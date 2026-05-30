'use strict';

/**
 * routes/numberSequences.js — admin/finance-head config for the
 * standardized document numbering policy.
 *
 * Endpoints (all gated by system.number_sequences.edit):
 *   GET  /api/number-sequences           list all configured doc types
 *   GET  /api/number-sequences/:docType  read one + preview next number
 *   PUT  /api/number-sequences/:docType  edit prefix/padding/resetPeriod
 *
 * Deliberately NOT exposed:
 *   - DELETE — removing a sequence row would break number generation
 *     for in-flight transactions. Admin can update prefix but not delete.
 *   - "Set counter to N" — only the generator should mutate the counter,
 *     preventing duplicate-number accidents. If admin needs to reset,
 *     they edit RESET_PERIOD (which triggers the natural reset on the
 *     next mint) or contact DBA for an out-of-band SQL update.
 *
 * Standards anchor:
 *   - ISO/IEC 27001:2022 A.8.32 (Change Management) — config changes
 *     audited via the standard auditMiddleware (PUT mutations logged)
 *   - SAP "Number Range" admin pattern — read-mostly, edit-rarely, no
 *     direct counter mutation
 */

const express = require('express');
const { execute } = require('../db');
const { catchAsync } = require('../middleware/errorHandler');
const { authMiddleware, requirePermission } = require('../middleware/authMiddleware');
const { apiError } = require('../utils/apiError');
const { previewNextNumber } = require('../utils/numberGenerator');

const router = express.Router();
router.use(authMiddleware);
router.use(requirePermission('system.number_sequences.edit'));

// ── List ──────────────────────────────────────────────────────────────
router.get('/', catchAsync(async (req, res) => {
  const r = await execute(
    `SELECT DOC_TYPE, PREFIX, DOC_CODE, PADDING, RESET_PERIOD,
            CURRENT_COUNTER, CURRENT_PERIOD_KEY, UPDATED_AT, UPDATED_BY
       FROM QA_NUMBER_SEQUENCES
      ORDER BY DOC_TYPE`
  );
  // Enrich with a preview of the next number — useful UX for the table.
  const rows = r.rows || [];
  const enriched = await Promise.all(rows.map(async (row) => ({
    ...row,
    NEXT_PREVIEW: await previewNextNumber(row.DOC_TYPE)
  })));
  res.json({ success: true, data: enriched });
}));

// ── Detail ────────────────────────────────────────────────────────────
router.get('/:docType', catchAsync(async (req, res) => {
  const code = String(req.params.docType || '').toUpperCase().trim();
  const r = await execute(
    `SELECT DOC_TYPE, PREFIX, DOC_CODE, PADDING, RESET_PERIOD,
            CURRENT_COUNTER, CURRENT_PERIOD_KEY, UPDATED_AT, UPDATED_BY
       FROM QA_NUMBER_SEQUENCES
      WHERE DOC_TYPE = :docType`,
    { docType: code }
  );
  const row = (r.rows || [])[0];
  if (!row) return apiError.send(res, 'E_NOT_FOUND', `No number sequence configured for "${code}".`);
  row.NEXT_PREVIEW = await previewNextNumber(code);
  res.json({ success: true, data: row });
}));

// ── Update ────────────────────────────────────────────────────────────
router.put('/:docType', catchAsync(async (req, res) => {
  const code = String(req.params.docType || '').toUpperCase().trim();
  const { prefix, docCode, padding, resetPeriod } = req.body || {};

  // Validate inputs — the DB CHECK constraints would catch these but
  // returning specific error codes via apiError is cleaner UX than
  // a raw constraint violation.
  if (prefix !== undefined && !/^[A-Z0-9_]{1,20}$/.test(prefix)) {
    return apiError.send(res, 'E_VALIDATION',
      'Prefix must be 1-20 uppercase letters / digits / underscores (e.g. "MIDSA", "ACME_GH").',
      { field: 'prefix' });
  }
  if (docCode !== undefined && !/^[A-Z0-9_]{1,20}$/.test(docCode)) {
    return apiError.send(res, 'E_VALIDATION',
      'Doc code must be 1-20 uppercase letters / digits / underscores (e.g. "INV", "PR").',
      { field: 'docCode' });
  }
  if (padding !== undefined) {
    const n = Number(padding);
    if (!Number.isInteger(n) || n < 1 || n > 10) {
      return apiError.send(res, 'E_VALIDATION', 'Padding must be an integer 1-10.', { field: 'padding' });
    }
  }
  if (resetPeriod !== undefined && !['NEVER', 'YEARLY', 'MONTHLY'].includes(resetPeriod)) {
    return apiError.send(res, 'E_VALIDATION',
      'Reset period must be NEVER, YEARLY, or MONTHLY.',
      { field: 'resetPeriod' });
  }

  // Build dynamic UPDATE — only touch the columns the caller provided.
  const sets = [];
  const binds = { docType: code, by: req.user.email };
  if (prefix      !== undefined) { sets.push('PREFIX        = :prefix');      binds.prefix      = prefix; }
  if (docCode     !== undefined) { sets.push('DOC_CODE      = :docCode');     binds.docCode     = docCode; }
  if (padding     !== undefined) { sets.push('PADDING       = :padding');     binds.padding     = Number(padding); }
  if (resetPeriod !== undefined) { sets.push('RESET_PERIOD  = :resetPeriod'); binds.resetPeriod = resetPeriod; }
  if (sets.length === 0) {
    return apiError.send(res, 'E_VALIDATION', 'No fields to update.');
  }
  sets.push('UPDATED_AT = SYSTIMESTAMP');
  sets.push('UPDATED_BY = :by');

  const r = await execute(
    `UPDATE QA_NUMBER_SEQUENCES
        SET ${sets.join(', ')}
      WHERE DOC_TYPE = :docType`,
    binds
  );
  if (!r.rowsAffected) {
    return apiError.send(res, 'E_NOT_FOUND', `No number sequence configured for "${code}".`);
  }

  // Return the updated row + new preview so the UI can refresh
  const after = await execute(
    `SELECT DOC_TYPE, PREFIX, DOC_CODE, PADDING, RESET_PERIOD,
            CURRENT_COUNTER, CURRENT_PERIOD_KEY, UPDATED_AT, UPDATED_BY
       FROM QA_NUMBER_SEQUENCES
      WHERE DOC_TYPE = :docType`,
    { docType: code }
  );
  const row = after.rows[0];
  row.NEXT_PREVIEW = await previewNextNumber(code);
  res.json({ success: true, data: row });
}));

module.exports = router;
