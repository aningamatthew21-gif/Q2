/**
 * CancelPrModal — Module 3 controlled-vocabulary PR cancellation.
 *
 * Replaces the inline `askText` cancellation prompt used in
 * PurchaseRequisitionDetail.jsx with a structured form that captures
 * BOTH a controlled reason code (for reporting) AND optional free-text
 * notes (for context). The backend cancel endpoint already accepts both
 * shapes — passing only the legacy `reason` still works for any callers
 * that haven't been migrated.
 *
 * Wiring:
 *   <CancelPrModal
 *     open={open}
 *     onClose={() => setOpen(false)}
 *     pr={pr}                    // { id, prNumber }
 *     onCancelled={() => fetchPR()}
 *   />
 */

import React, { useEffect, useState } from 'react';
import api from '../../api';
import Dialog from '../v2/Dialog';
import Button from '../common/Button';
import Label from '../v2/Label';

const CANCELLATION_REASONS = [
    { value: 'DUPLICATE',              label: 'Duplicate requisition' },
    { value: 'STOCK_REAPPEARED',       label: 'Stock reappeared in inventory' },
    { value: 'CUSTOMER_CANCELLED',     label: 'Customer cancelled the order' },
    { value: 'VENDOR_UNAVAILABLE',     label: 'No vendor available' },
    { value: 'BUDGET_EXCEEDED',        label: 'Budget exceeded / not approved' },
    { value: 'LEAD_TIME_UNACCEPTABLE', label: 'Vendor lead time unacceptable' },
    { value: 'SOURCED_INTERNALLY',     label: 'Sourced internally / alternative found' },
    { value: 'OTHER',                  label: 'Other (please specify in notes)' }
];

const CancelPrModal = ({ open, onClose, pr, onCancelled }) => {
    const [reason, setReason] = useState('');
    const [notes, setNotes]   = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError]   = useState(null);

    useEffect(() => {
        if (!open) return;
        setReason('');
        setNotes('');
        setError(null);
    }, [open]);

    const handleSubmit = async () => {
        if (!pr?.id) { setError('No PR linked.'); return; }
        if (!reason) { setError('Pick a cancellation reason.'); return; }
        if (reason === 'OTHER' && !notes.trim()) {
            setError('Please describe the reason in notes when choosing "Other".');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const res = await api.post(`/purchase-requisitions/${pr.id}/cancel`, {
                cancellationReason: reason,
                cancellationNotes:  notes || null
            });
            if (res?.success) {
                onCancelled?.();
                onClose();
            } else {
                setError(res?.error || 'Could not cancel PR.');
            }
        } catch (err) {
            const status = err?.response?.status;
            const msg    = err?.response?.data?.error || err?.message || 'Unknown error';
            setError(`Failed to cancel${status ? ` (${status})` : ''}: ${msg}`);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog
            open={open}
            onClose={saving ? undefined : onClose}
            title={`Cancel ${pr?.prNumber || pr?.id || 'PR'}?`}
            description="The PR will be moved to CANCELLED. Pick a reason so we can categorise it in the cancellation-reasons report."
            size="md"
        >
            <div className="space-y-3">
                {error && (
                    <div className="p-3 rounded border border-red-200 bg-red-50 text-sm text-red-700">{error}</div>
                )}

                <div>
                    <Label className="block text-xs font-medium text-gray-600 mb-1" required>Cancellation Reason</Label>
                    <select
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded text-sm"
                    >
                        <option value="">— Select reason —</option>
                        {CANCELLATION_REASONS.map(r => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                    </select>
                </div>

                <div>
                    <Label className="block text-xs font-medium text-gray-600 mb-1" required={reason === 'OTHER'}>
                        Notes
                    </Label>
                    <textarea
                        rows={3}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder={reason === 'OTHER' ? 'Required when reason is Other' : 'Optional context for the audit trail'}
                        className="w-full p-2 border border-gray-300 rounded text-sm"
                    />
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                    <Button variant="ghost" onClick={onClose} disabled={saving}>Keep PR</Button>
                    <Button variant="danger" onClick={handleSubmit} disabled={saving || !reason}>
                        {saving ? 'Cancelling…' : 'Cancel Requisition'}
                    </Button>
                </div>
            </div>
        </Dialog>
    );
};

export default CancelPrModal;
