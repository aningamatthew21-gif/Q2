import React from 'react';
import { ChevronRight } from 'lucide-react';
import clsx from 'clsx';

/**
 * Breadcrumb — small chevroned trail above each PageTitle.
 *
 * items: Array<string | { label: string; onClick?: () => void }>
 * The last item is rendered as plain (non-clickable) text. Items
 * with `onClick` render as buttons; pure-string items render as
 * dimmed labels (use `onClick` when you want them navigable).
 */
export default function Breadcrumb({ items = [], className = '' }) {
  return (
    <nav aria-label="Breadcrumb" className={clsx('mb-2', className)}>
      <ol className="flex items-center gap-1.5 text-xs text-n-500">
        {items.map((raw, i) => {
          const it = typeof raw === 'string' ? { label: raw } : raw;
          const isLast = i === items.length - 1;
          return (
            <li key={i} className="flex items-center gap-1.5 min-w-0">
              {it.onClick && !isLast ? (
                <button
                  type="button"
                  onClick={it.onClick}
                  className="hover:text-accent truncate focus:outline-none focus-visible:underline"
                >
                  {it.label}
                </button>
              ) : (
                <span className={clsx(
                  'truncate',
                  isLast ? 'text-n-700 font-medium' : 'text-n-500'
                )}>
                  {it.label}
                </span>
              )}
              {!isLast && (
                <ChevronRight className="w-3 h-3 text-n-300 flex-shrink-0" aria-hidden />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
