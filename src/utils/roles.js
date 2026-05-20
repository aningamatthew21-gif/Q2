/**
 * src/utils/roles.js — role-aware navigation & department helpers.
 *
 * THE PROBLEM THIS SOLVES
 * ───────────────────────
 * The app was originally written against four FLAT roles —
 * `sales`, `controller`, `procurement`, `admin` — and the codebase is
 * littered with `currentUser.role === 'controller'` style checks.
 *
 * The authorization rebuild introduced TIERED roles
 * (`finance_officer`, `finance_head`, `sales_officer`, `sales_head`,
 * `procurement_officer`, `procurement_head`, `admin`, `customer`).
 * Every legacy `=== 'controller'` check silently fails for a
 * `finance_head` user, so a finance head fell through to the wrong
 * branch everywhere — landing on the sales dashboard, the back button
 * dumping them on the wrong page, post-approval navigation sending them
 * to a page their role can't open (the "access restricted" screen).
 *
 * These helpers accept EITHER a legacy role string, a tiered role
 * string, OR an `appUser` object, and answer the questions the UI
 * actually needs ("which department?", "which dashboard?", "which list
 * page should the invoice editor return to?"). Built on the single
 * source of truth in shared/permissions.js so they can never drift.
 */

import {
  ROLE_DEPARTMENT,
  ROLE_TIER,
  ALL_ROLES,
  legacyRoleToTiered
} from './permissions';

/**
 * canonicalRole — normalise any role input to a tiered role string.
 * Accepts a role string (legacy or tiered) or an `{ role }` object.
 */
export function canonicalRole(roleOrUser) {
  if (!roleOrUser) return null;
  const raw = typeof roleOrUser === 'string' ? roleOrUser : roleOrUser.role;
  if (!raw) return null;
  return ALL_ROLES.indexOf(raw) >= 0 ? raw : legacyRoleToTiered(raw);
}

/** Department for a role: 'finance' | 'sales' | 'procurement' | 'system' | 'external'. */
export function roleDepartment(roleOrUser) {
  const r = canonicalRole(roleOrUser);
  return r ? ROLE_DEPARTMENT[r] : null;
}

/** Tier for a role: 'officer' | 'head' | 'admin' | 'customer'. */
export function roleTier(roleOrUser) {
  const r = canonicalRole(roleOrUser);
  return r ? ROLE_TIER[r] : null;
}

export const isFinance     = (r) => roleDepartment(r) === 'finance';
export const isSales       = (r) => roleDepartment(r) === 'sales';
export const isProcurement = (r) => roleDepartment(r) === 'procurement';
export const isAdmin       = (r) => canonicalRole(r) === 'admin';
export const isCustomer    = (r) => canonicalRole(r) === 'customer';

export const isHead    = (r) => roleTier(r) === 'head';
export const isOfficer = (r) => roleTier(r) === 'officer';

/**
 * isElevated — a "head" or an admin: the people allowed to take
 * department-level decisions (approvals, overrides). Officers are not
 * elevated; they do data entry and route work up.
 */
export const isElevated = (r) => {
  const t = roleTier(r);
  return t === 'head' || t === 'admin';
};

/**
 * isFinanceController — the modern equivalent of the legacy
 * `role === 'controller'` check. True for any finance-department user
 * OR an admin. Use this anywhere the old code asked "is this a
 * controller?" and meant "can this person work the finance desk".
 */
export const isFinanceController = (r) => isFinance(r) || isAdmin(r);

/**
 * landingPageFor — the dashboard a role should land on after login or
 * session-restore. Replaces AppContext's legacy `roleToLandingPage`,
 * which only knew the four flat roles and dumped every tiered role on
 * the sales dashboard via its `default:` branch.
 */
export function landingPageFor(roleOrUser) {
  if (isAdmin(roleOrUser) || isFinance(roleOrUser)) return 'controllerDashboard';
  if (isProcurement(roleOrUser))                    return 'procurementDashboard';
  if (isCustomer(roleOrUser))                       return 'customerPortal';
  return 'salesDashboard';
}

/**
 * invoiceListPageFor — the list page the invoice editor should return
 * to for a given role. Used as the fallback when navigation didn't pass
 * an explicit `returnTo`.
 *
 *   finance / admin → 'invoices'   (All Invoices — gated by invoice.read.all)
 *   sales           → 'myInvoices' (gated by invoice.read.own)
 *   anything else   → that role's landing dashboard
 */
export function invoiceListPageFor(roleOrUser) {
  if (isAdmin(roleOrUser) || isFinance(roleOrUser)) return 'invoices';
  if (isSales(roleOrUser))                          return 'myInvoices';
  return landingPageFor(roleOrUser);
}

/**
 * resolveReturnPage — pick where a sub-page (editor / detail view)
 * should send the user when they cancel or finish.
 *
 * Prefers an explicit `returnTo` handed in via pageContext (the
 * industry-standard "return URL" pattern — the caller knows best where
 * the user came from), and falls back to a role-aware default so the
 * navigation is always sensible even for entry points that don't pass
 * one.
 */
export function resolveReturnPage(pageContext, roleOrUser, fallback) {
  const returnTo = pageContext && pageContext.returnTo;
  if (returnTo) return returnTo;
  if (fallback) return fallback;
  return invoiceListPageFor(roleOrUser);
}
