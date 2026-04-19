import React, { useState, useEffect } from 'react';
import api from '../../api';
import Icon from '../common/Icon';

const TargetsSettings = () => {
    const [year, setYear] = useState(new Date().getFullYear());
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [targets, setTargets] = useState({
        '01': 0, '02': 0, '03': 0, '04': 0, '05': 0, '06': 0,
        '07': 0, '08': 0, '09': 0, '10': 0, '11': 0, '12': 0
    });
    const [message, setMessage] = useState(null);

    const months = [
        { key: '01', name: 'January' }, { key: '02', name: 'February' }, { key: '03', name: 'March' },
        { key: '04', name: 'April' }, { key: '05', name: 'May' }, { key: '06', name: 'June' },
        { key: '07', name: 'July' }, { key: '08', name: 'August' }, { key: '09', name: 'September' },
        { key: '10', name: 'October' }, { key: '11', name: 'November' }, { key: '12', name: 'December' }
    ];

    const [exchangeRates, setExchangeRates] = useState([]);

    useEffect(() => {
        fetchTargets();
        fetchExchangeRates();
    }, [year]);

    const fetchExchangeRates = async () => {
        try {
            const response = await api.get('/settings/exchangeRates');
            if (response.success && response.data) {
                setExchangeRates(Array.isArray(response.data.rates) ? response.data.rates : []);
            }
        } catch (error) {
            console.error("Error fetching exchange rates:", error);
        }
    };

    const getApplicableRate = (targetMonthKey) => {
        // targetMonthKey is like "01", "02"
        // rates have month like "2024-01"
        const targetFullMonth = `${year}-${targetMonthKey}`;

        // Sort rates descending by month
        const sortedRates = [...exchangeRates].sort((a, b) => b.month.localeCompare(a.month));

        // Find the first rate that is <= targetFullMonth
        const applicableRate = sortedRates.find(r => r.month <= targetFullMonth);

        return applicableRate ? parseFloat(applicableRate.usdToGhs) : null;
    };

    const handleExport = () => {
        const rows = [['Month', 'Amount (GHS)', 'Currency']];
        months.forEach(m => {
            rows.push([m.name, targets[m.key] || 0, 'GHS']);
        });

        const csvContent = "data:text/csv;charset=utf-8," + rows.map(e => e.join(",")).join("\n");
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `revenue_targets_${year}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

    };

    const handleImport = (event) => {
        const file = event.target.files[0];
        if (!file) return;

        console.log('📂 [DEBUG] File selected for import:', file.name);

        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target.result;
            console.log('📄 [DEBUG] File content length:', content.length);

            const lines = content.split(/\r?\n/); // Handle both CRLF and LF
            const newTargets = { ...targets };
            let warningMsg = '';
            let updatedCount = 0;

            // Skip header (row 0)
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;

                // Simple CSV parse: split by comma, but handle potential quotes
                // This regex matches: "quoted value" OR non-comma-value
                const matches = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || line.split(',');

                if (matches.length < 2) {
                    console.warn('⚠️ [DEBUG] Skipping invalid line:', line);
                    continue;
                }

                // Clean up values (remove quotes)
                const clean = (val) => val ? val.replace(/^"|"$/g, '').trim() : '';

                const monthName = clean(matches[0]); // e.g. "January"
                const amountStr = clean(matches[1]); // e.g. "15000"
                const currency = clean(matches[2]);  // e.g. "GHS"

                console.log(`🔍 [DEBUG] Parsing line ${i}:`, { monthName, amountStr, currency });

                const month = months.find(m => m.name.toLowerCase() === monthName.toLowerCase());

                if (month) {
                    let amount = parseFloat(amountStr.replace(/,/g, '')); // Remove thousands separators
                    const curr = currency ? currency.toUpperCase() : 'GHS';

                    if (isNaN(amount)) {
                        console.warn(`⚠️ [DEBUG] Invalid amount for ${monthName}:`, amountStr);
                        continue;
                    }

                    if (curr === 'USD') {
                        const rate = getApplicableRate(month.key);
                        console.log(`💱 [DEBUG] Converting USD to GHS for ${monthName}. Rate: ${rate}`);
                        if (rate) {
                            amount = amount * rate;
                        } else {
                            warningMsg = `Warning: No exchange rate found for ${monthName} (or prior months). Using 0.`;
                            amount = 0;
                        }
                    }

                    newTargets[month.key] = amount;
                    updatedCount++;
                } else {
                    console.warn(`⚠️ [DEBUG] Month not found: "${monthName}"`);
                }
            }

            console.log('✅ [DEBUG] Import complete. Updated months:', updatedCount);
            setTargets(newTargets);

            if (warningMsg) {
                setMessage({ type: 'error', text: warningMsg });
            } else if (updatedCount > 0) {
                setMessage({ type: 'success', text: `Successfully imported targets for ${updatedCount} months! Review and Save.` });
            } else {
                setMessage({ type: 'error', text: 'No valid data found in CSV. Please check the format.' });
            }
            // Reset file input
            event.target.value = '';
        };
        reader.readAsText(file);
    };

    const fetchTargets = async () => {
        setLoading(true);
        try {
            const response = await api.get(`/targets/${year}`);
            if (response.success && response.data) {
                setTargets(response.data.monthlyTargets || {});
            } else {
                // Reset to zeros if no data exists for this year
                setTargets({
                    '01': 0, '02': 0, '03': 0, '04': 0, '05': 0, '06': 0,
                    '07': 0, '08': 0, '09': 0, '10': 0, '11': 0, '12': 0
                });
            }
        } catch (error) {
            console.warn("Could not load targets for this year, setting to zero.", error);
            setTargets({
                '01': 0, '02': 0, '03': 0, '04': 0, '05': 0, '06': 0,
                '07': 0, '08': 0, '09': 0, '10': 0, '11': 0, '12': 0
            });
        } finally {
            setLoading(false);
        }
    };

    const handleInputChange = (monthKey, value) => {
        setTargets(prev => ({
            ...prev,
            [monthKey]: parseFloat(value) || 0
        }));
    };

    const calculateAnnualTarget = () => {
        return Object.values(targets).reduce((sum, val) => sum + (val || 0), 0);
    };

    const handleSave = async () => {
        setSaving(true);
        setMessage(null);
        try {
            const annualTarget = calculateAnnualTarget();
            await api.post(`/targets/${year}`, {
                monthlyTargets: targets,
                annualTarget: annualTarget
            });
            setMessage({ type: 'success', text: 'Targets saved successfully!' });
            setTimeout(() => setMessage(null), 3000);
        } catch (error) {
            console.error("Error saving targets:", error);
            setMessage({ type: 'error', text: 'Failed to save targets.' });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold text-gray-800">Revenue Targets</h2>
                <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-2">
                        <label className="text-sm font-medium text-gray-600">Year:</label>
                        <select
                            value={year}
                            onChange={(e) => setYear(parseInt(e.target.value))}
                            className="border border-gray-300 rounded-md p-1 text-sm focus:ring-blue-500 focus:border-blue-500"
                        >
                            {[...Array(5)].map((_, i) => {
                                const y = new Date().getFullYear() - 1 + i;
                                return <option key={y} value={y}>{y}</option>;
                            })}
                        </select>
                    </div>
                    <div className="flex space-x-2">
                        <button
                            onClick={handleExport}
                            className="text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center"
                        >
                            <Icon id="download" className="mr-1" /> Export CSV
                        </button>
                        <label className="text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center cursor-pointer">
                            <Icon id="upload" className="mr-1" /> Import CSV
                            <input type="file" accept=".csv" onChange={handleImport} className="hidden" />
                        </label>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="text-center py-8 text-gray-500">Loading targets...</div>
            ) : (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                        {months.map((month) => (
                            <div key={month.key} className="flex flex-col">
                                <label className="text-sm font-medium text-gray-600 mb-1">{month.name}</label>
                                <div className="relative">
                                    <span className="absolute left-3 top-2 text-gray-500 text-sm">GHS</span>
                                    <input
                                        type="number"
                                        min="0"
                                        value={targets[month.key] || ''}
                                        onChange={(e) => handleInputChange(month.key, e.target.value)}
                                        className="w-full pl-12 pr-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-right"
                                        placeholder="0.00"
                                    />
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="flex justify-between items-center pt-4 border-t border-gray-100">
                        <div className="text-lg font-semibold text-gray-800">
                            Annual Target: <span className="text-blue-600">GHS {calculateAnnualTarget().toLocaleString('en-GH', { minimumFractionDigits: 2 })}</span>
                        </div>
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center"
                        >
                            {saving ? (
                                <>
                                    <Icon id="sync-alt fa-spin" className="mr-2" /> Saving...
                                </>
                            ) : (
                                <>
                                    <Icon id="save" className="mr-2" /> Save Targets
                                </>
                            )}
                        </button>
                    </div>

                    {message && (
                        <div className={`mt-4 p-3 rounded-md text-sm ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                            {message.text}
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default TargetsSettings;
