import React, { useEffect, useMemo, useState } from 'react';
import api from '../../../api';
import ReportPage from '../ReportPage';
import MetricTile from '../../../components/v2/MetricTile';
import ChartCard, { CHART_COLORS } from '../../../components/v2/ChartCard';
import Card, { CardHead, CardBody } from '../../../components/v2/Card';
import { SortableHeader, useSortable } from '../../../components/v2';
import { useApp } from '../../../context/AppContext';
import { exportReport } from '../../../services/ReportExportService';
import { fmtMoney } from '../../../utils/format';   // SP3-M5
import {
    ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine
} from 'recharts';

/**
 * F7 · Customer Profitability — Pareto + segmentation.
 *
 * The classic 80/20 view, sliced by industry and size band (Module 1).
 * Surfaces "dangerous" accounts (big AND slow-paying) for credit review.
 *
 * Backend: GET /api/reports/finance/customer-profitability?year=&minRevenue=
 */

const CustomerProfitabilityReport = () => {
    const { navigate } = useApp();

    const [year, setYear] = useState(String(new Date().getFullYear()));
    const [minRevenue, setMinRevenue] = useState('0');

    const [data, setData]       = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        const params = new URLSearchParams();
        if (year)            params.append('year', year);
        if (Number(minRevenue) > 0) params.append('minRevenue', minRevenue);

        api.get(`/reports/finance/customer-profitability?${params.toString()}`)
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
    }, [year, minRevenue]);

    const { sortKey, sortDir, toggle, sortedRows } = useSortable(
        data?.rows || [],
        'revenue',
        'desc'
    );

    const handleExport = async (format, opts) => {
        if (!data) return;
        return exportReport(format, data, opts);
    };

    const yearOptions = useMemo(() => {
        const ys = [];
        const thisYear = new Date().getFullYear();
        for (let y = thisYear; y >= thisYear - 4; y--) ys.push(String(y));
        return ys;
    }, []);

    const filtersJsx = (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 items-end">
            <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Year</label>
                <select value={year} onChange={(e) => setYear(e.target.value)} className="w-full p-2 border border-gray-300 rounded text-sm font-mono">
                    {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
            </div>
            <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Min revenue (GHS)</label>
                <input type="number" min="0" step="1000" value={minRevenue} onChange={(e) => setMinRevenue(e.target.value)} className="w-full p-2 border border-gray-300 rounded text-sm font-mono" />
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

    const chartsJsx = data?.charts?.[0]?.data ? (
        <ChartCard title="Pareto curve" subtitle="Cumulative revenue % by customer rank (1 = top customer)">
            <div style={{ height: 240 }}>
                <ResponsiveContainer>
                    <LineChart data={data.charts[0].data} margin={{ top: 10, right: 30, bottom: 5, left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                        <Tooltip formatter={(v) => `${v}%`} labelFormatter={(l) => `Rank ${l}`} />
                        <ReferenceLine y={80} stroke="#9CA3AF" strokeDasharray="4 4" label={{ value: '80%', fontSize: 10, fill: '#9CA3AF', position: 'right' }} />
                        <Line type="monotone" dataKey="value" stroke={CHART_COLORS.primary} strokeWidth={2.5} dot={false} />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </ChartCard>
    ) : null;

    return (
        <ReportPage
            title="Customer Profitability"
            subtitle={data?.subtitle}
            icon="crown"
            loading={loading}
            error={error}
            empty={!data?.rows?.length}
            emptyHint={`No customers with revenue in ${year}.`}
            onExport={handleExport}
            filters={filtersJsx}
            kpiBand={kpiBand}
            charts={chartsJsx}
        >
            <Card>
                <CardHead
                    title="Customers"
                    subtitle={data?.extras?.methodology ? `Methodology: ${data.extras.methodology}` : null}
                />
                <CardBody pad={false}>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 border-b border-gray-200">
                                <tr>
                                    <SortableHeader keyName="customerName"  sortKey={sortKey} sortDir={sortDir} onSort={toggle}>Customer</SortableHeader>
                                    <SortableHeader keyName="industry"      sortKey={sortKey} sortDir={sortDir} onSort={toggle}>Industry</SortableHeader>
                                    <SortableHeader keyName="sizeBand"      sortKey={sortKey} sortDir={sortDir} onSort={toggle}>Size</SortableHeader>
                                    <SortableHeader keyName="revenue"       sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right">YTD revenue</SortableHeader>
                                    <SortableHeader keyName="marginPct"     sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right">Margin %</SortableHeader>
                                    <SortableHeader keyName="invoiceCount"  sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right"># inv</SortableHeader>
                                    <SortableHeader keyName="oldestOpenDays" sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right">Oldest open</SortableHeader>
                                    <SortableHeader keyName="balanceDue"    sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right">Outstanding</SortableHeader>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedRows.map((row, i) => (
                                    <tr
                                        key={row.customerId}
                                        onClick={() => navigate('customerStatement', { customerId: row.customerId })}
                                        className={`border-b border-gray-100 hover:bg-gray-50 cursor-pointer ${row.isDanger ? 'bg-red-50' : ''}`}
                                    >
                                        <td className="px-4 py-2 text-gray-800">
                                            <span className="text-xs text-gray-500 mr-2">#{i + 1}</span>
                                            {row.customerName}
                                            {row.isDanger && <span className="ml-2 px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-semibold">⚠ DANGER</span>}
                                        </td>
                                        <td className="px-4 py-2 text-gray-700">{row.industry}</td>
                                        <td className="px-4 py-2 text-gray-700">{row.sizeBand}</td>
                                        <td className="px-4 py-2 text-right font-mono text-gray-900 font-semibold">{fmtMoney(row.revenue)}</td>
                                        <td className="px-4 py-2 text-right font-mono text-gray-700">{row.marginPct > 0 ? `${row.marginPct} %` : '—'}</td>
                                        <td className="px-4 py-2 text-right font-mono text-gray-700">{row.invoiceCount}</td>
                                        <td className="px-4 py-2 text-right font-mono text-gray-700">{row.oldestOpenDays > 0 ? `${row.oldestOpenDays}d` : '—'}</td>
                                        <td className="px-4 py-2 text-right font-mono text-gray-700">{fmtMoney(row.balanceDue)}</td>
                                    </tr>
                                ))}
                                {data?.totals && (
                                    <tr className="bg-blue-50 font-semibold border-t-2 border-blue-200">
                                        <td colSpan={3} className="px-4 py-2 text-blue-900">TOTAL</td>
                                        <td className="px-4 py-2 text-right font-mono text-blue-900">{fmtMoney(data.totals.revenue)}</td>
                                        <td colSpan={3}></td>
                                        <td className="px-4 py-2 text-right font-mono text-blue-900">{fmtMoney(data.totals.balanceDue)}</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </CardBody>
            </Card>
        </ReportPage>
    );
};

export default CustomerProfitabilityReport;
