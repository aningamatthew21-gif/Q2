/**
 * src/utils/permissions.js — frontend re-export of the shared permission model.
 *
 * Re-exports the cross-stack `shared/permissions.js` catalogue so React
 * components can import permission helpers from a co-located `utils` path
 * (`import { can } from '../utils/permissions'`) and Vite resolves it
 * through its CommonJS interop layer.
 *
 * Why a thin re-export instead of importing `shared/...` everywhere:
 *   - Keeps consumer imports short and dialect-stable (no `../../../shared`).
 *   - Lets us add frontend-only helpers (`useCan`, etc.) here without
 *     polluting the cross-stack module.
 *   - The actual data lives in `shared/permissions.js` — the file BOTH
 *     frontend and backend read so authorization can never drift.
 */

// shared/permissions.js uses property-style CommonJS exports
// (`exports.X = X`), which Vite's rollup-commonjs analyser can statically
// discover. Named imports work directly without a default-and-destructure
// dance, and Tree-shaking still drops anything the frontend doesn't use.
import {
  ROLES,
  ALL_ROLES,
  DEPARTMENTS,
  ROLE_DEPARTMENT,
  ROLE_TIER,
  ROLE_LABEL,
  ACTIONS,
  ALL_ACTIONS,
  ROLE_ACTIONS,
  PAGE_PERMISSIONS,
  SOD_RULES,
  legacyRoleToTiered,
  can as canRaw,
  canOpenPage as canOpenPageRaw,
  actionsFor
} from '../../shared/permissions.js';

export {
  ROLES,
  ALL_ROLES,
  DEPARTMENTS,
  ROLE_DEPARTMENT,
  ROLE_TIER,
  ROLE_LABEL,
  ACTIONS,
  ALL_ACTIONS,
  ROLE_ACTIONS,
  PAGE_PERMISSIONS,
  SOD_RULES,
  legacyRoleToTiered,
  actionsFor
};

/**
 * can(roleOrUser, action) — slightly more forgiving than the shared `can`.
 *
 * Accepts EITHER a role string or an `appUser` object (`{ role, ... }`).
 * Most React components have the user object handy from `useApp()`, so
 * this saves the destructure at every call site.
 *
 * Legacy single-word roles (`controller`, `sales`, …) are upgraded to
 * tiered roles transparently — matches the backend's authMiddleware
 * behaviour so the two stay consistent.
 */
export function can(roleOrUser, action) {
  const role = extractRole(roleOrUser);
  return canRaw(role, action);
}

/** Same forgiving signature for page-level gates. */
export function canOpenPage(roleOrUser, page) {
  const role = extractRole(roleOrUser);
  return canOpenPageRaw(role, page);
}

function extractRole(roleOrUser) {
  if (!roleOrUser) return null;
  const raw = typeof roleOrUser === 'string' ? roleOrUser : roleOrUser.role;
  if (!raw) return null;
  // Treat legacy roles as their tiered equivalents.
  return looksLikeTiered(raw) ? raw : legacyRoleToTiered(raw);
}

function looksLikeTiered(role) {
  return ALL_ROLES.indexOf(role) >= 0;
}
