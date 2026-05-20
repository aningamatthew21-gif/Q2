'use strict';

/**
 * migrate_optimistic_locking.js — adds a ROW_VERSION column to QA_INVOICES
 * so the PUT route can detect concurrent edits and reject the loser with a
 * 409 Conflict instead of silently overwriting them.
 *
 *   node backend/migrate_optimistic_locking.js
 *
 * Idempotent: re-runs are safe. Existing rows default to ROW_VERSION = 1,
 * so frontends fetching pre-existing invoices receive a valid version on
 * day one.
 *
 * Sister to the inventory race fix that landed alongside this migration in
 * the invoice-approval transaction (stock decrement is now atomic with the
 * status change). Together they close the two lost-update bugs surfaced in
 * the multi-user concurrency review.
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
    // ORA-00955: name already used
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
  console.log('▶ Optimistic-locking migration');

  await ddl(
    'QA_INVOICES.ROW_VERSION column',
    `ALTER TABLE QA_INVOICES ADD ROW_VERSION NUMBER DEFAULT 1 NOT NULL`
  );

  // Backfill any rows that somehow have NULL (defensive — DEFAULT should
  // have handled this, but if the column already existed without a default
  // there could be nulls). Safe to run repeatedly.
  await execute(`UPDATE QA_INVOICES SET ROW_VERSION = 1 WHERE ROW_VERSION IS NULL`);
  console.log('  ✓ Backfill NULL ROW_VERSION → 1 (if any)');

  console.log('✅ Optimistic-locking schema ready');
  await closePool();
}

run().catch(async (err) => {
  console.error('❌ Migration failed:', err.message);
  try { await closePool(); } catch (_) { /* ignore */ }
  process.exit(1);
});
