import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import api from '../api';
import socket from '../socket';
import Icon from '../components/common/Icon';

// ─── Constants ───────────────────────────────────────────────────────────────
const CATEGORIES = [
  { key: 'all',       label: 'All Activity',  icon: 'list' },
  { key: 'auth',      label: 'Auth',          icon: 'lock' },
  { key: 'invoices',  label: 'Invoices',      icon: 'file-invoice' },
  { key: 'quotes',    label: 'Quotes',        icon: 'file-alt' },
  { key: 'inventory', label: 'Inventory',     icon: 'boxes' },
  { key: 'customers', label: 'Customers',     icon: 'users' },
  { key: 'settings',  label: 'Settings',      icon: 'cog' },
  { key: 'system',    label: 'System',        icon: 'server' },
];

const SEVERITY_CONFIG = {
  info:     { bg: 'bg-blue-100',   text: 'text-blue-700',   dot: 'bg-blue-500',   label: 'Info' },
  warning:  { bg: 'bg-yellow-100', text: 'text-yellow-700', dot: 'bg-yellow-500', label: 'Warning' },
  critical: { bg: 'bg-red-100',    text: 'text-red-700',    dot: 'bg-red-500',    label: 'Critical' },
};

const OUTCOME_CONFIG = {
  success: { bg: 'bg-green-100', text: 'text-green-700', icon: '✓' },
  failure: { bg: 'bg-red-100',   text: 'text-red-700',   icon: '✕' },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const formatTs = (ts) => {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
};

const formatAction = (action = '') =>
  action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// ─── Component ───────────────────────────────────────────────────────────────
const AuditTrail = ({ navigateTo, userId }) => {
  const [logs, setLogs]           = useState([]);
  const [stats, setStats]         = useState({ logsToday: 0, uniqueUsersToday: 0, criticalToday: 0 });
  const [loading, setLoading]     = useState(true);
  const [total, setTotal]         = useState(0);
  const [offset, setOffset]       = useState(0);
  const [expandedId, setExpandedId] = useState(null);
  const [activeCategory, setActiveCategory] = useState('all');
  const [newLogPulse, setNewLogPulse] = useState(false);
  const liveRef = useRef(false);

  const LIMIT = 100;

  // ── Filters ────────────────────────────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0];
  const [filters, setFilters] = useState({
    startDate: today,
    endDate: today,
    severity: 'all',
    userId: '',
    action: '',
  });
  const [appliedFilters, setAppliedFilters] = useState({ ...filters, category: 'all' });

  // ── Fetch logs ─────────────────────────────────────────────────────────────
  const fetchLogs = useCallback(async (params, currentOffset = 0) => {
    setLoading(true);
    try {
      const query = { limit: LIMIT, offset: currentOffset, ...params };
      // Remove empty strings
      Object.keys(query).forEach(k => query[k] === '' && delete query[k]);
      if (query.category === 'all') delete query.category;
      if (query.severity === 'all') delete query.severity;

      const [logsRes, statsRes] = await Promise.all([
        api.get('/audit-logs', { params: query }),
        api.get('/audit-logs/stats'),
      ]);

      if (logsRes.success) {
        if (currentOffset === 0) {
          setLogs(logsRes.data || []);
        } else {
          setLogs(prev => [...prev, ...(logsRes.data || [])]);
        }
        setTotal(logsRes.total || 0);
      }
      if (statsRes.success) setStats(statsRes.data);
    } catch (err) {
      console.error('Audit log fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchLogs(appliedFilters, 0);
    setOffset(0);
  }, [appliedFilters, fetchLogs]);

  // ── Real-time WebSocket ────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket.connected) socket.connect();

    const handleNewLog = () => {
      setNewLogPulse(true);
      setTimeout(() => setNewLogPulse(false), 2000);
      // Silently refresh if on first page and live mode
      if (liveRef.current) {
        fetchLogs(appliedFilters, 0);
        setOffset(0);
      }
    };

    socket.on('audit_logs:new', handleNewLog);
    return () => socket.off('audit_logs:new', handleNewLog);
  }, [appliedFilters, fetchLogs]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleApplyFilters = () => {
    setAppliedFilters({ ...filters, category: activeCategory });
    setOffset(0);
  };

  const handleClearFilters = () => {
    const reset = { startDate: '', endDate: '', severity: 'all', userId: '', action: '' };
    setFilters(reset);
    setAppliedFilters({ ...reset, category: activeCategory });
    setOffset(0);
  };

  const handleCategoryChange = (cat) => {
    setActiveCategory(cat);
    setAppliedFilters(prev => ({ ...prev, category: cat }));
    setOffset(0);
  };

  const handleLoadMore = () => {
    const newOffset = offset + LIMIT;
    setOffset(newOffset);
    fetchLogs(appliedFilters, newOffset);
  };

  // ── Export CSV ─────────────────────────────────────────────────────────────
  const handleExport = () => {
    const headers = ['Timestamp', 'User', 'Action', 'Category', 'Severity', 'Outcome', 'Entity Type', 'Entity ID', 'Details', 'IP Address'];
    const rows = logs.map(l => [
      new Date(l.timestamp).toISOString(),
      l.userId || '',
      l.action || '',
      l.category || '',
      l.severity || '',
      l.outcome || '',
      l.entityType || '',
      l.entityId || '',
      (l.details || '').replace(/,/g, ';'),
      l.ipAddress || ''
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit_trail_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Row expand ─────────────────────────────────────────────────────────────
  const toggleExpand = (id) => setExpandedId(prev => prev === id ? null : id);

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto p-4 md:p-6">

        {/* ── Header ── */}
        <header className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
              <Icon id="history" className="text-purple-600 text-lg" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Activity & Audit Trail</h1>
              <p className="text-xs text-gray-500">Complete system event history with 365-day retention</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Live indicator */}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${newLogPulse ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              <span className={`w-2 h-2 rounded-full ${newLogPulse ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
              {newLogPulse ? 'New event' : 'Live'}
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={liveRef.current}
                onChange={e => { liveRef.current = e.target.checked; }}
                className="rounded"
              />
              Auto-refresh
            </label>
            <button
              onClick={handleExport}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
            >
              <Icon id="download" className="text-sm" /> Export CSV
            </button>
            <button
              onClick={() => navigateTo('controllerDashboard')}
              className="text-sm text-gray-500 hover:text-gray-800 flex items-center gap-1"
            >
              <Icon id="arrow-left" className="text-sm" /> Back
            </button>
          </div>
        </header>

        {/* ── Stats Cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Events Today', value: stats.logsToday,         color: 'blue',   icon: 'chart-line' },
            { label: 'Active Users',  value: stats.uniqueUsersToday,  color: 'purple', icon: 'users' },
            { label: 'Critical Today', value: stats.criticalToday,   color: 'red',    icon: 'exclamation-triangle' },
          ].map(s => (
            <div key={s.label} className={`bg-white rounded-xl border border-${s.color}-100 p-4 flex items-center gap-4 shadow-sm`}>
              <div className={`w-10 h-10 bg-${s.color}-100 rounded-lg flex items-center justify-center flex-shrink-0`}>
                <Icon id={s.icon} className={`text-${s.color}-600`} />
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-900">{s.value}</div>
                <div className="text-xs text-gray-500">{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Category Tabs ── */}
        <div className="flex flex-wrap gap-2 mb-4">
          {CATEGORIES.map(cat => (
            <button
              key={cat.key}
              onClick={() => handleCategoryChange(cat.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                activeCategory === cat.key
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-white text-gray-600 border border-gray-200 hover:border-blue-300 hover:text-blue-600'
              }`}
            >
              <Icon id={cat.icon} className="text-xs" />
              {cat.label}
            </button>
          ))}
        </div>

        {/* ── Filters Panel ── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">From Date</label>
              <input type="date" value={filters.startDate}
                onChange={e => setFilters(p => ({ ...p, startDate: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">To Date</label>
              <input type="date" value={filters.endDate}
                onChange={e => setFilters(p => ({ ...p, endDate: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Severity</label>
              <select value={filters.severity}
                onChange={e => setFilters(p => ({ ...p, severity: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500">
                <option value="all">All Severities</option>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">User</label>
              <input type="text" placeholder="Filter by user..." value={filters.userId}
                onChange={e => setFilters(p => ({ ...p, userId: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Action</label>
              <input type="text" placeholder="Filter by action..." value={filters.action}
                onChange={e => setFilters(p => ({ ...p, action: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={handleApplyFilters}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2">
              <Icon id="search" className="text-xs" /> Apply Filters
            </button>
            <button onClick={handleClearFilters}
              className="px-4 py-2 bg-gray-100 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors">
              Clear
            </button>
            <span className="ml-auto text-xs text-gray-400 self-center">
              Showing {logs.length} of {total} records
            </span>
          </div>
        </div>

        {/* ── Log Table ── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          {loading && logs.length === 0 ? (
            <div className="flex items-center justify-center py-20 text-gray-400">
              <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full mr-3" />
              Loading audit logs...
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <Icon id="history" className="text-4xl mb-3 text-gray-300" />
              <p className="font-medium">No events found</p>
              <p className="text-sm">Try adjusting your filters or date range</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Timestamp</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">User</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Action</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Entity</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Severity</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Outcome</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Details</th>
                    <th className="px-4 py-3 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {logs.map(log => {
                    const sev  = SEVERITY_CONFIG[log.severity]  || SEVERITY_CONFIG.info;
                    const out  = OUTCOME_CONFIG[log.outcome]    || OUTCOME_CONFIG.success;
                    const isExp = expandedId === log.id;

                    return (
                      <React.Fragment key={log.id}>
                        <tr
                          className={`hover:bg-gray-50 transition-colors cursor-pointer ${isExp ? 'bg-blue-50' : ''}`}
                          onClick={() => toggleExpand(log.id)}
                        >
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="text-gray-600 font-mono text-xs">{formatTs(log.timestamp)}</span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5">
                              <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                                <span className="text-blue-700 text-xs font-medium">
                                  {(log.userId || '?')[0].toUpperCase()}
                                </span>
                              </div>
                              <span className="text-gray-700 font-medium text-xs truncate max-w-24">
                                {log.userId || '—'}
                              </span>
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-medium text-gray-900 text-xs">
                              {formatAction(log.action)}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {log.entityType ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
                                {log.entityType}
                                {log.entityId && <span className="text-gray-400 font-mono">#{log.entityId.slice(0, 8)}</span>}
                              </span>
                            ) : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${sev.bg} ${sev.text}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${sev.dot}`} />
                              {sev.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${out.bg} ${out.text}`}>
                              {out.icon} {log.outcome || 'success'}
                            </span>
                          </td>
                          <td className="px-4 py-3 max-w-xs">
                            <span className="text-gray-500 text-xs truncate block max-w-48">
                              {log.details || '—'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Icon id={isExp ? 'chevron-up' : 'chevron-down'} className="text-gray-400 text-xs" />
                          </td>
                        </tr>

                        {/* Expanded Detail Row */}
                        {isExp && (
                          <tr className="bg-blue-50">
                            <td colSpan={8} className="px-6 py-4">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                                <div>
                                  <p className="font-semibold text-gray-600 mb-1">FULL ACTION</p>
                                  <code className="text-blue-800 bg-blue-100 px-2 py-1 rounded font-mono">{log.action}</code>
                                </div>
                                <div>
                                  <p className="font-semibold text-gray-600 mb-1">IP ADDRESS</p>
                                  <span className="text-gray-700 font-mono">{log.ipAddress || 'Not recorded'}</span>
                                </div>
                                <div>
                                  <p className="font-semibold text-gray-600 mb-1">CATEGORY</p>
                                  <span className="inline-flex items-center px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full capitalize">
                                    {log.category}
                                  </span>
                                </div>
                                {log.extra && (
                                  <div className="md:col-span-3">
                                    <p className="font-semibold text-gray-600 mb-1">ADDITIONAL DATA</p>
                                    <pre className="bg-gray-800 text-green-300 rounded-lg p-3 text-xs overflow-x-auto max-h-48 whitespace-pre-wrap">
                                      {JSON.stringify(log.extra, null, 2)}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Load More ── */}
          {logs.length < total && (
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between text-sm text-gray-500">
              <span>Showing {logs.length} of {total} entries</span>
              <button
                onClick={handleLoadMore}
                disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {loading ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Loading...</> : 'Load More'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AuditTrail;
