'use strict';

const express = require('express');
const { execute } = require('../db');
const { catchAsync } = require('../middleware/errorHandler');
const { authMiddleware } = require('../middleware/authMiddleware');
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
    customerSince: row.CUSTOMER_SINCE || ''
  }));

  res.json({ success: true, data: customers });
}));

/**
 * GET /api/customers/:id
 * Fetch single customer
 */
router.get('/:id', catchAsync(async (req, res) => {
  const { id } = req.params;
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
router.post('/', catchAsync(async (req, res) => {
  const cust = req.body;
  if (!cust.id || !cust.name) {
    return res.status(400).json({ success: false, error: 'id and name are required' });
  }

  await execute(`
    INSERT INTO QA_CUSTOMERS (
      CUSTOMER_ID, CUSTOMER_NAME, CONTACT_PERSON, CONTACT_EMAIL, 
      LOCATION, PO_BOX, REGION, ADDRESS, NOTES, CUSTOMER_SINCE
    ) VALUES (
      :id, :name, :cp, :ce, :loc, :po, :reg, :addr, :notes, :sinc
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
    sinc: cust.customerSince || null
  });

  // Emit WebSocket event so clients auto-update
  emitToAll('customers:updated');

  res.json({ success: true, data: cust });
}));

/**
 * PUT /api/customers/:id
 * Update an existing customer (merge patch)
 */
router.put('/:id', catchAsync(async (req, res) => {
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
    customerSince: 'CUSTOMER_SINCE'
  };

  for (const [key, dbCol] of Object.entries(mappings)) {
    if (cust[key] !== undefined) {
      updates.push(`${dbCol} = :${key}`);
      binds[key] = cust[key];
    }
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
router.delete('/:id', catchAsync(async (req, res) => {
  const { id } = req.params;
  
  // Enforce referential integrity checks here if needed, 
  // or let Oracle throw a foreign key violation (handled by errorHandler)
  await execute('DELETE FROM QA_CUSTOMERS WHERE CUSTOMER_ID = :id', { id });
  
  emitToAll('customers:updated');
  res.json({ success: true });
}));

module.exports = router;
