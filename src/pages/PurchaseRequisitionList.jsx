import React, { useState, useMemo, useEffect } from 'react';
import Icon from '../components/common/Icon';
import { useRealtimePRs } from '../hooks/useRealtimePRs';
import { useDebounce } from '../hooks/useDebounce';

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

    const totalPages = pagination?.totalPages || 1;
    const totalCount = pagination?.total || 0;

    const role = currentUser?.role;
    const backPage = role === 'procurement' ? 'procurementDashboard' : 'controllerDashboard';

    return (
        <div className="min-h-screen bg-gray-100">
            <div className="max-w-7xl mx-auto p-4 md:p-8">
                <header className="bg-white p-4 rounded-xl shadow-md mb-6 flex justify-between items-center">
                    <h1 className="text-2xl font-bold">Purchase Requisitions</h1>
                    <button onClick={() => navigateTo(backPage)} className="text-sm">
                        <Icon id="arrow-left" className="mr-1" /> Back
                    </button>
                </header>

                <div className="bg-white p-6 rounded-xl shadow-md">
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
                                        <th className="p-3 font-semibold text-xs text-gray-500 uppercase">PR #</th>
                                        <th className="p-3 font-semibold text-xs text-gray-500 uppercase">Item</th>
                                        <th className="p-3 font-semibold text-xs text-gray-500 uppercase">Customer</th>
                                        <th className="p-3 font-semibold text-xs text-gray-500 uppercase text-center">Qty</th>
                                        <th className="p-3 font-semibold text-xs text-gray-500 uppercase">Needed By</th>
                                        <th className="p-3 font-semibold text-xs text-gray-500 uppercase text-center">Reason</th>
                                        <th className="p-3 font-semibold text-xs text-gray-500 uppercase text-center">Priority</th>
                                        <th className="p-3 font-semibold text-xs text-gray-500 uppercase text-center">Status</th>
                                        <th className="p-3 font-semibold text-xs text-gray-500 uppercase"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtered.map(pr => (
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
            </div>
        </div>
    );
};

export default PurchaseRequisitionList;
