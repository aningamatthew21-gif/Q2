'use strict';

/**
 * One-time migration: Backfill Purchase Requisitions for existing
 * "Pending Pricing" invoices that were created before the PR auto-creation
 * code was deployed.
 *
 * Run: node backend/migrate_backfill_prs.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const crypto = require('crypto');
const { initPool, execute, transaction, closePool } = require('./db');

async function backfill() {
    console.log('Starting PR backfill migration...\n');
    await initPool();

    // 1. Find all invoices with Pending Pricing that have no PRs
    const invoicesRes = await execute(`
        SELECT i.INVOICE_ID, i.CUSTOMER_NAME, i.CREATED_BY, i.SOURCING_STATUS, i.PR_COUNT
        FROM QA_INVOICES i
        WHERE i.STATUS = 'Pending Pricing'
          AND (i.PR_COUNT IS NULL OR i.PR_COUNT = 0)
    `);

    const invoices = invoicesRes.rows || [];
    console.log(`Found ${invoices.length} invoices needing PR backfill.\n`);

    if (invoices.length === 0) {
        console.log('Nothing to do.');
        await closePool();
        process.exit(0);
    }

    let totalPRs = 0;

    for (const inv of invoices) {
        const invId = inv.INVOICE_ID;
        console.log(`Processing invoice: ${invId} (${inv.CUSTOMER_NAME})`);

        // 2. Get line items for this invoice
        const linesRes = await execute(
            'SELECT * FROM QA_INVOICE_LINE_ITEMS WHERE INVOICE_ID = :id ORDER BY SORT_ORDER',
            { id: invId }
        );
        const lines = linesRes.rows || [];

        // 3. Filter lines that need procurement (sourced or zero price)
        const sourcedLines = lines.filter(li => {
            const sku = li.SKU || '';
            const price = Number(li.UNIT_PRICE || 0);
            // Sourced items have SOURCED-* SKUs or zero price
            if (sku.startsWith('SOURCED-')) return true;
            if (price === 0) return true;
            return false;
        });

        if (sourcedLines.length === 0) {
            console.log(`  No sourced lines found, skipping.`);
            continue;
        }

        console.log(`  Found ${sourcedLines.length} sourced line(s), creating PRs...`);

        await transaction(async (conn) => {
            for (const li of sourcedLines) {
                const seqRes = await conn.execute('SELECT QA_PR_SEQ.NEXTVAL AS N FROM DUAL');
                const seqNum = seqRes.rows[0].N;
                const prId = `PR-${crypto.randomUUID()}`;
                const prNumber = `PR-${new Date().getFullYear()}-${String(seqNum).padStart(4, '0')}`;
                const sku = li.SKU || '';
                const reason = sku.startsWith('SOURCED-') ? 'CUSTOM_SOURCED' : 'OUT_OF_STOCK';

                await conn.execute(`
                    INSERT INTO QA_PURCHASE_REQUISITIONS (
                        PR_ID, PR_NUMBER, INVOICE_ID, QUOTE_LINE_MATCH_KEY, ITEM_NAME, ITEM_DESCRIPTION,
                        QUANTITY, UOM, REASON, STATUS, PRIORITY, REQUESTED_BY, CUSTOMER_NAME
                    ) VALUES (
                        :id, :pn, :iid, :mk, :inm, :idesc,
                        :qty, 'EA', :reas, 'OPEN', 'normal', :rb, :cn
                    )
                `, {
                    id: prId,
                    pn: prNumber,
                    iid: invId,
                    mk: sku,
                    inm: li.ITEM_NAME || 'Sourced item',
                    idesc: li.ITEM_NAME || null,
                    qty: Number(li.QUANTITY) || 1,
                    reas: reason,
                    rb: inv.CREATED_BY || 'system',
                    cn: inv.CUSTOMER_NAME || null
                });

                await conn.execute(`
                    INSERT INTO QA_PROCUREMENT_EVENTS (EVENT_TYPE, ENTITY_TYPE, ENTITY_ID, ACTOR, PAYLOAD)
                    VALUES ('PR_CREATED', 'PR', :id, 'system', :payload)
                `, {
                    id: prId,
                    payload: JSON.stringify({
                        source: 'backfill_migration',
                        invoiceId: invId,
                        prNumber,
                        reason
                    })
                });

                console.log(`    Created PR ${prNumber} for "${li.ITEM_NAME}" (${reason})`);
                totalPRs++;
            }

            // Update invoice PR count and sourcing status
            await conn.execute(`
                UPDATE QA_INVOICES SET SOURCING_STATUS = 'PENDING', PR_COUNT = :pc
                WHERE INVOICE_ID = :id
            `, {
                pc: sourcedLines.length,
                id: invId
            });
        });

        console.log(`  Done. ${sourcedLines.length} PR(s) created for invoice ${invId}`);
    }

    console.log(`\nBackfill complete. Created ${totalPRs} total PRs across ${invoices.length} invoices.`);
    await closePool();
    process.exit(0);
}

backfill().catch(err => {
    console.error('Backfill failed:', err);
    process.exit(1);
});
