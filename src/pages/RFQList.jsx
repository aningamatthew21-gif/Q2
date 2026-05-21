import React, { useState, useMemo } from 'react';
import Icon from '../components/common/Icon';
import PageHeader from '../components/common/PageHeader';
import Button from '../components/common/Button';
import { useRealtimeRFQs } from '../hooks/useRealtimeRFQs';
import { useDebounce } from '../hooks/useDebounce';
import { SortableHeader, useSortable } from '../components/v2';
import { useApp } from '../context/AppContext';

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

    // Project numeric/date columns onto themselves so the sort hook's
    // detection picks the right comparator (numeric for amount, date for
    // deadline/created, locale-string for everything else).
    const sortableRfqs = useMemo(() => filtered.map(r => ({
        ...r,
        _award:    Number(r.totalAwardAmount) || 0,
        _items:    Number(r.lineItemCount) || 0,
        _vendors:  Number(r.vendorCount) || 0,
        _deadline: Date.parse(r.submissionDeadline) || 0,
        _created:  Date.parse(r.createdAt) || 0
    })), [filtered]);
    const { sortKey, sortDir, toggle: toggleSort, sortedRows: sortedRfqs } =
        useSortable(sortableRfqs, '_created', 'desc');

    // Pull the current user's email so we can render the "Yours" pill on
    // RFQs whose linked PRs are assigned to them. This mirrors the badge
    // we added to the PR list — officers can spot their workload at a
    // glance instead of opening every RFQ to check.
    const { userEmail } = useApp();
    const role = currentUser?.role;
    const backPage = (role === 'procurement_head' || role === 'procurement_officer' || role === 'procurement')
        ? 'procurementDashboard'
        : 'controllerDashboard';

    return (
        <>
            <PageHeader
                title="Requests for Quotation"
                actions={
                    <>
                        <Button variant="primary" size="sm" onClick={() => navigateTo('rfqBuilder')} leftIcon={<Icon id="plus" />}>
                            New RFQ
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => navigateTo(backPage)} leftIcon={<Icon id="arrow-left" />}>
                            Back
                        </Button>
                    </>
                }
            />

            <div className="bg-surface p-6 rounded-panel shadow-card border border-line">
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
                                        <th className="p-3 text-left"><SortableHeader  label="RFQ #"     sortKey="rfqNumber" current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>
                                        <th className="p-3 text-left"><SortableHeader  label="Title"     sortKey="title"     current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>
                                        <th className="p-3 text-left"><SortableHeader  label="Deadline"  sortKey="_deadline" current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>
                                        <th className="p-3 text-center"><SortableHeader label="Items"    sortKey="_items"    current={sortKey} dir={sortDir} onToggle={toggleSort} align="center" /></th>
                                        <th className="p-3 text-center"><SortableHeader label="Responses" sortKey="_vendors" current={sortKey} dir={sortDir} onToggle={toggleSort} align="center" /></th>
                                        <th className="p-3 text-right"><SortableHeader  label="Award"    sortKey="_award"    current={sortKey} dir={sortDir} onToggle={toggleSort} align="right" /></th>
                                        <th className="p-3 text-center"><SortableHeader label="Status"   sortKey="status"    current={sortKey} dir={sortDir} onToggle={toggleSort} align="center" /></th>
                                        <th className="p-3 text-left">Assigned</th>
                                        <th className="p-3 text-left"><SortableHeader  label="Created"   sortKey="_created"  current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>
                                        <th className="p-3 font-semibold text-xs text-gray-500 uppercase"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedRfqs.map(r => {
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
                                            <td className="p-3 text-sm text-gray-700">
                                                {(() => {
                                                    const officers = Array.isArray(r.assignedOfficers) ? r.assignedOfficers : [];
                                                    const isMine = userEmail && officers.includes(userEmail);
                                                    if (officers.length === 0) {
                                                        return <span className="text-gray-400 italic">Unassigned</span>;
                                                    }
                                                    return (
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <span className="truncate max-w-[180px]" title={officers.join(', ')}>
                                                                {officers[0].split('@')[0]}
                                                                {officers.length > 1 && (
                                                                    <span className="text-gray-400"> +{officers.length - 1}</span>
                                                                )}
                                                            </span>
                                                            {isMine && (
                                                                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-700 uppercase tracking-wide">
                                                                    Yours
                                                                </span>
                                                            )}
                                                        </div>
                                                    );
                                                })()}
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
                                            <td colSpan="10" className="p-6 text-center text-gray-500">
                                                No RFQs match the current filters.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
            </div>
        </>
    );
};

export default RFQList;
