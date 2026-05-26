import React from 'react';
import { ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-react';
import clsx from 'clsx';

/**
 * useSortable — drop-in sort state for hand-written tables.
 *
 *   const { sortKey, sortDir, toggle, sortedRows } = useSortable(rows, 'date', 'desc');
 *
 *   <th><SortableHeader label="Date" sortKey="date" current={sortKey} dir={sortDir} onToggle={toggle} /></th>
 *
 * Cycles asc → desc → none on repeated clicks of the same column.
 */
export function useSortable(rows, defaultKey = null, defaultDir = 'asc') {
  const [sortKey, setSortKey] = React.useState(defaultKey);
  const [sortDir, setSortDir] = React.useState(defaultDir);

  const toggle = React.useCallback((key) => {
    setSortKey(prev => {
      if (prev !== key) { setSortDir('asc'); return key; }
      return key;
    });
    setSortDir(prevDir => {
      // If we're clicking a different key, the setSortKey above already set 'asc'.
      // If same key, cycle asc → desc → none.
      // Note: this runs in the same React batch, so we read latest by checking sortKey
      //   which has already been set. We re-derive from the prevDir + same-key path.
      if (sortKey !== key) return 'asc';
      if (prevDir === 'asc')  return 'desc';
      if (prevDir === 'desc') { setSortKey(null); return 'asc'; }
      return 'asc';
    });
  }, [sortKey]);

  const sortedRows = React.useMemo(() => {
    if (!sortKey) return rows;
    const dir = sortDir === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => {
      const av = a?.[sortKey];
      const bv = b?.[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      // Numeric / date comparison when both look numeric
      const an = typeof av === 'number' ? av : (Number(av) || (Date.parse(av) || NaN));
      const bn = typeof bv === 'number' ? bv : (Number(bv) || (Date.parse(bv) || NaN));
      if (!Number.isNaN(an) && !Number.isNaN(bn)) return (an - bn) * dir;
      return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) * dir;
    });
  }, [rows, sortKey, sortDir]);

  return { sortKey, sortDir, toggle, sortedRows };
}

/**
 * SortableHeader — renders a clickable label with the active arrow.
 *
 * Two supported APIs (back-compat):
 *
 *   CANONICAL (must wrap in your own <th>):
 *     <th>
 *       <SortableHeader label="Date" sortKey="date" current={sortKey} dir={sortDir} onToggle={toggle} />
 *     </th>
 *
 *   LEGACY (component renders its own <th>; uses children as label):
 *     <SortableHeader keyName="date" sortKey={sortKey} sortDir={sortDir} onSort={toggle}>Date</SortableHeader>
 *
 * The two are distinguished by whether `keyName` is present. The legacy
 * form is used by the Module 5 report pages — wrapping its own <th>
 * means consumers can render it directly inside <tr> without invalid
 * HTML (and without each report having to remember the wrapper).
 *
 * Pass `align="right"` for numeric / amount columns.
 */
export default function SortableHeader({
  label,
  children,
  // canonical:
  sortKey,
  current,
  dir,
  onToggle,
  // legacy aliases:
  keyName,
  sortDir,
  onSort,
  align = 'left',
  className = ''
}) {
  // Disambiguate column-key vs active-key based on which API the caller used.
  const isLegacy   = keyName !== undefined;
  const columnKey  = isLegacy ? keyName : sortKey;
  const activeKey  = isLegacy ? sortKey : current;
  const activeDir  = sortDir ?? dir ?? 'asc';
  const toggleFn   = onSort  ?? onToggle ?? (() => {});
  const labelText  = label ?? children ?? '';

  const isActive = activeKey === columnKey;

  const buttonEl = (
    <button
      type="button"
      onClick={() => toggleFn(columnKey)}
      className={clsx(
        'group inline-flex items-center gap-1 select-none',
        'text-[11px] font-semibold uppercase tracking-wider',
        isActive ? 'text-n-800' : 'text-n-600 hover:text-n-800',
        align === 'right'  && 'flex-row-reverse w-full',
        align === 'center' && 'w-full justify-center',
        className
      )}
      aria-sort={isActive ? (activeDir === 'desc' ? 'descending' : 'ascending') : 'none'}
    >
      <span>{labelText}</span>
      <span className="w-3 h-3 inline-flex items-center justify-center">
        {isActive
          ? (activeDir === 'desc'
              ? <ArrowDown className="w-3 h-3 text-accent" />
              : <ArrowUp className="w-3 h-3 text-accent" />)
          : <ChevronsUpDown className="w-3 h-3 text-n-300 group-hover:text-n-500" />}
      </span>
    </button>
  );

  // Legacy callers render <SortableHeader> directly inside <tr>; wrap in
  // a <th> so the HTML stays valid. Canonical callers already wrap.
  if (isLegacy) {
    return (
      <th className={clsx(
        'px-4 py-2 border-b border-n-200',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left'
      )}>
        {buttonEl}
      </th>
    );
  }
  return buttonEl;
}
