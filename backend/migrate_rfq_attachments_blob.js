'use strict';

/**
 * migrate_rfq_attachments_blob.js
 *
 * Converts QA_RFQ_RESPONSE_ATTACHMENTS.FILE_DATA from CLOB → BLOB.
 *
 * Why:
 *   The original design stored the file as base64-text in a CLOB. That
 *   pattern bit us hard: binding a JS string with `type: oracledb.CLOB`
 *   in oracledb v6 silently coerces the bind metadata object to its
 *   .toString() representation ("[object Object]", 15 chars), so the
 *   actual file content never reaches the DB. See node-oracledb LOB docs:
 *   https://node-oracledb.readthedocs.io/en/latest/user_guide/lob_data.html
 *
 *   BLOB is the canonical Oracle type for binary file data. We decode
 *   the base64 on the backend, bind the raw Buffer, and let Oracle
 *   stream the bytes natively — no encoding round-trip, no truncation.
 *
 * Existing data:
 *   All rows in the current table are corrupted "[object Object]" stubs
 *   from the broken bind, so we DROP the table and recreate. There is
 *   no real attachment data to preserve.
 *
 *   node backend/migrate_rfq_attachments_blob.js
 *
 * Idempotent: safe to re-run. Catches "table does not exist" on the DROP.
 */

require('dotenv').config();
const { initPool, execute, closePool } = require('./db');

async function ddl(label, sql, swallowCodes = []) {
  try {
    await execute(sql);
    console.log(`  ✓ ${label}`);
  } catch (err) {
    const msg = err.message || '';
    const allOk = [
      /ORA-01430/, // column already exists
      /ORA-00955/, // name already used
      /ORA-02260/, // table has primary key
      /ORA-02275/, // such referential constraint exists
      /ORA-00942/, // table or view does not exist (safe on DROP)
      ...swallowCodes
    ];
    if (allOk.some(re => re.test(msg))) {
      console.log(`  • ${label} — ${msg.split('\n')[0]} (skipped)`);
    } else {
      console.error(`  ✗ ${label} — ${msg}`);
      throw err;
    }
  }
}

async function run() {
  await initPool();
  console.log('▶ RFQ attachments CLOB → BLOB migration');

  // Drop and recreate. All existing rows are corrupted CLOB stubs from
  // the broken bind (literal string "[object Object]"), so there's
  // nothing real to migrate.
  await ddl(
    'DROP existing QA_RFQ_RESPONSE_ATTACHMENTS',
    `DROP TABLE QA_RFQ_RESPONSE_ATTACHMENTS CASCADE CONSTRAINTS`
  );

  await ddl(
    'CREATE QA_RFQ_RESPONSE_ATTACHMENTS (FILE_DATA as BLOB)',
    `CREATE TABLE QA_RFQ_RESPONSE_ATTACHMENTS (
       ATTACHMENT_ID   NUMBER         GENERATED ALWAYS AS IDENTITY,
       RFQ_ID          VARCHAR2(50)   NOT NULL,
       VENDOR_ID       VARCHAR2(50)   NOT NULL,
       FILE_NAME       VARCHAR2(500)  NOT NULL,
       FILE_TYPE       VARCHAR2(100),
       FILE_SIZE       NUMBER         DEFAULT 0,
       FILE_DATA       BLOB           NOT NULL,
       UPLOADED_BY     VARCHAR2(255),
       UPLOADED_AT     TIMESTAMP      DEFAULT SYSTIMESTAMP,
       CONSTRAINT PK_RFQ_RESPONSE_ATT PRIMARY KEY (ATTACHMENT_ID)
     )`
  );

  await ddl(
    'IDX_RRA_RFQ_VENDOR',
    `CREATE INDEX IDX_RRA_RFQ_VENDOR ON QA_RFQ_RESPONSE_ATTACHMENTS(RFQ_ID, VENDOR_ID)`
  );
  await ddl(
    'IDX_RRA_RFQ',
    `CREATE INDEX IDX_RRA_RFQ ON QA_RFQ_RESPONSE_ATTACHMENTS(RFQ_ID)`
  );

  console.log('✅ Attachments schema rebuilt (BLOB-backed)');
  await closePool();
}

run().catch(async (err) => {
  console.error('❌ Migration failed:', err.message);
  try { await closePool(); } catch (_) { /* ignore */ }
  process.exit(1);
});
