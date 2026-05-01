import React, { useState, useEffect, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import Icon from '../components/common/Icon';
import PageHeader from '../components/common/PageHeader';
import Button from '../components/common/Button';
import ReportModal from '../components/ReportModal';
import { formatCurrency } from '../utils/formatting';
import { getInvoiceDate } from '../utils/helpers';
import { useRealtimeInvoices } from '../hooks/useRealtimeInvoices';
import { useRealtimeInventory } from '../hooks/useRealtimeInventory';
import { useRealtimePRs } from '../hooks/useRealtimePRs';
import { useRealtimeRFQs } from '../hooks/useRealtimeRFQs';

const ControllerAnalyticsDashboard = ({ navigateTo, userId, userEmail, currentUser }) => {
    const [openReport, setOpenReport] = useState(false);

    // Extract username from email (everything before @)
    const username = userEmail ? userEmail.split('@')[0] : 'User';

    // Real-time data fetching for immediate updates
    const { data: invoices, loading: invoicesLoading } = useRealtimeInvoices();
    const { data: inventory, loading: inventoryLoading } = useRealtimeInventory();
    const { data: prs } = useRealtimePRs();
    const { data: rfqs } = useRealtimeRFQs();

    const procStats = useMemo(() => ({
        openPRs: prs.filter(p => p.status === 'OPEN').length,
        activeRFQs: rfqs.filter(r => ['DRAFT','SENT','RECEIVING','COMPARING'].includes(r.status)).length,
        pendingApproval: rfqs.filter(r => r.status === 'PENDING_APPROVAL').length,
        awarded: rfqs.filter(r => r.status === 'AWARDED').length,
        // Phase 4 — invoices flagged for re-approval after sourcing variance
        needsReapproval: invoices.filter(inv => inv.requiresReapproval).length,
        // Phase 5 — risk / escalation counts
        atRisk: rfqs.filter(r => r.isPastDeadline && !r.isEscalated).length,
        escalated: rfqs.filter(r => r.isEscalated).length,
    }), [prs, rfqs, invoices]);

    // Phase 5 — RFQs at risk (past deadline or escalated) for the queue section
    const riskQueue = useMemo(
        () => rfqs.filter(r => r.isEscalated || r.isPastDeadline),
        [rfqs]
    );

    // Phase 4 — invoices needing re-approval, for the dashboard queue section
    const reapprovalQueue = useMemo(
        () => invoices.filter(inv => inv.requiresReapproval),
        [invoices]
    );

    const { invoiceData, inventoryHealthData } = useMemo(() => {
        // Invoice Statistics (REVENUE ONLY: Customer Accepted or Paid)
        const monthlyData = {};
        invoices.filter(inv => inv.status === 'Customer Accepted' || inv.status === 'Paid').forEach(inv => {
            const date = getInvoiceDate(inv);
            // Format as YYYY-MM for consistent sorting and grouping
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const key = `${year}-${month}`;

            if (!monthlyData[key]) monthlyData[key] = { name: key, count: 0, total: 0 };
            monthlyData[key].count += 1;
            monthlyData[key].total += inv.total || inv.totals?.grandTotal || inv.totals?.subtotal || 0;
        });
        const invoiceData = Object.values(monthlyData).sort((a, b) => a.name.localeCompare(b.name));

        // Inventory Health
        const itemsBelowReorder = inventory.filter(item => item.stock <= item.restockLimit).length;
        const inventoryHealthData = inventory.length > 0 ? Math.round(((inventory.length - itemsBelowReorder) / inventory.length) * 100) : 100;

        return { invoiceData, inventoryHealthData };
    }, [invoices, inventory]);



    return (
        <>
            <PageHeader
                title="Controller Dashboard"
                actions={
                    <>
                        <Button variant="secondary" size="sm" onClick={() => navigateTo('taxSettings')} leftIcon={<Icon id="cog" />}>
                            System Settings
                        </Button>
                        <Button variant="primary" size="sm" onClick={() => setOpenReport(true)} leftIcon={<Icon id="chart-bar" />}>
                            Generate Full Report
                        </Button>
                    </>
                }
            />

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
                    {/* H3 — was previously gated on `currentUser.level === 'main'`,
                        but `level` is never populated anywhere in AppContext, so the
                        tile was permanently invisible. The /salesInvoiceApproval route
                        already enforces ['sales','controller','admin'] via PAGE_ROLES,
                        so a simple role check is the right gate here. */}
                    {currentUser && (currentUser.role === 'controller' || currentUser.role === 'admin') && <div className="bg-white p-6 rounded-xl shadow-md hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigateTo('salesInvoiceApproval')}><Icon id="file-invoice" className="text-3xl text-green-500 mb-4" /><h2 className="text-xl font-semibold text-gray-800">Approve Invoices</h2><p className="text-gray-600">Review and approve pending invoices.</p></div>}
                    <div className="bg-white p-6 rounded-xl shadow-md hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigateTo('inventory')}><Icon id="boxes" className="text-3xl text-blue-500 mb-4" /><h2 className="text-xl font-semibold text-gray-800">Manage Inventory</h2><p className="text-gray-600">View and edit stock items.</p></div>
                    <div className="bg-white p-6 rounded-xl shadow-md hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigateTo('customers')}><Icon id="users" className="text-3xl text-purple-500 mb-4" /><h2 className="text-xl font-semibold text-gray-800">Manage Customers</h2><p className="text-gray-600">View customer data and portals.</p></div>
                    <div className="bg-white p-6 rounded-xl shadow-md hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigateTo('vendors')}><Icon id="truck" className="text-3xl text-teal-500 mb-4" /><h2 className="text-xl font-semibold text-gray-800">Manage Vendors</h2><p className="text-gray-600">Manage procurement suppliers.</p></div>
                    <div className="bg-white p-6 rounded-xl shadow-md hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigateTo('procurementDashboard')}><Icon id="clipboard-list" className="text-3xl text-amber-500 mb-4" /><h2 className="text-xl font-semibold text-gray-800">Procurement</h2><p className="text-gray-600">View purchase requisitions & RFQs.</p></div>
                    <div className="bg-white p-6 rounded-xl shadow-md hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigateTo('procurementSettings')}><Icon id="cog" className="text-3xl text-gray-500 mb-4" /><h2 className="text-xl font-semibold text-gray-800">Procurement Settings</h2><p className="text-gray-600">Configure thresholds & approvals.</p></div>
                    <div className="bg-white p-6 rounded-xl shadow-md hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigateTo('pricingManagement')}><Icon id="calculator" className="text-3xl text-orange-500 mb-4" /><h2 className="text-xl font-semibold text-gray-800">Pricing Management</h2><p className="text-gray-600">Manage cost components and pricing.</p></div>
                    <div className="bg-white p-6 rounded-xl shadow-md hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigateTo('auditTrail')}><Icon id="history" className="text-3xl text-gray-500 mb-4" /><h2 className="text-xl font-semibold text-gray-800">Activity Log</h2><p className="text-gray-600">View system audit trail.</p></div>
                    {/* H4 — let controllers manage their own approval signatures
                        without going through the full TaxSettings admin screen. */}
                    <div className="bg-white p-6 rounded-xl shadow-md hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigateTo('mySignatures')}><Icon id="pen-fancy" className="text-3xl text-pink-500 mb-4" /><h2 className="text-xl font-semibold text-gray-800">My Signatures</h2><p className="text-gray-600">Add or manage your approval signatures.</p></div>
                </div>

                {/* Procurement Quick Stats */}
                <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-8">
                    <div className="bg-white p-4 rounded-xl shadow-md cursor-pointer hover:shadow-lg" onClick={() => navigateTo('purchaseRequisitions', { status: 'OPEN' })}>
                        <p className="text-sm text-gray-500">Open PRs</p>
                        <p className="text-2xl font-bold text-amber-600">{procStats.openPRs}</p>
                    </div>
                    <div className="bg-white p-4 rounded-xl shadow-md cursor-pointer hover:shadow-lg" onClick={() => navigateTo('rfqList')}>
                        <p className="text-sm text-gray-500">Active RFQs</p>
                        <p className="text-2xl font-bold text-blue-600">{procStats.activeRFQs}</p>
                    </div>
                    <div className="bg-white p-4 rounded-xl shadow-md cursor-pointer hover:shadow-lg" onClick={() => navigateTo('rfqList')}>
                        <p className="text-sm text-gray-500">Pending Approval</p>
                        <p className={`text-2xl font-bold ${procStats.pendingApproval > 0 ? 'text-yellow-600' : 'text-gray-400'}`}>{procStats.pendingApproval}</p>
                    </div>
                    <div className="bg-white p-4 rounded-xl shadow-md">
                        <p className="text-sm text-gray-500">Awarded RFQs</p>
                        <p className="text-2xl font-bold text-green-600">{procStats.awarded}</p>
                    </div>
                    <div className="bg-white p-4 rounded-xl shadow-md cursor-pointer hover:shadow-lg" onClick={() => navigateTo('invoices')} title="Invoices flagged for re-approval after sourcing variance">
                        <p className="text-sm text-gray-500">Needs Re-Approval</p>
                        <p className={`text-2xl font-bold ${procStats.needsReapproval > 0 ? 'text-amber-600' : 'text-gray-400'}`}>{procStats.needsReapproval}</p>
                    </div>
                    <div className="bg-white p-4 rounded-xl shadow-md cursor-pointer hover:shadow-lg" onClick={() => navigateTo('rfqList', { filter: 'ESCALATED' })} title="RFQs escalated to procurement head or past deadline">
                        <p className="text-sm text-gray-500">RFQs At Risk</p>
                        <p className={`text-2xl font-bold ${procStats.escalated > 0 ? 'text-red-600' : procStats.atRisk > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                            {procStats.escalated + procStats.atRisk}
                        </p>
                        {procStats.escalated > 0 && (
                            <p className="text-[10px] text-red-600 font-semibold mt-1">{procStats.escalated} escalated</p>
                        )}
                    </div>
                </div>

                {/* Pending RFQ Approvals Section — READ-ONLY oversight for finance.
                 *  RFQ approvals are a procurement-head decision (see RFQDetail.jsx).
                 *  This section is kept visible so finance can audit pending awards
                 *  and their values, but cannot approve/reject them. */}
                {procStats.pendingApproval > 0 && (
                    <div className="mb-8 bg-gray-50 border border-gray-200 rounded-xl p-6">
                        <h2 className="text-lg font-semibold text-gray-800 mb-1 flex items-center">
                            <span className="bg-gray-500 text-white rounded-full w-8 h-8 flex items-center justify-center mr-3 text-sm font-bold">
                                {procStats.pendingApproval}
                            </span>
                            RFQs Pending Procurement-Head Approval
                        </h2>
                        <p className="text-xs text-gray-500 ml-11 mb-4">
                            Read-only — these awards are decided by procurement, not finance.
                        </p>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-100 border-b border-gray-300">
                                    <tr>
                                        <th className="p-3 text-left text-gray-700">RFQ #</th>
                                        <th className="p-3 text-left text-gray-700">Title</th>
                                        <th className="p-3 text-left text-gray-700">Vendor</th>
                                        <th className="p-3 text-right text-gray-700">Amount</th>
                                        <th className="p-3 text-center text-gray-700">Created</th>
                                        <th className="p-3 text-center text-gray-700">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rfqs.filter(r => r.status === 'PENDING_APPROVAL').slice(0, 5).map(rfq => (
                                        <tr key={rfq.id} className="border-b border-gray-100 hover:bg-gray-100 transition-colors">
                                            <td className="p-3 font-mono text-sm">{rfq.rfqNumber}</td>
                                            <td className="p-3">{rfq.title?.substring(0, 30)}...</td>
                                            <td className="p-3">{rfq.awardedVendorName || '—'}</td>
                                            <td className="p-3 text-right font-semibold">{rfq.currency} {(rfq.totalAwardAmount || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                                            <td className="p-3 text-center text-xs text-gray-600">{new Date(rfq.createdAt).toLocaleDateString()}</td>
                                            <td className="p-3 text-center">
                                                <button onClick={() => navigateTo('rfqDetail', rfq.id)} className="text-blue-600 hover:underline text-xs font-semibold">
                                                    View →
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {procStats.pendingApproval > 5 && (
                            <p className="text-sm text-gray-600 mt-3">... and {procStats.pendingApproval - 5} more. View all in <button onClick={() => navigateTo('rfqList')} className="text-gray-800 font-semibold underline">RFQ List</button></p>
                        )}
                    </div>
                )}

                {/* Phase 4 — Invoice Re-Approval Queue */}
                {reapprovalQueue.length > 0 && (
                    <div className="mb-8 bg-amber-50 border border-amber-200 rounded-xl p-6">
                        <h2 className="text-lg font-semibold text-amber-900 mb-4 flex items-center">
                            <span className="bg-amber-600 text-white rounded-full w-8 h-8 flex items-center justify-center mr-3 text-sm font-bold">
                                {reapprovalQueue.length}
                            </span>
                            Invoices Needing Re-Approval
                            <span className="ml-3 text-xs font-normal text-amber-700">(sourcing materially changed the total)</span>
                        </h2>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-amber-100 border-b border-amber-300">
                                    <tr>
                                        <th className="p-3 text-left text-amber-900">Invoice #</th>
                                        <th className="p-3 text-left text-amber-900">Customer</th>
                                        <th className="p-3 text-right text-amber-900">Original</th>
                                        <th className="p-3 text-right text-amber-900">Final</th>
                                        <th className="p-3 text-center text-amber-900">Variance</th>
                                        <th className="p-3 text-center text-amber-900">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {reapprovalQueue.slice(0, 5).map(inv => {
                                        const orig = Number(inv.originalEstimate || 0);
                                        const fin = Number(inv.total || 0);
                                        const variance = Number(inv.reapprovalVariance || 0);
                                        const up = fin > orig;
                                        return (
                                            <tr key={inv.id} className="border-b border-amber-100 hover:bg-amber-100 transition-colors">
                                                <td className="p-3 font-mono text-xs">{inv.approvedInvoiceId || inv.id}</td>
                                                <td className="p-3">{inv.customerName}</td>
                                                <td className="p-3 text-right">{formatCurrency(inv.currency || 'GHS', orig)}</td>
                                                <td className="p-3 text-right font-semibold">{formatCurrency(inv.currency || 'GHS', fin)}</td>
                                                <td className={`p-3 text-center font-semibold ${up ? 'text-red-700' : 'text-emerald-700'}`}>
                                                    <Icon id={up ? 'arrow-up' : 'arrow-down'} className="mr-1" />{variance.toFixed(2)}%
                                                </td>
                                                <td className="p-3 text-center">
                                                    <button onClick={() => navigateTo('invoiceEditor', { invoiceId: inv.id })} className="text-blue-600 hover:underline text-xs font-semibold">
                                                        Review →
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        {reapprovalQueue.length > 5 && (
                            <p className="text-sm text-amber-700 mt-3">... and {reapprovalQueue.length - 5} more. View all in <button onClick={() => navigateTo('invoices')} className="text-amber-900 font-semibold underline">All Invoices</button></p>
                        )}
                    </div>
                )}

                {/* Phase 5 — RFQs At Risk queue */}
                {riskQueue.length > 0 && (
                    <div className="mb-8 bg-red-50 border border-red-200 rounded-xl p-6">
                        <h2 className="text-lg font-semibold text-red-900 mb-4 flex items-center">
                            <span className="bg-red-600 text-white rounded-full w-8 h-8 flex items-center justify-center mr-3 text-sm font-bold">
                                {riskQueue.length}
                            </span>
                            RFQs At Risk
                            <span className="ml-3 text-xs font-normal text-red-700">(escalated or past submission deadline)</span>
                        </h2>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-red-100 border-b border-red-300">
                                    <tr>
                                        <th className="p-3 text-left text-red-900">RFQ #</th>
                                        <th className="p-3 text-left text-red-900">Title</th>
                                        <th className="p-3 text-left text-red-900">Status</th>
                                        <th className="p-3 text-left text-red-900">Deadline</th>
                                        <th className="p-3 text-center text-red-900">Age</th>
                                        <th className="p-3 text-center text-red-900">Risk</th>
                                        <th className="p-3 text-center text-red-900">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {riskQueue.slice(0, 5).map(r => (
                                        <tr key={r.id} className="border-b border-red-100 hover:bg-red-100 transition-colors">
                                            <td className="p-3 font-mono text-xs">{r.rfqNumber}</td>
                                            <td className="p-3">{(r.title || '').substring(0, 30)}{r.title?.length > 30 ? '…' : ''}</td>
                                            <td className="p-3 text-xs">{r.status}</td>
                                            <td className="p-3 text-xs">{r.submissionDeadline || '—'}</td>
                                            <td className="p-3 text-center text-xs">{r.daysOpen != null ? `${r.daysOpen}d` : '—'}</td>
                                            <td className="p-3 text-center">
                                                {r.isEscalated ? (
                                                    <span className="text-[10px] font-bold px-2 py-0.5 bg-red-600 text-white rounded-full">
                                                        <Icon id="exclamation-circle" className="mr-1" />ESCALATED
                                                    </span>
                                                ) : (
                                                    <span className="text-[10px] font-semibold px-2 py-0.5 bg-amber-100 text-amber-800 border border-amber-300 rounded-full">
                                                        <Icon id="clock" className="mr-1" />PAST DEADLINE
                                                    </span>
                                                )}
                                            </td>
                                            <td className="p-3 text-center">
                                                <button onClick={() => navigateTo('rfqDetail', r.id)} className="text-blue-600 hover:underline text-xs font-semibold">
                                                    Review →
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {riskQueue.length > 5 && (
                            <p className="text-sm text-red-700 mt-3">... and {riskQueue.length - 5} more. View all in <button onClick={() => navigateTo('rfqList')} className="text-red-900 font-semibold underline">RFQ List</button></p>
                        )}
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-white p-6 rounded-xl shadow-md">
                        <h3 className="font-semibold text-lg mb-4">Monthly Invoice Statistics</h3>
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={invoiceData}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="name" />
                                <YAxis />
                                <Tooltip formatter={(value) => formatCurrency('GHS', value)} />
                                <Bar dataKey="total" fill="#8884d8" name="Total Value" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="bg-white p-6 rounded-xl shadow-md flex flex-col items-center justify-center">
                        <h3 className="font-semibold text-lg mb-4">Inventory Health</h3>
                        <div className="text-5xl font-bold text-blue-500">{inventoryHealthData}%</div>
                        <p className="text-gray-600 mt-2">of items are above reorder level</p>
                    </div>
                    <div className="bg-white p-6 rounded-xl shadow-md hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigateTo('taxSettings')}>
                        <Icon id="cogs" className="text-3xl text-gray-500 mb-4" />
                        <h2 className="text-xl font-semibold text-gray-800">Tax & Levy Settings</h2>
                        <p className="text-gray-600">Configure global tax rates.</p>
                    </div>
                    <div className="bg-white p-6 rounded-xl shadow-md flex flex-col items-center justify-center">
                        <h3 className="font-semibold text-lg mb-4">Recognized Invoices</h3>
                        <div className="text-5xl font-bold text-green-500">{invoices.filter(inv => inv.status === 'Customer Accepted' || inv.status === 'Paid').length}</div>
                        <p className="text-gray-600 mt-2">revenue generating invoices</p>
                    </div>
                </div>

            {/* Report Modal */}
            {openReport && (
                <ReportModal
                    role="controller"
                    onClose={() => setOpenReport(false)}
                />
            )}


        </>
    );
};

export default ControllerAnalyticsDashboard;
