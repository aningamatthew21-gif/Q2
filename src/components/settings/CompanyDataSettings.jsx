import React, { useState, useEffect } from 'react';
import api from '../../api';
import Notification from '../common/Notification';

const CompanyDataSettings = ({ log }) => {
    const [invoiceSettings, setInvoiceSettings] = useState(null);
    const [settingsLoading, setSettingsLoading] = useState(false);
    const [notification, setNotification] = useState(null);

    // Load Invoice Settings
    useEffect(() => {
        const loadInvoiceSettings = async () => {
            try {
                const response = await api.get('/settings/company');
                if (response.success && response.data && Object.keys(response.data).length > 0) {
                    setInvoiceSettings(response.data);
                } else {
                    // Default invoice settings
                    setInvoiceSettings({
                        companyAddress: {
                            poBox: 'P.O. Box KN 785',
                            city: 'Accra, Ghana',
                            tel: '+233 302 220 180',
                            fax: '+233 302 220 180',
                            email: 'sales@margins-id.com'
                        },
                        accountDetails: {
                            accountName: 'Margins ID Systems Applications Ltd.',
                            bankers: 'Fidelity Bank Limited',
                            address: 'Ridge Towers, Cruickshank Road, Ridge, Accra',
                            accountNumbers: '1070033129318 - GHC'
                        },
                        locationAddress: {
                            companyName: 'Margins ID Systems Applications Ltd.',
                            unit: 'Unit B607, Octagon',
                            street: 'Barnes Road, Accra Central'
                        }
                    });
                }
            } catch (err) {
                console.error('Error loading invoice settings:', err);
            }
        };
        loadInvoiceSettings();
    }, []);

    const handleSaveInvoiceSettings = async (e) => {
        e.preventDefault();
        setSettingsLoading(true);
        const formData = new FormData(e.target);

        const settings = {
            companyAddress: {
                poBox: formData.get('poBox'),
                city: formData.get('city'),
                tel: formData.get('tel'),
                fax: formData.get('fax'),
                email: formData.get('email')
            },
            accountDetails: {
                accountName: formData.get('accountName'),
                bankers: formData.get('bankers'),
                address: formData.get('bankAddress'),
                accountNumbers: formData.get('accountNumbers')
            },
            locationAddress: {
                companyName: formData.get('locCompanyName'),
                unit: formData.get('locUnit'),
                street: formData.get('locStreet')
            }
        };

        try {
            await api.post('/settings/company', settings);
            setInvoiceSettings(settings);

            await log('SETTINGS_CHANGE', `Updated Company Data Settings`, {
                category: 'settings',
                settingType: 'invoice_settings',
                details: settings
            });

            setNotification({ type: 'success', message: 'Company Data settings saved successfully' });
        } catch (err) {
            console.error('Error saving invoice settings:', err);
            setNotification({ type: 'error', message: 'Failed to save settings' });
        } finally {
            setSettingsLoading(false);
        }
    };

    if (!invoiceSettings) return <div className="p-6 text-center text-gray-500">Loading company data...</div>;

    return (
        <div className="bg-white p-6 rounded-xl shadow-md max-w-4xl mx-auto">
            {notification && <Notification message={notification.message} type={notification.type} onDismiss={() => setNotification(null)} />}
            <h2 className="text-xl font-semibold text-gray-700 mb-6">Company Data Management</h2>
            <form onSubmit={handleSaveInvoiceSettings}>
                {/* Company Address Section */}
                <div className="mb-8">
                    <h4 className="text-md font-semibold text-gray-700 mb-3 border-b pb-2">Company Contact Info (Header)</h4>
                    <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-2">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">P.O. Box</label>
                            <input type="text" name="poBox" defaultValue={invoiceSettings.companyAddress?.poBox} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">City/Country</label>
                            <input type="text" name="city" defaultValue={invoiceSettings.companyAddress?.city} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Tel</label>
                            <input type="text" name="tel" defaultValue={invoiceSettings.companyAddress?.tel} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Fax</label>
                            <input type="text" name="fax" defaultValue={invoiceSettings.companyAddress?.fax} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                        <div className="sm:col-span-2">
                            <label className="block text-sm font-medium text-gray-700">Email</label>
                            <input type="email" name="email" defaultValue={invoiceSettings.companyAddress?.email} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                    </div>
                </div>

                {/* Account Details Section */}
                <div className="mb-8">
                    <h4 className="text-md font-semibold text-gray-700 mb-3 border-b pb-2">Bank Account Details</h4>
                    <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-2">
                        <div className="sm:col-span-2">
                            <label className="block text-sm font-medium text-gray-700">Account Name</label>
                            <input type="text" name="accountName" defaultValue={invoiceSettings.accountDetails?.accountName} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Bankers</label>
                            <input type="text" name="bankers" defaultValue={invoiceSettings.accountDetails?.bankers} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Bank Address</label>
                            <input type="text" name="bankAddress" defaultValue={invoiceSettings.accountDetails?.address} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                        <div className="sm:col-span-2">
                            <label className="block text-sm font-medium text-gray-700">Account Numbers (GHC/USD)</label>
                            <input type="text" name="accountNumbers" defaultValue={invoiceSettings.accountDetails?.accountNumbers} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                    </div>
                </div>

                {/* Location Address Section */}
                <div className="mb-8">
                    <h4 className="text-md font-semibold text-gray-700 mb-3 border-b pb-2">Location Address (Footer)</h4>
                    <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-2">
                        <div className="sm:col-span-2">
                            <label className="block text-sm font-medium text-gray-700">Company Name</label>
                            <input type="text" name="locCompanyName" defaultValue={invoiceSettings.locationAddress?.companyName} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Unit/Building</label>
                            <input type="text" name="locUnit" defaultValue={invoiceSettings.locationAddress?.unit} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Street/Area</label>
                            <input type="text" name="locStreet" defaultValue={invoiceSettings.locationAddress?.street} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                    </div>
                </div>

                <div className="flex justify-end pt-6">
                    <button
                        type="submit"
                        disabled={settingsLoading}
                        className="px-6 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                    >
                        {settingsLoading ? 'Saving...' : 'Save Company Data'}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default CompanyDataSettings;
