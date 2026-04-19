require('dotenv').config();
const db = require('./db');

async function test() {
  await db.initPool();
  try {
    const r = await db.execute(`
    INSERT INTO QA_AUDIT_LOGS
      (USER_ID, ACTION, DETAILS, CATEGORY, EXTRA_DATA, ENTITY_TYPE, ENTITY_ID, SEVERITY, OUTCOME, IP_ADDRESS)
    VALUES
      (:userId, :action, :details, :category, :extData, :entityType, :entityId, :severity, :outcomeRes, :ipAddr)
    `, {
      userId: 'testuser',
      action: 'LOGIN_SUCCESS',
      details: 'User logged in',
      category: 'auth',
      extData: JSON.stringify({ extraField: 'should go to extra data' }),
      entityType: null,
      entityId: null,
      severity: 'info',
      outcomeRes: 'success',
      ipAddr: '127.0.0.1'
    });
    console.log("Insert Success:", r);
  } catch (err) {
    console.error("Insert Error:", err.message);
  } finally {
    process.exit();
  }
}
test();
