import React from 'react';
import Icon from '../common/Icon';

/**
 * Per-vendor card surfacing response state with prominent log/edit/remind actions.
 *
 * Props:
 *  - vendor:     { vendorId, vendorName, vendorEmail }
 *  - responses:  array of response rows for this vendor (may be empty)
 *  - lineCount:  total number of line items expected per vendor
 *  - deadline:   RFQ submission deadline (ISO string)
 *  - canManage:  boolean — show action buttons
 *  - onLog:      handler() to open log-response modal for this vendor
 *  - onEdit:     handler() to open editing flow
 *  - onRemind:   handler() to open mailto reminder draft
 */
const VendorResponseCard = ({ vendor, responses = [], lineCount = 0, deadline, canManage, onLog, onEdit, onRemind }) => {
    const hasResponded = responses.length > 0;
    const fullyResponded = lineCount > 0 && responses.length >= lineCount;
    const partiallyResponded = hasResponded && !fullyResponded;

    const pastDeadline = deadline && new Date(deadline) < new Date();
    const overdueAndSilent = pastDeadline && !hasResponded;

    let badge, borderClass, iconId, iconClass;
    if (overdueAndSilent) {
        badge = { label: 'Past Deadline · No Response', cls: 'bg-red-100 text-red-700' };
        borderClass = 'border-red-300 bg-red-50/40';
        iconId = 'exclamation-triangle';
        iconClass = 'text-red-500';
    } else if (fullyResponded) {
        badge = { label: 'Responded', cls: 'bg-emerald-100 text-emerald-700' };
        borderClass = 'border-emerald-300 bg-emerald-50/40';
        iconId = 'circle-check';
        iconClass = 'text-emerald-500';
    } else if (partiallyResponded) {
        badge = { label: `Partial (${responses.length}/${lineCount})`, cls: 'bg-amber-100 text-amber-700' };
        borderClass = 'border-amber-300 bg-amber-50/40';
        iconId = 'hourglass-half';
        iconClass = 'text-amber-500';
    } else {
        badge = { label: 'Awaiting Response', cls: 'bg-gray-100 text-gray-600' };
        borderClass = 'border-gray-200 bg-white';
        iconId = 'paper-plane';
        iconClass = 'text-gray-400';
    }

    // Compute totals for responded vendors
    const totalCost = responses.reduce((sum, r) => sum + (Number(r.unitCost) || 0) * (Number(r.quantity) || 1), 0);
    const totalFreight = responses.reduce((sum, r) => sum + (Number(r.freightCost) || 0), 0);
    const grandTotal = totalCost + totalFreight;

    // Average lead time across responded lines
    const leadTimes = responses.map(r => Number(r.leadTimeDays)).filter(n => !isNaN(n) && n > 0);
    const avgLeadTime = leadTimes.length ? Math.round(leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length) : null;

    // Earliest response timestamp
    const earliestResponse = responses
        .map(r => r.respondedAt)
        .filter(Boolean)
        .sort()[0];

    return (
        <div className={`rounded-xl border-2 p-4 transition-all ${borderClass}`}>
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className={`w-10 h-10 rounded-full bg-white border flex items-center justify-center flex-shrink-0`}>
                        <Icon id={iconId} className={iconClass} />
                    </div>
                    <div className="min-w-0">
                        <p className="font-semibold text-gray-900 truncate">{vendor.vendorName || 'Unnamed Vendor'}</p>
                        {vendor.vendorEmail && (
                            <p className="text-xs text-gray-500 truncate">{vendor.vendorEmail}</p>
                        )}
                    </div>
                </div>
                <span className={`text-[10px] px-2 py-1 rounded-full font-medium whitespace-nowrap ${badge.cls}`}>
                    {badge.label}
                </span>
            </div>

            {hasResponded ? (
                <div className="mt-3 grid grid-cols-3 gap-2 text-center bg-white/70 rounded-lg p-2 border border-gray-100">
                    <div>
                        <p className="text-[10px] text-gray-500 uppercase tracking-wide">Total</p>
                        <p className="text-sm font-bold text-gray-800">GHS {grandTotal.toFixed(2)}</p>
                    </div>
                    <div>
                        <p className="text-[10px] text-gray-500 uppercase tracking-wide">Lead Time</p>
                        <p className="text-sm font-bold text-gray-800">{avgLeadTime ? `${avgLeadTime}d` : '—'}</p>
                    </div>
                    <div>
                        <p className="text-[10px] text-gray-500 uppercase tracking-wide">Lines</p>
                        <p className="text-sm font-bold text-gray-800">{responses.length}/{lineCount || '?'}</p>
                    </div>
                </div>
            ) : (
                <div className="mt-3 text-xs text-gray-500 italic px-2">
                    {pastDeadline
                        ? 'No reply received before the submission deadline.'
                        : 'Vendor has not yet provided pricing.'}
                </div>
            )}

            {earliestResponse && (
                <p className="mt-2 text-[10px] text-gray-400">
                    First response: {new Date(earliestResponse).toLocaleString()}
                </p>
            )}

            {canManage && (
                <div className="mt-3 flex flex-wrap gap-2">
                    {!hasResponded && onLog && (
                        <button
                            onClick={onLog}
                            className="flex-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-md"
                        >
                            <Icon id="pen-to-square" className="mr-1" /> Log Response
                        </button>
                    )}
                    {hasResponded && onEdit && (
                        <button
                            onClick={onEdit}
                            className="flex-1 px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-800 text-xs font-medium rounded-md"
                        >
                            <Icon id="pen" className="mr-1" /> Edit
                        </button>
                    )}
                    {!hasResponded && onRemind && vendor.vendorEmail && (
                        <button
                            onClick={onRemind}
                            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md border ${overdueAndSilent ? 'bg-red-600 hover:bg-red-700 text-white border-red-600' : 'bg-white hover:bg-gray-50 text-gray-700 border-gray-300'}`}
                            title={`Send a reminder email to ${vendor.vendorEmail}`}
                        >
                            <Icon id="envelope" className="mr-1" /> Send Reminder
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

export default VendorResponseCard;
