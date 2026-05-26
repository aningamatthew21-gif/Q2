'use strict';

/**
 * routes/reports/procurement.js — Module 5 Phase 5.2
 *
 * Eight procurement reports, all gated by `reports.run.procurement`.
 *
 * Schema lesson stack carried from Phase 5.1:
 *   - *_AT columns (CREATED_AT, AWARDED_AT, CANCELLED_AT, FULFILLED_AT,
 *     APPROVED_AT, LOGGED_AT, EMAIL_SENT_AT, EVENT_TIME) are real
 *     TIMESTAMP — bind JS Date directly.
 *   - QA_GOODS_RECEIPTS.RECEIVED_DATE is a real DATE — bind JS Date.
 *   - VARCHAR2 user-string date columns to watch for:
 *       QA_PURCHASE_REQUISITIONS.NEEDED_BY        VARCHAR2(50)
 *       QA_RFQS.SUBMISSION_DEADLINE               VARCHAR2(50)
 *       QA_RFQS.DELIVERY_DEADLINE                 VARCHAR2(50)
 *       QA_RFQ_RESPONSES.RECEIVED_DATE            VARCHAR2(50)
 *     Use SUBSTR(col,1,10) + isoDay() string for comparisons on these.
 */

const express = require('express');
const { execute } = require('../../db');
const { catchAsync } = require('../../middleware/errorHandler');
const { authMiddleware, requirePermission } = require('../../middleware/authMiddleware');
const { envelope, parseDateRange, agingBucket, AGING_BUCKET_ORDER, n, safeJsonArray, isoDay } = require('./_shared');

const router = express.Router();
router.use(authMiddleware);
router.use(requirePermission('reports.run.procurement'));

// Day count helper — uniform 24h math (procurement views don't need
// timezone precision; the day boundary is "what shows on the date").
const MS_PER_DAY = 24 * 60 * 60 * 1000;
function daysBetween(a, b) {
  if (!a || !b) return 0;
  const da = a instanceof Date ? a : new Date(a);
  const db = b instanceof Date ? b : new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return 0;
  return Math.floor((db.getTime() - da.getTime()) / MS_PER_DAY);
}

// ═════════════════════════════════════════════════════════════════════════
// P1 · PR Backlog Aging — open requisitions by age + owner
// ═════════════════════════════════════════════════════════════════════════
router.get('/pr-backlog', catchAsync(async (req, res) => {
  const { asOfDate } = parseDateRange(req.query);
  const { owner, priority, status } = req.query;

  const conditions = ["pr.STATUS NOT IN ('FULFILLED','CANCELLED','REJECTED')"];
  const binds = {};
  if (owner)    { conditions.push("LOWER(pr.ASSIGNED_TO) = LOWER(:own)"); binds.own = owner; }
  if (priority) { conditions.push("pr.PRIORITY = :prio"); binds.prio = priority; }
  if (status)   { conditions.push("pr.STATUS = :st"); binds.st = status; }

  const sql = `
    SELECT
      pr.PR_ID,
      pr.PR_NUMBER,
      pr.ITEM_NAME,
      pr.QUANTITY,
      pr.UOM,
      pr.STATUS,
      pr.PRIORITY,
      pr.ASSIGNED_TO,
      pr.REQUESTED_BY,
      pr.CREATED_AT,
      pr.CUSTOMER_NAME
    FROM QA_PURCHASE_REQUISITIONS pr
    WHERE ${conditions.join(' AND ')}`;
  const r = await execute(sql, binds);
  const raw = r.rows || [];

  const asofMs = asOfDate.getTime();
  // Aging bucket scheme dedicated to backlog (different bands than AR).
  const bucketize = (days) => {
    if (days <= 3)  return '0-3';
    if (days <= 7)  return '4-7';
    if (days <= 14) return '8-14';
    if (days <= 30) return '15-30';
    return '30+';
  };
  const BACKLOG_ORDER = ['0-3', '4-7', '8-14', '15-30', '30+'];
  const bucketTotals  = { '0-3': 0, '4-7': 0, '8-14': 0, '15-30': 0, '30+': 0 };

  let totalAge = 0;
  let stalled = 0;
  let urgentLate = 0;

  const rows = raw.map(row => {
    const createdAt = row.CREATED_AT instanceof Date ? row.CREATED_AT : new Date(row.CREATED_AT);
    const age = Math.max(0, Math.floor((asofMs - createdAt.getTime()) / MS_PER_DAY));
    const bucket = bucketize(age);
    bucketTotals[bucket] = (bucketTotals[bucket] || 0) + 1;
    totalAge += age;
    if (age > 14) stalled++;
    if ((row.PRIORITY || '').toLowerCase() === 'urgent' && age > 7) urgentLate++;

    return {
      prId:        row.PR_ID,
      prNumber:    row.PR_NUMBER || row.PR_ID,
      itemName:    row.ITEM_NAME || '—',
      quantity:    n(row.QUANTITY),
      uom:         row.UOM || 'EA',
      status:      row.STATUS,
      priority:    row.PRIORITY,
      owner:       row.ASSIGNED_TO || 'unassigned',
      ageDays:     age,
      bucket,
      createdAt:   row.CREATED_AT,
      customerName: row.CUSTOMER_NAME || ''
    };
  });
  rows.sort((a, b) => (b.ageDays - a.ageDays) || (a.priority === 'urgent' ? -1 : 0));

  const avgAge = rows.length > 0 ? n(totalAge / rows.length, 1) : 0;

  res.json(envelope({
    title:    'PR Backlog Aging',
    subtitle: `As of ${isoDay(asOfDate)} · ${rows.length} open PR${rows.length === 1 ? '' : 's'}`,
    asOfDate,
    filtersApplied: [
      { label: 'As of', value: isoDay(asOfDate) },
      ...(owner    ? [{ label: 'Owner',    value: owner }]    : []),
      ...(priority ? [{ label: 'Priority', value: priority }] : []),
      ...(status   ? [{ label: 'Status',   value: status }]   : [])
    ],
    kpis: [
      { label: 'Open PRs',       value: rows.length,         fmt: 'number' },
      { label: 'Avg age (days)', value: avgAge,              fmt: 'number' },
      { label: 'Stalled >14d',   value: stalled,             fmt: 'number', tone: stalled > 0 ? 'bad' : 'good' },
      { label: 'Urgent late',    value: urgentLate,          fmt: 'number', tone: urgentLate > 0 ? 'bad' : 'good' }
    ],
    charts: [
      {
        type: 'bar',
        title: 'Aging distribution (count)',
        data: BACKLOG_ORDER.map(b => ({ name: `${b} d`, value: bucketTotals[b] || 0 }))
      }
    ],
    columns: [
      { key: 'prNumber',    label: 'PR#',       type: 'string', drillPage: 'purchaseRequisitionDetail', drillKey: 'prId' },
      { key: 'itemName',    label: 'Item',      type: 'string' },
      { key: 'quantity',    label: 'Qty',       type: 'number' },
      { key: 'priority',    label: 'Prio',      type: 'string' },
      { key: 'status',      label: 'Status',    type: 'string' },
      { key: 'ageDays',     label: 'Age (d)',   type: 'number' },
      { key: 'owner',       label: 'Owner',     type: 'string' },
      { key: 'customerName',label: 'Customer',  type: 'string' }
    ],
    rows
  }));
}));

// ═════════════════════════════════════════════════════════════════════════
// P2 · RFQ Cycle Time — average days at each procurement stage
// ═════════════════════════════════════════════════════════════════════════
router.get('/rfq-cycle-time', catchAsync(async (req, res) => {
  const { from, to } = parseDateRange(req.query);
  const { owner } = req.query;

  // Pull all AWARDED RFQs in window. Window applies to AWARDED_AT
  // (TIMESTAMP — bind Date direct).
  const awardCond = [
    "STATUS = 'AWARDED'",
    "AWARDED_AT >= :fromd",
    "AWARDED_AT <= :tod"
  ];
  const binds = { fromd: from, tod: to };

  const rfqRes = await execute(`
    SELECT RFQ_ID, RFQ_NUMBER, CREATED_AT, AWARDED_AT, CREATED_BY,
           TOTAL_AWARD_AMOUNT, AWARDED_VENDOR_ID
    FROM QA_RFQS
    WHERE ${awardCond.join(' AND ')}
    ORDER BY AWARDED_AT DESC
  `, binds);
  const rfqs = rfqRes.rows || [];

  if (rfqs.length === 0) {
    return res.json(envelope({
      title:    'RFQ Cycle Time',
      subtitle: `${isoDay(from)} → ${isoDay(to)} · no awarded RFQs in window`,
      asOfDate: new Date(),
      filtersApplied: [{ label: 'Period', value: `${isoDay(from)} → ${isoDay(to)}` }],
      kpis: [
        { label: 'Avg total cycle', value: 0, fmt: 'number' },
        { label: 'Fastest',         value: 0, fmt: 'number' },
        { label: 'Slowest stage',   value: '—', fmt: 'string' },
        { label: 'Awards in window',value: 0, fmt: 'number' }
      ],
      charts: [],
      columns: [],
      rows: []
    }));
  }

  // Pull events for these RFQs in one query (IN list)
  const ids = rfqs.map(r => r.RFQ_ID);
  const inBinds = {};
  const inPlaceholders = ids.map((id, i) => { inBinds[`id${i}`] = id; return `:id${i}`; });
  const evtRes = await execute(`
    SELECT ENTITY_ID, EVENT_TYPE, EVENT_TIME
    FROM QA_PROCUREMENT_EVENTS
    WHERE ENTITY_TYPE = 'RFQ' AND ENTITY_ID IN (${inPlaceholders.join(',')})
    ORDER BY EVENT_TIME
  `, inBinds);
  const events = evtRes.rows || [];

  // Index events by RFQ for fast lookup
  const eventsByRfq = {};
  for (const e of events) {
    (eventsByRfq[e.ENTITY_ID] = eventsByRfq[e.ENTITY_ID] || []).push(e);
  }
  // First-event-of-type helper
  const firstOf = (list, type) => list.find(e => e.EVENT_TYPE === type);

  let totalCycle = 0;
  const stageSums = { create_to_sent: 0, sent_to_response: 0, response_to_rec: 0, rec_to_approve: 0, approve_to_award: 0 };
  const stageCounts = { create_to_sent: 0, sent_to_response: 0, response_to_rec: 0, rec_to_approve: 0, approve_to_award: 0 };

  const rows = rfqs.map(r => {
    const list = eventsByRfq[r.RFQ_ID] || [];
    const created = r.CREATED_AT;
    const sent    = firstOf(list, 'RFQ_SENT')?.EVENT_TIME;
    const response = firstOf(list, 'RFQ_RESPONSE_LOGGED')?.EVENT_TIME;
    const rec     = firstOf(list, 'RFQ_RECOMMENDED')?.EVENT_TIME;
    const approve = firstOf(list, 'RFQ_CONTROLLER_APPROVED')?.EVENT_TIME
                 || firstOf(list, 'RFQ_AWARDED')?.EVENT_TIME;
    const awarded = r.AWARDED_AT;

    const dCreateToSent     = sent ? daysBetween(created, sent) : null;
    const dSentToResponse   = sent && response ? daysBetween(sent, response) : null;
    const dResponseToRec    = response && rec ? daysBetween(response, rec) : null;
    const dRecToApprove     = rec && approve ? daysBetween(rec, approve) : null;
    const dApproveToAward   = approve && awarded ? daysBetween(approve, awarded) : null;
    const totalDays         = daysBetween(created, awarded);

    [['create_to_sent', dCreateToSent], ['sent_to_response', dSentToResponse],
     ['response_to_rec', dResponseToRec], ['rec_to_approve', dRecToApprove],
     ['approve_to_award', dApproveToAward]
    ].forEach(([k, v]) => {
      if (v != null && v >= 0) { stageSums[k] += v; stageCounts[k] += 1; }
    });
    totalCycle += totalDays;

    return {
      rfqId:           r.RFQ_ID,
      rfqNumber:       r.RFQ_NUMBER || r.RFQ_ID,
      createdAt:       isoDay(created),
      awardedAt:       isoDay(awarded),
      totalDays,
      owner:           r.CREATED_BY || '',
      totalAward:      n(r.TOTAL_AWARD_AMOUNT)
    };
  });
  rows.sort((a, b) => b.totalDays - a.totalDays);

  const avgStage = (k) => stageCounts[k] > 0 ? n(stageSums[k] / stageCounts[k], 1) : 0;
  const avgs = {
    create_to_sent:    avgStage('create_to_sent'),
    sent_to_response:  avgStage('sent_to_response'),
    response_to_rec:   avgStage('response_to_rec'),
    rec_to_approve:    avgStage('rec_to_approve'),
    approve_to_award:  avgStage('approve_to_award')
  };
  const stageEntries = [
    { name: 'PR created → RFQ sent',        value: avgs.create_to_sent },
    { name: 'RFQ sent → 1st response',      value: avgs.sent_to_response },
    { name: '1st response → recommendation',value: avgs.response_to_rec },
    { name: 'Recommend → approve',          value: avgs.rec_to_approve },
    { name: 'Approve → awarded',            value: avgs.approve_to_award }
  ];
  const slowest = stageEntries.reduce((acc, s) => (s.value > acc.value ? s : acc), { name: '—', value: 0 });
  const avgTotal = rfqs.length > 0 ? n(totalCycle / rfqs.length, 1) : 0;
  const fastest = rows.reduce((acc, r) => (r.totalDays < acc ? r.totalDays : acc), Infinity);

  // Apply owner filter post-hoc (cheap; rfqs is bounded by AWARDED_AT window)
  const filteredRows = owner ? rows.filter(r => (r.owner || '').toLowerCase() === owner.toLowerCase()) : rows;

  res.json(envelope({
    title:    'RFQ Cycle Time',
    subtitle: `${isoDay(from)} → ${isoDay(to)} · ${filteredRows.length} awarded RFQ${filteredRows.length === 1 ? '' : 's'}`,
    asOfDate: new Date(),
    filtersApplied: [
      { label: 'Period', value: `${isoDay(from)} → ${isoDay(to)}` },
      ...(owner ? [{ label: 'Owner', value: owner }] : [])
    ],
    kpis: [
      { label: 'Avg total cycle (d)', value: avgTotal,              fmt: 'number' },
      { label: 'Fastest (d)',         value: Number.isFinite(fastest) ? fastest : 0, fmt: 'number' },
      { label: 'Slowest stage',       value: `${slowest.name} · ${slowest.value} d`, fmt: 'string' },
      { label: 'Awards in window',    value: rfqs.length,           fmt: 'number' }
    ],
    charts: [
      { type: 'bar', title: 'Avg days per stage', data: stageEntries }
    ],
    columns: [
      { key: 'rfqNumber',  label: 'RFQ#',      type: 'string', drillPage: 'rfqDetail', drillKey: 'rfqId' },
      { key: 'createdAt',  label: 'Created',   type: 'string' },
      { key: 'awardedAt',  label: 'Awarded',   type: 'string' },
      { key: 'totalDays',  label: 'Cycle (d)', type: 'number' },
      { key: 'owner',      label: 'Owner',     type: 'string' },
      { key: 'totalAward', label: 'Award',     type: 'currency' }
    ],
    rows: filteredRows
  }));
}));

// ═════════════════════════════════════════════════════════════════════════
// P3 · RFQs Needing Attention — past deadline / low response / escalated
// ═════════════════════════════════════════════════════════════════════════
router.get('/rfqs-attention', catchAsync(async (req, res) => {
  const { asOfDate } = parseDateRange(req.query);

  // Open RFQs: SENT / RECEIVING / PENDING_APPROVAL
  const rfqRes = await execute(`
    SELECT
      r.RFQ_ID, r.RFQ_NUMBER, r.STATUS, r.CREATED_BY,
      r.SUBMISSION_DEADLINE, r.DELIVERY_DEADLINE, r.CREATED_AT
    FROM QA_RFQS r
    WHERE r.STATUS IN ('SENT','RECEIVING','PENDING_APPROVAL')
    ORDER BY r.CREATED_AT
  `);
  const rfqs = rfqRes.rows || [];

  if (rfqs.length === 0) {
    // Consistent envelope shape — zero-value KPIs render the empty state
    // gracefully without the KPI band disappearing.
    return res.json(envelope({
      title:    'RFQs Needing Attention',
      subtitle: `As of ${isoDay(asOfDate)} · no open RFQs`,
      asOfDate,
      kpis: [
        { label: 'Open RFQs',     value: 0, fmt: 'number' },
        { label: 'Past deadline', value: 0, fmt: 'number', tone: 'good' },
        { label: 'Low response',  value: 0, fmt: 'number', tone: 'good' },
        { label: 'Escalated',     value: 0, fmt: 'number', tone: 'good' }
      ],
      charts: [], columns: [], rows: []
    }));
  }

  // Vendor-response counts per RFQ (one query)
  const ids = rfqs.map(r => r.RFQ_ID);
  const inBinds = {};
  const inPh = ids.map((id, i) => { inBinds[`id${i}`] = id; return `:id${i}`; });
  const venRes = await execute(`
    SELECT RFQ_ID,
           COUNT(*)                                              AS INVITED,
           SUM(CASE WHEN RESPONSE_STATUS = 'RESPONDED' THEN 1 ELSE 0 END) AS RESPONDED
    FROM QA_RFQ_VENDORS
    WHERE RFQ_ID IN (${inPh.join(',')})
    GROUP BY RFQ_ID
  `, inBinds);
  const venByRfq = {};
  for (const v of (venRes.rows || [])) {
    venByRfq[v.RFQ_ID] = { invited: Number(v.INVITED), responded: Number(v.RESPONDED) };
  }

  // Escalation events
  const evRes = await execute(`
    SELECT DISTINCT ENTITY_ID
    FROM QA_PROCUREMENT_EVENTS
    WHERE ENTITY_TYPE = 'RFQ' AND ENTITY_ID IN (${inPh.join(',')})
      AND EVENT_TYPE = 'RFQ_ESCALATED'
  `, inBinds);
  const escalatedSet = new Set((evRes.rows || []).map(r => r.ENTITY_ID));

  let pastDeadline = 0;
  let lowResponse  = 0;
  let escalated    = 0;
  const asofStr = isoDay(asOfDate);

  const rows = rfqs.map(r => {
    const ven = venByRfq[r.RFQ_ID] || { invited: 0, responded: 0 };
    // SUBMISSION_DEADLINE is VARCHAR2 — string compare via SUBSTR-prefix
    const deadline = (r.SUBMISSION_DEADLINE || '').slice(0, 10);
    const isPast = deadline && deadline < asofStr;
    const isLow  = ven.responded < 3 && r.STATUS === 'RECEIVING';
    const isEsc  = escalatedSet.has(r.RFQ_ID);
    const flags = [];
    if (isPast) { flags.push('PAST_DEADLINE'); pastDeadline++; }
    if (isLow)  { flags.push('LOW_RESPONSE');  lowResponse++; }
    if (r.STATUS === 'PENDING_APPROVAL') flags.push('AWAIT_HEAD');
    if (isEsc)  { flags.push('ESCALATED'); escalated++; }
    return {
      rfqId:        r.RFQ_ID,
      rfqNumber:    r.RFQ_NUMBER || r.RFQ_ID,
      status:       r.STATUS,
      deadline:     deadline || '—',
      vendorRatio:  `${ven.responded} / ${ven.invited}`,
      flags:        flags.join(', '),
      owner:        r.CREATED_BY || '',
      ageDays:      daysBetween(r.CREATED_AT, asOfDate)
    };
  });
  rows.sort((a, b) => b.ageDays - a.ageDays);

  res.json(envelope({
    title:    'RFQs Needing Attention',
    subtitle: `As of ${asofStr} · ${rows.length} open RFQ${rows.length === 1 ? '' : 's'}`,
    asOfDate,
    filtersApplied: [{ label: 'As of', value: asofStr }],
    kpis: [
      { label: 'Open RFQs',       value: rows.length,    fmt: 'number' },
      { label: 'Past deadline',   value: pastDeadline,   fmt: 'number', tone: pastDeadline > 0 ? 'bad' : 'good' },
      { label: 'Low response',    value: lowResponse,    fmt: 'number', tone: lowResponse > 0 ? 'bad' : 'good' },
      { label: 'Escalated',       value: escalated,      fmt: 'number', tone: escalated > 0 ? 'bad' : 'good' }
    ],
    charts: [
      {
        type: 'bar',
        title: 'By risk flag (count of RFQs)',
        data: [
          { name: 'Past deadline', value: pastDeadline },
          { name: 'Low response',  value: lowResponse },
          { name: 'Await head',    value: rows.filter(r => r.status === 'PENDING_APPROVAL').length },
          { name: 'Escalated',     value: escalated }
        ]
      }
    ],
    columns: [
      { key: 'rfqNumber',   label: 'RFQ#',      type: 'string', drillPage: 'rfqDetail', drillKey: 'rfqId' },
      { key: 'status',      label: 'Status',    type: 'string' },
      { key: 'deadline',    label: 'Deadline',  type: 'string' },
      { key: 'vendorRatio', label: 'Vendors',   type: 'string' },
      { key: 'flags',       label: 'Risk flags',type: 'string' },
      { key: 'ageDays',     label: 'Age (d)',   type: 'number' },
      { key: 'owner',       label: 'Owner',     type: 'string' }
    ],
    rows
  }));
}));

// ═════════════════════════════════════════════════════════════════════════
// P4 · Spend by Vendor (Pareto)
// ═════════════════════════════════════════════════════════════════════════
router.get('/spend-by-vendor', catchAsync(async (req, res) => {
  const { from, to } = parseDateRange(req.query);
  const topN = Math.min(Number(req.query.topN) || 30, 100);

  // RECEIVED_DATE is real DATE (Module 3) — bind JS Date direct.
  const sql = `
    SELECT
      gr.VENDOR_ID,
      v.VENDOR_NAME,
      v.CATEGORY,
      gr.TOTAL_VALUE,
      gr.RECEIVED_DATE,
      gr.RECEIPT_ID
    FROM QA_GOODS_RECEIPTS gr
    LEFT JOIN QA_VENDORS v ON v.VENDOR_ID = gr.VENDOR_ID
    WHERE gr.RECEIVED_DATE >= :fromd AND gr.RECEIVED_DATE <= :tod`;
  const r = await execute(sql, { fromd: from, tod: to });
  const raw = r.rows || [];

  // Rollup by vendor
  const byVendor = {};
  let totalSpend = 0;
  for (const row of raw) {
    const id = row.VENDOR_ID || 'UNKNOWN';
    if (!byVendor[id]) {
      byVendor[id] = {
        vendorId:    id,
        vendorName:  row.VENDOR_NAME || '— unmapped —',
        category:    row.CATEGORY || '—',
        spend:       0,
        poCount:     0
      };
    }
    const v = n(row.TOTAL_VALUE);
    byVendor[id].spend += v;
    byVendor[id].poCount += 1;
    totalSpend += v;
  }

  const sortedVendors = Object.values(byVendor).sort((a, b) => b.spend - a.spend);

  // Pareto: cumulative %
  let cum = 0;
  const rows = sortedVendors.slice(0, topN).map((v, i) => {
    cum += v.spend;
    return {
      rank:        i + 1,
      vendorId:    v.vendorId,
      vendorName:  v.vendorName,
      category:    v.category,
      spend:       n(v.spend),
      poCount:     v.poCount,
      cumPct:      totalSpend > 0 ? n((cum / totalSpend) * 100, 1) : 0
    };
  });

  const top5Share = rows.slice(0, 5).reduce((acc, r) => acc + r.spend, 0);
  const top5Pct = totalSpend > 0 ? n((top5Share / totalSpend) * 100, 1) : 0;

  // Pareto chart: cumulative spend % vs vendor rank.
  let runSum = 0;
  const chartData = sortedVendors.map((v, i) => {
    runSum += v.spend;
    return {
      name:  String(i + 1),
      value: totalSpend > 0 ? n((runSum / totalSpend) * 100, 1) : 0
    };
  });

  res.json(envelope({
    title:    'Spend by Vendor (Pareto)',
    subtitle: `${isoDay(from)} → ${isoDay(to)} · ${sortedVendors.length} vendor${sortedVendors.length === 1 ? '' : 's'} with spend`,
    asOfDate: new Date(),
    filtersApplied: [{ label: 'Period', value: `${isoDay(from)} → ${isoDay(to)}` }],
    kpis: [
      { label: 'Total spend',        value: n(totalSpend),         fmt: 'currency' },
      { label: 'Active vendors',     value: sortedVendors.length,  fmt: 'number' },
      { label: 'Top vendor',         value: sortedVendors[0]?.vendorName || '—', fmt: 'string' },
      { label: 'Top-5 concentration',value: top5Pct,               fmt: 'percent', tone: top5Pct > 70 ? 'bad' : 'neutral' }
    ],
    charts: [
      { type: 'line', title: 'Pareto — cumulative spend % by vendor rank', data: chartData }
    ],
    columns: [
      { key: 'rank',       label: '#',          type: 'number' },
      { key: 'vendorName', label: 'Vendor',     type: 'string', drillPage: 'vendorScorecard', drillKey: 'vendorId' },
      { key: 'category',   label: 'Category',   type: 'string' },
      { key: 'spend',      label: 'Spend',      type: 'currency' },
      { key: 'poCount',    label: '# receipts', type: 'number' },
      { key: 'cumPct',     label: 'Cum %',      type: 'percent' }
    ],
    rows,
    totals: { spend: n(totalSpend) }
  }));
}));

// ═════════════════════════════════════════════════════════════════════════
// P5 · Spend by Category (ABC)
// ═════════════════════════════════════════════════════════════════════════
router.get('/spend-by-category', catchAsync(async (req, res) => {
  const { from, to } = parseDateRange(req.query);

  // Join receipts to PR to get ITEM_NAME, then to inventory via name
  // (no SKU on PR — fallback to ITEM_NAME match). Inventory may not
  // match for custom items; those become category "Uncategorised".
  const sql = `
    SELECT
      gr.RECEIPT_ID,
      gr.PR_ID,
      gr.TOTAL_VALUE,
      pr.ITEM_NAME,
      inv.ITEM_CATEGORY,
      inv.ITEM_SUBCATEGORY,
      gr.VENDOR_ID,
      v.VENDOR_NAME
    FROM QA_GOODS_RECEIPTS gr
    LEFT JOIN QA_PURCHASE_REQUISITIONS pr ON pr.PR_ID = gr.PR_ID
    LEFT JOIN QA_INVENTORY inv ON UPPER(inv.ITEM_NAME) = UPPER(pr.ITEM_NAME)
    LEFT JOIN QA_VENDORS   v   ON v.VENDOR_ID = gr.VENDOR_ID
    WHERE gr.RECEIVED_DATE >= :fromd AND gr.RECEIVED_DATE <= :tod`;
  const r = await execute(sql, { fromd: from, tod: to });
  const raw = r.rows || [];

  const byCat = {};
  let totalSpend = 0;
  for (const row of raw) {
    const cat = row.ITEM_CATEGORY || 'Uncategorised';
    const sub = row.ITEM_SUBCATEGORY || '—';
    const key = `${cat}|${sub}`;
    if (!byCat[key]) {
      byCat[key] = {
        category: cat,
        subcategory: sub,
        spend: 0,
        receipts: 0,
        vendors: new Set()
      };
    }
    const v = n(row.TOTAL_VALUE);
    byCat[key].spend += v;
    byCat[key].receipts += 1;
    if (row.VENDOR_NAME) byCat[key].vendors.add(row.VENDOR_NAME);
    totalSpend += v;
  }

  // Sort by spend desc for ABC classification
  const sorted = Object.values(byCat).sort((a, b) => b.spend - a.spend);

  // ABC: A = first ≥ 80%, B = next ≥ 15%, C = rest
  let cum = 0;
  let aCount = 0, bCount = 0, cCount = 0;
  const rows = sorted.map(c => {
    cum += c.spend;
    const cumPct = totalSpend > 0 ? (cum / totalSpend) * 100 : 0;
    let cls;
    if (cumPct <= 80)      { cls = 'A'; aCount++; }
    else if (cumPct <= 95) { cls = 'B'; bCount++; }
    else                   { cls = 'C'; cCount++; }
    return {
      category:    c.category,
      subcategory: c.subcategory,
      spend:       n(c.spend),
      receipts:    c.receipts,
      vendorCount: c.vendors.size,
      cumPct:      n(cumPct, 1),
      abcClass:    cls
    };
  });

  // Chart: by category rollup (sum across subcategories)
  const byCatOnly = {};
  for (const row of rows) {
    byCatOnly[row.category] = (byCatOnly[row.category] || 0) + row.spend;
  }
  const chartData = Object.entries(byCatOnly)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value: n(value) }));

  res.json(envelope({
    title:    'Spend by Category (ABC)',
    subtitle: `${isoDay(from)} → ${isoDay(to)} · ${rows.length} (cat / subcat) combination${rows.length === 1 ? '' : 's'}`,
    asOfDate: new Date(),
    filtersApplied: [{ label: 'Period', value: `${isoDay(from)} → ${isoDay(to)}` }],
    kpis: [
      { label: 'Total spend', value: n(totalSpend), fmt: 'currency' },
      { label: 'A-class',     value: aCount,        fmt: 'number' },
      { label: 'B-class',     value: bCount,        fmt: 'number' },
      { label: 'C-class',     value: cCount,        fmt: 'number' }
    ],
    charts: [
      { type: 'bar', title: 'Spend by category (GHS)', data: chartData }
    ],
    columns: [
      { key: 'category',    label: 'Category',    type: 'string' },
      { key: 'subcategory', label: 'Subcategory', type: 'string' },
      { key: 'spend',       label: 'Spend',       type: 'currency' },
      { key: 'receipts',    label: '# receipts',  type: 'number' },
      { key: 'vendorCount', label: '# vendors',   type: 'number' },
      { key: 'cumPct',      label: 'Cum %',       type: 'percent' },
      { key: 'abcClass',    label: 'ABC',         type: 'string' }
    ],
    rows,
    totals: { spend: n(totalSpend) },
    extras: {
      methodology: 'A = top categories cumulatively to 80% of spend; B = next 15%; C = remaining. Items not matched to QA_INVENTORY appear as "Uncategorised".'
    }
  }));
}));

// ═════════════════════════════════════════════════════════════════════════
// P6 · Best-Price Override Audit
// ═════════════════════════════════════════════════════════════════════════
router.get('/override-audit', catchAsync(async (req, res) => {
  const { from, to } = parseDateRange(req.query);
  const { head } = req.query;

  // RECOMMENDED_VENDOR_ID lives on QA_RFQS but may not be present in
  // pre-Module-3 deployments. We coalesce via the most-recent
  // RFQ_RECOMMENDED event payload when the column is missing.
  // For the v1 report, just require both columns to be present.
  const rfqRes = await execute(`
    SELECT
      r.RFQ_ID, r.RFQ_NUMBER, r.AWARDED_VENDOR_ID, r.RECOMMENDED_VENDOR_ID,
      r.AWARDED_AT, r.AWARDED_BY, r.APPROVED_BY, r.TOTAL_AWARD_AMOUNT,
      vRec.VENDOR_NAME AS REC_NAME,
      vAwd.VENDOR_NAME AS AWD_NAME
    FROM QA_RFQS r
    LEFT JOIN QA_VENDORS vRec ON vRec.VENDOR_ID = r.RECOMMENDED_VENDOR_ID
    LEFT JOIN QA_VENDORS vAwd ON vAwd.VENDOR_ID = r.AWARDED_VENDOR_ID
    WHERE r.STATUS IN ('AWARDED','CLOSED')
      AND r.RECOMMENDED_VENDOR_ID IS NOT NULL
      AND r.AWARDED_VENDOR_ID IS NOT NULL
      AND r.RECOMMENDED_VENDOR_ID != r.AWARDED_VENDOR_ID
      AND r.AWARDED_AT >= :fromd AND r.AWARDED_AT <= :tod
    ORDER BY r.AWARDED_AT DESC
  `, { fromd: from, tod: to });
  const overrides = rfqRes.rows || [];

  // For premium calc: compare awarded total vs what system-rec would have cost
  // — sum line totals of the recommended vendor's responses on each RFQ.
  let totalPremium = 0;
  const headTotals = {}; // head -> { count, premium }
  const rows = [];
  for (const r of overrides) {
    const recCostRes = await execute(`
      SELECT NVL(SUM(TOTAL_COST), 0) AS RECSUM
      FROM QA_RFQ_RESPONSES
      WHERE RFQ_ID = :rid AND VENDOR_ID = :vid
    `, { rid: r.RFQ_ID, vid: r.RECOMMENDED_VENDOR_ID });
    const recSum = n(recCostRes.rows?.[0]?.RECSUM);
    const awd    = n(r.TOTAL_AWARD_AMOUNT);
    const premium = awd - recSum;
    totalPremium += premium;
    const headKey = r.APPROVED_BY || r.AWARDED_BY || '—';
    if (!headTotals[headKey]) headTotals[headKey] = { count: 0, premium: 0 };
    headTotals[headKey].count++;
    headTotals[headKey].premium += premium;

    // Get the override reason from the latest RFQ_RECOMMENDED event payload
    const reasonRes = await execute(`
      SELECT PAYLOAD FROM QA_PROCUREMENT_EVENTS
      WHERE ENTITY_TYPE = 'RFQ' AND ENTITY_ID = :rid AND EVENT_TYPE = 'RFQ_RECOMMENDED'
      ORDER BY EVENT_TIME DESC FETCH FIRST 1 ROWS ONLY
    `, { rid: r.RFQ_ID });
    let reason = '';
    if (reasonRes.rows?.[0]?.PAYLOAD) {
      try {
        const p = JSON.parse(reasonRes.rows[0].PAYLOAD);
        reason = p.reason || '';
      } catch (_e) { reason = ''; }
    }

    rows.push({
      rfqId:        r.RFQ_ID,
      rfqNumber:    r.RFQ_NUMBER || r.RFQ_ID,
      systemPick:   r.REC_NAME || '—',
      awardedTo:    r.AWD_NAME || '—',
      awardedAt:    isoDay(r.AWARDED_AT),
      premium:      n(premium),
      head:         headKey,
      reason
    });
  }
  rows.sort((a, b) => b.premium - a.premium);

  // Optional filter by head
  const filtered = head ? rows.filter(r => r.head === head) : rows;

  const overrideRate = 0; // We'd need total-awards-in-period for the denominator; v1 just shows count.
  const headChart = Object.entries(headTotals).map(([h, info]) => ({
    name:  h, value: n(info.premium)
  })).sort((a, b) => b.value - a.value);

  res.json(envelope({
    title:    'Best-Price Override Audit',
    subtitle: `${isoDay(from)} → ${isoDay(to)} · ${filtered.length} override${filtered.length === 1 ? '' : 's'}`,
    asOfDate: new Date(),
    filtersApplied: [
      { label: 'Period', value: `${isoDay(from)} → ${isoDay(to)}` },
      ...(head ? [{ label: 'Head', value: head }] : [])
    ],
    kpis: [
      { label: 'Total overrides',  value: filtered.length, fmt: 'number' },
      { label: 'Total cost premium', value: n(totalPremium), fmt: 'currency', tone: totalPremium > 0 ? 'bad' : 'good' },
      { label: 'Avg premium / override', value: filtered.length > 0 ? n(totalPremium / filtered.length) : 0, fmt: 'currency' },
      { label: 'Heads who overrode', value: Object.keys(headTotals).length, fmt: 'number' }
    ],
    charts: [
      { type: 'bar', title: 'Cost premium by approving head', data: headChart }
    ],
    columns: [
      { key: 'rfqNumber',  label: 'RFQ#',         type: 'string', drillPage: 'rfqDetail', drillKey: 'rfqId' },
      { key: 'awardedAt',  label: 'Awarded',      type: 'string' },
      { key: 'systemPick', label: 'System pick',  type: 'string' },
      { key: 'awardedTo',  label: 'Awarded to',   type: 'string' },
      { key: 'premium',    label: 'Cost premium', type: 'currency' },
      { key: 'head',       label: 'Approver',     type: 'string' },
      { key: 'reason',     label: 'Reason',       type: 'string' }
    ],
    rows: filtered,
    totals: { premium: n(filtered.reduce((a, r) => a + r.premium, 0)) }
  }));
}));

// ═════════════════════════════════════════════════════════════════════════
// P7 · Lead-Time Accuracy
// ═════════════════════════════════════════════════════════════════════════
router.get('/lead-time-accuracy', catchAsync(async (req, res) => {
  const { from, to } = parseDateRange(req.query);
  const { vendorId } = req.query;

  // For each receipt: committed lead time = the winning vendor's
  // LEAD_TIME_DAYS on that PR. Actual = RECEIVED_DATE − AWARDED_AT.
  const conds = ['gr.RECEIVED_DATE >= :fromd', 'gr.RECEIVED_DATE <= :tod'];
  const binds = { fromd: from, tod: to };
  if (vendorId) { conds.push('gr.VENDOR_ID = :vid'); binds.vid = vendorId; }

  const sql = `
    SELECT
      gr.RECEIPT_ID, gr.RECEIVED_DATE, gr.PR_ID, gr.VENDOR_ID,
      v.VENDOR_NAME,
      r.AWARDED_AT,
      rr.LEAD_TIME_DAYS
    FROM QA_GOODS_RECEIPTS gr
    LEFT JOIN QA_VENDORS v ON v.VENDOR_ID = gr.VENDOR_ID
    LEFT JOIN QA_RFQS    r ON r.RFQ_ID    = gr.RFQ_ID
    LEFT JOIN QA_RFQ_RESPONSES rr
        ON rr.RFQ_ID = gr.RFQ_ID AND rr.VENDOR_ID = gr.VENDOR_ID AND rr.PR_ID = gr.PR_ID
    WHERE ${conds.join(' AND ')}`;
  const r = await execute(sql, binds);
  const raw = r.rows || [];

  // Compute variance per receipt
  let onTime = 0, late = 0, early = 0;
  let varianceSum = 0;
  const byVendor = {};
  const bucketTotals = { 'early-2+': 0, 'early-1-2': 0, 'on-time': 0, 'late-1-3': 0, 'late-4-7': 0, 'late-8+': 0 };

  const rows = raw.map(row => {
    const committed = Number(row.LEAD_TIME_DAYS) || 0;
    const actualDays = row.AWARDED_AT ? daysBetween(row.AWARDED_AT, row.RECEIVED_DATE) : null;
    const variance = (actualDays != null && committed > 0) ? actualDays - committed : null;

    let bucket = null;
    if (variance == null) bucket = null;
    else if (variance >= 8)  bucket = 'late-8+';
    else if (variance >= 4)  bucket = 'late-4-7';
    else if (variance >= 1)  bucket = 'late-1-3';
    else if (variance <= -3) bucket = 'early-2+';
    else if (variance <= -1) bucket = 'early-1-2';
    else                     bucket = 'on-time';
    if (bucket) bucketTotals[bucket] = (bucketTotals[bucket] || 0) + 1;

    if (variance != null) {
      varianceSum += variance;
      if (variance > 0) late++;
      else if (variance < 0) early++;
      else onTime++;
    }

    const vid = row.VENDOR_ID || 'UNKNOWN';
    if (!byVendor[vid]) {
      byVendor[vid] = {
        vendorId:   vid,
        vendorName: row.VENDOR_NAME || '—',
        deliveries: 0,
        onTime:     0,
        varianceSum:0,
        worst:      0
      };
    }
    byVendor[vid].deliveries++;
    if (variance != null) {
      byVendor[vid].varianceSum += variance;
      if (variance > byVendor[vid].worst) byVendor[vid].worst = variance;
      if (variance <= 0) byVendor[vid].onTime++;
    }

    return {
      receiptId:     row.RECEIPT_ID,
      vendorId:      vid,
      vendorName:    row.VENDOR_NAME || '—',
      committedDays: committed,
      actualDays:    actualDays != null ? actualDays : '—',
      variance:      variance != null ? variance : '—',
      bucket:        bucket || '—',
      receivedDate:  isoDay(row.RECEIVED_DATE)
    };
  });
  rows.sort((a, b) => (Number(b.variance) || 0) - (Number(a.variance) || 0));

  const totalScored = onTime + late + early;
  const onTimePct = totalScored > 0 ? n((onTime / totalScored) * 100, 1) : 0;
  const avgVariance = totalScored > 0 ? n(varianceSum / totalScored, 1) : 0;

  // Per-vendor rollup with on-time % (sort worst-first)
  const vendorRows = Object.values(byVendor).map(v => ({
    vendorId:    v.vendorId,
    vendorName:  v.vendorName,
    deliveries:  v.deliveries,
    avgVariance: v.deliveries > 0 ? n(v.varianceSum / v.deliveries, 1) : 0,
    onTimePct:   v.deliveries > 0 ? n((v.onTime / v.deliveries) * 100, 1) : 0,
    worst:       v.worst
  })).sort((a, b) => a.onTimePct - b.onTimePct);

  res.json(envelope({
    title:    'Lead-Time Accuracy',
    subtitle: `${isoDay(from)} → ${isoDay(to)} · ${rows.length} deliver${rows.length === 1 ? 'y' : 'ies'}`,
    asOfDate: new Date(),
    filtersApplied: [
      { label: 'Period', value: `${isoDay(from)} → ${isoDay(to)}` },
      ...(vendorId ? [{ label: 'Vendor', value: vendorId }] : [])
    ],
    kpis: [
      { label: 'Deliveries',     value: rows.length,         fmt: 'number' },
      { label: 'On-time rate',   value: onTimePct,           fmt: 'percent', tone: onTimePct >= 80 ? 'good' : 'bad' },
      { label: 'Avg variance (d)', value: avgVariance,       fmt: 'number',  tone: avgVariance > 3 ? 'bad' : 'neutral' },
      { label: 'Late deliveries',value: late,                fmt: 'number',  tone: late > 0 ? 'bad' : 'good' }
    ],
    charts: [
      {
        type: 'bar',
        title: 'Variance distribution',
        data: [
          { name: 'Early 2+ d',  value: bucketTotals['early-2+']  },
          { name: 'Early 1-2 d', value: bucketTotals['early-1-2'] },
          { name: 'On time',     value: bucketTotals['on-time']   },
          { name: 'Late 1-3 d',  value: bucketTotals['late-1-3']  },
          { name: 'Late 4-7 d',  value: bucketTotals['late-4-7']  },
          { name: 'Late 8+ d',   value: bucketTotals['late-8+']   }
        ]
      }
    ],
    columns: [
      { key: 'vendorName',    label: 'Vendor',       type: 'string', drillPage: 'vendorScorecard', drillKey: 'vendorId' },
      { key: 'deliveries',    label: 'Deliveries',   type: 'number' },
      { key: 'avgVariance',   label: 'Avg variance', type: 'number' },
      { key: 'onTimePct',     label: 'On-time %',    type: 'percent' },
      { key: 'worst',         label: 'Worst delay',  type: 'number' }
    ],
    rows: vendorRows,
    extras: {
      methodology: 'Committed = LEAD_TIME_DAYS quoted by the winning vendor at award. Actual = RECEIVED_DATE − AWARDED_AT. Variance > 0 = late.',
      perDelivery: rows
    }
  }));
}));

// ═════════════════════════════════════════════════════════════════════════
// P8 · PR Cancellation Analysis
// ═════════════════════════════════════════════════════════════════════════
router.get('/pr-cancellations', catchAsync(async (req, res) => {
  const { from, to } = parseDateRange(req.query);
  const { owner } = req.query;

  const conds = [
    "pr.STATUS = 'CANCELLED'",
    "pr.CANCELLED_AT >= :fromd",
    "pr.CANCELLED_AT <= :tod"
  ];
  const binds = { fromd: from, tod: to };
  if (owner) { conds.push("LOWER(pr.ASSIGNED_TO) = LOWER(:own)"); binds.own = owner; }

  const sql = `
    SELECT
      pr.PR_ID, pr.PR_NUMBER, pr.ITEM_NAME, pr.QUANTITY,
      pr.CANCELLATION_REASON, pr.CANCELLATION_NOTES, pr.CANCELLED_AT,
      pr.CANCELLED_BY, pr.ASSIGNED_TO, pr.CREATED_AT
    FROM QA_PURCHASE_REQUISITIONS pr
    WHERE ${conds.join(' AND ')}
    ORDER BY pr.CANCELLED_AT DESC`;

  // CANCELLED_BY column added in Module 3 — check existence
  let raw;
  try {
    const r = await execute(sql, binds);
    raw = r.rows || [];
  } catch (e) {
    // ORA-00904 = column not found (CANCELLED_BY); retry without it
    if (/ORA-00904/.test(e.message)) {
      const fallbackSql = sql.replace(/,\s*pr\.CANCELLED_BY/, '');
      const r2 = await execute(fallbackSql, binds);
      raw = r2.rows || [];
    } else {
      throw e;
    }
  }

  // Also pull total PR count in window for cancel-rate denominator
  const totRes = await execute(`
    SELECT COUNT(*) AS C FROM QA_PURCHASE_REQUISITIONS
    WHERE CREATED_AT >= :fromd AND CREATED_AT <= :tod`,
    { fromd: from, tod: to });
  const totalPrs = Number(totRes.rows?.[0]?.C || 0);

  const reasonTotals = {};
  let avoidable = 0;
  for (const row of raw) {
    const reason = row.CANCELLATION_REASON || 'OTHER';
    reasonTotals[reason] = (reasonTotals[reason] || 0) + 1;
    if (reason === 'DUPLICATE' || reason === 'STOCK_REAPPEARED') avoidable++;
  }

  const rows = raw.map(row => ({
    prId:       row.PR_ID,
    prNumber:   row.PR_NUMBER || row.PR_ID,
    itemName:   row.ITEM_NAME || '—',
    quantity:   n(row.QUANTITY),
    reason:     row.CANCELLATION_REASON || 'OTHER',
    notes:      row.CANCELLATION_NOTES || '',
    cancelledAt: isoDay(row.CANCELLED_AT),
    cancelledBy: row.CANCELLED_BY || row.ASSIGNED_TO || '—',
    leadTime:   daysBetween(row.CREATED_AT, row.CANCELLED_AT)
  }));

  const cancelRate = totalPrs > 0 ? n((raw.length / totalPrs) * 100, 1) : 0;
  const reasonChart = Object.entries(reasonTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value }));

  res.json(envelope({
    title:    'PR Cancellation Analysis',
    subtitle: `${isoDay(from)} → ${isoDay(to)} · ${rows.length} cancelled PR${rows.length === 1 ? '' : 's'}`,
    asOfDate: new Date(),
    filtersApplied: [
      { label: 'Period', value: `${isoDay(from)} → ${isoDay(to)}` },
      ...(owner ? [{ label: 'Owner', value: owner }] : [])
    ],
    kpis: [
      { label: 'Total PRs created', value: totalPrs,    fmt: 'number' },
      { label: 'Cancelled',         value: rows.length, fmt: 'number' },
      { label: 'Cancel rate',       value: cancelRate,  fmt: 'percent', tone: cancelRate > 15 ? 'bad' : 'neutral' },
      { label: 'Avoidable',         value: avoidable,   fmt: 'number',  tone: avoidable > 0 ? 'bad' : 'good' }
    ],
    charts: [
      { type: 'bar', title: 'Cancellations by reason', data: reasonChart }
    ],
    columns: [
      { key: 'prNumber',    label: 'PR#',          type: 'string', drillPage: 'purchaseRequisitionDetail', drillKey: 'prId' },
      { key: 'itemName',    label: 'Item',         type: 'string' },
      { key: 'quantity',    label: 'Qty',          type: 'number' },
      { key: 'reason',      label: 'Reason',       type: 'string' },
      { key: 'notes',       label: 'Notes',        type: 'string' },
      { key: 'cancelledAt', label: 'Cancelled at', type: 'string' },
      { key: 'cancelledBy', label: 'Cancelled by', type: 'string' },
      { key: 'leadTime',    label: 'Open days',    type: 'number' }
    ],
    rows
  }));
}));

module.exports = router;
