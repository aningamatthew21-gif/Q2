'use strict';

/**
 * /api/notifications — the in-app notification centre API.
 *
 * Every row in QA_NOTIFICATIONS belongs to exactly one recipient, so
 * every query here is hard-scoped to `WHERE RECIPIENT = req.user.email`.
 * A user can only ever see / read / archive their OWN notifications —
 * there is no cross-user access path.
 *
 * Routes:
 *   GET   /                  list mine (filters: unread, category, includeArchived, limit, offset)
 *   GET   /unread-count      lightweight badge count
 *   PATCH /:id/read          mark one read
 *   PATCH /read-all          mark every unread one read
 *   PATCH /:id/archive       soft-delete one ("delete" in the UI)
 */

const express = require('express');
const { execute } = require('../db');
const { catchAsync } = require('../middleware/errorHandler');
const { authMiddleware } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(authMiddleware);

/** Map a QA_NOTIFICATIONS row to the camelCase shape the frontend expects. */
function mapRow(row) {
  let linkContext = null;
  if (row.LINK_CONTEXT) {
    try { linkContext = JSON.parse(row.LINK_CONTEXT); } catch (_) { linkContext = null; }
  }
  return {
    id:          row.NOTIF_ID,
    type:        row.TYPE,
    title:       row.TITLE,
    body:        row.BODY || null,
    severity:    row.SEVERITY || 'info',
    category:    row.CATEGORY || 'system',
    entityType:  row.ENTITY_TYPE || null,
    entityId:    row.ENTITY_ID || null,
    linkPage:    row.LINK_PAGE || null,
    linkContext,
    actor:       row.ACTOR || null,
    isRead:      row.IS_READ === 1 || row.IS_READ === true,
    isArchived:  row.IS_ARCHIVED === 1 || row.IS_ARCHIVED === true,
    createdAt:   row.CREATED_AT
  };
}

/**
 * GET /api/notifications
 * Query: unread=1, category=invoices, includeArchived=1, limit=30, offset=0
 */
router.get('/', catchAsync(async (req, res) => {
  const me = req.user.email;
  const { unread, category, includeArchived } = req.query;
  const limit  = Math.min(parseInt(req.query.limit, 10) || 30, 100);
  const offset = parseInt(req.query.offset, 10) || 0;

  let sql = 'SELECT * FROM QA_NOTIFICATIONS WHERE RECIPIENT = :me';
  const binds = { me };

  if (!includeArchived || includeArchived === '0') {
    sql += ' AND IS_ARCHIVED = 0';
  }
  if (unread === '1' || unread === 'true') {
    sql += ' AND IS_READ = 0';
  }
  if (category && category !== 'all') {
    sql += ' AND CATEGORY = :cat';
    binds.cat = category;
  }

  sql += ' ORDER BY CREATED_AT DESC OFFSET :off ROWS FETCH NEXT :lim ROWS ONLY';
  binds.off = offset;
  binds.lim = limit;

  const result = await execute(sql, binds);
  const data = (result.rows || []).map(mapRow);

  // Always return the live unread count alongside the page so the badge
  // and the list stay in sync from a single round-trip.
  const countRes = await execute(
    `SELECT COUNT(*) AS CNT FROM QA_NOTIFICATIONS
      WHERE RECIPIENT = :me AND IS_READ = 0 AND IS_ARCHIVED = 0`,
    { me }
  );
  const unreadCount = Number(countRes.rows?.[0]?.CNT || 0);

  res.json({ success: true, data, unreadCount });
}));

/**
 * GET /api/notifications/unread-count
 */
router.get('/unread-count', catchAsync(async (req, res) => {
  const result = await execute(
    `SELECT COUNT(*) AS CNT FROM QA_NOTIFICATIONS
      WHERE RECIPIENT = :me AND IS_READ = 0 AND IS_ARCHIVED = 0`,
    { me: req.user.email }
  );
  res.json({ success: true, count: Number(result.rows?.[0]?.CNT || 0) });
}));

/**
 * PATCH /api/notifications/read-all — mark every unread notification read.
 * Declared before /:id/read so "read-all" isn't captured as an :id.
 */
router.patch('/read-all', catchAsync(async (req, res) => {
  await execute(
    `UPDATE QA_NOTIFICATIONS
        SET IS_READ = 1, READ_AT = SYSTIMESTAMP
      WHERE RECIPIENT = :me AND IS_READ = 0 AND IS_ARCHIVED = 0`,
    { me: req.user.email }
  );
  res.json({ success: true });
}));

/**
 * PATCH /api/notifications/:id/read — mark one notification read.
 */
router.patch('/:id/read', catchAsync(async (req, res) => {
  const result = await execute(
    `UPDATE QA_NOTIFICATIONS
        SET IS_READ = 1, READ_AT = SYSTIMESTAMP
      WHERE NOTIF_ID = :id AND RECIPIENT = :me`,
    { id: req.params.id, me: req.user.email }
  );
  if (!result.rowsAffected) {
    return res.status(404).json({ success: false, error: 'Notification not found' });
  }
  res.json({ success: true });
}));

/**
 * PATCH /api/notifications/:id/archive — soft-delete ("delete" in the UI).
 */
router.patch('/:id/archive', catchAsync(async (req, res) => {
  const result = await execute(
    `UPDATE QA_NOTIFICATIONS
        SET IS_ARCHIVED = 1, IS_READ = 1, READ_AT = NVL(READ_AT, SYSTIMESTAMP)
      WHERE NOTIF_ID = :id AND RECIPIENT = :me`,
    { id: req.params.id, me: req.user.email }
  );
  if (!result.rowsAffected) {
    return res.status(404).json({ success: false, error: 'Notification not found' });
  }
  res.json({ success: true });
}));

module.exports = router;
