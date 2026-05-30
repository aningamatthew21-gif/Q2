'use strict';

/**
 * apiError(code, detail?, opts?) — build a standard error envelope.
 *
 * Standards anchor:
 *   - OWASP ASVS V11.1.1 — application emits an error message that does
 *     not include internal detail (stack, SQL, binds) for non-FATAL errors
 *   - ISO/IEC 27001:2022 A.8.15 — every error carries the correlation ID
 *     that ties it to the structured log line
 *
 * Usage in a route:
 *
 *   const { apiError } = require('../utils/apiError');
 *
 *   if (!isOwner) {
 *     return res.status(403).json(apiError('E_PERM_DENIED'));
 *   }
 *   if (sodErr) {
 *     return res.status(403).json(apiError('E_SOD_VIOLATION', sodErr));
 *   }
 *
 * Or, with the convenience .send():
 *
 *   return apiError.send(res, 'E_NOT_FOUND', 'Invoice INV-… not found');
 *
 * The envelope shape:
 *
 *   {
 *     success: false,
 *     error: {
 *       code:      'E_SOD_VIOLATION',
 *       message:   'human-readable message',
 *       requestId: 'req_a1b2c3d4',          // pulled from AsyncLocalStorage
 *       field:     'salesPersonId' | null,  // for inline validation UIs
 *       retryable: false
 *     }
 *   }
 */

const { ERROR_CODES, getErrorDef } = require('../../shared/errors');

let getRequestIdFn = () => null;
try {
  // Wired by logger.js if structured-logging is on; fall back to null otherwise.
  const logger = require('./logger');
  if (typeof logger.getRequestId === 'function') {
    getRequestIdFn = logger.getRequestId;
  }
} catch (_) { /* logger optional */ }

function apiError(code, detail, opts = {}) {
  const def = getErrorDef(code);
  const envelope = {
    success: false,
    error: {
      code,
      message: (detail && String(detail).trim()) || def.userMessage,
      requestId: getRequestIdFn() || null,
      field:     opts.field     || null,
      retryable: opts.retryable !== undefined ? !!opts.retryable : !!def.retryable
    }
  };
  return envelope;
}

/**
 * Convenience wrapper that sets the HTTP status and sends the envelope
 * in one call:  return apiError.send(res, 'E_NOT_FOUND', 'Invoice X');
 *
 * Returns the response so the caller can `return` it.
 */
apiError.send = function sendApiError(res, code, detail, opts = {}) {
  const def = getErrorDef(code);
  return res.status(opts.http || def.http || 500).json(apiError(code, detail, opts));
};

/**
 * Predicate — is this thing already an apiError envelope?
 * Used by the central error handler so we don't double-wrap.
 */
apiError.isEnvelope = function isEnvelope(x) {
  return !!(x && x.success === false && x.error && typeof x.error.code === 'string'
            && ERROR_CODES[x.error.code]);
};

module.exports = { apiError };
