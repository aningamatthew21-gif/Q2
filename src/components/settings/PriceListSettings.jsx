import React, { useState, useMemo, useEffect } from 'react';
import Icon from '../common/Icon';
import { useRealtimeInventory } from '../../hooks/useRealtimeInventory';
import { formatCurrency } from '../../utils/formatting';

// Page size matches the convention used by other paginated tables in the
// app (PR list, Inventory). 50 rows fits a typical 1080px viewport without
// scrolling and keeps row-render cost low even on a 10k-item catalogue.
const PAGE_SIZE = 50;

const PriceListSettings = ({ currentMonthRate, currentMonthKey }) => {
    const { data: rawInventory, loading: inventoryLoading } = useRealtimeInventory();
    const inventory = Array.isArray(rawInventory) ? rawInventory : [];
    const [priceListSearch, setPriceListSearch] = useState('');
    const [page, setPage] = useState(1);

    // Memoise the filtered list — the previous implementation invoked the
    // filter three times per render (existence check, length check, map),
    // which was wasted CPU on a multi-thousand-row catalogue. Memo also
    // gives pagination a stable reference to slice from.
    const filteredInventory = useMemo(() => {
        const term = priceListSearch.toLowerCase();
        if (!term) return inventory;
        return inventory.filter(item => (item.name || '').toLowerCase().includes(term));
    }, [inventory, priceListSearch]);

    // Reset to page 1 whenever the search term changes — otherwise a search
    // that narrows the result set to fewer pages than the current page would
    // render an empty table with no visual signal of why.
    useEffect(() => { setPage(1); }, [priceListSearch]);

    const totalRows  = filteredInventory.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
    // Clamp page in case row count drops below current page bounds (e.g.
    // an inventory item is deleted while the user is on the last page).
    const safePage   = Math.min(page, totalPages);
    const startIdx   = (safePage - 1) * PAGE_SIZE;
    const pageRows   = filteredInventory.slice(startIdx, startIdx + PAGE_SIZE);

    const handleExportPriceList = () => {
        // Export exports the FULL filtered list (not just the current page) —
        // when a user clicks "Export to Excel" they expect the whole dataset
        // matching their search, not a one-page snapshot.
        const headers = ["S/N", "SKU", "Description", "Stock Level", "Final Price (GHS)", "Final Price (USD)", "Exchange Rate"];
        const rate = currentMonthRate || 0;

        const csvRows = [headers.join(',')];

        filteredInventory.forEach((item, index) => {
            const priceGhs = item.price || 0;
            const priceUsd = rate > 0 ? (priceGhs / rate).toFixed(2) : 'N/A';
            const stockLevel = item.stock || 0;

            const row = [
                index + 1,
                `"${item.id}"`,
                `"${(item.name || '').replace(/"/g, '""')}"`,
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
                        ) : totalRows === 0 ? (
                            <tr>
                                <td colSpan="6" className="px-6 py-4 text-center text-gray-500">No items found.</td>
                            </tr>
                        ) : (
                            pageRows.map((item, index) => {
                                const priceGhs = item.price || 0;
                                const priceUsd = currentMonthRate ? (priceGhs / currentMonthRate) : 0;
                                const stockLevel = item.stock || 0;
                                // S/N reflects the row's ABSOLUTE position in the
                                // filtered set, not its page-relative index — so
                                // page 2 starts at 51, not 1.
                                const serial = startIdx + index + 1;
                                return (
                                    <tr key={item.id} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{serial}</td>
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

            {/* Pagination controls — only render when there's more than one
                page to navigate. Matches the visual pattern used on the PR
                list and Inventory pages so the app feels consistent. */}
            {!inventoryLoading && totalRows > 0 && totalPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                    <p className="text-sm text-gray-500">
                        Showing {startIdx + 1}–{Math.min(startIdx + PAGE_SIZE, totalRows)} of {totalRows} items
                    </p>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={safePage <= 1}
                            className="px-3 py-1 text-sm border rounded disabled:opacity-40 hover:bg-gray-50"
                        >
                            ← Prev
                        </button>
                        <span className="px-3 py-1 text-sm text-gray-700">
                            Page {safePage} / {totalPages}
                        </span>
                        <button
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            disabled={safePage >= totalPages}
                            className="px-3 py-1 text-sm border rounded disabled:opacity-40 hover:bg-gray-50"
                        >
                            Next →
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PriceListSettings;
