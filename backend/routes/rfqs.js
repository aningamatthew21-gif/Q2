'use strict';

const express = require('express');
const crypto = require('crypto');
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
  let sql = `
    SELECT r.*,
      (SELECT COUNT(*) FROM QA_RFQ_VENDORS rv WHERE rv.RFQ_ID = r.RFQ_ID) AS VENDOR_COUNT,
      (SELECT COUNT(DISTINCT rr.VENDOR_ID) FROM QA_RFQ_RESPONSES rr WHERE rr.RFQ_ID = r.RFQ_ID) AS RESPONSE_COUNT,
      (SELECT COUNT(*) FROM QA_RFQ_LINE_ITEMS li WHERE li.RFQ_ID = r.RFQ_ID) AS ITEMS_COUNT
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
      vendorCount:   Number(row.VENDOR_COUNT   || 0),
      responseCount: Number(row.RESPONSE_COUNT || 0),
      itemsCount:    Number(row.ITEMS_COUNT    || 0),
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

  res.json({ success: true, data: { ...rfq, lineItems, vendors, responses } });
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
router.post('/', requireRole('procurement', 'controller', 'admin'), catchAsync(async (req, res) => {
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
router.post('/:id/send', requireRole('procurement', 'controller', 'admin'), catchAsync(async (req, res) => {
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

  emitToAll('rfq:updated');
  res.json({ success: true, sendResults });
}));

/**
 * POST /api/rfqs/:id/responses
 * Manually log a vendor response (one row per PR per vendor)
 * Body: { vendorId, prId, unitCost, quantity, leadTimeDays, freight, deliveryTerms, paymentTerms, validityDays, currency, notes, receivedDate }
 */
router.post('/:id/responses', requireRole('procurement', 'controller', 'admin'), catchAsync(async (req, res) => {
  const { id } = req.params;
  const r = req.body || {};
  if (!r.vendorId || !r.prId) {
    return res.status(400).json({ success: false, error: 'vendorId and prId are required' });
  }
  const qty = Number(r.quantity || 1);
  const unit = Number(r.unitCost || 0);
  const total = unit * qty + Number(r.freight || 0);

  await transaction(async (conn) => {
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
router.post('/:id/award', requireRole('procurement', 'controller', 'admin'), catchAsync(async (req, res) => {
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
  });

  emitToAll('rfq:updated');
  emitToAll('pr:updated');
  emitToAll('invoices:updated');
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
router.post('/:id/recommend', requireRole('procurement', 'controller', 'admin'), catchAsync(async (req, res) => {
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
  });

  emitToAll('rfq:updated');
  res.json({ success: true, totalAmount, status: 'PENDING_APPROVAL' });
}));

/**
 * DELETE /api/rfqs/:id  → cancel an RFQ (and revert PRs to OPEN)
 */
router.delete('/:id', requireRole('procurement', 'controller', 'admin'), catchAsync(async (req, res) => {
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
    log('tx body complete (about to commit)');
  });
  log('tx committed');

  emitToAll('rfq:updated');
  emitToAll('pr:updated');
  emitToAll('invoices:updated');
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
    `SELECT STATUS FROM QA_RFQS WHERE RFQ_ID = :id`,
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
  });

  emitToAll('rfq:updated');
  res.json({ success: true });
}));

/**
 * POST /api/rfqs/:id/escalate
 * Phase 5 — manual escalation trigger.
 * Allows procurement/controller/admin to flag an RFQ as escalated before the
 * automatic threshold fires. Body: { reason?: string, escalatedTo?: string }.
 * No-op if the RFQ is already escalated.
 */
router.post('/:id/escalate', requireRole('procurement', 'controller', 'admin'), catchAsync(async (req, res) => {
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

module.exports = router;
