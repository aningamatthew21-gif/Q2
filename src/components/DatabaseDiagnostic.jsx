import React, { useState } from 'react';
import api from '../api';
import ConnectionTest from './ConnectionTest';

/**
 * DatabaseDiagnostic component - tests Oracle REST API backend connectivity.
 * Replaces the legacy Firebase diagnostic tool.
 */
const DatabaseDiagnostic = () => {
    const [diagnosticResults, setDiagnosticResults] = useState({});
    const [isRunning, setIsRunning] = useState(false);
    const [error, setError] = useState(null);

    const runDiagnostics = async () => {
        setIsRunning(true);
        setError(null);
        const results = {};

        try {
            // 1. Test Backend Reachability
            console.log('🔍 [DIAGNOSTIC] Testing backend reachability...');
            try {
                const resp = await fetch('/api/auth/me', {
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem('auth_token')}`
                    }
                });
                results.backendReachability = {
                    status: resp.ok || resp.status === 401 ? 'SUCCESS' : 'FAILED',
                    message: `Backend responded with HTTP ${resp.status}`
                };
                console.log('✅ [DIAGNOSTIC] Backend reachable');
            } catch (err) {
                results.backendReachability = { status: 'FAILED', message: `Cannot reach backend: ${err.message}` };
                console.error('❌ [DIAGNOSTIC] Backend unreachable:', err);
            }

            // 2. Test JWT Auth
            console.log('🔍 [DIAGNOSTIC] Testing JWT auth...');
            try {
                const resp = await api.get('/auth/me');
                results.jwtAuth = {
                    status: resp.success ? 'SUCCESS' : 'FAILED',
                    message: resp.success ? `Authenticated as ${resp.user?.email}` : 'JWT invalid or expired'
                };
                console.log('✅ [DIAGNOSTIC] JWT auth OK');
            } catch (err) {
                results.jwtAuth = { status: 'FAILED', message: err.message };
                console.error('❌ [DIAGNOSTIC] JWT auth failed:', err);
            }

            // 3. Test Oracle DB - Inventory
            console.log('🔍 [DIAGNOSTIC] Testing Oracle inventory table...');
            try {
                const resp = await api.get('/inventory');
                results.oracleInventory = {
                    status: resp.success ? 'SUCCESS' : 'FAILED',
                    message: resp.success ? `QA_INVENTORY: ${resp.data?.length ?? 0} records` : resp.error
                };
            } catch (err) {
                results.oracleInventory = { status: 'FAILED', message: err.message };
            }

            // 4. Test Oracle DB - Customers
            console.log('🔍 [DIAGNOSTIC] Testing Oracle customers table...');
            try {
                const resp = await api.get('/customers');
                results.oracleCustomers = {
                    status: resp.success ? 'SUCCESS' : 'FAILED',
                    message: resp.success ? `QA_CUSTOMERS: ${resp.data?.length ?? 0} records` : resp.error
                };
            } catch (err) {
                results.oracleCustomers = { status: 'FAILED', message: err.message };
            }

            // 5. Test Oracle DB - Invoices
            console.log('🔍 [DIAGNOSTIC] Testing Oracle invoices table...');
            try {
                const resp = await api.get('/invoices');
                results.oracleInvoices = {
                    status: resp.success ? 'SUCCESS' : 'FAILED',
                    message: resp.success ? `QA_INVOICES: ${resp.data?.length ?? 0} records` : resp.error
                };
            } catch (err) {
                results.oracleInvoices = { status: 'FAILED', message: err.message };
            }

            // 6. Test Oracle DB - Settings
            console.log('🔍 [DIAGNOSTIC] Testing Oracle settings tables...');
            try {
                const resp = await api.get('/settings/taxes');
                results.oracleSettings = {
                    status: resp.success ? 'SUCCESS' : 'FAILED',
                    message: resp.success ? `QA_TAX_SETTINGS: ${resp.data?.taxArray?.length ?? 0} tax rules` : resp.error
                };
            } catch (err) {
                results.oracleSettings = { status: 'FAILED', message: err.message };
            }

            // 7. Network connectivity check
            console.log('🔍 [DIAGNOSTIC] Testing network connectivity...');
            try {
                await fetch('https://www.google.com', { mode: 'no-cors' });
                results.networkConnectivity = { status: 'SUCCESS', message: 'Network connectivity confirmed' };
            } catch (err) {
                results.networkConnectivity = { status: 'FAILED', message: err.message };
            }

        } catch (err) {
            setError(err.message);
            console.error('❌ [DIAGNOSTIC] Diagnostic crashed:', err);
        } finally {
            setIsRunning(false);
        }

        setDiagnosticResults(results);
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'SUCCESS': return 'text-green-600';
            case 'FAILED': return 'text-red-600';
            default: return 'text-gray-600';
        }
    };

    const getStatusIcon = (status) => {
        switch (status) {
            case 'SUCCESS': return '✅';
            case 'FAILED': return '❌';
            default: return '⏳';
        }
    };

    return (
        <div className="max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-lg">
            <h2 className="text-2xl font-bold text-gray-800 mb-6">Oracle Backend Diagnostics</h2>

            <div className="mb-6">
                <button
                    onClick={runDiagnostics}
                    disabled={isRunning}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isRunning ? 'Running Diagnostics...' : 'Run Full Diagnostics'}
                </button>
            </div>

            {error && (
                <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
                    <strong>Error:</strong> {error}
                </div>
            )}

            {Object.keys(diagnosticResults).length > 0 && (
                <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-gray-700">Diagnostic Results:</h3>

                    {Object.entries(diagnosticResults).map(([test, result]) => (
                        <div key={test} className="p-4 border rounded-lg">
                            <div className="flex items-center justify-between">
                                <div>
                                    <span className="font-medium text-gray-700">
                                        {test.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}:
                                    </span>
                                    <span className={`ml-2 ${getStatusColor(result.status)}`}>
                                        {getStatusIcon(result.status)} {result.status}
                                    </span>
                                </div>
                            </div>
                            <div className="mt-2 text-sm text-gray-600">
                                {result.message}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <div className="mt-8 p-4 bg-gray-100 rounded-lg">
                <h4 className="font-semibold text-gray-700 mb-2">Troubleshooting Tips:</h4>
                <ul className="text-sm text-gray-600 space-y-1">
                    <li>• Ensure the Node.js backend server is running on port 3001</li>
                    <li>• Verify Oracle DB credentials in <code>backend/.env</code></li>
                    <li>• Check that Oracle DB listener is running and accepting connections</li>
                    <li>• Confirm Vite proxy config in <code>vite.config.js</code> routes <code>/api</code> to port 3001</li>
                    <li>• Check the terminal running <code>node server.js</code> for error messages</li>
                </ul>
            </div>

            <div className="mt-6">
                <ConnectionTest />
            </div>
        </div>
    );
};

export default DatabaseDiagnostic;
