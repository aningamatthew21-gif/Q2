import React, { useState } from 'react';
import api from '../api';

/**
 * ConnectionTest component - tests the Oracle REST API backend connection.
 * Replaces the legacy Firebase connection tester.
 */
const ConnectionTest = () => {
    const [testResults, setTestResults] = useState({});
    const [isTesting, setIsTesting] = useState(false);

    const runConnectionTest = async () => {
        setIsTesting(true);
        const results = {};

        try {
            // Test 1: Auth endpoint
            console.log('🔍 [TEST] Testing auth endpoint...');
            try {
                await api.get('/auth/me');
                results.auth = { success: true, message: 'Auth endpoint reachable and JWT valid' };
                console.log('✅ [TEST] Auth endpoint OK');
            } catch (err) {
                results.auth = { success: false, message: err.message };
                console.error('❌ [TEST] Auth test failed:', err);
            }

            // Test 2: Inventory read
            console.log('🔍 [TEST] Testing inventory read...');
            try {
                const resp = await api.get('/inventory');
                results.inventory = { success: resp.success, message: `Inventory: ${resp.data?.length ?? 0} items found` };
                console.log('✅ [TEST] Inventory read OK');
            } catch (err) {
                results.inventory = { success: false, message: err.message };
                console.error('❌ [TEST] Inventory read failed:', err);
            }

            // Test 3: Customers read
            console.log('🔍 [TEST] Testing customers read...');
            try {
                const resp = await api.get('/customers');
                results.customers = { success: resp.success, message: `Customers: ${resp.data?.length ?? 0} records found` };
                console.log('✅ [TEST] Customers read OK');
            } catch (err) {
                results.customers = { success: false, message: err.message };
                console.error('❌ [TEST] Customers read failed:', err);
            }

            // Test 4: Invoices read
            console.log('🔍 [TEST] Testing invoices read...');
            try {
                const resp = await api.get('/invoices');
                results.invoices = { success: resp.success, message: `Invoices: ${resp.data?.length ?? 0} records found` };
                console.log('✅ [TEST] Invoices read OK');
            } catch (err) {
                results.invoices = { success: false, message: err.message };
                console.error('❌ [TEST] Invoices read failed:', err);
            }

            // Test 5: Settings read
            console.log('🔍 [TEST] Testing settings read...');
            try {
                const resp = await api.get('/settings/taxes');
                results.settings = { success: resp.success, message: 'Settings (taxes) endpoint reachable' };
                console.log('✅ [TEST] Settings read OK');
            } catch (err) {
                results.settings = { success: false, message: err.message };
                console.error('❌ [TEST] Settings read failed:', err);
            }

        } catch (err) {
            results.globalError = { success: false, message: err.message };
            console.error('❌ [TEST] Connection test crashed:', err);
        } finally {
            setIsTesting(false);
        }

        setTestResults(results);
    };

    return (
        <div className="max-w-2xl mx-auto p-6 bg-white rounded-lg shadow-lg">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Oracle Backend Connection Test</h3>

            <button
                onClick={runConnectionTest}
                disabled={isTesting}
                className="w-full mb-4 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {isTesting ? 'Testing...' : 'Test Backend Connection'}
            </button>

            {Object.keys(testResults).length > 0 && (
                <div className="space-y-3">
                    <h4 className="font-semibold text-gray-700">Test Results:</h4>

                    {Object.entries(testResults).map(([test, result]) => (
                        <div key={test} className={`p-3 border rounded ${result.success ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'}`}>
                            <div className="flex items-center">
                                <span className={`mr-2 ${result.success ? 'text-green-600' : 'text-red-600'}`}>
                                    {result.success ? '✅' : '❌'}
                                </span>
                                <span className="font-medium">
                                    {test.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}:
                                </span>
                            </div>
                            <div className={`mt-1 text-sm ${result.success ? 'text-green-700' : 'text-red-700'}`}>
                                {result.message}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-700">
                <strong>Note:</strong> This tests connections to the Oracle REST API backend running at <code>/api/*</code>.
            </div>
        </div>
    );
};

export default ConnectionTest;
