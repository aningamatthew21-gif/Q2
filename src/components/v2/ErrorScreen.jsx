import React from 'react';
import Icon from '../common/Icon';
import Button from '../common/Button';

/**
 * ErrorScreen — single component, 7 variants, one consistent UI for
 * every failure state in the app.
 *
 * Standards anchor:
 *   - WCAG 2.1 AA — role="alert" announces to screen readers, icon
 *     + heading + text together (not color-only); focus is moved to
 *     the primary action so keyboard users land somewhere useful.
 *   - ISO/IEC 25010 Usability — User Error Protection / Recoverability:
 *     every variant offers at least one recovery affordance (retry, go
 *     back, contact support, etc.) and an opaque requestId for support
 *     correlation.
 *   - OWASP ASVS V11.1.1 — no stack trace is rendered to the user
 *     (the page only shows the friendly message + the requestId; the
 *     details live in QA_ERROR_LOG keyed by that ID).
 *
 * Usage:
 *
 *   <ErrorScreen
 *     variant="permission"          // empty|loading|network|notfound|permission|conflict|server|inline
 *     title="You don't have access" // optional override; sensible default per variant
 *     detail="Your role is sales_officer; this page requires invoice.approve.finance."
 *     actions={[
 *       { label: 'Go back',       onClick: () => navigate(-1), tone: 'primary' },
 *       { label: 'Request access', onClick: () => mailto(IT_EMAIL) }
 *     ]}
 *     requestId="req_a1b2c3d4"      // shown monospace at bottom for support
 *   />
 *
 * Compact mode for inline use (e.g. inside a Card body, not full page):
 *
 *   <ErrorScreen variant="empty" compact />
 */

const VARIANTS = {
  empty: {
    icon: 'inbox',
    iconColorClass: 'text-gray-400',
    bgClass:        'bg-gray-50',
    borderClass:    'border-gray-200',
    defaultTitle:   'Nothing here yet',
    defaultDetail:  'No records match the current filters.',
    role: 'status',
    ariaLive: 'polite'
  },
  loading: {
    icon: 'loader',
    iconColorClass: 'text-blue-500 animate-spin',
    bgClass:        'bg-white',
    borderClass:    'border-gray-100',
    defaultTitle:   'Loading…',
    defaultDetail:  'Fetching the latest data.',
    role: 'status',
    ariaLive: 'polite'
  },
  network: {
    icon: 'cloud-off',
    iconColorClass: 'text-amber-500',
    bgClass:        'bg-amber-50',
    borderClass:    'border-amber-200',
    defaultTitle:   'Connection problem',
    defaultDetail:  'We couldn\'t reach the server. Please check your connection and try again.',
    role: 'alert',
    ariaLive: 'assertive'
  },
  notfound: {
    icon: 'help-circle',
    iconColorClass: 'text-gray-500',
    bgClass:        'bg-gray-50',
    borderClass:    'border-gray-200',
    defaultTitle:   'Not found',
    defaultDetail:  'We couldn\'t find what you were looking for. It may have been deleted or moved.',
    role: 'status',
    ariaLive: 'polite'
  },
  permission: {
    icon: 'lock',
    iconColorClass: 'text-indigo-500',
    bgClass:        'bg-indigo-50',
    borderClass:    'border-indigo-200',
    defaultTitle:   'Access required',
    defaultDetail:  'You don\'t have permission to view or perform this action.',
    role: 'alert',
    ariaLive: 'assertive'
  },
  conflict: {
    icon: 'alert-triangle',
    iconColorClass: 'text-yellow-600',
    bgClass:        'bg-yellow-50',
    borderClass:    'border-yellow-200',
    defaultTitle:   'Out-of-date',
    defaultDetail:  'Someone else changed this while you were editing. Reload to get the latest version.',
    role: 'alert',
    ariaLive: 'assertive'
  },
  server: {
    icon: 'alert-octagon',
    iconColorClass: 'text-red-600',
    bgClass:        'bg-red-50',
    borderClass:    'border-red-200',
    defaultTitle:   'Something went wrong',
    defaultDetail:  'An unexpected error occurred. Engineering has been notified.',
    role: 'alert',
    ariaLive: 'assertive'
  },
  inline: {
    icon: 'info',
    iconColorClass: 'text-blue-600',
    bgClass:        'bg-blue-50',
    borderClass:    'border-blue-200',
    defaultTitle:   'Please review',
    defaultDetail:  'Some fields need your attention.',
    role: 'alert',
    ariaLive: 'polite'
  }
};

const ErrorScreen = ({
    variant = 'server',
    title,
    detail,
    actions = [],
    requestId = null,
    compact = false,
    className = ''
}) => {
    const def = VARIANTS[variant] || VARIANTS.server;
    const heading = title  || def.defaultTitle;
    const body    = detail || def.defaultDetail;

    // Move keyboard focus to the primary action so users can act
    // immediately without re-grabbing focus with the mouse.
    const primaryActionRef = React.useRef(null);
    React.useEffect(() => {
        if (primaryActionRef.current && actions.length > 0 && !compact) {
            try { primaryActionRef.current.focus({ preventScroll: true }); } catch (_) {}
        }
    }, [actions.length, compact]);

    const wrapperPadding = compact ? 'py-6 px-4' : 'py-16 px-6';
    const iconSize       = compact ? 'h-8 w-8'   : 'h-12 w-12';
    const titleSize      = compact ? 'text-base' : 'text-xl';

    return (
        <div
            role={def.role}
            aria-live={def.ariaLive}
            className={`flex flex-col items-center text-center rounded-lg border ${def.borderClass} ${def.bgClass} ${wrapperPadding} ${className}`}
        >
            <Icon id={def.icon} className={`${iconSize} ${def.iconColorClass} mb-3`} />
            <h2 className={`font-semibold text-gray-900 ${titleSize} mb-1`}>{heading}</h2>
            <p className="text-sm text-gray-600 max-w-md mb-4">{body}</p>

            {actions.length > 0 && (
                <div className="flex flex-wrap gap-2 justify-center mb-2">
                    {actions.map((a, i) => (
                        <Button
                            key={i}
                            ref={i === 0 ? primaryActionRef : undefined}
                            onClick={a.onClick}
                            variant={a.tone === 'primary' ? 'primary' : (a.tone === 'danger' ? 'danger' : 'ghost')}
                            size={compact ? 'xs' : 'sm'}
                            leftIcon={a.icon ? <Icon id={a.icon} /> : undefined}
                            disabled={a.disabled}
                        >
                            {a.label}
                        </Button>
                    ))}
                </div>
            )}

            {requestId && !compact && (
                <div className="mt-3 text-[11px] text-gray-400 font-mono">
                    Reference: <span className="select-all">{requestId}</span>
                </div>
            )}
        </div>
    );
};

export default ErrorScreen;
