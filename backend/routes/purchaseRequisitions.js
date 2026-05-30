'use strict';

const express = require('express');
const crypto = require('crypto');
const { execute, transaction } = require('../db');
const { catchAsync } = require('../middleware/errorHandler');
const { authMiddleware, requireRole, requirePermission } = require('../middleware/authMiddleware');
const { emitToAll } = require('../utils/socketEmitter');
const { can } = require('../../shared/permissions.js');
const { notify } = require('../services/notificationService');

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

  // Pull recent procurement events for this PR. PAYLOAD is included so
  // the frontend can render rich context (rejection reason, recommended
  // vendor, award total) under each event.
  const evRes = await execute(
    `SELECT EVENT_ID, EVENT_TIME, EVENT_TYPE, ACTOR, PAYLOAD
     FROM QA_PROCUREMENT_EVENTS
     WHERE ENTITY_TYPE = 'PR' AND ENTITY_ID = :id
     ORDER BY EVENT_TIME DESC FETCH FIRST 50 ROWS ONLY`,
    { id }
  );
  const events = (evRes.rows || []).map(r => {
    let payload = null;
    if (r.PAYLOAD) {
      try { payload = JSON.parse(r.PAYLOAD); }
      catch (_e) { payload = null; }
    }
    return {
      id: r.EVENT_ID,
      time: r.EVENT_TIME,
      type: r.EVENT_TYPE,
      actor: r.ACTOR,
      payload
    };
  });

  res.json({ success: true, data: { ...pr, invoice, events } });
}));

/**
 * POST /api/purchase-requisitions
 * Manually create a PR (procurement, controller, admin)
 */
router.post('/', requirePermission('pr.create'), catchAsync(async (req, res) => {
  const pr = req.body || {};
  if (!pr.itemName) {
    return res.status(400).json({ success: false, error: 'itemName is required' });
  }

  const id = pr.id || `PR-${crypto.randomUUID()}`;
  // PR_NUMBER now sourced from the standardized numbering policy
  // (QA_NUMBER_SEQUENCES → DOC_TYPE='PR'). Format defaults to
  // MIDSA-PR-{MM-YYYY}-{NNNNN} but is admin-configurable.
  // Legacy QA_PR_SEQ still exists for back-compat but is no longer
  // the source of truth.
  const { generateNumber } = require('../utils/numberGenerator');
  const prNumber = await generateNumber('PR');

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
router.put('/:id', requirePermission('pr.create'), catchAsync(async (req, res) => {
  const { id } = req.params;
  const updates = req.body || {};

  // ── Authorization: who can change the ASSIGNED_TO field ─────────────
  // The base `pr.create` gate is sufficient for editing your own PR (an
  // officer can update priority/notes on PRs assigned to them). But the
  // assignment field itself is a supervisory action — only roles with
  // `pr.assign` (procurement_head, admin) may set it. A 403 here stops
  // a crafted POST from sidestepping the head's authority. The field is
  // dropped from the update payload rather than 403-ing the entire
  // request when other fields are also present and legitimate.
  let assignmentChange = null; // {from, to} when assignedTo is being modified
  if (Object.prototype.hasOwnProperty.call(updates, 'assignedTo')) {
    if (!can(req.user.role, 'pr.assign')) {
      return res.status(403).json({
        success: false,
        error: 'Only the procurement head can assign or reassign a purchase requisition.'
      });
    }

    // Snapshot the existing assignee so the audit event can record from→to.
    const cur = await execute(
      `SELECT ASSIGNED_TO FROM QA_PURCHASE_REQUISITIONS WHERE PR_ID = :id`,
      { id }, { outFormat: 4002 }
    );
    if (!cur.rows || cur.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Purchase requisition not found.' });
    }
    const prevAssignee = cur.rows[0].ASSIGNED_TO || null;
    const newAssignee  = updates.assignedTo || null;
    if (prevAssignee !== newAssignee) {
      assignmentChange = { from: prevAssignee, to: newAssignee };
    }
  }

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

  // PR number (for notification body) — pull once if we'll need it.
  let prNumberForNotify = null;
  if (assignmentChange && assignmentChange.to) {
    const meta = await execute(
      `SELECT PR_NUMBER FROM QA_PURCHASE_REQUISITIONS WHERE PR_ID = :id`,
      { id }, { outFormat: 4002 }
    );
    prNumberForNotify = meta.rows?.[0]?.PR_NUMBER || id;
  }

  await transaction(async (conn) => {
    await conn.execute(
      `UPDATE QA_PURCHASE_REQUISITIONS SET ${sets.join(', ')} WHERE PR_ID = :id`,
      binds
    );
    await conn.execute(`
      INSERT INTO QA_PROCUREMENT_EVENTS (EVENT_TYPE, ENTITY_TYPE, ENTITY_ID, ACTOR, PAYLOAD)
      VALUES ('PR_UPDATED','PR',:id,:actor,:payload)
    `, { id, actor: req.user.email, payload: JSON.stringify(updates) });

    // Dedicated reassignment event — surfaces clearly in the PR history
    // panel with explicit from/to addresses, separate from the general
    // PR_UPDATED noise. Auditors looking for "who reassigned this work
    // and when" don't have to parse JSON payloads to answer.
    if (assignmentChange) {
      await conn.execute(`
        INSERT INTO QA_PROCUREMENT_EVENTS (EVENT_TYPE, ENTITY_TYPE, ENTITY_ID, ACTOR, PAYLOAD)
        VALUES ('PR_REASSIGNED','PR',:id,:actor,:payload)
      `, {
        id,
        actor: req.user.email,
        payload: JSON.stringify(assignmentChange)
      });
    }
  });

  emitToAll('pr:updated');

  // Notify the new assignee — fire-and-forget; never blocks the response.
  // Only fires on actual change (so a save-without-change doesn't spam).
  // Excludes the actor (head assigning to themselves doesn't need to
  // notify themselves) via excludeActor on the notify spec.
  if (assignmentChange && assignmentChange.to) {
    notify({
      to:         { users: [assignmentChange.to], excludeActor: true },
      actor:      req.user.email,
      type:       'pr.assigned',
      title:      `PR ${prNumberForNotify} assigned to you`,
      body:       `${req.user.email} assigned this purchase requisition to you. Open it from the PR list to begin work.`,
      severity:   'info',
      category:   'procurement',
      entityType: 'PR',
      entityId:   id,
      linkPage:   'purchaseRequisitionDetail',
      linkContext: id,
      groupKey:   `pr.assigned:${id}`
    });
  }

  res.json({ success: true });
}));

/**
 * POST /api/purchase-requisitions/:id/cancel
 *
 * Module 3 enhancement — accepts a controlled `cancellationReason` enum
 * + optional `cancellationNotes` free text. Persists into the dedicated
 * columns added by migrate_module3, AND keeps the original free-text
 * `reason` writing to NOTES for backward compatibility with the existing
 * front-end fallback that reads NOTES on cancelled PRs.
 *
 * Body:
 *   {
 *     cancellationReason?: 'DUPLICATE' | 'STOCK_REAPPEARED' | 'CUSTOMER_CANCELLED'
 *                        | 'VENDOR_UNAVAILABLE' | 'BUDGET_EXCEEDED'
 *                        | 'LEAD_TIME_UNACCEPTABLE' | 'SOURCED_INTERNALLY' | 'OTHER'
 *     cancellationNotes?:  string (free text; saved alongside the code)
 *     reason?:             string (legacy — written to NOTES for back-compat)
 *   }
 */
const VALID_CANCELLATION_REASONS = new Set([
  'DUPLICATE', 'STOCK_REAPPEARED', 'CUSTOMER_CANCELLED',
  'VENDOR_UNAVAILABLE', 'BUDGET_EXCEEDED',
  'LEAD_TIME_UNACCEPTABLE', 'SOURCED_INTERNALLY', 'OTHER'
]);
router.post('/:id/cancel', requirePermission('pr.cancel'), catchAsync(async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};

  // Validate the controlled enum if supplied. Older callers that only
  // send `reason` (free text) keep working — we map them to 'OTHER' so
  // the report-friendly column always has a value.
  let cancellationReason = body.cancellationReason;
  if (cancellationReason && !VALID_CANCELLATION_REASONS.has(cancellationReason)) {
    return res.status(400).json({
      success: false,
      error: `Invalid cancellationReason. Must be one of: ${Array.from(VALID_CANCELLATION_REASONS).join(', ')}.`
    });
  }
  if (!cancellationReason) cancellationReason = 'OTHER';

  // NOTES still gets the human-readable reason for back-compat with the
  // existing PR detail UI that displays NOTES on cancelled PRs.
  const humanReason = body.cancellationNotes
    || body.reason
    || `Cancelled (${cancellationReason})`;

  await transaction(async (conn) => {
    await conn.execute(
      `UPDATE QA_PURCHASE_REQUISITIONS
          SET STATUS              = 'CANCELLED',
              UPDATED_AT          = SYSTIMESTAMP,
              NOTES               = :n,
              CANCELLATION_REASON = :crsn,
              CANCELLATION_NOTES  = :cnotes,
              CANCELLED_AT        = SYSTIMESTAMP,
              CANCELLED_BY        = :cby
        WHERE PR_ID = :id`,
      {
        id,
        n:      humanReason,
        crsn:   cancellationReason,
        cnotes: body.cancellationNotes || null,
        cby:    req.user.email
      }
    );
    await conn.execute(`
      INSERT INTO QA_PROCUREMENT_EVENTS (EVENT_TYPE, ENTITY_TYPE, ENTITY_ID, ACTOR, PAYLOAD)
      VALUES ('PR_CANCELLED','PR',:id,:actor,:payload)
    `, {
      id,
      actor: req.user.email,
      payload: JSON.stringify({
        cancellationReason,
        cancellationNotes: body.cancellationNotes || null,
        legacyReason:      body.reason || null
      })
    });
  });
  emitToAll('pr:updated');
  res.json({ success: true });
}));

module.exports = router;
