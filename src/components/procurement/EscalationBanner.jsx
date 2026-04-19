import React, { useState } from 'react';
import Icon from '../common/Icon';

/**
 * Phase 5 — Escalation Banner
 *
 * Surfaces stale/past-deadline RFQ risk state on the RFQDetail page:
 *
 *   - Red "Escalated" banner once ESCALATED_AT is stamped (either by the
 *     automatic staleness watcher or a manual /escalate call).
 *   - Amber "Past Deadline" + age warning when an active RFQ is past its
 *     submission deadline but has not yet been escalated.
 *
 * Props:
 *   rfq              — full RFQ object (must include isPastDeadline,
 *                      isEscalated, escalatedAt, escalatedTo,
 *                      escalationReason, daysOpen, submissionDeadline).
 *   canEscalate      — whether the current user may manually escalate.
 *   onEscalate       — async ({ reason }) => void
 *   submitting       — parent-controlled loading flag.
 */
const EscalationBanner = ({ rfq, canEscalate, onEscalate, submitting }) => {
    const [showForm, setShowForm] = useState(false);
    const [reason, setReason] = useState('');

    if (!rfq) return null;

    // If the RFQ is already escalated → show the red banner.
    if (rfq.isEscalated) {
        return (
            <div className="bg-red-50 border-l-4 border-red-600 rounded-xl p-5 mb-6 shadow-sm">
                <div className="flex items-start gap-3">
                    <Icon id="exclamation-circle" className="text-2xl text-red-600 mt-0.5" />
                    <div className="flex-1">
                        <div className="flex items-center flex-wrap gap-2">
                            <h3 className="text-base font-semibold text-red-900">Escalated to Procurement Head</h3>
                            <span className="text-xs px-2 py-0.5 bg-red-600 text-white rounded-full font-semibold">
                                ESCALATED
                            </span>
                        </div>
                        <p className="text-sm text-red-800 mt-1">
                            {rfq.escalationReason || 'This RFQ has been flagged as stale and raised to management.'}
                        </p>
                        <div className="mt-2 text-xs text-red-700 space-y-0.5">
                            {rfq.escalatedAt && (
                                <div><strong>Escalated at:</strong> {new Date(rfq.escalatedAt).toLocaleString()}</div>
                            )}
                            {rfq.escalatedTo && (
                                <div><strong>Notified:</strong> {rfq.escalatedTo}</div>
                            )}
                            {rfq.daysOpen != null && (
                                <div><strong>RFQ age:</strong> {rfq.daysOpen} day{rfq.daysOpen === 1 ? '' : 's'}</div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // Active + past deadline and not yet escalated → amber warning with a
    // manual-escalate button for procurement/controller.
    if (rfq.isPastDeadline) {
        return (
            <div className="bg-amber-50 border-l-4 border-amber-500 rounded-xl p-5 mb-6 shadow-sm">
                <div className="flex items-start gap-3 mb-3">
                    <Icon id="clock" className="text-2xl text-amber-600 mt-0.5" />
                    <div className="flex-1">
                        <h3 className="text-base font-semibold text-amber-900">
                            Past Submission Deadline
                        </h3>
                        <p className="text-sm text-amber-800 mt-1">
                            This RFQ is still in <strong>{rfq.status}</strong> but the submission deadline
                            {rfq.submissionDeadline && <> (<strong>{rfq.submissionDeadline}</strong>)</>} has already passed.
                            {rfq.daysOpen != null && <> It has been open for <strong>{rfq.daysOpen}</strong> day{rfq.daysOpen === 1 ? '' : 's'}.</>}
                        </p>
                        <p className="text-xs text-amber-700 mt-2">
                            Consider sending reminders to non-responders, or escalate to procurement head.
                        </p>
                    </div>
                </div>

                {canEscalate && (
                    <div className="pl-9">
                        {!showForm ? (
                            <button
                                type="button"
                                onClick={() => setShowForm(true)}
                                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-md"
                            >
                                <Icon id="exclamation-triangle" className="mr-2" />
                                Escalate Now
                            </button>
                        ) : (
                            <div className="space-y-2 max-w-xl">
                                <textarea
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                    placeholder="Reason for escalation (optional)"
                                    rows={2}
                                    maxLength={500}
                                    className="w-full p-2 border border-amber-300 rounded-md text-sm"
                                />
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        disabled={submitting}
                                        onClick={async () => {
                                            await onEscalate({ reason: reason.trim() || null });
                                            setShowForm(false);
                                            setReason('');
                                        }}
                                        className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-md disabled:opacity-50"
                                    >
                                        {submitting ? 'Escalating…' : 'Confirm Escalation'}
                                    </button>
                                    <button
                                        type="button"
                                        disabled={submitting}
                                        onClick={() => { setShowForm(false); setReason(''); }}
                                        className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm rounded-md disabled:opacity-50"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    }

    return null;
};

export default EscalationBanner;
