import React from 'react';
import ErrorScreen from './ErrorScreen';
import api from '../../api';

/**
 * ErrorBoundary — catches render-time React errors that would otherwise
 * white-screen the app, renders a user-friendly fallback, and POSTs a
 * report to /api/errors/report so the admin Error Monitor surfaces it.
 *
 * Standards anchor:
 *   - ISO/IEC 25010 Reliability — Fault tolerance + Recoverability:
 *     a render crash in one page no longer takes down the rest of the
 *     app (per-page boundaries) or the entire SPA (app-level boundary).
 *   - OWASP ASVS V11.1.7 — error reporting is fire-and-forget; report
 *     failures cannot cascade into another crash.
 *   - WCAG 2.1 AA — fallback ErrorScreen has role="alert" + actionable
 *     recovery affordances (reload, go home).
 *
 * Placement:
 *   <ErrorBoundary scope="app">       — once at AppShell root
 *     <ErrorBoundary scope="page">    — per page render slot
 *       <SomePage />
 *     </ErrorBoundary>
 *   </ErrorBoundary>
 *
 * On error, the user sees the server-variant ErrorScreen with two
 * actions: "Try again" (re-mounts the children) and "Go home" (sends
 * them to the dashboard). A correlation requestId is shown for support.
 */

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, requestId: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        // Compose a correlation id for the user → log lookup. The
        // backend reportError() will dedup by fingerprint so spamming
        // here is harmless, but we still avoid blocking the render.
        const requestId = `cli_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        this.setState({ requestId });

        // Fire-and-forget — never let the report itself crash the
        // boundary. Wrap in try/catch + .catch() for completeness.
        try {
            api.post('/errors/report', {
                code:    'E_INTERNAL',
                severity:'ERROR',
                source:  'react',
                message: (error && error.message) || 'Render error',
                stack:   (error && error.stack) || null,
                route:   typeof window !== 'undefined' ? window.location.search : null,
                userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
                payload: {
                    scope: this.props.scope || 'unknown',
                    componentStack: errorInfo && errorInfo.componentStack
                }
            }).catch(() => {});
        } catch (_) { /* never re-throw */ }

        /* eslint-disable no-console */
        console.error('[ErrorBoundary]', this.props.scope || 'unknown', error, errorInfo);
        /* eslint-enable no-console */
    }

    reset = () => {
        this.setState({ hasError: false, error: null, requestId: null });
    };

    goHome = () => {
        try {
            const url = new URL(window.location.href);
            url.searchParams.delete('page');
            window.location.href = url.toString();
        } catch (_) {
            window.location.href = '/';
        }
    };

    render() {
        if (this.state.hasError) {
            // Scope determines the fallback UX:
            //   'app'   — full-page; user is offered Reload + Go home
            //   'page'  — page-level; user is offered Try again + Go home
            //   'card'  — section-level; user is offered Try again only
            const scope = this.props.scope || 'page';
            const isApp = scope === 'app';
            const compact = scope === 'card';

            const actions = [];
            actions.push({
                label: isApp ? 'Reload app' : 'Try again',
                tone: 'primary',
                icon: 'rotate-cw',
                onClick: () => (isApp ? window.location.reload() : this.reset())
            });
            if (scope !== 'card') {
                actions.push({
                    label: 'Go to dashboard',
                    tone: 'ghost',
                    icon: 'home',
                    onClick: this.goHome
                });
            }

            return (
                <ErrorScreen
                    variant="server"
                    title={isApp ? 'The app encountered an unexpected error' : 'This page couldn\'t render'}
                    detail={
                        isApp
                            ? 'You can safely reload — your work in unsaved forms may be lost, but signed-in state is preserved.'
                            : 'The rest of the app is still working. You can try this view again or go back to your dashboard.'
                    }
                    actions={actions}
                    requestId={this.state.requestId}
                    compact={compact}
                    className={isApp ? 'mx-auto max-w-2xl mt-20' : 'mx-auto max-w-xl my-8'}
                />
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
