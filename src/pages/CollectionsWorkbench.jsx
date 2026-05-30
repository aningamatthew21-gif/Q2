/**
 * CollectionsWorkbench — Module 2's primary AR landing surface for finance.
 *
 * Layout:
 *   - 4 KPI tiles across the top: Total AR Outstanding, % Overdue, DSO,
 *     Payments logged today
 *   - Tabs: Overdue · Aging · Recent Payments · Unallocated · Follow-up
 *   - Right-side actions: "+ Log Payment", "+ Log Unallocated"
 *
 * Data sources:
 *   GET /api/collections/aging       — overdue list + bucket totals
 *   GET /api/collections/dso         — DSO + AR + sales window numbers
 *   GET /api/collections/payments    — recent confirmed payments
 *   GET /api/collections/unallocated — open un-applied bucket
 *   GET /api/collections/actions     — recent follow-ups
 *
 * Realtime: subscribes to `invoices:updated` + `payments:updated` so
 * logging a payment in InvoiceEditor refreshes this page automatically.
 */

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import api from '../api';
import socket from '../socket';
import Icon from '../components/common/Icon';
import PageHeader from '../components/common/PageHeader';
import Button from '../components/common/Button';
import { SortableHeader, useSortable } from '../components/v2';
import LogPaymentModal from '../components/modals/LogPaymentModal';
import LogCollectionActionModal from '../components/modals/LogCollectionActionModal';
import { useApp } from '../context/AppContext';
import { usePrompt } from '../components/v2/PromptDialog';
import { can } from '../utils/permissions';
import { PDFService } from '../services/PDFService';

const TABS = [
    { id: 'overdue',    label: 'Overdue' },
    { id: 'aging',      label: 'Aging Buckets' },
    { id: 'payments',   label: 'Recent Payments' },
    { id: 'unallocated',label: 'Unallocated' },
    { id: 'actions',    label: 'Follow-up' }
];

// Generic case-insensitive includes — used by every tab's filter logic.
// Defensive against null/undefined and number values (so a search for "100"
// matches an amount cell). Returns true when haystack is empty (so an empty
// search shows everything).
const matchesQuery = (q, ...fields) => {
    if (!q) return true;
    const term = String(q).toLowerCase();
    return fields.some(f => f != null && String(f).toLowerCase().includes(term));
};

const fmtMoney = (currency, amount) =>
    `${currency || 'GHS'} ${Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (s) => s ? new Date(s).toLocaleDateString() : '—';

const CollectionsWorkbench = ({ navigateTo }) => {
    const { appUser } = useApp();
    const [tab, setTab] = useState('overdue');

    const [aging, setAging] = useState({ totalOutstanding: 0, buckets: {}, rows: [] });
    const [dso, setDso] = useState({ ar: 0, sales: 0, dso: null, windowDays: 90 });
    const [payments, setPayments] = useState([]);
    const [unallocated, setUnallocated] = useState([]);
    const [actions, setActions] = useState([]);
    const [loading, setLoading] = useState(true);

    const [logPaymentInvoice, setLogPaymentInvoice] = useState(null); // pre-selected invoice or null
    const [logActionInvoice, setLogActionInvoice]   = useState(null); // {id, number}

    // ── Shared search + filter state ─────────────────────────────────
    // The query and customer filter apply to whichever tab is active.
    // Date filters only matter for tabs with dated rows (Recent Payments,
    // Unallocated, Follow-up). Persisted across tab switches so the user
    // can flip back and forth without re-entering a filter.
    const [query, setQuery] = useState('');
    const [customerFilter, setCustomerFilter] = useState('');
    const [bucketFilter, setBucketFilter] = useState('ALL'); // overdue + aging only
    const [statusFilter, setStatusFilter] = useState('ALL'); // unallocated only
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');

    const clearFilters = () => {
        setQuery('');
        setCustomerFilter('');
        setBucketFilter('ALL');
        setStatusFilter('ALL');
        setDateFrom('');
        setDateTo('');
    };

    const { askText } = usePrompt();
    const canReverse  = can(appUser, 'payment.reverse');
    const [actionNote, setActionNote] = useState(null); // success/error banner

    // Reverse a payment from the Recent Payments tab. Same flow as the
    // InvoiceEditor / CustomerStatement Reverse — reuses the existing
    // 24h-window-gated backend endpoint. Refetches after success so the
    // status badge flips to REVERSED in the table without a page reload.
    const handleReversePayment = useCallback(async (payment) => {
        const label = payment.receiptNumber || `#${payment.id}`;
        const reason = await askText({
            title:        `Reverse receipt ${label}?`,
            description:  'This marks the payment as REVERSED, restores the invoice balance, and is permanent. A reason is required for the audit trail.',
            label:        'Reason for reversal',
            placeholder:  'e.g. duplicate entry, cheque bounced, wrong invoice',
            multiline:    true,
            maxLength:    500,
            confirmLabel: 'Reverse payment',
            confirmTone:  'danger',
            cancelLabel:  'Keep payment'
        });
        if (reason === null) return;
        try {
            const res = await api.post(`/collections/payments/${payment.id}/reverse`, { reason: String(reason).trim() });
            if (res?.success) {
                setActionNote({ type: 'success', message: `Receipt ${label} reversed.` });
                fetchAll();
            } else {
                setActionNote({ type: 'error', message: res?.error || 'Could not reverse payment.' });
            }
        } catch (err) {
            const status = err?.response?.status;
            const msg    = err?.response?.data?.error || err?.message || 'Unknown error';
            setActionNote({
                type: 'error',
                message: status === 422 ? msg : `Failed to reverse${status ? ` (${status})` : ''}: ${msg}`
            });
        }
    }, [askText]);

    // Download the underlying invoice PDF for a payment row. Fetches the
    // full invoice (line items, tax breakdown, signature, etc.) and hands
    // it to PDFService, which renders the same customer-facing document
    // that was sent at approval time. No separate stored attachment — the
    // PDF is regenerated deterministically from the invoice record.
    const handleDownloadInvoicePDF = useCallback(async (invoiceId) => {
        if (!invoiceId) {
            setActionNote({ type: 'error', message: 'No invoice id on this row.' });
            return;
        }
        try {
            const res = await api.get(`/invoices/${invoiceId}`);
            if (!res?.success || !res.data) {
                setActionNote({ type: 'error', message: 'Could not load invoice for PDF.' });
                return;
            }
            await PDFService.downloadInvoicePDF(res.data);
        } catch (err) {
            const msg = err?.response?.data?.error || err?.message || 'Unknown error';
            setActionNote({ type: 'error', message: `Failed to download PDF: ${msg}` });
        }
    }, []);

    // Distinct customers across all loaded data — used to populate the
    // customer dropdown without an extra round-trip.
    const allCustomers = useMemo(() => {
        const set = new Set();
        (aging.rows || []).forEach(r => r.customerName && set.add(r.customerName));
        (unallocated || []).forEach(u => u.customerId && set.add(u.customerId));
        return Array.from(set).sort();
    }, [aging.rows, unallocated]);

    const fetchAll = useCallback(async () => {
        setLoading(true);
        try {
            const [agRes, dsoRes, payRes, unallocRes, actRes] = await Promise.all([
                api.get('/collections/aging').catch(() => ({ success: false })),
                api.get('/collections/dso').catch(() => ({ success: false })),
                api.get('/collections/payments').catch(() => ({ success: false })),
                api.get('/collections/unallocated').catch(() => ({ success: false })),
                api.get('/collections/actions').catch(() => ({ success: false }))
            ]);
            if (agRes?.success)     setAging(agRes.data);
            if (dsoRes?.success)    setDso(dsoRes.data);
            if (payRes?.success)    setPayments(payRes.data || []);
            if (unallocRes?.success) setUnallocated(unallocRes.data || []);
            if (actRes?.success)    setActions(actRes.data || []);
        } catch (err) {
            // Top-level workbench load failure — distinct from the per-
            // endpoint .catch(() => …) fallbacks above, which let
            // individual panels degrade independently. If we land here,
            // something broke OUTSIDE Promise.all (e.g. setState after
            // unmount, JSON parse error). Surface so the user knows the
            // page may be partially-broken rather than just empty.
            console.error('Collections workbench load failed:', err);
            const detail = err?.response?.data?.error?.message || err?.message || 'Unknown error';
            setActionNote({
                type: 'error',
                message: `Could not load Collections workbench — ${detail}. Some panels may be empty; refresh to retry.`
            });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchAll();
        if (!socket.connected) socket.connect();
        const refetch = () => fetchAll();
        socket.on('invoices:updated', refetch);
        socket.on('payments:updated', refetch);
        socket.on('collections:actions:updated', refetch);
        return () => {
            socket.off('invoices:updated', refetch);
            socket.off('payments:updated', refetch);
            socket.off('collections:actions:updated', refetch);
        };
    }, [fetchAll]);

    // Derived KPIs
    const totalOutstanding = aging.totalOutstanding || 0;
    const overdueAmount = useMemo(
        () => (aging.rows || []).filter(r => r.daysOverdue > 0).reduce((s, r) => s + r.balanceDue, 0),
        [aging.rows]
    );
    const pctOverdue = totalOutstanding > 0 ? (overdueAmount / totalOutstanding) * 100 : 0;
    const today = new Date().toDateString();
    const paymentsToday = useMemo(
        () => payments.filter(p => new Date(p.paymentDate || p.createdAt).toDateString() === today)
                      .reduce((s, p) => s + p.amount + (p.whtTotal || 0), 0),
        [payments, today]
    );

    return (
        <>
            <PageHeader
                title="Collections Workbench"
                actions={
                    <>
                        <Button
                            variant="primary"
                            size="sm"
                            leftIcon={<Icon id="plus" />}
                            onClick={() => setLogPaymentInvoice({ /* no pre-selection */ })}
                        >
                            Log Payment
                        </Button>
                    </>
                }
            />

            {/* KPI tiles */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                <div className="bg-white p-4 rounded-panel shadow-card border border-line">
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total AR Outstanding</div>
                    <div className="text-2xl font-bold mt-1">{fmtMoney('GHS', totalOutstanding)}</div>
                </div>
                <div className="bg-white p-4 rounded-panel shadow-card border border-line">
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">% Overdue</div>
                    <div className={`text-2xl font-bold mt-1 ${pctOverdue > 30 ? 'text-red-600' : pctOverdue > 10 ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {pctOverdue.toFixed(1)}%
                    </div>
                    <div className="text-xs text-gray-500 mt-1">{fmtMoney('GHS', overdueAmount)} overdue</div>
                </div>
                <div className="bg-white p-4 rounded-panel shadow-card border border-line">
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">DSO (90-day)</div>
                    <div className="text-2xl font-bold mt-1">{dso.dso != null ? `${dso.dso} days` : '—'}</div>
                    <div className="text-xs text-gray-500 mt-1">{fmtMoney('GHS', dso.sales)} sales · {fmtMoney('GHS', dso.ar)} AR</div>
                </div>
                <div className="bg-white p-4 rounded-panel shadow-card border border-line">
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Logged Today</div>
                    <div className="text-2xl font-bold mt-1 text-blue-700">{fmtMoney('GHS', paymentsToday)}</div>
                </div>
            </div>

            {/* Action-note banner — surfaces success/error toasts for
                inline operations (reverse, PDF download) so the user gets
                feedback without leaving the tab. */}
            {actionNote && (
                <div className={`mb-3 p-3 rounded text-sm flex items-center justify-between ${
                    actionNote.type === 'error'
                        ? 'bg-red-50 border border-red-200 text-red-700'
                        : 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                }`}>
                    <span>{actionNote.message}</span>
                    <button onClick={() => setActionNote(null)} className="text-gray-400 hover:text-gray-600 ml-2">×</button>
                </div>
            )}

            {/* Tabs */}
            <div className="bg-surface rounded-panel shadow-card border border-line">
                <div className="flex border-b border-line overflow-x-auto">
                    {TABS.map(t => (
                        <button
                            key={t.id}
                            onClick={() => setTab(t.id)}
                            className={`px-5 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                                tab === t.id
                                    ? 'text-blue-700 border-b-2 border-blue-600 bg-white'
                                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                            }`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                {/* Shared search + filter strip — applies to whatever tab
                    is active. Bucket only shows on Overdue/Aging tabs;
                    Status only on Unallocated; Date range only on tabs
                    with dated rows. Clear resets all at once. */}
                <div className="p-3 border-b border-line bg-gray-50/60">
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="relative flex-1 min-w-[200px] max-w-md">
                            <input
                                type="text"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Search invoice #, customer, receipt, reference…"
                                className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                            <Icon id="search" className="absolute left-2 top-2.5 text-gray-400 w-4 h-4" />
                        </div>

                        <select
                            value={customerFilter}
                            onChange={(e) => setCustomerFilter(e.target.value)}
                            className="px-2 py-1.5 text-sm border border-gray-300 rounded bg-white"
                            title="Filter by customer"
                        >
                            <option value="">All customers</option>
                            {allCustomers.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>

                        {(tab === 'overdue' || tab === 'aging') && (
                            <select
                                value={bucketFilter}
                                onChange={(e) => setBucketFilter(e.target.value)}
                                className="px-2 py-1.5 text-sm border border-gray-300 rounded bg-white"
                                title="Filter by aging bucket"
                            >
                                <option value="ALL">All buckets</option>
                                <option value="0-30">0–30 days</option>
                                <option value="31-60">31–60 days</option>
                                <option value="61-90">61–90 days</option>
                                <option value="90+">90+ days</option>
                            </select>
                        )}

                        {tab === 'unallocated' && (
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                                className="px-2 py-1.5 text-sm border border-gray-300 rounded bg-white"
                                title="Filter by status"
                            >
                                <option value="ALL">All statuses</option>
                                <option value="UNAPPLIED">Unapplied</option>
                                <option value="PARTIALLY_APPLIED">Partially applied</option>
                                <option value="APPLIED">Applied</option>
                                <option value="REFUNDED">Refunded</option>
                            </select>
                        )}

                        {(tab === 'payments' || tab === 'unallocated' || tab === 'actions') && (
                            <>
                                <input
                                    type="date"
                                    value={dateFrom}
                                    onChange={(e) => setDateFrom(e.target.value)}
                                    className="px-2 py-1.5 text-sm border border-gray-300 rounded bg-white"
                                    title="From date"
                                />
                                <span className="text-xs text-gray-500">to</span>
                                <input
                                    type="date"
                                    value={dateTo}
                                    onChange={(e) => setDateTo(e.target.value)}
                                    className="px-2 py-1.5 text-sm border border-gray-300 rounded bg-white"
                                    title="To date"
                                />
                            </>
                        )}

                        {(query || customerFilter || bucketFilter !== 'ALL' || statusFilter !== 'ALL' || dateFrom || dateTo) && (
                            <button
                                type="button"
                                onClick={clearFilters}
                                className="text-xs text-blue-600 hover:underline ml-1"
                            >
                                Clear filters
                            </button>
                        )}
                    </div>
                </div>

                <div className="p-4">
                    {loading ? (
                        <div className="text-center py-12 text-gray-500">
                            <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mr-2"></div>
                            Loading…
                        </div>
                    ) : tab === 'overdue' ? (
                        <OverdueTab
                            rows={(aging.rows || []).filter(r => r.daysOverdue > 0)}
                            query={query}
                            customerFilter={customerFilter}
                            bucketFilter={bucketFilter}
                            onLogPayment={(inv) => setLogPaymentInvoice(inv)}
                            onLogAction={(inv) => setLogActionInvoice({ id: inv.invoiceId, number: inv.invoiceId })}
                            navigateTo={navigateTo}
                        />
                    ) : tab === 'aging' ? (
                        <AgingTab
                            buckets={aging.buckets || {}}
                            rows={aging.rows || []}
                            query={query}
                            customerFilter={customerFilter}
                            bucketFilter={bucketFilter}
                        />
                    ) : tab === 'payments' ? (
                        <PaymentsTab
                            payments={payments}
                            query={query}
                            customerFilter={customerFilter}
                            dateFrom={dateFrom}
                            dateTo={dateTo}
                            canReverse={canReverse}
                            onReverse={handleReversePayment}
                            onDownloadPDF={handleDownloadInvoicePDF}
                            navigateTo={navigateTo}
                        />
                    ) : tab === 'unallocated' ? (
                        <UnallocatedTab
                            rows={unallocated}
                            query={query}
                            customerFilter={customerFilter}
                            statusFilter={statusFilter}
                            dateFrom={dateFrom}
                            dateTo={dateTo}
                        />
                    ) : (
                        <ActionsTab
                            rows={actions}
                            query={query}
                            customerFilter={customerFilter}
                            dateFrom={dateFrom}
                            dateTo={dateTo}
                            navigateTo={navigateTo}
                        />
                    )}
                </div>
            </div>

            {/* Modals */}
            <LogPaymentModal
                open={!!logPaymentInvoice}
                onClose={() => setLogPaymentInvoice(null)}
                invoice={logPaymentInvoice && logPaymentInvoice.id ? logPaymentInvoice : null}
                onLogged={() => { setLogPaymentInvoice(null); fetchAll(); }}
            />
            <LogCollectionActionModal
                open={!!logActionInvoice}
                onClose={() => setLogActionInvoice(null)}
                invoiceId={logActionInvoice?.id}
                invoiceNumber={logActionInvoice?.number}
                onLogged={() => { setLogActionInvoice(null); fetchAll(); }}
            />
        </>
    );
};

// ── Tab components ─────────────────────────────────────────────────────

const OverdueTab = ({ rows, query, customerFilter, bucketFilter, onLogPayment, onLogAction, navigateTo }) => {
    // Apply filters before projecting for sorting. Order matters — filter
    // first so the sortable list never includes hidden rows.
    const filtered = useMemo(() => rows.filter(r => {
        if (customerFilter && r.customerName !== customerFilter) return false;
        if (bucketFilter && bucketFilter !== 'ALL' && r.bucket !== bucketFilter) return false;
        if (!matchesQuery(query, r.invoiceId, r.customerName, r.balanceDue)) return false;
        return true;
    }), [rows, query, customerFilter, bucketFilter]);

    const sortable = useMemo(() => filtered.map(r => ({
        ...r,
        _due:       Date.parse(r.dueDate) || 0,
        _days:      Number(r.daysOverdue) || 0,
        _balance:   Number(r.balanceDue) || 0
    })), [filtered]);
    const { sortKey, sortDir, toggle, sortedRows } = useSortable(sortable, '_days', 'desc');

    if (rows.length === 0) {
        return <div className="text-center py-12 text-gray-500">No overdue invoices. 🎉</div>;
    }
    if (sortedRows.length === 0) {
        return <div className="text-center py-12 text-gray-500">No invoices match the current filters.</div>;
    }
    return (
        <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                    <tr>
                        <th className="px-3 py-2 text-left"><SortableHeader label="Invoice"   sortKey="invoiceId"   current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                        <th className="px-3 py-2 text-left"><SortableHeader label="Customer"  sortKey="customerName" current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                        <th className="px-3 py-2 text-left"><SortableHeader label="Due"       sortKey="_due"        current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                        <th className="px-3 py-2 text-right"><SortableHeader label="Days Late" sortKey="_days"      current={sortKey} dir={sortDir} onToggle={toggle} align="right" /></th>
                        <th className="px-3 py-2 text-right"><SortableHeader label="Balance"  sortKey="_balance"    current={sortKey} dir={sortDir} onToggle={toggle} align="right" /></th>
                        <th className="px-3 py-2 text-center"><SortableHeader label="Bucket"  sortKey="bucket"      current={sortKey} dir={sortDir} onToggle={toggle} align="center" /></th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {sortedRows.map(r => (
                        <tr key={r.invoiceId} className="hover:bg-gray-50">
                            <td className="px-3 py-2 text-sm font-mono">{r.invoiceId}</td>
                            <td className="px-3 py-2 text-sm">{r.customerName}</td>
                            <td className="px-3 py-2 text-sm">{fmtDate(r.dueDate)}</td>
                            <td className="px-3 py-2 text-right text-sm font-semibold text-red-600">{r.daysOverdue}</td>
                            <td className="px-3 py-2 text-right text-sm font-mono">{fmtMoney(r.currency, r.balanceDue)}</td>
                            <td className="px-3 py-2 text-center">
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                    r.bucket === '90+'   ? 'bg-red-100 text-red-700'   :
                                    r.bucket === '61-90' ? 'bg-orange-100 text-orange-700' :
                                    r.bucket === '31-60' ? 'bg-amber-100 text-amber-700' :
                                                           'bg-gray-100 text-gray-700'
                                }`}>{r.bucket}</span>
                            </td>
                            <td className="px-3 py-2 text-right">
                                <div className="flex gap-1 justify-end">
                                    <button
                                        onClick={() => onLogPayment({
                                            id: r.invoiceId,
                                            invoiceNumber: r.invoiceId,
                                            total: r.total,
                                            amountPaid: r.amountPaid,
                                            balanceDue: r.balanceDue,
                                            currency: r.currency
                                        })}
                                        className="text-xs text-blue-600 hover:underline"
                                    >Log Payment</button>
                                    <span className="text-gray-300">·</span>
                                    <button
                                        onClick={() => onLogAction(r)}
                                        className="text-xs text-amber-600 hover:underline"
                                    >Follow up</button>
                                    <span className="text-gray-300">·</span>
                                    <button
                                        onClick={() => navigateTo('customerPortal', r.customerId)}
                                        className="text-xs text-gray-600 hover:underline"
                                    >Statement</button>
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const AgingTab = ({ buckets, rows, query, customerFilter, bucketFilter }) => {
    const filtered = useMemo(() => rows.filter(r => {
        if (customerFilter && r.customerName !== customerFilter) return false;
        if (bucketFilter && bucketFilter !== 'ALL' && r.bucket !== bucketFilter) return false;
        if (!matchesQuery(query, r.invoiceId, r.customerName, r.balanceDue)) return false;
        return true;
    }), [rows, query, customerFilter, bucketFilter]);

    const sortable = useMemo(() => filtered.map(r => ({
        ...r,
        _due:     Date.parse(r.dueDate) || 0,
        _balance: Number(r.balanceDue) || 0
    })), [filtered]);
    const { sortKey, sortDir, toggle, sortedRows } = useSortable(sortable, '_due', 'asc');

    return (
        <div>
            <div className="grid grid-cols-4 gap-3 mb-4">
                {['0-30','31-60','61-90','90+'].map(k => (
                    <div key={k} className={`p-3 rounded border ${
                        k === '90+'   ? 'border-red-200 bg-red-50' :
                        k === '61-90' ? 'border-orange-200 bg-orange-50' :
                        k === '31-60' ? 'border-amber-200 bg-amber-50' :
                                        'border-gray-200 bg-gray-50'
                    }`}>
                        <div className="text-xs font-medium text-gray-600 uppercase tracking-wide">{k} days</div>
                        <div className="text-xl font-bold mt-1">{fmtMoney('GHS', buckets[k] || 0)}</div>
                    </div>
                ))}
            </div>
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-3 py-2 text-left"><SortableHeader label="Invoice"   sortKey="invoiceId"    current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                            <th className="px-3 py-2 text-left"><SortableHeader label="Customer"  sortKey="customerName" current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                            <th className="px-3 py-2 text-left"><SortableHeader label="Due"       sortKey="_due"         current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                            <th className="px-3 py-2 text-right"><SortableHeader label="Balance"  sortKey="_balance"     current={sortKey} dir={sortDir} onToggle={toggle} align="right" /></th>
                            <th className="px-3 py-2 text-center"><SortableHeader label="Bucket"  sortKey="bucket"       current={sortKey} dir={sortDir} onToggle={toggle} align="center" /></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {sortedRows.map(r => (
                            <tr key={r.invoiceId} className="hover:bg-gray-50">
                                <td className="px-3 py-2 text-sm font-mono">{r.invoiceId}</td>
                                <td className="px-3 py-2 text-sm">{r.customerName}</td>
                                <td className="px-3 py-2 text-sm">{fmtDate(r.dueDate)}</td>
                                <td className="px-3 py-2 text-right text-sm font-mono">{fmtMoney(r.currency, r.balanceDue)}</td>
                                <td className="px-3 py-2 text-center text-xs">{r.bucket}</td>
                            </tr>
                        ))}
                        {sortedRows.length === 0 && (
                            <tr><td colSpan="5" className="px-3 py-8 text-center text-gray-500">No outstanding invoices.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const PaymentsTab = ({ payments, query, customerFilter, dateFrom, dateTo, canReverse, onReverse, onDownloadPDF, navigateTo }) => {
    // Note — `customerFilter` matches on invoiceId here since payments rows
    // don't carry customerName (they're per-invoice). Combined with the
    // server-side aging rows already filtered, this is functional for our
    // typical "find this customer's payments" workflow because invoice IDs
    // are unique. For per-customer payment lookup users should pivot via
    // the customer statement page instead.
    const fromTs = dateFrom ? Date.parse(dateFrom) : null;
    const toTs   = dateTo   ? Date.parse(dateTo)   : null;
    const filtered = useMemo(() => payments.filter(p => {
        const ts = Date.parse(p.paymentDate || p.createdAt) || 0;
        if (fromTs && ts < fromTs) return false;
        if (toTs   && ts > toTs + 86_400_000) return false; // inclusive of end-of-day
        if (!matchesQuery(query, p.receiptNumber, p.invoiceId, p.paymentMethod, p.loggedBy, p.amount)) return false;
        return true;
    }), [payments, query, fromTs, toTs]);

    const sortable = useMemo(() => filtered.map(p => ({
        ...p,
        _date:    Date.parse(p.paymentDate || p.createdAt) || 0,
        _amount:  Number(p.amount) || 0,
        _wht:     Number(p.whtTotal) || 0
    })), [filtered]);
    const { sortKey, sortDir, toggle, sortedRows } = useSortable(sortable, '_date', 'desc');

    return (
        <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                    <tr>
                        <th className="px-3 py-2 text-left"><SortableHeader label="Receipt"   sortKey="receiptNumber" current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                        <th className="px-3 py-2 text-left"><SortableHeader label="Date"      sortKey="_date"         current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                        <th className="px-3 py-2 text-left"><SortableHeader label="Invoice"   sortKey="invoiceId"     current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                        <th className="px-3 py-2 text-right"><SortableHeader label="Amount"   sortKey="_amount"       current={sortKey} dir={sortDir} onToggle={toggle} align="right" /></th>
                        <th className="px-3 py-2 text-right"><SortableHeader label="WHT"      sortKey="_wht"          current={sortKey} dir={sortDir} onToggle={toggle} align="right" /></th>
                        <th className="px-3 py-2 text-left"><SortableHeader label="Method"    sortKey="paymentMethod" current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                        <th className="px-3 py-2 text-left"><SortableHeader label="Logged by" sortKey="loggedBy"      current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                        <th className="px-3 py-2 text-center"><SortableHeader label="Status"  sortKey="status"        current={sortKey} dir={sortDir} onToggle={toggle} align="center" /></th>
                        <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Invoice PDF</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {sortedRows.map(p => {
                        const isReversed = p.status === 'REVERSED';
                        return (
                            <tr key={p.id} className={`hover:bg-gray-50 ${isReversed ? 'opacity-60' : ''}`}>
                                <td className={`px-3 py-2 text-sm font-mono ${isReversed ? 'line-through' : ''}`}>{p.receiptNumber || `PAY-${p.id}`}</td>
                                <td className={`px-3 py-2 text-sm ${isReversed ? 'line-through' : ''}`}>{fmtDate(p.paymentDate || p.createdAt)}</td>
                                <td className="px-3 py-2 text-sm font-mono">
                                    {/* Invoice link — only shown when the payment is tied to
                                        a real invoice. Goes to the InvoiceEditor where the
                                        full ledger lives. */}
                                    {p.invoiceId ? (
                                        <button onClick={() => navigateTo('invoiceEditor', { invoiceId: p.invoiceId })} className="text-blue-600 hover:underline">
                                            {p.invoiceId}
                                        </button>
                                    ) : (
                                        <span className="text-gray-400 italic">—</span>
                                    )}
                                </td>
                                <td className={`px-3 py-2 text-right text-sm font-mono ${isReversed ? 'line-through' : ''}`}>{fmtMoney('GHS', p.amount)}</td>
                                <td className={`px-3 py-2 text-right text-sm font-mono text-gray-600 ${isReversed ? 'line-through' : ''}`}>{p.whtTotal > 0 ? fmtMoney('GHS', p.whtTotal) : '—'}</td>
                                <td className={`px-3 py-2 text-sm text-gray-600 ${isReversed ? 'line-through' : ''}`}>{p.paymentMethod}</td>
                                <td className="px-3 py-2 text-sm text-gray-500">{(p.loggedBy || '').split('@')[0]}</td>
                                <td className="px-3 py-2 text-center">
                                    <span
                                        className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase ${
                                            isReversed ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                                        }`}
                                        title={isReversed ? `Reversed: ${p.reversalReason || ''}` : ''}
                                    >
                                        {p.status || 'Confirmed'}
                                    </span>
                                </td>
                                <td className="px-3 py-2 text-center">
                                    {/* Invoice PDF — regenerated on demand from the
                                        invoice record. The "attachment" effectively is
                                        the customer-facing PDF that was signed at
                                        approval; PDFService re-renders it deterministically
                                        from the same data. */}
                                    {p.invoiceId ? (
                                        <button
                                            type="button"
                                            onClick={() => onDownloadPDF(p.invoiceId)}
                                            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                                            title="Download the signed invoice PDF sent to the customer"
                                        >
                                            <Icon id="file-pdf" className="w-3.5 h-3.5" />
                                            PDF
                                        </button>
                                    ) : (
                                        <span className="text-gray-300">—</span>
                                    )}
                                </td>
                                <td className="px-3 py-2 text-right">
                                    {/* Reverse action — gated by permission and only on
                                        confirmed (non-reversed) payments. Server enforces
                                        the 24h officer window; head bypasses. */}
                                    {!isReversed && canReverse && (
                                        <button
                                            type="button"
                                            onClick={() => onReverse(p)}
                                            className="text-xs text-red-600 hover:underline"
                                            title="Reverse this payment"
                                        >
                                            Reverse
                                        </button>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                    {sortedRows.length === 0 && (
                        <tr><td colSpan="10" className="px-3 py-8 text-center text-gray-500">No payments logged yet.</td></tr>
                    )}
                </tbody>
            </table>
        </div>
    );
};

const UnallocatedTab = ({ rows, query, customerFilter, statusFilter, dateFrom, dateTo }) => {
    const fromTs = dateFrom ? Date.parse(dateFrom) : null;
    const toTs   = dateTo   ? Date.parse(dateTo)   : null;
    const filtered = useMemo(() => rows.filter(r => {
        if (customerFilter && r.customerId !== customerFilter) return false;
        if (statusFilter && statusFilter !== 'ALL' && r.status !== statusFilter) return false;
        const ts = Date.parse(r.paymentDate || r.loggedAt) || 0;
        if (fromTs && ts < fromTs) return false;
        if (toTs   && ts > toTs + 86_400_000) return false;
        if (!matchesQuery(query, r.customerId, r.referenceNumber, r.paymentMethod, r.amount)) return false;
        return true;
    }), [rows, query, customerFilter, statusFilter, fromTs, toTs]);

    const sortable = useMemo(() => filtered.map(r => ({
        ...r,
        _date:   Date.parse(r.paymentDate || r.loggedAt) || 0,
        _amount: Number(r.amount) || 0
    })), [filtered]);
    const { sortKey, sortDir, toggle, sortedRows } = useSortable(sortable, '_date', 'desc');

    return (
        <div className="overflow-x-auto">
            <div className="mb-3 text-sm text-gray-600">
                Payments received without an invoice assignment. Apply each to one or more outstanding invoices from the customer's statement page.
            </div>
            <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                    <tr>
                        <th className="px-3 py-2 text-left"><SortableHeader label="Customer"  sortKey="customerId"     current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                        <th className="px-3 py-2 text-left"><SortableHeader label="Date"      sortKey="_date"          current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                        <th className="px-3 py-2 text-right"><SortableHeader label="Amount"   sortKey="_amount"        current={sortKey} dir={sortDir} onToggle={toggle} align="right" /></th>
                        <th className="px-3 py-2 text-left"><SortableHeader label="Method"    sortKey="paymentMethod"  current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                        <th className="px-3 py-2 text-left"><SortableHeader label="Reference" sortKey="referenceNumber" current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                        <th className="px-3 py-2 text-center"><SortableHeader label="Status"  sortKey="status"          current={sortKey} dir={sortDir} onToggle={toggle} align="center" /></th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {sortedRows.map(r => (
                        <tr key={r.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2 text-sm">{r.customerId}</td>
                            <td className="px-3 py-2 text-sm">{fmtDate(r.paymentDate || r.loggedAt)}</td>
                            <td className="px-3 py-2 text-right text-sm font-mono">{fmtMoney(r.currency, r.amount)}</td>
                            <td className="px-3 py-2 text-sm">{r.paymentMethod}</td>
                            <td className="px-3 py-2 text-sm">{r.referenceNumber}</td>
                            <td className="px-3 py-2 text-center">
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                    r.status === 'APPLIED'           ? 'bg-emerald-100 text-emerald-700' :
                                    r.status === 'PARTIALLY_APPLIED' ? 'bg-amber-100 text-amber-700' :
                                                                       'bg-gray-100 text-gray-700'
                                }`}>{r.status}</span>
                            </td>
                        </tr>
                    ))}
                    {sortedRows.length === 0 && (
                        <tr><td colSpan="6" className="px-3 py-8 text-center text-gray-500">No unallocated payments.</td></tr>
                    )}
                </tbody>
            </table>
        </div>
    );
};

const ActionsTab = ({ rows, query, customerFilter, dateFrom, dateTo, navigateTo }) => {
    const fromTs = dateFrom ? Date.parse(dateFrom) : null;
    const toTs   = dateTo   ? Date.parse(dateTo)   : null;
    const filtered = useMemo(() => rows.filter(a => {
        const ts = Date.parse(a.actionDate) || 0;
        if (fromTs && ts < fromTs) return false;
        if (toTs   && ts > toTs + 86_400_000) return false;
        if (!matchesQuery(query, a.invoiceId, a.actionType, a.outcome, a.actor, a.notes)) return false;
        // customerFilter intentionally ignored — actions rows don't carry
        // the customer name (they're invoice-scoped). The Recent Payments
        // and Overdue tabs are the right ones for customer-centric search.
        return true;
    }), [rows, query, fromTs, toTs]);

    const sortable = useMemo(() => filtered.map(a => ({
        ...a,
        _when:     Date.parse(a.actionDate) || 0,
        _promised: Date.parse(a.promiseToPayDate) || 0,
        _next:     Date.parse(a.nextActionDate) || 0
    })), [filtered]);
    const { sortKey, sortDir, toggle, sortedRows } = useSortable(sortable, '_when', 'desc');

    return (
        <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                    <tr>
                        <th className="px-3 py-2 text-left"><SortableHeader label="When"     sortKey="_when"     current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                        <th className="px-3 py-2 text-left"><SortableHeader label="Invoice"  sortKey="invoiceId" current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                        <th className="px-3 py-2 text-left"><SortableHeader label="Type"     sortKey="actionType" current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                        <th className="px-3 py-2 text-left"><SortableHeader label="Outcome"  sortKey="outcome"   current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                        <th className="px-3 py-2 text-left"><SortableHeader label="Promised" sortKey="_promised" current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                        <th className="px-3 py-2 text-left"><SortableHeader label="Next"     sortKey="_next"     current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                        <th className="px-3 py-2 text-left"><SortableHeader label="Actor"    sortKey="actor"     current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {sortedRows.map(a => (
                        <tr key={a.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2 text-sm">{fmtDate(a.actionDate)}</td>
                            <td className="px-3 py-2 text-sm font-mono">
                                <button onClick={() => navigateTo('invoiceEditor', { invoiceId: a.invoiceId })} className="text-blue-600 hover:underline">
                                    {a.invoiceId}
                                </button>
                            </td>
                            <td className="px-3 py-2 text-sm">{a.actionType}</td>
                            <td className="px-3 py-2 text-sm text-gray-600">{a.outcome || '—'}</td>
                            <td className="px-3 py-2 text-sm">{fmtDate(a.promiseToPayDate)}</td>
                            <td className="px-3 py-2 text-sm">{fmtDate(a.nextActionDate)}</td>
                            <td className="px-3 py-2 text-sm text-gray-500">{(a.actor || '').split('@')[0]}</td>
                        </tr>
                    ))}
                    {sortedRows.length === 0 && (
                        <tr><td colSpan="7" className="px-3 py-8 text-center text-gray-500">No follow-up actions logged yet.</td></tr>
                    )}
                </tbody>
            </table>
        </div>
    );
};

export default CollectionsWorkbench;
