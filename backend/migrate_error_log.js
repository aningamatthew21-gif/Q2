'use strict';

/**
 * migrate_error_log.js — EH-3 Error persistence layer
 *
 * Standards anchor:
 *   - ISO/IEC 27001:2022 A.8.15 (Logging) — central persistent log of
 *     system errors with categorization, retention, and access control
 *   - ISO/IEC 27001:2022 A.8.16 (Monitoring activities) — feeds the
 *     real-time admin Error Monitor (EH-4)
 *   - ISO/IEC 27001:2022 A.5.34 (Privacy and protection of PII) — the
 *     PAYLOAD_SAMPLE column stores a PII-masked copy of the request
 *     (passwords, OTPs, tokens, JWTs redacted via backend/utils/maskPII.js)
 *   - OWASP ASVS V11.1.7 — all internal-failure details logged
 *     server-side, never to the client
 *
 * Schema design notes:
 *   - FINGERPRINT is the dedup key: sha256(code + route + stack-top)[:32].
 *     Repeated occurrences of the same error don't pile up rows; they
 *     update LAST_SEEN_AT and OCCURRENCE_COUNT on the existing row.
 *     Makes the Error Monitor dashboard readable (top-N unique errors,
 *     not a wall of duplicates).
 *   - SEVERITY values come from shared/errors.js — 'INFO' | 'WARN' |
 *     'ERROR' | 'FATAL'. Only ERROR and FATAL trigger the Socket.IO
 *     'error:logged' event (so admins aren't alerted for routine 404s).
 *   - SOURCE distinguishes backend exceptions from frontend-reported
 *     errors (React Error Boundary, useApiCall failures) so the admin
 *     can filter "show me only server crashes" vs "browser bugs".
 *   - ACKNOWLEDGED_BY / RESOLVED_AT support the workflow: Open →
 *     Acknowledged (clock starts on MTTR) → Resolved (with note).
 *     Without this, the Error Monitor degenerates into a wall of red
 *     that everyone learns to ignore.
 *   - PAYLOAD_SAMPLE is the request body PII-masked. CLOB so we don't
 *     pre-truncate. The reporter caps at ~8KB before insert.
 *
 * Idempotent (catches ORA-00955 already-exists). Safe to re-run.
 *
 *   node backend/migrate_error_log.js
 */

require('dotenv').config();
const { initPool, execute, closePool } = require('./db');

async function ddl(label, sql) {
  try {
    await execute(sql);
    console.log(`  ✓ ${label}`);
  } catch (err) {
    const msg = err.message || '';
    if (/ORA-01430|ORA-00955|ORA-02260|ORA-02275|ORA-01442|ORA-01451/.test(msg)) {
      console.log(`  • ${label} — already exists, skipped`);
    } else {
      console.error(`  ✗ ${label} — ${msg}`);
      throw err;
    }
  }
}

async function run() {
  await initPool();
  console.log('▶ EH-3 Error-log migration');

  await ddl(
    'QA_ERROR_LOG table',
    `CREATE TABLE QA_ERROR_LOG (
       ERROR_ID          VARCHAR2(40)   NOT NULL,
       FINGERPRINT       VARCHAR2(64)   NOT NULL,
       CODE              VARCHAR2(40)   NOT NULL,
       SEVERITY          VARCHAR2(10)   NOT NULL,
       SOURCE            VARCHAR2(10)   NOT NULL,
       MESSAGE           VARCHAR2(2000),
       STACK             CLOB,
       ROUTE             VARCHAR2(300),
       USER_EMAIL        VARCHAR2(255),
       USER_ROLE         VARCHAR2(30),
       REQUEST_ID        VARCHAR2(64),
       USER_AGENT        VARCHAR2(500),
       CLIENT_IP         VARCHAR2(64),
       PAYLOAD_SAMPLE    CLOB,
       FIRST_SEEN_AT     TIMESTAMP      DEFAULT SYSTIMESTAMP,
       LAST_SEEN_AT      TIMESTAMP      DEFAULT SYSTIMESTAMP,
       OCCURRENCE_COUNT  NUMBER         DEFAULT 1,
       STATUS            VARCHAR2(15)   DEFAULT 'OPEN',
       ACKNOWLEDGED_BY   VARCHAR2(255),
       ACKNOWLEDGED_AT   TIMESTAMP,
       RESOLVED_BY       VARCHAR2(255),
       RESOLVED_AT       TIMESTAMP,
       RESOLUTION_NOTE   VARCHAR2(2000),
       MUTED             CHAR(1)        DEFAULT 'N',
       CONSTRAINT PK_ERR_LOG       PRIMARY KEY (ERROR_ID),
       CONSTRAINT UQ_ERR_FINGERPRINT UNIQUE (FINGERPRINT),
       CONSTRAINT CK_ERR_SEVERITY  CHECK (SEVERITY IN ('INFO','WARN','ERROR','FATAL')),
       CONSTRAINT CK_ERR_SOURCE    CHECK (SOURCE   IN ('backend','react','network','manual')),
       CONSTRAINT CK_ERR_STATUS    CHECK (STATUS   IN ('OPEN','ACKNOWLEDGED','RESOLVED','MUTED')),
       CONSTRAINT CK_ERR_MUTED     CHECK (MUTED    IN ('Y','N'))
     )`
  );

  // Indexes for the three primary access paths in the Error Monitor:
  //   1. "Show recent" — LAST_SEEN_AT DESC
  //   2. "Show unresolved" — STATUS + SEVERITY
  //   3. Per-user troubleshooting — USER_EMAIL + LAST_SEEN_AT
  await ddl(
    'IDX_ERR_LAST_SEEN',
    `CREATE INDEX IDX_ERR_LAST_SEEN ON QA_ERROR_LOG(LAST_SEEN_AT DESC)`
  );
  await ddl(
    'IDX_ERR_STATUS_SEV',
    `CREATE INDEX IDX_ERR_STATUS_SEV ON QA_ERROR_LOG(STATUS, SEVERITY)`
  );
  await ddl(
    'IDX_ERR_USER',
    `CREATE INDEX IDX_ERR_USER ON QA_ERROR_LOG(USER_EMAIL, LAST_SEEN_AT DESC)`
  );
  await ddl(
    'IDX_ERR_CODE',
    `CREATE INDEX IDX_ERR_CODE ON QA_ERROR_LOG(CODE, LAST_SEEN_AT DESC)`
  );

  console.log('✅ Error-log schema ready');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Restart backend — errorHandler middleware will start');
  console.log('     persisting via backend/utils/errorReporter.js');
  console.log('  2. As ADMIN, open the Error Monitor page (Sidebar → System →');
  console.log('     Error Monitor) to see captures and acknowledge / resolve.');
  await closePool();
}

run().catch(async (err) => {
  console.error('❌ Migration failed:', err.message);
  try { await closePool(); } catch (_) { /* ignore */ }
  process.exit(1);
});
