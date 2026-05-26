'use strict';

/**
 * migrate_module2_collections.js — Module 2 of the Reports Foundation
 * build-out plan. Stands up the collections / payment subsystem the
 * existing app has been missing.
 *
 *   node backend/migrate_module2_collections.js
 *
 * Idempotent — re-runs are safe (catches ORA-01430 / ORA-00955).
 * Additive only — no destructive changes.
 *
 * What this adds:
 *
 *   NEW TABLES
 *     QA_WHT_TYPES               — withholding-tax catalogue (config)
 *     QA_WHT_PROFILES            — customer WHT profiles (Gov / B2B / Retail)
 *     QA_UNALLOCATED_PAYMENTS    — general payment intake bucket
 *     QA_COLLECTION_ACTIONS      — per-invoice follow-up log
 *     QA_WHT_CERTIFICATES        — customer-issued WHT certificate storage
 *
 *   ALTER QA_INVOICE_PAYMENTS  +9 columns (WHT breakdown, receipt #,
 *                                          status, reversal, cheque/bank)
 *
 *   SEQUENCE  QA_RCPT_SEQ        — receipt-number counter (RCPT-2026-NNNN)
 *
 *   SEED      QA_WHT_TYPES       — Ghana defaults: VAT WHT 7%, Service
 *                                  WHT 7.5%, Goods WHT 3%, Rent WHT 8%
 *   SEED      QA_WHT_PROFILES    — Government, Private B2B, Retail
 *
 * Why now:
 *   - The current `QA_INVOICE_PAYMENTS` table exists but is bare (7
 *     columns, no UI ever rendered against it). A real collections module
 *     needs payment-level WHT breakdown, reversal audit, and per-payment
 *     receipt numbers — those columns are added here.
 *   - WHT prediction (Module 2's hardest engineering bit) needs the
 *     configurable WHT_TYPES + per-customer WHT_PROFILES so it can
 *     enumerate plausible combinations.
 *   - Customer statements need a collection-action log to surface
 *     follow-up history alongside the invoice / payment timeline.
 *
 * Sister to Module 1 — reads Module 1's invoice `DUE_DATE` for aging
 * computation and Module 1's customer `WHT_PROFILE_CODE` to drive the
 * prediction engine.
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
 * Run an INSERT but ignore the unique-key violation that fires on re-run
 * (ORA-00001). Used for seed data so the migration is replay-safe.
 */
async function seed(label, sql, binds = {}) {
  try {
    await execute(sql, binds);
    console.log(`  ✓ seed: ${label}`);
  } catch (err) {
    const msg = err.message || '';
    if (/ORA-00001/.test(msg)) {
      console.log(`  • seed: ${label} — already exists, skipped`);
    } else {
      console.error(`  ✗ seed: ${label} — ${msg}`);
      throw err;
    }
  }
}

async function run() {
  await initPool();
  console.log('▶ Module 2 — Collections / Payment System migration');

  // ── QA_WHT_TYPES ─────────────────────────────────────────────────────
  console.log('• QA_WHT_TYPES');
  await ddl(
    'QA_WHT_TYPES table',
    `CREATE TABLE QA_WHT_TYPES (
       WHT_CODE     VARCHAR2(30)   NOT NULL,
       WHT_NAME     VARCHAR2(100)  NOT NULL,
       WHT_RATE     NUMBER(5,2)    NOT NULL,
       APPLIES_TO   VARCHAR2(20)   DEFAULT 'subtotal',
       IS_ACTIVE    CHAR(1)        DEFAULT 'Y',
       SORT_ORDER   NUMBER(3)      DEFAULT 0,
       CREATED_AT   TIMESTAMP      DEFAULT SYSTIMESTAMP,
       CONSTRAINT PK_WHT_TYPES PRIMARY KEY (WHT_CODE),
       CONSTRAINT CHK_WHT_APPLIES CHECK (APPLIES_TO IN ('subtotal','gross')),
       CONSTRAINT CHK_WHT_ACTIVE  CHECK (IS_ACTIVE  IN ('Y','N'))
     )`
  );

  // ── QA_WHT_PROFILES ──────────────────────────────────────────────────
  console.log('• QA_WHT_PROFILES');
  await ddl(
    'QA_WHT_PROFILES table',
    `CREATE TABLE QA_WHT_PROFILES (
       PROFILE_CODE VARCHAR2(40)   NOT NULL,
       PROFILE_NAME VARCHAR2(100)  NOT NULL,
       WHT_CODES    VARCHAR2(500),
       IS_DEFAULT   CHAR(1)        DEFAULT 'N',
       CREATED_AT   TIMESTAMP      DEFAULT SYSTIMESTAMP,
       CONSTRAINT PK_WHT_PROFILES PRIMARY KEY (PROFILE_CODE),
       CONSTRAINT CHK_PROFILE_DEFAULT CHECK (IS_DEFAULT IN ('Y','N'))
     )`
  );

  // ── QA_UNALLOCATED_PAYMENTS ──────────────────────────────────────────
  console.log('• QA_UNALLOCATED_PAYMENTS');
  await ddl(
    'QA_UNALLOCATED_PAYMENTS table',
    `CREATE TABLE QA_UNALLOCATED_PAYMENTS (
       UNALLOC_ID        NUMBER         GENERATED ALWAYS AS IDENTITY,
       CUSTOMER_ID       VARCHAR2(50)   NOT NULL,
       AMOUNT            NUMBER(15,2)   NOT NULL,
       CURRENCY          VARCHAR2(10)   DEFAULT 'GHS',
       PAYMENT_DATE      DATE,
       PAYMENT_METHOD    VARCHAR2(50),
       REFERENCE_NUMBER  VARCHAR2(255),
       BANK_NAME         VARCHAR2(100),
       STATUS            VARCHAR2(20)   DEFAULT 'UNAPPLIED',
       LOGGED_BY         VARCHAR2(255),
       LOGGED_AT         TIMESTAMP      DEFAULT SYSTIMESTAMP,
       NOTES             VARCHAR2(2000),
       CONSTRAINT PK_UNALLOC PRIMARY KEY (UNALLOC_ID),
       CONSTRAINT CHK_UNALLOC_STATUS CHECK (STATUS IN
         ('UNAPPLIED','PARTIALLY_APPLIED','APPLIED','REFUNDED'))
     )`
  );
  await ddl(
    'IDX_UNALLOC_CUSTOMER',
    `CREATE INDEX IDX_UNALLOC_CUSTOMER ON QA_UNALLOCATED_PAYMENTS(CUSTOMER_ID)`
  );
  await ddl(
    'IDX_UNALLOC_STATUS',
    `CREATE INDEX IDX_UNALLOC_STATUS ON QA_UNALLOCATED_PAYMENTS(STATUS)`
  );

  // ── QA_COLLECTION_ACTIONS ────────────────────────────────────────────
  console.log('• QA_COLLECTION_ACTIONS');
  await ddl(
    'QA_COLLECTION_ACTIONS table',
    `CREATE TABLE QA_COLLECTION_ACTIONS (
       ACTION_ID            NUMBER         GENERATED ALWAYS AS IDENTITY,
       INVOICE_ID           VARCHAR2(50)   NOT NULL,
       ACTION_DATE          TIMESTAMP      DEFAULT SYSTIMESTAMP,
       ACTION_TYPE          VARCHAR2(30)   NOT NULL,
       ACTOR                VARCHAR2(255)  NOT NULL,
       OUTCOME              VARCHAR2(60),
       PROMISE_TO_PAY_DATE  DATE,
       NEXT_ACTION_DATE     DATE,
       NOTES                VARCHAR2(2000),
       CREATED_AT           TIMESTAMP      DEFAULT SYSTIMESTAMP,
       CONSTRAINT PK_COLL_ACTIONS PRIMARY KEY (ACTION_ID),
       CONSTRAINT CHK_COLL_TYPE CHECK (ACTION_TYPE IN
         ('CALL','EMAIL','SMS','MEETING','NOTE','STATEMENT_SENT','DISPUTE_LOGGED'))
     )`
  );
  await ddl(
    'IDX_COLL_INVOICE',
    `CREATE INDEX IDX_COLL_INVOICE ON QA_COLLECTION_ACTIONS(INVOICE_ID)`
  );
  await ddl(
    'IDX_COLL_NEXT',
    `CREATE INDEX IDX_COLL_NEXT ON QA_COLLECTION_ACTIONS(NEXT_ACTION_DATE)`
  );

  // ── QA_WHT_CERTIFICATES ──────────────────────────────────────────────
  console.log('• QA_WHT_CERTIFICATES');
  await ddl(
    'QA_WHT_CERTIFICATES table',
    `CREATE TABLE QA_WHT_CERTIFICATES (
       CERT_ID        NUMBER         GENERATED ALWAYS AS IDENTITY,
       CUSTOMER_ID    VARCHAR2(50)   NOT NULL,
       PAYMENT_ID     NUMBER,
       CERT_NUMBER    VARCHAR2(60),
       CERT_DATE      DATE,
       CERT_FILE_URL  VARCHAR2(500),
       UPLOADED_BY    VARCHAR2(255),
       UPLOADED_AT    TIMESTAMP      DEFAULT SYSTIMESTAMP,
       CONSTRAINT PK_WHT_CERT PRIMARY KEY (CERT_ID)
     )`
  );
  await ddl(
    'IDX_WHT_CERT_CUSTOMER',
    `CREATE INDEX IDX_WHT_CERT_CUSTOMER ON QA_WHT_CERTIFICATES(CUSTOMER_ID)`
  );
  await ddl(
    'IDX_WHT_CERT_PAYMENT',
    `CREATE INDEX IDX_WHT_CERT_PAYMENT ON QA_WHT_CERTIFICATES(PAYMENT_ID)`
  );

  // ── EXTEND QA_INVOICE_PAYMENTS ───────────────────────────────────────
  console.log('• QA_INVOICE_PAYMENTS extensions');
  await ddl(
    'QA_INVOICE_PAYMENTS.WHT_TOTAL',
    `ALTER TABLE QA_INVOICE_PAYMENTS ADD WHT_TOTAL NUMBER(15,2) DEFAULT 0`
  );
  await ddl(
    'QA_INVOICE_PAYMENTS.WHT_BREAKDOWN (JSON)',
    `ALTER TABLE QA_INVOICE_PAYMENTS ADD WHT_BREAKDOWN CLOB`
  );
  await ddl(
    'QA_INVOICE_PAYMENTS.RECEIPT_NUMBER',
    `ALTER TABLE QA_INVOICE_PAYMENTS ADD RECEIPT_NUMBER VARCHAR2(40)`
  );
  await ddl(
    'QA_INVOICE_PAYMENTS.LOGGED_BY',
    `ALTER TABLE QA_INVOICE_PAYMENTS ADD LOGGED_BY VARCHAR2(255)`
  );
  await ddl(
    "QA_INVOICE_PAYMENTS.STATUS (DRAFT/CONFIRMED/REVERSED)",
    `ALTER TABLE QA_INVOICE_PAYMENTS ADD STATUS VARCHAR2(20) DEFAULT 'CONFIRMED'`
  );
  await ddl(
    'QA_INVOICE_PAYMENTS.REVERSED_AT',
    `ALTER TABLE QA_INVOICE_PAYMENTS ADD REVERSED_AT TIMESTAMP`
  );
  await ddl(
    'QA_INVOICE_PAYMENTS.REVERSED_BY',
    `ALTER TABLE QA_INVOICE_PAYMENTS ADD REVERSED_BY VARCHAR2(255)`
  );
  await ddl(
    'QA_INVOICE_PAYMENTS.REVERSAL_REASON',
    `ALTER TABLE QA_INVOICE_PAYMENTS ADD REVERSAL_REASON VARCHAR2(500)`
  );
  await ddl(
    'QA_INVOICE_PAYMENTS.CHEQUE_NUMBER',
    `ALTER TABLE QA_INVOICE_PAYMENTS ADD CHEQUE_NUMBER VARCHAR2(50)`
  );
  await ddl(
    'QA_INVOICE_PAYMENTS.BANK_NAME',
    `ALTER TABLE QA_INVOICE_PAYMENTS ADD BANK_NAME VARCHAR2(100)`
  );
  await ddl(
    'QA_INVOICE_PAYMENTS.NOTES',
    `ALTER TABLE QA_INVOICE_PAYMENTS ADD NOTES VARCHAR2(2000)`
  );
  await ddl(
    'QA_INVOICE_PAYMENTS.UNALLOC_ID',
    `ALTER TABLE QA_INVOICE_PAYMENTS ADD UNALLOC_ID NUMBER`
  );

  // ── SEQUENCE for receipt numbers ─────────────────────────────────────
  console.log('• Sequence');
  await ddl(
    'QA_RCPT_SEQ',
    `CREATE SEQUENCE QA_RCPT_SEQ START WITH 1 INCREMENT BY 1 NOCACHE NOCYCLE`
  );

  // ── SEED WHT TYPES (Ghana defaults) ──────────────────────────────────
  // Standard Ghana withholding rates as of 2026. APPLIES_TO determines
  // whether the % is calculated on the invoice subtotal (taxable amount
  // before VAT) or on gross (including VAT). Most Ghanaian WHTs apply on
  // subtotal — VAT WHT being the notable exception.
  console.log('• Seed WHT types');
  const seedWhtTypes = [
    { code: 'VAT_WHT',    name: 'VAT Withholding',     rate: 7.0,  applies: 'gross',    sort: 10 },
    { code: 'SERVICE_WHT',name: 'Service Withholding', rate: 7.5,  applies: 'subtotal', sort: 20 },
    { code: 'GOODS_WHT',  name: 'Goods Withholding',   rate: 3.0,  applies: 'subtotal', sort: 30 },
    { code: 'RENT_WHT',   name: 'Rent Withholding',    rate: 8.0,  applies: 'subtotal', sort: 40 }
  ];
  for (const w of seedWhtTypes) {
    await seed(
      `WHT type ${w.code} @ ${w.rate}%`,
      `INSERT INTO QA_WHT_TYPES (WHT_CODE, WHT_NAME, WHT_RATE, APPLIES_TO, SORT_ORDER)
       VALUES (:code, :name, :rate, :applies, :sort)`,
      w
    );
  }

  // ── SEED WHT PROFILES ────────────────────────────────────────────────
  // Three baseline profiles per Ghanaian withholding norms:
  //   Government     — withholds everything (worst case for receivables)
  //   Private B2B    — typically withholds VAT + service/goods
  //   Retail / End   — no withholding (rare, but valid)
  console.log('• Seed WHT profiles');
  const seedProfiles = [
    { code: 'GOVERNMENT',  name: 'Government / Public Sector', codes: 'VAT_WHT,SERVICE_WHT,GOODS_WHT,RENT_WHT', def: 'N' },
    { code: 'PRIVATE_B2B', name: 'Private B2B',                codes: 'VAT_WHT,SERVICE_WHT,GOODS_WHT',          def: 'Y' },
    { code: 'RETAIL',      name: 'Retail / End Consumer',      codes: '',                                       def: 'N' }
  ];
  for (const p of seedProfiles) {
    await seed(
      `Profile ${p.code}`,
      `INSERT INTO QA_WHT_PROFILES (PROFILE_CODE, PROFILE_NAME, WHT_CODES, IS_DEFAULT)
       VALUES (:code, :name, :codes, :def)`,
      p
    );
  }

  console.log('✅ Module 2 schema ready');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Restart the backend so new routes load.');
  console.log('  2. Optionally classify customers via CustomerModal → WHT Profile Code (PRIVATE_B2B / GOVERNMENT / RETAIL).');
  console.log('  3. Begin logging payments from Collections Workbench or InvoiceEditor.');
  await closePool();
}

run().catch(async (err) => {
  console.error('❌ Migration failed:', err.message);
  try { await closePool(); } catch (_) { /* ignore */ }
  process.exit(1);
});
