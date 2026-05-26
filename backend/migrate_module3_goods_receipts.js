'use strict';

/**
 * migrate_module3_goods_receipts.js — Module 3 of the Reports Foundation
 * build-out plan. Adds the procurement-receiving subsystem.
 *
 *   node backend/migrate_module3_goods_receipts.js
 *
 * Idempotent — re-runs are safe (catches ORA-01430 / ORA-00955 / ORA-02260).
 * Additive only — no destructive changes.
 *
 * What this adds:
 *
 *   NEW TABLES
 *     QA_GOODS_RECEIPTS          — one row per receiving event (per PR)
 *     QA_GOODS_RECEIPT_RETURNS   — post-receipt return events (RMAs)
 *
 *   ALTER QA_PURCHASE_REQUISITIONS  +4 columns:
 *     CANCELLATION_REASON   controlled vocab
 *     CANCELLATION_NOTES    free text
 *     CANCELLED_AT          timestamp
 *     CANCELLED_BY          email
 *     FULFILLED_AT          explicit fulfilment timestamp
 *                           (we previously inferred from UPDATED_AT)
 *
 *   SEQUENCE  QA_GR_SEQ           — receipt-number counter (GR-2026-NNNN)
 *
 * Why now (per the plan):
 *   - Vendor scorecards (Report #5) need on-time / defect / lead-time
 *     data captured per receipt. Without QA_GOODS_RECEIPTS we can only
 *     show "PR was marked FULFILLED" — a flag, no measurements.
 *   - PR cancellation analysis (Report #13) needs a structured reason
 *     code, not JSON parsed out of the PROCUREMENT_EVENTS payload.
 *   - Composite vendor performance score needs defect + return data
 *     that can only come from a receiving step.
 *
 * Per-PR granularity (locked in Module 3 kickoff): each receipt belongs
 * to one PR. Multi-PR shipments require multiple receipt rows. The
 * cumulative-qty math in the goods-receipts route handles partials.
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

async function run() {
  await initPool();
  console.log('▶ Module 3 — Procurement Goods Receipts migration');

  // ── QA_GOODS_RECEIPTS ────────────────────────────────────────────────
  console.log('• QA_GOODS_RECEIPTS');
  await ddl(
    'QA_GOODS_RECEIPTS table',
    `CREATE TABLE QA_GOODS_RECEIPTS (
       RECEIPT_ID              NUMBER         GENERATED ALWAYS AS IDENTITY,
       RECEIPT_NUMBER          VARCHAR2(40)   NOT NULL,
       PR_ID                   VARCHAR2(50)   NOT NULL,
       RFQ_ID                  VARCHAR2(50),
       VENDOR_ID               VARCHAR2(50),
       RECEIVED_DATE           DATE           NOT NULL,
       RECEIVED_BY             VARCHAR2(255),
       QTY_ORDERED             NUMBER(10,2)   DEFAULT 0,
       QTY_RECEIVED            NUMBER(10,2)   NOT NULL,
       QTY_DEFECTIVE           NUMBER(10,2)   DEFAULT 0,
       QTY_RETURNED            NUMBER(10,2)   DEFAULT 0,
       VENDOR_INVOICE_NUMBER   VARCHAR2(60),
       TOTAL_VALUE             NUMBER(15,2)   DEFAULT 0,
       CURRENCY                VARCHAR2(10)   DEFAULT 'GHS',
       STATUS                  VARCHAR2(30)   DEFAULT 'PENDING_QC',
       CONDITION_NOTES         VARCHAR2(2000),
       CREATED_AT              TIMESTAMP      DEFAULT SYSTIMESTAMP,
       UPDATED_AT              TIMESTAMP      DEFAULT SYSTIMESTAMP,
       CONSTRAINT PK_GR PRIMARY KEY (RECEIPT_ID),
       CONSTRAINT UQ_GR_NUMBER UNIQUE (RECEIPT_NUMBER),
       CONSTRAINT CHK_GR_STATUS CHECK (STATUS IN
         ('PENDING_QC','ACCEPTED','PARTIALLY_ACCEPTED','REJECTED'))
     )`
  );
  await ddl(
    'IDX_GR_PR',
    `CREATE INDEX IDX_GR_PR ON QA_GOODS_RECEIPTS(PR_ID)`
  );
  await ddl(
    'IDX_GR_VENDOR',
    `CREATE INDEX IDX_GR_VENDOR ON QA_GOODS_RECEIPTS(VENDOR_ID)`
  );
  await ddl(
    'IDX_GR_RFQ',
    `CREATE INDEX IDX_GR_RFQ ON QA_GOODS_RECEIPTS(RFQ_ID)`
  );
  await ddl(
    'IDX_GR_DATE',
    `CREATE INDEX IDX_GR_DATE ON QA_GOODS_RECEIPTS(RECEIVED_DATE)`
  );

  // ── QA_GOODS_RECEIPT_RETURNS ─────────────────────────────────────────
  console.log('• QA_GOODS_RECEIPT_RETURNS');
  await ddl(
    'QA_GOODS_RECEIPT_RETURNS table',
    `CREATE TABLE QA_GOODS_RECEIPT_RETURNS (
       RETURN_ID       NUMBER         GENERATED ALWAYS AS IDENTITY,
       RECEIPT_ID      NUMBER         NOT NULL,
       RETURN_DATE     DATE           NOT NULL,
       RETURN_QTY      NUMBER(10,2)   NOT NULL,
       RETURN_REASON   VARCHAR2(60)   NOT NULL,
       RMA_NUMBER      VARCHAR2(60),
       LOGGED_BY       VARCHAR2(255),
       LOGGED_AT       TIMESTAMP      DEFAULT SYSTIMESTAMP,
       NOTES           VARCHAR2(2000),
       CONSTRAINT PK_GR_RETURN PRIMARY KEY (RETURN_ID),
       CONSTRAINT FK_GR_RETURN_GR FOREIGN KEY (RECEIPT_ID)
         REFERENCES QA_GOODS_RECEIPTS(RECEIPT_ID) ON DELETE CASCADE,
       CONSTRAINT CHK_GR_RETURN_REASON CHECK (RETURN_REASON IN
         ('DEFECTIVE','WRONG_ITEM','DAMAGED','NOT_AS_SPECIFIED','EXPIRED','OTHER'))
     )`
  );
  await ddl(
    'IDX_GR_RETURN_RECEIPT',
    `CREATE INDEX IDX_GR_RETURN_RECEIPT ON QA_GOODS_RECEIPT_RETURNS(RECEIPT_ID)`
  );

  // ── EXTEND QA_PURCHASE_REQUISITIONS ─────────────────────────────────
  console.log('• QA_PURCHASE_REQUISITIONS extensions');
  await ddl(
    'QA_PURCHASE_REQUISITIONS.CANCELLATION_REASON',
    `ALTER TABLE QA_PURCHASE_REQUISITIONS ADD CANCELLATION_REASON VARCHAR2(40)`
  );
  await ddl(
    'QA_PURCHASE_REQUISITIONS.CANCELLATION_NOTES',
    `ALTER TABLE QA_PURCHASE_REQUISITIONS ADD CANCELLATION_NOTES VARCHAR2(2000)`
  );
  await ddl(
    'QA_PURCHASE_REQUISITIONS.CANCELLED_AT',
    `ALTER TABLE QA_PURCHASE_REQUISITIONS ADD CANCELLED_AT TIMESTAMP`
  );
  await ddl(
    'QA_PURCHASE_REQUISITIONS.CANCELLED_BY',
    `ALTER TABLE QA_PURCHASE_REQUISITIONS ADD CANCELLED_BY VARCHAR2(255)`
  );
  await ddl(
    'QA_PURCHASE_REQUISITIONS.FULFILLED_AT',
    `ALTER TABLE QA_PURCHASE_REQUISITIONS ADD FULFILLED_AT TIMESTAMP`
  );

  // ── SEQUENCE for receipt numbers ────────────────────────────────────
  console.log('• Sequence');
  await ddl(
    'QA_GR_SEQ',
    `CREATE SEQUENCE QA_GR_SEQ START WITH 1 INCREMENT BY 1 NOCACHE NOCYCLE`
  );

  console.log('✅ Module 3 schema ready');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Restart the backend so new routes load.');
  console.log('  2. From a PR in the AWARDED state, click "Receive Goods" to log the first receipt.');
  console.log('  3. Vendor scorecards become meaningful after the first ~5 receipts per vendor.');
  await closePool();
}

run().catch(async (err) => {
  console.error('❌ Migration failed:', err.message);
  try { await closePool(); } catch (_) { /* ignore */ }
  process.exit(1);
});
