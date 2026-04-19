import React, { useState } from 'react';

const VendorModal = ({ vendor, onSave, onClose }) => {
    const [formData, setFormData] = useState(vendor || {
        name: '',
        contactPerson: '',
        contactEmail: '',
        contactPhone: '',
        category: '',
        status: 'active',
        rating: 0,
        paymentTerms: '',
        leadTimeDays: 0,
        address: '',
        notes: ''
    });

    const handleChange = (e) => {
        const { name, value, type } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'number' ? parseFloat(value) || 0 : value
        }));
    };

    const handleSave = () => {
        if (!formData.name?.trim()) {
            alert('Vendor name is required.');
            return;
        }
        onSave({ ...formData, id: vendor?.id });
    };

    return (
        <div className="fixed inset-0 backdrop-blur bg-opacity-50 flex justify-center items-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl p-8 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                <h2 className="text-2xl font-bold text-gray-800 mb-6">{vendor ? 'Edit Vendor' : 'Add New Vendor'}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                        <label className="text-sm font-medium text-gray-700">Vendor Name *</label>
                        <input type="text" name="name" value={formData.name} onChange={handleChange} className="mt-1 w-full p-2 border rounded-md" />
                    </div>
                    <div>
                        <label className="text-sm font-medium text-gray-700">Contact Person</label>
                        <input type="text" name="contactPerson" value={formData.contactPerson} onChange={handleChange} className="mt-1 w-full p-2 border rounded-md" />
                    </div>
                    <div>
                        <label className="text-sm font-medium text-gray-700">Contact Email</label>
                        <input type="email" name="contactEmail" value={formData.contactEmail} onChange={handleChange} className="mt-1 w-full p-2 border rounded-md" />
                    </div>
                    <div>
                        <label className="text-sm font-medium text-gray-700">Contact Phone</label>
                        <input type="text" name="contactPhone" value={formData.contactPhone} onChange={handleChange} className="mt-1 w-full p-2 border rounded-md" />
                    </div>
                    <div>
                        <label className="text-sm font-medium text-gray-700">Category</label>
                        <input type="text" name="category" value={formData.category} onChange={handleChange} placeholder="e.g. Pumps, Electrical" className="mt-1 w-full p-2 border rounded-md" />
                    </div>
                    <div>
                        <label className="text-sm font-medium text-gray-700">Status</label>
                        <select name="status" value={formData.status} onChange={handleChange} className="mt-1 w-full p-2 border rounded-md">
                            <option value="active">Active</option>
                            <option value="inactive">Inactive</option>
                            <option value="suspended">Suspended</option>
                        </select>
                    </div>
                    <div>
                        <label className="text-sm font-medium text-gray-700">Rating (0-5)</label>
                        <input type="number" min="0" max="5" step="0.5" name="rating" value={formData.rating} onChange={handleChange} className="mt-1 w-full p-2 border rounded-md" />
                    </div>
                    <div>
                        <label className="text-sm font-medium text-gray-700">Typical Lead Time (days)</label>
                        <input type="number" min="0" name="leadTimeDays" value={formData.leadTimeDays} onChange={handleChange} className="mt-1 w-full p-2 border rounded-md" />
                    </div>
                    <div>
                        <label className="text-sm font-medium text-gray-700">Payment Terms</label>
                        <input type="text" name="paymentTerms" value={formData.paymentTerms} onChange={handleChange} placeholder="e.g. Net 30" className="mt-1 w-full p-2 border rounded-md" />
                    </div>
                    <div className="md:col-span-2">
                        <label className="text-sm font-medium text-gray-700">Address</label>
                        <input type="text" name="address" value={formData.address} onChange={handleChange} className="mt-1 w-full p-2 border rounded-md" />
                    </div>
                    <div className="md:col-span-2">
                        <label className="text-sm font-medium text-gray-700">Notes</label>
                        <textarea name="notes" value={formData.notes} onChange={handleChange} rows="3" className="mt-1 w-full p-2 border rounded-md" />
                    </div>
                </div>
                <div className="mt-8 flex justify-end space-x-4">
                    <button onClick={onClose} className="py-2 px-4 border rounded-md">Cancel</button>
                    <button onClick={handleSave} className="py-2 px-4 text-white bg-blue-600 rounded-md">Save Vendor</button>
                </div>
            </div>
        </div>
    );
};

export default VendorModal;
