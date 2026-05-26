'use strict';

/**
 * routes/reasons.js — Module 4
 *
 * CRUD + listing for QA_REASON_CODES, the controlled vocabulary that
 * drives the reject/win modals on quotes and invoices. Categories:
 *   - QUOTE_REJECTION
 *   - INVOICE_REJECTION
 *   - LOST_DEAL
 *   - WON_DEAL
 *   - (PR_CANCELLATION / RFQ_CANCELLATION reserved for future use)
 *
 * Endpoints:
 *   GET  /api/reasons               → all active codes
 *   GET  /api/reasons?category=X    → active codes for one category
 *   POST /api/reasons               → admin: create a new code
 *   PUT  /api/reasons/:code         → admin: update label / sort / active
 *
 * Permissions:
 *   Read   — any authenticated user (the modals on the frontend need it).
 *   Write  — admin only. We reuse the existing `system.config.edit` action
 *            from the catalogue rather than introducing a new permission.
 *
 *   This file deliberately doesn't add new keys to shared/permissions.js
 *   so the locked role-based-edits scope stays untouched. If `system.
 *   config.edit` doesn't exist in your build, fall through to
 *   requireRole('admin') below.
 */

const express = require('express');
const { execute } = require('../db');
const { catchAsync } = require('../middleware/errorHandler');
const { authMiddleware, requireRole } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(authMiddleware);

/**
 * GET /api/reasons
 * Optional query: category (one of the seeded categories).
 * Returns active codes ordered by SORT_ORDER then LABEL.
 */
router.get('/', catchAsync(async (req, res) => {
  const { category } = req.query;
  const binds = {};
  let where = `WHERE IS_ACTIVE = 'Y'`;
  if (category) {
    where += ` AND CATEGORY = :cat`;
    binds.cat = String(category).toUpperCase();
  }
  const r = await execute(
    `SELECT CODE, CATEGORY, LABEL, IS_ACTIVE, SORT_ORDER
       FROM QA_REASON_CODES
      ${where}
      ORDER BY SORT_ORDER, LABEL`,
    binds
  );
  res.json({
    success: true,
    data: (r.rows || []).map(row => ({
      code:      row.CODE,
      category:  row.CATEGORY,
      label:     row.LABEL,
      isActive:  row.IS_ACTIVE === 'Y',
      sortOrder: Number(row.SORT_ORDER || 100)
    }))
  });
}));

/**
 * POST /api/reasons
 * Admin-only. Body: { code, category, label, sortOrder? }
 */
router.post('/', requireRole('admin'), catchAsync(async (req, res) => {
  const { code, category, label, sortOrder } = req.body || {};
  if (!code || !category || !label) {
    return res.status(400).json({ success: false, error: 'code, category, and label are required' });
  }
  const cleanCode = String(code).toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 40);
  await execute(
    `INSERT INTO QA_REASON_CODES (CODE, CATEGORY, LABEL, IS_ACTIVE, SORT_ORDER)
     VALUES (:code, :cat, :lbl, 'Y', :so)`,
    {
      code: cleanCode,
      cat:  String(category).toUpperCase().slice(0, 30),
      lbl:  String(label).slice(0, 100),
      so:   Number(sortOrder) || 100
    }
  );
  res.json({ success: true, data: { code: cleanCode } });
}));

/**
 * PUT /api/reasons/:code
 * Admin-only. Body: { label?, sortOrder?, isActive? }
 * CODE is immutable (it's the FK target for invoices/quotes).
 */
router.put('/:code', requireRole('admin'), catchAsync(async (req, res) => {
  const { code } = req.params;
  const { label, sortOrder, isActive } = req.body || {};
  const sets = [];
  const binds = { code };
  if (label !== undefined)     { sets.push('LABEL = :lbl');      binds.lbl = String(label).slice(0, 100); }
  if (sortOrder !== undefined) { sets.push('SORT_ORDER = :so');  binds.so  = Number(sortOrder) || 100; }
  if (isActive !== undefined)  { sets.push("IS_ACTIVE = :act");  binds.act = isActive ? 'Y' : 'N'; }
  if (sets.length === 0) {
    return res.status(400).json({ success: false, error: 'No updatable fields supplied.' });
  }
  sets.push('UPDATED_AT = SYSTIMESTAMP');
  await execute(
    `UPDATE QA_REASON_CODES SET ${sets.join(', ')} WHERE CODE = :code`,
    binds
  );
  res.json({ success: true });
}));

module.exports = router;
