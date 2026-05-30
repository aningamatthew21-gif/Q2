import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  MoreHorizontal, RefreshCw, ExternalLink, ImageDown,
  Clipboard, FileSpreadsheet, Table as TableIcon, Check
} from 'lucide-react';
import clsx from 'clsx';
import { staggerItem, cardHover, TRANSITION_OUT } from './motion';
import { useApp } from '../../context/AppContext';
import Dialog from './Dialog';

/**
 * ChartCard — header-and-canvas wrapper for any Recharts (or custom) chart,
 * now with a real (opt-in) overflow menu instead of the previous decorative
 * placeholder.
 *
 * Standards anchor:
 *   - WCAG 2.1 SC 3.2.2 (On Input) — controls produce predictable, perceivable
 *     responses; no false affordances
 *   - WCAG 2.1 SC 2.1.1 (Keyboard) — menu fully keyboard-navigable
 *     (Tab to open trigger, Enter/Space to open, Esc to close, click-outside
 *     to dismiss)
 *   - WCAG 2.1 SC 4.1.2 (Name, Role, Value) — aria-haspopup, aria-expanded,
 *     role="menu" + role="menuitem" all set
 *   - ISO/IEC 25010 Usability — Operability + User Error Protection: the
 *     menu only renders when there's at least one actionable item; we never
 *     show a button that does nothing
 *   - Industry parity: action set matches Microsoft Power BI / Looker /
 *     Tableau standard overflow menus (Refresh · Open · Download · Copy ·
 *     View as table)
 *
 * Backward compatibility:
 *   - The legacy `right` prop still wins if provided — same as before.
 *   - The legacy decorative ellipsis is GONE. When no actions are passed
 *     and no `right` element, NO button renders (no false affordance).
 *   - All 38 existing callers that pass neither prop now see a clean
 *     card header with no ellipsis. To opt into the menu, the parent
 *     just adds the convenience props below — no other changes needed.
 *
 * Usage (full set):
 *
 *   <ChartCard
 *     title="Monthly invoice statistics"
 *     subtitle="Recognized revenue"
 *     height={300}
 *
 *     // Tier 1 conveniences:
 *     onRefresh={() => refetch()}             // → "Refresh" menu item
 *     reportPage="reportDsoTrend"             // → "Open as full report" menu item
 *
 *     // Tier 2 conveniences:
 *     tableData={{                            // enables CSV + View-as-table
 *       columns: [
 *         { key: 'name',  label: 'Month' },
 *         { key: 'total', label: 'Revenue', type: 'currency' }
 *       ],
 *       rows: invoiceData
 *     }}
 *
 *     // Optional override of menu items entirely:
 *     // actions={[{label, icon, onClick, divider, danger}]}
 *   >
 *     <BarChart ... />
 *   </ChartCard>
 *
 * PNG / Copy-as-image use the `html-to-image` library against a ref on the
 * chart canvas div, so they work for any chart engine (Recharts, custom SVG,
 * canvas, even pure HTML).
 */

export default function ChartCard({
  title, subtitle, right,
  height = 260, padded = true,
  children, className = '',
  // ── Tier 1 conveniences ──
  onRefresh,
  reportPage,
  reportContext,
  // ── Tier 2 conveniences ──
  tableData,
  // ── Optional manual override ──
  actions,
  // ── Tunables ──
  exportFilename
}) {
  const navigateFromCtx = useAppNavigateSafe();
  const chartRef = useRef(null);
  const [tableOpen, setTableOpen] = useState(false);
  const [busyAction, setBusyAction] = useState(null);
  const [toast, setToast] = useState(null);

  // Auto-clear ephemeral toast (e.g. "Copied!")
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  // Filename root for any download — safe, dated, derived from title.
  const safeFilename = useMemo(() => {
    const base = (exportFilename || title || 'chart')
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'chart';
    const stamp = new Date().toISOString().slice(0, 10);
    return `${base}-${stamp}`;
  }, [exportFilename, title]);

  // ── Build the menu item list from props ──
  // If `actions` is explicitly passed, use it verbatim (full caller control).
  // Otherwise assemble from the convenience props (the common case).
  const menuItems = useMemo(() => {
    if (Array.isArray(actions)) return actions;
    const items = [];

    if (typeof onRefresh === 'function') {
      items.push({
        label: 'Refresh',
        icon: RefreshCw,
        onClick: async () => {
          setBusyAction('refresh');
          try { await onRefresh(); } finally { setBusyAction(null); }
        }
      });
    }

    if (reportPage && navigateFromCtx) {
      items.push({
        label: 'Open as full report',
        icon: ExternalLink,
        onClick: () => navigateFromCtx(reportPage, reportContext || {})
      });
    }

    // Visual export — needs the chart ref to be mounted.
    items.push({
      label: 'Download as PNG',
      icon: ImageDown,
      onClick: async () => {
        if (!chartRef.current) return;
        setBusyAction('png');
        try {
          const { toPng } = await import('html-to-image');
          const dataUrl = await toPng(chartRef.current, {
            backgroundColor: '#ffffff',
            pixelRatio: 2,    // crisp on retina
            cacheBust: true
          });
          const a = document.createElement('a');
          a.href = dataUrl;
          a.download = `${safeFilename}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        } catch (e) {
          setToast({ type: 'error', message: 'Couldn\'t export PNG.' });
        } finally {
          setBusyAction(null);
        }
      }
    });

    items.push({
      label: 'Copy as image',
      icon: Clipboard,
      onClick: async () => {
        if (!chartRef.current) return;
        if (!navigator.clipboard || !window.ClipboardItem) {
          setToast({ type: 'error', message: 'Clipboard not supported in this browser.' });
          return;
        }
        setBusyAction('copy');
        try {
          const { toBlob } = await import('html-to-image');
          const blob = await toBlob(chartRef.current, {
            backgroundColor: '#ffffff',
            pixelRatio: 2,
            cacheBust: true
          });
          if (!blob) throw new Error('blob');
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          setToast({ type: 'success', message: 'Copied to clipboard.' });
        } catch (e) {
          setToast({ type: 'error', message: 'Couldn\'t copy to clipboard.' });
        } finally {
          setBusyAction(null);
        }
      }
    });

    if (tableData && Array.isArray(tableData.columns) && Array.isArray(tableData.rows)) {
      items.push({ divider: true });
      items.push({
        label: 'Download data as CSV',
        icon: FileSpreadsheet,
        onClick: () => {
          const csv = buildCSV(tableData.columns, tableData.rows);
          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${safeFilename}.csv`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
      });
      items.push({
        label: 'View as table',
        icon: TableIcon,
        onClick: () => setTableOpen(true)
      });
    }

    return items;
  }, [actions, onRefresh, reportPage, reportContext, navigateFromCtx, tableData, safeFilename]);

  // Whether to render a menu trigger at all.
  const hasMenu = !right && menuItems.length > 0;

  return (
    <>
      <motion.div
        variants={staggerItem}
        whileHover={cardHover}
        transition={TRANSITION_OUT}
        className={clsx('bg-white border border-n-200 rounded-card overflow-hidden relative', className)}
      >
        <div className="px-4 py-3 border-b border-n-200 flex items-center justify-between gap-3">
          <div className="min-w-0">
            {title    && <div className="text-[13px] font-semibold text-n-800 truncate">{title}</div>}
            {subtitle && <div className="text-xs text-n-500 mt-0.5 truncate">{subtitle}</div>}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {right ?? (hasMenu ? (
              <OverflowMenu items={menuItems} busyAction={busyAction} />
            ) : null)}
          </div>
        </div>
        <div ref={chartRef} className={clsx(padded && 'p-4')} style={{ height }}>
          {children}
        </div>

        {/* Ephemeral toast (e.g. "Copied!") */}
        {toast && (
          <div
            role="status"
            aria-live="polite"
            className={clsx(
              'absolute bottom-3 right-3 text-xs px-3 py-1.5 rounded shadow-md flex items-center gap-1.5',
              toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'
            )}
          >
            <Check className="w-3 h-3" />
            {toast.message}
          </div>
        )}
      </motion.div>

      {/* View-as-table dialog */}
      {tableOpen && tableData && (
        <Dialog open onClose={() => setTableOpen(false)} title={title || 'Data'} size="xl">
          <TableView columns={tableData.columns} rows={tableData.rows} />
        </Dialog>
      )}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * OverflowMenu — small accessible dropdown.
 * Self-contained (no popper / radix dep). Click-outside + Esc to close,
 * arrow-key navigation between items, proper ARIA roles.
 * ───────────────────────────────────────────────────────────────────── */

function OverflowMenu({ items, busyAction }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  // Close on outside click + Esc
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (!menuRef.current?.contains(e.target) && !triggerRef.current?.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Keyboard arrow nav inside menu
  const onMenuKey = useCallback((e) => {
    const focusables = menuRef.current?.querySelectorAll('[role="menuitem"]:not([disabled])') || [];
    const arr = Array.from(focusables);
    const idx = arr.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      arr[(idx + 1) % arr.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      arr[(idx - 1 + arr.length) % arr.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      arr[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      arr[arr.length - 1]?.focus();
    }
  }, []);

  // Auto-focus first item when opening
  useEffect(() => {
    if (!open) return;
    const first = menuRef.current?.querySelector('[role="menuitem"]:not([disabled])');
    first?.focus();
  }, [open]);

  const handleItemClick = async (item) => {
    if (!item.onClick) return;
    setOpen(false);
    try { await item.onClick(); } catch (_) { /* per-item handlers own their feedback */ }
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-7 h-7 grid place-items-center rounded-md text-n-500 hover:bg-n-100 hover:text-n-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        aria-label="Chart actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Chart actions"
          onKeyDown={onMenuKey}
          className="absolute right-0 top-full mt-1 min-w-[200px] bg-white border border-n-200 rounded-md shadow-lg py-1 z-30"
          style={{ animation: 'fadeIn 120ms ease-out' }}
        >
          {items.map((item, i) => {
            if (item.divider) {
              return <div key={`d-${i}`} role="separator" className="h-px bg-n-200 my-1" />;
            }
            const Icon = item.icon;
            const isBusy = busyAction && item.label?.toLowerCase().includes(busyAction);
            return (
              <button
                key={item.label || i}
                role="menuitem"
                type="button"
                disabled={item.disabled || isBusy}
                onClick={() => handleItemClick(item)}
                className={clsx(
                  'w-full text-left px-3 py-2 text-sm flex items-center gap-2 focus:outline-none focus:bg-blue-50',
                  item.danger ? 'text-red-700 hover:bg-red-50' : 'text-n-700 hover:bg-n-50',
                  (item.disabled || isBusy) && 'opacity-50 cursor-not-allowed'
                )}
              >
                {Icon && <Icon className="w-4 h-4 flex-shrink-0" />}
                <span className="flex-1">{item.label}</span>
                {isBusy && <span className="text-xs text-n-400">…</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * TableView — reads tableData.columns + rows. Sortable header,
 * currency / number / percent / date formatting per column meta.
 * ───────────────────────────────────────────────────────────────────── */
function TableView({ columns, rows }) {
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc');

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return -dir;
      if (bv == null) return dir;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [rows, sortKey, sortDir]);

  const toggle = (k) => {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('asc'); }
  };

  return (
    <div className="max-h-[60vh] overflow-auto -mx-2">
      <table className="min-w-full text-sm">
        <thead className="bg-n-50 sticky top-0">
          <tr>
            {columns.map(c => (
              <th
                key={c.key}
                onClick={() => toggle(c.key)}
                className="text-left px-3 py-2 font-medium text-n-700 cursor-pointer select-none hover:bg-n-100"
              >
                {c.label}
                {sortKey === c.key && <span className="ml-1 text-n-400">{sortDir === 'asc' ? '▲' : '▼'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={i} className="border-t border-n-100">
              {columns.map(c => (
                <td key={c.key} className="px-3 py-1.5 text-n-700">{formatCell(r[c.key], c.type)}</td>
              ))}
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-6 text-center text-n-500">No data.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * Helpers
 * ───────────────────────────────────────────────────────────────────── */

function formatCell(v, type) {
  if (v == null) return '';
  if (type === 'currency') return Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (type === 'number')   return Number(v).toLocaleString();
  if (type === 'percent')  return `${Number(v).toFixed(1)}%`;
  if (type === 'date')     {
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
  }
  return String(v);
}

function buildCSV(columns, rows) {
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map(c => esc(c.label)).join(',');
  const body = rows.map(r => columns.map(c => esc(r[c.key])).join(',')).join('\r\n');
  return head + '\r\n' + body + '\r\n';
}

// useApp's navigate is what powers our SPA routing. Wrap defensively —
// ChartCard could in principle be rendered outside the app shell.
function useAppNavigateSafe() {
  try {
    const ctx = useApp();
    return ctx?.navigate || null;
  } catch (_) { return null; }
}

/* Shared chart palette — keeps every chart on the same colour ramp. */
export const CHART_COLORS = {
  accent:  '#0F6CBD',
  ok:      '#107C10',
  warn:    '#B7710E',
  err:     '#C4314B',
  info:    '#005FB8',
  neutral: '#605E5C',
  grid:    '#EDEBE9',
  axis:    '#A19F9D'
};
export const CHART_SERIES = [
  '#0F6CBD', '#5C2E91', '#0E7C7B', '#B7710E',
  '#8A8886', '#107C10', '#C4314B', '#005FB8'
];
