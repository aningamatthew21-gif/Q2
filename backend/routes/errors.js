'use strict';

/**
 * routes/errors.js — Error Monitor backend.
 *
 * Endpoints:
 *   POST /api/errors/report          — frontend reports an error (open to any
 *                                       authenticated user; the report goes
 *                                       through the same reportError() chokepoint
 *                                       and is fingerprint-deduped)
 *   GET  /api/errors                  — list errors (admin only via
 *                                       system.errors.read)
 *   GET  /api/errors/stats            — KPI summary (admin)
 *   GET  /api/errors/timeseries       — per-minute count for the chart (admin)
 *   GET  /api/errors/:id              — detail incl. masked payload (admin)
 *   POST /api/errors/:id/acknowledge  — admin acknowledges (admin)
 *   POST /api/errors/:id/resolve      — admin resolves with a note (admin)
 *   POST /api/errors/:id/mute         — admin mutes known-issue (admin)
 *   POST /api/errors/:id/unmute       — admin unmutes (admin)
 *
 * Standards anchor:
 *   - ISO/IEC 27001:2022 A.8.15 (Logging) — read access controlled
 *   - ISO/IEC 27001:2022 A.8.16 (Monitoring) — admin observability surface
 *   - ISO/IEC 27001:2022 A.5.34 (PII) — payload already masked at insert,
 *     re-confirmed not to leak in responses
 *
 * Resilience:
 *   The frontend-report endpoint is rate-limited (apiLimiter from server.js
 *   already wraps it) so a malicious client can't flood the table.
 */

const express = require('express');
const { execute } = require('../db');
const { catchAsync } = require('../middleware/errorHandler');
const { authMiddleware, requirePermission } = require('../middleware/authMiddleware');
const { reportError } = require('../utils/errorReporter');
const { apiError } = require('../utils/apiError');

const router = express.Router();
router.use(authMiddleware);

// ── Frontend-error report endpoint ─────────────────────────────────────
// Open to every authenticated user. The frontend ErrorBoundary +
// useApiCall hook POST here when something blows up client-side.
router.post('/report', catchAsync(async (req, res) => {
  const {
    code, severity, message, stack, source, route, userAgent, payload
  } = req.body || {};

  const safeSeverity = ['INFO', 'WARN', 'ERROR', 'FATAL'].includes(severity) ? severity : 'ERROR';
  const safeSource   = ['react', 'network', 'manual'].includes(source) ? source : 'react';

  await reportError({
    code: code || 'E_INTERNAL',
    severity: safeSeverity,
    source:   safeSource,
    message:  String(message || '').slice(0, 1900),
    stack,
    route:    String(route || '').slice(0, 290),
    requestId: req.requestId || null,
    userEmail: req.user?.email || null,
    userRole:  req.user?.role || null,
    userAgent: userAgent || req.get('User-Agent') || null,
    clientIp:  req.ip || null,
    payload
  });

  res.json({ success: true });
}));

// ── Admin-only endpoints below ─────────────────────────────────────────
router.use(requirePermission('system.errors.read'));

// ── DEBUG: deliberately throw, for the "Trigger test error" button ─────
// Pattern stolen from Sentry's /sentry-throw debug route, Rails'
// /rails/exceptions, etc. Always throws a known error so the operator
// can verify the entire monitoring pipeline end-to-end:
//   click button → axios → this endpoint → throw → catchAsync → next →
//   errorHandler → classifyThrown(E_INTERNAL) → reportError → INSERT into
//   QA_ERROR_LOG → emit 'error:logged' → Error Monitor refreshes → row
//   appears.
// Gated by system.errors.read so only admins can fire it.
router.get('/test-throw', catchAsync(async (req, res) => {
    // Use a stable, recognisable message + stable route so the fingerprint
    // dedups across multiple presses — the operator sees count increment
    // rather than a wall of new rows.
    const err = new Error('[TEST] Monitoring self-test — this error was intentionally thrown by GET /api/errors/test-throw');
    err.isTestEvent = true;
    throw err;
}));

// LIST — paginated, filterable by status / severity / source / search
router.get('/', catchAsync(async (req, res) => {
  const status   = req.query.status    || null;   // 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'MUTED' | 'ANY'
  const severity = req.query.severity  || null;   // 'INFO' | 'WARN' | 'ERROR' | 'FATAL' | 'ANY'
  const source   = req.query.source    || null;
  const q        = (req.query.q || '').trim();
  const limit    = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
  const offset   = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  let sql = `SELECT ERROR_ID, FINGERPRINT, CODE, SEVERITY, SOURCE, STATUS, MUTED,
                    MESSAGE, ROUTE, USER_EMAIL, USER_ROLE,
                    FIRST_SEEN_AT, LAST_SEEN_AT, OCCURRENCE_COUNT,
                    ACKNOWLEDGED_BY, ACKNOWLEDGED_AT, RESOLVED_BY, RESOLVED_AT
               FROM QA_ERROR_LOG WHERE 1=1`;
  const binds = {};

  if (status && status !== 'ANY') {
    sql += ' AND STATUS = :status';
    binds.status = status;
  }
  if (severity && severity !== 'ANY') {
    sql += ' AND SEVERITY = :severity';
    binds.severity = severity;
  }
  if (source && source !== 'ANY') {
    sql += ' AND SOURCE = :source';
    binds.source = source;
  }
  if (q) {
    sql += ' AND (LOWER(CODE) LIKE :q OR LOWER(MESSAGE) LIKE :q OR LOWER(ROUTE) LIKE :q OR LOWER(USER_EMAIL) LIKE :q)';
    binds.q = `%${q.toLowerCase()}%`;
  }
  sql += ' ORDER BY LAST_SEEN_AT DESC OFFSET :off ROWS FETCH NEXT :lim ROWS ONLY';
  binds.off = offset;
  binds.lim = limit;

  const r = await execute(sql, binds);
  res.json({ success: true, data: r.rows || [] });
}));

// STATS — KPI tiles for the dashboard header
router.get('/stats', catchAsync(async (req, res) => {
  const sinceHours = Math.min(Math.max(parseInt(req.query.sinceHours, 10) || 24, 1), 24 * 30);
  const since = `INTERVAL '${sinceHours}' HOUR`;

  const r = await execute(`
    SELECT
      COUNT(*)                                              AS TOTAL,
      SUM(CASE WHEN STATUS = 'OPEN'         THEN 1 ELSE 0 END) AS OPEN_COUNT,
      SUM(CASE WHEN STATUS = 'ACKNOWLEDGED' THEN 1 ELSE 0 END) AS ACK_COUNT,
      SUM(CASE WHEN STATUS = 'RESOLVED'     THEN 1 ELSE 0 END) AS RESOLVED_COUNT,
      SUM(CASE WHEN SEVERITY = 'FATAL'      THEN 1 ELSE 0 END) AS FATAL_COUNT,
      SUM(CASE WHEN SEVERITY = 'ERROR'      THEN 1 ELSE 0 END) AS ERROR_COUNT,
      SUM(CASE WHEN SEVERITY = 'WARN'       THEN 1 ELSE 0 END) AS WARN_COUNT,
      SUM(OCCURRENCE_COUNT)                                 AS TOTAL_OCCURRENCES
    FROM QA_ERROR_LOG
    WHERE LAST_SEEN_AT >= SYSTIMESTAMP - ${since}
  `);

  const row = r.rows?.[0] || {};
  res.json({
    success: true,
    data: {
      sinceHours,
      uniqueErrors:      Number(row.TOTAL || 0),
      open:              Number(row.OPEN_COUNT || 0),
      acknowledged:      Number(row.ACK_COUNT || 0),
      resolved:          Number(row.RESOLVED_COUNT || 0),
      fatal:             Number(row.FATAL_COUNT || 0),
      errors:            Number(row.ERROR_COUNT || 0),
      warnings:          Number(row.WARN_COUNT || 0),
      totalOccurrences:  Number(row.TOTAL_OCCURRENCES || 0)
    }
  });
}));

// TIMESERIES — per-hour or per-day count for the chart
router.get('/timeseries', catchAsync(async (req, res) => {
  const sinceHours = Math.min(Math.max(parseInt(req.query.sinceHours, 10) || 24, 1), 24 * 30);
  // Hourly buckets for ≤48h windows, daily for longer. The format
  // model is the COMPLETE Oracle pattern — `HH24` (hours 00-23) is
  // already the full element, do NOT append `24` again or you get
  // `'YYYY-MM-DD HH2424'` which throws ORA-01821: date format not
  // recognized (the very same bug whose feedback loop made the Error
  // Monitor count itself 100x per minute).
  const bucketFormat = sinceHours <= 48
    ? 'YYYY-MM-DD HH24'   // hourly grouping
    : 'YYYY-MM-DD';       // daily grouping
  const bucketLabel = sinceHours <= 48 ? 'hour' : 'day';

  const r = await execute(`
    SELECT
      TO_CHAR(LAST_SEEN_AT, '${bucketFormat}') AS BUCKET,
      SUM(OCCURRENCE_COUNT) AS COUNT
    FROM QA_ERROR_LOG
    WHERE LAST_SEEN_AT >= SYSTIMESTAMP - INTERVAL '${sinceHours}' HOUR
    GROUP BY TO_CHAR(LAST_SEEN_AT, '${bucketFormat}')
    ORDER BY BUCKET
  `);

  res.json({
    success: true,
    data: {
      bucket: bucketLabel,
      points: (r.rows || []).map(row => ({ t: row.BUCKET, count: Number(row.COUNT || 0) }))
    }
  });
}));

// DETAIL — full record including masked payload, stack, etc.
router.get('/:id', catchAsync(async (req, res) => {
  const r = await execute(
    `SELECT * FROM QA_ERROR_LOG WHERE ERROR_ID = :id`,
    { id: req.params.id }
  );
  const row = r.rows?.[0];
  if (!row) return apiError.send(res, 'E_NOT_FOUND', 'Error record not found');
  res.json({ success: true, data: row });
}));

// ACKNOWLEDGE
router.post('/:id/acknowledge', catchAsync(async (req, res) => {
  const r = await execute(
    `UPDATE QA_ERROR_LOG
        SET STATUS = 'ACKNOWLEDGED',
            ACKNOWLEDGED_BY = :by,
            ACKNOWLEDGED_AT = SYSTIMESTAMP
      WHERE ERROR_ID = :id AND STATUS IN ('OPEN','ACKNOWLEDGED')`,
    { id: req.params.id, by: req.user.email }
  );
  if (!r.rowsAffected) return apiError.send(res, 'E_NOT_FOUND', 'Error not found or already resolved');
  res.json({ success: true });
}));

// RESOLVE
router.post('/:id/resolve', catchAsync(async (req, res) => {
  const note = String(req.body?.note || '').slice(0, 2000);
  /* eslint-disable no-console */
  console.log(`📌 [errors] RESOLVE request — id=${req.params.id} by=${req.user.email} noteLen=${note.length}`);
  /* eslint-enable no-console */
  if (!note.trim()) return apiError.send(res, 'E_VALIDATION', 'Resolution note is required.', { field: 'note' });

  const r = await execute(
    `UPDATE QA_ERROR_LOG
        SET STATUS          = 'RESOLVED',
            RESOLVED_BY     = :by1,
            RESOLVED_AT     = SYSTIMESTAMP,
            RESOLUTION_NOTE = :note,
            ACKNOWLEDGED_BY = COALESCE(ACKNOWLEDGED_BY, :by2),
            ACKNOWLEDGED_AT = COALESCE(ACKNOWLEDGED_AT, SYSTIMESTAMP)
      WHERE ERROR_ID = :id`,
    // Use DIFFERENT bind names for the two RESOLVED_BY / ACKNOWLEDGED_BY
    // references. Some oracledb / Oracle combos handle repeated named
    // binds inconsistently across releases (esp. with optimizer rewrites);
    // distinct names removes the entire class of "bind variable already
    // referenced" + "ORA-01008: not all variables bound" headaches.
    { id: req.params.id, by1: req.user.email, by2: req.user.email, note }
  );
  /* eslint-disable no-console */
  console.log(`📌 [errors] RESOLVE done — rowsAffected=${r.rowsAffected}`);
  /* eslint-enable no-console */
  if (!r.rowsAffected) return apiError.send(res, 'E_NOT_FOUND', 'Error not found');
  res.json({ success: true });
}));

// MUTE / UNMUTE
router.post('/:id/mute', catchAsync(async (req, res) => {
  const r = await execute(
    `UPDATE QA_ERROR_LOG SET MUTED = 'Y', STATUS = 'MUTED' WHERE ERROR_ID = :id`,
    { id: req.params.id }
  );
  if (!r.rowsAffected) return apiError.send(res, 'E_NOT_FOUND', 'Error not found');
  res.json({ success: true });
}));

router.post('/:id/unmute', catchAsync(async (req, res) => {
  const r = await execute(
    `UPDATE QA_ERROR_LOG SET MUTED = 'N',
                              STATUS = CASE WHEN RESOLVED_AT IS NOT NULL THEN 'RESOLVED'
                                            WHEN ACKNOWLEDGED_AT IS NOT NULL THEN 'ACKNOWLEDGED'
                                            ELSE 'OPEN' END
       WHERE ERROR_ID = :id`,
    { id: req.params.id }
  );
  if (!r.rowsAffected) return apiError.send(res, 'E_NOT_FOUND', 'Error not found');
  res.json({ success: true });
}));

module.exports = router;
