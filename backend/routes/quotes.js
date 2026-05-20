'use strict';

const express = require('express');
const crypto = require('crypto');
const { execute, transaction } = require('../db');
const { catchAsync } = require('../middleware/errorHandler');
const { authMiddleware, requirePermission } = require('../middleware/authMiddleware');
const { can } = require('../../shared/permissions');
const { emitToAll } = require('../utils/socketEmitter');

const router = express.Router();
router.use(authMiddleware);

/**
 * GET /api/quotes
 */
router.get('/', catchAsync(async (req, res) => {
  // SCOPE FILTER — users without `invoice.read.all` (which a sales_officer
  // doesn't have) only see quotes they created. Same shape as the
  // /api/invoices GET scope filter so behaviour is consistent across the
  // sales surface.
  let sql = 'SELECT * FROM QA_QUOTES';
  const binds = {};
  if (!can(req.user.role, 'invoice.read.all')) {
    sql += ' WHERE LOWER(CREATED_BY) = LOWER(:me)';
    binds.me = req.user.email;
  }
  sql += ' ORDER BY CREATED_AT DESC FETCH FIRST 500 ROWS ONLY';
  const result = await execute(sql, binds);
  
  const quotes = [];
  
  for (const row of (result.rows || [])) {
    const quoteId = row.QUOTE_ID;
    
    // Fetch quote line items
    const liRes = await execute(
      'SELECT * FROM QA_QUOTE_LINE_ITEMS WHERE QUOTE_ID = :id ORDER BY SORT_ORDER, LINE_ID',
      { id: quoteId }
    );

    quotes.push({
      id: quoteId,
      status: row.STATUS,
      createdBy: row.CREATED_BY,
      customerId: row.CUSTOMER_ID,
      customerName: row.CUSTOMER_NAME,
      date: row.QUOTE_DATE,
      expiresAt: row.EXPIRES_AT,
      incoterm: row.INCOTERM,
      currency: row.CURRENCY,
      notes: row.NOTES,
      terms: row.TERMS,
      subtotal: row.SUBTOTAL,
      shippingCharge: row.SHIPPING_CHARGE,
      insuranceCharge: row.INSURANCE_CHARGE,
      orderDiscount: row.ORDER_DISCOUNT,
      handlingCharge: row.HANDLING_CHARGE,
      tax: row.TAX,
      total: row.TOTAL,
      grossMarginPct: row.GROSS_MARGIN_PCT,
      audit: {
        computedBy: row.AUDIT_COMPUTED_BY,
        computedAt: row.AUDIT_COMPUTED_AT,
        validated: row.AUDIT_VALIDATED === 1
      },
      convertedToInvoice: row.CONVERTED_TO_INV,
      conversionDate: row.CONVERSION_DATE,
      createdAt: row.CREATED_AT,
      updatedAt: row.UPDATED_AT,
      
      lineItems: (liRes.rows || []).map(li => ({
        id: li.SKU || li.LINE_ID.toString(),
        description: li.DESCRIPTION,
        quantity: li.QUANTITY,
        unitCost: li.UNIT_COST,
        freightBreakdown: li.FREIGHT_BREAKDOWN,
        dutyBreakdown: li.DUTY_BREAKDOWN,
        insuranceBreakdown: li.INSURANCE_BREAKDOWN,
        packagingBreakdown: li.PACKAGING_BREAKDOWN,
        otherBreakdown: li.OTHER_BREAKDOWN,
        unitLandedCost: li.UNIT_LANDED_COST,
        markupPercent: li.MARKUP_PERCENT,
        pricingMode: li.PRICING_MODE,
        unitPrice: li.UNIT_PRICE,
        totalPrice: li.LINE_TOTAL
      }))
    });
  }

  res.json({ success: true, data: quotes });
}));

/**
 * POST /api/quotes
 */
router.post('/', requirePermission('quote.create'), catchAsync(async (req, res) => {
  const qt = req.body;
  if (!qt.id) qt.id = crypto.randomUUID();

  await transaction(async (conn) => {
    // 1. Insert Parent
    await conn.execute(`
      INSERT INTO QA_QUOTES (
        QUOTE_ID, STATUS, CREATED_BY, CUSTOMER_ID, CUSTOMER_NAME, QUOTE_DATE,
        EXPIRES_AT, INCOTERM, CURRENCY, NOTES, TERMS, SUBTOTAL, SHIPPING_CHARGE,
        INSURANCE_CHARGE, ORDER_DISCOUNT, HANDLING_CHARGE, TAX, TOTAL,
        GROSS_MARGIN_PCT, AUDIT_COMPUTED_BY, AUDIT_COMPUTED_AT, AUDIT_VALIDATED
      ) VALUES (
        :id, :st, :cb, :cid, :cn, :qd, :exp, :inc, :cur, :not, :trm,
        :sub, :ship, :ins, :disc, :hnd, :tx, :tot, :gmp, :acb, :aca, :val
      )
    `, {
      id: qt.id,
      st: qt.status || 'DRAFT',
      cb: qt.createdBy || req.user.email,
      cid: qt.customerId || null,
      cn: qt.customerName || null,
      qd: qt.date || null,
      exp: qt.expiresAt || null,
      inc: qt.incoterm || 'FOB',
      cur: qt.currency || 'GHS',
      not: qt.notes || null,
      trm: qt.terms || null,
      sub: qt.subtotal || 0,
      ship: qt.shippingCharge || 0,
      ins: qt.insuranceCharge || 0,
      disc: qt.orderDiscount || 0,
      hnd: qt.handlingCharge || 0,
      tx: qt.tax || 0,
      tot: qt.total || 0,
      gmp: qt.grossMarginPct || null,
      acb: qt.audit?.computedBy || null,
      aca: qt.audit?.computedAt || null,
      val: qt.audit?.validated ? 1 : 0
    });

    // 2. Insert Line Items
    if (qt.lineItems && qt.lineItems.length > 0) {
      for (let i = 0; i < qt.lineItems.length; i++) {
        const item = qt.lineItems[i];
        await conn.execute(`
          INSERT INTO QA_QUOTE_LINE_ITEMS (
            QUOTE_ID, SKU, DESCRIPTION, QUANTITY, UNIT_COST, FREIGHT_BREAKDOWN,
            DUTY_BREAKDOWN, INSURANCE_BREAKDOWN, PACKAGING_BREAKDOWN, OTHER_BREAKDOWN,
            UNIT_LANDED_COST, MARKUP_PERCENT, PRICING_MODE, UNIT_PRICE, LINE_TOTAL, SORT_ORDER
          ) VALUES (
            :qid, :sku, :desc, :qty, :uc, :fb, :db, :ib, :pb, :ob, :ulc, :mup, :pm, :up, :lt, :srt
          )
        `, {
          qid: qt.id,
          sku: item.id || null, // SKU front-end binding
          desc: item.description || '',
          qty: item.quantity || 1,
          uc: item.unitCost || 0,
          fb: item.freightBreakdown || 0,
          db: item.dutyBreakdown || 0,
          ib: item.insuranceBreakdown || 0,
          pb: item.packagingBreakdown || 0,
          ob: item.otherBreakdown || 0,
          ulc: item.unitLandedCost || 0,
          mup: item.markupPercent || 0,
          pm: item.pricingMode || 'markup',
          up: item.unitPrice || 0,
          lt: item.totalPrice || 0,
          srt: i
        });
      }
    }
  });

  emitToAll('quotes:updated');
  res.json({ success: true, id: qt.id });
}));

/**
 * PUT /api/quotes/:id
 */
router.put('/:id', requirePermission('quote.create'), catchAsync(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  const sqlSets = [];
  const binds = { id };

  const mappings = {
    status: 'STATUS',
    convertedToInvoice: 'CONVERTED_TO_INV'
  };

  for (const [key, dbCol] of Object.entries(mappings)) {
    if (updates[key] !== undefined) {
      sqlSets.push(`${dbCol} = :${key}`);
      binds[key] = updates[key];
    }
  }
  
  if (updates.convertedToInvoice) {
    sqlSets.push('CONVERSION_DATE = SYSTIMESTAMP');
  }

  if (sqlSets.length > 0) {
    sqlSets.push('UPDATED_AT = SYSTIMESTAMP');
    const sql = `UPDATE QA_QUOTES SET ${sqlSets.join(', ')} WHERE QUOTE_ID = :id`;
    await execute(sql, binds);
    emitToAll('quotes:updated');
  }

  res.json({ success: true });
}));

/**
 * DELETE /api/quotes/:id
 */
router.delete('/:id', requirePermission('quote.create'), catchAsync(async (req, res) => {
  const { id } = req.params;
  await execute('DELETE FROM QA_QUOTES WHERE QUOTE_ID = :id', { id });
  emitToAll('quotes:updated');
  res.json({ success: true });
}));

module.exports = router;
