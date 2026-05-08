import React, { useState, useRef, useMemo } from 'react';
import api from '../api';
import Icon from '../components/common/Icon';
import PageHeader from '../components/common/PageHeader';
import Button from '../components/common/Button';
import Notification from '../components/common/Notification';
import CustomerModal from '../components/modals/CustomerModal';
import ConfirmationModal from '../components/modals/ConfirmationModal';
import { logActivity } from '../utils/logger';
import { invalidateCache } from '../utils/cache';
import { useRealtimeCustomers } from '../hooks/useRealtimeCustomers';
import { useDebounce } from '../hooks/useDebounce';
import { useActivityLog } from '../hooks/useActivityLog';
import { useApp } from '../context/AppContext';
import { SortableHeader, useSortable } from '../components/v2';

const CustomerManagement = ({ navigateTo, userId }) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingCustomer, setEditingCustomer] = useState(null);
    const [pendingImport, setPendingImport] = useState(null);
    const [notification, setNotification] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [deletingCustomer, setDeletingCustomer] = useState(null);
    const fileInputRef = useRef(null);
    const { userEmail } = useApp();
    const username = userEmail ? userEmail.split('@')[0] : (userId || 'System');

    // Debounced search for better performance
    const debouncedSearchTerm = useDebounce(searchTerm, 1000); // Increased delay for logging

    // Logging
    const { log } = useActivityLog();
    React.useEffect(() => {
        if (debouncedSearchTerm && debouncedSearchTerm.trim().length > 2) {
            log('SEARCH_QUERY', `Searched customers for: "${debouncedSearchTerm}"`, {
                category: 'user_action',
                searchDetails: {
                    term: debouncedSearchTerm,
                    context: 'customers'
                }
            });
        }
    }, [debouncedSearchTerm, log]);

    // Real-time customer data fetching for immediate updates
    const { data: customers, loading: customersLoading } = useRealtimeCustomers();
    const handleOpenModal = (customer = null) => { setEditingCustomer(customer); setIsModalOpen(true); };
    const handleCloseModal = () => { setIsModalOpen(false); setEditingCustomer(null); };
    const handleSaveCustomer = async (customerToSave) => {
        try {
            const id = customerToSave.id || `CUST-${Date.now()}`;
            const finalCustomer = { ...customerToSave, id };

            if (customerToSave.id) {
                // Update existing
                await api.put(`/customers/${customerToSave.id}`, finalCustomer);
            } else {
                // Create new
                await api.post('/customers', finalCustomer);
            }

            await logActivity(username, customerToSave.id ? 'Updated Customer' : 'Created Customer', `Customer: ${finalCustomer.name}`);

            // Invalidate cache for other components
            invalidateCache('customers');

            setNotification({
                type: 'success',
                message: customerToSave.id ?
                    `Customer "${finalCustomer.name}" updated successfully!` :
                    `Customer "${finalCustomer.name}" added successfully!`
            });

            handleCloseModal();
        } catch (error) {
            console.error('Error saving customer:', error);
            setNotification({
                type: 'error',
                message: 'Failed to save customer. Please try again.'
            });
        }
    };
    const handleConfirmImport = async () => {
        if (!pendingImport) return;
        try {
            // Sequential API calls for import (or could use a bulk endpoint if available)
            for (const customer of pendingImport) {
                // We use POST and assume the backend handles duplicates or we check first
                // For simplicity, we just try to save each one
                await api.post('/customers', customer).catch(err => {
                    // If it fails (e.g. 409 Conflict), try PUT
                    return api.put(`/customers/${customer.id}`, customer);
                });
            }
            logActivity(username, 'Imported Customers', `Imported ${pendingImport.length} customers.`);

            invalidateCache('customers');
            setNotification({ type: 'success', message: `Imported ${pendingImport.length} customers successfully.` });
            setPendingImport(null);
        } catch (error) {
            console.error('Import failed:', error);
            setNotification({ type: 'error', message: 'Import failed partially or fully. Check logs.' });
        }
    };
    const handleExportToCSV = () => {
        const headers = ["id", "name", "contactPerson", "contactEmail", "location", "poBox", "region", "address"];
        const csvRows = [headers.join(','), ...customers.map(item => headers.map(header => `"${String(item[header] || '').replace(/"/g, '""')}"`).join(','))];
        const csvString = csvRows.join('\n');
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.setAttribute('hidden', '');
        a.setAttribute('href', url);
        a.setAttribute('download', 'customers.csv');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };
    const handleImportClick = () => fileInputRef.current.click();
    const handleFileImport = (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target.result;
            const lines = text.split(/\r\n|\n/).filter(line => line.trim() !== '');
            if (lines.length < 2) {
                setNotification({ message: "Import file is empty." });
                return;
            }
            const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
            const expectedHeaders = ["id", "name", "contactPerson", "contactEmail", "location", "poBox", "region", "address"];
            if (headers.length !== expectedHeaders.length || !expectedHeaders.every((h, i) => h === headers[i])) {
                setNotification({ message: "Invalid CSV format or headers." });
                return;
            }
            const imported = lines.slice(1).map(rowStr => {
                const values = rowStr.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || [];
                if (values.length !== headers.length) return null;
                const item = {};
                headers.forEach((header, i) => {
                    item[header] = values[i].replace(/^"|"$/g, '').trim();
                });
                if (!item.id || !item.name) return null;
                return { ...item };
            }).filter(Boolean);
            if (imported.length > 0) setPendingImport(imported);
            else setNotification({ message: "Could not find any valid items in the file." });
        };
        reader.readAsText(file);
        event.target.value = '';
    };

    // Filter customers based on debounced search term
    const filteredCustomers = useMemo(() => {
        if (!debouncedSearchTerm.trim()) return customers;
        const term = debouncedSearchTerm.toLowerCase();
        return customers.filter(customer =>
            customer.name?.toLowerCase().includes(term) ||
            customer.contactPerson?.toLowerCase().includes(term) ||
            customer.contactEmail?.toLowerCase().includes(term) ||
            customer.id?.toLowerCase().includes(term)
        );
    }, [customers, debouncedSearchTerm]);

    const { sortKey, sortDir, toggle: toggleSort, sortedRows: sortedCustomers } =
        useSortable(filteredCustomers, 'name', 'asc');

    // Handle customer deletion
    const handleDeleteCustomer = async (customer) => {
        try {
            // Delete via API
            const response = await api.delete(`/customers/${customer.id}`);
            
            if (!response.success && response.error?.includes('foreign key')) {
                setNotification({
                    type: 'error',
                    message: `Cannot delete customer "${customer.name}" because they have existing invoices.`
                });
                return;
            }

            await logActivity(username, 'Deleted Customer', `Deleted customer ${customer.name}`);
            setNotification({
                type: 'success',
                message: `Customer "${customer.name}" has been deleted successfully.`
            });
            invalidateCache('customers');
            setDeletingCustomer(null);
        } catch (error) {
            console.error('Error deleting customer:', error);
            // Handle Oracle foreign key error specifically if possible
            const errorMsg = error.response?.data?.error || '';
            if (errorMsg.includes('ORA-02292')) {
                setNotification({
                    type: 'error',
                    message: `Cannot delete customer "${customer.name}" because they have existing invoices in Oracle.`
                });
            } else {
                setNotification({
                    type: 'error',
                    message: 'Failed to delete customer. Please try again.'
                });
            }
        }
    };

    return (
        <>
            {notification && <Notification message={notification.message} type={notification.type} onDismiss={() => setNotification(null)} />}
            {isModalOpen && <CustomerModal customer={editingCustomer} onSave={handleSaveCustomer} onClose={handleCloseModal} />}
            {pendingImport && <ConfirmationModal title="Confirm Import" message={`Found ${pendingImport.length} customers. This will update existing and add new ones.`} onConfirm={handleConfirmImport} onCancel={() => setPendingImport(null)} confirmText="Update & Add" confirmColor="bg-blue-600" />}
            {deletingCustomer && <ConfirmationModal title="Confirm Delete" message={`Are you sure you want to delete customer "${deletingCustomer.name}"? This action cannot be undone.`} onConfirm={() => handleDeleteCustomer(deletingCustomer)} onCancel={() => setDeletingCustomer(null)} confirmText="Delete" confirmColor="bg-red-600" />}

            <PageHeader
                title="Customer Management"
                actions={
                    <Button variant="ghost" size="sm" onClick={() => navigateTo('controllerDashboard')} leftIcon={<Icon id="arrow-left" />}>
                        Back
                    </Button>
                }
            />

            <div className="bg-surface p-6 rounded-panel shadow-card border border-line">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold text-ink">All Customers</h2>
                    <div className="flex items-center space-x-2">
                        <input type="file" ref={fileInputRef} onChange={handleFileImport} className="hidden" accept=".csv" />
                        <Button variant="secondary" size="sm" onClick={handleImportClick}>Import</Button>
                        <Button variant="secondary" size="sm" onClick={handleExportToCSV}>Export</Button>
                        <Button variant="secondary" size="sm" onClick={() => invalidateCache('customers')} leftIcon={<Icon id="sync-alt" />} title="Refresh customer data">
                            Refresh
                        </Button>
                        <Button variant="primary" size="sm" onClick={() => handleOpenModal()} leftIcon={<Icon id="plus" />}>
                            Add New
                        </Button>
                    </div>
                </div>

                {/* Search Bar */}
                <div className="mb-4">
                    <input
                        type="text"
                        placeholder="Search customers by name, contact, email, or ID..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full p-3 border border-line rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                    {searchTerm && (
                        <div className="mt-2 text-sm text-ink-muted">
                            Showing {filteredCustomers.length} of {customers.length} customers
                        </div>
                    )}
                </div>

                <div className="overflow-x-auto">
                    {customersLoading ? (
                        <div className="text-center py-8">
                            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                            <p className="mt-2 text-ink-muted">Loading customers...</p>
                        </div>
                    ) : (
                        <table className="w-full text-left">
                            <thead className="bg-surface-sunken">
                                <tr>
                                    <th className="p-3 text-left"><SortableHeader label="ID"      sortKey="id"            current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>
                                    <th className="p-3 text-left"><SortableHeader label="Name"    sortKey="name"          current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>
                                    <th className="p-3 text-left"><SortableHeader label="Contact" sortKey="contactPerson" current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>
                                    <th className="p-3 text-left"><SortableHeader label="Email"   sortKey="contactEmail"  current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>
                                    <th className="p-3 font-semibold text-[11px] text-n-600 uppercase tracking-wider text-center">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedCustomers.map(c => (
                                    <tr key={c.id} className="border-b hover:bg-surface-sunken">
                                        <td className="p-3 text-xs">{c.id}</td>
                                        <td className="p-3 font-medium">{c.name}</td>
                                        <td className="p-3">{c.contactPerson}</td>
                                        <td className="p-3">{c.contactEmail}</td>
                                        <td className="p-3 text-center space-x-4">
                                            <button onClick={() => navigateTo('customerPortal', c.id)} className="text-green-600 font-medium">View Portal</button>
                                            <button onClick={() => handleOpenModal(c)} className="text-blue-600 font-medium">Edit</button>
                                            <button onClick={() => setDeletingCustomer(c)} className="text-red-600 font-medium">Delete</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </>
    );
};

export default CustomerManagement;
