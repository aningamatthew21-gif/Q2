import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { sidePanelVariants, backdropVariants } from './motion';

/**
 * DetailPanel — right-side sliding drawer for previewing a row from a list.
 *
 * Standards anchor:
 *   - WCAG 2.1 SC 2.1.1 (Keyboard) — Escape closes the panel
 *   - WCAG 2.1 SC 2.1.2 (No Keyboard Trap) — aria-modal="false" + click-out
 *     dismissal so the rest of the page remains interactive
 *   - WCAG 2.5.5 (Target Size) — close button hit area is 36×36 even though
 *     the visual icon is 16px (negative-margin trick keeps visual rhythm
 *     while widening the click target — same pattern Microsoft Fluent uses)
 *   - ISO/IEC 25010 Operability — three independent ways to dismiss (X,
 *     Esc, click-outside) means no single failure mode can trap the user
 *
 * Backward compatibility:
 *   - Same prop surface as before (open, onClose, title, subtitle, footer,
 *     width, className, children) — no caller change required.
 *
 *   <DetailPanel
 *     open={!!selectedRow}
 *     onClose={() => setSelectedRow(null)}
 *     title="INV-2026-0118"
 *     subtitle="ACME Industries"
 *     footer={<Button variant="primary">Approve</Button>}
 *     width={380}
 *   >
 *     ...detail content...
 *   </DetailPanel>
 */
export default function DetailPanel({
  open, onClose,
  title, subtitle, footer,
  width = 380,
  className = '',
  children
}) {
  const panelRef = useRef(null);

  // ── Escape to close (WCAG 2.1.1) ───────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // ── Click-outside to dismiss (desktop) ────────────────────────────
  // On mobile the dimmed backdrop handles dismiss; on desktop there's
  // no backdrop (aria-modal="false" — rest of page interactive), so
  // we listen for clicks outside the panel rect.
  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (e) => {
      // Ignore if the click began inside the panel
      if (panelRef.current?.contains(e.target)) return;
      // Don't close on clicks inside other overlays (modals, dropdowns)
      // that render at higher z-index — they have their own dismiss flow.
      if (e.target.closest('[role="dialog"], [role="menu"], [role="alertdialog"]')) return;
      onClose?.();
    };
    // Use mousedown not click so the dismiss feels immediate.
    // Listen on document but with capture=false so per-element handlers
    // run first (e.g. a row click that opens the panel doesn't immediately
    // close it via this listener — React state batches it correctly).
    document.addEventListener('mousedown', onDocPointerDown);
    return () => document.removeEventListener('mousedown', onDocPointerDown);
  }, [open, onClose]);

  // Defensive close handler — stops propagation so the click-outside
  // listener (which runs at the document level) doesn't see the X click
  // as an "outside" click. Belt-and-braces; the contains() check above
  // already handles it, but this is harmless and explicit.
  const handleCloseClick = (e) => {
    e.stopPropagation();
    onClose?.();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Mobile-only dimmed backdrop */}
          <motion.div
            className="fixed inset-0 z-30 md:hidden bg-n-900/30"
            variants={backdropVariants}
            initial="initial"
            animate="enter"
            exit="exit"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.aside
            ref={panelRef}
            role="dialog"
            aria-modal="false"
            aria-labelledby="detail-panel-title"
            className={clsx(
              'fixed top-12 right-0 z-40',
              'h-[calc(100vh-3rem-1.75rem)]',  // viewport - topbar - statusbar
              'bg-white border-l border-n-200 shadow-popover',
              'flex flex-col',
              className
            )}
            style={{ width: '100%', maxWidth: width }}
            variants={sidePanelVariants}
            initial="initial"
            animate="enter"
            exit="exit"
          >
            <header className="flex items-start justify-between gap-3 px-4 py-3 border-b border-n-200 flex-shrink-0">
              <div className="min-w-0">
                {subtitle && (
                  <div className="text-xs text-n-500 font-mono-num truncate">{subtitle}</div>
                )}
                {title && (
                  <h3 id="detail-panel-title" className="text-[15px] font-semibold text-n-800 mt-0.5 truncate">
                    {title}
                  </h3>
                )}
              </div>
              {/*
                Close button — WCAG 2.5.5 compliant.
                Visual icon is 16×16, but the button's hit area is 36×36 via
                the explicit w-9 h-9 sizing. Negative margin (-mr-1.5) pulls
                it back into the header padding so the visual rhythm stays
                tight while the click target stays generous.
                Three ways to dismiss this panel: X click, Esc key, or click
                anywhere outside the panel.
              */}
              <button
                type="button"
                onClick={handleCloseClick}
                aria-label="Close detail panel (Esc)"
                title="Close (Esc)"
                className={clsx(
                  'w-9 h-9 -mr-1.5 grid place-items-center rounded-md',
                  'text-n-500 hover:bg-n-100 hover:text-n-800',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  'flex-shrink-0 transition-colors'
                )}
              >
                <X className="w-4 h-4" />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto p-4">{children}</div>
            {footer && (
              <footer className="flex items-center justify-end gap-2 px-4 py-3 border-t border-n-200 bg-n-0 flex-shrink-0">
                {footer}
              </footer>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
