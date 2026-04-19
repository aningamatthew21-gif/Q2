import React, { useState, useMemo } from 'react';
import api from '../api';
import Icon from '../components/common/Icon';
import Notification from '../components/common/Notification';
import VendorModal from '../components/modals/VendorModal';
import ConfirmationModal from '../components/modals/ConfirmationModal';
import { logActivity } from '../utils/logger';
import { invalidateCache } from '../utils/cache';
import { useRealtimeVendors } from '../hooks/useRealtimeVendors';
import { useDebounce } from '../hooks/useDebounce';
import { useApp } from '../context/AppContext';

const VendorManagement = ({ navigateTo, userId, currentUser }) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingVendor, setEditingVendor] = useState(null);
    const [notification, setNotification] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [deletingVendor, setDeletingVendor] = useState(null);
    const { userEmail } = useApp();
    const username = userEmail ? userEmail.split('@')[0] : (userId || 'System');

    const debouncedSearchTerm = useDebounce(searchTerm, 400);
    const { data: vendors, loading: vendorsLoading } = useRealtimeVendors();

    const role = currentUser?.role;
    const canDelete = role === 'controller' || role === 'admin';
    const backPage = role === 'procurement' ? 'procurementDashboard' : 'controllerDashboard';

    const handleOpenModal = (vendor = null) => { setEditingVendor(vendor); setIsModalOpen(true); };
    const handleCloseModal = () => { setIsModalOpen(false); setEditingVendor(null); };

    const handleSaveVendor = async (vendorToSave) => {
        try {
            if (vendorToSave.id) {
                await api.put(`/vendors/${vendorToSave.id}`, vendorToSave);
            } else {
                await api.post('/vendors', vendorToSave);
            }
            await logActivity(username, vendorToSave.id ? 'Updated Vendor' : 'Created Vendor', `Vendor: ${vendorToSave.name}`);
            invalidateCache('vendors');
            setNotification({
                type: 'success',
                message: vendorToSave.id
                    ? `Vendor "${vendorToSave.name}" updated successfully!`
                    : `Vendor "${vendorToSave.name}" added successfully!`
            });
            handleCloseModal();
        } catch (error) {
            console.error('Error saving vendor:', error);
            setNotification({ type: 'error', message: 'Failed to save vendor. Please try again.' });
        }
    };

    const handleDeleteVendor = async (vendor) => {
        try {
            await api.delete(`/vendors/${vendor.id}`);
            await logActivity(username, 'Deactivated Vendor', `Vendor: ${vendor.name}`);
            setNotification({
                type: 'success',
                message: `Vendor "${vendor.name}" has been deactivated.`
            });
            invalidateCache('vendors');
            setDeletingVendor(null);
        } catch (error) {
            console.error('Error deleting vendor:', error);
            setNotification({ type: 'error', message: 'Failed to deactivate vendor.' });
        }
    };

    const filteredVendors = useMemo(() => {
        if (!debouncedSearchTerm.trim()) return vendors;
        const term = debouncedSearchTerm.toLowerCase();
        return vendors.filter(v =>
            v.name?.toLowerCase().includes(term) ||
            v.contactPerson?.toLowerCase().includes(term) ||
            v.contactEmail?.toLowerCase().includes(term) ||
            v.category?.toLowerCase().includes(term)
        );
    }, [vendors, debouncedSearchTerm]);

    return (
        <div className="min-h-screen bg-gray-100">
            <div className="max-w-7xl mx-auto p-4 md:p-8">
                {notification && <Notification message={notification.message} type={notification.type} onDismiss={() => setNotification(null)} />}
                {isModalOpen && <VendorModal vendor={editingVendor} onSave={handleSaveVendor} onClose={handleCloseModal} />}
                {deletingVendor && (
                    <ConfirmationModal
                        title="Confirm Deactivation"
                        message={`Deactivate vendor "${deletingVendor.name}"? They will be hidden from RFQ selection but historical records are preserved.`}
                        onConfirm={() => handleDeleteVendor(deletingVendor)}
                        onCancel={() => setDeletingVendor(null)}
                        confirmText="Deactivate"
                        confirmColor="bg-red-600"
                    />
                )}

                <header className="bg-white p-4 rounded-xl shadow-md mb-8 flex justify-between items-center">
                    <h1 className="text-2xl font-bold">Vendor Management</h1>
                    <button onClick={() => navigateTo(backPage)} className="text-sm">
                        <Icon id="arrow-left" className="mr-1" /> Back
                    </button>
                </header>

                <div className="bg-white p-6 rounded-xl shadow-md">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-semibold">All Vendors</h2>
                        <button onClick={() => handleOpenModal()} className="py-2 px-4 text-white bg-blue-600 rounded-md text-sm">
                            <Icon id="plus" className="mr-2" />Add Vendor
                        </button>
                    </div>

                    <div className="mb-4">
                        <input
                            type="text"
                            placeholder="Search vendors by name, contact, email, or category..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full p-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        {searchTerm && (
                            <div className="mt-2 text-sm text-gray-600">
                                Showing {filteredVendors.length} of {vendors.length} vendors
                            </div>
                        )}
                    </div>

                    <div className="overflow-x-auto">
                        {vendorsLoading ? (
                            <div className="text-center py-8">
                                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                                <p className="mt-2 text-gray-600">Loading vendors...</p>
                            </div>
                        ) : (
                            <table className="w-full text-left">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="p-3 font-semibold">Name</th>
                                        <th className="p-3 font-semibold">Category</th>
                                        <th className="p-3 font-semibold">Contact</th>
                                        <th className="p-3 font-semibold">Email</th>
                                        <th className="p-3 font-semibold text-center">Rating</th>
                                        <th className="p-3 font-semibold text-center">Lead Time</th>
                                        <th className="p-3 font-semibold text-center">Status</th>
                                        <th className="p-3 font-semibold text-center">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredVendors.map(v => (
                                        <tr key={v.id} className="border-b hover:bg-gray-50">
                                            <td className="p-3 font-medium">{v.name}</td>
                                            <td className="p-3">{v.category || '—'}</td>
                                            <td className="p-3">{v.contactPerson || '—'}</td>
                                            <td className="p-3">{v.contactEmail || '—'}</td>
                                            <td className="p-3 text-center">{Number(v.rating || 0).toFixed(1)} ★</td>
                                            <td className="p-3 text-center">{v.leadTimeDays || 0}d</td>
                                            <td className="p-3 text-center">
                                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                                    v.status === 'active' ? 'bg-green-100 text-green-800' :
                                                    v.status === 'suspended' ? 'bg-yellow-100 text-yellow-800' :
                                                    'bg-gray-100 text-gray-600'
                                                }`}>
                                                    {v.status}
                                                </span>
                                            </td>
                                            <td className="p-3 text-center space-x-4">
                                                <button onClick={() => handleOpenModal(v)} className="text-blue-600 font-medium">Edit</button>
                                                {canDelete && (
                                                    <button onClick={() => setDeletingVendor(v)} className="text-red-600 font-medium">Deactivate</button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                    {filteredVendors.length === 0 && (
                                        <tr>
                                            <td colSpan="8" className="p-6 text-center text-gray-500">
                                                No vendors found. Click "Add Vendor" to create one.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default VendorManagement;
