'use strict';

/**
 * /api/vendor-scorecards — computed per-vendor performance metrics.
 *
 * Reads from:
 *   QA_VENDORS              — base list
 *   QA_RFQ_VENDORS          — invitations
 *   QA_RFQ_RESPONSES        — quotes received
 *   QA_RFQS                 — awards
 *   QA_GOODS_RECEIPTS       — actual deliveries (Module 3)
 *   QA_GOODS_RECEIPT_RETURNS — return events (Module 3)
 *
 * Computed metrics (all 0-1 ratios surfaced as percentages):
 *   responseRate     = responses / invitations
 *   winRate          = awards / responses (NaN if no responses)
 *   onTimePct        = receipts on/before committed deadline / total receipts
 *   leadTimeAvgDays  = mean(actual lead-time days)
 *   defectRatePct    = sum(qty_defective) / sum(qty_received)
 *   returnRatePct    = sum(qty_returned) / sum(qty_received)
 *   compositeScore   = weighted 0-100 (see WEIGHTS below)
 *
 * The composite formula weights the actual-delivery metrics most heavily
 * because they're the operational signal — response/win rates can be
 * gamed (vendor responds aggressively but delivers poorly). Adjust the
 * WEIGHTS constant if you want to re-balance.
 */

const express = require('express');
const { execute } = require('../db');
const { catchAsync } = require('../middleware/errorHandler');
const { authMiddleware, requirePermission } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(authMiddleware);

// ── Composite scoring weights ─────────────────────────────────────────
// Sum to 1.0. Tune here; the composite re-normalises itself if a metric
// is unavailable for a vendor (e.g. they've never been awarded → no
// on-time data → those weights redistribute to the remaining metrics).
const WEIGHTS = Object.freeze({
  onTime:     0.30,   // operational reliability
  defectFree: 0.25,   // quality
  leadTimeOk: 0.20,   // accuracy of their commitments
  returnFree: 0.10,   // post-receipt quality
  responsive: 0.10,   // RFQ engagement
  competitive:0.05    // win rate (price-competitive proxy)
});

function safePct(num, den) {
  if (!den || den <= 0) return null;
  return Math.max(0, Math.min(1, num / den));
}

/**
 * Compose 0-100 score from the per-vendor metrics. Missing metrics (null)
 * are dropped and weights renormalised. A vendor with no data scores
 * null (not 0 — the UI should show "Insufficient data" rather than
 * unfairly penalising a brand-new supplier).
 */
function compositeScore(m) {
  const components = [
    { weight: WEIGHTS.onTime,      value: m.onTimePct      },
    { weight: WEIGHTS.defectFree,  value: m.defectRatePct != null ? 1 - m.defectRatePct : null },
    { weight: WEIGHTS.leadTimeOk,  value: m.leadTimeAvgDays != null ? Math.max(0, 1 - Math.abs(m.leadTimeAvgDays) / 14) : null },
    { weight: WEIGHTS.returnFree,  value: m.returnRatePct != null ? 1 - m.returnRatePct : null },
    { weight: WEIGHTS.responsive,  value: m.responseRate   },
    { weight: WEIGHTS.competitive, value: m.winRate        }
  ].filter(c => c.value !== null && !Number.isNaN(c.value));

  if (components.length === 0) return null;
  const totalWeight = components.reduce((s, c) => s + c.weight, 0);
  const weighted    = components.reduce((s, c) => s + c.value * c.weight, 0);
  return Math.round((weighted / totalWeight) * 100);
}

/**
 * Compute metrics for a single vendor (or all, if vendorId omitted).
 * Returns a Map keyed by vendorId.
 */
async function computeMetrics(vendorId = null) {
  // 1. RFQ engagement (invitations / responses / wins)
  const engageSql = `
    SELECT v.VENDOR_ID,
           NVL(COUNT(DISTINCT rv.RFQ_ID), 0) AS INVITES,
           NVL(COUNT(DISTINCT rr.RFQ_ID), 0) AS RESPONSES,
           NVL(COUNT(DISTINCT CASE WHEN r.AWARDED_VENDOR_ID = v.VENDOR_ID THEN r.RFQ_ID END), 0) AS WINS
      FROM QA_VENDORS v
      LEFT JOIN QA_RFQ_VENDORS rv     ON rv.VENDOR_ID = v.VENDOR_ID
      LEFT JOIN QA_RFQ_RESPONSES rr   ON rr.VENDOR_ID = v.VENDOR_ID
      LEFT JOIN QA_RFQS r             ON r.AWARDED_VENDOR_ID = v.VENDOR_ID
     ${vendorId ? 'WHERE v.VENDOR_ID = :vid' : ''}
     GROUP BY v.VENDOR_ID
  `;
  const engageRes = await execute(engageSql, vendorId ? { vid: vendorId } : {}, { outFormat: 4002 });

  // 2. Receipts roll-up (qty + defect + return + on-time + lead time)
  const recSql = `
    SELECT gr.VENDOR_ID,
           COUNT(*) AS RECEIPT_COUNT,
           NVL(SUM(gr.QTY_RECEIVED), 0)   AS TOTAL_RECEIVED,
           NVL(SUM(gr.QTY_DEFECTIVE), 0)  AS TOTAL_DEFECTIVE,
           NVL(SUM(gr.QTY_RETURNED), 0)   AS TOTAL_RETURNED,
           AVG((CAST(gr.RECEIVED_DATE AS DATE) - CAST(r.AWARDED_AT AS DATE))) AS AVG_LEAD_DAYS,
           NVL(SUM(CASE WHEN rr.LEAD_TIME_DAYS IS NULL THEN 0
                        WHEN (CAST(gr.RECEIVED_DATE AS DATE) - CAST(r.AWARDED_AT AS DATE)) <= rr.LEAD_TIME_DAYS THEN 1
                        ELSE 0 END), 0) AS ON_TIME_COUNT,
           COUNT(CASE WHEN rr.LEAD_TIME_DAYS IS NOT NULL THEN 1 END) AS MEASURABLE_COUNT
      FROM QA_GOODS_RECEIPTS gr
      LEFT JOIN QA_RFQS r            ON r.RFQ_ID = gr.RFQ_ID
      LEFT JOIN QA_RFQ_RESPONSES rr  ON rr.RFQ_ID = gr.RFQ_ID AND rr.VENDOR_ID = gr.VENDOR_ID
     ${vendorId ? 'WHERE gr.VENDOR_ID = :vid' : 'WHERE gr.VENDOR_ID IS NOT NULL'}
     GROUP BY gr.VENDOR_ID
  `;
  const recRes = await execute(recSql, vendorId ? { vid: vendorId } : {}, { outFormat: 4002 });

  // 3. Vendor base data (name, category, rating)
  const baseSql = `SELECT VENDOR_ID, VENDOR_NAME, CATEGORY, STATUS, RATING, LEAD_TIME_DAYS
                     FROM QA_VENDORS
                    ${vendorId ? 'WHERE VENDOR_ID = :vid' : ''}`;
  const baseRes = await execute(baseSql, vendorId ? { vid: vendorId } : {}, { outFormat: 4002 });

  // Index lookups
  const recByVendor = new Map();
  for (const row of (recRes.rows || [])) {
    recByVendor.set(row.VENDOR_ID, row);
  }
  const engageByVendor = new Map();
  for (const row of (engageRes.rows || [])) {
    engageByVendor.set(row.VENDOR_ID, row);
  }

  // Assemble per-vendor scorecard
  const scorecards = (baseRes.rows || []).map(v => {
    const eng = engageByVendor.get(v.VENDOR_ID) || { INVITES: 0, RESPONSES: 0, WINS: 0 };
    const rec = recByVendor.get(v.VENDOR_ID)   || {};
    const totalReceived = Number(rec.TOTAL_RECEIVED || 0);
    const totalDefect   = Number(rec.TOTAL_DEFECTIVE || 0);
    const totalReturn   = Number(rec.TOTAL_RETURNED || 0);
    const onTimeCount   = Number(rec.ON_TIME_COUNT || 0);
    const measurable    = Number(rec.MEASURABLE_COUNT || 0);
    const avgLeadDays   = rec.AVG_LEAD_DAYS != null ? Number(rec.AVG_LEAD_DAYS) : null;

    const metrics = {
      receiptCount:    Number(rec.RECEIPT_COUNT || 0),
      totalReceived,
      totalDefect,
      totalReturn,
      invites:         Number(eng.INVITES   || 0),
      responses:       Number(eng.RESPONSES || 0),
      wins:            Number(eng.WINS      || 0),
      responseRate:    safePct(Number(eng.RESPONSES || 0), Number(eng.INVITES   || 0)),
      winRate:         safePct(Number(eng.WINS      || 0), Number(eng.RESPONSES || 0)),
      onTimePct:       safePct(onTimeCount, measurable),
      leadTimeAvgDays: avgLeadDays,
      defectRatePct:   safePct(totalDefect, totalReceived),
      returnRatePct:   safePct(totalReturn, totalReceived)
    };

    return {
      vendorId:     v.VENDOR_ID,
      vendorName:   v.VENDOR_NAME,
      category:     v.CATEGORY || '',
      status:       v.STATUS || 'active',
      rating:       Number(v.RATING || 0),
      committedLeadTimeDays: Number(v.LEAD_TIME_DAYS || 0),
      metrics,
      compositeScore: compositeScore(metrics)
    };
  });

  return scorecards;
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/vendor-scorecards — all vendors, ranked
// Returns the list sorted by compositeScore desc (null scores at bottom).
// ─────────────────────────────────────────────────────────────────────────
router.get('/', requirePermission('vendor_scorecard.read'), catchAsync(async (req, res) => {
  const cards = await computeMetrics();
  cards.sort((a, b) => {
    if (a.compositeScore == null && b.compositeScore == null) return 0;
    if (a.compositeScore == null) return 1;
    if (b.compositeScore == null) return -1;
    return b.compositeScore - a.compositeScore;
  });
  res.json({ success: true, data: cards });
}));

// ─────────────────────────────────────────────────────────────────────────
// GET /api/vendor-scorecards/:vendorId — single-vendor detail
// ─────────────────────────────────────────────────────────────────────────
router.get('/:vendorId', requirePermission('vendor_scorecard.read'), catchAsync(async (req, res) => {
  const cards = await computeMetrics(req.params.vendorId);
  if (!cards.length) {
    return res.status(404).json({ success: false, error: 'Vendor not found.' });
  }
  res.json({ success: true, data: cards[0] });
}));

module.exports = router;
