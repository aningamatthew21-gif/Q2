'use strict';

/**
 * Migration: Create all procurement module tables, sequences, and columns.
 * Safe to re-run — each statement ignores "already exists" errors.
 *
 * Run: node backend/migrate_procurement_schema.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { initPool, execute, closePool } = require('./db');

const statements = [
    // 1. Relax user role constraint
    { sql: `ALTER TABLE QA_USERS DROP CONSTRAINT CHK_USERS_ROLE`, ignore: ['ORA-02443'] },
    { sql: `ALTER TABLE QA_USERS ADD CONSTRAINT CHK_USERS_ROLE CHECK (USER_ROLE IN ('sales','controller','procurement','admin'))`, ignore: ['ORA-02264'] },

    // 2. Add columns to QA_INVOICES
    { sql: `ALTER TABLE QA_INVOICES ADD (SOURCING_STATUS VARCHAR2(20) DEFAULT 'NONE')`, ignore: ['ORA-01430'] },
    { sql: `ALTER TABLE QA_INVOICES ADD (PR_COUNT NUMBER(5,0) DEFAULT 0)`, ignore: ['ORA-01430'] },
    { sql: `ALTER TABLE QA_INVOICES ADD CONSTRAINT CHK_INV_SOURCING CHECK (SOURCING_STATUS IN ('NONE','PENDING','PARTIAL','COMPLETE'))`, ignore: ['ORA-02264'] },

    // 3. Sequences
    { sql: `CREATE SEQUENCE QA_PR_SEQ START WITH 1 INCREMENT BY 1 NOCACHE NOCYCLE`, ignore: ['ORA-00955'] },
    { sql: `CREATE SEQUENCE QA_RFQ_SEQ START WITH 1 INCREMENT BY 1 NOCACHE NOCYCLE`, ignore: ['ORA-00955'] },

    // 4. Vendors table
    { sql: `CREATE TABLE QA_VENDORS (
        VENDOR_ID VARCHAR2(50) NOT NULL, VENDOR_NAME VARCHAR2(500) NOT NULL,
        CONTACT_PERSON VARCHAR2(255), CONTACT_EMAIL VARCHAR2(255), CONTACT_PHONE VARCHAR2(100),
        CATEGORY VARCHAR2(100), STATUS VARCHAR2(20) DEFAULT 'active', RATING NUMBER(3,1) DEFAULT 0,
        PAYMENT_TERMS VARCHAR2(100), LEAD_TIME_DAYS NUMBER(5,0) DEFAULT 0,
        ADDRESS VARCHAR2(500), NOTES VARCHAR2(4000),
        CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP, CREATED_BY VARCHAR2(255),
        UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP, UPDATED_BY VARCHAR2(255),
        CONSTRAINT PK_VENDORS PRIMARY KEY (VENDOR_ID),
        CONSTRAINT CHK_VENDOR_STATUS CHECK (STATUS IN ('active','inactive','suspended')),
        CONSTRAINT CHK_VENDOR_RATING CHECK (RATING BETWEEN 0 AND 5)
    )`, ignore: ['ORA-00955'] },

    // 5. Purchase Requisitions table
    { sql: `CREATE TABLE QA_PURCHASE_REQUISITIONS (
        PR_ID VARCHAR2(50) NOT NULL, PR_NUMBER VARCHAR2(50), INVOICE_ID VARCHAR2(50),
        QUOTE_LINE_MATCH_KEY VARCHAR2(200), ITEM_NAME VARCHAR2(500), ITEM_DESCRIPTION VARCHAR2(4000),
        QUANTITY NUMBER(10,2) DEFAULT 1, UOM VARCHAR2(20) DEFAULT 'EA',
        NEEDED_BY VARCHAR2(50), REASON VARCHAR2(30) DEFAULT 'CUSTOM_SOURCED',
        STATUS VARCHAR2(20) DEFAULT 'OPEN', PRIORITY VARCHAR2(20) DEFAULT 'normal',
        REQUESTED_BY VARCHAR2(255), ASSIGNED_TO VARCHAR2(255),
        CUSTOMER_NAME VARCHAR2(500), NOTES VARCHAR2(4000),
        CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP, UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP,
        CONSTRAINT PK_PR PRIMARY KEY (PR_ID),
        CONSTRAINT FK_PR_INVOICE FOREIGN KEY (INVOICE_ID) REFERENCES QA_INVOICES(INVOICE_ID) ON DELETE SET NULL,
        CONSTRAINT CHK_PR_REASON CHECK (REASON IN ('OUT_OF_STOCK','INSUFFICIENT','NOT_IN_INVENTORY','CUSTOM_SOURCED')),
        CONSTRAINT CHK_PR_STATUS CHECK (STATUS IN ('OPEN','IN_RFQ','AWARDED','FULFILLED','CANCELLED','REJECTED')),
        CONSTRAINT CHK_PR_PRIORITY CHECK (PRIORITY IN ('low','normal','high','urgent'))
    )`, ignore: ['ORA-00955'] },

    // 6. RFQ Headers
    { sql: `CREATE TABLE QA_RFQS (
        RFQ_ID VARCHAR2(50) NOT NULL, RFQ_NUMBER VARCHAR2(50), TITLE VARCHAR2(500),
        STATUS VARCHAR2(30) DEFAULT 'DRAFT', SUBMISSION_DEADLINE VARCHAR2(50),
        DELIVERY_DEADLINE VARCHAR2(50), AWARDED_VENDOR_ID VARCHAR2(50),
        AWARDED_AT TIMESTAMP, AWARDED_BY VARCHAR2(255),
        TOTAL_AWARD_AMOUNT NUMBER(15,4) DEFAULT 0, CURRENCY VARCHAR2(10) DEFAULT 'GHS',
        NOTES VARCHAR2(4000), CREATED_BY VARCHAR2(255),
        CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP, UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP,
        CONSTRAINT PK_RFQ PRIMARY KEY (RFQ_ID),
        CONSTRAINT FK_RFQ_VENDOR FOREIGN KEY (AWARDED_VENDOR_ID) REFERENCES QA_VENDORS(VENDOR_ID) ON DELETE SET NULL,
        CONSTRAINT CHK_RFQ_STATUS CHECK (STATUS IN ('DRAFT','SENT','RECEIVING','COMPARING','PENDING_APPROVAL','AWARDED','CANCELLED','CLOSED'))
    )`, ignore: ['ORA-00955'] },

    // 7. RFQ Line Items
    { sql: `CREATE TABLE QA_RFQ_LINE_ITEMS (
        RFQ_LINE_ID NUMBER GENERATED ALWAYS AS IDENTITY, RFQ_ID VARCHAR2(50) NOT NULL,
        PR_ID VARCHAR2(50) NOT NULL, ITEM_NAME VARCHAR2(500),
        QUANTITY NUMBER(10,2) DEFAULT 1, SORT_ORDER NUMBER(5,0) DEFAULT 0,
        CONSTRAINT PK_RFQ_LI PRIMARY KEY (RFQ_LINE_ID),
        CONSTRAINT FK_RFQ_LI_RFQ FOREIGN KEY (RFQ_ID) REFERENCES QA_RFQS(RFQ_ID) ON DELETE CASCADE,
        CONSTRAINT FK_RFQ_LI_PR FOREIGN KEY (PR_ID) REFERENCES QA_PURCHASE_REQUISITIONS(PR_ID) ON DELETE CASCADE
    )`, ignore: ['ORA-00955'] },

    // 8. RFQ Vendors
    { sql: `CREATE TABLE QA_RFQ_VENDORS (
        RFQ_VENDOR_ID NUMBER GENERATED ALWAYS AS IDENTITY, RFQ_ID VARCHAR2(50) NOT NULL,
        VENDOR_ID VARCHAR2(50) NOT NULL, EMAIL_SENT_AT TIMESTAMP, EMAIL_MESSAGE_ID VARCHAR2(500),
        RESPONSE_STATUS VARCHAR2(20) DEFAULT 'PENDING',
        CONSTRAINT PK_RFQ_VENDORS PRIMARY KEY (RFQ_VENDOR_ID),
        CONSTRAINT FK_RV_RFQ FOREIGN KEY (RFQ_ID) REFERENCES QA_RFQS(RFQ_ID) ON DELETE CASCADE,
        CONSTRAINT FK_RV_VENDOR FOREIGN KEY (VENDOR_ID) REFERENCES QA_VENDORS(VENDOR_ID) ON DELETE CASCADE,
        CONSTRAINT CHK_RV_STATUS CHECK (RESPONSE_STATUS IN ('PENDING','RESPONDED','DECLINED','NO_RESPONSE')),
        CONSTRAINT UQ_RFQ_VENDOR UNIQUE (RFQ_ID, VENDOR_ID)
    )`, ignore: ['ORA-00955'] },

    // 9. RFQ Responses
    { sql: `CREATE TABLE QA_RFQ_RESPONSES (
        RESPONSE_ID NUMBER GENERATED ALWAYS AS IDENTITY, RFQ_ID VARCHAR2(50) NOT NULL,
        VENDOR_ID VARCHAR2(50) NOT NULL, PR_ID VARCHAR2(50) NOT NULL,
        UNIT_COST NUMBER(15,4) DEFAULT 0, QUANTITY NUMBER(10,2) DEFAULT 1,
        TOTAL_COST NUMBER(15,4) DEFAULT 0, CURRENCY VARCHAR2(10) DEFAULT 'GHS',
        LEAD_TIME_DAYS NUMBER(5,0) DEFAULT 0, FREIGHT NUMBER(15,4) DEFAULT 0,
        DELIVERY_TERMS VARCHAR2(100), PAYMENT_TERMS VARCHAR2(100),
        VALIDITY_DAYS NUMBER(5,0) DEFAULT 30, NOTES VARCHAR2(4000),
        IS_WINNER NUMBER(1) DEFAULT 0, LOGGED_BY VARCHAR2(255),
        LOGGED_AT TIMESTAMP DEFAULT SYSTIMESTAMP, RECEIVED_DATE VARCHAR2(50),
        CONSTRAINT PK_RFQ_RESP PRIMARY KEY (RESPONSE_ID),
        CONSTRAINT FK_RR_RFQ FOREIGN KEY (RFQ_ID) REFERENCES QA_RFQS(RFQ_ID) ON DELETE CASCADE,
        CONSTRAINT FK_RR_VENDOR FOREIGN KEY (VENDOR_ID) REFERENCES QA_VENDORS(VENDOR_ID) ON DELETE CASCADE,
        CONSTRAINT FK_RR_PR FOREIGN KEY (PR_ID) REFERENCES QA_PURCHASE_REQUISITIONS(PR_ID) ON DELETE CASCADE,
        CONSTRAINT CHK_RR_WINNER CHECK (IS_WINNER IN (0,1))
    )`, ignore: ['ORA-00955'] },

    // 10. Procurement Events
    //     Note: The CHK_PE_ENTITY constraint is defined here for fresh installs,
    //     and then *immediately* relaxed below so that legacy deployments (which
    //     already created the table without 'INVOICE' in the allowed list) get
    //     the new constraint on next migration run. The Phase 4 reapproval flow
    //     in routes/rfqs.js writes ENTITY_TYPE='INVOICE' events; without this
    //     fix the /rfqs/:id/approve endpoint throws ORA-02290 when an invoice
    //     crosses the variance threshold.
    { sql: `CREATE TABLE QA_PROCUREMENT_EVENTS (
        EVENT_ID NUMBER GENERATED ALWAYS AS IDENTITY, EVENT_TIME TIMESTAMP DEFAULT SYSTIMESTAMP,
        EVENT_TYPE VARCHAR2(50) NOT NULL, ENTITY_TYPE VARCHAR2(20) NOT NULL,
        ENTITY_ID VARCHAR2(50), ACTOR VARCHAR2(255), PAYLOAD CLOB,
        CONSTRAINT PK_PROC_EVENTS PRIMARY KEY (EVENT_ID),
        CONSTRAINT CHK_PE_ENTITY CHECK (ENTITY_TYPE IN ('PR','RFQ','VENDOR','RESPONSE','SETTING','INVOICE'))
    )`, ignore: ['ORA-00955'] },

    // 10b. Phase 4 retro-fix — relax CHK_PE_ENTITY to allow 'INVOICE'.
    // Drop-and-recreate is the only idempotent route Oracle gives us for a
    // CHECK constraint. ORA-02443 = "constraint not found" (already dropped).
    // ORA-02264 = "name already in use by an existing constraint" (already
    // recreated). Both are safe to ignore on re-runs.
    { sql: `ALTER TABLE QA_PROCUREMENT_EVENTS DROP CONSTRAINT CHK_PE_ENTITY`, ignore: ['ORA-02443', 'ORA-00942'] },
    { sql: `ALTER TABLE QA_PROCUREMENT_EVENTS ADD CONSTRAINT CHK_PE_ENTITY CHECK (ENTITY_TYPE IN ('PR','RFQ','VENDOR','RESPONSE','SETTING','INVOICE'))`, ignore: ['ORA-02264', 'ORA-00942'] },

    // 11. Procurement Settings
    { sql: `CREATE TABLE QA_PROCUREMENT_SETTINGS (
        SETTING_KEY VARCHAR2(50) NOT NULL, SETTING_VAL CLOB,
        UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP, UPDATED_BY VARCHAR2(255),
        CONSTRAINT PK_PROC_SETTINGS PRIMARY KEY (SETTING_KEY)
    )`, ignore: ['ORA-00955'] },

    // 12. Seed procurement settings
    { sql: `INSERT INTO QA_PROCUREMENT_SETTINGS (SETTING_KEY, SETTING_VAL) VALUES ('highValueThreshold', '0')`, ignore: ['ORA-00001'] },
    { sql: `INSERT INTO QA_PROCUREMENT_SETTINGS (SETTING_KEY, SETTING_VAL) VALUES ('minVendorsPerRFQ', '3')`, ignore: ['ORA-00001'] },
    { sql: `INSERT INTO QA_PROCUREMENT_SETTINGS (SETTING_KEY, SETTING_VAL) VALUES ('defaultRFQDeadlineDays', '7')`, ignore: ['ORA-00001'] },
    { sql: `INSERT INTO QA_PROCUREMENT_SETTINGS (SETTING_KEY, SETTING_VAL) VALUES ('enableProcurementModule', 'true')`, ignore: ['ORA-00001'] },
    { sql: `INSERT INTO QA_PROCUREMENT_SETTINGS (SETTING_KEY, SETTING_VAL) VALUES ('defaultCurrency', 'GHS')`, ignore: ['ORA-00001'] },

    // 13. Phase 3 — Recommendation & Approval columns on QA_RFQS
    //     (safe to re-run — ORA-01430 = "column already exists")
    { sql: `ALTER TABLE QA_RFQS ADD (RECOMMENDED_VENDOR_ID VARCHAR2(50))`,    ignore: ['ORA-01430'] },
    { sql: `ALTER TABLE QA_RFQS ADD (RECOMMENDATION_SCORE NUMBER(5,2))`,      ignore: ['ORA-01430'] },
    { sql: `ALTER TABLE QA_RFQS ADD (RECOMMENDATION_REASON VARCHAR2(500))`,   ignore: ['ORA-01430'] },
    { sql: `ALTER TABLE QA_RFQS ADD (RECOMMENDED_BY VARCHAR2(255))`,          ignore: ['ORA-01430'] },
    { sql: `ALTER TABLE QA_RFQS ADD (RECOMMENDED_AT TIMESTAMP)`,              ignore: ['ORA-01430'] },
    { sql: `ALTER TABLE QA_RFQS ADD (ALLOW_PARTIAL NUMBER(1) DEFAULT 0)`,     ignore: ['ORA-01430'] },
    { sql: `ALTER TABLE QA_RFQS ADD (APPROVED_BY VARCHAR2(255))`,             ignore: ['ORA-01430'] },
    { sql: `ALTER TABLE QA_RFQS ADD (APPROVED_AT TIMESTAMP)`,                 ignore: ['ORA-01430'] },

    // FK: RECOMMENDED_VENDOR_ID → QA_VENDORS (ORA-02264 = constraint name already used)
    { sql: `ALTER TABLE QA_RFQS ADD CONSTRAINT FK_RFQ_REC_VENDOR FOREIGN KEY (RECOMMENDED_VENDOR_ID) REFERENCES QA_VENDORS(VENDOR_ID)`, ignore: ['ORA-02264', 'ORA-02275'] },

    // 13b. Phase 5 — Risk / Staleness / Escalation columns on QA_RFQS
    { sql: `ALTER TABLE QA_RFQS ADD (LAST_STALENESS_CHECK_AT TIMESTAMP)`, ignore: ['ORA-01430'] },
    { sql: `ALTER TABLE QA_RFQS ADD (ESCALATED_AT TIMESTAMP)`,            ignore: ['ORA-01430'] },
    { sql: `ALTER TABLE QA_RFQS ADD (ESCALATED_TO VARCHAR2(255))`,        ignore: ['ORA-01430'] },
    { sql: `ALTER TABLE QA_RFQS ADD (ESCALATION_REASON VARCHAR2(500))`,   ignore: ['ORA-01430'] },

    // Phase 5 settings seeds (ORA-00001 = unique constraint violation — row already exists)
    { sql: `INSERT INTO QA_PROCUREMENT_SETTINGS (SETTING_KEY, SETTING_VAL) VALUES ('stalenessEscalationDays', '7')`,   ignore: ['ORA-00001'] },
    { sql: `INSERT INTO QA_PROCUREMENT_SETTINGS (SETTING_KEY, SETTING_VAL) VALUES ('procurementHeadEmail', '')`,       ignore: ['ORA-00001'] },

    // 13c. Phase 4 — Quote Re-Approval Loop columns on QA_INVOICES
    // When an RFQ is approved and cost pushback moves the invoice total beyond the
    // configured variance threshold, the approve endpoint stamps these columns so
    // the invoice is flagged for re-approval before reaching the customer.
    { sql: `ALTER TABLE QA_INVOICES ADD (ORIGINAL_ESTIMATE NUMBER(18,4))`,         ignore: ['ORA-01430'] },
    { sql: `ALTER TABLE QA_INVOICES ADD (REQUIRES_REAPPROVAL NUMBER(1) DEFAULT 0)`, ignore: ['ORA-01430'] },
    { sql: `ALTER TABLE QA_INVOICES ADD (REAPPROVAL_VARIANCE NUMBER(10,4))`,       ignore: ['ORA-01430'] },
    { sql: `ALTER TABLE QA_INVOICES ADD (REAPPROVAL_REASON VARCHAR2(500))`,        ignore: ['ORA-01430'] },
    { sql: `ALTER TABLE QA_INVOICES ADD (REAPPROVED_BY VARCHAR2(255))`,            ignore: ['ORA-01430'] },
    { sql: `ALTER TABLE QA_INVOICES ADD (REAPPROVED_AT TIMESTAMP)`,                ignore: ['ORA-01430'] },

    // Phase 4 setting seed — variance threshold (whole percent). 10 = "flag if > 10%".
    { sql: `INSERT INTO QA_PROCUREMENT_SETTINGS (SETTING_KEY, SETTING_VAL) VALUES ('reapprovalVarianceThreshold', '10')`, ignore: ['ORA-00001'] },

    // C2 fix — line-precise pushback match key. Stores the originating line's
    // SORT_ORDER so when multiple PRs target the same SKU on the same invoice
    // (rare but legal), each award updates exactly one line. Nullable for
    // backward-compat with PRs created before this column existed; pushback
    // falls back to the legacy SKU-only match when null.
    { sql: `ALTER TABLE QA_PURCHASE_REQUISITIONS ADD (LINE_SORT_ORDER NUMBER(5,0))`, ignore: ['ORA-01430'] },

    // 14. Indexes (ignore if exist)
    { sql: `CREATE INDEX IDX_VENDOR_NAME ON QA_VENDORS(VENDOR_NAME)`, ignore: ['ORA-00955'] },
    { sql: `CREATE INDEX IDX_VENDOR_STATUS ON QA_VENDORS(STATUS)`, ignore: ['ORA-00955'] },
    { sql: `CREATE INDEX IDX_PR_INVOICE ON QA_PURCHASE_REQUISITIONS(INVOICE_ID)`, ignore: ['ORA-00955'] },
    { sql: `CREATE INDEX IDX_PR_STATUS ON QA_PURCHASE_REQUISITIONS(STATUS)`, ignore: ['ORA-00955'] },
    { sql: `CREATE INDEX IDX_PR_CREATED ON QA_PURCHASE_REQUISITIONS(CREATED_AT)`, ignore: ['ORA-00955'] },
    { sql: `CREATE INDEX IDX_RFQ_STATUS ON QA_RFQS(STATUS)`, ignore: ['ORA-00955'] },
    { sql: `CREATE INDEX IDX_PE_TYPE ON QA_PROCUREMENT_EVENTS(EVENT_TYPE)`, ignore: ['ORA-00955'] },
    { sql: `CREATE INDEX IDX_PE_TIME ON QA_PROCUREMENT_EVENTS(EVENT_TIME)`, ignore: ['ORA-00955'] },
];

async function migrate() {
    console.log('Starting procurement schema migration...\n');
    await initPool();

    let ok = 0, skipped = 0, failed = 0;
    for (const stmt of statements) {
        const preview = stmt.sql.replace(/\s+/g, ' ').substring(0, 80);
        try {
            await execute(stmt.sql);
            console.log(`  OK: ${preview}...`);
            ok++;
        } catch (err) {
            const msg = err.message || '';
            const isExpected = (stmt.ignore || []).some(code => msg.includes(code));
            if (isExpected) {
                console.log(`  SKIP (already exists): ${preview}...`);
                skipped++;
            } else {
                console.error(`  FAIL: ${preview}...`);
                console.error(`    Error: ${msg}`);
                failed++;
            }
        }
    }

    console.log(`\nMigration complete: ${ok} applied, ${skipped} skipped, ${failed} failed.`);

    // Verify
    const tables = await execute(`SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME IN ('QA_VENDORS','QA_PURCHASE_REQUISITIONS','QA_RFQS','QA_RFQ_LINE_ITEMS','QA_RFQ_VENDORS','QA_RFQ_RESPONSES','QA_PROCUREMENT_EVENTS','QA_PROCUREMENT_SETTINGS') ORDER BY TABLE_NAME`);
    console.log('\nProcurement tables:', (tables.rows || []).map(r => r.TABLE_NAME).join(', '));

    const seqs = await execute(`SELECT SEQUENCE_NAME FROM USER_SEQUENCES WHERE SEQUENCE_NAME IN ('QA_PR_SEQ','QA_RFQ_SEQ')`);
    console.log('Sequences:', (seqs.rows || []).map(r => r.SEQUENCE_NAME).join(', '));

    const cols = await execute(`SELECT COLUMN_NAME FROM USER_TAB_COLUMNS WHERE TABLE_NAME='QA_INVOICES' AND COLUMN_NAME IN ('SOURCING_STATUS','PR_COUNT','ORIGINAL_ESTIMATE','REQUIRES_REAPPROVAL','REAPPROVAL_VARIANCE','REAPPROVAL_REASON','REAPPROVED_BY','REAPPROVED_AT')`);
    console.log('Invoice new columns:', (cols.rows || []).map(r => r.COLUMN_NAME).join(', '));

    const rfqCols = await execute(`SELECT COLUMN_NAME FROM USER_TAB_COLUMNS WHERE TABLE_NAME='QA_RFQS' AND COLUMN_NAME IN ('RECOMMENDED_VENDOR_ID','RECOMMENDATION_SCORE','RECOMMENDATION_REASON','RECOMMENDED_BY','RECOMMENDED_AT','ALLOW_PARTIAL','APPROVED_BY','APPROVED_AT','LAST_STALENESS_CHECK_AT','ESCALATED_AT','ESCALATED_TO','ESCALATION_REASON')`);
    console.log('RFQ Phase 3+5 columns:', (rfqCols.rows || []).map(r => r.COLUMN_NAME).join(', '));

    await closePool();
    process.exit(failed > 0 ? 1 : 0);
}

migrate().catch(err => { console.error('Migration failed:', err); process.exit(1); });
