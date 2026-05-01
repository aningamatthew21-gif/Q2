import React, { useMemo } from 'react';
import Icon from '../components/common/Icon';
import PageHeader from '../components/common/PageHeader';
import { useRealtimePRs } from '../hooks/useRealtimePRs';
import { useRealtimeVendors } from '../hooks/useRealtimeVendors';
import { useRealtimeRFQs } from '../hooks/useRealtimeRFQs';

const ProcurementDashboard = ({ navigateTo, userEmail, currentUser }) => {
    const username = userEmail ? userEmail.split('@')[0] : 'User';
    const { data: prs, loading: prsLoading } = useRealtimePRs();
    const { data: vendors } = useRealtimeVendors();
    const { data: rfqs } = useRealtimeRFQs();

    const stats = useMemo(() => {
        const open       = prs.filter(p => p.status === 'OPEN').length;
        const inRfq      = prs.filter(p => p.status === 'IN_RFQ').length;
        const awarded    = prs.filter(p => p.status === 'AWARDED').length;
        const fulfilled  = prs.filter(p => p.status === 'FULFILLED').length;
        const urgent     = prs.filter(p => p.priority === 'urgent' && p.status !== 'CANCELLED' && p.status !== 'FULFILLED').length;
        const activeVendors = vendors.filter(v => v.status === 'active').length;
        // RFQs that the procurement head needs to approve (recommend → PENDING_APPROVAL)
        const pendingApproval = rfqs.filter(r => r.status === 'PENDING_APPROVAL').length;
        return { open, inRfq, awarded, fulfilled, urgent, activeVendors, pendingApproval };
    }, [prs, vendors, rfqs]);

    // RFQs waiting on procurement-head sign-off. Shown as an actionable inbox.
    const pendingApprovalRFQs = useMemo(
        () => rfqs.filter(r => r.status === 'PENDING_APPROVAL').slice(0, 5),
        [rfqs]
    );

    const recentPRs = useMemo(() => {
        return [...prs]
            .filter(p => p.status === 'OPEN' || p.status === 'IN_RFQ')
            .slice(0, 8);
    }, [prs]);

    const StatCard = ({ label, value, color = 'text-gray-800', icon }) => (
        <div className="bg-white p-5 rounded-xl shadow-md">
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-sm text-gray-500 font-medium">{label}</p>
                    <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
                </div>
                {icon && <Icon id={icon} className="text-3xl text-gray-300" />}
            </div>
        </div>
    );

    return (
        <>
            <PageHeader title="Procurement Dashboard" />

                {/* Stat cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-8">
                    <StatCard label="Open Requests"   value={prsLoading ? '…' : stats.open}        color="text-amber-600" icon="inbox" />
                    <StatCard label="In RFQ"          value={prsLoading ? '…' : stats.inRfq}       color="text-blue-600"  icon="paper-plane" />
                    <StatCard label="Pending My Approval" value={stats.pendingApproval}            color={stats.pendingApproval > 0 ? 'text-yellow-600' : 'text-gray-400'} icon="user-check" />
                    <StatCard label="Awarded"         value={prsLoading ? '…' : stats.awarded}     color="text-green-600" icon="check-circle" />
                    <StatCard label="Fulfilled"       value={prsLoading ? '…' : stats.fulfilled}   color="text-emerald-600" icon="box" />
                    <StatCard label="Urgent"          value={prsLoading ? '…' : stats.urgent}      color="text-red-600"   icon="exclamation-triangle" />
                    <StatCard label="Active Vendors"  value={stats.activeVendors}                  color="text-teal-600"  icon="truck" />
                </div>

                {/* Pending Procurement-Head Approvals — actionable inbox.
                 *  These are RFQs that a procurement officer recommended; the procurement
                 *  head (this user, or admin) must approve to AWARD and push cost back to
                 *  the originating invoice. Not visible to finance/controller anymore. */}
                {pendingApprovalRFQs.length > 0 && (
                    <div className="mb-8 bg-yellow-50 border border-yellow-200 rounded-xl p-6">
                        <h2 className="text-lg font-semibold text-yellow-900 mb-4 flex items-center">
                            <span className="bg-yellow-600 text-white rounded-full w-8 h-8 flex items-center justify-center mr-3 text-sm font-bold">
                                {stats.pendingApproval}
                            </span>
                            RFQs Awaiting Your Approval
                        </h2>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-yellow-100 border-b border-yellow-300">
                                    <tr>
                                        <th className="p-3 text-left text-yellow-900">RFQ #</th>
                                        <th className="p-3 text-left text-yellow-900">Title</th>
                                        <th className="p-3 text-left text-yellow-900">Vendor</th>
                                        <th className="p-3 text-right text-yellow-900">Amount</th>
                                        <th className="p-3 text-center text-yellow-900">Created</th>
                                        <th className="p-3 text-center text-yellow-900">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pendingApprovalRFQs.map(rfq => (
                                        <tr key={rfq.id} className="border-b border-yellow-100 hover:bg-yellow-100 transition-colors">
                                            <td className="p-3 font-mono text-sm">{rfq.rfqNumber}</td>
                                            <td className="p-3">{(rfq.title || '').substring(0, 30)}{(rfq.title || '').length > 30 ? '...' : ''}</td>
                                            <td className="p-3">{rfq.awardedVendorName || '—'}</td>
                                            <td className="p-3 text-right font-semibold">{rfq.currency} {(rfq.totalAwardAmount || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                                            <td className="p-3 text-center text-xs text-gray-600">{rfq.createdAt ? new Date(rfq.createdAt).toLocaleDateString() : '—'}</td>
                                            <td className="p-3 text-center">
                                                <button onClick={() => navigateTo('rfqDetail', rfq.id)} className="text-blue-600 hover:underline text-xs font-semibold">
                                                    Review →
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {stats.pendingApproval > 5 && (
                            <p className="text-sm text-yellow-700 mt-3">... and {stats.pendingApproval - 5} more. View all in <button onClick={() => navigateTo('rfqList')} className="text-yellow-900 font-semibold underline">RFQ List</button></p>
                        )}
                    </div>
                )}

                {/* Action tiles */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
                    <div className="bg-white p-6 rounded-xl shadow-md hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigateTo('purchaseRequisitions')}>
                        <Icon id="clipboard-list" className="text-3xl text-amber-500 mb-4" />
                        <h2 className="text-xl font-semibold text-gray-800">All Requests</h2>
                        <p className="text-gray-600">Browse purchase requisitions.</p>
                    </div>
                    <div className="bg-white p-6 rounded-xl shadow-md hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigateTo('purchaseRequisitions', { status: 'OPEN' })}>
                        <Icon id="inbox" className="text-3xl text-blue-500 mb-4" />
                        <h2 className="text-xl font-semibold text-gray-800">Open Inbox</h2>
                        <p className="text-gray-600">{stats.open} requests need sourcing.</p>
                    </div>
                    <div className="bg-white p-6 rounded-xl shadow-md hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigateTo('vendors')}>
                        <Icon id="truck" className="text-3xl text-teal-500 mb-4" />
                        <h2 className="text-xl font-semibold text-gray-800">Vendor Directory</h2>
                        <p className="text-gray-600">Manage approved suppliers.</p>
                    </div>
                    <div className="bg-white p-6 rounded-xl shadow-md hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigateTo('rfqList')}>
                        <Icon id="paper-plane" className="text-3xl text-purple-500 mb-4" />
                        <h2 className="text-xl font-semibold text-gray-800">RFQs</h2>
                        <p className="text-gray-600">Send & track vendor quotes.</p>
                    </div>
                    {/* H4 — procurement users sign their own approval notes (e.g. on
                        RFQ approval). Give them a direct tile, same as sales/controller. */}
                    <div className="bg-white p-6 rounded-xl shadow-md hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigateTo('mySignatures')}>
                        <Icon id="pen-fancy" className="text-3xl text-pink-500 mb-4" />
                        <h2 className="text-xl font-semibold text-gray-800">My Signatures</h2>
                        <p className="text-gray-600">Add or manage your approval signatures.</p>
                    </div>
                </div>

                {/* Recent open / in-progress requests */}
                <div className="bg-white p-6 rounded-xl shadow-md">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="font-semibold text-lg">Active Requisitions</h3>
                        <button onClick={() => navigateTo('purchaseRequisitions')} className="text-sm text-blue-600 hover:underline">
                            View all →
                        </button>
                    </div>
                    {prsLoading ? (
                        <div className="text-center py-8 text-gray-500">Loading…</div>
                    ) : recentPRs.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                            No active requisitions. New requests will appear here in real time.
                        </div>
                    ) : (
                        <table className="w-full text-left">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="p-3 font-semibold text-xs text-gray-500 uppercase">PR #</th>
                                    <th className="p-3 font-semibold text-xs text-gray-500 uppercase">Item</th>
                                    <th className="p-3 font-semibold text-xs text-gray-500 uppercase">Customer</th>
                                    <th className="p-3 font-semibold text-xs text-gray-500 uppercase text-center">Qty</th>
                                    <th className="p-3 font-semibold text-xs text-gray-500 uppercase text-center">Reason</th>
                                    <th className="p-3 font-semibold text-xs text-gray-500 uppercase text-center">Status</th>
                                    <th className="p-3 font-semibold text-xs text-gray-500 uppercase"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {recentPRs.map(pr => (
                                    <tr key={pr.id} className="border-b hover:bg-gray-50">
                                        <td className="p-3 font-mono text-xs">{pr.prNumber || pr.id.slice(0, 8)}</td>
                                        <td className="p-3 font-medium">{pr.itemName}</td>
                                        <td className="p-3 text-sm text-gray-600">{pr.customerName || '—'}</td>
                                        <td className="p-3 text-center">{pr.quantity}</td>
                                        <td className="p-3 text-center text-xs">{pr.reason}</td>
                                        <td className="p-3 text-center">
                                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                                pr.status === 'OPEN'   ? 'bg-amber-100 text-amber-800' :
                                                pr.status === 'IN_RFQ' ? 'bg-blue-100 text-blue-800'   :
                                                'bg-gray-100 text-gray-800'
                                            }`}>{pr.status}</span>
                                        </td>
                                        <td className="p-3 text-right">
                                            <button onClick={() => navigateTo('purchaseRequisitionDetail', pr.id)} className="text-blue-600 text-sm font-medium">
                                                Open
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
        </>
    );
};

export default ProcurementDashboard;
