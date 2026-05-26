import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Plus, Pencil, Trash2, Download, Filter, Search, RefreshCw,
  Rows3, Rows2, Columns, ArrowLeft, ChevronLeft, ChevronRight,
  ExternalLink, FileText, Eye
} from 'lucide-react';
import {
  Breadcrumb, PageTitle, Card, Button, CommandBar, FilterChips,
  StatusBadge, EmptyState, DetailPanel, SortableHeader, useSortable
} from '../components/v2';
import { listContainer, listRow } from '../components/v2/motion';
import { formatCurrency } from '../utils/formatting';
import { useDebounce } from '../hooks/useDebounce';
import { useActivityLog } from '../hooks/useActivityLog';
import { usePagination } from '../hooks/usePagination';
import { useApp } from '../context/AppContext';
import { can } from '../utils/permissions';

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
  // Permission-driven — works for both legacy roles AND new tiered roles
  // (finance_officer / finance_head). The old `=== 'controller'` check
  // silently hid the Price-item button from every tiered finance user.
  const canPrice = can(appUser?.role, 'invoice.edit.pricing');

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

  // Sync from pageContext when navigated freshly
  useEffect(() => {
    if (pageContext?.status) setStatusFilter(pageContext.status);
    if (pageContext?.aging)  setAgingFilter(pageContext.aging);
  }, [pageContext]);

  // ── Server-side query params (unchanged from v1) ─────────
  const queryParams = useMemo(() => {
    const params = {};
    if (selectedYear !== 'All') {
      if (selectedMonth !== 'All') {
        const lastDay = new Date(selectedYear, parseInt(selectedMonth), 0).getDate();
        params.startDate = `${selectedYear}-${selectedMonth}-01`;
        params.endDate   = `${selectedYear}-${selectedMonth}-${lastDay}`;
      } else {
        params.startDate = `${selectedYear}-01-01`;
        params.endDate   = `${selectedYear}-12-31`;
      }
    }
    if (agingFilter) params.aging = agingFilter;
    return params;
  }, [selectedYear, selectedMonth, agingFilter]);

  const { data: invoices, loading, hasMore, loadMore, error } = usePagination('/invoices', queryParams);

  // ── Client-side filter (search + aging + status) ─────────
  const filteredInvoices = useMemo(() => {
    let filtered = invoices;

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

  const years  = ['2023', '2024', '2025', '2026'];
  const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];

  // ── FilterChips data ─────────────────────────────────────
  const activeChips = useMemo(() => {
    const chips = [];
    if (statusFilter !== 'All') chips.push({ id: 'status', label: `Status: ${statusFilter}`,  onRemove: () => setStatusFilter('All') });
    if (selectedYear  !== 'All') chips.push({ id: 'year',   label: `Year: ${selectedYear}`,    onRemove: () => setSelectedYear('All')  });
    if (selectedMonth !== 'All') chips.push({ id: 'month',  label: `Month: ${selectedMonth}`,  onRemove: () => setSelectedMonth('All') });
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
      <CommandBar items={[
        { icon: <Plus />,    label: 'New',        primary: true, onClick: () => navigateTo('quoting') },
        { divider: true },
        { icon: <Pencil />,  label: 'Edit',       disabled: !previewRow,
          onClick: () => previewRow && navigateTo('invoiceEditor', { invoiceId: previewRow.id, returnTo: 'invoices' }) },
        { icon: <Trash2 />,  label: 'Delete',     disabled: !previewRow },
        { icon: <Download />,label: 'Export' },
        { divider: true },
        { icon: <Filter />,  label: 'Filters',    onClick: () => setShowFilterPanel(v => !v) },
        { icon: <Search />,  label: 'Search' },
        { icon: <RefreshCw/>,label: 'Refresh',    onClick: () => window.location.reload() },
        { spacer: true },
        { icon: density === 'compact' ? <Rows3 /> : <Rows2 />,
          label: density === 'compact' ? 'Compact' : 'Comfortable',
          onClick: () => setDensity(d => d === 'compact' ? 'comfortable' : 'compact') },
        { icon: <Columns />, label: 'Columns' }
      ]} />

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
                {months.map(m => <option key={m} value={m}>{m}</option>)}
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
      <Card className="mb-3 overflow-hidden">
        <table className="w-full text-[13px]">
          {/* Sticky header.
              Paints `bg-n-50` on every <th> directly (not just <thead>) so
              that rows scrolling underneath don't bleed through — browsers
              don't reliably render backgrounds on the <thead> element when
              it's `position: sticky`. The bottom border + z-20 keep the
              divider visible above the page-transition motion layers. */}
          <thead className="sticky top-12 z-20">
            <tr>
              <th className="bg-n-50 border-b border-n-200 px-3 py-2 text-left  w-[150px]"><SortableHeader label="Invoice"  sortKey="id"           current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>
              <th className="bg-n-50 border-b border-n-200 px-3 py-2 text-left"><SortableHeader label="Customer"            sortKey="customerName" current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>
              <th className="bg-n-50 border-b border-n-200 px-3 py-2 text-left  w-[120px]"><SortableHeader label="Date"     sortKey="_date"         current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>
              <th className="bg-n-50 border-b border-n-200 px-3 py-2 text-left  w-[120px]"><SortableHeader label="Due"      sortKey="_due"          current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>
              <th className="bg-n-50 border-b border-n-200 px-3 py-2 text-right w-[140px]"><SortableHeader label="Amount"   sortKey="_amount"       current={sortKey} dir={sortDir} onToggle={toggleSort} align="right" /></th>
              <th className="bg-n-50 border-b border-n-200 px-3 py-2 text-left  w-[180px]"><SortableHeader label="Status"   sortKey="status"        current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>
              <th className="bg-n-50 border-b border-n-200 px-3 py-2 text-right w-[140px]"><span className="text-[11px] font-semibold uppercase tracking-wider text-n-600">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {loading && invoices.length === 0 ? (
              <tr><td colSpan="7" className="p-8 text-center">
                <div className="inline-block w-8 h-8 rounded-full border-2 border-n-100 border-t-accent animate-spin" />
                <div className="text-[13px] text-n-500 mt-2">Loading invoices…</div>
              </td></tr>
            ) : filteredInvoices.length === 0 ? (
              <tr><td colSpan="7">
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
                      <td className={`px-3 ${rowPad} font-mono-num text-[12.5px] text-n-800`}>{inv.approvedInvoiceId || inv.id}</td>
                      <td className={`px-3 ${rowPad} text-n-700 font-medium`}>{inv.customerName}</td>
                      <td className={`px-3 ${rowPad} text-n-600 text-[12.5px]`}>{inv.date}</td>
                      <td className={`px-3 ${rowPad} text-[12.5px]`}>
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
                      </td>
                      <td className={`px-3 ${rowPad} text-right font-mono-num text-[12.5px] text-n-800 font-semibold`}>{formatCurrency(inv.currency, inv.total)}</td>
                      <td className={`px-3 ${rowPad}`}>
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
                      </td>
                      <td className={`px-3 ${rowPad} text-right`}>
                        {inv.status === 'Pending Pricing' && canPrice ? (
                          <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); navigateTo('invoiceEditor', { invoiceId: inv.id, returnTo: 'invoices' }); }}>Price item</Button>
                        ) : inv.status === 'Pending Approval' ? (
                          <Button size="sm" variant="default" onClick={(e) => { e.stopPropagation(); navigateTo('invoiceEditor', { invoiceId: inv.id, returnTo: 'invoices' }); }}>Edit / Approve</Button>
                        ) : (
                          <Button size="sm" variant="subtle" iconLeft={<Eye />} onClick={(e) => { e.stopPropagation(); navigateTo('customerPortal', inv.customerId); }}>Portal</Button>
                        )}
                      </td>
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
