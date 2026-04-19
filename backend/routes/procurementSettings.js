'use strict';

const express = require('express');
const { execute } = require('../db');
const { catchAsync } = require('../middleware/errorHandler');
const { authMiddleware, requireRole } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(authMiddleware);

/**
 * GET /api/procurement-settings
 * Returns all key/value pairs from QA_PROCUREMENT_SETTINGS.
 * Restricted to procurement/controller/admin so sales users can't see
 * approval thresholds and game RFQ structure.
 */
router.get('/', requireRole('procurement', 'controller', 'admin'), catchAsync(async (req, res) => {
  const result = await execute('SELECT SETTING_KEY, SETTING_VAL FROM QA_PROCUREMENT_SETTINGS ORDER BY SETTING_KEY');
  const settings = {};
  for (const row of (result.rows || [])) {
    settings[row.SETTING_KEY] = {
      value: row.SETTING_VAL
    };
  }
  res.json({ success: true, data: settings });
}));

/**
 * PUT /api/procurement-settings
 * Body: { key: value, ... }  e.g. { highValueThreshold: '50000', minVendorsPerRFQ: '3' }
 * Only controller/admin may edit.
 */
router.put('/', requireRole('controller', 'admin'), catchAsync(async (req, res) => {
  const updates = req.body || {};
  for (const [key, value] of Object.entries(updates)) {
    await execute(
      `UPDATE QA_PROCUREMENT_SETTINGS SET SETTING_VAL = :val, UPDATED_AT = SYSTIMESTAMP WHERE SETTING_KEY = :key`,
      { val: String(value), key }
    );
  }
  res.json({ success: true });
}));

module.exports = router;
