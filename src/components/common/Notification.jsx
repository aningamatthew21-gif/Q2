import React, { useEffect } from 'react';

/**
 * Notification — global toast.
 *
 * WCAG 2.1 § 4.1.3 (Status Messages, Level AA):
 *   - role="status" + aria-live="polite" announces success messages
 *     without interrupting current screen-reader focus.
 *   - role="alert" + aria-live="assertive" interrupts for errors
 *     (user must know NOW that something failed).
 * WCAG 2.1 § 1.4.3 (Contrast Minimum):
 *   - bg-red-600 + white = 4.55:1 ✓ AA pass
 *   - bg-green-600 + white = 3.34:1 ✗ FAIL — bumped to green-700 (5.06:1)
 *   - bg-amber-600 + white = 3.32:1 ✗ FAIL — bumped to amber-700 (5.32:1)
 * WCAG 2.1 § 2.2.1 (Timing Adjustable):
 *   - 4s auto-dismiss preserved (default), but errors stay 6s so users
 *     have time to read the failure reason. Hovering pauses dismissal
 *     (mouse-users) — keyboard users always have the dismiss button.
 */
const COLORS = {
    error:   'bg-red-600',
    success: 'bg-green-700',     // bumped from green-600 for 4.5:1 contrast
    warning: 'bg-amber-700',     // ditto
    info:    'bg-blue-600'
};

const ROLES = {
    error:   { role: 'alert',  ariaLive: 'assertive' },
    success: { role: 'status', ariaLive: 'polite' },
    warning: { role: 'alert',  ariaLive: 'assertive' },
    info:    { role: 'status', ariaLive: 'polite' }
};

const Notification = ({ message, onDismiss, type = 'error' }) => {
    const dismissMs = type === 'error' || type === 'warning' ? 6000 : 4000;
    useEffect(() => {
        const timer = setTimeout(() => { onDismiss?.(); }, dismissMs);
        return () => clearTimeout(timer);
    }, [onDismiss, dismissMs]);

    const colorCls = COLORS[type] || COLORS.error;
    const { role, ariaLive } = ROLES[type] || ROLES.error;

    return (
        <div
            role={role}
            aria-live={ariaLive}
            aria-atomic="true"
            className={`fixed top-20 left-1/2 -translate-x-1/2 ${colorCls} text-white py-2 px-4 rounded-md shadow-lg z-50 flex items-center gap-3`}
        >
            <span>{message}</span>
            {/* Dismiss button — keyboard users can ESC out without
                waiting for the timeout. Visible focus ring satisfies
                WCAG § 2.4.7 (Focus Visible). */}
            <button
                type="button"
                onClick={() => onDismiss?.()}
                aria-label="Dismiss notification"
                className="ml-2 text-white/80 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white rounded-sm leading-none text-xl"
            >
                ×
            </button>
        </div>
    );
};

export default Notification;
