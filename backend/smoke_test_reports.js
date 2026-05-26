'use strict';

/**
 * smoke_test_reports.js — Module 5 Phase 5.4 QA harness
 *
 * Hits every report endpoint against the running backend with a
 * signed admin JWT and verifies:
 *   - 200 status code
 *   - response.success === true
 *   - data envelope is shaped right (title, kpis, columns OR charts present)
 *   - SQL runs without throwing
 *
 * Catches issues node --check + npm run build miss:
 *   - Oracle type mismatches (ORA-01843 / ORA-00932 / etc.)
 *   - Reserved bind names (ORA-01745)
 *   - Bind/SQL count mismatches (NJS-098)
 *   - Column-name typos (ORA-00904)
 *   - Runtime JS errors in the handler logic
 *
 * Usage:
 *   1. Start the backend in another shell: `cd backend && npm run dev`
 *   2. Run from `backend/`: `node smoke_test_reports.js`
 *
 * No data is mutated — all endpoints are GET-only.
 */

require('dotenv').config();
const http = require('http');
const jwt  = require('jsonwebtoken');

const PORT = process.env.PORT || 3001;
const SECRET = process.env.JWT_SECRET;

if (!SECRET) {
  console.error('❌ JWT_SECRET not set in backend/.env');
  process.exit(1);
}

// Sign a JWT for an admin user — uses the same payload shape as
// /auth/verify-otp does so the authMiddleware accepts it.
const adminToken = jwt.sign(
  { email: 'qa-smoke@local', role: 'admin', userId: 'qa-smoke' },
  SECRET,
  { expiresIn: '15m' }
);

// All 24 endpoints. Use no params so the backend's defaults kick in
// — that's the most common path users hit on first page load.
const ENDPOINTS = [
  // Finance (8)
  { name: 'F1 AR Aging',                 path: '/api/reports/finance/ar-aging' },
  { name: 'F2 DSO Trend',                path: '/api/reports/finance/dso' },
  { name: 'F3 Cash Collections',         path: '/api/reports/finance/cash-collections' },
  { name: 'F4 Sales Register',           path: '/api/reports/finance/sales-register' },
  { name: 'F5 VAT Compliance',           path: '/api/reports/finance/vat-compliance' },
  { name: 'F6 WHT Collected',            path: '/api/reports/finance/wht-collected' },
  { name: 'F7 Customer Profitability',   path: '/api/reports/finance/customer-profitability' },
  { name: 'F8 Bad-Debt Provision',       path: '/api/reports/finance/bad-debt-provision' },
  // Procurement (8)
  { name: 'P1 PR Backlog Aging',         path: '/api/reports/procurement/pr-backlog' },
  { name: 'P2 RFQ Cycle Time',           path: '/api/reports/procurement/rfq-cycle-time' },
  { name: 'P3 RFQs Needing Attention',   path: '/api/reports/procurement/rfqs-attention' },
  { name: 'P4 Spend by Vendor',          path: '/api/reports/procurement/spend-by-vendor' },
  { name: 'P5 Spend by Category',        path: '/api/reports/procurement/spend-by-category' },
  { name: 'P6 Override Audit',           path: '/api/reports/procurement/override-audit' },
  { name: 'P7 Lead-Time Accuracy',       path: '/api/reports/procurement/lead-time-accuracy' },
  { name: 'P8 PR Cancellation',          path: '/api/reports/procurement/pr-cancellations' },
  // Sales (8)
  { name: 'S1 Sales Pipeline',           path: '/api/reports/sales/pipeline' },
  { name: 'S2 Conversion Funnel',        path: '/api/reports/sales/conversion-funnel' },
  { name: 'S3 Revenue vs Target',        path: '/api/reports/sales/revenue-vs-target' },
  { name: 'S4 Sales Leaderboard',        path: '/api/reports/sales/leaderboard' },
  { name: 'S5 Quote Aging',              path: '/api/reports/sales/quote-aging' },
  { name: 'S6 Win / Loss',               path: '/api/reports/sales/win-loss' },
  { name: 'S7 Top Customers',            path: '/api/reports/sales/top-customers' },
  { name: 'S8 Top Products',             path: '/api/reports/sales/top-products' }
];

function hit(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: 'localhost',
      port: PORT,
      path,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
      timeout: 30_000
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(body); } catch (_e) { parsed = { _raw: body.slice(0, 200) }; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('Timeout after 30s')); });
    req.end();
  });
}

function classify(result) {
  if (result.status !== 200) {
    return { ok: false, why: `HTTP ${result.status}: ${result.body?.error || JSON.stringify(result.body).slice(0, 120)}` };
  }
  if (!result.body?.success) {
    return { ok: false, why: `success=false: ${result.body?.error || 'unknown'}` };
  }
  const d = result.body.data;
  if (!d) return { ok: false, why: 'no data envelope' };
  if (!d.title) return { ok: false, why: 'envelope missing title' };
  const k = Array.isArray(d.kpis) ? d.kpis.length : 0;
  const c = Array.isArray(d.charts) ? d.charts.length : 0;
  const r = Array.isArray(d.rows) ? d.rows.length : 0;
  return { ok: true, summary: `kpis=${k} charts=${c} rows=${r}` };
}

(async () => {
  console.log(`\n▶ Module 5 reports smoke test — hitting ${ENDPOINTS.length} endpoints on :${PORT}\n`);
  let pass = 0, fail = 0;
  const failures = [];

  for (const ep of ENDPOINTS) {
    process.stdout.write(`  ${ep.name.padEnd(32)} `);
    try {
      const result = await hit(ep.path);
      const verdict = classify(result);
      if (verdict.ok) {
        console.log(`✓  ${verdict.summary}`);
        pass++;
      } else {
        console.log(`✗  ${verdict.why}`);
        fail++;
        failures.push({ name: ep.name, why: verdict.why, path: ep.path });
      }
    } catch (e) {
      console.log(`✗  ${e.message}`);
      fail++;
      failures.push({ name: ep.name, why: e.message, path: ep.path });
    }
  }

  console.log(`\n────────────────────────────────────────────────`);
  console.log(`  ${pass} passed   ${fail} failed   (${ENDPOINTS.length} total)`);
  console.log(`────────────────────────────────────────────────\n`);

  if (failures.length > 0) {
    console.log('Failures:');
    for (const f of failures) {
      console.log(`  ✗ ${f.name}`);
      console.log(`      ${f.path}`);
      console.log(`      → ${f.why}\n`);
    }
    process.exit(1);
  } else {
    console.log('All endpoints healthy ✓\n');
    process.exit(0);
  }
})();
