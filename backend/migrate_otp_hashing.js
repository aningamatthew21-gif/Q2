'use strict';

/**
 * migrate_otp_hashing.js — SP2-H5+H6
 *
 * Adds at-rest hashing for OTPs (HMAC-SHA-256 + per-row salt + global
 * pepper from .env) and a dedicated audit-trail table for OTP send /
 * verify events.
 *
 * Standards anchor:
 *   - ISO/IEC 27001:2022 A.5.17 (Authentication information secrecy)
 *   - ISO/IEC 27001:2022 A.8.15 (Logging — auth events must be auditable)
 *   - NIST SP 800-63B §5.1.4   (Look-up secrets and short-lived OTPs)
 *   - OWASP ASVS v4.0 §2.2.1   (Authentication response timing/messages)
 *   - OWASP Password Storage Cheat Sheet (pepper + per-row salt pattern)
 *
 * Schema deltas (all additive, all idempotent):
 *   QA_OTPS:
 *     + OTP_HASH        VARCHAR2(64)  — hex SHA-256 of (otp + salt + pepper)
 *     + OTP_SALT        VARCHAR2(32)  — per-row random salt (hex)
 *     + ATTEMPT_COUNT   NUMBER(3)     — incremented on every verify call
 *     + LAST_ATTEMPT_AT TIMESTAMP     — for sliding-window throttle
 *     + OTP_CODE        ← made NULLABLE (legacy column kept for back-compat
 *                        with any existing in-flight code; new writes use
 *                        OTP_HASH only). After cutover both columns coexist
 *                        and reads prefer OTP_HASH.
 *
 *   QA_OTP_AUDIT (NEW):
 *     OTP_AUDIT_ID  NUMBER GENERATED IDENTITY
 *     EVENT_TIME    TIMESTAMP DEFAULT SYSTIMESTAMP
 *     EVENT_TYPE    VARCHAR2(20)  — 'OTP_SENT' | 'OTP_VERIFY_OK'
 *                                 | 'OTP_VERIFY_FAIL' | 'OTP_THROTTLED'
 *     OTP_EMAIL     VARCHAR2(255) — recipient email (masked downstream
 *                                   when audit log is exposed via API)
 *     IP_ADDRESS    VARCHAR2(64)
 *     USER_AGENT    VARCHAR2(500)
 *
 * Existing in-flight OTPs (rows present at migration time) are wiped —
 * the migration is idempotent and the 10-minute TTL means any user
 * mid-login simply re-requests. Better than carrying mixed schema.
 *
 *   node backend/migrate_otp_hashing.js
 */

require('dotenv').config();
const { initPool, execute, closePool } = require('./db');

async function ddl(label, sql) {
  try {
    await execute(sql);
    console.log(`  ✓ ${label}`);
  } catch (err) {
    const msg = err.message || '';
    // ORA-01430 column already exists
    // ORA-00955 name already used (table/index/sequence)
    // ORA-02260 table already has primary key
    // ORA-02264 name already used by existing constraint
    // ORA-01442 column already NOT NULL
    // ORA-01451 already NULL
    // ORA-00942 table does not exist (safe on DROP CONSTRAINT)
    if (/ORA-01430|ORA-00955|ORA-02260|ORA-02264|ORA-01442|ORA-01451|ORA-00942/.test(msg)) {
      console.log(`  • ${label} — already done, skipped`);
    } else {
      console.error(`  ✗ ${label} — ${msg}`);
      throw err;
    }
  }
}

async function run() {
  await initPool();
  console.log('▶ SP2-H5+H6 OTP hashing + audit migration\n');

  // ── 1. Add new columns to QA_OTPS ─────────────────────────────────
  await ddl(
    'QA_OTPS.OTP_HASH VARCHAR2(64)',
    `ALTER TABLE QA_OTPS ADD OTP_HASH VARCHAR2(64)`
  );
  await ddl(
    'QA_OTPS.OTP_SALT VARCHAR2(32)',
    `ALTER TABLE QA_OTPS ADD OTP_SALT VARCHAR2(32)`
  );
  await ddl(
    'QA_OTPS.ATTEMPT_COUNT NUMBER(3) DEFAULT 0',
    `ALTER TABLE QA_OTPS ADD ATTEMPT_COUNT NUMBER(3) DEFAULT 0`
  );
  await ddl(
    'QA_OTPS.LAST_ATTEMPT_AT TIMESTAMP',
    `ALTER TABLE QA_OTPS ADD LAST_ATTEMPT_AT TIMESTAMP`
  );

  // ── 2. Make legacy OTP_CODE NULLABLE so new writes can skip it ────
  // We do NOT drop OTP_CODE — kept for back-compat with any caller
  // that hasn't been updated. The auth.js verify-otp handler prefers
  // OTP_HASH when present and falls back to OTP_CODE legacy check.
  await ddl(
    'Relax NOT NULL on legacy OTP_CODE',
    `ALTER TABLE QA_OTPS MODIFY (OTP_CODE NULL)`
  );

  // ── 3. Wipe in-flight OTPs (10-min TTL — users just re-request) ──
  // Non-idempotent but safe: re-running just deletes nothing.
  console.log('  • Wiping in-flight unhashed OTPs (users will re-request)…');
  await execute(`DELETE FROM QA_OTPS WHERE OTP_HASH IS NULL`);
  console.log('  ✓ legacy unhashed OTPs cleared');

  // ── 4. Dedicated audit table for OTP-specific events ─────────────
  // Separate from QA_AUDIT_LOGS so high-volume OTP traffic doesn't
  // drown the user-action stream. Indexed by email + time for the
  // throttle-window query.
  await ddl(
    'QA_OTP_AUDIT table',
    `CREATE TABLE QA_OTP_AUDIT (
       OTP_AUDIT_ID  NUMBER         GENERATED ALWAYS AS IDENTITY,
       EVENT_TIME    TIMESTAMP      DEFAULT SYSTIMESTAMP,
       EVENT_TYPE    VARCHAR2(20)   NOT NULL,
       OTP_EMAIL     VARCHAR2(255),
       IP_ADDRESS    VARCHAR2(64),
       USER_AGENT    VARCHAR2(500),
       CONSTRAINT PK_OTP_AUDIT PRIMARY KEY (OTP_AUDIT_ID),
       CONSTRAINT CK_OTP_AUDIT_TYPE CHECK (EVENT_TYPE IN
         ('OTP_SENT','OTP_VERIFY_OK','OTP_VERIFY_FAIL','OTP_THROTTLED'))
     )`
  );
  await ddl(
    'IDX_OTP_AUDIT_EMAIL_TIME',
    `CREATE INDEX IDX_OTP_AUDIT_EMAIL_TIME ON QA_OTP_AUDIT(OTP_EMAIL, EVENT_TIME)`
  );
  await ddl(
    'IDX_OTP_AUDIT_TIME',
    `CREATE INDEX IDX_OTP_AUDIT_TIME ON QA_OTP_AUDIT(EVENT_TIME)`
  );

  console.log('\n✅ OTP hashing + audit schema ready');
  console.log('\nNext steps:');
  console.log('  1. Add OTP_PEPPER to backend/.env (64 hex chars)');
  console.log('     Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  console.log('  2. Restart backend — auth.js will start writing OTP_HASH instead of OTP_CODE');
  console.log('  3. Any user mid-OTP needs to request a new code (10-min TTL otherwise)');
  await closePool();
}

run().catch(async (err) => {
  console.error('❌ Migration failed:', err.message);
  try { await closePool(); } catch (_) {}
  process.exit(1);
});
