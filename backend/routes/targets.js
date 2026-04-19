'use strict';

const express = require('express');
const { execute } = require('../db');
const { catchAsync } = require('../middleware/errorHandler');
const { authMiddleware } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(authMiddleware);

/**
 * GET /api/targets/:year
 */
router.get('/:year', catchAsync(async (req, res) => {
  const { year } = req.params;
  const result = await execute('SELECT * FROM QA_REVENUE_TARGETS WHERE TARGET_YEAR = :yr', { yr: year });

  if (!result.rows || result.rows.length === 0) {
    return res.status(404).json({ success: false, error: 'Targets not found for this year' });
  }

  const monthlyTargets = {};
  let annualTarget = 0;
  let updatedAt = result.rows[0].UPDATED_AT;

  for (const row of result.rows) {
    monthlyTargets[row.TARGET_MONTH] = row.TARGET_AMOUNT;
    if (row.ANNUAL_TARGET) annualTarget = row.ANNUAL_TARGET;
    if (row.UPDATED_AT > updatedAt) updatedAt = row.UPDATED_AT;
  }

  res.json({
    success: true,
    data: {
      monthlyTargets,
      annualTarget,
      updatedAt
    }
  });
}));

/**
 * POST /api/targets/:year
 * Upserts targets for the entire year
 */
router.post('/:year', catchAsync(async (req, res) => {
  const { year } = req.params;
  const { monthlyTargets, annualTarget } = req.body;

  if (!monthlyTargets || typeof monthlyTargets !== 'object') {
    return res.status(400).json({ success: false, error: 'monthlyTargets object is required' });
  }

  // Iterate over 12 months and upsert each
  for (const [monthKey, amount] of Object.entries(monthlyTargets)) {
    const amtNum = parseFloat(amount) || 0;
    
    await execute(`
      MERGE INTO QA_REVENUE_TARGETS dest
      USING (SELECT :yr AS y, :mo AS m, :amt AS a, :ann AS an FROM DUAL) src
      ON (dest.TARGET_YEAR = src.y AND dest.TARGET_MONTH = src.m)
      WHEN MATCHED THEN
        UPDATE SET TARGET_AMOUNT = src.a, ANNUAL_TARGET = src.an, UPDATED_AT = SYSTIMESTAMP
      WHEN NOT MATCHED THEN
        INSERT (TARGET_YEAR, TARGET_MONTH, TARGET_AMOUNT, ANNUAL_TARGET)
        VALUES (src.y, src.m, src.a, src.an)
    `, {
      yr: year, mo: monthKey, amt: amtNum, ann: annualTarget || 0
    });
  }

  res.json({ success: true, message: 'Targets saved' });
}));

module.exports = router;
