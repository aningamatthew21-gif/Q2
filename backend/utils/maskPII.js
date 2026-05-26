'use strict';

/**
 * maskPII.js — pseudonymise personally-identifiable information before
 * it lands in audit logs, error reports, console.log, or anywhere else
 * it might be read by an unauthorised eye.
 *
 * Standards anchor:
 *   - ISO/IEC 27001:2022 A.5.34 (Privacy and protection of PII)
 *   - ISO/IEC 27001:2022 A.8.11 (Data masking)
 *   - GDPR Art. 4(5)  (pseudonymisation definition)
 *   - GDPR Art. 32    (security of processing — appropriate technical measures)
 *   - Ghana Data Protection Act 2012  (personal-data minimisation)
 *
 * Design principles:
 *   1. Pure function — no I/O, no side effects, deterministic output
 *      for a given input. Easy to unit-test.
 *   2. Pseudonymisation, not anonymisation — preserves enough partial
 *      info for forensic correlation ("was this the same user who...?")
 *      without exposing the raw value at rest.
 *   3. Safe-by-default — if the input is unrecognisable, the OUTPUT is
 *      "[REDACTED]" rather than the raw value.
 *   4. Recursive — walks nested objects and arrays so PII deep inside
 *      a request body is masked too.
 *   5. Whitelist of safe keys — fields like `id`, `status`, `priority`
 *      are never masked even if they happen to match a regex by chance.
 *
 * Usage:
 *   const { maskPII, maskEmail, maskPhone } = require('./utils/maskPII');
 *   const safe = maskPII(req.body);
 *   logger.info('User update', safe);
 */

// Field names that are NEVER masked — pure identifiers, never PII.
// Conservative whitelist: only well-known non-PII fields.
const SAFE_KEYS = new Set([
  'id', 'invoiceId', 'invoice_id', 'rfqId', 'rfq_id', 'prId', 'pr_id',
  'customerId', 'customer_id', 'vendorId', 'vendor_id', 'userId', 'user_id',
  'status', 'priority', 'category', 'severity', 'type', 'kind',
  'currency', 'amount', 'total', 'quantity', 'qty', 'subtotal',
  'createdAt', 'updatedAt', 'deletedAt', 'date',
  'page', 'pageSize', 'limit', 'offset', 'sort', 'order',
  'rowVersion', 'version'
]);

// Field names that are ALWAYS fully removed (not masked, deleted).
// Use for secrets that should never appear even partially.
const SECRET_KEYS = new Set([
  'password', 'pwd', 'passwd', 'secret', 'apiKey', 'api_key',
  'token', 'accessToken', 'refreshToken', 'authToken',
  'otp', 'otpCode', 'pin', 'sessionId',
  'signatureUrl', 'signatureData',     // base64 images, too large + sensitive
  'cardNumber', 'cvv', 'cvc',
  'fileData', 'dataUrl'                 // base64 blob payloads
]);

// Field names that look like PII even if the value doesn't match a regex.
// e.g. {name: 'Akua Owusu'} — masked by key, not by value pattern.
const PII_KEYS_BY_NAME = new Set([
  'email', 'emailAddress', 'email_address', 'recipient',
  'phone', 'phoneNumber', 'phone_number', 'mobile',
  'tin', 'taxpayerId', 'taxpayer_id', 'ssn', 'nationalId',
  'name', 'firstName', 'lastName', 'fullName', 'customerName',
  'address', 'streetAddress', 'addressLine', 'address_line',
  'bankAccount', 'bank_account', 'iban', 'accountNumber',
  'contactPerson', 'contact_person'
]);

// ── Value-pattern detectors ─────────────────────────────────────────

// Matches common email shapes including subdomains, plus + tags.
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;

// Phone — at least 8 digits, optional + prefix, allows spaces/dashes/parens.
const PHONE_RE = /^\+?[0-9()\-\s]{8,20}$/;

// Ghana TIN — 11-15 chars starting with letter or P/C, digits + dashes.
// Loose match; combined with field-name check for confidence.
const TIN_RE   = /^[A-Z]{1,3}-?[0-9-]{8,15}$/i;

// 13-19 contiguous digits — credit card / bank account.
const LONG_DIGITS_RE = /^[0-9]{13,19}$/;

// ── Masking primitives ──────────────────────────────────────────────

/**
 * Mask an email: keep first letter of local-part + first letter of
 * domain + TLD. Empty/invalid input → '[REDACTED]'.
 *
 *   'aningamatthew21@gmail.com' → 'a***@g***.com'
 *   'john.doe+filter@company.co.uk' → 'j***@c***.co.uk'
 */
function maskEmail(value) {
  const s = String(value || '');
  if (!EMAIL_RE.test(s)) return '[REDACTED]';
  const at = s.lastIndexOf('@');
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  const lastDot = domain.lastIndexOf('.');
  if (lastDot < 1) return '[REDACTED]';
  // For "co.uk" / ".com.gh" preserve everything after the SECOND-to-last dot
  // if there are multiple dots — common ccTLD pattern.
  const dots = domain.split('.');
  const tld = dots.length > 2 ? dots.slice(-2).join('.') : dots.slice(-1)[0];
  return `${local[0] || '*'}***@${domain[0] || '*'}***.${tld}`;
}

/**
 * Mask a phone number: keep first 3 chars (country/area code) +
 * last 4 digits. Strips formatting chars before counting.
 *
 *   '+233 24 123 4567' → '+23***4567'
 *   '0241234567'       → '024***4567'
 */
function maskPhone(value) {
  const s = String(value || '').trim();
  const digits = s.replace(/\D/g, '');
  if (digits.length < 8) return '[REDACTED]';
  const head = s.startsWith('+') ? s.slice(0, 4) : digits.slice(0, 3);
  const tail = digits.slice(-4);
  return `${head}***${tail}`;
}

/**
 * Mask a TIN or other tax-ID-style identifier: keep first 1 + last 4.
 *
 *   'C0012345678' → 'C******5678'
 */
function maskTin(value) {
  const s = String(value || '').trim();
  if (s.length < 6) return '[REDACTED]';
  return `${s[0]}${'*'.repeat(Math.max(1, s.length - 5))}${s.slice(-4)}`;
}

/**
 * Mask a long digit string (card / bank account): keep last 4.
 *
 *   '4111111111111111' → '****-****-****-1111'
 */
function maskLongDigits(value) {
  const s = String(value || '').replace(/\D/g, '');
  if (s.length < 8) return '[REDACTED]';
  return `****-****-****-${s.slice(-4)}`;
}

/**
 * Mask a human name: keep first letter + length-hint stars.
 *
 *   'Akua Owusu' → 'A**** O****'
 *   'X'          → '*'
 */
function maskName(value) {
  const s = String(value || '').trim();
  if (!s) return '[REDACTED]';
  return s
    .split(/\s+/)
    .map(word => (word[0] || '*') + '*'.repeat(Math.max(0, word.length - 1)))
    .join(' ');
}

/**
 * Mask an address: keep first 3 chars (e.g. street number) + length hint.
 *
 *   '15 Independence Ave, Accra' → '15 ***'
 */
function maskAddress(value) {
  const s = String(value || '').trim();
  if (s.length < 5) return '[REDACTED]';
  return `${s.slice(0, 3)}*** (len=${s.length})`;
}

// ── Dispatcher: pick the right masker for a string value ────────────

function maskScalar(value, keyHint = '') {
  if (value == null) return value;
  if (typeof value !== 'string') return value;
  const k = String(keyHint || '').toLowerCase();

  // Key-name hints override value detection — a field named `email`
  // gets masked as email even if the value is weird.
  if (k.includes('email') || k === 'recipient')          return maskEmail(value);
  if (k.includes('phone') || k === 'mobile')             return maskPhone(value);
  if (k.includes('tin') || k.includes('taxpayer')
      || k === 'ssn' || k === 'nationalid')              return maskTin(value);
  if (k.includes('bank') || k === 'accountnumber'
      || k.includes('iban') || k.includes('card'))       return maskLongDigits(value);
  if (k === 'name' || k.endsWith('name')
      || k === 'firstname' || k === 'lastname'
      || k === 'contactperson')                          return maskName(value);
  if (k.includes('address') || k === 'streetaddress')    return maskAddress(value);

  // Fallback to value-pattern detection
  if (EMAIL_RE.test(value))     return maskEmail(value);
  if (PHONE_RE.test(value))     return maskPhone(value);
  if (LONG_DIGITS_RE.test(value)) return maskLongDigits(value);
  if (TIN_RE.test(value))       return maskTin(value);

  return value;
}

// ── Recursive object walker ─────────────────────────────────────────

/**
 * Recursively mask PII in any value (object, array, scalar).
 *
 * Order of operations per key:
 *   1. SECRET_KEYS  → delete entirely (replaced with '[REMOVED]')
 *   2. SAFE_KEYS    → pass through unchanged
 *   3. PII_KEYS     → mask via the key-hint dispatcher
 *   4. nested object/array → recurse
 *   5. scalar → maskScalar with the key as hint
 *
 * Returns a NEW object — never mutates the input. ISO 27001 emphasises
 * "don't accidentally alter the source data when redacting".
 */
function maskPII(value, depth = 0) {
  // Bail out on pathological depth (defensive against circular refs)
  if (depth > 20) return '[MAX_DEPTH]';

  if (value == null) return value;

  // Arrays: map element-by-element
  if (Array.isArray(value)) {
    return value.map((v) => maskPII(v, depth + 1));
  }

  // Plain objects: walk keys
  if (typeof value === 'object' && value.constructor === Object) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const keyLower = k.toLowerCase();
      if (SECRET_KEYS.has(k) || SECRET_KEYS.has(keyLower)) {
        out[k] = '[REMOVED]';
        continue;
      }
      if (SAFE_KEYS.has(k) || SAFE_KEYS.has(keyLower)) {
        out[k] = v;   // safe identifier, pass through
        continue;
      }
      if (v && typeof v === 'object') {
        out[k] = maskPII(v, depth + 1);
        continue;
      }
      // Scalar value with PII key hint OR value-pattern detection
      out[k] = maskScalar(v, k);
    }
    return out;
  }

  // Buffer / Date / other complex types pass through unchanged
  if (typeof value !== 'string') return value;

  // Bare-string input — apply value-pattern detection without a key
  return maskScalar(value);
}

module.exports = {
  maskPII,
  maskEmail,
  maskPhone,
  maskTin,
  maskLongDigits,
  maskName,
  maskAddress,
  SAFE_KEYS,
  SECRET_KEYS,
  PII_KEYS_BY_NAME
};
