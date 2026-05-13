'use strict';

/**
 * /api/users — admin-only user provisioning + role management.
 *
 * Replaces the previous "ssh in and run a SQL UPDATE" workflow. The
 * frontend UserManagement page calls these endpoints to:
 *
 *   GET    /api/users            — list every account
 *   POST   /api/users            — invite a new user
 *   PUT    /api/users/:email     — change role or status
 *   DELETE /api/users/:email     — deactivate (soft delete; preserves
 *                                  history + audit ties via FKs)
 *
 * All routes are gated by `user.manage` and additionally by SoD-style
 * invariants so an admin cannot lock themselves out:
 *
 *   - Cannot demote yourself OUT of admin if you're the last admin.
 *   - Cannot deactivate yourself.
 *   - Cannot delete yourself.
 *
 * Auditing: every mutation writes an entry to QA_AUDIT_LOGS via the
 * auto-audit middleware (state-changing /api/* routes are captured),
 * so the activity trail shows who promoted whom and when.
 */
const express = require('express');
const { execute } = require('../db');
const { catchAsync } = require('../middleware/errorHandler');
const { authMiddleware, requirePermission } = require('../middleware/authMiddleware');
const { ROLES, ALL_ROLES, ROLE_LABEL } = require('../../shared/permissions.js');

const router = express.Router();
router.use(authMiddleware);

const rowToUser = (row) => ({
  email:     row.USER_EMAIL,
  role:      row.USER_ROLE,
  roleLabel: ROLE_LABEL[row.USER_ROLE] || row.USER_ROLE,
  name:      row.USER_NAME,
  status:    row.USER_STATUS,
  createdAt: row.CREATED_AT
});

const isValidEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());

/** Count admins in the system — used to prevent the last-admin lockout. */
async function countAdmins() {
  const r = await execute(
    `SELECT COUNT(*) AS C FROM QA_USERS WHERE USER_ROLE = 'admin' AND USER_STATUS = 'active'`,
    {}, { outFormat: 4002 }
  );
  return Number(r.rows?.[0]?.C || 0);
}

// ── GET /api/users ───────────────────────────────────────────────────────
router.get('/', requirePermission('user.manage'), catchAsync(async (req, res) => {
  const result = await execute(
    `SELECT USER_EMAIL, USER_ROLE, USER_NAME, USER_STATUS, CREATED_AT
       FROM QA_USERS
       ORDER BY USER_STATUS DESC, USER_ROLE, USER_EMAIL`,
    {}, { outFormat: 4002 }
  );
  res.json({
    success: true,
    data: {
      users:    (result.rows || []).map(rowToUser),
      roles:    ALL_ROLES.map(r => ({ id: r, label: ROLE_LABEL[r] || r }))
    }
  });
}));

// ── POST /api/users ──────────────────────────────────────────────────────
router.post('/', requirePermission('user.manage'), catchAsync(async (req, res) => {
  const { email, role, name } = req.body || {};

  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, error: 'A valid email is required.' });
  }
  if (!ALL_ROLES.includes(role)) {
    return res.status(400).json({ success: false, error: `Unknown role: ${role}.` });
  }

  // Reject duplicates explicitly so the UI can show a clear message.
  const exists = await execute(
    `SELECT 1 FROM QA_USERS WHERE USER_EMAIL = :em`,
    { em: email.trim().toLowerCase() }
  );
  if (exists.rows?.length) {
    return res.status(409).json({ success: false, error: 'A user with that email already exists.' });
  }

  await execute(`
    INSERT INTO QA_USERS (USER_EMAIL, USER_ROLE, USER_NAME, USER_STATUS)
    VALUES (:em, :rl, :nm, 'active')
  `, {
    em: email.trim().toLowerCase(),
    rl: role,
    nm: (name || '').trim() || null
  });

  res.json({
    success: true,
    user: { email: email.trim().toLowerCase(), role, name: name || null, status: 'active' }
  });
}));

// ── PUT /api/users/:email ────────────────────────────────────────────────
router.put('/:email', requirePermission('user.manage'), catchAsync(async (req, res) => {
  const targetEmail = String(req.params.email || '').trim().toLowerCase();
  const { role, name, status } = req.body || {};

  if (!targetEmail) {
    return res.status(400).json({ success: false, error: 'User email is required.' });
  }

  // Verify the target exists so we return 404 rather than a silent no-op.
  const before = await execute(
    `SELECT USER_EMAIL, USER_ROLE, USER_STATUS FROM QA_USERS WHERE USER_EMAIL = :em`,
    { em: targetEmail }, { outFormat: 4002 }
  );
  const target = before.rows?.[0];
  if (!target) {
    return res.status(404).json({ success: false, error: 'User not found.' });
  }

  // ── Self-lockout invariants ─────────────────────────────
  const isSelf = req.user.email === targetEmail;
  if (isSelf && role && role !== 'admin' && target.USER_ROLE === 'admin') {
    const n = await countAdmins();
    if (n <= 1) {
      return res.status(409).json({
        success: false,
        error:   'You are the only active admin. Promote another user to admin before demoting yourself.'
      });
    }
  }
  if (isSelf && status === 'inactive') {
    return res.status(409).json({
      success: false,
      error:   "You cannot deactivate your own account."
    });
  }

  // ── Validate inputs ─────────────────────────────────────
  if (role !== undefined && !ALL_ROLES.includes(role)) {
    return res.status(400).json({ success: false, error: `Unknown role: ${role}.` });
  }
  if (status !== undefined && !['active', 'inactive'].includes(status)) {
    return res.status(400).json({ success: false, error: `Unknown status: ${status}.` });
  }

  const sets = [];
  const binds = { em: targetEmail };
  if (role   !== undefined) { sets.push('USER_ROLE = :rl');   binds.rl = role; }
  if (name   !== undefined) { sets.push('USER_NAME = :nm');   binds.nm = (name || '').trim() || null; }
  if (status !== undefined) { sets.push('USER_STATUS = :st'); binds.st = status; }
  if (sets.length === 0) {
    return res.status(400).json({ success: false, error: 'No changes provided.' });
  }

  await execute(
    `UPDATE QA_USERS SET ${sets.join(', ')} WHERE USER_EMAIL = :em`,
    binds
  );

  // Hand back the new state so the UI can refresh without an extra round-trip.
  const after = await execute(
    `SELECT USER_EMAIL, USER_ROLE, USER_NAME, USER_STATUS, CREATED_AT
       FROM QA_USERS WHERE USER_EMAIL = :em`,
    { em: targetEmail }, { outFormat: 4002 }
  );
  res.json({ success: true, user: rowToUser(after.rows[0]) });
}));

// ── DELETE /api/users/:email — soft deactivate ────────────────────────
router.delete('/:email', requirePermission('user.manage'), catchAsync(async (req, res) => {
  const targetEmail = String(req.params.email || '').trim().toLowerCase();
  if (req.user.email === targetEmail) {
    return res.status(409).json({ success: false, error: 'You cannot deactivate yourself.' });
  }

  const before = await execute(
    `SELECT USER_ROLE FROM QA_USERS WHERE USER_EMAIL = :em`,
    { em: targetEmail }, { outFormat: 4002 }
  );
  if (!before.rows?.[0]) {
    return res.status(404).json({ success: false, error: 'User not found.' });
  }
  if (before.rows[0].USER_ROLE === 'admin') {
    const n = await countAdmins();
    if (n <= 1) {
      return res.status(409).json({
        success: false,
        error:   'Cannot deactivate the last active admin.'
      });
    }
  }

  await execute(
    `UPDATE QA_USERS SET USER_STATUS = 'inactive' WHERE USER_EMAIL = :em`,
    { em: targetEmail }
  );
  res.json({ success: true });
}));

module.exports = router;
