'use strict';

/**
 * migrate_module4_reasons.js
 *
 * Module 4 — Sales win/loss + segmentation foundations.
 *
 * Adds a small controlled vocabulary so the eventual win/loss,
 * cancellation-analysis, and rejection-reason reports have something
 * to GROUP BY instead of free-text strings ("dnt want", "too pricey",
 * "pricing too high", "Price High", … — all the same reason today
 * but unjoinable).
 *
 *   node backend/migrate_module4_reasons.js
 *
 * Idempotent. Pure additive — same `ddl` pattern as the prior modules.
 * Existing REJECTION_REASON / REJECTION_NOTES columns are NOT touched;
 * the new *_CODE columns sit alongside them so historical free-text
 * data keeps rendering as-is.
 */

require('dotenv').config();
const { initPool, execute, closePool } = require('./db');

async function ddl(label, sql) {
  try {
    await execute(sql);
    console.log(`  ✓ ${label}`);
  } catch (err) {
    const msg = err.message || '';
    if (/ORA-01430|ORA-00955|ORA-02260|ORA-02275/.test(msg)) {
      console.log(`  • ${label} — already exists, skipped`);
    } else {
      console.error(`  ✗ ${label} — ${msg}`);
      throw err;
    }
  }
}

/**
 * Seed a single reason code. Uses MERGE for true idempotency — running
 * the seed twice doesn't duplicate or overwrite a manually-edited label.
 *
 *   - INSERT when the CODE is new
 *   - SKIP when the CODE exists (do nothing in the MATCHED branch)
 */
async function seedReason(code, category, label, sortOrder) {
  await execute(
    `MERGE INTO QA_REASON_CODES tgt
     USING (SELECT :code AS CODE FROM dual) src
        ON (tgt.CODE = src.CODE)
     WHEN NOT MATCHED THEN
       INSERT (CODE, CATEGORY, LABEL, IS_ACTIVE, SORT_ORDER)
       VALUES (:code, :cat, :lbl, 'Y', :so)`,
    { code, cat: category, lbl: label, so: sortOrder }
  );
}

async function run() {
  await initPool();
  console.log('▶ Module 4 — reason-codes + invoice/quote columns');

  // ── 1. Master table ─────────────────────────────────────────────
  await ddl(
    'QA_REASON_CODES table',
    `CREATE TABLE QA_REASON_CODES (
       CODE        VARCHAR2(40)  NOT NULL,
       CATEGORY    VARCHAR2(30)  NOT NULL,
       LABEL       VARCHAR2(100) NOT NULL,
       IS_ACTIVE   CHAR(1)       DEFAULT 'Y',
       SORT_ORDER  NUMBER(3)     DEFAULT 100,
       CREATED_AT  TIMESTAMP     DEFAULT SYSTIMESTAMP,
       UPDATED_AT  TIMESTAMP     DEFAULT SYSTIMESTAMP,
       CONSTRAINT PK_REASON_CODES PRIMARY KEY (CODE),
       CONSTRAINT CK_REASON_ACTIVE CHECK (IS_ACTIVE IN ('Y','N'))
     )`
  );
  await ddl(
    'IDX_REASON_CAT_ACT',
    `CREATE INDEX IDX_REASON_CAT_ACT ON QA_REASON_CODES(CATEGORY, IS_ACTIVE, SORT_ORDER)`
  );

  // ── 2. Invoice columns ──────────────────────────────────────────
  await ddl(
    'QA_INVOICES.REJECTION_REASON_CODE',
    `ALTER TABLE QA_INVOICES ADD (REJECTION_REASON_CODE VARCHAR2(40))`
  );
  await ddl(
    'QA_INVOICES.LOST_TO_COMPETITOR',
    `ALTER TABLE QA_INVOICES ADD (LOST_TO_COMPETITOR VARCHAR2(120))`
  );
  await ddl(
    'QA_INVOICES.WIN_REASON_CODE',
    `ALTER TABLE QA_INVOICES ADD (WIN_REASON_CODE VARCHAR2(40))`
  );

  // ── 3. Quote columns ────────────────────────────────────────────
  await ddl(
    'QA_QUOTES.REJECTION_REASON_CODE',
    `ALTER TABLE QA_QUOTES ADD (REJECTION_REASON_CODE VARCHAR2(40))`
  );
  await ddl(
    'QA_QUOTES.REJECTION_NOTES',
    `ALTER TABLE QA_QUOTES ADD (REJECTION_NOTES VARCHAR2(2000))`
  );

  // ── 4. Seed industry-standard reason codes ──────────────────────
  // Categories drive the dropdown filter on each modal. Sort orders
  // are coarse (10/20/30) so admins can wedge custom codes in
  // between without renumbering.
  console.log('▶ Seeding reason codes');

  // ───── QUOTE_REJECTION — sales head / customer rejects a quote ─
  const quoteRej = [
    ['PRICE_TOO_HIGH',     'Price too high / out of budget',         10],
    ['COMPETITOR_WON',     'Competitor won the deal',                20],
    ['SPEC_MISMATCH',      'Spec / requirement mismatch',            30],
    ['TIMING_DELAYED',     'Timing — customer delayed decision',     40],
    ['PROJECT_CANCELLED',  'Customer project cancelled',             50],
    ['BUDGET_FROZEN',      'Customer budget frozen',                 60],
    ['LOST_CONTACT',       'Lost contact with customer',             70],
    ['NO_DECISION',        'No decision made (lapsed)',              80],
    ['INTERNAL_ERROR',     'Quote had an internal error',            90],
    ['QUOTE_OTHER',        'Other (see notes)',                     999]
  ];
  for (const [code, label, so] of quoteRej) {
    await seedReason(code, 'QUOTE_REJECTION', label, so);
  }

  // ───── INVOICE_REJECTION — finance head rejects an invoice ────
  const invRej = [
    ['INV_PRICING_ERROR',     'Pricing error — needs correction',         10],
    ['INV_TAX_ERROR',         'Tax breakdown incorrect',                  20],
    ['INV_QTY_MISMATCH',      'Quantity / line items mismatch',           30],
    ['INV_CUSTOMER_DETAILS',  'Customer details incorrect',               40],
    ['INV_MISSING_APPROVAL',  'Missing prior approval / authorization',   50],
    ['INV_DUPLICATE',         'Duplicate invoice',                        60],
    ['INV_CREDIT_HOLD',       'Customer on credit hold',                  70],
    ['INV_POLICY',            'Violates pricing / discount policy',       80],
    ['INV_OTHER',             'Other (see notes)',                       999]
  ];
  for (const [code, label, so] of invRej) {
    await seedReason(code, 'INVOICE_REJECTION', label, so);
  }

  // ───── LOST_DEAL — customer rejected the final invoice ────────
  const lost = [
    ['LOST_PRICE',         'Price (chose cheaper supplier)',           10],
    ['LOST_COMPETITOR',    'Lost to a named competitor',               20],
    ['LOST_TIMING',        'Timing — customer needed it sooner',       30],
    ['LOST_QUALITY_SPEC',  'Spec / quality concerns',                  40],
    ['LOST_PAYMENT_TERMS', 'Payment terms / credit not acceptable',    50],
    ['LOST_RELATIONSHIP',  'Relationship / service concern',           60],
    ['LOST_NO_REASON',     'No reason given',                          70],
    ['LOST_OTHER',         'Other (see notes)',                       999]
  ];
  for (const [code, label, so] of lost) {
    await seedReason(code, 'LOST_DEAL', label, so);
  }

  // ───── WON_DEAL — customer accepted the final invoice ─────────
  const won = [
    ['WON_PRICE',          'Best price',                              10],
    ['WON_QUALITY',        'Quality / spec match',                    20],
    ['WON_RELATIONSHIP',   'Existing relationship / repeat customer', 30],
    ['WON_LEAD_TIME',      'Fastest delivery / lead time',            40],
    ['WON_SERVICE',        'Service / support reputation',            50],
    ['WON_SOLE_SOURCE',    'Sole-source / no competition',            60],
    ['WON_OTHER',          'Other (see notes)',                      999]
  ];
  for (const [code, label, so] of won) {
    await seedReason(code, 'WON_DEAL', label, so);
  }

  console.log('✅ Module 4 schema + seed ready');
  await closePool();
}

run().catch(async (err) => {
  console.error('❌ Migration failed:', err.message);
  try { await closePool(); } catch (_) { /* ignore */ }
  process.exit(1);
});
