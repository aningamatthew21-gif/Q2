import React, { useState } from 'react';
import Icon from '../common/Icon';
import { useRealtimeInventory } from '../../hooks/useRealtimeInventory';
import { formatCurrency } from '../../utils/formatting';

const PriceListSettings = ({ currentMonthRate, currentMonthKey }) => {
    const { data: inventory, loading: inventoryLoading } = useRealtimeInventory();
    const [priceListSearch, setPriceListSearch] = useState('');

    const handleExportPriceList = () => {
        const headers = ["S/N", "SKU", "Description", "Stock Level", "Final Price (GHS)", "Final Price (USD)", "Exchange Rate"];
        const rate = currentMonthRate || 0;

        const csvRows = [headers.join(',')];

        const filteredInventory = inventory.filter(item =>
            item.name.toLowerCase().includes(priceListSearch.toLowerCase())
        );

        filteredInventory.forEach((item, index) => {
            const priceGhs = item.price || 0;
            const priceUsd = rate > 0 ? (priceGhs / rate).toFixed(2) : 'N/A';
            const stockLevel = item.stock || 0;

            const row = [
                index + 1,
                `"${item.id}"`,
                `"${item.name.replace(/"/g, '""')}"`,
                stockLevel,
                priceGhs.toFixed(2),
                priceUsd,
                rate.toFixed(4)
            ];
            csvRows.push(row.join(','));
        });

        const csvString = csvRows.join('\n');
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.setAttribute('hidden', '');
        a.setAttribute('href', url);
        a.setAttribute('download', `price_list_${currentMonthKey}.csv`);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    return (
        <div className="bg-white p-6 rounded-xl shadow-md">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold text-gray-700">Price List</h2>
                <div className="flex space-x-2">
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="Search items..."
                            value={priceListSearch}
                            onChange={(e) => setPriceListSearch(e.target.value)}
                            className="pl-8 pr-4 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                        <Icon id="search" className="absolute left-2 top-3 text-gray-400 w-4 h-4" />
                    </div>
                    <button onClick={handleExportPriceList} className="flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700">
                        <Icon id="download" className="mr-2 w-4 h-4" /> Export to Excel
                    </button>
                </div>
            </div>

            {/* Exchange Rate Info */}
            <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-md flex justify-between items-center">
                <span className="text-blue-800 text-sm">
                    <Icon id="info-circle" className="inline mr-2" />
                    USD prices converted using {currentMonthKey} rate: <strong>{currentMonthRate ? `GHS ${currentMonthRate.toFixed(4)}` : 'Not Set'}</strong>
                </span>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">S/N</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">SKU</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
                            <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Stock Level</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Final Price (GHS)</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Final Price (USD)</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {inventoryLoading ? (
                            <tr>
                                <td colSpan="6" className="px-6 py-4 text-center text-gray-500">Loading inventory...</td>
                            </tr>
                        ) : inventory.filter(item => item.name.toLowerCase().includes(priceListSearch.toLowerCase())).length === 0 ? (
                            <tr>
                                <td colSpan="6" className="px-6 py-4 text-center text-gray-500">No items found.</td>
                            </tr>
                        ) : (
                            inventory.filter(item => item.name.toLowerCase().includes(priceListSearch.toLowerCase())).map((item, index) => {
                                const priceGhs = item.price || 0;
                                const priceUsd = currentMonthRate ? (priceGhs / currentMonthRate) : 0;
                                const stockLevel = item.stock || 0;
                                return (
                                    <tr key={item.id} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{index + 1}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{item.id}</td>
                                        <td className="px-6 py-4 text-sm text-gray-500">{item.name}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-900">{stockLevel}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{formatCurrency(item.currency, priceGhs)}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                                            {currentMonthRate ? `$${priceUsd.toFixed(2)}` : 'N/A'}
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default PriceListSettings;
