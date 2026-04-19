import React, { useEffect, useRef } from 'react';

/**
 * L5 — Confirmation modal with keyboard handling and focus trap.
 *  - Escape key -> onCancel
 *  - Enter key  -> onConfirm (when the confirm button is focused or no other button is)
 *  - Tab / Shift+Tab cycle between Cancel and Confirm only
 *  - Initial focus lands on the confirm button so keyboard users can Enter through.
 */
const ConfirmationModal = ({ onConfirm, onCancel, title, message, confirmText, confirmColor }) => {
    const cancelRef = useRef(null);
    const confirmRef = useRef(null);
    const previouslyFocusedRef = useRef(null);

    useEffect(() => {
        // Remember who had focus so we can restore it when the modal closes
        previouslyFocusedRef.current = typeof document !== 'undefined' ? document.activeElement : null;
        // Initial focus on confirm
        confirmRef.current?.focus();

        const handleKey = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onCancel?.();
                return;
            }
            if (e.key === 'Tab') {
                const focusable = [cancelRef.current, confirmRef.current].filter(Boolean);
                if (focusable.length === 0) return;
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
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
        return () => {
            document.removeEventListener('keydown', handleKey);
            // Restore focus to whatever opened the modal
            if (previouslyFocusedRef.current && typeof previouslyFocusedRef.current.focus === 'function') {
                try { previouslyFocusedRef.current.focus(); } catch { /* ignore */ }
            }
        };
    }, [onCancel]);

    return (
        <div
            className="fixed inset-0 bg-white-50 bg-opacity-50 flex justify-center items-center z-50"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-modal-title"
            aria-describedby="confirm-modal-message"
        >
            <div className="bg-white rounded-xl shadow-2xl p-8 w-full max-w-md">
                <h2 id="confirm-modal-title" className="text-xl font-semibold text-gray-800 mb-4">{title}</h2>
                <p id="confirm-modal-message" className="text-gray-600 mb-6">{message}</p>
                <div className="flex justify-end space-x-4">
                    <button
                        ref={cancelRef}
                        onClick={onCancel}
                        className="py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400"
                    >Cancel</button>
                    <button
                        ref={confirmRef}
                        onClick={onConfirm}
                        className={`py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-red-500 ${confirmColor}`}
                    >{confirmText}</button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmationModal;
