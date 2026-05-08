import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCw,
  Download, Printer, Maximize2, Minimize2, FileText, AlertCircle
} from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import clsx from 'clsx';
import Button from './Button';

/**
 * PdfViewer — custom in-app PDF viewer.
 *
 * Replaces the embedded browser/Chrome/Google PDF chrome (which clashes with
 * Fluent 2 and isn't dark-mode aware) with a viewer rendered fully inside the
 * app's design system:
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ Toolbar — page nav · zoom · rotate · download · print       │
 *   ├─────────────────┬───────────────────────────────────────────┤
 *   │ Thumbnails      │ Continuous canvas pages, scrollable        │
 *   │  (sidebar)       │                                           │
 *   └─────────────────┴───────────────────────────────────────────┘
 *
 * Renders PDF pages to <canvas> via pdfjs-dist. Honours dark mode by
 * placing the canvas on a neutral surface and tinting page chrome
 * (the white paper itself stays white — that's what's printed).
 *
 * Props:
 *   src        — base64 string OR ArrayBuffer OR Uint8Array OR URL
 *   filename   — used for Download
 *   onDownload — optional callback after download click
 *   onPrint    — optional callback (we open the print dialog ourselves)
 *   className  — pass-through for outer wrapper
 *
 * Usage:
 *   <PdfViewer src={pdfBase64} filename="INV-2026-0118.pdf" />
 */

// pdfjs needs its worker located somewhere — Vite's `?url` import gives us a
// stable served path that works in dev and after `vite build`. Setting it
// once at module load is the recommended pattern.
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

function base64ToUint8(base64) {
  const clean = base64.replace(/^data:application\/pdf(;[^,]*)?,/, '');
  const binary = atob(clean);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export default function PdfViewer({
  src,
  filename = 'document.pdf',
  onDownload,
  onPrint,
  className = ''
}) {
  const containerRef     = useRef(null);
  const thumbsRef        = useRef(null);
  const [pdf, setPdf]                 = useState(null);
  const [pageCount, setPageCount]     = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom]               = useState(1);
  const [rotation, setRotation]       = useState(0);
  const [fullscreen, setFullscreen]   = useState(false);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [thumbsOpen, setThumbsOpen]   = useState(true);

  // ── Load the PDF ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let task = null;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        let data;
        if (typeof src === 'string') {
          if (/^https?:\/\//.test(src) || src.startsWith('blob:')) {
            const res = await fetch(src);
            const buf = await res.arrayBuffer();
            data = new Uint8Array(buf);
          } else {
            data = base64ToUint8(src);
          }
        } else if (src instanceof ArrayBuffer) {
          data = new Uint8Array(src);
        } else if (src instanceof Uint8Array) {
          data = src;
        } else {
          throw new Error('PdfViewer: unsupported src type');
        }
        task = pdfjs.getDocument({ data });
        const doc = await task.promise;
        if (cancelled) return;
        setPdf(doc);
        setPageCount(doc.numPages);
        setCurrentPage(1);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        console.error('[PdfViewer] load failed', e);
        setError(e?.message || 'Failed to load PDF.');
        setLoading(false);
      }
    }
    if (src) load();
    return () => {
      cancelled = true;
      try { task?.destroy?.(); } catch { /* noop */ }
    };
  }, [src]);

  // ── Render all pages whenever pdf / zoom / rotation change ─
  useEffect(() => {
    if (!pdf || !containerRef.current) return;
    let active = true;
    const root = containerRef.current;
    root.innerHTML = '';

    (async () => {
      for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
        if (!active) return;
        const page = await pdf.getPage(pageNo);
        const dpr  = Math.max(1, window.devicePixelRatio || 1);
        const viewport = page.getViewport({ scale: zoom * dpr, rotation });

        const wrap = document.createElement('div');
        wrap.dataset.page = String(pageNo);
        wrap.className = 'mx-auto my-3 bg-white shadow-card rounded-card relative overflow-hidden';
        wrap.style.width  = `${viewport.width / dpr}px`;
        wrap.style.height = `${viewport.height / dpr}px`;

        const canvas = document.createElement('canvas');
        canvas.width  = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width  = '100%';
        canvas.style.height = '100%';
        canvas.style.display = 'block';
        wrap.appendChild(canvas);

        const label = document.createElement('div');
        label.className = 'absolute top-2 right-2 text-[10.5px] text-n-500 bg-white/85 backdrop-blur-sm border border-n-200 rounded-md px-1.5 py-0.5 font-mono-num';
        label.textContent = `${pageNo} / ${pdf.numPages}`;
        wrap.appendChild(label);

        root.appendChild(wrap);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      }
    })();

    return () => { active = false; };
  }, [pdf, zoom, rotation]);

  // ── Render thumbnails sidebar ─────────────────────────────
  useEffect(() => {
    if (!pdf || !thumbsRef.current) return;
    let active = true;
    const root = thumbsRef.current;
    root.innerHTML = '';
    (async () => {
      for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
        if (!active) return;
        const page = await pdf.getPage(pageNo);
        const targetW = 110;
        const baseVp  = page.getViewport({ scale: 1 });
        const scale   = targetW / baseVp.width;
        const viewport = page.getViewport({ scale, rotation });

        const wrap = document.createElement('button');
        wrap.type = 'button';
        wrap.dataset.page = String(pageNo);
        wrap.className = 'block w-full mb-2 rounded-md overflow-hidden border border-n-200 bg-white hover:border-accent transition-colors';
        wrap.addEventListener('click', () => goToPage(pageNo));

        const canvas = document.createElement('canvas');
        canvas.width  = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width  = '100%';
        canvas.style.display = 'block';
        wrap.appendChild(canvas);

        const label = document.createElement('div');
        label.className = 'text-center text-[10.5px] text-n-500 py-0.5';
        label.textContent = `${pageNo}`;
        wrap.appendChild(label);

        root.appendChild(wrap);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      }
    })();
    return () => { active = false; };
  }, [pdf, rotation]);

  // ── Track which page is currently in view ─────────────────
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const onScroll = () => {
      const rect = root.getBoundingClientRect();
      const targetY = rect.top + 100;        // 100px below the toolbar feels right
      const pages = Array.from(root.querySelectorAll('[data-page]'));
      let active = 1;
      for (const p of pages) {
        const r = p.getBoundingClientRect();
        if (r.top <= targetY) active = Number(p.dataset.page);
        else break;
      }
      setCurrentPage(active);
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => root.removeEventListener('scroll', onScroll);
  }, [pdf]);

  // ── Highlight active thumb ────────────────────────────────
  useEffect(() => {
    const tRoot = thumbsRef.current;
    if (!tRoot) return;
    Array.from(tRoot.querySelectorAll('[data-page]')).forEach(el => {
      const isActive = Number(el.dataset.page) === currentPage;
      el.classList.toggle('!border-accent', isActive);
      el.classList.toggle('ring-2', isActive);
      el.classList.toggle('ring-accent/40', isActive);
    });
  }, [currentPage, pdf]);

  // ── Actions ──────────────────────────────────────────────
  const goToPage = useCallback((pageNo) => {
    const root = containerRef.current;
    if (!root) return;
    const target = root.querySelector(`[data-page="${pageNo}"]`);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const zoomIn  = () => setZoom(z => ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + 1)] || 1.5);
  const zoomOut = () => setZoom(z => ZOOMS[Math.max(0, ZOOMS.indexOf(z) - 1)] || 0.75);
  const fitWidth = () => {
    const root = containerRef.current;
    if (!pdf || !root) return;
    pdf.getPage(1).then(page => {
      const vp = page.getViewport({ scale: 1, rotation });
      const targetWidth = root.clientWidth - 32;          // px-4
      setZoom(Math.max(0.25, Math.min(3, targetWidth / vp.width)));
    });
  };

  const rotate = () => setRotation(r => (r + 90) % 360);

  const download = () => {
    let url;
    if (typeof src === 'string') {
      url = /^https?:\/\//.test(src) || src.startsWith('blob:') || src.startsWith('data:')
        ? (src.startsWith('data:') ? src : src)
        : `data:application/pdf;base64,${src.replace(/^data:application\/pdf(;[^,]*)?,/, '')}`;
    } else {
      const blob = new Blob([src], { type: 'application/pdf' });
      url = URL.createObjectURL(blob);
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (url.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(url), 1000);
    onDownload?.();
  };

  const print = () => {
    let url;
    if (typeof src === 'string' && (src.startsWith('http') || src.startsWith('blob:'))) {
      url = src;
    } else if (typeof src === 'string') {
      const bytes = base64ToUint8(src);
      url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    } else {
      url = URL.createObjectURL(new Blob([src], { type: 'application/pdf' }));
    }
    const w = window.open(url, '_blank');
    setTimeout(() => { try { w?.print?.(); } catch { /* ignore */ } }, 600);
    onPrint?.();
  };

  // ── Render ────────────────────────────────────────────────
  return (
    <div className={clsx('flex flex-col bg-n-50 dark:bg-n-0 text-n-700 h-full min-h-0', className)}>
      {/* TOOLBAR */}
      <div className="h-11 flex-shrink-0 px-2 sm:px-3 flex items-center gap-1 border-b border-n-200 bg-white">
        {/* Page nav */}
        <button
          type="button"
          onClick={() => goToPage(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
          className="w-8 h-8 grid place-items-center rounded-md text-n-600 hover:bg-n-100 disabled:opacity-40 disabled:hover:bg-transparent"
          aria-label="Previous page"
        ><ChevronLeft className="w-4 h-4" /></button>
        <div className="flex items-center gap-1 px-1.5">
          <input
            type="number"
            min={1}
            max={pageCount}
            value={currentPage}
            onChange={(e) => {
              const n = Math.max(1, Math.min(pageCount, Number(e.target.value) || 1));
              setCurrentPage(n);
              goToPage(n);
            }}
            className="w-12 h-7 px-1 text-center text-[12.5px] font-mono-num bg-n-50 border border-n-200 rounded-md focus:outline-none focus:border-accent focus:bg-white"
          />
          <span className="text-[12px] text-n-500">/ {pageCount || '—'}</span>
        </div>
        <button
          type="button"
          onClick={() => goToPage(Math.min(pageCount, currentPage + 1))}
          disabled={currentPage >= pageCount}
          className="w-8 h-8 grid place-items-center rounded-md text-n-600 hover:bg-n-100 disabled:opacity-40 disabled:hover:bg-transparent"
          aria-label="Next page"
        ><ChevronRight className="w-4 h-4" /></button>

        <span className="w-px h-5 bg-n-200 mx-1" />

        {/* Zoom */}
        <button type="button" onClick={zoomOut} className="w-8 h-8 grid place-items-center rounded-md text-n-600 hover:bg-n-100" aria-label="Zoom out"><ZoomOut className="w-4 h-4" /></button>
        <select
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="h-7 px-1.5 text-[12px] bg-n-50 border border-n-200 rounded-md focus:outline-none focus:border-accent focus:bg-white"
        >
          {ZOOMS.map(z => <option key={z} value={z}>{Math.round(z * 100)}%</option>)}
        </select>
        <button type="button" onClick={zoomIn} className="w-8 h-8 grid place-items-center rounded-md text-n-600 hover:bg-n-100" aria-label="Zoom in"><ZoomIn className="w-4 h-4" /></button>
        <button
          type="button"
          onClick={fitWidth}
          className="hidden sm:inline-flex items-center px-2 h-7 rounded-md text-[12px] text-n-700 hover:bg-n-100"
          title="Fit to width"
        >Fit</button>

        <span className="w-px h-5 bg-n-200 mx-1" />

        <button type="button" onClick={rotate} className="w-8 h-8 grid place-items-center rounded-md text-n-600 hover:bg-n-100" aria-label="Rotate"><RotateCw className="w-4 h-4" /></button>

        <span className="flex-1" />

        {/* Right cluster */}
        <button
          type="button"
          onClick={() => setThumbsOpen(v => !v)}
          className={clsx(
            'hidden md:inline-flex items-center px-2 h-7 rounded-md text-[12px]',
            thumbsOpen ? 'text-accent-text bg-accent-soft' : 'text-n-700 hover:bg-n-100'
          )}
          title="Toggle thumbnails"
        ><FileText className="w-3.5 h-3.5 mr-1" />Thumbnails</button>

        <button type="button" onClick={download} className="inline-flex items-center px-2 h-7 rounded-md text-[12px] text-n-700 hover:bg-n-100" title="Download">
          <Download className="w-3.5 h-3.5 mr-1" />Download
        </button>
        <button type="button" onClick={print} className="inline-flex items-center px-2 h-7 rounded-md text-[12px] text-n-700 hover:bg-n-100" title="Print">
          <Printer className="w-3.5 h-3.5 mr-1" />Print
        </button>
        <button
          type="button"
          onClick={() => setFullscreen(v => !v)}
          className="w-8 h-8 grid place-items-center rounded-md text-n-600 hover:bg-n-100"
          aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>

      {/* BODY */}
      <div className="flex-1 flex min-h-0">
        {/* Thumbs */}
        {thumbsOpen && (
          <aside className="hidden md:block w-[140px] flex-shrink-0 bg-n-50 dark:bg-n-50 border-r border-n-200 overflow-y-auto px-2 py-2">
            <div ref={thumbsRef} />
          </aside>
        )}
        {/* Pages */}
        <div className="flex-1 min-w-0 relative">
          {loading && (
            <div className="absolute inset-0 grid place-items-center">
              <div className="flex flex-col items-center gap-3">
                <div className="w-10 h-10 rounded-full border-2 border-n-200 border-t-accent animate-spin" />
                <div className="text-[13px] text-n-500">Generating preview…</div>
              </div>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 grid place-items-center p-6">
              <div className="max-w-sm text-center">
                <div className="w-12 h-12 rounded-full bg-err-soft text-err grid place-items-center mx-auto mb-3">
                  <AlertCircle className="w-5 h-5" />
                </div>
                <h3 className="text-[15px] font-semibold text-n-800">Couldn’t open this PDF</h3>
                <p className="text-[13px] text-n-500 mt-1">{error}</p>
              </div>
            </div>
          )}
          <motion.div
            ref={containerRef}
            initial={{ opacity: 0 }}
            animate={{ opacity: loading || error ? 0 : 1 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 overflow-auto px-4 py-2 bg-n-50 dark:bg-n-0"
            style={{ scrollBehavior: 'smooth' }}
          />
        </div>
      </div>

      {fullscreen && (
        <FullscreenOverlay onClose={() => setFullscreen(false)}>
          <PdfViewer src={src} filename={filename} className="!bg-n-50" />
        </FullscreenOverlay>
      )}
    </div>
  );
}

function FullscreenOverlay({ onClose, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm grid place-items-center">
      <div className="w-screen h-screen bg-n-50">
        {children}
        <button
          onClick={onClose}
          className="fixed top-2 right-2 z-[70] w-9 h-9 grid place-items-center rounded-md bg-white border border-n-200 hover:bg-n-100"
          aria-label="Exit fullscreen"
        >×</button>
      </div>
    </div>
  );
}

/* Re-export helper for callers that already have a base64 string. */
export { base64ToUint8 };
