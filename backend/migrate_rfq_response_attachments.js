'use strict';

/**
 * migrate_rfq_response_attachments.js
 *
 * Adds QA_RFQ_RESPONSE_ATTACHMENTS so the vendor quotation PDFs / signed
 * RFQ scans uploaded via LogVendorResponseModal actually persist. Prior
 * to this migration the frontend sent the attachments in the POST body
 * and the backend silently dropped them — the "PDF" button on the
 * comparison matrix could only re-generate the blank RFQ template
 * because there were no real attachments to download.
 *
 *   node backend/migrate_rfq_response_attachments.js
 *
 * Idempotent. Same `ddl` pattern as our other migrations.
 *
 * Storage decision:
 *   FILE_DATA is a CLOB holding the base64 data-URL, mirroring how the
 *   signed-RFQ payload is stored elsewhere in the app. Real binary file
 *   storage (S3-compatible / disk-mounted) is a P1 hardening — fine for
 *   the small file sizes (typically < 1 MB per quotation PDF) we expect
 *   at this scale.
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
  console.log('▶ RFQ response-attachments migration');

  await ddl(
    'QA_RFQ_RESPONSE_ATTACHMENTS table',
    `CREATE TABLE QA_RFQ_RESPONSE_ATTACHMENTS (
       ATTACHMENT_ID   NUMBER         GENERATED ALWAYS AS IDENTITY,
       RFQ_ID          VARCHAR2(50)   NOT NULL,
       VENDOR_ID       VARCHAR2(50)   NOT NULL,
       FILE_NAME       VARCHAR2(500)  NOT NULL,
       FILE_TYPE       VARCHAR2(100),
       FILE_SIZE       NUMBER         DEFAULT 0,
       FILE_DATA       CLOB           NOT NULL,
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

  console.log('✅ Attachments schema ready');
  await closePool();
}

run().catch(async (err) => {
  console.error('❌ Migration failed:', err.message);
  try { await closePool(); } catch (_) { /* ignore */ }
  process.exit(1);
});
