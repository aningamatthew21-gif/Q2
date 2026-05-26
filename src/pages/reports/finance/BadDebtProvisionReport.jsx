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
    ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip
} from 'recharts';

/**
 * F8 · Bad-Debt Provision — age-based reserve calculation.
 *
 * Quarterly close report. CFO + auditor view. Standard schedule:
 *   0-90 d   = 0 %
 *   91-180   = 25 %
 *   181-365  = 50 %
 *   365+     = 100 % (write-off candidates listed)
 *
 * Backend: GET /api/reports/finance/bad-debt-provision?asOfDate=
 */

const fmtMoney = (v) => Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const BadDebtProvisionReport = () => {
    const { navigate } = useApp();

    const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
    const [asOfDate, setAsOfDate] = useState(today);

    const [data, setData]       = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        api.get(`/reports/finance/bad-debt-provision?asOfDate=${asOfDate}`)
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
    }, [asOfDate]);

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
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 items-end">
            <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">As of date</label>
                <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="w-full p-2 border border-gray-300 rounded text-sm" />
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
        <ChartCard title="Provision by aging bucket (GHS)">
            <div style={{ height: 220 }}>
                <ResponsiveContainer>
                    <BarChart data={data.charts[0].data} margin={{ top: 10, right: 20, bottom: 5, left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                        <Tooltip formatter={(v) => fmtMoney(v)} />
                        <Bar dataKey="value" fill={CHART_COLORS.warn || '#F59E0B'} radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </ChartCard>
    ) : null;

    const sched = data?.extras?.schedule || [];

    return (
        <ReportPage
            title="Bad-Debt Provision"
            subtitle={data?.subtitle}
            icon="triangle-exclamation"
            loading={loading}
            error={error}
            empty={!sched.length && !sortedRows.length}
            emptyHint="No open AR to provision."
            onExport={handleExport}
            filters={filtersJsx}
            kpiBand={kpiBand}
            charts={chartsJsx}
        >
            {/* Provision schedule */}
            {sched.length > 0 && (
                <Card className="mb-4">
                    <CardHead
                        title="Provision schedule applied"
                        subtitle={data?.extras?.methodology}
                    />
                    <CardBody pad={false}>
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 border-b border-gray-200">
                                <tr>
                                    <th className="px-4 py-2 text-left text-xs text-gray-500 font-medium">Aging bucket</th>
                                    <th className="px-4 py-2 text-right text-xs text-gray-500 font-medium">AR balance</th>
                                    <th className="px-4 py-2 text-right text-xs text-gray-500 font-medium">Provision %</th>
                                    <th className="px-4 py-2 text-right text-xs text-gray-500 font-medium">Provision amount</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sched.map((s, i) => (
                                    <tr key={i} className={`border-b border-gray-100 ${s.bucket === '365+ days' ? 'bg-red-50' : ''}`}>
                                        <td className="px-4 py-2 text-gray-800">{s.bucket}</td>
                                        <td className="px-4 py-2 text-right font-mono text-gray-700">{fmtMoney(s.arBalance)}</td>
                                        <td className="px-4 py-2 text-right font-mono text-gray-700">{s.rate} %</td>
                                        <td className={`px-4 py-2 text-right font-mono font-semibold ${s.rate >= 50 ? 'text-red-700' : 'text-gray-900'}`}>{fmtMoney(s.provision)}</td>
                                    </tr>
                                ))}
                                <tr className="bg-blue-50 font-semibold border-t-2 border-blue-200">
                                    <td className="px-4 py-2 text-blue-900">TOTAL</td>
                                    <td className="px-4 py-2 text-right font-mono text-blue-900">{fmtMoney(data?.extras?.totalAr || 0)}</td>
                                    <td></td>
                                    <td className="px-4 py-2 text-right font-mono text-blue-900">{fmtMoney(data?.extras?.totalProvision || 0)}</td>
                                </tr>
                            </tbody>
                        </table>
                    </CardBody>
                </Card>
            )}

            {/* Write-off candidates */}
            <Card>
                <CardHead
                    title={`Write-off candidates (${sortedRows.length})`}
                    subtitle="Open invoices 365+ days past due — review with auditor"
                />
                <CardBody pad={false}>
                    {sortedRows.length === 0 ? (
                        <div className="text-center py-8 text-gray-500 text-sm">
                            No invoices 365+ days past due. Nothing to write off this period.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 border-b border-gray-200">
                                    <tr>
                                        <SortableHeader keyName="invoiceNumber" sortKey={sortKey} sortDir={sortDir} onSort={toggle}>Invoice</SortableHeader>
                                        <SortableHeader keyName="customerName"  sortKey={sortKey} sortDir={sortDir} onSort={toggle}>Customer</SortableHeader>
                                        <SortableHeader keyName="dueDate"       sortKey={sortKey} sortDir={sortDir} onSort={toggle}>Due date</SortableHeader>
                                        <SortableHeader keyName="daysOverdue"   sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right">Days</SortableHeader>
                                        <SortableHeader keyName="balanceDue"    sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right">Balance</SortableHeader>
                                        <SortableHeader keyName="provision"     sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right">Provision</SortableHeader>
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
                                            <td className="px-4 py-2 text-gray-800">{row.customerName}</td>
                                            <td className="px-4 py-2 text-gray-700">{row.dueDate}</td>
                                            <td className="px-4 py-2 text-right font-mono text-red-700 font-semibold">{row.daysOverdue}</td>
                                            <td className="px-4 py-2 text-right font-mono text-gray-900">{fmtMoney(row.balanceDue)}</td>
                                            <td className="px-4 py-2 text-right font-mono text-red-700 font-semibold">{fmtMoney(row.provision)}</td>
                                        </tr>
                                    ))}
                                    {data?.totals && (
                                        <tr className="bg-red-50 font-semibold border-t-2 border-red-200">
                                            <td colSpan={4} className="px-4 py-2 text-red-900">TOTAL WRITE-OFFS</td>
                                            <td className="px-4 py-2 text-right font-mono text-red-900">{fmtMoney(data.totals.balanceDue)}</td>
                                            <td className="px-4 py-2 text-right font-mono text-red-900">{fmtMoney(data.totals.provision)}</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardBody>
            </Card>
        </ReportPage>
    );
};

export default BadDebtProvisionReport;
