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
    ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip
} from 'recharts';

/**
 * F4 · Sales Register — audit-grade revenue recognition register.
 *
 * One row per recognised invoice in the period, with full tax
 * breakdown for GL tie-out. Used at month-end and year-end close.
 * Status is restricted to revenue-recognising states (Customer
 * Accepted / Paid / Partial) so this view is auditor-friendly.
 *
 * Backend: GET /api/reports/finance/sales-register?from=&to=&salesperson=&customerId=
 */

const SalesRegisterReport = () => {
    const { navigate } = useApp();

    // Default period: first day of current month → today
    const today = useMemo(() => {
        const d = new Date();
        return d.toISOString().slice(0, 10);
    }, []);
    const firstOfMonth = useMemo(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    }, []);

    const [from, setFrom]               = useState(firstOfMonth);
    const [to, setTo]                   = useState(today);
    const [salesperson, setSalesperson] = useState('');

    const [data, setData]       = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        const params = new URLSearchParams();
        if (from)        params.append('from', from);
        if (to)          params.append('to', to);
        if (salesperson) params.append('salesperson', salesperson);

        api.get(`/reports/finance/sales-register?${params.toString()}`)
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
    }, [from, to, salesperson]);

    // Distinct salespersons from result so the filter only shows real values
    const distinctReps = useMemo(() => {
        if (!data?.rows) return [];
        return Array.from(new Set(data.rows.map(r => r.salesperson).filter(v => v && v !== '—'))).sort();
    }, [data]);

    const { sortKey, sortDir, toggle, sortedRows } = useSortable(
        data?.rows || [],
        'invoiceDate',
        'asc'
    );

    const handleExport = async (format, opts) => {
        if (!data) return;
        return exportReport(format, data, opts);
    };

    const filtersJsx = (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
            <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
                <input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="w-full p-2 border border-gray-300 rounded text-sm"
                />
            </div>
            <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
                <input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="w-full p-2 border border-gray-300 rounded text-sm"
                />
            </div>
            <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Salesperson</label>
                <select
                    value={salesperson}
                    onChange={(e) => setSalesperson(e.target.value)}
                    className="w-full p-2 border border-gray-300 rounded text-sm"
                >
                    <option value="">All</option>
                    {distinctReps.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
            </div>
            {salesperson && (
                <button
                    onClick={() => setSalesperson('')}
                    className="text-xs text-blue-600 hover:underline pb-2 text-left"
                >
                    Clear filter
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
                />
            ))}
        </div>
    ) : null;

    // Horizontal bar — revenue by salesperson (top 5 + Other)
    const chartsJsx = data?.charts?.[0]?.data ? (
        <ChartCard title="Revenue by salesperson" subtitle="Top 5 reps + rest collapsed">
            <div style={{ height: 220 }}>
                <ResponsiveContainer>
                    <BarChart
                        data={data.charts[0].data}
                        layout="vertical"
                        margin={{ top: 10, right: 30, bottom: 5, left: 60 }}
                    >
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                        <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={120} />
                        <Tooltip formatter={(v) => fmtMoney(v)} />
                        <Bar dataKey="value" fill={CHART_COLORS.primary} radius={[0, 4, 4, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </ChartCard>
    ) : null;

    return (
        <ReportPage
            title="Sales Register"
            subtitle={data?.subtitle}
            icon="book"
            loading={loading}
            error={error}
            empty={!data?.rows?.length}
            emptyHint={`No recognised invoices between ${from} and ${to}.`}
            onExport={handleExport}
            filters={filtersJsx}
            kpiBand={kpiBand}
            charts={chartsJsx}
        >
            <Card>
                <CardHead
                    title="Invoice detail"
                    subtitle={`${data?.rows?.length || 0} invoice${data?.rows?.length === 1 ? '' : 's'} · ready for GL posting`}
                />
                <CardBody pad={false}>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 border-b border-gray-200">
                                <tr>
                                    <SortableHeader keyName="invoiceNumber" sortKey={sortKey} sortDir={sortDir} onSort={toggle}>Invoice</SortableHeader>
                                    <SortableHeader keyName="invoiceDate"   sortKey={sortKey} sortDir={sortDir} onSort={toggle}>Date</SortableHeader>
                                    <SortableHeader keyName="customerName"  sortKey={sortKey} sortDir={sortDir} onSort={toggle}>Customer</SortableHeader>
                                    <SortableHeader keyName="tin"           sortKey={sortKey} sortDir={sortDir} onSort={toggle}>TIN</SortableHeader>
                                    <SortableHeader keyName="salesperson"   sortKey={sortKey} sortDir={sortDir} onSort={toggle}>Salesperson</SortableHeader>
                                    <SortableHeader keyName="subtotal"      sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right">Net</SortableHeader>
                                    <SortableHeader keyName="nhil"          sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right">NHIL</SortableHeader>
                                    <SortableHeader keyName="getfund"       sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right">GETFund</SortableHeader>
                                    <SortableHeader keyName="covid"         sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right">COVID</SortableHeader>
                                    <SortableHeader keyName="vat"           sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right">VAT</SortableHeader>
                                    <SortableHeader keyName="total"         sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right">Gross</SortableHeader>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedRows.map((row) => (
                                    <tr
                                        key={row.invoiceId}
                                        onClick={() => navigate('invoiceEditor', { invoiceId: row.invoiceId })}
                                        className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                                    >
                                        <td className="px-4 py-2 font-mono text-xs text-blue-700">{row.invoiceNumber}</td>
                                        <td className="px-4 py-2 text-gray-700">{row.invoiceDate}</td>
                                        <td className="px-4 py-2 text-gray-800">{row.customerName}</td>
                                        <td className="px-4 py-2 font-mono text-xs text-gray-600">{row.tin || '—'}</td>
                                        <td className="px-4 py-2 text-gray-700">{row.salesperson}</td>
                                        <td className="px-4 py-2 text-right font-mono text-gray-900">{fmtMoney(row.subtotal)}</td>
                                        <td className="px-4 py-2 text-right font-mono text-gray-700">{fmtMoney(row.nhil)}</td>
                                        <td className="px-4 py-2 text-right font-mono text-gray-700">{fmtMoney(row.getfund)}</td>
                                        <td className="px-4 py-2 text-right font-mono text-gray-700">{fmtMoney(row.covid)}</td>
                                        <td className="px-4 py-2 text-right font-mono text-gray-700">{fmtMoney(row.vat)}</td>
                                        <td className="px-4 py-2 text-right font-mono text-gray-900 font-semibold">{fmtMoney(row.total)}</td>
                                    </tr>
                                ))}
                                {data?.totals && (
                                    <tr className="bg-blue-50 font-semibold border-t-2 border-blue-200">
                                        <td colSpan={5} className="px-4 py-2 text-blue-900">TOTAL</td>
                                        <td className="px-4 py-2 text-right font-mono text-blue-900">{fmtMoney(data.totals.subtotal)}</td>
                                        <td className="px-4 py-2 text-right font-mono text-blue-900">{fmtMoney(data.totals.nhil)}</td>
                                        <td className="px-4 py-2 text-right font-mono text-blue-900">{fmtMoney(data.totals.getfund)}</td>
                                        <td className="px-4 py-2 text-right font-mono text-blue-900">{fmtMoney(data.totals.covid)}</td>
                                        <td className="px-4 py-2 text-right font-mono text-blue-900">{fmtMoney(data.totals.vat)}</td>
                                        <td className="px-4 py-2 text-right font-mono text-blue-900">{fmtMoney(data.totals.total)}</td>
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

export default SalesRegisterReport;
