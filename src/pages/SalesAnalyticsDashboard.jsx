import React, { useState, useEffect, useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis } from 'recharts';
import Icon from '../components/common/Icon';
import ReportModal from '../components/ReportModal';
import { formatCurrency } from '../utils/formatting';
import { useRealtimeInvoices } from '../hooks/useRealtimeInvoices';

const SalesAnalyticsDashboard = ({ navigateTo, userId, userEmail }) => {
    const [openReport, setOpenReport] = useState(false);
    const username = userEmail ? userEmail.split('@')[0] : 'User';
    const { data: invoices, loading: isLoading, error: fetchError } = useRealtimeInvoices(userId);

    const handleRefresh = () => { console.log('Real-time updates active - refresh not needed'); };

    const { internalFunnel, pipelineMetrics, topCustomersData } = useMemo(() => {
        const filteredInvoices = invoices.filter(inv => inv.status !== 'Rejected' && inv.status !== 'Customer Rejected');
        const funnel = {
            'Pending Pricing': 0,
            'Pending Approval': 0,
            'Approved': 0,
            'Awaiting Acceptance': 0,
            'Customer Accepted': 0
        };
        const customerTotals = {};

        filteredInvoices.forEach(inv => {
            if (inv.status === 'Pending Pricing') funnel['Pending Pricing']++;
            if (inv.status === 'Pending Approval') funnel['Pending Approval']++;
            if (inv.status === 'Approved') funnel['Approved']++;
            if (inv.status === 'Awaiting Acceptance') funnel['Awaiting Acceptance']++;
            if (inv.status === 'Customer Accepted' || inv.status === 'Paid') funnel['Customer Accepted']++;

            if (inv.status === 'Customer Accepted' || inv.status === 'Paid') {
                customerTotals[inv.customerName] = (customerTotals[inv.customerName] || 0) + (inv.total || inv.totals?.grandTotal || inv.totals?.subtotal || 0);
            }
        });

        // 1. Chart Data: Internal Process Only
        const internalFunnel = [
            { value: funnel['Pending Pricing'], name: 'Pending Procurement', fill: '#8b5cf6' },
            { value: funnel['Pending Approval'], name: 'Pending Approval', fill: '#f59e0b' },
            { value: funnel['Approved'], name: 'Approved (Ready)', fill: '#3b82f6' }
        ];

        // 2. Legend Data: Pipeline Status
        const pipelineMetrics = [
            { label: 'Pending Procurement', value: funnel['Pending Pricing'], color: 'bg-purple-500' },
            { label: 'Awaiting Acceptance', value: funnel['Awaiting Acceptance'], color: 'bg-violet-500' },
            { label: 'Realized Revenue', value: funnel['Customer Accepted'], color: 'bg-green-500' },
            { label: 'Ready to Send', value: funnel['Approved'], color: 'bg-blue-500' }
        ];

        const topCustomersData = Object.entries(customerTotals)
            .map(([name, total]) => ({ name, total }))
            .sort((a, b) => b.total - a.total)
            .slice(0, 5);

        return { internalFunnel, pipelineMetrics, topCustomersData };
    }, [invoices]);

    const handleFunnelClick = (data) => {
        if (data && data.name) {
            const statusMap = { 'Pending Procurement': 'Pending Pricing', 'Pending Approval': 'Pending Approval', 'Approved (Ready)': 'Approved' };
            navigateTo('myInvoices', { status: statusMap[data.name] });
        }
    };

    return (
        <div className="min-h-screen bg-gray-100">
            <div className="max-w-7xl mx-auto p-4 md:p-8">
                <header className="bg-white p-4 rounded-xl shadow-md mb-8 flex justify-between items-center">
                    <h1 className="text-2xl font-bold text-gray-800">Sales Dashboard</h1>
                    <div className="flex items-center space-x-4">
                        <button onClick={() => setOpenReport(true)} className="py-2 px-4 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"><Icon id="chart-bar" className="mr-2" />Generate Sales Report</button>
                        <button onClick={handleRefresh} className="text-sm text-gray-600 hover:text-blue-600 disabled:opacity-50" disabled={isLoading}><Icon id={isLoading ? "sync-alt fa-spin" : "sync-alt"} className="mr-1" />{isLoading ? 'Refreshing...' : 'Refresh'}</button>
                        <div className="flex items-center space-x-2 px-3 py-1 bg-gray-100 rounded-full border border-gray-200 min-w-0 max-w-[260px]"><div className="bg-gray-300 rounded-full p-1 flex-shrink-0"><Icon id="user" className="text-gray-600 w-4 h-4" /></div><span className="text-sm font-medium text-gray-700 truncate" title={userEmail || username}>{username}</span></div>
                        <button onClick={() => navigateTo('login')} className="text-sm text-gray-600 hover:text-blue-600"><Icon id="sign-out-alt" className="mr-1" /> Logout</button>
                    </div>
                </header>

                {/*
                  Four-tile action grid.
                  • Create Quote / View My Invoices / Pending Approval — individual-salesperson tools.
                  • Approve Quotes — sales-boss / reviewer entry into the dual-path approval page
                    (component-level gating hides pricing edits for sales; controller retains full edits).
                */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    <div className="bg-white p-6 rounded-xl shadow-md hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigateTo('quoting')}><Icon id="file-invoice-dollar" className="text-3xl text-green-500 mb-4" /><h2 className="text-xl font-semibold text-gray-800">Create Quote</h2><p className="text-gray-600">Build professional quotes with pricing management.</p></div>
                    <div className="bg-white p-6 rounded-xl shadow-md hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigateTo('myInvoices')}><Icon id="list-alt" className="text-3xl text-blue-500 mb-4" /><h2 className="text-xl font-semibold text-gray-800">View My Invoices</h2><p className="text-gray-600">Track invoice status.</p></div>
                    <div className="bg-white p-6 rounded-xl shadow-md hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigateTo('myInvoices', { status: 'Pending Approval' })}><Icon id="check-circle" className="text-3xl text-orange-500 mb-4" /><h2 className="text-xl font-semibold text-gray-800">Pending Approval</h2><p className="text-gray-600">Track my quotes awaiting sign-off.</p></div>
                    <div className="bg-white p-6 rounded-xl shadow-md hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigateTo('salesInvoiceApproval')}><Icon id="user-check" className="text-3xl text-indigo-500 mb-4" /><h2 className="text-xl font-semibold text-gray-800">Approve Quotes</h2><p className="text-gray-600">Sign off team quotes before they go to the customer.</p></div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-white p-6 rounded-xl shadow-md">
                        <h3 className="font-semibold text-lg mb-4">Internal Approval Status</h3>
                        {isLoading ? <div className="flex items-center justify-center h-[300px] text-gray-500">Loading chart data...</div> : (
                            <div className="flex flex-col items-center">
                                <ResponsiveContainer width="100%" height={250}>
                                    <PieChart>
                                        <Pie data={internalFunnel} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value" label={({ value }) => value > 0 ? value : ''}>
                                            {internalFunnel.map((entry, index) => (<Cell key={`cell-${index}`} fill={entry.fill} />))}
                                        </Pie>
                                        <Tooltip />
                                    </PieChart>
                                </ResponsiveContainer>
                                <div className="w-full mt-4 grid grid-cols-2 gap-4 border-t pt-4">
                                    {pipelineMetrics.map((metric, idx) => (
                                        <div key={idx} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                                            <div className="flex items-center"><div className={`w-3 h-3 rounded-full mr-2 ${metric.color}`}></div><span className="text-sm text-gray-600">{metric.label}</span></div>
                                            <span className="font-bold text-gray-800">{metric.value}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="bg-white p-6 rounded-xl shadow-md">
                        <h3 className="font-semibold text-lg mb-4">My Top Customers (Revenue)</h3>
                        {isLoading ? <div className="flex items-center justify-center h-[300px] text-gray-500">Loading chart data...</div> : (
                            topCustomersData.length > 0 ? (
                                <ResponsiveContainer width="100%" height={300}>
                                    <BarChart data={topCustomersData} layout="vertical">
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis type="number" hide />
                                        <YAxis type="category" dataKey="name" width={100} stroke="#333" />
                                        <Tooltip formatter={(value) => formatCurrency('GHS', value)} />
                                        <Bar dataKey="total" fill="#82ca9d" name="Sales Volume" />
                                    </BarChart>
                                </ResponsiveContainer>
                            ) : (<div className="flex items-center justify-center h-[300px] text-gray-500">No customer data to display.</div>)
                        )}
                    </div>
                </div>
            </div>
            {openReport && (<ReportModal role="sales" onClose={() => setOpenReport(false)} />)}
        </div>
    );
};
export default SalesAnalyticsDashboard;
