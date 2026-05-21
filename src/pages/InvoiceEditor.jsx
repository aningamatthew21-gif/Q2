import React, { useState, useEffect, useMemo } from 'react';
import api from '../api';
import { useRealtimeInventory } from '../hooks/useRealtimeInventory';
import { useRealtimeCustomers } from '../hooks/useRealtimeCustomers';
import Icon from '../components/common/Icon';
import PageHeader from '../components/common/PageHeader';
import Button from '../components/common/Button';
import Notification from '../components/common/Notification';
import QuantityModal from '../components/modals/QuantityModal';
import ConfirmationModal from '../components/modals/ConfirmationModal';
import ReApprovalBanner from '../components/invoices/ReApprovalBanner';
import { logActivity } from '../utils/logger';
import { isFinanceController, resolveReturnPage } from '../utils/roles';
import { can } from '../utils/permissions';

const InvoiceEditor = ({ navigateTo, pageContext, userId, currentUser }) => {
    const { invoiceId } = pageContext || {};

    // Where Cancel / post-approval navigation should land.
    //
    // Prefers an explicit `returnTo` handed in by whoever opened the
    // editor (All Invoices, My Invoices, a dashboard tile…) — that's the
    // industry-standard "return URL" pattern — and falls back to a
    // ROLE-AWARE default. The old code only knew the flat roles
    // `'sales'` / `'controller'`, so a tiered user (finance_head, …)
    // hit the `else` branch and was dumped on the sales dashboard, and
    // after an approval was sent to `myInvoices` — a page finance can't
    // open — which is the "access restricted" screen the user saw.
    const handleBackNavigation = () => {
        navigateTo(resolveReturnPage(pageContext, currentUser));
    };

    const { data: inventory, loading: inventoryLoading } = useRealtimeInventory();
    const { data: customers, loading: customersLoading } = useRealtimeCustomers();

    // Invoice specific state
    const [invoice, setInvoice] = useState(null);
    const [quoteItems, setQuoteItems] = useState([]);
    const [taxes, setTaxes] = useState([]);
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [orderCharges, setOrderCharges] = useState({
        shipping: 0,
        handling: 0,
        discount: 0
    });

    // UI State
    const [isLoading, setIsLoading] = useState(true);
    const [notification, setNotification] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [addingItem, setAddingItem] = useState(null);
    const [removingItem, setRemovingItem] = useState(null);
    const [reapprovalSubmitting, setReapprovalSubmitting] = useState(false);

    // M8 — prevent line-item edits while procurement is actively sourcing.
    // Finance desk (any finance role) / admin can still override for
    // exceptional cases; other roles are locked out.
    const sourcingInProgress =
        invoice?.sourcingStatus === 'PENDING' || invoice?.sourcingStatus === 'PARTIAL';
    const sourcingLocked =
        sourcingInProgress && !isFinanceController(currentUser?.role);

    // ── Sourcing gate on APPROVAL ───────────────────────────────────────
    // An invoice that still needs procurement (sourcingStatus PENDING or
    // PARTIAL) carries placeholder prices for its sourced lines — the real
    // cost only lands once the RFQ is AWARDED and pushed back, which flips
    // sourcingStatus to COMPLETE. Approving before that means the finance
    // head signs off a total that isn't real. So approval is blocked until
    // sourcing completes; rejection stays available (finance can always
    // bounce a quote back). NONE = no procurement needed = free to approve.
    const sourcingBlocksApproval = sourcingInProgress;

    // Phase 4 — handle re-approval decisions from the ReApprovalBanner
    const handleReapprovalDecision = async ({ decision, note }) => {
        if (!invoice?.id) return;
        setReapprovalSubmitting(true);
        try {
            const res = await api.post(`/invoices/${invoice.id}/reapprove`, { decision, note });
            if (res.success) {
                setNotification({
                    type: 'success',
                    message: decision === 'accept'
                        ? 'Quote re-approved. You can now release it to the customer.'
                        : 'Quote bounced back to Pending Pricing for revision.'
                });
                // Refresh invoice to pull updated flags / status
                const refreshed = await api.get(`/invoices/${invoice.id}`);
                if (refreshed.success) setInvoice(refreshed.data);
            } else {
                setNotification({ type: 'error', message: res.error || 'Re-approval failed.' });
            }
        } catch (err) {
            setNotification({ type: 'error', message: err?.message || 'Re-approval failed.' });
        } finally {
            setReapprovalSubmitting(false);
        }
    };



    // Signature selection state
    const [signatures, setSignatures] = useState([]);
    const [selectedSignature, setSelectedSignature] = useState(null);
    const [signaturesLoading, setSignaturesLoading] = useState(true);

    // Currency State
    const [currency, setCurrency] = useState('GHS');
    const [fxMonthKey] = useState(() => {
        const now = new Date();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        return `${now.getFullYear()}-${m}`;
    });
    const [fxRateGhsPerUsd, setFxRateGhsPerUsd] = useState(null);





    // Fetch invoice data
    useEffect(() => {
        if (!invoiceId) return;

        const fetchInvoice = async () => {
            try {
                const res = await api.get(`/invoices/${invoiceId}`);
                if (res.success) {
                    const data = res.data;
                    setInvoice(data);
                    const itemsArray = data.lineItems || data.items || [];
                    setQuoteItems(itemsArray);
                    // ── Tax catalogue load policy ──────────────────────────
                    // Pre-customer-send invoices (Draft, Pending Pricing,
                    // Pending Approval, Rejected-back-to-sales) ALWAYS pull
                    // the live global /settings/taxes catalogue. This means
                    // the FH approval view mirrors current Tax Settings —
                    // new taxes (e.g. a newly-added TRIAL TAX) appear with
                    // their global enabled-state, and rate changes flow
                    // through. Matches the QuotingModule sales-engine
                    // behaviour the user asked for. FH retains the ability
                    // to toggle individual taxes off per-invoice; the toggle
                    // is captured in `taxBreakdown` when they approve.
                    //
                    // Finalized invoices (Approved onward — customer has
                    // either been sent the invoice or has acted on it) load
                    // the saved snapshot so the historical record stays
                    // intact and matches what the customer received. Global
                    // is only consulted as a fallback if the snapshot is
                    // missing (legacy invoices created before snapshot
                    // persistence existed).
                    //
                    // The cutoff is FH approval: status === 'Approved' is
                    // when the snapshot becomes the source of truth.
                    const FINALIZED_STATUSES = new Set([
                        'Approved',
                        'Sent',
                        'Customer Accepted',
                        'Customer Rejected',
                        'Paid',
                        'Partially Paid',
                        'Cancelled',
                        'Closed'
                    ]);
                    const savedTaxes = Array.isArray(data.taxBreakdown) ? data.taxBreakdown : [];
                    const isFinalized = FINALIZED_STATUSES.has(data.status);

                    if (isFinalized && savedTaxes.length > 0) {
                        // Locked snapshot — preserve customer-facing tax history.
                        setTaxes(savedTaxes);
                    } else {
                        // Pre-customer-send OR finalized-but-no-snapshot: pull live global.
                        try {
                            const taxRes = await api.get('/settings/taxes');
                            const globalTaxes = (taxRes?.success && Array.isArray(taxRes.data?.taxArray))
                                ? taxRes.data.taxArray
                                : [];
                            // Final guard: if global also empty (shouldn't happen, but
                            // defensive), keep whatever was on the invoice rather than
                            // rendering an empty taxes block.
                            setTaxes(globalTaxes.length > 0 ? globalTaxes : savedTaxes);
                        } catch (taxErr) {
                            console.error('Error loading global tax catalogue:', taxErr);
                            setTaxes(savedTaxes); // fall back to whatever was on the invoice
                        }
                    }
                    setOrderCharges(data.orderCharges || { shipping: 0, handling: 0, discount: 0 });
                    setSelectedCustomer(customers.find(c => c.id === data.customerId) || null);
                    if (data.currency) setCurrency(data.currency);
                    setIsLoading(false);
                } else {
                    setNotification({ type: 'error', message: 'Invoice not found.' });
                    setIsLoading(false);
                }
            } catch (err) {
                console.error('Error fetching invoice:', err);
                setNotification({ type: 'error', message: 'Error loading invoice.' });
                setIsLoading(false);
            }
        };

        fetchInvoice();
    }, [invoiceId, customers]);

    // Load available signatures
    useEffect(() => {
        const fetchSignatures = async () => {
            try {
                const res = await api.get('/settings/signatures');
                if (res.success) {
                    const mySignatures = (res.data.signatures || []).filter(s => s.createdBy === userId);
                    setSignatures(mySignatures);
                    if (!selectedSignature && mySignatures.length > 0) {
                        setSelectedSignature(mySignatures[0]);
                    }
                }
                setSignaturesLoading(false);
            } catch (err) {
                console.error('Error fetching signatures:', err);
                setSignaturesLoading(false);
            }
        };
        fetchSignatures();
    }, [userId]);

    // Fetch Exchange Rates
    useEffect(() => {
        const fetchFx = async () => {
            try {
                const res = await api.get('/settings/exchangeRates');
                if (res.success && res.data.rates) {
                    const current = res.data.rates.find(r => r.month === fxMonthKey);
                    const rate = current ? Number(current.usdToGhs) : null;
                    if (isFinite(rate) && rate > 0) setFxRateGhsPerUsd(rate);
                }
            } catch (err) {
                console.error('Error fetching FX rates:', err);
            }
        };
        fetchFx();
    }, [fxMonthKey]);

    // Helper functions for currency conversion
    const convertAmount = (amountGhs) => {
        const n = Number(amountGhs) || 0;
        if (currency === 'USD') {
            const rate = invoice?.exchangeRate || fxRateGhsPerUsd;
            if (!rate) return 0;
            return Number((n / rate).toFixed(2));
        }
        return Number(n.toFixed(2));
    };

    const formatAmount = (amountGhs) => {
        const val = convertAmount(amountGhs);
        if (currency === 'USD') {
            return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
        }
        return new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' }).format(val);
    };

    const toggleCurrency = () => {
        setCurrency(prev => prev === 'GHS' ? 'USD' : 'GHS');
    };

    const filteredInventory = useMemo(() => inventory.filter(item => item.name.toLowerCase().includes(searchTerm.toLowerCase()) || item.id.toLowerCase().includes(searchTerm.toLowerCase())), [inventory, searchTerm]);



    const totals = useMemo(() => {
        if (!taxes) return {};
        const result = {};

        // Use finalPrice if available, otherwise use price
        const subtotal = quoteItems.reduce((acc, item) => {
            const itemPrice = Number(item.finalPrice || item.price || 0);
            const quantity = Number(item.quantity || 0);
            return acc + (itemPrice * quantity);
        }, 0);

        result.subtotal = subtotal;

        // Add order level charges
        const shipping = Number(orderCharges.shipping || 0);
        const handling = Number(orderCharges.handling || 0);
        const discount = Number(orderCharges.discount || 0);

        result.shipping = shipping;
        result.handling = handling;
        result.discount = discount;

        // Calculate subtotal with order charges
        const subtotalWithCharges = subtotal + shipping + handling - discount;
        result.subtotalWithCharges = subtotalWithCharges;

        let levyTotal = subtotalWithCharges;

        // Apply taxes to subtotal with charges
        taxes.filter(t => t.on === 'subtotal' && t.enabled).forEach(t => {
            const taxRate = Number(t.rate || 0);
            const taxAmount = subtotalWithCharges * (taxRate / 100);
            result[t.id] = taxAmount;
            levyTotal += taxAmount;
        });

        result.levyTotal = levyTotal;
        let grandTotal = levyTotal;

        // Apply taxes to levy total
        taxes.filter(t => t.on === 'levyTotal' && t.enabled).forEach(t => {
            const taxRate = Number(t.rate || 0);
            const taxAmount = levyTotal * (taxRate / 100);
            result[t.id] = taxAmount;
            grandTotal += taxAmount;
        });

        result.grandTotal = grandTotal;
        return result;
    }, [quoteItems, taxes, orderCharges]);

    const handleTaxChange = (id, field, value) => {
        setTaxes(currentTaxes =>
            currentTaxes.map(t =>
                t.id === id ? { ...t, [field]: field === 'rate' ? parseFloat(value) || 0 : value } : t
            )
        );
    };

    const handleAddItem = (item, quantity) => {
        setQuoteItems(currentItems => {
            const existing = currentItems.find(i => i.id === item.id);
            if (existing) {
                return currentItems.map(i => i.id === item.id ? { ...i, quantity: i.quantity + quantity, price: item.price } : i);
            }
            return [...currentItems, { id: item.id, name: item.name, quantity, price: item.price }];
        });
        setAddingItem(null);
    };

    const handleUpdateItem = (itemId, field, value) => {
        setQuoteItems(currentItems =>
            currentItems.map(item => {
                if (item.id === itemId) {
                    const newValue = field === 'quantity' ? parseInt(value, 10) || 0 : parseFloat(value) || 0;
                    return { ...item, [field]: newValue };
                }
                return item;
            })
        );
    };

    const handleRequestRemoveItem = (itemToRemove) => setRemovingItem(itemToRemove);
    const handleConfirmRemoveItem = () => {
        if (!removingItem) return;
        setQuoteItems(currentItems => currentItems.filter(item => item.id !== removingItem.id));
        setRemovingItem(null);
    };

    // --- VIRTUAL INVENTORY: PRICING UPDATE ---
    const handleSourcedPriceUpdate = (itemId, costPriceGhs) => {
        const margin = 32; // 32% Margin
        const cost = parseFloat(costPriceGhs) || 0;

        // Selling Price is always calculated in Base Currency (GHS)
        const sellingPriceGhs = cost * (1 + (margin / 100));

        setQuoteItems(currentItems =>
            currentItems.map(item => {
                if (item.id === itemId) {
                    return {
                        ...item,
                        costPrice: cost,         // Store Base Cost (GHS)
                        price: sellingPriceGhs,  // Store Base Sell (GHS)
                        finalPrice: sellingPriceGhs
                    };
                }
                return item;
            })
        );
    };



    const handleApproval = async (newStatus) => {
        try {
            if (newStatus === 'Approved' && !selectedSignature) {
                setNotification({ type: 'error', message: 'Please select a signature before approving the invoice.' });
                return;
            }

            // Sourcing gate — a quote whose procurement isn't finished yet
            // still carries placeholder prices; approving it would sign off
            // a total that isn't real. Block approval until sourcing
            // completes (the RFQ award pushes the real cost back and flips
            // sourcingStatus to COMPLETE). Rejection stays allowed.
            if (newStatus === 'Approved' && sourcingBlocksApproval) {
                setNotification({
                    type: 'error',
                    message: 'This quote has items still being sourced by procurement. It can be approved only once sourcing is complete and the RFQ has been awarded.'
                });
                return;
            }

            const updateData = {
                status: newStatus,
                lineItems: quoteItems.map(item => ({
                    id: item.id,
                    description: item.name,
                    quantity: item.quantity,
                    unitPrice: item.finalPrice || item.price,
                    totalPrice: (item.finalPrice || item.price) * item.quantity
                })),
                subtotal: totals.subtotal,
                total: totals.grandTotal,
                orderCharges: orderCharges,
                taxBreakdown: taxes,
                currency: currency,
                exchangeRate: fxRateGhsPerUsd || invoice?.exchangeRate,
                // Optimistic-concurrency token — backend returns 409 if a
                // different user changed this invoice since we loaded it.
                ...(invoice?.rowVersion !== undefined ? { rowVersion: invoice.rowVersion } : {})
            };

            if (newStatus === 'Approved' && selectedSignature) {
                updateData.signatureData = JSON.stringify({
                    signatureUrl: selectedSignature.signatureUrl,
                    controllerName: selectedSignature.controllerName,
                    subsidiary: selectedSignature.subsidiary,
                    timestamp: new Date().toISOString()
                });
            }

            // Persist the status change. The server now decrements
            // inventory atomically inside the same transaction (see
            // backend/routes/invoices.js PUT) — sourced / custom items
            // that aren't in QA_INVENTORY are skipped server-side, and
            // any real SKU that lacks stock fails the whole approval
            // with code:'INSUFFICIENT_STOCK' (surfaced by the catch).
            //
            // The old client-side GET-then-PUT inventory loop that
            // followed this call was a lost-update race — two
            // concurrent approvals for the same SKU both read the same
            // stock value and both wrote it back. Removing it kills
            // the race; doing it in one transaction also removes the
            // "approved invoice but stock wasn't deducted" half-state
            // that crashes on a stray sourced line.
            await api.put(`/invoices/${invoiceId}`, updateData);

            await logActivity(userId, newStatus === 'Approved' ? 'Approved' : 'Rejected', `Invoice: ${invoice.invoiceNumber}`, {
                statusBefore: invoice.status,
                statusAfter: newStatus,
                totalValue: totals.grandTotal
            });

            setNotification({ type: 'success', message: `Invoice ${invoiceId} has been ${newStatus.toLowerCase()}.` });
            // Return the user to wherever they came from — role-aware, so a
            // finance head goes back to All Invoices, never to a page their
            // role can't open (which is what produced the "access
            // restricted" screen).
            const dest = resolveReturnPage(pageContext, currentUser);
            setTimeout(() => navigateTo(dest), 1500);
        } catch (error) {
            console.error('Approval failed:', error);
            // Surface the server's real reason (e.g. the sourcing gate)
            // rather than the opaque axios "Request failed with status…".
            const serverMsg = error?.response?.data?.error || error?.message || 'Unknown error';
            setNotification({ type: 'error', message: `Failed to ${newStatus.toLowerCase()} invoice: ${serverMsg}` });
        }
    };

    if (isLoading || customersLoading || inventoryLoading) return <div className="p-8 text-center">Loading Invoice Editor...</div>;
    if (!invoice) return <div className="p-8 text-center text-red-500">Could not load invoice data.</div>;
    if (!customers || !inventory) return <div className="p-8 text-center text-red-500">Could not load required data.</div>;

    return (
        <>
            {notification && <Notification message={notification.message} type={notification.type} onDismiss={() => setNotification(null)} />}
            {addingItem && <QuantityModal item={addingItem} onClose={() => setAddingItem(null)} onConfirm={handleAddItem} />}
            {removingItem && <ConfirmationModal title="Confirm Removal" message={`Remove "${removingItem.name}" from the quote?`} onConfirm={handleConfirmRemoveItem} onCancel={() => setRemovingItem(null)} confirmText="Remove" confirmColor="bg-red-600 hover:bg-red-700" />}

            {/* Phase 4 — re-approval banner for variance-flagged invoices */}
            {invoice?.requiresReapproval && (
                <ReApprovalBanner
                    invoice={invoice}
                    canAct={
                        can(currentUser, 'invoice.reapprove') ||
                        invoice?.salesPersonId === currentUser?.email
                    }
                    onDecision={handleReapprovalDecision}
                    submitting={reapprovalSubmitting}
                />
            )}

            <PageHeader
                title={`Edit Invoice #${invoiceId}`}
                subtitle={
                    invoice.sourcingStatus && invoice.sourcingStatus !== 'NONE' ? (
                        <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${
                            invoice.sourcingStatus === 'PENDING'  ? 'bg-amber-100 text-amber-800' :
                            invoice.sourcingStatus === 'PARTIAL'  ? 'bg-blue-100 text-blue-800'   :
                            invoice.sourcingStatus === 'COMPLETE' ? 'bg-green-100 text-green-800' :
                            'bg-gray-100 text-gray-800'
                        }`}>
                            {invoice.sourcingStatus === 'PENDING'  ? 'Awaiting Procurement' :
                             invoice.sourcingStatus === 'PARTIAL'  ? 'Sourcing In Progress' :
                             invoice.sourcingStatus === 'COMPLETE' ? 'Sourcing Complete'    :
                             invoice.sourcingStatus}
                            {invoice.prCount > 0 && ` (${invoice.prCount} PR${invoice.prCount > 1 ? 's' : ''})`}
                        </span>
                    ) : null
                }
                actions={
                    <Button variant="ghost" size="sm" onClick={handleBackNavigation} leftIcon={<Icon id="times" />}>
                        Cancel
                    </Button>
                }
            />

                {sourcingLocked && (
                    <div className="bg-amber-50 border-l-4 border-amber-400 rounded-md p-4 mb-6 text-sm text-amber-800 flex items-start gap-2">
                        <Icon id="lock" className="mt-0.5" />
                        <div>
                            <strong>Quote locked.</strong> Procurement is currently sourcing items on this quote.
                            Line items, quantities, and additions are frozen until sourcing completes
                            (to prevent duplicate purchase requisitions). Contact the controller if an urgent change is needed.
                        </div>
                    </div>
                )}

                {/* Approval is gated until procurement finishes. Shown to
                    everyone (finance can still edit, but nobody can approve
                    a quote whose sourced-item prices aren't final yet). */}
                {sourcingBlocksApproval && (
                    <div className="bg-amber-50 border-l-4 border-amber-400 rounded-md p-4 mb-6 text-sm text-amber-800 flex items-start gap-2">
                        <Icon id="info-circle" className="mt-0.5" />
                        <div>
                            <strong>Approval locked &mdash; sourcing in progress.</strong> This quote has items
                            being sourced by procurement ({invoice?.sourcingStatus === 'PENDING' ? 'awaiting procurement' : 'sourcing in progress'}
                            {invoice?.prCount > 0 ? `, ${invoice.prCount} PR${invoice.prCount > 1 ? 's' : ''}` : ''}).
                            It can be approved only once sourcing is complete and the RFQ has been awarded, so the
                            final prices are reflected here. You can still reject the quote if needed.
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
                    {/* Item Selection */}
                    <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-md">
                        <h2 className="text-xl font-semibold text-gray-700 mb-4">Add Items to Invoice</h2>
                        <input type="text" placeholder="Search inventory..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full pl-4 pr-4 py-2 border rounded-md" />
                        <div className="h-96 mt-4 overflow-y-auto border rounded-md">
                            <table className="w-full text-left">
                                <thead className="bg-gray-50 sticky top-0"><tr><th className="p-3 font-semibold text-sm">Product</th><th className="p-3 font-semibold text-sm text-right">Price</th></tr></thead>
                                <tbody>{filteredInventory.map(item => (<tr key={item.id} onClick={() => !sourcingLocked && setAddingItem(item)} className={`border-b ${sourcingLocked ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-50 cursor-pointer'}`} title={sourcingLocked ? 'Quote is locked while procurement is sourcing.' : ''}><td className="p-3 font-medium">{item.name}</td><td className="p-3 text-right">{formatAmount(item.price)}</td></tr>))}</tbody>
                            </table>
                        </div>
                    </div>

                    {/* Invoice Details */}
                    <div className="lg:col-span-3 bg-white p-6 rounded-xl shadow-md">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-semibold text-gray-700">Invoice Details for: <span className="text-blue-600">{selectedCustomer?.name}</span></h2>
                        </div>

                        {/* Line Items Table */}
                        <div className="h-96 overflow-y-auto border rounded-md mb-4">
                            <table className="w-full text-left">
                                <thead className="bg-gray-50 sticky top-0">
                                    <tr><th className="p-2 font-semibold text-sm">Item</th>
                                    <th className="p-2 font-semibold text-sm">Desc</th>
                                    <th className="p-2 font-semibold text-sm text-center">Qty</th>
                                    <th className="p-2 font-semibold text-sm text-right">Price</th>
                                    <th className="p-2 font-semibold text-sm text-right">Total</th>
                                    <th className="p-2 font-semibold text-sm text-center"></th>
                                    </tr>
                                    </thead>
                                <tbody>{quoteItems.map(item => {
                                    console.log('Rendering item:', item);
                                    const displayPrice = item.finalPrice || item.price || 0;
                                    const itemTotal = displayPrice * (item.quantity || 0);
                                    return (
                                        <tr key={item.id} className="border-b">
                                            <td className="p-2 text-sm font-medium">{item.name} <br/> {item.type === 'sourced' && <div className='text-sm text-blue-400'>({item.description})</div>} </td>
                                            <td className="p-1"><input type="number" value={item.quantity} onChange={e => handleUpdateItem(item.id, 'quantity', e.target.value)} className="w-16 text-center border-gray-300 rounded-md disabled:bg-gray-100 disabled:cursor-not-allowed" min="0" disabled={sourcingLocked} /></td>
                                            <td className="p-1 text-right text-sm font-medium">
                                                {/* Logic: If it is Sourced AND I work the finance desk, allow editing */}
                                                {item.type === 'sourced' && isFinanceController(currentUser?.role) ? (
                                                    <div className="flex flex-col items-end">
                                                        <label className="text-[10px] text-gray-400">Cost (GHS)</label>
                                                        <input
                                                            type="number"
                                                            placeholder="0.00"
                                                            className="w-24 text-right border border-blue-300 rounded px-1 py-0.5 text-sm focus:ring-2 focus:ring-blue-500 bg-blue-50"
                                                            onChange={(e) => handleSourcedPriceUpdate(item.id, e.target.value)}
                                                            defaultValue={item.costPrice || ''}
                                                        />
                                                        <span className="text-xs text-green-600 font-bold mt-1">
                                                            Sell: {formatAmount(item.price)}
                                                        </span>
                                                    </div>
                                                ) : (
                                                    // Sales users or non-sourced items just see the price
                                                    formatAmount(displayPrice)
                                                )}
                                            </td>
                                            <td className="p-2 text-sm text-right font-medium">{formatAmount(itemTotal)}</td>
                                            <td className="p-2 text-center"><button onClick={() => handleRequestRemoveItem(item)} disabled={sourcingLocked} className="text-red-500 hover:text-red-700 disabled:text-gray-300 disabled:cursor-not-allowed" title={sourcingLocked ? 'Locked: procurement is sourcing this quote.' : ''}><Icon id="trash-alt" /></button></td>
                                        </tr>
                                    );
                                })}</tbody>
                            </table>
                        </div>

                        {/* Order Level Charges - Controller can edit */}
                        <div className="bg-white rounded-lg shadow p-6 mb-6">
                            <h3 className="text-lg font-semibold mb-4">Order Level Charges</h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Shipping</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={orderCharges.shipping}
                                        onChange={(e) => setOrderCharges(prev => ({
                                            ...prev,
                                            shipping: parseFloat(e.target.value) || 0
                                        }))}
                                        className="block w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Handling</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={orderCharges.handling}
                                        onChange={(e) => setOrderCharges(prev => ({
                                            ...prev,
                                            handling: parseFloat(e.target.value) || 0
                                        }))}
                                        className="block w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Discount</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={orderCharges.discount}
                                        onChange={(e) => setOrderCharges(prev => ({
                                            ...prev,
                                            discount: parseFloat(e.target.value) || 0
                                        }))}
                                        className="block w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    />
                                </div>
                            </div>
                            <div className="mt-4 p-3 bg-gray-50 rounded">
                                <h4 className="text-sm font-medium text-gray-700 mb-2">Order Charges Summary</h4>
                                <div className="space-y-1 text-sm">
                                    <div className="flex justify-between">
                                        <span>Shipping:</span>
                                        <span>{formatAmount(totals.shipping)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>Handling:</span>
                                        <span>{formatAmount(totals.handling)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>Discount:</span>
                                        <span className="text-red-600">-{formatAmount(totals.discount)}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Taxes & Totals */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div>
                                <h3 className="font-semibold mb-2">Taxes & Levies</h3>
                                <div className="space-y-2">
                                    {taxes.map(tax => (
                                        <div key={tax.id} className="flex items-center justify-between text-sm">
                                            <div className="flex items-center">
                                                <input type="checkbox" checked={tax.enabled} onChange={e => handleTaxChange(tax.id, 'enabled', e.target.checked)} className="mr-3 h-4 w-4" />
                                                <span className="font-medium">{tax.name}</span>
                                            </div>
                                            <div>
                                                <input type="number" value={tax.rate} onChange={e => handleTaxChange(tax.id, 'rate', e.target.value)} className="w-16 text-right p-1 border rounded-md" />
                                                <span className="ml-1">%</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="mt-6 pt-4 border-t border-gray-200">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="font-semibold text-gray-700">Currency</span>
                                        <button
                                            onClick={toggleCurrency}
                                            className={`relative inline-flex items-center h-6 w-12 rounded-full transition-colors duration-300 focus:outline-none ${currency === 'USD' ? 'bg-blue-600' : 'bg-gray-400'}`}
                                            title="Toggle Currency"
                                        >
                                            <span
                                                className={`inline-block w-4 h-4 transform bg-white rounded-full transition-transform duration-300 ${currency === 'USD' ? 'translate-x-7' : 'translate-x-1'}`}
                                            />
                                        </button>
                                    </div>
                                    <div className="text-sm text-gray-600 space-y-1">
                                        <div className="flex justify-between">
                                            <span>Selected:</span>
                                            <span className="font-medium">{currency}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span>Rate Period:</span>
                                            <span className="font-medium">{fxMonthKey}</span>
                                        </div>
                                        {currency === 'USD' && (
                                            <div className="flex justify-between text-blue-600">
                                                <span>Exchange Rate:</span>
                                                <span className="font-medium">1 USD = {fxRateGhsPerUsd} GHS</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="border-t md:border-t-0 md:border-l pt-4 md:pt-0 md:pl-4 space-y-2">
                                <div className="flex justify-between text-lg"><span className="font-semibold">GROSS TOTAL</span><span className="font-semibold">{formatAmount(totals.subtotal)}</span></div>
                                <div className="flex justify-between text-sm text-gray-500"><span>Shipping:</span><span>{formatAmount(totals.shipping)}</span></div>
                                <div className="flex justify-between text-sm text-gray-500"><span>Handling:</span><span>{formatAmount(totals.handling)}</span></div>
                                <div className="flex justify-between text-sm text-gray-500"><span>Discount:</span><span className="text-red-600">-{formatAmount(totals.discount)}</span></div>
                                <div className="flex justify-between font-semibold border-t pt-2"><span>Taxable Amount</span><span>{formatAmount(totals.subtotalWithCharges)}</span></div>
                                {taxes.filter(t => t.enabled && t.on === 'subtotal').map(tax => (<div key={tax.id} className="flex justify-between text-sm text-gray-500"><span>{tax.name} ({tax.rate}%)</span><span>{formatAmount(totals[tax.id] || 0)}</span></div>))}
                                <div className="flex justify-between font-semibold border-t pt-2"><span>Subtotal (Before VAT)</span><span>{formatAmount(totals.levyTotal)}</span></div>
                                {taxes.filter(t => t.enabled && t.on === 'levyTotal').map(tax => (<div key={tax.id} className="flex justify-between text-sm text-gray-500"><span>{tax.name} ({tax.rate}%)</span><span>{formatAmount(totals[tax.id] || 0)}</span></div>))}
                                <div className="flex justify-between text-xl font-bold border-t pt-2 mt-2"><span>Total Amount Payable</span><span>{formatAmount(totals.grandTotal)}</span></div>
                            </div>
                        </div>

                        {/* Signature Selection for Approval */}
                        <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
                            <h3 className="text-lg font-medium text-blue-800 mb-3">Digital Signature for Approval</h3>
                            {signaturesLoading ? (
                                <div className="text-center py-4">
                                    <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                                    <p className="mt-2 text-sm text-blue-600">Loading signatures...</p>
                                </div>
                            ) : signatures.length === 0 ? (
                                <div className="text-center py-4 text-blue-600">
                                    <p className="text-sm">No signatures configured.</p>
                                    <p className="text-xs">Please add signatures in System Settings first.</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <label className="block text-sm font-medium text-blue-700">
                                        Select Controller Signature:
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
                                        <div className="flex items-center space-x-4 p-3 bg-white rounded border">
                                            <div className="flex-shrink-0">
                                                <img
                                                    src={selectedSignature.signatureUrl}
                                                    alt={`${selectedSignature.controllerName}'s signature`}
                                                    className="h-12 w-auto object-contain border rounded"
                                                />
                                            </div>
                                            <div className="flex-1">
                                                <p className="font-medium text-gray-800">{selectedSignature.controllerName}</p>
                                                <p className="text-sm text-gray-600">{selectedSignature.subsidiary}</p>
                                            </div>
                                            <div className="text-xs text-gray-500">
                                                Selected for approval
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Action Buttons */}
                        <div className="mt-6 flex justify-end space-x-4">
                            {/* If Draft, show Submit for Approval. If Pending Approval, show Approve/Reject */}
                            {(invoice?.status === 'Draft' || !invoice?.status) ? (
                                <button
                                    onClick={() => handleApproval('Pending Approval')}
                                    className="py-2 px-6 text-white bg-blue-600 rounded-md font-semibold hover:bg-blue-700"
                                >
                                    Submit for Approval
                                </button>
                            ) : (
                                <>
                                    <button
                                        onClick={() => handleApproval('Rejected')}
                                        className="py-2 px-6 text-white bg-red-600 rounded-md font-semibold hover:bg-red-700"
                                    >
                                        Reject Invoice
                                    </button>
                                    <button
                                        onClick={() => handleApproval('Approved')}
                                        disabled={!selectedSignature || sourcingBlocksApproval}
                                        className={`py-2 px-6 text-white rounded-md font-semibold ${selectedSignature && !sourcingBlocksApproval
                                            ? 'bg-green-600 hover:bg-green-700'
                                            : 'bg-gray-400 cursor-not-allowed'
                                            }`}
                                        title={
                                            sourcingBlocksApproval
                                                ? 'Procurement is still sourcing this quote — approval unlocks once the RFQ is awarded.'
                                                : selectedSignature
                                                    ? 'Approve with selected signature'
                                                    : 'Please select a signature first'
                                        }
                                    >
                                        {sourcingBlocksApproval
                                            ? 'Awaiting Sourcing'
                                            : selectedSignature
                                                ? 'Save & Approve'
                                                : 'Select Signature First'}
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
        </>
    );
};

export default InvoiceEditor;
