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
const { can } = require('../../shared/permissions');
const { emitToAll } = require('../utils/socketEmitter');
const { notify } = require('../services/notificationService');

/** Compact money string for notification bodies. */
function money(currency, amount) {
  return `${currency || 'GHS'} ${Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

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
 * Helper: parse a payment-terms string into a day count.
 *
 *   'Net 0' / 'Due on receipt'  → 0
 *   'Net 7'  / '7'              → 7
 *   'Net 30' / '30' / '30 days' → 30
 *   anything else               → 30  (safe default, matches schema default)
 *
 * Centralised here so the same logic applies whether the frontend sends a
 * 'Net 30' string or a bare number. Used by the POST handler below to
 * compute DUE_DATE from INVOICE_DATE + the snapshotted payment terms.
 */
function paymentTermsToDays(term) {
  if (term === undefined || term === null || term === '') return 30;
  const s = String(term).trim().toLowerCase();
  if (s === 'due on receipt' || s === 'net 0' || s === '0') return 0;
  const m = s.match(/(\d+)/);
  if (m) {
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) && n >= 0 ? n : 30;
  }
  return 30;
}

/**
 * Helper: compute DUE_DATE from an INVOICE_DATE string + days offset.
 * Returns a JS Date the oracledb driver binds into the DATE column.
 * Falls back to today + offset if invoiceDate is missing/invalid.
 */
function computeDueDate(invoiceDateStr, daysOffset) {
  const base = invoiceDateStr ? new Date(invoiceDateStr) : new Date();
  const safe = isNaN(base.getTime()) ? new Date() : base;
  const d = new Date(safe);
  d.setDate(d.getDate() + (Number(daysOffset) || 0));
  return d;
}

/**
 * GET /api/invoices
 * Supports pagination and filtering
 */
router.get('/', catchAsync(async (req, res) => {
  const { status, customerId, createdBy, startDate, endDate } = req.query;
  // OWASP API4:2023 — Unrestricted Resource Consumption. Hard-cap the
  // limit at 1000 so ?limit=999999 can't sweep the whole invoice table.
  // Default 1000 preserves prior behavior; max 1000 prevents abuse.
  const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 1000), 1000);
  const offset = (page - 1) * limit;

  // SOFT-DELETE FILTER — exclude rows marked IS_DELETED='Y'. NULL-safe
  // for any historical rows that pre-date the Module-SP1 migration.
  // The functional index IDX_INV_IS_DELETED makes this filter free.
  let sql = "SELECT * FROM QA_INVOICES WHERE (IS_DELETED IS NULL OR IS_DELETED = 'N')";
  const binds = {};

  // SCOPE FILTER — a user without `invoice.read.all` (e.g. a sales_officer
  // who only has `invoice.read.own`) must NEVER receive invoices they
  // didn't create. The catalogue says officers are scoped to "own"; this
  // line enforces it at the SQL boundary so a crafted GET can't widen the
  // result. Server-side filter takes precedence over any client createdBy
  // param to prevent scope-widening via query string.
  if (!can(req.user.role, 'invoice.read.all')) {
    sql += ' AND LOWER(CREATED_BY) = LOWER(:me)';
    binds.me = req.user.email;
  }

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
      // Module 1 — DUE_DATE + PAYMENT_TERMS snapshot
      dueDate: row.DUE_DATE || null,
      paymentTerms: row.PAYMENT_TERMS || null,
      currency: row.CURRENCY,
      exchangeRate: row.EXCHANGE_RATE,
      subtotal: row.SUBTOTAL,
      total: row.TOTAL,
      taxes: row.TAXES,
      taxBreakdown: safeParse(row.TAX_BREAKDOWN, []),
      status: row.STATUS,
      rowVersion: Number(row.ROW_VERSION || 1),  // optimistic-concurrency token (mirror /:id detail)
      amountPaid: row.AMOUNT_PAID,
      balanceDue: row.BALANCE_DUE,
      rejectionReason: row.REJECTION_REASON,
      // Module 4 — controlled vocabulary alongside the legacy free-text reason
      rejectionReasonCode: row.REJECTION_REASON_CODE || null,
      lostToCompetitor:    row.LOST_TO_COMPETITOR || null,
      winReasonCode:       row.WIN_REASON_CODE || null,
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

  // Soft-delete filter: treat IS_DELETED='Y' as 404. Admin can restore
  // via POST /:id/restore which flips the flag back.
  const result = await execute(
    `SELECT * FROM QA_INVOICES
     WHERE INVOICE_ID = :id AND (IS_DELETED IS NULL OR IS_DELETED = 'N')`,
    { id }
  );
  if (!result.rows || result.rows.length === 0) {
    return res.status(404).json({ success: false, error: 'Invoice not found' });
  }

  const row = result.rows[0];

  // OWNERSHIP CHECK — a user without `invoice.read.all` can only fetch
  // invoices they created or are assigned as the salesperson on. Without
  // this, any authenticated user could enumerate every invoice by id.
  // Customers calling from the portal use a separate code path
  // (portal.read.own) and are not allowed here at all.
  if (!can(req.user.role, 'invoice.read.all')) {
    const me = String(req.user.email || '').toLowerCase();
    const createdBy   = String(row.CREATED_BY || '').toLowerCase();
    const salesperson = String(row.SALESPERSON_ID || '').toLowerCase();
    if (me !== createdBy && me !== salesperson) {
      // Return 404 (not 403) so attackers can't probe for the existence
      // of invoices outside their scope.
      return res.status(404).json({ success: false, error: 'Invoice not found' });
    }
  }

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
    // Module 1 — DUE_DATE + PAYMENT_TERMS snapshot
    dueDate: row.DUE_DATE || null,
    paymentTerms: row.PAYMENT_TERMS || null,
    currency: row.CURRENCY,
    exchangeRate: row.EXCHANGE_RATE,
    subtotal: row.SUBTOTAL,
    total: row.TOTAL,
    taxes: row.TAXES,
    taxBreakdown: safeParse(row.TAX_BREAKDOWN, []),
    status: row.STATUS,
    // Optimistic-concurrency token. Clients MUST echo this back on PUT to
    // claim "I'm editing the version I saw"; a mismatch returns 409 so the
    // loser knows to reload and merge.
    rowVersion: Number(row.ROW_VERSION || 1),
    amountPaid: row.AMOUNT_PAID,
    balanceDue: row.BALANCE_DUE,
    rejectionReason: row.REJECTION_REASON,
    // Module 4 — controlled vocabulary alongside the legacy free-text reason
    rejectionReasonCode: row.REJECTION_REASON_CODE || null,
    lostToCompetitor:    row.LOST_TO_COMPETITOR || null,
    winReasonCode:       row.WIN_REASON_CODE || null,
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
router.post('/', requirePermission('quote.create'), catchAsync(async (req, res) => {
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

  // Module 1 — resolve PAYMENT_TERMS + DUE_DATE before the transaction.
  //   1. If the frontend explicitly sent `paymentTerms`, snapshot that.
  //   2. Else look up the customer's DEFAULT_PAYMENT_TERMS so the invoice
  //      inherits the right Net-N cadence at creation time (snapshot —
  //      retroactive customer-default changes don't rewrite history).
  //   3. If the frontend explicitly sent `dueDate`, honour it; otherwise
  //      compute from invoice date + parsed terms.
  let paymentTermsSnapshot = inv.paymentTerms || null;
  if (!paymentTermsSnapshot && inv.customerId) {
    try {
      const custRes = await execute(
        `SELECT DEFAULT_PAYMENT_TERMS FROM QA_CUSTOMERS WHERE CUSTOMER_ID = :id`,
        { id: inv.customerId }, { outFormat: 4002 }
      );
      paymentTermsSnapshot = custRes.rows?.[0]?.DEFAULT_PAYMENT_TERMS || 'Net 30';
    } catch (_e) {
      paymentTermsSnapshot = 'Net 30';
    }
  }
  if (!paymentTermsSnapshot) paymentTermsSnapshot = 'Net 30';

  const dueDate = inv.dueDate
    ? new Date(inv.dueDate)
    : computeDueDate(inv.date, paymentTermsToDays(paymentTermsSnapshot));

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
        CONVERTED_FROM_QUOTE, SOURCING_STATUS, PR_COUNT, ORIGINAL_ESTIMATE,
        DUE_DATE, PAYMENT_TERMS
      ) VALUES (
        :id, :aid, :spid, :cb, :cid, :cn, :idate, :curr, :exr,
        :sub, :tot, :tax, :tb, :st, :p, :b, :cqt, :ss, :pc, :oe,
        :ddt, :ptm
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
      oe: originalEstimate,
      // Module 1 — computed above
      ddt: dueDate,
      ptm: paymentTermsSnapshot
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

    // New sourcing work just landed for procurement — tell the desk.
    notify({
      to: { departments: ['procurement'], excludeActor: true },
      actor: req.user.email,
      type: 'pr.created', category: 'procurement', severity: 'info',
      title: `${prDrafts.length} new purchase requisition${prDrafts.length > 1 ? 's' : ''}`,
      body: `Invoice ${inv.id} for ${inv.customerName || 'a customer'} created ${prDrafts.length} PR${prDrafts.length > 1 ? 's' : ''} that need sourcing.`,
      entityType: 'invoice', entityId: inv.id,
      linkPage: 'purchaseRequisitions', linkContext: {},
      groupKey: `invoice:${inv.id}:prs_created`
    });
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

  // ── Authorization & SoD enforcement ──────────────────────────────────
  // Status transitions are the load-bearing actions on this route — they
  // determine who approves what. Plain field edits (signature, payment,
  // balance) skip these gates because they're scoped by the page-level
  // permission. For status changes we load the current invoice once and
  // run both the permission check AND the matching SoD invariant.
  // Captured inside the status-change block, consumed AFTER the UPDATE
  // commits to fan out notifications (see the dispatch block below).
  let notifyCtx = null;

  if (updates.status !== undefined) {
    const cur = await execute(
      `SELECT STATUS, CREATED_BY, SALESPERSON_ID, APPROVED_BY, REJECTED_BY,
              CUSTOMER_ACTION_AT, SUBMITTED_AT, SOURCING_STATUS,
              CUSTOMER_NAME, TOTAL, CURRENCY
         FROM QA_INVOICES WHERE INVOICE_ID = :id`,
      { id }
    );
    const row = cur.rows?.[0];
    if (!row) return res.status(404).json({ success: false, error: 'Invoice not found' });

    const prevStatus = row.STATUS;
    const newStatus  = updates.status;
    const entity     = {
      createdBy:      row.CREATED_BY,
      salesPersonId:  row.SALESPERSON_ID,
      sentBy:         row.APPROVED_BY    // who sent it to the customer = last approver
    };

    notifyCtx = {
      prevStatus,
      newStatus,
      createdBy:     row.CREATED_BY,
      salesPersonId: row.SALESPERSON_ID,
      customerName:  row.CUSTOMER_NAME || 'the customer',
      total:        row.TOTAL,
      currency:     row.CURRENCY
    };

    // Sales-side approval: invoice is moving from Pending Approval → Approved.
    if (newStatus === 'Approved' && prevStatus === 'Pending Approval') {
      // ── Sourcing gate ────────────────────────────────────────────────
      // A quote whose procurement isn't finished still carries placeholder
      // prices on its sourced lines — the real cost only lands when the RFQ
      // is AWARDED and pushed back (which flips SOURCING_STATUS to COMPLETE).
      // Approving before that would sign off a total that isn't real, so we
      // block it server-side regardless of what the UI allowed. Rejection
      // stays available. 409 = the resource's state forbids this action.
      const ss = row.SOURCING_STATUS;
      if (ss === 'PENDING' || ss === 'PARTIAL') {
        return res.status(409).json({
          success: false,
          error: 'This quote is still being sourced by procurement. It can be approved only after sourcing completes and the RFQ has been awarded.'
        });
      }
      const canSales   = can(req.user.role, 'invoice.approve.sales');
      const canFinance = can(req.user.role, 'invoice.approve.finance');
      if (!canSales && !canFinance) {
        return res.status(403).json({ success: false, error: "You don't have permission to approve this invoice." });
      }
      // Run the SoD rule that MATCHES the approver's actual permission.
      // Previously this always called the sales rule, which worked only by
      // accident because the two rules happened to be identical. Calling
      // the right one means future divergence (e.g. finance gains an
      // additional check) lands correctly. Admins can hold both perms; we
      // prefer the more specific finance rule when present.
      const sodKey = canFinance ? 'invoice.approve.finance' : 'invoice.approve.sales';
      const sodErr = sodCheckRunner(sodKey)(req.user, entity);
      if (sodErr) return res.status(403).json({ success: false, error: sodErr });
    }
    // Rejection of either side.
    if (newStatus === 'Rejected' && prevStatus === 'Pending Approval') {
      if (!can(req.user.role, 'invoice.reject.sales') && !can(req.user.role, 'invoice.reject.finance')) {
        return res.status(403).json({ success: false, error: "You don't have permission to reject this invoice." });
      }
    }
    // Customer-on-behalf action — the user marking accept can't be the same
    // user who approved/sent the invoice. Customer Rejected has its own
    // reject flow handled elsewhere, but the SoD shape is identical.
    if (newStatus === 'Customer Accepted' || newStatus === 'Customer Rejected') {
      if (!can(req.user.role, 'invoice.customer_action') && req.user.role !== 'admin' && req.user.role !== 'customer') {
        return res.status(403).json({ success: false, error: "You don't have permission to mark this invoice on behalf of the customer." });
      }
      const sodErr = sodCheckRunner('invoice.customer_action')(req.user, entity);
      if (sodErr) return res.status(403).json({ success: false, error: sodErr });
    }
    // Mark paid — finance head only.
    if (newStatus === 'Paid' || newStatus === 'Partially Paid') {
      if (!can(req.user.role, 'invoice.mark_paid')) {
        return res.status(403).json({ success: false, error: "Only Finance Head can mark an invoice as paid." });
      }
    }
  }

  const sqlSets = [];
  const binds = { id };

  const mappings = {
    status: 'STATUS',
    approvedInvoiceId: 'APPROVED_INVOICE_ID',
    rejectionReason: 'REJECTION_REASON',
    signatureData: 'SIGNATURE_DATA',
    amountPaid: 'AMOUNT_PAID',
    balanceDue: 'BALANCE_DUE',
    // Module 1 — finance can override the snapshotted payment terms or
    // due date (e.g. negotiated extension, special-terms invoice). Both
    // are optional; if omitted, the original snapshot stands.
    paymentTerms: 'PAYMENT_TERMS',
    // Module 4 — controlled rejection / win vocabulary. Persisted
    // alongside the legacy free-text REJECTION_REASON so the
    // upcoming win/loss + cancellation-analysis reports have a
    // GROUP BY-able column. All three are optional — when omitted
    // the existing free-text path still works for legacy clients.
    rejectionReasonCode: 'REJECTION_REASON_CODE',
    lostToCompetitor:    'LOST_TO_COMPETITOR',
    winReasonCode:       'WIN_REASON_CODE'
  };

  for (const [key, dbCol] of Object.entries(mappings)) {
    if (updates[key] !== undefined) {
      sqlSets.push(`${dbCol} = :${key}`);
      binds[key] = updates[key];
    }
  }

  // DUE_DATE is a DATE column — needs JS Date binding, not string. Handle
  // it separately from the generic mapping loop so the conversion happens
  // here rather than relying on the loop's pass-through.
  if (updates.dueDate !== undefined) {
    sqlSets.push('DUE_DATE = :dueDate');
    binds.dueDate = updates.dueDate ? new Date(updates.dueDate) : null;
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

  // Capture so we can emit an inventory-update broadcast iff the approval
  // path actually decremented stock (avoids needless refetches elsewhere).
  let stockChanged = false;

  if (sqlSets.length > 0) {
    sqlSets.push('UPDATED_AT = SYSTIMESTAMP');

    // ── Optimistic concurrency control ───────────────────────────────
    // When the client supplies `rowVersion` (which they get from any
    // GET /invoices/:id response), the UPDATE clauses gain a version
    // match and the column is incremented on success. A 0-row result
    // means somebody else changed the invoice since the client loaded
    // it — we return 409 so the UI can prompt for reload instead of
    // silently overwriting the other user's edits.
    //
    // Backward-compatible: a client that omits rowVersion gets the
    // legacy last-write-wins behaviour (with a warning log so we can
    // spot un-migrated callers).
    const expectedRv = (updates.rowVersion !== undefined && updates.rowVersion !== null)
      ? Number(updates.rowVersion)
      : null;
    if (expectedRv === null) {
      console.warn(`[invoices PUT ${id}] no rowVersion supplied — concurrency check skipped`);
    }

    const setsForSql = [...sqlSets];
    if (expectedRv !== null) setsForSql.push('ROW_VERSION = ROW_VERSION + 1');

    const whereParts = ['INVOICE_ID = :id'];
    const updateBinds = { ...binds };
    if (expectedRv !== null) {
      whereParts.push('ROW_VERSION = :expectedRv');
      updateBinds.expectedRv = expectedRv;
    }
    const updateSql = `UPDATE QA_INVOICES SET ${setsForSql.join(', ')} WHERE ${whereParts.join(' AND ')}`;

    // Sales-side approval is the one transition that must atomically
    // decrement physical inventory. Previously the frontend did this as
    // a separate GET-then-PUT loop after a successful PUT, which is a
    // textbook lost-update race: two concurrent approvals for the same
    // SKU both read the same stock value and both wrote it back, leaving
    // the warehouse silently oversold. Doing it server-side inside one
    // transaction kills that race — either both the status change AND
    // every stock decrement succeed, or nothing changes.
    const isApproval = updates.status === 'Approved'
                    && notifyCtx
                    && notifyCtx.prevStatus === 'Pending Approval';

    try {
      if (isApproval) {
        await transaction(async (conn) => {
          // 1. Load line items
          const liRes = await conn.execute(
            `SELECT SKU, QUANTITY FROM QA_INVOICE_LINE_ITEMS WHERE INVOICE_ID = :id`,
            { id },
            { outFormat: 4002 }
          );

          // 2. Atomically decrement each SKU. The conditional WHERE
          //    (`STOCK >= :qty`) is the lock-free way to detect a
          //    shortage — Oracle does the read-and-write in a single
          //    atomic statement, so two concurrent approvers can't both
          //    "win" with stale snapshots.
          for (const li of (liRes.rows || [])) {
            const sku = li.SKU;
            const qty = Number(li.QUANTITY) || 0;
            if (!sku || qty <= 0) continue;

            const dec = await conn.execute(
              `UPDATE QA_INVENTORY
                  SET STOCK = STOCK - :qty,
                      UPDATED_AT = SYSTIMESTAMP,
                      UPDATED_BY = :uby
                WHERE SKU = :sku AND STOCK >= :qty`,
              { sku, qty, uby: req.user.email },
              { autoCommit: false }
            );
            if ((dec.rowsAffected || 0) === 0) {
              // Did the SKU exist at all? Custom / sourced items aren't
              // in QA_INVENTORY by design — those skip cleanly. A real
              // SKU with insufficient stock fails the whole approval.
              const exists = await conn.execute(
                `SELECT STOCK, ITEM_NAME FROM QA_INVENTORY WHERE SKU = :sku`,
                { sku },
                { outFormat: 4002 }
              );
              if (exists.rows && exists.rows.length > 0) {
                const have = exists.rows[0].STOCK;
                const name = exists.rows[0].ITEM_NAME || sku;
                const e = new Error(
                  `Insufficient stock for ${name} (${sku}): need ${qty}, have ${have}.`
                );
                e.code = 'INSUFFICIENT_STOCK';
                throw e;
              }
              // SKU not in inventory table — custom / sourced item, OK.
            } else {
              stockChanged = true;
            }
          }

          // 3. Update the invoice itself (status, signature, etc.)
          const upd = await conn.execute(updateSql, updateBinds, { autoCommit: false });
          if ((upd.rowsAffected || 0) === 0) {
            const e = new Error(expectedRv !== null
              ? 'This invoice was modified by another user. Reload and try again.'
              : 'Invoice not found.');
            e.code = expectedRv !== null ? 'VERSION_MISMATCH' : 'NOT_FOUND';
            throw e;
          }
        });
      } else {
        // Non-approval update — single statement is enough. Still
        // version-checked when rowVersion was supplied.
        const upd = await execute(updateSql, updateBinds);
        if ((upd.rowsAffected || 0) === 0) {
          if (expectedRv !== null) {
            return res.status(409).json({
              success: false,
              code: 'VERSION_MISMATCH',
              error: 'This invoice was modified by another user. Reload and try again.'
            });
          }
          // No version supplied + 0 rows = invoice doesn't exist.
          return res.status(404).json({ success: false, error: 'Invoice not found.' });
        }
      }
    } catch (err) {
      if (err.code === 'INSUFFICIENT_STOCK') {
        return res.status(409).json({ success: false, code: 'INSUFFICIENT_STOCK', error: err.message });
      }
      if (err.code === 'VERSION_MISMATCH') {
        return res.status(409).json({ success: false, code: 'VERSION_MISMATCH', error: err.message });
      }
      if (err.code === 'NOT_FOUND') {
        return res.status(404).json({ success: false, error: err.message });
      }
      throw err;
    }
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
  // Server-side stock decrement happened atomically above, so refresh
  // every connected client's inventory snapshot too.
  if (stockChanged) emitToAll('inventory:updated');

  // ── Notifications ────────────────────────────────────────────────────
  // Fan a status change out to the people who need to know. Fire-and-forget
  // — notify() never throws, so this can't affect the response above.
  if (notifyCtx && sqlSets.length > 0) {
    const c = notifyCtx;
    const actor = req.user.email;
    const link = { invoiceId: id };

    if (c.newStatus === 'Pending Approval') {
      notify({
        to: { roles: ['finance_head'], excludeActor: true },
        actor, type: 'invoice.pending_approval', category: 'invoices', severity: 'warning',
        title: 'Invoice awaiting your approval',
        body: `${id} for ${c.customerName} (${money(c.currency, c.total)}) was submitted and needs finance approval.`,
        entityType: 'invoice', entityId: id,
        linkPage: 'invoiceEditor', linkContext: { ...link, returnTo: 'invoices' },
        groupKey: `invoice:${id}:pending_approval`
      });
    } else if (c.newStatus === 'Approved') {
      notify({
        to: { users: [c.createdBy, c.salesPersonId], excludeActor: true },
        actor, type: 'invoice.approved', category: 'invoices', severity: 'success',
        title: 'Invoice approved',
        body: `${id} for ${c.customerName} (${money(c.currency, c.total)}) was approved by ${actor}.`,
        entityType: 'invoice', entityId: id,
        linkPage: 'invoiceEditor', linkContext: { ...link, returnTo: 'myInvoices' }
      });
    } else if (c.newStatus === 'Rejected') {
      const reason = updates.rejectionReason ? ` Reason: "${String(updates.rejectionReason).slice(0, 300)}"` : '';
      notify({
        to: { users: [c.createdBy, c.salesPersonId], excludeActor: true },
        actor, type: 'invoice.rejected', category: 'invoices', severity: 'warning',
        title: 'Invoice rejected',
        body: `${id} for ${c.customerName} was rejected by ${actor}.${reason}`,
        entityType: 'invoice', entityId: id,
        linkPage: 'invoiceEditor', linkContext: { ...link, returnTo: 'myInvoices' }
      });
    } else if (c.newStatus === 'Customer Accepted') {
      notify({
        to: { users: [c.createdBy, c.salesPersonId], roles: ['sales_head'], excludeActor: true },
        actor, type: 'invoice.customer_accepted', category: 'invoices', severity: 'success',
        title: 'Customer accepted invoice',
        body: `${c.customerName} accepted ${id} (${money(c.currency, c.total)}).`,
        entityType: 'invoice', entityId: id,
        linkPage: 'invoiceEditor', linkContext: { ...link, returnTo: 'myInvoices' }
      });
    } else if (c.newStatus === 'Customer Rejected') {
      notify({
        to: { users: [c.createdBy, c.salesPersonId], roles: ['sales_head'], excludeActor: true },
        actor, type: 'invoice.customer_rejected', category: 'invoices', severity: 'warning',
        title: 'Customer rejected invoice',
        body: `${c.customerName} declined ${id} (${money(c.currency, c.total)}).`,
        entityType: 'invoice', entityId: id,
        linkPage: 'invoiceEditor', linkContext: { ...link, returnTo: 'myInvoices' }
      });
    } else if (c.newStatus === 'Paid' || c.newStatus === 'Partially Paid') {
      notify({
        to: { roles: ['finance_head'], users: [c.createdBy, c.salesPersonId], excludeActor: true },
        actor, type: 'invoice.paid', category: 'finance',
        severity: c.newStatus === 'Paid' ? 'success' : 'info',
        title: c.newStatus === 'Paid' ? 'Invoice marked paid' : 'Invoice partially paid',
        body: `${id} for ${c.customerName} was marked ${c.newStatus.toLowerCase()} by ${actor}.`,
        entityType: 'invoice', entityId: id,
        linkPage: 'invoiceEditor', linkContext: { ...link, returnTo: 'invoices' }
      });
    }
  }

  res.json({ success: true });
}));

/**
 * DELETE /api/invoices/:id  — SOFT DELETE
 *
 * Per Ghana Companies Act 2019 (6-year record retention) and
 * ISO/IEC 27001:2022 A.8.10 (Information Deletion), financial
 * records may NOT be permanently destroyed on demand. We retain
 * the row + line items + payments forever and just mark the
 * invoice IS_DELETED='Y' so it disappears from the active UI.
 *
 * Admin can recover via POST /:id/restore below.
 *
 * Controller/admin only — same access as before.
 */
router.delete('/:id', requireRole('controller', 'admin'), catchAsync(async (req, res) => {
  const { id } = req.params;

  // Idempotent: if already soft-deleted, return 200 — caller wanted it gone.
  const result = await execute(
    `UPDATE QA_INVOICES
        SET IS_DELETED = 'Y',
            DELETED_AT = SYSTIMESTAMP,
            DELETED_BY = :usr
      WHERE INVOICE_ID = :id AND (IS_DELETED IS NULL OR IS_DELETED = 'N')`,
    { id, usr: req.user.email }
  );

  if (result.rowsAffected === 0) {
    // Either invoice doesn't exist OR was already deleted. Disambiguate.
    const check = await execute(
      `SELECT IS_DELETED FROM QA_INVOICES WHERE INVOICE_ID = :id`,
      { id }
    );
    if (!check.rows?.[0]) {
      return res.status(404).json({ success: false, error: 'Invoice not found.' });
    }
    // Already deleted — still success; nothing to do.
  }

  emitToAll('invoices:updated');
  res.json({ success: true, softDeleted: true });
}));

/**
 * POST /api/invoices/:id/restore — undo soft-delete.
 * Admin recovery path; same role gate as delete.
 */
router.post('/:id/restore', requireRole('controller', 'admin'), catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await execute(
    `UPDATE QA_INVOICES
        SET IS_DELETED = 'N',
            DELETED_AT = NULL,
            DELETED_BY = NULL
      WHERE INVOICE_ID = :id AND IS_DELETED = 'Y'`,
    { id }
  );
  if (result.rowsAffected === 0) {
    return res.status(404).json({ success: false, error: 'No soft-deleted invoice with that ID.' });
  }
  emitToAll('invoices:updated');
  res.json({ success: true, restored: true });
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
router.post('/:id/reapprove', requirePermission('invoice.reapprove'), catchAsync(async (req, res) => {
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

    // Audit-event INSERT — same defensive guard as in /rfqs/:id/approve. The
    // CHK_PE_ENTITY constraint on QA_PROCUREMENT_EVENTS must include 'INVOICE'
    // (added in migrate_procurement_schema.js step 10b). If the migration
    // hasn't been run on this deployment the INSERT would throw ORA-02290 and
    // roll back the user-visible reapproval decision. We log and continue —
    // the load-bearing state is REQUIRES_REAPPROVAL on QA_INVOICES.
    try {
      await conn.execute(
        `INSERT INTO QA_PROCUREMENT_EVENTS (EVENT_TYPE, ENTITY_TYPE, ENTITY_ID, ACTOR, PAYLOAD)
         VALUES ('INVOICE_REAPPROVAL_DECISION','INVOICE',:id,:actor,:payload)`,
        { id, actor: req.user.email, payload: JSON.stringify({ decision, note: note || null }) }
      );
    } catch (eventErr) {
      console.warn(
        `[reapproval] Failed to log INVOICE_REAPPROVAL_DECISION event for ${id} ` +
        `(ENTITY_TYPE constraint may not yet allow 'INVOICE' — run ` +
        `migrate_procurement_schema.js): ${eventErr.message}`
      );
    }
  });

  emitToAll('invoices:updated');
  res.json({ success: true, decision });
}));

module.exports = router;
