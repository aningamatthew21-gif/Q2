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
    ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell
} from 'recharts';

/**
 * F5 · VAT Compliance Report — Ghana GRA filing aid.
 *
 * Audience: tax manager, finance head, external auditor.
 * Renders the monthly filing summary (box codes 010 / 040 / 050 / 060
 * / 070 / 080) for direct paste into the GRA portal, plus a warnings
 * strip for invoices that would FAIL GRA's TIN validation.
 *
 * Backend: GET /api/reports/finance/vat-compliance?month=YYYY-MM
 */

const fmtMoney = (v) => Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const VatComplianceReport = () => {
    const { navigate } = useApp();

    // Default month = current YYYY-MM
    const defaultMonth = useMemo(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }, []);
    const [month, setMonth] = useState(defaultMonth);

    // Data state
    const [data, setData]       = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        api.get(`/reports/finance/vat-compliance?month=${month}`)
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
    }, [month]);

    const { sortKey, sortDir, toggle, sortedRows } = useSortable(
        data?.rows || [],
        'invoiceDate',
        'asc'
    );

    const handleExport = async (format, opts) => {
        if (!data) return;
        return exportReport(format, data, opts);
    };

    // Month picker — last 12 months as quick options
    const monthOptions = useMemo(() => {
        const opts = [];
        const today = new Date();
        for (let i = 0; i < 12; i++) {
            const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
            opts.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        }
        return opts;
    }, []);

    const filtersJsx = (
        <div className="flex items-end gap-3">
            <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Filing month</label>
                <select
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                    className="w-44 p-2 border border-gray-300 rounded text-sm font-mono"
                >
                    {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
            </div>
            <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="p-2 border border-gray-300 rounded text-sm"
            />
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

    // Chart: tax mix bar
    const chartsJsx = data?.charts?.[0]?.data ? (
        <ChartCard title="Tax mix (GHS)" subtitle="Output VAT + statutory levies for the month">
            <div style={{ height: 220 }}>
                <ResponsiveContainer>
                    <BarChart data={data.charts[0].data} margin={{ top: 10, right: 20, bottom: 5, left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                        <Tooltip formatter={(v) => fmtMoney(v)} />
                        <Bar dataKey="value" fill={CHART_COLORS.primary} radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </ChartCard>
    ) : null;

    const extras   = data?.extras || {};
    const filing   = extras.filingSummary || [];
    const warnings = extras.warnings || [];

    return (
        <ReportPage
            title="VAT Compliance"
            subtitle={data?.subtitle}
            icon="percent"
            loading={loading}
            error={error}
            empty={!data?.rows?.length}
            emptyHint={`No recognised invoices for ${month}. Pick a different filing month.`}
            onExport={handleExport}
            filters={filtersJsx}
            kpiBand={kpiBand}
            charts={chartsJsx}
        >
            {/* GRA filing summary — the box-coded table for direct paste */}
            {filing.length > 0 && (
                <Card className="mb-4">
                    <CardHead
                        title="Filing summary"
                        subtitle="Paste these totals straight into the GRA portal"
                    />
                    <CardBody pad={false}>
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 border-b border-gray-200">
                                <tr>
                                    <th className="px-4 py-2 text-left text-xs text-gray-500 font-medium w-16">Box</th>
                                    <th className="px-4 py-2 text-left text-xs text-gray-500 font-medium">Description</th>
                                    <th className="px-4 py-2 text-right text-xs text-gray-500 font-medium">Amount (GHS)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filing.map((row, i) => (
                                    <tr key={i} className={`border-b border-gray-100 ${row.box === '080' ? 'bg-blue-50 font-semibold' : ''}`}>
                                        <td className="px-4 py-2 font-mono text-xs text-gray-700">{row.box || ''}</td>
                                        <td className="px-4 py-2 text-gray-800">{row.label}</td>
                                        <td className="px-4 py-2 text-right font-mono text-gray-900">{fmtMoney(row.amount)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </CardBody>
                </Card>
            )}

            {/* Validation warnings — TIN issues that would fail GRA */}
            {warnings.length > 0 && (
                <Card className="mb-4 border-amber-300">
                    <CardHead
                        title={`Validation warnings (${warnings.length})`}
                        subtitle="GRA will reject these rows — fix before filing"
                    />
                    <CardBody pad={false}>
                        <table className="w-full text-sm">
                            <thead className="bg-amber-50 border-b border-amber-200">
                                <tr>
                                    <th className="px-4 py-2 text-left text-xs font-medium text-amber-900">Invoice</th>
                                    <th className="px-4 py-2 text-left text-xs font-medium text-amber-900">Customer</th>
                                    <th className="px-4 py-2 text-left text-xs font-medium text-amber-900">Issue</th>
                                </tr>
                            </thead>
                            <tbody>
                                {warnings.map((w, i) => (
                                    <tr
                                        key={i}
                                        onClick={() => navigate('invoiceEditor', { invoiceId: w.invoiceId })}
                                        className="border-b border-amber-100 hover:bg-amber-50/50 cursor-pointer"
                                    >
                                        <td className="px-4 py-2 font-mono text-xs text-blue-700">{w.invoiceNumber}</td>
                                        <td className="px-4 py-2 text-gray-800">{w.customerName}</td>
                                        <td className="px-4 py-2 text-amber-800">⚠ {w.issue}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </CardBody>
                </Card>
            )}

            {/* Detail table */}
            <Card>
                <CardHead
                    title="Invoice detail"
                    subtitle={`${data?.rows?.length || 0} invoice${data?.rows?.length === 1 ? '' : 's'} recognised this month`}
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
                                        <td className="px-4 py-2 font-mono text-xs text-gray-600">{row.tin || '⚠ missing'}</td>
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
                                        <td colSpan={4} className="px-4 py-2 text-blue-900">TOTAL</td>
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

export default VatComplianceReport;
