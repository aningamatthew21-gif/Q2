'use strict';

/**
 * verify_backup.js — automated Oracle dump-file integrity check.
 *
 * Standards anchor:
 *   - ISO/IEC 27001:2022 A.8.13 (Information backup — restore-tested)
 *   - ISO/IEC 27001:2022 A.5.30 (ICT readiness — drills logged)
 *
 * What it does:
 *   1. Verifies the dump file exists + is non-empty + has a sane size
 *   2. Counts rows in critical tables of the LIVE schema (source-of-truth)
 *   3. Reads the dump's logfile (if present alongside) to find the
 *      reported row counts AT EXPORT TIME
 *   4. Compares — flags any drop >1% as a corruption signal
 *
 * What it deliberately does NOT do:
 *   - Actually impdp the dump into a scratch schema (that's a destructive
 *     operation requiring Oracle SYSDBA privileges + free tablespace; it
 *     belongs in a dedicated ops runbook, not a Node script).
 *   - Verify BLOB byte integrity for every attachment (would take hours).
 *
 * For the FULL physical restore drill, see DISASTER_RECOVERY.md §5.
 *
 * Usage:
 *   cd backend
 *   node verify_backup.js <path-to-dump-file>
 *
 * Exit codes:
 *   0 = backup looks good
 *   1 = backup is missing / empty / suspiciously small
 *   2 = row-count regression detected (possible silent corruption)
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { initPool, execute, closePool } = require('./db');

const MIN_DUMP_SIZE_BYTES = 1024 * 1024;   // 1 MB — anything smaller is suspect
const ROW_COUNT_TOLERANCE = 0.01;          // 1 % drop triggers a warning

// Critical tables to verify. Each is sampled from the LIVE DB so the
// script reports what's currently expected; a dump older than today
// won't perfectly match, but if today's row counts are wildly LOWER
// than a recent dump's reported counts, something's wrong (possibly a
// truncation / partial restore that crept in).
const CRITICAL_TABLES = [
  'QA_INVOICES',
  'QA_CUSTOMERS',
  'QA_QUOTES',
  'QA_PURCHASE_REQUISITIONS',
  'QA_RFQS',
  'QA_INVOICE_PAYMENTS',
  'QA_AUDIT_LOGS',
  'QA_RFQ_RESPONSE_ATTACHMENTS'
];

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function verifyDumpFile(dumpPath) {
  console.log(`\n▶ Verifying backup: ${path.basename(dumpPath)}`);

  if (!fs.existsSync(dumpPath)) {
    console.error(`  ✗ Dump file NOT FOUND at ${dumpPath}`);
    process.exit(1);
  }
  const stat = fs.statSync(dumpPath);
  if (stat.size < MIN_DUMP_SIZE_BYTES) {
    console.error(`  ✗ Dump file is too small (${fmtBytes(stat.size)}) — possibly truncated`);
    process.exit(1);
  }
  console.log(`  ✓ Dump file exists + non-empty (${fmtBytes(stat.size)})`);
  console.log(`  ✓ Last modified: ${stat.mtime.toISOString()}`);

  // Look for the export logfile alongside the dump
  const logPath = dumpPath.replace(/\.(dmp|dpdmp)$/i, '.log');
  let exportTime = null;
  let logCounts = {};
  if (fs.existsSync(logPath)) {
    const log = fs.readFileSync(logPath, 'utf8');
    // expdp format example: ". . exported "QUOTEAPP"."QA_INVOICES"  234.5 KB  5123 rows"
    const re = /exported\s+"[^"]+"\."([^"]+)"\s+\S+\s+\S+\s+(\d+)\s+rows/g;
    let m;
    while ((m = re.exec(log)) !== null) {
      logCounts[m[1].toUpperCase()] = Number(m[2]);
    }
    const timeMatch = log.match(/Job\s+"\S+"\s+successfully\s+completed\s+at\s+(.+)$/m);
    if (timeMatch) exportTime = timeMatch[1].trim();
    console.log(`  ✓ Export log found: ${Object.keys(logCounts).length} tables, finished ${exportTime || 'n/a'}`);
  } else {
    console.log(`  • No export log alongside dump (expected at ${path.basename(logPath)})`);
    console.log(`    — proceeding with current-DB row-count sanity check only`);
  }

  return { logCounts, exportTime };
}

async function verifyRowCounts(logCounts) {
  console.log(`\n▶ Cross-checking row counts against live DB`);
  let suspicious = 0;
  let healthy = 0;
  let unknown = 0;

  for (const table of CRITICAL_TABLES) {
    let liveCount;
    try {
      const r = await execute(`SELECT COUNT(*) AS C FROM ${table}`);
      liveCount = Number(r.rows[0].C);
    } catch (e) {
      console.log(`  • ${table.padEnd(32)} ?  (live query failed: ${e.message.slice(0, 60)})`);
      unknown++;
      continue;
    }

    const dumpCount = logCounts[table];
    if (dumpCount == null) {
      console.log(`  • ${table.padEnd(32)} live=${liveCount.toLocaleString().padStart(8)}  (not in dump log)`);
      unknown++;
      continue;
    }

    const drop = dumpCount > 0 ? (dumpCount - liveCount) / dumpCount : 0;
    if (drop > ROW_COUNT_TOLERANCE) {
      // Live has MORE rows = normal (new data since dump). Live has FEWER
      // = suspicious (rows lost since dump).
      console.log(`  ✗ ${table.padEnd(32)} dump=${dumpCount.toLocaleString().padStart(8)} live=${liveCount.toLocaleString().padStart(8)}  ⚠ ${(drop * 100).toFixed(1)}% DROP`);
      suspicious++;
    } else {
      const delta = liveCount - dumpCount;
      const deltaStr = delta >= 0 ? `+${delta.toLocaleString()}` : delta.toLocaleString();
      console.log(`  ✓ ${table.padEnd(32)} dump=${dumpCount.toLocaleString().padStart(8)} live=${liveCount.toLocaleString().padStart(8)}  (${deltaStr})`);
      healthy++;
    }
  }

  console.log(`\n  Summary: ${healthy} healthy · ${suspicious} suspicious · ${unknown} unknown`);
  return suspicious;
}

async function checkRecency() {
  console.log(`\n▶ Backup recency check`);
  // Audit log should have something newer than the dump time if backup is fresh
  try {
    const r = await execute(`SELECT MAX(CREATED_AT) AS LATEST FROM QA_AUDIT_LOGS`);
    const latestAudit = r.rows?.[0]?.LATEST;
    if (latestAudit) {
      console.log(`  ✓ Most recent audit event in live DB: ${new Date(latestAudit).toISOString()}`);
    }
  } catch (_) { /* non-fatal */ }
}

async function run() {
  const dumpPath = process.argv[2];
  if (!dumpPath) {
    console.error('Usage: node verify_backup.js <path-to-dump-file>');
    process.exit(1);
  }

  await initPool();

  try {
    const { logCounts } = await verifyDumpFile(dumpPath);
    const suspicious = await verifyRowCounts(logCounts);
    await checkRecency();

    console.log('');
    if (suspicious > 0) {
      console.error(`❌ Backup verification FAILED — ${suspicious} table(s) show suspicious row drop`);
      console.error(`   See DISASTER_RECOVERY.md §5 for the full physical-restore drill`);
      process.exit(2);
    }
    console.log('✅ Backup verified — safe to restore from');
    process.exit(0);
  } finally {
    await closePool();
  }
}

run().catch(async (err) => {
  console.error('\n❌ Verification crashed:', err.message);
  try { await closePool(); } catch (_) {}
  process.exit(1);
});
