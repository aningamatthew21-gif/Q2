import React, { useEffect, useMemo, useState } from 'react';
import api from '../../../api';
import ReportPage from '../ReportPage';
import MetricTile from '../../../components/v2/MetricTile';
import ChartCard, { CHART_COLORS } from '../../../components/v2/ChartCard';
import Card, { CardBody } from '../../../components/v2/Card';
import { SortableHeader, useSortable } from '../../../components/v2';
import { useApp } from '../../../context/AppContext';
import { exportReport } from '../../../services/ReportExportService';
// SP3-M5 — formatters live in src/utils/format.js (single source of truth)
import { fmtMoney, fmtDate } from '../../../utils/format';
import {
    ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell
} from 'recharts';

/**
 * F1 · AR Aging Report
 *
 * Outstanding receivables aged from due date. The Finance Head's
 * weekly action list: who do I call today, who's about to cross into
 * 90+, which industry is dragging DSO up.
 *
 * Backend: GET /api/reports/finance/ar-aging
 * Standard envelope (see backend/routes/reports/_shared.js#envelope).
 */

const BUCKET_COLOR = {
    'CURRENT': CHART_COLORS.ok,
    '1-30':    CHART_COLORS.info,
    '31-60':   CHART_COLORS.warn,
    '61-90':   '#C4314B',
    '90+':     '#7E1F2E'
};

const BUCKET_BADGE = {
    'CURRENT': 'bg-emerald-50 text-emerald-700 border-emerald-200',
    '1-30':    'bg-blue-50 text-blue-700 border-blue-200',
    '31-60':   'bg-amber-50 text-amber-800 border-amber-200',
    '61-90':   'bg-orange-50 text-orange-800 border-orange-200',
    '90+':     'bg-red-50 text-red-800 border-red-200'
};


const ArAgingReport = () => {
    const { navigate } = useApp();

    // Filter state
    const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
    const [asOfDate, setAsOfDate]               = useState(today);
    const [industry, setIndustry]               = useState('');
    const [sizeBand, setSizeBand]               = useState('');
    const [creditHoldOnly, setCreditHoldOnly]   = useState(false);

    // Data state
    const [data, setData]       = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        const params = new URLSearchParams();
        if (asOfDate)       params.append('asOfDate', asOfDate);
        if (industry)       params.append('industry', industry);
        if (sizeBand)       params.append('sizeBand', sizeBand);
        if (creditHoldOnly) params.append('creditHoldOnly', 'true');

        api.get(`/reports/finance/ar-aging?${params.toString()}`)
            .then(res => {
                if (cancelled) return;
                if (res?.success) setData(res.data);
                else setError(res?.error || 'Failed to load report');
            })
            .catch(err => {
                if (cancelled) return;
                setError(err?.response?.data?.error || err?.message || 'Failed to load report');
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [asOfDate, industry, sizeBand, creditHoldOnly]);

    // Distinct industries / size bands surfaced from the data itself —
    // means the filters always match what's actually in the result set.
    const distinctIndustries = useMemo(() => {
        if (!data?.rows) return [];
        return Array.from(new Set(data.rows.map(r => r.industry).filter(v => v && v !== '—'))).sort();
    }, [data]);

    const distinctSizeBands = useMemo(() => {
        if (!data?.rows) return [];
        return Array.from(new Set(data.rows.map(r => r.sizeBand).filter(v => v && v !== '—'))).sort();
    }, [data]);

    const { sortKey, sortDir, toggle, sortedRows } = useSortable(
        data?.rows || [],
        'daysOverdue',
        'desc'
    );

    const handleExport = async (format, opts) => {
        if (!data) return;
        return exportReport(format, data, opts);
    };

    const filtersJsx = (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
            <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">As of date</label>
                <input
                    type="date"
                    value={asOfDate}
                    onChange={(e) => setAsOfDate(e.target.value)}
                    className="w-full p-2 border border-gray-300 rounded text-sm"
                />
            </div>
            <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Industry</label>
                <select
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    className="w-full p-2 border border-gray-300 rounded text-sm"
                >
                    <option value="">All industries</option>
                    {distinctIndustries.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
            </div>
            <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Size band</label>
                <select
                    value={sizeBand}
                    onChange={(e) => setSizeBand(e.target.value)}
                    className="w-full p-2 border border-gray-300 rounded text-sm"
                >
                    <option value="">All sizes</option>
                    {distinctSizeBands.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
            </div>
            <div className="flex items-center gap-2 pb-2">
                <input
                    type="checkbox"
                    id="creditHoldOnly"
                    checked={creditHoldOnly}
                    onChange={(e) => setCreditHoldOnly(e.target.checked)}
                />
                <label htmlFor="creditHoldOnly" className="text-xs text-gray-700">Credit hold only</label>
            </div>
            {(industry || sizeBand || creditHoldOnly) && (
                <button
                    onClick={() => { setIndustry(''); setSizeBand(''); setCreditHoldOnly(false); }}
                    className="text-xs text-blue-600 hover:underline pb-2 text-left"
                >
                    Clear filters
                </button>
            )}
        </div>
    );

    const kpiBand = data?.kpis ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {data.kpis.map((kpi, i) => (
                <MetricTile
                    key={i}
                    label={kpi.label}
                    value={kpi.value}
                    format={kpi.fmt === 'currency' ? 'currency' : kpi.fmt === 'percent' ? 'percent' : 'number'}
                    deltaSuffix={kpi.fmt === 'percent' ? '%' : undefined}
                />
            ))}
        </div>
    ) : null;

    const charts = data?.charts && data.charts.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {data.charts.map((c, i) => (
                <ChartCard key={i} title={c.title} height={260}>
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={c.data} layout="vertical" margin={{ left: 20, right: 16, top: 8, bottom: 8 }}>
                            <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" />
                            <XAxis type="number" tick={{ fontSize: 11, fill: CHART_COLORS.axis }} />
                            <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: CHART_COLORS.axis }} width={90} />
                            <Tooltip formatter={(v) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })} />
                            <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                                {c.data.map((d, idx) => (
                                    <Cell key={idx} fill={BUCKET_COLOR[d.name] || CHART_COLORS.accent} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </ChartCard>
            ))}
        </div>
    ) : null;

    return (
        <ReportPage
            title="AR Aging"
            subtitle={data?.subtitle || 'Loading…'}
            icon="file-invoice-dollar"
            loading={loading}
            error={error}
            empty={!loading && !error && (!data?.rows || data.rows.length === 0)}
            emptyHint="No open invoices for the selected filters. Nice — fully collected."
            onExport={handleExport}
            filters={filtersJsx}
            kpiBand={kpiBand}
            charts={charts}
        >
            <Card>
                <CardBody pad={false}>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 border-b border-gray-200">
                                <tr>
                                    <th className="text-left p-3"><SortableHeader label="Customer"  sortKey="customerName" current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                                    <th className="text-left p-3"><SortableHeader label="Industry"  sortKey="industry"     current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                                    <th className="text-left p-3"><SortableHeader label="Invoice"   sortKey="invoiceNumber"current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                                    <th className="text-left p-3"><SortableHeader label="Due"       sortKey="dueDate"      current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                                    <th className="text-right p-3"><SortableHeader label="Days"     sortKey="daysOverdue"  current={sortKey} dir={sortDir} onToggle={toggle} align="right" /></th>
                                    <th className="text-right p-3"><SortableHeader label="Balance"  sortKey="balanceDue"   current={sortKey} dir={sortDir} onToggle={toggle} align="right" /></th>
                                    <th className="text-left p-3"><SortableHeader label="Bucket"    sortKey="bucket"       current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedRows.map((r) => (
                                    <tr
                                        key={r.invoiceId}
                                        onClick={() => navigate('invoiceEditor', { invoiceId: r.invoiceId, returnTo: 'reportArAging' })}
                                        className="border-b border-gray-100 hover:bg-blue-50/40 cursor-pointer"
                                    >
                                        <td className="p-3">
                                            <div className="font-medium text-gray-800">{r.customerName}</div>
                                            {r.creditHold && (
                                                <span className="text-[10px] uppercase tracking-wide font-semibold text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5 inline-block mt-0.5">Credit hold</span>
                                            )}
                                        </td>
                                        <td className="p-3 text-gray-700">{r.industry}</td>
                                        <td className="p-3 font-mono text-xs text-gray-700">{r.invoiceNumber}</td>
                                        <td className="p-3 text-gray-700">{fmtDate(r.dueDate)}</td>
                                        <td className={`p-3 text-right font-mono ${r.daysOverdue > 90 ? 'text-red-700 font-bold' : r.daysOverdue > 30 ? 'text-amber-700' : 'text-gray-700'}`}>
                                            {r.daysOverdue > 0 ? r.daysOverdue : '—'}
                                        </td>
                                        <td className="p-3 text-right font-mono font-medium text-gray-800">
                                            {fmtMoney(r.balanceDue)}
                                        </td>
                                        <td className="p-3">
                                            <span className={`text-[10px] uppercase tracking-wide font-semibold border rounded px-1.5 py-0.5 ${BUCKET_BADGE[r.bucket] || 'bg-gray-100 text-gray-700 border-gray-200'}`}>
                                                {r.bucket}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            {data?.totals?.balanceDue != null && (
                                <tfoot className="bg-blue-50/60 border-t-2 border-blue-200">
                                    <tr>
                                        <td colSpan={5} className="p-3 text-right font-semibold text-gray-800">TOTAL OPEN AR</td>
                                        <td className="p-3 text-right font-mono font-bold text-gray-900">{fmtMoney(data.totals.balanceDue)}</td>
                                        <td></td>
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                </CardBody>
            </Card>
        </ReportPage>
    );
};

export default ArAgingReport;
