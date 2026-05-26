/**
 * GoodsReceipts — Module 3 list view of all receiving events.
 *
 * Procurement officers and heads land here to see what's been received
 * recently, drill into individual receipts, and log RMAs / returns.
 * Receipts are created from the PR Detail page (where the PR context
 * lives) — this page is read-mostly with a return-logging modal.
 *
 * Filters: status, vendor, date range, search by receipt # / PR # /
 * vendor invoice #. Sortable columns throughout.
 */

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import api from '../api';
import socket from '../socket';
import Icon from '../components/common/Icon';
import PageHeader from '../components/common/PageHeader';
import Button from '../components/common/Button';
import { SortableHeader, useSortable } from '../components/v2';
import { useApp } from '../context/AppContext';
import { can } from '../utils/permissions';

const STATUS_OPTIONS = [
    { value: 'ALL',                label: 'All statuses' },
    { value: 'PENDING_QC',         label: 'Pending QC' },
    { value: 'ACCEPTED',           label: 'Accepted' },
    { value: 'PARTIALLY_ACCEPTED', label: 'Partially Accepted' },
    { value: 'REJECTED',           label: 'Rejected' }
];

const fmtMoney = (currency, amount) =>
    `${currency || 'GHS'} ${Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (s) => s ? new Date(s).toLocaleDateString() : '—';

const STATUS_BADGE = {
    PENDING_QC:         'bg-amber-100 text-amber-700',
    ACCEPTED:           'bg-emerald-100 text-emerald-700',
    PARTIALLY_ACCEPTED: 'bg-blue-100 text-blue-700',
    REJECTED:           'bg-red-100 text-red-700'
};

const GoodsReceipts = ({ navigateTo, currentUser }) => {
    const { appUser } = useApp();
    const [receipts, setReceipts] = useState([]);
    const [loading, setLoading]   = useState(true);
    const [error, setError]       = useState(null);

    const [statusFilter, setStatusFilter] = useState('ALL');
    const [dateFrom, setDateFrom]         = useState('');
    const [dateTo, setDateTo]             = useState('');
    const [query, setQuery]               = useState('');

    const canViewScorecard = can(appUser, 'vendor_scorecard.read');

    const fetchReceipts = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params = {};
            if (statusFilter !== 'ALL') params.status = statusFilter;
            if (dateFrom) params.from = dateFrom;
            if (dateTo)   params.to   = dateTo;
            const res = await api.get('/goods-receipts', { params });
            if (res?.success) setReceipts(res.data || []);
            else setError(res?.error || 'Could not load receipts.');
        } catch (err) {
            const status = err?.response?.status;
            const msg    = err?.response?.data?.error || err?.message || 'Unknown error';
            setError(status === 403
                ? "You don't have permission to view goods receipts."
                : `Failed to load receipts (${status || 'network'}): ${msg}`);
        } finally {
            setLoading(false);
        }
    }, [statusFilter, dateFrom, dateTo]);

    useEffect(() => {
        fetchReceipts();
        if (!socket.connected) socket.connect();
        const refetch = () => fetchReceipts();
        socket.on('goods-receipts:updated', refetch);
        return () => socket.off('goods-receipts:updated', refetch);
    }, [fetchReceipts]);

    // Apply search filter — covers receipt #, PR number AND id, vendor
    // name AND id, vendor invoice ref, and the PR's item name (so an
    // operator can type "laptop" and see all receipts of laptops).
    const filtered = useMemo(() => {
        if (!query.trim()) return receipts;
        const term = query.toLowerCase();
        return receipts.filter(r =>
            (r.receiptNumber || '').toLowerCase().includes(term) ||
            (r.prNumber || '').toLowerCase().includes(term) ||
            (r.prId || '').toLowerCase().includes(term) ||
            (r.prItemName || '').toLowerCase().includes(term) ||
            (r.vendorName || '').toLowerCase().includes(term) ||
            (r.vendorId || '').toLowerCase().includes(term) ||
            (r.vendorInvoiceNumber || '').toLowerCase().includes(term)
        );
    }, [receipts, query]);

    // Sortable projection
    const sortableRows = useMemo(() => filtered.map(r => ({
        ...r,
        _date:    Date.parse(r.receivedDate) || 0,
        _qtyRec:  Number(r.qtyReceived) || 0,
        _value:   Number(r.totalValue) || 0
    })), [filtered]);
    const { sortKey, sortDir, toggle, sortedRows } = useSortable(sortableRows, '_date', 'desc');

    return (
        <>
            <PageHeader
                title="Goods Receipts"
                actions={
                    <>
                        {canViewScorecard && (
                            <Button
                                variant="ghost"
                                size="sm"
                                leftIcon={<Icon id="chart-bar" />}
                                onClick={() => navigateTo('vendorScorecard')}
                            >
                                Vendor Scorecards
                            </Button>
                        )}
                    </>
                }
            />

            {/* Filter strip */}
            <div className="bg-surface p-3 rounded-panel shadow-card border border-line mb-3">
                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative flex-1 min-w-[220px] max-w-md">
                        <input
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search receipt #, PR #, vendor, invoice #…"
                            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                        />
                        <Icon id="search" className="absolute left-2 top-2.5 text-gray-400 w-4 h-4" />
                    </div>
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="px-2 py-1.5 text-sm border border-gray-300 rounded bg-white"
                    >
                        {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                    <input
                        type="date"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        className="px-2 py-1.5 text-sm border border-gray-300 rounded bg-white"
                        title="From received date"
                    />
                    <span className="text-xs text-gray-500">to</span>
                    <input
                        type="date"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                        className="px-2 py-1.5 text-sm border border-gray-300 rounded bg-white"
                        title="To received date"
                    />
                    {(query || statusFilter !== 'ALL' || dateFrom || dateTo) && (
                        <button
                            type="button"
                            onClick={() => { setQuery(''); setStatusFilter('ALL'); setDateFrom(''); setDateTo(''); }}
                            className="text-xs text-blue-600 hover:underline ml-1"
                        >
                            Clear filters
                        </button>
                    )}
                </div>
            </div>

            {/* Table */}
            <div className="bg-surface p-4 rounded-panel shadow-card border border-line">
                {error && (
                    <div className="mb-3 p-3 rounded border border-red-200 bg-red-50 text-sm text-red-700">{error}</div>
                )}

                {loading ? (
                    <div className="text-center py-12 text-gray-500">
                        <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mr-2"></div>
                        Loading receipts…
                    </div>
                ) : sortedRows.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                        {receipts.length === 0
                            ? 'No goods receipts logged yet. Receipts are created from the Purchase Requisition detail page when a PR is in AWARDED status.'
                            : 'No receipts match the current filters.'}
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-3 py-2 text-left"><SortableHeader label="Receipt #" sortKey="receiptNumber" current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                                    <th className="px-3 py-2 text-left"><SortableHeader label="Date"     sortKey="_date"          current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                                    <th className="px-3 py-2 text-left"><SortableHeader label="PR / Item" sortKey="prNumber"      current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                                    <th className="px-3 py-2 text-left"><SortableHeader label="Vendor"    sortKey="vendorName"    current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                                    <th className="px-3 py-2 text-right"><SortableHeader label="Qty Rec'd" sortKey="_qtyRec"     current={sortKey} dir={sortDir} onToggle={toggle} align="right" /></th>
                                    <th className="px-3 py-2 text-right"><SortableHeader label="Value"   sortKey="_value"         current={sortKey} dir={sortDir} onToggle={toggle} align="right" /></th>
                                    <th className="px-3 py-2 text-left"><SortableHeader label="Vendor Inv #" sortKey="vendorInvoiceNumber" current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                                    <th className="px-3 py-2 text-center"><SortableHeader label="Status" sortKey="status"        current={sortKey} dir={sortDir} onToggle={toggle} align="center" /></th>
                                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {sortedRows.map(r => (
                                    <tr key={r.id} className="hover:bg-gray-50">
                                        <td className="px-3 py-2 text-sm font-mono">{r.receiptNumber}</td>
                                        <td className="px-3 py-2 text-sm">{fmtDate(r.receivedDate)}</td>
                                        <td className="px-3 py-2 text-sm">
                                            {/* Show the human-readable PR number (e.g. PR-2026-0008)
                                                with the item description directly below. Clicking
                                                still navigates by the internal prId. Raw UUID kept
                                                in the tooltip in case operators need it for support. */}
                                            {r.prId ? (
                                                <button
                                                    onClick={() => navigateTo('purchaseRequisitionDetail', r.prId)}
                                                    className="text-left"
                                                    title={r.prId}
                                                >
                                                    <span className="text-blue-600 hover:underline font-mono text-xs">
                                                        {r.prNumber || r.prId}
                                                    </span>
                                                    {r.prItemName && (
                                                        <span className="block text-[11px] text-gray-500 truncate max-w-[260px]">
                                                            {r.prItemName}
                                                        </span>
                                                    )}
                                                </button>
                                            ) : '—'}
                                        </td>
                                        <td className="px-3 py-2 text-sm text-gray-700">
                                            {r.vendorName || (
                                                <span title={r.vendorId} className="text-gray-400 italic">
                                                    {r.vendorId ? r.vendorId.slice(0, 12) + '…' : '—'}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-right text-sm font-mono">
                                            {Number(r.qtyReceived).toLocaleString()}
                                            {r.qtyDefective > 0 && (
                                                <span className="text-[10px] text-red-600 ml-1 block">({r.qtyDefective} defect)</span>
                                            )}
                                            {r.qtyReturned > 0 && (
                                                <span className="text-[10px] text-amber-700 block">({r.qtyReturned} returned)</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-right text-sm font-mono">{fmtMoney(r.currency, r.totalValue)}</td>
                                        <td className="px-3 py-2 text-sm text-gray-600">{r.vendorInvoiceNumber || '—'}</td>
                                        <td className="px-3 py-2 text-center">
                                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[r.status] || 'bg-gray-100 text-gray-700'}`}>
                                                {r.status}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            <button
                                                onClick={() => navigateTo('purchaseRequisitionDetail', r.prId)}
                                                className="text-xs text-blue-600 hover:underline"
                                                title="Open the source PR"
                                            >
                                                Open PR
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </>
    );
};

export default GoodsReceipts;
