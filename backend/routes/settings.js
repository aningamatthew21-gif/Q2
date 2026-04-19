'use strict';

const express = require('express');
const crypto = require('crypto');
const { execute, transaction, lobToString } = require('../db');
const { catchAsync } = require('../middleware/errorHandler');
const { authMiddleware, requireRole } = require('../middleware/authMiddleware');
const { emitToAll } = require('../utils/socketEmitter');

const router = express.Router();
router.use(authMiddleware);

// ==========================================
// TAX SETTINGS
// ==========================================
router.get('/taxes', catchAsync(async (req, res) => {
  const result = await execute('SELECT * FROM QA_TAX_SETTINGS ORDER BY SORT_ORDER ASC');
  const taxArray = (result.rows || []).map(row => ({
    id: row.TAX_ID,
    name: row.TAX_NAME,
    rate: row.TAX_RATE,
    enabled: row.IS_ENABLED === 1,
    on: row.APPLIED_ON
  }));
  res.json({ success: true, data: { taxArray } });
}));

router.post('/taxes', requireRole('controller', 'admin'), catchAsync(async (req, res) => {
  const { taxArray } = req.body;
  
  await transaction(async (conn) => {
    await conn.execute('DELETE FROM QA_TAX_SETTINGS');
    
    for (let i = 0; i < taxArray.length; i++) {
      const tax = taxArray[i];
      await conn.execute(`
        INSERT INTO QA_TAX_SETTINGS (TAX_ID, TAX_NAME, TAX_RATE, IS_ENABLED, APPLIED_ON, SORT_ORDER)
        VALUES (:id, :nm, :rt, :en, :onV, :so)
      `, {
        id: tax.id,
        nm: tax.name,
        rt: tax.rate || 0,
        en: tax.enabled ? 1 : 0,
        onV: tax.on || 'subtotal',
        so: i
      });
    }
  });

  emitToAll('settings:taxes:updated');
  res.json({ success: true });
}));

// ==========================================
// EXCHANGE RATES
// ==========================================
router.get('/exchangeRates', catchAsync(async (req, res) => {
  const result = await execute('SELECT * FROM QA_EXCHANGE_RATES ORDER BY RATE_MONTH DESC');
  const rates = (result.rows || []).map(row => ({
    id: row.RATE_ID,
    month: row.RATE_MONTH,
    usdToGhs: row.USD_TO_GHS,
    createdAt: row.CREATED_AT,
    createdBy: row.CREATED_BY,
    updatedAt: row.UPDATED_AT,
    updatedBy: row.UPDATED_BY
  }));
  res.json({ success: true, data: { rates } });
}));

router.post('/exchangeRates', catchAsync(async (req, res) => {
  const { rates } = req.body; // Full array sent by client

  await transaction(async (conn) => {
    await conn.execute('DELETE FROM QA_EXCHANGE_RATES');

    for (const rate of rates) {
      await conn.execute(`
        INSERT INTO QA_EXCHANGE_RATES (RATE_ID, RATE_MONTH, USD_TO_GHS, CREATED_BY, UPDATED_BY)
        VALUES (:id, :mo, :rt, :cb, :ub)
      `, {
        id: rate.id || crypto.randomUUID(),
        mo: rate.month,
        rt: rate.usdToGhs || 0,
        cb: rate.createdBy || req.user.email,
        ub: req.user.email
      });
    }
  });

  res.json({ success: true });
}));

// ==========================================
// SIGNATURES
// ==========================================
router.get('/signatures', catchAsync(async (req, res) => {
  const result = await execute('SELECT * FROM QA_SIGNATURES');

  // Safely resolve SIGNATURE_URL — it may be a Lob stream or a plain string
  const signatures = await Promise.all(
    (result.rows || []).map(async row => ({
      id: row.SIG_ID,
      controllerName: row.CONTROLLER_NAME,
      subsidiary: row.SUBSIDIARY,
      signatureUrl: await lobToString(row.SIGNATURE_URL),
      createdAt: row.CREATED_AT,
      createdBy: row.CREATED_BY
    }))
  );

  res.json({ success: true, data: { signatures } });
}));

router.post('/signatures', catchAsync(async (req, res) => {
  const { signatures } = req.body;

  await transaction(async (conn) => {
    await conn.execute('DELETE FROM QA_SIGNATURES');

    for (const sig of signatures) {
      // CLOB fields handle large base64 strings natively in thin mode
      await conn.execute(`
        INSERT INTO QA_SIGNATURES (SIG_ID, CONTROLLER_NAME, SUBSIDIARY, SIGNATURE_URL, CREATED_BY)
        VALUES (:id, :cn, :sub, :surl, :cb)
      `, {
        id: sig.id || crypto.randomUUID(),
        cn: sig.controllerName,
        sub: sig.subsidiary || null,
        surl: sig.signatureUrl || null,
        cb: sig.createdBy || req.user.email
      });
    }
  });

  res.json({ success: true });
}));

// ==========================================
// COMPANY DATA (INVOICE HEADER SETTINGS)
// ==========================================
router.get('/company', catchAsync(async (req, res) => {
  const result = await execute('SELECT * FROM QA_COMPANY_SETTINGS');
  const data = {};

  for (const row of result.rows) {
    if (row.SETTING_VAL) {
      try {
        data[row.SETTING_KEY] = JSON.parse(row.SETTING_VAL);
      } catch (e) {
        data[row.SETTING_KEY] = null;
      }
    }
  }

  res.json({ success: true, data });
}));

router.post('/company', catchAsync(async (req, res) => {
  const data = req.body;

  await transaction(async (conn) => {
    for (const [key, val] of Object.entries(data)) {
      if (typeof val === 'object') {
        const jsonStr = JSON.stringify(val);
        await conn.execute(`
          MERGE INTO QA_COMPANY_SETTINGS dest
          USING (SELECT :k AS k, :v AS v FROM DUAL) src
          ON (dest.SETTING_KEY = src.k)
          WHEN MATCHED THEN UPDATE SET SETTING_VAL = src.v
          WHEN NOT MATCHED THEN INSERT (SETTING_KEY, SETTING_VAL) VALUES (src.k, src.v)
        `, { k: key, v: jsonStr });
      }
    }
  });

  res.json({ success: true });
}));

// ==========================================
// PRICING
// ==========================================
router.get('/pricing', catchAsync(async (req, res) => {
  const result = await execute('SELECT * FROM QA_PRICING_SETTINGS WHERE ID = \'pricing\'');
  
  if (!result.rows || result.rows.length === 0) {
    return res.json({ success: true, data: null });
  }

  const r = result.rows[0];
  res.json({
    success: true,
    data: {
      defaultMarkupPercent: r.DEFAULT_MARKUP_PCT,
      defaultMarginPercent: r.DEFAULT_MARGIN_PCT,
      pricingMode: r.PRICING_MODE,
      allocationMethod: r.ALLOCATION_METHOD,
      roundingDecimals: r.ROUNDING_DECIMALS,
      defaultIncoterm: r.DEFAULT_INCOTERM,
      defaultCurrency: r.DEFAULT_CURRENCY,
      defaultQuoteExpiryDays: r.DEFAULT_QUOTE_EXPIRY,
      approvalThresholds: {
        minMarginPercent: r.MIN_MARGIN_PCT,
        maxDiscountPercent: r.MAX_DISCOUNT_PCT,
        requireApprovalAbove: r.REQUIRE_APPROVAL_ABOVE,
      },
      taxRules: {
        defaultRate: r.DEFAULT_TAX_RATE
      },
      presetRates: {
        insurancePct: r.INSURANCE_RATE_PCT ?? 0.01,
        freightPct: r.FREIGHT_RATE_PCT ?? 0.12,
        dutyPct: r.DUTY_RATE_PCT ?? 0.50,
        handlingPct: r.HANDLING_RATE_PCT ?? 0.02,
        transferAdminPct: r.TRANSFER_ADMIN_RATE_PCT ?? 0.015,
        defaultFxRate: r.DEFAULT_FX_RATE ?? 13.05
      }
    }
  });
}));

router.post('/pricing', catchAsync(async (req, res) => {
  const p = req.body;

  await execute(`
    MERGE INTO QA_PRICING_SETTINGS dest
    USING (SELECT 'pricing' AS id FROM DUAL) src
    ON (dest.ID = src.id)
    WHEN MATCHED THEN UPDATE SET
      DEFAULT_MARKUP_PCT = :mup, DEFAULT_MARGIN_PCT = :mar,
      PRICING_MODE = :mod, ALLOCATION_METHOD = :alloc, ROUNDING_DECIMALS = :rnd,
      DEFAULT_INCOTERM = :inc, DEFAULT_CURRENCY = :cur, DEFAULT_QUOTE_EXPIRY = :exp,
      MIN_MARGIN_PCT = :minm, MAX_DISCOUNT_PCT = :maxd, REQUIRE_APPROVAL_ABOVE = :req,
      DEFAULT_TAX_RATE = :tax,
      INSURANCE_RATE_PCT = :irp, FREIGHT_RATE_PCT = :frp, DUTY_RATE_PCT = :drp,
      HANDLING_RATE_PCT = :hrp, TRANSFER_ADMIN_RATE_PCT = :tarp, DEFAULT_FX_RATE = :fxr,
      UPDATED_AT = SYSTIMESTAMP
    WHEN NOT MATCHED THEN INSERT (
      ID, DEFAULT_MARKUP_PCT, DEFAULT_MARGIN_PCT, PRICING_MODE, ALLOCATION_METHOD,
      ROUNDING_DECIMALS, DEFAULT_INCOTERM, DEFAULT_CURRENCY, DEFAULT_QUOTE_EXPIRY,
      MIN_MARGIN_PCT, MAX_DISCOUNT_PCT, REQUIRE_APPROVAL_ABOVE, DEFAULT_TAX_RATE,
      INSURANCE_RATE_PCT, FREIGHT_RATE_PCT, DUTY_RATE_PCT, HANDLING_RATE_PCT,
      TRANSFER_ADMIN_RATE_PCT, DEFAULT_FX_RATE
    ) VALUES (
      'pricing', :mup, :mar, :mod, :alloc, :rnd, :inc, :cur, :exp,
      :minm, :maxd, :req, :tax,
      :irp, :frp, :drp, :hrp, :tarp, :fxr
    )
  `, {
    mup: p.defaultMarkupPercent || 30,
    mar: p.defaultMarginPercent || 15,
    mod: p.pricingMode || 'markup',
    alloc: p.allocationMethod || 'weight',
    rnd: p.roundingDecimals || 2,
    inc: p.defaultIncoterm || 'FOB',
    cur: p.defaultCurrency || 'GHS',
    exp: p.defaultQuoteExpiryDays || 30,
    minm: p.approvalThresholds?.minMarginPercent || 15,
    maxd: p.approvalThresholds?.maxDiscountPercent || 20,
    req: p.approvalThresholds?.requireApprovalAbove || 10000,
    tax: p.taxRules?.defaultRate || 0.12,
    irp: p.presetRates?.insurancePct ?? 0.01,
    frp: p.presetRates?.freightPct ?? 0.12,
    drp: p.presetRates?.dutyPct ?? 0.50,
    hrp: p.presetRates?.handlingPct ?? 0.02,
    tarp: p.presetRates?.transferAdminPct ?? 0.015,
    fxr: p.presetRates?.defaultFxRate ?? 13.05
  });

  res.json({ success: true });
}));

// ==========================================
// INVOICE COUNTER (SEQUENCE)
// ==========================================
router.post('/invoiceCounter', catchAsync(async (req, res) => {
  await transaction(async (conn) => {
    // 1. Increment counter
    await conn.execute(`
      MERGE INTO QA_COMPANY_SETTINGS dest
      USING (SELECT 'invoice_counter' AS k FROM DUAL) src
      ON (dest.SETTING_KEY = src.k)
      WHEN MATCHED THEN 
        UPDATE SET SETTING_VAL = TO_CHAR(TO_NUMBER(NVL(SETTING_VAL, '0')) + 1)
      WHEN NOT MATCHED THEN 
        INSERT (SETTING_KEY, SETTING_VAL) VALUES ('invoice_counter', '1')
    `);

    // 2. Fetch the new value
    const result = await conn.execute('SELECT SETTING_VAL FROM QA_COMPANY_SETTINGS WHERE SETTING_KEY = \'invoice_counter\'');
    const nextSeq = parseInt(result.rows[0].SETTING_VAL);
    res.json({ success: true, nextSeq });
  });
}));

module.exports = router;
