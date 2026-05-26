'use strict';

/**
 * routes/reports/finance.js — Module 5 Phase 5.1
 *
 * Eight finance reports, all gated by `reports.run.finance`. The
 * pattern is identical for every endpoint: gather params → run SQL →
 * shape into the standard envelope (see _shared.js).
 *
 * Build order (locked):
 *   F1 AR Aging              ← built first (most-used)
 *   F5 VAT Compliance
 *   F4 Sales Register
 *   F6 WHT Collected
 *   F2 DSO Trend
 *   F3 Cash Collections
 *   F7 Customer Profitability
 *   F8 Bad-Debt Provision
 */

const express = require('express');
const { execute } = require('../../db');
const { catchAsync } = require('../../middleware/errorHandler');
const { authMiddleware, requirePermission } = require('../../middleware/authMiddleware');
const { envelope, parseDateRange, agingBucket, AGING_BUCKET_ORDER, n, graBoxFor, safeJsonArray, isoDay } = require('./_shared');

const router = express.Router();
router.use(authMiddleware);
router.use(requirePermission('reports.run.finance'));

/**
 * Health / placeholder until each report ships. Lets the ReportsHub
 * link-out work for un-built reports — they show a friendly "Coming
 * soon" via the standard ReportPage wrapper.
 */
function placeholder(title, reason) {
  return envelope({
    title,
    subtitle: 'Coming soon — Phase 5.1',
    kpis: [],
    charts: [],
    columns: [],
    rows: []
  });
}

// ─────────────────────────────────────────────────────────────────────────
// F1 · AR Aging — outstanding receivables aged from due date.
//
// Open AR = BALANCE_DUE > 0 AND STATUS NOT IN draft/rejected/cancelled/paid.
// Bucket by (asOfDate − DUE_DATE) days using the standard 5-bucket scheme.
// ─────────────────────────────────────────────────────────────────────────
router.get('/ar-aging', catchAsync(async (req, res) => {
  const { asOfDate } = parseDateRange(req.query);
  const { customerId, industry, sizeBand, creditHoldOnly } = req.query;

  // Build WHERE clauses dynamically so optional filters don't bloat
  // the SQL when unused. Date math is done in JS (see below) so we
  // don't bind asOfDate into the SQL at all.
  const conditions = [
    "i.BALANCE_DUE > 0",
    "i.STATUS NOT IN ('Draft','Rejected','Customer Rejected','Cancelled','Paid')"
  ];
  const binds = {};

  if (customerId)   { conditions.push("i.CUSTOMER_ID = :cust");  binds.cust = customerId; }
  if (industry)     { conditions.push("c.INDUSTRY = :ind");      binds.ind  = industry; }
  if (sizeBand)     { conditions.push("c.SIZE_BAND = :sb");      binds.sb   = sizeBand; }
  if (String(creditHoldOnly) === 'true') {
    conditions.push("c.CREDIT_HOLD = 'Y'");
  }

  // INVOICE_DATE is VARCHAR2(20) in the legacy schema (ISO string from
  // the frontend); DUE_DATE was added in Module 1 as a real DATE. Rather
  // than fight the type mismatch in SQL (TRUNC, NVL, +30 all interact
  // differently across DATE/VARCHAR2/TIMESTAMP), we return the raw
  // fields and compute days-overdue in JS. Tiny inefficiency, eliminates
  // an entire class of ORA-00932 bugs.
  const sql = `
    SELECT
      i.INVOICE_ID,
      i.APPROVED_INVOICE_ID,
      i.CUSTOMER_ID,
      i.CUSTOMER_NAME,
      c.INDUSTRY,
      c.SIZE_BAND,
      c.CREDIT_HOLD,
      i.INVOICE_DATE,
      i.DUE_DATE,
      i.TOTAL,
      i.BALANCE_DUE,
      i.STATUS,
      i.PAYMENT_TERMS
    FROM QA_INVOICES i
    LEFT JOIN QA_CUSTOMERS c ON c.CUSTOMER_ID = i.CUSTOMER_ID
    WHERE ${conditions.join(' AND ')}`;

  const r = await execute(sql, binds);
  const raw = r.rows || [];

  // Resolve due date for each row: prefer DUE_DATE; fall back to
  // INVOICE_DATE + 30 (assumed Net 30) for legacy invoices that
  // never had a due date backfilled. Returns null if neither parses.
  const resolveDue = (row) => {
    if (row.DUE_DATE) {
      const d = row.DUE_DATE instanceof Date ? row.DUE_DATE : new Date(row.DUE_DATE);
      if (!Number.isNaN(d.getTime())) return d;
    }
    if (row.INVOICE_DATE) {
      const d = new Date(row.INVOICE_DATE);
      if (!Number.isNaN(d.getTime())) {
        const d2 = new Date(d);
        d2.setDate(d2.getDate() + 30);
        return d2;
      }
    }
    return null;
  };

  const asofMs = asOfDate.getTime();
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  // Shape rows + compute buckets (JS-side date math)
  const rows = raw.map(row => {
    const due = resolveDue(row);
    const days = due ? Math.floor((asofMs - due.getTime()) / MS_PER_DAY) : 0;
    return {
      invoiceId:        row.INVOICE_ID,
      invoiceNumber:    row.APPROVED_INVOICE_ID || row.INVOICE_ID,
      customerId:       row.CUSTOMER_ID,
      customerName:     row.CUSTOMER_NAME || '—',
      industry:         row.INDUSTRY      || '—',
      sizeBand:         row.SIZE_BAND     || '—',
      creditHold:       row.CREDIT_HOLD === 'Y',
      invoiceDate:      row.INVOICE_DATE,
      dueDate:          due,
      total:            n(row.TOTAL),
      balanceDue:       n(row.BALANCE_DUE),
      daysOverdue:      days,
      bucket:           agingBucket(days)
    };
  });
  // Sort by days overdue desc, then balance desc (now that we have it)
  rows.sort((a, b) => (b.daysOverdue - a.daysOverdue) || (b.balanceDue - a.balanceDue));

  // ── Aggregations for the KPI band and charts ──────────────────────
  let totalAR = 0;
  let overdueAR = 0;
  const customersOverdue = new Set();
  const bucketTotals  = { CURRENT: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  const industryTotals = {};

  for (const row of rows) {
    totalAR += row.balanceDue;
    bucketTotals[row.bucket] = (bucketTotals[row.bucket] || 0) + row.balanceDue;
    if (row.bucket !== 'CURRENT') {
      overdueAR += row.balanceDue;
      customersOverdue.add(row.customerId);
    }
    const ind = row.industry || '—';
    industryTotals[ind] = (industryTotals[ind] || 0) + row.balanceDue;
  }

  const worstBucketKey = AGING_BUCKET_ORDER.slice().reverse()
    .find(k => (bucketTotals[k] || 0) > 0) || 'CURRENT';

  const pctOverdue = totalAR > 0 ? n((overdueAR / totalAR) * 100, 1) : 0;

  const filtersApplied = [];
  if (industry)   filtersApplied.push({ label: 'Industry',   value: industry });
  if (sizeBand)   filtersApplied.push({ label: 'Size band',  value: sizeBand });
  if (customerId) filtersApplied.push({ label: 'Customer',   value: customerId });
  if (String(creditHoldOnly) === 'true') filtersApplied.push({ label: 'Credit hold', value: 'Yes' });

  res.json(envelope({
    title:    'AR Aging',
    subtitle: `As of ${asOfDate.toISOString().slice(0, 10)} · ${rows.length} open invoice${rows.length === 1 ? '' : 's'}`,
    asOfDate,
    filtersApplied,
    kpis: [
      { label: 'Total AR',          value: totalAR,            fmt: 'currency' },
      { label: '% Overdue',         value: pctOverdue,         fmt: 'percent', tone: pctOverdue > 50 ? 'bad' : pctOverdue > 25 ? 'neutral' : 'good' },
      { label: `Worst bucket (${worstBucketKey})`, value: n(bucketTotals[worstBucketKey]), fmt: 'currency' },
      { label: 'Customers overdue', value: customersOverdue.size, fmt: 'number' }
    ],
    charts: [
      {
        type:  'bar',
        title: 'Aging bucket mix',
        data:  AGING_BUCKET_ORDER.map(b => ({ name: b, value: n(bucketTotals[b] || 0) }))
      },
      {
        type:  'bar',
        title: 'Outstanding by industry',
        data:  Object.entries(industryTotals)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([name, value]) => ({ name, value: n(value) }))
      }
    ],
    columns: [
      { key: 'customerName', label: 'Customer',  type: 'string', drillPage: 'customerStatement', drillKey: 'customerId' },
      { key: 'industry',     label: 'Industry',  type: 'string' },
      { key: 'invoiceNumber',label: 'Invoice',   type: 'string', drillPage: 'invoiceEditor', drillKey: 'invoiceId' },
      { key: 'dueDate',      label: 'Due',       type: 'date' },
      { key: 'daysOverdue',  label: 'Days',      type: 'number' },
      { key: 'balanceDue',   label: 'Balance',   type: 'currency' },
      { key: 'bucket',       label: 'Bucket',    type: 'string' }
    ],
    rows,
    totals: { balanceDue: totalAR }
  }));
}));
// ─────────────────────────────────────────────────────────────────────────
// F2 · DSO Trend — Days Sales Outstanding over time.
//
// For each month-bucket in the window:
//   revenue   = sum of recognised SUBTOTAL invoiced in the month
//   collected = sum of payments banked in the month (status != REVERSED)
//   ar_end    = sum of BALANCE_DUE for invoices created on/before
//               month-end and still status-recognised (snapshot)
//   DSO       = (ar_end / revenue) × days_in_month        when revenue > 0
//   CEI proxy = (collected / revenue) × 100               (collection-rate)
//
// Notes:
//   - DSO is right-sized to days-in-month rather than a fixed 30, which
//     gets you a stable comparison even across Feb/leap years.
//   - The "true" CEI formula uses opening/ending TOTAL vs CURRENT AR;
//     we approximate with collection rate. Flagged in the report as
//     "Collection rate" not "CEI" to avoid misleading the user.
// ─────────────────────────────────────────────────────────────────────────
router.get('/dso', catchAsync(async (req, res) => {
  const { from, to } = parseDateRange(req.query);
  // Default window = trailing 12 months ending at `to` if `from` was
  // defaulted to first-of-month. Lets the report be useful on first load.
  let windowFrom = from;
  if (!req.query.from) {
    windowFrom = new Date(to.getFullYear(), to.getMonth() - 11, 1);
  }
  const fromStr = isoDay(windowFrom);
  const toStr   = isoDay(to);

  // ── 1. All recognised invoices in/before the window for AR snapshot ──
  // We pull invoices created before window-end so we can compute AR
  // snapshot at each month-end (an invoice from 6 months ago still
  // contributes to AR_END today).
  const invSql = `
    SELECT INVOICE_ID, INVOICE_DATE, SUBTOTAL, BALANCE_DUE, STATUS
    FROM QA_INVOICES
    WHERE STATUS IN ('Customer Accepted','Paid','Partially Paid')
      AND INVOICE_DATE <= :toEnd`;
  const invRes = await execute(invSql, { toEnd: toStr });
  const invoices = invRes.rows || [];

  // ── 2. All payments in the window (for collected-per-month) ──
  // PAYMENT_DATE is VARCHAR2(20) ISO-string (NOT a real DATE — I got
  // burned assuming it was; ORA-01843 fires on every comparison if
  // you bind a Date object). SUBSTR(...,1,10) extracts the YYYY-MM-DD
  // prefix so the comparison is correct whether the stored value is
  // pure date or full timestamp.
  const paySql = `
    SELECT INVOICE_ID, AMOUNT, PAYMENT_DATE, STATUS
    FROM QA_INVOICE_PAYMENTS
    WHERE SUBSTR(PAYMENT_DATE, 1, 10) >= :pFrom
      AND SUBSTR(PAYMENT_DATE, 1, 10) <= :pTo
      AND STATUS != 'REVERSED'`;
  const payRes = await execute(paySql, { pFrom: isoDay(windowFrom), pTo: isoDay(to) });
  const payments = payRes.rows || [];

  // ── 3. Build month buckets across the window ──
  const months = [];
  const cursor = new Date(windowFrom.getFullYear(), windowFrom.getMonth(), 1);
  const lastBucket = new Date(to.getFullYear(), to.getMonth(), 1);
  while (cursor <= lastBucket) {
    const ym = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0); // last day of month
    const daysIn   = monthEnd.getDate();
    months.push({ ym, end: monthEnd, daysIn });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  // ── 4. Compute per-bucket metrics ──
  const rows = months.map(m => {
    // Revenue in the month — invoices whose INVOICE_DATE starts with ym
    let revenue = 0;
    for (const inv of invoices) {
      if (String(inv.INVOICE_DATE || '').startsWith(m.ym)) {
        revenue += n(inv.SUBTOTAL);
      }
    }

    // Collected in the month — payments whose PAYMENT_DATE falls in month
    let collected = 0;
    for (const p of payments) {
      const d = p.PAYMENT_DATE instanceof Date ? p.PAYMENT_DATE : new Date(p.PAYMENT_DATE);
      if (!Number.isNaN(d.getTime())) {
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (ym === m.ym) collected += n(p.AMOUNT);
      }
    }

    // AR snapshot at month-end — invoices with INVOICE_DATE on/before
    // month-end AND still carrying BALANCE_DUE. NOTE: this is the
    // CURRENT BALANCE_DUE (not BALANCE_DUE-at-that-month-end). For a
    // strict snapshot we'd need to subtract subsequent payments. For
    // the trend view, current balance is a reasonable approximation
    // since older balances are usually settled by now. Documented in
    // the report so the user knows.
    const monthEndStr = isoDay(m.end);
    let arEnd = 0;
    for (const inv of invoices) {
      if (String(inv.INVOICE_DATE || '') <= monthEndStr && n(inv.BALANCE_DUE) > 0) {
        arEnd += n(inv.BALANCE_DUE);
      }
    }

    const dso = revenue > 0 ? n((arEnd / revenue) * m.daysIn, 0) : 0;
    const collectionRate = revenue > 0 ? n((collected / revenue) * 100, 1) : 0;

    return {
      month:           m.ym,
      revenue:         n(revenue),
      collected:       n(collected),
      arEnd:           n(arEnd),
      dso,
      collectionRate
    };
  });

  // ── 5. KPIs ──
  const latest = rows[rows.length - 1] || { dso: 0, collectionRate: 0 };
  const dsoValues = rows.map(r => r.dso).filter(v => v > 0);
  const avgDso  = dsoValues.length > 0 ? Math.round(dsoValues.reduce((a, b) => a + b, 0) / dsoValues.length) : 0;
  const best    = dsoValues.length > 0 ? rows.find(r => r.dso === Math.min(...dsoValues)) : null;
  const prevMonth = rows[rows.length - 2];
  const dsoDelta  = prevMonth ? latest.dso - prevMonth.dso : 0;

  res.json(envelope({
    title:    'DSO Trend',
    subtitle: `Trailing ${rows.length} month${rows.length === 1 ? '' : 's'} · ${fromStr} → ${toStr}`,
    asOfDate: new Date(),
    filtersApplied: [{ label: 'Period', value: `${fromStr} → ${toStr}` }],
    kpis: [
      { label: 'Current DSO',     value: latest.dso,           fmt: 'number', tone: latest.dso < 45 ? 'good' : latest.dso < 75 ? 'neutral' : 'bad' },
      { label: `${rows.length}-mo avg`, value: avgDso,         fmt: 'number' },
      { label: 'Best month',      value: best ? `${best.dso}d (${best.month})` : '—', fmt: 'string' },
      { label: 'Current collection rate', value: latest.collectionRate, fmt: 'percent' }
    ],
    charts: [
      {
        type:  'line',
        title: 'DSO over time (days)',
        data:  rows.map(r => ({ name: r.month, value: r.dso }))
      }
    ],
    columns: [
      { key: 'month',          label: 'Month',           type: 'string' },
      { key: 'revenue',        label: 'Revenue',         type: 'currency' },
      { key: 'arEnd',          label: 'AR (period end)', type: 'currency' },
      { key: 'dso',            label: 'DSO (days)',      type: 'number' },
      { key: 'collected',      label: 'Collected',       type: 'currency' },
      { key: 'collectionRate', label: 'Collection rate', type: 'percent' }
    ],
    rows,
    totals: null,
    extras: {
      methodology: 'DSO = (AR at month-end / Revenue in month) × days-in-month. AR snapshot is current balance for invoices created on/before month-end (does not back-out post-period payments).'
    }
  }));
}));
// ─────────────────────────────────────────────────────────────────────────
// F3 · Cash Collections — daily inflows by payment method.
//
// Daily breakdown of what actually hit the bank, sliced by method (cash,
// cheque, bank xfer, mobile money, card). Lets the treasurer see
// channel-mix shifts and weekly cadence (Friday spike, end-of-month
// surge, etc.).
// ─────────────────────────────────────────────────────────────────────────
router.get('/cash-collections', catchAsync(async (req, res) => {
  const { from, to } = parseDateRange(req.query);
  const { method, currency, bank } = req.query;

  // PAYMENT_DATE is VARCHAR2(20) ISO-string (not DATE). SUBSTR ensures
  // the comparison works whether stored as YYYY-MM-DD or full timestamp.
  const conditions = [
    "p.STATUS != 'REVERSED'",
    "SUBSTR(p.PAYMENT_DATE, 1, 10) >= :pFrom",
    "SUBSTR(p.PAYMENT_DATE, 1, 10) <= :pTo"
  ];
  const binds = { pFrom: isoDay(from), pTo: isoDay(to) };

  if (method)   { conditions.push("UPPER(p.PAYMENT_METHOD) = UPPER(:meth)"); binds.meth = method; }
  if (currency) { conditions.push("UPPER(p.CURRENCY) = UPPER(:curr)");       binds.curr = currency; }
  if (bank)     { conditions.push("UPPER(p.BANK_NAME) = UPPER(:bnk)");       binds.bnk  = bank; }

  const sql = `
    SELECT
      p.PAYMENT_ID,
      p.INVOICE_ID,
      p.AMOUNT,
      p.PAYMENT_DATE,
      p.PAYMENT_METHOD,
      p.REFERENCE_NUMBER,
      p.RECEIPT_NUMBER,
      p.WHT_TOTAL,
      p.BANK_NAME,
      p.CHEQUE_NUMBER,
      i.APPROVED_INVOICE_ID,
      i.CUSTOMER_ID,
      i.CUSTOMER_NAME
    FROM QA_INVOICE_PAYMENTS p
    LEFT JOIN QA_INVOICES i ON i.INVOICE_ID = p.INVOICE_ID
    WHERE ${conditions.join(' AND ')}
    ORDER BY p.PAYMENT_DATE DESC, p.PAYMENT_ID DESC`;

  const r = await execute(sql, binds);
  const raw = r.rows || [];

  let totalCash  = 0;
  let totalWht   = 0;
  const byMethod = {};
  const byDay    = {};

  const rows = raw.map(p => {
    const amt   = n(p.AMOUNT);
    const wht   = n(p.WHT_TOTAL);
    const dt    = p.PAYMENT_DATE instanceof Date ? p.PAYMENT_DATE : new Date(p.PAYMENT_DATE);
    const day   = isoDay(dt) || '';
    const meth  = (p.PAYMENT_METHOD || 'Other').toString();

    totalCash += amt;
    totalWht  += wht;

    byMethod[meth] = (byMethod[meth] || 0) + amt;
    byDay[day]     = (byDay[day]     || 0) + amt;

    return {
      paymentId:     p.PAYMENT_ID,
      receiptNumber: p.RECEIPT_NUMBER || `RCPT-${p.PAYMENT_ID}`,
      paymentDate:   day,
      invoiceId:     p.INVOICE_ID,
      invoiceNumber: p.APPROVED_INVOICE_ID || p.INVOICE_ID,
      customerId:    p.CUSTOMER_ID,
      customerName:  p.CUSTOMER_NAME || '—',
      method:        meth,
      amount:        amt,
      wht,
      reference:     p.REFERENCE_NUMBER || p.CHEQUE_NUMBER || '',
      bank:          p.BANK_NAME || ''
    };
  });

  const totalReceipts = rows.length;
  const avgTicket = totalReceipts > 0 ? n(totalCash / totalReceipts) : 0;
  const whtRate   = totalCash > 0 ? n((totalWht / (totalCash + totalWht)) * 100, 1) : 0;

  // Method chart — sorted by amount desc
  const methodChart = Object.entries(byMethod)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value: n(value) }));

  // Daily inflow chart — sorted by date asc, gaps not filled (chart
  // tolerates sparse data; filling would inflate the array uselessly)
  const dayChart = Object.entries(byDay)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, value]) => ({ name, value: n(value) }));

  const filtersApplied = [
    { label: 'Period', value: `${isoDay(from)} → ${isoDay(to)}` }
  ];
  if (method)   filtersApplied.push({ label: 'Method',   value: method });
  if (currency) filtersApplied.push({ label: 'Currency', value: currency });
  if (bank)     filtersApplied.push({ label: 'Bank',     value: bank });

  res.json(envelope({
    title:    'Cash Collections',
    subtitle: `${isoDay(from)} → ${isoDay(to)} · ${totalReceipts} receipt${totalReceipts === 1 ? '' : 's'}`,
    asOfDate: new Date(),
    filtersApplied,
    kpis: [
      { label: 'Net cash in',    value: n(totalCash),  fmt: 'currency' },
      { label: 'WHT withheld',   value: n(totalWht),   fmt: 'currency' },
      { label: 'Effective WHT %',value: whtRate,       fmt: 'percent' },
      { label: 'Avg ticket',     value: avgTicket,     fmt: 'currency' }
    ],
    charts: [
      { type: 'bar',  title: 'By payment method', data: methodChart },
      { type: 'line', title: 'Daily inflow',      data: dayChart }
    ],
    columns: [
      { key: 'paymentDate',   label: 'Date',     type: 'string' },
      { key: 'receiptNumber', label: 'Receipt',  type: 'string' },
      { key: 'customerName',  label: 'Customer', type: 'string', drillPage: 'customerStatement', drillKey: 'customerId' },
      { key: 'invoiceNumber', label: 'Invoice',  type: 'string', drillPage: 'invoiceEditor',     drillKey: 'invoiceId' },
      { key: 'method',        label: 'Method',   type: 'string' },
      { key: 'reference',     label: 'Reference',type: 'string' },
      { key: 'amount',        label: 'Net',      type: 'currency' },
      { key: 'wht',           label: 'WHT',      type: 'currency' }
    ],
    rows,
    totals: { amount: n(totalCash), wht: n(totalWht) }
  }));
}));
// ─────────────────────────────────────────────────────────────────────────
// F4 · Sales Register — audit-grade revenue recognition register.
//
// One row per recognised invoice in the period, with the full tax
// breakdown laid out so an auditor can tie back to the GL. Status
// filter is strict (Customer Accepted / Paid / Partially Paid only) —
// pending/draft/rejected invoices are NOT revenue.
//
// Lesson stack:
//   F1 — date math in JS; INVOICE_DATE is VARCHAR2
//   F5 — TAX_BREAKDOWN is CLOB JSON; parse via safeJsonArray
//   F1 — strict bind/SQL sync; only bind values used by the SQL
// ─────────────────────────────────────────────────────────────────────────
router.get('/sales-register', catchAsync(async (req, res) => {
  const { from, to } = parseDateRange(req.query);
  const { salesperson, customerId } = req.query;

  // ISO date strings for VARCHAR2 INVOICE_DATE lexical comparison.
  // Works because YYYY-MM-DD sorts identically as string and date.
  const fromStr = isoDay(from);
  const toStr   = isoDay(to);

  const conditions = [
    // Revenue recognition: customer-accepted invoices and beyond
    "i.STATUS IN ('Customer Accepted','Paid','Partially Paid')",
    "i.INVOICE_DATE >= :fromd",
    "i.INVOICE_DATE <= :tod"
  ];
  const binds = { fromd: fromStr, tod: toStr };

  if (salesperson) { conditions.push("LOWER(i.SALESPERSON_ID) = LOWER(:sp)"); binds.sp = salesperson; }
  if (customerId)  { conditions.push("i.CUSTOMER_ID = :cust");                binds.cust = customerId; }

  const sql = `
    SELECT
      i.INVOICE_ID,
      i.APPROVED_INVOICE_ID,
      i.CUSTOMER_ID,
      i.CUSTOMER_NAME,
      i.INVOICE_DATE,
      i.SALESPERSON_ID,
      i.SUBTOTAL,
      i.TAXES,
      i.TOTAL,
      i.STATUS,
      i.TAX_BREAKDOWN,
      c.TIN,
      c.INDUSTRY
    FROM QA_INVOICES i
    LEFT JOIN QA_CUSTOMERS c ON c.CUSTOMER_ID = i.CUSTOMER_ID
    WHERE ${conditions.join(' AND ')}
    ORDER BY i.INVOICE_DATE, i.INVOICE_ID`;

  const r = await execute(sql, binds);
  const raw = r.rows || [];

  // Accumulators
  let totalSubtotal = 0;
  let totalTaxes    = 0;
  let totalGross    = 0;
  const boxTotals = { VAT: 0, NHIL: 0, GETFUND: 0, COVID: 0, OTHER: 0 };
  const repTotals = {}; // SALESPERSON_ID -> revenue
  const distinctReps = new Set();

  const rows = raw.map(row => {
    const breakdown = safeJsonArray(row.TAX_BREAKDOWN);
    const perInvBoxes = { VAT: 0, NHIL: 0, GETFUND: 0, COVID: 0, OTHER: 0 };
    for (const line of breakdown) {
      const box = graBoxFor(line.label || line.name || '');
      const amt = Number(line.amount || 0);
      perInvBoxes[box] = (perInvBoxes[box] || 0) + amt;
      boxTotals[box]   = (boxTotals[box]   || 0) + amt;
    }

    const subtotal = n(row.SUBTOTAL);
    const taxes    = n(row.TAXES);
    const total    = n(row.TOTAL);
    totalSubtotal += subtotal;
    totalTaxes    += taxes;
    totalGross    += total;

    const rep = row.SALESPERSON_ID || '—';
    repTotals[rep] = (repTotals[rep] || 0) + subtotal;
    distinctReps.add(rep);

    return {
      invoiceId:     row.INVOICE_ID,
      invoiceNumber: row.APPROVED_INVOICE_ID || row.INVOICE_ID,
      invoiceDate:   row.INVOICE_DATE,
      customerName:  row.CUSTOMER_NAME || '—',
      customerId:    row.CUSTOMER_ID,
      tin:           row.TIN || '',
      industry:      row.INDUSTRY || '—',
      salesperson:   rep,
      subtotal,
      nhil:          n(perInvBoxes.NHIL),
      getfund:       n(perInvBoxes.GETFUND),
      covid:         n(perInvBoxes.COVID),
      vat:           n(perInvBoxes.VAT),
      total,
      status:        row.STATUS
    };
  });

  // Top-5 salesperson revenue for the chart, rest collapsed into "Other"
  const repArr = Object.entries(repTotals).sort((a, b) => b[1] - a[1]);
  const top5   = repArr.slice(0, 5).map(([name, value]) => ({ name, value: n(value) }));
  const rest   = repArr.slice(5).reduce((acc, [, v]) => acc + v, 0);
  if (rest > 0) top5.push({ name: `Other (${repArr.length - 5})`, value: n(rest) });

  const filtersApplied = [
    { label: 'Period', value: `${fromStr} → ${toStr}` }
  ];
  if (salesperson) filtersApplied.push({ label: 'Salesperson', value: salesperson });
  if (customerId)  filtersApplied.push({ label: 'Customer',    value: customerId });

  res.json(envelope({
    title:    'Sales Register',
    subtitle: `Period ${fromStr} → ${toStr} · ${rows.length} recognised invoice${rows.length === 1 ? '' : 's'}`,
    asOfDate: new Date(),
    filtersApplied,
    kpis: [
      { label: 'Net revenue',     value: n(totalSubtotal), fmt: 'currency' },
      { label: 'Total VAT',       value: n(boxTotals.VAT), fmt: 'currency' },
      { label: 'NHIL + GET + COV',value: n(boxTotals.NHIL + boxTotals.GETFUND + boxTotals.COVID), fmt: 'currency' },
      { label: 'Invoices',        value: rows.length,      fmt: 'number' }
    ],
    charts: [
      {
        type:  'bar',
        title: 'Revenue by salesperson (top 5)',
        data:  top5
      }
    ],
    columns: [
      { key: 'invoiceNumber', label: 'Invoice',     type: 'string',   drillPage: 'invoiceEditor', drillKey: 'invoiceId' },
      { key: 'invoiceDate',   label: 'Date',        type: 'string' },
      { key: 'customerName',  label: 'Customer',    type: 'string' },
      { key: 'tin',           label: 'TIN',         type: 'string' },
      { key: 'salesperson',   label: 'Salesperson', type: 'string' },
      { key: 'subtotal',      label: 'Net',         type: 'currency' },
      { key: 'nhil',          label: 'NHIL',        type: 'currency' },
      { key: 'getfund',       label: 'GETFund',     type: 'currency' },
      { key: 'covid',         label: 'COVID',       type: 'currency' },
      { key: 'vat',           label: 'VAT',         type: 'currency' },
      { key: 'total',         label: 'Gross',       type: 'currency' }
    ],
    rows,
    totals: {
      subtotal: n(totalSubtotal),
      nhil:     n(boxTotals.NHIL),
      getfund:  n(boxTotals.GETFUND),
      covid:    n(boxTotals.COVID),
      vat:      n(boxTotals.VAT),
      total:    n(totalGross)
    }
  }));
}));
// ─────────────────────────────────────────────────────────────────────────
// F5 · VAT Compliance (Ghana GRA)
//
// Aggregates the tax lines on every recognised invoice within a month
// so the tax manager can paste totals straight into the GRA portal.
// Surfaces TIN-validation warnings so missing / malformed taxpayer
// IDs get caught BEFORE the filing fails on the GRA side.
//
// Lesson from F1: INVOICE_DATE is VARCHAR2(20) ISO-string, so we
// filter by string prefix (LIKE 'YYYY-MM%') — no SQL date arithmetic.
// Lesson from F1: TAX_BREAKDOWN is a CLOB JSON; parse in JS, not SQL.
// ─────────────────────────────────────────────────────────────────────────

// graBoxFor lives in _shared.js (reused by F4 Sales Register too).

// TIN validation — Ghana TINs are 11 chars: "C" or "P" or "G" + 10 digits
// (legacy) or 15 chars (GhanaCard-based). Accept either; flag empty
// or short/non-conforming values as warnings.
function validateTin(tin) {
  const t = String(tin || '').trim().toUpperCase();
  if (!t)                              return { ok: false, reason: 'TIN missing — GRA will reject row' };
  if (t.length < 10)                   return { ok: false, reason: `TIN too short (${t.length} chars)` };
  if (!/^[A-Z0-9-]+$/.test(t))         return { ok: false, reason: 'TIN contains unexpected characters' };
  return { ok: true };
}

router.get('/vat-compliance', catchAsync(async (req, res) => {
  // Default to current month YYYY-MM. Accept explicit `month` (YYYY-MM)
  // or `from`/`to` for an arbitrary range.
  const today = new Date();
  const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const month = (req.query.month && /^\d{4}-\d{2}$/.test(req.query.month)) ? req.query.month : defaultMonth;

  // String-prefix match on INVOICE_DATE — works for ISO YYYY-MM-DD or
  // datetime strings since both start with YYYY-MM. Avoids the
  // ORA-00932 trap from doing TO_DATE on a free-form VARCHAR2.
  const sql = `
    SELECT
      i.INVOICE_ID,
      i.APPROVED_INVOICE_ID,
      i.CUSTOMER_ID,
      i.CUSTOMER_NAME,
      i.INVOICE_DATE,
      i.SUBTOTAL,
      i.TAXES,
      i.TOTAL,
      i.STATUS,
      i.TAX_BREAKDOWN,
      c.TIN
    FROM QA_INVOICES i
    LEFT JOIN QA_CUSTOMERS c ON c.CUSTOMER_ID = i.CUSTOMER_ID
    WHERE i.STATUS NOT IN ('Draft','Rejected','Customer Rejected','Cancelled','Pending Pricing','Pending Approval')
      AND i.INVOICE_DATE LIKE :pfx
    ORDER BY i.INVOICE_DATE`;

  const r = await execute(sql, { pfx: `${month}%` });
  const raw = r.rows || [];

  // Parse the breakdown CLOB once per row; aggregate at the same time.
  const boxTotals = { VAT: 0, NHIL: 0, GETFUND: 0, COVID: 0, OTHER: 0 };
  let totalSubtotal = 0;
  let totalTaxes    = 0;
  let totalGross    = 0;
  const warnings = [];

  const rows = raw.map(row => {
    // CLOB → string → JSON (already fetched as string by db.js fetchTypeMap)
    let breakdown = [];
    if (row.TAX_BREAKDOWN) {
      try {
        breakdown = JSON.parse(row.TAX_BREAKDOWN);
        if (!Array.isArray(breakdown)) breakdown = [];
      } catch (_e) { breakdown = []; }
    }

    // Per-line GRA-box accumulator for the detail row
    const perInvBoxes = { VAT: 0, NHIL: 0, GETFUND: 0, COVID: 0, OTHER: 0 };
    for (const line of breakdown) {
      const box  = graBoxFor(line.label || line.name || '');
      const amt  = Number(line.amount || 0);
      perInvBoxes[box] = (perInvBoxes[box] || 0) + amt;
      boxTotals[box]   = (boxTotals[box]   || 0) + amt;
    }

    const subtotal = n(row.SUBTOTAL);
    const taxes    = n(row.TAXES);
    const total    = n(row.TOTAL);
    totalSubtotal += subtotal;
    totalTaxes    += taxes;
    totalGross    += total;

    // TIN validation collected here for the warnings strip
    const tinCheck = validateTin(row.TIN);
    if (!tinCheck.ok) {
      warnings.push({
        invoiceId:     row.INVOICE_ID,
        invoiceNumber: row.APPROVED_INVOICE_ID || row.INVOICE_ID,
        customerName:  row.CUSTOMER_NAME || '—',
        issue:         tinCheck.reason
      });
    }

    return {
      invoiceId:     row.INVOICE_ID,
      invoiceNumber: row.APPROVED_INVOICE_ID || row.INVOICE_ID,
      customerName:  row.CUSTOMER_NAME || '—',
      tin:           row.TIN || '',
      invoiceDate:   row.INVOICE_DATE,
      subtotal,
      vat:           n(perInvBoxes.VAT),
      nhil:          n(perInvBoxes.NHIL),
      getfund:       n(perInvBoxes.GETFUND),
      covid:         n(perInvBoxes.COVID),
      otherTax:      n(perInvBoxes.OTHER),
      total
    };
  });

  // GRA filing summary — boxes 010/040/050/060/070/080
  const filingSummary = [
    { box: '010', label: 'Standard-rated sales (excl. VAT)', amount: n(totalSubtotal) },
    { box: '020', label: 'Zero-rated sales',                 amount: 0 },
    { box: '030', label: 'Exempt sales',                     amount: 0 },
    { box: '040', label: 'Output VAT (15%)',                 amount: n(boxTotals.VAT) },
    { box: '050', label: 'NHIL (2.5%)',                      amount: n(boxTotals.NHIL) },
    { box: '060', label: 'GETFund Levy (2.5%)',              amount: n(boxTotals.GETFUND) },
    { box: '070', label: 'COVID-19 Health Levy (1%)',        amount: n(boxTotals.COVID) },
    { box: '',    label: 'Other levies',                     amount: n(boxTotals.OTHER) },
    { box: '080', label: 'Total taxes payable',              amount: n(totalTaxes) }
  ];

  res.json(envelope({
    title:    'VAT Compliance',
    subtitle: `Filing period ${month} · ${rows.length} recognised invoice${rows.length === 1 ? '' : 's'}`,
    asOfDate: today,
    filtersApplied: [{ label: 'Month', value: month }],
    kpis: [
      { label: 'Taxable sales',  value: n(totalSubtotal),   fmt: 'currency' },
      { label: 'Output VAT',     value: n(boxTotals.VAT),   fmt: 'currency' },
      { label: 'Total levies',   value: n(boxTotals.NHIL + boxTotals.GETFUND + boxTotals.COVID + boxTotals.OTHER), fmt: 'currency' },
      { label: 'TIN warnings',   value: warnings.length, fmt: 'number', tone: warnings.length > 0 ? 'bad' : 'good' }
    ],
    charts: [
      {
        type:  'bar',
        title: 'Tax mix (GHS)',
        data: [
          { name: 'VAT 15%',       value: n(boxTotals.VAT) },
          { name: 'NHIL 2.5%',     value: n(boxTotals.NHIL) },
          { name: 'GETFund 2.5%',  value: n(boxTotals.GETFUND) },
          { name: 'COVID 1%',      value: n(boxTotals.COVID) },
          { name: 'Other',         value: n(boxTotals.OTHER) }
        ]
      }
    ],
    columns: [
      { key: 'invoiceNumber', label: 'Invoice',   type: 'string',   drillPage: 'invoiceEditor', drillKey: 'invoiceId' },
      { key: 'invoiceDate',   label: 'Date',      type: 'string' },
      { key: 'customerName',  label: 'Customer',  type: 'string' },
      { key: 'tin',           label: 'TIN',       type: 'string' },
      { key: 'subtotal',      label: 'Net',       type: 'currency' },
      { key: 'nhil',          label: 'NHIL',      type: 'currency' },
      { key: 'getfund',       label: 'GETFund',   type: 'currency' },
      { key: 'covid',         label: 'COVID',     type: 'currency' },
      { key: 'vat',           label: 'VAT',       type: 'currency' },
      { key: 'total',         label: 'Gross',     type: 'currency' }
    ],
    rows,
    totals: {
      subtotal: n(totalSubtotal),
      nhil:     n(boxTotals.NHIL),
      getfund:  n(boxTotals.GETFUND),
      covid:    n(boxTotals.COVID),
      vat:      n(boxTotals.VAT),
      total:    n(totalGross)
    },
    // Stash GRA filing summary + warnings as report-specific extras
    // (the frontend renders them outside the standard table layout)
    extras: {
      filingSummary,
      warnings
    }
  }));
}));
// ─────────────────────────────────────────────────────────────────────────
// F6 · Withholding Tax Collected — Ghana WHT filing aid.
//
// Every payment row with WHT_TOTAL > 0 contributes. Breakdown CLOB is
// JSON of `[{ code, rate, amount }]` — code is one of VAT_WHT,
// SERVICE_WHT, GOODS_WHT, RENT_WHT (extensible via QA_WHT_TYPES config).
// LEFT JOIN QA_WHT_CERTIFICATES so missing-cert rows still appear (just
// without a CERT_NUMBER).
//
// Lessons banked: PAYMENT_DATE is a real DATE column → safe to compare
// directly with bind dates. INVOICE_DATE on the joined invoice would
// not be — but we don't filter by it here.
// ─────────────────────────────────────────────────────────────────────────
router.get('/wht-collected', catchAsync(async (req, res) => {
  const { from, to } = parseDateRange(req.query);
  const { whtType, certStatus } = req.query;

  // PAYMENT_DATE is VARCHAR2(20) ISO-string (not DATE). SUBSTR ensures
  // the comparison works whether stored as YYYY-MM-DD or full timestamp.
  const conditions = [
    "p.WHT_TOTAL > 0",
    "p.STATUS != 'REVERSED'",
    "SUBSTR(p.PAYMENT_DATE, 1, 10) >= :fromd",
    "SUBSTR(p.PAYMENT_DATE, 1, 10) <= :tod"
  ];
  const binds = { fromd: isoDay(from), tod: isoDay(to) };

  // certStatus filter — applied AFTER the LEFT JOIN on certificates
  // via a HAVING-style check below in JS (cleaner than SQL when the
  // join is LEFT and we need IS NULL semantics).

  const sql = `
    SELECT
      p.PAYMENT_ID,
      p.INVOICE_ID,
      p.AMOUNT,
      p.PAYMENT_DATE,
      p.PAYMENT_METHOD,
      p.WHT_TOTAL,
      p.WHT_BREAKDOWN,
      p.RECEIPT_NUMBER,
      i.APPROVED_INVOICE_ID,
      i.CUSTOMER_ID,
      i.CUSTOMER_NAME,
      c.TIN,
      cert.CERT_NUMBER,
      cert.CERT_DATE
    FROM QA_INVOICE_PAYMENTS p
    LEFT JOIN QA_INVOICES   i    ON i.INVOICE_ID  = p.INVOICE_ID
    LEFT JOIN QA_CUSTOMERS  c    ON c.CUSTOMER_ID = i.CUSTOMER_ID
    LEFT JOIN QA_WHT_CERTIFICATES cert ON cert.PAYMENT_ID = p.PAYMENT_ID
    WHERE ${conditions.join(' AND ')}
    ORDER BY p.PAYMENT_DATE DESC, p.PAYMENT_ID DESC`;

  const r = await execute(sql, binds);
  const raw = r.rows || [];

  // Each payment can carry multiple WHT lines (e.g. VAT_WHT 7% + SERVICE_WHT 7.5%
  // on the same receipt). Expand to one row per (payment, wht-line) so
  // by-type aggregation is straightforward AND each line shows in the table.
  const rows = [];
  const typeTotals = {};   // wht code -> { amount, count }
  let totalWht        = 0;
  let netCashOnRows   = 0;
  let certPresent     = 0;
  let certMissing     = 0;

  for (const p of raw) {
    const breakdown = safeJsonArray(p.WHT_BREAKDOWN);
    const hasCert = !!p.CERT_NUMBER;
    if (hasCert) certPresent++; else certMissing++;

    netCashOnRows += n(p.AMOUNT);

    // If the breakdown is empty but WHT_TOTAL > 0, fall back to a single
    // "Unspecified" row so the data still shows up. Better to surface
    // the missing-detail than to silently drop revenue.
    const lines = breakdown.length > 0
      ? breakdown
      : [{ code: 'UNSPECIFIED', rate: null, amount: Number(p.WHT_TOTAL) }];

    for (const line of lines) {
      const code = String(line.code || 'UNSPECIFIED').toUpperCase();
      const amt  = n(line.amount);

      // whtType filter applied at row level (post-explode)
      if (whtType && code !== String(whtType).toUpperCase()) continue;
      // certStatus filter applied at row level (one row inherits cert
      // status from its parent payment)
      if (certStatus === 'missing' && hasCert) continue;
      if (certStatus === 'present' && !hasCert) continue;

      typeTotals[code] = typeTotals[code] || { amount: 0, count: 0 };
      typeTotals[code].amount += amt;
      typeTotals[code].count  += 1;
      totalWht += amt;

      rows.push({
        paymentId:     p.PAYMENT_ID,
        receiptNumber: p.RECEIPT_NUMBER || `RCPT-${p.PAYMENT_ID}`,
        paymentDate:   p.PAYMENT_DATE ? isoDay(p.PAYMENT_DATE) : '',
        invoiceId:     p.INVOICE_ID,
        invoiceNumber: p.APPROVED_INVOICE_ID || p.INVOICE_ID,
        customerId:    p.CUSTOMER_ID,
        customerName:  p.CUSTOMER_NAME || '—',
        tin:           p.TIN || '',
        whtCode:       code,
        whtRate:       line.rate != null ? Number(line.rate) : null,
        amount:        amt,
        netCashOnInv:  n(p.AMOUNT),
        certNumber:    p.CERT_NUMBER || '',
        certDate:      p.CERT_DATE ? isoDay(p.CERT_DATE) : '',
        certPresent:   hasCert
      });
    }
  }

  const totalPayments = raw.length;
  const certPct = totalPayments > 0 ? n((certPresent / totalPayments) * 100, 1) : 0;

  // WHT-by-type chart data
  const byTypeChart = Object.entries(typeTotals)
    .sort((a, b) => b[1].amount - a[1].amount)
    .map(([code, info]) => ({
      name: `${code} (${info.count})`,
      value: n(info.amount)
    }));

  const filtersApplied = [
    { label: 'Period', value: `${isoDay(from)} → ${isoDay(to)}` }
  ];
  if (whtType)    filtersApplied.push({ label: 'WHT type',    value: whtType });
  if (certStatus) filtersApplied.push({ label: 'Cert status', value: certStatus });

  res.json(envelope({
    title:    'Withholding Tax Collected',
    subtitle: `${isoDay(from)} → ${isoDay(to)} · ${totalPayments} payment${totalPayments === 1 ? '' : 's'} carrying WHT`,
    asOfDate: new Date(),
    filtersApplied,
    kpis: [
      { label: 'Total WHT',             value: n(totalWht),  fmt: 'currency' },
      { label: `Certs collected`,       value: `${certPresent} / ${totalPayments}`, fmt: 'string' },
      { label: `Cert collection rate`,  value: certPct,      fmt: 'percent', tone: certPct >= 80 ? 'good' : certPct >= 50 ? 'neutral' : 'bad' },
      { label: 'Missing certificates',  value: certMissing,  fmt: 'number',  tone: certMissing > 0 ? 'bad' : 'good' }
    ],
    charts: [
      {
        type:  'bar',
        title: 'WHT by type',
        data:  byTypeChart
      }
    ],
    columns: [
      { key: 'paymentDate',   label: 'Date',         type: 'string' },
      { key: 'receiptNumber', label: 'Receipt',      type: 'string' },
      { key: 'customerName',  label: 'Customer',     type: 'string', drillPage: 'customerStatement', drillKey: 'customerId' },
      { key: 'invoiceNumber', label: 'Invoice',      type: 'string', drillPage: 'invoiceEditor',     drillKey: 'invoiceId' },
      { key: 'whtCode',       label: 'WHT type',     type: 'string' },
      { key: 'whtRate',       label: 'Rate %',       type: 'percent' },
      { key: 'amount',        label: 'WHT amount',   type: 'currency' },
      { key: 'certNumber',    label: 'Certificate#', type: 'string' }
    ],
    rows,
    totals: { amount: n(totalWht) }
  }));
}));
// ─────────────────────────────────────────────────────────────────────────
// F7 · Customer Profitability (Pareto)
//
// Per-customer YTD rollup: revenue, gross margin, outstanding AR, and
// a "danger" flag for customers who are big AND slow. Drives the
// classic 80/20 view + identifies which top accounts deserve a credit
// review.
//
// Cost source: QA_INVENTORY.UNIT_COST (joined by SKU). Lines whose
// SKU doesn't match (custom/sourced items) contribute revenue but not
// to margin calc — flagged in the methodology note.
// ─────────────────────────────────────────────────────────────────────────
router.get('/customer-profitability', catchAsync(async (req, res) => {
  const year = String(req.query.year || new Date().getFullYear());
  const minRevenue = Number(req.query.minRevenue) || 0;

  // ── 1. Recognised invoice line items in the year, with cost-from-SKU ──
  // LEFT JOIN to inventory so unmatched SKUs still contribute revenue
  // (just with cost = 0, which becomes a 100%-margin row — we flag
  // those separately so margin numbers don't lie).
  const sql = `
    SELECT
      i.CUSTOMER_ID,
      i.CUSTOMER_NAME,
      c.INDUSTRY,
      c.SIZE_BAND,
      li.SKU,
      li.QUANTITY,
      li.UNIT_PRICE,
      li.LINE_TOTAL,
      inv.UNIT_COST,
      i.INVOICE_ID,
      i.INVOICE_DATE,
      i.BALANCE_DUE,
      i.STATUS
    FROM QA_INVOICES i
    JOIN QA_INVOICE_LINE_ITEMS li ON li.INVOICE_ID = i.INVOICE_ID
    LEFT JOIN QA_CUSTOMERS c ON c.CUSTOMER_ID = i.CUSTOMER_ID
    LEFT JOIN QA_INVENTORY inv ON inv.SKU = li.SKU
    WHERE i.STATUS IN ('Customer Accepted','Paid','Partially Paid')
      AND i.INVOICE_DATE LIKE :ypfx`;

  const r = await execute(sql, { ypfx: `${year}%` });
  const lines = r.rows || [];

  // ── 2. Rollup by customer ──
  const byCust = {};
  for (const line of lines) {
    const cid = line.CUSTOMER_ID;
    if (!cid) continue;
    if (!byCust[cid]) {
      byCust[cid] = {
        customerId:    cid,
        customerName:  line.CUSTOMER_NAME || '—',
        industry:      line.INDUSTRY || '—',
        sizeBand:      line.SIZE_BAND || '—',
        revenue:       0,
        costMatched:   0,
        revMatched:    0,
        balanceDue:    0,
        invoiceIds:    new Set(),
        oldestOpenDays: 0
      };
    }
    const c = byCust[cid];
    const lt   = n(line.LINE_TOTAL);
    const qty  = n(line.QUANTITY);
    const cost = line.UNIT_COST != null ? n(line.UNIT_COST) * qty : null;

    c.revenue += lt;
    if (cost != null && cost > 0) {
      c.costMatched += cost;
      c.revMatched  += lt;
    }
    c.invoiceIds.add(line.INVOICE_ID);
  }

  // ── 3. Open AR per customer (snapshot — sum current BALANCE_DUE) ──
  // Run as a second pass over lines (we have BALANCE_DUE on every
  // line copy) but dedupe by invoice — BALANCE_DUE is per-invoice not
  // per-line. Use a Set to track which invoices we've already counted.
  const arSeen = {};
  const today = new Date();
  for (const line of lines) {
    const cid = line.CUSTOMER_ID;
    if (!cid) continue;
    if (!arSeen[cid]) arSeen[cid] = new Set();
    if (arSeen[cid].has(line.INVOICE_ID)) continue;
    arSeen[cid].add(line.INVOICE_ID);

    const bd = n(line.BALANCE_DUE);
    if (bd > 0 && byCust[cid]) {
      byCust[cid].balanceDue += bd;
      // Oldest-overdue tracking
      const dStr = line.INVOICE_DATE || '';
      const d = new Date(dStr);
      if (!Number.isNaN(d.getTime())) {
        const days = Math.floor((today - d) / (24 * 60 * 60 * 1000));
        if (days > byCust[cid].oldestOpenDays) byCust[cid].oldestOpenDays = days;
      }
    }
  }

  // ── 4. Compute margin + danger flag + filter ──
  const rows = Object.values(byCust)
    .filter(c => c.revenue >= minRevenue)
    .map(c => {
      const grossMargin = c.revMatched > 0 ? (c.revMatched - c.costMatched) : 0;
      const marginPct   = c.revMatched > 0 ? n((grossMargin / c.revMatched) * 100, 1) : 0;
      // "Danger" = big customer (top-quartile revenue) AND slow pay
      // (oldest open > 60 days). We can't know top-quartile yet; flag
      // by absolute threshold (oldest open > 60d AND balanceDue > 0).
      const isDanger = c.balanceDue > 0 && c.oldestOpenDays > 60;
      return {
        customerId:    c.customerId,
        customerName:  c.customerName,
        industry:      c.industry,
        sizeBand:      c.sizeBand,
        revenue:       n(c.revenue),
        marginPct,
        balanceDue:    n(c.balanceDue),
        oldestOpenDays: c.oldestOpenDays,
        invoiceCount:  c.invoiceIds.size,
        isDanger
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  // ── 5. Pareto curve (cumulative %) ──
  const totalRev = rows.reduce((acc, r) => acc + r.revenue, 0);
  let cum = 0;
  const pareto = rows.map((r, i) => {
    cum += r.revenue;
    return {
      name:   `${i + 1}`,
      value:  totalRev > 0 ? n((cum / totalRev) * 100, 1) : 0
    };
  });

  // Top-20% revenue share
  const top20Count = Math.max(1, Math.ceil(rows.length * 0.20));
  const top20Rev   = rows.slice(0, top20Count).reduce((acc, r) => acc + r.revenue, 0);
  const top20Pct   = totalRev > 0 ? n((top20Rev / totalRev) * 100, 1) : 0;

  // Avg margin (revenue-weighted across matched-cost rows)
  const matchedRevTotal = rows.reduce((acc, r) => acc + (r.marginPct > 0 ? r.revenue : 0), 0);
  const weightedMargin  = matchedRevTotal > 0
    ? rows.reduce((acc, r) => acc + (r.marginPct * r.revenue), 0) / rows.reduce((acc, r) => acc + r.revenue, 1)
    : 0;

  const dangerCount = rows.filter(r => r.isDanger).length;

  res.json(envelope({
    title:    'Customer Profitability',
    subtitle: `YTD ${year} · ${rows.length} customer${rows.length === 1 ? '' : 's'} with recognised revenue`,
    asOfDate: new Date(),
    filtersApplied: [
      { label: 'Year',         value: year },
      ...(minRevenue > 0 ? [{ label: 'Min revenue', value: `GHS ${minRevenue.toLocaleString()}` }] : [])
    ],
    kpis: [
      { label: 'YTD revenue',         value: n(totalRev),          fmt: 'currency' },
      { label: `Top 20% drive`,       value: top20Pct,             fmt: 'percent', tone: top20Pct > 80 ? 'neutral' : 'good' },
      { label: 'Avg margin (wt)',     value: n(weightedMargin, 1), fmt: 'percent' },
      { label: 'Dangerous accounts',  value: dangerCount,          fmt: 'number',  tone: dangerCount > 0 ? 'bad' : 'good' }
    ],
    charts: [
      {
        type:  'line',
        title: 'Pareto — cumulative revenue % by customer rank',
        data:  pareto
      }
    ],
    columns: [
      { key: 'customerName',  label: 'Customer',     type: 'string',   drillPage: 'customerStatement', drillKey: 'customerId' },
      { key: 'industry',      label: 'Industry',     type: 'string' },
      { key: 'sizeBand',      label: 'Size',         type: 'string' },
      { key: 'revenue',       label: 'YTD Revenue',  type: 'currency' },
      { key: 'marginPct',     label: 'Margin %',     type: 'percent' },
      { key: 'invoiceCount',  label: '# invoices',   type: 'number' },
      { key: 'oldestOpenDays',label: 'Oldest open',  type: 'number' },
      { key: 'balanceDue',    label: 'Outstanding',  type: 'currency' }
    ],
    rows,
    totals: { revenue: n(totalRev), balanceDue: n(rows.reduce((a, r) => a + r.balanceDue, 0)) },
    extras: {
      methodology: 'Margin computed only on line items whose SKU matches QA_INVENTORY (cost source). Custom/sourced items count toward revenue but not margin. "Dangerous" = open balance + oldest invoice >60 days old.'
    }
  }));
}));
// ─────────────────────────────────────────────────────────────────────────
// F8 · Bad-Debt Provision — age-based reserve recommendation.
//
// Applies the standard GAAP-ish schedule:
//   0-90 d     → 0 % provision
//   91-180 d   → 25 %
//   181-365 d  → 50 %
//   365+ d     → 100 % (write-off candidates)
// Days are counted from DUE_DATE (Module 1 column), with fall-back to
// INVOICE_DATE + 30 for legacy invoices missing DUE_DATE.
// ─────────────────────────────────────────────────────────────────────────
router.get('/bad-debt-provision', catchAsync(async (req, res) => {
  const { asOfDate } = parseDateRange(req.query);

  const sql = `
    SELECT
      i.INVOICE_ID,
      i.APPROVED_INVOICE_ID,
      i.CUSTOMER_ID,
      i.CUSTOMER_NAME,
      i.INVOICE_DATE,
      i.DUE_DATE,
      i.BALANCE_DUE,
      i.STATUS
    FROM QA_INVOICES i
    WHERE i.BALANCE_DUE > 0
      AND i.STATUS NOT IN ('Draft','Rejected','Customer Rejected','Cancelled','Paid')`;

  const r = await execute(sql);
  const raw = r.rows || [];

  const asofMs = asOfDate.getTime();
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  const resolveDue = (row) => {
    if (row.DUE_DATE) {
      const d = row.DUE_DATE instanceof Date ? row.DUE_DATE : new Date(row.DUE_DATE);
      if (!Number.isNaN(d.getTime())) return d;
    }
    if (row.INVOICE_DATE) {
      const d = new Date(row.INVOICE_DATE);
      if (!Number.isNaN(d.getTime())) {
        const d2 = new Date(d);
        d2.setDate(d2.getDate() + 30);
        return d2;
      }
    }
    return null;
  };

  // Apply schedule
  const schedule = [
    { key: '0-90',     min: 0,   max: 90,    rate: 0,    label: '0-90 days' },
    { key: '91-180',   min: 91,  max: 180,   rate: 0.25, label: '91-180 days' },
    { key: '181-365',  min: 181, max: 365,   rate: 0.50, label: '181-365 days' },
    { key: '365+',     min: 366, max: Infinity, rate: 1.00, label: '365+ days' }
  ];

  const bucketTotals = { '0-90': 0, '91-180': 0, '181-365': 0, '365+': 0 };
  const provisionByBucket = { '0-90': 0, '91-180': 0, '181-365': 0, '365+': 0 };
  let totalAr = 0;
  let totalProvision = 0;
  const writeOffs = [];

  for (const row of raw) {
    const due = resolveDue(row);
    const days = due ? Math.floor((asofMs - due.getTime()) / MS_PER_DAY) : 0;
    const bd = n(row.BALANCE_DUE);
    totalAr += bd;

    const band = schedule.find(s => days >= s.min && days <= s.max);
    if (!band) continue;
    bucketTotals[band.key]    += bd;
    provisionByBucket[band.key] += bd * band.rate;
    totalProvision             += bd * band.rate;

    if (band.key === '365+') {
      writeOffs.push({
        invoiceId:     row.INVOICE_ID,
        invoiceNumber: row.APPROVED_INVOICE_ID || row.INVOICE_ID,
        customerId:    row.CUSTOMER_ID,
        customerName:  row.CUSTOMER_NAME || '—',
        dueDate:       due ? isoDay(due) : '',
        daysOverdue:   days,
        balanceDue:    bd,
        provision:     n(bd) // 100%
      });
    }
  }

  // Sort write-offs oldest first
  writeOffs.sort((a, b) => b.daysOverdue - a.daysOverdue);

  const scheduleRows = schedule.map(s => ({
    bucket:    s.label,
    arBalance: n(bucketTotals[s.key]),
    rate:      s.rate * 100,
    provision: n(provisionByBucket[s.key])
  }));

  res.json(envelope({
    title:    'Bad-Debt Provision',
    subtitle: `As of ${isoDay(asOfDate)} · ${raw.length} open invoice${raw.length === 1 ? '' : 's'}`,
    asOfDate,
    filtersApplied: [{ label: 'As of', value: isoDay(asOfDate) }],
    kpis: [
      { label: 'Open AR',                value: n(totalAr),         fmt: 'currency' },
      { label: 'Recommended provision',  value: n(totalProvision),  fmt: 'currency', tone: 'bad' },
      { label: '% of AR',                value: totalAr > 0 ? n((totalProvision / totalAr) * 100, 1) : 0, fmt: 'percent' },
      { label: 'Write-off candidates',   value: writeOffs.length,   fmt: 'number',   tone: writeOffs.length > 0 ? 'bad' : 'good' }
    ],
    charts: [
      {
        type:  'bar',
        title: 'Provision by aging bucket (GHS)',
        data:  scheduleRows.map(s => ({ name: s.bucket, value: s.provision }))
      }
    ],
    columns: [
      { key: 'invoiceNumber', label: 'Invoice',       type: 'string',   drillPage: 'invoiceEditor', drillKey: 'invoiceId' },
      { key: 'customerName',  label: 'Customer',      type: 'string' },
      { key: 'dueDate',       label: 'Due date',      type: 'string' },
      { key: 'daysOverdue',   label: 'Days',          type: 'number' },
      { key: 'balanceDue',    label: 'Balance',       type: 'currency' },
      { key: 'provision',     label: 'Provision',     type: 'currency' }
    ],
    rows: writeOffs,
    totals: {
      balanceDue: n(writeOffs.reduce((a, r) => a + r.balanceDue, 0)),
      provision:  n(writeOffs.reduce((a, r) => a + r.provision, 0))
    },
    extras: {
      schedule:    scheduleRows,
      totalAr:     n(totalAr),
      totalProvision: n(totalProvision),
      methodology: 'Age-based GAAP schedule: 0-90d=0%, 91-180d=25%, 181-365d=50%, 365+d=100% (write-off candidates).'
    }
  }));
}));

module.exports = router;
