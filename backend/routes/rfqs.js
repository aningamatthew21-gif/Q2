'use strict';

const express = require('express');
const crypto = require('crypto');
const oracledb = require('oracledb');
const { execute, transaction } = require('../db');
const { catchAsync } = require('../middleware/errorHandler');
const {
  authMiddleware,
  requireRole,
  requirePermission,
  sodCheckRunner
} = require('../middleware/authMiddleware');
const { emitToAll } = require('../utils/socketEmitter');
const { sendRfqEmail } = require('../utils/email');
const { calculateVendorScores, DEFAULT_WEIGHTS } = require('../utils/vendorScoring');
const { notify } = require('../services/notificationService');
const { can } = require('../../shared/permissions.js');
const { validateAttachmentBuffer } = require('../utils/fileValidator');

// ── RFQ ownership (derived from linked PR assignments) ───────────────────
//
// An officer "owns" an RFQ if they are the current ASSIGNED_TO of at least
// one purchase requisition linked to the RFQ via QA_RFQ_LINE_ITEMS. This
// is derived ownership — there's no ASSIGNED_TO column on the RFQ itself.
//
// The advantage of deriving instead of storing: when the procurement head
// reassigns a PR (via PUT /purchase-requisitions/:id), the new officer
// automatically inherits access to any RFQ that PR is part of — without
// requiring a second "reassign the RFQ" action. Conversely, an officer
// who loses all their linked PRs to reassignment loses access naturally.
//
// PH / admin always bypass this check via `rfq.approve.award`. The
// ownership gate exists purely to protect officer-level actions
// (`rfq.response.log`, `rfq.send`, `rfq.recommend`, `rfq.escalate`) from
// being run by an officer who isn't actually working the RFQ.
async function getRfqAssignedOfficers(rfqId) {
  const r = await execute(
    `SELECT DISTINCT pr.ASSIGNED_TO AS OFFICER
       FROM QA_RFQ_LINE_ITEMS li
       JOIN QA_PURCHASE_REQUISITIONS pr ON pr.PR_ID = li.PR_ID
      WHERE li.RFQ_ID = :id AND pr.ASSIGNED_TO IS NOT NULL`,
    { id: rfqId }, { outFormat: 4002 }
  );
  return new Set((r.rows || []).map(row => row.OFFICER).filter(Boolean));
}

/**
 * Mirror an RFQ-scoped procurement event onto every PR linked to the RFQ.
 * Adds PR-scoped rows with EVENT_TYPE prefixed `PR_` (e.g. `PR_RFQ_SENT`)
 * so the PR's history panel reflects the full procurement timeline,
 * not just the create event. Pass an open `conn` to keep this inside
 * the caller's transaction.
 *
 * Without this mirror the PR history is misleading: a PR can be sitting
 * in `IN_RFQ` for days, the RFQ goes through send → responses → award,
 * and the PR's history panel still shows nothing but "PR_CREATED".
 */
async function mirrorRfqEventToPrs(connOrNull, rfqId, eventType, actor, payload = {}) {
  if (!rfqId || !eventType) return;
  // Map RFQ event types to the PR-scoped equivalent. Keep the mapping
  // small + explicit so future event types are an obvious add here.
  const PR_EVENT_TYPE = {
    'RFQ_CREATED':            'PR_RFQ_CREATED',
    'RFQ_SENT':               'PR_RFQ_SENT',
    'RFQ_RESPONSE_LOGGED':    'PR_RFQ_RESPONSE_LOGGED',
    'RFQ_RECOMMENDED':        'PR_RECOMMENDATION_MADE',
    'RFQ_PENDING_APPROVAL':   'PR_PENDING_AWARD_APPROVAL',
    'RFQ_CONTROLLER_REJECTED':'PR_RECOMMENDATION_REJECTED',
    'RFQ_AWARDED':            'PR_AWARDED',
    'RFQ_CONTROLLER_APPROVED':'PR_AWARDED',
    'RFQ_CANCELLED':          'PR_RFQ_CANCELLED'
  }[eventType];
  if (!PR_EVENT_TYPE) return; // event type we don't mirror

  // Accept both a transaction connection (callers inside `transaction()`)
  // and `null` (callers that already auto-committed their main event row
  // via plain `execute`). The mirror rows are audit data; we don't insist
  // they be atomic with the main event for non-transactional callers.
  const exec = connOrNull
    ? (sql, binds, opts) => connOrNull.execute(sql, binds, opts)
    : (sql, binds, opts) => execute(sql, binds, opts);

  const linkedRes = await exec(
    `SELECT DISTINCT PR_ID FROM QA_RFQ_LINE_ITEMS WHERE RFQ_ID = :rid`,
    { rid: rfqId }, { outFormat: 4002 }
  );
  const payloadStr = JSON.stringify({ ...payload, rfqId });
  for (const row of (linkedRes.rows || [])) {
    try {
      await exec(
        `INSERT INTO QA_PROCUREMENT_EVENTS (EVENT_TYPE, ENTITY_TYPE, ENTITY_ID, ACTOR, PAYLOAD)
         VALUES (:et, 'PR', :pid, :actor, :payload)`,
        { et: PR_EVENT_TYPE, pid: row.PR_ID, actor, payload: payloadStr }
      );
    } catch (e) {
      // Don't fail the parent transaction just because a mirror row didn't insert
      console.error(`[mirrorRfqEventToPrs] failed for PR=${row.PR_ID}:`, e.message);
    }
  }
}

// Middleware: gate the request behind RFQ ownership for officer-level
// actions. PH/admin bypass automatically. Must run AFTER requirePermission
// so the permission catalogue is the first line of defence.
function requireRfqOwnership(req, res, next) {
  // PH / admin / anyone with award authority bypasses ownership entirely —
  // by definition they can act on any RFQ regardless of who's assigned.
  if (can(req.user.role, 'rfq.approve.award')) return next();

  const rfqId = req.params.id;
  if (!rfqId) {
    return res.status(400).json({ success: false, error: 'RFQ id is required.' });
  }

  getRfqAssignedOfficers(rfqId)
    .then(officers => {
      if (officers.has(req.user.email)) return next();
      return res.status(403).json({
        success: false,
        error: "This RFQ isn't linked to a purchase requisition currently assigned to you. Ask the procurement head to reassign a linked PR to you before working on it."
      });
    })
    .catch(err => {
      console.error('[requireRfqOwnership] check failed:', err);
      return res.status(500).json({ success: false, error: 'Ownership check failed.' });
    });
}

/**
 * Recompute taxes from the stored TAX_BREAKDOWN CLOB rates rather than using
 * the taxes/subtotal ratio (which breaks when original subtotal is 0, e.g. Pending Pricing invoices).
 * Falls back to ratio method if TAX_BREAKDOWN is missing or unparseable.
 */
function recomputeTaxesFromBreakdown(newSubtotal, taxBreakdownJson, oldTaxes, oldSubtotal) {
  try {
    const breakdown = typeof taxBreakdownJson === 'string'
      ? JSON.parse(taxBreakdownJson)
      : (taxBreakdownJson || []);

    if (Array.isArray(breakdown) && breakdown.length > 0) {
      // Each entry: { label, rate, amount } — recalculate amounts from rate × newSubtotal
      let running = newSubtotal;
      let totalTax = 0;
      for (const entry of breakdown) {
        const rate = Number(entry.rate || 0) / 100;
        const taxAmt = Number((running * rate).toFixed(4));
        totalTax += taxAmt;
        running += taxAmt; // cascading (COVID levy applies to subtotal+NHIL+GETFund)
      }
      return Number(totalTax.toFixed(4));
    }
  } catch (_) { /* fall through */ }

  // Fallback: ratio method (safe for non-zero original subtotals)
  const taxRatio = oldSubtotal > 0 ? oldTaxes / oldSubtotal : 0;
  return Number((newSubtotal * taxRatio).toFixed(4));
}

const router = express.Router();
router.use(authMiddleware);

/**
 * Phase 4 (Quote Re-Approval Loop) added four columns to QA_INVOICES:
 * ORIGINAL_ESTIMATE, REQUIRES_REAPPROVAL, REAPPROVAL_VARIANCE, REAPPROVAL_REASON.
 *
 * If the deployment hasn't yet run `node backend/migrate_procurement_schema.js`
 * since those steps were added, the columns don't exist and any SQL referencing
 * them throws ORA-00904 ("invalid identifier") — surfacing to the frontend as
 * a generic 500. This guard checks once at first call and adapts the approve
 * flow so it works on both old and new schemas. The check is cached for the
 * process lifetime; if the migration is later run, the server picks up the
 * new columns on next restart.
 */
let _phase4ColumnsAvailable = null;
async function hasPhase4Columns() {
  if (_phase4ColumnsAvailable !== null) return _phase4ColumnsAvailable;
  try {
    const r = await execute(
      `SELECT COUNT(*) AS C FROM USER_TAB_COLUMNS
        WHERE TABLE_NAME = 'QA_INVOICES'
          AND COLUMN_NAME IN ('ORIGINAL_ESTIMATE','REQUIRES_REAPPROVAL','REAPPROVAL_VARIANCE','REAPPROVAL_REASON')`,
      {},
      { outFormat: 4002 }
    );
    _phase4ColumnsAvailable = Number(r.rows?.[0]?.C || 0) >= 4;
    if (!_phase4ColumnsAvailable) {
      console.warn(
        '[rfqs] Phase 4 reapproval columns missing on QA_INVOICES. ' +
        'Run `node backend/migrate_procurement_schema.js` to enable variance-based reapproval. ' +
        'Approve flow will fall back to the legacy UPDATE without those columns.'
      );
    }
    return _phase4ColumnsAvailable;
  } catch (err) {
    console.warn('[rfqs] Phase 4 column probe failed; assuming legacy schema:', err.message);
    _phase4ColumnsAvailable = false;
    return false;
  }
}

const rowToRFQ = (row) => {
  const activeStatuses = ['SENT', 'RECEIVING', 'COMPARING'];
  const isActive = activeStatuses.includes(row.STATUS);
  const now = new Date();

  // Past-deadline if an active RFQ has a submission deadline in the past
  let isPastDeadline = false;
  if (isActive && row.SUBMISSION_DEADLINE) {
    const deadline = new Date(row.SUBMISSION_DEADLINE);
    if (!Number.isNaN(deadline.getTime())) {
      isPastDeadline = deadline.getTime() < now.getTime();
    }
  }

  // Days the RFQ has been open (rounded down). Useful for staleness cues.
  let daysOpen = null;
  if (row.CREATED_AT) {
    const created = new Date(row.CREATED_AT);
    if (!Number.isNaN(created.getTime())) {
      daysOpen = Math.floor((now.getTime() - created.getTime()) / (24 * 60 * 60 * 1000));
    }
  }

  return {
    id: row.RFQ_ID,
    rfqNumber: row.RFQ_NUMBER || '',
    title: row.TITLE || '',
    status: row.STATUS,
    submissionDeadline: row.SUBMISSION_DEADLINE || '',
    deliveryDeadline: row.DELIVERY_DEADLINE || '',
    awardedVendorId: row.AWARDED_VENDOR_ID || '',
    awardedAt: row.AWARDED_AT,
    awardedBy: row.AWARDED_BY || '',
    totalAwardAmount: Number(row.TOTAL_AWARD_AMOUNT || 0),
    currency: row.CURRENCY || 'GHS',
    notes: row.NOTES || '',
    createdBy: row.CREATED_BY || '',
    createdAt: row.CREATED_AT,
    updatedAt: row.UPDATED_AT,
    // Phase 3 — recommendation + approval metadata
    recommendedVendorId: row.RECOMMENDED_VENDOR_ID || '',
    recommendationScore: row.RECOMMENDATION_SCORE != null ? Number(row.RECOMMENDATION_SCORE) : null,
    recommendationReason: row.RECOMMENDATION_REASON || '',
    recommendedBy: row.RECOMMENDED_BY || '',
    recommendedAt: row.RECOMMENDED_AT,
    allowPartial: row.ALLOW_PARTIAL === 1,
    approvedBy: row.APPROVED_BY || '',
    approvedAt: row.APPROVED_AT,
    // Phase 5 — risk / escalation surface
    lastStalenessCheckAt: row.LAST_STALENESS_CHECK_AT || null,
    escalatedAt: row.ESCALATED_AT || null,
    escalatedTo: row.ESCALATED_TO || '',
    escalationReason: row.ESCALATION_REASON || '',
    isPastDeadline,
    isEscalated: !!row.ESCALATED_AT,
    daysOpen
  };
};

/**
 * GET /api/rfqs
 * List with optional status filter — includes vendor_count, response_count, items_count
 */
router.get('/', catchAsync(async (req, res) => {
  const { status } = req.query;
  // The ASSIGNED_OFFICERS subquery materialises the derived ownership for
  // each RFQ — comma-joined list of distinct PR assignees. The inner
  // SELECT DISTINCT pre-deduplicates so the outer LISTAGG works on Oracle
  // 11g+ (LISTAGG DISTINCT only landed in 19c). Empty string when no PRs
  // are linked or none have assignees.
  let sql = `
    SELECT r.*,
      (SELECT COUNT(*) FROM QA_RFQ_VENDORS rv WHERE rv.RFQ_ID = r.RFQ_ID) AS VENDOR_COUNT,
      (SELECT COUNT(DISTINCT rr.VENDOR_ID) FROM QA_RFQ_RESPONSES rr WHERE rr.RFQ_ID = r.RFQ_ID) AS RESPONSE_COUNT,
      (SELECT COUNT(*) FROM QA_RFQ_LINE_ITEMS li WHERE li.RFQ_ID = r.RFQ_ID) AS ITEMS_COUNT,
      (SELECT LISTAGG(officer, ',') WITHIN GROUP (ORDER BY officer)
         FROM (
           SELECT DISTINCT pr.ASSIGNED_TO AS officer
             FROM QA_RFQ_LINE_ITEMS li
             JOIN QA_PURCHASE_REQUISITIONS pr ON pr.PR_ID = li.PR_ID
            WHERE li.RFQ_ID = r.RFQ_ID AND pr.ASSIGNED_TO IS NOT NULL
         )) AS ASSIGNED_OFFICERS
    FROM QA_RFQS r WHERE 1=1`;
  const binds = {};
  if (status) {
    sql += ' AND r.STATUS = :status';
    binds.status = status;
  }
  sql += ' ORDER BY r.CREATED_AT DESC';
  const result = await execute(sql, binds);
  res.json({
    success: true,
    data: (result.rows || []).map(row => ({
      ...rowToRFQ(row),
      vendorCount:      Number(row.VENDOR_COUNT   || 0),
      responseCount:    Number(row.RESPONSE_COUNT || 0),
      itemsCount:       Number(row.ITEMS_COUNT    || 0),
      assignedOfficers: row.ASSIGNED_OFFICERS
        ? String(row.ASSIGNED_OFFICERS).split(',').map(s => s.trim()).filter(Boolean)
        : []
    }))
  });
}));

/**
 * GET /api/rfqs/:id
 * Single RFQ with line items, vendors, responses
 */
router.get('/:id', catchAsync(async (req, res) => {
  const { id } = req.params;
  const rfqRes = await execute('SELECT * FROM QA_RFQS WHERE RFQ_ID = :id', { id });
  if (!rfqRes.rows || rfqRes.rows.length === 0) {
    return res.status(404).json({ success: false, error: 'RFQ not found' });
  }
  const rfq = rowToRFQ(rfqRes.rows[0]);

  const liRes = await execute(
    `SELECT li.RFQ_LINE_ID, li.PR_ID, li.ITEM_NAME, li.QUANTITY, li.SORT_ORDER,
            pr.PR_NUMBER, pr.UOM, pr.STATUS AS PR_STATUS, pr.INVOICE_ID, pr.QUOTE_LINE_MATCH_KEY
     FROM QA_RFQ_LINE_ITEMS li
     JOIN QA_PURCHASE_REQUISITIONS pr ON pr.PR_ID = li.PR_ID
     WHERE li.RFQ_ID = :id
     ORDER BY li.SORT_ORDER ASC`,
    { id }
  );
  const lineItems = (liRes.rows || []).map(r => ({
    rfqLineId: r.RFQ_LINE_ID,
    prId: r.PR_ID,
    prNumber: r.PR_NUMBER,
    itemName: r.ITEM_NAME,
    quantity: Number(r.QUANTITY || 0),
    uom: r.UOM || 'EA',
    prStatus: r.PR_STATUS,
    invoiceId: r.INVOICE_ID,
    matchKey: r.QUOTE_LINE_MATCH_KEY
  }));

  const venRes = await execute(
    `SELECT rv.RFQ_VENDOR_ID, rv.VENDOR_ID, rv.EMAIL_SENT_AT, rv.RESPONSE_STATUS,
            v.VENDOR_NAME, v.CONTACT_EMAIL, v.CONTACT_PERSON, v.CONTACT_PHONE,
            v.ADDRESS, v.RATING, v.LEAD_TIME_DAYS
     FROM QA_RFQ_VENDORS rv
     JOIN QA_VENDORS v ON v.VENDOR_ID = rv.VENDOR_ID
     WHERE rv.RFQ_ID = :id`,
    { id }
  );
  const vendors = (venRes.rows || []).map(r => ({
    rfqVendorId: r.RFQ_VENDOR_ID,
    vendorId: r.VENDOR_ID,
    vendorName: r.VENDOR_NAME,
    contactEmail: r.CONTACT_EMAIL,
    contactPerson: r.CONTACT_PERSON || '',
    contactPhone: r.CONTACT_PHONE || '',
    address: r.ADDRESS || '',
    rating: Number(r.RATING || 0),
    leadTimeDays: Number(r.LEAD_TIME_DAYS || 0),
    emailSentAt: r.EMAIL_SENT_AT,
    responseStatus: r.RESPONSE_STATUS
  }));

  const respRes = await execute(
    `SELECT * FROM QA_RFQ_RESPONSES WHERE RFQ_ID = :id ORDER BY LOGGED_AT DESC`,
    { id }
  );
  const responses = (respRes.rows || []).map(r => ({
    id: r.RESPONSE_ID,
    vendorId: r.VENDOR_ID,
    prId: r.PR_ID,
    unitCost: Number(r.UNIT_COST || 0),
    quantity: Number(r.QUANTITY || 0),
    totalCost: Number(r.TOTAL_COST || 0),
    currency: r.CURRENCY,
    leadTimeDays: Number(r.LEAD_TIME_DAYS || 0),
    freight: Number(r.FREIGHT || 0),
    deliveryTerms: r.DELIVERY_TERMS || '',
    paymentTerms: r.PAYMENT_TERMS || '',
    validityDays: Number(r.VALIDITY_DAYS || 0),
    notes: r.NOTES || '',
    isWinner: r.IS_WINNER === 1,
    loggedBy: r.LOGGED_BY || '',
    loggedAt: r.LOGGED_AT,
    receivedDate: r.RECEIVED_DATE || ''
  }));

  // Derived ownership — the set of officers currently assigned to any PR
  // linked to this RFQ. Frontend uses it to compute `isMine` and to render
  // the "Yours" pill on the list view.
  const assignedOfficers = Array.from(await getRfqAssignedOfficers(id));

  // ── Last rejection (Module 3 visibility) ────────────────────────────
  // When the head rejected a recommendation, the rfq.status flips back
  // to RECEIVING and the reason is captured in a RFQ_CONTROLLER_REJECTED
  // event payload. Surface the most-recent one so the RFQ detail page
  // can render a clear banner explaining WHY it came back. Only the
  // latest matters (subsequent re-recommendations supersede earlier ones).
  let lastRejection = null;
  try {
    const rejRes = await execute(
      `SELECT EVENT_TIME, ACTOR, PAYLOAD
         FROM QA_PROCUREMENT_EVENTS
        WHERE ENTITY_TYPE = 'RFQ'
          AND ENTITY_ID = :id
          AND EVENT_TYPE = 'RFQ_CONTROLLER_REJECTED'
        ORDER BY EVENT_TIME DESC
        FETCH FIRST 1 ROWS ONLY`,
      { id }, { outFormat: 4002 }
    );
    const rejRow = rejRes.rows?.[0];
    if (rejRow) {
      let reason = '';
      try { reason = (JSON.parse(rejRow.PAYLOAD || '{}')).reason || ''; } catch (_e) { /* ignore */ }
      lastRejection = {
        rejectedAt: rejRow.EVENT_TIME,
        rejectedBy: rejRow.ACTOR,
        reason
      };
      // Suppress the banner if a newer RECOMMENDED event came after the
      // rejection (officer already re-recommended). Compare timestamps.
      const newRecRes = await execute(
        `SELECT 1 FROM QA_PROCUREMENT_EVENTS
          WHERE ENTITY_TYPE = 'RFQ'
            AND ENTITY_ID = :id
            AND EVENT_TYPE = 'RFQ_RECOMMENDED'
            AND EVENT_TIME > :ts
          FETCH FIRST 1 ROWS ONLY`,
        { id, ts: rejRow.EVENT_TIME }
      );
      if (newRecRes.rows?.length > 0) {
        lastRejection = null;
      }
    }
  } catch (_e) {
    // Best-effort — banner just doesn't render
  }

  // ── Attachment counts per vendor (Module 3 add-on) ──────────────────
  // Drives the PDF-button visibility in the comparison matrix without
  // sending the full attachment payloads down. Frontend fetches the
  // full metadata list only when the user clicks Download.
  const attCountRes = await execute(
    `SELECT VENDOR_ID, COUNT(*) AS C
       FROM QA_RFQ_RESPONSE_ATTACHMENTS
      WHERE RFQ_ID = :id
      GROUP BY VENDOR_ID`,
    { id }, { outFormat: 4002 }
  );
  const attachmentCounts = {};
  for (const row of (attCountRes.rows || [])) {
    attachmentCounts[row.VENDOR_ID] = Number(row.C || 0);
  }

  res.json({
    success: true,
    data: { ...rfq, lineItems, vendors, responses, assignedOfficers, lastRejection, attachmentCounts }
  });
}));

/**
 * GET /api/rfqs/:id/recommendation
 * Returns the multi-criteria scoring recommendation for an RFQ.
 * Reads weights from QA_PROCUREMENT_SETTINGS (with safe defaults if rows missing).
 */
router.get('/:id/recommendation', catchAsync(async (req, res) => {
  const { id } = req.params;

  // Fetch RFQ + vendors + responses + line items in parallel
  const [rfqRes, liRes, venRes, respRes, settingsRes] = await Promise.all([
    execute('SELECT * FROM QA_RFQS WHERE RFQ_ID = :id', { id }),
    execute(
      `SELECT li.RFQ_LINE_ID, li.PR_ID, li.ITEM_NAME, li.QUANTITY,
              pr.PR_NUMBER, pr.UOM
       FROM QA_RFQ_LINE_ITEMS li
       JOIN QA_PURCHASE_REQUISITIONS pr ON pr.PR_ID = li.PR_ID
       WHERE li.RFQ_ID = :id`,
      { id }
    ),
    execute(
      `SELECT rv.VENDOR_ID, v.VENDOR_NAME, v.RATING, v.LEAD_TIME_DAYS, v.PAYMENT_TERMS
       FROM QA_RFQ_VENDORS rv
       JOIN QA_VENDORS v ON v.VENDOR_ID = rv.VENDOR_ID
       WHERE rv.RFQ_ID = :id`,
      { id }
    ),
    execute('SELECT * FROM QA_RFQ_RESPONSES WHERE RFQ_ID = :id', { id }),
    execute(`SELECT SETTING_KEY, SETTING_VAL FROM QA_PROCUREMENT_SETTINGS WHERE SETTING_KEY LIKE 'scoreWeight%'`)
  ]);

  if (!rfqRes.rows || rfqRes.rows.length === 0) {
    return res.status(404).json({ success: false, error: 'RFQ not found' });
  }

  // Build the rfq shape that calculateVendorScores expects
  const rfq = {
    lineItems: (liRes.rows || []).map(r => ({
      prId: r.PR_ID,
      itemName: r.ITEM_NAME,
      quantity: Number(r.QUANTITY || 0)
    })),
    vendors: (venRes.rows || []).map(r => ({
      vendorId: r.VENDOR_ID,
      vendorName: r.VENDOR_NAME,
      rating: Number(r.RATING || 0),
      leadTimeDays: Number(r.LEAD_TIME_DAYS || 0),
      paymentTerms: r.PAYMENT_TERMS || ''
    })),
    responses: (respRes.rows || []).map(r => ({
      vendorId: r.VENDOR_ID,
      prId: r.PR_ID,
      unitCost: Number(r.UNIT_COST || 0),
      quantity: Number(r.QUANTITY || 0),
      freight: Number(r.FREIGHT || 0),
      leadTimeDays: Number(r.LEAD_TIME_DAYS || 0),
      paymentTerms: r.PAYMENT_TERMS || ''
    }))
  };

  // Resolve weights from settings, falling back to defaults
  const settingsMap = {};
  for (const row of (settingsRes.rows || [])) {
    settingsMap[row.SETTING_KEY] = Number(row.SETTING_VAL);
  }
  const weights = {
    price:        Number.isFinite(settingsMap.scoreWeightPrice)        ? settingsMap.scoreWeightPrice        : DEFAULT_WEIGHTS.price,
    leadTime:     Number.isFinite(settingsMap.scoreWeightLeadTime)     ? settingsMap.scoreWeightLeadTime     : DEFAULT_WEIGHTS.leadTime,
    rating:       Number.isFinite(settingsMap.scoreWeightRating)       ? settingsMap.scoreWeightRating       : DEFAULT_WEIGHTS.rating,
    paymentTerms: Number.isFinite(settingsMap.scoreWeightPaymentTerms) ? settingsMap.scoreWeightPaymentTerms : DEFAULT_WEIGHTS.paymentTerms,
    coverage:     Number.isFinite(settingsMap.scoreWeightCoverage)     ? settingsMap.scoreWeightCoverage     : DEFAULT_WEIGHTS.coverage
  };

  const result = calculateVendorScores(rfq, weights);
  res.json({ success: true, data: result });
}));

/**
 * POST /api/rfqs
 * Create new RFQ. Body: { title, prIds[], vendorIds[], submissionDeadline, deliveryDeadline, notes, currency }
 */
router.post('/', requirePermission('rfq.create'), catchAsync(async (req, res) => {
  const { title, prIds = [], vendorIds = [], submissionDeadline, deliveryDeadline, notes, currency } = req.body || {};

  if (!prIds.length) {
    return res.status(400).json({ success: false, error: 'At least one PR is required' });
  }
  if (!vendorIds.length) {
    return res.status(400).json({ success: false, error: 'At least one vendor is required' });
  }

  const id = `RFQ-${crypto.randomUUID()}`;
  const seqRes = await execute('SELECT QA_RFQ_SEQ.NEXTVAL AS N FROM DUAL');
  const seqNum = seqRes.rows[0].N;
  const rfqNumber = `RFQ-${new Date().getFullYear()}-${String(seqNum).padStart(4, '0')}`;

  // Pull the PR rows we need to project as line items
  const prRowsRes = await execute(
    `SELECT PR_ID, ITEM_NAME, QUANTITY FROM QA_PURCHASE_REQUISITIONS
     WHERE PR_ID IN (${prIds.map((_, i) => `:p${i}`).join(',')})`,
    Object.fromEntries(prIds.map((p, i) => [`p${i}`, p]))
  );
  const prRows = prRowsRes.rows || [];

  await transaction(async (conn) => {
    await conn.execute(`
      INSERT INTO QA_RFQS (
        RFQ_ID, RFQ_NUMBER, TITLE, STATUS, SUBMISSION_DEADLINE, DELIVERY_DEADLINE,
        CURRENCY, NOTES, CREATED_BY
      ) VALUES (
        :id, :rn, :ti, 'DRAFT', :sd, :dd, :curr, :notes, :cb
      )
    `, {
      id,
      rn: rfqNumber,
      ti: title || rfqNumber,
      sd: submissionDeadline || null,
      dd: deliveryDeadline || null,
      curr: currency || 'GHS',
      notes: notes || null,
      cb: req.user.email
    });

    // Insert line items + flip PR status to IN_RFQ
    for (let i = 0; i < prRows.length; i++) {
      const r = prRows[i];
      await conn.execute(
        `INSERT INTO QA_RFQ_LINE_ITEMS (RFQ_ID, PR_ID, ITEM_NAME, QUANTITY, SORT_ORDER)
         VALUES (:rid, :pid, :inm, :qty, :so)`,
        { rid: id, pid: r.PR_ID, inm: r.ITEM_NAME, qty: Number(r.QUANTITY || 1), so: i }
      );
      await conn.execute(
        `UPDATE QA_PURCHASE_REQUISITIONS SET STATUS = 'IN_RFQ', UPDATED_AT = SYSTIMESTAMP WHERE PR_ID = :pid`,
        { pid: r.PR_ID }
      );
    }

    // Insert vendors
    for (const vid of vendorIds) {
      await conn.execute(
        `INSERT INTO QA_RFQ_VENDORS (RFQ_ID, VENDOR_ID) VALUES (:rid, :vid)`,
        { rid: id, vid }
      );
    }

    await conn.execute(`
      INSERT INTO QA_PROCUREMENT_EVENTS (EVENT_TYPE, ENTITY_TYPE, ENTITY_ID, ACTOR, PAYLOAD)
      VALUES ('RFQ_CREATED','RFQ',:id,:actor,:payload)
    `, { id, actor: req.user.email, payload: JSON.stringify({ prIds, vendorIds, rfqNumber }) });

    // Mirror to PR history so each linked PR records "moved into this RFQ"
    await mirrorRfqEventToPrs(conn, id, 'RFQ_CREATED', req.user.email, { rfqNumber });
  });

  emitToAll('rfq:updated');
  emitToAll('pr:updated');
  emitToAll('invoices:updated'); // X-4: invoice sourcing status may change appearance
  res.json({ success: true, id, rfqNumber });
}));

/**
 * POST /api/rfqs/:id/send
 * Email all vendors for this RFQ. Sets status SENT.
 */
router.post('/:id/send', requirePermission('rfq.send'), requireRfqOwnership, catchAsync(async (req, res) => {
  const { id } = req.params;

  // Build all the data needed to email
  const rfqRes = await execute('SELECT * FROM QA_RFQS WHERE RFQ_ID = :id', { id });
  if (!rfqRes.rows[0]) return res.status(404).json({ success: false, error: 'RFQ not found' });
  const rfq = rowToRFQ(rfqRes.rows[0]);

  const liRes = await execute(
    `SELECT li.ITEM_NAME, li.QUANTITY, pr.UOM
     FROM QA_RFQ_LINE_ITEMS li
     JOIN QA_PURCHASE_REQUISITIONS pr ON pr.PR_ID = li.PR_ID
     WHERE li.RFQ_ID = :id ORDER BY li.SORT_ORDER`,
    { id }
  );
  const lineItems = (liRes.rows || []).map(r => ({
    itemName: r.ITEM_NAME,
    quantity: Number(r.QUANTITY || 1),
    uom: r.UOM || 'EA'
  }));

  const venRes = await execute(
    `SELECT rv.RFQ_VENDOR_ID, rv.VENDOR_ID, v.VENDOR_NAME, v.CONTACT_EMAIL
     FROM QA_RFQ_VENDORS rv
     JOIN QA_VENDORS v ON v.VENDOR_ID = rv.VENDOR_ID
     WHERE rv.RFQ_ID = :id`,
    { id }
  );

  const sendResults = [];
  for (const vRow of (venRes.rows || [])) {
    if (!vRow.CONTACT_EMAIL) {
      sendResults.push({ vendorId: vRow.VENDOR_ID, sent: false, error: 'No email on file' });
      continue;
    }
    try {
      const info = await sendRfqEmail({
        toEmail: vRow.CONTACT_EMAIL,
        vendorName: vRow.VENDOR_NAME,
        rfqNumber: rfq.rfqNumber,
        deadline: rfq.submissionDeadline || '—',
        lineItems,
        replyToEmail: req.user.email,
        notes: rfq.notes
      });
      await execute(
        `UPDATE QA_RFQ_VENDORS
         SET EMAIL_SENT_AT = SYSTIMESTAMP, EMAIL_MESSAGE_ID = :mid
         WHERE RFQ_VENDOR_ID = :rvid`,
        { mid: info.messageId, rvid: vRow.RFQ_VENDOR_ID }
      );
      sendResults.push({
        vendorId: vRow.VENDOR_ID,
        vendorName: vRow.VENDOR_NAME,
        sent: true,
        messageId: info.messageId
      });
    } catch (err) {
      console.error(`RFQ email failed for ${vRow.VENDOR_ID}:`, err.message);
      sendResults.push({
        vendorId: vRow.VENDOR_ID,
        vendorName: vRow.VENDOR_NAME,
        sent: false,
        error: err.message
      });
    }
  }

  // M9 — surface failures in audit trail so they don't disappear silently
  const failed = sendResults.filter(r => !r.sent);
  if (failed.length > 0) {
    try {
      await execute(`
        INSERT INTO QA_AUDIT_LOGS
          (USER_ID, ACTION, DETAILS, CATEGORY, EXTRA_DATA, ENTITY_TYPE, ENTITY_ID, SEVERITY, OUTCOME)
        VALUES
          (:u_id, :act, :det, 'rfq', :ext, 'RFQ', :eid, 'warning', 'partial')
      `, {
        u_id: req.user.email,
        act: 'RFQ Email Send Failures',
        det: `${failed.length} of ${sendResults.length} vendor email(s) failed to send for ${rfq.rfqNumber}`,
        ext: JSON.stringify({ failed }).substring(0, 3900),
        eid: id
      });
    } catch (auditErr) {
      console.error('[rfqs] audit-log for send failures failed:', auditErr.message);
    }
  }

  await execute(
    `UPDATE QA_RFQS SET STATUS = 'SENT', UPDATED_AT = SYSTIMESTAMP WHERE RFQ_ID = :id`,
    { id }
  );
  await execute(`
    INSERT INTO QA_PROCUREMENT_EVENTS (EVENT_TYPE, ENTITY_TYPE, ENTITY_ID, ACTOR, PAYLOAD)
    VALUES ('RFQ_SENT','RFQ',:id,:actor,:payload)
  `, { id, actor: req.user.email, payload: JSON.stringify({ sendResults }) });
  await mirrorRfqEventToPrs(null, id, 'RFQ_SENT', req.user.email, { vendorCount: sendResults.length });

  emitToAll('rfq:updated');
  res.json({ success: true, sendResults });
}));

/**
 * POST /api/rfqs/:id/responses
 * Manually log a vendor response (one row per PR per vendor)
 * Body: { vendorId, prId, unitCost, quantity, leadTimeDays, freight, deliveryTerms, paymentTerms, validityDays, currency, notes, receivedDate }
 */
router.post('/:id/responses', requirePermission('rfq.response.log'), requireRfqOwnership, catchAsync(async (req, res) => {
  const { id } = req.params;
  const r = req.body || {};
  if (!r.vendorId || !r.prId) {
    return res.status(400).json({ success: false, error: 'vendorId and prId are required' });
  }
  const qty = Number(r.quantity || 1);
  const unit = Number(r.unitCost || 0);
  const total = unit * qty + Number(r.freight || 0);

  // ── Edit-mode detection ─────────────────────────────────────────────
  // The frontend's "Log" button is shown on every row of the comparison
  // matrix, including vendors who've already responded. When the user
  // clicks Log on an already-responded vendor they're editing — so we
  // delete the existing rows for (rfq, vendor, pr) before inserting,
  // making the call an upsert semantically. (Multiple rows could exist
  // if the vendor responded for multiple PRs — we only delete the row
  // for THIS pr to keep the others intact.)
  await transaction(async (conn) => {
    await conn.execute(
      `DELETE FROM QA_RFQ_RESPONSES
        WHERE RFQ_ID = :rid AND VENDOR_ID = :vid AND PR_ID = :pid`,
      { rid: id, vid: r.vendorId, pid: r.prId }
    );

    await conn.execute(`
      INSERT INTO QA_RFQ_RESPONSES (
        RFQ_ID, VENDOR_ID, PR_ID, UNIT_COST, QUANTITY, TOTAL_COST, CURRENCY,
        LEAD_TIME_DAYS, FREIGHT, DELIVERY_TERMS, PAYMENT_TERMS, VALIDITY_DAYS,
        NOTES, LOGGED_BY, RECEIVED_DATE
      ) VALUES (
        :rid, :vid, :pid, :uc, :qty, :tc, :curr,
        :lt, :fr, :dt, :pt, :vd,
        :notes, :lb, :rd
      )
    `, {
      rid: id,
      vid: r.vendorId,
      pid: r.prId,
      uc: unit,
      qty,
      tc: total,
      curr: r.currency || 'GHS',
      lt: Number(r.leadTimeDays || 0),
      fr: Number(r.freight || 0),
      dt: r.deliveryTerms || null,
      pt: r.paymentTerms || null,
      vd: Number(r.validityDays || 30),
      notes: r.notes || null,
      lb: req.user.email,
      rd: r.receivedDate || null
    });

    // ── Attachments (Module 3 add-on) ─────────────────────────────
    // Frontend sends attachments on the FIRST line of a batched save
    // only (i === 0 in LogVendorResponseModal). We REPLACE existing
    // attachments for this (rfq, vendor) when a new non-empty array
    // arrives so the user can curate the file list in edit mode.
    // Empty arrays are no-ops (preserves the existing attachments
    // when the user is only editing line costs).
    const attachments = Array.isArray(r.attachments) ? r.attachments : [];
    if (attachments.length > 0) {
      await conn.execute(
        `DELETE FROM QA_RFQ_RESPONSE_ATTACHMENTS WHERE RFQ_ID = :rid AND VENDOR_ID = :vid`,
        { rid: id, vid: r.vendorId }
      );
      for (const att of attachments) {
        if (!att || !att.dataUrl || !att.name) continue;

        // Decode the base64 data URL into a raw Buffer so we can stream
        // straight into a BLOB column. Storing binary files as base64
        // text in a CLOB was the previous approach and it silently
        // corrupted everything: oracledb v6 treats `{ val: str, type:
        // oracledb.CLOB }` as a temp-LOB descriptor (val should be a
        // Lob or Buffer), so passing a plain string falls back to
        // String(bindObj) → "[object Object]". 15 chars per row, every
        // PDF destroyed. BLOB + Buffer is the canonical pattern.
        const raw     = String(att.dataUrl || '');
        const cIdx    = raw.indexOf(',');
        const looks   = raw.startsWith('data:') && cIdx > 0 && cIdx < 200;
        const b64     = (looks ? raw.slice(cIdx + 1) : raw).replace(/[\s\r\n]/g, '');
        const buffer  = Buffer.from(b64, 'base64');

        // ── OWASP File Upload Cheat Sheet 2025 / ISO 27001 A.8.7 ──────
        // Defence-in-depth: verify the bytes are actually the file type
        // the client claims, AND under our 10 MB cap, AND on our MIME
        // allowlist. Rejects payloads where someone renamed
        // malware.exe → contract.pdf or stuffed an oversized blob past
        // the frontend dropzone (which can be bypassed via direct POST).
        //
        // Per-attachment rejection is "fail-fast inside the transaction"
        // — one bad file aborts the whole save so the user gets a clear
        // error rather than seeing some files saved and some silently
        // dropped. Caller's transaction() wrapper auto-rolls-back.
        const verdict = validateAttachmentBuffer(buffer, att.type, att.name);
        if (!verdict.ok) {
          console.warn(`[rfqs:attachment] REJECTED — ${verdict.reason}`);
          const err = new Error(verdict.reason);
          err.status = 400;
          throw err;
        }

        // ── CANONICAL oracledb v6 BLOB insert via temp LOB streaming ──
        //
        // Sequence (verified against
        // https://node-oracledb.readthedocs.io/en/stable/user_guide/lob_data.html):
        //   1. createLob(oracledb.BLOB)  — temp LOB on this connection
        //   2. .end(buffer)              — write buffer + close writable
        //                                  ('finish' fires when fully flushed)
        //   3. execute(INSERT … :b)      — bind the LOB itself
        //   4. await tempLob.destroy()   — frees temp tablespace
        //
        // Critical: use .destroy(), NOT .close(). The docs explicitly
        // say temp LOBs created with createLob() must be released with
        // destroy(). close() is for closing FETCHED LOBs and on a temp
        // LOB can leave the temp tablespace allocated. We previously
        // used close() and saw stored bytes diverge from input — the
        // close-vs-destroy distinction is the root cause.
        const tempLob = await conn.createLob(oracledb.BLOB);
        try {
          await new Promise((resolve, reject) => {
            tempLob.once('error', reject);
            tempLob.once('finish', resolve);
            tempLob.end(buffer);
          });

          // Bind names avoid Oracle reserved words: SIZE and TYPE both
          // trigger ORA-01745. Use :fname/:ftype/:fsize/:fdata/:uby.
          await conn.execute(
            `INSERT INTO QA_RFQ_RESPONSE_ATTACHMENTS (
               RFQ_ID, VENDOR_ID, FILE_NAME, FILE_TYPE, FILE_SIZE, FILE_DATA, UPLOADED_BY
             ) VALUES (
               :rid, :vid, :fname, :ftype, :fsize, :fdata, :uby
             )`,
            {
              rid:   id,
              vid:   r.vendorId,
              fname: String(att.name).slice(0, 500),
              ftype: att.type ? String(att.type).slice(0, 100) : null,
              // FILE_SIZE is the actual binary byte count (matches what
              // we'll send back on download). Used by the download
              // handler as a sanity check.
              fsize: buffer.length,
              fdata: tempLob,
              uby:   req.user.email
            }
          );

          // Forensic log — once a successful insert lands we record the
          // first 8 bytes hex so the operator can verify storage against
          // the original PDF (a valid PDF starts %PDF-1.x = 25 50 44 46
          // 2D 31 2E xx). Helps debug future regressions.
          const head8 = buffer.slice(0, 8).toString('hex');
          console.log(
            `[rfq attachment insert] ${att.name} · ${buffer.length}B · ` +
            `head=${head8} ${buffer.slice(0, 4).toString('ascii')}`
          );
        } finally {
          // Per docs: destroy() releases temp tablespace. close() does
          // NOT — temp LOBs leak across the pool otherwise.
          try { await tempLob.destroy(); } catch (_) { /* already gone */ }
        }
      }
    }

    await conn.execute(`
      UPDATE QA_RFQ_VENDORS SET RESPONSE_STATUS = 'RESPONDED'
      WHERE RFQ_ID = :rid AND VENDOR_ID = :vid
    `, { rid: id, vid: r.vendorId });

    // Move RFQ to RECEIVING when first response comes in (from SENT/DRAFT)
    await conn.execute(`
      UPDATE QA_RFQS SET STATUS = 'RECEIVING', UPDATED_AT = SYSTIMESTAMP
      WHERE RFQ_ID = :rid AND STATUS IN ('SENT','DRAFT')
    `, { rid: id });

    // Check if ALL invited vendors have now responded → transition to COMPARING
    const totalVendorsRes = await conn.execute(
      `SELECT COUNT(*) AS TOT FROM QA_RFQ_VENDORS WHERE RFQ_ID = :rid`,
      { rid: id }, { outFormat: 4002 }
    );
    const respondedVendorsRes = await conn.execute(
      `SELECT COUNT(*) AS TOT FROM QA_RFQ_VENDORS WHERE RFQ_ID = :rid AND RESPONSE_STATUS = 'RESPONDED'`,
      { rid: id }, { outFormat: 4002 }
    );
    const totalVendors = Number(totalVendorsRes.rows?.[0]?.TOT || 0);
    const respondedVendors = Number(respondedVendorsRes.rows?.[0]?.TOT || 0);
    if (totalVendors > 0 && respondedVendors >= totalVendors) {
      await conn.execute(`
        UPDATE QA_RFQS SET STATUS = 'COMPARING', UPDATED_AT = SYSTIMESTAMP
        WHERE RFQ_ID = :rid AND STATUS = 'RECEIVING'
      `, { rid: id });
    }

    await conn.execute(`
      INSERT INTO QA_PROCUREMENT_EVENTS (EVENT_TYPE, ENTITY_TYPE, ENTITY_ID, ACTOR, PAYLOAD)
      VALUES ('RFQ_RESPONSE_LOGGED','RFQ',:id,:actor,:payload)
    `, { id, actor: req.user.email, payload: JSON.stringify({ vendorId: r.vendorId, prId: r.prId, unitCost: unit }) });

    // Mirror only to the specific PR this response is for (not all PRs in
    // the RFQ) — the per-PR history should show "vendor X quoted $Y for me"
    // only on the PR that vendor quoted, not on every sibling.
    try {
      await conn.execute(
        `INSERT INTO QA_PROCUREMENT_EVENTS (EVENT_TYPE, ENTITY_TYPE, ENTITY_ID, ACTOR, PAYLOAD)
         VALUES ('PR_RFQ_RESPONSE_LOGGED','PR',:pid,:actor,:payload)`,
        { pid: r.prId, actor: req.user.email, payload: JSON.stringify({ rfqId: id, vendorId: r.vendorId, unitCost: unit, total }) }
      );
    } catch (e) {
      console.error('[response mirror to PR] failed:', e.message);
    }
  });

  emitToAll('rfq:updated');
  res.json({ success: true });
}));

/**
 * POST /api/rfqs/:id/award
 * Body: { vendorId, responseIds: [] }
 * Marks the responses as winners, updates RFQ + PRs to AWARDED,
 * and pushes awarded costs back into the originating invoice line items.
 */
router.post('/:id/award', requirePermission('rfq.approve.award'), catchAsync(async (req, res) => {
  const { id } = req.params;
  const { vendorId, responseIds = [] } = req.body || {};
  if (!vendorId || responseIds.length === 0) {
    return res.status(400).json({ success: false, error: 'vendorId and responseIds are required' });
  }

  // Check high-value threshold setting
  const threshRes = await execute(
    `SELECT SETTING_VAL FROM QA_PROCUREMENT_SETTINGS WHERE SETTING_KEY = 'highValueThreshold'`
  );
  const threshold = Number(threshRes.rows?.[0]?.SETTING_VAL || 0);
  const userRole = req.user.role;
  const isControllerOrAdmin = userRole === 'controller' || userRole === 'admin';

  let totalAward = 0;
  const pushbackResults = [];

  await transaction(async (conn) => {
    // Mark winning responses + award PRs
    for (const respId of responseIds) {
      const respRow = await conn.execute(
        'SELECT TOTAL_COST, PR_ID, UNIT_COST FROM QA_RFQ_RESPONSES WHERE RESPONSE_ID = :id',
        { id: respId },
        { outFormat: 4002 }
      );
      if (!respRow.rows || respRow.rows.length === 0) continue;
      const r = respRow.rows[0];
      totalAward += Number(r.TOTAL_COST || 0);

      await conn.execute(
        `UPDATE QA_RFQ_RESPONSES SET IS_WINNER = 1 WHERE RESPONSE_ID = :id`,
        { id: respId }
      );
      await conn.execute(
        `UPDATE QA_PURCHASE_REQUISITIONS
         SET STATUS = 'AWARDED', UPDATED_AT = SYSTIMESTAMP
         WHERE PR_ID = :pid`,
        { pid: r.PR_ID }
      );

      // ── Phase 4 cost pushback ──────────────────────────────────────
      // Look up the PR to find the linked invoice and match key
      const prRow = await conn.execute(
        `SELECT INVOICE_ID, QUOTE_LINE_MATCH_KEY, QUANTITY
         FROM QA_PURCHASE_REQUISITIONS WHERE PR_ID = :pid`,
        { pid: r.PR_ID },
        { outFormat: 4002 }
      );
      if (prRow.rows && prRow.rows.length > 0) {
        const pr = prRow.rows[0];
        if (pr.INVOICE_ID && pr.QUOTE_LINE_MATCH_KEY) {
          const newUnitPrice = Number(r.UNIT_COST || 0);
          const qty = Number(pr.QUANTITY || 1);
          const newLineTotal = Number((newUnitPrice * qty).toFixed(4));

          // Update the matching line item using SKU = QUOTE_LINE_MATCH_KEY
          const updateResult = await conn.execute(
            `UPDATE QA_INVOICE_LINE_ITEMS
             SET UNIT_PRICE = :up, LINE_TOTAL = :lt
             WHERE INVOICE_ID = :iid AND SKU = :sku`,
            { up: newUnitPrice, lt: newLineTotal, iid: pr.INVOICE_ID, sku: pr.QUOTE_LINE_MATCH_KEY }
          );
          pushbackResults.push({
            prId: r.PR_ID,
            invoiceId: pr.INVOICE_ID,
            matchKey: pr.QUOTE_LINE_MATCH_KEY,
            newUnitPrice,
            newLineTotal,
            rowsUpdated: updateResult.rowsAffected || 0
          });
        }
      }
    }

    // If high-value threshold is active and total exceeds it, route to PENDING_APPROVAL
    const needsApproval = threshold > 0 && totalAward > threshold && !isControllerOrAdmin;

    // Recompute invoice totals for every affected invoice (only if not pending approval)
    const affectedInvoices = needsApproval ? [] : [...new Set(pushbackResults.map(p => p.invoiceId).filter(Boolean))];
    for (const invId of affectedInvoices) {
      // Sum all line totals to get new subtotal
      const sumRes = await conn.execute(
        `SELECT NVL(SUM(LINE_TOTAL), 0) AS SUBTOTAL FROM QA_INVOICE_LINE_ITEMS WHERE INVOICE_ID = :iid`,
        { iid: invId },
        { outFormat: 4002 }
      );
      const newSubtotal = Number(sumRes.rows[0]?.SUBTOTAL || 0);

      // Recompute taxes from stored TAX_BREAKDOWN rates (handles zero-subtotal Pending Pricing invoices)
      const invRow = await conn.execute(
        `SELECT SUBTOTAL, TAXES, TAX_BREAKDOWN FROM QA_INVOICES WHERE INVOICE_ID = :iid`,
        { iid: invId },
        { outFormat: 4002 }
      );
      const oldInv = invRow.rows[0];
      const oldSub = Number(oldInv?.SUBTOTAL || 0);
      const oldTaxes = Number(oldInv?.TAXES || 0);
      const taxBreakdown = oldInv?.TAX_BREAKDOWN;
      const newTaxes = recomputeTaxesFromBreakdown(newSubtotal, taxBreakdown, oldTaxes, oldSub);
      const newTotal = Number((newSubtotal + newTaxes).toFixed(4));

      // Count how many PRs for this invoice are now AWARDED or FULFILLED
      const prCountRes = await conn.execute(
        `SELECT COUNT(*) AS TOT FROM QA_PURCHASE_REQUISITIONS WHERE INVOICE_ID = :iid`,
        { iid: invId },
        { outFormat: 4002 }
      );
      const awardedCountRes = await conn.execute(
        `SELECT COUNT(*) AS TOT FROM QA_PURCHASE_REQUISITIONS
         WHERE INVOICE_ID = :iid AND STATUS IN ('AWARDED','FULFILLED')`,
        { iid: invId },
        { outFormat: 4002 }
      );
      const totalPrs = Number(prCountRes.rows[0]?.TOT || 0);
      const awardedPrs = Number(awardedCountRes.rows[0]?.TOT || 0);
      const sourcingComplete = awardedPrs >= totalPrs;
      const newSourcingStatus = sourcingComplete ? 'COMPLETE' : 'PARTIAL';

      // When all PRs for this invoice are awarded, promote it from 'Pending Pricing' to 'Pending Approval'
      // so the controller can review the final costed quote and approve it for the customer.
      const currentStatusRes = await conn.execute(
        `SELECT STATUS FROM QA_INVOICES WHERE INVOICE_ID = :iid`,
        { iid: invId },
        { outFormat: 4002 }
      );
      const currentStatus = currentStatusRes.rows?.[0]?.STATUS || '';
      const newInvoiceStatus = sourcingComplete && currentStatus === 'Pending Pricing'
        ? 'Pending Approval'
        : currentStatus;

      await conn.execute(
        `UPDATE QA_INVOICES
         SET SUBTOTAL = :sub, TAXES = :tax, TOTAL = :tot, BALANCE_DUE = :bd,
             SOURCING_STATUS = :ss, STATUS = :ist, UPDATED_AT = SYSTIMESTAMP
         WHERE INVOICE_ID = :iid`,
        { sub: newSubtotal, tax: newTaxes, tot: newTotal, bd: newTotal, ss: newSourcingStatus, ist: newInvoiceStatus, iid: invId }
      );
    }

    // Update the RFQ itself
    const rfqStatus = needsApproval ? 'PENDING_APPROVAL' : 'AWARDED';
    await conn.execute(
      `UPDATE QA_RFQS
       SET STATUS = :st, AWARDED_VENDOR_ID = :vid, AWARDED_AT = SYSTIMESTAMP,
           AWARDED_BY = :ab, TOTAL_AWARD_AMOUNT = :ta, UPDATED_AT = SYSTIMESTAMP
       WHERE RFQ_ID = :id`,
      { st: rfqStatus, id, vid: vendorId, ab: req.user.email, ta: totalAward }
    );

    // If pending approval, revert PRs back to IN_RFQ (not yet truly awarded)
    if (needsApproval) {
      for (const respId of responseIds) {
        const rr = await conn.execute(
          'SELECT PR_ID FROM QA_RFQ_RESPONSES WHERE RESPONSE_ID = :id',
          { id: respId },
          { outFormat: 4002 }
        );
        if (rr.rows?.[0]) {
          await conn.execute(
            `UPDATE QA_PURCHASE_REQUISITIONS SET STATUS = 'IN_RFQ', UPDATED_AT = SYSTIMESTAMP WHERE PR_ID = :pid`,
            { pid: rr.rows[0].PR_ID }
          );
        }
      }
    }

    const eventType = needsApproval ? 'RFQ_PENDING_APPROVAL' : 'RFQ_AWARDED';
    await conn.execute(`
      INSERT INTO QA_PROCUREMENT_EVENTS (EVENT_TYPE, ENTITY_TYPE, ENTITY_ID, ACTOR, PAYLOAD)
      VALUES (:et,'RFQ',:id,:actor,:payload)
    `, {
      et: eventType,
      id,
      actor: req.user.email,
      payload: JSON.stringify({ vendorId, responseIds, totalAward, pushbackResults, needsApproval })
    });
    await mirrorRfqEventToPrs(conn, id, eventType, req.user.email, { vendorId, totalAward });
  });

  emitToAll('rfq:updated');
  emitToAll('pr:updated');
  emitToAll('invoices:updated');

  // Sourcing just completed — tell finance and the sales owners of the
  // affected invoices that the real costs are now reflected on their quotes.
  try {
    const invoiceIds = [...new Set(pushbackResults.map(p => p.invoiceId).filter(Boolean))];
    if (invoiceIds.length > 0) {
      const inClause = invoiceIds.map((_, i) => `:id${i}`).join(',');
      const idBinds = {};
      invoiceIds.forEach((iid, i) => { idBinds[`id${i}`] = iid; });
      const invRes = await execute(
        `SELECT INVOICE_ID, CREATED_BY, SALESPERSON_ID, CUSTOMER_NAME FROM QA_INVOICES WHERE INVOICE_ID IN (${inClause})`,
        idBinds
      );
      for (const inv of (invRes.rows || [])) {
        notify({
          to: {
            users: [inv.CREATED_BY, inv.SALESPERSON_ID],
            roles: ['finance_head'],
            excludeActor: true
          },
          actor: req.user.email,
          type: 'rfq.awarded', category: 'procurement', severity: 'success',
          title: 'Sourcing complete — quote re-costed',
          body: `Procurement awarded sourcing for ${inv.INVOICE_ID} (${inv.CUSTOMER_NAME || 'a customer'}). The final supplier costs are now on the quote.`,
          entityType: 'invoice', entityId: inv.INVOICE_ID,
          linkPage: 'invoiceEditor', linkContext: { invoiceId: inv.INVOICE_ID, returnTo: 'invoices' },
          groupKey: `invoice:${inv.INVOICE_ID}:sourced`
        });
      }
    }
  } catch (e) { console.error('[rfqs] award notify failed:', e.message); }

  res.json({ success: true, totalAward, pushbackResults, status: threshold > 0 && totalAward > threshold && !isControllerOrAdmin ? 'PENDING_APPROVAL' : 'AWARDED' });
}));

/**
 * POST /api/rfqs/:id/recommend
 * Formal two-step award — Phase 3.
 * Procurement officer captures a recommendation; RFQ transitions to PENDING_APPROVAL.
 * No PR status change and no cost pushback here — those happen at /approve.
 *
 * Body: { vendorId, responseIds[], score, reason, allowPartial }
 */
router.post('/:id/recommend', requirePermission('rfq.recommend'), requireRfqOwnership, catchAsync(async (req, res) => {
  const { id } = req.params;
  const {
    vendorId,
    responseIds = [],
    score = null,
    reason = '',
    allowPartial = false
  } = req.body || {};

  if (!vendorId || responseIds.length === 0) {
    return res.status(400).json({ success: false, error: 'vendorId and responseIds are required' });
  }

  // Validate coverage unless partial explicitly allowed
  if (!allowPartial) {
    const coverageRes = await execute(
      `SELECT
         (SELECT COUNT(*) FROM QA_RFQ_LINE_ITEMS WHERE RFQ_ID = :id) AS LINES,
         (SELECT COUNT(DISTINCT PR_ID) FROM QA_RFQ_RESPONSES WHERE RFQ_ID = :id AND VENDOR_ID = :vid) AS RESPONDED
       FROM DUAL`,
      { id, vid: vendorId }
    );
    const totalLines = Number(coverageRes.rows?.[0]?.LINES || 0);
    const respondedLines = Number(coverageRes.rows?.[0]?.RESPONDED || 0);
    if (respondedLines < totalLines) {
      return res.status(400).json({
        success: false,
        error: `Vendor has only responded to ${respondedLines} of ${totalLines} line items. Enable "allow partial award" to proceed anyway.`
      });
    }
  }

  let totalAmount = 0;

  await transaction(async (conn) => {
    // Mark winning responses (used by /approve to drive cost pushback)
    for (const respId of responseIds) {
      const rrow = await conn.execute(
        'SELECT TOTAL_COST FROM QA_RFQ_RESPONSES WHERE RESPONSE_ID = :id AND RFQ_ID = :rid',
        { id: respId, rid: id },
        { outFormat: 4002 }
      );
      if (!rrow.rows || rrow.rows.length === 0) continue;
      totalAmount += Number(rrow.rows[0].TOTAL_COST || 0);
      await conn.execute(
        `UPDATE QA_RFQ_RESPONSES SET IS_WINNER = 1 WHERE RESPONSE_ID = :id`,
        { id: respId }
      );
    }

    // Clear any stale winner flags from vendors that are NOT the recommended one
    await conn.execute(
      `UPDATE QA_RFQ_RESPONSES SET IS_WINNER = 0 WHERE RFQ_ID = :id AND VENDOR_ID != :vid`,
      { id, vid: vendorId }
    );

    // Capture recommendation metadata and route to PENDING_APPROVAL.
    // H1 fix — do NOT stamp AWARDED_VENDOR_ID here. That field is reserved for the
    // head's `/approve` step so reporting queries that count "awarded" vendors are
    // not polluted by RFQs that are still pending approval. RECOMMENDED_VENDOR_ID
    // is the canonical record of the officer's choice at this stage.
    await conn.execute(
      `UPDATE QA_RFQS
       SET STATUS                 = 'PENDING_APPROVAL',
           RECOMMENDED_VENDOR_ID  = :vid,
           RECOMMENDATION_SCORE   = :sc,
           RECOMMENDATION_REASON  = :rsn,
           RECOMMENDED_BY         = :rb,
           RECOMMENDED_AT         = SYSTIMESTAMP,
           ALLOW_PARTIAL          = :ap,
           TOTAL_AWARD_AMOUNT     = :ta,
           UPDATED_AT             = SYSTIMESTAMP
       WHERE RFQ_ID = :id`,
      {
        vid: vendorId,
        sc: score != null ? Number(score) : null,
        rsn: (reason || '').slice(0, 500),
        rb: req.user.email,
        ap: allowPartial ? 1 : 0,
        ta: totalAmount,
        id
      }
    );

    await conn.execute(`
      INSERT INTO QA_PROCUREMENT_EVENTS (EVENT_TYPE, ENTITY_TYPE, ENTITY_ID, ACTOR, PAYLOAD)
      VALUES ('RFQ_RECOMMENDED','RFQ',:id,:actor,:payload)
    `, {
      id,
      actor: req.user.email,
      payload: JSON.stringify({ vendorId, responseIds, score, reason, allowPartial, totalAmount })
    });
    await mirrorRfqEventToPrs(conn, id, 'RFQ_RECOMMENDED', req.user.email, { vendorId, score, reason });
  });

  emitToAll('rfq:updated');

  // Tell the procurement head a recommendation is waiting for their award decision.
  try {
    const numRes = await execute(`SELECT RFQ_NUMBER FROM QA_RFQS WHERE RFQ_ID = :id`, { id });
    const rfqNumber = numRes.rows?.[0]?.RFQ_NUMBER || id;
    notify({
      to: { roles: ['procurement_head'], excludeActor: true },
      actor: req.user.email,
      type: 'rfq.recommended', category: 'procurement', severity: 'warning',
      title: 'RFQ recommendation awaiting your approval',
      body: `${req.user.email} recommended a vendor for ${rfqNumber} (total ${Number(totalAmount || 0).toLocaleString()}). It needs your award approval.`,
      entityType: 'rfq', entityId: id,
      linkPage: 'rfqDetail', linkContext: { rfqId: id },
      groupKey: `rfq:${id}:recommended`
    });
  } catch (e) { console.error('[rfqs] recommend notify failed:', e.message); }

  res.json({ success: true, totalAmount, status: 'PENDING_APPROVAL' });
}));

/**
 * DELETE /api/rfqs/:id  → cancel an RFQ (and revert PRs to OPEN)
 */
router.delete('/:id', requirePermission('rfq.cancel'), catchAsync(async (req, res) => {
  const { id } = req.params;
  await transaction(async (conn) => {
    await conn.execute(
      `UPDATE QA_RFQS SET STATUS = 'CANCELLED', UPDATED_AT = SYSTIMESTAMP WHERE RFQ_ID = :id`,
      { id }
    );
    await conn.execute(`
      UPDATE QA_PURCHASE_REQUISITIONS SET STATUS = 'OPEN', UPDATED_AT = SYSTIMESTAMP
      WHERE PR_ID IN (SELECT PR_ID FROM QA_RFQ_LINE_ITEMS WHERE RFQ_ID = :id)
    `, { id });
    await conn.execute(`
      INSERT INTO QA_PROCUREMENT_EVENTS (EVENT_TYPE, ENTITY_TYPE, ENTITY_ID, ACTOR, PAYLOAD)
      VALUES ('RFQ_CANCELLED','RFQ',:id,:actor,'{}')
    `, { id, actor: req.user.email });
    await mirrorRfqEventToPrs(conn, id, 'RFQ_CANCELLED', req.user.email, {});
  });
  emitToAll('rfq:updated');
  emitToAll('pr:updated');
  res.json({ success: true });
}));

/**
 * POST /api/rfqs/:id/approve
 * Procurement head / admin approves a PENDING_APPROVAL RFQ → transitions to AWARDED
 * and performs cost pushback to the originating invoice.
 *
 * Ownership: RFQ approval is a PROCUREMENT-side decision — not a finance/controller
 * decision. Finance can SEE pending RFQs on their dashboard for visibility but cannot
 * approve or reject them.
 */
router.post('/:id/approve', requirePermission('rfq.approve.award'), catchAsync(async (req, res) => {
  const { id } = req.params;

  // Tagged step logging — when the approve flow throws a 500, the backend log
  // tells us which named step failed instead of just a generic stack trace.
  // Strip after a few weeks once the flow is known-stable.
  const tag = `[approve ${id}]`;
  const log = (step, extra) => {
    if (extra !== undefined) console.log(`${tag} ${step}`, extra);
    else console.log(`${tag} ${step}`);
  };
  log('start');

  const rfqRes = await execute('SELECT * FROM QA_RFQS WHERE RFQ_ID = :id', { id });
  if (!rfqRes.rows?.[0]) return res.status(404).json({ success: false, error: 'RFQ not found' });
  log('rfq loaded', { status: rfqRes.rows[0].STATUS });
  if (rfqRes.rows[0].STATUS !== 'PENDING_APPROVAL') {
    return res.status(400).json({ success: false, error: 'RFQ is not pending approval' });
  }

  // Separation of duties — the procurement officer who recommended the
  // vendor cannot also be the head who approves the award. Enforced
  // server-side so a crafted POST can't bypass the UI gate.
  const rfqRow = rfqRes.rows[0];
  const sodErr = sodCheckRunner('rfq.approve.award')(req.user, {
    recommendedBy: rfqRow.RECOMMENDED_BY
  });
  if (sodErr) {
    log('SoD violation', { user: req.user.email, recommendedBy: rfqRow.RECOMMENDED_BY });
    return res.status(403).json({ success: false, error: sodErr });
  }

  // H1 — RECOMMENDED_VENDOR_ID is now the canonical pre-approval source. Fall back
  // to AWARDED_VENDOR_ID for legacy RFQs created before this split.
  const vendorId = rfqRes.rows[0].RECOMMENDED_VENDOR_ID || rfqRes.rows[0].AWARDED_VENDOR_ID;
  if (!vendorId) {
    return res.status(400).json({ success: false, error: 'RFQ has no recommended vendor' });
  }
  const totalAward = Number(rfqRes.rows[0].TOTAL_AWARD_AMOUNT || 0);
  const pushbackResults = [];

  // Detect whether Phase 4 reapproval columns are present on this deployment.
  // If they aren't, we skip variance-based reapproval entirely so the legacy
  // approve path still works while the migration is pending.
  const phase4 = await hasPhase4Columns();
  log('phase4 columns?', phase4);

  // Phase 4 — load re-approval variance threshold (whole-percent integer).
  // Only meaningful when Phase 4 columns are present.
  let variancePctThreshold = 10;
  if (phase4) {
    try {
      const varThreshRes = await execute(
        `SELECT SETTING_VAL FROM QA_PROCUREMENT_SETTINGS WHERE SETTING_KEY = 'reapprovalVarianceThreshold'`
      );
      variancePctThreshold = Number(varThreshRes.rows?.[0]?.SETTING_VAL || 10);
    } catch (_) { /* fall back to default */ }
  }
  const reapprovalsTriggered = [];

  await transaction(async (conn) => {
    log('tx start');
    // Fetch winning responses and push costs back
    const winRes = await conn.execute(
      `SELECT RESPONSE_ID, PR_ID, UNIT_COST, TOTAL_COST FROM QA_RFQ_RESPONSES
       WHERE RFQ_ID = :id AND IS_WINNER = 1`,
      { id },
      { outFormat: 4002 }
    );
    log('winners loaded', winRes.rows?.length);
    for (const r of (winRes.rows || [])) {
      // Award the PR
      await conn.execute(
        `UPDATE QA_PURCHASE_REQUISITIONS SET STATUS = 'AWARDED', UPDATED_AT = SYSTIMESTAMP WHERE PR_ID = :pid`,
        { pid: r.PR_ID }
      );
      // Push cost to invoice line.
      // C2 fix — use LINE_SORT_ORDER (when available) to target exactly one line.
      // The previous SKU-only WHERE could overwrite multiple lines if two PRs
      // referenced the same SKU on the same invoice. We also SELECT FOR UPDATE
      // to serialise concurrent awards on the same invoice.
      const prRow = await conn.execute(
        `SELECT INVOICE_ID, QUOTE_LINE_MATCH_KEY, LINE_SORT_ORDER, QUANTITY
           FROM QA_PURCHASE_REQUISITIONS WHERE PR_ID = :pid`,
        { pid: r.PR_ID },
        { outFormat: 4002 }
      );
      if (prRow.rows?.[0]?.INVOICE_ID && prRow.rows[0].QUOTE_LINE_MATCH_KEY) {
        const pr = prRow.rows[0];
        const newUnitPrice = Number(r.UNIT_COST || 0);
        const qty = Number(pr.QUANTITY || 1);
        const newLineTotal = Number((newUnitPrice * qty).toFixed(4));

        const hasSortOrder = pr.LINE_SORT_ORDER !== null && pr.LINE_SORT_ORDER !== undefined;
        if (hasSortOrder) {
          // Lock the exact line first to serialise concurrent awards.
          await conn.execute(
            `SELECT LINE_ID FROM QA_INVOICE_LINE_ITEMS
               WHERE INVOICE_ID = :iid AND SKU = :sku AND SORT_ORDER = :so
               FOR UPDATE`,
            { iid: pr.INVOICE_ID, sku: pr.QUOTE_LINE_MATCH_KEY, so: pr.LINE_SORT_ORDER }
          );
          await conn.execute(
            `UPDATE QA_INVOICE_LINE_ITEMS
                SET UNIT_PRICE = :up, LINE_TOTAL = :lt
              WHERE INVOICE_ID = :iid AND SKU = :sku AND SORT_ORDER = :so`,
            { up: newUnitPrice, lt: newLineTotal, iid: pr.INVOICE_ID, sku: pr.QUOTE_LINE_MATCH_KEY, so: pr.LINE_SORT_ORDER }
          );
        } else {
          // Legacy fallback for PRs created before LINE_SORT_ORDER existed.
          // Restrict to one row via ROWNUM so a duplicate-SKU edge case can no
          // longer double-write, and lock first to serialise.
          await conn.execute(
            `SELECT LINE_ID FROM QA_INVOICE_LINE_ITEMS
               WHERE INVOICE_ID = :iid AND SKU = :sku
               FOR UPDATE`,
            { iid: pr.INVOICE_ID, sku: pr.QUOTE_LINE_MATCH_KEY }
          );
          await conn.execute(
            `UPDATE QA_INVOICE_LINE_ITEMS
                SET UNIT_PRICE = :up, LINE_TOTAL = :lt
              WHERE LINE_ID = (
                SELECT LINE_ID FROM (
                  SELECT LINE_ID FROM QA_INVOICE_LINE_ITEMS
                    WHERE INVOICE_ID = :iid AND SKU = :sku
                    ORDER BY SORT_ORDER, LINE_ID
                ) WHERE ROWNUM = 1
              )`,
            { up: newUnitPrice, lt: newLineTotal, iid: pr.INVOICE_ID, sku: pr.QUOTE_LINE_MATCH_KEY }
          );
        }
        pushbackResults.push({ prId: r.PR_ID, invoiceId: pr.INVOICE_ID, newUnitPrice, newLineTotal });
      }
    }

    // Recompute invoice totals
    const affectedInvoices = [...new Set(pushbackResults.map(p => p.invoiceId).filter(Boolean))];
    log('affected invoices', affectedInvoices);
    for (const invId of affectedInvoices) {
      log('recompute invoice', invId);
      const sumRes = await conn.execute(
        `SELECT NVL(SUM(LINE_TOTAL), 0) AS SUBTOTAL FROM QA_INVOICE_LINE_ITEMS WHERE INVOICE_ID = :iid`,
        { iid: invId },
        { outFormat: 4002 }
      );
      const newSubtotal = Number(sumRes.rows[0]?.SUBTOTAL || 0);
      const invRow = await conn.execute(
        `SELECT SUBTOTAL, TAXES, TAX_BREAKDOWN FROM QA_INVOICES WHERE INVOICE_ID = :iid`,
        { iid: invId },
        { outFormat: 4002 }
      );
      const oldSub = Number(invRow.rows[0]?.SUBTOTAL || 0);
      const oldTaxes2 = Number(invRow.rows[0]?.TAXES || 0);
      const taxBreakdown2 = invRow.rows[0]?.TAX_BREAKDOWN;
      const newTaxes = recomputeTaxesFromBreakdown(newSubtotal, taxBreakdown2, oldTaxes2, oldSub);
      const newTotal = Number((newSubtotal + newTaxes).toFixed(4));

      const prCountRes = await conn.execute(
        `SELECT COUNT(*) AS TOT FROM QA_PURCHASE_REQUISITIONS WHERE INVOICE_ID = :iid`,
        { iid: invId }, { outFormat: 4002 }
      );
      const awardedCountRes = await conn.execute(
        `SELECT COUNT(*) AS TOT FROM QA_PURCHASE_REQUISITIONS WHERE INVOICE_ID = :iid AND STATUS IN ('AWARDED','FULFILLED')`,
        { iid: invId }, { outFormat: 4002 }
      );
      const sourcingComplete2 = Number(awardedCountRes.rows[0]?.TOT || 0) >= Number(prCountRes.rows[0]?.TOT || 0);
      const newSourcingStatus = sourcingComplete2 ? 'COMPLETE' : 'PARTIAL';

      // Promote invoice status from 'Pending Pricing' -> 'Pending Approval' once all PRs are fulfilled.
      // Only SELECT ORIGINAL_ESTIMATE when Phase 4 columns are present — selecting a
      // non-existent column throws ORA-00904 and rolls back the whole transaction.
      const curStatusRes = await conn.execute(
        phase4
          ? `SELECT STATUS, ORIGINAL_ESTIMATE FROM QA_INVOICES WHERE INVOICE_ID = :iid`
          : `SELECT STATUS FROM QA_INVOICES WHERE INVOICE_ID = :iid`,
        { iid: invId },
        { outFormat: 4002 }
      );
      const curStatus = curStatusRes.rows?.[0]?.STATUS || '';
      const originalEstimate = phase4 ? Number(curStatusRes.rows?.[0]?.ORIGINAL_ESTIMATE || 0) : 0;
      const promotedStatus = sourcingComplete2 && curStatus === 'Pending Pricing'
        ? 'Pending Approval'
        : curStatus;

      // Phase 4 — variance detection. Only meaningful once sourcing is complete,
      // we have a positive baseline estimate to compare against, AND the schema
      // has the Phase 4 columns to record the result.
      let requiresReapproval = 0;
      let reapprovalVariance = null;
      let reapprovalReason = null;
      if (phase4 && sourcingComplete2 && originalEstimate > 0) {
        const variancePct = Math.abs(newTotal - originalEstimate) / originalEstimate * 100;
        reapprovalVariance = Number(variancePct.toFixed(4));
        if (variancePct > variancePctThreshold) {
          requiresReapproval = 1;
          const direction = newTotal > originalEstimate ? 'increased' : 'decreased';
          reapprovalReason =
            `Sourcing ${direction} the invoice total by ${variancePct.toFixed(2)}% ` +
            `(threshold ${variancePctThreshold}%). Original: ${originalEstimate.toFixed(2)}, ` +
            `Final: ${newTotal.toFixed(2)}.`;
          reapprovalsTriggered.push({ invoiceId: invId, variancePct, originalEstimate, newTotal });
        }
      }

      // Two flavours of UPDATE — Phase 4 (with reapproval columns) vs. legacy.
      // Splitting at the SQL level (rather than always binding the columns) avoids
      // ORA-00904 on legacy schemas while keeping the new schema's audit fields.
      if (phase4) {
        await conn.execute(
          `UPDATE QA_INVOICES SET SUBTOTAL = :sub, TAXES = :tax, TOTAL = :tot, BALANCE_DUE = :bd,
           SOURCING_STATUS = :ss, STATUS = :ist,
           REQUIRES_REAPPROVAL = :rr, REAPPROVAL_VARIANCE = :rv, REAPPROVAL_REASON = :rsn,
           UPDATED_AT = SYSTIMESTAMP WHERE INVOICE_ID = :iid`,
          {
            sub: newSubtotal, tax: newTaxes, tot: newTotal, bd: newTotal,
            ss: newSourcingStatus, ist: promotedStatus,
            rr: requiresReapproval, rv: reapprovalVariance, rsn: reapprovalReason,
            iid: invId
          }
        );
      } else {
        await conn.execute(
          `UPDATE QA_INVOICES SET SUBTOTAL = :sub, TAXES = :tax, TOTAL = :tot, BALANCE_DUE = :bd,
           SOURCING_STATUS = :ss, STATUS = :ist,
           UPDATED_AT = SYSTIMESTAMP WHERE INVOICE_ID = :iid`,
          {
            sub: newSubtotal, tax: newTaxes, tot: newTotal, bd: newTotal,
            ss: newSourcingStatus, ist: promotedStatus,
            iid: invId
          }
        );
      }

      if (requiresReapproval === 1) {
        // Guarded — the audit-event INSERT relies on the CHK_PE_ENTITY constraint
        // having been relaxed (see migrate_procurement_schema.js step 10b) to
        // accept 'INVOICE'. If the migration hasn't run on this deployment, the
        // INSERT throws ORA-02290 and the whole approve transaction would roll
        // back even though all the user-visible work (PR awards, cost pushback,
        // invoice flagging) succeeded. We log the failure so it's visible in
        // backend logs and continue, since the event is purely an audit
        // breadcrumb — the REQUIRES_REAPPROVAL column on QA_INVOICES is the
        // load-bearing piece of state.
        try {
          await conn.execute(
            `INSERT INTO QA_PROCUREMENT_EVENTS (EVENT_TYPE, ENTITY_TYPE, ENTITY_ID, ACTOR, PAYLOAD)
             VALUES ('INVOICE_REAPPROVAL_REQUIRED','INVOICE',:iid,:actor,:payload)`,
            {
              iid: invId,
              actor: req.user.email,
              payload: JSON.stringify({
                rfqId: id,
                originalEstimate,
                newTotal,
                variancePct: reapprovalVariance,
                threshold: variancePctThreshold
              })
            }
          );
        } catch (eventErr) {
          console.warn(
            `[approve] Failed to log INVOICE_REAPPROVAL_REQUIRED event for ${invId} ` +
            `(ENTITY_TYPE constraint may not yet allow 'INVOICE' — run ` +
            `migrate_procurement_schema.js): ${eventErr.message}`
          );
        }
      }
    }

    log('updating RFQ row to AWARDED');
    await conn.execute(
      `UPDATE QA_RFQS
       SET STATUS             = 'AWARDED',
           AWARDED_VENDOR_ID  = :vid,
           APPROVED_BY        = :approver,
           APPROVED_AT        = SYSTIMESTAMP,
           AWARDED_AT         = SYSTIMESTAMP,
           AWARDED_BY         = :approver,
           UPDATED_AT         = SYSTIMESTAMP
       WHERE RFQ_ID = :id`,
      { vid: vendorId, approver: req.user.email, id }
    );
    log('inserting RFQ_CONTROLLER_APPROVED event');
    await conn.execute(`
      INSERT INTO QA_PROCUREMENT_EVENTS (EVENT_TYPE, ENTITY_TYPE, ENTITY_ID, ACTOR, PAYLOAD)
      VALUES ('RFQ_CONTROLLER_APPROVED','RFQ',:id,:actor,:payload)
    `, { id, actor: req.user.email, payload: JSON.stringify({ totalAward, pushbackResults }) });
    await mirrorRfqEventToPrs(conn, id, 'RFQ_CONTROLLER_APPROVED', req.user.email, { vendorId, totalAward });
    log('tx body complete (about to commit)');
  });
  log('tx committed');

  emitToAll('rfq:updated');
  emitToAll('pr:updated');
  emitToAll('invoices:updated');

  // Tell the officer who recommended this vendor that their recommendation
  // was approved and the RFQ is now awarded.
  if (rfqRow.RECOMMENDED_BY) {
    notify({
      to: { users: [rfqRow.RECOMMENDED_BY], excludeActor: true },
      actor: req.user.email,
      type: 'rfq.approved', category: 'procurement', severity: 'success',
      title: 'Your RFQ recommendation was approved',
      body: `${req.user.email} approved your vendor recommendation for ${rfqRow.RFQ_NUMBER || id}. The RFQ is now awarded.`,
      entityType: 'rfq', entityId: id,
      linkPage: 'rfqDetail', linkContext: { rfqId: id }
    });
  }

  res.json({ success: true, totalAward, pushbackResults, reapprovalsTriggered });
}));

/**
 * POST /api/rfqs/:id/reject
 * Procurement head / admin rejects a PENDING_APPROVAL RFQ → returns to RECEIVING status.
 * See /:id/approve for the role-ownership rationale.
 */
router.post('/:id/reject', requireRole('procurement', 'admin'), catchAsync(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body || {};

  // H2 — disambiguate "RFQ doesn't exist" (404) from "RFQ exists but isn't in
  // PENDING_APPROVAL" (409) before the UPDATE, so the client gets honest feedback
  // instead of a silent success. Previously a no-op UPDATE returned 200.
  const existing = await execute(
    `SELECT STATUS, RECOMMENDED_BY, RFQ_NUMBER FROM QA_RFQS WHERE RFQ_ID = :id`,
    { id }
  );
  if (!existing.rows?.[0]) {
    return res.status(404).json({ success: false, error: 'RFQ not found' });
  }
  if (existing.rows[0].STATUS !== 'PENDING_APPROVAL') {
    return res.status(409).json({
      success: false,
      error: `RFQ is in status '${existing.rows[0].STATUS}', cannot reject.`
    });
  }

  await transaction(async (conn) => {
    // Reset RFQ status and clear stale award fields so next award cycle starts fresh.
    // RECOMMENDED_VENDOR_ID stays — it's the officer's choice and audit-relevant.
    await conn.execute(
      `UPDATE QA_RFQS
       SET STATUS = 'RECEIVING',
           AWARDED_VENDOR_ID = NULL,
           TOTAL_AWARD_AMOUNT = 0,
           AWARDED_AT = NULL,
           AWARDED_BY = NULL,
           UPDATED_AT = SYSTIMESTAMP
       WHERE RFQ_ID = :id AND STATUS = 'PENDING_APPROVAL'`,
      { id }
    );
    // Reset winner flags on all responses
    await conn.execute(`UPDATE QA_RFQ_RESPONSES SET IS_WINNER = 0 WHERE RFQ_ID = :id`, { id });
    await conn.execute(`
      INSERT INTO QA_PROCUREMENT_EVENTS (EVENT_TYPE, ENTITY_TYPE, ENTITY_ID, ACTOR, PAYLOAD)
      VALUES ('RFQ_CONTROLLER_REJECTED','RFQ',:id,:actor,:payload)
    `, { id, actor: req.user.email, payload: JSON.stringify({ reason: reason || '' }) });
    await mirrorRfqEventToPrs(conn, id, 'RFQ_CONTROLLER_REJECTED', req.user.email, { reason: reason || '' });
  });

  emitToAll('rfq:updated');

  // Tell the recommending officer their recommendation was sent back.
  const recBy = existing.rows[0].RECOMMENDED_BY;
  if (recBy) {
    const reasonText = reason ? ` Reason: "${String(reason).slice(0, 300)}"` : '';
    notify({
      to: { users: [recBy], excludeActor: true },
      actor: req.user.email,
      type: 'rfq.rejected', category: 'procurement', severity: 'warning',
      title: 'RFQ recommendation sent back',
      body: `${req.user.email} rejected your vendor recommendation for ${existing.rows[0].RFQ_NUMBER || id}. It's back in RECEIVING for another look.${reasonText}`,
      entityType: 'rfq', entityId: id,
      linkPage: 'rfqDetail', linkContext: { rfqId: id }
    });
  }

  res.json({ success: true });
}));

/**
 * POST /api/rfqs/:id/escalate
 * Phase 5 — manual escalation trigger.
 * Allows procurement/controller/admin to flag an RFQ as escalated before the
 * automatic threshold fires. Body: { reason?: string, escalatedTo?: string }.
 * No-op if the RFQ is already escalated.
 */
router.post('/:id/escalate', requirePermission('rfq.escalate'), requireRfqOwnership, catchAsync(async (req, res) => {
  const { id } = req.params;
  const { reason, escalatedTo } = req.body || {};

  const rfqRes = await execute(
    `SELECT STATUS, ESCALATED_AT, RFQ_NUMBER FROM QA_RFQS WHERE RFQ_ID = :id`,
    { id }
  );
  if (!rfqRes.rows?.[0]) {
    return res.status(404).json({ success: false, error: 'RFQ not found' });
  }
  if (rfqRes.rows[0].ESCALATED_AT) {
    return res.status(400).json({ success: false, error: 'RFQ is already escalated' });
  }
  if (!['SENT', 'RECEIVING', 'COMPARING'].includes(rfqRes.rows[0].STATUS)) {
    return res.status(400).json({ success: false, error: 'Only active RFQs can be escalated' });
  }

  // Resolve target email: explicit > saved procurement head setting > null
  let targetEmail = escalatedTo || null;
  if (!targetEmail) {
    const headRes = await execute(
      `SELECT SETTING_VAL FROM QA_PROCUREMENT_SETTINGS WHERE SETTING_KEY = 'procurementHeadEmail'`
    );
    targetEmail = headRes.rows?.[0]?.SETTING_VAL || null;
  }

  const escalationReason = reason || `Manual escalation by ${req.user.email}.`;

  await transaction(async (conn) => {
    await conn.execute(
      `UPDATE QA_RFQS
          SET ESCALATED_AT      = SYSTIMESTAMP,
              ESCALATED_TO      = :to,
              ESCALATION_REASON = :rsn,
              UPDATED_AT        = SYSTIMESTAMP
        WHERE RFQ_ID = :id`,
      { to: targetEmail, rsn: escalationReason, id }
    );

    await conn.execute(
      `INSERT INTO QA_PROCUREMENT_EVENTS (EVENT_TYPE, ENTITY_TYPE, ENTITY_ID, ACTOR, PAYLOAD)
       VALUES ('RFQ_ESCALATED','RFQ',:id,:actor,:payload)`,
      {
        id, actor: req.user.email,
        payload: JSON.stringify({
          manual: true,
          reason: escalationReason,
          escalatedTo: targetEmail,
          rfqNumber: rfqRes.rows[0].RFQ_NUMBER
        })
      }
    );
  });

  emitToAll('rfq:updated');
  res.json({ success: true, escalatedTo: targetEmail });
}));

// ──────────────────────────────────────────────────────────────────────
// Vendor-response attachments (Module 3 add-on)
//
// LIST + DOWNLOAD only — uploads happen via POST /:id/responses (above)
// because the modal that uploads them already POSTs the response payload
// and the attachments ride along.
//
// GET  /:id/responses/:vendorId/attachments               → metadata list
// GET  /:id/responses/:vendorId/attachments/:attId/download → binary
// ──────────────────────────────────────────────────────────────────────

router.get('/:id/responses/:vendorId/attachments', requirePermission('rfq.read'), catchAsync(async (req, res) => {
  const { id, vendorId } = req.params;
  const r = await execute(
    `SELECT ATTACHMENT_ID, FILE_NAME, FILE_TYPE, FILE_SIZE, UPLOADED_BY, UPLOADED_AT
       FROM QA_RFQ_RESPONSE_ATTACHMENTS
      WHERE RFQ_ID = :rid AND VENDOR_ID = :vid
      ORDER BY UPLOADED_AT DESC, ATTACHMENT_ID DESC`,
    { rid: id, vid: vendorId }, { outFormat: 4002 }
  );
  res.json({
    success: true,
    data: (r.rows || []).map(row => ({
      attachmentId: row.ATTACHMENT_ID,
      fileName:     row.FILE_NAME,
      fileType:     row.FILE_TYPE || 'application/octet-stream',
      fileSize:     Number(row.FILE_SIZE || 0),
      uploadedBy:   row.UPLOADED_BY || '',
      uploadedAt:   row.UPLOADED_AT
    }))
  });
}));

router.get('/:id/responses/:vendorId/attachments/:attId/download', requirePermission('rfq.read'), catchAsync(async (req, res) => {
  const { id, vendorId, attId } = req.params;

  // Explicit per-column fetch hint — defends against fetchTypeMap not
  // applying (which has bitten us before — global default was set in
  // db.js but a previous regression returned the raw Lob descriptor
  // for FILE_DATA, which then silently turned into 15 bytes of garbage
  // via the Buffer.from(lob, 'binary') fallback path).
  const r = await execute(
    `SELECT FILE_NAME, FILE_TYPE, FILE_SIZE, FILE_DATA
       FROM QA_RFQ_RESPONSE_ATTACHMENTS
      WHERE ATTACHMENT_ID = :aid AND RFQ_ID = :rid AND VENDOR_ID = :vid`,
    { aid: attId, rid: id, vid: vendorId },
    {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      fetchInfo: { FILE_DATA: { type: oracledb.BUFFER } }
    }
  );
  const row = r.rows?.[0];
  if (!row) {
    return res.status(404).json({ success: false, error: 'Attachment not found.' });
  }

  // Hard assertion: FILE_DATA MUST be a Buffer at this point. If it
  // isn't, the bytes are corrupted (or fetchInfo failed) — abort
  // cleanly rather than serve garbage.
  if (!Buffer.isBuffer(row.FILE_DATA)) {
    console.error(
      `[rfq attachment ${attId}] FILE_DATA is not a Buffer — got ${typeof row.FILE_DATA} ` +
      `(constructor=${row.FILE_DATA?.constructor?.name || 'none'}). ` +
      `Storage corrupted OR fetchInfo failed. Re-upload the file.`
    );
    return res.status(500).json({
      success: false,
      error: 'Attachment is corrupted in storage. Please re-upload via the Edit Vendor Response modal.'
    });
  }

  // DEFENSIVE COPY — oracledb v6 sometimes returns Buffers that are
  // views over the pooled connection's internal memory. db.js#execute()
  // releases that connection in a finally block BEFORE this handler
  // runs, and the pool then zeros the memory on reclaim. The result
  // was 131,484 bytes of zeros on the wire even though the DB stored
  // a perfect PDF (verified via diagnose_attachments.js).
  // Buffer.from(buffer) forces a JS-owned copy so the bytes survive
  // the connection lifecycle. Cheap: ~10 MB max per attachment.
  const buffer = Buffer.from(row.FILE_DATA);
  const expectedBytes = Number(row.FILE_SIZE || 0);

  // Forensic logging — record EVERY download with byte counts + first
  // 8 bytes hex. A valid PDF starts %PDF-1.x = 25 50 44 46 2D 31 2E xx.
  // An image starts with its magic (PNG=89504E47, JPG=FFD8FFE0, etc.).
  // If head8 = "5B6F626A 6563744F" that's "[objectO..." = the
  // [object Object] sentinel we used to write — definitive storage
  // corruption signal.
  const head8 = buffer.slice(0, 8).toString('hex');
  const head4ascii = buffer.slice(0, 4).toString('ascii').replace(/[^\x20-\x7E]/g, '.');
  const sizeMatch = expectedBytes === 0 || Math.abs(buffer.length - expectedBytes) <= 8;
  const status = sizeMatch ? '✓' : '⚠';
  console.log(
    `[rfq attachment download ${status}] id=${attId} name="${row.FILE_NAME}" ` +
    `buffer=${buffer.length}B stored=${expectedBytes}B head=${head8} (${head4ascii})`
  );

  if (!sizeMatch) {
    console.warn(
      `[rfq attachment ${attId}] SIZE MISMATCH — buffer ${buffer.length}B vs stored FILE_SIZE ${expectedBytes}B. ` +
      `Most likely indicates the upload was truncated or close()/destroy() race during insert.`
    );
  }

  res.setHeader('Content-Type', row.FILE_TYPE || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${(row.FILE_NAME || 'attachment').replace(/"/g, '\\"')}"`);
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.end(buffer);
}));

module.exports = router;
