'use strict';
require('dotenv').config();
const oracledb = require('oracledb');

async function seedUsers() {
  const conn = await oracledb.getConnection({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectionString: process.env.DB_CONNECTION_STRING
  });

  const usersToSeed = [
    { email: 'aningamatthew21@gmail.com', role: 'sales',      name: 'Matthew Aninga' },
    { email: 'controller@margins-id.com', role: 'controller', name: 'Controller Admin' },
  ];

  for (const u of usersToSeed) {
    try {
      await conn.execute(
        "MERGE INTO QA_USERS dest " +
        "USING (SELECT :email AS e FROM DUAL) src " +
        "ON (dest.USER_EMAIL = src.e) " +
        "WHEN MATCHED THEN UPDATE SET USER_ROLE = :role, USER_NAME = :name " +
        "WHEN NOT MATCHED THEN INSERT (USER_EMAIL, USER_ROLE, USER_NAME) VALUES (:email, :role, :name)",
        { email: u.email, role: u.role, name: u.name }
      );
      console.log('Upserted:', u.email, '| role:', u.role);
    } catch (e) {
      console.error('Failed for', u.email, '->', e.message);
    }
  }

  await conn.commit();

  // Show final state
  const result = await conn.execute('SELECT USER_EMAIL, USER_ROLE, USER_NAME FROM QA_USERS ORDER BY USER_ROLE');
  console.log('\nFinal QA_USERS table:');
  result.rows.forEach(r => console.log(' -', r.USER_EMAIL, '| role:', r.USER_ROLE, '| name:', r.USER_NAME));

  await conn.close();
}

seedUsers().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
