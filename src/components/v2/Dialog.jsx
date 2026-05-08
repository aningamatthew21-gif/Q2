import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { dialogVariants, backdropVariants } from './motion';

/**
 * Dialog — flat Fluent 2 dialog (replaces v1 GlassModal for non-login modals).
 *
 * Carries forward the focus-trap, body-scroll-lock, Escape-to-close, and
 * focus-restore behaviours from GlassModal.jsx so every existing modal can
 * swap implementations without changing UX semantics.
 *
 * Sizes:
 *   sm  = 448px max-width   (confirms)
 *   md  = 576px             (most modals — default)
 *   lg  = 768px             (item / customer editors)
 *   xl  = 960px             (RFQ preview)
 *   fit = max-w-fit
 *   full = fullscreen viewport
 */
const SIZE = {
  sm:   'max-w-md',
  md:   'max-w-xl',
  lg:   'max-w-3xl',
  xl:   'max-w-5xl',
  fit:  'max-w-fit',
  full: 'max-w-none w-screen h-screen rounded-none'
};

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Dialog({
  open = true,
  onClose,
  title,
  description,
  footer,
  size = 'md',
  closeOnBackdrop = true,
  hideCloseButton = false,
  initialFocusRef,
  className = '',
  children
}) {
  const panelRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  // Keep `onClose` and `initialFocusRef` reachable inside the open-effect
  // without putting them in the deps. Earlier the deps included these, and
  // since most callers pass an inline arrow function (`onClose={() => ...}`)
  // a NEW reference was created on every parent render. That caused the
  // effect to tear down + re-run on every keystroke, and the "focus the
  // first focusable element on open" logic would steal focus from the
  // <input> back to the Close (X) button — producing the "type one
  // character then the box loses focus" bug.
  //
  // Stable refs sidestep React's stale-closure trap without breaking the
  // dependency contract.
  const onCloseRef        = useRef(onClose);
  const initialFocusRefRef = useRef(initialFocusRef);
  useEffect(() => { onCloseRef.current        = onClose;        }, [onClose]);
  useEffect(() => { initialFocusRefRef.current = initialFocusRef; }, [initialFocusRef]);

  useEffect(() => {
    if (!open) return undefined;

    previouslyFocusedRef.current =
      typeof document !== 'undefined' ? document.activeElement : null;

    const focusInitial = () => {
      const focusRef = initialFocusRefRef.current;
      if (focusRef?.current?.focus) {
        focusRef.current.focus();
        return;
      }
      const panel = panelRef.current;
      if (!panel) return;
      // Prefer the first text input / textarea / select so the user can
      // start typing immediately. Fall back to any focusable element.
      const firstField = panel.querySelector(
        'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])'
      );
      if (firstField) { firstField.focus(); return; }
      const focusables = panel.querySelectorAll(FOCUSABLE);
      if (focusables.length > 0) focusables[0].focus();
      else panel.focus();
    };
    const t = setTimeout(focusInitial, 0);

    const handleKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (e.key === 'Tab') {
        const panel = panelRef.current;
        if (!panel) return;
        const focusables = Array.from(panel.querySelectorAll(FOCUSABLE))
          .filter(el => el.offsetParent !== null || el === document.activeElement);
        if (focusables.length === 0) { e.preventDefault(); return; }
        const first = focusables[0];
        const last  = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handleKey);

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = originalOverflow;
      const prev = previouslyFocusedRef.current;
      if (prev?.focus) { try { prev.focus(); } catch { /* ignore */ } }
    };
    // ONLY depend on `open`. Other handlers are read via refs above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onBackdropMouseDown = (e) => {
    if (!closeOnBackdrop) return;
    if (e.target === e.currentTarget) onClose?.();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          variants={backdropVariants}
          initial="initial"
          animate="enter"
          exit="exit"
          onMouseDown={onBackdropMouseDown}
          aria-hidden={false}
        >
          <motion.div
            className="absolute inset-0 bg-n-900/40"
            variants={backdropVariants}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title       ? 'dialog-title'        : undefined}
            aria-describedby={description ? 'dialog-description' : undefined}
            tabIndex={-1}
            variants={dialogVariants}
            className={clsx(
              'relative w-full bg-white rounded-panel border border-n-200',
              'shadow-popover overflow-hidden flex flex-col',
              size === 'full' ? 'max-h-screen' : 'max-h-[90vh]',
              SIZE[size] ?? SIZE.md,
              className
            )}
          >
            {(title || !hideCloseButton) && (
              <header className="flex items-start justify-between gap-4 px-5 pt-4 pb-3 border-b border-n-200">
                <div className="min-w-0">
                  {title && (
                    <h2 id="dialog-title" className="text-[16px] font-semibold text-n-800 leading-tight">
                      {title}
                    </h2>
                  )}
                  {description && (
                    <p id="dialog-description" className="mt-1 text-[13px] text-n-500">
                      {description}
                    </p>
                  )}
                </div>
                {!hideCloseButton && (
                  <button
                    type="button"
                    onClick={() => onClose?.()}
                    aria-label="Close"
                    className="flex-shrink-0 w-7 h-7 grid place-items-center rounded-md text-n-500 hover:bg-n-100 hover:text-n-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </header>
            )}

            <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

            {footer && (
              <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-n-200 bg-n-0">
                {footer}
              </footer>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
