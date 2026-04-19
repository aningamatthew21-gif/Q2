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
  oracledb.fetchTypeMap = new Map([
    [oracledb.CLOB,      { type: oracledb.STRING }],  // Auto-fetch CLOBs as strings
    [oracledb.BLOB,      { type: oracledb.BUFFER }],  // Auto-fetch BLOBs as Buffer
  ]);

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
 * Health check — returns true if a query succeeds
 */
async function ping() {
  try {
    await execute('SELECT 1 FROM DUAL');
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { initPool, execute, transaction, closePool, ping, lobToString };
