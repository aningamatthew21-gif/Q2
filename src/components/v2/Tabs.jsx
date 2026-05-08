import React, { useState } from 'react';
import { motion } from 'framer-motion';
import clsx from 'clsx';

/**
 * Tabs — horizontal tab strip with an animated underline that
 * slides between the active tab via framer-motion's `layoutId`.
 *
 * Controlled or uncontrolled:
 *   <Tabs tabs={[{id:'a',label:'A'}, ...]} />          // uncontrolled
 *   <Tabs tabs={[...]} value={tabId} onChange={set} /> // controlled
 *
 * `tabs[i].count`  — optional badge number rendered after the label.
 */
export default function Tabs({
  tabs = [],
  value,
  defaultValue,
  onChange,
  className = ''
}) {
  const [internal, setInternal] = useState(defaultValue ?? tabs[0]?.id);
  const active = value ?? internal;

  const select = (id) => {
    if (value === undefined) setInternal(id);
    onChange?.(id);
  };

  return (
    <div className={clsx('flex items-center border-b border-n-200 px-1', className)} role="tablist">
      {tabs.map((t) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => select(t.id)}
            className={clsx(
              'relative px-3.5 py-2.5 text-[13px] transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-t-md',
              isActive
                ? 'text-accent-text font-semibold'
                : 'text-n-600 hover:text-n-800'
            )}
          >
            <span className="inline-flex items-center gap-2">
              {t.label}
              {typeof t.count === 'number' && (
                <span className={clsx(
                  'inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10.5px] font-mono-num',
                  isActive ? 'bg-accent text-white' : 'bg-n-100 text-n-600'
                )}>{t.count}</span>
              )}
            </span>
            {isActive && (
              <motion.span
                layoutId="tabs-active-underline"
                className="absolute left-2 right-2 -bottom-px h-[2px] bg-accent rounded"
                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                aria-hidden
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
