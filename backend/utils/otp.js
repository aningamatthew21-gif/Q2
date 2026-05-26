'use strict';

const crypto = require('crypto');

/**
 * utils/otp.js — secure OTP generation, hashing, and timing-safe
 * comparison.
 *
 * Standards anchor:
 *   - NIST SP 800-63B §5.1.4 (short-lived look-up secrets)
 *   - OWASP Password Storage Cheat Sheet (salt + pepper pattern)
 *   - ISO/IEC 27001:2022 A.5.17 (Authentication information secrecy)
 *
 * Threat model:
 *   - DB dump → attacker has OTP_HASH + OTP_SALT but NOT the pepper.
 *     6-digit space (1M combinations) is brute-forceable in seconds
 *     WITHOUT pepper. WITH pepper, attacker also needs the .env value.
 *   - Network attacker → timing-safe comparison + the M11 latency
 *     floor (auth.js withMinLatency) make string-position guessing
 *     attacks infeasible.
 *   - Rainbow-table attacker → per-row salt makes precomputed tables
 *     useless even if the pepper is leaked.
 *
 * The pepper lives in process.env.OTP_PEPPER. Generate with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

const PEPPER = process.env.OTP_PEPPER || '';

if (!PEPPER && process.env.NODE_ENV === 'production') {
  // Fail loud in production — never run with a missing pepper.
  throw new Error(
    'OTP_PEPPER environment variable is REQUIRED in production. ' +
    'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  );
} else if (!PEPPER) {
  console.warn(
    '⚠  OTP_PEPPER not set — OTP hashes will use empty pepper. ' +
    'Set it in .env before any production deploy.'
  );
}

/**
 * Generate a cryptographically secure 6-digit OTP.
 * Uses crypto.randomInt for unbiased range (vs Math.random + modulo).
 */
function generateOtp() {
  return String(crypto.randomInt(100000, 1000000)).padStart(6, '0');
}

/**
 * Generate a 16-byte random salt (32 hex chars).
 * Per-OTP salt — defeats rainbow tables.
 */
function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Hash an OTP with HMAC-SHA-256 using the per-row salt as the key and
 * (otp + pepper) as the message. This binds the hash to BOTH the salt
 * (per-row uniqueness) AND the pepper (DB-dump resistance).
 *
 * Returns a 64-char hex string suitable for storage in
 * QA_OTPS.OTP_HASH VARCHAR2(64).
 */
function hashOtp(otp, salt) {
  // HMAC over (otp + pepper) keyed by salt. Cryptographically equivalent
  // to SHA256(salt || otp || pepper) but with HMAC's well-known proofs
  // against length-extension attacks.
  return crypto
    .createHmac('sha256', salt)
    .update(String(otp) + PEPPER)
    .digest('hex');
}

/**
 * Timing-safe comparison of two hex strings of equal length.
 * Returns false on length mismatch WITHOUT calling timingSafeEqual
 * (which throws on length mismatch). Returns true only on exact match
 * in constant time relative to the position of any mismatched byte.
 *
 * Per Node docs: "Use crypto.timingSafeEqual to prevent timing attacks
 * when comparing values such as HMAC digests or secret values."
 */
function timingSafeEqualHex(aHex, bHex) {
  if (typeof aHex !== 'string' || typeof bHex !== 'string') return false;
  if (aHex.length !== bHex.length) return false;
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Verify a submitted OTP against the stored (hash, salt) tuple.
 * Returns true iff the OTP matches.
 */
function verifyOtp(submittedOtp, storedHash, storedSalt) {
  if (!submittedOtp || !storedHash || !storedSalt) return false;
  const computed = hashOtp(submittedOtp, storedSalt);
  return timingSafeEqualHex(computed, storedHash);
}

module.exports = {
  generateOtp,
  generateSalt,
  hashOtp,
  verifyOtp,
  timingSafeEqualHex
};
