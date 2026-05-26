'use strict';

/**
 * migrate_refresh_tokens.js
 *
 * SP1-H1+H2+H3 — Refresh-token JWT pattern.
 *
 * Why:
 *   The previous design issued a single 24-hour JWT with no revocation
 *   list. A stolen token granted full 24h access; a compromised user
 *   couldn't be logged out remotely; there was no way to terminate a
 *   session on detected anomaly. ISO/IEC 27001:2022 A.5.18 / A.8.5
 *   require "the ability to revoke access rights" — implausible
 *   with the legacy design.
 *
 *   We now issue:
 *     - access token   — 15 min TTL, signed with JWT_SECRET
 *     - refresh token  — 7 day TTL, signed with JWT_REFRESH_SECRET,
 *                        SHA-256 hash stored server-side in
 *                        QA_REFRESH_TOKENS so it can be revoked
 *
 *   On any access-token expiry, the frontend silently exchanges the
 *   refresh token for a new access token. Logout marks the refresh
 *   token revoked; any compromised access token expires in ≤15 min.
 *
 * Schema choices:
 *   - TOKEN_HASH is SHA-256 of the raw token (NEVER store raw secrets)
 *   - REVOKED_AT NULL means active; non-NULL means revoked
 *   - REVOKED_REASON is free-text (logout / rotation / admin-revoke / …)
 *   - USER_AGENT + IP_ADDRESS support future session-management UI and
 *     anomaly detection (ISO 27001 A.8.16 monitoring)
 *
 *   node backend/migrate_refresh_tokens.js
 *
 * Idempotent (catches ORA-00955 already-exists). Safe to re-run.
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
  console.log('▶ SP1-H1+H2+H3 Refresh-token migration');

  await ddl(
    'QA_REFRESH_TOKENS table',
    `CREATE TABLE QA_REFRESH_TOKENS (
       TOKEN_ID       NUMBER          GENERATED ALWAYS AS IDENTITY,
       TOKEN_HASH     VARCHAR2(128)   NOT NULL,
       USER_EMAIL     VARCHAR2(255)   NOT NULL,
       ISSUED_AT      TIMESTAMP       DEFAULT SYSTIMESTAMP,
       EXPIRES_AT     TIMESTAMP       NOT NULL,
       REVOKED_AT     TIMESTAMP,
       REVOKED_REASON VARCHAR2(50),
       USER_AGENT     VARCHAR2(500),
       IP_ADDRESS     VARCHAR2(50),
       CONSTRAINT PK_REFRESH_TOKENS PRIMARY KEY (TOKEN_ID),
       CONSTRAINT UQ_REFRESH_HASH UNIQUE (TOKEN_HASH)
     )`
  );

  await ddl(
    'IDX_REFRESH_USER',
    `CREATE INDEX IDX_REFRESH_USER ON QA_REFRESH_TOKENS(USER_EMAIL, REVOKED_AT)`
  );
  await ddl(
    'IDX_REFRESH_EXPIRES',
    `CREATE INDEX IDX_REFRESH_EXPIRES ON QA_REFRESH_TOKENS(EXPIRES_AT)`
  );

  console.log('✅ Refresh-token schema ready');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Add JWT_REFRESH_SECRET to backend/.env (96 hex chars)');
  console.log('     Generate: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  console.log('  2. Restart backend — auth.js will start issuing both tokens');
  console.log('  3. Existing 24h JWT tokens remain valid until they expire (24h max)');
  console.log('     New logins will use the 15min+7d pattern from this point on');
  await closePool();
}

run().catch(async (err) => {
  console.error('❌ Migration failed:', err.message);
  try { await closePool(); } catch (_) { /* ignore */ }
  process.exit(1);
});
