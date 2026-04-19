'use strict';

const express = require('express');
const crypto = require('crypto');
const { execute, transaction } = require('../db');
const { catchAsync } = require('../middleware/errorHandler');
const { authMiddleware, requireRole } = require('../middleware/authMiddleware');
const { emitToAll } = require('../utils/socketEmitter');

const router = express.Router();

router.use(authMiddleware);

const rowToPR = (row) => ({
  id: row.PR_ID,
  prNumber: row.PR_NUMBER || '',
  invoiceId: row.INVOICE_ID || '',
  quoteLineMatchKey: row.QUOTE_LINE_MATCH_KEY || '',
  itemName: row.ITEM_NAME || '',
  itemDescription: row.ITEM_DESCRIPTION || '',
  quantity: row.QUANTITY != null ? Number(row.QUANTITY) : 0,
  uom: row.UOM || 'EA',
  neededBy: row.NEEDED_BY || '',
  reason: row.REASON || 'CUSTOM_SOURCED',
  status: row.STATUS || 'OPEN',
  priority: row.PRIORITY || 'normal',
  requestedBy: row.REQUESTED_BY || '',
  assignedTo: row.ASSIGNED_TO || '',
  customerName: row.CUSTOMER_NAME || '',
  notes: row.NOTES || '',
  createdAt: row.CREATED_AT,
  updatedAt: row.UPDATED_AT
});

/**
 * GET /api/purchase-requisitions
 * List with optional filters: status, assignedTo, invoiceId
 * Supports pagination: page (1-based, default 1), pageSize (default 50)
 */
router.get('/', catchAsync(async (req, res) => {
  const { status, assignedTo, invoiceId } = req.query;
  const page     = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 50));
  const offset   = (page - 1) * pageSize;

  let whereClause = 'WHERE 1=1';
  const binds = {};
  if (status) {
    whereClause += ' AND STATUS = :status';
    binds.status = status;
  }
  if (assignedTo) {
    whereClause += ' AND ASSIGNED_TO = :assignedTo';
    binds.assignedTo = assignedTo;
  }
  if (invoiceId) {
    whereClause += ' AND INVOICE_ID = :invoiceId';
    binds.invoiceId = invoiceId;
  }

  // Count query for pagination metadata
  const countResult = await execute(
    `SELECT COUNT(*) AS TOTAL FROM QA_PURCHASE_REQUISITIONS ${whereClause}`,
    binds
  );
  const total = Number((countResult.rows[0] && countResult.rows[0].TOTAL) || 0);

  // Paginated data query
  const dataResult = await execute(
    `SELECT * FROM QA_PURCHASE_REQUISITIONS ${whereClause}
     ORDER BY CREATED_AT DESC
     OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
    { ...binds, offset, limit: pageSize }
  );

  res.json({
    success: true,
    data: (dataResult.rows || []).map(rowToPR),
    pagination: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
  });
}));

/**
 * GET /api/purchase-requisitions/:id
 * Single PR with linked invoice metadata
 */
router.get('/:id', catchAsync(async (req, res) => {
  const { id } = req.params;
  const prRes = await execute('SELECT * FROM QA_PURCHASE_REQUISITIONS WHERE PR_ID = :id', { id });
  if (!prRes.rows || prRes.rows.length === 0) {
    return res.status(404).json({ success: false, error: 'Purchase requisition not found' });
  }
  const pr = rowToPR(prRes.rows[0]);

  // Pull associated invoice header (if linked)
  let invoice = null;
  if (pr.invoiceId) {
    const invRes = await execute(
      `SELECT INVOICE_ID, CUSTOMER_NAME, STATUS, TOTAL, CURRENCY, INVOICE_DATE, SOURCING_STATUS, PR_COUNT
       FROM QA_INVOICES WHERE INVOICE_ID = :id`,
      { id: pr.invoiceId }
    );
    if (invRes.rows && invRes.rows[0]) {
      const r = invRes.rows[0];
      invoice = {
        id: r.INVOICE_ID,
        customerName: r.CUSTOMER_NAME,
        status: r.STATUS,
        total: r.TOTAL,
        currency: r.CURRENCY,
        date: r.INVOICE_DATE,
        sourcingStatus: r.SOURCING_STATUS,
        prCount: r.PR_COUNT
      };
    }
  }

  // Pull recent procurement events for this PR
  const evRes = await execute(
    `SELECT EVENT_ID, EVENT_TIME, EVENT_TYPE, ACTOR
     FROM QA_PROCUREMENT_EVENTS
     WHERE ENTITY_TYPE = 'PR' AND ENTITY_ID = :id
     ORDER BY EVENT_TIME DESC FETCH FIRST 50 ROWS ONLY`,
    { id }
  );
  const events = (evRes.rows || []).map(r => ({
    id: r.EVENT_ID,
    time: r.EVENT_TIME,
    type: r.EVENT_TYPE,
    actor: r.ACTOR
  }));

  res.json({ success: true, data: { ...pr, invoice, events } });
}));

/**
 * POST /api/purchase-requisitions
 * Manually create a PR (procurement, controller, admin)
 */
router.post('/', requireRole('procurement', 'controller', 'admin'), catchAsync(async (req, res) => {
  const pr = req.body || {};
  if (!pr.itemName) {
    return res.status(400).json({ success: false, error: 'itemName is required' });
  }

  const id = pr.id || `PR-${crypto.randomUUID()}`;
  const seqRes = await execute('SELECT QA_PR_SEQ.NEXTVAL AS N FROM DUAL');
  const seqNum = seqRes.rows[0].N;
  const prNumber = `PR-${new Date().getFullYear()}-${String(seqNum).padStart(4, '0')}`;

  await transaction(async (conn) => {
    await conn.execute(`
      INSERT INTO QA_PURCHASE_REQUISITIONS (
        PR_ID, PR_NUMBER, INVOICE_ID, QUOTE_LINE_MATCH_KEY, ITEM_NAME, ITEM_DESCRIPTION,
        QUANTITY, UOM, NEEDED_BY, REASON, STATUS, PRIORITY,
        REQUESTED_BY, ASSIGNED_TO, CUSTOMER_NAME, NOTES
      ) VALUES (
        :id, :pn, :iid, :mk, :inm, :idesc,
        :qty, :uom, :nb, :reas, :st, :pri,
        :rb, :asg, :cn, :notes
      )
    `, {
      id,
      pn: prNumber,
      iid: pr.invoiceId || null,
      mk: pr.quoteLineMatchKey || null,
      inm: pr.itemName,
      idesc: pr.itemDescription || null,
      qty: Number(pr.quantity) || 1,
      uom: pr.uom || 'EA',
      nb: pr.neededBy || null,
      reas: pr.reason || 'CUSTOM_SOURCED',
      st: pr.status || 'OPEN',
      pri: pr.priority || 'normal',
      rb: req.user.email,
      asg: pr.assignedTo || null,
      cn: pr.customerName || null,
      notes: pr.notes || null
    });

    await conn.execute(`
      INSERT INTO QA_PROCUREMENT_EVENTS (EVENT_TYPE, ENTITY_TYPE, ENTITY_ID, ACTOR, PAYLOAD)
      VALUES ('PR_CREATED','PR',:id,:actor,:payload)
    `, { id, actor: req.user.email, payload: JSON.stringify({ source: 'manual', prNumber }) });
  });

  emitToAll('pr:updated');
  res.json({ success: true, id, prNumber });
}));

/**
 * PUT /api/purchase-requisitions/:id
 * Update fields (assign, status, priority, notes)
 */
router.put('/:id', requireRole('procurement', 'controller', 'admin'), catchAsync(async (req, res) => {
  const { id } = req.params;
  const updates = req.body || {};

  const mappings = {
    status: 'STATUS',
    priority: 'PRIORITY',
    assignedTo: 'ASSIGNED_TO',
    neededBy: 'NEEDED_BY',
    notes: 'NOTES',
    itemName: 'ITEM_NAME',
    itemDescription: 'ITEM_DESCRIPTION',
    quantity: 'QUANTITY',
    uom: 'UOM',
    reason: 'REASON'
  };

  const sets = [];
  const binds = { id };
  for (const [k, col] of Object.entries(mappings)) {
    if (updates[k] !== undefined) {
      sets.push(`${col} = :${k}`);
      binds[k] = updates[k];
    }
  }
  if (sets.length === 0) return res.json({ success: true });

  sets.push('UPDATED_AT = SYSTIMESTAMP');

  await transaction(async (conn) => {
    await conn.execute(
      `UPDATE QA_PURCHASE_REQUISITIONS SET ${sets.join(', ')} WHERE PR_ID = :id`,
      binds
    );
    await conn.execute(`
      INSERT INTO QA_PROCUREMENT_EVENTS (EVENT_TYPE, ENTITY_TYPE, ENTITY_ID, ACTOR, PAYLOAD)
      VALUES ('PR_UPDATED','PR',:id,:actor,:payload)
    `, { id, actor: req.user.email, payload: JSON.stringify(updates) });
  });

  emitToAll('pr:updated');
  res.json({ success: true });
}));

/**
 * POST /api/purchase-requisitions/:id/cancel
 */
router.post('/:id/cancel', requireRole('procurement', 'controller', 'admin'), catchAsync(async (req, res) => {
  const { id } = req.params;
  const reason = req.body?.reason || 'Cancelled by procurement';
  await transaction(async (conn) => {
    await conn.execute(
      `UPDATE QA_PURCHASE_REQUISITIONS
       SET STATUS = 'CANCELLED', UPDATED_AT = SYSTIMESTAMP, NOTES = :n
       WHERE PR_ID = :id`,
      { id, n: reason }
    );
    await conn.execute(`
      INSERT INTO QA_PROCUREMENT_EVENTS (EVENT_TYPE, ENTITY_TYPE, ENTITY_ID, ACTOR, PAYLOAD)
      VALUES ('PR_CANCELLED','PR',:id,:actor,:payload)
    `, { id, actor: req.user.email, payload: JSON.stringify({ reason }) });
  });
  emitToAll('pr:updated');
  res.json({ success: true });
}));

module.exports = router;
