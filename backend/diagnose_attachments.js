'use strict';

/**
 * diagnose_attachments.js — server-side forensic inspector for
 * QA_RFQ_RESPONSE_ATTACHMENTS rows.
 *
 * Reports per row:
 *   - ATTACHMENT_ID
 *   - FILE_NAME / FILE_TYPE
 *   - FILE_SIZE (the column value — what we said we stored)
 *   - DBMS_LOB.GETLENGTH(FILE_DATA) (what Oracle ACTUALLY stored, server-side)
 *   - First 16 bytes of FILE_DATA as hex + ASCII (file magic check)
 *   - Diagnosis: HEALTHY / SIZE_MISMATCH / OBJECT_OBJECT / EMPTY / UNKNOWN
 *
 * Usage:
 *   cd backend
 *   node diagnose_attachments.js               # inspect all rows
 *   node diagnose_attachments.js 7             # inspect attachment id 7
 *   node diagnose_attachments.js --wipe        # ⚠ DELETE ALL rows (start clean)
 *
 * The wipe is intentional — if every row is corrupt from a previous
 * insert-side bug, the only fix is to re-upload from the UI. This
 * script gives you a clean slate.
 */

require('dotenv').config();
const oracledb = require('oracledb');
const { initPool, execute, closePool } = require('./db');

function fmtHex(buf, n = 16) {
  const slice = buf.slice(0, n);
  const hex = slice.toString('hex').match(/.{1,2}/g).join(' ');
  const ascii = slice.toString('ascii').replace(/[^\x20-\x7E]/g, '.');
  return `${hex.padEnd(n * 3, ' ')}  |${ascii}|`;
}

function classifyMagic(head) {
  const hex8 = head.slice(0, 8).toString('hex').toUpperCase();
  // Known file signatures
  if (hex8.startsWith('25504446'))      return 'PDF';
  if (hex8.startsWith('89504E47'))      return 'PNG';
  if (hex8.startsWith('FFD8FF'))        return 'JPEG';
  if (hex8.startsWith('47494638'))      return 'GIF';
  if (hex8.startsWith('504B0304'))      return 'ZIP/Office';
  if (hex8.startsWith('D0CF11E0'))      return 'Office (legacy)';
  // The smoking gun — "[obje" = the [object Object] coercion sentinel
  if (hex8.startsWith('5B6F626A'))      return '⚠ "[object Object]" SENTINEL — storage corrupted';
  // ASCII-looking start may indicate text/JSON
  const a = head.slice(0, 4).toString('ascii');
  if (/^[\x20-\x7E]+$/.test(a))         return `ASCII ("${a}…") — likely NOT a binary file`;
  return 'unknown';
}

async function diagnose(id) {
  const whereClause = id ? 'WHERE ATTACHMENT_ID = :id' : '';
  const binds = id ? { id: Number(id) } : {};

  const r = await execute(
    `SELECT ATTACHMENT_ID, RFQ_ID, VENDOR_ID, FILE_NAME, FILE_TYPE,
            FILE_SIZE, UPLOADED_BY, UPLOADED_AT,
            DBMS_LOB.GETLENGTH(FILE_DATA) AS LOB_LEN,
            FILE_DATA
       FROM QA_RFQ_RESPONSE_ATTACHMENTS
       ${whereClause}
       ORDER BY ATTACHMENT_ID DESC
       FETCH FIRST 50 ROWS ONLY`,
    binds,
    { fetchInfo: { FILE_DATA: { type: oracledb.BUFFER } } }
  );

  const rows = r.rows || [];
  if (rows.length === 0) {
    console.log('\n  (no attachment rows found)');
    return;
  }

  console.log(`\n  Inspecting ${rows.length} row${rows.length === 1 ? '' : 's'}…\n`);

  let healthy = 0, sentinel = 0, mismatch = 0, empty = 0, other = 0;
  for (const row of rows) {
    const colSize = Number(row.FILE_SIZE || 0);
    const lobSize = Number(row.LOB_LEN || 0);
    const buf = Buffer.isBuffer(row.FILE_DATA) ? row.FILE_DATA : Buffer.alloc(0);
    const bufSize = buf.length;

    let verdict;
    if (bufSize === 0)             { verdict = 'EMPTY';          empty++; }
    else if (bufSize <= 32 && classifyMagic(buf).includes('[object Object]'))
                                   { verdict = 'OBJECT_OBJECT';  sentinel++; }
    else if (Math.abs(bufSize - colSize) > 8 && colSize > 0)
                                   { verdict = 'SIZE_MISMATCH';  mismatch++; }
    else                            { verdict = 'HEALTHY';        healthy++; }

    console.log(`  ─── ATTACHMENT_ID ${row.ATTACHMENT_ID} ─────────────────────────────`);
    console.log(`    File:     ${row.FILE_NAME} (${row.FILE_TYPE || 'no MIME'})`);
    console.log(`    RFQ:      ${row.RFQ_ID}`);
    console.log(`    Vendor:   ${row.VENDOR_ID}`);
    console.log(`    Uploaded: ${row.UPLOADED_AT?.toISOString?.()} by ${row.UPLOADED_BY}`);
    console.log(`    FILE_SIZE column: ${colSize} bytes`);
    console.log(`    DBMS_LOB len:     ${lobSize} bytes`);
    console.log(`    JS Buffer len:    ${bufSize} bytes`);
    if (bufSize > 0) {
      console.log(`    Head 16:  ${fmtHex(buf, 16)}`);
      console.log(`    Magic:    ${classifyMagic(buf)}`);
    }
    console.log(`    Verdict:  ${verdict}\n`);
  }

  console.log(`  ─── Summary ─────────────────────────────────────────────`);
  console.log(`    Healthy:        ${healthy}`);
  console.log(`    [object Object]: ${sentinel}  ${sentinel > 0 ? '← write the canonical insert (Task #14 fix) + re-upload' : ''}`);
  console.log(`    Size mismatch:  ${mismatch}`);
  console.log(`    Empty:          ${empty}`);
  console.log(`    Other:          ${other}\n`);

  if (sentinel > 0 || mismatch > 0 || empty > 0) {
    console.log(`  💡 To wipe corrupted rows and start clean:`);
    console.log(`     node diagnose_attachments.js --wipe\n`);
  }
}

async function wipe() {
  const r = await execute(`SELECT COUNT(*) AS C FROM QA_RFQ_RESPONSE_ATTACHMENTS`);
  const count = Number(r.rows?.[0]?.C || 0);
  if (count === 0) {
    console.log('\n  (table already empty)\n');
    return;
  }
  console.log(`\n  Deleting ${count} attachment row${count === 1 ? '' : 's'}…`);
  await execute(`DELETE FROM QA_RFQ_RESPONSE_ATTACHMENTS`);
  console.log(`  ✓ Wiped. Re-upload via Edit Vendor Response modal in the UI.\n`);
}

/**
 * --dump <id>  — fetch attachment N via the LIVE backend HTTP endpoint
 * and write the bytes to disk. If the resulting file is a valid PDF,
 * the Express transport is fine — and any corruption is downstream
 * (Vite proxy or browser quirk).
 */
async function dump(id) {
  const http = require('http');
  const fs   = require('fs');
  const path = require('path');
  const jwt  = require('jsonwebtoken');

  const SECRET = process.env.JWT_SECRET;
  if (!SECRET) { console.error('❌ JWT_SECRET missing in .env'); process.exit(1); }

  // Look up the attachment row so we know the RFQ + vendor + filename
  const r = await execute(
    `SELECT ATTACHMENT_ID, RFQ_ID, VENDOR_ID, FILE_NAME
       FROM QA_RFQ_RESPONSE_ATTACHMENTS WHERE ATTACHMENT_ID = :id`,
    { id: Number(id) }
  );
  const row = r.rows?.[0];
  if (!row) { console.error(`❌ no attachment with id=${id}`); return; }

  const token = jwt.sign(
    { email: 'qa-dump@local', role: 'admin', userId: 'qa-dump' },
    SECRET, { expiresIn: '5m' }
  );

  const reqPath = `/api/rfqs/${row.RFQ_ID}/responses/${row.VENDOR_ID}/attachments/${row.ATTACHMENT_ID}/download`;
  console.log(`\n  Fetching ${reqPath}\n`);

  await new Promise((resolve, reject) => {
    const req = http.request({
      host: 'localhost', port: process.env.PORT || 3001,
      path: reqPath, method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    }, (res) => {
      console.log(`  HTTP ${res.statusCode}`);
      console.log(`  Headers:`);
      for (const [k, v] of Object.entries(res.headers)) console.log(`    ${k}: ${v}`);
      console.log('');

      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const outPath = path.join(__dirname, `dumped-${row.ATTACHMENT_ID}-${row.FILE_NAME.replace(/[^a-zA-Z0-9.-]/g, '_')}`);
        fs.writeFileSync(outPath, buf);
        const head8 = buf.slice(0, 8).toString('hex');
        const head4ascii = buf.slice(0, 4).toString('ascii').replace(/[^\x20-\x7E]/g, '.');
        console.log(`  Body length:   ${buf.length} bytes`);
        console.log(`  First 8 bytes: ${head8}  (${head4ascii})`);
        console.log(`  Wrote to:      ${outPath}`);
        console.log(`\n  ▶ Open ${outPath} in a PDF viewer to confirm.`);
        console.log(`    If it opens cleanly, the Express transport is fine and`);
        console.log(`    the corruption is happening in the Vite dev proxy or browser.\n`);
        resolve();
      });
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  await initPool();
  const arg = process.argv[2];
  const arg2 = process.argv[3];
  try {
    if (arg === '--wipe') {
      await wipe();
    } else if (arg === '--dump' && arg2 && /^\d+$/.test(arg2)) {
      await dump(arg2);
    } else if (arg && /^\d+$/.test(arg)) {
      await diagnose(arg);
    } else {
      await diagnose(null);
    }
  } catch (e) {
    console.error('❌', e.message);
    process.exit(1);
  } finally {
    await closePool();
  }
})();
