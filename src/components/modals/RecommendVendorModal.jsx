import React, { useState, useMemo, useEffect } from 'react';
import Icon from '../common/Icon';

/**
 * RecommendVendorModal — Phase 3
 *
 * Procurement officer uses this to commit their recommendation for a given vendor.
 * Submitting sends POST /api/rfqs/:id/recommend which transitions the RFQ to
 * PENDING_APPROVAL. Final award + cost pushback happens when the Procurement Head
 * approves.
 *
 * Props:
 *  - rfq:             full rfq payload (needed for line-item count + currency)
 *  - vendor:          the vendor being recommended
 *  - recommendation:  optional — the /recommendation response, used to pre-fill
 *                     score/reason if this vendor is the system pick
 *  - onSubmit:        (payload) => Promise — called with { vendorId, responseIds, score, reason, allowPartial }
 *  - onCancel:        () => void
 */
const RecommendVendorModal = ({ rfq, vendor, recommendation, onSubmit, onCancel }) => {
    // Derive the responses + totals for this vendor
    const vendorResponses = useMemo(
        () => (rfq?.responses || []).filter(r => r.vendorId === vendor?.vendorId),
        [rfq, vendor]
    );
    const totalLines = rfq?.lineItems?.length || 0;
    const respondedLines = new Set(vendorResponses.map(r => r.prId)).size;
    const isPartial = respondedLines < totalLines;
    const missingLines = useMemo(
        () => (rfq?.lineItems || []).filter(li => !vendorResponses.some(r => r.prId === li.prId)),
        [rfq, vendorResponses]
    );

    const totalAmount = vendorResponses.reduce((sum, r) => sum + (Number(r.totalCost) || 0), 0);
    const currency = rfq?.currency || 'GHS';

    // Pre-fill score + reason if this vendor is the system's recommendation
    const systemPick = recommendation?.vendors?.find(v => v.vendorId === vendor?.vendorId);
    const defaultScore  = systemPick?.weightedScore ?? '';
    const defaultReason = systemPick?.recommendationReason ?? '';

    const [reason, setReason]             = useState(defaultReason);
    const [score, setScore]               = useState(defaultScore);
    const [allowPartial, setAllowPartial] = useState(false);
    const [submitting, setSubmitting]     = useState(false);
    const [error, setError]               = useState(null);

    useEffect(() => {
        setReason(defaultReason);
        setScore(defaultScore);
    }, [defaultReason, defaultScore]);

    const canSubmit = !submitting && vendorResponses.length > 0 && (!isPartial || allowPartial);

    const handleSubmit = async () => {
        if (!canSubmit) return;
        setError(null);
        setSubmitting(true);
        try {
            await onSubmit({
                vendorId: vendor.vendorId,
                responseIds: vendorResponses.map(r => r.id),
                score: score === '' ? null : Number(score),
                reason: (reason || '').trim(),
                allowPartial
            });
        } catch (err) {
            setError(err?.message || 'Failed to submit recommendation.');
        } finally {
            setSubmitting(false);
        }
    };

    const fmtMoney = (n) => `${currency} ${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="bg-gradient-to-r from-emerald-500 to-blue-500 text-white px-6 py-4 rounded-t-xl">
                    <div className="flex items-center gap-3">
                        <Icon id="lightbulb" className="text-2xl" />
                        <div>
                            <h2 className="text-xl font-bold">Recommend Vendor for Award</h2>
                            <p className="text-sm opacity-90">This recommendation will be sent to the Procurement Head for approval.</p>
                        </div>
                    </div>
                </div>

                <div className="p-6 space-y-5">
                    {/* Vendor summary */}
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Recommended Vendor</p>
                        <p className="text-lg font-bold text-gray-900 mt-1">{vendor?.vendorName}</p>
                        {vendor?.contactEmail && (
                            <p className="text-sm text-gray-600">{vendor.contactEmail}</p>
                        )}
                        <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                            <div className="bg-white rounded p-2 border">
                                <p className="text-[10px] text-gray-500 uppercase">Total Cost</p>
                                <p className="text-sm font-semibold">{fmtMoney(totalAmount)}</p>
                            </div>
                            <div className="bg-white rounded p-2 border">
                                <p className="text-[10px] text-gray-500 uppercase">Lines Quoted</p>
                                <p className="text-sm font-semibold">{respondedLines} / {totalLines}</p>
                            </div>
                            <div className="bg-white rounded p-2 border">
                                <p className="text-[10px] text-gray-500 uppercase">Rating</p>
                                <p className="text-sm font-semibold">{vendor?.rating ? `${vendor.rating}/5` : '—'}</p>
                            </div>
                        </div>
                    </div>

                    {/* Partial-response warning */}
                    {isPartial && (
                        <div className="bg-amber-50 border border-amber-300 rounded-lg p-4">
                            <div className="flex items-start gap-3">
                                <Icon id="exclamation-triangle" className="text-amber-600 text-xl mt-0.5" />
                                <div className="flex-1">
                                    <p className="font-semibold text-amber-900">Partial Response Detected</p>
                                    <p className="text-sm text-amber-800 mt-1">
                                        This vendor has not quoted on all {totalLines} line items. Missing:
                                    </p>
                                    <ul className="text-xs text-amber-900 mt-1 list-disc list-inside">
                                        {missingLines.slice(0, 3).map(li => (
                                            <li key={li.prId}>{li.itemName}</li>
                                        ))}
                                        {missingLines.length > 3 && (
                                            <li>… and {missingLines.length - 3} more</li>
                                        )}
                                    </ul>
                                    <label className="flex items-center gap-2 mt-3 text-sm text-amber-900 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={allowPartial}
                                            onChange={(e) => setAllowPartial(e.target.checked)}
                                            className="rounded border-amber-400"
                                        />
                                        <span>Allow partial award — the un-quoted lines will remain open for a future RFQ.</span>
                                    </label>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Score field */}
                    <div>
                        <label className="block text-sm font-medium text-gray-800 mb-1">
                            Recommendation Score <span className="text-xs text-gray-400">(optional, 0–100)</span>
                        </label>
                        <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            value={score}
                            onChange={(e) => setScore(e.target.value)}
                            className="w-32 p-2 border rounded-md text-sm"
                        />
                        {systemPick && (
                            <p className="text-xs text-gray-500 mt-1">
                                Pre-filled with system-calculated weighted score.
                            </p>
                        )}
                    </div>

                    {/* Reason */}
                    <div>
                        <label className="block text-sm font-medium text-gray-800 mb-1">
                            Recommendation Reason <span className="text-red-500">*</span>
                        </label>
                        <textarea
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            rows={3}
                            maxLength={500}
                            placeholder="e.g. Lowest total cost with fastest lead time and full line coverage."
                            className="w-full p-2 border rounded-md text-sm"
                        />
                        <p className="text-xs text-gray-400 mt-0.5 text-right">{reason.length}/500</p>
                    </div>

                    {error && (
                        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">
                            {error}
                        </div>
                    )}
                </div>

                <div className="bg-gray-50 px-6 py-4 rounded-b-xl flex justify-end gap-2">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-100"
                        disabled={submitting}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={!canSubmit}
                        className={`px-5 py-2 rounded-md text-sm font-semibold text-white ${
                            canSubmit ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-gray-300 cursor-not-allowed'
                        }`}
                    >
                        {submitting ? 'Submitting…' : 'Submit Recommendation'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default RecommendVendorModal;
