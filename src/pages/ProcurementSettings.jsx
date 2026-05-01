import React, { useState, useEffect } from 'react';
import api from '../api';
import Icon from '../components/common/Icon';
import PageHeader from '../components/common/PageHeader';
import Button from '../components/common/Button';
import Notification from '../components/common/Notification';

const SETTING_META = {
    highValueThreshold: {
        label: 'High-Value Approval Threshold (GHS)',
        type: 'number',
        help: 'RFQ awards above this amount require controller approval. Set to 0 to disable.'
    },
    minVendorsPerRFQ: {
        label: 'Minimum Vendors per RFQ',
        type: 'number',
        help: 'Recommended minimum number of vendors to invite per RFQ.'
    },
    defaultRFQDeadlineDays: {
        label: 'Default RFQ Deadline (days)',
        type: 'number',
        help: 'Default number of days from RFQ creation to submission deadline.'
    },
    enableProcurementModule: {
        label: 'Enable Procurement Module',
        type: 'toggle',
        help: 'Master switch for the procurement workflow. When off, PRs are still created but no RFQs can be initiated.'
    },
    reapprovalVarianceThreshold: {
        label: 'Re-Approval Variance Threshold (%)',
        type: 'number',
        help: 'When sourcing changes an invoice total by more than this percentage of the original estimate, the invoice is flagged for re-approval before going to the customer. Best-practice default: 10%.'
    },
    stalenessEscalationDays: {
        label: 'RFQ Escalation Threshold (days)',
        type: 'number',
        help: 'Active RFQs (SENT / RECEIVING / COMPARING) older than this many days are automatically escalated to the procurement head by the background watcher. Best-practice default: 7 days.'
    },
    procurementHeadEmail: {
        label: 'Procurement Head Email',
        type: 'text',
        help: 'Email of the procurement head who receives escalation notifications. Leave blank to suppress the outbound notification while still flagging the RFQ.'
    }
};

// Multi-criteria scoring weights (Phase 2). All values are relative — the system normalises by their sum.
const WEIGHT_META = {
    scoreWeightPrice:        { label: 'Price',         help: 'How much the lowest total cost matters.' },
    scoreWeightLeadTime:     { label: 'Lead Time',     help: 'How much faster delivery matters.' },
    scoreWeightRating:       { label: 'Vendor Rating', help: 'How much the historical vendor rating matters.' },
    scoreWeightPaymentTerms: { label: 'Payment Terms', help: 'How much longer credit terms matter (e.g. Net 60 vs Net 30).' },
    scoreWeightCoverage:     { label: 'Line Coverage', help: 'How much it matters that the vendor quoted on every line.' }
};

const ProcurementSettings = ({ navigateTo, currentUser }) => {
    const [settings, setSettings] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [notification, setNotification] = useState(null);
    const [dirty, setDirty] = useState({});

    const role = currentUser?.role;
    const backPage = role === 'procurement' ? 'procurementDashboard' : 'controllerDashboard';

    useEffect(() => {
        const fetch = async () => {
            try {
                const res = await api.get('/procurement-settings');
                if (res.success) setSettings(res.data || {});
            } catch (err) {
                setNotification({ type: 'error', message: 'Failed to load settings.' });
            } finally {
                setLoading(false);
            }
        };
        fetch();
    }, []);

    const handleChange = (key, value) => {
        setDirty(prev => ({ ...prev, [key]: value }));
    };

    const getValue = (key) => {
        if (dirty[key] !== undefined) return dirty[key];
        return settings[key]?.value || '';
    };

    const handleSave = async () => {
        if (Object.keys(dirty).length === 0) return;
        setSaving(true);
        try {
            const res = await api.put('/procurement-settings', dirty);
            if (res.success) {
                // Merge dirty into settings
                const updated = { ...settings };
                for (const [k, v] of Object.entries(dirty)) {
                    updated[k] = { ...updated[k], value: v };
                }
                setSettings(updated);
                setDirty({});
                setNotification({ type: 'success', message: 'Settings saved.' });
            }
        } catch (err) {
            setNotification({ type: 'error', message: 'Failed to save settings.' });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-24">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-4 border-primary"></div>
            </div>
        );
    }

    return (
        <>
            {notification && (
                <Notification message={notification.message} type={notification.type} onDismiss={() => setNotification(null)} />
            )}

            <PageHeader
                title="Procurement Settings"
                actions={
                    <Button variant="ghost" size="sm" onClick={() => navigateTo(backPage)} leftIcon={<Icon id="arrow-left" />}>
                        Back
                    </Button>
                }
            />

            <div className="bg-surface p-6 rounded-panel shadow-card border border-line space-y-6">
                    <h2 className="text-base font-semibold text-gray-800 border-b pb-2">General</h2>
                    {Object.entries(SETTING_META).map(([key, meta]) => {
                        const value = getValue(key);
                        return (
                            <div key={key} className="border-b pb-4 last:border-b-0">
                                <label className="block text-sm font-medium text-gray-800 mb-1">{meta.label}</label>
                                <p className="text-xs text-gray-500 mb-2">{meta.help}</p>
                                {meta.type === 'toggle' ? (
                                    <button
                                        onClick={() => handleChange(key, value === 'true' ? 'false' : 'true')}
                                        className={`relative inline-flex items-center h-7 w-12 rounded-full transition-colors ${
                                            value === 'true' ? 'bg-blue-600' : 'bg-gray-300'
                                        }`}
                                    >
                                        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                                            value === 'true' ? 'translate-x-6' : 'translate-x-1'
                                        }`} />
                                    </button>
                                ) : meta.type === 'text' ? (
                                    <input
                                        type="text"
                                        value={value}
                                        onChange={(e) => handleChange(key, e.target.value)}
                                        placeholder={meta.placeholder || ''}
                                        className="w-72 p-2 border rounded-md text-sm"
                                    />
                                ) : (
                                    <input
                                        type="number"
                                        min="0"
                                        value={value}
                                        onChange={(e) => handleChange(key, e.target.value)}
                                        className="w-48 p-2 border rounded-md text-sm"
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>

            {/* Vendor Scoring Weights Card */}
            <div className="bg-surface p-6 rounded-panel shadow-card border border-line space-y-4 mt-6">
                    <div className="border-b pb-2">
                        <h2 className="text-base font-semibold text-gray-800">Vendor Scoring Weights</h2>
                        <p className="text-xs text-gray-500 mt-1">
                            Tune how the system ranks vendor responses. Weights are relative — the system normalises by their sum, so a weight of 50 with the others at 10 means Price counts 5× more than each other criterion.
                        </p>
                    </div>

                    {(() => {
                        const weightSum = Object.keys(WEIGHT_META).reduce((acc, k) => acc + (Number(getValue(k)) || 0), 0);
                        return (
                            <>
                                {Object.entries(WEIGHT_META).map(([key, meta]) => {
                                    const raw = Number(getValue(key)) || 0;
                                    const pct = weightSum > 0 ? (raw / weightSum) * 100 : 0;
                                    return (
                                        <div key={key} className="border-b pb-4 last:border-b-0">
                                            <div className="flex items-center justify-between mb-1">
                                                <label className="text-sm font-medium text-gray-800">{meta.label}</label>
                                                <span className="text-xs text-gray-500">
                                                    Weight <strong>{raw}</strong> · effective <strong>{pct.toFixed(1)}%</strong>
                                                </span>
                                            </div>
                                            <p className="text-xs text-gray-500 mb-2">{meta.help}</p>
                                            <div className="flex items-center gap-3">
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="100"
                                                    value={raw}
                                                    onChange={(e) => handleChange(key, e.target.value)}
                                                    className="flex-1 accent-blue-600"
                                                />
                                                <input
                                                    type="number"
                                                    min="0"
                                                    max="100"
                                                    value={raw}
                                                    onChange={(e) => handleChange(key, e.target.value)}
                                                    className="w-20 p-1.5 border rounded-md text-sm text-right"
                                                />
                                            </div>
                                            <div className="h-1.5 bg-gray-100 rounded-full mt-2 overflow-hidden">
                                                <div className="h-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
                                            </div>
                                        </div>
                                    );
                                })}

                                {weightSum === 0 && (
                                    <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-800">
                                        <Icon id="exclamation-triangle" className="mr-1" />
                                        All weights are zero — the recommendation engine will pick arbitrarily. Set at least one weight above 0.
                                    </div>
                                )}
                                <div className="text-xs text-gray-500 text-right">
                                    Total weight: <strong>{weightSum}</strong>
                                </div>
                            </>
                        );
                    })()}
                </div>

            <div className="flex justify-end mt-6">
                <Button
                    variant="primary"
                    onClick={handleSave}
                    disabled={Object.keys(dirty).length === 0 || saving}
                >
                    {saving ? 'Saving…' : 'Save All Settings'}
                </Button>
            </div>
        </>
    );
};

export default ProcurementSettings;
