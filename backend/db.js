'use strict';

const oracledb = require('oracledb');

// Helper: safely read a CLOB Lob object or return plain string
async function lobToString(lob) {
  if (!lob) return null;
  if (typeof lob === 'string') return lob;
  // OracleDB Lob stream
  return new Promise((resolve, reject) => {
    let data = '';
    lob.setEncoding('utf8');
    lob.on('data', chunk => { data += chunk; });
    lob.on('end', () => resolve(data));
    lob.on('error', err => reject(err));
  });
}

// ─── THIN MODE: No Oracle Instant Client installation required ──────────────
// Oracle XE is local so thin mode connects directly to the TCP port
// If your company later requires Wallet/mTLS, switch to thick mode

let pool = null;

/**
 * Initialize the Oracle connection pool.
 * Call once at server startup.
 */
async function initPool() {
  if (pool) return pool;

  // UV_THREADPOOL_SIZE must be set before first connection for optimal performance
  process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '16';

  pool = await oracledb.createPool({
    user:          process.env.DB_USER,
    password:      process.env.DB_PASSWORD,
    connectString: process.env.DB_CONNECTION_STRING, // e.g. localhost:1521/XEPDB1

    // Pool configuration for Oracle XE (moderate limits)
    poolMin:       2,   // Minimum connections always alive
    poolMax:       10,  // Maximum concurrent connections
    poolIncrement: 1,   // Connections added when pool is exhausted
    poolTimeout:   60,  // Seconds idle connection lives before eviction
    stmtCacheSize: 30,  // Cached parsed SQL statements per connection

    // Connection validation
    pingInterval: 60,   // Ping idle connections every 60 seconds
  });

  // Set global defaults for all executions
  oracledb.outFormat    = oracledb.OUT_FORMAT_OBJECT; // Row as JS object, not array
  oracledb.autoCommit   = true;

  // CLOB → STRING / BLOB → BUFFER auto-conversion at fetch time.
  // We set BOTH `fetchTypeMap` AND `fetchAsBuffer`/`fetchAsString`
  // because they cover slightly different code paths in oracledb v6:
  //
  //   - fetchTypeMap is the modern API but in practice some queries
  //     receive a raw Lob descriptor anyway (especially when a query
  //     also sets per-column `fetchInfo`, which appears to suppress
  //     the type-map fallback for non-listed columns).
  //   - fetchAsBuffer/fetchAsString are the legacy globals — they
  //     force an independent JS-owned Buffer/String copy of the LOB
  //     contents, NOT a view into the connection's internal memory.
  //
  // The independent-copy guarantee is critical: db.js#execute() releases
  // the pooled connection in `finally` BEFORE the caller reads
  // row.FILE_DATA. If the Buffer is a view over connection memory,
  // those bytes get zeroed when the pool reclaims the connection —
  // producing the infamous "131,484 zero bytes" download corruption
  // bug we hit on attachments.
  oracledb.fetchTypeMap = new Map([
    [oracledb.CLOB, { type: oracledb.STRING }],
    [oracledb.BLOB, { type: oracledb.BUFFER }],
  ]);
  oracledb.fetchAsBuffer = [oracledb.BLOB];
  oracledb.fetchAsString = [oracledb.CLOB];

  console.log('✅ [DB] Oracle connection pool initialized');
  console.log(`   User: ${process.env.DB_USER}`);
  console.log(`   DSN:  ${process.env.DB_CONNECTION_STRING}`);
  console.log(`   Pool: min=${2} max=${10}`);

  return pool;
}

/**
 * Execute a single SQL statement.
 * Automatically acquires and releases a connection.
 * Uses bind variables for SQL injection prevention.
 *
 * @param {string} sql - SQL with :bindName placeholders
 * @param {object|array} binds - Bind values
 * @param {object} opts - Additional oracledb options
 */
async function execute(sql, binds = {}, opts = {}) {
  let conn;
  try {
    conn = await pool.getConnection();
    const result = await conn.execute(sql, binds, {
      outFormat:  oracledb.OUT_FORMAT_OBJECT,
      autoCommit: true,
      fetchInfo: {
        'SIGNATURE_URL': { type: oracledb.STRING },
        'EXTRA_DATA': { type: oracledb.STRING },
        'SETTING_VAL': { type: oracledb.STRING },
        'SIGNATURE_DATA': { type: oracledb.STRING },
        'TAX_BREAKDOWN': { type: oracledb.STRING }
      },
      ...opts,
    });
    return result;
  } catch (err) {
    console.error('[DB] execute() error:', err.message);
    console.error('[DB] SQL:', sql);
    console.error('[DB] Binds:', JSON.stringify(binds));
    throw err;
  } finally {
    if (conn) {
      try { await conn.close(); } catch (_) {}
    }
  }
}

/**
 * Execute multiple statements in a transaction.
 * Rolls back automatically on any error.
 *
 * @param {Function} workFn - async (conn) => { ... }
 */
async function transaction(workFn) {
  let conn;
  try {
    conn = await pool.getConnection();
    const result = await workFn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (_) {}
    }
    throw err;
  } finally {
    if (conn) {
      try { await conn.close(); } catch (_) {}
    }
  }
}

/**
 * Gracefully drain and close the pool.
 * Call on application shutdown (SIGTERM/SIGINT).
 */
async function closePool() {
  if (pool) {
    try {
      await pool.close(10); // 10s drain timeout
      console.log('✅ [DB] Oracle pool closed gracefully');
    } catch (err) {
      console.error('[DB] Error closing pool:', err.message);
    } finally {
      pool = null;
    }
  }
}

/**
 * Health check — returns true if a query succeeds.
 *
 * Internally bounded by `timeoutMs` (default 1000ms) so the /api/health
 * endpoint never hangs the Docker HEALTHCHECK / load-balancer probe
 * when the DB is wedged. A wedged DB on a probe should return false
 * (mark unhealthy) within 1 second, not block for the default Oracle
 * connect timeout (~60s).
 */
async function ping(timeoutMs = 1000) {
  try {
    const result = await Promise.race([
      execute('SELECT 1 AS OK FROM DUAL'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('DB ping timeout')), timeoutMs))
    ]);
    return result && result.rows && result.rows.length > 0;
  } catch (_) {
    return false;
  }
}

/**
 * Pool diagnostics — returns oracledb pool counters, or null if the
 * pool isn't initialised yet. Used by the production /api/health
 * endpoint so on-call can see at-a-glance whether the pool is healthy
 * (low queue, no leaked connections).
 */
function poolStats() {
  if (!pool) return null;
  return {
    connectionsOpen:    pool.connectionsOpen,
    connectionsInUse:   pool.connectionsInUse,
    poolMax:            pool.poolMax,
    poolMin:            pool.poolMin,
    // utilisation as percentage — high values for sustained periods
    // indicate poolMax should be raised
    utilisationPct:     pool.poolMax > 0
      ? Math.round((pool.connectionsInUse / pool.poolMax) * 100)
      : 0
  };
}

/**
 * safeSqlIdent — defensive guard for any place we string-interpolate an
 * SQL identifier (table, column, ORDER BY direction). Returns the value
 * unchanged if it matches the Oracle-identifier grammar; THROWS otherwise.
 *
 * Use anywhere a `${value}` is splice into SQL outside of bind placeholders:
 *
 *   const col = safeSqlIdent(allowedColumns[k]);          // throws if k absent
 *   `UPDATE t SET ${col} = :v WHERE id = :id`             // safe
 *   `... ORDER BY ${safeSqlIdent(orderCol)} ${safeSqlIdent(dir, 'dir')}`
 *
 * Catches: SQL-injection regressions where a future dev forgets to map
 * user input → hardcoded column name. Today no caller is vulnerable
 * (audit 2026-05-25 confirmed), but this exists so any future
 * regression fails LOUDLY at first request rather than silently in
 * production. Per OWASP A03 SQL-Injection Prevention Cheat Sheet —
 * "input validation or query redesign is the most appropriate defense"
 * when bind placeholders can't be used (column/table names).
 *
 * `kind` defaults to 'ident' (alphanumeric + underscore, max 30 chars
 * per Oracle 12c identifier length). For ORDER BY direction pass 'dir'.
 */
function safeSqlIdent(value, kind = 'ident') {
  const s = String(value || '');
  if (kind === 'dir') {
    if (s.toUpperCase() === 'ASC' || s.toUpperCase() === 'DESC') return s.toUpperCase();
    throw new Error(`safeSqlIdent: invalid sort direction "${value}" (expected ASC or DESC)`);
  }
  // Oracle identifier grammar: A-Z, 0-9, _, $, # — case-insensitive,
  // must start with a letter, max 30 chars (12c) / 128 chars (12.2+).
  // We're strict: alphanumeric + underscore only, max 30 chars.
  if (!/^[A-Za-z][A-Za-z0-9_]{0,29}$/.test(s)) {
    throw new Error(`safeSqlIdent: invalid identifier "${value}" — only [A-Za-z0-9_] allowed, max 30 chars`);
  }
  return s;
}

module.exports = { initPool, execute, transaction, closePool, ping, poolStats, lobToString, safeSqlIdent };
