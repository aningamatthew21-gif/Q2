'use strict';

/**
 * Migration: Add pricing upgrade columns to QA_INVENTORY and QA_PRICING_SETTINGS.
 * Also inserts procurement user.
 *
 * Run: node backend/migrate_pricing_upgrade.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { initPool, execute, closePool } = require('./db');

const statements = [
    // 1. Add new columns to QA_INVENTORY (ignore if already exist)
    {
        sql: `ALTER TABLE QA_INVENTORY ADD (ITEM_TYPE VARCHAR2(20) DEFAULT 'Hardware')`,
        ignore: 'ORA-01430' // column already exists
    },
    {
        sql: `ALTER TABLE QA_INVENTORY ADD (HANDLING_PER_UNIT NUMBER(15,4) DEFAULT 0)`,
        ignore: 'ORA-01430'
    },
    {
        sql: `ALTER TABLE QA_INVENTORY ADD (TRANSFER_ADMIN_PER_UNIT NUMBER(15,4) DEFAULT 0)`,
        ignore: 'ORA-01430'
    },
    // 2. Add check constraint for item type (ignore if already exist)
    {
        sql: `ALTER TABLE QA_INVENTORY ADD CONSTRAINT CHK_INV_ITEM_TYPE CHECK (ITEM_TYPE IN ('Hardware', 'Software', 'Service'))`,
        ignore: 'ORA-02264' // name already used
    },
    // 3. Add preset rate columns to QA_PRICING_SETTINGS
    {
        sql: `ALTER TABLE QA_PRICING_SETTINGS ADD (INSURANCE_RATE_PCT NUMBER(10,6) DEFAULT 0.01)`,
        ignore: 'ORA-01430'
    },
    {
        sql: `ALTER TABLE QA_PRICING_SETTINGS ADD (FREIGHT_RATE_PCT NUMBER(10,6) DEFAULT 0.12)`,
        ignore: 'ORA-01430'
    },
    {
        sql: `ALTER TABLE QA_PRICING_SETTINGS ADD (DUTY_RATE_PCT NUMBER(10,6) DEFAULT 0.50)`,
        ignore: 'ORA-01430'
    },
    {
        sql: `ALTER TABLE QA_PRICING_SETTINGS ADD (HANDLING_RATE_PCT NUMBER(10,6) DEFAULT 0.02)`,
        ignore: 'ORA-01430'
    },
    {
        sql: `ALTER TABLE QA_PRICING_SETTINGS ADD (TRANSFER_ADMIN_RATE_PCT NUMBER(10,6) DEFAULT 0.015)`,
        ignore: 'ORA-01430'
    },
    {
        sql: `ALTER TABLE QA_PRICING_SETTINGS ADD (DEFAULT_FX_RATE NUMBER(15,6) DEFAULT 13.05)`,
        ignore: 'ORA-01430'
    },
    // 4. Update existing pricing settings row with preset defaults
    {
        sql: `UPDATE QA_PRICING_SETTINGS SET
            INSURANCE_RATE_PCT = 0.01,
            FREIGHT_RATE_PCT = 0.12,
            DUTY_RATE_PCT = 0.50,
            HANDLING_RATE_PCT = 0.02,
            TRANSFER_ADMIN_RATE_PCT = 0.015,
            DEFAULT_MARKUP_PCT = 30,
            DEFAULT_FX_RATE = 13.05
        WHERE ID = 'pricing'`
    },
    // 5. Add procurement user (ignore if already exists)
    {
        sql: `INSERT INTO QA_USERS (USER_EMAIL, USER_ROLE, USER_NAME, USER_STATUS)
              VALUES ('aningamatthew21+procure@gmail.com', 'procurement', 'Procurement User', 'active')`,
        ignore: 'ORA-00001' // unique constraint violation (already exists)
    }
];

async function migrate() {
    console.log('Starting pricing upgrade migration...\n');
    await initPool();

    for (const stmt of statements) {
        try {
            await execute(stmt.sql);
            console.log(`  OK: ${stmt.sql.substring(0, 80)}...`);
        } catch (err) {
            const msg = err.message || '';
            if (stmt.ignore && msg.includes(stmt.ignore)) {
                console.log(`  SKIP (already exists): ${stmt.sql.substring(0, 80)}...`);
            } else {
                console.error(`  FAIL: ${stmt.sql.substring(0, 80)}...`);
                console.error(`    Error: ${msg}`);
            }
        }
    }

    console.log('\nMigration complete.');
    await closePool();
    process.exit(0);
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
