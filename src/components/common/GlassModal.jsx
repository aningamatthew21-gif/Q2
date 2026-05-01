import React, { useEffect, useRef } from 'react';
import GlassSurface from './GlassSurface';

/**
 * GlassModal — Apple-style modal shell.
 *
 * Single source of truth for every modal/popup in the app. Wraps
 * children in a <GlassSurface> centered on a dim-and-blurred backdrop.
 * Centralizes the keyboard / focus-trap / scroll-lock behavior that
 * previously lived only inside `modals/ConfirmationModal.jsx` (L5),
 * so every modal inherits it for free.
 *
 * Features:
 *   - Escape closes (calls onClose)
 *   - Optional backdrop click-to-close (closeOnBackdrop, default true)
 *   - Tab / Shift+Tab cycle among focusable descendants (focus trap)
 *   - First focusable element gets focus on open
 *   - Focus restored to previously-focused element on close
 *   - `aria-modal`, `role="dialog"`, `aria-labelledby`, `aria-describedby`
 *   - Body scroll locked while open
 *   - Respects prefers-reduced-motion via global stylesheet rule
 *
 * Props:
 *   - open:        boolean (default true — most callers conditionally render)
 *   - onClose:     function — fires on Escape / backdrop click / X button
 *   - title:       optional h2 text (sets aria-labelledby)
 *   - description: optional leading paragraph (sets aria-describedby)
 *   - footer:      optional node rendered at the bottom (usually buttons)
 *   - size:        'sm' | 'md' | 'lg' | 'xl' | 'fit'   (default 'md')
 *   - closeOnBackdrop: boolean (default true)
 *   - hideCloseButton: boolean — suppresses the X button (default false)
 *   - initialFocusRef: optional ref to focus on open (overrides first focusable)
 *   - children:    modal body
 *   - className:   pass-through to the inner GlassSurface
 */

const SIZE_CLASS = {
  sm:  'max-w-sm',
  md:  'max-w-md',
  lg:  'max-w-2xl',
  xl:  'max-w-4xl',
  fit: 'max-w-fit',
  // Full-screen workspace style — used by the PDF preview modals which
  // need to fill the viewport like a native app window.
  full: 'max-w-none w-screen h-screen rounded-none'
};

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function GlassModal({
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

  useEffect(() => {
    if (!open) return undefined;

    previouslyFocusedRef.current =
      typeof document !== 'undefined' ? document.activeElement : null;

    // Initial focus
    const focusInitial = () => {
      if (initialFocusRef?.current?.focus) {
        initialFocusRef.current.focus();
        return;
      }
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = panel.querySelectorAll(FOCUSABLE_SELECTOR);
      if (focusables.length > 0) focusables[0].focus();
      else panel.focus();
    };
    // Defer one tick so children mount + refs populate.
    const t = setTimeout(focusInitial, 0);

    const handleKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
        return;
      }
      if (e.key === 'Tab') {
        const panel = panelRef.current;
        if (!panel) return;
        const focusables = Array.from(panel.querySelectorAll(FOCUSABLE_SELECTOR))
          .filter(el => el.offsetParent !== null || el === document.activeElement);
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKey);

    // Body scroll lock
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = originalOverflow;
      // Restore focus to whatever opened the modal
      const prev = previouslyFocusedRef.current;
      if (prev && typeof prev.focus === 'function') {
        try { prev.focus(); } catch { /* ignore */ }
      }
    };
  }, [open, onClose, initialFocusRef]);

  if (!open) return null;

  const onBackdropMouseDown = (e) => {
    // Only close when the backdrop itself is clicked — not descendant clicks
    // that bubble up.
    if (!closeOnBackdrop) return;
    if (e.target === e.currentTarget) onClose?.();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/30 backdrop-blur-sm"
      onMouseDown={onBackdropMouseDown}
      aria-hidden={false}
    >
      <GlassSurface
        as="div"
        ref={panelRef}
        tint="strong"
        radius="glass"
        interactive={false}
        padding="p-0"
        className={[
          'w-full',
          SIZE_CLASS[size] ?? SIZE_CLASS.md,
          size === 'full' ? 'max-h-screen' : 'max-h-[90vh]',
          'overflow-hidden flex flex-col',
          className
        ].join(' ')}
        // Make the inner z-10 wrapper also a flex column so the modal's
        // header/body/footer can use `flex-1 overflow-y-auto` for scrolling.
        // Without this the inner div blocks the flex context and the body
        // grows past the modal's max-height instead of scrolling.
        innerClassName="flex flex-col flex-1 min-h-0"
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'glass-modal-title' : undefined}
        aria-describedby={description ? 'glass-modal-description' : undefined}
        tabIndex={-1}
      >
        {/* Header */}
        {(title || !hideCloseButton) && (
          <header className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b border-line/60">
            <div className="min-w-0">
              {title && (
                <h2
                  id="glass-modal-title"
                  className="text-lg font-semibold text-ink leading-tight"
                >
                  {title}
                </h2>
              )}
              {description && (
                <p
                  id="glass-modal-description"
                  className="mt-1 text-sm text-ink-muted"
                >
                  {description}
                </p>
              )}
            </div>
            {!hideCloseButton && (
              <button
                type="button"
                onClick={() => onClose?.()}
                aria-label="Close"
                className="flex-shrink-0 rounded-pill w-8 h-8 flex items-center justify-center text-ink-muted hover:bg-surface-sunken hover:text-ink transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                  className="w-4 h-4"
                >
                  <path
                    fillRule="evenodd"
                    d="M4.28 3.22a.75.75 0 0 0-1.06 1.06L8.94 10l-5.72 5.72a.75.75 0 1 0 1.06 1.06L10 11.06l5.72 5.72a.75.75 0 1 0 1.06-1.06L11.06 10l5.72-5.72a.75.75 0 0 0-1.06-1.06L10 8.94 4.28 3.22Z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            )}
          </header>
        )}

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <footer className="flex items-center justify-end gap-2 px-6 py-4 border-t border-line/60">
            {footer}
          </footer>
        )}
      </GlassSurface>
    </div>
  );
}
