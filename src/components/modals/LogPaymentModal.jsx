/**
 * LogPaymentModal — Module 2 collections payment entry (JE-style rebuild).
 *
 * Layout follows the NetSuite / SAP B1 / Xero pattern:
 *
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │ Header strip: Customer · Invoice · Date · Method · Reference  │
 *   │              · Cheque# (cond) · Bank (cond)                   │
 *   ├────────────────────────────────────────────────────────────────┤
 *   │ AMOUNT RECEIVED  [—————————]                                   │
 *   ├────────────────────────────────────────────────────────────────┤
 *   │ Withholding tax lines (sub-grid, manual entry)                 │
 *   │   Type [▼]  Rate  Amount  [×]            [+ Add WHT line]      │
 *   ├────────────────────────────────────────────────────────────────┤
 *   │ Notes                                                          │
 *   ├────────────────────────────────────────────────────────────────┤
 *   │ Summary: cash + WHT = effective coverage                       │
 *   │                                          [Cancel] [Log Payment]│
 *   └────────────────────────────────────────────────────────────────┘
 *
 * Entry points:
 *   - InvoiceEditor                 invoice pre-selected
 *   - CustomerPortal (row action)   invoice pre-selected
 *   - CollectionsWorkbench (header) NO pre-selection — user picks
 *                                   customer and invoice from comboboxes
 *
 * Server contract unchanged: POST /collections/payments with
 * { invoiceId, amount, paymentDate, paymentMethod, referenceNumber,
 *   chequeNumber, bankName, notes, whtBreakdown: [{ code, rate, amount }] }.
 *
 * Invoice picker filters to payment-eligible statuses only (matches the
 * server gate — Awaiting Acceptance, Customer Accepted, Partially Paid,
 * Paid). Statuses outside that list never appear, so a user cannot
 * even attempt to log a payment against a pending-pricing invoice.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../api';
import Dialog from '../v2/Dialog';
import Button from '../common/Button';
import Icon from '../common/Icon';
import Label from '../v2/Label';
import { useRealtimeCustomers } from '../../hooks/useRealtimeCustomers';

const PAYMENT_METHODS = [
    'Cash', 'Cheque', 'Bank Transfer', 'Mobile Money', 'Card', 'Other'
];

// Mirrors backend PAYMENT_ELIGIBLE_STATUSES. Filtering the picker keeps
// the user from selecting an invoice that the server would reject anyway.
const PAYMENT_ELIGIBLE_STATUSES = new Set([
    'Awaiting Acceptance', 'Customer Accepted', 'Partially Paid', 'Paid'
]);

const fmtMoney = (currency, amount) =>
    `${currency || 'GHS'} ${Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Compact, controlled-input combobox. Renders a text input + dropdown of
// matching options; clicking an option commits the selection and fires
// `onChange(item)`. Designed to be reused for both customer and invoice
// pickers without dragging in a heavier autocomplete library.
const Combobox = ({ value, onChange, options, placeholder, disabled, getKey, getLabel, getSub }) => {
    const [query, setQuery] = useState('');
    const [open, setOpen]   = useState(false);
    const wrapRef = useRef(null);

    useEffect(() => {
        if (value) setQuery(getLabel(value));
        else setQuery('');
    }, [value, getLabel]);

    useEffect(() => {
        const onDocClick = (e) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, []);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q || (value && query === getLabel(value))) return options.slice(0, 12);
        return options.filter(o => {
            const lbl = (getLabel(o) || '').toLowerCase();
            const sub = (getSub?.(o)  || '').toLowerCase();
            return lbl.includes(q) || sub.includes(q);
        }).slice(0, 12);
    }, [query, options, value, getLabel, getSub]);

    return (
        <div className="relative" ref={wrapRef}>
            <input
                type="text"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setOpen(true); if (value) onChange(null); }}
                onFocus={() => setOpen(true)}
                placeholder={placeholder}
                disabled={disabled}
                className="w-full p-2 border border-gray-300 rounded text-sm disabled:bg-gray-100 disabled:cursor-not-allowed"
                autoComplete="off"
            />
            {open && !disabled && filtered.length > 0 && (
                <ul className="absolute z-30 left-0 right-0 mt-1 max-h-60 overflow-auto bg-white border border-gray-200 rounded shadow-lg">
                    {filtered.map(o => (
                        <li key={getKey(o)}>
                            <button
                                type="button"
                                onClick={() => { onChange(o); setQuery(getLabel(o)); setOpen(false); }}
                                className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm"
                            >
                                <div className="font-medium text-gray-800">{getLabel(o)}</div>
                                {getSub && <div className="text-xs text-gray-500">{getSub(o)}</div>}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

const LogPaymentModal = ({
    open,
    onClose,
    invoice,        // optional pre-selection { id, invoiceNumber, total, balanceDue, currency, customerId }
    onLogged
}) => {
    const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

    // Form state
    const [paymentDate, setPaymentDate]   = useState(today);
    const [method, setMethod]             = useState('Bank Transfer');
    const [amount, setAmount]             = useState('');
    const [reference, setReference]       = useState('');
    const [chequeNumber, setChequeNumber] = useState('');
    const [bankName, setBankName]         = useState('');
    const [notes, setNotes]               = useState('');

    // WHT lines — array of { id, code, rate, amount }. `id` is a UI key only.
    const [whtLines, setWhtLines]         = useState([]);
    const [whtTypes, setWhtTypes]         = useState([]);

    // Standalone-mode picker state (only used when no `invoice` prop)
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [selectedInvoice, setSelectedInvoice]   = useState(null);
    const [customerInvoices, setCustomerInvoices] = useState([]); // eligible invoices for picked customer

    // Submit/UI state
    const [saving, setSaving]   = useState(false);
    const [error, setError]     = useState(null);
    const [success, setSuccess] = useState(null);
    // Overpayment two-step confirm: user must explicitly tick the
    // acknowledgement before the Log Payment button activates when the
    // total they're entering exceeds the invoice balance.
    const [acknowledgedOverpay, setAcknowledgedOverpay] = useState(false);

    const { data: customers } = useRealtimeCustomers();
    const customerOptions = useMemo(
        () => (Array.isArray(customers) ? customers : []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || '')),
        [customers]
    );

    // Pre-resolve the working invoice: prop-supplied wins; otherwise the
    // user's picker selection. Both flow through one variable so the rest
    // of the modal stays simple.
    const workingInvoice = invoice && invoice.id ? invoice : selectedInvoice;

    // Reset whenever the modal opens
    useEffect(() => {
        if (!open) return;
        setPaymentDate(today);
        setMethod('Bank Transfer');
        setReference('');
        setChequeNumber('');
        setBankName('');
        setNotes('');
        setWhtLines([]);
        setError(null);
        setSuccess(null);
        setAcknowledgedOverpay(false);

        if (invoice && invoice.id) {
            setSelectedCustomer(null);
            setSelectedInvoice(null);
            setAmount(invoice?.balanceDue != null && Number(invoice.balanceDue) > 0
                ? String(invoice.balanceDue)
                : (invoice?.total ? String(invoice.total) : ''));
        } else {
            setSelectedCustomer(null);
            setSelectedInvoice(null);
            setCustomerInvoices([]);
            setAmount('');
        }
    }, [open, invoice, today]);

    // Load WHT type catalogue on open (cached on the api call by browser).
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        api.get('/wht/types').then(res => {
            if (cancelled) return;
            if (res?.success) {
                setWhtTypes((res.data || []).filter(t => t.isActive !== false));
            }
        }).catch(() => { /* WHT optional; modal works without */ });
        return () => { cancelled = true; };
    }, [open]);

    // When the user picks a customer in standalone mode, load that
    // customer's payment-eligible invoices.
    useEffect(() => {
        if (!open || (invoice && invoice.id) || !selectedCustomer) {
            setCustomerInvoices([]);
            return;
        }
        let cancelled = false;
        api.get('/invoices', { params: { customerId: selectedCustomer.id, limit: 200 } })
            .then(res => {
                if (cancelled) return;
                const all = Array.isArray(res?.data) ? res.data : [];
                setCustomerInvoices(all.filter(i => PAYMENT_ELIGIBLE_STATUSES.has(i.status)));
            })
            .catch(() => { setCustomerInvoices([]); });
        return () => { cancelled = true; };
    }, [open, invoice, selectedCustomer]);

    // When invoice picked in standalone mode, pre-fill amount with balance.
    useEffect(() => {
        if (selectedInvoice) {
            setAmount(selectedInvoice.balanceDue != null && Number(selectedInvoice.balanceDue) > 0
                ? String(selectedInvoice.balanceDue)
                : (selectedInvoice.total ? String(selectedInvoice.total) : ''));
        }
    }, [selectedInvoice]);

    // WHT helpers — add / update / remove / auto-fill amount from rate
    const addWhtLine = () => {
        setWhtLines(prev => [...prev, { id: Date.now() + Math.random(), code: '', rate: 0, amount: 0 }]);
    };
    const removeWhtLine = (id) => {
        setWhtLines(prev => prev.filter(l => l.id !== id));
    };
    const updateWhtLine = (id, patch) => {
        setWhtLines(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l));
    };
    const onWhtCodeChange = (id, newCode) => {
        const type = whtTypes.find(t => t.code === newCode);
        if (!type) {
            updateWhtLine(id, { code: '', rate: 0, amount: 0 });
            return;
        }
        // Auto-suggest amount = rate% × subtotal-or-gross from invoice
        const inv = workingInvoice;
        const base = type.appliesTo === 'gross' ? (Number(inv?.total) || 0) : (Number(inv?.subtotal ?? inv?.total) || 0);
        const suggested = Number(((type.rate / 100) * base).toFixed(2));
        updateWhtLine(id, { code: newCode, rate: type.rate, amount: suggested });
    };

    const amt        = Number(amount) || 0;
    const whtTotal   = useMemo(() => whtLines.reduce((s, l) => s + (Number(l.amount) || 0), 0), [whtLines]);
    const effective  = amt + whtTotal;
    const invTotal   = Number(workingInvoice?.total || 0);
    const invBalance = Number(workingInvoice?.balanceDue ?? invTotal);
    const coverDelta = invTotal - effective;
    // Overpayment = the user is committing more than the invoice's
    // current outstanding balance (NOT the original total — partial
    // payments may have already reduced it). Compute against balance.
    const overpayAmount = Math.max(0, effective - invBalance);
    const isOverpayment = overpayAmount > 0.01;

    // Reset the acknowledgement if the user changes the amount or WHT
    // such that the overpayment goes away — prevents the case where they
    // tick the checkbox, then dial the amount back, but the Log button
    // still shows "Acknowledge" framing.
    useEffect(() => {
        if (!isOverpayment) setAcknowledgedOverpay(false);
    }, [isOverpayment]);

    const canSubmit = !!workingInvoice && amt > 0 && !saving && (!isOverpayment || acknowledgedOverpay);

    const handleSubmit = async () => {
        if (!workingInvoice?.id) { setError('Pick an invoice first.'); return; }
        if (!Number.isFinite(amt) || amt <= 0) { setError('Enter a valid amount.'); return; }

        // Strip lines without a chosen WHT code (UI placeholder rows).
        const whtBreakdown = whtLines
            .filter(l => l.code && Number(l.amount) > 0)
            .map(l => ({ code: l.code, rate: Number(l.rate) || 0, amount: Number(l.amount) || 0 }));

        setSaving(true); setError(null);
        try {
            const res = await api.post('/collections/payments', {
                invoiceId:       workingInvoice.id,
                amount:          amt,
                paymentDate,
                paymentMethod:   method,
                referenceNumber: reference || null,
                chequeNumber:    method === 'Cheque' ? (chequeNumber || null) : null,
                bankName:        (method === 'Cheque' || method === 'Bank Transfer') ? (bankName || null) : null,
                notes:           notes || null,
                whtBreakdown
            });
            if (res?.success) {
                setSuccess(res.data);
                onLogged?.(res.data);
            } else {
                setError(res?.error || 'Could not log payment.');
            }
        } catch (err) {
            const status = err?.response?.status;
            const msg    = err?.response?.data?.error || err?.message || 'Unknown error';
            setError(`Failed to log payment${status ? ` (${status})` : ''}: ${msg}`);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog
            open={open}
            onClose={saving ? undefined : onClose}
            title={success
                ? `Payment logged · ${success.receiptNumber}`
                : `Log Payment${workingInvoice?.invoiceNumber ? ` · ${workingInvoice.invoiceNumber}` : ''}`}
            description={success
                ? `Receipt ${success.receiptNumber} has been issued.`
                : (workingInvoice
                    ? `Invoice total ${fmtMoney(workingInvoice.currency, workingInvoice.total)} · outstanding ${fmtMoney(workingInvoice.currency, workingInvoice.balanceDue ?? workingInvoice.total)}`
                    : 'Pick a customer and invoice to record a payment against')}
            size="xl"
        >
            {success ? (
                <div className="space-y-4">
                    <div className="p-4 rounded border border-emerald-200 bg-emerald-50 text-sm text-emerald-800">
                        <div className="font-semibold mb-1">Payment recorded</div>
                        <div>Receipt number: <span className="font-mono">{success.receiptNumber}</span></div>
                        <div>Payment ID: <span className="font-mono">#{success.paymentId}</span></div>
                    </div>
                    <div className="flex justify-end">
                        <Button variant="primary" onClick={onClose}>Close</Button>
                    </div>
                </div>
            ) : (
                <div className="space-y-4">
                    {error && (
                        <div className="p-3 rounded border border-red-200 bg-red-50 text-sm text-red-700">{error}</div>
                    )}

                    {/* ── Header strip (JE-style horizontal) ─────────────────── */}
                    <div className="bg-gray-50 border border-gray-200 rounded p-3">
                        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
                            {/* Customer + Invoice — read-only chips if pre-selected, comboboxes otherwise */}
                            <div className="col-span-2">
                                <Label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1" required={!(invoice && invoice.id)}>Customer</Label>
                                {invoice && invoice.id ? (
                                    <div className="p-2 bg-white border border-gray-200 rounded text-sm font-medium text-gray-800 truncate">
                                        {invoice.customerName || invoice.customerId || '—'}
                                    </div>
                                ) : (
                                    <Combobox
                                        value={selectedCustomer}
                                        onChange={(c) => { setSelectedCustomer(c); setSelectedInvoice(null); }}
                                        options={customerOptions}
                                        placeholder="Type customer name…"
                                        getKey={(c) => c.id}
                                        getLabel={(c) => c.name}
                                        getSub={(c) => c.contactEmail || c.id}
                                    />
                                )}
                            </div>
                            <div className="col-span-2">
                                <Label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1" required={!(invoice && invoice.id)}>Invoice</Label>
                                {invoice && invoice.id ? (
                                    <div className="p-2 bg-white border border-gray-200 rounded text-sm font-mono text-gray-800 truncate">
                                        {invoice.invoiceNumber || invoice.id}
                                    </div>
                                ) : (
                                    <Combobox
                                        value={selectedInvoice}
                                        onChange={setSelectedInvoice}
                                        options={customerInvoices}
                                        placeholder={selectedCustomer ? 'Pick invoice…' : 'Pick customer first'}
                                        disabled={!selectedCustomer || customerInvoices.length === 0}
                                        getKey={(i) => i.id}
                                        getLabel={(i) => i.invoiceNumber || i.id}
                                        getSub={(i) => `${i.status} · ${fmtMoney(i.currency, i.balanceDue ?? i.total)}`}
                                    />
                                )}
                            </div>
                            <div>
                                <Label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1" required>Date</Label>
                                <input
                                    type="date"
                                    value={paymentDate}
                                    onChange={(e) => setPaymentDate(e.target.value)}
                                    className="w-full p-2 border border-gray-300 rounded text-sm"
                                />
                            </div>
                            <div>
                                <Label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1" required>Method</Label>
                                <select
                                    value={method}
                                    onChange={(e) => setMethod(e.target.value)}
                                    className="w-full p-2 border border-gray-300 rounded text-sm"
                                >
                                    {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                                </select>
                            </div>
                            <div className={method === 'Cheque' ? 'col-span-2 md:col-span-2' : 'col-span-2 md:col-span-2'}>
                                <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Reference</label>
                                <input
                                    type="text"
                                    value={reference}
                                    onChange={(e) => setReference(e.target.value)}
                                    placeholder="Transaction ID / MoMo ID"
                                    className="w-full p-2 border border-gray-300 rounded text-sm"
                                />
                            </div>
                            {method === 'Cheque' && (
                                <div>
                                    <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Cheque #</label>
                                    <input
                                        type="text"
                                        value={chequeNumber}
                                        onChange={(e) => setChequeNumber(e.target.value)}
                                        className="w-full p-2 border border-gray-300 rounded text-sm"
                                    />
                                </div>
                            )}
                            {(method === 'Cheque' || method === 'Bank Transfer') && (
                                <div className="col-span-2 md:col-span-3">
                                    <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Bank</label>
                                    <input
                                        type="text"
                                        value={bankName}
                                        onChange={(e) => setBankName(e.target.value)}
                                        className="w-full p-2 border border-gray-300 rounded text-sm"
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ── Amount received row (own emphasized strip) ────────── */}
                    <div className="flex items-end gap-4 bg-white border border-blue-200 rounded p-3">
                        <div className="flex-1">
                            <Label className="block text-[10px] font-semibold text-blue-700 uppercase tracking-wide mb-1" required>
                                Amount Received {workingInvoice && `(${workingInvoice.currency || 'GHS'})`}
                            </Label>
                            <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                placeholder="0.00"
                                className="w-full p-2 text-lg font-mono font-semibold border border-blue-300 rounded bg-blue-50/40"
                            />
                        </div>
                        {workingInvoice && amt > 0 && coverDelta > 0.01 && !isOverpayment && (
                            <div className="text-xs text-right text-amber-700 pb-2">
                                Short of invoice by <strong>{fmtMoney(workingInvoice.currency, coverDelta)}</strong>. Add WHT lines below to close the gap.
                            </div>
                        )}
                    </div>

                    {/* Overpayment warning + explicit acknowledgement.
                        Sits between Amount and WHT so the user sees it
                        in flow. The submit button stays disabled until
                        the checkbox is ticked — matches NetSuite's
                        "confirm over-application" pattern. */}
                    {isOverpayment && (
                        <div className="bg-amber-50 border border-amber-300 rounded p-3">
                            <div className="flex items-start gap-2">
                                <Icon id="exclamation-triangle" className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
                                <div className="flex-1">
                                    <div className="text-sm font-semibold text-amber-900">
                                        Overpayment detected
                                    </div>
                                    <div className="text-xs text-amber-800 mt-1">
                                        Cash {fmtMoney(workingInvoice?.currency, amt)}
                                        {whtTotal > 0 && <> + WHT {fmtMoney(workingInvoice?.currency, whtTotal)}</>}
                                        {' = '}<strong>{fmtMoney(workingInvoice?.currency, effective)}</strong>
                                        {' exceeds the outstanding balance of '}
                                        <strong>{fmtMoney(workingInvoice?.currency, invBalance)}</strong>
                                        {' by '}<strong>{fmtMoney(workingInvoice?.currency, overpayAmount)}</strong>.
                                    </div>
                                    <div className="text-xs text-amber-800 mt-2">
                                        Proceeding will close this invoice fully; the excess will need to be reconciled
                                        manually (e.g. as a credit on the customer's next invoice or as a refund).
                                    </div>
                                    <label className="flex items-center gap-2 mt-3 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={acknowledgedOverpay}
                                            onChange={(e) => setAcknowledgedOverpay(e.target.checked)}
                                            className="h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                                        />
                                        <span className="text-sm font-medium text-amber-900">
                                            I acknowledge the overpayment and want to proceed.
                                        </span>
                                    </label>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ── Withholding tax line items ────────────────────────── */}
                    <div className="bg-white border border-gray-200 rounded p-3">
                        <div className="flex items-center justify-between mb-2">
                            <h4 className="text-sm font-semibold text-gray-700">Withholding Tax Lines</h4>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={addWhtLine}
                                leftIcon={<Icon id="plus" />}
                                disabled={whtTypes.length === 0}
                            >
                                Add WHT line
                            </Button>
                        </div>
                        {whtTypes.length === 0 ? (
                            <div className="text-xs text-gray-500 italic py-2">
                                No WHT types configured. Configure in System Settings → Withholding Taxes.
                            </div>
                        ) : whtLines.length === 0 ? (
                            <div className="text-xs text-gray-500 italic py-2">
                                No WHT applied. Add a line if the customer's payment is net of withholding tax.
                            </div>
                        ) : (
                            <table className="min-w-full text-sm">
                                <thead className="text-[10px] uppercase text-gray-500">
                                    <tr>
                                        <th className="text-left  py-1 w-2/5">WHT Type</th>
                                        <th className="text-right py-1 w-20">Rate %</th>
                                        <th className="text-right py-1">Amount</th>
                                        <th className="w-10"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {whtLines.map(line => (
                                        <tr key={line.id} className="border-t border-gray-100">
                                            <td className="py-1.5 pr-2">
                                                <select
                                                    value={line.code}
                                                    onChange={(e) => onWhtCodeChange(line.id, e.target.value)}
                                                    className="w-full p-1.5 border border-gray-300 rounded text-sm"
                                                >
                                                    <option value="">— Select —</option>
                                                    {whtTypes.map(t => (
                                                        <option key={t.code} value={t.code}>
                                                            {t.code} · {t.name}
                                                        </option>
                                                    ))}
                                                </select>
                                            </td>
                                            <td className="py-1.5 pr-2">
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    value={line.rate}
                                                    onChange={(e) => updateWhtLine(line.id, { rate: Number(e.target.value) || 0 })}
                                                    className="w-full p-1.5 text-right font-mono border border-gray-300 rounded text-sm"
                                                />
                                            </td>
                                            <td className="py-1.5 pr-2">
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    value={line.amount}
                                                    onChange={(e) => updateWhtLine(line.id, { amount: Number(e.target.value) || 0 })}
                                                    className="w-full p-1.5 text-right font-mono border border-gray-300 rounded text-sm"
                                                />
                                            </td>
                                            <td className="py-1.5 text-right">
                                                <button
                                                    type="button"
                                                    onClick={() => removeWhtLine(line.id)}
                                                    className="text-red-500 hover:text-red-700 text-lg leading-none"
                                                    title="Remove line"
                                                >
                                                    ×
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>

                    {/* ── Notes ─────────────────────────────────────────────── */}
                    <div>
                        <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Notes (optional)</label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            rows={2}
                            className="w-full p-2 border border-gray-300 rounded text-sm"
                            placeholder="Context for the audit trail"
                        />
                    </div>

                    {/* ── Summary + actions ─────────────────────────────────── */}
                    <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                        <div className="text-xs text-gray-600">
                            {workingInvoice ? (
                                <>
                                    Cash <strong>{fmtMoney(workingInvoice.currency, amt)}</strong>
                                    {' + WHT '}<strong>{fmtMoney(workingInvoice.currency, whtTotal)}</strong>
                                    {' = '}<strong>{fmtMoney(workingInvoice.currency, effective)}</strong>
                                    {' against '}<strong>{fmtMoney(workingInvoice.currency, invTotal)}</strong>
                                </>
                            ) : 'Pick an invoice to begin.'}
                        </div>
                        <div className="flex gap-2">
                            <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
                            <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit}>
                                {saving ? 'Logging…' : 'Log Payment'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </Dialog>
    );
};

export default LogPaymentModal;
