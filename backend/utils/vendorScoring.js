'use strict';

/**
 * Vendor scoring engine — multi-criteria weighted scoring.
 *
 * Inputs:
 *   rfq.vendors[]    — { vendorId, vendorName, rating, leadTimeDays, ... }
 *   rfq.responses[]  — { vendorId, prId, unitCost, quantity, freight, leadTimeDays, paymentTerms, ... }
 *   rfq.lineItems[]  — { prId, itemName, quantity, ... }
 *   weights          — { price, leadTime, rating, paymentTerms, coverage }  (numbers, summed for normalization)
 *
 * Output:
 *   {
 *     weights,                    // normalized weights (echoed back)
 *     vendors: [
 *       {
 *         vendorId, vendorName,
 *         metrics: { totalCost, avgLeadTime, rating, paymentTermDays, coveragePct },
 *         scores:  { price, leadTime, rating, paymentTerms, coverage },  // each 0-100
 *         weightedScore,          // 0-100 final score
 *         recommendationReason    // human-readable string
 *       },
 *       ...
 *     ],
 *     recommendedVendorId,        // null if no responses
 *     summary                     // human-readable headline
 *   }
 */

const DEFAULT_WEIGHTS = {
    price: 50,
    leadTime: 20,
    rating: 15,
    paymentTerms: 10,
    coverage: 5
};

/**
 * Parse a payment-terms string like "Net 30", "Net 60", "Due on receipt", "30 days" into days.
 * Higher = better (more days of credit).
 */
function parsePaymentTermDays(terms) {
    if (!terms) return 0;
    const t = String(terms).toLowerCase().trim();
    if (/(due\s*on\s*receipt|cod|cash|advance|prepaid)/.test(t)) return 0;
    const match = t.match(/(\d+)/);
    if (match) return Number(match[1]);
    return 0;
}

function calculateVendorScores(rfq, weights = DEFAULT_WEIGHTS) {
    const safeWeights = {
        price:        Number(weights.price)        || 0,
        leadTime:     Number(weights.leadTime)     || 0,
        rating:       Number(weights.rating)       || 0,
        paymentTerms: Number(weights.paymentTerms) || 0,
        coverage:     Number(weights.coverage)     || 0
    };
    const weightSum = safeWeights.price + safeWeights.leadTime + safeWeights.rating + safeWeights.paymentTerms + safeWeights.coverage;

    const vendors = rfq.vendors || [];
    const responses = rfq.responses || [];
    const lineItems = rfq.lineItems || [];
    const totalLines = lineItems.length;

    // Step 1: gather per-vendor metrics
    const vendorMetrics = vendors.map(v => {
        const vRespons = responses.filter(r => r.vendorId === v.vendorId);
        const totalCost = vRespons.reduce((sum, r) => {
            const lineTotal = (Number(r.unitCost) || 0) * (Number(r.quantity) || 0) + (Number(r.freight) || 0);
            return sum + lineTotal;
        }, 0);

        const leadTimes = vRespons.map(r => Number(r.leadTimeDays)).filter(n => n > 0);
        const avgLeadTime = leadTimes.length
            ? leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length
            : (Number(v.leadTimeDays) || 0);

        // Use the first non-empty payment term across this vendor's responses
        const ptString = (vRespons.find(r => r.paymentTerms)?.paymentTerms) || '';
        const paymentTermDays = parsePaymentTermDays(ptString);

        const respondedPrs = new Set(vRespons.map(r => r.prId));
        const respondedCount = lineItems.filter(li => respondedPrs.has(li.prId)).length;
        const coveragePct = totalLines > 0 ? (respondedCount / totalLines) * 100 : 0;

        return {
            vendor: v,
            totalCost,
            avgLeadTime,
            rating: Number(v.rating) || 0,
            paymentTermDays,
            paymentTermsString: ptString,
            coveragePct,
            respondedCount,
            hasResponded: vRespons.length > 0
        };
    });

    // Step 2: find baselines for normalisation
    const respondedVendors = vendorMetrics.filter(m => m.hasResponded && m.totalCost > 0);
    const lowestCost   = respondedVendors.length ? Math.min(...respondedVendors.map(m => m.totalCost)) : 0;
    const fastestLead  = respondedVendors.filter(m => m.avgLeadTime > 0).length
        ? Math.min(...respondedVendors.filter(m => m.avgLeadTime > 0).map(m => m.avgLeadTime))
        : 0;
    const longestPmt   = Math.max(0, ...vendorMetrics.map(m => m.paymentTermDays));

    // Step 3: compute per-criterion scores (0-100) and the weighted composite
    const scored = vendorMetrics.map(m => {
        const priceScore     = (m.hasResponded && m.totalCost > 0 && lowestCost > 0)   ? (lowestCost / m.totalCost) * 100 : 0;
        const leadTimeScore  = (m.avgLeadTime > 0 && fastestLead > 0)                  ? (fastestLead / m.avgLeadTime) * 100 : (m.hasResponded ? 50 : 0);
        const ratingScore    = (m.rating / 5) * 100;
        const paymentScore   = (longestPmt > 0)                                         ? (m.paymentTermDays / longestPmt) * 100 : 0;
        const coverageScore  = m.coveragePct;

        const weightedScore = weightSum > 0
            ? (
                priceScore    * safeWeights.price        +
                leadTimeScore * safeWeights.leadTime     +
                ratingScore   * safeWeights.rating       +
                paymentScore  * safeWeights.paymentTerms +
                coverageScore * safeWeights.coverage
              ) / weightSum
            : 0;

        // Build a human reason
        const strengths = [];
        if (priceScore     >= 95) strengths.push('lowest total cost');
        if (leadTimeScore  >= 95) strengths.push('fastest lead time');
        if (ratingScore    >= 80) strengths.push('high vendor rating');
        if (paymentScore   >= 95) strengths.push('best payment terms');
        if (coverageScore  >= 100) strengths.push('full line coverage');
        const reason = strengths.length
            ? `Wins on: ${strengths.join(', ')}`
            : (m.hasResponded ? 'Balanced score across criteria' : 'No response received');

        return {
            vendorId: m.vendor.vendorId,
            vendorName: m.vendor.vendorName,
            metrics: {
                totalCost: Number(m.totalCost.toFixed(2)),
                avgLeadTime: Number(m.avgLeadTime.toFixed(1)),
                rating: Number(m.rating.toFixed(1)),
                paymentTermDays: m.paymentTermDays,
                paymentTermsString: m.paymentTermsString,
                coveragePct: Number(m.coveragePct.toFixed(1)),
                respondedCount: m.respondedCount,
                totalLines
            },
            scores: {
                price:        Number(priceScore.toFixed(1)),
                leadTime:     Number(leadTimeScore.toFixed(1)),
                rating:       Number(ratingScore.toFixed(1)),
                paymentTerms: Number(paymentScore.toFixed(1)),
                coverage:     Number(coverageScore.toFixed(1))
            },
            weightedScore: Number(weightedScore.toFixed(1)),
            recommendationReason: reason,
            hasResponded: m.hasResponded
        };
    });

    // Step 4: pick winner — the responding vendor with the highest weighted score
    const eligible = scored.filter(s => s.hasResponded);
    eligible.sort((a, b) => b.weightedScore - a.weightedScore);
    const winner = eligible[0] || null;

    // Sort full output by score desc for UI rendering
    scored.sort((a, b) => b.weightedScore - a.weightedScore);

    let summary = 'No vendors have responded yet.';
    if (winner) {
        summary = `${winner.vendorName} scores highest (${winner.weightedScore}/100). ${winner.recommendationReason}.`;
    }

    return {
        weights: safeWeights,
        vendors: scored,
        recommendedVendorId: winner ? winner.vendorId : null,
        summary
    };
}

module.exports = {
    calculateVendorScores,
    parsePaymentTermDays,
    DEFAULT_WEIGHTS
};
