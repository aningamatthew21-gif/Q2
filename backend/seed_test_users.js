#!/usr/bin/env node
/**
 * seed_test_users.js
 *
 * Idempotent seeder for the seven test accounts that cover every role
 * tier defined in shared/permissions.js. Designed for the
 * authorization-rollout test plan: one email per role, every email is
 * a Gmail `+suffix` of a single real inbox so OTPs all land in the
 * same mailbox.
 *
 * Each row is written via Oracle MERGE so the script is safe to run
 * repeatedly — emails already present have their role updated, new
 * ones are inserted. Existing display names are preserved unless
 * the row is brand-new.
 *
 * Run from anywhere:
 *     node backend/seed_test_users.js
 * or, from inside the backend folder:
 *     node seed_test_users.js
 *
 * After it finishes, the affected users must log out and log back in
 * — their JWT carries the old role until they re-authenticate.
 *
 * The list below mirrors what the user asked for in chat. Edit the
 * `BASE` constant if your real inbox is not `aningamatthew21@gmail.com`.
 */

'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { initPool, execute, closePool } = require('./db');

// ── Edit BASE to point to YOUR Gmail address. Every test user routes
//    through `BASE+<suffix>@gmail.com` so the OTPs all arrive in one inbox.
const BASE = 'aningamatthew21';

const USERS = [
  { email: `${BASE}@gmail.com`,                          role: 'admin',                name: 'System Administrator'   },

  { email: `${BASE}+finance.head@gmail.com`,             role: 'finance_head',         name: 'Finance Head (test)'    },
  { email: `${BASE}+finance.officer@gmail.com`,          role: 'finance_officer',      name: 'Finance Officer (test)' },

  { email: `${BASE}+sales.head@gmail.com`,               role: 'sales_head',           name: 'Sales Head (test)'      },
  { email: `${BASE}+sales.officer@gmail.com`,            role: 'sales_officer',        name: 'Sales Officer (test)'   },

  { email: `${BASE}+procure@gmail.com`,                  role: 'procurement_head',     name: 'Procurement Head (test)'},
  { email: `${BASE}+procurement.officer@gmail.com`,      role: 'procurement_officer',  name: 'Procurement Officer (test)' }
];

// MERGE = Oracle's UPSERT. Inserts if missing, updates role + name if present.
// USER_STATUS is left alone on existing rows so a previously deactivated
// account stays deactivated unless you explicitly reactivate it.
const MERGE_SQL = `
MERGE INTO QA_USERS u
USING (
  SELECT :em AS USER_EMAIL, :rl AS USER_ROLE, :nm AS USER_NAME FROM dual
) src
ON (u.USER_EMAIL = src.USER_EMAIL)
WHEN MATCHED THEN UPDATE SET
    USER_ROLE = src.USER_ROLE,
    USER_NAME = COALESCE(u.USER_NAME, src.USER_NAME)
WHEN NOT MATCHED THEN INSERT
  (USER_EMAIL,        USER_ROLE,        USER_NAME,        USER_STATUS)
  VALUES
  (src.USER_EMAIL,    src.USER_ROLE,    src.USER_NAME,    'active')
`;

async function main() {
  console.log(`\nSeeding ${USERS.length} test users…\n`);
  await initPool();

  let inserted = 0, updated = 0, failed = 0;

  for (const u of USERS) {
    try {
      // Check whether this email exists already so we can report INSERT vs UPDATE.
      const before = await execute(
        'SELECT USER_ROLE FROM QA_USERS WHERE USER_EMAIL = :em',
        { em: u.email }
      );
      const existed = before.rows && before.rows.length > 0;

      await execute(MERGE_SQL, { em: u.email, rl: u.role, nm: u.name });

      if (existed) {
        updated++;
        console.log(`  UPDATE  ${u.email.padEnd(50)}  →  ${u.role}`);
      } else {
        inserted++;
        console.log(`  INSERT  ${u.email.padEnd(50)}  →  ${u.role}`);
      }
    } catch (err) {
      failed++;
      console.error(`  FAIL    ${u.email}  →  ${err.message}`);
    }
  }

  console.log(`\nDone. ${inserted} inserted, ${updated} updated, ${failed} failed.\n`);

  // Print the resulting roster so you can copy/paste it for testing.
  const all = await execute(
    `SELECT USER_EMAIL, USER_ROLE, USER_STATUS FROM QA_USERS ORDER BY USER_ROLE, USER_EMAIL`
  );
  console.log('Current QA_USERS roster:');
  console.log('─'.repeat(86));
  (all.rows || []).forEach(r => {
    console.log(`  ${(r.USER_EMAIL || '').padEnd(50)}  ${(r.USER_ROLE || '').padEnd(22)} ${r.USER_STATUS || ''}`);
  });
  console.log('─'.repeat(86));

  await closePool();
  console.log('\nNote: any user already logged-in needs to sign out + sign back in');
  console.log('so their JWT carries the new role.\n');
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
