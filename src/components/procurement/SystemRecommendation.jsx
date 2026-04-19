import React, { useState } from 'react';
import Icon from '../common/Icon';

/**
 * Renders the multi-criteria recommendation panel for an RFQ.
 *
 * Props:
 *  - data:         the response from GET /api/rfqs/:id/recommendation
 *  - currency:     'GHS' | 'USD'
 *  - canAward:     boolean — show "Award to recommended" button
 *  - onAward:      (vendor) => void  — called with the recommended vendor object from rfq.vendors
 *  - rfqVendors:   rfq.vendors array (used to map vendorId back to a full vendor object for award)
 */
const ScoreBar = ({ label, value, weight }) => {
    const pct = Math.max(0, Math.min(100, value));
    const colour = pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-blue-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-400';
    return (
        <div className="text-xs">
            <div className="flex justify-between mb-1">
                <span className="text-gray-600">{label} <span className="text-gray-400">({weight}%)</span></span>
                <span className="font-mono text-gray-700">{value.toFixed(0)}</span>
            </div>
            <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div className={`h-full ${colour} transition-all`} style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
};

const SystemRecommendation = ({ data, currency = 'GHS', canAward = false, onAward, rfqVendors = [] }) => {
    const [expanded, setExpanded] = useState(false);

    if (!data) return null;
    if (!data.recommendedVendorId) {
        return (
            <div className="bg-white p-6 rounded-xl shadow-md border-l-4 border-gray-300">
                <div className="flex items-center gap-3">
                    <Icon id="lightbulb" className="text-2xl text-gray-400" />
                    <div>
                        <h3 className="font-semibold text-gray-700">System Recommendation</h3>
                        <p className="text-sm text-gray-500 mt-1">{data.summary || 'Awaiting vendor responses to generate a recommendation.'}</p>
                    </div>
                </div>
            </div>
        );
    }

    const winner = data.vendors.find(v => v.vendorId === data.recommendedVendorId);
    const fullVendor = rfqVendors.find(v => v.vendorId === data.recommendedVendorId);
    if (!winner) return null;

    const others = data.vendors.filter(v => v.vendorId !== data.recommendedVendorId);
    const fmtMoney = (n) => `${currency} ${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

    return (
        <div className="bg-gradient-to-br from-emerald-50 via-white to-blue-50 p-6 rounded-xl shadow-md border-l-4 border-emerald-500 mb-6">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                <div className="flex items-start gap-3 flex-1">
                    <div className="text-3xl mt-1">🏆</div>
                    <div className="flex-1">
                        <p className="text-xs text-emerald-700 uppercase tracking-wider font-semibold">System Recommendation</p>
                        <h3 className="text-xl font-bold text-gray-900 mt-1">{winner.vendorName}</h3>
                        <p className="text-sm text-gray-600 mt-1">{winner.recommendationReason}</p>
                        <div className="flex items-baseline gap-2 mt-3">
                            <span className="text-3xl font-bold text-emerald-600">{winner.weightedScore.toFixed(1)}</span>
                            <span className="text-sm text-gray-500">/ 100 weighted score</span>
                        </div>
                    </div>
                </div>
                {canAward && fullVendor && onAward && (
                    <button
                        onClick={() => onAward(fullVendor)}
                        className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg shadow-sm whitespace-nowrap"
                    >
                        <Icon id="trophy" className="mr-2" />Award to {winner.vendorName.split(' ')[0]}
                    </button>
                )}
            </div>

            {/* Score breakdown */}
            <div className="mt-5 grid grid-cols-1 md:grid-cols-5 gap-3 bg-white/60 rounded-lg p-4 border border-emerald-100">
                <ScoreBar label="Price"        value={winner.scores.price}        weight={data.weights.price} />
                <ScoreBar label="Lead Time"    value={winner.scores.leadTime}     weight={data.weights.leadTime} />
                <ScoreBar label="Rating"       value={winner.scores.rating}       weight={data.weights.rating} />
                <ScoreBar label="Pmt Terms"    value={winner.scores.paymentTerms} weight={data.weights.paymentTerms} />
                <ScoreBar label="Coverage"     value={winner.scores.coverage}     weight={data.weights.coverage} />
            </div>

            {/* Quick metrics row */}
            <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-2 text-xs text-gray-700">
                <div className="bg-white/80 rounded p-2 border border-gray-100">
                    <span className="block text-[10px] text-gray-500 uppercase">Total Cost</span>
                    <span className="font-semibold">{fmtMoney(winner.metrics.totalCost)}</span>
                </div>
                <div className="bg-white/80 rounded p-2 border border-gray-100">
                    <span className="block text-[10px] text-gray-500 uppercase">Lead Time</span>
                    <span className="font-semibold">{winner.metrics.avgLeadTime > 0 ? `${winner.metrics.avgLeadTime}d` : '—'}</span>
                </div>
                <div className="bg-white/80 rounded p-2 border border-gray-100">
                    <span className="block text-[10px] text-gray-500 uppercase">Rating</span>
                    <span className="font-semibold">{winner.metrics.rating > 0 ? `${winner.metrics.rating}/5` : '—'}</span>
                </div>
                <div className="bg-white/80 rounded p-2 border border-gray-100">
                    <span className="block text-[10px] text-gray-500 uppercase">Pmt Terms</span>
                    <span className="font-semibold">{winner.metrics.paymentTermsString || '—'}</span>
                </div>
                <div className="bg-white/80 rounded p-2 border border-gray-100">
                    <span className="block text-[10px] text-gray-500 uppercase">Coverage</span>
                    <span className="font-semibold">{winner.metrics.respondedCount}/{winner.metrics.totalLines} lines</span>
                </div>
            </div>

            {/* Compare with others */}
            {others.length > 0 && (
                <div className="mt-4">
                    <button
                        onClick={() => setExpanded(!expanded)}
                        className="text-xs text-emerald-700 hover:text-emerald-900 font-medium"
                    >
                        <Icon id={expanded ? 'chevron-up' : 'chevron-down'} className="mr-1" />
                        {expanded ? 'Hide' : 'Show'} comparison with {others.length} other vendor{others.length === 1 ? '' : 's'}
                    </button>
                    {expanded && (
                        <div className="mt-3 space-y-2">
                            {others.map(v => (
                                <div key={v.vendorId} className="bg-white/70 rounded-lg p-3 border border-gray-100 flex items-center justify-between gap-3">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium text-gray-800 truncate">{v.vendorName}</span>
                                            {!v.hasResponded && (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">No response</span>
                                            )}
                                        </div>
                                        <p className="text-[11px] text-gray-500 mt-0.5">{v.recommendationReason}</p>
                                        {v.hasResponded && (
                                            <p className="text-[11px] text-gray-600 mt-0.5">
                                                {fmtMoney(v.metrics.totalCost)} · {v.metrics.avgLeadTime}d · {v.metrics.respondedCount}/{v.metrics.totalLines} lines
                                            </p>
                                        )}
                                    </div>
                                    <div className="text-right">
                                        <div className="text-lg font-bold text-gray-700">{v.weightedScore.toFixed(1)}</div>
                                        <div className="text-[10px] text-gray-400">/100</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <p className="mt-3 text-[10px] text-gray-400 italic">
                Weights configurable in Procurement Settings. Recommendations are advisory — final award decision rests with the procurement officer.
            </p>
        </div>
    );
};

export default SystemRecommendation;
