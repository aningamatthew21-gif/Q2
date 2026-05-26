'use strict';

/**
 * secretsCheck.js — boot-time guard against weak / default / leaked secrets.
 *
 * Standards anchor:
 *   - ISO/IEC 27001:2022 A.5.17 (Authentication information) — secrets
 *     must be of sufficient strength and rotated when compromised.
 *   - ISO/IEC 27001:2022 A.8.2  (Privileged access rights) — admin-tier
 *     credentials require additional control.
 *   - OWASP ASVS v4.0 §2.4 (Credential Storage / Strength).
 *
 * Behaviour:
 *   - DEV:  prints warnings but allows boot. Lets developers iterate
 *     without forcing rotation on every fresh clone.
 *   - PROD: refuses to boot if any CRITICAL check fails. ISO 27001 calls
 *     for "fail-secure" behaviour on misconfigured production systems.
 *
 * Add new checks by appending to the CHECKS array. Each check has:
 *   - name        — short label for the log line
 *   - level       — 'critical' (blocks prod boot) | 'warn' (always warns)
 *   - test(env)   — returns null if OK, else a string explaining the gap
 */

// Known weak / default / placeholder values that should never reach prod.
// Keep the list short and obvious; ISO calls this an "approved bad-secret
// list" — distinct from password-blacklist DBs (which are out of scope here).
const KNOWN_WEAK = new Set([
  '', 'changeme', 'change-me', 'secret', 'password', 'admin', 'test',
  'your-jwt-secret', 'your_jwt_secret', 'your-secret', 'placeholder',
  'devsecret', 'dev_secret', 'foo', 'bar', '12345', 'abc123',
  '<GENERATE_96_HEX_CHARS_VIA_CRYPTO_RANDOMBYTES_48>',
  '<GENERATE_96_HEX_CHARS_SEPARATELY>',
  '<STRONG_DB_PASSWORD_MIN_12_CHARS>'
]);

const CHECKS = [
  {
    name:  'JWT_SECRET present',
    level: 'critical',
    test:  (env) => env.JWT_SECRET ? null : 'JWT_SECRET is not set'
  },
  {
    name:  'JWT_SECRET strength',
    level: 'critical',
    test:  (env) => {
      const v = env.JWT_SECRET || '';
      if (KNOWN_WEAK.has(v.toLowerCase())) return 'JWT_SECRET matches a known placeholder value';
      if (v.length < 32) return `JWT_SECRET is ${v.length} chars; minimum 32 required (per ISO 27001 A.5.17)`;
      // Entropy heuristic: count distinct characters. Real random hex has
      // ≥ 16 distinct chars. A pasted dictionary word might have 3-8.
      const distinct = new Set(v).size;
      if (distinct < 12) return `JWT_SECRET has only ${distinct} distinct characters — looks low-entropy. Generate via: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`;
      return null;
    }
  },
  {
    name:  'JWT_REFRESH_SECRET differs from JWT_SECRET',
    level: 'warn',          // becomes critical once refresh-token rollout (H1+H2+H3) is live
    test:  (env) => {
      if (!env.JWT_REFRESH_SECRET) return 'JWT_REFRESH_SECRET not set (required once refresh-token flow ships)';
      if (env.JWT_REFRESH_SECRET === env.JWT_SECRET) return 'JWT_REFRESH_SECRET must differ from JWT_SECRET (defence-in-depth)';
      return null;
    }
  },
  {
    name:  'DB_PASSWORD strength',
    level: 'critical',
    test:  (env) => {
      const v = env.DB_PASSWORD || '';
      if (!v) return 'DB_PASSWORD not set';
      if (KNOWN_WEAK.has(v.toLowerCase())) return 'DB_PASSWORD is a known placeholder';
      if (v.length < 12) return `DB_PASSWORD is ${v.length} chars; minimum 12 required`;
      return null;
    }
  },
  {
    name:  'SMTP credentials present',
    level: 'warn',
    test:  (env) => {
      if (!env.SMTP_USER || !env.SMTP_PASS) return 'SMTP_USER / SMTP_PASS not set — OTP email will fail at runtime';
      return null;
    }
  },
  {
    name:  'OpenRouter API key present',
    level: 'warn',
    test:  (env) => {
      if (!env.OPENROUTER_API_KEY) return 'OPENROUTER_API_KEY not set — AI chat features will return 500';
      return null;
    }
  },
  {
    name:  'NODE_ENV explicit in production',
    level: 'warn',
    test:  (env) => {
      // Only meaningful when the operator believes they're in prod
      if (env.NODE_ENV !== 'production' && env.PORT === '80') {
        return 'PORT=80 suggests production but NODE_ENV is not "production" — stack traces may leak to clients';
      }
      return null;
    }
  }
];

/**
 * Run all checks and return { critical: [...], warnings: [...] }.
 * Pure function — no side effects, easy to unit-test.
 */
function evaluate(env = process.env) {
  const critical = [];
  const warnings = [];
  for (const check of CHECKS) {
    const failure = check.test(env);
    if (!failure) continue;
    const entry = `[${check.name}] ${failure}`;
    if (check.level === 'critical') critical.push(entry);
    else warnings.push(entry);
  }
  return { critical, warnings };
}

/**
 * Run checks and act per environment. Call once at server startup,
 * BEFORE the HTTP listener binds.
 *   - Logs every warning
 *   - In NODE_ENV=production, throws on any critical failure (boot aborts)
 *   - In any other env, logs critical failures but allows boot
 */
function enforce(env = process.env, log = console) {
  const { critical, warnings } = evaluate(env);

  if (warnings.length === 0 && critical.length === 0) {
    log.log('🔒 [secretsCheck] All secrets configured per ISO 27001 A.5.17 ✓');
    return;
  }

  for (const w of warnings) log.warn(`⚠  [secretsCheck] ${w}`);

  if (critical.length === 0) return;

  for (const c of critical) log.error(`❌ [secretsCheck] ${c}`);

  if (env.NODE_ENV === 'production') {
    log.error('');
    log.error('🛑 Refusing to boot in production with critical secret failures.');
    log.error('   See backend/.env.example for the required shape and');
    log.error('   docs/SECRETS_ROTATION.md for the rotation runbook.');
    log.error('');
    throw new Error(
      `secretsCheck failed: ${critical.length} critical issue(s) — see logs above`
    );
  }

  log.warn('⚠  Non-production environment — continuing boot despite critical failures.');
  log.warn('   These WILL block deployment to production. Fix before NODE_ENV=production.');
}

module.exports = { evaluate, enforce, CHECKS, KNOWN_WEAK };
