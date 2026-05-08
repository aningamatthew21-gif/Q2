import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { sidePanelVariants, backdropVariants } from './motion';

/**
 * DetailPanel — right-side sliding drawer for previewing a row from a list.
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
 *
 * No backdrop on md+ (the rest of the page stays interactive); on sm
 * it gets a tinted backdrop for clarity. Slide motion uses
 * sidePanelVariants so it matches the rest of the app's feel.
 */
export default function DetailPanel({
  open, onClose,
  title, subtitle, footer,
  width = 380,
  className = '',
  children
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
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
              <button
                type="button"
                onClick={onClose}
                aria-label="Close detail panel"
                className="w-7 h-7 grid place-items-center rounded-md text-n-500 hover:bg-n-100 hover:text-n-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent flex-shrink-0"
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
