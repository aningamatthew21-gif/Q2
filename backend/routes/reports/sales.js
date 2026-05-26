'use strict';

/**
 * routes/reports/sales.js — Module 5 Phase 5.3
 *
 * Eight sales reports, all gated by `reports.run.sales`.
 *
 * Schema lesson stack (consolidated through Phases 5.1/5.2):
 *
 *   Date column types vary — DO NOT assume from suffix. Real lookups:
 *     QA_QUOTES.QUOTE_DATE             VARCHAR2(20)  ← string compare
 *     QA_QUOTES.EXPIRES_AT             VARCHAR2(50)  ← string compare (NOT a TIMESTAMP)
 *     QA_QUOTES.CREATED_AT / UPDATED_AT / AUDIT_COMPUTED_AT / CONVERSION_DATE  TIMESTAMP
 *     QA_INVOICES.INVOICE_DATE         VARCHAR2(20)  ← string compare
 *     QA_INVOICES.DUE_DATE             DATE          (Module 1)  ← bind JS Date
 *     QA_INVOICES.CREATED_AT / *_AT    TIMESTAMP    ← bind JS Date
 *     QA_INVOICE_PAYMENTS.PAYMENT_DATE VARCHAR2(20)  ← string compare
 *     QA_REVENUE_TARGETS.TARGET_YEAR   NUMBER(4,0)
 *     QA_REVENUE_TARGETS.TARGET_MONTH  VARCHAR2(2)  ← '01'..'12'
 */

const express = require('express');
const { execute } = require('../../db');
const { catchAsync } = require('../../middleware/errorHandler');
const { authMiddleware, requirePermission } = require('../../middleware/authMiddleware');
const { envelope, parseDateRange, n, safeJsonArray, isoDay } = require('./_shared');

const router = express.Router();
router.use(authMiddleware);
router.use(requirePermission('reports.run.sales'));

const MS_PER_DAY = 24 * 60 * 60 * 1000;
function daysBetween(a, b) {
  if (!a || !b) return 0;
  const da = a instanceof Date ? a : new Date(a);
  const db = b instanceof Date ? b : new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return 0;
  return Math.floor((db.getTime() - da.getTime()) / MS_PER_DAY);
}

// ═════════════════════════════════════════════════════════════════════════
// S1 · Sales Pipeline by Stage
// ═════════════════════════════════════════════════════════════════════════
router.get('/pipeline', catchAsync(async (req, res) => {
  const { salesperson } = req.query;

  // Quote-side: DRAFT / SENT
  const quoteConds = ["q.STATUS NOT IN ('CONVERTED','REJECTED','EXPIRED')"];
  const qBinds = {};
  if (salesperson) { quoteConds.push("LOWER(q.CREATED_BY) = LOWER(:sp)"); qBinds.sp = salesperson; }

  const qRes = await execute(`
    SELECT q.QUOTE_ID, q.STATUS, q.CUSTOMER_NAME, q.TOTAL, q.CREATED_AT, q.CREATED_BY
    FROM QA_QUOTES q
    WHERE ${quoteConds.join(' AND ')}
  `, qBinds);

  // Invoice-side: anything not yet closed
  const invConds = ["i.STATUS NOT IN ('Paid','Customer Rejected','Cancelled','Rejected','Draft')"];
  const iBinds = {};
  if (salesperson) { invConds.push("LOWER(i.SALESPERSON_ID) = LOWER(:sp)"); iBinds.sp = salesperson; }

  const iRes = await execute(`
    SELECT i.INVOICE_ID, i.APPROVED_INVOICE_ID, i.STATUS, i.CUSTOMER_NAME,
           i.TOTAL, i.BALANCE_DUE, i.CREATED_AT, i.SALESPERSON_ID
    FROM QA_INVOICES i
    WHERE ${invConds.join(' AND ')}
  `, iBinds);

  // Combine into uniform "deals" list with a normalised stage label
  const STAGE_ORDER = ['Draft','Sent','Pending Pricing','Pending Approval','Approved','Awaiting Acceptance','Customer Accepted','Partially Paid'];
  const stageLabel = (kind, status) => {
    if (kind === 'quote') {
      if (status === 'DRAFT') return 'Draft';
      if (status === 'SENT')  return 'Sent';
      return status; // fallback
    }
    return status;
  };

  const deals = [];
  const now = new Date();
  for (const q of qRes.rows || []) {
    deals.push({
      kind:        'quote',
      id:          q.QUOTE_ID,
      number:      q.QUOTE_ID,
      stage:       stageLabel('quote', q.STATUS),
      customerName: q.CUSTOMER_NAME || '—',
      value:       n(q.TOTAL),
      ageDays:     daysBetween(q.CREATED_AT, now),
      owner:       q.CREATED_BY
    });
  }
  for (const i of iRes.rows || []) {
    deals.push({
      kind:        'invoice',
      id:          i.INVOICE_ID,
      number:      i.APPROVED_INVOICE_ID || i.INVOICE_ID,
      stage:       i.STATUS,
      customerName: i.CUSTOMER_NAME || '—',
      value:       n(i.TOTAL),
      ageDays:     daysBetween(i.CREATED_AT, now),
      owner:       i.SALESPERSON_ID
    });
  }

  // Aggregate by stage
  const byStage = {};
  for (const d of deals) {
    if (!byStage[d.stage]) byStage[d.stage] = { count: 0, value: 0, ageSum: 0, oldest: null };
    byStage[d.stage].count++;
    byStage[d.stage].value += d.value;
    byStage[d.stage].ageSum += d.ageDays;
    if (!byStage[d.stage].oldest || d.ageDays > byStage[d.stage].oldest.ageDays) {
      byStage[d.stage].oldest = d;
    }
  }

  const stageRows = Object.entries(byStage)
    .map(([stage, info]) => ({
      stage,
      count: info.count,
      value: n(info.value),
      avgAge: info.count > 0 ? n(info.ageSum / info.count, 1) : 0,
      oldestDeal: info.oldest ? `${info.oldest.number} ${info.oldest.ageDays}d` : '—',
      owner: info.oldest?.owner || ''
    }))
    .sort((a, b) => {
      const ai = STAGE_ORDER.indexOf(a.stage);
      const bi = STAGE_ORDER.indexOf(b.stage);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

  const totalOpen   = deals.reduce((acc, d) => acc + d.value, 0);
  const dealCount   = deals.length;
  const avgDeal     = dealCount > 0 ? n(totalOpen / dealCount) : 0;
  const largestDeal = deals.reduce((acc, d) => (d.value > acc ? d.value : acc), 0);

  res.json(envelope({
    title:    'Sales Pipeline',
    subtitle: `${dealCount} open deal${dealCount === 1 ? '' : 's'} across ${stageRows.length} stages`,
    asOfDate: now,
    filtersApplied: salesperson ? [{ label: 'Salesperson', value: salesperson }] : [],
    kpis: [
      { label: 'Total open',  value: n(totalOpen),  fmt: 'currency' },
      { label: '# deals',     value: dealCount,     fmt: 'number' },
      { label: 'Avg deal',    value: avgDeal,       fmt: 'currency' },
      { label: 'Largest deal',value: n(largestDeal),fmt: 'currency' }
    ],
    charts: [
      {
        type: 'bar',
        title: 'Pipeline value by stage (GHS)',
        data: stageRows.map(s => ({ name: s.stage, value: s.value }))
      }
    ],
    columns: [
      { key: 'stage',      label: 'Stage',         type: 'string' },
      { key: 'count',      label: '# deals',       type: 'number' },
      { key: 'value',      label: 'Value',         type: 'currency' },
      { key: 'avgAge',     label: 'Avg age (d)',   type: 'number' },
      { key: 'oldestDeal', label: 'Oldest',        type: 'string' },
      { key: 'owner',      label: 'Owner (oldest)',type: 'string' }
    ],
    rows: stageRows,
    totals: { value: n(totalOpen) }
  }));
}));

// ═════════════════════════════════════════════════════════════════════════
// S2 · Quote-to-Cash Conversion Funnel
// ═════════════════════════════════════════════════════════════════════════
router.get('/conversion-funnel', catchAsync(async (req, res) => {
  const { from, to } = parseDateRange(req.query);
  const { salesperson } = req.query;

  // Cohort = quotes whose CREATED_AT is in window. CREATED_AT is TIMESTAMP.
  const conds = ['q.CREATED_AT >= :fromd', 'q.CREATED_AT <= :tod'];
  const binds = { fromd: from, tod: to };
  if (salesperson) { conds.push('LOWER(q.CREATED_BY) = LOWER(:sp)'); binds.sp = salesperson; }

  const qRes = await execute(`
    SELECT q.QUOTE_ID, q.STATUS, q.TOTAL, q.CONVERTED_TO_INV
    FROM QA_QUOTES q
    WHERE ${conds.join(' AND ')}
  `, binds);
  const quotes = qRes.rows || [];

  const cohort     = quotes.length;
  const cohortVal  = quotes.reduce((a, q) => a + n(q.TOTAL), 0);
  const sentCount  = quotes.filter(q => q.STATUS !== 'DRAFT').length;
  const convInvIds = quotes.map(q => q.CONVERTED_TO_INV).filter(Boolean);

  let acceptedCount = 0;
  let paidCount     = 0;
  if (convInvIds.length > 0) {
    const phs = convInvIds.map((_, i) => { binds[`iid${i}`] = convInvIds[i]; return `:iid${i}`; });
    const iRes = await execute(`
      SELECT STATUS FROM QA_INVOICES
      WHERE INVOICE_ID IN (${phs.join(',')})
    `, Object.fromEntries(Object.entries(binds).filter(([k]) => k.startsWith('iid'))));
    for (const inv of (iRes.rows || [])) {
      if (['Customer Accepted','Paid','Partially Paid'].includes(inv.STATUS)) acceptedCount++;
      if (inv.STATUS === 'Paid') paidCount++;
    }
  }

  // Drop-off rates as percent
  const pct = (a, b) => (b > 0 ? n((a / b) * 100, 1) : 0);

  res.json(envelope({
    title:    'Quote-to-Cash Conversion Funnel',
    subtitle: `Cohort: ${cohort} quotes created ${isoDay(from)} → ${isoDay(to)} (worth ${n(cohortVal).toLocaleString()})`,
    asOfDate: new Date(),
    filtersApplied: [
      { label: 'Period', value: `${isoDay(from)} → ${isoDay(to)}` },
      ...(salesperson ? [{ label: 'Salesperson', value: salesperson }] : [])
    ],
    kpis: [
      { label: 'Quotes created',  value: cohort,        fmt: 'number' },
      { label: '% Sent',          value: pct(sentCount, cohort), fmt: 'percent' },
      { label: '% Accepted',      value: pct(acceptedCount, cohort), fmt: 'percent' },
      { label: '% Paid in full',  value: pct(paidCount, cohort),    fmt: 'percent' }
    ],
    charts: [
      {
        type: 'bar',
        title: 'Funnel (count of quotes from cohort)',
        data: [
          { name: 'Created',  value: cohort },
          { name: 'Sent',     value: sentCount },
          { name: 'Accepted', value: acceptedCount },
          { name: 'Paid',     value: paidCount }
        ]
      }
    ],
    columns: [
      { key: 'stage',       label: 'Stage',       type: 'string' },
      { key: 'count',       label: '# in cohort', type: 'number' },
      { key: 'pctOfCohort', label: '% of cohort', type: 'percent' },
      { key: 'dropoff',     label: '% drop-off vs prev', type: 'percent' }
    ],
    rows: [
      { stage: 'Quote created',     count: cohort,         pctOfCohort: 100, dropoff: 0 },
      { stage: 'Sent to customer',  count: sentCount,      pctOfCohort: pct(sentCount, cohort),     dropoff: pct(cohort - sentCount, cohort) },
      { stage: 'Customer accepted', count: acceptedCount,  pctOfCohort: pct(acceptedCount, cohort), dropoff: pct(sentCount - acceptedCount, sentCount) },
      { stage: 'Paid in full',      count: paidCount,      pctOfCohort: pct(paidCount, cohort),     dropoff: pct(acceptedCount - paidCount, acceptedCount) }
    ]
  }));
}));

// ═════════════════════════════════════════════════════════════════════════
// S3 · Revenue vs Target
// ═════════════════════════════════════════════════════════════════════════
router.get('/revenue-vs-target', catchAsync(async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const { salesperson } = req.query;

  // Targets for the year
  const tRes = await execute(`
    SELECT TARGET_MONTH, TARGET_AMOUNT
    FROM QA_REVENUE_TARGETS
    WHERE TARGET_YEAR = :yr
  `, { yr: year });
  const targetsByMonth = {};
  let annualTarget = 0;
  for (const r of (tRes.rows || [])) {
    targetsByMonth[r.TARGET_MONTH] = n(r.TARGET_AMOUNT);
    annualTarget += n(r.TARGET_AMOUNT);
  }

  // Recognised revenue in year — INVOICE_DATE is VARCHAR2; LIKE 'YYYY%'
  const invConds = ["i.STATUS IN ('Customer Accepted','Paid','Partially Paid')",
                    "i.INVOICE_DATE LIKE :ypfx"];
  const binds = { ypfx: `${year}%` };
  if (salesperson) { invConds.push('LOWER(i.SALESPERSON_ID) = LOWER(:sp)'); binds.sp = salesperson; }

  const iRes = await execute(`
    SELECT i.INVOICE_DATE, i.SUBTOTAL, i.SALESPERSON_ID
    FROM QA_INVOICES i
    WHERE ${invConds.join(' AND ')}
  `, binds);

  const actualByMonth = {};
  const actualByRep   = {};
  let ytdActual = 0;
  for (const r of (iRes.rows || [])) {
    const month = String(r.INVOICE_DATE || '').slice(5, 7); // YYYY-MM-...
    if (!month) continue;
    const amt = n(r.SUBTOTAL);
    actualByMonth[month] = (actualByMonth[month] || 0) + amt;
    const rep = r.SALESPERSON_ID || '—';
    actualByRep[rep] = (actualByRep[rep] || 0) + amt;
    ytdActual += amt;
  }

  // Build monthly rows for chart + table
  const months = ['01','02','03','04','05','06','07','08','09','10','11','12'];
  const monthRows = months.map(m => {
    const target = targetsByMonth[m] || 0;
    const actual = actualByMonth[m] || 0;
    return {
      month: `${year}-${m}`,
      target: n(target),
      actual: n(actual),
      attainment: target > 0 ? n((actual / target) * 100, 1) : 0
    };
  });

  // Per-rep table — needs target-per-rep (we don't track that yet, so all-rep target = annualTarget)
  const repRows = Object.entries(actualByRep).map(([rep, actual]) => ({
    salesperson: rep,
    actual:      n(actual),
    attainment:  annualTarget > 0 ? n((actual / annualTarget) * 100, 1) : 0
  })).sort((a, b) => b.actual - a.actual);

  const ytdTarget = months
    .slice(0, new Date().getMonth() + 1)
    .reduce((acc, m) => acc + (targetsByMonth[m] || 0), 0);
  const attainmentYtd = ytdTarget > 0 ? n((ytdActual / ytdTarget) * 100, 1) : 0;

  // Simple FY forecast = YTD × 12 / monthsElapsed
  const monthsElapsed = new Date().getMonth() + 1;
  const fyForecast = monthsElapsed > 0 ? n((ytdActual / monthsElapsed) * 12) : 0;

  res.json(envelope({
    title:    'Revenue vs Target',
    subtitle: `${year} YTD · ${months.length} months · annual target ${annualTarget.toLocaleString()}`,
    asOfDate: new Date(),
    filtersApplied: [
      { label: 'Year', value: String(year) },
      ...(salesperson ? [{ label: 'Salesperson', value: salesperson }] : [])
    ],
    kpis: [
      { label: 'YTD actual',  value: n(ytdActual),     fmt: 'currency' },
      { label: 'YTD target',  value: n(ytdTarget),     fmt: 'currency' },
      { label: 'Attainment',  value: attainmentYtd,    fmt: 'percent', tone: attainmentYtd >= 100 ? 'good' : attainmentYtd >= 80 ? 'neutral' : 'bad' },
      { label: 'FY forecast', value: fyForecast,       fmt: 'currency' }
    ],
    charts: [
      {
        type: 'bar',
        title: 'Actual vs Target by month (GHS)',
        data: monthRows.map(m => ({ name: m.month.slice(5), value: m.actual }))
      }
    ],
    columns: [
      { key: 'salesperson', label: 'Rep',         type: 'string' },
      { key: 'actual',      label: 'YTD actual',  type: 'currency' },
      { key: 'attainment',  label: 'Attainment',  type: 'percent' }
    ],
    rows: repRows,
    totals: { actual: n(ytdActual) },
    extras: { monthlyDetail: monthRows }
  }));
}));

// ═════════════════════════════════════════════════════════════════════════
// S4 · Sales Rep Leaderboard
// ═════════════════════════════════════════════════════════════════════════
router.get('/leaderboard', catchAsync(async (req, res) => {
  const period = req.query.period || 'ytd'; // ytd | qtd | mtd
  const now = new Date();
  let fromStr;
  if (period === 'mtd') fromStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2,'0')}-01`;
  else if (period === 'qtd') {
    const qStart = Math.floor(now.getMonth() / 3) * 3;
    fromStr = `${now.getFullYear()}-${String(qStart + 1).padStart(2,'0')}-01`;
  } else fromStr = `${now.getFullYear()}-01-01`;

  // All quotes by rep (cohort denominator for win-rate)
  const qRes = await execute(`
    SELECT CREATED_BY AS REP, STATUS, TOTAL, CREATED_AT
    FROM QA_QUOTES
    WHERE CREATED_AT >= :fromd
  `, { fromd: new Date(fromStr) });

  // All invoices recognised by rep
  const iRes = await execute(`
    SELECT SALESPERSON_ID AS REP, STATUS, SUBTOTAL, INVOICE_DATE, CREATED_AT
    FROM QA_INVOICES
    WHERE STATUS IN ('Customer Accepted','Paid','Partially Paid')
      AND INVOICE_DATE >= :fromd
  `, { fromd: fromStr });

  const byRep = {};
  for (const q of (qRes.rows || [])) {
    const rep = q.REP || '—';
    if (!byRep[rep]) byRep[rep] = { quotes: 0, won: 0, sent: 0, revenue: 0, pipeline: 0 };
    byRep[rep].quotes++;
    if (q.STATUS !== 'DRAFT') byRep[rep].sent++;
    if (!['DRAFT','SENT','REJECTED','EXPIRED'].includes(q.STATUS)) byRep[rep].pipeline += n(q.TOTAL);
  }
  for (const i of (iRes.rows || [])) {
    const rep = i.REP || '—';
    if (!byRep[rep]) byRep[rep] = { quotes: 0, won: 0, sent: 0, revenue: 0, pipeline: 0 };
    byRep[rep].won++;
    byRep[rep].revenue += n(i.SUBTOTAL);
  }

  const rows = Object.entries(byRep).map(([rep, info]) => ({
    salesperson: rep,
    revenue:     n(info.revenue),
    won:         info.won,
    sent:        info.sent,
    winPct:      info.sent > 0 ? n((info.won / info.sent) * 100, 1) : 0,
    avgDeal:     info.won > 0 ? n(info.revenue / info.won) : 0,
    pipeline:    n(info.pipeline)
  })).sort((a, b) => b.revenue - a.revenue);

  const totalTeam   = rows.reduce((a, r) => a + r.revenue, 0);
  const topRep      = rows[0] || null;
  const bestWinRate = [...rows].sort((a, b) => b.winPct - a.winPct)[0] || null;
  const mostDeals   = [...rows].sort((a, b) => b.won - a.won)[0] || null;

  res.json(envelope({
    title:    'Sales Leaderboard',
    subtitle: `${period.toUpperCase()} · ${rows.length} rep${rows.length === 1 ? '' : 's'} active`,
    asOfDate: now,
    filtersApplied: [{ label: 'Period', value: period.toUpperCase() }],
    kpis: [
      { label: 'Team revenue', value: n(totalTeam),                 fmt: 'currency' },
      { label: 'Top rep',      value: topRep ? `${topRep.salesperson} · ${topRep.revenue.toLocaleString()}` : '—', fmt: 'string' },
      { label: 'Best win rate',value: bestWinRate ? `${bestWinRate.salesperson} · ${bestWinRate.winPct}%` : '—', fmt: 'string' },
      { label: 'Most deals',   value: mostDeals ? `${mostDeals.salesperson} · ${mostDeals.won}` : '—', fmt: 'string' }
    ],
    charts: [
      {
        type: 'bar',
        title: 'Revenue by rep',
        data: rows.slice(0, 10).map(r => ({ name: r.salesperson, value: r.revenue }))
      }
    ],
    columns: [
      { key: 'salesperson', label: 'Rep',       type: 'string' },
      { key: 'revenue',     label: 'Revenue',   type: 'currency' },
      { key: 'won',         label: '#Won',      type: 'number' },
      { key: 'sent',        label: '#Sent',     type: 'number' },
      { key: 'winPct',      label: 'Win %',     type: 'percent' },
      { key: 'avgDeal',     label: 'Avg deal',  type: 'currency' },
      { key: 'pipeline',    label: 'Pipeline',  type: 'currency' }
    ],
    rows,
    totals: { revenue: n(totalTeam) }
  }));
}));

// ═════════════════════════════════════════════════════════════════════════
// S5 · Quote Aging
// ═════════════════════════════════════════════════════════════════════════
router.get('/quote-aging', catchAsync(async (req, res) => {
  const { asOfDate } = parseDateRange(req.query);
  const { salesperson } = req.query;
  const minDays = Number(req.query.minDays) || 0;

  // Open quotes — SENT (not yet converted/rejected/expired)
  const conds = ["q.STATUS = 'SENT'", "q.CONVERTED_TO_INV IS NULL"];
  const binds = {};
  if (salesperson) { conds.push('LOWER(q.CREATED_BY) = LOWER(:sp)'); binds.sp = salesperson; }

  const r = await execute(`
    SELECT q.QUOTE_ID, q.CUSTOMER_NAME, q.TOTAL, q.CREATED_AT, q.EXPIRES_AT, q.CREATED_BY
    FROM QA_QUOTES q
    WHERE ${conds.join(' AND ')}
  `, binds);
  const raw = r.rows || [];

  const asofMs = asOfDate.getTime();
  let expiringSoon = 0;
  let expired      = 0;
  const buckets = { '0-7': 0, '8-14': 0, '15-30': 0, '31-60': 0, '60+': 0 };

  const rows = raw.map(row => {
    const sent = row.CREATED_AT instanceof Date ? row.CREATED_AT : new Date(row.CREATED_AT);
    const days = Math.max(0, Math.floor((asofMs - sent.getTime()) / MS_PER_DAY));
    // EXPIRES_AT is VARCHAR2(50) — parse JS-side, NOT a real TIMESTAMP
    const expRaw = row.EXPIRES_AT || '';
    let expiry = null;
    if (expRaw) {
      const d = new Date(expRaw);
      if (!Number.isNaN(d.getTime())) expiry = d;
    }
    let daysToExpiry = null;
    if (expiry) {
      daysToExpiry = Math.floor((expiry.getTime() - asofMs) / MS_PER_DAY);
      if (daysToExpiry < 0)      expired++;
      else if (daysToExpiry <= 7) expiringSoon++;
    }

    let bucket;
    if (days <= 7)        bucket = '0-7';
    else if (days <= 14)  bucket = '8-14';
    else if (days <= 30)  bucket = '15-30';
    else if (days <= 60)  bucket = '31-60';
    else                  bucket = '60+';
    buckets[bucket] = (buckets[bucket] || 0) + 1;

    return {
      quoteId:      row.QUOTE_ID,
      customerName: row.CUSTOMER_NAME || '—',
      value:        n(row.TOTAL),
      sentDate:     isoDay(sent),
      ageDays:      days,
      expires:      expRaw ? String(expRaw).slice(0, 10) : '—',
      daysToExpiry: daysToExpiry != null ? daysToExpiry : '—',
      owner:        row.CREATED_BY
    };
  }).filter(r => r.ageDays >= minDays).sort((a, b) => b.ageDays - a.ageDays);

  const totalValue = rows.reduce((a, r) => a + r.value, 0);

  res.json(envelope({
    title:    'Quote Aging',
    subtitle: `As of ${isoDay(asOfDate)} · ${rows.length} open quote${rows.length === 1 ? '' : 's'}`,
    asOfDate,
    filtersApplied: [
      { label: 'As of', value: isoDay(asOfDate) },
      ...(salesperson ? [{ label: 'Salesperson', value: salesperson }] : []),
      ...(minDays > 0 ? [{ label: 'Min age', value: `${minDays}d` }] : [])
    ],
    kpis: [
      { label: 'Open quotes',  value: rows.length,    fmt: 'number' },
      { label: 'Total value',  value: n(totalValue),  fmt: 'currency' },
      { label: 'Expiring ≤7d', value: expiringSoon,   fmt: 'number', tone: expiringSoon > 0 ? 'neutral' : 'good' },
      { label: 'Already expired', value: expired,     fmt: 'number', tone: expired > 0 ? 'bad' : 'good' }
    ],
    charts: [
      {
        type: 'bar',
        title: 'Aging distribution (count)',
        data: Object.entries(buckets).map(([k, v]) => ({ name: `${k} d`, value: v }))
      }
    ],
    columns: [
      { key: 'quoteId',      label: 'Quote',         type: 'string' },
      { key: 'customerName', label: 'Customer',      type: 'string' },
      { key: 'value',        label: 'Value',         type: 'currency' },
      { key: 'sentDate',     label: 'Sent',          type: 'string' },
      { key: 'ageDays',      label: 'Days',          type: 'number' },
      { key: 'expires',      label: 'Expires',       type: 'string' },
      { key: 'daysToExpiry', label: 'Days to expiry',type: 'number' },
      { key: 'owner',        label: 'Owner',         type: 'string' }
    ],
    rows
  }));
}));

// ═════════════════════════════════════════════════════════════════════════
// S6 · Win / Loss Analysis
// ═════════════════════════════════════════════════════════════════════════
router.get('/win-loss', catchAsync(async (req, res) => {
  const { from, to } = parseDateRange(req.query);
  const { industry, sizeBand, salesperson } = req.query;

  const conds = [
    "i.STATUS IN ('Customer Accepted','Customer Rejected','Paid','Partially Paid')",
    "i.INVOICE_DATE >= :fromd",
    "i.INVOICE_DATE <= :tod"
  ];
  const binds = { fromd: isoDay(from), tod: isoDay(to) };
  if (industry)    { conds.push('c.INDUSTRY = :ind'); binds.ind = industry; }
  if (sizeBand)    { conds.push('c.SIZE_BAND = :sb'); binds.sb = sizeBand; }
  if (salesperson) { conds.push('LOWER(i.SALESPERSON_ID) = LOWER(:sp)'); binds.sp = salesperson; }

  const r = await execute(`
    SELECT
      i.INVOICE_ID, i.APPROVED_INVOICE_ID, i.STATUS, i.TOTAL, i.SUBTOTAL,
      i.CUSTOMER_NAME, i.SALESPERSON_ID,
      i.REJECTION_REASON_CODE, i.WIN_REASON_CODE, i.LOST_TO_COMPETITOR,
      c.INDUSTRY, c.SIZE_BAND
    FROM QA_INVOICES i
    LEFT JOIN QA_CUSTOMERS c ON c.CUSTOMER_ID = i.CUSTOMER_ID
    WHERE ${conds.join(' AND ')}
  `, binds);
  const raw = r.rows || [];

  let won = 0, lost = 0, wonValue = 0, lostValue = 0;
  const winReasons  = {};
  const lossReasons = {};
  const competitors = {};
  const byIndustry  = {};

  const rows = raw.map(row => {
    const isWin = row.STATUS !== 'Customer Rejected';
    const val   = n(row.SUBTOTAL);
    if (isWin) { won++; wonValue += val; }
    else       { lost++; lostValue += val; }
    if (isWin && row.WIN_REASON_CODE) winReasons[row.WIN_REASON_CODE] = (winReasons[row.WIN_REASON_CODE] || 0) + 1;
    if (!isWin && row.REJECTION_REASON_CODE) lossReasons[row.REJECTION_REASON_CODE] = (lossReasons[row.REJECTION_REASON_CODE] || 0) + 1;
    if (!isWin && row.LOST_TO_COMPETITOR) {
      const c = String(row.LOST_TO_COMPETITOR);
      if (!competitors[c]) competitors[c] = { count: 0, value: 0, industries: new Set() };
      competitors[c].count++;
      competitors[c].value += val;
      if (row.INDUSTRY) competitors[c].industries.add(row.INDUSTRY);
    }
    const ind = row.INDUSTRY || '—';
    if (!byIndustry[ind]) byIndustry[ind] = { closed: 0, won: 0, wonValue: 0 };
    byIndustry[ind].closed++;
    if (isWin) { byIndustry[ind].won++; byIndustry[ind].wonValue += val; }

    return {
      invoiceId:    row.INVOICE_ID,
      invoiceNumber:row.APPROVED_INVOICE_ID || row.INVOICE_ID,
      customerName: row.CUSTOMER_NAME || '—',
      industry:     row.INDUSTRY || '—',
      salesperson:  row.SALESPERSON_ID || '—',
      outcome:      isWin ? 'WON' : 'LOST',
      reasonCode:   isWin ? (row.WIN_REASON_CODE || '—') : (row.REJECTION_REASON_CODE || '—'),
      competitor:   row.LOST_TO_COMPETITOR || '',
      value:        val
    };
  });

  const totalClosed = won + lost;
  const winRate = totalClosed > 0 ? n((won / totalClosed) * 100, 1) : 0;

  // Sort reasons desc
  const winReasonChart  = Object.entries(winReasons).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }));
  const lossReasonChart = Object.entries(lossReasons).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }));

  // Industry rollup as detail extras
  const industryRows = Object.entries(byIndustry).map(([ind, info]) => ({
    industry: ind,
    closed:   info.closed,
    won:      info.won,
    winPct:   info.closed > 0 ? n((info.won / info.closed) * 100, 1) : 0,
    wonValue: n(info.wonValue)
  })).sort((a, b) => b.wonValue - a.wonValue);

  const competitorRows = Object.entries(competitors).map(([name, info]) => ({
    competitor: name,
    dealsLost:  info.count,
    valueLost:  n(info.value),
    industries: Array.from(info.industries).join(', ')
  })).sort((a, b) => b.valueLost - a.valueLost);

  res.json(envelope({
    title:    'Win / Loss Analysis',
    subtitle: `${isoDay(from)} → ${isoDay(to)} · ${totalClosed} closed deal${totalClosed === 1 ? '' : 's'}`,
    asOfDate: new Date(),
    filtersApplied: [
      { label: 'Period', value: `${isoDay(from)} → ${isoDay(to)}` },
      ...(industry ? [{ label: 'Industry', value: industry }] : []),
      ...(sizeBand ? [{ label: 'Size band', value: sizeBand }] : []),
      ...(salesperson ? [{ label: 'Salesperson', value: salesperson }] : [])
    ],
    kpis: [
      { label: 'Win rate',   value: winRate,         fmt: 'percent', tone: winRate >= 50 ? 'good' : 'neutral' },
      { label: 'Closed deals', value: totalClosed,   fmt: 'number' },
      { label: 'Value won',  value: n(wonValue),     fmt: 'currency' },
      { label: 'Value lost', value: n(lostValue),    fmt: 'currency', tone: 'bad' }
    ],
    charts: [
      { type: 'bar', title: 'Why we WIN (count)',  data: winReasonChart },
      { type: 'bar', title: 'Why we LOSE (count)', data: lossReasonChart }
    ],
    columns: [
      { key: 'invoiceNumber', label: 'Invoice',     type: 'string', drillPage: 'invoiceEditor', drillKey: 'invoiceId' },
      { key: 'customerName',  label: 'Customer',    type: 'string' },
      { key: 'industry',      label: 'Industry',    type: 'string' },
      { key: 'salesperson',   label: 'Rep',         type: 'string' },
      { key: 'outcome',       label: 'Outcome',     type: 'string' },
      { key: 'reasonCode',    label: 'Reason code', type: 'string' },
      { key: 'competitor',    label: 'Competitor',  type: 'string' },
      { key: 'value',         label: 'Value',       type: 'currency' }
    ],
    rows,
    extras: { industryRollup: industryRows, competitorRollup: competitorRows }
  }));
}));

// ═════════════════════════════════════════════════════════════════════════
// S7 · Top Customers
// ═════════════════════════════════════════════════════════════════════════
router.get('/top-customers', catchAsync(async (req, res) => {
  const year = String(req.query.year || new Date().getFullYear());
  const topN = Math.min(Number(req.query.topN) || 30, 100);

  const r = await execute(`
    SELECT
      i.CUSTOMER_ID,
      i.CUSTOMER_NAME,
      c.INDUSTRY,
      c.SIZE_BAND,
      i.SUBTOTAL,
      i.INVOICE_DATE
    FROM QA_INVOICES i
    LEFT JOIN QA_CUSTOMERS c ON c.CUSTOMER_ID = i.CUSTOMER_ID
    WHERE i.STATUS IN ('Customer Accepted','Paid','Partially Paid')
      AND i.INVOICE_DATE LIKE :ypfx
  `, { ypfx: `${year}%` });
  const raw = r.rows || [];

  const byCust = {};
  let totalRev = 0;
  const byIndustry = {};
  const bySizeBand = {};
  for (const row of raw) {
    const cid = row.CUSTOMER_ID;
    if (!cid) continue;
    if (!byCust[cid]) {
      byCust[cid] = {
        customerId: cid,
        customerName: row.CUSTOMER_NAME || '—',
        industry: row.INDUSTRY || '—',
        sizeBand: row.SIZE_BAND || '—',
        revenue: 0,
        lastOrder: ''
      };
    }
    const amt = n(row.SUBTOTAL);
    byCust[cid].revenue += amt;
    totalRev += amt;
    if (!byCust[cid].lastOrder || row.INVOICE_DATE > byCust[cid].lastOrder) {
      byCust[cid].lastOrder = row.INVOICE_DATE;
    }
    byIndustry[byCust[cid].industry] = (byIndustry[byCust[cid].industry] || 0) + amt;
    bySizeBand[byCust[cid].sizeBand] = (bySizeBand[byCust[cid].sizeBand] || 0) + amt;
  }

  const sorted = Object.values(byCust).sort((a, b) => b.revenue - a.revenue);
  const rows = sorted.slice(0, topN).map((c, i) => ({
    rank:         i + 1,
    customerId:   c.customerId,
    customerName: c.customerName,
    industry:     c.industry,
    sizeBand:     c.sizeBand,
    revenue:      n(c.revenue),
    lastOrder:    String(c.lastOrder).slice(0, 10),
    status:       'Active'
  }));

  const today = new Date();
  const dormantCutoff = new Date(today.getFullYear(), today.getMonth() - 3, today.getDate());
  let dormant = 0;
  for (const c of sorted) {
    const lo = c.lastOrder ? new Date(c.lastOrder) : null;
    if (!lo || lo < dormantCutoff) dormant++;
  }
  // "New" customers — first invoice this YEAR
  // (would need first-ever-invoice tracking for a true "new"; use "single-invoice in year" as proxy)
  const newCount = sorted.filter(c => raw.filter(r => r.CUSTOMER_ID === c.customerId).length === 1).length;

  res.json(envelope({
    title:    'Top Customers',
    subtitle: `YTD ${year} · ${sorted.length} customer${sorted.length === 1 ? '' : 's'} with recognised revenue`,
    asOfDate: new Date(),
    filtersApplied: [{ label: 'Year', value: year }],
    kpis: [
      { label: 'Active customers',   value: sorted.length, fmt: 'number' },
      { label: 'Avg revenue/cust',   value: sorted.length > 0 ? n(totalRev / sorted.length) : 0, fmt: 'currency' },
      { label: 'New (YTD proxy)',    value: newCount,      fmt: 'number' },
      { label: 'Dormant >90d',       value: dormant,       fmt: 'number', tone: dormant > 0 ? 'neutral' : 'good' }
    ],
    charts: [
      {
        type: 'bar',
        title: 'Revenue by industry',
        data: Object.entries(byIndustry).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, value]) => ({ name, value: n(value) }))
      }
    ],
    columns: [
      { key: 'rank',         label: '#',         type: 'number' },
      { key: 'customerName', label: 'Customer',  type: 'string', drillPage: 'customerStatement', drillKey: 'customerId' },
      { key: 'industry',     label: 'Industry',  type: 'string' },
      { key: 'sizeBand',     label: 'Size',      type: 'string' },
      { key: 'revenue',      label: 'YTD Rev',   type: 'currency' },
      { key: 'lastOrder',    label: 'Last order',type: 'string' },
      { key: 'status',       label: 'Status',    type: 'string' }
    ],
    rows,
    totals: { revenue: n(totalRev) }
  }));
}));

// ═════════════════════════════════════════════════════════════════════════
// S8 · Top Products (ABC)
// ═════════════════════════════════════════════════════════════════════════
router.get('/top-products', catchAsync(async (req, res) => {
  const year = String(req.query.year || new Date().getFullYear());
  const { category } = req.query;
  const topN = Math.min(Number(req.query.topN) || 50, 200);

  const sql = `
    SELECT
      li.SKU,
      li.ITEM_NAME,
      li.QUANTITY,
      li.LINE_TOTAL,
      inv.ITEM_CATEGORY,
      inv.ITEM_SUBCATEGORY
    FROM QA_INVOICES i
    JOIN QA_INVOICE_LINE_ITEMS li ON li.INVOICE_ID = i.INVOICE_ID
    LEFT JOIN QA_INVENTORY inv ON inv.SKU = li.SKU
    WHERE i.STATUS IN ('Customer Accepted','Paid','Partially Paid')
      AND i.INVOICE_DATE LIKE :ypfx
      ${category ? "AND inv.ITEM_CATEGORY = :cat" : ''}`;
  const binds = { ypfx: `${year}%` };
  if (category) binds.cat = category;

  const r = await execute(sql, binds);
  const raw = r.rows || [];

  const bySku = {};
  let totalRev = 0;
  const byCat = {};
  for (const row of raw) {
    const sku = row.SKU || `${row.ITEM_NAME || 'Unknown'} (no SKU)`;
    if (!bySku[sku]) {
      bySku[sku] = {
        sku,
        itemName: row.ITEM_NAME || '—',
        category: row.ITEM_CATEGORY || '—',
        qty: 0,
        revenue: 0
      };
    }
    const lt = n(row.LINE_TOTAL);
    bySku[sku].qty += n(row.QUANTITY);
    bySku[sku].revenue += lt;
    totalRev += lt;
    const cat = row.ITEM_CATEGORY || 'Uncategorised';
    byCat[cat] = (byCat[cat] || 0) + lt;
  }

  const sorted = Object.values(bySku).sort((a, b) => b.revenue - a.revenue);

  let cum = 0;
  let aCount = 0, bCount = 0, cCount = 0;
  const rows = sorted.slice(0, topN).map((s, i) => {
    cum += s.revenue;
    const cumPct = totalRev > 0 ? (cum / totalRev) * 100 : 0;
    let cls;
    if (cumPct <= 80)      { cls = 'A'; aCount++; }
    else if (cumPct <= 95) { cls = 'B'; bCount++; }
    else                   { cls = 'C'; cCount++; }
    return {
      rank:     i + 1,
      sku:      s.sku,
      itemName: s.itemName,
      category: s.category,
      qty:      n(s.qty),
      revenue:  n(s.revenue),
      abcClass: cls
    };
  });

  res.json(envelope({
    title:    'Top Products (ABC)',
    subtitle: `YTD ${year} · ${sorted.length} SKU${sorted.length === 1 ? '' : 's'} sold`,
    asOfDate: new Date(),
    filtersApplied: [
      { label: 'Year', value: year },
      ...(category ? [{ label: 'Category', value: category }] : [])
    ],
    kpis: [
      { label: 'SKUs sold',  value: sorted.length, fmt: 'number' },
      { label: 'A-class',    value: aCount, fmt: 'number' },
      { label: 'B-class',    value: bCount, fmt: 'number' },
      { label: 'C-class',    value: cCount, fmt: 'number' }
    ],
    charts: [
      {
        type: 'bar',
        title: 'Revenue by category',
        data: Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, value]) => ({ name, value: n(value) }))
      }
    ],
    columns: [
      { key: 'rank',     label: '#',        type: 'number' },
      { key: 'sku',      label: 'SKU',      type: 'string' },
      { key: 'itemName', label: 'Item',     type: 'string' },
      { key: 'category', label: 'Category', type: 'string' },
      { key: 'qty',      label: 'Qty',      type: 'number' },
      { key: 'revenue',  label: 'Revenue',  type: 'currency' },
      { key: 'abcClass', label: 'ABC',      type: 'string' }
    ],
    rows,
    totals: { revenue: n(totalRev) }
  }));
}));

module.exports = router;
