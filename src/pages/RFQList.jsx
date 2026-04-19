import React, { useState, useMemo } from 'react';
import Icon from '../components/common/Icon';
import { useRealtimeRFQs } from '../hooks/useRealtimeRFQs';
import { useDebounce } from '../hooks/useDebounce';

const STATUS_FILTERS = [
    { id: 'ALL',              label: 'All' },
    { id: 'DRAFT',            label: 'Draft' },
    { id: 'SENT',             label: 'Sent' },
    { id: 'RECEIVING',        label: 'Receiving' },
    { id: 'COMPARING',        label: 'Comparing' },
    { id: 'PENDING_APPROVAL', label: 'Pending Approval' },
    { id: 'AWARDED',          label: 'Awarded' },
    { id: 'CANCELLED',        label: 'Cancelled' },
    // Phase 5 — risk pseudo-filters (not real status values, handled client-side)
    { id: 'PAST_DEADLINE',    label: 'Past Deadline' },
    { id: 'ESCALATED',        label: 'Escalated' }
];

// Pseudo-filters aren't real statuses, so the realtime hook should fetch all
// and we filter client-side.
const PSEUDO_FILTERS = new Set(['PAST_DEADLINE', 'ESCALATED']);

const STATUS_LABELS = {
    DRAFT: 'Draft', SENT: 'Sent', RECEIVING: 'Receiving', COMPARING: 'Comparing',
    PENDING_APPROVAL: 'Pending Approval', AWARDED: 'Awarded', CANCELLED: 'Cancelled'
};
const StatusBadge = ({ value }) => (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
        value === 'DRAFT'            ? 'bg-gray-100 text-gray-700'    :
        value === 'SENT'             ? 'bg-blue-100 text-blue-800'    :
        value === 'RECEIVING'        ? 'bg-amber-100 text-amber-800'  :
        value === 'COMPARING'        ? 'bg-purple-100 text-purple-800':
        value === 'PENDING_APPROVAL' ? 'bg-yellow-100 text-yellow-800':
        value === 'AWARDED'          ? 'bg-green-100 text-green-800'  :
        value === 'CANCELLED'        ? 'bg-red-100 text-red-700'      :
        'bg-gray-100 text-gray-800'
    }`}>{STATUS_LABELS[value] || value}</span>
);

const RFQList = ({ navigateTo, currentUser }) => {
    const [statusFilter, setStatusFilter] = useState('ALL');
    const [searchTerm, setSearchTerm] = useState('');
    const debounced = useDebounce(searchTerm, 300);

    const { data: rfqs, loading } = useRealtimeRFQs(
        (statusFilter === 'ALL' || PSEUDO_FILTERS.has(statusFilter)) ? {} : { status: statusFilter }
    );

    const filtered = useMemo(() => {
        let base = rfqs;
        // Apply pseudo-filter first
        if (statusFilter === 'PAST_DEADLINE') {
            base = base.filter(r => r.isPastDeadline && !r.isEscalated);
        } else if (statusFilter === 'ESCALATED') {
            base = base.filter(r => r.isEscalated);
        }
        if (!debounced.trim()) return base;
        const term = debounced.toLowerCase();
        return base.filter(r =>
            r.rfqNumber?.toLowerCase().includes(term) ||
            r.title?.toLowerCase().includes(term)
        );
    }, [rfqs, debounced, statusFilter]);

    // Counts for the risk-filter chips so operators know at a glance how many need attention
    const riskCounts = useMemo(() => ({
        pastDeadline: rfqs.filter(r => r.isPastDeadline && !r.isEscalated).length,
        escalated:    rfqs.filter(r => r.isEscalated).length
    }), [rfqs]);

    const role = currentUser?.role;
    const backPage = role === 'procurement' ? 'procurementDashboard' : 'controllerDashboard';

    return (
        <div className="min-h-screen bg-gray-100">
            <div className="max-w-7xl mx-auto p-4 md:p-8">
                <header className="bg-white p-4 rounded-xl shadow-md mb-6 flex justify-between items-center">
                    <h1 className="text-2xl font-bold">Requests for Quotation</h1>
                    <div className="flex gap-2">
                        <button
                            onClick={() => navigateTo('rfqBuilder')}
                            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
                        >
                            <Icon id="plus" className="mr-1" /> New RFQ
                        </button>
                        <button onClick={() => navigateTo(backPage)} className="text-sm">
                            <Icon id="arrow-left" className="mr-1" /> Back
                        </button>
                    </div>
                </header>

                <div className="bg-white p-6 rounded-xl shadow-md">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
                        <div className="flex flex-wrap gap-2">
                            {STATUS_FILTERS.map(f => {
                                const isActive = statusFilter === f.id;
                                const isRisk = PSEUDO_FILTERS.has(f.id);
                                const count = f.id === 'PAST_DEADLINE' ? riskCounts.pastDeadline
                                            : f.id === 'ESCALATED'     ? riskCounts.escalated
                                            : null;
                                let cls;
                                if (isActive) {
                                    cls = f.id === 'ESCALATED'     ? 'bg-red-600 text-white'
                                        : f.id === 'PAST_DEADLINE' ? 'bg-amber-600 text-white'
                                        : 'bg-blue-600 text-white';
                                } else if (isRisk && count > 0) {
                                    cls = f.id === 'ESCALATED'
                                        ? 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100'
                                        : 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100';
                                } else {
                                    cls = 'bg-gray-100 text-gray-700 hover:bg-gray-200';
                                }
                                return (
                                    <button
                                        key={f.id}
                                        onClick={() => setStatusFilter(f.id)}
                                        className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${cls}`}
                                    >
                                        {isRisk && (
                                            <Icon id={f.id === 'ESCALATED' ? 'exclamation-circle' : 'clock'} className="mr-1" />
                                        )}
                                        {f.label}
                                        {isRisk && count > 0 && (
                                            <span className={`ml-2 inline-block min-w-[20px] px-1.5 py-0.5 rounded-full text-xs font-bold ${
                                                isActive ? 'bg-white/30' : (f.id === 'ESCALATED' ? 'bg-red-600 text-white' : 'bg-amber-600 text-white')
                                            }`}>
                                                {count}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                        <input
                            type="text"
                            placeholder="Search by RFQ # or title..."
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
                                        <th className="p-3 font-semibold text-xs text-gray-500 uppercase">RFQ #</th>
                                        <th className="p-3 font-semibold text-xs text-gray-500 uppercase">Title</th>
                                        <th className="p-3 font-semibold text-xs text-gray-500 uppercase">Deadline</th>
                                        <th className="p-3 font-semibold text-xs text-gray-500 uppercase text-center">Items</th>
                                        <th className="p-3 font-semibold text-xs text-gray-500 uppercase text-center" title="Responses received / Vendors invited">Responses</th>
                                        <th className="p-3 font-semibold text-xs text-gray-500 uppercase text-right">Award</th>
                                        <th className="p-3 font-semibold text-xs text-gray-500 uppercase text-center">Status</th>
                                        <th className="p-3 font-semibold text-xs text-gray-500 uppercase">Created</th>
                                        <th className="p-3 font-semibold text-xs text-gray-500 uppercase"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtered.map(r => {
                                        const needsAttention =
                                            (r.status === 'SENT' || r.status === 'RECEIVING') &&
                                            r.responseCount > 0 && r.responseCount < r.vendorCount;
                                        return (
                                        <tr key={r.id} className={`border-b hover:bg-gray-50 ${needsAttention ? 'bg-amber-50' : ''}`}>
                                            <td className="p-3 font-mono text-xs">{r.rfqNumber || r.id.slice(0, 8)}</td>
                                            <td className="p-3 font-medium">{r.title || '—'}</td>
                                            <td className="p-3 text-sm">{r.submissionDeadline || '—'}</td>
                                            <td className="p-3 text-center text-sm text-gray-600">{r.itemsCount || '—'}</td>
                                            <td className="p-3 text-center">
                                                {r.vendorCount > 0 ? (
                                                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                                        r.responseCount >= r.vendorCount
                                                            ? 'bg-green-100 text-green-700'
                                                            : r.responseCount > 0
                                                                ? 'bg-amber-100 text-amber-700'
                                                                : 'bg-gray-100 text-gray-600'
                                                    }`} title={`${r.responseCount} of ${r.vendorCount} vendors responded`}>
                                                        {r.responseCount}/{r.vendorCount}
                                                    </span>
                                                ) : '—'}
                                            </td>
                                            <td className="p-3 text-right text-sm">
                                                {r.totalAwardAmount > 0
                                                    ? `${r.currency} ${Number(r.totalAwardAmount).toLocaleString()}`
                                                    : '—'}
                                            </td>
                                            <td className="p-3 text-center">
                                                <StatusBadge value={r.status} />
                                                {r.isEscalated && (
                                                    <span
                                                        className="block mt-1 px-2 py-0.5 text-[10px] font-bold rounded-full bg-red-100 text-red-800 border border-red-300"
                                                        title={r.escalationReason || 'Escalated to procurement head'}
                                                    >
                                                        <Icon id="exclamation-circle" className="mr-1" />Escalated
                                                    </span>
                                                )}
                                                {!r.isEscalated && r.isPastDeadline && (
                                                    <span
                                                        className="block mt-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-amber-100 text-amber-800 border border-amber-300"
                                                        title={`Deadline: ${r.submissionDeadline} · open ${r.daysOpen || '?'} day(s)`}
                                                    >
                                                        <Icon id="clock" className="mr-1" />Past Deadline
                                                    </span>
                                                )}
                                            </td>
                                            <td className="p-3 text-xs text-gray-500">
                                                {r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '—'}
                                            </td>
                                            <td className="p-3 text-right">
                                                <button
                                                    onClick={() => navigateTo('rfqDetail', r.id)}
                                                    className="text-blue-600 text-sm font-medium"
                                                >
                                                    Open
                                                </button>
                                            </td>
                                        </tr>
                                        );
                                    })}
                                    {filtered.length === 0 && (
                                        <tr>
                                            <td colSpan="9" className="p-6 text-center text-gray-500">
                                                No RFQs match the current filters.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default RFQList;
