/**
 * shared/errors.js — single source of truth for error codes used by BOTH
 * the Express backend and the React frontend.
 *
 * Why one file:
 *   The same way `shared/permissions.js` keeps RBAC drift impossible, this
 *   file keeps error semantics consistent. Backend emits a code; frontend
 *   maps the code → UI archetype → ErrorScreen variant + recovery action.
 *   No free-text parsing on the client.
 *
 * Standards anchor:
 *   - ISO/IEC 27001:2022 A.8.15 (Logging) — every error categorized for
 *     audit + retention
 *   - ISO/IEC 25010 Reliability (Maturity, Fault tolerance, Recoverability)
 *   - OWASP ASVS v4.0 V11.1.x — consistent error shape, no internal-detail
 *     leak to client (stack/SQL/binds never serialized for non-FATAL),
 *     timing-stable responses
 *   - WCAG 2.1 AA — every archetype maps to a screen that uses both icon
 *     + text (not color-only) and proper ARIA role="alert"
 *
 * The envelope (every error response from the backend):
 *
 *   {
 *     success: false,
 *     error: {
 *       code:       'E_SOD_VIOLATION',          // machine
 *       message:    'Approver must not be...',  // user-visible
 *       requestId:  'req_a1b2c3d4',             // for support correlation
 *       field:      'salesPersonId'  | null,    // for inline validation
 *       retryable:  false                        // hint to the UI
 *     }
 *   }
 *
 * To add a new code: add to ERROR_CODES below, then use apiError(code, detail)
 * in the backend route. The frontend picks it up automatically via the
 * archetype mapping.
 */

/**
 * shared/ is configured as ESM (type: "module" in shared/package.json),
 * so this file uses `export` syntax — NOT `module.exports`. The backend
 * consumes it via Node 22's native require-ESM bridge (the same way it
 * already consumes shared/permissions.js), so call sites like
 * `require('../../shared/errors')` keep working.
 */

/**
 * UI archetypes — the seven failure shapes a user can hit. Every code
 * maps to exactly one, which drives which <ErrorScreen> variant renders.
 *
 *   'empty'      — query returned 0 rows (not strictly an error)
 *   'inline'     — validation / per-field — show next to the field
 *   'permission' — 401/403 — render permission screen with role hint
 *   'notfound'   — 404 — single-resource missing
 *   'conflict'   — 409 — concurrency / duplicate — show diff / reload
 *   'network'    — transport-level — offline, timeout, rate-limited
 *   'server'     — 5xx — generic recover-able-by-retry / report
 */
export const ARCHETYPES = Object.freeze({
  EMPTY:      'empty',
  INLINE:     'inline',
  PERMISSION: 'permission',
  NOTFOUND:   'notfound',
  CONFLICT:   'conflict',
  NETWORK:    'network',
  SERVER:     'server'
});

/**
 * The catalogue. Every backend error eventually maps to one of these.
 * `userMessage` is the safe default; routes can override per-call.
 * `severity` drives whether QA_ERROR_LOG persists at WARN (logged but
 * routine) or ERROR (admin attention) or FATAL (page + Slack later).
 */
export const ERROR_CODES = Object.freeze({
  // ── 4xx — client-side ───────────────────────────────────────────────
  E_AUTH_REQUIRED: {
    http: 401, archetype: ARCHETYPES.PERMISSION, severity: 'INFO',
    userMessage: 'Please sign in again to continue.',
    retryable: false
  },
  E_AUTH_EXPIRED: {
    http: 401, archetype: ARCHETYPES.PERMISSION, severity: 'INFO',
    userMessage: 'Your session has expired. Please sign in again.',
    retryable: false
  },
  E_AUTH_INVALID: {
    http: 401, archetype: ARCHETYPES.PERMISSION, severity: 'WARN',
    userMessage: 'Your credentials could not be verified.',
    retryable: false
  },
  E_PERM_DENIED: {
    http: 403, archetype: ARCHETYPES.PERMISSION, severity: 'INFO',
    userMessage: 'You don\'t have permission to perform this action.',
    retryable: false
  },
  E_SOD_VIOLATION: {
    http: 403, archetype: ARCHETYPES.PERMISSION, severity: 'WARN',
    userMessage: 'Separation of duties — a different user must perform this action.',
    retryable: false
  },
  E_NOT_FOUND: {
    http: 404, archetype: ARCHETYPES.NOTFOUND, severity: 'INFO',
    userMessage: 'We couldn\'t find what you were looking for.',
    retryable: false
  },
  E_VALIDATION: {
    http: 400, archetype: ARCHETYPES.INLINE, severity: 'INFO',
    userMessage: 'Some fields need your attention.',
    retryable: false
  },
  E_BAD_REQUEST: {
    http: 400, archetype: ARCHETYPES.SERVER, severity: 'WARN',
    userMessage: 'The request couldn\'t be understood. Please try again.',
    retryable: false
  },
  E_CONFLICT_STATE: {
    http: 409, archetype: ARCHETYPES.CONFLICT, severity: 'WARN',
    userMessage: 'This record was changed by another user. Please reload and try again.',
    retryable: false
  },
  E_CONFLICT_DUP: {
    http: 409, archetype: ARCHETYPES.INLINE, severity: 'INFO',
    userMessage: 'A record with these details already exists.',
    retryable: false
  },
  E_RATE_LIMITED: {
    http: 429, archetype: ARCHETYPES.NETWORK, severity: 'INFO',
    userMessage: 'Too many requests — please wait a moment and try again.',
    retryable: true
  },
  E_PAYLOAD_TOO_LARGE: {
    http: 413, archetype: ARCHETYPES.INLINE, severity: 'INFO',
    userMessage: 'The file or request is too large.',
    retryable: false
  },
  E_UNSUPPORTED_MEDIA: {
    http: 415, archetype: ARCHETYPES.INLINE, severity: 'INFO',
    userMessage: 'That file type isn\'t allowed.',
    retryable: false
  },

  // ── 5xx — server-side ───────────────────────────────────────────────
  E_DB_DOWN: {
    http: 503, archetype: ARCHETYPES.SERVER, severity: 'FATAL',
    userMessage: 'Our database is temporarily unavailable. Please try again in a minute.',
    retryable: true
  },
  E_DB_QUERY: {
    http: 500, archetype: ARCHETYPES.SERVER, severity: 'ERROR',
    userMessage: 'A database error occurred. Engineering has been notified.',
    retryable: false
  },
  E_DB_CONSTRAINT: {
    http: 409, archetype: ARCHETYPES.INLINE, severity: 'WARN',
    userMessage: 'This change conflicts with existing data.',
    retryable: false
  },
  E_EXTERNAL_DOWN: {
    http: 502, archetype: ARCHETYPES.SERVER, severity: 'ERROR',
    userMessage: 'A service we depend on is currently unavailable.',
    retryable: true
  },
  E_TIMEOUT: {
    http: 504, archetype: ARCHETYPES.NETWORK, severity: 'WARN',
    userMessage: 'The request took too long. Please try again.',
    retryable: true
  },
  E_INTERNAL: {
    http: 500, archetype: ARCHETYPES.SERVER, severity: 'ERROR',
    userMessage: 'Something went wrong. Engineering has been notified.',
    retryable: false
  },
  E_UNKNOWN: {
    http: 500, archetype: ARCHETYPES.SERVER, severity: 'ERROR',
    userMessage: 'An unexpected error occurred.',
    retryable: false
  }
});

export const ALL_CODES = Object.keys(ERROR_CODES);

/**
 * Resolve a code (string or unknown) → catalogue entry, defaulting to
 * E_UNKNOWN so the caller never sees `undefined`.
 */
export function getErrorDef(code) {
  return ERROR_CODES[code] || ERROR_CODES.E_UNKNOWN;
}

/**
 * Map an arbitrary thrown value into a code. Used by the central error
 * handler so legacy `throw new Error('foo')` patterns still produce a
 * sane envelope while migration proceeds.
 *
 * Heuristics:
 *   - Oracle ORA-XXXXX → E_DB_QUERY (or E_DB_CONSTRAINT for ORA-00001
 *     unique violations, ORA-02291 FK violations, etc.)
 *   - oracledb pool exhausted / DPI-1080 / NJS-040 → E_DB_DOWN
 *   - Express JSON parse errors → E_BAD_REQUEST
 *   - JWT errors → E_AUTH_INVALID
 *   - Generic Error → E_INTERNAL
 */
export function classifyThrown(err) {
  if (!err) return 'E_UNKNOWN';
  const msg = String(err.message || err);
  // Oracle data-integrity violations bubble as 4xx (user-fixable)
  if (/ORA-00001\b/.test(msg)) return 'E_CONFLICT_DUP';        // unique
  if (/ORA-02291\b|ORA-02292\b/.test(msg)) return 'E_DB_CONSTRAINT'; // FK
  // Oracle availability failures
  if (/NJS-040\b|NJS-024\b|DPI-1080\b|ORA-12541\b|ORA-12170\b/.test(msg)) return 'E_DB_DOWN';
  // Other Oracle = generic query error
  if (/ORA-\d+/.test(msg)) return 'E_DB_QUERY';
  // Auth/JWT
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') return 'E_AUTH_INVALID';
  // Body-parser
  if (err.type === 'entity.parse.failed') return 'E_BAD_REQUEST';
  if (err.type === 'entity.too.large')   return 'E_PAYLOAD_TOO_LARGE';
  // Express-rate-limit doesn't throw, but other rate-limit libs do
  if (err.status === 429) return 'E_RATE_LIMITED';
  return 'E_INTERNAL';
}

// Exports are all named (`export const ARCHETYPES`, `export const ERROR_CODES`,
// `export const ALL_CODES`, `export function getErrorDef`, `export function classifyThrown`).
// Backend consumers via `require('../../shared/errors')` receive these
// through Node 22's native require-ESM bridge, identical to how
// `shared/permissions.js` is already consumed.
