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
 * F6 · Withholding Tax Collected — Ghana WHT filing aid.
 *
 * Audience: Tax Manager (monthly filing); Finance Head (compliance).
 * Surfaces WHT broken out by type (VAT_WHT 7%, SERVICE_WHT 7.5%, etc.)
 * AND certificate-collection status so finance can chase missing certs
 * before the GRA recoverability window closes.
 *
 * Backend: GET /api/reports/finance/wht-collected?from=&to=&whtType=&certStatus=
 */

const WhtCollectedReport = () => {
    const { navigate } = useApp();

    const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
    const firstOfMonth = useMemo(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    }, []);

    const [from, setFrom]             = useState(firstOfMonth);
    const [to, setTo]                 = useState(today);
    const [whtType, setWhtType]       = useState('');
    const [certStatus, setCertStatus] = useState(''); // '', 'present', 'missing'

    const [data, setData]       = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        const params = new URLSearchParams();
        if (from)       params.append('from', from);
        if (to)         params.append('to', to);
        if (whtType)    params.append('whtType', whtType);
        if (certStatus) params.append('certStatus', certStatus);

        api.get(`/reports/finance/wht-collected?${params.toString()}`)
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
    }, [from, to, whtType, certStatus]);

    // Distinct WHT types from result for the filter dropdown
    const distinctTypes = useMemo(() => {
        if (!data?.rows) return [];
        return Array.from(new Set(data.rows.map(r => r.whtCode))).sort();
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
                <label className="block text-xs font-medium text-gray-600 mb-1">WHT type</label>
                <select value={whtType} onChange={(e) => setWhtType(e.target.value)} className="w-full p-2 border border-gray-300 rounded text-sm">
                    <option value="">All types</option>
                    {distinctTypes.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
            </div>
            <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Certificate</label>
                <select value={certStatus} onChange={(e) => setCertStatus(e.target.value)} className="w-full p-2 border border-gray-300 rounded text-sm">
                    <option value="">All</option>
                    <option value="present">Collected</option>
                    <option value="missing">Missing ⚠</option>
                </select>
            </div>
            {(whtType || certStatus) && (
                <button
                    onClick={() => { setWhtType(''); setCertStatus(''); }}
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

    const chartsJsx = data?.charts?.[0]?.data ? (
        <ChartCard title="WHT by type" subtitle="Total withheld for the period (count of receipts in parentheses)">
            <div style={{ height: 240 }}>
                <ResponsiveContainer>
                    <BarChart
                        data={data.charts[0].data}
                        layout="vertical"
                        margin={{ top: 10, right: 30, bottom: 5, left: 100 }}
                    >
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                        <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={170} />
                        <Tooltip formatter={(v) => fmtMoney(v)} />
                        <Bar dataKey="value" fill={CHART_COLORS.primary} radius={[0, 4, 4, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </ChartCard>
    ) : null;

    return (
        <ReportPage
            title="Withholding Tax Collected"
            subtitle={data?.subtitle}
            icon="receipt"
            loading={loading}
            error={error}
            empty={!data?.rows?.length}
            emptyHint={`No WHT-bearing payments between ${from} and ${to}.`}
            onExport={handleExport}
            filters={filtersJsx}
            kpiBand={kpiBand}
            charts={chartsJsx}
        >
            <Card>
                <CardHead
                    title="WHT detail"
                    subtitle={`${data?.rows?.length || 0} WHT line${data?.rows?.length === 1 ? '' : 's'} (one row per WHT type per receipt)`}
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
                                    <SortableHeader keyName="whtCode"        sortKey={sortKey} sortDir={sortDir} onSort={toggle}>WHT type</SortableHeader>
                                    <SortableHeader keyName="whtRate"        sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right">Rate</SortableHeader>
                                    <SortableHeader keyName="amount"         sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right">WHT amount</SortableHeader>
                                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Certificate</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedRows.map((row, i) => (
                                    <tr
                                        key={`${row.paymentId}-${row.whtCode}-${i}`}
                                        onClick={() => navigate('invoiceEditor', { invoiceId: row.invoiceId })}
                                        className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                                    >
                                        <td className="px-4 py-2 text-gray-700">{row.paymentDate}</td>
                                        <td className="px-4 py-2 font-mono text-xs text-gray-700">{row.receiptNumber}</td>
                                        <td className="px-4 py-2 text-gray-800">{row.customerName}</td>
                                        <td className="px-4 py-2 font-mono text-xs text-blue-700">{row.invoiceNumber}</td>
                                        <td className="px-4 py-2 text-gray-800">
                                            <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-xs font-mono">{row.whtCode}</span>
                                        </td>
                                        <td className="px-4 py-2 text-right font-mono text-gray-700">{row.whtRate != null ? `${row.whtRate} %` : '—'}</td>
                                        <td className="px-4 py-2 text-right font-mono font-semibold text-gray-900">{fmtMoney(row.amount)}</td>
                                        <td className="px-4 py-2">
                                            {row.certPresent ? (
                                                <span className="text-xs font-mono text-emerald-700">{row.certNumber}{row.certDate ? ` · ${row.certDate}` : ''}</span>
                                            ) : (
                                                <span className="text-xs text-amber-700">⚠ pending</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                                {data?.totals && (
                                    <tr className="bg-blue-50 font-semibold border-t-2 border-blue-200">
                                        <td colSpan={6} className="px-4 py-2 text-blue-900">TOTAL</td>
                                        <td className="px-4 py-2 text-right font-mono text-blue-900">{fmtMoney(data.totals.amount)}</td>
                                        <td></td>
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

export default WhtCollectedReport;
