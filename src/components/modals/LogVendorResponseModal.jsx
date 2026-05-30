import React, { useState, useMemo, useEffect } from 'react';
import GlassModal from '../common/GlassModal';
import Button from '../common/Button';
import FileDropzone from '../v2/FileDropzone';
import Label from '../v2/Label';
import RequiredMark from '../v2/RequiredMark';
import { Paperclip, Download, FileText } from 'lucide-react';
import api from '../../api';

const INPUT_CLASS = 'p-1.5 border border-line rounded-card text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none bg-surface';
const INPUT_CLASS_WIDE = 'w-full p-2 border border-line rounded-card text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none bg-surface';

/**
 * LogVendorResponseModal
 * Bulk-entry: log a vendor's quoted prices for ALL line items in one form.
 * Shared fields (delivery terms, payment terms, validity, received date) apply to every line.
 * Individual fields (unit cost, freight, lead time) are per-line.
 *
 * Edit mode: when the vendor already has logged responses on this RFQ, the
 * modal pre-fills every line + shared field + lists existing attachments
 * with download links. Saving an empty attachment list preserves the
 * existing files (only a non-empty upload replaces them).
 */
const LogVendorResponseModal = ({ rfq, vendor, onSave, onCancel, defaultPrId }) => {
    // Existing responses for THIS vendor on THIS RFQ — used to detect edit
    // mode and pre-fill the form.
    const existingResponses = useMemo(
        () => (rfq.responses || []).filter(r => r.vendorId === vendor.vendorId),
        [rfq.responses, vendor.vendorId]
    );
    const isEditMode = existingResponses.length > 0;
    const firstExisting = existingResponses[0] || null;

    // Per-line state keyed by prId — pre-filled from existing responses when present
    const [lines, setLines] = useState(() =>
        rfq.lineItems.map(li => {
            const ex = existingResponses.find(r => r.prId === li.prId);
            return {
                prId: li.prId,
                itemName: li.itemName,
                quantity: li.quantity,
                uom: li.uom || 'EA',
                prNumber: li.prNumber,
                unitCost: ex && ex.unitCost > 0 ? String(ex.unitCost) : '',
                freight: ex ? String(ex.freight || 0) : '0',
                leadTimeDays: ex && ex.leadTimeDays > 0 ? String(ex.leadTimeDays) : '',
            };
        })
    );

    // Shared fields — pre-fill from the first existing response if any
    const [deliveryTerms, setDeliveryTerms] = useState(firstExisting?.deliveryTerms || '');
    const [paymentTerms, setPaymentTerms]   = useState(firstExisting?.paymentTerms || '');
    const [validityDays, setValidityDays]   = useState(firstExisting?.validityDays ? String(firstExisting.validityDays) : '30');
    const [receivedDate, setReceivedDate]   = useState(() => {
        if (firstExisting?.receivedDate) {
            // Oracle returns Date objects; trim to YYYY-MM-DD for the input
            try { return new Date(firstExisting.receivedDate).toISOString().slice(0, 10); }
            catch (_) { return new Date().toISOString().slice(0, 10); }
        }
        return new Date().toISOString().slice(0, 10);
    });
    const [notes, setNotes]                 = useState(firstExisting?.notes || '');
    const [submitting, setSubmitting]       = useState(false);
    const [savedCount, setSavedCount]       = useState(0);
    const [saveError, setSaveError]         = useState(null);

    // New attachments (uploaded this session)
    const [attachments, setAttachments]     = useState([]);
    // Existing attachments fetched from the backend on mount
    const [existingAttachments, setExistingAttachments] = useState([]);
    const [loadingAttachments, setLoadingAttachments]   = useState(isEditMode);

    // Fetch existing attachment metadata in edit mode
    useEffect(() => {
        if (!isEditMode) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await api.get(`/rfqs/${rfq.id}/responses/${vendor.vendorId}/attachments`);
                if (!cancelled && res?.success) {
                    setExistingAttachments(res.data || []);
                }
            } catch (e) {
                // Non-fatal — existing attachments just won't be shown
                console.warn('[LogVendorResponseModal] failed to load attachments:', e.message);
            } finally {
                if (!cancelled) setLoadingAttachments(false);
            }
        })();
        return () => { cancelled = true; };
    }, [isEditMode, rfq.id, vendor.vendorId]);

    const handleDownloadExisting = async (att) => {
        try {
            // Use raw fetch to get the binary blob with auth header
            const token = localStorage.getItem('auth_token');
            const resp = await fetch(
                `/api/rfqs/${rfq.id}/responses/${vendor.vendorId}/attachments/${att.attachmentId}/download`,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            if (!resp.ok) throw new Error('Download failed');
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = att.fileName || 'attachment';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error('[LogVendorResponseModal] download failed:', e.message);
        }
    };

    const updateLine = (prId, field, value) => {
        setLines(prev => prev.map(l => l.prId === prId ? { ...l, [field]: value } : l));
    };

    const filledLines = useMemo(() => lines.filter(l => Number(l.unitCost) > 0), [lines]);
    // In edit mode, existing attachments satisfy the "attached" requirement
    const hasAnyAttachment = attachments.length > 0 || existingAttachments.length > 0;
    const canSave = filledLines.length > 0 && hasAnyAttachment;

    const grandTotal = useMemo(() =>
        lines.reduce((acc, l) => acc + (Number(l.unitCost || 0) * l.quantity) + Number(l.freight || 0), 0),
        [lines]
    );

    const handleSave = async () => {
        if (!canSave) return;
        setSubmitting(true);
        setSaveError(null);
        let saved = 0;
        try {
            // Trim each attachment payload to what the backend should persist:
            //   { name, type, size, dataUrl }
            // The original File objects don't serialise — keep them out of the
            // wire payload.
            const attPayload = attachments.map(a => ({
                name:    a.name,
                type:    a.type,
                size:    a.size,
                dataUrl: a.dataUrl
            }));

            for (let i = 0; i < filledLines.length; i++) {
                const l = filledLines[i];
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
                    // Send attachments with the FIRST line only so the
                    // parent doesn't store duplicates per line. Backend
                    // replaces existing attachments only when the array is
                    // non-empty — leaving it empty preserves existing files.
                    attachments: i === 0 ? attPayload : []
                });
                saved++;
                setSavedCount(saved);
            }
        } catch (err) {
            // Surface the error inside the modal — the parent's toast
            // notification ends up behind this dialog so the user never
            // sees it otherwise.
            const status = err?.response?.status;
            const body   = err?.response?.data;
            const msg    = body?.error || err?.message || 'Unknown error';
            setSaveError(`Save failed${status ? ` (${status})` : ''}: ${msg}`);
        } finally {
            setSubmitting(false);
        }
    };

    const formatBytes = (n) => {
        if (!n) return '0 KB';
        if (n < 1024) return `${n} B`;
        if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
        return `${(n / 1024 / 1024).toFixed(2)} MB`;
    };

    const footer = (
        <div className="flex justify-between items-center w-full gap-3">
            <p className="text-xs text-ink-muted">
                {filledLines.length} of {lines.length} items priced &middot;{' '}
                {existingAttachments.length > 0 && (
                    <>{existingAttachments.length} existing</>
                )}
                {existingAttachments.length > 0 && attachments.length > 0 && ' + '}
                {attachments.length > 0 && (
                    <>{attachments.length} new</>
                )}
                {!hasAnyAttachment && '0 attachments'}
                {filledLines.length > 0 && !hasAnyAttachment && (
                    <span className="ml-2 text-err font-medium">— attach the signed RFQ to continue</span>
                )}
            </p>
            <div className="flex gap-3">
                <Button variant="secondary" onClick={onCancel}>Cancel</Button>
                <Button
                    variant="primary"
                    onClick={handleSave}
                    disabled={!canSave || submitting}
                >
                    {submitting
                        ? `Saving ${savedCount}/${filledLines.length}…`
                        : (isEditMode
                            ? `Update ${filledLines.length} Response(s)`
                            : `Save ${filledLines.length} Response(s)`)}
                </Button>
            </div>
        </div>
    );

    return (
        <GlassModal
            open
            onClose={onCancel}
            title={isEditMode ? 'Edit Vendor Response' : 'Log Vendor Response'}
            description={<><strong className="text-ink">{vendor.vendorName}</strong> &middot; RFQ {rfq.rfqNumber} &middot; {rfq.lineItems.length} line item(s)</>}
            size="xl"
            footer={footer}
        >
            {isEditMode ? (
                <div className="mb-3 p-2 rounded border border-info/30 bg-info-soft text-xs text-info">
                    Editing the existing response logged
                    {firstExisting?.loggedBy && <> by <strong>{firstExisting.loggedBy}</strong></>}.
                    Update prices, lead times, or shared fields below. Existing attachments are kept unless you upload replacements.
                </div>
            ) : (
                <p className="text-xs text-info mb-3">Enter unit costs for each item below. Leave blank to skip items the vendor didn't quote on.</p>
            )}

            {saveError && (
                <div className="mb-3 p-3 rounded border border-red-300 bg-red-50 text-sm text-red-800">
                    {saveError}
                </div>
            )}

            <div className="space-y-5">
                {/* Per-line pricing table */}
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-surface-sunken border-b border-line">
                            <tr>
                                <th className="p-2 text-left text-xs text-ink-muted font-medium">Item</th>
                                <th className="p-2 text-center text-xs text-ink-muted font-medium">Qty</th>
                                <th className="p-2 text-left text-xs text-ink-muted font-medium">Unit Cost ({rfq.currency || 'GHS'})<RequiredMark /></th>
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

                {/* Existing attachments (edit mode) */}
                {isEditMode && (
                    <div>
                        <div className="flex items-center gap-2 mb-2">
                            <FileText className="w-3.5 h-3.5 text-n-500" />
                            <label className="text-[12px] font-semibold text-n-700">
                                Existing attachments {!loadingAttachments && `(${existingAttachments.length})`}
                            </label>
                        </div>
                        {loadingAttachments ? (
                            <div className="text-xs text-ink-subtle p-2">Loading attachments…</div>
                        ) : existingAttachments.length === 0 ? (
                            <div className="text-xs text-ink-subtle p-2 border border-dashed border-line rounded">
                                No attachments on file. Upload the signed RFQ + any quotation document below.
                            </div>
                        ) : (
                            <ul className="border border-line rounded divide-y divide-line">
                                {existingAttachments.map(att => (
                                    <li key={att.attachmentId} className="flex items-center justify-between p-2 text-sm hover:bg-surface-sunken">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <FileText className="w-4 h-4 text-ink-muted flex-shrink-0" />
                                            <div className="min-w-0">
                                                <div className="font-medium text-ink truncate">{att.fileName}</div>
                                                <div className="text-xs text-ink-subtle">
                                                    {formatBytes(att.fileSize)}
                                                    {att.uploadedBy && <> &middot; {att.uploadedBy}</>}
                                                </div>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleDownloadExisting(att)}
                                            className="ml-3 flex items-center gap-1 text-xs text-primary hover:underline flex-shrink-0"
                                            title="Download"
                                        >
                                            <Download className="w-3.5 h-3.5" /> Download
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}

                {/* Attachments — in edit mode this UPLOADS replacements; in
                    create mode at least one file is required. */}
                <div>
                    <div className="flex items-center gap-2 mb-2">
                        <Paperclip className="w-3.5 h-3.5 text-n-500" />
                        <Label className="text-[12px] font-semibold text-n-700" required={!isEditMode}>
                            {isEditMode ? 'Replace attachments' : 'Vendor attachments'}
                        </Label>
                    </div>
                    <FileDropzone
                        value={attachments}
                        onChange={setAttachments}
                        accept="application/pdf,image/png,image/jpeg,image/jpg,image/heic"
                        multiple
                        maxFileSizeMB={10}
                        required={!isEditMode}
                        hint={isEditMode
                            ? "Optional — upload new files to REPLACE the existing list. Leave empty to keep the files above."
                            : "Attach the vendor's signed RFQ. Add the quotation, technical sheets, or any covering letter as additional files. At least one file is required."}
                    />
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
