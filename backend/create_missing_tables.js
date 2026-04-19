'use strict';
require('dotenv').config();
const oracledb = require('oracledb');

async function createMissingTables() {
  const conn = await oracledb.getConnection({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectionString: process.env.DB_CONNECTION_STRING
  });

  console.log('Connected to Oracle. Checking missing tables...');

  // Check and create QA_PRICING_SETTINGS
  try {
    const check = await conn.execute(
      "SELECT COUNT(*) AS CNT FROM USER_TABLES WHERE TABLE_NAME = 'QA_PRICING_SETTINGS'",
      {}
    );
    const cnt = check.rows[0][0];

    if (cnt > 0) {
      console.log('✅ QA_PRICING_SETTINGS already exists');
    } else {
      console.log('Creating QA_PRICING_SETTINGS...');
      await conn.execute(
        "CREATE TABLE QA_PRICING_SETTINGS (" +
        "  ID                     VARCHAR2(50)   NOT NULL PRIMARY KEY," +
        "  DEFAULT_MARKUP_PCT     NUMBER(5,2)    DEFAULT 32," +
        "  DEFAULT_MARGIN_PCT     NUMBER(5,2)    DEFAULT 15," +
        "  PRICING_MODE           VARCHAR2(20)   DEFAULT 'markup'," +
        "  ALLOCATION_METHOD      VARCHAR2(20)   DEFAULT 'weight'," +
        "  ROUNDING_DECIMALS      NUMBER(2)      DEFAULT 2," +
        "  DEFAULT_INCOTERM       VARCHAR2(10)   DEFAULT 'FOB'," +
        "  DEFAULT_CURRENCY       VARCHAR2(10)   DEFAULT 'GHS'," +
        "  DEFAULT_QUOTE_EXPIRY   NUMBER(3)      DEFAULT 30," +
        "  MIN_MARGIN_PCT         NUMBER(5,2)    DEFAULT 15," +
        "  MAX_DISCOUNT_PCT       NUMBER(5,2)    DEFAULT 20," +
        "  REQUIRE_APPROVAL_ABOVE NUMBER(12,2)   DEFAULT 10000," +
        "  DEFAULT_TAX_RATE       NUMBER(5,4)    DEFAULT 0.12," +
        "  CREATED_AT             TIMESTAMP      DEFAULT SYSTIMESTAMP," +
        "  UPDATED_AT             TIMESTAMP      DEFAULT SYSTIMESTAMP" +
        ")",
        {}
      );
      await conn.execute("INSERT INTO QA_PRICING_SETTINGS (ID) VALUES ('pricing')", {});
      await conn.commit();
      console.log('✅ QA_PRICING_SETTINGS created with defaults');
    }
  } catch (e) {
    console.error('❌ QA_PRICING_SETTINGS error:', e.message);
  }

  await conn.close();
  console.log('Done.');
}

createMissingTables().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
