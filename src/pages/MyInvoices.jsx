import React, { useState, useEffect, useMemo } from 'react';
import api from '../api';
import Icon from '../components/common/Icon';
import { useRealtimeInvoices } from '../hooks/useRealtimeInvoices';
import PreviewModal from '../components/PreviewModal';

import { useActivityLog } from '../hooks/useActivityLog';
import { getInvoiceDate } from '../utils/helpers';

const MyInvoices = ({ navigateTo, userId, pageContext }) => {
    const { log } = useActivityLog();
    const [previewData, setPreviewData] = useState(null);

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

    const { data: myInvoices, loading: invoicesLoading } = useRealtimeInvoices(userId);

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
            } catch (error) { console.error('Error fetching complete invoice data:', error); }
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
                } catch (error) { console.error('Error fetching customer data:', error); }
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
        } catch (error) { console.error('Error preparing preview data:', error); alert('Error preparing invoice preview. Please try again.'); }
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
        } catch (error) { console.error('Error updating invoice status:', error); alert('Failed to update invoice status. Please try again.'); return false; }
    };

    const handleSendEmail = async () => {
        const success = await markAsSentToCustomer();
        if (!success) return;
        const customer = previewData.customer;
        const invoiceId = previewData.invoiceId || 'INV-2025-XXXXX';
        const total = previewData.totals?.grandTotal || previewData.subtotal || 0;
        const currency = previewData.currency || 'GHS';
        if (!customer?.contactEmail) { alert('Customer email not available. Please add customer email first.'); return; }
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
        if (window.confirm(`Mark invoice ${invoice.approvedInvoiceId || invoice.id} as Accepted by Customer? This will recognize revenue.`)) {
            try {
                await api.put(`/invoices/${invoice.id}`, { status: 'Customer Accepted', customerActionAt: new Date() });
                log('INVOICE_ACTION', `Marked Invoice ${invoice.id} as Customer Accepted`, { documentId: invoice.id });
            } catch (error) { console.error('Error marking accepted:', error); }
        }
    };

    const handleMarkRejected = async (invoice) => {
        const reason = prompt("Please enter the reason for rejection:");
        if (!reason) return;

        try {
            // 1. Update Invoice Status
            await api.put(`/invoices/${invoice.id}`, {
                status: 'Customer Rejected',
                customerActionAt: new Date(),
                rejectionReason: reason
            });

            // 2. Restore Inventory
            const itemsToRestore = invoice.lineItems || invoice.items || [];
            for (const item of itemsToRestore) {
                if (item.id && item.type !== 'sourced') {
                    // Fetch current stock, increment, and update
                    const invRes = await api.get(`/inventory/${item.id}`);
                    if (invRes.success) {
                        const newStock = (invRes.data.stock || 0) + (Number(item.quantity) || 0);
                        await api.put(`/inventory/${item.id}`, { stock: newStock });
                    }
                }
            }

            log('INVOICE_ACTION', `Marked Invoice ${invoice.id} as Customer Rejected`, {
                documentId: invoice.id,
                reason
            });
            console.log("✅ Invoice rejected and inventory restored.");
        } catch (error) {
            console.error('Error marking rejected:', error);
            alert(`Failed to reject invoice: ${error.message}`);
        }
    };

    const handleRevise = async (invoice) => {
        if (window.confirm(`Revise invoice ${invoice.approvedInvoiceId || invoice.id}? This will reset approval signatures, restore inventory, and move it to Draft.`)) {
            try {
                await api.put(`/invoices/${invoice.id}`, { 
                    status: 'Draft', 
                    controllerSignature: null, 
                    approvedBy: null, 
                    signatureTimestamp: null 
                });
                
                const itemsToRestore = invoice.lineItems || invoice.items || [];
                // Only restore stock for inventory items — sourced items were never deducted from stock
                for (const item of itemsToRestore) {
                    if (item.id && item.type !== 'sourced') {
                        const invRes = await api.get(`/inventory/${item.id}`);
                        if (invRes.success) {
                            const newStock = (invRes.data.stock || 0) + (Number(item.quantity) || 0);
                            await api.put(`/inventory/${item.id}`, { stock: newStock });
                        }
                    }
                }

                log('INVENTORY_ACTION', `Restored stock for revised Invoice ${invoice.id}`, { documentId: invoice.id, itemCount: itemsToRestore.filter(i => i.type !== 'sourced').length });
                navigateTo('invoiceEditor', { invoiceId: invoice.id });
            } catch (error) { console.error('Error revising invoice:', error); alert('Failed to revise invoice. Please try again.'); }
        }
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
        <div className="min-h-screen bg-gray-100">
            <div className="max-w-7xl mx-auto p-4 md:p-8">
                {previewData && (
                    <PreviewModal open={!!previewData} onClose={() => setPreviewData(null)} payload={previewData} mode="invoice" isDistribution={true} onEmail={handleSendEmail} onDownload={handleDownloadAction} />
                )}
                <header className="bg-white p-4 rounded-xl shadow-md mb-8 flex justify-between items-center">
                    <div className="flex items-center space-x-3"><h1 className="text-2xl font-bold text-gray-800">My Invoices</h1></div>
                    <button onClick={() => navigateTo('salesDashboard')} className="text-sm"><Icon id="arrow-left" className="mr-1" /> Back to Dashboard</button>
                </header>
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
                            <thead className="bg-gray-50"><tr><th className="p-3 font-semibold">Invoice ID</th><th className="p-3 font-semibold">Customer</th><th className="p-3 font-semibold">Date</th><th className="p-3 font-semibold text-right">Amount</th><th className="p-3 font-semibold text-center">Status</th><th className="p-3 font-semibold text-center">Actions</th></tr></thead>
                            <tbody>
                                {filteredInvoices.length === 0 ? (<tr><td colSpan="6" className="p-8 text-center text-gray-500">No invoices found in this category.</td></tr>) : (filteredInvoices.map(inv => (
                                    <tr key={inv.id} className="border-b hover:bg-gray-50">
                                        <td className="p-3 font-medium">{inv.approvedInvoiceId || inv.id}</td>
                                        <td className="p-3">{inv.customerName}</td>
                                        <td className="p-3">{inv.date}</td>
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
            </div>
        </div>
    );
};
export default MyInvoices;
