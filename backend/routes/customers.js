'use strict';

const express = require('express');
const { execute, transaction } = require('../db');
const { catchAsync } = require('../middleware/errorHandler');
const { authMiddleware, requirePermission } = require('../middleware/authMiddleware');
const { emitToAll } = require('../utils/socketEmitter');

const router = express.Router();

// All customer routes require authentication
router.use(authMiddleware);

/**
 * GET /api/customers
 * Fetch all customers
 */
router.get('/', catchAsync(async (req, res) => {
  const result = await execute('SELECT * FROM QA_CUSTOMERS ORDER BY CUSTOMER_NAME ASC');

  // Convert Oracle keys to camelCase for the frontend (matching Firebase structure)
  const customers = (result.rows || []).map(row => ({
    id: row.CUSTOMER_ID,
    name: row.CUSTOMER_NAME,
    contactPerson: row.CONTACT_PERSON || '',
    contactEmail: row.CONTACT_EMAIL || '',
    location: row.LOCATION || '',
    poBox: row.PO_BOX || '',
    region: row.REGION || '',
    address: row.ADDRESS || '',
    notes: row.NOTES || '',
    customerSince: row.CUSTOMER_SINCE || '',
    // Module 1 — master-data fields. All optional; default to safe values
    // when NULL so frontends don't crash on the legacy rows that pre-date
    // the migration.
    tin:                  row.TIN || '',
    defaultPaymentTerms:  row.DEFAULT_PAYMENT_TERMS || 'Net 30',
    creditLimit:          Number(row.CREDIT_LIMIT || 0),
    creditHold:           row.CREDIT_HOLD === 'Y',
    industry:             row.INDUSTRY || '',
    sizeBand:             row.SIZE_BAND || '',
    whtProfileCode:       row.WHT_PROFILE_CODE || ''
  }));

  res.json({ success: true, data: customers });
}));

/**
 * GET /api/customers/:id
 * Fetch single customer
 */
router.get('/:id', catchAsync(async (req, res) => {
  const { id } = req.params;

  // SCOPE — a `customer` role can only fetch their OWN record. Internal
  // staff (anyone with `customer.read`) can fetch any. Without this, a
  // customer JWT could enumerate every customer in the system by id.
  // Customer.uid is mirrored from their email per the auth flow.
  if (req.user.role === 'customer') {
    const me = String(req.user.email || '').toLowerCase();
    if (String(id).toLowerCase() !== me && String(req.user.uid || '').toLowerCase() !== String(id).toLowerCase()) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }
  }

  const result = await execute('SELECT * FROM QA_CUSTOMERS WHERE CUSTOMER_ID = :id', { id });

  if (!result.rows || result.rows.length === 0) {
    return res.status(404).json({ success: false, error: 'Customer not found' });
  }

  const row = result.rows[0];
  res.json({
    success: true,
    data: {
      id: row.CUSTOMER_ID,
      name: row.CUSTOMER_NAME,
      contactPerson: row.CONTACT_PERSON || '',
      contactEmail: row.CONTACT_EMAIL || '',
      location: row.LOCATION || '',
      poBox: row.PO_BOX || '',
      region: row.REGION || '',
      address: row.ADDRESS || '',
      notes: row.NOTES || '',
      customerSince: row.CUSTOMER_SINCE || ''
    }
  });
}));

/**
 * POST /api/customers
 * Create a new customer
 */
router.post('/', requirePermission('customer.write'), catchAsync(async (req, res) => {
  const cust = req.body;
  if (!cust.id || !cust.name) {
    return res.status(400).json({ success: false, error: 'id and name are required' });
  }

  await execute(`
    INSERT INTO QA_CUSTOMERS (
      CUSTOMER_ID, CUSTOMER_NAME, CONTACT_PERSON, CONTACT_EMAIL,
      LOCATION, PO_BOX, REGION, ADDRESS, NOTES, CUSTOMER_SINCE,
      TIN, DEFAULT_PAYMENT_TERMS, CREDIT_LIMIT, CREDIT_HOLD,
      INDUSTRY, SIZE_BAND, WHT_PROFILE_CODE
    ) VALUES (
      :id, :name, :cp, :ce, :loc, :po, :reg, :addr, :notes, :sinc,
      :tin, :dpt, :clim, :chold, :ind, :sb, :wpc
    )
  `, {
    id: cust.id,
    name: cust.name,
    cp: cust.contactPerson || null,
    ce: cust.contactEmail || null,
    loc: cust.location || null,
    po: cust.poBox || null,
    reg: cust.region || null,
    addr: cust.address || null,
    notes: cust.notes || null,
    sinc: cust.customerSince || null,
    // Module 1 master-data inputs. All optional — defaults match the
    // schema defaults (Net 30, 0 credit, no hold) when the frontend
    // doesn't send them yet (back-compat for older UIs).
    tin:   cust.tin || null,
    dpt:   cust.defaultPaymentTerms || 'Net 30',
    clim:  Number(cust.creditLimit) || 0,
    chold: cust.creditHold ? 'Y' : 'N',
    ind:   cust.industry || null,
    sb:    cust.sizeBand || null,
    wpc:   cust.whtProfileCode || null
  });

  // Emit WebSocket event so clients auto-update
  emitToAll('customers:updated');

  res.json({ success: true, data: cust });
}));

/**
 * POST /api/customers/bulk
 *
 * Bulk upsert for CSV imports. MERGEs every row inside a SINGLE
 * transaction on ONE pooled connection, then emits `customers:updated`
 * exactly ONCE for the whole batch.
 *
 * Replaces the old client-side pattern of one POST per row — for a
 * 1000-line import that was 1000 HTTP round-trips AND 1000 socket
 * broadcasts, each making every client refetch the whole customer list.
 */
router.post('/bulk', requirePermission('customer.write'), catchAsync(async (req, res) => {
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

  // Module 1 fields included in both UPDATE and INSERT branches so CSV
  // imports can populate or refresh the new master-data columns alongside
  // the original fields.
  const MERGE_SQL = `
    MERGE INTO QA_CUSTOMERS t
    USING (SELECT :id AS CUSTOMER_ID FROM DUAL) s
    ON (t.CUSTOMER_ID = s.CUSTOMER_ID)
    WHEN MATCHED THEN UPDATE SET
      CUSTOMER_NAME = :name, CONTACT_PERSON = :cp, CONTACT_EMAIL = :ce,
      LOCATION = :loc, PO_BOX = :po, REGION = :reg, ADDRESS = :addr,
      NOTES = :notes, CUSTOMER_SINCE = :sinc,
      TIN = :tin, DEFAULT_PAYMENT_TERMS = :dpt, CREDIT_LIMIT = :clim,
      CREDIT_HOLD = :chold, INDUSTRY = :ind, SIZE_BAND = :sb,
      WHT_PROFILE_CODE = :wpc, UPDATED_AT = SYSTIMESTAMP
    WHEN NOT MATCHED THEN INSERT (
      CUSTOMER_ID, CUSTOMER_NAME, CONTACT_PERSON, CONTACT_EMAIL,
      LOCATION, PO_BOX, REGION, ADDRESS, NOTES, CUSTOMER_SINCE,
      TIN, DEFAULT_PAYMENT_TERMS, CREDIT_LIMIT, CREDIT_HOLD,
      INDUSTRY, SIZE_BAND, WHT_PROFILE_CODE
    ) VALUES (
      :id, :name, :cp, :ce, :loc, :po, :reg, :addr, :notes, :sinc,
      :tin, :dpt, :clim, :chold, :ind, :sb, :wpc
    )
  `;

  let processed = 0;
  const errors = [];

  await transaction(async (conn) => {
    for (let i = 0; i < items.length; i++) {
      const c = items[i];
      if (!c || !c.id || !c.name) {
        errors.push({ index: i, error: 'missing id or name' });
        continue;
      }
      try {
        await conn.execute(MERGE_SQL, {
          id:    String(c.id),
          name:  c.name,
          cp:    c.contactPerson || null,
          ce:    c.contactEmail || null,
          loc:   c.location || null,
          po:    c.poBox || null,
          reg:   c.region || null,
          addr:  c.address || null,
          notes: c.notes || null,
          sinc:  c.customerSince || null,
          tin:   c.tin || null,
          dpt:   c.defaultPaymentTerms || 'Net 30',
          clim:  Number(c.creditLimit) || 0,
          chold: c.creditHold ? 'Y' : 'N',
          ind:   c.industry || null,
          sb:    c.sizeBand || null,
          wpc:   c.whtProfileCode || null
        }, { autoCommit: false });
        processed++;
      } catch (err) {
        errors.push({ index: i, id: c.id, error: err.message });
      }
    }
  });

  // ONE broadcast for the whole batch — not one per row.
  emitToAll('customers:updated');

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
 * PUT /api/customers/:id
 * Update an existing customer (merge patch)
 */
router.put('/:id', requirePermission('customer.write'), catchAsync(async (req, res) => {
  const { id } = req.params;
  const cust = req.body;

  // Build dynamic update query
  const updates = [];
  const binds = { id };

  const mappings = {
    name: 'CUSTOMER_NAME',
    contactPerson: 'CONTACT_PERSON',
    contactEmail: 'CONTACT_EMAIL',
    location: 'LOCATION',
    poBox: 'PO_BOX',
    region: 'REGION',
    address: 'ADDRESS',
    notes: 'NOTES',
    customerSince: 'CUSTOMER_SINCE',
    // Module 1 master-data fields
    tin: 'TIN',
    defaultPaymentTerms: 'DEFAULT_PAYMENT_TERMS',
    creditLimit: 'CREDIT_LIMIT',
    industry: 'INDUSTRY',
    sizeBand: 'SIZE_BAND',
    whtProfileCode: 'WHT_PROFILE_CODE'
  };

  for (const [key, dbCol] of Object.entries(mappings)) {
    if (cust[key] !== undefined) {
      updates.push(`${dbCol} = :${key}`);
      binds[key] = cust[key];
    }
  }

  // CREDIT_HOLD is a Y/N CHAR — boolean from the frontend needs translating
  // here rather than relying on the generic mappings loop above.
  if (cust.creditHold !== undefined) {
    updates.push('CREDIT_HOLD = :creditHold');
    binds.creditHold = cust.creditHold ? 'Y' : 'N';
  }

  if (updates.length > 0) {
    updates.push('UPDATED_AT = SYSTIMESTAMP');
    const sql = `UPDATE QA_CUSTOMERS SET ${updates.join(', ')} WHERE CUSTOMER_ID = :id`;
    await execute(sql, binds);
    emitToAll('customers:updated');
  }

  res.json({ success: true });
}));

/**
 * DELETE /api/customers/:id
 * Delete a customer
 */
router.delete('/:id', requirePermission('customer.write'), catchAsync(async (req, res) => {
  const { id } = req.params;

  // Enforce referential integrity checks here if needed,
  // or let Oracle throw a foreign key violation (handled by errorHandler)
  await execute('DELETE FROM QA_CUSTOMERS WHERE CUSTOMER_ID = :id', { id });
  
  emitToAll('customers:updated');
  res.json({ success: true });
}));

module.exports = router;
