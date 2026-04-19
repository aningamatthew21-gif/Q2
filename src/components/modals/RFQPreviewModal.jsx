import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { PDFService } from '../../services/PDFService';

/**
 * RFQPreviewModal — Multi-vendor RFQ PDF preview.
 *
 * Props:
 *   open          – boolean
 *   onClose       – () => void
 *   rfqData       – { rfqNumber, title, submissionDeadline, deliveryDeadline, currency, notes, lineItems[], vendors[] }
 *   onConfirmSend – () => Promise<void>   (creates the RFQ & sends emails)
 *   onSaveDraft   – () => Promise<void>   (creates the RFQ as draft)
 *
 * Generates one PDF per vendor, tabbed preview, individual download, bulk download, mailto per vendor.
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
                    // Use a Blob URL instead of a base64 data URI — required by
                    // Chromium-based browsers which block data: URIs in iframes.
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

        // Revoke blobs when modal closes or rfqData changes
        return () => revokeBlobUrls();
    }, [open, rfqData, revokeBlobUrls]);

    // Update iframe when active vendor or zoom changes
    useEffect(() => {
        if (!iframeRef.current || vendorPDFs.length === 0) return;
        const current = vendorPDFs[activeIdx];
        if (!current) return;
        // Append zoom fragment for PDF viewers that support it (Chromium PDF viewer does)
        const zoomParam = encodeURIComponent(zoom);
        iframeRef.current.src = `${current.blobUrl}#zoom=${zoomParam}&page=1`;
    }, [activeIdx, zoom, vendorPDFs]);

    const activeVendor = vendorPDFs[activeIdx]?.vendor;

    // Build filename for a vendor
    const buildFileName = useCallback((vendor) => {
        const vName = (vendor.vendorName || vendor.name || 'Vendor').replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '-');
        const rfqNum = (rfqData?.rfqNumber || 'RFQ').replace(/[^a-zA-Z0-9-]/g, '');
        const date = new Date().toISOString().slice(0, 10);
        return `${vName}-${rfqNum}-${date}.pdf`;
    }, [rfqData]);

    // Download single PDF
    const downloadSingle = useCallback((idx) => {
        const entry = vendorPDFs[idx];
        if (!entry) return;
        const fileName = buildFileName(entry.vendor);
        const link = document.createElement('a');
        link.href = entry.blobUrl;  // blob: URL — works in all browsers
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }, [vendorPDFs, buildFileName]);

    // Download all PDFs
    const downloadAll = useCallback(() => {
        vendorPDFs.forEach((_, idx) => {
            setTimeout(() => downloadSingle(idx), idx * 300);
        });
    }, [vendorPDFs, downloadSingle]);

    // Open mailto for a specific vendor
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

    // Email all vendors
    const emailAll = useCallback(() => {
        vendorPDFs.forEach((_, idx) => {
            setTimeout(() => emailVendor(idx), idx * 500);
        });
    }, [vendorPDFs, emailVendor]);

    // Confirm & Send
    const handleConfirmSend = async () => {
        if (sending) return;
        setSending(true);
        try {
            // Download all PDFs first so user has copies
            downloadAll();
            // Then trigger the actual create + send
            if (onConfirmSend) await onConfirmSend();
        } finally {
            setSending(false);
        }
    };

    // Save as Draft
    const handleSaveDraft = async () => {
        if (sending) return;
        setSending(true);
        try {
            if (onSaveDraft) await onSaveDraft();
        } finally {
            setSending(false);
        }
    };

    // IMPORTANT: all hooks must run on every render. Do NOT put any hook below
    // the `if (!open) return null` early return — that would violate React's
    // Rules of Hooks and crash the component into a blank page.
    const iframeSrc = useMemo(() => {
        if (vendorPDFs.length === 0 || !vendorPDFs[activeIdx]) return null;
        const zoomParam = encodeURIComponent(zoom);
        return `${vendorPDFs[activeIdx].blobUrl}#zoom=${zoomParam}&page=1`;
    }, [vendorPDFs, activeIdx, zoom]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-50" role="dialog" aria-modal="true" aria-label="RFQ Preview">
            <div className="bg-white w-screen h-screen flex flex-col">
                {/* Header */}
                <div className="px-4 py-3 border-b flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-semibold">
                            RFQ Preview — {rfqData?.rfqNumber || 'New RFQ'}
                        </h3>
                        <p className="text-xs text-gray-500">
                            {vendorPDFs.length > 0
                                ? `${vendorPDFs.length} vendor PDF(s) generated — review before sending`
                                : 'Generating vendor PDFs...'}
                        </p>
                    </div>
                    <button onClick={onClose} className="text-gray-600 hover:text-gray-800 text-xl" aria-label="Close preview">
                        ✕
                    </button>
                </div>

                {/* Toolbar */}
                <div className="px-4 py-2 border-b bg-gray-50 flex flex-wrap items-center justify-between gap-2">
                    {/* Vendor tabs */}
                    <div className="flex items-center gap-1 overflow-x-auto">
                        {vendorPDFs.map((entry, idx) => (
                            <button
                                key={entry.vendor.vendorId || idx}
                                onClick={() => setActiveIdx(idx)}
                                className={`px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors ${
                                    activeIdx === idx
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100'
                                }`}
                            >
                                {entry.vendor.vendorName || entry.vendor.name || `Vendor ${idx + 1}`}
                            </button>
                        ))}
                    </div>

                    {/* Zoom + actions */}
                    <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1 text-sm text-gray-600">
                            Zoom
                            <select value={zoom} onChange={(e) => setZoom(e.target.value)} className="border rounded px-2 py-1 text-sm">
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
                                <button
                                    onClick={() => downloadSingle(activeIdx)}
                                    className="px-3 py-1.5 bg-gray-600 hover:bg-gray-700 text-white rounded text-sm flex items-center gap-1"
                                    title="Download this vendor's PDF"
                                >
                                    <span>&#11015;</span> This PDF
                                </button>
                                <button
                                    onClick={downloadAll}
                                    className="px-3 py-1.5 bg-gray-700 hover:bg-gray-800 text-white rounded text-sm flex items-center gap-1"
                                    title="Download all vendor PDFs"
                                >
                                    <span>&#11015;</span> All ({vendorPDFs.length})
                                </button>
                                <button
                                    onClick={() => emailVendor(activeIdx)}
                                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm flex items-center gap-1"
                                    title={`Email ${activeVendor?.vendorName || activeVendor?.name || 'vendor'}`}
                                >
                                    <span>&#9993;</span> Email This Vendor
                                </button>
                                {vendorPDFs.length > 1 && (
                                    <button
                                        onClick={emailAll}
                                        className="px-3 py-1.5 bg-indigo-700 hover:bg-indigo-800 text-white rounded text-sm flex items-center gap-1"
                                        title="Open mailto for all vendors"
                                    >
                                        <span>&#9993;</span> Email All
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                </div>

                {/* PDF viewer */}
                <div className="flex-1 p-3 overflow-hidden flex flex-col">
                    <div className="flex-1 border rounded-md overflow-auto bg-gray-100">
                        {loading && (
                            <div className="flex items-center justify-center h-full text-gray-700">
                                <div className="animate-spin h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full mr-3" />
                                Generating {rfqData?.vendors?.length || 0} vendor PDF(s)...
                            </div>
                        )}
                        {!loading && error && (
                            <div className="flex items-center justify-center h-full">
                                <div className="text-center text-red-600">
                                    <p className="font-medium mb-2">Failed to generate preview</p>
                                    <p className="text-sm mb-4">{error}</p>
                                    <button onClick={onClose} className="px-4 py-2 bg-gray-600 text-white rounded">
                                        Close
                                    </button>
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
                <div className="px-4 py-3 border-t bg-white flex items-center justify-between">
                    <div className="text-sm text-gray-500">
                        {vendorPDFs.length > 0 && (
                            <>
                                Viewing {activeIdx + 1} of {vendorPDFs.length} —{' '}
                                <strong>{activeVendor?.vendorName || activeVendor?.name}</strong>
                                {activeVendor?.contactEmail && (
                                    <span className="text-gray-400 ml-1">({activeVendor.contactEmail})</span>
                                )}
                            </>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm"
                        >
                            Back & Edit
                        </button>
                        <button
                            onClick={handleSaveDraft}
                            disabled={sending || loading}
                            className={`px-4 py-2 border rounded text-sm ${
                                sending || loading
                                    ? 'border-gray-200 text-gray-400 cursor-not-allowed'
                                    : 'border-blue-600 text-blue-600 hover:bg-blue-50'
                            }`}
                        >
                            Save as Draft
                        </button>
                        <button
                            onClick={handleConfirmSend}
                            disabled={sending || loading}
                            className={`px-4 py-2 rounded text-sm text-white ${
                                sending || loading
                                    ? 'bg-gray-300 cursor-not-allowed'
                                    : 'bg-green-600 hover:bg-green-700'
                            }`}
                        >
                            {sending ? 'Sending...' : 'Confirm & Send to Vendors'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
