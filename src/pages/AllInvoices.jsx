import React, { useState, useEffect, useMemo } from 'react';
import Icon from '../components/common/Icon';
import { formatCurrency } from '../utils/formatting';
import { useDebounce } from '../hooks/useDebounce';
import { useActivityLog } from '../hooks/useActivityLog';
import { usePagination } from '../hooks/usePagination';
import { useApp } from '../context/AppContext';

const AllInvoices = ({ navigateTo, pageContext }) => {
    const { appUser } = useApp();
    const isController = appUser?.role === 'controller';

    const [searchTerm, setSearchTerm] = useState("");
    const debouncedSearchTerm = useDebounce(searchTerm, 1000);

    // Logging
    const { log } = useActivityLog();
    useEffect(() => {
        if (debouncedSearchTerm && debouncedSearchTerm.trim().length > 2) {
            log('SEARCH_QUERY', `Searched invoices for: "${debouncedSearchTerm}"`, {
                category: 'user_action',
                searchDetails: {
                    term: debouncedSearchTerm,
                    context: 'invoices'
                }
            });
        }
    }, [debouncedSearchTerm, log]);

    // Filter State
    const [selectedYear, setSelectedYear] = useState('All');
    const [selectedMonth, setSelectedMonth] = useState('All');

    // Construct Query Parameters for Server-Side Filtering
    const queryParams = useMemo(() => {
        const params = {};
 
        // Date Filtering
        if (selectedYear !== 'All') {
            if (selectedMonth !== 'All') {
                const lastDay = new Date(selectedYear, parseInt(selectedMonth), 0).getDate();
                params.startDate = `${selectedYear}-${selectedMonth}-01`;
                params.endDate = `${selectedYear}-${selectedMonth}-${lastDay}`;
            } else {
                params.startDate = `${selectedYear}-01-01`;
                params.endDate = `${selectedYear}-12-31`;
            }
        }
 
        // Aging Filter (mapped to query params if backend supports or handled locally)
        if (pageContext?.aging) {
            params.aging = pageContext.aging;
        }

        return params;
    }, [selectedYear, selectedMonth, pageContext]);

    // Use Pagination Hook
    const { data: invoices, loading, hasMore, loadMore, error } = usePagination(
        '/invoices',
        queryParams
    );



    const getStatusColor = (status) => {
        switch (status) {
            case 'Paid': return 'bg-green-100 text-green-800';
            case 'Customer Accepted': return 'bg-green-100 text-green-800';
            case 'Approved': return 'bg-blue-100 text-blue-800'; // Ready to Send
            case 'Awaiting Acceptance': return 'bg-amber-100 text-amber-800';
            case 'Pending Approval': return 'bg-yellow-100 text-yellow-800';
            case 'Pending Pricing': return 'bg-purple-100 text-purple-800';
            case 'Rejected': return 'bg-red-100 text-red-800';
            case 'Customer Rejected': return 'bg-red-100 text-red-800';
            default: return 'bg-gray-100 text-gray-800';
        }
    };

    // Client-side filtering for Search Term and Aging (on loaded data)
    // Note: Ideally search should be server-side too, but Firestore lacks full-text search.
    const filteredInvoices = useMemo(() => {
        let filtered = invoices;

        // Apply aging filter if specified
        if (pageContext?.aging) {
            const today = new Date();
            const getDays = (range) => {
                switch (range) {
                    case '0-30 Days': return { min: 0, max: 30 };
                    case '31-60 Days': return { min: 31, max: 60 };
                    case '61-90 Days': return { min: 61, max: 90 };
                    case '90+ Days': return { min: 91, max: Infinity };
                    default: return null;
                }
            }
            const range = getDays(pageContext.aging);
            if (range) {
                filtered = filtered.filter(inv => {
                    if (inv.status === 'Paid') return false;
                    const invoiceDate = new Date(inv.date);
                    const diffDays = Math.ceil((today - invoiceDate) / (1000 * 60 * 60 * 24));
                    return diffDays >= range.min && diffDays <= range.max;
                });
            }
        }

        // Apply search filter
        if (debouncedSearchTerm) {
            filtered = filtered.filter(inv =>
                inv.id.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
                (inv.customerName && inv.customerName.toLowerCase().includes(debouncedSearchTerm.toLowerCase()))
            );
        }

        return filtered;
    }, [invoices, debouncedSearchTerm, pageContext]);

    // Static Filter Options (since we don't have all data loaded)
    const years = ['2023', '2024', '2025', '2026'];
    const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];

    return (
        <div className="min-h-screen bg-gray-100">
            <div className="max-w-7xl mx-auto p-4 md:p-8">
                <header className="bg-white p-4 rounded-xl shadow-md mb-8 flex justify-between items-center">
                    <div className="flex items-center space-x-3">
                        <h1 className="text-2xl font-bold text-gray-800">All Invoices {pageContext?.aging && `(${pageContext.aging})`}</h1>
                        <div className="flex items-center text-sm text-gray-600 bg-gray-100 px-3 py-1 rounded-full">
                            <Icon id="clock" className="w-4 h-4 mr-1" />
                            Sorted: Newest to Oldest
                        </div>
                    </div>
                    <button onClick={() => navigateTo('controllerDashboard')} className="text-sm"><Icon id="arrow-left" className="mr-1" /> Back to Dashboard</button>
                </header>
                <div className="bg-white p-6 rounded-xl shadow-md">
                    {/* Filters */}
                    <div className="flex gap-4 mb-4 p-4 bg-gray-50 rounded-lg">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
                            <select
                                value={selectedYear}
                                onChange={(e) => setSelectedYear(e.target.value)}
                                className="block w-32 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                            >
                                <option value="All">All Years</option>
                                {years.map(year => (
                                    <option key={year} value={year}>{year}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Month</label>
                            <select
                                value={selectedMonth}
                                onChange={(e) => setSelectedMonth(e.target.value)}
                                className="block w-32 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                            >
                                <option value="All">All Months</option>
                                {months.map(month => (
                                    <option key={month} value={month}>{month}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="mb-4">
                        <input
                            type="text"
                            placeholder="Search by Invoice ID or Customer Name..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="w-full p-2 border rounded-md"
                        />
                    </div>

                    {error && (
                        <div className="bg-red-50 text-red-600 p-3 rounded-md mb-4">
                            Error loading invoices: {error}
                            {error.includes('index') && <p className="text-sm mt-1">An index is required for this query. Check the browser console for the creation link.</p>}
                        </div>
                    )}

                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="p-3 font-semibold">Invoice ID</th>
                                    <th className="p-3 font-semibold">Customer</th>
                                    <th className="p-3 font-semibold">
                                        <div className="flex items-center justify-center">
                                            Date & Time
                                            <Icon id="arrow-down" className="w-4 h-4 ml-1 text-blue-600" />
                                        </div>
                                    </th>
                                    <th className="p-3 font-semibold text-right">Amount</th>
                                    <th className="p-3 font-semibold text-center">Status</th>
                                    <th className="p-3 font-semibold text-center">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading && invoices.length === 0 ? (
                                    <tr>
                                        <td colSpan="6" className="p-8 text-center text-gray-600">
                                            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                                            <p className="mt-2">Loading invoices...</p>
                                        </td>
                                    </tr>
                                ) : filteredInvoices.length === 0 ? (
                                    <tr>
                                        <td colSpan="6" className="p-8 text-center text-gray-600">
                                            No invoices found
                                        </td>
                                    </tr>
                                ) : (
                                    filteredInvoices.map(inv => (
                                        <tr key={inv.id} className="border-b hover:bg-gray-50">
                                            <td className="p-3 font-medium">{inv.approvedInvoiceId || inv.id}</td>
                                            <td className="p-3">{inv.customerName}</td>
                                            <td className="p-3">{inv.date}</td>
                                            <td className="p-3 text-right">{formatCurrency(inv.currency, inv.total)}</td>
                                            <td className="p-3 text-center">
                                                <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(inv.status)}`}>
                                                    {inv.status}
                                                </span>
                                                {inv.sourcingStatus && inv.sourcingStatus !== 'NONE' && (
                                                    <span className={`block mt-1 px-2 py-0.5 text-[10px] font-medium rounded-full ${
                                                        inv.sourcingStatus === 'PENDING'  ? 'bg-amber-100 text-amber-700' :
                                                        inv.sourcingStatus === 'PARTIAL'  ? 'bg-blue-100 text-blue-700'   :
                                                        inv.sourcingStatus === 'COMPLETE' ? 'bg-green-100 text-green-700' :
                                                        'bg-gray-100 text-gray-600'
                                                    }`}>
                                                        {inv.sourcingStatus === 'PENDING'  ? 'Sourcing Pending' :
                                                         inv.sourcingStatus === 'PARTIAL'  ? 'Sourcing Partial' :
                                                         inv.sourcingStatus === 'COMPLETE' ? 'Sourcing Done'    :
                                                         inv.sourcingStatus}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="p-3 text-center space-x-2">
                                                {inv.status === 'Pending Pricing' && isController ? (
                                                    <button
                                                        onClick={() => navigateTo('invoiceEditor', { invoiceId: inv.id })}
                                                        className="text-xs bg-purple-600 text-white px-3 py-1 rounded hover:bg-purple-700"
                                                    >
                                                        <Icon id="edit" className="mr-1 inline" /> Price Item
                                                    </button>
                                                ) : inv.status === 'Pending Approval' ? (
                                                    <button onClick={() => navigateTo('invoiceEditor', { invoiceId: inv.id })} className="text-xs bg-blue-500 text-white px-3 py-1 rounded">Edit / Approve</button>
                                                ) : (
                                                    <button onClick={() => navigateTo('customerPortal', inv.customerId)} className="text-blue-600 font-medium text-xs">View Portal</button>
                                                )}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Load More Button */}
                    {hasMore && !loading && (
                        <div className="mt-6 text-center">
                            <button
                                onClick={() => loadMore()}
                                className="px-6 py-2 bg-gray-100 text-gray-700 rounded-full hover:bg-gray-200 font-medium transition-colors"
                            >
                                Load More Invoices
                            </button>
                        </div>
                    )}

                    {loading && invoices.length > 0 && (
                        <div className="mt-4 text-center text-gray-500">
                            Loading more...
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AllInvoices;
