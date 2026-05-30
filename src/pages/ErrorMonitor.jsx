import React, { useEffect, useMemo, useState, useCallback } from 'react';
import PageHeader from '../components/common/PageHeader';
import Button from '../components/common/Button';
import Icon from '../components/common/Icon';
import MetricTile from '../components/v2/MetricTile';
import Card from '../components/v2/Card';
import Dialog from '../components/v2/Dialog';
import ErrorScreen from '../components/v2/ErrorScreen';
import { SortableHeader, useSortable } from '../components/v2';
import { useApiCall } from '../hooks/useApiCall';
import api from '../api';
import socket from '../socket';
import { useApp } from '../context/AppContext';

/**
 * ErrorMonitor — admin observability dashboard for QA_ERROR_LOG.
 *
 * Standards anchor:
 *   - ISO/IEC 27001:2022 A.8.16 (Monitoring activities) — real-time
 *     observability of system errors, with stream + aggregation + drill
 *   - ISO/IEC 27001:2022 A.5.34 (PII) — payload shown is the masked
 *     copy stored at insert time; no re-derivation client-side
 *   - ISO/IEC 25010 Usability — User Error Protection (admin role):
 *     acknowledge-resolve-mute workflow prevents "wall of red" decay
 *   - WCAG 2.1 AA — colour + icon for every severity, role=alert on
 *     status panels, focus rings preserved on every interactive control
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │ Header: title · LIVE indicator · time window · filter chips     │
 *   │                                                                 │
 *   │ KPI tiles: Unique errors · Open · Critical (FATAL+ERROR) · Ack  │
 *   │                                                                 │
 *   │ Time-series chart (per-hour count, last 24h)                    │
 *   │                                                                 │
 *   │ Filter row: severity · source · status · search                 │
 *   │                                                                 │
 *   │ Dedup'd error list (sortable; click → detail dialog)            │
 *   └─────────────────────────────────────────────────────────────────┘
 *
 * Real-time stream:
 *   Subscribes to socket event `error:logged`. On receive: re-fetch the
 *   list + stats (debounced 750ms so a burst doesn't hammer the API).
 */

// ── Visual constants ─────────────────────────────────────────────────
const SEVERITY_STYLES = {
    FATAL: { bg: 'bg-red-100',    text: 'text-red-800',    border: 'border-red-300',    icon: 'alert-octagon', label: 'Fatal' },
    ERROR: { bg: 'bg-red-50',     text: 'text-red-700',    border: 'border-red-200',    icon: 'alert-circle',  label: 'Error' },
    WARN:  { bg: 'bg-amber-50',   text: 'text-amber-800',  border: 'border-amber-200',  icon: 'alert-triangle',label: 'Warn'  },
    INFO:  { bg: 'bg-blue-50',    text: 'text-blue-700',   border: 'border-blue-200',   icon: 'info',          label: 'Info'  }
};

const STATUS_STYLES = {
    OPEN:         { dot: 'bg-red-500',    text: 'text-red-700',    label: 'Open' },
    ACKNOWLEDGED: { dot: 'bg-amber-500',  text: 'text-amber-700',  label: 'Acknowledged' },
    RESOLVED:     { dot: 'bg-emerald-500',text: 'text-emerald-700',label: 'Resolved' },
    MUTED:        { dot: 'bg-gray-400',   text: 'text-gray-600',   label: 'Muted' }
};

const SOURCE_LABEL = {
    backend: 'API',
    react:   'UI',
    network: 'Net',
    manual:  'Manual'
};

const SeverityBadge = ({ value }) => {
    const s = SEVERITY_STYLES[value] || SEVERITY_STYLES.INFO;
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${s.bg} ${s.text} ${s.border}`}>
            <Icon id={s.icon} className="w-3 h-3" />
            {s.label}
        </span>
    );
};

const StatusBadge = ({ value }) => {
    const s = STATUS_STYLES[value] || STATUS_STYLES.OPEN;
    return (
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${s.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
            {s.label}
        </span>
    );
};

// Relative-time formatter that avoids importing a date library.
function relTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60)        return `${s}s ago`;
    if (s < 3600)      return `${Math.floor(s/60)}m ago`;
    if (s < 86400)     return `${Math.floor(s/3600)}h ago`;
    if (s < 86400*30)  return `${Math.floor(s/86400)}d ago`;
    return d.toISOString().slice(0, 10);
}

// ── Page ─────────────────────────────────────────────────────────────
const ErrorMonitor = () => {
    const { navigate } = useApp();

    // Filters
    const [severity, setSeverity] = useState('ANY');     // ANY | FATAL | ERROR | WARN | INFO
    const [status,   setStatus]   = useState('OPEN');    // ANY | OPEN | ACKNOWLEDGED | RESOLVED | MUTED
    const [source,   setSource]   = useState('ANY');     // ANY | backend | react | network | manual
    const [q,        setQ]        = useState('');
    const [sinceHours, setSinceHours] = useState(24);
    const [live, setLive] = useState(true);

    // Drill-down dialog state
    const [openDetail, setOpenDetail] = useState(null);   // error id
    const [actionBusy, setActionBusy] = useState(false);

    // Notification state — surfaces ack/resolve/mute failures so they
    // don't hang silently like the very bug class this page is built
    // to detect. ISO/IEC 25010 Usability — User Error Protection.
    const [notice, setNotice] = useState(null);   // {type: 'success'|'error', message}

    // Resolve modal state
    const [resolveFor, setResolveFor] = useState(null);
    const [resolveNote, setResolveNote] = useState('');

    // ── Data fetches ────────────────────────────────────────────────
    const listParams = useMemo(() => {
        const p = new URLSearchParams();
        if (severity !== 'ANY') p.set('severity', severity);
        if (status   !== 'ANY') p.set('status',   status);
        if (source   !== 'ANY') p.set('source',   source);
        if (q.trim())           p.set('q', q.trim());
        p.set('limit', '200');
        return p.toString();
    }, [severity, status, source, q]);

    const listCall = useApiCall(
        () => api.get(`/errors?${listParams}`),
        [listParams]
    );

    const statsCall = useApiCall(
        () => api.get(`/errors/stats?sinceHours=${sinceHours}`),
        [sinceHours]
    );

    const seriesCall = useApiCall(
        () => api.get(`/errors/timeseries?sinceHours=${sinceHours}`),
        [sinceHours]
    );

    // ── Real-time subscription (debounced refresh) ──────────────────
    useEffect(() => {
        if (!live) return;
        try { socket.connect(); } catch (_) {}
        let pending = null;
        const refresh = () => {
            if (pending) clearTimeout(pending);
            pending = setTimeout(() => {
                listCall.retry();
                statsCall.retry();
                seriesCall.retry();
            }, 750);
        };
        const handler = () => refresh();
        socket.on('error:logged', handler);
        return () => {
            socket.off('error:logged', handler);
            if (pending) clearTimeout(pending);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [live]);

    const stats = statsCall.data?.data?.data || statsCall.data?.data || {};
    const errors = listCall.data?.data?.data || listCall.data?.data || [];
    const series = seriesCall.data?.data?.data?.points || seriesCall.data?.data?.points || [];

    // ── Sorted list ────────────────────────────────────────────────
    const sortable = useMemo(() => (errors || []).map(e => ({
        ...e,
        _last: new Date(e.LAST_SEEN_AT || 0).getTime(),
        _count: Number(e.OCCURRENCE_COUNT || 0)
    })), [errors]);
    const { sortKey, sortDir, toggle, sortedRows } = useSortable(sortable, '_last', 'desc');

    // ── Action handlers ────────────────────────────────────────────
    const reload = useCallback(() => {
        listCall.retry();
        statsCall.retry();
        seriesCall.retry();
    }, [listCall, statsCall, seriesCall]);

    // Helper — pulls the most useful error message out of an axios error
    // (the backend's envelope message first, then HTTP-status hint).
    const extractErrMsg = (err) => {
        const env = err?.response?.data?.error;
        if (env?.message) return env.message;
        if (err?.response?.status === 404) return 'Error record not found (may have been resolved by another admin).';
        if (err?.response?.status === 403) return 'You don\'t have permission for this action.';
        if (err?.message) return err.message;
        return 'Action failed.';
    };

    const acknowledge = useCallback(async (id) => {
        setActionBusy(true);
        try {
            await api.post(`/errors/${id}/acknowledge`);
            setNotice({ type: 'success', message: 'Error acknowledged.' });
            reload();
        } catch (err) {
            setNotice({ type: 'error', message: `Acknowledge failed — ${extractErrMsg(err)}` });
        } finally { setActionBusy(false); }
    }, [reload]);

    const resolve = useCallback(async (id, note) => {
        setActionBusy(true);
        try {
            await api.post(`/errors/${id}/resolve`, { note });
            setResolveFor(null);
            setResolveNote('');
            setOpenDetail(null);
            setNotice({ type: 'success', message: 'Error marked as resolved.' });
            reload();
        } catch (err) {
            // Show the backend's specific reason so the operator can act
            // — not a silent failure that just leaves the dialog open.
            setNotice({ type: 'error', message: `Resolve failed — ${extractErrMsg(err)}` });
        } finally { setActionBusy(false); }
    }, [reload]);

    const mute = useCallback(async (id) => {
        setActionBusy(true);
        try {
            await api.post(`/errors/${id}/mute`);
            setNotice({ type: 'success', message: 'Error muted — future occurrences won\'t notify.' });
            reload();
        } catch (err) {
            setNotice({ type: 'error', message: `Mute failed — ${extractErrMsg(err)}` });
        } finally { setActionBusy(false); }
    }, [reload]);

    const unmute = useCallback(async (id) => {
        setActionBusy(true);
        try {
            await api.post(`/errors/${id}/unmute`);
            setNotice({ type: 'success', message: 'Error unmuted.' });
            reload();
        } catch (err) {
            setNotice({ type: 'error', message: `Unmute failed — ${extractErrMsg(err)}` });
        } finally { setActionBusy(false); }
    }, [reload]);

    // ── "Trigger test error" — admin self-test of the pipeline ────────
    // Industry-standard pattern (Sentry / Rollbar / Datadog all ship a
    // "send test event" button). Fires a deliberately-bad request via
    // the authenticated axios client so the JWT goes along; the backend
    // route throws ORA-01843, errorHandler classifies as E_DB_QUERY,
    // reportError persists + emits the socket event, and the live row
    // appears here within ~1s. Used for: "is monitoring alive?" sanity
    // check in ops, plus on-boarding demo.
    const [testFiring, setTestFiring] = useState(false);
    const triggerTestError = useCallback(async () => {
        setTestFiring(true);
        try {
            // Dedicated debug endpoint that ALWAYS throws — see
            // backend/routes/errors.js#test-throw. Stable error message
            // + stable route → same fingerprint each press → operator
            // sees occurrence_count increment instead of new rows.
            await api.get('/errors/test-throw');
        } catch (_) {
            // Expected to fail — that's the whole point of this button.
        } finally {
            setTestFiring(false);
            // Force-refresh the list even if the socket is paused.
            setTimeout(reload, 800);
        }
    }, [reload]);

    // ── Top-level loading / error ──────────────────────────────────
    if (listCall.error && !errors.length) {
        return (
            <>
                <PageHeader title="Error Monitor" />
                <ErrorScreen
                    variant={listCall.error.archetype}
                    title="Couldn't load error log"
                    detail={listCall.error.message}
                    actions={[{ label: 'Retry', tone: 'primary', onClick: reload, icon: 'rotate-cw' }]}
                    requestId={listCall.error.requestId}
                />
            </>
        );
    }

    // ── Render ─────────────────────────────────────────────────────
    return (
        <>
            <PageHeader
                title={
                    <span className="inline-flex items-center gap-3">
                        Error Monitor
                        {live && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600">
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                                </span>
                                LIVE
                            </span>
                        )}
                    </span>
                }
                actions={
                    <>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={triggerTestError}
                            disabled={testFiring}
                            leftIcon={<Icon id="alert-triangle" />}
                            title="Fire a deliberate ORA-01843 to verify the monitoring pipeline end-to-end"
                        >
                            {testFiring ? 'Firing…' : 'Trigger test error'}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setLive(v => !v)} leftIcon={<Icon id={live ? 'pause' : 'play'} />}>
                            {live ? 'Pause stream' : 'Resume stream'}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={reload} leftIcon={<Icon id="rotate-cw" />}>
                            Refresh
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => navigate('controllerDashboard')} leftIcon={<Icon id="arrow-left" />}>
                            Back
                        </Button>
                    </>
                }
            />

            {/* ── Action notification (auto-dismissable) ─────────── */}
            {notice && (
                <div
                    role={notice.type === 'error' ? 'alert' : 'status'}
                    aria-live={notice.type === 'error' ? 'assertive' : 'polite'}
                    className={`mb-4 p-3 rounded border text-sm flex items-center justify-between ${
                        notice.type === 'error'
                            ? 'bg-red-50 border-red-200 text-red-800'
                            : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    }`}
                >
                    <span className="flex items-center gap-2">
                        <Icon id={notice.type === 'error' ? 'alert-circle' : 'check-circle'} className="w-4 h-4 flex-shrink-0" />
                        <span>{notice.message}</span>
                    </span>
                    <button
                        onClick={() => setNotice(null)}
                        className="text-current opacity-60 hover:opacity-100 ml-3"
                        aria-label="Dismiss"
                    >×</button>
                </div>
            )}

            {/* ── Window selector ────────────────────────────────── */}
            <div className="flex items-center gap-2 mb-4 text-sm">
                <span className="text-gray-600">Window:</span>
                {[
                    { label: 'Last 1h',  v: 1   },
                    { label: 'Last 24h', v: 24  },
                    { label: 'Last 7d',  v: 168 },
                    { label: 'Last 30d', v: 720 }
                ].map(opt => (
                    <button
                        key={opt.v}
                        onClick={() => setSinceHours(opt.v)}
                        className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                            sinceHours === opt.v
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                        }`}
                    >
                        {opt.label}
                    </button>
                ))}
            </div>

            {/* ── KPI band ───────────────────────────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <MetricTile
                    label="Unique errors"
                    value={stats.uniqueErrors || 0}
                    format="number"
                />
                <MetricTile
                    label="Open"
                    value={stats.open || 0}
                    format="number"
                    tone={stats.open > 0 ? 'warning' : 'default'}
                />
                <MetricTile
                    label="Critical (FATAL + ERROR)"
                    value={(Number(stats.fatal) || 0) + (Number(stats.errors) || 0)}
                    format="number"
                    tone={(stats.fatal || stats.errors) ? 'danger' : 'default'}
                />
                <MetricTile
                    label="Total occurrences"
                    value={stats.totalOccurrences || 0}
                    format="compact"
                />
            </div>

            {/* ── Time-series sparkline (lightweight, no recharts dep) ── */}
            {series.length > 0 && (
                <Card className="mb-6">
                    <div className="px-4 pt-3 pb-2 flex items-center justify-between border-b border-gray-100">
                        <h3 className="text-sm font-semibold text-gray-700">Activity over time</h3>
                        <span className="text-xs text-gray-500">{series.length} buckets · last {sinceHours}h</span>
                    </div>
                    <div className="p-4">
                        <Sparkline points={series} />
                    </div>
                </Card>
            )}

            {/* ── Filter row ─────────────────────────────────────── */}
            <Card className="mb-4">
                <div className="p-3 flex flex-wrap gap-2 items-center">
                    <SelectChip label="Severity" value={severity} onChange={setSeverity} options={[
                        { v: 'ANY',   l: 'All' },
                        { v: 'FATAL', l: 'Fatal' },
                        { v: 'ERROR', l: 'Error' },
                        { v: 'WARN',  l: 'Warn'  },
                        { v: 'INFO',  l: 'Info'  }
                    ]} />
                    <SelectChip label="Status" value={status} onChange={setStatus} options={[
                        { v: 'ANY',          l: 'All' },
                        { v: 'OPEN',         l: 'Open' },
                        { v: 'ACKNOWLEDGED', l: 'Acknowledged' },
                        { v: 'RESOLVED',     l: 'Resolved' },
                        { v: 'MUTED',        l: 'Muted' }
                    ]} />
                    <SelectChip label="Source" value={source} onChange={setSource} options={[
                        { v: 'ANY',     l: 'All' },
                        { v: 'backend', l: 'API' },
                        { v: 'react',   l: 'UI' },
                        { v: 'network', l: 'Net' },
                        { v: 'manual',  l: 'Manual' }
                    ]} />
                    <div className="flex-1 min-w-[200px]">
                        <input
                            type="text"
                            value={q}
                            onChange={e => setQ(e.target.value)}
                            placeholder="Search code, message, route, user…"
                            className="w-full p-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                            aria-label="Search errors"
                        />
                    </div>
                </div>
            </Card>

            {/* ── Error table ───────────────────────────────────── */}
            <Card>
                {listCall.loading && !errors.length ? (
                    <ErrorScreen variant="loading" compact />
                ) : errors.length === 0 ? (
                    <ErrorScreen
                        variant="empty"
                        title="No matching errors"
                        detail="Nothing in the log matches your filters. Try widening the window or status."
                        compact
                    />
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-3 py-2 text-left"><SortableHeader label="Severity" sortKey="SEVERITY" current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                                    <th className="px-3 py-2 text-left"><SortableHeader label="Code"     sortKey="CODE"     current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                                    <th className="px-3 py-2 text-left"><SortableHeader label="Route"    sortKey="ROUTE"    current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                                    <th className="px-3 py-2 text-left"><SortableHeader label="User"     sortKey="USER_EMAIL" current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                                    <th className="px-3 py-2 text-right"><SortableHeader label="Count"   sortKey="_count"   current={sortKey} dir={sortDir} onToggle={toggle} align="right" /></th>
                                    <th className="px-3 py-2 text-right"><SortableHeader label="Last seen" sortKey="_last"  current={sortKey} dir={sortDir} onToggle={toggle} align="right" /></th>
                                    <th className="px-3 py-2 text-left">Status</th>
                                    <th className="px-3 py-2 text-right"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 bg-white">
                                {sortedRows.map(e => (
                                    <tr key={e.ERROR_ID} className="hover:bg-blue-50/40">
                                        <td className="px-3 py-2"><SeverityBadge value={e.SEVERITY} /></td>
                                        <td className="px-3 py-2 font-mono text-xs text-gray-800">
                                            {e.CODE}
                                            <span className="ml-2 text-[10px] uppercase font-semibold text-gray-400">
                                                {SOURCE_LABEL[e.SOURCE] || e.SOURCE}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-xs text-gray-700 font-mono truncate max-w-[260px]" title={e.ROUTE}>{e.ROUTE || '—'}</td>
                                        <td className="px-3 py-2 text-xs text-gray-700 truncate max-w-[160px]" title={e.USER_EMAIL}>{e.USER_EMAIL || '—'}</td>
                                        <td className="px-3 py-2 text-right text-sm font-mono font-semibold">{Number(e.OCCURRENCE_COUNT).toLocaleString()}</td>
                                        <td className="px-3 py-2 text-right text-xs text-gray-600">{relTime(e.LAST_SEEN_AT)}</td>
                                        <td className="px-3 py-2"><StatusBadge value={e.STATUS} /></td>
                                        <td className="px-3 py-2 text-right">
                                            <button
                                                onClick={() => setOpenDetail(e.ERROR_ID)}
                                                className="text-xs text-blue-600 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-1"
                                                aria-label={`View details for ${e.CODE}`}
                                            >
                                                View
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            {/* ── Drill-down dialog ─────────────────────────────── */}
            {openDetail && (
                <ErrorDetailDialog
                    errorId={openDetail}
                    onClose={() => setOpenDetail(null)}
                    onAcknowledge={acknowledge}
                    onMute={mute}
                    onUnmute={unmute}
                    onRequestResolve={(id) => setResolveFor(id)}
                    busy={actionBusy}
                />
            )}

            {/* ── Resolve modal (separate so the note input has focus) ── */}
            {resolveFor && (
                <Dialog
                    open
                    onClose={() => setResolveFor(null)}
                    title="Resolve error"
                    description="Add a short note describing what was done. This is stored in the audit trail."
                    size="md"
                >
                    <div className="space-y-3">
                        <textarea
                            value={resolveNote}
                            onChange={e => setResolveNote(e.target.value)}
                            placeholder="e.g. Fixed in deploy 2026-05-28 — patch in routes/invoices.js line 412 added null guard"
                            rows={4}
                            maxLength={2000}
                            autoFocus
                            className="w-full p-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                        <div className="text-xs text-gray-500">{resolveNote.length} / 2000</div>
                        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                            <Button variant="ghost"   onClick={() => setResolveFor(null)} disabled={actionBusy}>Cancel</Button>
                            <Button variant="primary" onClick={() => resolve(resolveFor, resolveNote.trim())} disabled={actionBusy || !resolveNote.trim()}>
                                {actionBusy ? 'Saving…' : 'Mark resolved'}
                            </Button>
                        </div>
                    </div>
                </Dialog>
            )}
        </>
    );
};

// ── Detail dialog (separate component, lazy-fetches full row) ──────
const ErrorDetailDialog = ({ errorId, onClose, onAcknowledge, onMute, onUnmute, onRequestResolve, busy }) => {
    const { data, error, loading } = useApiCall(
        () => api.get(`/errors/${errorId}`),
        [errorId]
    );

    const row = data?.data?.data || data?.data || null;

    return (
        <Dialog open onClose={onClose} title="Error detail" size="xl">
            {loading && <ErrorScreen variant="loading" compact />}
            {error && (
                <ErrorScreen
                    variant={error.archetype}
                    title="Couldn't load detail"
                    detail={error.message}
                    requestId={error.requestId}
                />
            )}
            {row && (
                <div className="space-y-4 text-sm">
                    {/* Top summary */}
                    <div className="flex flex-wrap items-center gap-3 pb-3 border-b border-gray-100">
                        <SeverityBadge value={row.SEVERITY} />
                        <code className="text-xs font-mono text-gray-800">{row.CODE}</code>
                        <StatusBadge value={row.STATUS} />
                        <span className="text-xs text-gray-500">Occurrences: <strong>{Number(row.OCCURRENCE_COUNT).toLocaleString()}</strong></span>
                        <span className="text-xs text-gray-500">First: {row.FIRST_SEEN_AT && new Date(row.FIRST_SEEN_AT).toISOString().slice(0,19).replace('T',' ')}</span>
                        <span className="text-xs text-gray-500">Last: {row.LAST_SEEN_AT && new Date(row.LAST_SEEN_AT).toISOString().slice(0,19).replace('T',' ')}</span>
                    </div>

                    {/* Message */}
                    <div>
                        <Label>Message</Label>
                        <div className="font-mono text-xs whitespace-pre-wrap bg-gray-50 border border-gray-200 rounded p-3">{row.MESSAGE || '(none)'}</div>
                    </div>

                    {/* Route + actor */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <Label>Route</Label>
                            <div className="font-mono text-xs bg-gray-50 border border-gray-200 rounded p-2 truncate">{row.ROUTE || '—'}</div>
                        </div>
                        <div>
                            <Label>Source</Label>
                            <div className="font-mono text-xs bg-gray-50 border border-gray-200 rounded p-2">{SOURCE_LABEL[row.SOURCE] || row.SOURCE}</div>
                        </div>
                        <div>
                            <Label>User</Label>
                            <div className="text-xs bg-gray-50 border border-gray-200 rounded p-2">
                                {row.USER_EMAIL || '—'}
                                {row.USER_ROLE && <span className="ml-2 text-gray-500">({row.USER_ROLE})</span>}
                            </div>
                        </div>
                        <div>
                            <Label>Client IP</Label>
                            <div className="text-xs bg-gray-50 border border-gray-200 rounded p-2 font-mono">{row.CLIENT_IP || '—'}</div>
                        </div>
                    </div>

                    {/* Request ID */}
                    {row.REQUEST_ID && (
                        <div>
                            <Label>Request ID (correlate with structured logs)</Label>
                            <div className="text-xs font-mono bg-gray-50 border border-gray-200 rounded p-2 select-all">{row.REQUEST_ID}</div>
                        </div>
                    )}

                    {/* Stack */}
                    {row.STACK && (
                        <details>
                            <summary className="cursor-pointer text-xs font-semibold text-gray-700 select-none">Stack trace</summary>
                            <pre className="mt-2 font-mono text-[11px] bg-gray-900 text-gray-100 rounded p-3 overflow-x-auto whitespace-pre">{row.STACK}</pre>
                        </details>
                    )}

                    {/* Payload */}
                    {row.PAYLOAD_SAMPLE && (
                        <details>
                            <summary className="cursor-pointer text-xs font-semibold text-gray-700 select-none">Request payload (PII-masked)</summary>
                            <pre className="mt-2 font-mono text-[11px] bg-gray-50 text-gray-800 rounded p-3 border border-gray-200 overflow-x-auto whitespace-pre">{prettyJson(row.PAYLOAD_SAMPLE)}</pre>
                        </details>
                    )}

                    {/* Resolution */}
                    {row.RESOLUTION_NOTE && (
                        <div>
                            <Label>Resolution note</Label>
                            <div className="text-xs bg-emerald-50 border border-emerald-200 rounded p-3">
                                {row.RESOLUTION_NOTE}
                                {row.RESOLVED_BY && <div className="mt-1 text-gray-500">— {row.RESOLVED_BY} at {row.RESOLVED_AT && new Date(row.RESOLVED_AT).toISOString().slice(0,19).replace('T',' ')}</div>}
                            </div>
                        </div>
                    )}

                    {/* Actions */}
                    <div className="flex flex-wrap justify-end gap-2 pt-3 border-t border-gray-100">
                        {row.STATUS === 'OPEN' && (
                            <Button variant="ghost" onClick={() => onAcknowledge(row.ERROR_ID)} disabled={busy} leftIcon={<Icon id="eye" />}>
                                Acknowledge
                            </Button>
                        )}
                        {row.STATUS !== 'RESOLVED' && row.STATUS !== 'MUTED' && (
                            <Button variant="primary" onClick={() => onRequestResolve(row.ERROR_ID)} disabled={busy} leftIcon={<Icon id="check-circle" />}>
                                Mark resolved
                            </Button>
                        )}
                        {row.MUTED === 'Y' ? (
                            <Button variant="ghost" onClick={() => onUnmute(row.ERROR_ID)} disabled={busy} leftIcon={<Icon id="volume-2" />}>
                                Unmute
                            </Button>
                        ) : (
                            <Button variant="ghost" onClick={() => onMute(row.ERROR_ID)} disabled={busy} leftIcon={<Icon id="volume-x" />}>
                                Mute
                            </Button>
                        )}
                        <Button variant="ghost" onClick={onClose}>Close</Button>
                    </div>
                </div>
            )}
        </Dialog>
    );
};

// ── Small helpers ──────────────────────────────────────────────────
const Label = ({ children }) => (
    <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">{children}</div>
);

const SelectChip = ({ label, value, onChange, options }) => (
    <label className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700">
        <span className="text-gray-500">{label}:</span>
        <select
            value={value}
            onChange={e => onChange(e.target.value)}
            className="px-2 py-1 border border-gray-300 rounded bg-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
            {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
    </label>
);

// Minimal inline SVG sparkline (no recharts to keep this page light)
const Sparkline = ({ points }) => {
    if (!points || points.length === 0) return null;
    const counts = points.map(p => Number(p.count) || 0);
    const max = Math.max(...counts, 1);
    const w = 800, h = 80, pad = 4;
    const dx = (w - pad * 2) / Math.max(points.length - 1, 1);
    const path = counts.map((c, i) => {
        const x = pad + i * dx;
        const y = h - pad - (c / max) * (h - pad * 2);
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
    const area = path + ` L ${(pad + (counts.length - 1) * dx).toFixed(1)} ${h - pad} L ${pad} ${h - pad} Z`;
    return (
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20" role="img" aria-label={`Error rate sparkline, peak ${max}`}>
            <path d={area} fill="rgba(220, 38, 38, 0.10)" />
            <path d={path} fill="none" stroke="#dc2626" strokeWidth="1.5" />
        </svg>
    );
};

function prettyJson(s) {
    try { return JSON.stringify(JSON.parse(s), null, 2); }
    catch (_) { return s; }
}

export default ErrorMonitor;
