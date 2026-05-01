import React from 'react';

/**
 * PageHeader — standard page title row.
 *
 * Every page today inlines its own `<header className="bg-white p-4 rounded-xl shadow-md
 * flex justify-between items-center">` with an h1 + user pill + logout.
 * After Phase C ships the sidebar, user pill + logout move there; each
 * page's <header> collapses to just a title + subtitle + optional
 * right-side action slot. That's what this component renders.
 *
 * Design:
 *   - No background card / shadow. Sits directly on the page canvas.
 *   - Title uses `text-2xl font-semibold text-ink`.
 *   - Subtitle is `text-sm text-ink-muted`.
 *   - `actions` slot is flex-aligned right for buttons or filters.
 *   - `back` slot (optional) renders a small back-link above the title.
 *
 * Props:
 *   - title      (required)
 *   - subtitle   (optional)
 *   - actions    (optional node, right-aligned)
 *   - back       (optional node, e.g. <Button variant="link">← Back</Button>)
 *   - className  pass-through
 */
export default function PageHeader({
  title,
  subtitle,
  actions,
  back,
  className = ''
}) {
  return (
    <header className={['mb-6', className].join(' ')}>
      {back && <div className="mb-2">{back}</div>}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-ink leading-tight tracking-tight">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2 flex-shrink-0">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}
