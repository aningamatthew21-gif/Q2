import React, { useState, useMemo, useEffect } from 'react';
import Icon from '../components/common/Icon';
import PageHeader from '../components/common/PageHeader';
import Button from '../components/common/Button';
import { useRealtimePRs } from '../hooks/useRealtimePRs';
import { useDebounce } from '../hooks/useDebounce';
import { SortableHeader, useSortable } from '../components/v2';

const STATUS_FILTERS = [
    { id: 'ALL',       label: 'All' },
    { id: 'OPEN',      label: 'Open' },
    { id: 'IN_RFQ',    label: 'In RFQ' },
    { id: 'AWARDED',   label: 'Awarded' },
    { id: 'FULFILLED', label: 'Fulfilled' },
    { id: 'CANCELLED', label: 'Cancelled' }
];

const PAGE_SIZE = 50;

// Helper: safely extract status from pageContext regardless of whether it's an object or null
const getContextStatus = (ctx) => {
    if (!ctx) return null;
    if (typeof ctx === 'object') return ctx.status || null;
    return null; // pageContext was a plain string (e.g. from a detail-page back-nav) — ignore it
};

const PurchaseRequisitionList = ({ navigateTo, currentUser, pageContext }) => {
    const [statusFilter, setStatusFilter] = useState(getContextStatus(pageContext) || 'ALL');
    const [searchTerm, setSearchTerm] = useState('');
    const [page, setPage] = useState(1);
    const debounced = useDebounce(searchTerm, 300);

    useEffect(() => {
        const s = getContextStatus(pageContext);
        if (s) setStatusFilter(s);
        setPage(1); // reset to first page when filter changes
    }, [pageContext]);

    // Reset page when status filter changes
    const handleStatusChange = (newStatus) => {
        setStatusFilter(newStatus);
        setPage(1);
    };

    const filters = { page, pageSize: PAGE_SIZE };
    if (statusFilter !== 'ALL') filters.status = statusFilter;

    const { data: prs, loading, pagination } = useRealtimePRs(filters);

    // Client-side search filters within the current page's data
    const filtered = useMemo(() => {
        if (!debounced.trim()) return prs;
        const term = debounced.toLowerCase();
        return prs.filter(pr =>
            pr.itemName?.toLowerCase().includes(term) ||
            pr.prNumber?.toLowerCase().includes(term) ||
            pr.customerName?.toLowerCase().includes(term) ||
            pr.invoiceId?.toLowerCase().includes(term)
        );
    }, [prs, debounced]);

    // Numeric / date projections so useSortable picks the right comparator.
    const sortablePrs = useMemo(() => filtered.map(pr => ({
        ...pr,
        _qty:      Number(pr.quantity) || 0,
        _needed:   Date.parse(pr.neededBy) || 0,
        _created:  Date.parse(pr.createdAt) || 0
    })), [filtered]);
    const { sortKey, sortDir, toggle: toggleSort, sortedRows: sortedPrs } =
        useSortable(sortablePrs, '_created', 'desc');

    const totalPages = pagination?.totalPages || 1;
    const totalCount = pagination?.total || 0;

    const role = currentUser?.role;
    const backPage = role === 'procurement' ? 'procurementDashboard' : 'controllerDashboard';

    return (
        <>
            <PageHeader
                title="Purchase Requisitions"
                actions={
                    <Button variant="ghost" size="sm" onClick={() => navigateTo(backPage)} leftIcon={<Icon id="arrow-left" />}>
                        Back
                    </Button>
                }
            />

            <div className="bg-surface p-6 rounded-panel shadow-card border border-line">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
                        <div className="flex flex-wrap gap-2">
                            {STATUS_FILTERS.map(f => (
                                <button
                                    key={f.id}
                                    onClick={() => handleStatusChange(f.id)}
                                    className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                                        statusFilter === f.id
                                            ? 'bg-blue-600 text-white'
                                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                    }`}
                                >
                                    {f.label}
                                </button>
                            ))}
                        </div>
                        <input
                            type="text"
                            placeholder="Search by item, PR number, customer, invoice..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full md:w-96 p-2 border border-gray-300 rounded-md"
                        />
                    </div>

                    {loading ? (
                        <div className="text-center py-8">
                            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                            <p className="mt-2 text-gray-600">Loading…</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="p-3 text-left"><SortableHeader  label="PR #"     sortKey="prNumber"     current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>
                                        <th className="p-3 text-left"><SortableHeader  label="Item"     sortKey="itemName"     current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>
                                        <th className="p-3 text-left"><SortableHeader  label="Customer" sortKey="customerName" current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>
                                        <th className="p-3 text-center"><SortableHeader label="Qty"     sortKey="_qty"         current={sortKey} dir={sortDir} onToggle={toggleSort} align="center" /></th>
                                        <th className="p-3 text-left"><SortableHeader  label="Needed By" sortKey="_needed"     current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>
                                        <th className="p-3 text-center"><SortableHeader label="Reason"  sortKey="reason"       current={sortKey} dir={sortDir} onToggle={toggleSort} align="center" /></th>
                                        <th className="p-3 text-center"><SortableHeader label="Priority" sortKey="priority"    current={sortKey} dir={sortDir} onToggle={toggleSort} align="center" /></th>
                                        <th className="p-3 text-center"><SortableHeader label="Status"  sortKey="status"       current={sortKey} dir={sortDir} onToggle={toggleSort} align="center" /></th>
                                        <th className="p-3 font-semibold text-xs text-gray-500 uppercase"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedPrs.map(pr => (
                                        <tr key={pr.id} className="border-b hover:bg-gray-50">
                                            <td className="p-3 font-mono text-xs">{pr.prNumber || pr.id.slice(0, 8)}</td>
                                            <td className="p-3 font-medium">{pr.itemName}</td>
                                            <td className="p-3 text-sm text-gray-600">{pr.customerName || '—'}</td>
                                            <td className="p-3 text-center">{pr.quantity}</td>
                                            <td className="p-3 text-sm">{pr.neededBy || '—'}</td>
                                            <td className="p-3 text-center text-xs">
                                                <span className={`px-2 py-0.5 rounded-full font-medium ${
                                                    pr.reason === 'CUSTOM_SOURCED'   ? 'bg-purple-100 text-purple-700' :
                                                    pr.reason === 'OUT_OF_STOCK'     ? 'bg-red-100 text-red-700'       :
                                                    pr.reason === 'INSUFFICIENT'     ? 'bg-yellow-100 text-yellow-700' :
                                                    pr.reason === 'NOT_IN_INVENTORY' ? 'bg-gray-100 text-gray-700'     :
                                                    'bg-gray-100 text-gray-600'
                                                }`}>
                                                    {pr.reason === 'CUSTOM_SOURCED' ? 'Custom Sourced' :
                                                     pr.reason === 'OUT_OF_STOCK' ? 'Out of Stock' :
                                                     pr.reason === 'INSUFFICIENT' ? 'Backorder' :
                                                     pr.reason === 'NOT_IN_INVENTORY' ? 'Not in Inventory' :
                                                     pr.reason}
                                                </span>
                                            </td>
                                            <td className="p-3 text-center">
                                                <span className={`px-2 py-1 rounded-full text-xs ${
                                                    pr.priority === 'urgent' ? 'bg-red-100 text-red-700'    :
                                                    pr.priority === 'high'   ? 'bg-orange-100 text-orange-700':
                                                    'bg-gray-100 text-gray-700'
                                                }`}>{pr.priority}</span>
                                            </td>
                                            <td className="p-3 text-center">
                                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                                    pr.status === 'OPEN'      ? 'bg-amber-100 text-amber-800'  :
                                                    pr.status === 'IN_RFQ'    ? 'bg-blue-100 text-blue-800'    :
                                                    pr.status === 'AWARDED'   ? 'bg-green-100 text-green-800'  :
                                                    pr.status === 'FULFILLED' ? 'bg-emerald-100 text-emerald-800' :
                                                    pr.status === 'CANCELLED' ? 'bg-gray-100 text-gray-600'    :
                                                    'bg-gray-100 text-gray-800'
                                                }`}>{pr.status}</span>
                                            </td>
                                            <td className="p-3 text-right">
                                                <button onClick={() => navigateTo('purchaseRequisitionDetail', pr.id)} className="text-blue-600 text-sm font-medium">Open</button>
                                            </td>
                                        </tr>
                                    ))}
                                    {filtered.length === 0 && (
                                        <tr>
                                            <td colSpan="9" className="p-6 text-center text-gray-500">
                                                No purchase requisitions match the current filters.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Pagination controls */}
                    {!loading && totalPages > 1 && (
                        <div className="flex items-center justify-between mt-4 pt-4 border-t">
                            <p className="text-sm text-gray-500">
                                Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, totalCount)} of {totalCount} requisitions
                            </p>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                    disabled={page <= 1}
                                    className="px-3 py-1 text-sm border rounded disabled:opacity-40 hover:bg-gray-50"
                                >
                                    ← Prev
                                </button>
                                <span className="px-3 py-1 text-sm text-gray-700">
                                    Page {page} / {totalPages}
                                </span>
                                <button
                                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                    disabled={page >= totalPages}
                                    className="px-3 py-1 text-sm border rounded disabled:opacity-40 hover:bg-gray-50"
                                >
                                    Next →
                                </button>
                            </div>
                        </div>
                    )}
                    {!loading && totalPages <= 1 && totalCount > 0 && (
                        <p className="text-xs text-gray-400 mt-3 text-right">{totalCount} requisition{totalCount !== 1 ? 's' : ''}</p>
                    )}
            </div>
        </>
    );
};

export default PurchaseRequisitionList;
