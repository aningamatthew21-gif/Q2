import React, { useState, useMemo } from 'react';
import GlassModal from '../common/GlassModal';
import Button from '../common/Button';

const INPUT_CLASS = 'p-1.5 border border-line rounded-card text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none bg-surface';
const INPUT_CLASS_WIDE = 'w-full p-2 border border-line rounded-card text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none bg-surface';

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

    const footer = (
        <div className="flex justify-between items-center w-full">
            <p className="text-xs text-ink-muted">
                {filledLines.length} of {lines.length} items will be saved
            </p>
            <div className="flex gap-3">
                <Button variant="secondary" onClick={onCancel}>Cancel</Button>
                <Button
                    variant="primary"
                    onClick={handleSave}
                    disabled={!canSave || submitting}
                >
                    {submitting ? `Saving ${savedCount}/${filledLines.length}…` : `Save ${filledLines.length} Response(s)`}
                </Button>
            </div>
        </div>
    );

    return (
        <GlassModal
            open
            onClose={onCancel}
            title="Log Vendor Response"
            description={<><strong className="text-ink">{vendor.vendorName}</strong> &middot; RFQ {rfq.rfqNumber} &middot; {rfq.lineItems.length} line item(s)</>}
            size="xl"
            footer={footer}
        >
            <p className="text-xs text-info mb-3">Enter unit costs for each item below. Leave blank to skip items the vendor didn't quote on.</p>

            <div className="space-y-5">
                {/* Per-line pricing table */}
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-surface-sunken border-b border-line">
                            <tr>
                                <th className="p-2 text-left text-xs text-ink-muted font-medium">Item</th>
                                <th className="p-2 text-center text-xs text-ink-muted font-medium">Qty</th>
                                <th className="p-2 text-left text-xs text-ink-muted font-medium">Unit Cost ({rfq.currency || 'GHS'}) *</th>
                                <th className="p-2 text-left text-xs text-ink-muted font-medium">Freight</th>
                                <th className="p-2 text-left text-xs text-ink-muted font-medium">Lead (days)</th>
                                <th className="p-2 text-right text-xs text-ink-muted font-medium">Line Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {lines.map(l => {
                                const lineTotal = (Number(l.unitCost || 0) * l.quantity) + Number(l.freight || 0);
                                const hasValue = Number(l.unitCost) > 0;
                                return (
                                    <tr key={l.prId} className={`border-b border-line ${hasValue ? 'bg-success-soft' : ''}`}>
                                        <td className="p-2">
                                            <div className="font-medium text-ink">{l.itemName}</div>
                                            <div className="text-xs text-ink-subtle">{l.prNumber}</div>
                                        </td>
                                        <td className="p-2 text-center text-ink-muted">{l.quantity} {l.uom}</td>
                                        <td className="p-2">
                                            <input
                                                type="number" step="0.01" min="0"
                                                value={l.unitCost}
                                                onChange={e => updateLine(l.prId, 'unitCost', e.target.value)}
                                                placeholder="0.00"
                                                className={`w-28 ${INPUT_CLASS}`}
                                            />
                                        </td>
                                        <td className="p-2">
                                            <input
                                                type="number" step="0.01" min="0"
                                                value={l.freight}
                                                onChange={e => updateLine(l.prId, 'freight', e.target.value)}
                                                placeholder="0.00"
                                                className={`w-24 ${INPUT_CLASS}`}
                                            />
                                        </td>
                                        <td className="p-2">
                                            <input
                                                type="number" min="0"
                                                value={l.leadTimeDays}
                                                onChange={e => updateLine(l.prId, 'leadTimeDays', e.target.value)}
                                                placeholder="0"
                                                className={`w-20 ${INPUT_CLASS}`}
                                            />
                                        </td>
                                        <td className="p-2 text-right font-medium text-ink">
                                            {hasValue ? `${rfq.currency || 'GHS'} ${lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '—'}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot className="bg-surface-sunken">
                            <tr>
                                <td colSpan={5} className="p-2 text-sm font-semibold text-right text-ink">
                                    Grand Total ({filledLines.length}/{lines.length} items quoted):
                                </td>
                                <td className="p-2 text-right font-bold text-primary">
                                    {rfq.currency || 'GHS'} {grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                {/* Shared fields */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                        <label className="block text-xs text-ink-muted mb-1">Delivery Terms</label>
                        <input type="text" value={deliveryTerms} onChange={e => setDeliveryTerms(e.target.value)}
                            placeholder="e.g. CIF Tema" className={INPUT_CLASS_WIDE} />
                    </div>
                    <div>
                        <label className="block text-xs text-ink-muted mb-1">Payment Terms</label>
                        <input type="text" value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)}
                            placeholder="e.g. Net 30" className={INPUT_CLASS_WIDE} />
                    </div>
                    <div>
                        <label className="block text-xs text-ink-muted mb-1">Validity (days)</label>
                        <input type="number" min="0" value={validityDays} onChange={e => setValidityDays(e.target.value)}
                            className={INPUT_CLASS_WIDE} />
                    </div>
                    <div>
                        <label className="block text-xs text-ink-muted mb-1">Received Date</label>
                        <input type="date" value={receivedDate} onChange={e => setReceivedDate(e.target.value)}
                            className={INPUT_CLASS_WIDE} />
                    </div>
                </div>

                <div>
                    <label className="block text-xs text-ink-muted mb-1">Notes (applies to all items)</label>
                    <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
                        className={INPUT_CLASS_WIDE} placeholder="Any vendor comments or conditions..." />
                </div>

                {submitting && savedCount > 0 && (
                    <div className="bg-info-soft border border-info/30 rounded-card p-3 text-sm text-info">
                        Saving... {savedCount}/{filledLines.length} responses logged.
                    </div>
                )}
            </div>
        </GlassModal>
    );
};

export default LogVendorResponseModal;
