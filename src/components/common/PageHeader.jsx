import React from 'react';
import V2PageTitle from '../v2/PageTitle';

/**
 * PageHeader — v1 API, Fluent 2 visuals.
 *
 * Original prop contract (title / subtitle / actions / back / className) is
 * preserved so every page that imports `common/PageHeader` flips to the
 * new look without code changes. Internally renders the v2 PageTitle.
 *
 * The optional `back` slot still renders above the title since some pages
 * use it for an explicit "← back" affordance. Pages that already migrated
 * to a Breadcrumb shouldn't use `back` simultaneously.
 */
export default function PageHeader({
  title,
  subtitle,
  actions,
  back,
  className = ''
}) {
  return (
    <>
      {back && <div className="mb-2">{back}</div>}
      <V2PageTitle
        title={title}
        subtitle={subtitle}
        actions={actions}
        className={className}
      />
    </>
  );
}
