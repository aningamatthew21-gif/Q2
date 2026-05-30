import React, { useState, useEffect, useMemo } from 'react';
import api from '../api';
import Icon from '../components/common/Icon';
import { useRealtimeInvoices } from '../hooks/useRealtimeInvoices';
import PreviewModal from '../components/PreviewModal';
import PageHeader from '../components/common/PageHeader';
import Button from '../components/common/Button';
import Notification from '../components/common/Notification';

import { useActivityLog } from '../hooks/useActivityLog';
import { SortableHeader, useSortable } from '../components/v2';
import { getInvoiceDate } from '../utils/helpers';
import { usePrompt } from '../components/v2/PromptDialog';
// Module 4 — controlled lost-deal / won-deal vocabulary
import RejectWithReasonModal from '../components/modals/RejectWithReasonModal';

const MyInvoices = ({ navigateTo, userId, pageContext }) => {
    const { log } = useActivityLog();
    const { askText, askConfirm } = usePrompt();
    const [previewData, setPreviewData] = useState(null);
    // Toast for transient errors — replaces the previous browser alert()s
    // which broke the Fluent 2 visual language and blocked the page.
    const [notification, setNotification] = useState(null);
    // Module 4 — invoice being "Customer Rejected" via the controlled
    // lost-deal modal. Holds the invoice object so the modal's onSubmit
    // can run the existing two-phase reject + inventory-restore flow.
    const [rejectingInvoice, setRejectingInvoice] = useState(null);

    // M7 — read filter state from URL on mount so browser reload / shared link keeps it
    const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
    const initialTabFromUrl = urlParams.get('tab');
    const initialYearFromUrl = urlParams.get('year');
    const initialMonthFromUrl = urlParams.get('month');

    const [activeTab, setActiveTab] = useState(() => {
        if (initialTabFromUrl) return initialTabFromUrl;
        // Deep-link from dashboard clicks — map status to tab key
        if (pageContext?.status === 'Pending Approval') return 'pendingApproval';
        if (pageContext?.status === 'Pending Pricing')  return 'pendingProcurement';
        if (pageContext?.status === 'Approved')         return 'readyToSend';
        if (pageContext?.status === 'Awaiting Acceptance') return 'awaitingAcceptance';
        if (pageContext?.status === 'Customer Rejected') return 'disputed';
        if (pageContext?.status === 'Customer Accepted' || pageContext?.status === 'Paid') return 'realizedRevenue';
        return 'pendingApproval';
    });
    const [taxesData, setTaxesData] = useState([]);
    const [taxesLoading, setTaxesLoading] = useState(true);

    // ERP-style broad read (2026-05-26): pass no userId so the backend
    // returns every invoice this user is authorised to see (which under
    // the new model is all of them). The existing tab / date / status
    // filters below remain the primary navigation tools. Replaces the
    // prior `useRealtimeInvoices(userId)` which narrowed the query to
    // creator=me and silently hid cross-role workflow (e.g. a
    // finance_head-authored quote queued for the sales_officer to send).
    const { data: myInvoices, loading: invoicesLoading } = useRealtimeInvoices();

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const [taxesRes, pricingRes] = await Promise.all([
                    api.get('/settings/taxes'),
                    api.get('/settings/pricing')
                ]);
                
                const settingsData = [
                    { id: 'taxes', ...taxesRes.data },
                    { id: 'pricing', ...pricingRes.data }
                ];
                setTaxesData(settingsData);
                setTaxesLoading(false);
            } catch (err) {
                console.error('Error fetching settings:', err);
                setTaxesLoading(false);
            }
        };

        fetchSettings();
    }, []);

    const [selectedYear, setSelectedYear] = useState(initialYearFromUrl || 'All');
    const [selectedMonth, setSelectedMonth] = useState(initialMonthFromUrl || 'All');

    // M7 — keep the URL in sync with filter state (non-destructive; preserves ?page=... and other params)
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const params = new URLSearchParams(window.location.search);
        if (activeTab && activeTab !== 'pendingApproval') params.set('tab', activeTab); else params.delete('tab');
        if (selectedYear && selectedYear !== 'All') params.set('year', selectedYear); else params.delete('year');
        if (selectedMonth && selectedMonth !== 'All') params.set('month', selectedMonth); else params.delete('month');
        const newSearch = params.toString();
        const newUrl = `${window.location.pathname}${newSearch ? `?${newSearch}` : ''}${window.location.hash}`;
        window.history.replaceState(null, '', newUrl);
    }, [activeTab, selectedYear, selectedMonth]);

    const taxes = useMemo(() => {
        if (taxesData.length > 0) {
            const taxDoc = taxesData.find(doc => doc.id === 'taxes');
            return taxDoc?.taxArray || [];
        }
        return [];
    }, [taxesData]);

    const invoiceSettings = useMemo(() => {
        if (taxesData.length > 0) {
            const settingsDoc = taxesData.find(doc => doc.id === 'invoice');
            return settingsDoc || {};
        }
        return {};
    }, [taxesData]);

    const filteredInvoices = useMemo(() => {
        let result = myInvoices;
        switch (activeTab) {
            case 'pendingApproval': result = result.filter(inv => inv.status === 'Pending Approval'); break;
            case 'pendingProcurement': result = result.filter(inv => inv.status === 'Pending Pricing'); break;
            case 'readyToSend': result = result.filter(inv => inv.status === 'Approved'); break;
            case 'awaitingAcceptance': result = result.filter(inv => inv.status === 'Awaiting Acceptance'); break;
            case 'realizedRevenue': result = result.filter(inv => inv.status === 'Customer Accepted' || inv.status === 'Paid'); break;
            case 'disputed': result = result.filter(inv => inv.status === 'Customer Rejected' || inv.status === 'Rejected'); break;
            default: break;
        }
        return result.filter(invoice => {
            const date = getInvoiceDate(invoice);
            const year = date.getFullYear().toString();
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const yearMatch = selectedYear === 'All' || year === selectedYear;
            const monthMatch = selectedMonth === 'All' || month === selectedMonth;
            return yearMatch && monthMatch;
        });
    }, [myInvoices, activeTab, selectedYear, selectedMonth]);

    // Project numeric / date columns so the sort hook picks the right
    // comparator (locale string for ID + customer + status, numeric for
    // amount, parsed-date for date).
    // Module 1 — `_due` + `_daysOverdue` added so the new Due column
    // sorts numerically and overdue badge can render from a stable per-row
    // value computed once here instead of every render.
    const today = useMemo(() => {
        const d = new Date(); d.setHours(0, 0, 0, 0); return d;
    }, []);
    const sortableInvoices = useMemo(() => filteredInvoices.map(inv => {
        const due = inv.dueDate ? new Date(inv.dueDate) : null;
        const dueValid = due && !isNaN(due.getTime());
        const daysOverdue = dueValid && Number(inv.balanceDue || inv.total || 0) > 0
            ? Math.floor((today - due) / (1000 * 60 * 60 * 24))
            : 0;
        return {
            ...inv,
            _amount: Number(inv.total) || 0,
            _date:   getInvoiceDate(inv).getTime() || 0,
            _due:    dueValid ? due.getTime() : 0,
            _daysOverdue: daysOverdue
        };
    }), [filteredInvoices, today]);
    const { sortKey, sortDir, toggle: toggleSort, sortedRows: sortedInvoices } =
        useSortable(sortableInvoices, '_date', 'desc');

    const { years, months } = useMemo(() => {
        const uniqueYears = new Set();
        const uniqueMonths = new Set();
        myInvoices.forEach(invoice => {
            const date = getInvoiceDate(invoice);
            uniqueYears.add(date.getFullYear().toString());
            uniqueMonths.add((date.getMonth() + 1).toString().padStart(2, '0'));
        });
        return { years: Array.from(uniqueYears).sort().reverse(), months: Array.from(uniqueMonths).sort() };
    }, [myInvoices]);

    const handleShowPreview = async (invoice) => {
        try {
            let completeInvoiceData = invoice;
            try {
                const response = await api.get(`/invoices/${invoice.id}`);
                if (response.success) completeInvoiceData = response.data;
            } catch (error) {
                // Preview falls back to the list-level data (which lacks
                // line items + payment history). Warn the user so they
                // don't think a stale preview is the source of truth.
                console.warn('[MyInvoices] Could not fetch full invoice data for preview, falling back to list snapshot:', error?.message);
                setNotification({
                    type: 'error',
                    message: 'Preview is showing partial data — we couldn\'t fetch the latest line items. ' + (error?.response?.data?.error?.message || error?.message || '')
                });
            }
            const taxConfig = completeInvoiceData.taxBreakdown || completeInvoiceData.taxConfiguration || taxes;
            
            // ... (keep currency conversion logic same) ...
            if (completeInvoiceData.currency === 'USD') {
                const exchangeRate = completeInvoiceData.exchangeRate || 1;
                if (completeInvoiceData.items) completeInvoiceData.items = completeInvoiceData.items.map(item => ({ ...item, price: (Number(item.price) || 0) / exchangeRate, finalPrice: (Number(item.finalPrice) || Number(item.price) || 0) / exchangeRate }));
                if (completeInvoiceData.lineItems) completeInvoiceData.lineItems = completeInvoiceData.lineItems.map(item => ({ ...item, price: (Number(item.price) || 0) / exchangeRate, finalPrice: (Number(item.finalPrice) || Number(item.price) || 0) / exchangeRate }));
                if (completeInvoiceData.orderCharges) completeInvoiceData.orderCharges = { shipping: (Number(completeInvoiceData.orderCharges.shipping) || 0) / exchangeRate, handling: (Number(completeInvoiceData.orderCharges.handling) || 0) / exchangeRate, discount: (Number(completeInvoiceData.orderCharges.discount) || 0) / exchangeRate };
            }

            const itemsArray = completeInvoiceData.lineItems || completeInvoiceData.items || [];
            const subtotal = itemsArray.reduce((acc, item) => {
                const price = Number(item.finalPrice || item.unitPrice || item.price || 0);
                const quantity = Number(item.quantity || 0);
                return acc + (price * quantity);
            }, 0);

            const orderCharges = completeInvoiceData.orderCharges || { shipping: 0, handling: 0, discount: 0 };
            const shipping = Number(orderCharges.shipping || 0);
            const handling = Number(orderCharges.handling || 0);
            const discount = Number(orderCharges.discount || 0);
            const subtotalWithCharges = subtotal + shipping + handling - discount;
            const safeTaxConfig = Array.isArray(taxConfig) ? taxConfig : [];
            var totals = calculateDynamicTotals(subtotalWithCharges, safeTaxConfig, orderCharges);

            let customerData = { name: completeInvoiceData.customerName };
            if (completeInvoiceData.customerId) {
                try {
                    const custRes = await api.get(`/customers/${completeInvoiceData.customerId}`);
                    if (custRes.success) {
                        const customer = custRes.data;
                        customerData = { name: customer.name || completeInvoiceData.customerName, contactEmail: customer.contactEmail || completeInvoiceData.customerEmail || 'test@example.com', location: customer.location || '[CUSTOMER LOCATION]', poBox: customer.poBox || '[CUSTOMER P.O. BOX]', region: customer.region || '[REGION]', address: customer.address || '[ADDRESS]' };
                    }
                } catch (error) {
                    // Falls back to placeholder customer fields ([CUSTOMER
                    // LOCATION] etc.). Warn so the user notices before
                    // sending an email with placeholder text.
                    console.warn('[MyInvoices] Could not fetch customer record for preview, using placeholders:', error?.message);
                    setNotification({
                        type: 'error',
                        message: 'Customer details could not be loaded — preview will show placeholder values. Refresh and try again.'
                    });
                }
            }
            if (!totals || Object.values(totals).some(val => isNaN(val) || !isFinite(val))) {
                totals = { subtotal: subtotal, grandTotal: subtotal, shipping: 0, handling: 0, discount: 0, subtotalWithCharges: subtotal };
            }

            let parsedSignature = {};
            if (completeInvoiceData.signatureData) {
                try {
                    parsedSignature = typeof completeInvoiceData.signatureData === 'string'
                        ? JSON.parse(completeInvoiceData.signatureData)
                        : completeInvoiceData.signatureData;
                } catch(e) { console.error('Failed to parse signatureData', e); }
            }

            const previewDataObj = { 
                customer: customerData, 
                items: itemsArray, 
                subtotal, 
                taxes: safeTaxConfig, 
                totals, 
                invoiceId: completeInvoiceData.id, 
                invoiceNumber: completeInvoiceData.invoiceNumber, 
                invoiceDate: completeInvoiceData.invoiceDate, 
                controllerSignature: parsedSignature.signatureUrl || parsedSignature.signature || completeInvoiceData.controllerSignature, 
                controllerName: parsedSignature.controllerName || completeInvoiceData.controllerName, 
                controllerSubsidiary: parsedSignature.subsidiary || parsedSignature.controllerSubsidiary || completeInvoiceData.controllerSubsidiary, 
                signatureTimestamp: completeInvoiceData.signatureTimestamp || parsedSignature.signedAt, 
                approvedBy: completeInvoiceData.approvedBy || parsedSignature.signedBy, 
                currency: completeInvoiceData.currency, 
                exchangeRate: completeInvoiceData.exchangeRate 
            };
            setPreviewData(previewDataObj);
        } catch (error) { console.error('Error preparing preview data:', error); setNotification({ type: 'error', message: 'Error preparing invoice preview. Please try again.' }); }
    };

    const calculateDynamicTotals = (subtotalWithCharges, taxes, orderCharges = {}) => {
        const totals = {};
        // Pure item subtotal (before order-level shipping/handling/discount)
        const shipping = orderCharges.shipping || 0;
        const handling = orderCharges.handling || 0;
        const discount = orderCharges.discount || 0;
        const subtotal = subtotalWithCharges - shipping - handling + discount;
        totals.subtotal = subtotal;
        totals.shipping = shipping;
        totals.handling = handling;
        totals.discount = discount;
        totals.subtotalWithCharges = subtotalWithCharges;
        // Taxes are applied on subtotalWithCharges (the charge-inclusive base, matching how the quote was built)
        let levyTotal = subtotalWithCharges;
        const subtotalTaxes = (Array.isArray(taxes) ? taxes : []).filter(t => t.on === 'subtotal' && t.enabled);
        subtotalTaxes.forEach(t => {
            const taxAmount = subtotalWithCharges * (t.rate / 100);
            totals[t.id] = taxAmount;
            totals[`${t.id}_rate`] = t.rate;
            levyTotal += taxAmount;
        });
        totals.levyTotal = levyTotal;
        const levyTaxes = (Array.isArray(taxes) ? taxes : []).filter(t => t.on === 'levyTotal' && t.enabled);
        let grandTotal = levyTotal;
        levyTaxes.forEach(t => {
            const taxAmount = levyTotal * (t.rate / 100);
            totals[t.id] = taxAmount;
            totals[`${t.id}_rate`] = t.rate;
            grandTotal += taxAmount;
        });
        totals.grandTotal = grandTotal;
        return totals;
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'Pending Approval': return 'bg-amber-100 text-amber-800';
            case 'Pending Pricing': return 'bg-purple-100 text-purple-800';
            case 'Customer Accepted': return 'bg-green-100 text-green-800';
            case 'Paid': return 'bg-green-100 text-green-800';
            case 'Approved': return 'bg-blue-100 text-blue-800';
            case 'Awaiting Acceptance': return 'bg-amber-100 text-amber-800';
            case 'Customer Rejected': return 'bg-red-100 text-red-800';
            case 'Rejected': return 'bg-red-100 text-red-800';
            default: return 'bg-gray-100 text-gray-800';
        }
    };

    const markAsSentToCustomer = async () => {
        if (!previewData) return;
        try {
            await api.put(`/invoices/${previewData.invoiceId}`, { status: 'Awaiting Acceptance', sentAt: new Date() });
            log('DOCUMENT_ACTION', `Sent Invoice ${previewData.invoiceId} to customer (Email/Download)`, { category: 'document', action: 'send_invoice', documentId: previewData.invoiceId });
            return true;
        } catch (error) { console.error('Error updating invoice status:', error); setNotification({ type: 'error', message: 'Failed to update invoice status. Please try again.' }); return false; }
    };

    const handleSendEmail = async () => {
        const success = await markAsSentToCustomer();
        if (!success) return;
        const customer = previewData.customer;
        const invoiceId = previewData.invoiceId || 'INV-2025-XXXXX';
        const total = previewData.totals?.grandTotal || previewData.subtotal || 0;
        const currency = previewData.currency || 'GHS';
        if (!customer?.contactEmail) { setNotification({ type: 'error', message: 'Customer email not available. Please add customer email first.' }); return; }
        const subject = `Invoice ${invoiceId} from Margins ID Systems`;
        const locale = currency === 'USD' ? 'en-US' : 'en-GH';
        const formattedTotal = new Intl.NumberFormat(locale, { style: 'currency', currency: currency }).format(total);
        const body = `Dear ${customer.name},\n\nPlease find attached your invoice ${invoiceId}.\n\nInvoice Details:\n- Invoice Number: ${invoiceId}\n- Date: ${new Date().toISOString().split('T')[0]}\n- Total Amount: ${formattedTotal}\n\nPayment Terms: 100% - 10 days from invoice date\n\nAccount Details:\nAccount Name: ${invoiceSettings?.accountDetails?.accountName || 'Margins ID Systems Applications Ltd.'}\nBankers: ${invoiceSettings?.accountDetails?.bankers || 'Fidelity Bank Limited'}\nAccount Numbers: ${invoiceSettings?.accountDetails?.accountNumbers || '1070033129318 - GHC'}\n\nPlease make payment to the account details above or issue cheque in the company's name.\n\nThank you for your business.\n\nBest regards,\n${invoiceSettings?.locationAddress?.companyName || 'Margins ID Systems'}\n${invoiceSettings?.locationAddress?.unit || 'Unit B607, Octagon'}\n${invoiceSettings?.locationAddress?.street || 'Barnes Road, Accra Central'}\nTel: ${invoiceSettings?.companyAddress?.tel || '+233 XX XXX XXXX'}\nEmail: ${invoiceSettings?.companyAddress?.email || 'sales@margins-id.com'}`;
        const mailtoLink = `mailto:${customer.contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        window.open(mailtoLink);
    };

    const handleDownloadAction = async () => {
        await markAsSentToCustomer();
    };

    const handleMarkAccepted = async (invoice) => {
        // Stock deduction point: inventory is decremented at controller Approval (SalesInvoiceApproval),
        // NOT here. Acceptance just recognises revenue — no stock change needed.
        // Rejection (handleMarkRejected) restores stock because that undoes the approval deduction.
        const ok = await askConfirm({
            title:        `Mark ${invoice.approvedInvoiceId || invoice.id} as accepted?`,
            description:  'This recognizes revenue and cannot be undone from the customer side.',
            confirmLabel: 'Mark accepted',
            confirmTone:  'primary'
        });
        if (!ok) return;
        try {
            await api.put(`/invoices/${invoice.id}`, { status: 'Customer Accepted', customerActionAt: new Date() });
            log('INVOICE_ACTION', `Marked Invoice ${invoice.id} as Customer Accepted`, { documentId: invoice.id });
            // ISO/IEC 25010 — User Error Protection: confirm the state change
            // landed. Previously the click was silent on success too, so users
            // could not tell whether the action took effect.
            setNotification({ type: 'success', message: `Invoice ${invoice.approvedInvoiceId || invoice.id} marked as Customer Accepted.` });
        } catch (error) {
            // OWASP ASVS V11.1.7 + ISO/IEC 25010 — never swallow errors from
            // privileged operations. Surface the backend's specific reason
            // (e.g. SoD violation, permission deny, validation) so the user
            // can act on it instead of clicking again into the same wall.
            console.error('Error marking accepted:', error);
            const backendMsg = error?.response?.data?.error || error?.message || 'Failed to mark invoice as accepted. Please try again.';
            setNotification({ type: 'error', message: backendMsg });
        }
    };

    // Module 4 — open the controlled-vocabulary lost-deal modal. The
    // modal's onSubmit calls performMarkRejected below. We keep the
    // existing two-phase reject + inventory restore logic intact —
    // only the reason capture moved from askText to the modal.
    const handleMarkRejected = (invoice) => {
        setRejectingInvoice(invoice);
    };

    const performMarkRejected = async ({ reasonCode, reasonLabel, lostToCompetitor, notes }) => {
        const invoice = rejectingInvoice;
        if (!invoice) return;
        const reason = notes || reasonLabel || 'Customer rejected';

        // Two-phase: status FIRST, inventory restore as best-effort.
        // The earlier code wrapped both in a single try/catch, so a single
        // missing inventory row (404 from /inventory/:id, common for legacy
        // line items where item.id was a SOURCED-… or had been deleted)
        // would fail the entire reject and the user got "Request failed
        // with status code 404". Now the rejection persists even if some
        // restores fail, and we tell the user exactly what didn't restore.
        try {
            await api.put(`/invoices/${invoice.id}`, {
                status: 'Customer Rejected',
                customerActionAt: new Date(),
                rejectionReason: reason,
                // Module 4 — structured columns alongside the free-text reason.
                rejectionReasonCode: reasonCode || null,
                lostToCompetitor:    lostToCompetitor || null
            });
        } catch (err) {
            console.error('Reject invoice — status update failed:', err);
            await askConfirm({
                title:        'Could not update the invoice',
                description:  err?.response?.data?.error || err.message || 'The server rejected the status change. The invoice was NOT rejected.',
                confirmLabel: 'OK',
                cancelLabel:  ''
            });
            throw err; // keep modal open for retry
        }
        setRejectingInvoice(null);

        const itemsToRestore = (invoice.lineItems || invoice.items || []).filter(it =>
            it && it.id &&
            it.type !== 'sourced' &&
            !String(it.id).toUpperCase().startsWith('SOURCED-')
        );
        const restoreFailures = [];
        for (const item of itemsToRestore) {
            try {
                const invRes = await api.get(`/inventory/${item.id}`);
                if (invRes?.success) {
                    const newStock = (invRes.data.stock || 0) + (Number(item.quantity) || 0);
                    await api.put(`/inventory/${item.id}`, { stock: newStock });
                }
            } catch (err) {
                console.warn(`Inventory restore skipped for ${item.id}:`, err?.response?.status || err.message);
                restoreFailures.push({ id: item.id, name: item.name || item.description, status: err?.response?.status });
            }
        }

        log('INVOICE_ACTION', `Marked Invoice ${invoice.id} as Customer Rejected`, {
            documentId: invoice.id, reason,
            restoreFailures: restoreFailures.length
        });

        if (restoreFailures.length) {
            await askConfirm({
                title:        'Invoice rejected — some stock not restored',
                description:  `The rejection went through and the salesperson will see the reason. ${restoreFailures.length} item${restoreFailures.length === 1 ? '' : 's'} could not be restored to inventory because the SKU is no longer in the catalogue:\n\n${restoreFailures.map(f => `• ${f.name || f.id}${f.status === 404 ? ' (not in inventory)' : ''}`).join('\n')}`,
                confirmLabel: 'OK',
                cancelLabel:  ''
            });
        }
    };

    const handleRevise = async (invoice) => {
        const ok = await askConfirm({
            title:        `Revise ${invoice.approvedInvoiceId || invoice.id}?`,
            description:  'Resets approval signatures, restores inventory for inventory-tracked items, and moves the invoice back to Draft.',
            confirmLabel: 'Revise',
            confirmTone:  'danger'
        });
        if (!ok) return;

        // Same two-phase approach as reject — status first, restore as
        // best-effort, surface failures without blocking the workflow.
        try {
            await api.put(`/invoices/${invoice.id}`, {
                status: 'Draft',
                controllerSignature: null,
                approvedBy: null,
                signatureTimestamp: null
            });
        } catch (err) {
            console.error('Revise invoice — status update failed:', err);
            await askConfirm({
                title:        'Could not revise the invoice',
                description:  err?.response?.data?.error || err.message || 'The server rejected the status change.',
                confirmLabel: 'OK',
                cancelLabel:  ''
            });
            return;
        }

        const itemsToRestore = (invoice.lineItems || invoice.items || []).filter(it =>
            it && it.id &&
            it.type !== 'sourced' &&
            !String(it.id).toUpperCase().startsWith('SOURCED-')
        );
        let restored = 0;
        for (const item of itemsToRestore) {
            try {
                const invRes = await api.get(`/inventory/${item.id}`);
                if (invRes?.success) {
                    const newStock = (invRes.data.stock || 0) + (Number(item.quantity) || 0);
                    await api.put(`/inventory/${item.id}`, { stock: newStock });
                    restored++;
                }
            } catch (err) {
                console.warn(`Inventory restore skipped for ${item.id}:`, err?.response?.status || err.message);
            }
        }
        log('INVENTORY_ACTION', `Restored stock for revised Invoice ${invoice.id}`, {
            documentId: invoice.id, itemCount: restored
        });
        navigateTo('invoiceEditor', { invoiceId: invoice.id, returnTo: 'myInvoices' });
    };

    const formatListAmount = (amount, currency) => {
        try {
            const cur = currency === 'USD' ? 'USD' : 'GHS';
            const locale = cur === 'USD' ? 'en-US' : 'en-GH';
            const n = Number(amount) || 0;
            return new Intl.NumberFormat(locale, { style: 'currency', currency: cur }).format(n);
        } catch (e) { return String(amount || 0); }
    };

    return (
        <>
            {notification && (
                <Notification message={notification.message} type={notification.type} onDismiss={() => setNotification(null)} />
            )}
            {previewData && (
                <PreviewModal open={!!previewData} onClose={() => setPreviewData(null)} payload={previewData} mode="invoice" isDistribution={true} onEmail={handleSendEmail} onDownload={handleDownloadAction} />
            )}
            <RejectWithReasonModal
                open={!!rejectingInvoice}
                onClose={() => setRejectingInvoice(null)}
                onSubmit={performMarkRejected}
                category="LOST_DEAL"
                title={rejectingInvoice ? `Mark ${rejectingInvoice.approvedInvoiceId || rejectingInvoice.id} as rejected` : 'Mark rejected'}
                description="The salesperson will see this on their queue. Inventory will be restored after the rejection persists."
                confirmLabel="Mark rejected"
                confirmTone="danger"
                requireReason
            />
            <PageHeader
                title="Invoices"
                actions={
                    <Button variant="ghost" size="sm" onClick={() => navigateTo('salesDashboard')} leftIcon={<Icon id="arrow-left" />}>
                        Back to Dashboard
                    </Button>
                }
            />
                <div className="flex space-x-1 rounded-xl bg-blue-900/20 p-1 mb-6 overflow-x-auto">
                    <button onClick={() => setActiveTab('pendingApproval')} className={`w-full rounded-lg py-2.5 text-sm font-medium leading-5 text-blue-700 ring-white ring-opacity-60 ring-offset-2 ring-offset-blue-400 focus:outline-none focus:ring-2 whitespace-nowrap ${activeTab === 'pendingApproval' ? 'bg-white shadow' : 'text-blue-100 hover:bg-white/[0.12] hover:text-white'}`}>Pending Approval</button>
                    <button onClick={() => setActiveTab('pendingProcurement')} className={`w-full rounded-lg py-2.5 text-sm font-medium leading-5 text-blue-700 ring-white ring-opacity-60 ring-offset-2 ring-offset-blue-400 focus:outline-none focus:ring-2 whitespace-nowrap ${activeTab === 'pendingProcurement' ? 'bg-white shadow' : 'text-blue-100 hover:bg-white/[0.12] hover:text-white'}`}>Pending Procurement</button>
                    <button onClick={() => setActiveTab('readyToSend')} className={`w-full rounded-lg py-2.5 text-sm font-medium leading-5 text-blue-700 ring-white ring-opacity-60 ring-offset-2 ring-offset-blue-400 focus:outline-none focus:ring-2 whitespace-nowrap ${activeTab === 'readyToSend' ? 'bg-white shadow' : 'text-blue-100 hover:bg-white/[0.12] hover:text-white'}`}>Ready to Send</button>
                    <button onClick={() => setActiveTab('awaitingAcceptance')} className={`w-full rounded-lg py-2.5 text-sm font-medium leading-5 text-blue-700 ring-white ring-opacity-60 ring-offset-2 ring-offset-blue-400 focus:outline-none focus:ring-2 whitespace-nowrap ${activeTab === 'awaitingAcceptance' ? 'bg-white shadow' : 'text-blue-100 hover:bg-white/[0.12] hover:text-white'}`}>Awaiting Acceptance</button>
                    <button onClick={() => setActiveTab('realizedRevenue')} className={`w-full rounded-lg py-2.5 text-sm font-medium leading-5 text-blue-700 ring-white ring-opacity-60 ring-offset-2 ring-offset-blue-400 focus:outline-none focus:ring-2 whitespace-nowrap ${activeTab === 'realizedRevenue' ? 'bg-white shadow' : 'text-blue-100 hover:bg-white/[0.12] hover:text-white'}`}>Realized Revenue</button>
                    <button onClick={() => setActiveTab('disputed')} className={`w-full rounded-lg py-2.5 text-sm font-medium leading-5 text-blue-700 ring-white ring-opacity-60 ring-offset-2 ring-offset-blue-400 focus:outline-none focus:ring-2 whitespace-nowrap ${activeTab === 'disputed' ? 'bg-white shadow' : 'text-blue-100 hover:bg-white/[0.12] hover:text-white'}`}>Disputed / Rejected</button>
                </div>
                <div className="bg-white p-6 rounded-xl shadow-md">
                    <div className="flex gap-4 mb-4 p-4 bg-gray-50 rounded-lg">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
                            <select value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)} className="block w-32 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm">
                                <option value="All">All Years</option>
                                {years.map(year => (<option key={year} value={year}>{year}</option>))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Month</label>
                            <select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="block w-32 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm">
                                <option value="All">All Months</option>
                                {months.map(month => (<option key={month} value={month}>{month}</option>))}
                            </select>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="p-3 text-left"><SortableHeader  label="Invoice ID" sortKey="id"           current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>
                                    <th className="p-3 text-left"><SortableHeader  label="Customer"   sortKey="customerName" current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>
                                    <th className="p-3 text-left"><SortableHeader  label="Date"       sortKey="_date"        current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>
                                    <th className="p-3 text-left"><SortableHeader  label="Due"        sortKey="_due"         current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>
                                    <th className="p-3 text-right"><SortableHeader label="Amount"     sortKey="_amount"      current={sortKey} dir={sortDir} onToggle={toggleSort} align="right" /></th>
                                    <th className="p-3 text-center"><SortableHeader label="Status"    sortKey="status"       current={sortKey} dir={sortDir} onToggle={toggleSort} align="center" /></th>
                                    <th className="p-3 font-semibold text-[11px] text-n-600 uppercase tracking-wider text-center">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedInvoices.length === 0 ? (<tr><td colSpan="7" className="p-8 text-center text-gray-500">No invoices found in this category.</td></tr>) : (sortedInvoices.map(inv => (
                                    <tr key={inv.id} className="border-b hover:bg-gray-50">
                                        <td className="p-3 font-medium">{inv.approvedInvoiceId || inv.id}</td>
                                        <td className="p-3">{inv.customerName}</td>
                                        <td className="p-3">{inv.date}</td>
                                        <td className="p-3">
                                            {inv.dueDate ? (
                                                <div className="flex flex-col">
                                                    <span className="text-gray-700">{new Date(inv.dueDate).toLocaleDateString()}</span>
                                                    {inv._daysOverdue > 0 && (
                                                        <span className="text-[10.5px] font-semibold text-red-600 uppercase tracking-wide">
                                                            {inv._daysOverdue} day{inv._daysOverdue === 1 ? '' : 's'} overdue
                                                        </span>
                                                    )}
                                                </div>
                                            ) : (
                                                <span className="text-gray-400 italic">—</span>
                                            )}
                                        </td>
                                        <td className="p-3 text-right">{formatListAmount(inv.total, inv.currency)}</td>
                                        <td className="p-3 text-center">
                                            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(inv.status)}`}>{inv.status}</span>
                                            {inv.sourcingStatus && inv.sourcingStatus !== 'NONE' && (() => {
                                                const cfg = inv.sourcingStatus === 'PENDING'
                                                    ? { cls: 'bg-amber-100 text-amber-700 border border-amber-200', icon: 'hourglass-half', label: 'Sourcing Pending', tip: 'Procurement is collecting vendor quotes for items in this invoice. The cost will update automatically once a vendor is awarded.' }
                                                    : inv.sourcingStatus === 'PARTIAL'
                                                    ? { cls: 'bg-blue-100 text-blue-700 border border-blue-200', icon: 'spinner', label: 'Sourcing Partial', tip: 'Some items have been awarded to vendors; others are still being sourced.' }
                                                    : inv.sourcingStatus === 'COMPLETE'
                                                    ? { cls: 'bg-green-100 text-green-700 border border-green-200', icon: 'circle-check', label: 'Sourcing Done', tip: 'All sourced items now have confirmed costs from awarded vendors.' }
                                                    : { cls: 'bg-gray-100 text-gray-600', icon: 'circle-info', label: inv.sourcingStatus, tip: 'Sourcing status' };
                                                return (
                                                    <span
                                                        className={`block mt-1 px-2 py-0.5 text-[10px] font-medium rounded-full ${cfg.cls} cursor-help`}
                                                        title={cfg.tip}
                                                    >
                                                        <Icon id={cfg.icon} className="mr-1" />{cfg.label}
                                                    </span>
                                                );
                                            })()}
                                            {/* Phase 4 — re-approval needed badge */}
                                            {inv.requiresReapproval && (
                                                <span
                                                    className="block mt-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-amber-100 text-amber-800 border border-amber-300 cursor-help animate-pulse"
                                                    title={inv.reapprovalReason || `Sourcing changed the total by ${Number(inv.reapprovalVariance || 0).toFixed(2)}%. Re-approval required.`}
                                                >
                                                    <Icon id="exclamation-triangle" className="mr-1" />Needs Re-Approval
                                                </span>
                                            )}
                                        </td>
                                        <td className="p-3 text-center">
                                            <div className="flex items-center justify-center gap-1 flex-wrap">
                                                {/* View button on every tab — opens read-only PDF preview */}
                                                <button onClick={() => handleShowPreview(inv)} className="text-xs border border-gray-400 text-gray-600 px-2 py-1 rounded hover:bg-gray-50 transition-colors">View</button>
                                                {activeTab === 'pendingApproval' && (<span className="text-xs text-amber-600 font-medium"><Icon id="clock" className="inline w-3 h-3 mr-1" /> Awaiting Controller</span>)}
                                                {activeTab === 'pendingProcurement' && (<span className="text-xs text-purple-600 font-medium"><Icon id="shopping-cart" className="inline w-3 h-3 mr-1" /> Awaiting Procurement</span>)}
                                                {activeTab === 'readyToSend' && (<button onClick={() => handleShowPreview(inv)} className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 transition-colors">Send to Customer</button>)}
                                                {activeTab === 'awaitingAcceptance' && (<><button onClick={() => handleMarkAccepted(inv)} className="text-xs border border-green-600 text-green-600 px-2 py-1 rounded hover:bg-green-50 transition-colors">Accept</button><button onClick={() => handleMarkRejected(inv)} className="text-xs border border-red-600 text-red-600 px-2 py-1 rounded hover:bg-red-50 transition-colors">Reject</button></>)}
                                                {activeTab === 'disputed' && (<button onClick={() => handleRevise(inv)} className="text-xs bg-amber-500 text-white px-3 py-1 rounded hover:bg-amber-600 transition-colors">Revise Quote</button>)}
                                                {activeTab === 'realizedRevenue' && (<span className="text-xs text-green-600 font-medium"><Icon id="check" className="inline w-3 h-3 mr-1" /> Recognized</span>)}
                                            </div>
                                        </td>
                                    </tr>
                                )))}
                            </tbody>
                        </table>
                    </div>
                </div>
        </>
    );
};
export default MyInvoices;
