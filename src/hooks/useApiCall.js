import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * useApiCall — uniform pattern for "fetch on mount, render loading /
 * error / data, retry on demand."
 *
 * Standards anchor:
 *   - ISO/IEC 25010 Reliability — Recoverability (caller-driven retry)
 *     + Fault tolerance (abort-on-unmount prevents state-update-on-
 *     unmounted-component warnings that hide real bugs).
 *   - ISO/IEC 25010 Usability — User Error Protection: the returned
 *     `error` always carries `archetype` and `userMessage` so the
 *     caller can render an <ErrorScreen variant={error.archetype} />
 *     without parsing free text.
 *   - OWASP ASVS V11.1.1 — error info presented to user is the
 *     server-safe `userMessage`; raw axios / network errors stay in
 *     the dev console only.
 *
 * Returns:
 *
 *   {
 *     data:    T | null,
 *     error:   { code, message, archetype, requestId, retryable, raw } | null,
 *     loading: boolean,
 *     retry:   () => void,
 *     setData: (next) => void    // optimistic-update escape hatch
 *   }
 *
 * Usage:
 *
 *   const { data, error, loading, retry } = useApiCall(
 *     () => api.get(`/invoices/${id}`),
 *     [id]
 *   );
 *
 *   if (loading)        return <ErrorScreen variant="loading" />;
 *   if (error)          return <ErrorScreen variant={error.archetype}
 *                              title={error.title}
 *                              detail={error.message}
 *                              actions={error.retryable ? [{label:'Retry', onClick:retry, tone:'primary'}] : []}
 *                              requestId={error.requestId} />;
 *   return <View data={data.data} />;
 *
 * Options:
 *   { manual: true }  — don't fire on mount; call retry() to invoke
 *   { onError }       — side-effect hook (toast etc.); rendered error
 *                       still returned
 *   { onSuccess }     — side-effect hook (analytics, etc.)
 */

// Map an axios-style error (or plain Error) into the shape the
// frontend ErrorScreen consumes. Mirrors shared/errors.js archetypes.
function normalizeError(err) {
    // axios error with backend envelope: { success: false, error: { code, message, requestId, retryable } }
    const envelope = err?.response?.data?.error;
    if (envelope && typeof envelope === 'object' && envelope.code) {
        return {
            code:       envelope.code,
            message:    envelope.message || 'Something went wrong.',
            archetype:  archetypeFor(envelope.code, err?.response?.status),
            requestId:  envelope.requestId || null,
            field:      envelope.field || null,
            retryable:  !!envelope.retryable,
            httpStatus: err?.response?.status || 0,
            raw:        err
        };
    }

    // axios error WITHOUT a structured envelope (legacy routes, gateway
    // errors). Heuristic: use HTTP status.
    const status = err?.response?.status;
    if (status === 401 || status === 403) {
        return mkErr('E_PERM_DENIED', 'permission', status, err?.response?.data?.error || 'Access denied.', err);
    }
    if (status === 404) {
        return mkErr('E_NOT_FOUND', 'notfound', status, err?.response?.data?.error || 'Not found.', err);
    }
    if (status === 409) {
        return mkErr('E_CONFLICT_STATE', 'conflict', status, err?.response?.data?.error || 'Conflicting change.', err);
    }
    if (status === 429) {
        return mkErr('E_RATE_LIMITED', 'network', status, 'Too many requests — please slow down.', err, true);
    }
    if (status >= 500) {
        return mkErr('E_INTERNAL', 'server', status, err?.response?.data?.error || 'Server error.', err);
    }

    // Network / no response — true transport failure
    if (!err?.response) {
        const isAbort = err?.name === 'AbortError' || err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED';
        if (isAbort) return null; // not an error to surface
        return mkErr('E_TIMEOUT', 'network', 0, 'We couldn\'t reach the server. Please check your connection.', err, true);
    }

    return mkErr('E_UNKNOWN', 'server', status || 0, err?.message || 'Unexpected error.', err);
}

function mkErr(code, archetype, status, message, raw, retryable = false) {
    return {
        code, message, archetype,
        requestId: raw?.response?.data?.error?.requestId || null,
        field:     null,
        retryable,
        httpStatus: status,
        raw
    };
}

// Code → archetype lookup that mirrors shared/errors.js (kept in sync
// by convention; small enough that keeping it here avoids importing
// CommonJS into a hot hook).
const ARCHETYPE_BY_CODE = {
    E_AUTH_REQUIRED:    'permission',
    E_AUTH_EXPIRED:     'permission',
    E_AUTH_INVALID:     'permission',
    E_PERM_DENIED:      'permission',
    E_SOD_VIOLATION:    'permission',
    E_NOT_FOUND:        'notfound',
    E_VALIDATION:       'inline',
    E_BAD_REQUEST:      'server',
    E_CONFLICT_STATE:   'conflict',
    E_CONFLICT_DUP:     'inline',
    E_RATE_LIMITED:     'network',
    E_PAYLOAD_TOO_LARGE:'inline',
    E_UNSUPPORTED_MEDIA:'inline',
    E_DB_DOWN:          'server',
    E_DB_QUERY:         'server',
    E_DB_CONSTRAINT:    'inline',
    E_EXTERNAL_DOWN:    'server',
    E_TIMEOUT:          'network',
    E_INTERNAL:         'server',
    E_UNKNOWN:          'server'
};
function archetypeFor(code, status) {
    if (ARCHETYPE_BY_CODE[code]) return ARCHETYPE_BY_CODE[code];
    if (status === 401 || status === 403) return 'permission';
    if (status === 404) return 'notfound';
    if (status === 409) return 'conflict';
    if (status === 429) return 'network';
    if (status >= 500)  return 'server';
    return 'server';
}

export function useApiCall(fn, deps = [], opts = {}) {
    const { manual = false, onError, onSuccess } = opts;
    const [data, setData]       = useState(null);
    const [error, setError]     = useState(null);
    const [loading, setLoading] = useState(!manual);
    const reqRef = useRef(0); // monotonic request counter for cancellation
    const mountedRef = useRef(true);

    const run = useCallback(async () => {
        const myReq = ++reqRef.current;
        setLoading(true);
        setError(null);
        try {
            const result = await fn();
            // Stale-response guard: only update state if this is still
            // the latest in-flight call AND we're still mounted.
            if (!mountedRef.current || myReq !== reqRef.current) return;
            setData(result);
            setLoading(false);
            if (onSuccess) try { onSuccess(result); } catch (_) {}
        } catch (err) {
            if (!mountedRef.current || myReq !== reqRef.current) return;
            const normalized = normalizeError(err);
            if (normalized) {
                setError(normalized);
                if (onError) try { onError(normalized); } catch (_) {}
            }
            setLoading(false);
        }
        // intentionally not depending on fn — the deps array passed in
        // controls when to re-run (mirrors useEffect mental model).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);

    useEffect(() => {
        mountedRef.current = true;
        if (!manual) run();
        return () => { mountedRef.current = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);

    return { data, error, loading, retry: run, setData };
}

export default useApiCall;
