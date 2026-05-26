'use strict';

const express = require('express');
const { execute, transaction } = require('../db');
const { catchAsync } = require('../middleware/errorHandler');
const { authMiddleware, requirePermission } = require('../middleware/authMiddleware');
const { emitToAll } = require('../utils/socketEmitter');

const router = express.Router();
router.use(authMiddleware);

/**
 * GET /api/inventory
 */
router.get('/', catchAsync(async (req, res) => {
  // Inventory listing is internal-only. Customers must not enumerate the
  // catalogue. Internal staff (anyone with `inventory.read`) can fetch.
  if (req.user.role === 'customer') {
    return res.status(403).json({ success: false, error: "Access denied." });
  }

  const result = await execute('SELECT * FROM QA_INVENTORY ORDER BY ITEM_NAME ASC');

  const items = (result.rows || []).map(row => ({
    id: row.SKU,
    name: row.ITEM_NAME,
    vendor: row.VENDOR || '',
    stock: row.STOCK || 0,
    price: row.PRICE || 0,
    restockLimit: row.RESTOCK_LIMIT || 0,
    currency: row.CURRENCY || 'GHS',
    itemType: row.ITEM_TYPE || 'Hardware',
    unitCost: row.UNIT_COST || 0,
    weightKg: row.WEIGHT_KG || 0,
    dimensions: {
      length: row.DIM_LENGTH || 0,
      width: row.DIM_WIDTH || 0,
      height: row.DIM_HEIGHT || 0
    },
    costComponents: {
      inboundFreightPerUnit: row.FREIGHT_PER_UNIT || 0,
      dutyPerUnit: row.DUTY_PER_UNIT || 0,
      insurancePerUnit: row.INSURANCE_PER_UNIT || 0,
      packagingPerUnit: row.PACKAGING_PER_UNIT || 0,
      otherPerUnit: row.OTHER_PER_UNIT || 0,
      handlingPerUnit: row.HANDLING_PER_UNIT || 0,
      transferAdminPerUnit: row.TRANSFER_ADMIN_PER_UNIT || 0
    },
    markupOverridePercent: row.MARKUP_OVERRIDE || null,
    pricingTier: row.PRICING_TIER || 'standard',
    // Module 1 — item taxonomy. Free text initially; can normalise to a
    // master list later if vocabulary fragmentation becomes a problem.
    itemCategory: row.ITEM_CATEGORY || '',
    itemSubcategory: row.ITEM_SUBCATEGORY || '',
    updatedAt: row.UPDATED_AT,
    updatedBy: row.UPDATED_BY
  }));

  res.json({ success: true, data: items });
}));

/**
 * GET /api/inventory/:id
 */
router.get('/:id', catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await execute('SELECT * FROM QA_INVENTORY WHERE SKU = :id', { id });

  if (!result.rows || result.rows.length === 0) {
    return res.status(404).json({ success: false, error: 'Item not found' });
  }

  const row = result.rows[0];
  res.json({
    success: true,
    data: {
      id: row.SKU,
      name: row.ITEM_NAME,
      vendor: row.VENDOR || '',
      stock: row.STOCK || 0,
      price: row.PRICE || 0,
      restockLimit: row.RESTOCK_LIMIT || 0,
      currency: row.CURRENCY || 'GHS',
      unitCost: row.UNIT_COST || 0,
      weightKg: row.WEIGHT_KG || 0,
      dimensions: {
        length: row.DIM_LENGTH || 0,
        width: row.DIM_WIDTH || 0,
        height: row.DIM_HEIGHT || 0
      },
      costComponents: {
        inboundFreightPerUnit: row.FREIGHT_PER_UNIT || 0,
        dutyPerUnit: row.DUTY_PER_UNIT || 0,
        insurancePerUnit: row.INSURANCE_PER_UNIT || 0,
        packagingPerUnit: row.PACKAGING_PER_UNIT || 0,
        otherPerUnit: row.OTHER_PER_UNIT || 0,
        handlingPerUnit: row.HANDLING_PER_UNIT || 0,
        transferAdminPerUnit: row.TRANSFER_ADMIN_PER_UNIT || 0
      },
      markupOverridePercent: row.MARKUP_OVERRIDE || null,
      pricingTier: row.PRICING_TIER || 'standard',
      updatedAt: row.UPDATED_AT,
      updatedBy: row.UPDATED_BY
    }
  });
}));

/**
 * POST /api/inventory
 */
router.post('/', requirePermission('inventory.write'), catchAsync(async (req, res) => {
  const item = req.body;
  if (!item.id || !item.name) {
    return res.status(400).json({ success: false, error: 'id and name are required' });
  }

  // Parse nested components safely
  const dim = item.dimensions || {};
  const cost = item.costComponents || {};

  await execute(`
    INSERT INTO QA_INVENTORY (
      SKU, ITEM_NAME, VENDOR, STOCK, PRICE, RESTOCK_LIMIT, CURRENCY, ITEM_TYPE,
      UNIT_COST, WEIGHT_KG, DIM_LENGTH, DIM_WIDTH, DIM_HEIGHT,
      FREIGHT_PER_UNIT, DUTY_PER_UNIT, INSURANCE_PER_UNIT, PACKAGING_PER_UNIT, OTHER_PER_UNIT,
      HANDLING_PER_UNIT, TRANSFER_ADMIN_PER_UNIT,
      MARKUP_OVERRIDE, PRICING_TIER, UPDATED_BY,
      ITEM_CATEGORY, ITEM_SUBCATEGORY
    ) VALUES (
      :sku, :name, :vendor, :stock, :price, :restock, :curr, :itype,
      :ucost, :wkg, :dl, :dw, :dh,
      :fpu, :dpu, :ipu, :ppu, :opu,
      :hpu, :tapu,
      :mo, :pt, :uby,
      :ic, :isc
    )
  `, {
    sku: item.id,
    name: item.name,
    vendor: item.vendor || null,
    stock: item.stock || 0,
    price: item.price || 0,
    restock: item.restockLimit || 0,
    curr: item.currency || 'GHS',
    itype: item.itemType || 'Hardware',
    ucost: item.unitCost || 0,
    wkg: item.weightKg || 0,
    dl: dim.length || 0,
    dw: dim.width || 0,
    dh: dim.height || 0,
    fpu: cost.inboundFreightPerUnit || 0,
    dpu: cost.dutyPerUnit || 0,
    ipu: cost.insurancePerUnit || 0,
    ppu: cost.packagingPerUnit || 0,
    opu: cost.otherPerUnit || 0,
    hpu: cost.handlingPerUnit || 0,
    tapu: cost.transferAdminPerUnit || 0,
    mo: item.markupOverridePercent || null,
    pt: item.pricingTier || 'standard',
    uby: req.user.email,
    // Module 1 — item taxonomy
    ic:  item.itemCategory || null,
    isc: item.itemSubcategory || null
  });

  emitToAll('inventory:updated');
  res.json({ success: true, data: item });
}));

/**
 * POST /api/inventory/bulk
 *
 * Bulk upsert for CSV imports. Accepts { items: [...] } and MERGEs every
 * row inside a SINGLE transaction on ONE pooled connection, then emits
 * `inventory:updated` exactly ONCE for the whole batch.
 *
 * This replaces the old client-side pattern of firing one POST per row.
 * For a 1000-line import that meant 1000 HTTP round-trips AND 1000 socket
 * broadcasts — and every connected client refetched + re-rendered the
 * entire (growing) inventory table on each one. That O(n²) cascade is
 * what lagged the app and eventually blanked the screen.
 */
router.post('/bulk', requirePermission('inventory.write'), catchAsync(async (req, res) => {
  const items = Array.isArray(req.body && req.body.items) ? req.body.items : null;
  if (!items || items.length === 0) {
    return res.status(400).json({ success: false, error: 'items array is required' });
  }
  if (items.length > 5000) {
    return res.status(413).json({
      success: false,
      error: 'Too many items in one request (max 5000). Split into smaller batches.'
    });
  }

  // Upsert: update when the SKU already exists, insert otherwise.
  // Module 1 — ITEM_CATEGORY + ITEM_SUBCATEGORY now part of both UPDATE
  // and INSERT branches so CSV imports can populate the new taxonomy.
  const MERGE_SQL = `
    MERGE INTO QA_INVENTORY t
    USING (SELECT :sku AS SKU FROM DUAL) s
    ON (t.SKU = s.SKU)
    WHEN MATCHED THEN UPDATE SET
      ITEM_NAME = :name, VENDOR = :vendor, STOCK = :stock, PRICE = :price,
      RESTOCK_LIMIT = :restock, CURRENCY = :curr, ITEM_TYPE = :itype,
      UNIT_COST = :ucost, WEIGHT_KG = :wkg,
      DIM_LENGTH = :dl, DIM_WIDTH = :dw, DIM_HEIGHT = :dh,
      FREIGHT_PER_UNIT = :fpu, DUTY_PER_UNIT = :dpu, INSURANCE_PER_UNIT = :ipu,
      PACKAGING_PER_UNIT = :ppu, OTHER_PER_UNIT = :opu, HANDLING_PER_UNIT = :hpu,
      TRANSFER_ADMIN_PER_UNIT = :tapu, MARKUP_OVERRIDE = :mo, PRICING_TIER = :pt,
      ITEM_CATEGORY = :ic, ITEM_SUBCATEGORY = :isc,
      UPDATED_AT = SYSTIMESTAMP, UPDATED_BY = :uby
    WHEN NOT MATCHED THEN INSERT (
      SKU, ITEM_NAME, VENDOR, STOCK, PRICE, RESTOCK_LIMIT, CURRENCY, ITEM_TYPE,
      UNIT_COST, WEIGHT_KG, DIM_LENGTH, DIM_WIDTH, DIM_HEIGHT,
      FREIGHT_PER_UNIT, DUTY_PER_UNIT, INSURANCE_PER_UNIT, PACKAGING_PER_UNIT, OTHER_PER_UNIT,
      HANDLING_PER_UNIT, TRANSFER_ADMIN_PER_UNIT, MARKUP_OVERRIDE, PRICING_TIER, UPDATED_BY,
      ITEM_CATEGORY, ITEM_SUBCATEGORY
    ) VALUES (
      :sku, :name, :vendor, :stock, :price, :restock, :curr, :itype,
      :ucost, :wkg, :dl, :dw, :dh,
      :fpu, :dpu, :ipu, :ppu, :opu,
      :hpu, :tapu, :mo, :pt, :uby,
      :ic, :isc
    )
  `;

  const email = req.user.email;
  let processed = 0;
  const errors = [];

  // One connection, one commit. autoCommit:false on each statement so the
  // transaction() wrapper performs a single commit at the end.
  await transaction(async (conn) => {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item || !item.id || !item.name) {
        errors.push({ index: i, error: 'missing id or name' });
        continue;
      }
      const dim = item.dimensions || {};
      const cost = item.costComponents || {};
      const mo = item.markupOverridePercent;
      try {
        await conn.execute(MERGE_SQL, {
          sku:     String(item.id),
          name:    item.name,
          vendor:  item.vendor || null,
          stock:   Number(item.stock) || 0,
          price:   Number(item.price) || 0,
          restock: Number(item.restockLimit) || 0,
          curr:    item.currency || 'GHS',
          itype:   item.itemType || 'Hardware',
          ucost:   Number(item.unitCost) || 0,
          wkg:     Number(item.weightKg) || 0,
          dl:      Number(dim.length) || 0,
          dw:      Number(dim.width) || 0,
          dh:      Number(dim.height) || 0,
          fpu:     Number(cost.inboundFreightPerUnit) || 0,
          dpu:     Number(cost.dutyPerUnit) || 0,
          ipu:     Number(cost.insurancePerUnit) || 0,
          ppu:     Number(cost.packagingPerUnit) || 0,
          opu:     Number(cost.otherPerUnit) || 0,
          hpu:     Number(cost.handlingPerUnit) || 0,
          tapu:    Number(cost.transferAdminPerUnit) || 0,
          mo:      (mo === null || mo === undefined || mo === '') ? null : Number(mo),
          pt:      item.pricingTier || 'standard',
          uby:     email,
          ic:      item.itemCategory || null,
          isc:     item.itemSubcategory || null
        }, { autoCommit: false });
        processed++;
      } catch (err) {
        errors.push({ index: i, id: item.id, error: err.message });
      }
    }
  });

  // ONE broadcast for the whole batch — not one per row.
  emitToAll('inventory:updated');

  res.json({
    success: true,
    data: {
      processed,
      failed: errors.length,
      total: items.length,
      errors: errors.slice(0, 50)
    }
  });
}));

/**
 * PUT /api/inventory/:id
 */
router.put('/:id', requirePermission('inventory.write'), catchAsync(async (req, res) => {
  const { id } = req.params;
  const item = req.body;

  const dim = item.dimensions || {};
  const cost = item.costComponents || {};

  const updates = [];
  const binds = { id, uby: req.user.email };

  const mappings = {
    name: 'ITEM_NAME', vendor: 'VENDOR', stock: 'STOCK', price: 'PRICE',
    restockLimit: 'RESTOCK_LIMIT', currency: 'CURRENCY', itemType: 'ITEM_TYPE',
    unitCost: 'UNIT_COST', weightKg: 'WEIGHT_KG',
    markupOverridePercent: 'MARKUP_OVERRIDE', pricingTier: 'PRICING_TIER',
    // Module 1 — item taxonomy fields. Free text from the modal; whatever
    // the user types persists. Future Module 5 can normalise to a master
    // list if vocabulary fragmentation becomes a problem.
    itemCategory: 'ITEM_CATEGORY',
    itemSubcategory: 'ITEM_SUBCATEGORY'
  };

  for (const [key, dbCol] of Object.entries(mappings)) {
    if (item[key] !== undefined) {
      updates.push(`${dbCol} = :${key}`);
      binds[key] = item[key];
    }
  }

  // Nested structured updates
  if (item.dimensions) {
    if (dim.length !== undefined) { updates.push('DIM_LENGTH = :dl'); binds.dl = dim.length; }
    if (dim.width !== undefined) { updates.push('DIM_WIDTH = :dw'); binds.dw = dim.width; }
    if (dim.height !== undefined) { updates.push('DIM_HEIGHT = :dh'); binds.dh = dim.height; }
  }

  if (item.costComponents) {
    if (cost.inboundFreightPerUnit !== undefined) { updates.push('FREIGHT_PER_UNIT = :fpu'); binds.fpu = cost.inboundFreightPerUnit; }
    if (cost.dutyPerUnit !== undefined) { updates.push('DUTY_PER_UNIT = :dpu'); binds.dpu = cost.dutyPerUnit; }
    if (cost.insurancePerUnit !== undefined) { updates.push('INSURANCE_PER_UNIT = :ipu'); binds.ipu = cost.insurancePerUnit; }
    if (cost.packagingPerUnit !== undefined) { updates.push('PACKAGING_PER_UNIT = :ppu'); binds.ppu = cost.packagingPerUnit; }
    if (cost.otherPerUnit !== undefined) { updates.push('OTHER_PER_UNIT = :opu'); binds.opu = cost.otherPerUnit; }
    if (cost.handlingPerUnit !== undefined) { updates.push('HANDLING_PER_UNIT = :hpu'); binds.hpu = cost.handlingPerUnit; }
    if (cost.transferAdminPerUnit !== undefined) { updates.push('TRANSFER_ADMIN_PER_UNIT = :tapu'); binds.tapu = cost.transferAdminPerUnit; }
  }

  if (updates.length > 0) {
    updates.push('UPDATED_AT = SYSTIMESTAMP');
    updates.push('UPDATED_BY = :uby');
    const sql = `UPDATE QA_INVENTORY SET ${updates.join(', ')} WHERE SKU = :id`;
    await execute(sql, binds);
    emitToAll('inventory:updated');
  }

  res.json({ success: true });
}));

/**
 * DELETE /api/inventory/:id
 */
router.delete('/:id', requirePermission('inventory.write'), catchAsync(async (req, res) => {
  const { id } = req.params;
  await execute('DELETE FROM QA_INVENTORY WHERE SKU = :id', { id });
  emitToAll('inventory:updated');
  res.json({ success: true });
}));

module.exports = router;
