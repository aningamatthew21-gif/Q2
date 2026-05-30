import React, { useState, useRef, useEffect, useMemo } from 'react';
import api from '../api';
import Icon from '../components/common/Icon';
import PageHeader from '../components/common/PageHeader';
import Button from '../components/common/Button';
import Notification from '../components/common/Notification';
import ItemModal from '../components/modals/ItemModal';
import ConfirmationModal from '../components/modals/ConfirmationModal';
import ImportProgressModal from '../components/modals/ImportProgressModal';
import { logActivity } from '../utils/logger';
import { formatCurrency } from '../utils/formatting';
import { invalidateCache } from '../utils/cache';
import { useRealtimeInventory } from '../hooks/useRealtimeInventory';
import { useDebounce } from '../hooks/useDebounce';
import { useActivityLog } from '../hooks/useActivityLog';
import { useApp } from '../context/AppContext';
import { SortableHeader, useSortable } from '../components/v2';

const InventoryManagement = ({ navigateTo, userId }) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const [deletingItemId, setDeletingItemId] = useState(null);
    const [pendingImport, setPendingImport] = useState(null);
    // Live state for the blocking import-progress modal. `null` when no
    // import is running; an object { processed, total, failed, done, error }
    // while one is in flight or has just finished.
    const [importProgress, setImportProgress] = useState(null);
    const [notification, setNotification] = useState(null);
    const fileInputRef = useRef(null);
    const { data: inventory, loading: inventoryLoading } = useRealtimeInventory();
    const { userEmail } = useApp();
    const username = userEmail ? userEmail.split('@')[0] : (userId || 'System');
    const { log } = useActivityLog();
    const [invSearch, setInvSearch] = useState('');
    const debouncedSearch = useDebounce(invSearch, 1000);

    useEffect(() => {
        if (debouncedSearch && debouncedSearch.trim().length > 2) {
            log('SEARCH_QUERY', `Searched inventory for: "${debouncedSearch}"`, {
                category: 'user_action',
                searchDetails: { term: debouncedSearch, context: 'inventory' }
            });
        }
    }, [debouncedSearch, log]);

    const handleSaveItem = async (itemToSave) => {
        try {
            const id = itemToSave.id || `SKU-${Date.now()}`;

            // --- UNIFIED COUNTING FIX ---
            const finalItem = {
                ...itemToSave,
                id,
                stock: Math.max(0, parseInt(itemToSave.stock || 0, 10)),
                price: Math.max(0, parseFloat(itemToSave.price || 0)),
                restockLimit: Math.max(0, parseInt(itemToSave.restockLimit || 0, 10))
            };

            let existingItem = null;
            if (itemToSave.id) {
                try {
                    const response = await api.get(`/inventory/${itemToSave.id}`);
                    if (response.success) existingItem = response.data;
                } catch (error) {
                    // INTENTIONAL silent fallback: the existingItem fetch is
                    // ONLY used to enrich the audit log with the prior
                    // stockBefore / priceBefore values (see `changes` object
                    // below). If we can't fetch it, the save still works;
                    // the audit row just lacks the before-snapshot. Log at
                    // warn level so devs see it during smoke tests without
                    // it looking like an error.
                    console.warn('[InventoryManagement] Could not fetch existing item for audit-diff baseline (save will proceed without before-snapshot):', error?.message);
                }
            }

            if (itemToSave.id) {
                await api.put(`/inventory/${itemToSave.id}`, finalItem);
            } else {
                await api.post('/inventory', finalItem);
            }

            const changes = {
                stockBefore: existingItem?.stock,
                stockAfter: finalItem.stock,
                priceBefore: existingItem?.price,
                priceAfter: finalItem.price,
                stockChange: existingItem ? finalItem.stock - existingItem.stock : null,
                priceChange: existingItem ? finalItem.price - existingItem.price : null,
            };

            await logActivity(username, itemToSave.id ? 'Updated Inventory' : 'Created Inventory', `Item: ${finalItem?.name}`, changes);
            invalidateCache('inventory');
            setNotification({ type: 'success', message: itemToSave.id ? `Item "${finalItem.name}" updated successfully!` : `Item "${finalItem.name}" added successfully!` });
            setIsModalOpen(false);
            setEditingItem(null);
        } catch (error) {
            console.error('Error saving item:', error);
            setNotification({ type: 'error', message: 'Failed to save item. Please try again.' });
        }
    };

    const handleConfirmDelete = async () => {
        if (deletingItemId) {
            try {
                let deletedItem = null;
                const getResponse = await api.get(`/inventory/${deletingItemId}`);
                if (getResponse.success) deletedItem = getResponse.data;

                await api.delete(`/inventory/${deletingItemId}`);

                if (deletedItem) {
                    await logActivity(username, 'Deleted Inventory', `Deleted item ${deletedItem?.name}`, {
                        impact: `Removed ${deletedItem.name} (SKU: ${deletingItemId})`,
                        financialImpact: { type: 'deletion', value: deletedItem.price * deletedItem.stock }
                    });
                }
                invalidateCache('inventory');
                setNotification({ type: 'success', message: `Item "${deletedItem?.name || deletingItemId}" deleted.` });
                setDeletingItemId(null);
            } catch (error) {
                console.error('Delete failed:', error);
                setNotification({ type: 'error', message: 'Delete failed. Item might be linked to invoices.' });
                setDeletingItemId(null);
            }
        }
    };

    const handleConfirmImport = async () => {
        if (!pendingImport) return;
        const items = pendingImport;
        const total = items.length;
        // Send the import in chunks to the bulk endpoint. Each chunk is ONE
        // HTTP request that MERGEs every row server-side and broadcasts a
        // single `inventory:updated`. The old code fired one POST per row —
        // 1000 rows meant 1000 requests + 1000 socket events, each forcing
        // every client to refetch and re-render the whole growing table.
        const CHUNK = 200;

        // Swap the confirmation dialog for the BLOCKING progress modal
        // immediately. The instant the import starts, the "Update & Add"
        // button is gone from the screen — so it can't be clicked again,
        // and Cancel is no longer available either. That double-click on a
        // still-running import was exactly the double-data-entry the user
        // hit. The progress modal then shows a live spinner + bar + count.
        setPendingImport(null);
        setImportProgress({ processed: 0, total, failed: 0, done: false, error: null });

        let attempted = 0;
        let failed = 0;
        try {
            for (let i = 0; i < total; i += CHUNK) {
                const batch = items.slice(i, i + CHUNK);
                try {
                    const res = await api.post('/inventory/bulk', { items: batch });
                    failed += (res && res.success) ? (res.data?.failed || 0) : batch.length;
                } catch (batchErr) {
                    // One batch failed (network blip / server error) — count
                    // the rows as failed but keep going so the rest still load.
                    failed += batch.length;
                    console.warn('[Inventory import] batch failed:', batchErr?.message);
                }
                attempted += batch.length;
                // Live progress — the modal re-renders with the new counts.
                setImportProgress(p => p && ({ ...p, processed: attempted, failed }));
            }

            await logActivity(username, 'Imported Inventory', `Bulk import: ${total} items`, { category: 'inventory' });
            invalidateCache('inventory');
            setImportProgress(p => p && ({ ...p, processed: total, failed, done: true }));
        } catch (error) {
            console.error('Import error:', error);
            const msg = error?.response?.data?.error || error?.message || 'Unknown error';
            setImportProgress(p => p && ({ ...p, processed: attempted, failed, done: true, error: msg }));
        }
    };

    const handleFileImport = (event) => {
        const file = event.target.files[0];
        if (!file) return;
        if (file.size > 50 * 1024 * 1024) { setNotification({ type: 'error', message: 'File size must be less than 50MB' }); return; }

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const text = e.target.result;
                const lines = text.split(/\r\n|\n/).filter(line => line.trim() !== '');
                if (lines.length < 2) { setNotification({ message: "Import file is empty or has no data rows." }); return; }

                const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));

                const importedInventory = lines.slice(1).map((rowStr) => {
                    const values = rowStr.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
                    if (values.length < 3) return null;

                    const item = {};
                    headers.forEach((header, i) => { item[header] = values[i]; });

                    if (!item.id || !item.name) return null;

                    return {
                        id: item.id,
                        name: item.name,
                        vendor: item.vendor || 'No Vendor',
                        stock: Math.max(0, parseInt(item.stock, 10) || 0),
                        price: Math.max(0, parseFloat(item.price) || 0),
                        restockLimit: Math.max(0, parseInt(item.restockLimit, 10) || 0),
                        currency: item.currency || 'GHS',
                        itemType: item.itemType || 'Hardware',
                        costComponents: {
                            insurancePerUnit: Math.max(0, parseFloat(item.insurance) || 0),
                            inboundFreightPerUnit: Math.max(0, parseFloat(item.freight) || 0),
                            dutyPerUnit: Math.max(0, parseFloat(item.duty) || 0),
                            handlingPerUnit: Math.max(0, parseFloat(item.handling) || 0),
                            transferAdminPerUnit: Math.max(0, parseFloat(item.transferAdmin) || 0),
                            packagingPerUnit: Math.max(0, parseFloat(item.packaging) || 0),
                            otherPerUnit: Math.max(0, parseFloat(item.other) || 0)
                        },
                        markupOverridePercent: item.markupOverride ? parseFloat(item.markupOverride) : null
                    };
                }).filter(Boolean);

                if (importedInventory.length > 0) {
                    setPendingImport(importedInventory);
                    setNotification({ type: 'success', message: `Parsed ${importedInventory.length} valid items.` });
                } else {
                    setNotification({ type: 'error', message: `No valid items found. Check CSV format.` });
                }
            } catch (error) {
                setNotification({ type: 'error', message: 'Error parsing CSV file.' });
            }
        };
        reader.readAsText(file, 'UTF-8');
        event.target.value = '';
    };

    // ... (Keep handleOpenModal, handleCloseModal, handleDeleteRequest, handleExportToCSV, etc. same as before) ...
    const handleOpenModal = (item = null) => { setEditingItem(item); setIsModalOpen(true); };
    const handleCloseModal = () => { setIsModalOpen(false); setEditingItem(null); };
    const handleDeleteRequest = (itemId) => setDeletingItemId(itemId);
    const handleCancelDelete = () => setDeletingItemId(null);
    const handleCancelImport = () => setPendingImport(null);
    const handleImportClick = () => fileInputRef.current.click();
    const handleExportToCSV = () => {
        const headers = ["id", "name", "vendor", "stock", "price", "restockLimit", "currency", "itemType", "insurance", "freight", "duty", "handling", "transferAdmin", "packaging", "other", "markupOverride"];
        const csvRows = [headers.join(','), ...inventory.map(item => {
            const vals = {
                id: item.id, name: item.name, vendor: item.vendor || '',
                stock: item.stock || 0, price: item.price || 0, restockLimit: item.restockLimit || 0,
                currency: item.currency || 'GHS', itemType: item.itemType || 'Hardware',
                insurance: item.costComponents?.insurancePerUnit || 0,
                freight: item.costComponents?.inboundFreightPerUnit || 0,
                duty: item.costComponents?.dutyPerUnit || 0,
                handling: item.costComponents?.handlingPerUnit || 0,
                transferAdmin: item.costComponents?.transferAdminPerUnit || 0,
                packaging: item.costComponents?.packagingPerUnit || 0,
                other: item.costComponents?.otherPerUnit || 0,
                markupOverride: item.markupOverridePercent || ''
            };
            return headers.map(h => `"${String(vals[h] || '').replace(/"/g, '""')}"`).join(',');
        })];
        const csvString = csvRows.join('\n');
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.setAttribute('hidden', ''); a.setAttribute('href', url);
        a.setAttribute('download', 'inventory_pricing.csv'); document.body.appendChild(a); a.click(); document.body.removeChild(a);
    };

    const [invField, setInvField] = useState('all');
    // Memoised so a new array isn't built on every render (a parent re-render
    // or a realtime tick would otherwise re-filter the whole list each time).
    const filteredInventory = useMemo(() => {
        if (!invSearch.trim()) return inventory;
        const q = invSearch.toLowerCase();
        return inventory.filter(item => {
            if (invField === 'sku') return (item.id || '').toLowerCase().includes(q);
            if (invField === 'name') return (item.name || '').toLowerCase().includes(q);
            return (item.id || '').toLowerCase().includes(q) || (item.name || '').toLowerCase().includes(q);
        });
    }, [inventory, invSearch, invField]);

    // Sortable header state — clicking a column cycles asc → desc → none.
    // We project numeric fields (stock, restockLimit, price) onto themselves
    // since they're already numbers; useSortable's default detection covers
    // strings via locale-aware comparison.
    const { sortKey, sortDir, toggle: toggleSort, sortedRows: sortedInventory } =
        useSortable(filteredInventory, null, 'asc');

    // ── Pagination ───────────────────────────────────────────────────────
    // A non-virtualised table of 1000+ <tr> nodes is what blanked the screen
    // when opening Inventory. Capping the rendered DOM to one page of rows
    // keeps the view responsive at any inventory size.
    const PAGE_SIZE = 50;
    const [page, setPage] = useState(1);
    const pageCount = Math.max(1, Math.ceil(sortedInventory.length / PAGE_SIZE));
    const safePage = Math.min(page, pageCount);

    // Snap back to page 1 whenever the result set or ordering changes.
    useEffect(() => { setPage(1); }, [invSearch, invField, sortKey, sortDir]);

    const pagedInventory = useMemo(
        () => sortedInventory.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
        [sortedInventory, safePage]
    );

    return (<>
        {notification && <Notification message={notification.message} type={notification.type} onDismiss={() => setNotification(null)} />}
        {isModalOpen && <ItemModal item={editingItem} onSave={handleSaveItem} onClose={handleCloseModal} />}
        {deletingItemId && <ConfirmationModal title="Confirm Deletion" message="This item will be permanently deleted." onConfirm={handleConfirmDelete} onCancel={handleCancelDelete} confirmText="Delete" confirmColor="bg-red-600 hover:bg-red-700" />}
        {pendingImport && <ConfirmationModal title="Confirm Import" message={`Found ${pendingImport.length} items. This will update/add to inventory.`} onConfirm={handleConfirmImport} onCancel={handleCancelImport} confirmText="Update & Add" confirmColor="bg-blue-600 hover:bg-blue-700" />}
        {importProgress && (
            <ImportProgressModal
                title="Importing inventory"
                processed={importProgress.processed}
                total={importProgress.total}
                failed={importProgress.failed}
                done={importProgress.done}
                error={importProgress.error}
                onClose={() => setImportProgress(null)}
            />
        )}
        <PageHeader
            title="Inventory Management"
            actions={
                <Button variant="ghost" size="sm" onClick={() => navigateTo('controllerDashboard')} leftIcon={<Icon id="arrow-left" />}>
                    Back to Dashboard
                </Button>
            }
        />
        <div className="bg-surface p-6 rounded-panel shadow-card border border-line">
            <div className="flex flex-wrap justify-between items-center mb-6 gap-4">
                <h2 className="text-xl font-semibold text-ink">All Inventory Items</h2>
                <div className="flex flex-wrap items-center gap-2"><input type="file" ref={fileInputRef} onChange={handleFileImport} className="hidden" accept=".csv" />
                    <Button variant="secondary" size="sm" onClick={handleImportClick}>Import</Button>
                    <Button variant="secondary" size="sm" onClick={handleExportToCSV}>Export</Button>
                    <Button variant="primary" size="sm" onClick={() => handleOpenModal()}>Add New</Button>
                    <div className="flex items-center gap-2 ml-2"><input value={invSearch} onChange={(e) => setInvSearch(e.target.value)} placeholder="Search inventory..." className="p-2 border border-line rounded-md text-sm w-56" />
                        <select value={invField} onChange={(e) => setInvField(e.target.value)} className="p-2 border border-line rounded-md text-sm"><option value="all">All</option>
                            <option value="sku">SKU</option><option value="name">Name</option></select></div></div></div><div className="overflow-x-auto">
                <table className="w-full text-left">
                    <thead className="bg-surface-sunken">
                        <tr>
                            <th className="p-4 text-left"><SortableHeader  label="SKU"        sortKey="id"          current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>
                            <th className="p-4 text-left"><SortableHeader  label="Item Name"  sortKey="name"        current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>
                            <th className="p-4 text-left"><SortableHeader  label="Vendor"     sortKey="vendor"      current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>
                            <th className="p-4 text-center"><SortableHeader label="Type"      sortKey="itemType"    current={sortKey} dir={sortDir} onToggle={toggleSort} align="center" /></th>
                            <th className="p-4 text-center"><SortableHeader label="Curr"      sortKey="currency"    current={sortKey} dir={sortDir} onToggle={toggleSort} align="center" /></th>
                            <th className="p-4 text-center"><SortableHeader label="Stock"     sortKey="stock"       current={sortKey} dir={sortDir} onToggle={toggleSort} align="center" /></th>
                            <th className="p-4 text-center"><SortableHeader label="Restock At" sortKey="restockLimit" current={sortKey} dir={sortDir} onToggle={toggleSort} align="center" /></th>
                            <th className="p-4 text-right"><SortableHeader  label="Price"     sortKey="price"       current={sortKey} dir={sortDir} onToggle={toggleSort} align="right" /></th>
                            <th className="p-4 font-semibold text-sm text-center text-n-600 uppercase tracking-wider text-[11px]">Actions</th>
                        </tr>
                    </thead>
                    <tbody>{pagedInventory.map((item) => (<tr key={item.id} className="border-b hover:bg-surface-sunken"><td className="p-4 text-sm">{item.id}</td>
                        <td className="p-4 font-medium">{item.name}</td><td className="p-4 text-sm">{item.vendor}</td>
                        <td className="p-4 text-sm text-center"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${(item.itemType || 'Hardware') === 'Hardware' ? 'bg-blue-100 text-blue-700' : (item.itemType || 'Hardware') === 'Software' ? 'bg-purple-100 text-purple-700' : 'bg-orange-100 text-orange-700'}`}>{item.itemType || 'Hardware'}</span></td>
                        <td className="p-4 text-sm text-center text-ink-muted">{item.currency || 'GHS'}</td>
                        <td className={`p-4 text-sm text-center font-semibold ${item.stock <= item.restockLimit ? 'text-red-600' : 'text-ink'}`}>{item.stock}</td>
                        <td className="p-4 text-sm text-center">{item.restockLimit}</td><td className="p-4 text-sm text-right">{formatCurrency(item.currency, item.price)}</td>
                        <td className="p-4 text-center space-x-4"><button onClick={() => handleOpenModal(item)} className="text-blue-600 font-medium">Edit</button>
                            <button onClick={() => handleDeleteRequest(item.id)} className="text-red-600 font-medium">Delete</button></td></tr>))}
                    </tbody>
                </table>
            </div>
            {/* Pagination — only PAGE_SIZE rows are ever in the DOM at once. */}
            <div className="flex flex-wrap items-center justify-between gap-3 mt-4 text-sm text-ink-muted">
                <span>
                    {sortedInventory.length === 0
                        ? (inventoryLoading ? 'Loading inventory…' : 'No items')
                        : `Showing ${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, sortedInventory.length)} of ${sortedInventory.length} items`}
                </span>
                <div className="flex items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setPage(1)} disabled={safePage <= 1}>« First</Button>
                    <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}>‹ Prev</Button>
                    <span className="px-2 whitespace-nowrap">Page {safePage} / {pageCount}</span>
                    <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.min(pageCount, p + 1))} disabled={safePage >= pageCount}>Next ›</Button>
                    <Button variant="secondary" size="sm" onClick={() => setPage(pageCount)} disabled={safePage >= pageCount}>Last »</Button>
                </div>
            </div>
        </div>
    </>
    );
};

export default InventoryManagement;
