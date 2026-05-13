'use strict';

const jwt = require('jsonwebtoken');
const {
  can,
  legacyRoleToTiered,
  SOD_RULES,
  ROLES
} = require('../../shared/permissions');

/**
 * authMiddleware
 * ──────────────
 * JWT verification + role normalisation. Every authenticated route runs
 * this first so `req.user` always carries the canonical tiered role
 * (sales_officer, finance_head, etc.) regardless of whether the JWT was
 * minted in the legacy single-word format (`sales`, `controller`, …) or
 * the new tiered format.
 *
 * The legacy mapping is conservative — existing tokens keep their day-one
 * power without forced re-login. New tokens are minted with the tiered
 * role already in place (see backend/routes/auth.js).
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error:   'Authentication required. No token provided.'
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Canonicalise the role: if the JWT carries a legacy single-word role,
    // we upgrade it in-memory so downstream middleware (requirePermission)
    // operates on the tiered model consistently. The token itself is NOT
    // mutated — the user just gets the right grants for this request.
    const rawRole    = decoded.role;
    const tieredRole = isTieredRole(rawRole) ? rawRole : legacyRoleToTiered(rawRole);
    req.user = { ...decoded, role: tieredRole, legacyRole: rawRole };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error:   'Session expired. Please log in again.'
      });
    }
    return res.status(401).json({
      success: false,
      error:   'Invalid authentication token.'
    });
  }
}

/** True if `role` is already one of the new tiered role strings. */
function isTieredRole(role) {
  return Object.values(ROLES).indexOf(role) >= 0;
}

/**
 * requireRole(...roles)  — LEGACY, retained for backward compatibility
 * ─────────────────────────────────────────────────────────────────────
 * The old guard pre-dates the permission system. New routes should use
 * `requirePermission(actionKey)` instead. This wrapper kept in place so
 * existing routes that haven't been migrated yet still work; legacy role
 * names map to the tiered roles via legacyRoleToTiered() at JWT decode.
 *
 * Accepts EITHER legacy single-word roles OR tiered role strings.
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(403).json({ success: false, error: 'Access denied.' });
    }
    // Normalise required-role list against tiered roles
    const want = roles.map(r => isTieredRole(r) ? r : legacyRoleToTiered(r));
    if (want.indexOf(req.user.role) < 0 && req.user.role !== ROLES.ADMIN) {
      return res.status(403).json({
        success: false,
        error:   `Access denied. Required role: ${roles.join(' or ')}.`
      });
    }
    next();
  };
}

/**
 * requirePermission(actionKey [, options])
 * ────────────────────────────────────────
 * The new permission-based guard. Checks the user's tiered role against
 * the shared permissions catalogue.
 *
 *   router.post('/invoices/:id/approve',
 *     authMiddleware,
 *     requirePermission('invoice.approve.finance'),
 *     handler
 *   );
 *
 * Options:
 *   sod:        action key from SOD_RULES; if provided, the middleware
 *               also runs the SoD check against `req.sodEntity` (the
 *               route handler is responsible for loading the entity
 *               and attaching it before the SoD step — see
 *               `sodLoad()` below for a helper).
 *   loadEntity: function(req) -> Promise<entity>; if provided, the
 *               middleware loads the entity itself, attaches it to
 *               req.sodEntity, and runs the SoD check. Use this when
 *               the entity load is a single line and you'd rather not
 *               clutter the handler.
 */
function requirePermission(actionKey, options = {}) {
  if (typeof actionKey !== 'string' || !actionKey) {
    throw new Error('requirePermission: actionKey is required (string)');
  }
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(403).json({ success: false, error: 'Access denied.' });
      }
      if (!can(req.user.role, actionKey)) {
        return res.status(403).json({
          success: false,
          error:   `You don't have permission for this action (${actionKey}).`
        });
      }

      // ── Optional Separation of Duties check ──────────────
      const sodKey = options.sod || actionKey;
      const rule   = SOD_RULES[sodKey];
      if (rule) {
        let entity = req.sodEntity;
        if (!entity && typeof options.loadEntity === 'function') {
          entity = await options.loadEntity(req);
          req.sodEntity = entity;
        }
        if (entity && rule.check(req.user, entity) === false) {
          return res.status(403).json({
            success: false,
            error:   `Separation of duties: ${rule.description}`
          });
        }
      }
      next();
    } catch (err) {
      // SoD entity-load failed (e.g. invoice not found). Let the route
      // handle the not-found path itself; auth gate should pass through
      // so the handler can return 404. Logging here for debug.
      console.warn('[requirePermission] entity load failed:', err.message);
      next();
    }
  };
}

/**
 * sodCheckRunner(actionKey)
 * ─────────────────────────
 * Helper for routes that prefer to load the entity themselves (e.g. they
 * already do a SELECT to verify state), then run the SoD rule manually.
 *
 *   const invoice = await loadInvoice(id);
 *   const sodErr  = sodCheckRunner('invoice.approve.finance')(req.user, invoice);
 *   if (sodErr) return res.status(403).json({ success: false, error: sodErr });
 *
 * Returns null on pass, an error message on violation.
 */
function sodCheckRunner(actionKey) {
  return (user, entity) => {
    const rule = SOD_RULES[actionKey];
    if (!rule) return null;
    return rule.check(user, entity) ? null : rule.description;
  };
}

module.exports = {
  authMiddleware,
  requireRole,           // legacy — keep until every route migrates
  requirePermission,     // new — prefer for new routes
  sodCheckRunner
};
