'use strict';

/**
 * /api/wht — withholding-tax configuration CRUD.
 *
 * Two related resources under one router:
 *   /api/wht/types      — the catalogue (VAT_WHT, SERVICE_WHT, etc.)
 *   /api/wht/profiles   — customer classifications that bundle codes
 *
 * Reads gated by `customer.statement.read` (anyone running collections needs
 * to know what WHTs exist). Writes gated by `wht.config.edit` (admin only —
 * changing a WHT rate cascades to every future prediction so it's deliberately
 * locked down).
 *
 * Module 2 of the Reports Foundation build-out.
 */

const express = require('express');
const { execute } = require('../db');
const { catchAsync } = require('../middleware/errorHandler');
const { authMiddleware, requirePermission } = require('../middleware/authMiddleware');
const { emitToAll } = require('../utils/socketEmitter');

const router = express.Router();
router.use(authMiddleware);

// ── TYPES ────────────────────────────────────────────────────────────────

const rowToType = (row) => ({
  code:      row.WHT_CODE,
  name:      row.WHT_NAME,
  rate:      Number(row.WHT_RATE),
  appliesTo: row.APPLIES_TO || 'subtotal',
  isActive:  row.IS_ACTIVE === 'Y',
  sortOrder: Number(row.SORT_ORDER || 0)
});

router.get('/types', requirePermission('customer.statement.read'), catchAsync(async (req, res) => {
  const r = await execute(
    `SELECT * FROM QA_WHT_TYPES ORDER BY SORT_ORDER ASC, WHT_CODE ASC`
  );
  res.json({ success: true, data: (r.rows || []).map(rowToType) });
}));

router.post('/types', requirePermission('wht.config.edit'), catchAsync(async (req, res) => {
  const t = req.body || {};
  if (!t.code || !t.name || t.rate === undefined) {
    return res.status(400).json({ success: false, error: 'code, name, and rate are required.' });
  }
  // Bind name `:active` (not `:is`) — `IS` is a reserved SQL keyword and
  // oracledb 6.x has been observed to mis-parse the placeholder when it
  // sits immediately after `IS_ACTIVE = `, yielding a confusing ORA error.
  // Renaming the bind sidesteps the ambiguity entirely.
  await execute(
    `INSERT INTO QA_WHT_TYPES (WHT_CODE, WHT_NAME, WHT_RATE, APPLIES_TO, IS_ACTIVE, SORT_ORDER)
     VALUES (:c, :n, :r, :a, :active, :s)`,
    {
      c:      String(t.code).toUpperCase(),
      n:      t.name,
      r:      Number(t.rate),
      a:      t.appliesTo === 'gross' ? 'gross' : 'subtotal',
      active: t.isActive === false ? 'N' : 'Y',
      s:      Number(t.sortOrder) || 0
    }
  );
  emitToAll('wht:types:updated');
  res.json({ success: true });
}));

router.put('/types/:code', requirePermission('wht.config.edit'), catchAsync(async (req, res) => {
  const { code } = req.params;
  const t = req.body || {};
  const sets = [];
  // `:active` (not `:is`) — keyword-collision fix; see POST handler above.
  // Bind name `:wcode` (not `:code`) for the WHERE clause to avoid any
  // ambiguity with the URL param. Defensive against potential param-name
  // shadowing in oracledb's bind parser.
  const binds = { wcode: code.toUpperCase() };
  if (t.name      !== undefined) { sets.push('WHT_NAME = :n');     binds.n      = t.name; }
  if (t.rate      !== undefined) { sets.push('WHT_RATE = :r');     binds.r      = Number(t.rate); }
  if (t.appliesTo !== undefined) { sets.push('APPLIES_TO = :a');   binds.a      = t.appliesTo === 'gross' ? 'gross' : 'subtotal'; }
  if (t.isActive  !== undefined) { sets.push('IS_ACTIVE = :active'); binds.active = t.isActive ? 'Y' : 'N'; }
  if (t.sortOrder !== undefined) { sets.push('SORT_ORDER = :s');   binds.s      = Number(t.sortOrder) || 0; }
  if (sets.length === 0) return res.json({ success: true });
  await execute(
    `UPDATE QA_WHT_TYPES SET ${sets.join(', ')} WHERE WHT_CODE = :wcode`,
    binds
  );
  emitToAll('wht:types:updated');
  res.json({ success: true });
}));

/**
 * DELETE /api/wht/types/:code
 *
 * Hard-deletes a WHT type from the catalogue. If any past payment has
 * referenced this code (checked via JSON pattern match against
 * QA_INVOICE_PAYMENTS.WHT_BREAKDOWN CLOB) the delete is rejected with
 * 409 + machine-readable code `WHT_IN_USE` — the frontend offers a
 * soft-delete (deactivate via PUT isActive=false) as the next step.
 *
 * Referential check is intentionally string-match on the JSON column
 * rather than a foreign-key constraint because the breakdown is stored
 * as JSON inside a CLOB (no per-line FK relationship). The check is
 * conservative — a match in any payment row blocks the hard delete.
 */
router.delete('/types/:code', requirePermission('wht.config.edit'), catchAsync(async (req, res) => {
  const code = String(req.params.code || '').toUpperCase();

  // Referential check: anything in any payment's WHT_BREAKDOWN?
  // CLOB-safe pattern match — looking for "code":"VAT_WHT" inside the JSON.
  const refRes = await execute(
    `SELECT COUNT(*) AS C
       FROM QA_INVOICE_PAYMENTS
      WHERE DBMS_LOB.INSTR(WHT_BREAKDOWN, :needle) > 0`,
    { needle: `"code":"${code}"` },
    { outFormat: 4002 /* OUT_FORMAT_OBJECT */ }
  );
  const refCount = Number(refRes.rows?.[0]?.C || 0);

  if (refCount > 0) {
    return res.status(409).json({
      success: false,
      code:    'WHT_IN_USE',
      error:   `Cannot delete: "${code}" is referenced by ${refCount} past payment record(s).`
    });
  }

  await execute(`DELETE FROM QA_WHT_TYPES WHERE WHT_CODE = :c`, { c: code });
  emitToAll('wht:types:updated');
  res.json({ success: true });
}));

// ── PROFILES ─────────────────────────────────────────────────────────────

const rowToProfile = (row) => ({
  code:      row.PROFILE_CODE,
  name:      row.PROFILE_NAME,
  whtCodes:  row.WHT_CODES ? String(row.WHT_CODES).split(',').map(s => s.trim()).filter(Boolean) : [],
  isDefault: row.IS_DEFAULT === 'Y'
});

router.get('/profiles', requirePermission('customer.statement.read'), catchAsync(async (req, res) => {
  const r = await execute(
    `SELECT * FROM QA_WHT_PROFILES ORDER BY PROFILE_CODE ASC`
  );
  res.json({ success: true, data: (r.rows || []).map(rowToProfile) });
}));

router.post('/profiles', requirePermission('wht.config.edit'), catchAsync(async (req, res) => {
  const p = req.body || {};
  if (!p.code || !p.name) {
    return res.status(400).json({ success: false, error: 'code and name are required.' });
  }
  const codes = Array.isArray(p.whtCodes) ? p.whtCodes.join(',') : (p.whtCodes || '');
  await execute(
    `INSERT INTO QA_WHT_PROFILES (PROFILE_CODE, PROFILE_NAME, WHT_CODES, IS_DEFAULT)
     VALUES (:c, :n, :w, :d)`,
    {
      c: String(p.code).toUpperCase(),
      n: p.name,
      w: codes,
      d: p.isDefault ? 'Y' : 'N'
    }
  );
  emitToAll('wht:profiles:updated');
  res.json({ success: true });
}));

router.put('/profiles/:code', requirePermission('wht.config.edit'), catchAsync(async (req, res) => {
  const { code } = req.params;
  const p = req.body || {};
  const sets = [];
  const binds = { code: code.toUpperCase() };
  if (p.name      !== undefined) { sets.push('PROFILE_NAME = :n'); binds.n = p.name; }
  if (p.whtCodes  !== undefined) {
    const codes = Array.isArray(p.whtCodes) ? p.whtCodes.join(',') : (p.whtCodes || '');
    sets.push('WHT_CODES = :w');
    binds.w = codes;
  }
  if (p.isDefault !== undefined) { sets.push('IS_DEFAULT = :d'); binds.d = p.isDefault ? 'Y' : 'N'; }
  if (sets.length === 0) return res.json({ success: true });
  await execute(
    `UPDATE QA_WHT_PROFILES SET ${sets.join(', ')} WHERE PROFILE_CODE = :code`,
    binds
  );
  emitToAll('wht:profiles:updated');
  res.json({ success: true });
}));

module.exports = router;
