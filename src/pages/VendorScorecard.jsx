/**
 * VendorScorecard — Module 3 ranked vendor performance view.
 *
 * Lists every vendor with composite score + the underlying metrics:
 * on-time delivery, defect rate, return rate, lead-time accuracy,
 * response rate, win rate. Sortable so the head can rank by whichever
 * metric matters this week (e.g. "show me the worst defect rates").
 *
 * Backend metrics come from /api/vendor-scorecards which derives them
 * from QA_GOODS_RECEIPTS + QA_RFQ_* tables. Vendors with no measurable
 * data (newly added, never received from) show as "Insufficient data"
 * rather than being scored at 0, which would unfairly penalise them.
 *
 * Permissions: requires `vendor_scorecard.read` (procurement head,
 * finance head, admin).
 */

import React, { useEffect, useMemo, useState } from 'react';
import api from '../api';
import Icon from '../components/common/Icon';
import PageHeader from '../components/common/PageHeader';
import Button from '../components/common/Button';
import { SortableHeader, useSortable } from '../components/v2';

const fmtPct = (v) => v == null ? '—' : `${(v * 100).toFixed(1)}%`;
const fmtNum = (v) => v == null ? '—' : Number(v).toFixed(1);

const scoreTone = (score) => {
    if (score == null) return 'bg-gray-100 text-gray-500';
    if (score >= 80)   return 'bg-emerald-100 text-emerald-700';
    if (score >= 60)   return 'bg-amber-100 text-amber-700';
    return 'bg-red-100 text-red-700';
};

const VendorScorecard = ({ navigateTo, currentUser }) => {
    const [cards, setCards]   = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState(null);
    const [query, setQuery]     = useState('');

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        api.get('/vendor-scorecards')
            .then(res => {
                if (cancelled) return;
                if (res?.success) setCards(res.data || []);
                else setError(res?.error || 'Could not load scorecards.');
            })
            .catch(err => {
                if (cancelled) return;
                const status = err?.response?.status;
                const msg    = err?.response?.data?.error || err?.message || 'Unknown error';
                setError(status === 403
                    ? "You don't have permission to view vendor scorecards."
                    : `Failed to load (${status || 'network'}): ${msg}`);
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, []);

    const filtered = useMemo(() => {
        if (!query.trim()) return cards;
        const term = query.toLowerCase();
        return cards.filter(c =>
            (c.vendorName || '').toLowerCase().includes(term) ||
            (c.vendorId   || '').toLowerCase().includes(term) ||
            (c.category   || '').toLowerCase().includes(term)
        );
    }, [cards, query]);

    // Sortable projection — flatten metric numbers so sort works.
    const sortable = useMemo(() => filtered.map(c => ({
        ...c,
        _score:    c.compositeScore == null ? -1 : c.compositeScore,
        _onTime:   c.metrics.onTimePct      == null ? -1 : c.metrics.onTimePct,
        _defect:   c.metrics.defectRatePct  == null ? -1 : c.metrics.defectRatePct,
        _return:   c.metrics.returnRatePct  == null ? -1 : c.metrics.returnRatePct,
        _lead:     c.metrics.leadTimeAvgDays == null ? -999 : c.metrics.leadTimeAvgDays,
        _response: c.metrics.responseRate   == null ? -1 : c.metrics.responseRate,
        _wins:     c.metrics.winRate        == null ? -1 : c.metrics.winRate
    })), [filtered]);
    const { sortKey, sortDir, toggle, sortedRows } = useSortable(sortable, '_score', 'desc');

    // Top-line summary
    const summary = useMemo(() => {
        const measurable = cards.filter(c => c.compositeScore != null);
        const avgScore   = measurable.length === 0
            ? null
            : measurable.reduce((s, c) => s + c.compositeScore, 0) / measurable.length;
        const topPerformers = measurable.filter(c => c.compositeScore >= 80).length;
        const underperforms = measurable.filter(c => c.compositeScore < 60).length;
        return {
            total: cards.length,
            measured: measurable.length,
            avgScore,
            topPerformers,
            underperforms
        };
    }, [cards]);

    return (
        <>
            <PageHeader
                title="Vendor Scorecards"
                actions={
                    <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<Icon id="arrow-left" />}
                        onClick={() => navigateTo('vendors')}
                    >
                        Vendors
                    </Button>
                }
            />

            {/* KPI tiles */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
                <div className="bg-white p-3 rounded-panel shadow-card border border-line">
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Vendors</div>
                    <div className="text-2xl font-bold mt-1">{summary.total}</div>
                    <div className="text-xs text-gray-500 mt-1">{summary.measured} with measurable data</div>
                </div>
                <div className="bg-white p-3 rounded-panel shadow-card border border-line">
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Average Score</div>
                    <div className="text-2xl font-bold mt-1">{summary.avgScore == null ? '—' : Math.round(summary.avgScore)}</div>
                </div>
                <div className="bg-white p-3 rounded-panel shadow-card border border-line">
                    <div className="text-xs font-medium text-emerald-700 uppercase tracking-wide">Top Performers (≥80)</div>
                    <div className="text-2xl font-bold mt-1 text-emerald-700">{summary.topPerformers}</div>
                </div>
                <div className="bg-white p-3 rounded-panel shadow-card border border-line">
                    <div className="text-xs font-medium text-red-700 uppercase tracking-wide">Under-Performers (&lt;60)</div>
                    <div className="text-2xl font-bold mt-1 text-red-700">{summary.underperforms}</div>
                </div>
            </div>

            {/* Search */}
            <div className="bg-surface p-3 rounded-panel shadow-card border border-line mb-3">
                <div className="relative max-w-md">
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search vendor name, ID, or category…"
                        className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                    />
                    <Icon id="search" className="absolute left-2 top-2.5 text-gray-400 w-4 h-4" />
                </div>
            </div>

            {/* Table */}
            <div className="bg-surface p-4 rounded-panel shadow-card border border-line">
                {error && (
                    <div className="mb-3 p-3 rounded border border-red-200 bg-red-50 text-sm text-red-700">{error}</div>
                )}

                {loading ? (
                    <div className="text-center py-12 text-gray-500">
                        <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mr-2"></div>
                        Computing scorecards…
                    </div>
                ) : sortedRows.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                        {cards.length === 0
                            ? 'No vendors in the system. Add a vendor first.'
                            : 'No vendors match the current search.'}
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-3 py-2 text-left"><SortableHeader label="Vendor"   sortKey="vendorName" current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                                    <th className="px-3 py-2 text-left"><SortableHeader label="Category" sortKey="category"   current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                                    <th className="px-3 py-2 text-center"><SortableHeader label="Score"  sortKey="_score"     current={sortKey} dir={sortDir} onToggle={toggle} align="center" /></th>
                                    <th className="px-3 py-2 text-right"><SortableHeader label="On-Time" sortKey="_onTime"    current={sortKey} dir={sortDir} onToggle={toggle} align="right" /></th>
                                    <th className="px-3 py-2 text-right"><SortableHeader label="Defect" sortKey="_defect"    current={sortKey} dir={sortDir} onToggle={toggle} align="right" /></th>
                                    <th className="px-3 py-2 text-right"><SortableHeader label="Return" sortKey="_return"    current={sortKey} dir={sortDir} onToggle={toggle} align="right" /></th>
                                    <th className="px-3 py-2 text-right"><SortableHeader label="Avg Lead (days)" sortKey="_lead" current={sortKey} dir={sortDir} onToggle={toggle} align="right" /></th>
                                    <th className="px-3 py-2 text-right"><SortableHeader label="Response %" sortKey="_response" current={sortKey} dir={sortDir} onToggle={toggle} align="right" /></th>
                                    <th className="px-3 py-2 text-right"><SortableHeader label="Win %"    sortKey="_wins"     current={sortKey} dir={sortDir} onToggle={toggle} align="right" /></th>
                                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Receipts</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {sortedRows.map(c => {
                                    const noData = c.compositeScore == null && c.metrics.receiptCount === 0 && c.metrics.invites === 0;
                                    return (
                                        <tr key={c.vendorId} className="hover:bg-gray-50">
                                            <td className="px-3 py-2 text-sm font-medium text-gray-800">{c.vendorName}</td>
                                            <td className="px-3 py-2 text-sm text-gray-600">{c.category || '—'}</td>
                                            <td className="px-3 py-2 text-center">
                                                {noData ? (
                                                    <span className="text-xs text-gray-400 italic">No data</span>
                                                ) : (
                                                    <span className={`inline-block px-2.5 py-1 rounded-full text-sm font-bold ${scoreTone(c.compositeScore)}`}>
                                                        {c.compositeScore == null ? '—' : c.compositeScore}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-3 py-2 text-right text-sm font-mono">{fmtPct(c.metrics.onTimePct)}</td>
                                            <td className={`px-3 py-2 text-right text-sm font-mono ${c.metrics.defectRatePct > 0.05 ? 'text-red-600 font-semibold' : 'text-gray-700'}`}>
                                                {fmtPct(c.metrics.defectRatePct)}
                                            </td>
                                            <td className={`px-3 py-2 text-right text-sm font-mono ${c.metrics.returnRatePct > 0.02 ? 'text-amber-700 font-semibold' : 'text-gray-700'}`}>
                                                {fmtPct(c.metrics.returnRatePct)}
                                            </td>
                                            <td className="px-3 py-2 text-right text-sm font-mono">{fmtNum(c.metrics.leadTimeAvgDays)}</td>
                                            <td className="px-3 py-2 text-right text-sm font-mono">{fmtPct(c.metrics.responseRate)}</td>
                                            <td className="px-3 py-2 text-right text-sm font-mono">{fmtPct(c.metrics.winRate)}</td>
                                            <td className="px-3 py-2 text-right text-sm text-gray-600">{c.metrics.receiptCount}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <div className="mt-3 text-xs text-gray-500">
                <strong>How the composite score works:</strong> weighted blend of
                On-Time (30%), Defect-free (25%), Lead-time accuracy (20%),
                Return-free (10%), Response (10%), and Win rate (5%). Missing
                metrics drop out and the remaining weights re-normalise — so a
                new vendor with only an on-time figure is fairly scored on
                what we know about them.
            </div>
        </>
    );
};

export default VendorScorecard;
