import React from 'react';
import GlassModal from '../common/GlassModal';
import Button from '../common/Button';

/**
 * ImportProgressModal — blocking progress overlay for bulk Excel/CSV imports.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Bulk imports (Inventory, Customers, …) write hundreds–thousands of rows
 * to the database in batches, which takes real time. Before this modal the
 * user was left sitting on the "Confirm Import / Update & Add" dialog while
 * that ran — so they could click the confirm button AGAIN, or Cancel,
 * mid-flight, causing duplicate inserts / double data entry.
 *
 * The moment an import is confirmed the caller swaps the confirmation
 * dialog for THIS modal. It is deliberately UN-CANCELLABLE while running
 * (no close button, backdrop click ignored, Escape guarded by the parent)
 * and shows a live spinner + progress bar + "X / Y rows" counter so the
 * user can see exactly how far the load has got. Only once `done` is true
 * does a Done button appear.
 *
 * Props:
 *   title      — heading, e.g. "Importing inventory"
 *   processed  — rows committed so far
 *   total      — total rows in the import
 *   failed     — rows the server rejected (shown in the final summary)
 *   done       — true once every batch has been sent
 *   error      — fatal error string (import aborted); shown instead of the summary
 *   onClose    — invoked from the final Done button (and ignored while running)
 */
export default function ImportProgressModal({
  title = 'Importing data',
  processed = 0,
  total = 0,
  failed = 0,
  done = false,
  error = null,
  onClose
}) {
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const succeeded = Math.max(0, processed - failed);
  const safeClose = () => { if (done && typeof onClose === 'function') onClose(); };

  const footer = done ? (
    <Button variant="primary" onClick={safeClose}>Done</Button>
  ) : null;

  return (
    <GlassModal
      open
      // While the import is running, closing is a no-op — the load must
      // not be interrupted and the user must not be able to re-trigger it.
      onClose={safeClose}
      closeOnBackdrop={done}
      title={title}
      size="sm"
      footer={footer}
      hideCloseButton={!done}
    >
      <div className="py-1">
        {!done && !error && (
          <div className="flex items-center gap-3 mb-4">
            <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 flex-shrink-0" />
            <div className="text-sm text-ink-muted">
              Loading into the database… please keep this window open.
            </div>
          </div>
        )}

        {/* Progress bar */}
        <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              error ? 'bg-red-500' : done ? 'bg-green-500' : 'bg-blue-600'
            }`}
            style={{ width: `${done && !error ? 100 : pct}%` }}
          />
        </div>

        {/* Live counter */}
        <div className="mt-2 flex items-center justify-between text-sm">
          <span className="font-medium text-ink">
            {processed.toLocaleString()} / {total.toLocaleString()} rows
          </span>
          <span className="text-ink-muted">{done && !error ? 100 : pct}%</span>
        </div>

        {/* Final summary / fatal error */}
        {error ? (
          <div className="mt-4 p-3 rounded-md bg-red-50 border border-red-200 text-sm text-red-700">
            <div className="font-semibold">Import stopped.</div>
            <div className="mt-1 text-xs">{error}</div>
            {processed > 0 && (
              <div className="mt-1 text-xs">
                {succeeded.toLocaleString()} row(s) were saved before it stopped.
              </div>
            )}
          </div>
        ) : done ? (
          <div className="mt-4 p-3 rounded-md bg-green-50 border border-green-200 text-sm text-green-800">
            <div className="font-semibold">Import complete.</div>
            <div className="mt-1 text-xs text-green-700">
              {succeeded.toLocaleString()} row(s) saved
              {failed > 0 && (
                <span className="text-amber-700"> · {failed.toLocaleString()} could not be saved</span>
              )}.
            </div>
          </div>
        ) : null}
      </div>
    </GlassModal>
  );
}
