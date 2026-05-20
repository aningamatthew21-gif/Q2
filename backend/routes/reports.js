'use strict';

const express = require('express');
const { execute } = require('../db');
const { catchAsync } = require('../middleware/errorHandler');
const { authMiddleware } = require('../middleware/authMiddleware');
const { can } = require('../../shared/permissions');
const fs = require('fs');
const path = require('path');

const router = express.Router();
router.use(authMiddleware);

// Ensure reports directory exists
const reportsDir = path.join(__dirname, '..', 'reports');
if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}

/**
 * GET /api/reports/download/:filename
 * Securely download generated report CSV files
 */
router.get('/download/:filename', catchAsync(async (req, res) => {
  const { filename } = req.params;
  
  // Prevent directory traversal
  if (filename.includes('/') || filename.includes('..')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  
  const filePath = path.join(reportsDir, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Report not found' });
  }

  res.download(filePath);
}));

/**
 * POST /api/reports/generate/:type
 * Generate an ad-hoc report on the backend and return the URL
 * type can be 'invoices', 'customers', or 'inventory'
 */
router.post('/generate/:type', catchAsync(async (req, res) => {
  const { type } = req.params;

  // Per-type permission: each report type carries data that maps to a
  // different department. Sales reports → sales tier; finance/customer
  // reports → finance tier; inventory → procurement OR finance.
  const role = req.user.role;
  const allowed = {
    invoices:  can(role, 'reports.run.sales') || can(role, 'reports.run.finance'),
    customers: can(role, 'reports.run.sales') || can(role, 'reports.run.finance'),
    inventory: can(role, 'reports.run.procurement') || can(role, 'reports.run.finance')
  };
  if (allowed[type] === false) {
    return res.status(403).json({ success: false, error: `You don't have permission to run the ${type} report.` });
  }

  let result;
  // Dynamic CSV headers and query logic
  if (type === 'invoices') {
    result = await execute('SELECT INVOICE_ID, CUSTOMER_NAME, INVOICE_DATE, TOTAL, STATUS FROM QA_INVOICES ORDER BY CREATED_AT DESC');
  } else if (type === 'customers') {
    result = await execute('SELECT CUSTOMER_ID, CUSTOMER_NAME, CONTACT_EMAIL, REGION FROM QA_CUSTOMERS');
  } else if (type === 'inventory') {
    result = await execute('SELECT SKU, ITEM_NAME, STOCK, PRICE FROM QA_INVENTORY');
  } else {
    return res.status(400).json({ error: 'Unknown report type' });
  }

  const rows = result.rows || [];
  if (rows.length === 0) {
    return res.status(404).json({ error: 'No data found for report' });
  }

  // Create a minimal CSV string
  const headers = Object.keys(rows[0]).join(',');
  const csvLines = rows.map(row => 
    Object.values(row)
      .map(val => `"${val !== null ? String(val).replace(/"/g, '""') : ''}"`)
      .join(',')
  );
  
  const csvContent = [headers, ...csvLines].join('\n');
  const filename = `${type}_report_${Date.now()}.csv`;
  const filePath = path.join(reportsDir, filename);

  fs.writeFileSync(filePath, csvContent);

  res.json({ success: true, url: `/api/reports/download/${filename}` });
}));

module.exports = router;
