import React from 'react';
import Icon from '../common/Icon';

/**
 * Contextual hint banner that tells the user what to do next based on RFQ state.
 * Renders nothing if no action applies (e.g. terminal states for non-managers).
 */
const NextActionBanner = ({ rfq, canManage, onLogResponse, onAward, onSend, onPreviewPdfs, vendorCount = 0, responseCount = 0 }) => {
    if (!rfq) return null;

    const status = rfq.status;
    const allResponded = vendorCount > 0 && responseCount >= vendorCount;
    const someResponded = responseCount > 0;

    let config = null;

    if (status === 'DRAFT' && canManage) {
        config = {
            tone: 'amber',
            icon: 'paper-plane',
            title: 'Ready to send?',
            body: `This RFQ is still a draft. Once you send it, the ${vendorCount || 'invited'} vendor${vendorCount === 1 ? '' : 's'} will receive your request and you can begin collecting their offers.`,
            cta: onSend ? { label: 'Send to Vendors', handler: onSend } : null
        };
    } else if (status === 'SENT' && canManage) {
        config = {
            tone: 'blue',
            icon: 'inbox',
            title: 'Awaiting vendor responses',
            body: `Your RFQ has been sent to ${vendorCount} vendor${vendorCount === 1 ? '' : 's'}. As soon as a vendor calls or emails back with their pricing, log their response below — the system will automatically score and rank them for you.`,
            cta: onLogResponse ? { label: 'Log a Vendor Response', handler: onLogResponse } : null
        };
    } else if (status === 'RECEIVING' && canManage) {
        const remaining = Math.max(0, vendorCount - responseCount);
        config = {
            tone: 'blue',
            icon: 'inbox',
            title: `${responseCount} of ${vendorCount} vendors have responded`,
            body: remaining > 0
                ? `Keep logging responses as vendors get back to you. ${remaining} vendor${remaining === 1 ? ' is' : 's are'} still pending.`
                : 'All vendors have replied. Move on to evaluating their offers.',
            cta: onLogResponse ? { label: 'Log Another Response', handler: onLogResponse } : null
        };
    } else if (status === 'COMPARING' && canManage) {
        config = {
            tone: 'purple',
            icon: 'scale-balanced',
            title: 'Time to choose a winner',
            body: 'All vendor offers are in. Review the comparison matrix below — the system will recommend the best vendor based on price, lead time, rating and payment terms. You can accept the recommendation or override it.',
            cta: onAward ? { label: 'Award & Recommend', handler: onAward } : null
        };
    } else if (status === 'PENDING_APPROVAL') {
        config = {
            tone: 'amber',
            icon: 'user-check',
            title: 'Awaiting Procurement Head approval',
            body: 'A vendor has been recommended and the award is pending sign-off from the Procurement Head. No further action is needed from you until they review.',
            cta: null
        };
    } else if (status === 'AWARDED' || status === 'CLOSED') {
        config = {
            tone: 'emerald',
            icon: 'trophy',
            title: 'Award complete',
            body: 'A vendor has been awarded and the cost has been pushed back into the originating quote. You can download the official award letter PDF below to send to the winning vendor.',
            cta: onPreviewPdfs ? { label: 'Preview / Download PDFs', handler: onPreviewPdfs } : null
        };
    }

    if (!config) return null;

    const toneClasses = {
        amber:   'bg-amber-50 border-amber-300 text-amber-900',
        blue:    'bg-blue-50 border-blue-300 text-blue-900',
        purple:  'bg-purple-50 border-purple-300 text-purple-900',
        emerald: 'bg-emerald-50 border-emerald-300 text-emerald-900',
        gray:    'bg-gray-50 border-gray-300 text-gray-900'
    };
    const ctaToneClasses = {
        amber:   'bg-amber-600 hover:bg-amber-700',
        blue:    'bg-blue-600 hover:bg-blue-700',
        purple:  'bg-purple-600 hover:bg-purple-700',
        emerald: 'bg-emerald-600 hover:bg-emerald-700',
        gray:    'bg-gray-600 hover:bg-gray-700'
    };

    return (
        <div className={`border rounded-xl p-4 mb-6 flex flex-col md:flex-row md:items-center gap-4 ${toneClasses[config.tone]}`}>
            <div className="flex items-start gap-3 flex-1">
                <Icon id={config.icon} className="text-2xl mt-1" />
                <div>
                    <p className="font-semibold">{config.title}</p>
                    <p className="text-sm opacity-90 mt-0.5">{config.body}</p>
                </div>
            </div>
            {config.cta && (
                <button
                    onClick={config.cta.handler}
                    className={`px-4 py-2 rounded-lg text-white text-sm font-medium whitespace-nowrap shadow-sm ${ctaToneClasses[config.tone]}`}
                >
                    {config.cta.label} <Icon id="arrow-right" className="ml-1" />
                </button>
            )}
        </div>
    );
};

export default NextActionBanner;
