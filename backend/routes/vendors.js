'use strict';

const express = require('express');
const crypto = require('crypto');
const { execute } = require('../db');
const { catchAsync } = require('../middleware/errorHandler');
const { authMiddleware, requirePermission } = require('../middleware/authMiddleware');
const { emitToAll } = require('../utils/socketEmitter');

const router = express.Router();

// All vendor routes require authentication
router.use(authMiddleware);

const rowToVendor = (row) => ({
  id: row.VENDOR_ID,
  name: row.VENDOR_NAME,
  contactPerson: row.CONTACT_PERSON || '',
  contactEmail: row.CONTACT_EMAIL || '',
  contactPhone: row.CONTACT_PHONE || '',
  category: row.CATEGORY || '',
  status: row.STATUS || 'active',
  rating: row.RATING != null ? Number(row.RATING) : 0,
  paymentTerms: row.PAYMENT_TERMS || '',
  leadTimeDays: row.LEAD_TIME_DAYS != null ? Number(row.LEAD_TIME_DAYS) : 0,
  address: row.ADDRESS || '',
  notes: row.NOTES || '',
  createdAt: row.CREATED_AT,
  createdBy: row.CREATED_BY || '',
  updatedAt: row.UPDATED_AT,
  updatedBy: row.UPDATED_BY || ''
});

/**
 * GET /api/vendors
 * Fetch all vendors (any authenticated user can read)
 */
router.get('/', catchAsync(async (req, res) => {
  const result = await execute('SELECT * FROM QA_VENDORS ORDER BY VENDOR_NAME ASC');
  const vendors = (result.rows || []).map(rowToVendor);
  res.json({ success: true, data: vendors });
}));

/**
 * GET /api/vendors/:id
 */
router.get('/:id', catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await execute('SELECT * FROM QA_VENDORS WHERE VENDOR_ID = :id', { id });
  if (!result.rows || result.rows.length === 0) {
    return res.status(404).json({ success: false, error: 'Vendor not found' });
  }
  res.json({ success: true, data: rowToVendor(result.rows[0]) });
}));

/**
 * POST /api/vendors
 * Create vendor — procurement, controller, or admin
 */
router.post('/', requirePermission('vendor.write'), catchAsync(async (req, res) => {
  const v = req.body || {};
  if (!v.name) {
    return res.status(400).json({ success: false, error: 'name is required' });
  }
  const id = v.id || `VEN-${crypto.randomUUID()}`;

  await execute(`
    INSERT INTO QA_VENDORS (
      VENDOR_ID, VENDOR_NAME, CONTACT_PERSON, CONTACT_EMAIL, CONTACT_PHONE,
      CATEGORY, STATUS, RATING, PAYMENT_TERMS, LEAD_TIME_DAYS,
      ADDRESS, NOTES, CREATED_BY, UPDATED_BY
    ) VALUES (
      :id, :name, :cp, :ce, :cph, :cat, :st, :rt, :pt, :lt, :addr, :notes, :cb, :ub
    )
  `, {
    id,
    name: v.name,
    cp: v.contactPerson || null,
    ce: v.contactEmail || null,
    cph: v.contactPhone || null,
    cat: v.category || null,
    st: v.status || 'active',
    rt: Number(v.rating) || 0,
    pt: v.paymentTerms || null,
    lt: Number(v.leadTimeDays) || 0,
    addr: v.address || null,
    notes: v.notes || null,
    cb: req.user.email,
    ub: req.user.email
  });

  emitToAll('vendors:updated');
  res.json({ success: true, data: { ...v, id } });
}));

/**
 * PUT /api/vendors/:id
 * Audit-logs a before/after diff of the fields that actually changed (M4).
 */
router.put('/:id', requirePermission('vendor.write'), catchAsync(async (req, res) => {
  const { id } = req.params;
  const v = req.body || {};

  const mappings = {
    name: 'VENDOR_NAME',
    contactPerson: 'CONTACT_PERSON',
    contactEmail: 'CONTACT_EMAIL',
    contactPhone: 'CONTACT_PHONE',
    category: 'CATEGORY',
    status: 'STATUS',
    rating: 'RATING',
    paymentTerms: 'PAYMENT_TERMS',
    leadTimeDays: 'LEAD_TIME_DAYS',
    address: 'ADDRESS',
    notes: 'NOTES'
  };

  // Load current row so we can diff (best-effort — skip audit if vendor is missing)
  const beforeRes = await execute('SELECT * FROM QA_VENDORS WHERE VENDOR_ID = :id', { id });
  const before = beforeRes.rows && beforeRes.rows[0] ? rowToVendor(beforeRes.rows[0]) : null;

  const updates = [];
  const binds = { id };

  for (const [key, dbCol] of Object.entries(mappings)) {
    if (v[key] !== undefined) {
      updates.push(`${dbCol} = :${key}`);
      binds[key] = v[key];
    }
  }

  if (updates.length > 0) {
    updates.push('UPDATED_AT = SYSTIMESTAMP');
    updates.push('UPDATED_BY = :ub');
    binds.ub = req.user.email;
    const sql = `UPDATE QA_VENDORS SET ${updates.join(', ')} WHERE VENDOR_ID = :id`;
    await execute(sql, binds);

    // Build a compact before/after diff of fields that actually changed
    if (before) {
      const diff = {};
      for (const key of Object.keys(mappings)) {
        if (v[key] === undefined) continue;
        const oldVal = before[key];
        const newVal = v[key];
        if (String(oldVal ?? '') !== String(newVal ?? '')) {
          diff[key] = { before: oldVal ?? null, after: newVal ?? null };
        }
      }
      if (Object.keys(diff).length > 0) {
        try {
          await execute(`
            INSERT INTO QA_AUDIT_LOGS
              (USER_ID, ACTION, DETAILS, CATEGORY, EXTRA_DATA, ENTITY_TYPE, ENTITY_ID, SEVERITY, OUTCOME)
            VALUES
              (:u_id, :act, :det, :cat, :ext, :etype, :eid, 'info', 'success')
          `, {
            u_id: req.user.email,
            act: 'Vendor Updated',
            det: `Updated ${Object.keys(diff).length} field(s) on vendor ${before.name || id}`,
            cat: 'vendor',
            ext: JSON.stringify({ diff }).substring(0, 3900),
            etype: 'VENDOR',
            eid: id
          });
        } catch (auditErr) {
          // Audit failure must never block the mutation
          console.error('[vendors] audit-log failed:', auditErr.message);
        }
      }
    }

    emitToAll('vendors:updated');
  }

  res.json({ success: true });
}));

/**
 * DELETE /api/vendors/:id
 * Soft delete — mark as inactive. Only controller/admin.
 */
router.delete('/:id', requirePermission('vendor.deactivate'), catchAsync(async (req, res) => {
  const { id } = req.params;
  await execute(
    `UPDATE QA_VENDORS SET STATUS = 'inactive', UPDATED_AT = SYSTIMESTAMP, UPDATED_BY = :ub WHERE VENDOR_ID = :id`,
    { id, ub: req.user.email }
  );
  emitToAll('vendors:updated');
  res.json({ success: true });
}));

module.exports = router;
