import React, { useState, useEffect, useMemo } from 'react';
import api from '../api';
import Icon from '../components/common/Icon';
import PageHeader from '../components/common/PageHeader';
import Button from '../components/common/Button';
import Notification from '../components/common/Notification';
import TargetsSettings from '../components/settings/TargetsSettings';
import SignaturesSettings from '../components/settings/SignaturesSettings';
import PriceListSettings from '../components/settings/PriceListSettings';
import CompanyDataSettings from '../components/settings/CompanyDataSettings';
import WhtSettings from '../components/settings/WhtSettings';

import { useActivityLog } from '../hooks/useActivityLog';
import { usePrompt } from '../components/v2/PromptDialog';
import { can } from '../utils/permissions';

const TaxSettings = ({ navigateTo, userId, currentUser }) => {
    const { askConfirm } = usePrompt();
    const { log } = useActivityLog();
    const [taxes, setTaxes] = useState([]);
    const [notification, setNotification] = useState(null);
    const [activeTab, setActiveTab] = useState('taxes');

    // --- Exchange Rate Settings State ---
    const [rateMonth, setRateMonth] = useState(() => {
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        return `${now.getFullYear()}-${month}`;
    });
    const [usdToGhs, setUsdToGhs] = useState('');
    const [ratesLoading, setRatesLoading] = useState(true);
    const [ratesHistory, setRatesHistory] = useState([]);
    const [showRatesTable, setShowRatesTable] = useState(false);

    const currentMonthKey = useMemo(() => {
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        return `${now.getFullYear()}-${month}`;
    }, []);

    const currentMonthRate = useMemo(() => {
        const found = ratesHistory.find(r => r.month === currentMonthKey);
        return found ? Number(found.usdToGhs) : null;
    }, [ratesHistory, currentMonthKey]);

    // --- Load Exchange Rates History ---
    useEffect(() => {
        const fetchRates = async () => {
            try {
                const response = await api.get('/settings/exchangeRates');
                if (response.success && response.data) {
                    const list = response.data.rates || [];
                    setRatesHistory(list.sort((a, b) => (a.month > b.month ? -1 : 1)));
                    const current = list.find(r => r.month === rateMonth);
                    if (current && typeof current.usdToGhs === 'number') {
                        setUsdToGhs(String(current.usdToGhs));
                    }
                }
                setRatesLoading(false);
            } catch (err) {
                console.error('Error fetching FX rates:', err);
                setRatesLoading(false);
            }
        };
        fetchRates();
    }, [rateMonth]);

    const handleSaveExchangeRate = async () => {
        try {
            const numericRate = parseFloat(usdToGhs);
            if (!rateMonth || isNaN(numericRate) || numericRate <= 0) {
                setNotification({ type: 'error', message: 'Enter a valid month and positive rate.' });
                return;
            }

            const existing = ratesHistory.find(r => r.month === rateMonth);
            let updatedRates;
            if (existing) {
                updatedRates = ratesHistory.map(r => r.month === rateMonth ? { ...r, usdToGhs: numericRate, updatedAt: new Date().toISOString(), updatedBy: userId } : r);
            } else {
                const newEntry = { id: Date.now().toString(), month: rateMonth, usdToGhs: numericRate, createdAt: new Date().toISOString(), createdBy: userId };
                updatedRates = [...ratesHistory, newEntry];
            }

            updatedRates.sort((a, b) => (a.month > b.month ? -1 : 1));

            await api.post('/settings/exchangeRates', { rates: updatedRates });

            await log('SETTINGS_CHANGE', `Updated exchange rate for ${rateMonth} to ${numericRate}`, {
                category: 'settings',
                settingType: 'exchange_rate'
            });

            setRatesHistory(updatedRates);
            setNotification({ type: 'success', message: 'Exchange rate saved successfully.' });
        } catch (error) {
            // Surface the real backend error (status + message) so a 403,
            // SQL constraint, or validation failure is actionable rather
            // than the previous generic "Failed to save…" toast.
            const status    = error?.response?.status;
            const serverMsg = error?.response?.data?.error
                           || error?.response?.statusText
                           || error?.message
                           || 'Unknown error';
            console.error('handleSaveExchangeRate failed:', { status, error });
            setNotification({
                type: 'error',
                message: status
                    ? `Failed to save exchange rate (HTTP ${status}): ${serverMsg}`
                    : `Failed to save exchange rate: ${serverMsg}`
            });
        }
    };

    // --- Tax Logic ---
    useEffect(() => {
        const fetchTaxes = async () => {
            try {
                const response = await api.get('/settings/taxes');
                if (response.success && response.data && response.data.taxArray && response.data.taxArray.length > 0) {
                    setTaxes(response.data.taxArray);
                } else {
                    const initialTaxes = [
                        { id: 'vat', name: 'VAT Standard', rate: 15.0, enabled: true, on: 'levyTotal' },
                        { id: 'nhil', name: 'NHIL', rate: 2.5, enabled: true, on: 'subtotal' },
                        { id: 'getfund', name: 'GETFund', rate: 2.5, enabled: true, on: 'subtotal' },
                        { id: 'covid19', name: 'COVID-19 Levy', rate: 1.0, enabled: true, on: 'levyTotal' }
                    ];
                    setTaxes(initialTaxes);
                }
            } catch (err) {
                console.error('Error fetching taxes:', err);
            }
        };
        fetchTaxes();
    }, []);

    const handleTaxChange = (id, field, value) => {
        setTaxes(currentTaxes =>
            currentTaxes.map(t => {
                if (t.id === id) {
                    // Logic for Unified Counting / Limits
                    if (field === 'rate') {
                        let numVal = parseFloat(value);
                        if (isNaN(numVal) || numVal < 0) numVal = 0; // Stop negative
                        return { ...t, [field]: numVal };
                    }
                    return { ...t, [field]: value };
                }
                return t;
            })
        );
    };

    const handleAddTax = () => {
        const newTax = {
            id: `tax_${Date.now()}`,
            name: 'New Tax',
            rate: 0,
            enabled: true,
            on: 'levyTotal' // Default to applying on the total
        };
        setTaxes([...taxes, newTax]);
    };

    const handleDeleteTax = async (id) => {
        const ok = await askConfirm({
            title:        'Delete this tax?',
            description:  'Removes the tax from the configured list. The change is staged — click Save to persist.',
            confirmLabel: 'Delete tax',
            confirmTone:  'danger'
        });
        if (ok) setTaxes(taxes.filter(t => t.id !== id));
    };

    const handleSaveChanges = async () => {
        try {
            await api.post('/settings/taxes', { taxArray: taxes });
            await log('SETTINGS_CHANGE', `Updated Tax Settings: ${taxes.length} taxes configured`, { category: 'settings' });
            setNotification({ type: 'success', message: 'Tax settings saved successfully!' });
        } catch (error) {
            // Surface the real backend error (status + message) so a 403,
            // SQL constraint, or validation failure is actionable rather
            // than the previous generic "Failed to save…" toast. This was
            // the diagnostic gap that triggered the original bug report —
            // the user couldn't tell whether they were hitting a role
            // guard, a schema drift, or a network failure.
            const status    = error?.response?.status;
            const serverMsg = error?.response?.data?.error
                           || error?.response?.statusText
                           || error?.message
                           || 'Unknown error';
            console.error('Save taxes failed:', { status, error });
            setNotification({
                type: 'error',
                message: status
                    ? `Failed to save settings (HTTP ${status}): ${serverMsg}`
                    : `Failed to save settings: ${serverMsg}`
            });
        }
    };

    return (
        <>
            {notification && <Notification message={notification.message} type={notification.type} onDismiss={() => setNotification(null)} />}
            <PageHeader
                title="System Settings"
                actions={
                    <>
                        {currentUser && currentUser.role === 'controller' && (
                            <Button variant="ghost" size="sm" onClick={() => navigateTo('controllerDashboard')} leftIcon={<Icon id="arrow-left" />}>
                                Back to Dashboard
                            </Button>
                        )}
                        {currentUser && currentUser.role === 'sales' && (
                            <Button variant="ghost" size="sm" onClick={() => navigateTo('salesDashboard')} leftIcon={<Icon id="arrow-left" />}>
                                Back to Sales
                            </Button>
                        )}
                    </>
                }
            />

                {/* Tab Navigation */}
                <div className="flex space-x-4 mb-6 border-b border-gray-200 pb-1 overflow-x-auto">
                    <button onClick={() => setActiveTab('taxes')} className={`py-2 px-4 font-medium text-sm rounded-t-lg whitespace-nowrap ${activeTab === 'taxes' ? 'bg-white border-t border-l border-r border-gray-200 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>Tax & Rates</button>
                    {can(currentUser, 'wht.config.edit') && (
                        <button onClick={() => setActiveTab('wht')} className={`py-2 px-4 font-medium text-sm rounded-t-lg whitespace-nowrap ${activeTab === 'wht' ? 'bg-white border-t border-l border-r border-gray-200 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>Withholding Taxes</button>
                    )}
                    <button onClick={() => setActiveTab('signatures')} className={`py-2 px-4 font-medium text-sm rounded-t-lg whitespace-nowrap ${activeTab === 'signatures' ? 'bg-white border-t border-l border-r border-gray-200 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>Signatures</button>
                    <button onClick={() => setActiveTab('pricelist')} className={`py-2 px-4 font-medium text-sm rounded-t-lg whitespace-nowrap ${activeTab === 'pricelist' ? 'bg-white border-t border-l border-r border-gray-200 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>Price List</button>
                    <button onClick={() => setActiveTab('targets')} className={`py-2 px-4 font-medium text-sm rounded-t-lg whitespace-nowrap ${activeTab === 'targets' ? 'bg-white border-t border-l border-r border-gray-200 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>Revenue Targets</button>
                    <button onClick={() => setActiveTab('companyData')} className={`py-2 px-4 font-medium text-sm rounded-t-lg whitespace-nowrap ${activeTab === 'companyData' ? 'bg-white border-t border-l border-r border-gray-200 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>Company Data</button>
                </div>

                {activeTab === 'taxes' && (
                    <>
                        {can(currentUser, 'tax.edit') && <div className="bg-surface p-6 rounded-panel shadow-card border border-line max-w-4xl mx-auto">
                            <div className="flex justify-between items-center mb-6">
                                <div>
                                    <h2 className="text-xl font-semibold text-gray-700">Tax Configuration</h2>
                                    <p className="text-gray-500 text-sm">Define taxes and levies applied to invoices.</p>
                                </div>
                                <button onClick={handleAddTax} className="py-2 px-4 bg-gray-100 text-blue-600 rounded-lg hover:bg-blue-50 border border-blue-200 flex items-center text-sm font-medium">
                                    <Icon id="plus" className="mr-2" /> Add Tax
                                </button>
                            </div>

                            <div className="space-y-3">
                                {taxes.map(tax => (
                                    <div key={tax.id} className="grid grid-cols-12 gap-4 items-center p-4 bg-gray-50 rounded-lg border border-gray-100 hover:border-blue-200 transition-colors">

                                        {/* 1. Enable Toggle */}
                                        <div className="col-span-1 flex justify-center">
                                            <input
                                                type="checkbox"
                                                checked={tax.enabled}
                                                onChange={e => handleTaxChange(tax.id, 'enabled', e.target.checked)}
                                                className="h-5 w-5 text-blue-600 rounded focus:ring-blue-500"
                                                title="Enable/Disable"
                                            />
                                        </div>

                                        {/* 2. Tax Name */}
                                        <div className="col-span-4">
                                            <label className="text-xs text-gray-500 block mb-1">Name</label>
                                            <input
                                                type="text"
                                                value={tax.name}
                                                onChange={e => handleTaxChange(tax.id, 'name', e.target.value)}
                                                className="w-full p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 font-medium"
                                                placeholder="Tax Name"
                                            />
                                        </div>

                                        {/* 3. Rate Input (Unified Counting Applied) */}
                                        <div className="col-span-2">
                                            <label className="text-xs text-gray-500 block mb-1">Rate (%)</label>
                                            <input
                                                type="number"
                                                value={tax.rate}
                                                min="0"
                                                step="0.01"
                                                onChange={e => handleTaxChange(tax.id, 'rate', e.target.value)}
                                                className="w-full p-2 text-right border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                                            />
                                        </div>

                                        {/* 4. Calculation Basis (Accounting Logic) */}
                                        <div className="col-span-4">
                                            <label className="text-xs text-gray-500 block mb-1">Calculated on</label>
                                            <select
                                                value={tax.on || 'levyTotal'}
                                                onChange={e => handleTaxChange(tax.id, 'on', e.target.value)}
                                                className="w-full p-2 border border-gray-300 rounded text-sm bg-white"
                                                title={
                                                    tax.on === 'subtotal'
                                                        ? `Tax applies on the taxable amount only (subtotal + shipping + handling − discount), BEFORE any other taxes/levies. Standard for Ghanaian VAT under the 2023+ rules.`
                                                        : `Tax cascades — applies on the taxable amount PLUS already-applied levies (e.g. NHIL + GETFund + COVID levies). Use this for the legacy pre-2023 VAT.`
                                                }
                                            >
                                                <option value="subtotal">Taxable amount only (no cascade)</option>
                                                <option value="levyTotal">Cascade — subtotal + levies</option>
                                            </select>
                                            <div className="text-[10.5px] text-n-500 mt-1 leading-tight">
                                                {tax.on === 'subtotal'
                                                    ? 'Applies on subtotal+charges before other levies. Use for VAT under 2023+ Ghanaian law.'
                                                    : 'Applies on subtotal + already-applied levies (cascading). Pre-2023 VAT.'}
                                            </div>
                                        </div>

                                        {/* 5. Delete Button */}
                                        <div className="col-span-1 flex justify-center">
                                            <button
                                                onClick={() => handleDeleteTax(tax.id)}
                                                className="text-gray-400 hover:text-red-600 transition-colors p-2"
                                                title="Delete Tax"
                                            >
                                                <Icon id="trash" className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="mt-6 flex justify-end border-t pt-4">
                                <button onClick={handleSaveChanges} className="py-2.5 px-6 text-white bg-green-600 hover:bg-green-700 rounded-lg font-semibold shadow-sm transition-all">
                                    Save Changes
                                </button>
                            </div>
                        </div>}

                        {/* Exchange Rate Settings Section */}
                        {can(currentUser, 'fx.edit') && <div className="bg-surface p-6 rounded-panel shadow-card border border-line max-w-4xl mx-auto mt-8">
                            <div className="flex items-start justify-between mb-2">
                                <div>
                                    <h2 className="text-xl font-semibold text-gray-700">Rate Settings</h2>
                                    <p className="text-gray-600">Set monthly USD → GHS rate for quoting.</p>
                                </div>
                                <div className="ml-4 flex-shrink-0">
                                    <div className="rounded-lg border bg-blue-50 text-blue-800 px-4 py-3 shadow-sm">
                                        <div className="text-xs uppercase tracking-wide text-blue-700">Current Month</div>
                                        <div className="text-sm text-blue-900 font-semibold">{currentMonthKey}</div>
                                        <div className="text-2xl font-extrabold mt-1">
                                            {currentMonthRate ? `GHS ${currentMonthRate.toFixed(4)} / USD` : 'Not set'}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                                <div className="flex flex-col">
                                    <label className="text-sm text-gray-600 mb-1">Month</label>
                                    <input
                                        type="month"
                                        value={rateMonth}
                                        onChange={(e) => { setRateMonth(e.target.value); }}
                                        className="p-2 border rounded-md"
                                    />
                                </div>
                                <div className="flex flex-col">
                                    <label className="text-sm text-gray-600 mb-1">USD → GHS</label>
                                    <input
                                        type="number"
                                        step="0.0001"
                                        min="0"
                                        placeholder="e.g. 15.2500"
                                        value={usdToGhs}
                                        onChange={(e) => { setUsdToGhs(e.target.value); }}
                                        className="p-2 border rounded-md"
                                    />
                                </div>
                                <div className="flex space-x-2">
                                    <button onClick={handleSaveExchangeRate} className="flex-1 py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700">Save Rate</button>
                                    <button onClick={() => { setShowRatesTable(!showRatesTable); }} className="py-2 px-4 bg-gray-100 rounded-md border">{showRatesTable ? 'Hide' : 'View'} History</button>
                                </div>
                            </div>
                            {ratesLoading ? (
                                <div className="text-sm text-gray-500 mt-4">Loading rates...</div>
                            ) : null}
                            {showRatesTable && (
                                <div className="mt-6 overflow-x-auto">
                                    <table className="min-w-full text-sm">
                                        <thead>
                                            <tr className="text-left text-gray-600">
                                                <th className="py-2 pr-4">Month</th>
                                                <th className="py-2 pr-4">USD → GHS</th>
                                                <th className="py-2 pr-4">Updated</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {ratesHistory.length === 0 ? (
                                                <tr><td className="py-3 text-gray-500" colSpan="3">No rates saved yet.</td></tr>
                                            ) : (
                                                ratesHistory.map((r) => (
                                                    <tr key={r.id || r.month} className="border-t">
                                                        <td className="py-2 pr-4">{r.month}</td>
                                                        <td className="py-2 pr-4">{Number(r.usdToGhs).toFixed(4)}</td>
                                                        <td className="py-2 pr-4">{r.updatedAt || r.createdAt}</td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>}
                    </>
                )}

                {activeTab === 'wht' && can(currentUser, 'wht.config.edit') && (
                    <WhtSettings />
                )}

                {activeTab === 'signatures' && (
                    <SignaturesSettings userId={userId} currentUser={currentUser} />
                )}

                {activeTab === 'pricelist' && (
                    <PriceListSettings currentMonthRate={currentMonthRate} currentMonthKey={currentMonthKey} />
                )}

                {activeTab === 'companyData' && (
                    <CompanyDataSettings log={log} />
                )}

                {activeTab === 'targets' && (
                    <TargetsSettings />
                )}
        </>
    );
};

export default TaxSettings;
