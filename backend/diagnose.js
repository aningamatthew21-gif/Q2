'use strict';
require('dotenv').config();
const oracledb = require('oracledb');
const nodemailer = require('nodemailer');

async function diagnose() {
  console.log('--- 🔍 Quote App System Diagnostics ---');
  console.log('Timestamp:', new Date().toISOString());
  console.log('');

  // 1. Env Check
  console.log('1. Checking Environment Variables...');
  const roles = ['DB_USER', 'DB_PASSWORD', 'DB_CONNECTION_STRING', 'SMTP_USER', 'SMTP_PASS'];
  roles.forEach(r => {
    if (process.env[r]) {
      console.log(` ✅ ${r} is set`);
    } else {
      console.log(` ❌ ${r} is MISSING!`);
    }
  });

  // 2. Database Connection Check
  console.log('\n2. Testing Oracle Database Connection...');
  let connection;
  try {
    connection = await oracledb.getConnection({
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      connectionString: process.env.DB_CONNECTION_STRING
    });
    console.log(' ✅ Connection Successful!');
    
    // Check tables
    const tables = ['QA_USERS', 'QA_OTPS', 'QA_INVOICES', 'QA_CUSTOMERS'];
    for (const table of tables) {
      try {
        const result = await connection.execute(`SELECT count(*) as count FROM ${table}`);
        console.log(` ✅ Table ${table} exists (Rows: ${result.rows[0][0] || 0})`);
      } catch (err) {
        console.log(` ❌ Table ${table} error: ${err.message}`);
      }
    }
  } catch (err) {
    console.log(' ❌ Oracle Error:', err.message);
    if (err.message.includes('ORA-28000')) {
      console.log('    🚨 REASON: Account is LOCKED. You must run "ALTER USER quoteapp ACCOUNT UNLOCK;" as SYS.');
    } else if (err.message.includes('ORA-01017')) {
      console.log('    🚨 REASON: Invalid username/password. Check backend/.env vs your SQL command.');
    }
  } finally {
    if (connection) await connection.close();
  }

  // 3. SMTP Check
  console.log('\n3. Testing Gmail SMTP Connection...');
  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
    await transporter.verify();
    console.log(' ✅ SMTP Connection Verified!');
  } catch (err) {
    console.log(' ❌ SMTP Error:', err.message);
    console.log('    🚨 REASON: Check if "2-Step Verification" is ON and you are using a 16-char "App Password", not your main password.');
  }

  console.log('\n--- Diagnostics Complete ---');
}

diagnose();
