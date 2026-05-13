import React from 'react';
import { useApp } from '../../context/AppContext';
import { can } from '../../utils/permissions';

/**
 * <Can perm="invoice.approve.finance"> ... </Can>
 *
 * Renders its children only when the current authenticated user has the
 * given permission. Used to gate action buttons (Approve / Reject /
 * Delete / Sign / etc.) inside detail pages.
 *
 * Examples:
 *   <Can perm="invoice.approve.finance">
 *     <Button variant="primary" onClick={approve}>Approve</Button>
 *   </Can>
 *
 *   <Can perm="tax.edit" fallback={<span className="text-n-400 text-xs">View only</span>}>
 *     <SaveButton />
 *   </Can>
 *
 *   <Can perm={['rfq.approve.award', 'rfq.reject']} mode="any">  // OR-logic
 *     <ApprovalActions />
 *   </Can>
 *
 *   <Can perm={['vendor.write','vendor.deactivate']} mode="all">  // AND-logic
 *     <VendorPowerControls />
 *   </Can>
 *
 * Props:
 *   perm:       action key string OR array of keys
 *   mode:       'all' (default) or 'any' — only matters when perm is an array
 *   fallback:   node to render when denied (default: null = nothing)
 *   children:   the gated UI
 *
 * Always render-time only. NEVER use this as the sole security boundary —
 * the corresponding backend route MUST also gate the action. This component
 * is purely about avoiding "button is visible but click does nothing" UX.
 */
export default function Can({ perm, mode = 'all', fallback = null, children }) {
  const { appUser } = useApp();
  const allowed = check(appUser, perm, mode);
  return allowed ? <>{children}</> : <>{fallback}</>;
}

function check(appUser, perm, mode) {
  if (!perm) return true;
  if (typeof perm === 'string') return can(appUser, perm);
  if (Array.isArray(perm)) {
    if (perm.length === 0) return true;
    return mode === 'any'
      ? perm.some(p => can(appUser, p))
      : perm.every(p => can(appUser, p));
  }
  return false;
}

/**
 * useCan(perm [, mode]) — hook variant for handlers that need a boolean.
 *
 *   const canApprove = useCan('invoice.approve.finance');
 *   ...
 *   <Button disabled={!canApprove} onClick={...}>Approve</Button>
 *
 * Prefer `<Can>` for JSX — this hook is for ad-hoc decisions in handlers
 * (e.g. conditional API params, route guards in onClick).
 */
export function useCan(perm, mode = 'all') {
  const { appUser } = useApp();
  return check(appUser, perm, mode);
}
