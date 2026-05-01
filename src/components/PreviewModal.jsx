import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PDFService } from '../services/PDFService.js';
import { useApp } from '../context/AppContext';
import GlassModal from './common/GlassModal';
import Button from './common/Button';

export default function PreviewModal({ open, onClose, payload, mode = 'invoice', onConfirm, isDistribution = false, onEmail, onDownload }) {
  useApp(); // Ensure we're inside AppProvider context
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pdfBase64, setPdfBase64] = useState(null);
  const iframeRef = useRef(null);
  const [zoom, setZoom] = useState('page-width');

  useEffect(() => {
    console.log('🟡 [DEBUG] PreviewModal mount/update', { open, mode, hasPayload: !!payload });
  }, [open, mode, payload]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPdfBase64(null);
    setLoading(true);

    const generatePDF = async () => {
      try {
        console.log('🟠 [DEBUG] Generating preview PDF...', { mode });
        const pdf = mode === 'quote'
          ? await PDFService.generateQuotePDF(payload)
          : await PDFService.generateInvoicePDF(payload);
        const dataUri = pdf.output('datauristring');
        const base64 = dataUri.replace('data:application/pdf;filename=generated.pdf;base64,', '');
        setPdfBase64(base64);
        setLoading(false);
        console.log('✅ [DEBUG] Preview PDF generated');
      } catch (err) {
        console.error('Preview generation failed:', err);
        setError(err.message || 'Failed to generate preview');
        setLoading(false);
      }
    };

    generatePDF();
  }, [open, mode, payload]);

  const iframeSrc = useMemo(() => {
    if (!pdfBase64) return null;
    const zoomParam = encodeURIComponent(zoom);
    const src = `data:application/pdf;base64,${pdfBase64}#zoom=${zoomParam}&page=1`;
    console.log('🟢 [DEBUG] iframe src prepared (length):', src.length);
    return src;
  }, [pdfBase64, zoom]);

  useEffect(() => {
    if (!pdfBase64) return;
    if (iframeRef.current) {
      const zoomParam = encodeURIComponent(zoom);
      iframeRef.current.src = `data:application/pdf;base64,${pdfBase64}#zoom=${zoomParam}&page=1`;
    }
  }, [zoom, pdfBase64]);

  if (!open) return null;

  const triggerLocalDownload = () => {
    if (!pdfBase64) return;
    const fileName = `${payload.customer?.name || 'Customer'} - ${payload.invoiceNumber || payload.invoiceId || payload.quoteId || 'Document'}.pdf`;
    const link = document.createElement('a');
    link.href = `data:application/pdf;base64,${pdfBase64}`;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    console.log('🔵 [DEBUG] Download triggered:', fileName);
  };

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
        <div className="px-4 py-3 border-b border-line flex items-center justify-between">
          <h3 className="text-lg font-semibold text-ink">
            {isDistribution ? 'Invoice Preview' : 'Preview — Document you’re submitting for approval'}
          </h3>
          <button onClick={onClose} className="text-ink-muted hover:text-ink" aria-label="Close preview">✕</button>
        </div>
        <div className="flex-1 p-3 overflow-hidden flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3 text-sm text-ink-muted">
              <span className="hidden sm:inline">
                {isDistribution
                  ? 'This is the final approved document.'
                  : 'This is a preview — the final PDF will be generated if you Continue & Submit.'}
              </span>
              <label className="flex items-center gap-2">
                <span className="text-ink-muted">Zoom</span>
                <select value={zoom} onChange={(e) => setZoom(e.target.value)} className="border border-line rounded-card px-2 py-1 text-sm bg-surface">
                  <option value="page-width">Fit width</option>
                  <option value="page-fit">Fit page</option>
                  <option value="75">75%</option>
                  <option value="100">100%</option>
                  <option value="125">125%</option>
                  <option value="150">150%</option>
                  <option value="175">175%</option>
                  <option value="200">200%</option>
                </select>
              </label>
            </div>
            <div className="flex gap-2">
              {iframeSrc && (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      triggerLocalDownload();
                      if (onDownload) onDownload();
                    }}
                  >
                    ⬇ Download Only
                  </Button>

                  {isDistribution && onEmail && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        triggerLocalDownload();
                        onEmail();
                      }}
                    >
                      📧 Download & Email
                    </Button>
                  )}
                </>
              )}

              {isDistribution ? (
                <>
                  {onEmail && !iframeSrc && (
                    <Button variant="primary" size="sm" onClick={onEmail}>
                      Send Email Only
                    </Button>
                  )}
                  <Button variant="secondary" size="sm" onClick={onClose}>
                    Done / Close
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="danger" size="sm" onClick={() => { console.log('🟡 [DEBUG] PreviewModal Back & Edit'); onClose?.(); }}>
                    Back & Edit
                  </Button>
                  <Button variant="primary" size="sm" disabled={loading}
                    onClick={() => { console.log('🟢 [DEBUG] PreviewModal Continue & Submit'); onConfirm?.(); }}>
                    Continue & Submit
                  </Button>
                </>
              )}
            </div>
          </div>
          <div className="flex-1 border border-line rounded-card overflow-auto bg-surface-sunken">
            {loading && (
              <div className="w-full h-full flex flex-col items-center justify-center p-6">
                <div className="w-full max-w-2xl mx-auto bg-surface shadow-card rounded-card border border-line p-8 space-y-4 animate-pulse">
                  <div className="flex items-center justify-between">
                    <div className="h-6 bg-surface-sunken rounded w-40" />
                    <div className="h-6 bg-surface-sunken rounded w-24" />
                  </div>
                  <div className="h-3 bg-surface-sunken rounded w-2/3" />
                  <div className="h-3 bg-surface-sunken rounded w-1/2" />
                  <div className="mt-6 space-y-2">
                    <div className="h-4 bg-surface-sunken rounded" />
                    <div className="h-4 bg-surface-sunken rounded" />
                    <div className="h-4 bg-surface-sunken rounded w-5/6" />
                    <div className="h-4 bg-surface-sunken rounded w-4/6" />
                    <div className="h-4 bg-surface-sunken rounded w-3/6" />
                  </div>
                  <div className="mt-8 flex justify-end">
                    <div className="h-8 bg-surface-sunken rounded w-32" />
                  </div>
                </div>
                <div className="mt-4 flex items-center text-ink-muted text-sm">
                  <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full mr-2" />
                  Generating preview…
                </div>
              </div>
            )}
            {!loading && error && (
              <div className="text-danger text-sm p-4">
                <p className="font-medium mb-2">Failed to generate preview.</p>
                <p className="mb-3">{error}</p>
                <Button variant="primary" size="sm" onClick={() => {
                  console.log('🟠 [DEBUG] Retry preview');
                  setError(null);
                  setLoading(true);
                  setPdfBase64(null);
                  setTimeout(async () => {
                    try {
                      const pdf = mode === 'quote'
                        ? await PDFService.generateQuotePDF(payload)
                        : await PDFService.generateInvoicePDF(payload);
                      const dataUri = pdf.output('datauristring');
                      const base64 = dataUri.replace('data:application/pdf;filename=generated.pdf;base64,', '');
                      setPdfBase64(base64);
                      setLoading(false);
                      console.log('✅ [DEBUG] Retry success');
                    } catch (e) {
                      console.error('❌ [ERROR] Retry failed', e);
                      setError(e.message || 'Failed again');
                      setLoading(false);
                    }
                  }, 0);
                }}>Retry</Button>
              </div>
            )}
            {!loading && !error && iframeSrc && (
              <iframe ref={iframeRef} title="PDF Preview" src={iframeSrc} className="w-full h-full" onLoad={() => console.log('🟢 [DEBUG] PDF iframe loaded')} />
            )}
          </div>
        </div>
      </div>
    </GlassModal>
  );
}
