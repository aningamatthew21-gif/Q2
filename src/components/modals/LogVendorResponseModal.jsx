import React, { useState, useMemo } from 'react';

/**
 * LogVendorResponseModal
 * Bulk-entry: log a vendor's quoted prices for ALL line items in one form.
 * Shared fields (delivery terms, payment terms, validity, received date) apply to every line.
 * Individual fields (unit cost, freight, lead time) are per-line.
 */
const LogVendorResponseModal = ({ rfq, vendor, onSave, onCancel, defaultPrId }) => {
    // Per-line state keyed by prId
    const [lines, setLines] = useState(() =>
        rfq.lineItems.map(li => ({
            prId: li.prId,
            itemName: li.itemName,
            quantity: li.quantity,
            uom: li.uom || 'EA',
            prNumber: li.prNumber,
            unitCost: '',
            freight: '0',
            leadTimeDays: '',
        }))
    );

    // Shared fields
    const [deliveryTerms, setDeliveryTerms] = useState('');
    const [paymentTerms, setPaymentTerms]   = useState('');
    const [validityDays, setValidityDays]   = useState('30');
    const [receivedDate, setReceivedDate]   = useState(new Date().toISOString().slice(0, 10));
    const [notes, setNotes]                 = useState('');
    const [submitting, setSubmitting]       = useState(false);
    const [savedCount, setSavedCount]       = useState(0);

    const updateLine = (prId, field, value) => {
        setLines(prev => prev.map(l => l.prId === prId ? { ...l, [field]: value } : l));
    };

    const filledLines = useMemo(() => lines.filter(l => Number(l.unitCost) > 0), [lines]);
    const canSave = filledLines.length > 0;

    const grandTotal = useMemo(() =>
        lines.reduce((acc, l) => acc + (Number(l.unitCost || 0) * l.quantity) + Number(l.freight || 0), 0),
        [lines]
    );

    const handleSave = async () => {
        if (!canSave) return;
        setSubmitting(true);
        let saved = 0;
        try {
            for (const l of filledLines) {
                await onSave({
                    vendorId: vendor.vendorId,
                    prId: l.prId,
                    quantity: l.quantity,
                    unitCost: Number(l.unitCost),
                    freight: Number(l.freight || 0),
                    leadTimeDays: Number(l.leadTimeDays || 0),
                    deliveryTerms,
                    paymentTerms,
                    validityDays: Number(validityDays || 30),
                    receivedDate,
                    notes,
                    currency: rfq.currency || 'GHS',
                });
                saved++;
                setSavedCount(saved);
            }
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto">
                {/* Header */}
                <div className="p-5 border-b sticky top-0 bg-white z-10">
                    <h2 className="text-xl font-semibold">Log Vendor Response</h2>
                    <p className="text-sm text-gray-500 mt-0.5">
                        <strong>{vendor.vendorName}</strong> &middot; RFQ {rfq.rfqNumber} &middot; {rfq.lineItems.length} line item(s)
                    </p>
                    <p className="text-xs text-blue-600 mt-1">Enter unit costs for each item below. Leave blank to skip items the vendor didn't quote on.</p>
                </div>

                <div className="p-5 space-y-5">
                    {/* Per-line pricing table */}
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 border-b">
                                <tr>
                                    <th className="p-2 text-left text-xs text-gray-500 font-medium">Item</th>
                                    <th className="p-2 text-center text-xs text-gray-500 font-medium">Qty</th>
                                    <th className="p-2 text-left text-xs text-gray-500 font-medium">Unit Cost ({rfq.currency || 'GHS'}) *</th>
                                    <th className="p-2 text-left text-xs text-gray-500 font-medium">Freight</th>
                                    <th className="p-2 text-left text-xs text-gray-500 font-medium">Lead (days)</th>
                                    <th className="p-2 text-right text-xs text-gray-500 font-medium">Line Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {lines.map(l => {
                                    const lineTotal = (Number(l.unitCost || 0) * l.quantity) + Number(l.freight || 0);
                                    const hasValue = Number(l.unitCost) > 0;
                                    return (
                                        <tr key={l.prId} className={`border-b ${hasValue ? 'bg-green-50' : ''}`}>
                                            <td className="p-2">
                                                <div className="font-medium">{l.itemName}</div>
                                                <div className="text-xs text-gray-400">{l.prNumber}</div>
                                            </td>
                                            <td className="p-2 text-center text-gray-600">{l.quantity} {l.uom}</td>
                                            <td className="p-2">
                                                <input
                                                    type="number" step="0.01" min="0"
                                                    value={l.unitCost}
                                                    onChange={e => updateLine(l.prId, 'unitCost', e.target.value)}
                                                    placeholder="0.00"
                                                    className="w-28 p-1.5 border rounded text-sm focus:ring-1 focus:ring-blue-400"
                                                />
                                            </td>
                                            <td className="p-2">
                                                <input
                                                    type="number" step="0.01" min="0"
                                                    value={l.freight}
                                                    onChange={e => updateLine(l.prId, 'freight', e.target.value)}
                                                    placeholder="0.00"
                                                    className="w-24 p-1.5 border rounded text-sm"
                                                />
                                            </td>
                                            <td className="p-2">
                                                <input
                                                    type="number" min="0"
                                                    value={l.leadTimeDays}
                                                    onChange={e => updateLine(l.prId, 'leadTimeDays', e.target.value)}
                                                    placeholder="0"
                                                    className="w-20 p-1.5 border rounded text-sm"
                                                />
                                            </td>
                                            <td className="p-2 text-right font-medium">
                                                {hasValue ? `${rfq.currency || 'GHS'} ${lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '—'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                            <tfoot className="bg-gray-50">
                                <tr>
                                    <td colSpan={5} className="p-2 text-sm font-semibold text-right text-gray-700">
                                        Grand Total ({filledLines.length}/{lines.length} items quoted):
                                    </td>
                                    <td className="p-2 text-right font-bold text-blue-700">
                                        {rfq.currency || 'GHS'} {grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    {/* Shared fields */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">Delivery Terms</label>
                            <input type="text" value={deliveryTerms} onChange={e => setDeliveryTerms(e.target.value)}
                                placeholder="e.g. CIF Tema" className="w-full p-2 border rounded text-sm" />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">Payment Terms</label>
                            <input type="text" value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)}
                                placeholder="e.g. Net 30" className="w-full p-2 border rounded text-sm" />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">Validity (days)</label>
                            <input type="number" min="0" value={validityDays} onChange={e => setValidityDays(e.target.value)}
                                className="w-full p-2 border rounded text-sm" />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">Received Date</label>
                            <input type="date" value={receivedDate} onChange={e => setReceivedDate(e.target.value)}
                                className="w-full p-2 border rounded text-sm" />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs text-gray-500 mb-1">Notes (applies to all items)</label>
                        <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
                            className="w-full p-2 border rounded text-sm" placeholder="Any vendor comments or conditions..." />
                    </div>

                    {submitting && savedCount > 0 && (
                        <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-700">
                            Saving... {savedCount}/{filledLines.length} responses logged.
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-5 border-t flex justify-between items-center sticky bottom-0 bg-white">
                    <p className="text-xs text-gray-500">
                        {filledLines.length} of {lines.length} items will be saved
                    </p>
                    <div className="flex gap-3">
                        <button onClick={onCancel} className="px-4 py-2 border rounded text-sm text-gray-600 hover:bg-gray-50">
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={!canSave || submitting}
                            className={`px-5 py-2 rounded text-sm text-white font-medium ${
                                canSave && !submitting ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-300 cursor-not-allowed'
                            }`}
                        >
                            {submitting ? `Saving ${savedCount}/${filledLines.length}…` : `Save ${filledLines.length} Response(s)`}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LogVendorResponseModal;
