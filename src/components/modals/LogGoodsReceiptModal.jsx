/**
 * LogGoodsReceiptModal — Module 3 receiving entry.
 *
 * Opened from a PurchaseRequisitionDetail when the PR is in AWARDED
 * (or FULFILLED — for late-correction partials). The PR + vendor +
 * RFQ context are passed in as props, so no picker is needed; the form
 * is just the receipt-specific fields.
 *
 * Wiring:
 *   <LogGoodsReceiptModal
 *     open={open}
 *     onClose={() => setOpen(false)}
 *     pr={pr}                       // { id, prNumber, quantity, uom, ... }
 *     awardedVendor={...}           // { vendorId, vendorName }
 *     rfqId={...}
 *     cumulativeReceived={N}        // already-received qty (for partial guidance)
 *     onSaved={() => fetchData()}
 *   />
 */

import React, { useEffect, useMemo, useState } from 'react';
import api from '../../api';
import Dialog from '../v2/Dialog';
import Button from '../common/Button';
import Label from '../v2/Label';

const RECEIPT_STATUSES = [
    { value: 'PENDING_QC',         label: 'Pending QC' },
    { value: 'ACCEPTED',           label: 'Accepted' },
    { value: 'PARTIALLY_ACCEPTED', label: 'Partially Accepted' },
    { value: 'REJECTED',           label: 'Rejected' }
];

const fmtNum = (n, decimals = 2) =>
    Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals });

const LogGoodsReceiptModal = ({
    open,
    onClose,
    pr,
    awardedVendor,
    rfqId,
    cumulativeReceived = 0,
    onSaved
}) => {
    const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

    const remaining = Math.max(0, Number(pr?.quantity || 0) - Number(cumulativeReceived || 0));

    const [receivedDate, setReceivedDate]               = useState(today);
    const [qtyReceived, setQtyReceived]                 = useState('');
    const [qtyDefective, setQtyDefective]               = useState(0);
    const [vendorInvoiceNumber, setVendorInvoiceNumber] = useState('');
    const [totalValue, setTotalValue]                   = useState('');
    const [currency, setCurrency]                       = useState('GHS');
    const [status, setStatus]                           = useState('PENDING_QC');
    const [conditionNotes, setConditionNotes]           = useState('');
    const [saving, setSaving]                           = useState(false);
    const [error, setError]                             = useState(null);

    // Awarded-vendor unit cost passed in from PR detail. When > 0, the
    // modal auto-computes totalValue = unitCost × qtyReceived so the
    // operator doesn't have to type the number — they just confirm what
    // arrived. Override still works for the case where the vendor invoice
    // came in different from the RFQ quote.
    const awardedUnitCost = Number(awardedVendor?.unitCost) || 0;
    const awardedCurrency = awardedVendor?.currency || 'GHS';

    // Reset on each open. Pre-fill qtyReceived with remaining-to-receive
    // and totalValue with unitCost × remaining for one-click receiving.
    useEffect(() => {
        if (!open) return;
        setReceivedDate(today);
        const initialQty = remaining > 0 ? remaining : 0;
        setQtyReceived(initialQty > 0 ? String(initialQty) : '');
        setQtyDefective(0);
        setVendorInvoiceNumber('');
        setTotalValue(awardedUnitCost > 0 && initialQty > 0
            ? String((awardedUnitCost * initialQty).toFixed(2))
            : ''
        );
        setCurrency(awardedCurrency);
        setStatus('PENDING_QC');
        setConditionNotes('');
        setError(null);
    }, [open, today, remaining, awardedUnitCost, awardedCurrency]);

    const qty    = Number(qtyReceived)  || 0;
    const defect = Number(qtyDefective) || 0;
    const willCompletePR = (cumulativeReceived + qty) >= Number(pr?.quantity || 0);
    const overReceiving  = qty > remaining + 0.0001;

    // Live preview of the computed value as the operator types qty. They
    // can ignore it (the totalValue field stays freely editable) or click
    // "Apply" to refresh totalValue to match the new computation.
    const computedValue = awardedUnitCost > 0 ? Number((awardedUnitCost * qty).toFixed(2)) : 0;
    const userValue     = Number(totalValue) || 0;
    const valueDiffersFromAuto = awardedUnitCost > 0
        && computedValue > 0
        && Math.abs(computedValue - userValue) > 0.01;

    const handleSubmit = async () => {
        setError(null);
        if (!pr?.id) { setError('No PR linked to this modal.'); return; }
        if (qty <= 0)        { setError('Quantity received must be positive.'); return; }
        if (defect > qty)    { setError('Defective quantity cannot exceed quantity received.'); return; }
        // Allow over-receive but warn (vendors occasionally ship a couple of
        // extras for spec/quality reasons). The server doesn't block it.

        setSaving(true);
        try {
            const res = await api.post('/goods-receipts', {
                prId:                pr.id,
                rfqId:               rfqId || null,
                vendorId:            awardedVendor?.vendorId || null,
                receivedDate,
                qtyReceived:         qty,
                qtyDefective:        defect,
                vendorInvoiceNumber: vendorInvoiceNumber || null,
                totalValue:          totalValue ? Number(totalValue) : 0,
                currency,
                status,
                conditionNotes:      conditionNotes || null
            });
            if (res?.success) {
                onSaved?.(res.data);
                onClose();
            } else {
                setError(res?.error || 'Could not log receipt.');
            }
        } catch (err) {
            const status = err?.response?.status;
            const msg    = err?.response?.data?.error || err?.message || 'Unknown error';
            setError(`Failed to log receipt${status ? ` (${status})` : ''}: ${msg}`);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog
            open={open}
            onClose={saving ? undefined : onClose}
            title={`Receive Goods · ${pr?.prNumber || pr?.id || ''}`}
            description={pr ? (
                <>
                    PR ordered <strong>{fmtNum(pr.quantity)} {pr.uom || ''}</strong> of <strong>{pr.itemName || '—'}</strong>.
                    {' '}Already received: <strong>{fmtNum(cumulativeReceived)}</strong> ·
                    {' '}remaining: <strong>{fmtNum(remaining)}</strong>
                </>
            ) : null}
            size="lg"
        >
            <div className="space-y-4">
                {error && (
                    <div className="p-3 rounded border border-red-200 bg-red-50 text-sm text-red-700">{error}</div>
                )}

                {/* Vendor + RFQ context (read-only) */}
                <div className="bg-gray-50 border border-gray-200 rounded p-3 text-sm">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Vendor</div>
                            <div className="text-gray-800">{awardedVendor?.vendorName || awardedVendor?.vendorId || 'Not linked to an award'}</div>
                        </div>
                        <div>
                            <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">RFQ</div>
                            <div className="font-mono text-gray-700">{rfqId || '—'}</div>
                        </div>
                    </div>
                </div>

                {/* Receipt entry */}
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <Label className="block text-xs font-medium text-gray-600 mb-1" required>Received Date</Label>
                        <input
                            type="date"
                            value={receivedDate}
                            onChange={(e) => setReceivedDate(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded text-sm"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Vendor Invoice #</label>
                        <input
                            type="text"
                            value={vendorInvoiceNumber}
                            onChange={(e) => setVendorInvoiceNumber(e.target.value)}
                            placeholder="Supplier's invoice / delivery note"
                            className="w-full p-2 border border-gray-300 rounded text-sm"
                        />
                    </div>
                    <div>
                        <Label className="block text-xs font-medium text-gray-600 mb-1" required>
                            Qty Received {pr?.uom ? `(${pr.uom})` : ''}
                        </Label>
                        <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={qtyReceived}
                            onChange={(e) => setQtyReceived(e.target.value)}
                            className={`w-full p-2 border rounded text-sm font-mono ${
                                overReceiving ? 'border-amber-400 bg-amber-50' : 'border-gray-300'
                            }`}
                        />
                        {overReceiving && (
                            <div className="text-[11px] text-amber-700 mt-1">
                                Over-receiving by {fmtNum(qty - remaining)}. Saved as-is; no further receipts will be allowed once this PR auto-flips to FULFILLED.
                            </div>
                        )}
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Qty Defective</label>
                        <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={qtyDefective}
                            onChange={(e) => setQtyDefective(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded text-sm font-mono"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                            Total Value
                            {awardedUnitCost > 0 && (
                                <span className="ml-1 font-normal text-gray-500">
                                    (auto: {currency} {fmtNum(awardedUnitCost)} × qty)
                                </span>
                            )}
                        </label>
                        <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={totalValue}
                            onChange={(e) => setTotalValue(e.target.value)}
                            placeholder="0.00"
                            className="w-full p-2 border border-gray-300 rounded text-sm font-mono"
                        />
                        {valueDiffersFromAuto && (
                            <button
                                type="button"
                                onClick={() => setTotalValue(String(computedValue))}
                                className="text-[11px] text-blue-600 hover:underline mt-1"
                            >
                                Use auto-computed value {currency} {fmtNum(computedValue)}
                            </button>
                        )}
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Currency</label>
                        <select
                            value={currency}
                            onChange={(e) => setCurrency(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded text-sm"
                        >
                            <option value="GHS">GHS</option>
                            <option value="USD">USD</option>
                            <option value="EUR">EUR</option>
                            <option value="GBP">GBP</option>
                        </select>
                    </div>
                    <div className="col-span-2">
                        <label className="block text-xs font-medium text-gray-600 mb-1">QC Status</label>
                        <select
                            value={status}
                            onChange={(e) => setStatus(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded text-sm"
                        >
                            {RECEIPT_STATUSES.map(s => (
                                <option key={s.value} value={s.value}>{s.label}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Condition / Notes</label>
                    <textarea
                        rows={3}
                        value={conditionNotes}
                        onChange={(e) => setConditionNotes(e.target.value)}
                        placeholder="Packaging condition, batch numbers, any QC observations"
                        className="w-full p-2 border border-gray-300 rounded text-sm"
                    />
                </div>

                {/* Footer status hint */}
                <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                    <div className="text-xs text-gray-600">
                        {willCompletePR
                            ? <span className="text-emerald-700 font-medium">✓ This receipt will mark the PR as FULFILLED.</span>
                            : <>After this receipt: <strong>{fmtNum(cumulativeReceived + qty)}</strong> of <strong>{fmtNum(pr?.quantity)}</strong> received ({fmtNum(remaining - qty)} remaining).</>}
                    </div>
                    <div className="flex gap-2">
                        <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
                        <Button variant="primary" onClick={handleSubmit} disabled={saving || qty <= 0}>
                            {saving ? 'Saving…' : 'Log Receipt'}
                        </Button>
                    </div>
                </div>
            </div>
        </Dialog>
    );
};

export default LogGoodsReceiptModal;
