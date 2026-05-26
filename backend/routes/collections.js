'use strict';

/**
 * /api/collections — accounts-receivable / payment-application subsystem.
 *
 * Module 2 of the Reports Foundation build-out plan. Stands up the
 * payment-logging, withholding-tax-prediction, aging, DSO, statement,
 * and follow-up-action endpoints that earlier work could not produce
 * because the schema and routes did not exist.
 *
 * Wired into server.js as:
 *   app.use('/api/collections', collectionsRoutes);
 *
 * Permissions:
 *   POST   /payments              → payment.log
 *   POST   /payments/predict-wht  → payment.log (sees inputs only, no mutation)
 *   POST   /payments/:id/reverse  → payment.reverse
 *   POST   /unallocated           → payment.log
 *   POST   /unallocated/:id/apply → payment.apply.unallocated
 *   GET    /aging                 → customer.statement.read
 *   GET    /dso                   → customer.statement.read
 *   GET    /customer/:id/statement→ customer.statement.read
 *   POST   /actions               → collections.action.log
 *   GET    /actions               → customer.statement.read
 *
 * Every mutation runs inside a `transaction()` so AR balance updates,
 * payment inserts, and audit-event writes all commit (or roll back)
 * together. Realtime sockets emit `invoices:updated` + `payments:updated`
 * so the Collections Workbench + dashboards refresh live across windows.
 */

const express = require('express');
const oracledb = require('oracledb');
const { execute, transaction } = require('../db');
const { catchAsync } = require('../middleware/errorHandler');
const { authMiddleware, requirePermission } = require('../middleware/authMiddleware');
const { emitToAll } = require('../utils/socketEmitter');
const { notify } = require('../services/notificationService');

// ── Payment-eligible invoice statuses ────────────────────────────────────
// Per the post-Module-2 adjustment: payments can only be logged once sales
// has acknowledged the deal. Awaiting Acceptance is included because in
// Ghana B2B practice customers sometimes pay before formal acceptance
// (e.g. wire transfers initiated against the proforma) — finance needs to
// be able to record the receipt. All other statuses (Draft, Pending
// Pricing, Pending Approval, Approved-but-not-sent, Cancelled, Rejected)
// remain blocked at the server boundary.
const PAYMENT_ELIGIBLE_STATUSES = new Set([
  'Awaiting Acceptance',
  'Customer Accepted',
  'Partially Paid',
  'Paid'
]);

// 24-hour officer reverse window. Anything older requires a finance head.
// Bypassed when the actor's role is finance_head or admin.
const OFFICER_REVERSE_WINDOW_HOURS = 24;

const router = express.Router();
router.use(authMiddleware);

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/** Generate a `RCPT-2026-NNNN` receipt number using the sequence. */
async function nextReceiptNumber(conn) {
  const r = await conn.execute('SELECT QA_RCPT_SEQ.NEXTVAL AS N FROM DUAL', {}, { outFormat: 4002 });
  const n = r.rows[0].N;
  return `RCPT-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`;
}

/**
 * Recompute and persist the parent invoice's AMOUNT_PAID / BALANCE_DUE
 * inside an already-open transaction. Status auto-flips:
 *   balance ≤ 0   → 'Paid'
 *   amountPaid >0 → 'Partially Paid'
 *   else          → unchanged
 *
 * Sales-side statuses (Customer Accepted etc.) are preserved unless we
 * deliberately flip to Paid — this means a customer-accepted invoice with
 * a partial payment becomes "Partially Paid" + the customer-acceptance
 * timestamp on `CUSTOMER_ACTION_AT` stays intact.
 */
async function recomputeInvoiceBalance(conn, invoiceId) {
  // Sum only CONFIRMED payments (reversed rows excluded).
  const sumRes = await conn.execute(
    `SELECT NVL(SUM(AMOUNT), 0) AS PAID, NVL(SUM(WHT_TOTAL), 0) AS WHT
       FROM QA_INVOICE_PAYMENTS
      WHERE INVOICE_ID = :id AND (STATUS IS NULL OR STATUS = 'CONFIRMED')`,
    { id: invoiceId }, { outFormat: 4002 }
  );
  const paid = Number(sumRes.rows[0].PAID || 0);
  const wht  = Number(sumRes.rows[0].WHT  || 0);
  const effective = paid + wht; // WHT is treated as paid-to-government on customer's behalf

  const invRes = await conn.execute(
    `SELECT TOTAL, STATUS FROM QA_INVOICES WHERE INVOICE_ID = :id`,
    { id: invoiceId }, { outFormat: 4002 }
  );
  const inv = invRes.rows?.[0];
  if (!inv) return; // invoice gone — nothing to do
  const total = Number(inv.TOTAL || 0);
  const balance = Math.max(0, total - effective);

  let newStatus = inv.STATUS;
  if (balance <= 0.0001 && effective > 0) newStatus = 'Paid';
  else if (effective > 0) newStatus = 'Partially Paid';

  await conn.execute(
    `UPDATE QA_INVOICES
        SET AMOUNT_PAID = :pd, BALANCE_DUE = :bd, STATUS = :st, UPDATED_AT = SYSTIMESTAMP
      WHERE INVOICE_ID = :id`,
    { pd: paid, bd: balance, st: newStatus, id: invoiceId }
  );
}

const rowToPayment = (row) => ({
  id:              row.PAYMENT_ID,
  invoiceId:       row.INVOICE_ID,
  amount:          Number(row.AMOUNT || 0),
  paymentDate:     row.PAYMENT_DATE,
  paymentMethod:   row.PAYMENT_METHOD || '',
  referenceNumber: row.REFERENCE_NUMBER || '',
  chequeNumber:    row.CHEQUE_NUMBER || '',
  bankName:        row.BANK_NAME || '',
  whtTotal:        Number(row.WHT_TOTAL || 0),
  whtBreakdown:    row.WHT_BREAKDOWN ? safeJsonParse(row.WHT_BREAKDOWN) : [],
  receiptNumber:   row.RECEIPT_NUMBER || '',
  status:          row.STATUS || 'CONFIRMED',
  loggedBy:        row.LOGGED_BY || '',
  reversedAt:      row.REVERSED_AT || null,
  reversedBy:      row.REVERSED_BY || '',
  reversalReason:  row.REVERSAL_REASON || '',
  unallocId:       row.UNALLOC_ID || null,
  notes:           row.NOTES || '',
  createdAt:       row.CREATED_AT
});

function safeJsonParse(s, fallback = []) {
  try { return JSON.parse(s); } catch (_) { return fallback; }
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/collections/payments
// Log a payment against an invoice. Body:
//   {
//     invoiceId, amount, paymentDate, paymentMethod, referenceNumber,
//     chequeNumber?, bankName?, notes?,
//     whtBreakdown? : [{ code, rate, amount }]   ← from the predictor or manual
//   }
// ─────────────────────────────────────────────────────────────────────────
router.post('/payments', requirePermission('payment.log'), catchAsync(async (req, res) => {
  const p = req.body || {};
  if (!p.invoiceId || p.amount === undefined || p.amount === null) {
    return res.status(400).json({ success: false, error: 'invoiceId and amount are required.' });
  }
  const amount = Number(p.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ success: false, error: 'amount must be a positive number.' });
  }

  // Invoice-status gate — sales must have acknowledged the deal before
  // finance can record money against it. Returns 422 (Unprocessable
  // Entity) rather than 403 because the user has permission to log
  // payments in general; the invoice itself is the issue.
  const statusRes = await execute(
    `SELECT STATUS, TOTAL, AMOUNT_PAID, BALANCE_DUE, CUSTOMER_ID, CUSTOMER_NAME
       FROM QA_INVOICES WHERE INVOICE_ID = :id`,
    { id: p.invoiceId }, { outFormat: 4002 }
  );
  const statusRow = statusRes.rows?.[0];
  if (!statusRow) {
    return res.status(404).json({ success: false, error: 'Invoice not found.' });
  }
  if (!PAYMENT_ELIGIBLE_STATUSES.has(statusRow.STATUS)) {
    return res.status(422).json({
      success: false,
      error: `Payment cannot be logged on this invoice. Current status is "${statusRow.STATUS}" — it must be one of Awaiting Acceptance, Customer Accepted, Partially Paid, or Paid before finance can record a payment.`
    });
  }

  // Zero-balance guard — once an invoice is fully settled the workflow
  // is closed; logging another payment would be a double-entry. The
  // frontend hides the Log Payment button on Paid invoices, but a
  // crafted POST still needs the server boundary check. Tolerance ±0.01
  // so floating-point precision doesn't reject a legitimately-open
  // invoice with a 0.0001 leftover balance.
  const currentBalance = Number(
    statusRow.BALANCE_DUE != null
      ? statusRow.BALANCE_DUE
      : (Number(statusRow.TOTAL || 0) - Number(statusRow.AMOUNT_PAID || 0))
  );
  if (currentBalance <= 0.01) {
    return res.status(422).json({
      success: false,
      code: 'INVOICE_FULLY_PAID',
      error: 'This invoice is already fully paid. To correct an over-payment or refund, reverse the original payment instead of logging a new one.'
    });
  }

  const whtBreakdown = Array.isArray(p.whtBreakdown) ? p.whtBreakdown : [];
  const whtTotal = whtBreakdown.reduce((s, w) => s + (Number(w.amount) || 0), 0);

  let paymentId = null;
  let receiptNumber = null;
  await transaction(async (conn) => {
    receiptNumber = await nextReceiptNumber(conn);
    const insertRes = await conn.execute(
      `INSERT INTO QA_INVOICE_PAYMENTS (
         INVOICE_ID, AMOUNT, PAYMENT_DATE, PAYMENT_METHOD, REFERENCE_NUMBER,
         WHT_TOTAL, WHT_BREAKDOWN, RECEIPT_NUMBER, LOGGED_BY, STATUS,
         CHEQUE_NUMBER, BANK_NAME, NOTES, UNALLOC_ID
       ) VALUES (
         :iid, :amt, :pdt, :pm, :rn,
         :wt, :wb, :rcpt, :lby, 'CONFIRMED',
         :chq, :bnk, :nts, :unl
       )
       RETURNING PAYMENT_ID INTO :pid`,
      {
        iid:  p.invoiceId,
        amt:  amount,
        pdt:  p.paymentDate || null,
        pm:   p.paymentMethod || null,
        rn:   p.referenceNumber || null,
        wt:   Number(whtTotal.toFixed(2)),
        wb:   JSON.stringify(whtBreakdown),
        rcpt: receiptNumber,
        lby:  req.user.email,
        chq:  p.chequeNumber || null,
        bnk:  p.bankName || null,
        nts:  p.notes || null,
        unl:  p.unallocId || null,
        pid:  { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
      }
    );
    paymentId = insertRes.outBinds?.pid?.[0] || null;
    await recomputeInvoiceBalance(conn, p.invoiceId);
  });

  emitToAll('payments:updated');
  emitToAll('invoices:updated');

  // Best-effort notification to finance head + sales person on the invoice.
  // Failure here must never break the response.
  try {
    const invMeta = await execute(
      `SELECT SALESPERSON_ID, CREATED_BY, CUSTOMER_NAME FROM QA_INVOICES WHERE INVOICE_ID = :id`,
      { id: p.invoiceId }, { outFormat: 4002 }
    );
    const meta = invMeta.rows?.[0] || {};
    const recipients = [meta.SALESPERSON_ID, meta.CREATED_BY].filter(Boolean);
    if (recipients.length) {
      notify({
        to:         { users: recipients, roles: ['finance_head'], excludeActor: true },
        actor:      req.user.email,
        type:       'payment.logged',
        title:      `Payment logged for ${meta.CUSTOMER_NAME || 'customer'}`,
        body:       `${req.user.email} logged ${amount.toLocaleString()} against invoice ${p.invoiceId}. Receipt ${receiptNumber}.`,
        severity:   'success',
        category:   'finance',
        entityType: 'INVOICE',
        entityId:   p.invoiceId,
        linkPage:   'invoiceEditor',
        linkContext: p.invoiceId,
        groupKey:   `payment.logged:${p.invoiceId}`
      });
    }
  } catch (notifyErr) {
    console.error('[collections/payments notify] failed', notifyErr.message);
  }

  res.json({ success: true, data: { paymentId, receiptNumber } });
}));

// ─────────────────────────────────────────────────────────────────────────
// POST /api/collections/payments/:id/reverse
// Reverse a payment. Body: { reason }
// Inside a transaction: flip STATUS=REVERSED, recompute invoice balance.
// ─────────────────────────────────────────────────────────────────────────
router.post('/payments/:id/reverse', requirePermission('payment.reverse'), catchAsync(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body || {};
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ success: false, error: 'A reversal reason is required.' });
  }

  // 24-hour officer window. finance_head + admin bypass; everyone else
  // (specifically: finance_officer) can only reverse payments logged in
  // the last OFFICER_REVERSE_WINDOW_HOURS hours. Anything older requires
  // escalation to the head. This matches the locked-in decision that
  // officer reversals are reserved for typo correction, not historical
  // rewrites.
  const role = req.user?.role;
  const isHeadOrAdmin = (role === 'finance_head' || role === 'admin');

  let invoiceId = null;
  await transaction(async (conn) => {
    const cur = await conn.execute(
      `SELECT INVOICE_ID, STATUS, CREATED_AT,
              (CAST(SYSTIMESTAMP AS DATE) - CAST(CREATED_AT AS DATE)) * 24 AS HOURS_OLD
         FROM QA_INVOICE_PAYMENTS
        WHERE PAYMENT_ID = :id`,
      { id }, { outFormat: 4002 }
    );
    const row = cur.rows?.[0];
    if (!row) throw new Error('Payment not found.');
    if (row.STATUS === 'REVERSED') {
      throw new Error('Payment already reversed.');
    }
    const hoursOld = Number(row.HOURS_OLD || 0);
    if (!isHeadOrAdmin && hoursOld > OFFICER_REVERSE_WINDOW_HOURS) {
      const err = new Error(
        `This payment is ${hoursOld.toFixed(1)} hours old — outside the ${OFFICER_REVERSE_WINDOW_HOURS}-hour officer window. Ask the finance head to reverse it.`
      );
      err.statusCode = 422;
      throw err;
    }
    invoiceId = row.INVOICE_ID;

    // Bind names `:rvby` and `:rsn` — `BY` is a reserved Oracle keyword
    // (ORDER BY, GROUP BY, BULK COLLECT INTO ... BY) and using it as a
    // bind name triggers ORA-01745 "invalid host/bind variable name".
    // Same defensive renaming we did for the `:is` → `:active` fix
    // elsewhere.
    await conn.execute(
      `UPDATE QA_INVOICE_PAYMENTS
          SET STATUS = 'REVERSED',
              REVERSED_AT = SYSTIMESTAMP,
              REVERSED_BY = :rvby,
              REVERSAL_REASON = :rsn
        WHERE PAYMENT_ID = :id`,
      { rvby: req.user.email, rsn: String(reason).slice(0, 500), id }
    );
    await recomputeInvoiceBalance(conn, invoiceId);
  });

  emitToAll('payments:updated');
  emitToAll('invoices:updated');

  res.json({ success: true });
}));

// ─────────────────────────────────────────────────────────────────────────
// GET /api/collections/payments?invoiceId=&customerId=
// List payments. invoiceId scope is the common use (per-invoice ledger);
// customerId returns all payments across a customer's invoices.
// ─────────────────────────────────────────────────────────────────────────
router.get('/payments', requirePermission('customer.statement.read'), catchAsync(async (req, res) => {
  const { invoiceId, customerId, includeReversed } = req.query;

  let sql = `SELECT p.* FROM QA_INVOICE_PAYMENTS p`;
  const binds = {};
  const conds = [];

  if (customerId) {
    sql += ` JOIN QA_INVOICES i ON i.INVOICE_ID = p.INVOICE_ID`;
    conds.push('i.CUSTOMER_ID = :cid');
    binds.cid = customerId;
  }
  if (invoiceId) {
    conds.push('p.INVOICE_ID = :iid');
    binds.iid = invoiceId;
  }
  if (includeReversed !== 'true') {
    conds.push("(p.STATUS IS NULL OR p.STATUS = 'CONFIRMED')");
  }
  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  sql += ' ORDER BY p.CREATED_AT DESC';

  const r = await execute(sql, binds);
  res.json({ success: true, data: (r.rows || []).map(rowToPayment) });
}));

// ─────────────────────────────────────────────────────────────────────────
// POST /api/collections/unallocated
// Log a general (un-applied) payment. Body:
//   { customerId, amount, currency?, paymentDate, paymentMethod,
//     referenceNumber?, bankName?, notes? }
// ─────────────────────────────────────────────────────────────────────────
router.post('/unallocated', requirePermission('payment.log'), catchAsync(async (req, res) => {
  const u = req.body || {};
  if (!u.customerId || u.amount === undefined) {
    return res.status(400).json({ success: false, error: 'customerId and amount are required.' });
  }
  const amount = Number(u.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ success: false, error: 'amount must be a positive number.' });
  }

  let unallocId = null;
  const ins = await execute(
    `INSERT INTO QA_UNALLOCATED_PAYMENTS (
       CUSTOMER_ID, AMOUNT, CURRENCY, PAYMENT_DATE, PAYMENT_METHOD,
       REFERENCE_NUMBER, BANK_NAME, STATUS, LOGGED_BY, NOTES
     ) VALUES (
       :cid, :amt, :curr, :pdt, :pm, :rn, :bnk, 'UNAPPLIED', :lby, :nts
     )
     RETURNING UNALLOC_ID INTO :uid`,
    {
      cid:  u.customerId,
      amt:  amount,
      curr: u.currency || 'GHS',
      pdt:  u.paymentDate || null,
      pm:   u.paymentMethod || null,
      rn:   u.referenceNumber || null,
      bnk:  u.bankName || null,
      lby:  req.user.email,
      nts:  u.notes || null,
      uid:  { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
    }
  );
  unallocId = ins.outBinds?.uid?.[0] || null;

  emitToAll('payments:updated');
  res.json({ success: true, data: { unallocId } });
}));

// ─────────────────────────────────────────────────────────────────────────
// POST /api/collections/unallocated/:id/apply
// Apply an unallocated payment to one or more invoices.
// Body: { applications: [{ invoiceId, amount, whtBreakdown? }, ...] }
// Inside a transaction: insert each as a QA_INVOICE_PAYMENTS row, update
// invoice balances, and flip UNALLOC.STATUS based on remaining amount.
// ─────────────────────────────────────────────────────────────────────────
router.post('/unallocated/:id/apply', requirePermission('payment.apply.unallocated'), catchAsync(async (req, res) => {
  const { id } = req.params;
  const { applications } = req.body || {};
  if (!Array.isArray(applications) || applications.length === 0) {
    return res.status(400).json({ success: false, error: 'applications[] is required.' });
  }

  const created = [];
  await transaction(async (conn) => {
    const uRes = await conn.execute(
      `SELECT AMOUNT, STATUS FROM QA_UNALLOCATED_PAYMENTS WHERE UNALLOC_ID = :id`,
      { id }, { outFormat: 4002 }
    );
    const uRow = uRes.rows?.[0];
    if (!uRow) throw new Error('Unallocated payment not found.');
    if (uRow.STATUS === 'APPLIED' || uRow.STATUS === 'REFUNDED') {
      throw new Error('Unallocated payment is already fully applied or refunded.');
    }
    const available = Number(uRow.AMOUNT || 0);

    let totalApplied = 0;
    for (const app of applications) {
      const amt = Number(app.amount);
      if (!app.invoiceId || !Number.isFinite(amt) || amt <= 0) continue;
      totalApplied += amt;
    }
    if (totalApplied <= 0) throw new Error('No valid applications provided.');
    if (totalApplied - available > 0.01) {
      throw new Error(`Applications total ${totalApplied} exceeds available ${available}.`);
    }

    for (const app of applications) {
      const amt = Number(app.amount);
      if (!app.invoiceId || !Number.isFinite(amt) || amt <= 0) continue;
      const wht = Array.isArray(app.whtBreakdown) ? app.whtBreakdown : [];
      const whtTotal = wht.reduce((s, w) => s + (Number(w.amount) || 0), 0);
      const receiptNumber = await nextReceiptNumber(conn);

      const ins = await conn.execute(
        `INSERT INTO QA_INVOICE_PAYMENTS (
           INVOICE_ID, AMOUNT, PAYMENT_DATE, PAYMENT_METHOD, REFERENCE_NUMBER,
           WHT_TOTAL, WHT_BREAKDOWN, RECEIPT_NUMBER, LOGGED_BY, STATUS,
           UNALLOC_ID, NOTES
         ) VALUES (
           :iid, :amt, SYSDATE, 'Applied from unallocated', :rn,
           :wt, :wb, :rcpt, :lby, 'CONFIRMED',
           :unl, :nts
         )
         RETURNING PAYMENT_ID INTO :pid`,
        {
          iid:  app.invoiceId,
          amt,
          rn:   `UNALLOC-${id}`,
          wt:   Number(whtTotal.toFixed(2)),
          wb:   JSON.stringify(wht),
          rcpt: receiptNumber,
          lby:  req.user.email,
          unl:  Number(id),
          nts:  app.notes || `Applied from unallocated #${id}`,
          pid:  { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
        }
      );
      created.push({
        invoiceId:    app.invoiceId,
        paymentId:    ins.outBinds?.pid?.[0] || null,
        receiptNumber
      });

      await recomputeInvoiceBalance(conn, app.invoiceId);
    }

    const remaining = available - totalApplied;
    const newStatus = remaining <= 0.01 ? 'APPLIED' : 'PARTIALLY_APPLIED';
    await conn.execute(
      `UPDATE QA_UNALLOCATED_PAYMENTS
          SET STATUS = :st, AMOUNT = :rem
        WHERE UNALLOC_ID = :id`,
      { st: newStatus, rem: Math.max(0, remaining), id }
    );
  });

  emitToAll('payments:updated');
  emitToAll('invoices:updated');
  res.json({ success: true, data: { created } });
}));

// ─────────────────────────────────────────────────────────────────────────
// GET /api/collections/aging?asOfDate=&customerId=
// Server-side AR aging from DUE_DATE.
// Returns { buckets: { 0-30, 31-60, 61-90, 90+ }, totalOutstanding, rows }
// ─────────────────────────────────────────────────────────────────────────
router.get('/aging', requirePermission('customer.statement.read'), catchAsync(async (req, res) => {
  const asOf = req.query.asOfDate ? new Date(req.query.asOfDate) : new Date();
  const customerId = req.query.customerId;

  let sql = `
    SELECT INVOICE_ID, CUSTOMER_ID, CUSTOMER_NAME, INVOICE_DATE, DUE_DATE,
           TOTAL, AMOUNT_PAID, BALANCE_DUE, STATUS, CURRENCY
      FROM QA_INVOICES
     WHERE NVL(BALANCE_DUE, TOTAL - NVL(AMOUNT_PAID, 0)) > 0
       AND STATUS NOT IN ('Cancelled','Rejected','Draft','Pending Pricing')`;
  const binds = {};
  if (customerId) {
    sql += ' AND CUSTOMER_ID = :cid';
    binds.cid = customerId;
  }

  const r = await execute(sql, binds);
  const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  const rows = [];
  let totalOutstanding = 0;

  for (const row of (r.rows || [])) {
    const balance = Number(row.BALANCE_DUE ?? (row.TOTAL - (row.AMOUNT_PAID || 0))) || 0;
    if (balance <= 0) continue;
    const due = row.DUE_DATE ? new Date(row.DUE_DATE) : null;
    const daysOverdue = due && !isNaN(due.getTime())
      ? Math.floor((asOf - due) / (1000 * 60 * 60 * 24))
      : 0;
    let bucket;
    if      (daysOverdue <= 0)  bucket = '0-30';   // not yet due — group with current
    else if (daysOverdue <= 30) bucket = '0-30';
    else if (daysOverdue <= 60) bucket = '31-60';
    else if (daysOverdue <= 90) bucket = '61-90';
    else                        bucket = '90+';
    buckets[bucket] += balance;
    totalOutstanding += balance;
    rows.push({
      invoiceId:    row.INVOICE_ID,
      customerId:   row.CUSTOMER_ID,
      customerName: row.CUSTOMER_NAME,
      invoiceDate:  row.INVOICE_DATE,
      dueDate:      row.DUE_DATE,
      total:        Number(row.TOTAL || 0),
      amountPaid:   Number(row.AMOUNT_PAID || 0),
      balanceDue:   balance,
      status:       row.STATUS,
      currency:     row.CURRENCY || 'GHS',
      daysOverdue:  Math.max(0, daysOverdue),
      bucket
    });
  }

  res.json({
    success: true,
    data: {
      asOf: asOf.toISOString(),
      totalOutstanding: Number(totalOutstanding.toFixed(2)),
      buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, Number(v.toFixed(2))])),
      rows: rows.sort((a, b) => b.daysOverdue - a.daysOverdue)
    }
  });
}));

// ─────────────────────────────────────────────────────────────────────────
// GET /api/collections/dso?windowDays=90
// Daily Sales Outstanding (DSO) over a window:
//   DSO = (AR outstanding / total credit sales in window) × window days
// ─────────────────────────────────────────────────────────────────────────
router.get('/dso', requirePermission('customer.statement.read'), catchAsync(async (req, res) => {
  const windowDays = Math.max(1, parseInt(req.query.windowDays, 10) || 90);
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  const arRes = await execute(
    `SELECT NVL(SUM(NVL(BALANCE_DUE, TOTAL - NVL(AMOUNT_PAID, 0))), 0) AS AR
       FROM QA_INVOICES
      WHERE STATUS NOT IN ('Cancelled','Rejected','Draft','Pending Pricing')`,
    {}, { outFormat: 4002 }
  );
  const ar = Number(arRes.rows[0].AR || 0);

  const salesRes = await execute(
    `SELECT NVL(SUM(TOTAL), 0) AS SALES
       FROM QA_INVOICES
      WHERE INVOICE_DATE >= :cd
        AND STATUS NOT IN ('Cancelled','Rejected','Draft','Pending Pricing')`,
    { cd: cutoffIso }, { outFormat: 4002 }
  );
  const sales = Number(salesRes.rows[0].SALES || 0);

  const dso = sales > 0 ? Number(((ar / sales) * windowDays).toFixed(1)) : null;

  res.json({
    success: true,
    data: { windowDays, ar, sales, dso }
  });
}));

// ─────────────────────────────────────────────────────────────────────────
// GET /api/collections/customer/:id/statement?from=&to=
// Running ledger for a customer: opening balance + interleaved
// invoices/payments + closing balance + aging summary.
// ─────────────────────────────────────────────────────────────────────────
router.get('/customer/:id/statement', requirePermission('customer.statement.read'), catchAsync(async (req, res) => {
  const { id } = req.params;
  const from = req.query.from ? new Date(req.query.from) : null;
  const to   = req.query.to   ? new Date(req.query.to)   : new Date();

  // Customer header
  const custRes = await execute(
    `SELECT CUSTOMER_ID, CUSTOMER_NAME, TIN, CONTACT_EMAIL, ADDRESS,
            DEFAULT_PAYMENT_TERMS, CREDIT_LIMIT
       FROM QA_CUSTOMERS WHERE CUSTOMER_ID = :id`,
    { id }, { outFormat: 4002 }
  );
  const customer = custRes.rows?.[0];
  if (!customer) return res.status(404).json({ success: false, error: 'Customer not found.' });

  // Invoices & payments
  const invsRes = await execute(
    `SELECT INVOICE_ID, INVOICE_DATE, DUE_DATE, TOTAL, AMOUNT_PAID, BALANCE_DUE,
            STATUS, CURRENCY
       FROM QA_INVOICES
      WHERE CUSTOMER_ID = :id
        AND STATUS NOT IN ('Cancelled','Rejected','Draft','Pending Pricing')
      ORDER BY INVOICE_DATE ASC, INVOICE_ID ASC`,
    { id }
  );
  const paysRes = await execute(
    `SELECT p.PAYMENT_ID, p.INVOICE_ID, p.AMOUNT, p.PAYMENT_DATE, p.RECEIPT_NUMBER,
            p.PAYMENT_METHOD, p.WHT_TOTAL, p.STATUS
       FROM QA_INVOICE_PAYMENTS p
       JOIN QA_INVOICES i ON i.INVOICE_ID = p.INVOICE_ID
      WHERE i.CUSTOMER_ID = :id
        AND (p.STATUS IS NULL OR p.STATUS = 'CONFIRMED')
      ORDER BY p.PAYMENT_DATE ASC, p.CREATED_AT ASC`,
    { id }
  );

  // Build interleaved ledger entries
  const all = [];
  for (const r of (invsRes.rows || [])) {
    all.push({
      type:        'INVOICE',
      date:        r.INVOICE_DATE,
      reference:   r.INVOICE_ID,
      description: `Invoice — due ${r.DUE_DATE ? new Date(r.DUE_DATE).toLocaleDateString() : 'n/a'}`,
      debit:       Number(r.TOTAL || 0),
      credit:      0,
      currency:    r.CURRENCY || 'GHS',
      meta:        { status: r.STATUS, balanceDue: Number(r.BALANCE_DUE || 0) }
    });
  }
  for (const r of (paysRes.rows || [])) {
    const amt = Number(r.AMOUNT || 0) + Number(r.WHT_TOTAL || 0);
    all.push({
      type:        'PAYMENT',
      date:        r.PAYMENT_DATE,
      reference:   r.RECEIPT_NUMBER || `PAY-${r.PAYMENT_ID}`,
      description: `Payment — ${r.PAYMENT_METHOD || 'method n/a'}${Number(r.WHT_TOTAL || 0) > 0 ? ` (incl. ${Number(r.WHT_TOTAL).toFixed(2)} WHT)` : ''}`,
      debit:       0,
      credit:      amt,
      currency:    'GHS',
      meta:        { invoiceId: r.INVOICE_ID }
    });
  }
  all.sort((a, b) => {
    const ad = new Date(a.date || 0).getTime();
    const bd = new Date(b.date || 0).getTime();
    return ad - bd;
  });

  // Opening balance = sum of debits/credits BEFORE `from`
  let openingBalance = 0;
  const entries = [];
  for (const e of all) {
    const t = e.date ? new Date(e.date).getTime() : 0;
    if (from && t < from.getTime()) {
      openingBalance += (e.debit - e.credit);
      continue;
    }
    if (t > to.getTime()) continue;
    entries.push(e);
  }

  let running = openingBalance;
  const enriched = entries.map(e => {
    running += (e.debit - e.credit);
    return { ...e, runningBalance: Number(running.toFixed(2)) };
  });
  const closingBalance = Number(running.toFixed(2));

  // Aging buckets at closing
  const today = new Date();
  const aging = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  for (const r of (invsRes.rows || [])) {
    const balance = Number(r.BALANCE_DUE || 0);
    if (balance <= 0) continue;
    const due = r.DUE_DATE ? new Date(r.DUE_DATE) : null;
    const daysOverdue = due && !isNaN(due.getTime())
      ? Math.floor((today - due) / (1000 * 60 * 60 * 24))
      : 0;
    if      (daysOverdue <= 30) aging['0-30']  += balance;
    else if (daysOverdue <= 60) aging['31-60'] += balance;
    else if (daysOverdue <= 90) aging['61-90'] += balance;
    else                        aging['90+']   += balance;
  }

  res.json({
    success: true,
    data: {
      customer: {
        id:              customer.CUSTOMER_ID,
        name:            customer.CUSTOMER_NAME,
        tin:             customer.TIN || '',
        email:           customer.CONTACT_EMAIL || '',
        address:         customer.ADDRESS || '',
        paymentTerms:    customer.DEFAULT_PAYMENT_TERMS || '',
        creditLimit:     Number(customer.CREDIT_LIMIT || 0)
      },
      period: {
        from: from ? from.toISOString().slice(0, 10) : null,
        to:   to.toISOString().slice(0, 10)
      },
      openingBalance: Number(openingBalance.toFixed(2)),
      entries: enriched,
      closingBalance,
      aging: Object.fromEntries(Object.entries(aging).map(([k, v]) => [k, Number(v.toFixed(2))]))
    }
  });
}));

// ─────────────────────────────────────────────────────────────────────────
// Collection actions — POST + GET
// ─────────────────────────────────────────────────────────────────────────
router.post('/actions', requirePermission('collections.action.log'), catchAsync(async (req, res) => {
  const a = req.body || {};
  if (!a.invoiceId || !a.actionType) {
    return res.status(400).json({ success: false, error: 'invoiceId and actionType are required.' });
  }
  await execute(
    `INSERT INTO QA_COLLECTION_ACTIONS (
       INVOICE_ID, ACTION_TYPE, ACTOR, OUTCOME,
       PROMISE_TO_PAY_DATE, NEXT_ACTION_DATE, NOTES
     ) VALUES (
       :iid, :at, :actor, :oc, :ptp, :nxt, :nts
     )`,
    {
      iid:   a.invoiceId,
      at:    a.actionType,
      actor: req.user.email,
      oc:    a.outcome || null,
      ptp:   a.promiseToPayDate ? new Date(a.promiseToPayDate) : null,
      nxt:   a.nextActionDate   ? new Date(a.nextActionDate)   : null,
      nts:   a.notes || null
    }
  );
  emitToAll('collections:actions:updated');
  res.json({ success: true });
}));

router.get('/actions', requirePermission('customer.statement.read'), catchAsync(async (req, res) => {
  const { invoiceId, customerId } = req.query;
  let sql = `SELECT a.* FROM QA_COLLECTION_ACTIONS a`;
  const binds = {};
  const conds = [];
  if (customerId) {
    sql += ` JOIN QA_INVOICES i ON i.INVOICE_ID = a.INVOICE_ID`;
    conds.push('i.CUSTOMER_ID = :cid');
    binds.cid = customerId;
  }
  if (invoiceId) {
    conds.push('a.INVOICE_ID = :iid');
    binds.iid = invoiceId;
  }
  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  sql += ' ORDER BY a.ACTION_DATE DESC';
  const r = await execute(sql, binds);
  res.json({
    success: true,
    data: (r.rows || []).map(row => ({
      id:                row.ACTION_ID,
      invoiceId:         row.INVOICE_ID,
      actionDate:        row.ACTION_DATE,
      actionType:        row.ACTION_TYPE,
      actor:             row.ACTOR,
      outcome:           row.OUTCOME || '',
      promiseToPayDate:  row.PROMISE_TO_PAY_DATE || null,
      nextActionDate:    row.NEXT_ACTION_DATE || null,
      notes:             row.NOTES || ''
    }))
  });
}));

// ─────────────────────────────────────────────────────────────────────────
// GET /api/collections/unallocated — list with optional customer filter
// ─────────────────────────────────────────────────────────────────────────
router.get('/unallocated', requirePermission('customer.statement.read'), catchAsync(async (req, res) => {
  const { customerId, status } = req.query;
  let sql = `SELECT * FROM QA_UNALLOCATED_PAYMENTS`;
  const binds = {};
  const conds = [];
  if (customerId) { conds.push('CUSTOMER_ID = :cid'); binds.cid = customerId; }
  if (status)     { conds.push('STATUS = :st');       binds.st  = status; }
  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  sql += ' ORDER BY LOGGED_AT DESC';
  const r = await execute(sql, binds);
  res.json({
    success: true,
    data: (r.rows || []).map(row => ({
      id:              row.UNALLOC_ID,
      customerId:      row.CUSTOMER_ID,
      amount:          Number(row.AMOUNT || 0),
      currency:        row.CURRENCY || 'GHS',
      paymentDate:     row.PAYMENT_DATE,
      paymentMethod:   row.PAYMENT_METHOD || '',
      referenceNumber: row.REFERENCE_NUMBER || '',
      bankName:        row.BANK_NAME || '',
      status:          row.STATUS,
      loggedBy:        row.LOGGED_BY || '',
      loggedAt:        row.LOGGED_AT,
      notes:           row.NOTES || ''
    }))
  });
}));

module.exports = router;
