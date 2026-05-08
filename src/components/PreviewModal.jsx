import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ArrowLeft, Send, Mail, Download } from 'lucide-react';
import { PDFService } from '../services/PDFService.js';
import { useApp } from '../context/AppContext';
import PdfViewer from './v2/PdfViewer';
import Button from './v2/Button';
import { dialogVariants, backdropVariants } from './v2/motion';

/**
 * PreviewModal — full-screen Fluent 2 PDF preview.
 *
 * Replaces the old GlassModal-wrapped iframe (which surfaced the browser /
 * Chrome PDF chrome with all its mismatched typography). Now renders the
 * generated PDF inside our custom <PdfViewer>, themed to match the app and
 * dark-mode aware.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ Header: title + close                                         │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │ Helper line: "preview only / final document"                  │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │ <PdfViewer> — toolbar, thumbnails, scrollable canvas pages   │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │ Footer actions:                                                │
 *   │   submit-mode  → [Back & Edit]   [Continue & Submit]          │
 *   │   distribute   → [Download Only] [Download & Email]  [Done]   │
 *   └──────────────────────────────────────────────────────────────┘
 */
export default function PreviewModal({
  open, onClose, payload, mode = 'invoice',
  onConfirm, isDistribution = false, onEmail, onDownload
}) {
  useApp(); // ensure inside AppProvider
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const [pdfBase64, setPdfBase64]   = useState(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setPdfBase64(null);
    setLoading(true);
    (async () => {
      try {
        const pdf = mode === 'quote'
          ? await PDFService.generateQuotePDF(payload)
          : await PDFService.generateInvoicePDF(payload);
        const dataUri = pdf.output('datauristring');
        const base64  = dataUri.replace(/^data:application\/pdf(;[^,]*)?,/, '');
        if (cancelled) return;
        setPdfBase64(base64);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error('Preview generation failed:', err);
        setError(err.message || 'Failed to generate preview');
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, mode, payload]);

  const filename = `${payload?.customer?.name || 'Customer'} - ${payload?.invoiceNumber || payload?.invoiceId || payload?.quoteId || 'Document'}.pdf`;

  const triggerLocalDownload = () => {
    if (!pdfBase64) return;
    const link = document.createElement('a');
    link.href = `data:application/pdf;base64,${pdfBase64}`;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    onDownload?.();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex flex-col"
          variants={backdropVariants}
          initial="initial"
          animate="enter"
          exit="exit"
        >
          <motion.div className="absolute inset-0 bg-n-900/55 backdrop-blur-sm" variants={backdropVariants} />

          <motion.div
            variants={dialogVariants}
            className="relative m-4 sm:m-6 lg:m-8 flex-1 bg-white dark:bg-n-50 border border-n-200 rounded-panel shadow-popover overflow-hidden flex flex-col"
            role="dialog"
            aria-modal="true"
            aria-labelledby="preview-title"
          >
            {/* HEADER */}
            <header className="flex-shrink-0 flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-n-200">
              <div className="min-w-0">
                <h2 id="preview-title" className="text-[15px] font-semibold text-n-800 truncate">
                  {isDistribution
                    ? 'Document preview'
                    : mode === 'quote'
                      ? 'Quote preview — submitting for approval'
                      : 'Invoice preview — submitting for approval'}
                </h2>
                <p className="text-[12px] text-n-500 mt-0.5 truncate">
                  {isDistribution
                    ? 'This is the final approved document.'
                    : 'The final PDF is generated when you click Continue & Submit.'}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-8 h-8 grid place-items-center rounded-md text-n-500 hover:bg-n-100 hover:text-n-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent flex-shrink-0"
                aria-label="Close preview"
              ><X className="w-4 h-4" /></button>
            </header>

            {/* BODY */}
            <div className="flex-1 min-h-0">
              {loading && <SkeletonViewer />}
              {!loading && error && (
                <div className="h-full grid place-items-center p-6">
                  <div className="max-w-sm text-center">
                    <div className="w-12 h-12 rounded-full bg-err-soft text-err grid place-items-center mx-auto mb-3">!</div>
                    <h3 className="text-[15px] font-semibold text-n-800">Couldn’t generate the preview</h3>
                    <p className="text-[13px] text-n-500 mt-1">{error}</p>
                    <div className="mt-4">
                      <Button variant="primary" onClick={() => { setError(null); setLoading(true); /* force re-effect by toggling key */ setPdfBase64(null); }}>Retry</Button>
                    </div>
                  </div>
                </div>
              )}
              {!loading && !error && pdfBase64 && (
                <PdfViewer src={pdfBase64} filename={filename} onDownload={onDownload} />
              )}
            </div>

            {/* FOOTER */}
            <footer className="flex-shrink-0 flex items-center justify-end gap-2 px-4 sm:px-5 py-3 border-t border-n-200 bg-n-0">
              {isDistribution ? (
                <>
                  <Button iconLeft={<Download />} onClick={triggerLocalDownload} disabled={!pdfBase64}>Download</Button>
                  {onEmail && (
                    <Button variant="primary" iconLeft={<Mail />} onClick={() => { triggerLocalDownload(); onEmail(); }}>Download &amp; email</Button>
                  )}
                  <Button onClick={onClose}>Done</Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" iconLeft={<ArrowLeft />} onClick={onClose}>Back &amp; edit</Button>
                  <Button variant="primary" iconRight={<Send />} disabled={loading} onClick={() => onConfirm?.()}>Continue &amp; submit</Button>
                </>
              )}
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SkeletonViewer() {
  return (
    <div className="h-full bg-n-50 dark:bg-n-0 grid place-items-center p-6">
      <div className="w-full max-w-2xl mx-auto bg-white shadow-card rounded-card border border-n-200 p-8 space-y-4 v2-shimmer-bg">
        <div className="flex items-center justify-between">
          <div className="h-6 w-40 bg-n-100 rounded" />
          <div className="h-6 w-24 bg-n-100 rounded" />
        </div>
        <div className="h-3 w-2/3 bg-n-100 rounded" />
        <div className="h-3 w-1/2 bg-n-100 rounded" />
        <div className="mt-6 space-y-2">
          <div className="h-4 bg-n-100 rounded" />
          <div className="h-4 bg-n-100 rounded" />
          <div className="h-4 w-5/6 bg-n-100 rounded" />
          <div className="h-4 w-4/6 bg-n-100 rounded" />
          <div className="h-4 w-3/6 bg-n-100 rounded" />
        </div>
        <div className="mt-8 flex justify-end">
          <div className="h-8 w-32 bg-n-100 rounded" />
        </div>
        <div className="mt-3 flex items-center justify-center text-[13px] text-n-500">
          <div className="animate-spin h-4 w-4 border-2 border-accent border-t-transparent rounded-full mr-2" />
          Generating preview…
        </div>
      </div>
    </div>
  );
}
