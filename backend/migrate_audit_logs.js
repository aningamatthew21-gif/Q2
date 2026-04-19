'use strict';
require('dotenv').config();
const oracledb = require('oracledb');

async function migrate() {
  const conn = await oracledb.getConnection({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectionString: process.env.DB_CONNECTION_STRING
  });

  const columns = [
    { name: 'ENTITY_TYPE', ddl: "ALTER TABLE QA_AUDIT_LOGS ADD (ENTITY_TYPE VARCHAR2(100))" },
    { name: 'ENTITY_ID',   ddl: "ALTER TABLE QA_AUDIT_LOGS ADD (ENTITY_ID VARCHAR2(255))" },
    { name: 'SEVERITY',    ddl: "ALTER TABLE QA_AUDIT_LOGS ADD (SEVERITY VARCHAR2(20) DEFAULT 'info')" },
    { name: 'OUTCOME',     ddl: "ALTER TABLE QA_AUDIT_LOGS ADD (OUTCOME VARCHAR2(20) DEFAULT 'success')" },
    { name: 'IP_ADDRESS',  ddl: "ALTER TABLE QA_AUDIT_LOGS ADD (IP_ADDRESS VARCHAR2(45))" },
    { name: 'USER_AGENT',  ddl: "ALTER TABLE QA_AUDIT_LOGS ADD (USER_AGENT VARCHAR2(500))" },
  ];

  for (const col of columns) {
    try {
      // Check if column already exists
      const check = await conn.execute(
        "SELECT COUNT(*) AS C FROM USER_TAB_COLUMNS WHERE TABLE_NAME='QA_AUDIT_LOGS' AND COLUMN_NAME=:c",
        { c: col.name }
      );
      if (check.rows[0][0] > 0) {
        console.log(`Column ${col.name} already exists, skipping.`);
        continue;
      }
      await conn.execute(col.ddl);
      console.log(`✅ Added column: ${col.name}`);
    } catch (e) {
      console.error(`❌ Failed to add ${col.name}: ${e.message}`);
    }
  }

  // Create index for fast time-range queries
  try {
    await conn.execute("CREATE INDEX QA_AUDIT_TIME_IDX ON QA_AUDIT_LOGS (LOG_TIME DESC)");
    console.log('✅ Created time index');
  } catch (e) {
    if (e.message.includes('ORA-01408') || e.message.includes('ORA-00955')) {
      console.log('Time index already exists');
    } else {
      console.error('Index error:', e.message);
    }
  }

  try {
    await conn.execute("CREATE INDEX QA_AUDIT_CAT_IDX ON QA_AUDIT_LOGS (CATEGORY, LOG_TIME DESC)");
    console.log('✅ Created category index');
  } catch (e) {
    if (!e.message.includes('ORA-00955')) console.error('Category index error:', e.message);
  }

  await conn.commit();
  await conn.close();
  console.log('\n✅ Migration complete.');
}

migrate().catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
