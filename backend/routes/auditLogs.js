'use strict';

const express = require('express');
const { execute, transaction } = require('../db');
const { lobToString } = require('../db');
const { catchAsync } = require('../middleware/errorHandler');
const { authMiddleware } = require('../middleware/authMiddleware');
const { emitToAll } = require('../utils/socketEmitter');

const router = express.Router();
router.use(authMiddleware);

// ============================================================
// Auto-cleanup: run once per day, delete logs older than 365 days
// ============================================================
let lastCleanupDate = null;

const runCleanupIfNeeded = async () => {
  const today = new Date().toDateString();
  if (lastCleanupDate === today) return;
  lastCleanupDate = today;
  try {
    const result = await execute(
      "DELETE FROM QA_AUDIT_LOGS WHERE LOG_TIME < SYSTIMESTAMP - INTERVAL '365' DAY"
    );
    const deleted = result.rowsAffected || 0;
    if (deleted > 0) {
      console.log(`[AuditLogs] Auto-cleanup: deleted ${deleted} logs older than 365 days`);
    }
  } catch (err) {
    console.error('[AuditLogs] Cleanup failed:', err.message);
  }
};

// ============================================================
// GET /api/audit-logs
// Supports: startDate, endDate, category, severity, entityType, userId, limit
// ============================================================
router.get('/', catchAsync(async (req, res) => {
  // Run cleanup check (non-blocking)
  runCleanupIfNeeded().catch(() => {});

  const {
    startDate, endDate,
    category, severity, entityType,
    userId, action,
    limit = 500,
    offset = 0
  } = req.query;

  let whereClause = 'WHERE 1=1';
  const binds = {};

  if (startDate) {
    whereClause += ' AND LOG_TIME >= TO_TIMESTAMP(:startDate, \'YYYY-MM-DD\')';
    binds.startDate = startDate;
  }
  if (endDate) {
    whereClause += ' AND LOG_TIME < TO_TIMESTAMP(:endDate, \'YYYY-MM-DD\') + INTERVAL \'1\' DAY';
    binds.endDate = endDate;
  }
  if (category && category !== 'all') {
    whereClause += ' AND CATEGORY = :cat';
    binds.cat = category;
  }
  if (severity && severity !== 'all') {
    whereClause += ' AND SEVERITY = :sev';
    binds.sev = severity;
  }
  if (entityType) {
    whereClause += ' AND ENTITY_TYPE = :etype';
    binds.etype = entityType;
  }
  if (userId) {
    whereClause += ' AND LOWER(USER_ID) LIKE :uid';
    binds.uid = `%${userId.toLowerCase()}%`;
  }
  if (action) {
    whereClause += ' AND LOWER(ACTION) LIKE :act';
    binds.act = `%${action.toLowerCase()}%`;
  }

  const limitNum  = Math.min(parseInt(limit)  || 500,  2000);
  const offsetNum = Math.max(parseInt(offset) || 0, 0);

  const result = await execute(`
    SELECT * FROM QA_AUDIT_LOGS
    ${whereClause}
    ORDER BY LOG_TIME DESC
    OFFSET :off ROWS FETCH NEXT :lim ROWS ONLY
  `, { ...binds, off: offsetNum, lim: limitNum });

  // Also get total count for pagination
  const countResult = await execute(`
    SELECT COUNT(*) AS TOTAL FROM QA_AUDIT_LOGS ${whereClause}
  `, binds);

  const total = countResult.rows[0].TOTAL;

  const logs = await Promise.all((result.rows || []).map(async row => {
    let extraObj = null;
    try {
      const extraContent = await lobToString(row.EXTRA_DATA);
      if (extraContent) extraObj = JSON.parse(extraContent);
    } catch (_) {}

    return {
      id: row.LOG_ID.toString(),
      timestamp: row.LOG_TIME,
      userId: row.USER_ID,
      action: row.ACTION,
      details: row.DETAILS,
      category: row.CATEGORY || 'system',
      severity: row.SEVERITY || 'info',
      outcome: row.OUTCOME || 'success',
      entityType: row.ENTITY_TYPE || null,
      entityId: row.ENTITY_ID || null,
      ipAddress: row.IP_ADDRESS || null,
      userAgent: row.USER_AGENT || null,
      extra: extraObj
    };
  }));

  res.json({ success: true, data: logs, total, limit: limitNum, offset: offsetNum });
}));

// ============================================================
// GET /api/audit-logs/stats
// Quick summary counts for the AuditTrail dashboard header
// ============================================================
router.get('/stats', catchAsync(async (req, res) => {
  const today = new Date().toISOString().split('T')[0];

  const [todayTotal, totalUnique, totalCritical] = await Promise.all([
    execute(
      "SELECT COUNT(*) AS C FROM QA_AUDIT_LOGS WHERE LOG_TIME >= TO_TIMESTAMP(:d, 'YYYY-MM-DD')",
      { d: today }
    ),
    execute(
      "SELECT COUNT(DISTINCT USER_ID) AS C FROM QA_AUDIT_LOGS WHERE LOG_TIME >= TO_TIMESTAMP(:d, 'YYYY-MM-DD')",
      { d: today }
    ),
    execute(
      "SELECT COUNT(*) AS C FROM QA_AUDIT_LOGS WHERE SEVERITY = 'critical' AND LOG_TIME >= TO_TIMESTAMP(:d, 'YYYY-MM-DD')",
      { d: today }
    )
  ]);

  res.json({
    success: true,
    data: {
      logsToday: todayTotal.rows[0].C,
      uniqueUsersToday: totalUnique.rows[0].C,
      criticalToday: totalCritical.rows[0].C
    }
  });
}));

// ============================================================
// POST /api/audit-logs
// Write a new audit log entry (called from frontend logger)
// ============================================================
router.post('/', catchAsync(async (req, res) => {
  const log = req.body;
  if (!log.action || !log.category) {
    return res.status(400).json({ success: false, error: 'action and category are required' });
  }

  const {
    userId, action, details, category,
    entityType, entityId, severity, outcome,
    timestamp, ...extraData
  } = log;

  // SECURITY — always use the authenticated user as the actor. A client-
  // supplied `userId` is IGNORED here; otherwise any logged-in user could
  // forge audit entries attributed to anyone else (forensic-trail
  // corruption). The token is the only authority on identity.
  void userId;
  const finalUserId = req.user.email;

  // Whitelist severity / outcome so a client can't write `severity:'<script>'`
  const allowedSeverity = ['info', 'warning', 'critical', 'success'];
  const allowedOutcome  = ['success', 'failure', 'partial'];
  const safeSeverity = allowedSeverity.includes(severity) ? severity : 'info';
  const safeOutcome  = allowedOutcome.includes(outcome)   ? outcome  : 'success';
  const extraDataStr = Object.keys(extraData).length > 0
    ? JSON.stringify(extraData).substring(0, 3900)
    : null;

  const ipAddress = (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress || null
  );

  await execute(`
    INSERT INTO QA_AUDIT_LOGS
      (USER_ID, ACTION, DETAILS, CATEGORY, EXTRA_DATA, ENTITY_TYPE, ENTITY_ID, SEVERITY, OUTCOME, IP_ADDRESS)
    VALUES
      (:u_id, :act, :det, :cat, :ext_data, :e_type, :e_id, :sev, :u_out, :ip_addr)
  `, {
    u_id: finalUserId,
    act: action,
    det: details || null,
    cat: category,
    ext_data: extraDataStr,
    e_type: entityType || null,
    e_id: entityId ? String(entityId) : null,
    sev: safeSeverity,
    u_out: safeOutcome,
    ip_addr: ipAddress
  });

  emitToAll('audit_logs:new');
  res.json({ success: true });
}));

module.exports = router;
