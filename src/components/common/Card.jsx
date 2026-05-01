import React from 'react';

/**
 * Card — the standard content container.
 *
 * Replaces the inline `bg-white p-6 rounded-xl shadow-md` pattern
 * that every page currently duplicates. Uses design tokens:
 *   bg-surface border-line shadow-card rounded-card
 *
 * Opts for thin 1px `border-line` over drop shadows for a
 * flatter, more enterprise look (Xero/NetSuite style). A near-
 * invisible `shadow-card` adds just enough lift to separate the
 * card from the slate canvas without looking "webby."
 *
 * Props:
 *  - title:    optional string or node rendered as h3 at the top
 *  - subtitle: optional muted line under the title
 *  - actions:  optional node rendered right-aligned in the header
 *  - padding:  Tailwind padding class (default 'p-6')
 *  - dense:    when true, uses 'p-4' and smaller header spacing
 *  - as:       element tag (default 'section')
 *  - className, children, ...rest — pass-through
 */
export default function Card({
  title,
  subtitle,
  actions,
  padding,
  dense = false,
  as: Tag = 'section',
  className = '',
  children,
  ...rest
}) {
  const effectivePadding = padding ?? (dense ? 'p-4' : 'p-6');
  const hasHeader = title || subtitle || actions;

  return (
    <Tag
      className={[
        'bg-surface',
        'border border-line',
        'rounded-card',
        'shadow-card',
        effectivePadding,
        className
      ].join(' ')}
      {...rest}
    >
      {hasHeader && (
        <header
          className={[
            'flex items-start justify-between gap-4',
            dense ? 'mb-3' : 'mb-5'
          ].join(' ')}
        >
          <div className="min-w-0">
            {title && (
              <h3 className="text-base font-semibold text-ink leading-tight truncate">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="mt-1 text-sm text-ink-muted leading-snug">
                {subtitle}
              </p>
            )}
          </div>
          {actions && (
            <div className="flex items-center gap-2 flex-shrink-0">
              {actions}
            </div>
          )}
        </header>
      )}
      {children}
    </Tag>
  );
}
