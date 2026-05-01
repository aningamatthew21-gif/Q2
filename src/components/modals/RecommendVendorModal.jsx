import React, { useState, useMemo, useEffect } from 'react';
import Icon from '../common/Icon';
import GlassModal from '../common/GlassModal';
import Button from '../common/Button';

/**
 * RecommendVendorModal — Phase 3
 *
 * Procurement officer uses this to commit their recommendation for a given vendor.
 * Submitting sends POST /api/rfqs/:id/recommend which transitions the RFQ to
 * PENDING_APPROVAL. Final award + cost pushback happens when the Procurement Head
 * approves.
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

    const footer = (
        <>
            <Button variant="secondary" onClick={onCancel} disabled={submitting}>Cancel</Button>
            <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit}>
                {submitting ? 'Submitting…' : 'Submit Recommendation'}
            </Button>
        </>
    );

    return (
        <GlassModal
            open
            onClose={onCancel}
            title="Recommend Vendor for Award"
            description="This recommendation will be sent to the Procurement Head for approval."
            size="lg"
            footer={footer}
        >
            <div className="space-y-5">
                {/* Vendor summary */}
                <div className="bg-surface-sunken border border-line rounded-card p-4">
                    <p className="text-xs text-ink-muted uppercase tracking-wide">Recommended Vendor</p>
                    <p className="text-lg font-bold text-ink mt-1">{vendor?.vendorName}</p>
                    {vendor?.contactEmail && (
                        <p className="text-sm text-ink-muted">{vendor.contactEmail}</p>
                    )}
                    <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                        <div className="bg-surface rounded-card p-2 border border-line">
                            <p className="text-[10px] text-ink-muted uppercase">Total Cost</p>
                            <p className="text-sm font-semibold text-ink">{fmtMoney(totalAmount)}</p>
                        </div>
                        <div className="bg-surface rounded-card p-2 border border-line">
                            <p className="text-[10px] text-ink-muted uppercase">Lines Quoted</p>
                            <p className="text-sm font-semibold text-ink">{respondedLines} / {totalLines}</p>
                        </div>
                        <div className="bg-surface rounded-card p-2 border border-line">
                            <p className="text-[10px] text-ink-muted uppercase">Rating</p>
                            <p className="text-sm font-semibold text-ink">{vendor?.rating ? `${vendor.rating}/5` : '—'}</p>
                        </div>
                    </div>
                </div>

                {/* Partial-response warning */}
                {isPartial && (
                    <div className="bg-warning-soft border border-warning/40 rounded-card p-4">
                        <div className="flex items-start gap-3">
                            <Icon id="exclamation-triangle" className="text-warning text-xl mt-0.5" />
                            <div className="flex-1">
                                <p className="font-semibold text-warning">Partial Response Detected</p>
                                <p className="text-sm text-ink-muted mt-1">
                                    This vendor has not quoted on all {totalLines} line items. Missing:
                                </p>
                                <ul className="text-xs text-ink mt-1 list-disc list-inside">
                                    {missingLines.slice(0, 3).map(li => (
                                        <li key={li.prId}>{li.itemName}</li>
                                    ))}
                                    {missingLines.length > 3 && (
                                        <li>… and {missingLines.length - 3} more</li>
                                    )}
                                </ul>
                                <label className="flex items-center gap-2 mt-3 text-sm text-ink cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={allowPartial}
                                        onChange={(e) => setAllowPartial(e.target.checked)}
                                        className="rounded border-warning"
                                    />
                                    <span>Allow partial award — the un-quoted lines will remain open for a future RFQ.</span>
                                </label>
                            </div>
                        </div>
                    </div>
                )}

                {/* Score field */}
                <div>
                    <label className="block text-sm font-medium text-ink mb-1">
                        Recommendation Score <span className="text-xs text-ink-subtle">(optional, 0–100)</span>
                    </label>
                    <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={score}
                        onChange={(e) => setScore(e.target.value)}
                        className="w-32 p-2 border border-line rounded-card text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none bg-surface"
                    />
                    {systemPick && (
                        <p className="text-xs text-ink-muted mt-1">
                            Pre-filled with system-calculated weighted score.
                        </p>
                    )}
                </div>

                {/* Reason */}
                <div>
                    <label className="block text-sm font-medium text-ink mb-1">
                        Recommendation Reason <span className="text-danger">*</span>
                    </label>
                    <textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        rows={3}
                        maxLength={500}
                        placeholder="e.g. Lowest total cost with fastest lead time and full line coverage."
                        className="w-full p-2 border border-line rounded-card text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none bg-surface"
                    />
                    <p className="text-xs text-ink-subtle mt-0.5 text-right">{reason.length}/500</p>
                </div>

                {error && (
                    <div className="bg-danger-soft border border-danger/30 rounded-card p-3 text-sm text-danger">
                        {error}
                    </div>
                )}
            </div>
        </GlassModal>
    );
};

export default RecommendVendorModal;
