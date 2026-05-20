'use strict';

/**
 * migrate_notifications.js — idempotent schema migration for the in-app
 * notification centre.
 *
 *   node backend/migrate_notifications.js
 *
 * Safe to run repeatedly: every DDL statement is wrapped so that an
 * "object already exists" error (ORA-00955 / ORA-01408) is treated as a
 * no-op. Run it once on each environment before deploying the
 * notification feature.
 */

require('dotenv').config();
const { initPool, execute, closePool } = require('./db');

async function ddl(label, sql) {
  try {
    await execute(sql);
    console.log(`  ✓ ${label}`);
  } catch (err) {
    const msg = err.message || '';
    // ORA-00955: name is already used by an existing object
    // ORA-01408: such column list already indexed
    if (/ORA-00955|ORA-01408/.test(msg)) {
      console.log(`  • ${label} — already exists, skipped`);
    } else {
      console.error(`  ✗ ${label} — ${msg}`);
      throw err;
    }
  }
}

async function run() {
  await initPool();
  console.log('▶ Notifications schema migration');

  await ddl('QA_NOTIFICATIONS table', `
    CREATE TABLE QA_NOTIFICATIONS (
      NOTIF_ID      NUMBER         GENERATED ALWAYS AS IDENTITY,
      RECIPIENT     VARCHAR2(255)  NOT NULL,
      TYPE          VARCHAR2(60)   NOT NULL,
      TITLE         VARCHAR2(255)  NOT NULL,
      BODY          VARCHAR2(1000),
      SEVERITY      VARCHAR2(20)   DEFAULT 'info',
      CATEGORY      VARCHAR2(30)   DEFAULT 'system',
      ENTITY_TYPE   VARCHAR2(40),
      ENTITY_ID     VARCHAR2(120),
      LINK_PAGE     VARCHAR2(60),
      LINK_CONTEXT  VARCHAR2(2000),
      ACTOR         VARCHAR2(255),
      GROUP_KEY     VARCHAR2(160),
      IS_READ       NUMBER(1)      DEFAULT 0,
      READ_AT       TIMESTAMP,
      IS_ARCHIVED   NUMBER(1)      DEFAULT 0,
      CREATED_AT    TIMESTAMP      DEFAULT SYSTIMESTAMP,
      CONSTRAINT PK_NOTIFICATIONS PRIMARY KEY (NOTIF_ID),
      CONSTRAINT CHK_NOTIF_READ     CHECK (IS_READ IN (0,1)),
      CONSTRAINT CHK_NOTIF_ARCHIVED CHECK (IS_ARCHIVED IN (0,1))
    )
  `);

  await ddl('IDX_NOTIF_RECIPIENT',
    `CREATE INDEX IDX_NOTIF_RECIPIENT ON QA_NOTIFICATIONS(RECIPIENT, IS_ARCHIVED, IS_READ)`);
  await ddl('IDX_NOTIF_CREATED',
    `CREATE INDEX IDX_NOTIF_CREATED ON QA_NOTIFICATIONS(CREATED_AT)`);
  await ddl('IDX_NOTIF_GROUP',
    `CREATE INDEX IDX_NOTIF_GROUP ON QA_NOTIFICATIONS(RECIPIENT, GROUP_KEY, IS_READ)`);

  console.log('✅ Notifications schema ready');
  await closePool();
}

run().catch(async (err) => {
  console.error('❌ Migration failed:', err.message);
  try { await closePool(); } catch (_) { /* ignore */ }
  process.exit(1);
});
