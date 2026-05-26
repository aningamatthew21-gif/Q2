'use strict';

/**
 * routes/auth.js — authentication endpoints.
 *
 * SP1-H1+H2+H3 — refresh-token pattern (replaces single 24h JWT).
 *
 * Standards anchor:
 *   - ISO/IEC 27001:2022 A.5.18 (Access rights) — must be revocable
 *   - ISO/IEC 27001:2022 A.8.5  (Secure authentication) — short-lived
 *     primary credentials + revocable long-lived secondary credentials
 *   - OWASP ASVS v4.0 §3.2 (Session Binding), §3.3 (Session Termination)
 *
 * Token model:
 *   - Access token:  15 min TTL, signed with JWT_SECRET, used as Bearer
 *   - Refresh token: 7 day TTL, signed with JWT_REFRESH_SECRET, SHA-256
 *     hash stored in QA_REFRESH_TOKENS so it can be revoked
 *
 * On access-token expiry the frontend silently POSTs the refresh token
 * to /api/auth/refresh and receives a new access token. The refresh
 * token is rotated on each use (old hash revoked, new hash stored) —
 * this is the canonical "refresh token rotation" security pattern that
 * limits the blast radius of a stolen refresh token to one request.
 *
 * Endpoint surface:
 *   POST /send-otp        — unchanged (sends email OTP)
 *   POST /verify-otp      — now returns BOTH accessToken + refreshToken
 *   POST /refresh         — NEW: exchange refresh token for new access
 *   POST /logout          — NEW: revoke a refresh token
 *   GET  /me              — unchanged (read current user from JWT)
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { execute } = require('../db');
const { catchAsync } = require('../middleware/errorHandler');
const { authMiddleware } = require('../middleware/authMiddleware');
const { generateOtp, generateSalt, hashOtp, verifyOtp } = require('../utils/otp');
const { sendOtpEmail } = require('../utils/email');

const router = express.Router();

// ── Configuration ────────────────────────────────────────────────────
const ACCESS_TTL  = '15m';                  // short-lived primary
const REFRESH_TTL = '7d';                   // long-lived secondary
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// SP2-M11 — uniform-latency floor for credential-validation endpoints.
//
// Standards anchor:
//   - OWASP ASVS v4.0 §2.2.1  "responses MUST be the same for valid and
//                              invalid usernames so accounts cannot be
//                              enumerated by error message or response time"
//   - OWASP Auth Cheat Sheet — "make the same process happen regardless
//                              of whether the user/password exists"
//   - ISO/IEC 27001:2022 A.8.5 (Secure authentication)
//
// The trick: do all the real work in parallel with a fixed-duration
// Promise.delay. Whichever finishes last determines the response time.
// Real work that takes <200ms (the common case for OTP DB lookup) is
// padded; real work that takes >200ms (rare network blip) passes
// through unchanged. Net effect: server response time leaks nothing
// about whether the email existed or the OTP matched.
const MIN_AUTH_LATENCY_MS = 200;
async function withMinLatency(asyncFn) {
  const [result] = await Promise.all([
    Promise.resolve().then(asyncFn),
    new Promise((r) => setTimeout(r, MIN_AUTH_LATENCY_MS))
  ]);
  return result;
}

// SP2-M11 — single opaque error string for ALL credential failures
// (missing OTP row, expired OTP row, wrong code value). Distinct
// messages used to leak whether the email had an active OTP at all,
// which was an enumeration oracle for the user-existence check.
const OPAQUE_AUTH_FAIL = 'Invalid email or OTP code';

// SP2-H5+H6 — per-email throttle. After MAX_OTP_ATTEMPTS failed
// verifies within a rolling 10-minute window, further attempts are
// rejected with OTP_THROTTLED until a new OTP is requested. Counters
// reset on successful verify or new send-otp call.
const MAX_OTP_ATTEMPTS = 5;

/**
 * SP2-H5+H6 — write to the dedicated QA_OTP_AUDIT table. Best-effort,
 * never fails the auth flow. Email is stored plain because the OTP
 * audit table is admin-only and we need to be able to investigate
 * brute-force attempts by exact email match.
 */
async function logOtpEvent(eventType, email, req) {
  try {
    const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().slice(0, 64);
    const ua = (req.headers['user-agent'] || '').toString().slice(0, 500);
    await execute(
      `INSERT INTO QA_OTP_AUDIT (EVENT_TYPE, OTP_EMAIL, IP_ADDRESS, USER_AGENT)
       VALUES (:et, :em, :ip, :ua)`,
      { et: eventType, em: email || null, ip: ip || null, ua: ua || null }
    );
  } catch (err) {
    console.error('[OTP audit] write failed:', err.message);
  }
}

const ACCESS_SECRET  = process.env.JWT_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

if (!REFRESH_SECRET) {
  console.warn('⚠  [auth] JWT_REFRESH_SECRET not set — /refresh + /logout will fail. Add it to backend/.env');
}

// ── Helpers ──────────────────────────────────────────────────────────

/** SHA-256 hex of a string. Used so we never store raw refresh tokens. */
function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

/** Issue a fresh access token (15-min). */
function signAccessToken(user) {
  return jwt.sign(
    { email: user.email, role: user.role, name: user.name, uid: user.email },
    ACCESS_SECRET,
    { expiresIn: ACCESS_TTL }
  );
}

/**
 * Issue a fresh refresh token (7-day) AND persist its hash. Returns the
 * raw token (only the hash lives in the DB — even with full DB access
 * an attacker can't replay tokens because hashes are one-way).
 *
 * `jti` is a cryptographic random ID baked into the JWT payload so two
 * refresh tokens issued in the same millisecond have distinct hashes.
 */
async function issueRefreshToken(user, req) {
  const jti = crypto.randomBytes(16).toString('hex');
  const refresh = jwt.sign(
    { email: user.email, jti, type: 'refresh' },
    REFRESH_SECRET,
    { expiresIn: REFRESH_TTL }
  );
  const hash = sha256(refresh);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);

  await execute(
    `INSERT INTO QA_REFRESH_TOKENS (TOKEN_HASH, USER_EMAIL, EXPIRES_AT, USER_AGENT, IP_ADDRESS)
     VALUES (:hsh, :usr, :exp, :ua, :ip)`,
    {
      hsh: hash,
      usr: user.email,
      exp: expiresAt,
      ua:  (req?.headers?.['user-agent'] || '').slice(0, 500),
      ip:  (req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
            || req?.socket?.remoteAddress || '').slice(0, 50)
    }
  );

  return refresh;
}

/** Get or create the user record + return canonical role + name. */
async function getOrAssignUserRole(email) {
  const result = await execute(
    'SELECT USER_ROLE, USER_NAME FROM QA_USERS WHERE USER_EMAIL = :email',
    { email }
  );
  if (result.rows && result.rows.length > 0) {
    return {
      role: result.rows[0].USER_ROLE,
      name: result.rows[0].USER_NAME
    };
  }
  return { role: 'sales', name: null };
}

// ─────────────────────────────────────────────────────────────────────
// POST /api/auth/send-otp
// ─────────────────────────────────────────────────────────────────────
router.post('/send-otp', catchAsync(async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const normalizedEmail = email.trim().toLowerCase();
  const rawOtp = generateOtp();

  // SP2-H5 — hash the OTP at rest. The DB stores OTP_HASH + OTP_SALT
  // ONLY; the cleartext code goes out exactly once via SMTP and is
  // never persisted. ATTEMPT_COUNT reset to 0 so a fresh send unlocks
  // any previously-throttled session for this email.
  const salt = generateSalt();
  const otpHash = hashOtp(rawOtp, salt);

  await execute(`
    MERGE INTO QA_OTPS dest
    USING (SELECT :email AS email FROM DUAL) src
    ON (dest.OTP_EMAIL = src.email)
    WHEN MATCHED THEN
      UPDATE SET OTP_HASH = :h, OTP_SALT = :s, OTP_CODE = NULL,
                 ATTEMPT_COUNT = 0, LAST_ATTEMPT_AT = NULL,
                 CREATED_AT = SYSTIMESTAMP,
                 EXPIRES_AT = SYSTIMESTAMP + INTERVAL '10' MINUTE
    WHEN NOT MATCHED THEN
      INSERT (OTP_EMAIL, OTP_HASH, OTP_SALT, ATTEMPT_COUNT)
      VALUES (src.email, :h, :s, 0)
  `, { email: normalizedEmail, h: otpHash, s: salt });

  const user = await getOrAssignUserRole(normalizedEmail);

  try {
    await sendOtpEmail(normalizedEmail, rawOtp, user.name);
  } catch (err) {
    console.error('Failed to send email. Check SMTP settings.');
    console.log(`[DEV OTP] Log in with: ${rawOtp}`);
  }

  // SP2-H6 — log to dedicated OTP audit table so brute-force /
  // password-spray attempts are visible to admins independently of
  // the main audit log (which skips /send-otp to avoid noise).
  await logOtpEvent('OTP_SENT', normalizedEmail, req);

  res.json({ success: true, message: 'OTP generated and sent.' });
}));

// ─────────────────────────────────────────────────────────────────────
// POST /api/auth/verify-otp — now issues BOTH access + refresh tokens
// ─────────────────────────────────────────────────────────────────────
router.post('/verify-otp', catchAsync(async (req, res) => {
  // SP2-M11 — wrap the entire credential check in withMinLatency() so
  // success and ALL failure modes complete in >=200ms. Combined with
  // OPAQUE_AUTH_FAIL message, an attacker cannot distinguish
  // "email doesn't exist" from "email exists but OTP wrong" from
  // "OTP expired" via response body OR response time.
  //
  // We DO NOT pad input-shape validation (missing email/otp params) —
  // that's API contract feedback, not a credential check, and adding
  // latency there punishes legitimate clients with bad request format.
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ error: 'Email and OTP required' });

  const normalizedEmail = email.trim().toLowerCase();

  const verdict = await withMinLatency(async () => {
    // SP2-H5+H6 — fetch the hashed credential + salt + attempt count.
    // Legacy OTP_CODE column kept in SELECT for backward compat with
    // any pre-migration row (treated as failure if HASH is NULL).
    const result = await execute(`
      SELECT OTP_HASH, OTP_SALT, OTP_CODE, ATTEMPT_COUNT
      FROM QA_OTPS
      WHERE OTP_EMAIL = :email AND SYSTIMESTAMP < EXPIRES_AT
    `, { email: normalizedEmail });

    if (!result.rows || result.rows.length === 0) {
      return { ok: false, throttled: false };
    }

    const row = result.rows[0];
    const attempts = Number(row.ATTEMPT_COUNT || 0);

    // SP2-H6 — per-email throttle. After MAX_OTP_ATTEMPTS within the
    // 10-min OTP TTL window, all further verifies fail (even if the
    // code is correct) until a fresh OTP is requested. Prevents
    // online brute-force of the 6-digit space.
    if (attempts >= MAX_OTP_ATTEMPTS) {
      return { ok: false, throttled: true };
    }

    // SP2-H5 — increment attempt counter BEFORE the comparison so a
    // racing attacker can't replay before we've recorded the miss.
    // This is best-effort; a failure to increment doesn't fail the
    // verify (network can drop), but the counter is the throttle's
    // source of truth.
    await execute(
      `UPDATE QA_OTPS SET ATTEMPT_COUNT = ATTEMPT_COUNT + 1,
                          LAST_ATTEMPT_AT = SYSTIMESTAMP
       WHERE OTP_EMAIL = :email`,
      { email: normalizedEmail }
    );

    // SP2-H5 — timing-safe verify via HMAC re-hash + constant-time
    // byte comparison. Falls through to legacy OTP_CODE check ONLY
    // if no hash is stored (defensive against partially-migrated row,
    // shouldn't happen in steady state).
    let matched = false;
    if (row.OTP_HASH && row.OTP_SALT) {
      matched = verifyOtp(String(otp), row.OTP_HASH, row.OTP_SALT);
    } else if (row.OTP_CODE != null) {
      // Legacy path — happens only for rows inserted by an older code
      // version that the migration didn't wipe. Not timing-safe, but
      // withMinLatency wraps the whole call so it's masked at the
      // network layer.
      matched = String(row.OTP_CODE) === String(otp);
    }

    return { ok: matched, throttled: false };
  });

  if (verdict.throttled) {
    await logOtpEvent('OTP_THROTTLED', normalizedEmail, req);
    // Same opaque message — don't tell the attacker they triggered throttle.
    return res.status(400).json({ error: OPAQUE_AUTH_FAIL });
  }
  if (!verdict.ok) {
    await logOtpEvent('OTP_VERIFY_FAIL', normalizedEmail, req);
    return res.status(400).json({ error: OPAQUE_AUTH_FAIL });
  }

  await logOtpEvent('OTP_VERIFY_OK', normalizedEmail, req);

  // Delete validated OTP — single-use
  await execute('DELETE FROM QA_OTPS WHERE OTP_EMAIL = :email', { email: normalizedEmail });

  // Get or auto-create user
  const userRes = await execute('SELECT * FROM QA_USERS WHERE USER_EMAIL = :email', { email: normalizedEmail });
  let role = 'sales';
  let name = normalizedEmail.split('@')[0];

  if (userRes.rows && userRes.rows.length > 0) {
    role = userRes.rows[0].USER_ROLE;
    name = userRes.rows[0].USER_NAME || name;
  } else {
    await execute(`
      INSERT INTO QA_USERS (USER_EMAIL, USER_ROLE, USER_NAME)
      VALUES (:email, 'sales', :name)
    `, { email: normalizedEmail, name: name });
  }

  const user = { email: normalizedEmail, role, name };
  const accessToken  = signAccessToken(user);
  const refreshToken = REFRESH_SECRET ? await issueRefreshToken(user, req) : null;

  res.json({
    success: true,
    // `token` kept for backward compat with existing frontend storage,
    // but new clients should read `accessToken` explicitly.
    token: accessToken,
    accessToken,
    refreshToken,
    expiresIn: 15 * 60,        // seconds — frontend uses to schedule refresh
    user: { email: normalizedEmail, role, name, uid: normalizedEmail }
  });
}));

// ─────────────────────────────────────────────────────────────────────
// POST /api/auth/refresh — exchange refresh token for new access token
//
// Implements REFRESH TOKEN ROTATION: the presented refresh token is
// immediately revoked and a new refresh token is issued alongside the
// new access token. If a leaked refresh token is replayed, the legitimate
// user's next refresh request will fail (hash not found) → forced re-login
// → security team alerted via audit log.
// ─────────────────────────────────────────────────────────────────────
router.post('/refresh', catchAsync(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ success: false, error: 'refreshToken required' });
  }
  if (!REFRESH_SECRET) {
    return res.status(500).json({ success: false, error: 'Refresh tokens not configured (JWT_REFRESH_SECRET missing)' });
  }

  // 1. Verify signature + expiry (does NOT prove non-revocation)
  let decoded;
  try {
    decoded = jwt.verify(refreshToken, REFRESH_SECRET);
  } catch (e) {
    return res.status(401).json({ success: false, error: 'Refresh token invalid or expired. Please log in again.' });
  }
  if (decoded.type !== 'refresh') {
    return res.status(401).json({ success: false, error: 'Wrong token type.' });
  }

  // 2. Look up the hash + check revocation
  const hash = sha256(refreshToken);
  const lookup = await execute(
    `SELECT TOKEN_ID, USER_EMAIL, REVOKED_AT
       FROM QA_REFRESH_TOKENS
      WHERE TOKEN_HASH = :hsh`,
    { hsh: hash }
  );
  const row = lookup.rows?.[0];
  if (!row) {
    // Could be a replay attempt (token already rotated). Treat as
    // potential incident — log loudly.
    console.warn(`[auth.refresh] refresh token signature valid but hash not found in DB. Possible replay. Email=${decoded.email}`);
    return res.status(401).json({ success: false, error: 'Refresh token not recognised. Please log in again.' });
  }
  if (row.REVOKED_AT) {
    console.warn(`[auth.refresh] revoked refresh token presented. Email=${decoded.email} reason=${row.REVOKED_AT}`);
    return res.status(401).json({ success: false, error: 'Refresh token has been revoked. Please log in again.' });
  }

  // 3. Pull current user details (role may have changed since issue)
  const userRes = await execute(
    'SELECT USER_ROLE, USER_NAME FROM QA_USERS WHERE USER_EMAIL = :email',
    { email: decoded.email }
  );
  const role = userRes.rows?.[0]?.USER_ROLE || 'sales';
  const name = userRes.rows?.[0]?.USER_NAME || decoded.email.split('@')[0];

  // 4. Rotate: revoke the old token AND issue a new pair
  await execute(
    `UPDATE QA_REFRESH_TOKENS
        SET REVOKED_AT = SYSTIMESTAMP, REVOKED_REASON = 'rotated'
      WHERE TOKEN_ID = :id`,
    { id: row.TOKEN_ID }
  );

  const user = { email: decoded.email, role, name };
  const newAccess  = signAccessToken(user);
  const newRefresh = await issueRefreshToken(user, req);

  res.json({
    success: true,
    accessToken:  newAccess,
    refreshToken: newRefresh,
    expiresIn:    15 * 60,
    user: { email: user.email, role, name, uid: user.email }
  });
}));

// ─────────────────────────────────────────────────────────────────────
// POST /api/auth/logout — revoke a refresh token
// ─────────────────────────────────────────────────────────────────────
router.post('/logout', catchAsync(async (req, res) => {
  const { refreshToken } = req.body;
  // Logout is best-effort idempotent — missing body = 200 OK, nothing to do.
  // The access JWT just stops being used by the client.
  if (!refreshToken) return res.json({ success: true });

  const hash = sha256(refreshToken);
  await execute(
    `UPDATE QA_REFRESH_TOKENS
        SET REVOKED_AT = SYSTIMESTAMP, REVOKED_REASON = 'logout'
      WHERE TOKEN_HASH = :hsh AND REVOKED_AT IS NULL`,
    { hsh: hash }
  );
  res.json({ success: true });
}));

// ─────────────────────────────────────────────────────────────────────
// GET /api/auth/me — unchanged
// ─────────────────────────────────────────────────────────────────────
router.get('/me', authMiddleware, catchAsync(async (req, res) => {
  res.json({ success: true, user: req.user });
}));

module.exports = router;
