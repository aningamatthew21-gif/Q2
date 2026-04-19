import React, { useState, useEffect, useMemo } from 'react';
import api from '../api';
import Icon from '../components/common/Icon';
import { formatCurrency } from '../utils/formatting';
import PreviewModal from '../components/PreviewModal';
import CustomerModal from '../components/modals/CustomerModal';
import { useRealtimeInvoices } from '../hooks/useRealtimeInvoices';

const StatCard = ({ title, value, subtext, icon, color }) => (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-start justify-between">
        <div>
            <p className="text-sm font-medium text-gray-500 mb-1">{title}</p>
            <h3 className="text-2xl font-bold text-gray-900">{value}</h3>
            {subtext && <p className="text-xs text-gray-400 mt-1">{subtext}</p>}
        </div>
        <div className={`p-3 rounded-lg ${color}`}>
            <Icon id={icon} className="w-6 h-6 text-white" />
        </div>
    </div>
);

const StatusBadge = ({ status }) => {
    const styles = {
        'Approved': 'bg-blue-100 text-blue-800 border-blue-200', // Ready to Send (Internal)
        'Awaiting Acceptance': 'bg-yellow-100 text-yellow-800 border-yellow-200', // Action Required
        'Customer Accepted': 'bg-green-100 text-green-800 border-green-200', // Revenue Recognized
        'Paid': 'bg-green-100 text-green-800 border-green-200',
        'Pending Approval': 'bg-gray-100 text-gray-800 border-gray-200',
        'Rejected': 'bg-red-100 text-red-800 border-red-200',
        'Customer Rejected': 'bg-red-100 text-red-800 border-red-200',
        'Draft': 'bg-gray-100 text-gray-800 border-gray-200'
    };
    const defaultStyle = 'bg-gray-100 text-gray-800 border-gray-200';

    return (
        <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[status] || defaultStyle}`}>
            {status}
        </span>
    );
};

const CustomerPortal = ({ navigateTo, customerId, userId }) => {
    const [customer, setCustomer] = useState(null);
    const [activeTab, setActiveTab] = useState('All');
    const [searchTerm, setSearchTerm] = useState('');
    const [previewPayload, setPreviewPayload] = useState(null);
    const [isEditingCustomer, setIsEditingCustomer] = useState(false);
    const { data: invoices, loading: invoicesLoading } = useRealtimeInvoices(null, customerId);

    useEffect(() => {
        if (!customerId) return;
        
        const fetchCustomer = async () => {
            try {
                const response = await api.get(`/customers/${customerId}`);
                if (response.success) {
                    setCustomer(response.data);
                }
            } catch (error) {
                console.error("Error fetching customer:", error);
            }
        };

        fetchCustomer();
    }, [customerId]);

    // Calculate Stats
    const stats = useMemo(() => {
        const total = invoices.length;
        const totalValue = invoices.reduce((sum, inv) => sum + (inv.total || 0), 0);
        // "Approved" for customer means anything sent to them or accepted
        const approvedCount = invoices.filter(inv =>
            inv.status === 'Awaiting Acceptance' ||
            inv.status === 'Customer Accepted' ||
            inv.status === 'Paid'
        ).length;
        const pendingCount = invoices.filter(inv => inv.status === 'Pending Approval').length;

        return { total, totalValue, approvedCount, pendingCount };
    }, [invoices]);

    // Filter Invoices
    const filteredInvoices = useMemo(() => {
        return invoices.filter(inv => {
            const matchesTab = activeTab === 'All' ||
                (activeTab === 'Approved' && (inv.status === 'Awaiting Acceptance' || inv.status === 'Customer Accepted' || inv.status === 'Paid')) ||
                (activeTab === 'Pending' && inv.status === 'Pending Approval') ||
                (activeTab === 'Rejected' && (inv.status === 'Rejected' || inv.status === 'Customer Rejected'));

            const matchesSearch = inv.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (inv.date && inv.date.includes(searchTerm));

            return matchesTab && matchesSearch;
        }).sort((a, b) => new Date(b.date) - new Date(a.date)); // Sort by date desc
    }, [invoices, activeTab, searchTerm]);

    const handleSaveCustomer = async (updatedData) => {
        try {
            await api.put(`/customers/${customerId}`, updatedData);
            setCustomer({ ...customer, ...updatedData });
            setIsEditingCustomer(false);
        } catch (error) {
            console.error("Error updating customer:", error);
            alert("Failed to update customer details.");
        }
    };

    const handleViewInvoice = (inv) => {
        // Construct payload for PreviewModal/PDFService
        const payload = {
            ...inv,
            invoiceId: inv.id,
            customer: customer, // Pass full customer object
            items: inv.items || inv.lineItems || [],
            subtotal: inv.total, // Fallback if subtotal missing
            // Ensure taxes and totals are passed if available
            taxes: inv.taxBreakdown || inv.taxes || inv.taxConfiguration || [],
            totals: inv.totals || { grandTotal: inv.total }
        };
        setPreviewPayload(payload);
    };

    if (!customer) return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
    );

    return (
        <div className="min-h-screen bg-gray-50 font-sans text-gray-900">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

                {/* Header Section */}
                <div className="mb-8">
                    <button
                        onClick={() => navigateTo('customers')}
                        className="flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4 transition-colors"
                    >
                        <Icon id="arrow-left" className="w-4 h-4 mr-1" /> Back to Customer List
                    </button>

                    <div className="flex flex-col md:flex-row md:items-center justify-between bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                        <div>
                            <h1 className="text-3xl font-bold text-gray-900">{customer.name}</h1>
                            <div className="mt-2 flex flex-wrap gap-4 text-sm text-gray-500">
                                <div className="flex items-center">
                                    <Icon id="user" className="w-4 h-4 mr-2 opacity-70" />
                                    {customer.contactPerson || 'No Contact Person'}
                                </div>
                                <div className="flex items-center">
                                    <Icon id="envelope" className="w-4 h-4 mr-2 opacity-70" />
                                    {customer.contactEmail || 'No Email'}
                                </div>
                                <div className="flex items-center">
                                    <Icon id="location-marker" className="w-4 h-4 mr-2 opacity-70" />
                                    {customer.location || 'No Location'}
                                </div>
                            </div>
                        </div>
                        <div className="mt-4 md:mt-0">
                            <button
                                onClick={() => setIsEditingCustomer(true)}
                                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
                            >
                                Edit Customer
                            </button>
                        </div>
                    </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    <StatCard
                        title="Total Invoices"
                        value={stats.total}
                        icon="document-text"
                        color="bg-blue-500"
                    />
                    <StatCard
                        title="Total Value"
                        value={formatCurrency('GHS', stats.totalValue)}
                        icon="cash"
                        color="bg-green-500"
                    />
                    <StatCard
                        title="Open Invoices"
                        value={stats.approvedCount}
                        subtext="Awaiting payment/action"
                        icon="check-circle"
                        color="bg-indigo-500"
                    />
                    <StatCard
                        title="Pending"
                        value={stats.pendingCount}
                        subtext="Awaiting approval"
                        icon="clock"
                        color="bg-yellow-500"
                    />
                </div>

                {/* Main Content Area */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">

                    {/* Toolbar */}
                    <div className="p-5 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">

                        {/* Tabs */}
                        <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg">
                            {['All', 'Approved', 'Pending', 'Rejected'].map((tab) => (
                                <button
                                    key={tab}
                                    onClick={() => setActiveTab(tab)}
                                    className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === tab
                                        ? 'bg-white text-gray-900 shadow-sm'
                                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'
                                        }`}
                                >
                                    {tab}
                                </button>
                            ))}
                        </div>

                        {/* Search */}
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <Icon id="search" className="h-4 w-4 text-gray-400" />
                            </div>
                            <input
                                type="text"
                                placeholder="Search invoices..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-full sm:w-64"
                            />
                        </div>
                    </div>

                    {/* Table */}
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Invoice ID</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {filteredInvoices.length > 0 ? (
                                    filteredInvoices.map((inv) => (
                                        <tr key={inv.id} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                                {inv.id}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                {inv.date}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                                {formatCurrency(inv.currency || 'GHS', inv.total)}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <StatusBadge status={inv.status} />
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                                <button
                                                    onClick={() => handleViewInvoice(inv)}
                                                    className="text-blue-600 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-md transition-colors inline-flex items-center"
                                                >
                                                    <Icon id="eye" className="w-4 h-4 mr-1.5" />
                                                    View
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan="5" className="px-6 py-12 text-center text-gray-500">
                                            <div className="flex flex-col items-center justify-center">
                                                <Icon id="document-search" className="w-12 h-12 text-gray-300 mb-3" />
                                                <p className="text-lg font-medium text-gray-900">No invoices found</p>
                                                <p className="text-sm text-gray-500">Try adjusting your search or filter.</p>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Invoice Preview Modal (Shared) */}
            {previewPayload && (
                <PreviewModal
                    open={!!previewPayload}
                    onClose={() => setPreviewPayload(null)}
                    payload={previewPayload}
                    mode="invoice"
                    isDistribution={true} // Shows "Download" and "Close" buttons
                />
            )}

            {/* Customer Edit Modal */}
            {isEditingCustomer && (
                <CustomerModal
                    customer={customer}
                    onSave={handleSaveCustomer}
                    onClose={() => setIsEditingCustomer(false)}
                />
            )}
        </div>
    );
};

export default CustomerPortal;
