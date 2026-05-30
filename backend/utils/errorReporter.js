'use strict';

/**
 * errorReporter.js — single chokepoint for persisting errors to
 * QA_ERROR_LOG and emitting the real-time Socket.IO event.
 *
 * Standards anchor:
 *   - ISO/IEC 27001:2022 A.8.15 (Logging) — centralised, durable, queryable
 *   - ISO/IEC 27001:2022 A.8.16 (Monitoring activities) — real-time stream
 *     to admin observers via 'error:logged' socket event
 *   - ISO/IEC 27001:2022 A.5.34 (Privacy & PII protection) — payload is
 *     masked through utils/maskPII before persistence
 *   - OWASP ASVS V11.1.7 — error reporting is non-blocking and never
 *     throws on the request hot path (caller wraps in fire-and-forget)
 *
 * Two callers:
 *   1. backend/middleware/errorHandler.js — backend exceptions
 *   2. backend/routes/errors.js (POST /api/errors/report) — frontend errors
 *      (React Error Boundary, useApiCall failures, manual reports)
 *
 * Dedup model:
 *   fingerprint = sha256(code + route + stack-top-frame)[:32]
 *
 *   First occurrence: INSERT with OCCURRENCE_COUNT=1
 *   Repeat:           UPDATE LAST_SEEN_AT=now, OCCURRENCE_COUNT += 1
 *
 *   Implementation: MERGE statement, atomic in a single round-trip.
 *
 * Resilience:
 *   - Never throws to the caller; on any failure logs to console and
 *     swallows. Reporting failures must never cascade into request
 *     failures (would create infinite reporting loops).
 *   - PAYLOAD_SAMPLE is capped to 8 KB to bound write cost.
 */

const crypto = require('crypto');
const { execute } = require('../db');
const { maskPII } = require('./maskPII');
const { getErrorDef } = require('../../shared/errors');

// Lazy socket emitter — loaded on first use so a misconfigured emitter
// can't crash this module at import time.
let _emitToAll = null;
function getEmitter() {
  if (_emitToAll === null) {
    try { _emitToAll = require('./socketEmitter').emitToAll; }
    catch (_) { _emitToAll = () => {}; }
  }
  return _emitToAll;
}

// Pull the top non-internal frame out of a stack string for fingerprinting.
// We strip node-internal frames (node:internal/...) and node_modules
// (third-party noise — same root cause shows up under many libs).
function stackTopFrame(stack) {
  if (!stack || typeof stack !== 'string') return '';
  const lines = stack.split('\n');
  for (const line of lines) {
    if (!line.includes('node:internal/') &&
        !line.includes('node_modules') &&
        line.includes('at ')) {
      return line.trim().slice(0, 200);
    }
  }
  return (lines[1] || '').trim().slice(0, 200);
}

function fingerprint(code, route, stack) {
  return crypto.createHash('sha256')
    .update(`${code || 'E_UNKNOWN'}|${route || ''}|${stackTopFrame(stack)}`)
    .digest('hex')
    .slice(0, 32);
}

function newErrorId() {
  return `err_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

// JSON-stringify with a hard cap so a 50 MB payload doesn't bloat the
// log table. Truncates rather than crashes on circular refs.
function safeStringifyCapped(value, maxBytes = 8 * 1024) {
  let s;
  try {
    s = JSON.stringify(value);
  } catch (_) {
    try { s = JSON.stringify(value, getCircularReplacer()); }
    catch (_) { s = '"[unserialisable]"'; }
  }
  if (s == null) return null;
  if (Buffer.byteLength(s, 'utf8') <= maxBytes) return s;
  return s.slice(0, maxBytes - 20) + '..."[TRUNCATED]"';
}

function getCircularReplacer() {
  const seen = new WeakSet();
  return (k, v) => {
    if (typeof v === 'object' && v !== null) {
      if (seen.has(v)) return '[Circular]';
      seen.add(v);
    }
    return v;
  };
}

/**
 * Persist an error. Returns the persisted row's id + whether it was a
 * new fingerprint (so the caller can decide whether to alert).
 *
 *   await reportError({
 *     code:      'E_DB_QUERY',
 *     severity:  'ERROR',
 *     source:    'backend',     // 'backend' | 'react' | 'network' | 'manual'
 *     message:   err.message,
 *     stack:     err.stack,
 *     route:     'GET /api/invoices',
 *     requestId: req.requestId,
 *     userEmail: req.user?.email,
 *     userRole:  req.user?.role,
 *     userAgent: req.get('User-Agent'),
 *     clientIp:  req.ip,
 *     payload:   { query: req.query, params: req.params, body: req.body }
 *   });
 *
 * The function NEVER throws — failures are logged and swallowed.
 */
async function reportError(input) {
  try {
    const code     = input.code || 'E_UNKNOWN';
    const def      = getErrorDef(code);
    const severity = input.severity || def.severity || 'ERROR';
    const source   = input.source   || 'backend';
    const fp       = fingerprint(code, input.route, input.stack);
    const errorId  = newErrorId();

    // PII-mask any structured payload before writing to QA_ERROR_LOG.
    const maskedPayload = input.payload
      ? safeStringifyCapped(maskPII(input.payload))
      : null;

    const message = String(input.message || def.userMessage || '').slice(0, 1900);
    const route   = String(input.route   || '').slice(0, 290);
    const stack   = input.stack ? String(input.stack).slice(0, 32 * 1024) : null;
    const ua      = input.userAgent ? String(input.userAgent).slice(0, 490) : null;
    const ip      = input.clientIp  ? String(input.clientIp).slice(0, 60)   : null;
    const reqId   = input.requestId ? String(input.requestId).slice(0, 60)  : null;
    const email   = input.userEmail ? String(input.userEmail).slice(0, 250) : null;
    const role    = input.userRole  ? String(input.userRole).slice(0, 28)   : null;

    // MERGE = atomic upsert by fingerprint. New rows get errorId; repeats
    // bump count + last_seen. Oracle's MERGE syntax: WHEN MATCHED then
    // WHEN NOT MATCHED.
    const sql = `
      MERGE INTO QA_ERROR_LOG t
      USING (SELECT :fp AS FINGERPRINT FROM DUAL) src
      ON (t.FINGERPRINT = src.FINGERPRINT AND (t.MUTED = 'N' OR t.MUTED IS NULL))
      WHEN MATCHED THEN UPDATE
        SET t.LAST_SEEN_AT    = SYSTIMESTAMP,
            t.OCCURRENCE_COUNT = t.OCCURRENCE_COUNT + 1,
            t.SEVERITY        = CASE
                                  WHEN :severity = 'FATAL' THEN 'FATAL'
                                  WHEN :severity = 'ERROR' AND t.SEVERITY NOT IN ('FATAL') THEN 'ERROR'
                                  ELSE t.SEVERITY
                                END,
            t.STATUS          = CASE WHEN t.STATUS = 'RESOLVED' THEN 'OPEN' ELSE t.STATUS END,
            t.MESSAGE         = COALESCE(:message, t.MESSAGE)
      WHEN NOT MATCHED THEN INSERT
        (ERROR_ID, FINGERPRINT, CODE, SEVERITY, SOURCE, MESSAGE, STACK, ROUTE,
         USER_EMAIL, USER_ROLE, REQUEST_ID, USER_AGENT, CLIENT_IP, PAYLOAD_SAMPLE)
      VALUES
        (:errorId, :fp, :code, :severity, :source, :message, :stack, :route,
         :userEmail, :userRole, :requestId, :userAgent, :clientIp, :payload)
    `;

    const result = await execute(sql, {
      errorId, fp, code, severity, source,
      message, stack, route,
      userEmail: email, userRole: role, requestId: reqId,
      userAgent: ua, clientIp: ip,
      payload: maskedPayload
    });

    // Visible terminal feedback so the operator can confirm the
    // pipeline is alive (and so silent reporter failures are
    // immediately obvious instead of hiding in the dark).
    /* eslint-disable no-console */
    console.log(`📥 [errorReporter] ${severity} ${code} ${route || ''} — rowsAffected=${result.rowsAffected || 0} fp=${fp.slice(0, 8)}`);
    /* eslint-enable no-console */

    // Real-time push (ISO 27001 A.8.16). Only push for severity >= WARN
    // so admins aren't woken up by routine 404s; INFO stays in the log
    // but doesn't ring the bell.
    //
    // SELF-PROTECTION: do NOT push for errors that originated on the
    // Error Monitor's own endpoints. Otherwise a bug in /api/errors/*
    // creates an infinite feedback loop (route fails → emit → frontend
    // refreshes → route fails again → emit … ~80 events/min). The error
    // is still persisted (so it remains discoverable), just doesn't
    // ring the bell that would re-trigger the failing call.
    const isMonitorRoute = typeof route === 'string' && route.includes('/api/errors');
    const shouldPush     = !isMonitorRoute &&
      (severity === 'WARN' || severity === 'ERROR' || severity === 'FATAL');

    if (shouldPush) {
      try {
        getEmitter()('error:logged', {
          errorId, fingerprint: fp, code, severity, source, route,
          message: message.slice(0, 240),
          userEmail: email, requestId: reqId,
          loggedAt: new Date().toISOString()
        });
      } catch (_) { /* socket failure is non-fatal */ }
    }

    return { ok: true, errorId, fingerprint: fp };
  } catch (persistErr) {
    // Last resort — never let reporting failures kill the caller.
    /* eslint-disable no-console */
    console.error('[errorReporter] failed to persist:', persistErr && persistErr.message);
    /* eslint-enable no-console */
    return { ok: false, error: persistErr && persistErr.message };
  }
}

module.exports = { reportError, fingerprint, stackTopFrame };
