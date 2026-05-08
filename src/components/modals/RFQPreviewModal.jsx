import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import JSZip from 'jszip';
import { PDFService } from '../../services/PDFService';
import GlassModal from '../common/GlassModal';
import Button from '../common/Button';

/**
 * RFQPreviewModal — Multi-vendor RFQ PDF preview.
 *
 * Uses GlassModal with `size="full"` to give this a workspace-grade
 * footprint (this isn't a typical "moment" modal — it's a multi-pane
 * PDF reviewer). All existing tabs + toolbar + footer actions stay.
 */
export default function RFQPreviewModal({ open, onClose, rfqData, onConfirmSend, onSaveDraft }) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [vendorPDFs, setVendorPDFs] = useState([]); // [{ vendor, blobUrl, pdfDoc }]
    const [activeIdx, setActiveIdx] = useState(0);
    const [zoom, setZoom] = useState('page-width');
    const [sending, setSending] = useState(false);
    const iframeRef = useRef(null);
    // Track blob URLs so we can revoke them on close to avoid memory leaks
    const blobUrlsRef = useRef([]);

    // Revoke all blob URLs and clear the ref
    const revokeBlobUrls = useCallback(() => {
        blobUrlsRef.current.forEach(url => {
            try { URL.revokeObjectURL(url); } catch (_) {}
        });
        blobUrlsRef.current = [];
    }, []);

    // Generate PDFs when modal opens; revoke previous blobs first
    useEffect(() => {
        if (!open || !rfqData) return;

        // Cleanup any blobs from a prior open
        revokeBlobUrls();
        setError(null);
        setVendorPDFs([]);
        setActiveIdx(0);
        setLoading(true);

        const generate = async () => {
            try {
                const vendors = rfqData.vendors || [];
                if (vendors.length === 0) {
                    setError('No vendors selected.');
                    setLoading(false);
                    return;
                }

                const results = [];
                for (const vendor of vendors) {
                    const vendorRfqData = {
                        ...rfqData,
                        vendor: {
                            name: vendor.vendorName || vendor.name || '—',
                            contactPerson: vendor.contactPerson || '',
                            contactEmail: vendor.contactEmail || '',
                            contactPhone: vendor.contactPhone || '',
                            address: vendor.address || '',
                        },
                    };
                    const pdf = await PDFService.generateRFQPDF(vendorRfqData);
                    const arrayBuffer = pdf.output('arraybuffer');
                    const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
                    const blobUrl = URL.createObjectURL(blob);
                    blobUrlsRef.current.push(blobUrl);
                    results.push({
                        vendor,
                        blobUrl,
                        pdfDoc: pdf,
                    });
                }

                setVendorPDFs(results);
                setLoading(false);
            } catch (err) {
                console.error('RFQ PDF generation failed:', err);
                setError(err.message || 'Failed to generate RFQ previews.');
                setLoading(false);
            }
        };

        generate();

        return () => revokeBlobUrls();
    }, [open, rfqData, revokeBlobUrls]);

    useEffect(() => {
        if (!iframeRef.current || vendorPDFs.length === 0) return;
        const current = vendorPDFs[activeIdx];
        if (!current) return;
        const zoomParam = encodeURIComponent(zoom);
        iframeRef.current.src = `${current.blobUrl}#zoom=${zoomParam}&page=1`;
    }, [activeIdx, zoom, vendorPDFs]);

    const activeVendor = vendorPDFs[activeIdx]?.vendor;

    const buildFileName = useCallback((vendor) => {
        const vName = (vendor.vendorName || vendor.name || 'Vendor').replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '-');
        const rfqNum = (rfqData?.rfqNumber || 'RFQ').replace(/[^a-zA-Z0-9-]/g, '');
        const date = new Date().toISOString().slice(0, 10);
        return `${vName}-${rfqNum}-${date}.pdf`;
    }, [rfqData]);

    const downloadSingle = useCallback((idx) => {
        const entry = vendorPDFs[idx];
        if (!entry) return;
        const fileName = buildFileName(entry.vendor);
        const link = document.createElement('a');
        link.href = entry.blobUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }, [vendorPDFs, buildFileName]);

    // The previous downloadAll fired N anchor-clicks staggered by 300ms.
    // Browsers throttle / block rapid programmatic downloads from the same
    // origin and only the first one or two would actually save — exactly
    // the bug the user reported. We now bundle every vendor PDF into a
    // single ZIP and trigger one download. One file, zero race condition.
    const downloadAll = useCallback(async () => {
        if (vendorPDFs.length === 0) return;
        if (vendorPDFs.length === 1) { downloadSingle(0); return; }
        try {
            const zip = new JSZip();
            for (const entry of vendorPDFs) {
                const fileName = buildFileName(entry.vendor);
                // pdfDoc.output('arraybuffer') gives a fresh AB so this is safe
                // even after the blob URL was created earlier.
                const ab = entry.pdfDoc.output('arraybuffer');
                zip.file(fileName, ab);
            }
            const rfqNum = (rfqData?.rfqNumber || 'RFQ').replace(/[^a-zA-Z0-9-]/g, '');
            const date   = new Date().toISOString().slice(0, 10);
            const zipName = `${rfqNum}-vendor-pdfs-${date}.zip`;
            const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = zipName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(url), 1500);
        } catch (err) {
            console.error('[RFQPreviewModal] downloadAll (zip) failed', err);
            // Fallback: serial downloads with a long enough gap that the
            // browser doesn't block them.
            for (let i = 0; i < vendorPDFs.length; i++) {
                downloadSingle(i);
                // Wait long enough that Chrome doesn't squelch the next click.
                // 1000ms is the smallest interval that's reliable in our tests.
                await new Promise(r => setTimeout(r, 1000));
            }
        }
    }, [vendorPDFs, downloadSingle, buildFileName, rfqData]);

    const emailVendor = useCallback((idx) => {
        const entry = vendorPDFs[idx];
        if (!entry) return;
        const vendor = entry.vendor;
        const email = vendor.contactEmail;
        if (!email) {
            alert(`No email address on file for ${vendor.vendorName || vendor.name || 'this vendor'}.`);
            return;
        }
        const companyName = rfqData?.companySettings?.locationAddress?.companyName || 'Margins ID Systems Applications Ltd.';
        const rfqNum = rfqData?.rfqNumber || 'RFQ';
        const deadline = rfqData?.submissionDeadline || 'N/A';
        const subject = `Request for Quotation — ${rfqNum}`;
        const body = [
            `Dear ${vendor.contactPerson || vendor.vendorName || vendor.name || 'Sir/Madam'},`,
            '',
            `Please find attached our Request for Quotation (${rfqNum}).`,
            '',
            `Submission Deadline: ${deadline}`,
            rfqData?.deliveryDeadline ? `Delivery Deadline: ${rfqData.deliveryDeadline}` : '',
            '',
            'Please review the attached document and provide your quotation by the deadline. Kindly include unit pricing, lead times, delivery terms, and payment terms for each item listed.',
            '',
            'If you have any questions, please do not hesitate to contact us.',
            '',
            'Best regards,',
            companyName,
        ].filter(Boolean).join('\n');

        const mailtoLink = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        window.open(mailtoLink);
    }, [vendorPDFs, rfqData]);

    const emailAll = useCallback(() => {
        vendorPDFs.forEach((_, idx) => {
            setTimeout(() => emailVendor(idx), idx * 500);
        });
    }, [vendorPDFs, emailVendor]);

    const handleConfirmSend = async () => {
        if (sending) return;
        setSending(true);
        try {
            downloadAll();
            if (onConfirmSend) await onConfirmSend();
        } finally {
            setSending(false);
        }
    };

    const handleSaveDraft = async () => {
        if (sending) return;
        setSending(true);
        try {
            if (onSaveDraft) await onSaveDraft();
        } finally {
            setSending(false);
        }
    };

    const iframeSrc = useMemo(() => {
        if (vendorPDFs.length === 0 || !vendorPDFs[activeIdx]) return null;
        const zoomParam = encodeURIComponent(zoom);
        return `${vendorPDFs[activeIdx].blobUrl}#zoom=${zoomParam}&page=1`;
    }, [vendorPDFs, activeIdx, zoom]);

    if (!open) return null;

    return (
        <GlassModal
            open
            onClose={onClose}
            size="full"
            hideCloseButton
            closeOnBackdrop={false}
            className="p-0"
        >
            <div className="flex flex-col h-full">
                {/* Header */}
                <div className="px-4 py-3 border-b border-line flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-semibold text-ink">
                            RFQ Preview — {rfqData?.rfqNumber || 'New RFQ'}
                        </h3>
                        <p className="text-xs text-ink-muted">
                            {vendorPDFs.length > 0
                                ? `${vendorPDFs.length} vendor PDF(s) generated — review before sending`
                                : 'Generating vendor PDFs...'}
                        </p>
                    </div>
                    <button onClick={onClose} className="text-ink-muted hover:text-ink text-xl" aria-label="Close preview">
                        ✕
                    </button>
                </div>

                {/* Toolbar */}
                <div className="px-4 py-2 border-b border-line bg-surface-sunken flex flex-wrap items-center justify-between gap-2">
                    {/* Vendor tabs */}
                    <div className="flex items-center gap-1 overflow-x-auto">
                        {vendorPDFs.map((entry, idx) => (
                            <button
                                key={entry.vendor.vendorId || idx}
                                onClick={() => setActiveIdx(idx)}
                                className={`px-3 py-1.5 rounded-card text-sm whitespace-nowrap transition-colors ${
                                    activeIdx === idx
                                        ? 'bg-primary text-white'
                                        : 'bg-surface border border-line text-ink hover:bg-surface-muted'
                                }`}
                            >
                                {entry.vendor.vendorName || entry.vendor.name || `Vendor ${idx + 1}`}
                            </button>
                        ))}
                    </div>

                    {/* Zoom + actions */}
                    <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1 text-sm text-ink-muted">
                            Zoom
                            <select value={zoom} onChange={(e) => setZoom(e.target.value)} className="border border-line rounded-card px-2 py-1 text-sm bg-surface">
                                <option value="page-width">Fit width</option>
                                <option value="page-fit">Fit page</option>
                                <option value="75">75%</option>
                                <option value="100">100%</option>
                                <option value="125">125%</option>
                                <option value="150">150%</option>
                                <option value="200">200%</option>
                            </select>
                        </label>

                        {vendorPDFs.length > 0 && (
                            <>
                                <Button variant="secondary" size="sm" onClick={() => downloadSingle(activeIdx)} title="Download this vendor's PDF">
                                    ⬇ This PDF
                                </Button>
                                <Button variant="secondary" size="sm" onClick={downloadAll} title="Download all vendor PDFs">
                                    ⬇ All ({vendorPDFs.length})
                                </Button>
                                <Button variant="primary" size="sm" onClick={() => emailVendor(activeIdx)}
                                    title={`Email ${activeVendor?.vendorName || activeVendor?.name || 'vendor'}`}>
                                    ✉ Email This Vendor
                                </Button>
                                {vendorPDFs.length > 1 && (
                                    <Button variant="primary" size="sm" onClick={emailAll} title="Open mailto for all vendors">
                                        ✉ Email All
                                    </Button>
                                )}
                            </>
                        )}
                    </div>
                </div>

                {/* PDF viewer */}
                <div className="flex-1 p-3 overflow-hidden flex flex-col">
                    <div className="flex-1 border border-line rounded-card overflow-auto bg-surface-sunken">
                        {loading && (
                            <div className="flex items-center justify-center h-full text-ink">
                                <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full mr-3" />
                                Generating {rfqData?.vendors?.length || 0} vendor PDF(s)...
                            </div>
                        )}
                        {!loading && error && (
                            <div className="flex items-center justify-center h-full">
                                <div className="text-center text-danger">
                                    <p className="font-medium mb-2">Failed to generate preview</p>
                                    <p className="text-sm mb-4">{error}</p>
                                    <Button variant="secondary" onClick={onClose}>Close</Button>
                                </div>
                            </div>
                        )}
                        {!loading && !error && iframeSrc && (
                            <iframe
                                ref={iframeRef}
                                title="RFQ PDF Preview"
                                src={iframeSrc}
                                className="w-full h-full"
                            />
                        )}
                    </div>
                </div>

                {/* Bottom action bar */}
                <div className="px-4 py-3 border-t border-line bg-surface flex items-center justify-between">
                    <div className="text-sm text-ink-muted">
                        {vendorPDFs.length > 0 && (
                            <>
                                Viewing {activeIdx + 1} of {vendorPDFs.length} —{' '}
                                <strong className="text-ink">{activeVendor?.vendorName || activeVendor?.name}</strong>
                                {activeVendor?.contactEmail && (
                                    <span className="text-ink-subtle ml-1">({activeVendor.contactEmail})</span>
                                )}
                            </>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <Button variant="danger" onClick={onClose}>Back & Edit</Button>
                        <Button variant="secondary" onClick={handleSaveDraft} disabled={sending || loading}>
                            Save as Draft
                        </Button>
                        <Button variant="primary" onClick={handleConfirmSend} disabled={sending || loading}>
                            {sending ? 'Sending...' : 'Confirm & Send to Vendors'}
                        </Button>
                    </div>
                </div>
            </div>
        </GlassModal>
    );
}
