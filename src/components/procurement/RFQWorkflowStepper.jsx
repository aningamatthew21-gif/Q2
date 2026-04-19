import React from 'react';
import Icon from '../common/Icon';

/**
 * Maps an RFQ status to a 0-based step index in the workflow.
 * 7 stages: 0=Create, 1=Invite, 2=Collect, 3=Evaluate, 4=Recommend, 5=Approve, 6=Awarded
 */
const STAGES = [
    { key: 'CREATE',    label: 'Create',     icon: 'pen-to-square', desc: 'Build the RFQ' },
    { key: 'INVITE',    label: 'Invite',     icon: 'envelope',      desc: 'Send to vendors' },
    { key: 'COLLECT',   label: 'Collect',    icon: 'inbox',         desc: 'Log responses' },
    { key: 'EVALUATE',  label: 'Evaluate',   icon: 'scale-balanced',desc: 'Compare offers' },
    { key: 'RECOMMEND', label: 'Recommend',  icon: 'lightbulb',     desc: 'Choose vendor' },
    { key: 'APPROVE',   label: 'Approve',    icon: 'user-check',    desc: 'Head sign-off' },
    { key: 'AWARDED',   label: 'Awarded',    icon: 'trophy',        desc: 'Cost pushed back' }
];

const statusToStep = (status) => {
    switch (status) {
        case 'DRAFT':              return 0;
        case 'SENT':               return 1;
        case 'RECEIVING':          return 2;
        case 'COMPARING':          return 3;
        case 'PENDING_APPROVAL':   return 5;
        case 'AWARDED':
        case 'CLOSED':             return 6;
        case 'CANCELLED':          return -1;
        default:                   return 0;
    }
};

const RFQWorkflowStepper = ({ status }) => {
    const activeStep = statusToStep(status);
    const cancelled = status === 'CANCELLED';

    if (cancelled) {
        return (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-6 flex items-center gap-3">
                <Icon id="ban" className="text-gray-500 text-2xl" />
                <div>
                    <p className="font-semibold text-gray-700">RFQ Cancelled</p>
                    <p className="text-xs text-gray-500">This sourcing request was cancelled and is no longer active.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 mb-6">
            <div className="flex items-start justify-between gap-2 overflow-x-auto">
                {STAGES.map((stage, idx) => {
                    const isComplete = idx < activeStep;
                    const isActive   = idx === activeStep;
                    const isPending  = idx > activeStep;

                    let circleClasses = 'bg-gray-200 text-gray-400 border-gray-200';
                    if (isComplete) circleClasses = 'bg-emerald-500 text-white border-emerald-500';
                    if (isActive)   circleClasses = 'bg-blue-600 text-white border-blue-600 ring-4 ring-blue-100';

                    return (
                        <React.Fragment key={stage.key}>
                            <div className="flex flex-col items-center min-w-[80px] text-center">
                                <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center transition-colors ${circleClasses}`}>
                                    {isComplete ? (
                                        <Icon id="check" className="text-sm" />
                                    ) : (
                                        <Icon id={stage.icon} className="text-sm" />
                                    )}
                                </div>
                                <p className={`mt-2 text-xs font-semibold ${isActive ? 'text-blue-700' : isComplete ? 'text-emerald-700' : 'text-gray-400'}`}>
                                    {stage.label}
                                </p>
                                <p className="text-[10px] text-gray-400 leading-tight mt-0.5 max-w-[90px]">{stage.desc}</p>
                            </div>
                            {idx < STAGES.length - 1 && (
                                <div className={`flex-1 h-1 mt-5 rounded-full min-w-[20px] ${idx < activeStep ? 'bg-emerald-400' : 'bg-gray-200'}`} />
                            )}
                        </React.Fragment>
                    );
                })}
            </div>
        </div>
    );
};

export default RFQWorkflowStepper;
