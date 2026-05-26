'use strict';

/**
 * /api/goods-receipts — procurement receiving subsystem.
 *
 * Module 3 of the Reports Foundation build-out. Captures actual receipt
 * events against awarded PRs so vendor scorecards have something to
 * measure (on-time delivery, defect rate, lead-time accuracy, return
 * rate). Without this, the existing "PR.STATUS = FULFILLED" was just a
 * flag — no qty, no condition, no timestamp tied to physical receipt.
 *
 * Endpoints:
 *   POST   /api/goods-receipts                 → log a new receipt
 *   GET    /api/goods-receipts                 → list with filters
 *   GET    /api/goods-receipts/:id             → single receipt + returns
 *   POST   /api/goods-receipts/:id/return      → log a return event
 *   GET    /api/vendor-scorecards              → all vendors ranked
 *   GET    /api/vendor-scorecards/:vendorId    → per-vendor detail
 *
 * Per-PR granularity (locked decision): one receipt → one PR. Multi-PR
 * shipments need multiple receipt rows. The cumulative-qty math here
 * adds up receipts per PR; when cumulative QTY_RECEIVED ≥ PR.QUANTITY,
 * the PR auto-flips to FULFILLED and FULFILLED_AT is stamped.
 */

const express = require('express');
const oracledb = require('oracledb');
const { execute, transaction } = require('../db');
const { catchAsync } = require('../middleware/errorHandler');
const { authMiddleware, requirePermission } = require('../middleware/authMiddleware');
const { emitToAll } = require('../utils/socketEmitter');
const { notify } = require('../services/notificationService');

const router = express.Router();
router.use(authMiddleware);

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

async function nextReceiptNumber(conn) {
  const r = await conn.execute('SELECT QA_GR_SEQ.NEXTVAL AS N FROM DUAL', {}, { outFormat: 4002 });
  const n = r.rows[0].N;
  return `GR-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`;
}

const rowToReceipt = (row) => ({
  id:                  row.RECEIPT_ID,
  receiptNumber:       row.RECEIPT_NUMBER,
  prId:                row.PR_ID,
  // Human-readable PR number + item description sourced via JOIN so the
  // list page can display "PR-2026-0008 / Laptop" instead of the raw
  // UUID-based prId. Falls back to '' if the PR was deleted (FK is ON
  // DELETE CASCADE for goods-receipt rows, but we're defensive here).
  prNumber:            row.PR_NUMBER || '',
  prItemName:          row.PR_ITEM_NAME || '',
  rfqId:               row.RFQ_ID || null,
  vendorId:            row.VENDOR_ID || null,
  // Vendor name JOINed in so the list page reads "Atia" not the UUID.
  vendorName:          row.VENDOR_NAME || '',
  receivedDate:        row.RECEIVED_DATE,
  receivedBy:          row.RECEIVED_BY || '',
  qtyOrdered:          Number(row.QTY_ORDERED || 0),
  qtyReceived:         Number(row.QTY_RECEIVED || 0),
  qtyDefective:        Number(row.QTY_DEFECTIVE || 0),
  qtyReturned:         Number(row.QTY_RETURNED || 0),
  vendorInvoiceNumber: row.VENDOR_INVOICE_NUMBER || '',
  totalValue:          Number(row.TOTAL_VALUE || 0),
  currency:            row.CURRENCY || 'GHS',
  status:              row.STATUS || 'PENDING_QC',
  conditionNotes:      row.CONDITION_NOTES || '',
  createdAt:           row.CREATED_AT,
  updatedAt:           row.UPDATED_AT
});

const rowToReturn = (row) => ({
  id:           row.RETURN_ID,
  receiptId:    row.RECEIPT_ID,
  returnDate:   row.RETURN_DATE,
  returnQty:    Number(row.RETURN_QTY || 0),
  returnReason: row.RETURN_REASON,
  rmaNumber:    row.RMA_NUMBER || '',
  loggedBy:     row.LOGGED_BY || '',
  loggedAt:     row.LOGGED_AT,
  notes:        row.NOTES || ''
});

/**
 * Re-derive PR fulfilment state from its goods-receipts inside an open
 * transaction. Flips PR.STATUS to 'FULFILLED' and stamps FULFILLED_AT
 * when cumulative QTY_RECEIVED − QTY_RETURNED ≥ PR.QUANTITY.
 * (Reverts to AWARDED if a later return drops effective qty below total
 * — surfaces the case where a PR was prematurely marked done.)
 */
async function recomputePrFulfilment(conn, prId, actor) {
  const sumRes = await conn.execute(
    `SELECT NVL(SUM(QTY_RECEIVED - QTY_RETURNED), 0) AS NET
       FROM QA_GOODS_RECEIPTS WHERE PR_ID = :pid`,
    { pid: prId }, { outFormat: 4002 }
  );
  const net = Number(sumRes.rows[0].NET || 0);

  const prRes = await conn.execute(
    `SELECT QUANTITY, STATUS FROM QA_PURCHASE_REQUISITIONS WHERE PR_ID = :pid`,
    { pid: prId }, { outFormat: 4002 }
  );
  const pr = prRes.rows?.[0];
  if (!pr) return;

  const ordered = Number(pr.QUANTITY || 0);
  const isFulfilled = ordered > 0 && net >= ordered;
  const currentStatus = pr.STATUS;

  // Only transition between AWARDED and FULFILLED — leave CANCELLED /
  // IN_RFQ / etc untouched (those mean the PR isn't in a fulfilment-
  // capable state).
  if (isFulfilled && currentStatus !== 'FULFILLED') {
    await conn.execute(
      `UPDATE QA_PURCHASE_REQUISITIONS
          SET STATUS = 'FULFILLED', FULFILLED_AT = SYSTIMESTAMP, UPDATED_AT = SYSTIMESTAMP
        WHERE PR_ID = :pid`,
      { pid: prId }
    );
    // Audit event so the procurement timeline reflects the auto-flip
    await conn.execute(
      `INSERT INTO QA_PROCUREMENT_EVENTS (EVENT_TYPE, ENTITY_TYPE, ENTITY_ID, ACTOR, PAYLOAD)
       VALUES ('PR_FULFILLED','PR',:pid,:actor,:payload)`,
      { pid: prId, actor, payload: JSON.stringify({ source: 'goods_receipt', netReceived: net, ordered }) }
    );
  } else if (!isFulfilled && currentStatus === 'FULFILLED') {
    // Defensive — a return pulled net below total. Revert so dashboards stop lying.
    await conn.execute(
      `UPDATE QA_PURCHASE_REQUISITIONS
          SET STATUS = 'AWARDED', FULFILLED_AT = NULL, UPDATED_AT = SYSTIMESTAMP
        WHERE PR_ID = :pid`,
      { pid: prId }
    );
    await conn.execute(
      `INSERT INTO QA_PROCUREMENT_EVENTS (EVENT_TYPE, ENTITY_TYPE, ENTITY_ID, ACTOR, PAYLOAD)
       VALUES ('PR_FULFILLMENT_REVERTED','PR',:pid,:actor,:payload)`,
      { pid: prId, actor, payload: JSON.stringify({ source: 'goods_receipt_return', netReceived: net, ordered }) }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/goods-receipts
// Body: { prId, vendorId?, rfqId?, receivedDate, qtyReceived, qtyDefective?,
//         vendorInvoiceNumber?, totalValue?, currency?, status?, conditionNotes? }
// ─────────────────────────────────────────────────────────────────────────
router.post('/', requirePermission('goods_receipt.log'), catchAsync(async (req, res) => {
  const r = req.body || {};
  if (!r.prId || r.qtyReceived === undefined || r.qtyReceived === null) {
    return res.status(400).json({ success: false, error: 'prId and qtyReceived are required.' });
  }
  const qtyReceived = Number(r.qtyReceived);
  if (!Number.isFinite(qtyReceived) || qtyReceived <= 0) {
    return res.status(400).json({ success: false, error: 'qtyReceived must be a positive number.' });
  }

  // Validate the PR exists and is in a receivable state. Only AWARDED and
  // FULFILLED accept receipts — FULFILLED so corrections (e.g. a late
  // partial shipment after we marked it done early) still work, but not
  // CANCELLED / IN_RFQ / OPEN.
  const prRes = await execute(
    `SELECT PR_ID, STATUS, QUANTITY FROM QA_PURCHASE_REQUISITIONS WHERE PR_ID = :id`,
    { id: r.prId }, { outFormat: 4002 }
  );
  const prRow = prRes.rows?.[0];
  if (!prRow) {
    return res.status(404).json({ success: false, error: 'Purchase requisition not found.' });
  }
  if (!['AWARDED', 'FULFILLED'].includes(prRow.STATUS)) {
    return res.status(422).json({
      success: false,
      error: `Cannot receive goods against a PR in status "${prRow.STATUS}". Only AWARDED (or already-FULFILLED for late corrections) PRs accept receipts.`
    });
  }

  // ── Resolve awarded vendor + unit cost from the winning RFQ response.
  // This lets us:
  //   1. Default VENDOR_ID + RFQ_ID + CURRENCY from the award if the
  //      client didn't pass them (common case — operator just clicks
  //      "Receive" on a PR and doesn't think about the vendor).
  //   2. Auto-compute TOTAL_VALUE = UNIT_COST × qtyReceived when the
  //      operator doesn't supply a number. They CAN override by
  //      passing an explicit totalValue (e.g. vendor invoice came in
  //      different from the RFQ quote).
  //
  // The query finds the awarded vendor's response row for this PR via
  // QA_RFQS.AWARDED_VENDOR_ID. Limited to most-recent AWARDED RFQ in
  // case a PR was awarded twice (rare but possible after a re-award).
  let awardedVendorId = r.vendorId || null;
  let awardedRfqId    = r.rfqId    || null;
  let awardedUnitCost = 0;
  let awardedCurrency = null;
  try {
    const awardRes = await execute(
      `SELECT rr.UNIT_COST, rr.CURRENCY, rfq.RFQ_ID, rfq.AWARDED_VENDOR_ID
         FROM QA_RFQ_RESPONSES rr
         JOIN QA_RFQS rfq ON rfq.RFQ_ID = rr.RFQ_ID
        WHERE rr.PR_ID = :pid
          AND rr.VENDOR_ID = rfq.AWARDED_VENDOR_ID
          AND rfq.STATUS IN ('AWARDED','CLOSED')
        ORDER BY rfq.AWARDED_AT DESC NULLS LAST
        FETCH FIRST 1 ROWS ONLY`,
      { pid: r.prId }, { outFormat: 4002 }
    );
    const awardRow = awardRes.rows?.[0];
    if (awardRow) {
      if (!awardedRfqId)    awardedRfqId    = awardRow.RFQ_ID || null;
      if (!awardedVendorId) awardedVendorId = awardRow.AWARDED_VENDOR_ID || null;
      awardedUnitCost = Number(awardRow.UNIT_COST || 0);
      awardedCurrency = awardRow.CURRENCY || null;
    }
  } catch (e) {
    console.error('[goodsReceipts award lookup] failed:', e.message);
    // Non-fatal — fall through with whatever the client passed.
  }

  // Auto-compute totalValue only when the client didn't pass one (or
  // passed 0). If they passed an explicit non-zero value, trust it —
  // vendor invoices routinely differ from RFQ quotes.
  let totalValue = Number(r.totalValue) || 0;
  if (totalValue <= 0 && awardedUnitCost > 0) {
    totalValue = Number((awardedUnitCost * qtyReceived).toFixed(2));
  }
  const currency = r.currency || awardedCurrency || 'GHS';

  let receiptId = null;
  let receiptNumber = null;
  await transaction(async (conn) => {
    receiptNumber = await nextReceiptNumber(conn);
    const ins = await conn.execute(
      `INSERT INTO QA_GOODS_RECEIPTS (
         RECEIPT_NUMBER, PR_ID, RFQ_ID, VENDOR_ID, RECEIVED_DATE, RECEIVED_BY,
         QTY_ORDERED, QTY_RECEIVED, QTY_DEFECTIVE,
         VENDOR_INVOICE_NUMBER, TOTAL_VALUE, CURRENCY, STATUS, CONDITION_NOTES
       ) VALUES (
         :rn, :pid, :rfq, :vid, :rdate, :rby,
         :qo, :qr, :qd,
         :vin, :tv, :cur, :st, :notes
       )
       RETURNING RECEIPT_ID INTO :id`,
      {
        rn:    receiptNumber,
        pid:   r.prId,
        // Use the awarded RFQ + vendor we just resolved so the row
        // always carries the actual award linkage, not whatever the
        // operator happened (or didn't) to send.
        rfq:   awardedRfqId,
        vid:   awardedVendorId,
        rdate: r.receivedDate ? new Date(r.receivedDate) : new Date(),
        rby:   req.user.email,
        qo:    Number(prRow.QUANTITY || 0),
        qr:    qtyReceived,
        qd:    Number(r.qtyDefective) || 0,
        vin:   r.vendorInvoiceNumber || null,
        tv:    totalValue,
        cur:   currency,
        st:    r.status || 'PENDING_QC',
        notes: r.conditionNotes || null,
        id:    { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
      }
    );
    receiptId = ins.outBinds?.id?.[0] || null;

    // Audit event so each receipt appears in the PR's history strip.
    // The PR_FULFILLED event (from recomputePrFulfilment) only fires when
    // cumulative qty hits the ordered qty — without this row, partial
    // receipts would be invisible on the timeline.
    await conn.execute(
      `INSERT INTO QA_PROCUREMENT_EVENTS (EVENT_TYPE, ENTITY_TYPE, ENTITY_ID, ACTOR, PAYLOAD)
       VALUES ('PR_GOODS_RECEIVED','PR',:pid,:actor,:payload)`,
      {
        pid: r.prId,
        actor: req.user.email,
        payload: JSON.stringify({
          receiptId,
          receiptNumber,
          qtyReceived,
          qtyDefective: Number(r.qtyDefective) || 0,
          vendorId: awardedVendorId,
          rfqId: awardedRfqId,
          totalValue,
          currency,
          status: r.status || 'PENDING_QC'
        })
      }
    );

    await recomputePrFulfilment(conn, r.prId, req.user.email);
  });

  emitToAll('goods-receipts:updated');
  emitToAll('pr:updated');

  // Notify procurement head + sales (if the linked invoice is awaiting
  // sourcing) — best-effort, never blocks the response.
  try {
    notify({
      to:         { roles: ['procurement_head'], excludeActor: true },
      actor:      req.user.email,
      type:       'goods_receipt.logged',
      title:      `Goods received: ${receiptNumber}`,
      body:       `${qtyReceived} units received against PR ${r.prId} by ${req.user.email}.`,
      severity:   'info',
      category:   'procurement',
      entityType: 'PR',
      entityId:   r.prId,
      linkPage:   'purchaseRequisitionDetail',
      linkContext: r.prId,
      groupKey:   `goods_receipt.logged:${r.prId}`
    });
  } catch (e) {
    console.error('[goodsReceipts notify] failed:', e.message);
  }

  res.json({ success: true, data: { receiptId, receiptNumber } });
}));

// ─────────────────────────────────────────────────────────────────────────
// GET /api/goods-receipts?prId=&vendorId=&from=&to=
// ─────────────────────────────────────────────────────────────────────────
router.get('/', requirePermission('goods_receipt.log'), catchAsync(async (req, res) => {
  const { prId, vendorId, from, to, status } = req.query;
  // LEFT JOIN to PRs + vendors so the list page can show human-readable
  // PR_NUMBER + ITEM_NAME + VENDOR_NAME alongside the IDs. LEFT (not
  // INNER) so a receipt against a since-deleted vendor still renders;
  // those edge cases just show blank names rather than disappearing.
  let sql = `
    SELECT gr.*,
           pr.PR_NUMBER  AS PR_NUMBER,
           pr.ITEM_NAME  AS PR_ITEM_NAME,
           v.VENDOR_NAME AS VENDOR_NAME
      FROM QA_GOODS_RECEIPTS gr
      LEFT JOIN QA_PURCHASE_REQUISITIONS pr ON pr.PR_ID = gr.PR_ID
      LEFT JOIN QA_VENDORS v ON v.VENDOR_ID = gr.VENDOR_ID
     WHERE 1=1`;
  const binds = {};
  if (prId)     { sql += ' AND gr.PR_ID = :pid';        binds.pid    = prId; }
  if (vendorId) { sql += ' AND gr.VENDOR_ID = :vid';    binds.vid    = vendorId; }
  if (status)   { sql += ' AND gr.STATUS = :st';        binds.st     = status; }
  if (from)     { sql += ' AND gr.RECEIVED_DATE >= :fr'; binds.fr    = new Date(from); }
  if (to)       { sql += ' AND gr.RECEIVED_DATE <= :tt'; binds.tt    = new Date(to); }
  sql += ' ORDER BY gr.RECEIVED_DATE DESC, gr.CREATED_AT DESC';
  const r = await execute(sql, binds);
  res.json({ success: true, data: (r.rows || []).map(rowToReceipt) });
}));

// ─────────────────────────────────────────────────────────────────────────
// GET /api/goods-receipts/:id — single receipt with its returns
// ─────────────────────────────────────────────────────────────────────────
router.get('/:id', requirePermission('goods_receipt.log'), catchAsync(async (req, res) => {
  const { id } = req.params;
  const r = await execute(
    `SELECT gr.*,
            pr.PR_NUMBER  AS PR_NUMBER,
            pr.ITEM_NAME  AS PR_ITEM_NAME,
            v.VENDOR_NAME AS VENDOR_NAME
       FROM QA_GOODS_RECEIPTS gr
       LEFT JOIN QA_PURCHASE_REQUISITIONS pr ON pr.PR_ID = gr.PR_ID
       LEFT JOIN QA_VENDORS v ON v.VENDOR_ID = gr.VENDOR_ID
      WHERE gr.RECEIPT_ID = :id`,
    { id }
  );
  if (!r.rows || r.rows.length === 0) {
    return res.status(404).json({ success: false, error: 'Receipt not found.' });
  }
  const receipt = rowToReceipt(r.rows[0]);
  const retRes = await execute(
    `SELECT * FROM QA_GOODS_RECEIPT_RETURNS WHERE RECEIPT_ID = :id ORDER BY RETURN_DATE DESC`,
    { id }
  );
  receipt.returns = (retRes.rows || []).map(rowToReturn);
  res.json({ success: true, data: receipt });
}));

// ─────────────────────────────────────────────────────────────────────────
// POST /api/goods-receipts/:id/return
// Body: { returnDate, returnQty, returnReason, rmaNumber?, notes? }
// ─────────────────────────────────────────────────────────────────────────
router.post('/:id/return', requirePermission('goods_receipt.return'), catchAsync(async (req, res) => {
  const { id } = req.params;
  const r = req.body || {};
  if (r.returnQty === undefined || !r.returnReason) {
    return res.status(400).json({ success: false, error: 'returnQty and returnReason are required.' });
  }
  const returnQty = Number(r.returnQty);
  if (!Number.isFinite(returnQty) || returnQty <= 0) {
    return res.status(400).json({ success: false, error: 'returnQty must be a positive number.' });
  }

  let prId = null;
  await transaction(async (conn) => {
    const cur = await conn.execute(
      `SELECT PR_ID, QTY_RECEIVED, QTY_RETURNED FROM QA_GOODS_RECEIPTS WHERE RECEIPT_ID = :id`,
      { id }, { outFormat: 4002 }
    );
    const row = cur.rows?.[0];
    if (!row) throw new Error('Receipt not found.');
    prId = row.PR_ID;

    // Guard — can't return more than what was received minus already-returned
    const alreadyReturned = Number(row.QTY_RETURNED || 0);
    const received        = Number(row.QTY_RECEIVED || 0);
    const remainingForReturn = received - alreadyReturned;
    if (returnQty > remainingForReturn + 0.0001) {
      const err = new Error(
        `Cannot return ${returnQty} — only ${remainingForReturn} remain available for return on this receipt (received ${received}, already returned ${alreadyReturned}).`
      );
      err.statusCode = 422;
      throw err;
    }

    await conn.execute(
      `INSERT INTO QA_GOODS_RECEIPT_RETURNS (
         RECEIPT_ID, RETURN_DATE, RETURN_QTY, RETURN_REASON, RMA_NUMBER, LOGGED_BY, NOTES
       ) VALUES (
         :rid, :rdate, :qty, :reason, :rma, :lby, :notes
       )`,
      {
        rid:    Number(id),
        rdate:  r.returnDate ? new Date(r.returnDate) : new Date(),
        qty:    returnQty,
        reason: r.returnReason,
        rma:    r.rmaNumber || null,
        lby:    req.user.email,
        notes:  r.notes || null
      }
    );

    // Roll the QTY_RETURNED sum onto the parent receipt for fast filtering
    await conn.execute(
      `UPDATE QA_GOODS_RECEIPTS
          SET QTY_RETURNED = (SELECT NVL(SUM(RETURN_QTY), 0) FROM QA_GOODS_RECEIPT_RETURNS WHERE RECEIPT_ID = :id),
              UPDATED_AT = SYSTIMESTAMP
        WHERE RECEIPT_ID = :id`,
      { id }
    );

    // PR's effective net might have dropped below ordered qty — recompute.
    await recomputePrFulfilment(conn, prId, req.user.email);
  });

  emitToAll('goods-receipts:updated');
  emitToAll('pr:updated');

  res.json({ success: true });
}));

module.exports = router;
