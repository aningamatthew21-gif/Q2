import React, { useState } from 'react';
import Icon from '../common/Icon';
import { formatCurrency } from '../../utils/formatting';

/**
 * Phase 4 — Re-Approval Banner
 *
 * Shown at the top of an invoice that has `requiresReapproval === true`.
 * Surfaces the original-vs-final comparison and offers two actions:
 *   - Accept New Total (keeps the sourced numbers, clears the flag)
 *   - Revise Quote (rejects the sourcing outcome, bounces the invoice back
 *     to "Pending Pricing" so the user can adjust line items)
 *
 * Props:
 *   invoice      — the full invoice object (must include originalEstimate,
 *                  total, currency, reapprovalVariance, reapprovalReason).
 *   canAct       — true if current user may submit a decision.
 *   onDecision   — async ({ decision, note }) => void
 *   submitting   — parent-controlled loading flag.
 */
const ReApprovalBanner = ({ invoice, canAct, onDecision, submitting }) => {
    const [note, setNote] = useState('');
    const [mode, setMode] = useState(null); // 'accept' | 'reject' | null

    if (!invoice || !invoice.requiresReapproval) return null;

    const original = Number(invoice.originalEstimate || 0);
    const final = Number(invoice.total || 0);
    const delta = final - original;
    const variancePct = Number(invoice.reapprovalVariance || 0);
    const increased = delta > 0;
    const currency = invoice.currency || 'GHS';

    const submit = async () => {
        if (!mode) return;
        await onDecision({ decision: mode, note: note.trim() || null });
        setMode(null);
        setNote('');
    };

    return (
        <div className="bg-amber-50 border-l-4 border-amber-500 rounded-xl p-6 mb-6 shadow-sm">
            <div className="flex items-start gap-3 mb-4">
                <Icon id="exclamation-triangle" className="text-2xl text-amber-600 mt-0.5" />
                <div className="flex-1">
                    <h3 className="text-base font-semibold text-amber-900">
                        Quote Requires Re-Approval
                    </h3>
                    <p className="text-sm text-amber-800 mt-1">
                        {invoice.reapprovalReason || 'Sourcing materially changed the invoice total.'}
                    </p>
                </div>
            </div>

            {/* Original vs Final comparison */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                <div className="bg-white rounded-lg p-4 border border-amber-200">
                    <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">Original Estimate</div>
                    <div className="text-xl font-bold text-gray-800">{formatCurrency(currency, original)}</div>
                    <div className="text-xs text-gray-500 mt-1">At quote creation</div>
                </div>
                <div className="bg-white rounded-lg p-4 border border-amber-200">
                    <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">Final Total After Sourcing</div>
                    <div className={`text-xl font-bold ${increased ? 'text-red-600' : 'text-emerald-600'}`}>
                        {formatCurrency(currency, final)}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">Post cost pushback</div>
                </div>
                <div className={`rounded-lg p-4 border ${increased ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
                    <div className="text-xs uppercase tracking-wide font-semibold mb-1 text-gray-500">
                        Variance
                    </div>
                    <div className={`text-xl font-bold ${increased ? 'text-red-700' : 'text-emerald-700'}`}>
                        <Icon id={increased ? 'arrow-up' : 'arrow-down'} className="mr-1" />
                        {variancePct.toFixed(2)}%
                    </div>
                    <div className={`text-xs mt-1 ${increased ? 'text-red-600' : 'text-emerald-600'}`}>
                        {increased ? '+' : ''}{formatCurrency(currency, delta)}
                    </div>
                </div>
            </div>

            {/* Already decided */}
            {invoice.reapprovedAt && !invoice.requiresReapproval && (
                <div className="text-xs text-gray-600 italic">
                    Re-approved by {invoice.reapprovedBy} on {new Date(invoice.reapprovedAt).toLocaleString()}
                </div>
            )}

            {/* Action area */}
            {canAct && (
                <div className="mt-4 pt-4 border-t border-amber-200">
                    {!mode ? (
                        <div className="flex flex-col sm:flex-row gap-2">
                            <button
                                type="button"
                                onClick={() => setMode('accept')}
                                disabled={submitting}
                                className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-md transition-colors disabled:opacity-50"
                            >
                                <Icon id="check-circle" className="mr-2" />
                                Accept New Total
                            </button>
                            <button
                                type="button"
                                onClick={() => setMode('reject')}
                                disabled={submitting}
                                className="flex-1 px-4 py-2 bg-white border border-amber-400 text-amber-800 hover:bg-amber-100 text-sm font-semibold rounded-md transition-colors disabled:opacity-50"
                            >
                                <Icon id="undo" className="mr-2" />
                                Revise Quote
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className={`text-sm font-semibold ${mode === 'accept' ? 'text-emerald-800' : 'text-amber-800'}`}>
                                {mode === 'accept'
                                    ? 'Confirm: accept the new total and release this quote to the customer.'
                                    : 'Confirm: bounce back to Pending Pricing so line items can be revised.'}
                            </div>
                            <textarea
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                placeholder="Optional note (for audit trail)"
                                rows={2}
                                maxLength={500}
                                className="w-full p-2 border border-gray-300 rounded-md text-sm"
                            />
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={submit}
                                    disabled={submitting}
                                    className={`px-4 py-2 text-white text-sm font-semibold rounded-md disabled:opacity-50 ${
                                        mode === 'accept' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700'
                                    }`}
                                >
                                    {submitting ? 'Submitting…' : (mode === 'accept' ? 'Confirm Accept' : 'Confirm Revise')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { setMode(null); setNote(''); }}
                                    disabled={submitting}
                                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm rounded-md disabled:opacity-50"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {!canAct && (
                <div className="mt-2 text-xs text-amber-700">
                    Awaiting decision from the quote owner or controller.
                </div>
            )}
        </div>
    );
};

export default ReApprovalBanner;
