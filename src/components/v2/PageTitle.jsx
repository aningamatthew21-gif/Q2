import React from 'react';
import clsx from 'clsx';

/**
 * PageTitle — the standard top-of-page header block.
 *
 * Renders a 24px title, optional subtitle (or any node — usually a
 * StatusBadge + meta line), and a right-aligned action stack.
 *
 *   <PageTitle
 *     title="RFQ-2026-0014 · Q2 Reorder"
 *     subtitle={<><StatusBadge value="Pending Approval"/> · Created 2026-04-19</>}
 *     actions={<>
 *       <Button>Cancel</Button>
 *       <Button variant="primary">Approve</Button>
 *     </>}
 *   />
 *
 * Stacks vertically below md (actions wrap to a new row).
 */
export default function PageTitle({ title, subtitle, actions, className = '' }) {
  return (
    <div className={clsx(
      'flex flex-col md:flex-row md:items-start md:justify-between gap-3 md:gap-6 mb-4',
      'v2-fade-up',  // 240ms fade + 6px slide on mount; reduced-motion safe
      className
    )}>
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold text-n-800 leading-tight tracking-tight m-0">
          {title}
        </h1>
        {subtitle && (
          <div className="text-[13px] text-n-500 mt-1 flex flex-wrap items-center gap-2">
            {subtitle}
          </div>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
          {actions}
        </div>
      )}
    </div>
  );
}
