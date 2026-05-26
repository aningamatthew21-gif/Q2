'use strict';

/**
 * migrate_module1_master_data.js — Module 1 of the Reports Foundation
 * build-out plan. Adds master-data columns that unblock AR-aging,
 * VAT-compliance, customer-segmentation, and spend-by-category reports.
 *
 *   node backend/migrate_module1_master_data.js
 *
 * Idempotent — re-runs are safe (catches ORA-01430 "column already exists"
 * and ORA-00955 "name already used"). All additions are NEW columns on
 * EXISTING tables; no destructive changes, no renames, no drops.
 *
 * What this adds:
 *
 *   QA_CUSTOMERS  +TIN, +DEFAULT_PAYMENT_TERMS, +CREDIT_LIMIT, +CREDIT_HOLD,
 *                 +INDUSTRY, +SIZE_BAND, +WHT_PROFILE_CODE
 *   QA_INVOICES   +DUE_DATE, +PAYMENT_TERMS
 *   QA_INVENTORY  +ITEM_CATEGORY, +ITEM_SUBCATEGORY
 *
 * Why now:
 *   - AR aging needs `DUE_DATE` to be meaningful (an aging report based
 *     on invoice-date overstates AR for any customer with longer terms).
 *   - Ghana VAT compliance reports need `TIN` per customer.
 *   - Sales win-rate-by-segment reports need `INDUSTRY` + `SIZE_BAND`.
 *   - Procurement spend-by-category report (Module 5) needs item category.
 *   - `WHT_PROFILE_CODE` is a forward link to the WHT profiles table
 *     created in Module 2; we add the column now so customers can be
 *     classified ahead of the collections build-out.
 *
 * Sister to Module 2 (collections) which will read DUE_DATE for aging
 * and WHT_PROFILE_CODE for withholding prediction.
 */

require('dotenv').config();
const { initPool, execute, closePool } = require('./db');

async function ddl(label, sql) {
  try {
    await execute(sql);
    console.log(`  ✓ ${label}`);
  } catch (err) {
    const msg = err.message || '';
    // ORA-01430: column being added already exists in table
    // ORA-00955: name already used (constraint / index already exists)
    if (/ORA-01430|ORA-00955/.test(msg)) {
      console.log(`  • ${label} — already exists, skipped`);
    } else {
      console.error(`  ✗ ${label} — ${msg}`);
      throw err;
    }
  }
}

async function run() {
  await initPool();
  console.log('▶ Module 1 — Master-data foundations migration');

  // ── QA_CUSTOMERS ─────────────────────────────────────────────────────
  // Each column added independently so a partial prior run still lets
  // subsequent columns add cleanly.
  console.log('• QA_CUSTOMERS');
  await ddl(
    'QA_CUSTOMERS.TIN (Ghana Taxpayer ID)',
    `ALTER TABLE QA_CUSTOMERS ADD TIN VARCHAR2(20)`
  );
  await ddl(
    'QA_CUSTOMERS.DEFAULT_PAYMENT_TERMS',
    `ALTER TABLE QA_CUSTOMERS ADD DEFAULT_PAYMENT_TERMS VARCHAR2(30) DEFAULT 'Net 30'`
  );
  await ddl(
    'QA_CUSTOMERS.CREDIT_LIMIT',
    `ALTER TABLE QA_CUSTOMERS ADD CREDIT_LIMIT NUMBER(15,2) DEFAULT 0`
  );
  await ddl(
    "QA_CUSTOMERS.CREDIT_HOLD (Y/N)",
    `ALTER TABLE QA_CUSTOMERS ADD CREDIT_HOLD CHAR(1) DEFAULT 'N'`
  );
  await ddl(
    'QA_CUSTOMERS.INDUSTRY',
    `ALTER TABLE QA_CUSTOMERS ADD INDUSTRY VARCHAR2(80)`
  );
  await ddl(
    'QA_CUSTOMERS.SIZE_BAND (Micro/Small/Medium/Large/Enterprise)',
    `ALTER TABLE QA_CUSTOMERS ADD SIZE_BAND VARCHAR2(20)`
  );
  await ddl(
    'QA_CUSTOMERS.WHT_PROFILE_CODE (forward link to Module 2)',
    `ALTER TABLE QA_CUSTOMERS ADD WHT_PROFILE_CODE VARCHAR2(40)`
  );

  // ── QA_INVOICES ──────────────────────────────────────────────────────
  console.log('• QA_INVOICES');
  await ddl(
    'QA_INVOICES.DUE_DATE',
    `ALTER TABLE QA_INVOICES ADD DUE_DATE DATE`
  );
  await ddl(
    'QA_INVOICES.PAYMENT_TERMS (snapshotted from customer at creation)',
    `ALTER TABLE QA_INVOICES ADD PAYMENT_TERMS VARCHAR2(30)`
  );

  // ── QA_INVENTORY ─────────────────────────────────────────────────────
  console.log('• QA_INVENTORY');
  await ddl(
    'QA_INVENTORY.ITEM_CATEGORY',
    `ALTER TABLE QA_INVENTORY ADD ITEM_CATEGORY VARCHAR2(80)`
  );
  await ddl(
    'QA_INVENTORY.ITEM_SUBCATEGORY',
    `ALTER TABLE QA_INVENTORY ADD ITEM_SUBCATEGORY VARCHAR2(80)`
  );

  // ── Indexes for the new lookup-heavy columns ─────────────────────────
  // Aging reports filter by DUE_DATE; spend-by-category sorts by item
  // category; segment reports group by industry. Each index small and
  // additive — existing query plans unchanged.
  console.log('• Indexes');
  await ddl(
    'IDX_INVOICES_DUE_DATE',
    `CREATE INDEX IDX_INVOICES_DUE_DATE ON QA_INVOICES(DUE_DATE)`
  );
  await ddl(
    'IDX_INVENTORY_CATEGORY',
    `CREATE INDEX IDX_INVENTORY_CATEGORY ON QA_INVENTORY(ITEM_CATEGORY)`
  );
  await ddl(
    'IDX_CUSTOMERS_INDUSTRY',
    `CREATE INDEX IDX_CUSTOMERS_INDUSTRY ON QA_CUSTOMERS(INDUSTRY)`
  );

  console.log('✅ Module 1 schema ready');
  console.log('');
  console.log('Next: restart the backend so the updated CRUD routes pick up the new columns.');
  await closePool();
}

run().catch(async (err) => {
  console.error('❌ Migration failed:', err.message);
  try { await closePool(); } catch (_) { /* ignore */ }
  process.exit(1);
});
