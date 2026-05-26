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
    ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip
} from 'recharts';

/**
 * F3 · Cash Collections — daily inflows by payment method.
 *
 * Treasurer's daily view. Charts: channel mix (bar) + daily inflow
 * (line). Detail table lists every receipt with drill to the invoice.
 *
 * Backend: GET /api/reports/finance/cash-collections?from=&to=&method=&currency=&bank=
 */

const fmtMoney = (v) => Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CashCollectionsReport = () => {
    const { navigate } = useApp();

    const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
    const firstOfMonth = useMemo(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    }, []);

    const [from, setFrom]         = useState(firstOfMonth);
    const [to, setTo]             = useState(today);
    const [method, setMethod]     = useState('');
    const [currency, setCurrency] = useState('');
    const [bank, setBank]         = useState('');

    const [data, setData]       = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        const params = new URLSearchParams();
        if (from)     params.append('from', from);
        if (to)       params.append('to', to);
        if (method)   params.append('method', method);
        if (currency) params.append('currency', currency);
        if (bank)     params.append('bank', bank);

        api.get(`/reports/finance/cash-collections?${params.toString()}`)
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
    }, [from, to, method, currency, bank]);

    const distinctMethods = useMemo(() => {
        if (!data?.rows) return [];
        return Array.from(new Set(data.rows.map(r => r.method).filter(Boolean))).sort();
    }, [data]);
    const distinctBanks = useMemo(() => {
        if (!data?.rows) return [];
        return Array.from(new Set(data.rows.map(r => r.bank).filter(Boolean))).sort();
    }, [data]);

    const { sortKey, sortDir, toggle, sortedRows } = useSortable(
        data?.rows || [],
        'paymentDate',
        'desc'
    );

    const handleExport = async (format, opts) => {
        if (!data) return;
        return exportReport(format, data, opts);
    };

    const filtersJsx = (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
            <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full p-2 border border-gray-300 rounded text-sm" />
            </div>
            <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full p-2 border border-gray-300 rounded text-sm" />
            </div>
            <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Method</label>
                <select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full p-2 border border-gray-300 rounded text-sm">
                    <option value="">All</option>
                    {distinctMethods.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
            </div>
            <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Bank</label>
                <select value={bank} onChange={(e) => setBank(e.target.value)} className="w-full p-2 border border-gray-300 rounded text-sm">
                    <option value="">All banks</option>
                    {distinctBanks.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
            </div>
            {(method || bank || currency) && (
                <button
                    onClick={() => { setMethod(''); setBank(''); setCurrency(''); }}
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
                />
            ))}
        </div>
    ) : null;

    const methodData = data?.charts?.[0]?.data || [];
    const dayData    = data?.charts?.[1]?.data || [];

    const chartsJsx = (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ChartCard title="By payment method" subtitle="GHS, sorted by total">
                <div style={{ height: 220 }}>
                    <ResponsiveContainer>
                        <BarChart data={methodData} layout="vertical" margin={{ top: 10, right: 20, bottom: 5, left: 60 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                            <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={100} />
                            <Tooltip formatter={(v) => fmtMoney(v)} />
                            <Bar dataKey="value" fill={CHART_COLORS.primary} radius={[0, 4, 4, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </ChartCard>
            <ChartCard title="Daily inflow" subtitle="Net cash banked per day">
                <div style={{ height: 220 }}>
                    <ResponsiveContainer>
                        <LineChart data={dayData} margin={{ top: 10, right: 20, bottom: 5, left: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                            <Tooltip formatter={(v) => fmtMoney(v)} />
                            <Line type="monotone" dataKey="value" stroke={CHART_COLORS.primary} strokeWidth={2.5} dot={{ r: 2 }} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </ChartCard>
        </div>
    );

    return (
        <ReportPage
            title="Cash Collections"
            subtitle={data?.subtitle}
            icon="sack-dollar"
            loading={loading}
            error={error}
            empty={!data?.rows?.length}
            emptyHint={`No receipts between ${from} and ${to}.`}
            onExport={handleExport}
            filters={filtersJsx}
            kpiBand={kpiBand}
            charts={chartsJsx}
        >
            <Card>
                <CardHead
                    title="Receipts"
                    subtitle={`${data?.rows?.length || 0} receipt${data?.rows?.length === 1 ? '' : 's'} · sorted by Date desc`}
                />
                <CardBody pad={false}>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 border-b border-gray-200">
                                <tr>
                                    <SortableHeader keyName="paymentDate"    sortKey={sortKey} sortDir={sortDir} onSort={toggle}>Date</SortableHeader>
                                    <SortableHeader keyName="receiptNumber"  sortKey={sortKey} sortDir={sortDir} onSort={toggle}>Receipt</SortableHeader>
                                    <SortableHeader keyName="customerName"   sortKey={sortKey} sortDir={sortDir} onSort={toggle}>Customer</SortableHeader>
                                    <SortableHeader keyName="invoiceNumber"  sortKey={sortKey} sortDir={sortDir} onSort={toggle}>Invoice</SortableHeader>
                                    <SortableHeader keyName="method"         sortKey={sortKey} sortDir={sortDir} onSort={toggle}>Method</SortableHeader>
                                    <SortableHeader keyName="reference"      sortKey={sortKey} sortDir={sortDir} onSort={toggle}>Ref</SortableHeader>
                                    <SortableHeader keyName="amount"         sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right">Net</SortableHeader>
                                    <SortableHeader keyName="wht"            sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right">WHT</SortableHeader>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedRows.map((row) => (
                                    <tr
                                        key={row.paymentId}
                                        onClick={() => navigate('invoiceEditor', { invoiceId: row.invoiceId })}
                                        className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                                    >
                                        <td className="px-4 py-2 text-gray-700">{row.paymentDate}</td>
                                        <td className="px-4 py-2 font-mono text-xs text-gray-700">{row.receiptNumber}</td>
                                        <td className="px-4 py-2 text-gray-800">{row.customerName}</td>
                                        <td className="px-4 py-2 font-mono text-xs text-blue-700">{row.invoiceNumber}</td>
                                        <td className="px-4 py-2 text-gray-700">{row.method}</td>
                                        <td className="px-4 py-2 font-mono text-xs text-gray-600">{row.reference || '—'}</td>
                                        <td className="px-4 py-2 text-right font-mono text-gray-900 font-semibold">{fmtMoney(row.amount)}</td>
                                        <td className="px-4 py-2 text-right font-mono text-gray-700">{fmtMoney(row.wht)}</td>
                                    </tr>
                                ))}
                                {data?.totals && (
                                    <tr className="bg-blue-50 font-semibold border-t-2 border-blue-200">
                                        <td colSpan={6} className="px-4 py-2 text-blue-900">TOTAL</td>
                                        <td className="px-4 py-2 text-right font-mono text-blue-900">{fmtMoney(data.totals.amount)}</td>
                                        <td className="px-4 py-2 text-right font-mono text-blue-900">{fmtMoney(data.totals.wht)}</td>
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

export default CashCollectionsReport;
