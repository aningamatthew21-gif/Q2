import React from 'react';
import { motion } from 'framer-motion';
import { Inbox } from 'lucide-react';
import clsx from 'clsx';
import { TRANSITION_OUT } from './motion';

/**
 * EmptyState — shown inside a Card when a list/table has no rows.
 *
 *   <EmptyState
 *     icon={<Files/>}
 *     title="No invoices yet"
 *     body="Create one from a quote or import a batch."
 *     action={<Button variant="primary">New invoice</Button>}
 *   />
 */
export default function EmptyState({
  icon, title = 'Nothing here yet', body, action,
  className = '', dense = false
}) {
  const Wrapped = icon ?? <Inbox className="w-6 h-6" />;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={TRANSITION_OUT}
      className={clsx(
        'flex flex-col items-center text-center',
        dense ? 'py-8' : 'py-16',
        className
      )}
    >
      <div className="w-12 h-12 rounded-full bg-n-100 text-n-500 grid place-items-center mb-3">
        {Wrapped}
      </div>
      <h3 className="text-[15px] font-semibold text-n-800">{title}</h3>
      {body && <p className="text-[13px] text-n-500 mt-1 max-w-sm">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </motion.div>
  );
}
