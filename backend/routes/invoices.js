'use strict';

const express = require('express');
const crypto = require('crypto');
const { execute, transaction } = require('../db');
const { catchAsync } = require('../middleware/errorHandler');
const { authMiddleware, requireRole } = require('../middleware/authMiddleware');
const { emitToAll } = require('../utils/socketEmitter');

const router = express.Router();
router.use(authMiddleware);

/**
 * Helper: Parse CLOB JSON strings safely
 */
function safeParse(str, defaultVal = null) {
  if (!str) return defaultVal;
  try { return JSON.parse(str); } catch (e) { return defaultVal; }
}

/**
 * GET /api/invoices
 * Supports pagination and filtering
 */
router.get('/', catchAsync(async (req, res) => {
  const { status, customerId, createdBy, startDate, endDate, page = 1, limit = 1000 } = req.query;
  const offset = (page - 1) * limit;

  let sql = 'SELECT * FROM QA_INVOICES WHERE 1=1';
  const binds = {};

  // Support single or multiple statuses (array or comma-separated string)
  if (status) {
    const statuses = Array.isArray(status) ? status : status.split(',').map(s => s.trim());
    if (statuses.length === 1) {
      sql += ' AND STATUS = :st';
      binds.st = statuses[0];
    } else {
      // Build IN clause with named binds :s0, :s1, etc.
      const placeholders = statuses.map((s, i) => {
        binds[`s${i}`] = s;
        return `:s${i}`;
      }).join(', ');
      sql += ` AND STATUS IN (${placeholders})`;
    }
  }
  if (createdBy) {
    sql += ' AND CREATED_BY = :cb';
    binds.cb = createdBy;
  }
  if (customerId) {
    sql += ' AND CUSTOMER_ID = :cid';
    binds.cid = customerId;
  }
  if (startDate) {
    sql += ' AND INVOICE_DATE >= :sd';
    binds.sd = startDate;
  }
  if (endDate) {
    sql += ' AND INVOICE_DATE <= :ed';
    binds.ed = endDate;
  }

  // Add ordering and pagination
  sql += ` ORDER BY INVOICE_DATE DESC OFFSET :off ROWS FETCH NEXT :lim ROWS ONLY`;
  binds.off = parseInt(offset);
  binds.lim = parseInt(limit);

  const result = await execute(sql, binds);

  // For lists, we usually don't need deeply nested line items (improves performance)
  // If the frontend expects them, we'll need a JOIN or a separate call.
  // The Firebase app stored everything in one document. Here we reconstruct it.
  
  const invoiceRows = result.rows || [];
  if (invoiceRows.length === 0) {
    return res.json({ success: true, data: [] });
  }

  // Batch fetch line items and payments in 2 queries instead of N+1
  const invoiceIds = invoiceRows.map(r => r.INVOICE_ID);
  const inClause = invoiceIds.map((_, i) => `:id${i}`).join(',');
  const idBinds = {};
  invoiceIds.forEach((id, i) => { idBinds[`id${i}`] = id; });

  const liAllRes = await execute(
    `SELECT * FROM QA_INVOICE_LINE_ITEMS WHERE INVOICE_ID IN (${inClause}) ORDER BY INVOICE_ID, SORT_ORDER, LINE_ID`,
    idBinds
  );
  const payAllRes = await execute(
    `SELECT * FROM QA_INVOICE_PAYMENTS WHERE INVOICE_ID IN (${inClause}) ORDER BY INVOICE_ID, CREATED_AT`,
    idBinds
  );

  // Group by invoice ID for O(1) lookup
  const linesByInvoice = {};
  const paysByInvoice = {};
  for (const li of (liAllRes.rows || [])) {
    const iid = li.INVOICE_ID;
    if (!linesByInvoice[iid]) linesByInvoice[iid] = [];
    linesByInvoice[iid].push(li);
  }
  for (const pay of (payAllRes.rows || [])) {
    const iid = pay.INVOICE_ID;
    if (!paysByInvoice[iid]) paysByInvoice[iid] = [];
    paysByInvoice[iid].push(pay);
  }

  const invoices = invoiceRows.map(row => {
    const invId = row.INVOICE_ID;
    return {
      id: invId,
      invoiceNumber: invId,
      approvedInvoiceId: row.APPROVED_INVOICE_ID,
      salesPersonId: row.SALESPERSON_ID,
      createdBy: row.CREATED_BY,
      customerId: row.CUSTOMER_ID,
      customerName: row.CUSTOMER_NAME,
      date: row.INVOICE_DATE,
      currency: row.CURRENCY,
      exchangeRate: row.EXCHANGE_RATE,
      subtotal: row.SUBTOTAL,
      total: row.TOTAL,
      taxes: row.TAXES,
      taxBreakdown: safeParse(row.TAX_BREAKDOWN, []),
      status: row.STATUS,
      amountPaid: row.AMOUNT_PAID,
      balanceDue: row.BALANCE_DUE,
      rejectionReason: row.REJECTION_REASON,
      signatureData: row.SIGNATURE_DATA,
      sourcingStatus: row.SOURCING_STATUS || 'NONE',
      prCount: Number(row.PR_COUNT || 0),

      // Phase 4 — re-approval surface
      originalEstimate: row.ORIGINAL_ESTIMATE != null ? Number(row.ORIGINAL_ESTIMATE) : null,
      requiresReapproval: row.REQUIRES_REAPPROVAL === 1 || row.REQUIRES_REAPPROVAL === true,
      reapprovalVariance: row.REAPPROVAL_VARIANCE != null ? Number(row.REAPPROVAL_VARIANCE) : null,
      reapprovalReason: row.REAPPROVAL_REASON || null,
      reapprovedBy: row.REAPPROVED_BY || null,
      reapprovedAt: row.REAPPROVED_AT || null,

      timestamps: {
        submitted: row.SUBMITTED_AT,
        approved: row.APPROVED_AT,
        rejected: row.REJECTED_AT,
        customerAction: row.CUSTOMER_ACTION_AT,
        created: row.CREATED_AT,
        updated: row.UPDATED_AT
      },

      createdAt: row.CREATED_AT,
      invoiceDate: row.INVOICE_DATE,

      lineItems: (linesByInvoice[invId] || []).map(li => ({
        id: li.SKU || li.LINE_ID.toString(),
        // Canonical backend field names.
        description: li.ITEM_NAME,
        quantity: li.QUANTITY,
        unitPrice: li.UNIT_PRICE,
        totalPrice: li.LINE_TOTAL,
        // Editor-shape aliases so front-end code that was written against the
        // in-memory QuotingModule / InvoiceEditor shape (`name`, `price`,
        // `finalPrice`) keeps rendering correctly after a GET. Without these
        // aliases the Sales review, controller review, PDF, and email-to-
        // customer flows all rendered 0s because they read `.name`/`.price`.
        name: li.ITEM_NAME,
        price: li.UNIT_PRICE,
        finalPrice: li.UNIT_PRICE,
        type: li.ITEM_TYPE || 'inventory',
        isBackorder: li.IS_BACKORDER === 1 || li.IS_BACKORDER === true
      })),

      payments: (paysByInvoice[invId] || []).map(pay => ({
        id: pay.PAYMENT_ID.toString(),
        amount: pay.AMOUNT,
        date: pay.PAYMENT_DATE,
        method: pay.PAYMENT_METHOD,
        reference: pay.REFERENCE_NUMBER
      }))
    };
  });

  res.json({ success: true, data: invoices });
}));

/**
 * GET /api/invoices/:id
 */
router.get('/:id', catchAsync(async (req, res) => {
  const { id } = req.params;
  
  const result = await execute('SELECT * FROM QA_INVOICES WHERE INVOICE_ID = :id', { id });
  if (!result.rows || result.rows.length === 0) {
    return res.status(404).json({ success: false, error: 'Invoice not found' });
  }

  const row = result.rows[0];

  const liRes = await execute(
    'SELECT * FROM QA_INVOICE_LINE_ITEMS WHERE INVOICE_ID = :id ORDER BY SORT_ORDER, LINE_ID',
    { id }
  );
  
  const payRes = await execute(
    'SELECT * FROM QA_INVOICE_PAYMENTS WHERE INVOICE_ID = :id ORDER BY CREATED_AT',
    { id }
  );

  const invoice = {
    id: row.INVOICE_ID,
    invoiceNumber: row.INVOICE_ID,
    approvedInvoiceId: row.APPROVED_INVOICE_ID,
    salesPersonId: row.SALESPERSON_ID,
    createdBy: row.CREATED_BY,
    customerId: row.CUSTOMER_ID,
    customerName: row.CUSTOMER_NAME,
    date: row.INVOICE_DATE,
    currency: row.CURRENCY,
    exchangeRate: row.EXCHANGE_RATE,
    subtotal: row.SUBTOTAL,
    total: row.TOTAL,
    taxes: row.TAXES,
    taxBreakdown: safeParse(row.TAX_BREAKDOWN, []),
    status: row.STATUS,
    amountPaid: row.AMOUNT_PAID,
    balanceDue: row.BALANCE_DUE,
    rejectionReason: row.REJECTION_REASON,
    signatureData: row.SIGNATURE_DATA,
    convertedFromQuote: row.CONVERTED_FROM_QUOTE,
    sourcingStatus: row.SOURCING_STATUS || 'NONE',
    prCount: Number(row.PR_COUNT || 0),

    // Phase 4 — re-approval surface
    originalEstimate: row.ORIGINAL_ESTIMATE != null ? Number(row.ORIGINAL_ESTIMATE) : null,
    requiresReapproval: row.REQUIRES_REAPPROVAL === 1 || row.REQUIRES_REAPPROVAL === true,
    reapprovalVariance: row.REAPPROVAL_VARIANCE != null ? Number(row.REAPPROVAL_VARIANCE) : null,
    reapprovalReason: row.REAPPROVAL_REASON || null,
    reapprovedBy: row.REAPPROVED_BY || null,
    reapprovedAt: row.REAPPROVED_AT || null,

    timestamps: {
      submitted: row.SUBMITTED_AT,
      approved: row.APPROVED_AT,
      rejected: row.REJECTED_AT,
      customerAction: row.CUSTOMER_ACTION_AT,
      created: row.CREATED_AT,
      updated: row.UPDATED_AT
    },

    // Top-level date fields for frontend compatibility
    createdAt: row.CREATED_AT,
    invoiceDate: row.INVOICE_DATE,
    approvedBy: row.APPROVED_BY,

    lineItems: (liRes.rows || []).map(li => ({
      id: li.SKU || li.LINE_ID.toString(),
      // Canonical backend field names.
      description: li.ITEM_NAME,
      quantity: li.QUANTITY,
      unitPrice: li.UNIT_PRICE,
      totalPrice: li.LINE_TOTAL,
      // Editor-shape aliases — mirrors the list endpoint so SalesInvoiceReview,
      // InvoiceEditor, PDFService, and customer-review all see populated rows
      // regardless of which naming convention they were written against.
      name: li.ITEM_NAME,
      price: li.UNIT_PRICE,
      finalPrice: li.UNIT_PRICE,
      type: li.ITEM_TYPE || 'inventory',
      isBackorder: li.IS_BACKORDER === 1 || li.IS_BACKORDER === true
    })),

    payments: (payRes.rows || []).map(pay => ({
      id: pay.PAYMENT_ID.toString(),
      amount: pay.AMOUNT,
      date: pay.PAYMENT_DATE,
      method: pay.PAYMENT_METHOD,
      reference: pay.REFERENCE_NUMBER
    }))
  };

  res.json({ success: true, data: invoice });
}));

/**
 * POST /api/invoices
 * Deep insert of invoice + line items
 */
router.post('/', catchAsync(async (req, res) => {
  const inv = req.body;
  if (!inv.id) inv.id = crypto.randomUUID(); // Fallback if front-end didn't generate one

  // Determine which line items need procurement sourcing.
  // A sourced line is: explicitly flagged type==='sourced', OR has a zero unit price,
  // OR the requested qty exceeds current stock (backorder).
  // We look up real inventory stock from the DB to avoid relying solely on client data.
  const inventoryStockMap = {};
  const skusToCheck = (inv.lineItems || [])
    .filter(item => item && item.id && item.type !== 'sourced')
    .map(item => item.id);

  if (skusToCheck.length > 0) {
    // Batch-fetch current stock levels from inventory
    for (const sku of skusToCheck) {
      try {
        const stockRes = await execute(
          'SELECT STOCK FROM QA_INVENTORY WHERE SKU = :id',
          { id: sku }
        );
        if (stockRes.rows && stockRes.rows.length > 0) {
          inventoryStockMap[sku] = Number(stockRes.rows[0].STOCK || 0);
        }
      } catch (e) {
        // Item not in inventory — treat as needing procurement
        inventoryStockMap[sku] = 0;
      }
    }
  }

  // Capture each sourced line's ORIGINAL index in lineItems so the PR can store
  // it as LINE_SORT_ORDER. This makes RFQ award pushback line-precise — see C2
  // in the audit (rfqs.js cost pushback was matching SKU only, which double-wrote
  // when two PRs targeted the same SKU on the same invoice).
  const sourcedLines = (inv.lineItems || [])
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => {
      if (!item) return false;
      if (item.type === 'sourced') return true;
      const price = Number(item.unitPrice ?? item.price ?? 0);
      if (!price || price === 0) return true;
      const qty = Number(item.quantity || 0);
      // Use DB stock if available, then client-sent stock, then Infinity
      const stock = inventoryStockMap[item.id] ?? Number(item.stock ?? Infinity);
      if (qty > 0 && qty > stock) return true;
      return false;
    })
    .map(({ item, idx }) => {
      // Enrich sourced lines with actual stock data for PR reason determination
      item._actualStock = inventoryStockMap[item.id] ?? Number(item.stock ?? 0);
      item._sortOrder = idx;
      return item;
    });

  const needsProcurement = !!inv.requiresProcurement || sourcedLines.length > 0;
  const sourcingStatus = needsProcurement ? 'PENDING' : 'NONE';

  // Pre-compute PR identifiers for line items so we can insert atomically.
  console.log(`[INVOICE POST] needsProcurement=${needsProcurement}, sourcedLines=${sourcedLines.length}, requiresProcurement=${inv.requiresProcurement}`);
  if (sourcedLines.length > 0) {
    console.log('[INVOICE POST] Sourced lines:', sourcedLines.map(i => ({ id: i.id, type: i.type, unitPrice: i.unitPrice, stock: i.stock, qty: i.quantity })));
  }

  let prDrafts = [];
  if (needsProcurement && sourcedLines.length > 0) {
    try {
      prDrafts = await Promise.all(
        sourcedLines.map(async (item) => {
          const seqRes = await execute('SELECT QA_PR_SEQ.NEXTVAL AS N FROM DUAL');
          if (!seqRes.rows || !seqRes.rows[0]) {
            console.error('[INVOICE POST] QA_PR_SEQ query returned no rows');
            throw new Error('Failed to generate PR sequence number');
          }
          const seqNum = seqRes.rows[0].N;
          return {
            id: `PR-${crypto.randomUUID()}`,
            prNumber: `PR-${new Date().getFullYear()}-${String(seqNum).padStart(4, '0')}`,
            item
          };
        })
      );
      console.log(`[INVOICE POST] Created ${prDrafts.length} PR drafts`);
    } catch (seqErr) {
      console.error('[INVOICE POST] Failed to create PR drafts:', seqErr.message);
      throw seqErr; // Re-throw so the whole request fails visibly
    }
  }

  await transaction(async (conn) => {
    // 1. Insert Parent
    // Phase 4 — snapshot the original estimate for invoices that require procurement,
    // so we can detect material variance after cost pushback from the awarded RFQ.
    const originalEstimate = needsProcurement ? Number(inv.total || 0) : null;

    await conn.execute(`
      INSERT INTO QA_INVOICES (
        INVOICE_ID, APPROVED_INVOICE_ID, SALESPERSON_ID, CREATED_BY,
        CUSTOMER_ID, CUSTOMER_NAME, INVOICE_DATE, CURRENCY, EXCHANGE_RATE,
        SUBTOTAL, TOTAL, TAXES, TAX_BREAKDOWN, STATUS, AMOUNT_PAID, BALANCE_DUE,
        CONVERTED_FROM_QUOTE, SOURCING_STATUS, PR_COUNT, ORIGINAL_ESTIMATE
      ) VALUES (
        :id, :aid, :spid, :cb, :cid, :cn, :idate, :curr, :exr,
        :sub, :tot, :tax, :tb, :st, :p, :b, :cqt, :ss, :pc, :oe
      )
    `, {
      id: inv.id,
      aid: inv.approvedInvoiceId || null,
      spid: inv.salesPersonId || req.user.email,
      cb: inv.createdBy || req.user.email,
      cid: inv.customerId || null,
      cn: inv.customerName || null,
      idate: inv.date || null,
      curr: inv.currency || 'GHS',
      exr: inv.exchangeRate || 1,
      sub: inv.subtotal || 0,
      tot: inv.total || 0,
      tax: inv.taxes || 0,
      tb: JSON.stringify(inv.taxBreakdown || []),
      st: inv.status || 'Pending Pricing',
      p: inv.amountPaid || 0,
      b: inv.balanceDue || (inv.total || 0),
      cqt: inv.convertedFromQuote || null,
      ss: sourcingStatus,
      pc: prDrafts.length,
      oe: originalEstimate
    });

    // 2. Insert Line Items
    if (inv.lineItems && inv.lineItems.length > 0) {
      for (let i = 0; i < inv.lineItems.length; i++) {
        const item = inv.lineItems[i];
        await conn.execute(`
          INSERT INTO QA_INVOICE_LINE_ITEMS (
            INVOICE_ID, SKU, ITEM_NAME, QUANTITY, UNIT_PRICE, LINE_TOTAL, SORT_ORDER
          ) VALUES (
            :iid, :sku, :inm, :qty, :up, :lt, :srt
          )
        `, {
          iid: inv.id,
          sku: item.id || null, // Assuming front-end sends SKU as 'id'
          inm: item.description || '',
          qty: item.quantity || 1,
          up:  item.unitPrice || 0,
          lt:  item.totalPrice || 0,
          srt: i
        });
      }
    }

    // 3. Insert Payments (if any exists on creation)
    if (inv.payments && inv.payments.length > 0) {
      for (const pay of inv.payments) {
        await conn.execute(`
          INSERT INTO QA_INVOICE_PAYMENTS (INVOICE_ID, AMOUNT, PAYMENT_DATE, PAYMENT_METHOD, REFERENCE_NUMBER)
          VALUES (:iid, :amt, :pdt, :pm, :rn)
        `, {
          iid: inv.id,
          amt: pay.amount,
          pdt: pay.date,
          pm: pay.method,
          rn: pay.reference || null
        });
      }
    }

    // 4. Auto-create Purchase Requisitions for sourced line items
    console.log(`[INVOICE POST] Inserting ${prDrafts.length} PRs into QA_PURCHASE_REQUISITIONS`);
    for (const draft of prDrafts) {
      const item = draft.item;
      const actualStock = Number(item._actualStock ?? item.stock ?? 0);
      const qty = Number(item.quantity || 0);
      let reason;
      if (item.type === 'sourced') {
        reason = 'CUSTOM_SOURCED';
      } else if (actualStock === 0) {
        reason = 'OUT_OF_STOCK';
      } else if (qty > actualStock) {
        reason = 'INSUFFICIENT';
      } else {
        reason = 'NOT_IN_INVENTORY';
      }
      // For backorders, only request the deficit quantity
      const prQuantity = (reason === 'INSUFFICIENT' && actualStock > 0)
        ? qty - actualStock
        : qty;

      await conn.execute(`
        INSERT INTO QA_PURCHASE_REQUISITIONS (
          PR_ID, PR_NUMBER, INVOICE_ID, QUOTE_LINE_MATCH_KEY, LINE_SORT_ORDER,
          ITEM_NAME, ITEM_DESCRIPTION,
          QUANTITY, UOM, REASON, STATUS, PRIORITY, REQUESTED_BY, CUSTOMER_NAME
        ) VALUES (
          :id, :pn, :iid, :mk, :lso, :inm, :idesc,
          :qty, 'EA', :reas, 'OPEN', 'normal', :rb, :cn
        )
      `, {
        id: draft.id,
        pn: draft.prNumber,
        iid: inv.id,
        mk: item.id || null,
        lso: (typeof item._sortOrder === 'number') ? item._sortOrder : null,
        inm: item.description || item.name || 'Sourced item',
        idesc: item.description || null,
        qty: prQuantity || 1,
        reas: reason,
        rb: req.user.email,
        cn: inv.customerName || null
      });

      await conn.execute(`
        INSERT INTO QA_PROCUREMENT_EVENTS (EVENT_TYPE, ENTITY_TYPE, ENTITY_ID, ACTOR, PAYLOAD)
        VALUES ('PR_CREATED','PR',:id,:actor,:payload)
      `, {
        id: draft.id,
        actor: req.user.email,
        payload: JSON.stringify({
          source: 'invoice_submission',
          invoiceId: inv.id,
          prNumber: draft.prNumber,
          reason
        })
      });
    }
  });

  emitToAll('invoices:updated');
  if (prDrafts.length > 0) {
    emitToAll('pr:updated');
  }
  res.json({
    success: true,
    id: inv.id,
    sourcingStatus,
    prCount: prDrafts.length,
    purchaseRequisitions: prDrafts.map(d => ({ id: d.id, prNumber: d.prNumber }))
  });
}));

/**
 * PUT /api/invoices/:id
 * Partial update for status changes, signatures, and payments
 */
router.put('/:id', catchAsync(async (req, res) => {
  const { id } = req.params;
  const updates = req.body; // Cannot deep-update lineitems with this route.

  const sqlSets = [];
  const binds = { id };

  const mappings = {
    status: 'STATUS',
    approvedInvoiceId: 'APPROVED_INVOICE_ID',
    rejectionReason: 'REJECTION_REASON',
    signatureData: 'SIGNATURE_DATA',
    amountPaid: 'AMOUNT_PAID',
    balanceDue: 'BALANCE_DUE'
  };

  for (const [key, dbCol] of Object.entries(mappings)) {
    if (updates[key] !== undefined) {
      sqlSets.push(`${dbCol} = :${key}`);
      binds[key] = updates[key];
    }
  }

  // Handle timestamp updates explicitly based on status transitions
  if (updates.status === 'Approved') {
    sqlSets.push('APPROVED_AT = SYSTIMESTAMP');
    sqlSets.push('APPROVED_BY = :approverId');
    binds.approverId = req.user.email;
  } else if (updates.status === 'Rejected') {
    sqlSets.push('REJECTED_AT = SYSTIMESTAMP');
    sqlSets.push('REJECTED_BY = :approverId');
    binds.approverId = req.user.email;
  } else if (updates.status === 'Pending Approval' || updates.status === 'Awaiting Acceptance') {
    sqlSets.push('SUBMITTED_AT = SYSTIMESTAMP');
  } else if (['Signed', 'Paid', 'Partially Paid', 'Customer Accepted', 'Customer Rejected'].includes(updates.status)) {
    sqlSets.push('CUSTOMER_ACTION_AT = SYSTIMESTAMP');
  }

  if (sqlSets.length > 0) {
    sqlSets.push('UPDATED_AT = SYSTIMESTAMP');
    const sql = `UPDATE QA_INVOICES SET ${sqlSets.join(', ')} WHERE INVOICE_ID = :id`;
    await execute(sql, binds);
  }

  // If there's a new payment, insert it
  if (updates.newPayment) {
    const pay = updates.newPayment;
    await execute(`
      INSERT INTO QA_INVOICE_PAYMENTS (INVOICE_ID, AMOUNT, PAYMENT_DATE, PAYMENT_METHOD, REFERENCE_NUMBER)
      VALUES (:id, :amt, :pdt, :pm, :rn)
    `, {
      id,
      amt: pay.amount,
      pdt: pay.date,
      pm: pay.method,
      rn: pay.reference || null
    });
  }

  emitToAll('invoices:updated');
  res.json({ success: true });
}));

/**
 * DELETE /api/invoices/:id
 * Controller/admin only — prevents sales users deleting invoices
 */
router.delete('/:id', requireRole('controller', 'admin'), catchAsync(async (req, res) => {
  const { id } = req.params;
  // Cascades to LINE_ITEMS and PAYMENTS via FK ON DELETE CASCADE
  await execute('DELETE FROM QA_INVOICES WHERE INVOICE_ID = :id', { id });
  
  emitToAll('invoices:updated');
  res.json({ success: true });
}));

/**
 * POST /api/invoices/:id/reapprove
 * Phase 4 — Clear the REQUIRES_REAPPROVAL flag after a user re-confirms the
 * sourced quote (body: { decision: 'accept'|'reject', note?: string }).
 *
 *  - accept: clears the flag, records the approver, stamps REAPPROVED_AT.
 *  - reject: clears the flag but flips status back to 'Pending Pricing' so the
 *    sales user can revise line items or re-trigger sourcing.
 *
 * Allowed for controller, admin, or the invoice's originating salesperson
 * (they may choose to cancel the customer quote outright rather than send the
 * new cost-loaded total).
 */
router.post('/:id/reapprove', catchAsync(async (req, res) => {
  const { id } = req.params;
  const { decision = 'accept', note } = req.body || {};

  if (!['accept', 'reject'].includes(decision)) {
    return res.status(400).json({ success: false, error: 'decision must be "accept" or "reject"' });
  }

  const invRes = await execute(
    `SELECT SALESPERSON_ID, REQUIRES_REAPPROVAL, STATUS FROM QA_INVOICES WHERE INVOICE_ID = :id`,
    { id }
  );
  if (!invRes.rows?.[0]) {
    return res.status(404).json({ success: false, error: 'Invoice not found' });
  }
  const row = invRes.rows[0];
  if (row.REQUIRES_REAPPROVAL !== 1) {
    return res.status(400).json({ success: false, error: 'Invoice does not require re-approval' });
  }

  const role = req.user.role;
  const isOwner = row.SALESPERSON_ID === req.user.email;
  const isElevated = role === 'controller' || role === 'admin' || role === 'sales_main';
  if (!isOwner && !isElevated) {
    return res.status(403).json({ success: false, error: 'Not authorised to re-approve this invoice' });
  }

  await transaction(async (conn) => {
    if (decision === 'accept') {
      await conn.execute(
        `UPDATE QA_INVOICES
            SET REQUIRES_REAPPROVAL = 0,
                REAPPROVED_BY       = :actor,
                REAPPROVED_AT       = SYSTIMESTAMP,
                UPDATED_AT          = SYSTIMESTAMP
          WHERE INVOICE_ID = :id`,
        { actor: req.user.email, id }
      );
    } else {
      // reject → bounce back to Pending Pricing so sales can revise
      await conn.execute(
        `UPDATE QA_INVOICES
            SET REQUIRES_REAPPROVAL = 0,
                STATUS              = 'Pending Pricing',
                REAPPROVED_BY       = :actor,
                REAPPROVED_AT       = SYSTIMESTAMP,
                UPDATED_AT          = SYSTIMESTAMP
          WHERE INVOICE_ID = :id`,
        { actor: req.user.email, id }
      );
    }

    await conn.execute(
      `INSERT INTO QA_PROCUREMENT_EVENTS (EVENT_TYPE, ENTITY_TYPE, ENTITY_ID, ACTOR, PAYLOAD)
       VALUES ('INVOICE_REAPPROVAL_DECISION','INVOICE',:id,:actor,:payload)`,
      { id, actor: req.user.email, payload: JSON.stringify({ decision, note: note || null }) }
    );
  });

  emitToAll('invoices:updated');
  res.json({ success: true, decision });
}));

module.exports = router;
