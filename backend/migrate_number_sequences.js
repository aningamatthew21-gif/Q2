'use strict';

/**
 * migrate_number_sequences.js — standardized document numbering
 *
 * Standards anchor:
 *   - SAP S/4HANA "Number Range" pattern
 *   - Oracle EBS "Document Sequences"
 *   - Dynamics 365 BC "No. Series"
 *   - NetSuite "Auto-Generated Numbers"
 *
 * Schema:
 *   QA_NUMBER_SEQUENCES — one row per document type. The generator
 *   atomically increments CURRENT_COUNTER under SELECT ... FOR UPDATE
 *   so concurrent INSERT bursts can't race-condition into duplicate
 *   numbers (the classic gap-vs-duplicate trade-off — we choose
 *   "no duplicates ever, occasional gap on rolled-back transactions").
 *
 * Format produced by backend/utils/numberGenerator.js:
 *   {PREFIX}-{DOC_CODE}-{PERIOD_KEY}-{COUNTER zero-padded to PADDING digits}
 *
 *   Monthly: MIDSA-INV-05-2026-00001
 *   Yearly:  MIDSA-INV-2026-00001
 *   Never:   MIDSA-INV-00001
 *
 * Seed defaults match the user's stated preferences:
 *   - Company prefix: MIDSA
 *   - Reset frequency: MONTHLY
 *   - Padding: 5 digits
 *   - Doc codes: INV, PR, RFQ, GR, MEMO
 *
 * Idempotent: catches ORA-00955 (object exists) so it can be re-run
 * safely. After migration, the table is editable by Finance Head + Admin
 * via the new Numbering Settings page.
 *
 *   node backend/migrate_number_sequences.js
 */

require('dotenv').config();
const { initPool, execute, closePool } = require('./db');

async function ddl(label, sql) {
  try {
    await execute(sql);
    console.log(`  ✓ ${label}`);
  } catch (err) {
    const msg = err.message || '';
    if (/ORA-01430|ORA-00955|ORA-02260|ORA-02275|ORA-01442|ORA-01451|ORA-02264/.test(msg)) {
      console.log(`  • ${label} — already exists, skipped`);
    } else {
      console.error(`  ✗ ${label} — ${msg}`);
      throw err;
    }
  }
}

async function seedRow(docType, prefix, docCode, resetPeriod = 'MONTHLY', padding = 5) {
  // INSERT-IF-NOT-EXISTS via MERGE so we don't fight ORA-00001 on re-runs
  // AND we don't overwrite an admin's edits to existing rows.
  await execute(
    `MERGE INTO QA_NUMBER_SEQUENCES t
     USING (SELECT :docType AS DOC_TYPE FROM DUAL) src
     ON (t.DOC_TYPE = src.DOC_TYPE)
     WHEN NOT MATCHED THEN INSERT
       (DOC_TYPE, PREFIX, DOC_CODE, PADDING, RESET_PERIOD, CURRENT_COUNTER, CURRENT_PERIOD_KEY)
     VALUES
       (:docType, :prefix, :docCode, :padding, :resetPeriod, 0, NULL)`,
    { docType, prefix, docCode, padding, resetPeriod }
  );
}

async function run() {
  await initPool();
  console.log('▶ Standardized document-numbering migration');

  await ddl(
    'QA_NUMBER_SEQUENCES table',
    `CREATE TABLE QA_NUMBER_SEQUENCES (
       DOC_TYPE            VARCHAR2(20)   NOT NULL,
       PREFIX              VARCHAR2(20)   NOT NULL,
       DOC_CODE            VARCHAR2(20)   NOT NULL,
       PADDING             NUMBER(2)      DEFAULT 5 NOT NULL,
       RESET_PERIOD        VARCHAR2(10)   DEFAULT 'MONTHLY' NOT NULL,
       CURRENT_COUNTER     NUMBER(10)     DEFAULT 0 NOT NULL,
       CURRENT_PERIOD_KEY  VARCHAR2(10),
       UPDATED_AT          TIMESTAMP      DEFAULT SYSTIMESTAMP,
       UPDATED_BY          VARCHAR2(255),
       CONSTRAINT PK_NUM_SEQ           PRIMARY KEY (DOC_TYPE),
       CONSTRAINT CK_NUM_SEQ_RESET     CHECK (RESET_PERIOD IN ('NEVER', 'YEARLY', 'MONTHLY')),
       CONSTRAINT CK_NUM_SEQ_PADDING   CHECK (PADDING BETWEEN 1 AND 10),
       CONSTRAINT CK_NUM_SEQ_PREFIX    CHECK (REGEXP_LIKE(PREFIX,   '^[A-Z0-9_]{1,20}$')),
       CONSTRAINT CK_NUM_SEQ_DOC_CODE  CHECK (REGEXP_LIKE(DOC_CODE, '^[A-Z0-9_]{1,20}$'))
     )`
  );

  console.log('  • Seeding default rows (idempotent)…');
  await seedRow('INV',  'MIDSA', 'INV',  'MONTHLY', 5);
  await seedRow('PR',   'MIDSA', 'PR',   'MONTHLY', 5);
  await seedRow('RFQ',  'MIDSA', 'RFQ',  'MONTHLY', 5);
  await seedRow('GR',   'MIDSA', 'GR',   'MONTHLY', 5);
  await seedRow('MEMO', 'MIDSA', 'MEMO', 'MONTHLY', 5);
  console.log('  ✓ Default sequences seeded (INV / PR / RFQ / GR / MEMO)');

  console.log('✅ Numbering schema ready');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Restart backend — numberGenerator.js will start minting IDs.');
  console.log('  2. As Admin or Finance Head, open System → Numbering Settings to');
  console.log('     adjust prefix / padding / reset frequency per doc type.');
  console.log('  3. Historical IDs (incl. "null"-pattern legacy ones) are left as-is.');
  await closePool();
}

run().catch(async (err) => {
  console.error('❌ Migration failed:', err.message);
  try { await closePool(); } catch (_) {}
  process.exit(1);
});
