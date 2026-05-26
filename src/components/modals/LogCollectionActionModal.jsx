/**
 * LogCollectionActionModal — Module 2 collections follow-up logger.
 *
 * Records call/email/meeting/note events against an invoice along with
 * the outcome and any promise-to-pay date. Surfaced from the Overdue
 * Invoices tab of the Collections Workbench and from InvoiceEditor's
 * "Payments" section.
 *
 * Wiring:
 *   <LogCollectionActionModal
 *     open={openLogAction}
 *     onClose={() => setOpenLogAction(false)}
 *     invoiceId={invoice.id}
 *     invoiceNumber={invoice.invoiceNumber}
 *     onLogged={() => fetchActions()}
 *   />
 */

import React, { useEffect, useState } from 'react';
import api from '../../api';
import Dialog from '../v2/Dialog';
import Button from '../common/Button';

const ACTION_TYPES = [
    { value: 'CALL',            label: 'Phone call' },
    { value: 'EMAIL',           label: 'Email' },
    { value: 'SMS',             label: 'SMS' },
    { value: 'MEETING',         label: 'Meeting' },
    { value: 'NOTE',            label: 'Internal note' },
    { value: 'STATEMENT_SENT',  label: 'Statement sent' },
    { value: 'DISPUTE_LOGGED',  label: 'Dispute logged' }
];

const OUTCOMES = [
    { value: '',              label: '— Select outcome —' },
    { value: 'PROMISED',      label: 'Customer promised to pay' },
    { value: 'DISPUTED',      label: 'Customer disputed the invoice' },
    { value: 'NO_ANSWER',     label: 'No answer / no response' },
    { value: 'LEFT_MESSAGE',  label: 'Left a message' },
    { value: 'RESOLVED',      label: 'Resolved' },
    { value: 'ESCALATED',     label: 'Escalated to head' }
];

const LogCollectionActionModal = ({
    open,
    onClose,
    invoiceId,
    invoiceNumber,
    onLogged
}) => {
    const [actionType, setActionType] = useState('CALL');
    const [outcome, setOutcome]       = useState('');
    const [ptpDate, setPtpDate]       = useState('');
    const [nextDate, setNextDate]     = useState('');
    const [notes, setNotes]           = useState('');
    const [saving, setSaving]         = useState(false);
    const [error, setError]           = useState(null);

    useEffect(() => {
        if (!open) return;
        setActionType('CALL');
        setOutcome('');
        setPtpDate('');
        setNextDate('');
        setNotes('');
        setError(null);
    }, [open]);

    const handleSubmit = async () => {
        if (!invoiceId) { setError('Missing invoice id.'); return; }
        if (!actionType) { setError('Pick an action type.'); return; }
        setSaving(true); setError(null);
        try {
            const res = await api.post('/collections/actions', {
                invoiceId,
                actionType,
                outcome:          outcome || null,
                promiseToPayDate: outcome === 'PROMISED' ? (ptpDate || null) : null,
                nextActionDate:   nextDate || null,
                notes:            notes || null
            });
            if (res?.success) {
                onLogged?.();
                onClose();
            } else {
                setError(res?.error || 'Could not save action.');
            }
        } catch (err) {
            const msg = err?.response?.data?.error || err?.message || 'Unknown error';
            setError(`Failed to log action: ${msg}`);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog
            open={open}
            onClose={saving ? undefined : onClose}
            title={`Log follow-up${invoiceNumber ? ` · ${invoiceNumber}` : ''}`}
            description="Records the contact in the invoice's collections history."
            size="md"
        >
            <div className="space-y-3">
                {error && (
                    <div className="p-3 rounded border border-red-200 bg-red-50 text-sm text-red-700">
                        {error}
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Action</label>
                        <select
                            value={actionType}
                            onChange={(e) => setActionType(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded text-sm"
                        >
                            {ACTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Outcome</label>
                        <select
                            value={outcome}
                            onChange={(e) => setOutcome(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded text-sm"
                        >
                            {OUTCOMES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    </div>
                    {outcome === 'PROMISED' && (
                        <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Promised pay date</label>
                            <input
                                type="date"
                                value={ptpDate}
                                onChange={(e) => setPtpDate(e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded text-sm"
                            />
                        </div>
                    )}
                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Next follow-up</label>
                        <input
                            type="date"
                            value={nextDate}
                            onChange={(e) => setNextDate(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded text-sm"
                        />
                    </div>
                </div>

                <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                    <textarea
                        rows={3}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded text-sm"
                        placeholder="What was said / agreed? Any context that helps the next follow-up."
                    />
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                    <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
                    <Button variant="primary" onClick={handleSubmit} disabled={saving}>
                        {saving ? 'Saving…' : 'Save Action'}
                    </Button>
                </div>
            </div>
        </Dialog>
    );
};

export default LogCollectionActionModal;
