import React, { useEffect, useMemo, useState } from 'react';
import api from '../../api';
import ReportPage from './ReportPage';
import MetricTile from '../../components/v2/MetricTile';
import ChartCard, { CHART_COLORS } from '../../components/v2/ChartCard';
import Card, { CardHead, CardBody } from '../../components/v2/Card';
import { SortableHeader, useSortable } from '../../components/v2';
import { useApp } from '../../context/AppContext';
import { exportReport } from '../../services/ReportExportService';
import {
    ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie,
    XAxis, YAxis, CartesianGrid, Tooltip, Cell, ReferenceLine
} from 'recharts';

/**
 * GenericReport — driven entirely by the standard envelope.
 *
 * Reports whose layout matches the canonical KPI band + chart(s) +
 * sortable table can use this directly. Skip the bespoke per-report
 * page when there's no custom UI (filings summary, warnings strip,
 * etc.) — Phase 5.1 Finance reports each needed unique extras so
 * they got their own pages. Phase 5.2 Procurement is more uniform
 * and uses this template.
 *
 * Props:
 *   - title, icon         : displayed in the header
 *   - endpoint            : API path (no /api prefix)
 *   - filters             : array of { key, label, type, options?, defaultValue? }
 *                            type: 'date' | 'select' | 'text' | 'number'
 *   - chartType            : 'bar' | 'line' | 'pie' | 'horizontal-bar' (per chart, optional override)
 *
 * Filter values are pushed into the URL as query params. The page
 * refetches on any filter change.
 */

const fmtValueByType = (v, type) => {
    if (v == null || v === '') return '';
    if (type === 'currency') return Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (type === 'percent')  return `${Number(v).toFixed(1)} %`;
    if (type === 'number')   return Number(v).toLocaleString();
    return String(v);
};

const inputCls = 'w-full p-2 border border-gray-300 rounded text-sm';

const GenericReport = ({
    title,
    icon,
    endpoint,
    filters = [],
    chartTypes = {} // chartIndex -> 'bar' | 'line' | 'pie' | 'horizontal-bar'
}) => {
    const { navigate } = useApp();

    // Initialize filter state from defaults
    const initial = useMemo(() => {
        const obj = {};
        for (const f of filters) {
            if (f.defaultValue !== undefined) obj[f.key] = f.defaultValue;
            else if (f.type === 'date') {
                obj[f.key] = ''; // server will default
            } else obj[f.key] = '';
        }
        return obj;
    }, [filters]);
    const [filterValues, setFilterValues] = useState(initial);

    const [data, setData]       = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(filterValues)) {
            if (v != null && v !== '') params.append(k, v);
        }
        api.get(`${endpoint}?${params.toString()}`)
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
    }, [endpoint, filterValues]);

    const setFilter = (key, value) => setFilterValues(prev => ({ ...prev, [key]: value }));

    // Distinct values for select filters that say `optionsFromColumn: 'foo'`
    // — pulls from the result set itself so the dropdown always matches data.
    const distinctOptions = (col) => {
        if (!data?.rows || !col) return [];
        return Array.from(new Set(data.rows.map(r => r[col]).filter(v => v && v !== '—'))).sort();
    };

    const { sortKey, sortDir, toggle, sortedRows } = useSortable(
        data?.rows || [],
        data?.columns?.[0]?.key || '',
        'desc'
    );

    const handleExport = async (format, opts) => {
        if (!data) return;
        return exportReport(format, data, opts);
    };

    // Filters renderer
    const filtersJsx = filters.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
            {filters.map(f => {
                if (f.type === 'date') {
                    return (
                        <div key={f.key}>
                            <label className="block text-xs font-medium text-gray-600 mb-1">{f.label}</label>
                            <input
                                type="date"
                                value={filterValues[f.key] || ''}
                                onChange={(e) => setFilter(f.key, e.target.value)}
                                className={inputCls}
                            />
                        </div>
                    );
                }
                if (f.type === 'select') {
                    const opts = f.options || distinctOptions(f.optionsFromColumn);
                    return (
                        <div key={f.key}>
                            <label className="block text-xs font-medium text-gray-600 mb-1">{f.label}</label>
                            <select
                                value={filterValues[f.key] || ''}
                                onChange={(e) => setFilter(f.key, e.target.value)}
                                className={inputCls}
                            >
                                <option value="">{f.placeholder || 'All'}</option>
                                {opts.map(o => (
                                    typeof o === 'string'
                                        ? <option key={o} value={o}>{o}</option>
                                        : <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                            </select>
                        </div>
                    );
                }
                // text / number
                return (
                    <div key={f.key}>
                        <label className="block text-xs font-medium text-gray-600 mb-1">{f.label}</label>
                        <input
                            type={f.type === 'number' ? 'number' : 'text'}
                            value={filterValues[f.key] || ''}
                            onChange={(e) => setFilter(f.key, e.target.value)}
                            placeholder={f.placeholder || ''}
                            className={inputCls}
                        />
                    </div>
                );
            })}
        </div>
    ) : null;

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

    // Render each chart from envelope
    const chartsJsx = data?.charts?.length ? (
        <div className={`grid grid-cols-1 ${data.charts.length > 1 ? 'md:grid-cols-2' : ''} gap-4`}>
            {data.charts.map((chart, i) => {
                const explicit = chartTypes[i];
                const t = explicit || chart.type || 'bar';
                return (
                    <ChartCard key={i} title={chart.title}>
                        <div style={{ height: 240 }}>
                            <ResponsiveContainer>
                                {t === 'line' ? (
                                    <LineChart data={chart.data} margin={{ top: 10, right: 20, bottom: 5, left: 10 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                                        <YAxis tick={{ fontSize: 11 }} />
                                        <Tooltip />
                                        <Line type="monotone" dataKey="value" stroke={CHART_COLORS.primary} strokeWidth={2} dot={{ r: 2 }} />
                                    </LineChart>
                                ) : t === 'pie' ? (
                                    <PieChart>
                                        <Pie data={chart.data} dataKey="value" nameKey="name" outerRadius={80} label>
                                            {chart.data.map((_, idx) => <Cell key={idx} fill={Object.values(CHART_COLORS)[idx % Object.keys(CHART_COLORS).length]} />)}
                                        </Pie>
                                        <Tooltip />
                                    </PieChart>
                                ) : t === 'horizontal-bar' ? (
                                    <BarChart data={chart.data} layout="vertical" margin={{ top: 10, right: 20, bottom: 5, left: 100 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                        <XAxis type="number" tick={{ fontSize: 11 }} />
                                        <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={150} />
                                        <Tooltip />
                                        <Bar dataKey="value" fill={CHART_COLORS.primary} radius={[0, 4, 4, 0]} />
                                    </BarChart>
                                ) : (
                                    <BarChart data={chart.data} margin={{ top: 10, right: 20, bottom: 5, left: 10 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                                        <YAxis tick={{ fontSize: 11 }} />
                                        <Tooltip />
                                        <Bar dataKey="value" fill={CHART_COLORS.primary} radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                )}
                            </ResponsiveContainer>
                        </div>
                    </ChartCard>
                );
            })}
        </div>
    ) : null;

    const cols = data?.columns || [];
    // A row gets its drill handler from the FIRST drillable column found
    // (column with both `drillPage` and `drillKey` set in the envelope).
    // Whole-row click navigates to that page with `{ [drillKey]: rowValue }`
    // as pageContext — matches what InvoiceEditor / CustomerStatement /
    // VendorScorecard / PurchaseRequisitionDetail / RfqDetail expect.
    const rowDrillHandler = (row) => {
        for (const c of cols) {
            if (c.drillPage && c.drillKey && row[c.drillKey]) {
                return () => navigate(c.drillPage, { [c.drillKey]: row[c.drillKey] });
            }
        }
        return undefined;
    };

    return (
        <ReportPage
            title={title}
            subtitle={data?.subtitle}
            icon={icon}
            loading={loading}
            error={error}
            empty={!data?.rows?.length && !data?.charts?.length}
            emptyHint="No data for the selected filters."
            onExport={handleExport}
            filters={filtersJsx}
            kpiBand={kpiBand}
            charts={chartsJsx}
        >
            {cols.length > 0 && (
                <Card>
                    <CardHead
                        title="Detail"
                        subtitle={`${data?.rows?.length || 0} row${data?.rows?.length === 1 ? '' : 's'}${data?.extras?.methodology ? ` · ${data.extras.methodology}` : ''}`}
                    />
                    <CardBody pad={false}>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 border-b border-gray-200">
                                    <tr>
                                        {cols.map(c => (
                                            <SortableHeader
                                                key={c.key}
                                                keyName={c.key}
                                                sortKey={sortKey}
                                                sortDir={sortDir}
                                                onSort={toggle}
                                                align={['number', 'currency', 'percent'].includes(c.type) ? 'right' : 'left'}
                                            >
                                                {c.label}
                                            </SortableHeader>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedRows.map((row, i) => {
                                        const onClick = rowDrillHandler(row);
                                        // WCAG 2.1 § 2.1.1 (Keyboard) +
                                        // § 2.4.7 (Focus Visible) — drill
                                        // rows are clickable for mouse
                                        // users; make them keyboard-
                                        // reachable too. Enter/Space
                                        // activate the same handler.
                                        const a11yProps = onClick ? {
                                            tabIndex: 0,
                                            role: 'button',
                                            onKeyDown: (e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault();
                                                    onClick();
                                                }
                                            }
                                        } : {};
                                        return (
                                            <tr
                                                key={i}
                                                onClick={onClick}
                                                {...a11yProps}
                                                className={`border-b border-gray-100 ${onClick ? 'hover:bg-gray-50 cursor-pointer focus:outline-none focus-visible:bg-blue-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500' : ''}`}
                                            >
                                                {cols.map(c => (
                                                    <td
                                                        key={c.key}
                                                        className={`px-4 py-2 ${['number', 'currency', 'percent'].includes(c.type) ? 'text-right font-mono' : 'text-gray-800'}`}
                                                    >
                                                        {c.drillPage && row[c.drillKey]
                                                            ? <span className="text-blue-700 font-mono text-xs">{fmtValueByType(row[c.key], c.type)}</span>
                                                            : fmtValueByType(row[c.key], c.type)
                                                        }
                                                    </td>
                                                ))}
                                            </tr>
                                        );
                                    })}
                                    {data?.totals && (
                                        <tr className="bg-blue-50 font-semibold border-t-2 border-blue-200">
                                            {cols.map((c, idx) => (
                                                <td
                                                    key={c.key}
                                                    className={`px-4 py-2 ${['number', 'currency', 'percent'].includes(c.type) ? 'text-right font-mono text-blue-900' : 'text-blue-900'}`}
                                                >
                                                    {idx === 0 ? 'TOTAL' : (data.totals[c.key] != null ? fmtValueByType(data.totals[c.key], c.type) : '')}
                                                </td>
                                            ))}
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </CardBody>
                </Card>
            )}
        </ReportPage>
    );
};

export default GenericReport;
