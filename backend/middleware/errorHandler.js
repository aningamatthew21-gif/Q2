'use strict';

/**
 * Central error-handler middleware.
 *
 * Standards anchor:
 *   - OWASP ASVS V11.1.1 — application emits an error message that does
 *     not include internal detail (stack, SQL, binds) for non-development
 *     responses to clients
 *   - OWASP ASVS V11.1.7 — application logs all internal-failure details
 *     server-side (not just to the client) so support can diagnose
 *   - ISO/IEC 27001:2022 A.8.15 (Logging) — every error categorized,
 *     correlated to a request ID, and persisted to QA_ERROR_LOG for the
 *     retention window driven by the audit retention policy
 *
 * Behaviour:
 *   1. Classify the thrown value (Oracle ORA-…, JWT, validation, etc.)
 *      via `shared/errors.js#classifyThrown` to land on a stable code.
 *   2. Persist the error to QA_ERROR_LOG (fingerprint-dedup) via
 *      `reportError()` — fire-and-forget so reporting never blocks the
 *      response.
 *   3. Emit the standard envelope to the client via `apiError()` so
 *      every client sees the same shape and can pivot on `error.code`.
 *
 * Back-compat:
 *   Legacy routes that already produced `{ success: false, error: 'free text' }`
 *   continue to work — Express returned the response before reaching us
 *   in those cases. We only handle THROWN errors (caught by catchAsync).
 */

const { classifyThrown, getErrorDef } = require('../../shared/errors');
const { apiError } = require('../utils/apiError');

// Optional reporter (Phase EH-3). If absent, error still serialised to
// the client; we just don't persist.
let reportError = async () => {};
try {
  reportError = require('../utils/errorReporter').reportError;
} catch (_) { /* not yet wired — degrades gracefully */ }

function errorHandler(err, req, res, next) {
  // ── 1. Backend-side full diagnostic log (always; never to client) ──
  // The structured-logger middleware downstream captures requestId etc.;
  // here we just dump the raw stack so the developer can correlate.
  /* eslint-disable no-console */
  console.error(`[ERR] ${req.method} ${req.url}`);
  console.error(err && (err.stack || err.message) || err);
  /* eslint-enable no-console */

  // ── 2. Classify into a stable error code ───────────────────────────
  const code = classifyThrown(err);
  const def  = getErrorDef(code);
  const status = err.status || err.statusCode || def.http || 500;

  // For the client message, prefer the user-friendly default; only
  // expose raw `err.message` in development OR when it's a 4xx that
  // wouldn't leak internals (validation, conflict, etc.).
  let clientMessage = def.userMessage;
  if (status < 500 && err.message) {
    clientMessage = err.message;
  } else if (code === 'E_DB_QUERY' && err.message && /^ORA-\d+/.test(err.message)) {
    // Keep the ORA code (no leak) but strip the query body.
    const m = err.message.match(/ORA-(\d{5})/);
    clientMessage = `Database error (${m ? `ORA-${m[1]}` : 'unknown'}). Engineering has been notified.`;
  }

  // ── 3. Persist to QA_ERROR_LOG (fire-and-forget) ───────────────────
  // The reporter is wrapped in its own try so reporting failures cannot
  // affect the response to the client (OWASP ASVS V11.1.7 — reporting
  // must be non-blocking and non-throwing on the request path).
  try {
    reportError({
      code,
      severity: def.severity || 'ERROR',
      source:   'backend',
      message:  err.message || String(err),
      stack:    err.stack || null,
      route:    `${req.method} ${req.route?.path || req.url}`,
      requestId: req.requestId || null,
      userEmail: req.user?.email || null,
      userRole:  req.user?.role || null,
      userAgent: req.get('User-Agent') || null,
      clientIp:  req.ip || null,
      payload:   { query: req.query, params: req.params, body: req.body }
    }).catch(() => {});
  } catch (_) { /* never let reporting itself crash */ }

  // ── 4. Emit the standard envelope to the client ────────────────────
  res.status(status).json(apiError(code, clientMessage, {
    // Stack trace ONLY in development AND only for 5xx (so a 403 from
    // a misconfigured route never accidentally leaks server internals).
    ...(process.env.NODE_ENV === 'development' && status >= 500 ? { stack: err.stack } : {})
  }));
}

/**
 * Wrap an async Express route so rejected promises route to errorHandler.
 * Replaces the need for try/catch in every controller.
 */
const catchAsync = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

module.exports = { errorHandler, catchAsync };
