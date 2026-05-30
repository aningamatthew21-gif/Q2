import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
// Module 2 — Collections integration
import LogPaymentModal from '../components/modals/LogPaymentModal';
import LogCollectionActionModal from '../components/modals/LogCollectionActionModal';
import { usePrompt } from '../components/v2/PromptDialog';
import { logActivity } from '../utils/logger';
import { isFinanceController, resolveReturnPage } from '../utils/roles';
import { can } from '../utils/permissions';
import {
    INVOICE_STATUS,
    INVOICE_TRANSITIONS,
    isInvoiceTerminal,
    areInvoiceEditsFrozen
} from '../../shared/statuses';

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
    // Module 2 — Collections modals + payment ledger
    const [payments, setPayments] = useState([]);
    const [paymentsLoading, setPaymentsLoading] = useState(false);
    const [openLogPayment, setOpenLogPayment]   = useState(false);
    const [openLogAction, setOpenLogAction]     = useState(false);
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

    // Module 2 — Load payment ledger for this invoice. Re-runs whenever the
    // payments:updated socket fires elsewhere (LogPaymentModal, Collections
    // Workbench) so the ledger stays in sync without manual refresh.
    const fetchPayments = useCallback(async () => {
        if (!invoiceId) return;
        setPaymentsLoading(true);
        try {
            const res = await api.get('/collections/payments', { params: { invoiceId, includeReversed: 'true' } });
            if (res?.success) setPayments(res.data || []);
        } catch (_e) {
            // Quietly leave payments empty — the page still works without ledger
        } finally {
            setPaymentsLoading(false);
        }
    }, [invoiceId]);

    useEffect(() => { fetchPayments(); }, [fetchPayments]);

    // Module 2 — Reverse a logged payment. Officer can do it within 24h
    // (server enforces); head can do it any time. Asks for a reason via
    // the v2 prompt dialog — required by the backend.
    const { askText } = usePrompt();
    const handleReversePayment = async (payment) => {
        const reason = await askText({
            title:        `Reverse receipt ${payment.receiptNumber || `#${payment.id}`}?`,
            description:  'This marks the payment as REVERSED, restores the invoice balance, and is permanent. A reason is required for the audit trail.',
            label:        'Reason for reversal',
            placeholder:  'e.g. duplicate entry, cheque bounced, wrong invoice',
            multiline:    true,
            maxLength:    500,
            confirmLabel: 'Reverse payment',
            confirmTone:  'danger',
            cancelLabel:  'Keep payment'
        });
        if (reason === null) return; // user cancelled
        try {
            const res = await api.post(`/collections/payments/${payment.id}/reverse`, { reason: String(reason).trim() });
            if (res?.success) {
                setNotification({ type: 'success', message: `Receipt ${payment.receiptNumber || `#${payment.id}`} reversed.` });
                fetchPayments();
            } else {
                setNotification({ type: 'error', message: res?.error || 'Could not reverse payment.' });
            }
        } catch (err) {
            const status = err?.response?.status;
            const msg    = err?.response?.data?.error || err?.message || 'Unknown error';
            // 422 is the 24h-window block — surface the server's clear message verbatim
            setNotification({
                type: 'error',
                message: status === 422 ? msg : `Failed to reverse${status ? ` (${status})` : ''}: ${msg}`
            });
        }
    };

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
                // Aggregate tax amount (used by the TAXES column for fast
                // reporting roll-ups — the per-tax detail lives in
                // taxBreakdown). Sent so the backend doesn't have to
                // re-derive it from total - subtotal - charges.
                taxesTotal: Math.max(0, (totals.grandTotal || 0) - (totals.subtotalWithCharges || totals.subtotal || 0)),
                orderCharges: orderCharges,
                taxBreakdown: taxes,
                currency: currency,
                exchangeRate: fxRateGhsPerUsd || invoice?.exchangeRate,
                // Module 1 — include DUE_DATE if user edited it in the
                // metadata strip. Backend mapping converts the string to a
                // JS Date for the DATE column.
                ...(invoice?.dueDate ? { dueDate: invoice.dueDate } : {}),
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

                {/*
                  ── EDITS-FROZEN BANNER + UNIFIED LOCK FLAG ────────────────
                  Standards anchor: ISO/IEC 27001:2022 A.8.32 + ISO/IEC
                  25010 Reliability. Once an invoice is Approved or later,
                  the numbers the approver signed off on (and the customer
                  is reviewing) must be immutable. The flag `editsFrozen`
                  is consulted on every editable input below. The matching
                  backend gate in routes/invoices.js PUT handler is the
                  security net — this banner + disabled state is the UX.
                */}
                {(() => {
                    const editsFrozen = areInvoiceEditsFrozen(invoice?.status);
                    if (!editsFrozen) return null;
                    return (
                        <div className="bg-gray-100 border-l-4 border-gray-500 rounded-md p-4 mb-6 text-sm text-gray-800 flex items-start gap-2">
                            <Icon id="lock" className="mt-0.5" />
                            <div>
                                <strong>Invoice frozen ({invoice?.status}).</strong> Line items, quantities,
                                taxes, and order-level charges cannot be edited at this stage — they
                                were committed when the invoice was approved and must match the
                                document the customer received. To correct an error, use the
                                reversal / credit-memo workflow (planned future feature) or ask an
                                admin to soft-delete and re-issue.
                            </div>
                        </div>
                    );
                })()}

                <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
                    {/* Item Selection — locked when invoice is frozen (Approved+) OR
                        when procurement is sourcing. Both flags converge into
                        `addItemsLocked` so the disabled state covers both cases
                        with one specific tooltip message. */}
                    {(() => {
                        const editsFrozen = areInvoiceEditsFrozen(invoice?.status);
                        const addItemsLocked = sourcingLocked || editsFrozen;
                        const lockReason = editsFrozen
                            ? `Invoice is ${invoice?.status} — items are frozen.`
                            : sourcingLocked
                                ? 'Quote is locked while procurement is sourcing.'
                                : '';
                        return (
                            <div className={`lg:col-span-2 bg-white p-6 rounded-xl shadow-md ${addItemsLocked ? 'opacity-75' : ''}`}>
                                <h2 className="text-xl font-semibold text-gray-700 mb-4">
                                    Add Items to Invoice
                                    {addItemsLocked && <span className="ml-2 text-xs text-gray-500 font-normal">(locked)</span>}
                                </h2>
                                <input
                                    type="text"
                                    placeholder="Search inventory..."
                                    value={searchTerm}
                                    onChange={e => setSearchTerm(e.target.value)}
                                    disabled={addItemsLocked}
                                    title={lockReason}
                                    className="w-full pl-4 pr-4 py-2 border rounded-md disabled:bg-gray-100 disabled:cursor-not-allowed"
                                />
                                <div className="h-96 mt-4 overflow-y-auto border rounded-md">
                                    <table className="w-full text-left">
                                        <thead className="bg-gray-50 sticky top-0"><tr><th className="p-3 font-semibold text-sm">Product</th><th className="p-3 font-semibold text-sm text-right">Price</th></tr></thead>
                                        <tbody>{filteredInventory.map(item => (
                                            <tr
                                                key={item.id}
                                                onClick={() => !addItemsLocked && setAddingItem(item)}
                                                className={`border-b ${addItemsLocked ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-50 cursor-pointer'}`}
                                                title={addItemsLocked ? lockReason : ''}
                                            >
                                                <td className="p-3 font-medium">{item.name}</td>
                                                <td className="p-3 text-right">{formatAmount(item.price)}</td>
                                            </tr>
                                        ))}</tbody>
                                    </table>
                                </div>
                            </div>
                        );
                    })()}

                    {/* Invoice Details */}
                    <div className="lg:col-span-3 bg-white p-6 rounded-xl shadow-md">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-semibold text-gray-700">Invoice Details for: <span className="text-blue-600">{selectedCustomer?.name}</span></h2>
                        </div>

                        {/* Module 1 — Invoice metadata strip (date / due date /
                            payment terms). DUE_DATE is editable while the
                            invoice is still in pricing-pending; once it
                            moves past that into Approved or later, the field
                            renders read-only because the customer-facing
                            snapshot is locked. Mirrors how taxBreakdown is
                            handled by the FINALIZED_STATUSES list. */}
                        {(() => {
                            const FINALIZED = new Set(['Approved','Sent','Customer Accepted','Customer Rejected','Paid','Partially Paid','Cancelled','Closed']);
                            const isLocked = FINALIZED.has(invoice?.status);
                            const dueDateValue = invoice?.dueDate
                                ? new Date(invoice.dueDate).toISOString().slice(0, 10)
                                : '';
                            const invoiceDateDisplay = invoice?.invoiceDate || invoice?.date || '—';
                            return (
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4 p-3 bg-gray-50 rounded-md border border-gray-200">
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Invoice Date</label>
                                        <div className="mt-1 text-sm font-medium text-gray-800">
                                            {invoiceDateDisplay && invoiceDateDisplay !== '—'
                                                ? new Date(invoiceDateDisplay).toLocaleDateString()
                                                : '—'}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Payment Terms</label>
                                        <div className="mt-1 text-sm font-medium text-gray-800">
                                            {invoice?.paymentTerms || 'Net 30'}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">
                                            Due Date {isLocked ? '(locked)' : ''}
                                        </label>
                                        {isLocked ? (
                                            <div className="mt-1 text-sm font-medium text-gray-800">
                                                {dueDateValue ? new Date(dueDateValue).toLocaleDateString() : '—'}
                                            </div>
                                        ) : (
                                            <input
                                                type="date"
                                                value={dueDateValue}
                                                onChange={(e) => setInvoice(prev => ({ ...prev, dueDate: e.target.value }))}
                                                className="mt-1 w-full text-sm p-1 border border-gray-300 rounded"
                                                title="Editable while invoice is still in pricing/approval; locks after sent to customer"
                                            />
                                        )}
                                    </div>
                                </div>
                            );
                        })()}

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
                                            <td className="p-1"><input
                                                type="number"
                                                value={item.quantity}
                                                onChange={e => handleUpdateItem(item.id, 'quantity', e.target.value)}
                                                className="w-16 text-center border-gray-300 rounded-md disabled:bg-gray-100 disabled:cursor-not-allowed"
                                                min="0"
                                                disabled={sourcingLocked || areInvoiceEditsFrozen(invoice?.status)}
                                                title={areInvoiceEditsFrozen(invoice?.status) ? `Invoice is ${invoice?.status} — quantity is frozen.` : sourcingLocked ? 'Quote is locked while procurement is sourcing.' : ''}
                                            /></td>
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
                                            <td className="p-2 text-center"><button
                                                onClick={() => handleRequestRemoveItem(item)}
                                                disabled={sourcingLocked || areInvoiceEditsFrozen(invoice?.status)}
                                                className="text-red-500 hover:text-red-700 disabled:text-gray-300 disabled:cursor-not-allowed"
                                                title={areInvoiceEditsFrozen(invoice?.status) ? `Invoice is ${invoice?.status} — line items are frozen.` : sourcingLocked ? 'Locked: procurement is sourcing this quote.' : ''}
                                            ><Icon id="trash-alt" /></button></td>
                                        </tr>
                                    );
                                })}</tbody>
                            </table>
                        </div>

                        {/* Order Level Charges - Controller can edit */}
                        <div className="bg-white rounded-lg shadow p-6 mb-6">
                            <h3 className="text-lg font-semibold mb-4">Order Level Charges</h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {/* Order-level charges — locked when invoice is frozen.
                                    The locked title attribute tells the user why. */}
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
                                        disabled={areInvoiceEditsFrozen(invoice?.status)}
                                        title={areInvoiceEditsFrozen(invoice?.status) ? `Invoice is ${invoice?.status} — order charges are frozen.` : ''}
                                        className="block w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
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
                                        disabled={areInvoiceEditsFrozen(invoice?.status)}
                                        title={areInvoiceEditsFrozen(invoice?.status) ? `Invoice is ${invoice?.status} — order charges are frozen.` : ''}
                                        className="block w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
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
                                        disabled={areInvoiceEditsFrozen(invoice?.status)}
                                        title={areInvoiceEditsFrozen(invoice?.status) ? `Invoice is ${invoice?.status} — order charges are frozen.` : ''}
                                        className="block w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
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
                                    {taxes.map(tax => {
                                        const taxLocked = areInvoiceEditsFrozen(invoice?.status);
                                        const taxLockTitle = taxLocked ? `Invoice is ${invoice?.status} — taxes and rates are frozen.` : '';
                                        return (
                                            <div key={tax.id} className="flex items-center justify-between text-sm">
                                                <div className="flex items-center">
                                                    <input
                                                        type="checkbox"
                                                        checked={tax.enabled}
                                                        onChange={e => handleTaxChange(tax.id, 'enabled', e.target.checked)}
                                                        disabled={taxLocked}
                                                        title={taxLockTitle}
                                                        className="mr-3 h-4 w-4 disabled:cursor-not-allowed"
                                                    />
                                                    <span className={`font-medium ${taxLocked ? 'text-gray-500' : ''}`}>{tax.name}</span>
                                                </div>
                                                <div>
                                                    <input
                                                        type="number"
                                                        value={tax.rate}
                                                        onChange={e => handleTaxChange(tax.id, 'rate', e.target.value)}
                                                        disabled={taxLocked}
                                                        title={taxLockTitle}
                                                        className="w-16 text-right p-1 border rounded-md disabled:bg-gray-100 disabled:cursor-not-allowed"
                                                    />
                                                    <span className="ml-1">%</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                <div className="mt-6 pt-4 border-t border-gray-200">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="font-semibold text-gray-700">Currency</span>
                                        <button
                                            onClick={toggleCurrency}
                                            disabled={areInvoiceEditsFrozen(invoice?.status)}
                                            className={`relative inline-flex items-center h-6 w-12 rounded-full transition-colors duration-300 focus:outline-none ${
                                                areInvoiceEditsFrozen(invoice?.status)
                                                    ? 'bg-gray-300 cursor-not-allowed opacity-60'
                                                    : currency === 'USD' ? 'bg-blue-600' : 'bg-gray-400'
                                            }`}
                                            title={areInvoiceEditsFrozen(invoice?.status) ? `Invoice is ${invoice?.status} — currency is frozen.` : 'Toggle Currency'}
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

                        {/* Module 2 — Payments ledger + Log Payment button.
                            Renders for every invoice. The confirmed payments
                            sum + WHT total feed the running balance shown on
                            the right; reversed payments are visually struck-
                            through. Log Payment button is gated by the new
                            payment.log permission so officers without it
                            (e.g. sales) see the ledger but can't write to it. */}
                        <div className="mt-6 bg-white border border-gray-200 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-lg font-medium text-gray-800">
                                    Payments &amp; Collections
                                </h3>
                                <div className="flex gap-2">
                                    {can(currentUser, 'collections.action.log') && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setOpenLogAction(true)}
                                            leftIcon={<Icon id="phone" />}
                                        >
                                            Log Follow-up
                                        </Button>
                                    )}
                                    {(() => {
                                        // Hide Log Payment when invoice is fully paid (balance ≤ 0)
                                        // or status isn't payment-eligible. Mirrors the server gate
                                        // so users don't see a button that would 422 on submit.
                                        const eligibleStatuses = new Set([
                                            'Awaiting Acceptance', 'Customer Accepted', 'Partially Paid', 'Paid'
                                        ]);
                                        const confirmedPayments = payments.filter(p => !p.status || p.status === 'CONFIRMED');
                                        const paidSum   = confirmedPayments.reduce((s, p) => s + Number(p.amount || 0) + Number(p.whtTotal || 0), 0);
                                        const balance   = Math.max(0, Number(invoice?.total || 0) - paidSum);
                                        const canLogNow = can(currentUser, 'payment.log')
                                            && eligibleStatuses.has(invoice?.status)
                                            && balance > 0.01;
                                        if (!canLogNow) return null;
                                        return (
                                            <Button
                                                variant="primary"
                                                size="sm"
                                                onClick={() => setOpenLogPayment(true)}
                                                leftIcon={<Icon id="plus" />}
                                            >
                                                Log Payment
                                            </Button>
                                        );
                                    })()}
                                </div>
                            </div>

                            {(() => {
                                const confirmed = payments.filter(p => !p.status || p.status === 'CONFIRMED');
                                const paidSum   = confirmed.reduce((s, p) => s + Number(p.amount || 0), 0);
                                const whtSum    = confirmed.reduce((s, p) => s + Number(p.whtTotal || 0), 0);
                                const effective = paidSum + whtSum;
                                const total     = Number(invoice?.total || 0);
                                const balance   = Math.max(0, total - effective);
                                const dueDate   = invoice?.dueDate ? new Date(invoice.dueDate) : null;
                                const overdue   = balance > 0 && dueDate && !isNaN(dueDate.getTime())
                                    ? Math.floor((Date.now() - dueDate.getTime()) / (1000 * 60 * 60 * 24))
                                    : 0;

                                return (
                                    <>
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                                            <div className="p-2 bg-gray-50 rounded">
                                                <div className="text-xs text-gray-500 uppercase">Invoice Total</div>
                                                <div className="text-sm font-semibold">{formatAmount(total)}</div>
                                            </div>
                                            <div className="p-2 bg-emerald-50 rounded">
                                                <div className="text-xs text-emerald-700 uppercase">Cash Received</div>
                                                <div className="text-sm font-semibold text-emerald-800">{formatAmount(paidSum)}</div>
                                            </div>
                                            <div className="p-2 bg-blue-50 rounded">
                                                <div className="text-xs text-blue-700 uppercase">WHT Captured</div>
                                                <div className="text-sm font-semibold text-blue-800">{formatAmount(whtSum)}</div>
                                            </div>
                                            <div className={`p-2 rounded ${balance > 0 ? (overdue > 0 ? 'bg-red-50' : 'bg-amber-50') : 'bg-emerald-50'}`}>
                                                <div className={`text-xs uppercase ${balance > 0 ? (overdue > 0 ? 'text-red-700' : 'text-amber-700') : 'text-emerald-700'}`}>Outstanding</div>
                                                <div className={`text-sm font-semibold ${balance > 0 ? (overdue > 0 ? 'text-red-800' : 'text-amber-800') : 'text-emerald-800'}`}>
                                                    {formatAmount(balance)}
                                                    {overdue > 0 && <span className="ml-1 text-xs">({overdue}d late)</span>}
                                                </div>
                                            </div>
                                        </div>

                                        {paymentsLoading ? (
                                            <div className="text-center py-4 text-sm text-gray-500">Loading payments…</div>
                                        ) : payments.length === 0 ? (
                                            <div className="text-center py-4 text-sm text-gray-500 italic">
                                                No payments logged yet for this invoice.
                                            </div>
                                        ) : (
                                            <div className="overflow-x-auto">
                                                <table className="min-w-full text-sm">
                                                    <thead className="bg-gray-50 text-xs text-gray-600 uppercase">
                                                        <tr>
                                                            <th className="px-2 py-1 text-left">Receipt</th>
                                                            <th className="px-2 py-1 text-left">Date</th>
                                                            <th className="px-2 py-1 text-right">Amount</th>
                                                            <th className="px-2 py-1 text-right">WHT</th>
                                                            <th className="px-2 py-1 text-left">Method</th>
                                                            <th className="px-2 py-1 text-left">By</th>
                                                            <th className="px-2 py-1 text-left">Status</th>
                                                            <th className="px-2 py-1 text-right"></th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-gray-100">
                                                        {payments.map(p => {
                                                            const isReversed = p.status === 'REVERSED';
                                                            return (
                                                                <tr key={p.id} className={isReversed ? 'opacity-60' : ''}>
                                                                    <td className={`px-2 py-1 font-mono text-xs ${isReversed ? 'line-through' : ''}`}>{p.receiptNumber || `PAY-${p.id}`}</td>
                                                                    <td className={`px-2 py-1 ${isReversed ? 'line-through' : ''}`}>{p.paymentDate ? new Date(p.paymentDate).toLocaleDateString() : '—'}</td>
                                                                    <td className={`px-2 py-1 text-right font-mono ${isReversed ? 'line-through' : ''}`}>{formatAmount(p.amount)}</td>
                                                                    <td className={`px-2 py-1 text-right font-mono text-gray-600 ${isReversed ? 'line-through' : ''}`}>{p.whtTotal > 0 ? formatAmount(p.whtTotal) : '—'}</td>
                                                                    <td className={`px-2 py-1 text-gray-700 ${isReversed ? 'line-through' : ''}`}>{p.paymentMethod}</td>
                                                                    <td className="px-2 py-1 text-gray-500">{(p.loggedBy || '').split('@')[0]}</td>
                                                                    <td className="px-2 py-1">
                                                                        <span
                                                                            className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase ${
                                                                                isReversed ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                                                                            }`}
                                                                            title={isReversed ? `Reversed by ${p.reversedBy || ''}: ${p.reversalReason || ''}` : ''}
                                                                        >
                                                                            {p.status || 'Confirmed'}
                                                                        </span>
                                                                    </td>
                                                                    <td className="px-2 py-1 text-right">
                                                                        {/* Module 2 — Reverse action (gated by
                                                                            permission and confirmed status). Officer's
                                                                            24h window is enforced server-side; UI just
                                                                            shows the button universally so officers don't
                                                                            have to know the rule (server's 422 message
                                                                            explains if blocked). */}
                                                                        {!isReversed && can(currentUser, 'payment.reverse') && (
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => handleReversePayment(p)}
                                                                                className="text-xs text-red-600 hover:underline"
                                                                                title="Reverse this payment"
                                                                            >
                                                                                Reverse
                                                                            </button>
                                                                        )}
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </>
                                );
                            })()}
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

                        {/* ── Action Buttons (matrix-driven) ──────────────
                            Standards anchor: ISO/IEC 27001:2022 A.5.3 + A.8.32,
                            ISO/IEC 25010 Reliability — Maturity.

                            Three independent computed flags drive what renders:
                              • isTerminal      — Paid/Rejected/Customer Rejected/
                                                  Cancelled. Locked banner; NO actions.
                              • isCustomerStage — Awaiting Acceptance. Customer's
                                                  decision OR sales recording on
                                                  behalf (gated by invoice.customer_action
                                                  permission + SoD bypass).
                              • allowedNext     — array of next-states from the
                                                  shared TRANSITION_MATRIX. Decides
                                                  which Approve/Reject/Submit buttons
                                                  may even render.

                            Backend enforces the same matrix at the API layer
                            (routes/invoices.js PUT handler), so the UI hidden
                            state is a UX layer, not a security layer. */}
                        {(() => {
                            const status        = invoice?.status;
                            const isTerminal    = isInvoiceTerminal(status);
                            const isCustomerStg = status === INVOICE_STATUS.AWAITING_ACCEPTANCE;
                            const isDraft       = !status || status === INVOICE_STATUS.DRAFT;
                            const allowedNext   = INVOICE_TRANSITIONS[status] || [];
                            const canApprove    = allowedNext.includes(INVOICE_STATUS.APPROVED);
                            const canReject     = allowedNext.includes(INVOICE_STATUS.REJECTED);
                            // Permission gate for the "on-behalf" customer-action
                            // flow. The same SoD rule (actor ≠ sentBy unless
                            // admin/finance_head) we already shipped applies.
                            const canCustomerAction = can(currentUser, 'invoice.customer_action')
                                                   || currentUser?.role === 'admin';

                            // 1. Terminal — locked banner, no actions
                            if (isTerminal) {
                                return (
                                    <div className="mt-6 p-4 bg-gray-100 border border-gray-300 rounded-md flex items-center gap-3">
                                        <Icon id="lock" className="text-gray-500 flex-shrink-0" />
                                        <div className="flex-1">
                                            <div className="font-semibold text-gray-800">This invoice is finalized ({status})</div>
                                            <div className="text-sm text-gray-600 mt-0.5">
                                                No further status changes can be made. If a correction is needed,
                                                a reversal / credit-memo workflow (planned as a future feature) will
                                                be required. In the interim, an admin can soft-delete and re-issue.
                                            </div>
                                        </div>
                                    </div>
                                );
                            }

                            // 2. Awaiting Acceptance — customer-action buttons
                            if (isCustomerStg) {
                                return (
                                    <div className="mt-6 flex flex-col gap-3">
                                        <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-900">
                                            <Icon id="clock" className="inline mr-1.5" />
                                            This invoice has been sent to the customer and is awaiting their decision.
                                            You may record their response on their behalf below (e.g. if they confirm by phone or email).
                                        </div>
                                        <div className="flex justify-end space-x-4">
                                            <button
                                                onClick={() => handleApproval('Customer Rejected')}
                                                disabled={!canCustomerAction}
                                                title={!canCustomerAction ? 'You do not have permission to record customer decisions on behalf.' : 'Record that the customer rejected this invoice.'}
                                                className={`py-2 px-6 text-white rounded-md font-semibold ${canCustomerAction ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-400 cursor-not-allowed'}`}
                                            >
                                                Mark Customer Rejected
                                            </button>
                                            <button
                                                onClick={() => handleApproval('Customer Accepted')}
                                                disabled={!canCustomerAction}
                                                title={!canCustomerAction ? 'You do not have permission to record customer decisions on behalf.' : 'Record that the customer accepted this invoice.'}
                                                className={`py-2 px-6 text-white rounded-md font-semibold ${canCustomerAction ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-gray-400 cursor-not-allowed'}`}
                                            >
                                                Mark Customer Accepted
                                            </button>
                                        </div>
                                    </div>
                                );
                            }

                            // 3. Draft — Submit for Approval
                            if (isDraft) {
                                return (
                                    <div className="mt-6 flex justify-end space-x-4">
                                        <button
                                            onClick={() => handleApproval('Pending Approval')}
                                            className="py-2 px-6 text-white bg-blue-600 rounded-md font-semibold hover:bg-blue-700"
                                        >
                                            Submit for Approval
                                        </button>
                                    </div>
                                );
                            }

                            // 4. Pending Pricing / Pending Approval — internal decision
                            //    Show only the buttons the matrix permits. This is
                            //    the fix for the original bug: an Approved invoice
                            //    will fall through to (5) below with no buttons,
                            //    because allowedNext = [Awaiting Acceptance,
                            //    Pending Approval, Cancelled] — no Reject, no
                            //    Approve.
                            if (canApprove || canReject) {
                                return (
                                    <div className="mt-6 flex justify-end space-x-4">
                                        {canReject && (
                                            <button
                                                onClick={() => handleApproval('Rejected')}
                                                className="py-2 px-6 text-white bg-red-600 rounded-md font-semibold hover:bg-red-700"
                                            >
                                                Reject Invoice
                                            </button>
                                        )}
                                        {canApprove && (
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
                                        )}
                                    </div>
                                );
                            }

                            // 5. Approved (or any other matrix entry whose
                            //    only permitted nexts are "send to customer"
                            //    or "cancel") — no buttons here. The Send
                            //    action lives on the Invoices workspace.
                            return (
                                <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-md flex items-center gap-3">
                                    <Icon id="check-circle" className="text-blue-600 flex-shrink-0" />
                                    <div className="flex-1">
                                        <div className="font-semibold text-blue-900">Invoice is {status}</div>
                                        <div className="text-sm text-blue-800 mt-0.5">
                                            {status === INVOICE_STATUS.APPROVED
                                                ? 'This invoice is approved and ready to be sent to the customer from the Invoices workspace.'
                                                : 'No further decisions are required from this screen.'}
                                        </div>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                </div>

                {/* Module 2 — Collections modals mounted at root of the
                    fragment so they overlay the whole page when open. */}
                <LogPaymentModal
                    open={openLogPayment}
                    onClose={() => setOpenLogPayment(false)}
                    invoice={invoice}
                    onLogged={() => { setOpenLogPayment(false); fetchPayments(); }}
                />
                <LogCollectionActionModal
                    open={openLogAction}
                    onClose={() => setOpenLogAction(false)}
                    invoiceId={invoice?.id}
                    invoiceNumber={invoice?.invoiceNumber}
                    onLogged={() => { setOpenLogAction(false); }}
                />
        </>
    );
};

export default InvoiceEditor;
