import React, { useState } from 'react';

const CustomerModal = ({ customer, onSave, onClose }) => {
    const [formData, setFormData] = useState(customer || {
        name: '',
        contactPerson: '',
        contactEmail: '',
        location: '',
        poBox: '',
        region: '',
        address: ''
    });
    const handleChange = (e) => {
        const { name, value, type } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'number' ? parseFloat(value) || 0 : value
        }));
    };
    const handleSave = () => {
        onSave({ ...formData, id: customer?.id });
    };
    return (
        <div className="fixed inset-0 backdrop-blur bg-opacity-50 flex justify-center items-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl p-8 w-full max-w-2xl">
                <h2 className="text-2xl font-bold text-gray-800 mb-6">{customer ? 'Edit Customer' : 'Add New Customer'}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                        <label className="text-sm font-medium text-gray-700">Customer Name</label>
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
                        <label className="text-sm font-medium text-gray-700">Location</label>
                        <input type="text" name="location" value={formData.location} onChange={handleChange} className="mt-1 w-full p-2 border rounded-md" />
                    </div>
                    <div>
                        <label className="text-sm font-medium text-gray-700">P.O. Box</label>
                        <input type="text" name="poBox" value={formData.poBox} onChange={handleChange} className="mt-1 w-full p-2 border rounded-md" />
                    </div>
                    <div>
                        <label className="text-sm font-medium text-gray-700">Region</label>
                        <input type="text" name="region" value={formData.region} onChange={handleChange} className="mt-1 w-full p-2 border rounded-md" />
                    </div>
                    <div className="md:col-span-2">
                        <label className="text-sm font-medium text-gray-700">Address</label>
                        <input type="text" name="address" value={formData.address} onChange={handleChange} className="mt-1 w-full p-2 border rounded-md" />
                    </div>
                </div>
                <div className="mt-8 flex justify-end space-x-4">
                    <button onClick={onClose} className="py-2 px-4 border rounded-md">Cancel</button>
                    <button onClick={handleSave} className="py-2 px-4 text-white bg-blue-600 rounded-md">Save Customer</button>
                </div>
            </div>
        </div>
    );
};

export default CustomerModal;
