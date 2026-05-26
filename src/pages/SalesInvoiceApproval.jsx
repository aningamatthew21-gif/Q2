import React, { useState, useEffect, useMemo } from 'react';
import api from '../api';
import Icon from '../components/common/Icon';
import PageHeader from '../components/common/PageHeader';
import Button from '../components/common/Button';
import { formatCurrency } from '../utils/formatting';
import { logActivity } from '../utils/logger';
import { getInvoiceDate, generatePermanentId, getNextSequenceNumber } from '../utils/helpers';
import { useApp } from '../context/AppContext';
import { usePrompt } from '../components/v2/PromptDialog';
import { can } from '../utils/permissions';
// Module 4 — controlled rejection vocabulary
import RejectWithReasonModal from '../components/modals/RejectWithReasonModal';

const SalesInvoiceApproval = ({ navigateTo, userId }) => {
    const { askText } = usePrompt();
    const { userEmail, appUser } = useApp();
    const username = userEmail ? userEmail.split('@')[0] : userId;

    // CRITICAL: Determine Role (now permission-driven)
    // Dual-path approval page. Finance users (controller / finance_head / finance_officer /
    // admin) get the full finance experience — pricing edits, tax, quantity, view of the
    // Pending-Pricing queue. Sales users get the lean approval view (approve/reject only,
    // no pricing authority). Previously this used `appUser?.role === 'controller'` which
    // silently broke for every new tiered role (`finance_head`, `finance_officer`). The
    // permission catalogue is the single source of truth now.
    const isController = can(appUser?.role, 'invoice.edit.pricing');

    // Real-time data fetching
    const [invoices, setInvoices] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [signatures, setSignatures] = useState([]);
    const [signaturesLoading, setSignaturesLoading] = useState(true);
    const [selectedSignature, setSelectedSignature] = useState(null);
    const [notification, setNotification] = useState(null);

    // Module 4 — controlled-reason rejection modal state. We hold the
    // invoiceId being rejected here so the modal's onSubmit knows which
    // row to mutate without prop-drilling.
    const [rejectingInvoiceId, setRejectingInvoiceId] = useState(null);

    // Filters
    const [selectedYear, setSelectedYear] = useState('All');
    const [selectedMonth, setSelectedMonth] = useState('All');

    // 1. ROLE-BASED FETCH
    useEffect(() => {
        const fetchInvoices = async () => {
            const statusesToFetch = isController
                ? ["Pending Approval", "Pending Pricing"]
                : ["Pending Approval"];
                
            try {
                const response = await api.get('/invoices', {
                    params: {
                        status: statusesToFetch,
                        limit: 1000
                    }
                });
                
                if (response.success && response.data) {
                    const result = response.data;
                    const sortedResult = result.sort((a, b) => {
                        return getInvoiceDate(b) - getInvoiceDate(a);
                    });
                    setInvoices(sortedResult);
                }
                setIsLoading(false);
            } catch (err) {
                console.error('Error fetching invoices:', err);
                setError(err.message);
                setIsLoading(false);
            }
        };
        fetchInvoices();
    }, [isController]); // Re-run if role changes

    // Load signatures for approval (WITH SECURITY FILTER)
    useEffect(() => {
        const fetchSignatures = async () => {
            try {
                const response = await api.get('/settings/signatures');
                if (response.success && response.data) {
                    const allSignatures = response.data.signatures || [];
                    const mySignatures = allSignatures.filter(s => s.createdBy === userId);
                    setSignatures(mySignatures);
                }
                setSignaturesLoading(false);
            } catch (err) {
                console.error('Error fetching signatures:', err);
                setSignaturesLoading(false);
            }
        };
        fetchSignatures();
    }, [userId]);

    // Filter Logic
    const filteredInvoices = useMemo(() => {
        const me = (appUser?.email || '').toLowerCase();
        return invoices.filter(invoice => {
            const date = getInvoiceDate(invoice);
            const year = date.getFullYear().toString();
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const yearMatch = selectedYear === 'All' || year === selectedYear;
            const monthMatch = selectedMonth === 'All' || month === selectedMonth;

            // SoD HYGIENE — hide invoices the current user CANNOT approve
            // because they created them or are named as the salesperson.
            // The server's invoice.approve.sales / .finance SoD rule would
            // 403 these on click anyway; surfacing them in the queue just
            // teases the user with rows that can never succeed. Filter
            // ONLY for the "Pending Approval" status (the one bound by
            // SoD); Pending Pricing rows have no approver-vs-creator
            // restriction so the finance pricing user can still see those.
            if (me && invoice.status === 'Pending Approval') {
                const createdBy = String(invoice.createdBy || '').toLowerCase();
                const salesPerson = String(invoice.salesPersonId || '').toLowerCase();
                if (me === createdBy || me === salesPerson) return false;
            }

            return yearMatch && monthMatch;
        });
    }, [invoices, selectedYear, selectedMonth, appUser]);

    const { years, months } = useMemo(() => {
        const uniqueYears = new Set();
        const uniqueMonths = new Set();
        invoices.forEach(inv => {
            const d = getInvoiceDate(inv);
            uniqueYears.add(d.getFullYear().toString());
            uniqueMonths.add((d.getMonth() + 1).toString().padStart(2, '0'));
        });
        return { years: Array.from(uniqueYears).sort().reverse(), months: Array.from(uniqueMonths).sort() };
    }, [invoices]);

    const formatRowAmount = (amount, currency) => {
        try {
            const cur = currency === 'USD' ? 'USD' : 'GHS';
            const locale = cur === 'USD' ? 'en-US' : 'en-GH';
            const n = Number(amount) || 0;
            return new Intl.NumberFormat(locale, { style: 'currency', currency: cur }).format(n);
        } catch (e) {
            return String(amount || 0);
        }
    };

    const handleApproval = async (invoiceId, newStatus) => {
        console.log('🔍 [DEBUG] SalesInvoiceApproval: handleApproval called', {
            invoiceId, newStatus, selectedSignature: selectedSignature?.controllerName, userId
        });

        try {
            // Validate signature selection for approval
            if (newStatus === 'Approved' && !selectedSignature) {
                setNotification({ type: 'error', message: 'Please select a signature before approving the invoice.' });
                return;
            }

            // Pull the latest cached row so we can include its rowVersion in
            // the PUT — backend uses this for optimistic-concurrency control
            // and returns 409 if someone else changed the invoice in the
            // meantime. Without it the server logs a "concurrency check
            // skipped" warning and falls back to last-write-wins.
            const invoiceForVersion = invoices.find(inv => inv.id === invoiceId);
            const updatePayload = {
                status: newStatus,
                ...(invoiceForVersion?.rowVersion !== undefined
                    ? { rowVersion: invoiceForVersion.rowVersion }
                    : {})
            };

            if (newStatus === 'Approved' && selectedSignature) {
                updatePayload.signatureData = JSON.stringify({
                    signature: selectedSignature.signatureData,
                    signatureUrl: selectedSignature.signatureUrl,
                    controllerName: selectedSignature.controllerName,
                    subsidiary: selectedSignature.subsidiary,
                    signedAt: new Date().toISOString(),
                    signedBy: userId
                });

                // Generate Permanent Invoice ID (same as SalesInvoiceReview)
                try {
                    const sequence = await getNextSequenceNumber();
                    updatePayload.approvedInvoiceId = generatePermanentId(sequence);
                    console.log('✅ Generated approvedInvoiceId:', updatePayload.approvedInvoiceId);
                } catch (seqErr) {
                    console.error('Failed to generate permanent ID:', seqErr);
                    // Continue without permanent ID rather than blocking approval
                }

                // STOCK DECREMENT IS NOW SERVER-SIDE.
                // The backend PUT /invoices/:id atomically decrements every
                // line item's inventory inside the same transaction as the
                // status change. The old client-side loop here was a lost-
                // update race — two approvers hitting the same SKU could
                // both succeed with stale snapshots, silently overselling.
                // If stock is insufficient the PUT below returns 409 with
                // code 'INSUFFICIENT_STOCK', already handled by the catch.
            } else if (newStatus === 'Rejected') {
                // Module 4 — open the controlled-vocabulary modal instead of
                // the free-text askText. The modal's onSubmit (see JSX below)
                // calls performReject which finishes the PUT. Bail out here.
                setRejectingInvoiceId(invoiceId);
                return;
            }

            await api.put(`/invoices/${invoiceId}`, updatePayload);

            // Optimistic UI Update - remove from list
            setInvoices(current => current.filter(inv => inv.id !== invoiceId));

            // Log activity (non-blocking)
            const invoice = invoices.find(inv => inv.id === invoiceId);
            logActivity(userId, newStatus === 'Approved' ? 'INVOICE_APPROVED' : 'INVOICE_REJECTED',
                `Invoice: ${invoice?.invoiceNumber || invoiceId}`, {
                    statusBefore: 'Pending Approval',
                    statusAfter: newStatus,
                    approvedBy: userId,
                    totalValue: invoice?.total || 0
                }).catch(err => console.error('Logging failed', err));

            setNotification({ type: 'success', message: `Invoice ${newStatus.toLowerCase()} successfully.` });
            setTimeout(() => setNotification(null), 3000);

        } catch (error) {
            console.error('❌ [ERROR] SalesInvoiceApproval: handleApproval failed:', error);
            // Surface the SERVER'S actual reason (SoD violation, sourcing
            // gate, insufficient stock, version mismatch, permission) rather
            // than axios's generic "Request failed with status code 409".
            const serverMsg = error?.response?.data?.error || error?.message || 'Unknown error';
            setNotification({
                type: 'error',
                message: `Failed to ${newStatus.toLowerCase()} invoice: ${serverMsg}`
            });
        }
    };

    /**
     * Module 4 — invoked by RejectWithReasonModal.onSubmit. Completes the
     * rejection PUT with the controlled reason code + competitor name +
     * notes. Mirrors the original askText path but with structured fields
     * (alongside the legacy free-text REJECTION_REASON for back-compat).
     */
    const performReject = async ({ reasonCode, reasonLabel, lostToCompetitor, notes }) => {
        const invoiceId = rejectingInvoiceId;
        if (!invoiceId) return;
        const invoiceForVersion = invoices.find(inv => inv.id === invoiceId);
        try {
            await api.put(`/invoices/${invoiceId}`, {
                status: 'Rejected',
                rejectionReason:     notes || reasonLabel || 'Rejected by approver',
                rejectionReasonCode: reasonCode || null,
                lostToCompetitor:    lostToCompetitor || null,
                ...(invoiceForVersion?.rowVersion !== undefined
                    ? { rowVersion: invoiceForVersion.rowVersion }
                    : {})
            });
            setInvoices(current => current.filter(inv => inv.id !== invoiceId));
            const invoice = invoices.find(inv => inv.id === invoiceId);
            logActivity(userId, 'INVOICE_REJECTED',
                `Invoice: ${invoice?.invoiceNumber || invoiceId}`, {
                    statusBefore: 'Pending Approval',
                    statusAfter: 'Rejected',
                    approvedBy: userId,
                    reasonCode,
                    lostToCompetitor,
                    totalValue: invoice?.total || 0
                }).catch(err => console.error('Logging failed', err));
            setNotification({ type: 'success', message: 'Invoice rejected.' });
            setTimeout(() => setNotification(null), 3000);
            setRejectingInvoiceId(null);
        } catch (error) {
            const serverMsg = error?.response?.data?.error || error?.message || 'Unknown error';
            setNotification({ type: 'error', message: `Failed to reject invoice: ${serverMsg}` });
            // Keep the modal open so the user can adjust + retry.
            throw error;
        }
    };

    if (isLoading) return <div className="p-8 text-center">Loading pending invoices...</div>;
    if (error) return <div className="p-8 text-center text-red-600">Error: {error}</div>;

    return (
        <>
            <RejectWithReasonModal
                open={!!rejectingInvoiceId}
                onClose={() => setRejectingInvoiceId(null)}
                onSubmit={performReject}
                category="INVOICE_REJECTION"
                title="Reject this invoice"
                description="The salesperson will see your reason on their My Invoices view and on the re-revised draft."
                confirmLabel="Reject invoice"
                confirmTone="danger"
                requireReason
            />
            <PageHeader
                title={isController ? 'Controller Approval & Pricing' : 'Sales Approval'}
                subtitle="Review and approve pending invoices. Select a signature before approving."
                back={
                    <Button variant="ghost" size="sm" onClick={() => navigateTo(isController ? 'controllerDashboard' : 'salesDashboard')} leftIcon={<Icon id="arrow-left" />}>
                        Back to Dashboard
                    </Button>
                }
                actions={<div className="text-sm text-ink-muted">User: {username}</div>}
            />

                    {notification && (
                        <div className={`mb-6 p-4 rounded-md ${notification.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                            {notification.message}
                        </div>
                    )}

                    {!isLoading && signatures.length > 0 && (
                        <div className="bg-white rounded-lg shadow p-6 mb-6">
                            <h3 className="text-lg font-semibold mb-4">Select Approval Signature</h3>
                            <div className="space-y-3">
                                <label className="block text-sm font-medium text-blue-700">Controller Signature:</label>
                                <select
                                    className="w-full p-3 border border-blue-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    value={selectedSignature?.id || ''}
                                    onChange={(e) => setSelectedSignature(signatures.find(s => s.id === e.target.value))}
                                >
                                    <option value="">Choose a signature...</option>
                                    {signatures.map(s => <option key={s.id} value={s.id}>{s.controllerName} - {s.subsidiary}</option>)}
                                </select>
                                {selectedSignature && (
                                    <div className="text-sm text-green-600">
                                        ✓ Selected: {selectedSignature.controllerName} ({selectedSignature.subsidiary})
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="bg-white rounded-lg shadow overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-200">
                            <h3 className="text-lg font-semibold">Invoices Requiring Attention</h3>
                            <p className="text-sm text-gray-600">Total: {invoices.length} invoices</p>
                        </div>

                        {invoices.length === 0 ? (
                            <div className="p-8 text-center text-gray-500">
                                <Icon id="check-circle" className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                                <p className="text-lg">No pending invoices to approve</p>
                                <p className="text-sm">All invoices have been processed</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
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

                                <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Invoice ID</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                                            <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total</th>
                                            <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                        {filteredInvoices.map(invoice => {
                                            // Calculate total items
                                            const itemCount = (invoice.items?.length || 0) + (invoice.lineItems?.length || 0);

                                            // Convert total if USD
                                            const exchangeRate = invoice.exchangeRate || 1;
                                            const displayTotal = invoice.currency === 'USD' ? (invoice.total / exchangeRate) : invoice.total;

                                            return (
                                                <tr key={invoice.id}>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{invoice.approvedInvoiceId || invoice.id}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{invoice.customerName}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{invoice.date}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-center">
                                                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${invoice.status === 'Pending Pricing' ? 'bg-purple-100 text-purple-800' : 'bg-amber-100 text-amber-800'
                                                            }`}>
                                                            {invoice.status}
                                                        </span>
                                                        {invoice.requiresReapproval && (
                                                            <span
                                                                className="ml-2 px-2 py-1 text-xs font-semibold rounded-full bg-amber-100 text-amber-900 border border-amber-300"
                                                                title="Procurement award changed line costs — open Review to accept the new total."
                                                            >
                                                                <Icon id="exclamation-triangle" className="mr-1" />
                                                                Re-approval needed
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                                                        {formatRowAmount(displayTotal, invoice.currency)}
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-center space-x-2">
                                                        {/* CONTROLLER ACTION: PRICING */}
                                                        {isController && invoice.status === 'Pending Pricing' && (
                                                            <button
                                                                onClick={() => navigateTo('invoiceEditor', { invoiceId: invoice.id, returnTo: 'salesInvoiceApproval' })}
                                                                className="text-purple-600 hover:text-purple-900 border border-purple-200 px-3 py-1 rounded bg-purple-50"
                                                            >
                                                                <Icon id="edit" className="mr-1 inline" /> Price Item
                                                            </button>
                                                        )}

                                                        {/* COMMON ACTION: APPROVAL */}
                                                        {invoice.status === 'Pending Approval' && (
                                                            <>
                                                                <button
                                                                    onClick={() => navigateTo('salesInvoiceReview', { invoiceId: invoice.id })}
                                                                    className="text-indigo-600 hover:text-indigo-900"
                                                                >
                                                                    Review
                                                                </button>
                                                                <button
                                                                    onClick={() => handleApproval(invoice.id, 'Approved')}
                                                                    disabled={!selectedSignature || invoice.requiresReapproval}
                                                                    className={`text-green-600 hover:text-green-900 ${(!selectedSignature || invoice.requiresReapproval) ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                                    title={
                                                                        invoice.requiresReapproval
                                                                            ? 'Open Review and resolve the variance before approving.'
                                                                            : (!selectedSignature ? 'Select a signature first' : 'Approve')
                                                                    }
                                                                >
                                                                    Approve
                                                                </button>
                                                                <button
                                                                    onClick={() => handleApproval(invoice.id, 'Rejected')}
                                                                    className="text-red-600 hover:text-red-900"
                                                                >
                                                                    Reject
                                                                </button>
                                                            </>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
        </>
    );
};

export default SalesInvoiceApproval;
