'use strict';

const express = require('express');
const { execute } = require('../db');
const { catchAsync } = require('../middleware/errorHandler');
const { authMiddleware } = require('../middleware/authMiddleware');
const { emitToAll } = require('../utils/socketEmitter');

const router = express.Router();
router.use(authMiddleware);

/**
 * GET /api/inventory
 */
router.get('/', catchAsync(async (req, res) => {
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
router.post('/', catchAsync(async (req, res) => {
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
      MARKUP_OVERRIDE, PRICING_TIER, UPDATED_BY
    ) VALUES (
      :sku, :name, :vendor, :stock, :price, :restock, :curr, :itype,
      :ucost, :wkg, :dl, :dw, :dh,
      :fpu, :dpu, :ipu, :ppu, :opu,
      :hpu, :tapu,
      :mo, :pt, :uby
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
    uby: req.user.email
  });

  emitToAll('inventory:updated');
  res.json({ success: true, data: item });
}));

/**
 * PUT /api/inventory/:id
 */
router.put('/:id', catchAsync(async (req, res) => {
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
    markupOverridePercent: 'MARKUP_OVERRIDE', pricingTier: 'PRICING_TIER'
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
router.delete('/:id', catchAsync(async (req, res) => {
  const { id } = req.params;
  await execute('DELETE FROM QA_INVENTORY WHERE SKU = :id', { id });
  emitToAll('inventory:updated');
  res.json({ success: true });
}));

module.exports = router;
