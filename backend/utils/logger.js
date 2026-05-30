'use strict';

const crypto = require('crypto');

/**
 * utils/logger.js — structured JSON logger + request-ID correlation.
 *
 * Standards anchor:
 *   - ISO/IEC 27001:2022 A.8.15 (Logging)
 *   - ISO/IEC 27001:2022 A.8.16 (Monitoring activities)
 *   - 12-factor app §XI (Logs as event streams — write to stdout, let
 *     the platform handle aggregation / rotation)
 *   - SIEM-friendly: JSON one-event-per-line so ELK / Splunk / Datadog
 *     / Loki / CloudWatch can ingest without parser rules
 *
 * Why we built our own instead of adopting pino/winston:
 *   - Zero new dependencies (pino + pino-pretty add ~1MB to node_modules)
 *   - Trivial API surface — we only need 4 levels and a request-ID hook
 *   - Direct control over the JSON schema for forensic predictability
 *   - Easy to swap for pino later if we ever need its perf (we won't —
 *     this app does <100 req/sec; pino's value is at 10k+ req/sec)
 *
 * Output schema (one JSON object per line, terminated with \n):
 *   {
 *     "ts":  "2026-05-26T16:00:00.000Z",   ISO timestamp (UTC)
 *     "lvl": "info"|"warn"|"error"|"debug",
 *     "msg": "Human-readable message",
 *     "rid": "uuid-or-empty",              request ID (when available)
 *     ...meta                              any extra context fields
 *   }
 *
 * In development mode prints a coloured human-readable line alongside
 * the JSON for terminal readability. In production (NODE_ENV=production)
 * only the JSON is emitted — log shippers expect machine-readable.
 */

const IS_DEV = (process.env.NODE_ENV || 'development') !== 'production';

// AsyncLocalStorage gives us per-request context without threading
// `req` through every function call. Logs from anywhere in an HTTP
// handler's call stack automatically pick up the current request ID.
const { AsyncLocalStorage } = require('async_hooks');
const requestContext = new AsyncLocalStorage();

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] || LEVELS.info;

// ANSI colour codes for dev-mode pretty printing. Strictly cosmetic;
// JSON line is always emitted regardless.
const COLOURS = {
  debug: '\x1b[90m',   // dim
  info:  '\x1b[36m',   // cyan
  warn:  '\x1b[33m',   // yellow
  error: '\x1b[31m',   // red
  reset: '\x1b[0m'
};

function emit(level, msg, meta) {
  if (LEVELS[level] < MIN_LEVEL) return;
  const ctx = requestContext.getStore();
  const rid = ctx?.requestId || '';
  const record = {
    ts:  new Date().toISOString(),
    lvl: level,
    msg: String(msg),
    ...(rid ? { rid } : {}),
    ...(meta && typeof meta === 'object' ? meta : {})
  };
  // Single JSON line per record — the SIEM-friendly format. Use
  // process.stdout.write to avoid the extra `\n` Node's console.log
  // sometimes inserts on some platforms.
  process.stdout.write(JSON.stringify(record) + '\n');

  // Dev-only readability companion line (gets stripped by `npm start`
  // in production via NODE_ENV check). Tail -f friendly.
  if (IS_DEV) {
    const ridTag = rid ? ` \x1b[90m[${rid.slice(0, 8)}]\x1b[0m` : '';
    const metaStr = meta && Object.keys(meta).length
      ? ' \x1b[90m' + JSON.stringify(meta) + '\x1b[0m'
      : '';
    process.stdout.write(
      `${COLOURS[level]}${level.toUpperCase().padEnd(5)}${COLOURS.reset}${ridTag} ${msg}${metaStr}\n`
    );
  }
}

const logger = {
  debug: (msg, meta) => emit('debug', msg, meta),
  info:  (msg, meta) => emit('info',  msg, meta),
  warn:  (msg, meta) => emit('warn',  msg, meta),
  error: (msg, meta) => emit('error', msg, meta),
  /**
   * Run `fn()` with the given request ID attached to the async context.
   * Used by the requestId middleware below.
   */
  runWithContext(requestId, fn) {
    return requestContext.run({ requestId }, fn);
  },
  /** Read the current request ID, if any. */
  getRequestId() {
    return requestContext.getStore()?.requestId || null;
  }
};

/**
 * requestId middleware — assigns a UUID v4 per request, attaches to
 * req.requestId and the X-Request-ID response header, and wraps the
 * rest of the handler chain in an AsyncLocalStorage context so all
 * downstream `logger.*` calls inherit it automatically.
 *
 * Honours an incoming X-Request-ID header from upstream (load balancer,
 * tracing proxy, etc.) so distributed requests can be correlated
 * across services. If the incoming value looks invalid (not a UUID
 * shape, too long), we generate a fresh one — never trust client-
 * supplied identifiers blindly.
 */
const VALID_RID = /^[A-Za-z0-9_-]{8,64}$/;
function requestIdMiddleware(req, res, next) {
  const incoming = req.headers['x-request-id'];
  const rid = (incoming && VALID_RID.test(incoming))
    ? incoming
    : crypto.randomUUID();
  req.requestId = rid;
  res.setHeader('X-Request-ID', rid);
  logger.runWithContext(rid, () => next());
}

/**
 * Lightweight request logger — emits one INFO line per request when
 * the response finishes. Status, method, path, duration, bytes.
 * Use AFTER requestIdMiddleware so the rid is in the log line.
 *
 * Skips noisy probe endpoints by default.
 */
const SKIP_PATHS = new Set(['/api/health', '/favicon.ico']);
function httpAccessLog(req, res, next) {
  if (SKIP_PATHS.has(req.path)) return next();
  const start = Date.now();
  res.on('finish', () => {
    const durMs = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error'
                : res.statusCode >= 400 ? 'warn'
                : 'info';
    logger[level]('http', {
      method:   req.method,
      path:     req.path,
      status:   res.statusCode,
      durMs,
      bytes:    Number(res.getHeader('Content-Length') || 0) || undefined,
      ip:       req.ip || req.headers['x-forwarded-for']?.split(',')[0] || undefined,
      ua:       (req.headers['user-agent'] || '').slice(0, 200) || undefined
    });
  });
  next();
}

module.exports = {
  logger,
  requestIdMiddleware,
  httpAccessLog
};
