'use strict';

/**
 * migrate_invoice_soft_delete.js
 *
 * SP1-C2 — Soft-delete on invoices.
 *
 * Why:
 *   The previous DELETE /api/invoices/:id ran `DELETE FROM QA_INVOICES`
 *   with cascade to line items + payments. Permanently destroying
 *   financial records violates:
 *     - Ghana Companies Act 2019 — 6-year retention of corporate records
 *     - SOX-style financial-controls discipline (7-year retention)
 *     - ISO/IEC 27001:2022 A.8.10 (Information Deletion) — requires a
 *       documented retention policy BEFORE secure deletion
 *
 * Strategy (chosen for minimal blast radius, per QA session 2026-05-25):
 *   - Add IS_DELETED CHAR(1) DEFAULT 'N' column
 *   - Add DELETED_AT TIMESTAMP and DELETED_BY VARCHAR2(255) for audit trail
 *   - Add IS_DELETED-aware index for fast active-list scans
 *   - DELETE handler is rewritten in routes/invoices.js to UPDATE the
 *     flag instead of removing the row.
 *
 * Idempotent (catches ORA-01430 / ORA-00955 / ORA-01451). Safe to re-run.
 *
 *   node backend/migrate_invoice_soft_delete.js
 */

require('dotenv').config();
const { initPool, execute, closePool } = require('./db');

async function ddl(label, sql) {
  try {
    await execute(sql);
    console.log(`  ✓ ${label}`);
  } catch (err) {
    const msg = err.message || '';
    // ORA codes treated as "already done — skip cleanly":
    //   ORA-01430  column being added already exists
    //   ORA-00955  name is already used by an existing object (table/index)
    //   ORA-02260  table can have only one primary key
    //   ORA-02275  such referential constraint exists
    //   ORA-01451  already specifying NULL/NOT NULL
    //   ORA-01442  column to be modified to NOT NULL is already NOT NULL
    //   ORA-02264  name already used by an existing constraint  ← seen on re-run
    if (/ORA-01430|ORA-00955|ORA-02260|ORA-02275|ORA-01451|ORA-01442|ORA-02264/.test(msg)) {
      console.log(`  • ${label} — already exists, skipped`);
    } else {
      console.error(`  ✗ ${label} — ${msg}`);
      throw err;
    }
  }
}

async function run() {
  await initPool();
  console.log('▶ SP1-C2 Invoice soft-delete migration');

  await ddl(
    'QA_INVOICES.IS_DELETED column (CHAR(1) DEFAULT \'N\')',
    `ALTER TABLE QA_INVOICES ADD (IS_DELETED CHAR(1) DEFAULT 'N')`
  );
  await ddl(
    'QA_INVOICES.IS_DELETED check constraint',
    `ALTER TABLE QA_INVOICES ADD CONSTRAINT CK_INV_IS_DEL CHECK (IS_DELETED IN ('Y','N'))`
  );
  await ddl(
    'QA_INVOICES.DELETED_AT TIMESTAMP',
    `ALTER TABLE QA_INVOICES ADD (DELETED_AT TIMESTAMP)`
  );
  await ddl(
    'QA_INVOICES.DELETED_BY VARCHAR2(255)',
    `ALTER TABLE QA_INVOICES ADD (DELETED_BY VARCHAR2(255))`
  );
  // Functional index on IS_DELETED keeps "active list" scans fast
  // without needing to refactor every SELECT into a covering index.
  await ddl(
    'IDX_INV_IS_DELETED index',
    `CREATE INDEX IDX_INV_IS_DELETED ON QA_INVOICES(IS_DELETED)`
  );

  // Backfill: explicitly mark every existing row as not-deleted so the
  // column is never NULL (defensive — DEFAULT only applies to new rows).
  console.log('▶ Backfilling existing rows IS_DELETED=\'N\'…');
  const upd = await execute(
    `UPDATE QA_INVOICES SET IS_DELETED = 'N' WHERE IS_DELETED IS NULL`
  );
  console.log(`  ✓ ${upd.rowsAffected || 0} row(s) backfilled`);

  console.log('✅ Invoice soft-delete schema ready');
  console.log('');
  console.log('Next step: restart the backend so the updated DELETE handler in');
  console.log('routes/invoices.js (UPDATE … SET IS_DELETED=\'Y\') takes effect.');
  await closePool();
}

run().catch(async (err) => {
  console.error('❌ Migration failed:', err.message);
  try { await closePool(); } catch (_) { /* ignore */ }
  process.exit(1);
});
