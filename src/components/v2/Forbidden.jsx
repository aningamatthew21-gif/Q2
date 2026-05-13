import React from 'react';
import { motion } from 'framer-motion';
import { ShieldOff, ArrowLeft } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import Button from './Button';
import { ROLE_LABEL } from '../../utils/permissions';

/**
 * Forbidden — landing page shown when a user opens a URL their role can't see.
 *
 * Rendered by AppContext when `canOpenPage(appUser, page) === false`. We
 * surface the user's current role and which permission was missing, plus
 * a single CTA back to whichever dashboard their role IS allowed to see.
 *
 * Deliberate omissions:
 *   - We don't tell the user the exact action key required. Internal
 *     plumbing leaking into the UI invites probing. The role + general
 *     message is enough.
 *   - We don't auto-redirect. The user clicked / typed a URL — bouncing
 *     them silently would make the bug hard to reproduce. Make the deny
 *     visible.
 */
export default function Forbidden({ page, requiredPermission }) {
  const { appUser, navigate } = useApp();
  const roleLabel = ROLE_LABEL[appUser?.role] || appUser?.role || 'Unknown';

  const goHome = () => {
    const role = appUser?.role || '';
    if (role.startsWith('finance')        || role === 'admin')       navigate('controllerDashboard');
    else if (role.startsWith('procurement'))                          navigate('procurementDashboard');
    else                                                              navigate('salesDashboard');
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className="min-h-[60vh] flex items-center justify-center px-4"
    >
      <div className="max-w-md w-full bg-white border border-n-200 rounded-panel shadow-card p-8 text-center">
        <div className="w-14 h-14 rounded-full bg-err-soft text-err grid place-items-center mx-auto mb-4">
          <ShieldOff className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-semibold text-n-800 tracking-tight">
          You don’t have access to this page
        </h1>
        <p className="text-[13px] text-n-500 mt-2">
          Your current role is <span className="text-n-700 font-medium">{roleLabel}</span>.
          {page && <> The page <code className="font-mono-num text-[12px] text-n-700">{page}</code> needs a higher level of permission.</>}
        </p>
        {requiredPermission && (
          <div className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-pill bg-n-100 text-n-600 text-[11px] font-mono-num">
            requires: {requiredPermission}
          </div>
        )}
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button iconLeft={<ArrowLeft />} onClick={goHome}>Back to my dashboard</Button>
        </div>
        <p className="text-[11.5px] text-n-400 mt-5">
          If you believe this is a mistake, contact your system administrator.
        </p>
      </div>
    </motion.div>
  );
}
