/**
 * SalesPriceList — sales-facing read-only catalogue of stock + prices.
 *
 * Mirrors the Finance "Price List" tab (TaxSettings → Price List) in data
 * shape and behaviour, but lives as a top-level page in the sales nav so
 * officers can pull it up mid-call without navigating through System
 * Settings (which they don't otherwise need to see).
 *
 * Key differences vs the Finance tab:
 *   - Top-level page (PageHeader chrome) rather than a Settings card.
 *   - **PDF export** instead of CSV — sales typically share/print this
 *     externally; PDF preserves formatting and is signature-friendly.
 *   - Stock column rendered as a coloured badge driven by the per-SKU
 *     `restockLimit` field (the same threshold used by the low-stock
 *     watcher) — green / amber / red surfaces stock-risk at a glance.
 *
 * Same data layer as Finance: `useRealtimeInventory` + GET /settings/exchangeRates.
 * No new backend route; gated by `inventory.read` which sales_officer
 * already holds.
 */

import React, { useState, useMemo, useEffect } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import api from '../api';
import Icon from '../components/common/Icon';
import PageHeader from '../components/common/PageHeader';
import Button from '../components/common/Button';
import { SortableHeader, useSortable } from '../components/v2';
import { useRealtimeInventory } from '../hooks/useRealtimeInventory';
import { formatCurrency } from '../utils/formatting';

// Page size matches the convention used by other paginated tables in the
// app (PR list, Inventory, Finance Price List). 50 rows fits a typical
// 1080px viewport without scrolling and keeps row-render cost low.
const PAGE_SIZE = 50;

// Stock badge — coloured pill that tells sales at-a-glance whether an
// item is safe to quote at the customer-stated quantity. The threshold
// comes from `restockLimit` on each SKU (per-item, configured in
// Inventory). Items with no restockLimit set fall back to a simple
// in-stock / out-of-stock binary so the badge never lies.
const StockBadge = ({ stock, restockLimit }) => {
    const qty       = Number(stock) || 0;
    const threshold = Number(restockLimit) || 0;

    let cls, label;
    if (qty <= 0) {
        cls   = 'bg-red-100 text-red-700 border-red-200';
        label = `Out · ${qty}`;
    } else if (threshold > 0 && qty <= threshold) {
        cls   = 'bg-amber-100 text-amber-700 border-amber-200';
        label = `Low · ${qty}`;
    } else {
        cls   = 'bg-green-100 text-green-700 border-green-200';
        label = `${qty}`;
    }
    return (
        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`} title={`Stock: ${qty}${threshold > 0 ? ` · restock at ${threshold}` : ''}`}>
            {label}
        </span>
    );
};

const SalesPriceList = ({ navigateTo, currentUser }) => {
    const { data: rawInventory, loading: inventoryLoading } = useRealtimeInventory();
    const inventory = Array.isArray(rawInventory) ? rawInventory : [];
    const [search, setSearch]   = useState('');
    const [page, setPage]       = useState(1);
    const [exporting, setExporting] = useState(false);

    // Exchange-rate context — same source as Finance Price List. We pull
    // the rate for the CURRENT month so the USD column is anchored to a
    // documented monthly rate, not a live FX feed (which would change
    // every refresh and make the PDF unreproducible).
    const [currentMonthRate, setCurrentMonthRate] = useState(null);
    const currentMonthKey = useMemo(() => {
        const now   = new Date();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        return `${now.getFullYear()}-${month}`;
    }, []);

    useEffect(() => {
        let cancelled = false;
        api.get('/settings/exchangeRates')
            .then(res => {
                if (cancelled) return;
                if (res.success && res.data) {
                    const list = res.data.rates || [];
                    const cur  = list.find(r => r.month === currentMonthKey);
                    if (cur && typeof cur.usdToGhs === 'number') {
                        setCurrentMonthRate(cur.usdToGhs);
                    }
                }
            })
            .catch(err => console.error('Error fetching FX rate:', err));
        return () => { cancelled = true; };
    }, [currentMonthKey]);

    // Memoise the filtered list — the same pattern as the PR/RFQ lists.
    // Filter by SKU OR name so a sales rep can type either while on a
    // call. Case-insensitive.
    const filteredInventory = useMemo(() => {
        const term = search.trim().toLowerCase();
        if (!term) return inventory;
        return inventory.filter(item =>
            (item.name || '').toLowerCase().includes(term) ||
            (item.id   || '').toLowerCase().includes(term)
        );
    }, [inventory, search]);

    // Project numeric fields with `_` prefix so useSortable picks the
    // numeric comparator instead of locale-string. Same pattern PR/RFQ
    // lists use. Sortable columns: SKU (id, string), Description (name,
    // string), Stock (_stock, numeric), Price GHS (_price, numeric).
    // Price USD orders identically to Price GHS so we reuse `_price`.
    const sortableInventory = useMemo(() => filteredInventory.map(item => ({
        ...item,
        _stock: Number(item.stock) || 0,
        _price: Number(item.price) || 0
    })), [filteredInventory]);

    const { sortKey, sortDir, toggle: toggleSort, sortedRows: sortedInventory } =
        useSortable(sortableInventory, 'name', 'asc');

    // Reset to page 1 when the search OR the sort changes. Both narrow or
    // reorder the list in ways that make staying on the current page
    // disorienting — landing on a now-empty page after a tighter search,
    // or being in the middle of a re-sorted list with no idea why.
    useEffect(() => { setPage(1); }, [search, sortKey, sortDir]);

    const totalRows  = sortedInventory.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
    const safePage   = Math.min(page, totalPages);
    const startIdx   = (safePage - 1) * PAGE_SIZE;
    const pageRows   = sortedInventory.slice(startIdx, startIdx + PAGE_SIZE);

    const role     = currentUser?.role;
    const backPage = (role === 'sales_head' || role === 'sales_officer' || role === 'sales')
        ? 'salesDashboard'
        : 'controllerDashboard';

    // PDF export — outputs the FULL filtered set (not just the visible
    // page) because the export is the artifact sales rep will share or
    // print. Same logic as the Finance CSV export. Built with jsPDF +
    // jspdf-autotable, both already in the bundle for invoice PDFs.
    const handleExportPDF = async () => {
        if (totalRows === 0 || exporting) return;
        setExporting(true);
        try {
            const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
            const pageWidth = pdf.internal.pageSize.getWidth();

            // Header block
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(18);
            pdf.text('Price List', 14, 20);

            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(9);
            const generatedAt = new Date().toLocaleString();
            pdf.text(`Generated: ${generatedAt}`, 14, 27);
            if (currentMonthRate) {
                pdf.text(
                    `USD prices converted at ${currentMonthKey} rate: GHS ${Number(currentMonthRate).toFixed(4)} per USD`,
                    14, 33
                );
            } else {
                pdf.text(`USD column unavailable (no exchange rate set for ${currentMonthKey})`, 14, 33);
            }
            if (search.trim()) {
                pdf.text(`Filtered by: "${search.trim()}" (${totalRows} of ${inventory.length} items)`, 14, 39);
            }

            // Table
            const startY = search.trim() ? 45 : 39;
            autoTable(pdf, {
                startY,
                head: [['S/N', 'SKU', 'Description', 'Stock', 'Price (GHS)', 'Price (USD)']],
                // Use sortedInventory so the PDF matches what's currently on
                // screen — sorting by Price then exporting should give a PDF
                // sorted by price, not the original alphabetical order.
                body: sortedInventory.map((item, idx) => {
                    const priceGhs = Number(item.price) || 0;
                    const priceUsd = currentMonthRate ? priceGhs / Number(currentMonthRate) : null;
                    return [
                        idx + 1,
                        item.id || '',
                        item.name || '',
                        String(Number(item.stock) || 0),
                        priceGhs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                        priceUsd != null
                            ? `$${priceUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : 'N/A'
                    ];
                }),
                styles:      { fontSize: 8, cellPadding: 2 },
                headStyles:  { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' }, // accent blue-600
                alternateRowStyles: { fillColor: [248, 250, 252] }, // very light gray
                columnStyles: {
                    0: { halign: 'right',  cellWidth: 12 },
                    1: { cellWidth: 24 },
                    2: { cellWidth: 'auto' },
                    3: { halign: 'right',  cellWidth: 18 },
                    4: { halign: 'right',  cellWidth: 28 },
                    5: { halign: 'right',  cellWidth: 24 }
                },
                margin: { left: 14, right: 14 },
                didDrawPage: (data) => {
                    // Footer: page number on every page. Helps when sales
                    // prints + staples a long catalogue.
                    const pageHeight = pdf.internal.pageSize.getHeight();
                    pdf.setFontSize(8);
                    pdf.setTextColor(120);
                    pdf.text(
                        `Page ${data.pageNumber} · Confidential — internal use`,
                        pageWidth / 2,
                        pageHeight - 8,
                        { align: 'center' }
                    );
                    pdf.setTextColor(0);
                }
            });

            const dateStr = new Date().toISOString().split('T')[0];
            pdf.save(`price_list_${dateStr}.pdf`);
        } catch (err) {
            console.error('PDF export failed:', err);
            // Soft fail — alert is acceptable here because PDF export errors
            // are rare and the alternative (a stuck spinner) is worse.
            // (Future: route through the Notification system.)
            alert('Failed to generate PDF. Please try again.');
        } finally {
            setExporting(false);
        }
    };

    return (
        <>
            <PageHeader
                title="Price List"
                actions={
                    <>
                        <Button
                            variant="primary"
                            size="sm"
                            onClick={handleExportPDF}
                            disabled={inventoryLoading || totalRows === 0 || exporting}
                            leftIcon={<Icon id="download" />}
                        >
                            {exporting ? 'Generating…' : 'Export PDF'}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => navigateTo(backPage)} leftIcon={<Icon id="arrow-left" />}>
                            Back
                        </Button>
                    </>
                }
            />

            <div className="bg-surface p-6 rounded-panel shadow-card border border-line">
                {/* Search + result count */}
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
                    <div className="text-sm text-gray-600">
                        {inventoryLoading
                            ? 'Loading…'
                            : `${totalRows} item${totalRows === 1 ? '' : 's'}${search ? ` matching "${search}"` : ''}`}
                    </div>
                    <div className="relative w-full md:w-96">
                        <input
                            type="text"
                            placeholder="Search by SKU or description…"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                        <Icon id="search" className="absolute left-2 top-3 text-gray-400 w-4 h-4" />
                    </div>
                </div>

                {/* Exchange-rate info — mirrors Finance for consistency. */}
                <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-md text-sm text-blue-800">
                    <Icon id="info-circle" className="inline mr-2" />
                    USD prices converted using {currentMonthKey} rate:{' '}
                    <strong>{currentMonthRate ? `GHS ${currentMonthRate.toFixed(4)}` : 'Not Set'}</strong>
                </div>

                {/* Table */}
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                {/* S/N stays a static header — it's a row-position
                                    artifact, not a data field, so sorting by it
                                    would be a no-op. Other columns route through
                                    SortableHeader for ↑↓ toggle. Price (USD) uses
                                    the same `_price` projection because USD/GHS
                                    are linearly related — they share an order. */}
                                <th className="px-4 py-3 text-left  text-xs font-medium text-gray-500 uppercase tracking-wider">S/N</th>
                                <th className="px-4 py-3 text-left">
                                    <SortableHeader label="SKU"         sortKey="id"     current={sortKey} dir={sortDir} onToggle={toggleSort} />
                                </th>
                                <th className="px-4 py-3 text-left">
                                    <SortableHeader label="Description" sortKey="name"   current={sortKey} dir={sortDir} onToggle={toggleSort} />
                                </th>
                                <th className="px-4 py-3 text-center">
                                    <SortableHeader label="Stock"       sortKey="_stock" current={sortKey} dir={sortDir} onToggle={toggleSort} align="center" />
                                </th>
                                <th className="px-4 py-3 text-right">
                                    <SortableHeader label="Price (GHS)" sortKey="_price" current={sortKey} dir={sortDir} onToggle={toggleSort} align="right" />
                                </th>
                                <th className="px-4 py-3 text-right">
                                    <SortableHeader label="Price (USD)" sortKey="_price" current={sortKey} dir={sortDir} onToggle={toggleSort} align="right" />
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {inventoryLoading ? (
                                <tr>
                                    <td colSpan="6" className="px-4 py-8 text-center text-gray-500">
                                        <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mr-2"></div>
                                        Loading inventory…
                                    </td>
                                </tr>
                            ) : totalRows === 0 ? (
                                <tr>
                                    <td colSpan="6" className="px-4 py-6 text-center text-gray-500">
                                        {search ? `No items match "${search}".` : 'No inventory items available.'}
                                    </td>
                                </tr>
                            ) : (
                                pageRows.map((item, idx) => {
                                    const priceGhs = Number(item.price) || 0;
                                    const priceUsd = currentMonthRate ? priceGhs / Number(currentMonthRate) : null;
                                    const serial   = startIdx + idx + 1;
                                    return (
                                        <tr key={item.id} className="hover:bg-gray-50">
                                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">{serial}</td>
                                            <td className="px-4 py-3 whitespace-nowrap text-sm font-mono text-gray-900">{item.id}</td>
                                            <td className="px-4 py-3 text-sm text-gray-700">{item.name}</td>
                                            <td className="px-4 py-3 whitespace-nowrap text-center">
                                                <StockBadge stock={item.stock} restockLimit={item.restockLimit} />
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900">
                                                {formatCurrency(item.currency, priceGhs)}
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-600">
                                                {priceUsd != null ? `$${priceUsd.toFixed(2)}` : 'N/A'}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination — same pattern as PR list / Inventory. */}
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
        </>
    );
};

export default SalesPriceList;
