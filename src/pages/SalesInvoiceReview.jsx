import React, { useState, useEffect, useMemo } from 'react';
import api from '../api';
import Icon from '../components/common/Icon';
import PageHeader from '../components/common/PageHeader';
import Button from '../components/common/Button';
import { formatCurrency } from '../utils/formatting';
import { logActivity } from '../utils/logger';
import { generatePermanentId, getNextSequenceNumber } from '../utils/helpers';
import ReApprovalBanner from '../components/invoices/ReApprovalBanner';
import { useApp } from '../context/AppContext';

const SalesInvoiceReview = ({ navigateTo, userId, pageContext }) => {
    const { appUser } = useApp();
    const [invoice, setInvoice] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [signatures, setSignatures] = useState([]);
    const [signaturesLoading, setSignaturesLoading] = useState(true);
    const [selectedSignature, setSelectedSignature] = useState(null);
    const [notification, setNotification] = useState(null);
    const [taxes, setTaxes] = useState([]);
    const [taxesLoading, setTaxesLoading] = useState(true);
    const [reapprovalSubmitting, setReapprovalSubmitting] = useState(false);

    // Phase 4 — Re-approval handler. When sales reviews an invoice that procurement
    // has materially changed via cost pushback (variance > threshold), the banner
    // forces an explicit accept/reject decision before they can sign-off as before.
    const handleReapprovalDecision = async ({ decision, note }) => {
        if (!invoice?.id) return;
        setReapprovalSubmitting(true);
        try {
            const res = await api.post(`/invoices/${invoice.id}/reapprove`, { decision, note });
            if (res.success) {
                setNotification({
                    type: 'success',
                    message: decision === 'accept'
                        ? 'New total accepted. You can now approve and release this quote.'
                        : 'Quote bounced back to Pending Pricing for revision.'
                });
                // Refresh to clear requiresReapproval flag
                const refreshed = await api.get(`/invoices/${invoice.id}`);
                if (refreshed.success) setInvoice(refreshed.data);
                // If revised, the invoice has left this queue — go back to the list
                if (decision === 'reject') {
                    setTimeout(() => navigateTo('salesInvoiceApproval'), 1500);
                }
            } else {
                setNotification({ type: 'error', message: res.error || 'Re-approval failed.' });
            }
        } catch (err) {
            setNotification({ type: 'error', message: err?.message || 'Re-approval failed.' });
        } finally {
            setReapprovalSubmitting(false);
        }
    };

    const invoiceId = pageContext?.invoiceId;

    // Load invoice data
    useEffect(() => {
        if (!invoiceId) return;
 
        const fetchInvoice = async () => {
            try {
                const response = await api.get(`/invoices/${invoiceId}`);
                if (response.success && response.data) {
                    setInvoice(response.data);
                } else {
                    setError('Invoice not found');
                }
                setLoading(false);
            } catch (err) {
                console.error('Error fetching invoice:', err);
                setError(err.message);
                setLoading(false);
            }
        };
 
        fetchInvoice();
    }, [invoiceId]);

    // Load signatures for approval — only the current user's own signatures.
    // Server returns all signatures; we MUST filter client-side by createdBy
    // to prevent a sales rep from inadvertently signing with another user's
    // (e.g. controller's) signature image. Same pattern as SalesInvoiceApproval.jsx.
    useEffect(() => {
        const fetchSignatures = async () => {
            try {
                const response = await api.get('/settings/signatures');
                if (response.success && response.data) {
                    const all = response.data.signatures || [];
                    setSignatures(all.filter(s => s.createdBy === userId));
                }
                setSignaturesLoading(false);
            } catch (err) {
                console.error('Error fetching signatures:', err);
                setSignaturesLoading(false);
            }
        };
        fetchSignatures();
    }, [userId]);

    // Load tax configuration
    useEffect(() => {
        const fetchTaxes = async () => {
            try {
                const response = await api.get('/settings/taxes');
                if (response.success && response.data) {
                    setTaxes(response.data.taxArray || []);
                }
                setTaxesLoading(false);
            } catch (err) {
                console.error('Error fetching taxes:', err);
                setTaxesLoading(false);
            }
        };
        fetchTaxes();
    }, []);

    // Helper function to calculate totals dynamically (synchronized with InvoiceEditor)
    const calculateDynamicTotals = (subtotalWithCharges, taxes, orderCharges = {}) => {
        console.log('🧮 [DEBUG] SalesInvoiceReview: calculateDynamicTotals called', {
            subtotalWithCharges,
            taxesCount: taxes.length,
            orderCharges,
            taxes: taxes.map(t => ({
                id: t.id,
                name: t.name,
                rate: t.rate,
                on: t.on,
                enabled: t.enabled
            }))
        });

        const totals = {};

        // Calculate base subtotal (without order charges)
        const subtotal = subtotalWithCharges - (orderCharges.shipping || 0) - (orderCharges.handling || 0) + (orderCharges.discount || 0);
        totals.subtotal = subtotal;

        // Add order charges to result
        totals.shipping = orderCharges.shipping || 0;
        totals.handling = orderCharges.handling || 0;
        totals.discount = orderCharges.discount || 0;
        totals.subtotalWithCharges = subtotalWithCharges;

        let levyTotal = subtotalWithCharges;

        // Apply taxes to subtotal with charges (NHIL, GETFund, etc.)
        const subtotalTaxes = taxes.filter(t => t.on === 'subtotal' && t.enabled);
        console.log('📊 [DEBUG] SalesInvoiceReview: Subtotal taxes', {
            count: subtotalTaxes.length,
            taxes: subtotalTaxes.map(t => ({ id: t.id, name: t.name, rate: t.rate }))
        });

        subtotalTaxes.forEach(t => {
            const taxAmount = subtotalWithCharges * (t.rate / 100);
            totals[t.id] = taxAmount;
            totals[`${t.id}_rate`] = t.rate; // Store the rate too
            levyTotal += taxAmount;
            console.log('💰 [DEBUG] SalesInvoiceReview: Subtotal tax calculation', {
                taxId: t.id,
                taxName: t.name,
                rate: t.rate,
                taxAmount,
                levyTotalAfter: levyTotal
            });
        });

        totals.levyTotal = levyTotal;

        // Apply taxes to levy total (VAT, COVID-19 Levy, etc.)
        const levyTaxes = taxes.filter(t => t.on === 'levyTotal' && t.enabled);
        console.log('📊 [DEBUG] SalesInvoiceReview: Levy taxes', {
            count: levyTaxes.length,
            taxes: levyTaxes.map(t => ({ id: t.id, name: t.name, rate: t.rate }))
        });

        let grandTotal = levyTotal;
        levyTaxes.forEach(t => {
            const taxAmount = levyTotal * (t.rate / 100);
            totals[t.id] = taxAmount;
            totals[`${t.id}_rate`] = t.rate; // Store the rate too
            grandTotal += taxAmount;
            console.log('💰 [DEBUG] SalesInvoiceReview: Levy tax calculation', {
                taxId: t.id,
                taxName: t.name,
                rate: t.rate,
                taxAmount,
                grandTotalAfter: grandTotal
            });
        });

        totals.grandTotal = grandTotal;

        console.log('✅ [DEBUG] SalesInvoiceReview: Final calculated totals', { totals });
        return totals;
    };

    // Prepare display invoice with currency conversion if needed
    const displayInvoice = useMemo(() => {
        if (!invoice) return null;
        if (invoice.currency !== 'USD') return invoice;

        const rate = invoice.exchangeRate || 1;
        console.log('💱 [DEBUG] SalesInvoiceReview: Converting invoice to USD for display', { rate });

        // Deep copy to avoid mutating state
        const converted = JSON.parse(JSON.stringify(invoice));

        // Convert items — accept both frontend-native shape (price/finalPrice) AND
        // the backend GET /invoices/:id shape (unitPrice/totalPrice). Without this
        // the USD branch silently dropped the numbers produced by the API.
        const convertItem = (item) => {
            const basePrice = Number(item.unitPrice ?? item.finalPrice ?? item.price ?? 0);
            const lineTotal = Number(item.totalPrice ?? (basePrice * (item.quantity || 0)));
            item.price = basePrice / rate;
            item.finalPrice = basePrice / rate;
            item.unitPrice = basePrice / rate;
            item.totalPrice = lineTotal / rate;
        };
        if (converted.items) converted.items.forEach(convertItem);
        if (converted.lineItems) converted.lineItems.forEach(convertItem);

        // Convert order charges
        if (converted.orderCharges) {
            converted.orderCharges.shipping = (Number(converted.orderCharges.shipping) || 0) / rate;
            converted.orderCharges.handling = (Number(converted.orderCharges.handling) || 0) / rate;
            converted.orderCharges.discount = (Number(converted.orderCharges.discount) || 0) / rate;
        }

        // Convert total
        converted.total = (Number(converted.total) || 0) / rate;

        return converted;
    }, [invoice]);

    const calculatedTotals = useMemo(() => {
        if (!displayInvoice || taxesLoading) return null;

        // Use invoice's stored tax config if available, otherwise use current global taxes
        // This ensures historical invoices retain their original tax settings
        const taxConfig = displayInvoice.taxConfiguration || taxes;

        // Calculate subtotal from line items. GET /invoices/:id returns
        // { unitPrice, totalPrice } from Oracle; the in-memory editor shape
        // carries { price, finalPrice }. Accept both so the subtotal matches
        // the line totals the user sees in the table.
        const itemsArray = displayInvoice.items || displayInvoice.lineItems || [];
        const subtotal = itemsArray.reduce((acc, item) => {
            const quantity = Number(item.quantity || 0);
            // Prefer a precomputed line total when the backend sent one — that's
            // the number that was actually persisted and used for QA_INVOICES.TOTAL.
            if (item.totalPrice != null && !isNaN(Number(item.totalPrice))) {
                return acc + Number(item.totalPrice);
            }
            const price = Number(item.unitPrice ?? item.finalPrice ?? item.price ?? 0);
            return acc + (price * quantity);
        }, 0);

        // Add order charges
        const orderCharges = displayInvoice.orderCharges || { shipping: 0, handling: 0, discount: 0 };
        const shipping = Number(orderCharges.shipping || 0);
        const handling = Number(orderCharges.handling || 0);
        const discount = Number(orderCharges.discount || 0);
        const subtotalWithCharges = subtotal + shipping + handling - discount;

        return calculateDynamicTotals(subtotalWithCharges, taxConfig, orderCharges);
    }, [displayInvoice, taxes, taxesLoading]);

    const handleApproval = async (newStatus) => {
        console.log('🔍 [DEBUG] SalesInvoiceReview: handleApproval called', {
            invoiceId,
            newStatus,
            selectedSignature: selectedSignature?.controllerName,
            userId
        });

        try {
            // Validate signature selection for approval
            if (newStatus === 'Approved' && !selectedSignature) {
                console.warn('⚠️ [DEBUG] SalesInvoiceReview: No signature selected for approval');
                setNotification({ type: 'error', message: 'Please select a signature before approving the invoice.' });
                return;
            }

            const updateData = {
                status: newStatus,
            };
 
            // Add signature information if approving
            if (newStatus === 'Approved' && selectedSignature) {
                updateData.signatureData = JSON.stringify(selectedSignature);
                updateData.controllerSignature = selectedSignature.signatureUrl; // legacy field support
                updateData.controllerName = selectedSignature.controllerName;
                updateData.controllerSubsidiary = selectedSignature.subsidiary;
                updateData.signatureTimestamp = new Date().toISOString();
                updateData.approvedBy = userId;
                updateData.taxConfiguration = taxes;
 
                // Generate Permanent ID
                const sequence = await getNextSequenceNumber();
                updateData.approvedInvoiceId = generatePermanentId(sequence);
                
                // Adjust Stock
                const itemsArray = invoice.items || invoice.lineItems || [];
                for (const item of itemsArray) {
                    try {
                        const invRes = await api.get(`/inventory/${item.id}`);
                        if (invRes.success && invRes.data) {
                            const currentStock = invRes.data.stock;
                            const newStock = currentStock - (item.quantity || 0);
                            await api.put(`/inventory/${item.id}`, { stock: newStock });
                        }
                    } catch (invErr) {
                        console.warn(`Stock adjustment failed for ${item.id}`, invErr);
                    }
                }
            }
 
            const response = await api.put(`/invoices/${invoiceId}`, updateData);
            if (!response.success) {
                throw new Error(response.error || `Failed to ${newStatus} invoice`);
            }

            await logActivity(userId, newStatus === 'Approved' ? 'Approved Review' : 'Rejected Review', `Invoice: ${invoice.invoiceNumber}`, {
                statusBefore: invoice.status,
                statusAfter: newStatus,
                approvedBy: userId,
                approvalDate: new Date().toISOString(),
                totalValue: invoice.total || 0,
                itemCount: invoice.lineItems?.length || 0
            });

            setNotification({ type: 'success', message: `Invoice has been ${newStatus.toLowerCase()}.` });
            setTimeout(() => navigateTo('salesInvoiceApproval'), 1500);

            console.log('✅ [DEBUG] SalesInvoiceReview: Approval process completed successfully');
        } catch (error) {
            console.error('❌ [ERROR] SalesInvoiceReview: handleApproval failed:', error);
            setNotification({ type: 'error', message: `Failed to ${newStatus.toLowerCase()} invoice: ${error.message}` });
        }
    };

    const formatInvoiceAmount = (currency, amount) => {
        return formatCurrency(currency, amount);
    };

    if (loading) return <div className="p-8 text-center">Loading invoice details...</div>;
    if (error) return <div className="p-8 text-center text-red-600">Error: {error}</div>;
    if (!invoice) return <div className="p-8 text-center">Invoice not found</div>;

    return (
        <>
            <PageHeader
                title={`Review Invoice: ${invoice.id}`}
                subtitle="Review details and approve or reject this invoice."
                back={
                    <Button variant="ghost" size="sm" onClick={() => navigateTo('salesInvoiceApproval')} leftIcon={<Icon id="arrow-left" />}>
                        Back to Approval List
                    </Button>
                }
                actions={
                    <div className={`px-4 py-2 rounded-full text-sm font-semibold ${invoice.status === 'Pending Approval' ? 'bg-yellow-100 text-yellow-800' :
                        invoice.status === 'Approved' ? 'bg-green-100 text-green-800' :
                            'bg-red-100 text-red-800'
                        }`}>
                        {displayInvoice.status}
                    </div>
                }
            />

                    {notification && (
                        <div className={`mb-6 p-4 rounded-md ${notification.type === 'success'
                            ? 'bg-green-50 text-green-800 border border-green-200'
                            : 'bg-red-50 text-red-800 border border-red-200'
                            }`}>
                            {notification.message}
                        </div>
                    )}

                    {/* Phase 4 — Re-approval banner. Surfaces variance vs original
                        estimate when procurement's award changed line costs. The
                        Approve button below stays disabled until the user accepts. */}
                    {invoice?.requiresReapproval && (
                        <ReApprovalBanner
                            invoice={invoice}
                            canAct={
                                appUser?.role === 'controller' ||
                                appUser?.role === 'admin' ||
                                invoice?.salesPersonId === appUser?.email ||
                                invoice?.createdBy === appUser?.email
                            }
                            onDecision={handleReapprovalDecision}
                            submitting={reapprovalSubmitting}
                        />
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Invoice Details */}
                        <div className="lg:col-span-2 space-y-6">
                            {/* Customer Information */}
                            <div className="bg-white rounded-lg shadow p-6">
                                <h3 className="text-lg font-semibold mb-4">Customer Information</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">Customer Name</label>
                                        <p className="mt-1 text-sm text-gray-900">{displayInvoice.customerName}</p>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">Invoice Date</label>
                                        <p className="mt-1 text-sm text-gray-900">{displayInvoice.date}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Line Items */}
                            <div className="bg-white rounded-lg shadow p-6">
                                <h3 className="text-lg font-semibold mb-4">Invoice Items</h3>
                                <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-gray-200">
                                        <thead className="bg-gray-50">
                                            <tr>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Item</th>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Quantity</th>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Unit Price</th>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total</th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-gray-200">
                                            {(displayInvoice.items || displayInvoice.lineItems || []).map((item, index) => {
                                                // Backend GET /invoices/:id ships { description, unitPrice, totalPrice };
                                                // the live editor state carries { name, price, finalPrice }.
                                                // Read both so the review page doesn't render blank rows.
                                                const itemName = item.description || item.name || '—';
                                                const itemPrice = Number(item.unitPrice ?? item.finalPrice ?? item.price ?? 0);
                                                const itemTotal = item.totalPrice != null && !isNaN(Number(item.totalPrice))
                                                    ? Number(item.totalPrice)
                                                    : itemPrice * (item.quantity || 0);
                                                const rowCurrency = item.currency || displayInvoice.currency;
                                                return (
                                                    <tr key={index}>
                                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{itemName}</td>
                                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{item.quantity}</td>
                                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{formatInvoiceAmount(rowCurrency, itemPrice)}</td>
                                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{formatInvoiceAmount(rowCurrency, itemTotal)}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Order Level Charges */}
                            {displayInvoice.orderCharges && (
                                <div className="bg-white rounded-lg shadow p-6">
                                    <h3 className="text-lg font-semibold mb-4">Order Charges</h3>
                                    <div className="space-y-2">
                                        <div className="flex justify-between">
                                            <span className="text-sm text-gray-600">Shipping:</span>
                                            <span className="text-sm font-medium">{formatInvoiceAmount(displayInvoice.currency, displayInvoice.orderCharges.shipping || 0)}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-sm text-gray-600">Handling:</span>
                                            <span className="text-sm font-medium">{formatInvoiceAmount(displayInvoice.currency, displayInvoice.orderCharges.handling || 0)}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-sm text-gray-600">Discount:</span>
                                            <span className="text-sm font-medium text-red-600">-{formatInvoiceAmount(displayInvoice.currency, displayInvoice.orderCharges.discount || 0)}</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Totals */}
                            <div className="bg-white rounded-lg shadow p-6">
                                <h3 className="text-lg font-semibold mb-4">Invoice Summary</h3>
                                <div className="space-y-2">
                                    <div className="flex justify-between">
                                        <span className="text-sm text-gray-600">Subtotal:</span>
                                        <span className="text-sm font-medium">{formatInvoiceAmount(displayInvoice.currency, calculatedTotals?.subtotal || 0)}</span>
                                    </div>
                                    {calculatedTotals && taxes.filter(t => t.enabled).map((tax, index) => (
                                        <div key={index} className="flex justify-between">
                                            <span className="text-sm text-gray-600">{tax.name}:</span>
                                            <span className="text-sm font-medium">{formatInvoiceAmount(displayInvoice.currency, calculatedTotals[tax.id] || 0)}</span>
                                        </div>
                                    ))}
                                    <div className="border-t pt-2">
                                        <div className="flex justify-between">
                                            <span className="text-lg font-semibold">Total:</span>
                                            <span className="text-lg font-semibold">{formatInvoiceAmount(displayInvoice.currency, calculatedTotals?.grandTotal || displayInvoice.total || 0)}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Approval Actions */}
                        <div className="space-y-6">
                            {/* Empty-state: first-time user has no signature on file yet.
                              Without this, the whole signature panel was hidden and the user
                              could not reach the Add-Signature flow. */}
                            {!signaturesLoading && signatures.length === 0 && (
                                <div className="bg-white rounded-lg shadow p-6">
                                    <h3 className="text-lg font-semibold mb-2">No Signature On File</h3>
                                    <p className="text-sm text-gray-600 mb-4">
                                        You need to capture or upload a signature before you can approve this invoice.
                                    </p>
                                    <button onClick={() => navigateTo('mySignatures')}
                                        className="w-full py-3 px-4 text-white bg-blue-600 rounded-md font-semibold hover:bg-blue-700">
                                        <Icon id="cog" className="mr-2" />
                                        Add A Signature
                                    </button>
                                </div>
                            )}

                            {/* Signature Selection */}
                            {!signaturesLoading && signatures.length > 0 && (
                                <div className="bg-white rounded-lg shadow p-6">
                                    <h3 className="text-lg font-semibold mb-4">Select Approval Signature</h3>

                                    {/*
                                      Route to the standalone MySignatures page — not taxSettings.
                                      taxSettings is gated to controller/admin, so sales users
                                      clicking "Add A Signature" were being bounced back to the
                                      dashboard by the PAGE_ROLES guard in AppContext.
                                    */}
                                    <button onClick={() => navigateTo('mySignatures')}
                                        className="w-full py-3 px-4 text-white bg-blue-600 rounded-md font-semibold hover:bg-blue-700">
                                        <Icon id="cog" className="mr-2" />
                                        Add A Signature
                                    </button>

                                    <div className="space-y-3 mt-4">
                                        <label className="block text-sm font-medium text-blue-700">
                                            Sales Signature:
                                        </label>
                                        <select
                                            value={selectedSignature?.id || ''}
                                            onChange={(e) => {
                                                const signature = signatures.find(s => s.id === e.target.value);
                                                setSelectedSignature(signature);
                                            }}
                                            className="w-full p-3 border border-blue-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        >
                                            <option value="">Choose a signature...</option>
                                            {signatures.map(sig => (
                                                <option key={sig.id} value={sig.id}>
                                                    {sig.controllerName} - {sig.subsidiary}
                                                </option>
                                            ))}
                                        </select>
                                        {selectedSignature && (
                                            <div className="text-sm text-green-600">
                                                ✓ Selected: {selectedSignature.controllerName} ({selectedSignature.subsidiary})
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Action Buttons */}
                            <div className="bg-white rounded-lg shadow p-6">
                                <h3 className="text-lg font-semibold mb-4">Actions</h3>
                                <div className="space-y-3">
                                    <button
                                        onClick={() => handleApproval('Rejected')}
                                        className="w-full py-3 px-4 text-white bg-red-600 rounded-md font-semibold hover:bg-red-700"
                                    >
                                        Reject Invoice
                                    </button>
                                    <button
                                        onClick={() => handleApproval('Approved')}
                                        disabled={!selectedSignature || invoice?.requiresReapproval}
                                        className={`w-full py-3 px-4 text-white rounded-md font-semibold ${selectedSignature && !invoice?.requiresReapproval
                                            ? 'bg-green-600 hover:bg-green-700'
                                            : 'bg-gray-400 cursor-not-allowed'
                                            }`}
                                        title={
                                            invoice?.requiresReapproval
                                                ? 'Resolve the re-approval decision above before approving.'
                                                : (selectedSignature ? 'Approve with selected signature' : 'Please select a signature first')
                                        }
                                    >
                                        {invoice?.requiresReapproval
                                            ? 'Re-Approval Required'
                                            : (selectedSignature ? 'Approve Invoice' : 'Select Signature First')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
        </>
    );
};

export default SalesInvoiceReview;
