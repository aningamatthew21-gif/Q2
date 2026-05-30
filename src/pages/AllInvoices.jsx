import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Plus, Pencil, Trash2, Download, Filter, Search, RefreshCw,
  Rows3, Rows2, Columns as ColumnsIcon, ArrowLeft, ChevronLeft, ChevronRight,
  ExternalLink, FileText, Eye, Check, RotateCcw, AlertCircle, CheckCircle2
} from 'lucide-react';
import {
  Breadcrumb, PageTitle, Card, Button, CommandBar, FilterChips,
  StatusBadge, EmptyState, DetailPanel, SortableHeader, useSortable
} from '../components/v2';
import { usePrompt } from '../components/v2/PromptDialog';
import { listContainer, listRow } from '../components/v2/motion';
import { formatCurrency } from '../utils/formatting';
import { useDebounce } from '../hooks/useDebounce';
import { useActivityLog } from '../hooks/useActivityLog';
import { usePagination } from '../hooks/usePagination';
import { useApp } from '../context/AppContext';
import { can } from '../utils/permissions';
import api from '../api';

/* ─────────────────────────────────────────────────────────────────────
 * Column catalogue + localStorage key for the Columns chooser.
 * `fixed: true` columns are never togglable (Actions always shows).
 * Adding/removing columns: edit this array only; the rendering loop
 * and chooser dropdown both consume it.
 * ───────────────────────────────────────────────────────────────────── */
const COLUMN_STORAGE_KEY = 'allInvoices.visibleColumns.v1';
const ALL_COLUMNS = [
  { key: 'id',           label: 'Invoice',  default: true,  sortKey: 'id',           width: 'w-[150px]', align: 'left'  },
  { key: 'customerName', label: 'Customer', default: true,  sortKey: 'customerName', width: '',          align: 'left'  },
  { key: 'date',         label: 'Date',     default: true,  sortKey: '_date',        width: 'w-[120px]', align: 'left'  },
  { key: 'dueDate',      label: 'Due',      default: true,  sortKey: '_due',         width: 'w-[120px]', align: 'left'  },
  { key: 'total',        label: 'Amount',   default: true,  sortKey: '_amount',      width: 'w-[140px]', align: 'right' },
  { key: 'status',       label: 'Status',   default: true,  sortKey: 'status',       width: 'w-[180px]', align: 'left'  },
  { key: 'actions',      label: 'Actions',  default: true,  fixed: true,             width: 'w-[140px]', align: 'right' }
];

function loadVisibleColumns() {
  try {
    const stored = localStorage.getItem(COLUMN_STORAGE_KEY);
    if (stored) {
      const arr = JSON.parse(stored);
      if (Array.isArray(arr) && arr.length > 0) return new Set(arr);
    }
  } catch (_) { /* ignore — fall through to defaults */ }
  return new Set(ALL_COLUMNS.filter(c => c.default).map(c => c.key));
}

function saveVisibleColumns(set) {
  try {
    localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify([...set]));
  } catch (_) { /* localStorage full / private mode — degrade silently */ }
}

/* ─────────────────────────────────────────────────────────────────────
 * Columns chooser — small accessible dropdown rendered inline in the
 * CommandBar. Same a11y pattern as the ChartCard overflow menu (ARIA
 * menu role, keyboard nav, click-outside, Esc-to-close).
 * ───────────────────────────────────────────────────────────────────── */
function ColumnsButton({ visibleColumns, onChange }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (!menuRef.current?.contains(e.target) && !triggerRef.current?.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggleColumn = (key) => {
    const next = new Set(visibleColumns);
    if (next.has(key)) next.delete(key); else next.add(key);
    onChange(next);
  };

  const resetToDefault = () => {
    onChange(new Set(ALL_COLUMNS.filter(c => c.default).map(c => c.key)));
  };

  const allColumnsVisible = ALL_COLUMNS.every(c => visibleColumns.has(c.key));

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        title="Choose visible columns"
        aria-label="Choose visible columns"
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-[4px] text-[13px] font-medium text-n-700 hover:bg-n-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="w-3.5 h-3.5 grid place-items-center"><ColumnsIcon className="w-3.5 h-3.5" /></span>
        <span>Columns</span>
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Column visibility"
          className="absolute right-0 top-full mt-1 min-w-[200px] bg-white border border-n-200 rounded-md shadow-lg py-1 z-30"
        >
          {ALL_COLUMNS.map(col => {
            const checked = visibleColumns.has(col.key);
            const isFixed = !!col.fixed;
            return (
              <button
                key={col.key}
                role="menuitemcheckbox"
                aria-checked={checked}
                aria-disabled={isFixed}
                type="button"
                disabled={isFixed}
                onClick={() => !isFixed && toggleColumn(col.key)}
                title={isFixed ? 'This column is always shown' : `${checked ? 'Hide' : 'Show'} ${col.label}`}
                className={`w-full text-left px-3 py-1.5 text-[13px] flex items-center gap-2 hover:bg-n-50 focus:outline-none focus:bg-blue-50 ${
                  isFixed ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                <span className={`w-4 h-4 grid place-items-center border rounded-sm flex-shrink-0 ${
                  checked ? 'bg-blue-600 border-blue-600 text-white' : 'border-n-300 bg-white'
                }`}>
                  {checked && <Check className="w-3 h-3" />}
                </span>
                <span className="flex-1">{col.label}</span>
                {isFixed && <span className="text-[10px] uppercase text-n-400">Locked</span>}
              </button>
            );
          })}
          <div role="separator" className="h-px bg-n-200 my-1" />
          <button
            type="button"
            role="menuitem"
            onClick={resetToDefault}
            disabled={allColumnsVisible}
            className="w-full text-left px-3 py-1.5 text-[13px] flex items-center gap-2 text-n-600 hover:bg-n-50 focus:outline-none focus:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset to default
          </button>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * CSV builder — RFC 4180-compliant. Quotes any value containing comma,
 * quote, or newline; doubles internal quotes; uses CRLF line endings.
 * ───────────────────────────────────────────────────────────────────── */
function buildInvoicesCSV(rows) {
  const cols = [
    { key: 'id',           label: 'Invoice ID' },
    { key: 'customerName', label: 'Customer' },
    { key: 'date',         label: 'Date' },
    { key: 'dueDate',      label: 'Due Date' },
    { key: 'total',        label: 'Amount' },
    { key: 'currency',     label: 'Currency' },
    { key: 'status',       label: 'Status' }
  ];
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = cols.map(c => esc(c.label)).join(',');
  const body = rows.map(r =>
    cols.map(c => esc(c.key === 'id' ? (r.approvedInvoiceId || r.id) : r[c.key])).join(',')
  ).join('\r\n');
  return head + '\r\n' + body + '\r\n';
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * AllInvoices — Fluent 2 reference list page.
 *
 * Hooks, queryParams, useMemo, and navigation handlers are unchanged
 * from v1. JSX rewritten to use the v2 list-page pattern that's the
 * template for every other list page (My Invoices, RFQ List, PR List,
 * Vendors, Customers):
 *
 *   Breadcrumb
 *   PageTitle (with right-aligned actions)
 *   CommandBar (Office-style action ribbon)
 *   FilterChips (applied filters as removable pills)
 *   Card containing: <DataTable> + load-more footer
 *   DetailPanel (right slide-in preview for the selected row)
 *
 * Status-filter wiring extended: the page now reads pageContext.status
 * (e.g. { status: 'Pending Approval' } passed by dashboard tiles) and
 * applies it as a client-side filter chip alongside the existing aging
 * filter, so dashboard drill-throughs land on a filtered list.
 */
const AllInvoices = ({ navigateTo, pageContext }) => {
  const { appUser } = useApp();
  const { askConfirm } = usePrompt();
  // Permission-driven — works for both legacy roles AND new tiered roles
  // (finance_officer / finance_head). The old `=== 'controller'` check
  // silently hid the Price-item button from every tiered finance user.
  const canPrice  = can(appUser?.role, 'invoice.edit.pricing');
  // Soft-delete is gated to finance_head (legacy: controller) + admin on
  // the backend — mirror that on the frontend so the Delete button is
  // disabled rather than firing a guaranteed 403.
  const canDelete = appUser?.role === 'admin' || appUser?.role === 'finance_head' || appUser?.role === 'controller';

  // ── Filter state ──────────────────────────────────────────
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce(searchTerm, 1000);
  const { log } = useActivityLog();

  useEffect(() => {
    if (debouncedSearchTerm && debouncedSearchTerm.trim().length > 2) {
      log('SEARCH_QUERY', `Searched invoices for: "${debouncedSearchTerm}"`, {
        category: 'user_action',
        searchDetails: { term: debouncedSearchTerm, context: 'invoices' }
      });
    }
  }, [debouncedSearchTerm, log]);

  const [selectedYear,  setSelectedYear]  = useState('All');
  const [selectedMonth, setSelectedMonth] = useState('All');
  const [statusFilter,  setStatusFilter]  = useState(pageContext?.status || 'All');
  const [agingFilter,   setAgingFilter]   = useState(pageContext?.aging  || null);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [density, setDensity] = useState('compact');           // 'compact' | 'comfortable'
  const [previewRow, setPreviewRow] = useState(null);

  // ── Column visibility (Choice B — real chooser with persistence) ──
  // Keys must match the `key` field of ALL_COLUMNS at the top of file.
  const [visibleColumns, setVisibleColumns] = useState(loadVisibleColumns);
  useEffect(() => { saveVisibleColumns(visibleColumns); }, [visibleColumns]);
  const hasCol = useCallback((k) => visibleColumns.has(k), [visibleColumns]);
  // colSpan for loading / empty rows must reflect the currently-visible
  // column count (otherwise the empty-state message overflows or
  // underfills).
  const visibleColCount = useMemo(
    () => ALL_COLUMNS.filter(c => visibleColumns.has(c.key)).length,
    [visibleColumns]
  );

  // ── Action notification (success / error toasts for Delete, Export) ──
  const [notice, setNotice] = useState(null);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  // ── Busy state for destructive / async ribbon actions ──
  const [actionBusy, setActionBusy] = useState(false);

  // Sync from pageContext when navigated freshly
  useEffect(() => {
    if (pageContext?.status) setStatusFilter(pageContext.status);
    if (pageContext?.aging)  setAgingFilter(pageContext.aging);
  }, [pageContext]);

  // ── Server-side query params ───────────────────────────────────────
  // Three valid combos drive three different backend filters:
  //   1. year + month → exact month-of-year window (startDate..endDate)
  //   2. year alone   → calendar-year window
  //   3. month alone  → MONTH-ACROSS-ALL-YEARS via the new `month` query
  //                     param (the backend matches EXTRACT(MONTH FROM …))
  //                     Previously this combo silently no-op'd because
  //                     the month branch was nested inside the year check.
  const queryParams = useMemo(() => {
    const params = {};
    if (selectedYear !== 'All' && selectedMonth !== 'All') {
      const lastDay = new Date(selectedYear, parseInt(selectedMonth), 0).getDate();
      params.startDate = `${selectedYear}-${selectedMonth}-01`;
      params.endDate   = `${selectedYear}-${selectedMonth}-${lastDay}`;
    } else if (selectedYear !== 'All') {
      params.startDate = `${selectedYear}-01-01`;
      params.endDate   = `${selectedYear}-12-31`;
    } else if (selectedMonth !== 'All') {
      // Month-only filter — handled server-side via the dedicated
      // `month` query param (see backend/routes/invoices.js).
      params.month = selectedMonth;
    }
    if (agingFilter) params.aging = agingFilter;
    return params;
  }, [selectedYear, selectedMonth, agingFilter]);

  const { data: invoices, loading, hasMore, loadMore, error, reset: refetchInvoices } = usePagination('/invoices', queryParams);

  // Locally-deleted invoice IDs — soft-deleted records are filtered from
  // the live API list on next refetch, but until the refetch finishes
  // we hide them here so the row disappears immediately on Delete.
  const [hiddenIds, setHiddenIds] = useState(() => new Set());

  // ── Client-side filter (search + aging + status + optimistic-delete hide) ─────────
  const filteredInvoices = useMemo(() => {
    let filtered = hiddenIds.size > 0 ? invoices.filter(inv => !hiddenIds.has(inv.id)) : invoices;

    if (agingFilter) {
      const today = new Date();
      const ranges = {
        '0-30 Days':  { min: 0,   max: 30 },
        '31-60 Days': { min: 31,  max: 60 },
        '61-90 Days': { min: 61,  max: 90 },
        '90+ Days':   { min: 91,  max: Infinity }
      };
      const range = ranges[agingFilter];
      if (range) {
        filtered = filtered.filter(inv => {
          if (inv.status === 'Paid') return false;
          const invoiceDate = new Date(inv.date);
          const diffDays = Math.ceil((today - invoiceDate) / (1000 * 60 * 60 * 24));
          return diffDays >= range.min && diffDays <= range.max;
        });
      }
    }

    if (statusFilter && statusFilter !== 'All') {
      filtered = filtered.filter(inv => inv.status === statusFilter);
    }

    if (debouncedSearchTerm) {
      const q = debouncedSearchTerm.toLowerCase();
      filtered = filtered.filter(inv =>
        inv.id.toLowerCase().includes(q) ||
        (inv.customerName && inv.customerName.toLowerCase().includes(q))
      );
    }

    return filtered;
  }, [invoices, debouncedSearchTerm, agingFilter, statusFilter]);

  // Sort hook — clicking a header cycles asc → desc → none
  // Module 1 — `_due` and `_daysOverdue` projected so the new Due column
  // sorts numerically (not as locale strings) and the overdue badge can
  // be computed once per row instead of per-render.
  const today = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d;
  }, []);
  const sortableRows = useMemo(() => filteredInvoices.map(inv => {
    const due = inv.dueDate ? new Date(inv.dueDate) : null;
    const dueValid = due && !isNaN(due.getTime());
    const daysOverdue = dueValid && Number(inv.balanceDue || inv.total || 0) > 0
      ? Math.floor((today - due) / (1000 * 60 * 60 * 24))
      : 0;
    return {
      ...inv,
      _amount:   Number(inv.total) || 0,
      _date:     Date.parse(inv.date) || 0,
      _due:      dueValid ? due.getTime() : 0,
      _daysOverdue: daysOverdue
    };
  }), [filteredInvoices, today]);
  const { sortKey, sortDir, toggle: toggleSort, sortedRows } = useSortable(sortableRows, '_date', 'desc');

  /* ─────────────────────────────────────────────────────────────────
   * Toolbar action handlers
   * ─────────────────────────────────────────────────────────────────
   * Each one follows the same shape: confirm where destructive, fire
   * the API call (or local op), update local state, toast on success
   * or backend's specific reason on failure. No silent failures.
   */

  // DELETE — soft-delete the selected row via the backend's existing
  // DELETE /api/invoices/:id endpoint (which sets IS_DELETED='Y',
  // shipped in SP1-C2). Gated to admin / finance_head on the server;
  // we mirror that in canDelete above to disable the button.
  const handleDelete = useCallback(async () => {
    if (!previewRow || !canDelete || actionBusy) return;
    const label = previewRow.approvedInvoiceId || previewRow.id;
    const confirmed = await askConfirm({
      title:        `Delete ${label}?`,
      description:  `This soft-deletes the invoice (IS_DELETED='Y'). It disappears from the list but remains in QA_AUDIT_LOGS for the retention window. Admin can restore via POST /api/invoices/${previewRow.id}/restore.`,
      confirmLabel: 'Soft-delete',
      confirmTone:  'danger',
      cancelLabel:  'Cancel'
    });
    if (!confirmed) return;
    setActionBusy(true);
    try {
      await api.delete(`/invoices/${previewRow.id}`);
      // Optimistic hide so the row vanishes immediately; refetch confirms.
      setHiddenIds(prev => { const next = new Set(prev); next.add(previewRow.id); return next; });
      setPreviewRow(null);
      setNotice({ type: 'success', message: `Invoice ${label} soft-deleted.` });
      refetchInvoices();
    } catch (err) {
      const detail = err?.response?.data?.error?.message || err?.response?.data?.error || err?.message || 'Unknown error';
      setNotice({ type: 'error', message: `Delete failed — ${detail}` });
    } finally {
      setActionBusy(false);
    }
  }, [previewRow, canDelete, actionBusy, askConfirm, refetchInvoices]);

  // EXPORT — CSV download of the currently-FILTERED+SORTED rows (what
  // the user sees on screen, not the entire backend table). RFC 4180.
  const handleExport = useCallback(() => {
    if (sortedRows.length === 0) {
      setNotice({ type: 'error', message: 'Nothing to export — no rows match the current filters.' });
      return;
    }
    const csv = buildInvoicesCSV(sortedRows);
    const stamp = new Date().toISOString().slice(0, 10);
    triggerDownload(
      new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
      `invoices-${stamp}.csv`
    );
    setNotice({ type: 'success', message: `Exported ${sortedRows.length} invoices to CSV.` });
  }, [sortedRows]);

  // REFRESH — call usePagination.reset() instead of window.location.reload().
  // Preserves URL state, scroll position, current filters, and selected row.
  // (Previously a full-page reload — destructive to user context.)
  const handleRefresh = useCallback(() => {
    setHiddenIds(new Set());   // clear optimistic hides
    refetchInvoices();
    setNotice({ type: 'success', message: 'Refreshing list…' });
  }, [refetchInvoices]);

  const years  = ['2023', '2024', '2025', '2026'];
  // Month dropdown: backend bind value stays numeric (01..12) for
  // SQL EXTRACT(MONTH FROM ...) compatibility; display label is the
  // human-readable name. ISO/IEC 25010 Usability — Operability:
  // users shouldn't have to translate "07" → "July" in their head.
  const MONTHS = [
    { value: '01', label: 'January'   },
    { value: '02', label: 'February'  },
    { value: '03', label: 'March'     },
    { value: '04', label: 'April'     },
    { value: '05', label: 'May'       },
    { value: '06', label: 'June'      },
    { value: '07', label: 'July'      },
    { value: '08', label: 'August'    },
    { value: '09', label: 'September' },
    { value: '10', label: 'October'   },
    { value: '11', label: 'November'  },
    { value: '12', label: 'December'  }
  ];
  const monthLabelOf = (val) => MONTHS.find(m => m.value === val)?.label || val;

  // ── FilterChips data ─────────────────────────────────────
  const activeChips = useMemo(() => {
    const chips = [];
    if (statusFilter !== 'All') chips.push({ id: 'status', label: `Status: ${statusFilter}`,  onRemove: () => setStatusFilter('All') });
    if (selectedYear  !== 'All') chips.push({ id: 'year',   label: `Year: ${selectedYear}`,    onRemove: () => setSelectedYear('All')  });
    if (selectedMonth !== 'All') chips.push({ id: 'month',  label: `Month: ${monthLabelOf(selectedMonth)}`,  onRemove: () => setSelectedMonth('All') });
    if (agingFilter)             chips.push({ id: 'aging',  label: `Aging: ${agingFilter}`,    onRemove: () => setAgingFilter(null)    });
    if (debouncedSearchTerm)     chips.push({ id: 'search', label: `Search: "${debouncedSearchTerm}"`, onRemove: () => setSearchTerm('') });
    return chips;
  }, [statusFilter, selectedYear, selectedMonth, agingFilter, debouncedSearchTerm]);

  const rowPad = density === 'comfortable' ? 'py-2.5' : 'py-1.5';

  return (
    <>
      <Breadcrumb items={['Workspace', 'Finance', 'All invoices']} />
      <PageTitle
        title="Invoices"
        subtitle={
          <>
            <span>{filteredInvoices.length} of {invoices.length} invoices</span>
            {agingFilter && <span className="text-warn">· Aging: {agingFilter}</span>}
            {statusFilter !== 'All' && <span className="text-info">· Status: {statusFilter}</span>}
          </>
        }
        actions={
          <>
            <Button iconLeft={<ArrowLeft />} onClick={() => navigateTo('controllerDashboard')}>
              Back to dashboard
            </Button>
            <Button variant="primary" iconLeft={<Plus />} onClick={() => navigateTo('quoting')}>
              New invoice
            </Button>
          </>
        }
      />

      {/* COMMAND BAR */}
      {/*
        Every item below has a real handler. Items that previously had
        none ("Search", "Columns") were either removed (Search — the
        Filters panel already contains a search field; ISO 25010
        Operability frowns on duplicate affordances) or replaced with
        a working control (Columns → ColumnsButton dropdown).
        Refresh used to call window.location.reload() — destroyed URL
        state, scroll, and selection. Now it calls usePagination.reset()
        which refetches just the table.
      */}
      <CommandBar items={[
        { icon: <Plus />,    label: 'New',        primary: true,
          onClick: () => navigateTo('quoting') },
        { divider: true },
        { icon: <Pencil />,  label: 'Edit',       disabled: !previewRow,
          onClick: () => previewRow && navigateTo('invoiceEditor', { invoiceId: previewRow.id, returnTo: 'invoices' }) },
        { icon: <Trash2 />,  label: 'Delete',     disabled: !previewRow || !canDelete || actionBusy,
          title: !canDelete ? 'Only Finance Head or Admin can delete invoices.' : (previewRow ? 'Soft-delete the selected invoice' : 'Select a row to delete'),
          onClick: handleDelete },
        { icon: <Download />,label: 'Export',
          title: 'Download the currently-filtered rows as CSV',
          onClick: handleExport },
        { divider: true },
        { icon: <Filter />,  label: 'Filters',
          onClick: () => setShowFilterPanel(v => !v) },
        // Search button intentionally removed — the Filters panel
        // already has a dedicated search input. Duplicate affordances
        // confuse users (Nielsen Norman Group, "Single Search Field").
        { icon: <RefreshCw/>,label: 'Refresh',    disabled: loading,
          title: 'Re-fetch invoices without reloading the page',
          onClick: handleRefresh },
        { spacer: true },
        { icon: density === 'compact' ? <Rows3 /> : <Rows2 />,
          label: density === 'compact' ? 'Compact' : 'Comfortable',
          onClick: () => setDensity(d => d === 'compact' ? 'comfortable' : 'compact') },
        // Columns chooser — real dropdown with per-column checkboxes,
        // localStorage persistence, Reset-to-default. WCAG 2.1.1 +
        // 4.1.2 compliant (menuitemcheckbox role, keyboard nav, Esc).
        { render: () => <ColumnsButton visibleColumns={visibleColumns} onChange={setVisibleColumns} /> }
      ]} />

      {/* Toast notification — surfaces Delete / Export / Refresh outcomes.
          ISO 25010 User Error Protection: no silent failures. */}
      {notice && (
        <div
          role={notice.type === 'error' ? 'alert' : 'status'}
          aria-live={notice.type === 'error' ? 'assertive' : 'polite'}
          className={`mb-3 px-3 py-2 rounded-md border text-[13px] flex items-center justify-between gap-3 ${
            notice.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          <span className="flex items-center gap-2">
            {notice.type === 'error'
              ? <AlertCircle className="w-4 h-4 flex-shrink-0" />
              : <CheckCircle2 className="w-4 h-4 flex-shrink-0" />}
            <span>{notice.message}</span>
          </span>
          <button
            onClick={() => setNotice(null)}
            className="text-current opacity-60 hover:opacity-100 text-base leading-none"
            aria-label="Dismiss"
          >×</button>
        </div>
      )}

      {/* FILTER PANEL — collapsible */}
      {showFilterPanel && (
        <Card className="mb-3 p-3">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-[12px] font-medium text-n-700 mb-1">Year</label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="h-8 px-2 text-[13px] bg-white border border-n-300 rounded-md text-n-800 focus:outline-none focus:border-accent focus:shadow-focus"
              >
                <option value="All">All years</option>
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[12px] font-medium text-n-700 mb-1">Month</label>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="h-8 px-2 text-[13px] bg-white border border-n-300 rounded-md text-n-800 focus:outline-none focus:border-accent focus:shadow-focus"
              >
                <option value="All">All months</option>
                {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[12px] font-medium text-n-700 mb-1">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-8 px-2 text-[13px] bg-white border border-n-300 rounded-md text-n-800 focus:outline-none focus:border-accent focus:shadow-focus"
              >
                <option value="All">All statuses</option>
                <option>Pending Pricing</option>
                <option>Pending Approval</option>
                <option>Approved</option>
                <option>Awaiting Acceptance</option>
                <option>Customer Accepted</option>
                <option>Paid</option>
                <option>Rejected</option>
                <option>Customer Rejected</option>
              </select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-[12px] font-medium text-n-700 mb-1">Search</label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-n-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Invoice ID or customer…"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full h-8 pl-8 pr-3 text-[13px] bg-white border border-n-300 rounded-md text-n-800 placeholder:text-n-400 focus:outline-none focus:border-accent focus:shadow-focus"
                />
              </div>
            </div>
          </div>
        </Card>
      )}

      <FilterChips chips={activeChips} onAdd={() => setShowFilterPanel(v => !v)} />

      {/* ERROR */}
      {error && (
        <Card className="mb-3 p-3 border-err/40 bg-err-soft">
          <div className="text-[13px] text-err">
            Error loading invoices: {error}
            {String(error).includes('index') && <div className="text-xs mt-1">An index is required for this query. Check the browser console for the creation link.</div>}
          </div>
        </Card>
      )}

      {/* TABLE */}
      {/*
        Sticky header notes (kept outside the <table> so the JSX comment
        + its surrounding whitespace can't become a text-node child of
        the <table> — browsers wrap any direct text/whitespace child of
        a table in an implicit empty <tbody> which renders as a visible
        gap ABOVE the explicit <thead>. Same shape as the historic
        nested-motion.tbody bug; different root cause.):
          - Paints `bg-n-50` on every <th> directly (not just <thead>)
            so that rows scrolling underneath don't bleed through —
            browsers don't reliably render backgrounds on the <thead>
            element when it's `position: sticky`.
          - The bottom border + z-20 keep the divider visible above the
            page-transition motion layers.
          - `border-collapse` is explicit so the default 2px
            border-spacing doesn't add tiny gaps between cells.
      */}
      <Card className="mb-3 overflow-hidden">
        <table className="w-full text-[13px] border-collapse">
          <thead className="sticky top-12 z-20">
            <tr>
              {hasCol('id')           && <th className="bg-n-50 border-b border-n-200 px-3 py-2 text-left  w-[150px]"><SortableHeader label="Invoice"  sortKey="id"           current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>}
              {hasCol('customerName') && <th className="bg-n-50 border-b border-n-200 px-3 py-2 text-left"><SortableHeader label="Customer"            sortKey="customerName" current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>}
              {hasCol('date')         && <th className="bg-n-50 border-b border-n-200 px-3 py-2 text-left  w-[120px]"><SortableHeader label="Date"     sortKey="_date"         current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>}
              {hasCol('dueDate')      && <th className="bg-n-50 border-b border-n-200 px-3 py-2 text-left  w-[120px]"><SortableHeader label="Due"      sortKey="_due"          current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>}
              {hasCol('total')        && <th className="bg-n-50 border-b border-n-200 px-3 py-2 text-right w-[140px]"><SortableHeader label="Amount"   sortKey="_amount"       current={sortKey} dir={sortDir} onToggle={toggleSort} align="right" /></th>}
              {hasCol('status')       && <th className="bg-n-50 border-b border-n-200 px-3 py-2 text-left  w-[180px]"><SortableHeader label="Status"   sortKey="status"        current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>}
              {hasCol('actions')      && <th className="bg-n-50 border-b border-n-200 px-3 py-2 text-right w-[140px]"><span className="text-[11px] font-semibold uppercase tracking-wider text-n-600">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {loading && invoices.length === 0 ? (
              <tr><td colSpan={visibleColCount} className="p-8 text-center">
                <div className="inline-block w-8 h-8 rounded-full border-2 border-n-100 border-t-accent animate-spin" />
                <div className="text-[13px] text-n-500 mt-2">Loading invoices…</div>
              </td></tr>
            ) : filteredInvoices.length === 0 ? (
              <tr><td colSpan={visibleColCount}>
                <EmptyState
                  dense
                  icon={<FileText className="w-6 h-6" />}
                  title="No invoices match your filters"
                  body="Adjust the filters above or clear them to see all invoices."
                />
              </td></tr>
            ) : (
              // Rows go DIRECTLY inside the outer <tbody> above.
              // Previously this branch wrapped them in `<motion.tbody>` —
              // a second tbody nested inside the first, which is invalid
              // HTML. Browsers parsed it as two sibling tbodies, the empty
              // outer one reserved space ABOVE the sticky <thead>, and the
              // column-header bar visually drifted into the row area with
              // a blank gap above it. Removing the wrapper restores the
              // headers to the top of the table card. Per-row entrance
              // animations are unchanged — each <motion.tr> still has its
              // own `listRow` variant.
              sortedRows.map(inv => {
                  const isSelected = previewRow?.id === inv.id;
                  return (
                    <motion.tr
                      key={inv.id}
                      variants={listRow}
                      onClick={() => setPreviewRow(inv)}
                      className={`border-b border-n-100 cursor-pointer transition-colors ${
                        isSelected ? 'bg-accent-soft/60 hover:bg-accent-soft' : 'hover:bg-n-50'
                      }`}
                    >
                      {hasCol('id')           && <td className={`px-3 ${rowPad} font-mono-num text-[12.5px] text-n-800`}>{inv.approvedInvoiceId || inv.id}</td>}
                      {hasCol('customerName') && <td className={`px-3 ${rowPad} text-n-700 font-medium`}>{inv.customerName}</td>}
                      {hasCol('date')         && <td className={`px-3 ${rowPad} text-n-600 text-[12.5px]`}>{inv.date}</td>}
                      {hasCol('dueDate')      && <td className={`px-3 ${rowPad} text-[12.5px]`}>
                        {inv.dueDate ? (
                          <div className="flex flex-col">
                            <span className="text-n-700">{new Date(inv.dueDate).toLocaleDateString()}</span>
                            {inv._daysOverdue > 0 && (
                              <span className="text-[10.5px] font-semibold text-red-600 uppercase tracking-wide">
                                {inv._daysOverdue} day{inv._daysOverdue === 1 ? '' : 's'} overdue
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-n-400 italic">—</span>
                        )}
                      </td>}
                      {hasCol('total')        && <td className={`px-3 ${rowPad} text-right font-mono-num text-[12.5px] text-n-800 font-semibold`}>{formatCurrency(inv.currency, inv.total)}</td>}
                      {hasCol('status')       && <td className={`px-3 ${rowPad}`}>
                        <div className="flex flex-col gap-1 items-start">
                          <StatusBadge value={inv.status} />
                          {inv.sourcingStatus && inv.sourcingStatus !== 'NONE' && (
                            <StatusBadge size="sm" tone={
                              inv.sourcingStatus === 'COMPLETE' ? 'ok'
                            : inv.sourcingStatus === 'PARTIAL'  ? 'info'
                            : inv.sourcingStatus === 'PENDING'  ? 'warn'
                            : 'muted'
                            }>{
                              inv.sourcingStatus === 'COMPLETE' ? 'Sourcing done'
                            : inv.sourcingStatus === 'PARTIAL'  ? 'Sourcing partial'
                            : inv.sourcingStatus === 'PENDING'  ? 'Sourcing pending'
                            : inv.sourcingStatus
                            }</StatusBadge>
                          )}
                        </div>
                      </td>}
                      {hasCol('actions')      && <td className={`px-3 ${rowPad} text-right`}>
                        {inv.status === 'Pending Pricing' && canPrice ? (
                          <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); navigateTo('invoiceEditor', { invoiceId: inv.id, returnTo: 'invoices' }); }}>Price item</Button>
                        ) : inv.status === 'Pending Approval' ? (
                          <Button size="sm" variant="default" onClick={(e) => { e.stopPropagation(); navigateTo('invoiceEditor', { invoiceId: inv.id, returnTo: 'invoices' }); }}>Edit / Approve</Button>
                        ) : (
                          <Button size="sm" variant="subtle" iconLeft={<Eye />} onClick={(e) => { e.stopPropagation(); navigateTo('customerPortal', inv.customerId); }}>Portal</Button>
                        )}
                      </td>}
                    </motion.tr>
                  );
                })
            )}
          </tbody>
        </table>

        {/* Load more */}
        {hasMore && !loading && (
          <div className="border-t border-n-200 bg-n-50 px-3 py-2 flex items-center justify-between">
            <span className="text-[12px] text-n-500">Showing {filteredInvoices.length} of {invoices.length}+</span>
            <Button size="sm" variant="default" iconRight={<ChevronRight />} onClick={() => loadMore()}>Load more</Button>
          </div>
        )}
        {loading && invoices.length > 0 && (
          <div className="border-t border-n-200 bg-n-50 px-3 py-2 text-center text-[12px] text-n-500">Loading more…</div>
        )}
      </Card>

      {/* DETAIL PANEL — preview the selected row without leaving the list */}
      <DetailPanel
        open={!!previewRow}
        onClose={() => setPreviewRow(null)}
        subtitle={previewRow?.approvedInvoiceId || previewRow?.id}
        title={previewRow?.customerName}
        footer={previewRow && (
          <>
            <Button variant="ghost"   onClick={() => setPreviewRow(null)}>Close</Button>
            <Button variant="default" iconLeft={<FileText />} onClick={() => navigateTo('customerPortal', previewRow.customerId)}>Portal</Button>
            <Button variant="primary" iconRight={<ExternalLink />} onClick={() => navigateTo('invoiceEditor', { invoiceId: previewRow.id, returnTo: 'invoices' })}>Open</Button>
          </>
        )}
      >
        {previewRow && (
          <div className="space-y-3 text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge value={previewRow.status} />
              {previewRow.sourcingStatus && previewRow.sourcingStatus !== 'NONE' && (
                <StatusBadge size="sm" tone="info">Sourcing {previewRow.sourcingStatus.toLowerCase()}</StatusBadge>
              )}
            </div>
            <div className="border-t border-n-100 pt-3 space-y-1.5">
              <div className="flex justify-between"><span className="text-n-500">Date</span><span className="text-n-800">{previewRow.date}</span></div>
              <div className="flex justify-between"><span className="text-n-500">Currency</span><span className="text-n-800 font-mono-num">{previewRow.currency}</span></div>
              <div className="flex justify-between"><span className="text-n-500">Subtotal</span><span className="text-n-800 font-mono-num">{formatCurrency(previewRow.currency, previewRow.subtotal || 0)}</span></div>
              <div className="flex justify-between"><span className="text-n-500">Taxes</span><span className="text-n-800 font-mono-num">{formatCurrency(previewRow.currency, previewRow.taxes || 0)}</span></div>
              <div className="flex justify-between text-[15px] pt-1 border-t border-n-100">
                <span className="font-semibold text-n-800">Total</span>
                <span className="font-bold text-n-900 font-mono-num">{formatCurrency(previewRow.currency, previewRow.total)}</span>
              </div>
            </div>
          </div>
        )}
      </DetailPanel>
    </>
  );
};

export default AllInvoices;
