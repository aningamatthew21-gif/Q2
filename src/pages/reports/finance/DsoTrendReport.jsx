import React, { useEffect, useMemo, useState } from 'react';
import api from '../../../api';
import ReportPage from '../ReportPage';
import MetricTile from '../../../components/v2/MetricTile';
import ChartCard, { CHART_COLORS } from '../../../components/v2/ChartCard';
import Card, { CardHead, CardBody } from '../../../components/v2/Card';
import { SortableHeader, useSortable } from '../../../components/v2';
import { useApp } from '../../../context/AppContext';
import { exportReport } from '../../../services/ReportExportService';
import {
    ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine
} from 'recharts';

/**
 * F2 · DSO Trend — Days Sales Outstanding over a rolling window.
 *
 * Audience: CFO, Finance Head (monthly close), Board.
 * Default view: last 12 months. Visualises the months where DSO
 * climbed (collections slowed) vs improved.
 *
 * Backend: GET /api/reports/finance/dso?from=&to=
 */

const fmtMoney = (v) => Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const DsoTrendReport = () => {
    const { navigate } = useApp();

    // Default: today and 12 months ago
    const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
    const oneYearAgo = useMemo(() => {
        const d = new Date();
        d.setMonth(d.getMonth() - 11);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    }, []);

    const [from, setFrom] = useState(oneYearAgo);
    const [to, setTo]     = useState(today);

    const [data, setData]       = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        const params = new URLSearchParams();
        if (from) params.append('from', from);
        if (to)   params.append('to', to);

        api.get(`/reports/finance/dso?${params.toString()}`)
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
    }, [from, to]);

    const { sortKey, sortDir, toggle, sortedRows } = useSortable(
        data?.rows || [],
        'month',
        'asc'
    );

    const handleExport = async (format, opts) => {
        if (!data) return;
        return exportReport(format, data, opts);
    };

    const filtersJsx = (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 items-end">
            <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full p-2 border border-gray-300 rounded text-sm" />
            </div>
            <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full p-2 border border-gray-300 rounded text-sm" />
            </div>
            <div className="text-xs text-gray-500 self-center">
                Default: trailing 12 months
            </div>
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
                />
            ))}
        </div>
    ) : null;

    // Compute reference line average for the chart
    const avgDso = useMemo(() => {
        if (!data?.rows) return 0;
        const vals = data.rows.map(r => r.dso).filter(v => v > 0);
        return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
    }, [data]);

    const chartsJsx = data?.charts?.[0]?.data ? (
        <ChartCard title="DSO over time (days)" subtitle={`Trailing window · average = ${avgDso} days`}>
            <div style={{ height: 260 }}>
                <ResponsiveContainer>
                    <LineChart data={data.charts[0].data} margin={{ top: 10, right: 30, bottom: 5, left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(v) => `${v} days`} />
                        <ReferenceLine y={avgDso} stroke={CHART_COLORS.warn || '#F59E0B'} strokeDasharray="4 4" label={{ value: 'avg', fontSize: 10, fill: '#9CA3AF', position: 'right' }} />
                        <Line type="monotone" dataKey="value" stroke={CHART_COLORS.primary} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </ChartCard>
    ) : null;

    return (
        <ReportPage
            title="DSO Trend"
            subtitle={data?.subtitle}
            icon="chart-line"
            loading={loading}
            error={error}
            empty={!data?.rows?.length}
            emptyHint="No recognised revenue in the selected window."
            onExport={handleExport}
            filters={filtersJsx}
            kpiBand={kpiBand}
            charts={chartsJsx}
        >
            <Card>
                <CardHead
                    title="Per-month detail"
                    subtitle={data?.extras?.methodology ? `Methodology: ${data.extras.methodology}` : null}
                />
                <CardBody pad={false}>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 border-b border-gray-200">
                                <tr>
                                    <SortableHeader keyName="month"          sortKey={sortKey} sortDir={sortDir} onSort={toggle}>Month</SortableHeader>
                                    <SortableHeader keyName="revenue"        sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right">Revenue</SortableHeader>
                                    <SortableHeader keyName="arEnd"          sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right">AR end</SortableHeader>
                                    <SortableHeader keyName="dso"            sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right">DSO (d)</SortableHeader>
                                    <SortableHeader keyName="collected"      sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right">Collected</SortableHeader>
                                    <SortableHeader keyName="collectionRate" sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right">Coll. rate</SortableHeader>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedRows.map((row, i) => {
                                    const dsoBand = row.dso < 45 ? 'text-emerald-700' : row.dso < 75 ? 'text-amber-700' : 'text-red-700';
                                    return (
                                        <tr key={row.month} className="border-b border-gray-100 hover:bg-gray-50">
                                            <td className="px-4 py-2 font-mono text-gray-800">{row.month}</td>
                                            <td className="px-4 py-2 text-right font-mono text-gray-700">{fmtMoney(row.revenue)}</td>
                                            <td className="px-4 py-2 text-right font-mono text-gray-700">{fmtMoney(row.arEnd)}</td>
                                            <td className={`px-4 py-2 text-right font-mono font-semibold ${dsoBand}`}>{row.dso}</td>
                                            <td className="px-4 py-2 text-right font-mono text-gray-700">{fmtMoney(row.collected)}</td>
                                            <td className="px-4 py-2 text-right font-mono text-gray-700">{row.collectionRate} %</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </CardBody>
            </Card>
        </ReportPage>
    );
};

export default DsoTrendReport;
