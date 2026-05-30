/**
 * RejectWithReasonModal — Module 4
 *
 * Single dialog used everywhere an invoice or quote needs a controlled
 * rejection / win reason. Replaces the inline askText prompt with a
 * dropdown of reasons drawn from QA_REASON_CODES so the eventual
 * win/loss and cancellation-analysis reports have something to
 * GROUP BY instead of free-text strings.
 *
 * Behaviour:
 *   - Fetches `/api/reasons?category=` on open (cached by the modal mount).
 *   - When the selected reason looks competitor-related (code contains
 *     "COMPETITOR" or label mentions competitor) a free-text
 *     `lostToCompetitor` input appears so the team can capture WHO won.
 *   - Notes textarea is always available, optional but recommended.
 *   - onSubmit returns:
 *       { reasonCode, reasonLabel, lostToCompetitor, notes }
 *     so the caller can persist any subset it needs (invoice rejection
 *     stores reasonCode + lostToCompetitor; quote rejection stores
 *     reasonCode + rejectionNotes; lost-deal flow stores all three).
 *
 * Usage:
 *   <RejectWithReasonModal
 *     open={open}
 *     onClose={() => setOpen(false)}
 *     onSubmit={({ reasonCode, lostToCompetitor, notes }) => …}
 *     category="INVOICE_REJECTION"
 *     title={`Reject ${invoice.invoiceNumber}`}
 *     description="The salesperson will see this on their My Invoices view."
 *     confirmLabel="Reject invoice"
 *     confirmTone="danger"
 *     requireReason
 *   />
 */

import React, { useEffect, useMemo, useState } from 'react';
import api from '../../api';
import Dialog from '../v2/Dialog';
import Button from '../common/Button';
import Label from '../v2/Label';

const INPUT_CLASS = 'w-full p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none';

const RejectWithReasonModal = ({
    open,
    onClose,
    onSubmit,
    category,                    // one of: QUOTE_REJECTION | INVOICE_REJECTION | LOST_DEAL | WON_DEAL
    title = 'Select reason',
    description = null,
    confirmLabel = 'Confirm',
    confirmTone = 'primary',     // 'primary' | 'danger'
    requireReason = true,
    requireNotes = false
}) => {
    const [reasons, setReasons]       = useState([]);
    const [loading, setLoading]       = useState(false);
    const [error, setError]           = useState(null);
    const [reasonCode, setReasonCode] = useState('');
    const [lostToComp, setLostToComp] = useState('');
    const [notes, setNotes]           = useState('');
    const [submitting, setSubmitting] = useState(false);

    // Reset state every time the modal opens — never carry over a stale
    // selection from the previous invoice / quote.
    useEffect(() => {
        if (!open) return;
        setReasonCode('');
        setLostToComp('');
        setNotes('');
        setError(null);
        if (!category) return;
        let cancelled = false;
        setLoading(true);
        api.get(`/reasons?category=${encodeURIComponent(category)}`)
            .then(res => {
                if (cancelled) return;
                setReasons(res?.data || []);
            })
            .catch(err => {
                if (cancelled) return;
                console.error('[RejectWithReasonModal] failed to load reasons:', err.message);
                setError('Could not load reason list. Use the notes field to capture context.');
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [open, category]);

    // Which reason did the user pick? Used to conditionally surface the
    // "competitor name" input.
    const selected = useMemo(
        () => reasons.find(r => r.code === reasonCode) || null,
        [reasons, reasonCode]
    );
    const isCompetitorReason = useMemo(() => {
        if (!selected) return false;
        const code  = selected.code  || '';
        const label = (selected.label || '').toLowerCase();
        return code.includes('COMPETITOR') || label.includes('competitor');
    }, [selected]);

    const canSubmit = (!requireReason || !!reasonCode) && (!requireNotes || notes.trim().length > 0);

    const handleConfirm = async () => {
        setError(null);
        if (!canSubmit) {
            setError(requireReason && !reasonCode
                ? 'Please pick a reason from the list.'
                : 'Please add a short note before confirming.'
            );
            return;
        }
        setSubmitting(true);
        try {
            await onSubmit?.({
                reasonCode:       reasonCode || null,
                reasonLabel:      selected?.label || null,
                lostToCompetitor: isCompetitorReason && lostToComp.trim()
                    ? lostToComp.trim().slice(0, 120)
                    : null,
                notes:            notes.trim() || null
            });
            // Parent decides whether to close — leaves room for
            // server-side validation errors to keep the modal open.
        } catch (err) {
            const msg = err?.response?.data?.error || err?.message || 'Submit failed.';
            setError(msg);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog
            open={open}
            onClose={submitting ? undefined : onClose}
            title={title}
            description={description}
            size="md"
        >
            <div className="space-y-4">
                {error && (
                    <div className="p-3 rounded border border-red-200 bg-red-50 text-sm text-red-700">{error}</div>
                )}

                <div>
                    <Label className="block text-xs font-medium text-gray-600 mb-1" required={requireReason}>
                        Reason
                    </Label>
                    {loading ? (
                        <div className="text-xs text-gray-500 italic p-2">Loading reasons…</div>
                    ) : reasons.length === 0 ? (
                        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                            No reason codes available for this action yet. An admin can seed them under System &rarr; Reason Codes.
                            You can still confirm using the notes field below.
                        </div>
                    ) : (
                        <select
                            value={reasonCode}
                            onChange={(e) => setReasonCode(e.target.value)}
                            className={INPUT_CLASS}
                            disabled={submitting}
                        >
                            <option value="">— pick one —</option>
                            {reasons.map(r => (
                                <option key={r.code} value={r.code}>{r.label}</option>
                            ))}
                        </select>
                    )}
                </div>

                {isCompetitorReason && (
                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                            Lost to which competitor?
                            <span className="font-normal text-gray-400 ml-1">(optional but recommended)</span>
                        </label>
                        <input
                            type="text"
                            value={lostToComp}
                            onChange={(e) => setLostToComp(e.target.value)}
                            placeholder="e.g. Acme Distributors"
                            maxLength={120}
                            className={INPUT_CLASS}
                            disabled={submitting}
                        />
                    </div>
                )}

                <div>
                    <Label className="block text-xs font-medium text-gray-600 mb-1" required={requireNotes}>
                        Notes
                        <span className="font-normal text-gray-400 ml-1">
                            (visible to the salesperson on their queue)
                        </span>
                    </Label>
                    <textarea
                        rows={3}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Anything the team should know — pricing issue, missing spec, customer feedback…"
                        maxLength={500}
                        className={INPUT_CLASS}
                        disabled={submitting}
                    />
                    <div className="text-[10px] text-gray-400 mt-1 text-right">{notes.length}/500</div>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                    <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button>
                    <Button
                        variant={confirmTone === 'danger' ? 'danger' : 'primary'}
                        onClick={handleConfirm}
                        disabled={submitting || !canSubmit}
                    >
                        {submitting ? 'Saving…' : confirmLabel}
                    </Button>
                </div>
            </div>
        </Dialog>
    );
};

export default RejectWithReasonModal;
