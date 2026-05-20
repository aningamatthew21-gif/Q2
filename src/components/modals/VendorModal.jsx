import React, { useState } from 'react';
import GlassModal from '../common/GlassModal';
import Button from '../common/Button';

const INPUT_CLASS = 'mt-1 w-full p-2 border border-line rounded-card focus:ring-2 focus:ring-primary focus:border-primary outline-none bg-surface';
const LABEL_CLASS = 'text-sm font-medium text-ink-muted';

const VendorModal = ({ vendor, onSave, onClose }) => {
    const [validationError, setValidationError] = useState(null);
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
            setValidationError('Vendor name is required.');
            return;
        }
        setValidationError(null);
        onSave({ ...formData, id: vendor?.id });
    };

    const footer = (
        <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={handleSave}>Save Vendor</Button>
        </>
    );

    return (
        <GlassModal
            open
            onClose={onClose}
            title={vendor ? 'Edit Vendor' : 'Add New Vendor'}
            size="lg"
            footer={footer}
        >
            {validationError && (
                <div className="mb-3 p-2.5 rounded-md bg-red-50 border border-red-200 text-sm text-red-700">
                    {validationError}
                </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                    <label className={LABEL_CLASS}>Vendor Name *</label>
                    <input type="text" name="name" value={formData.name} onChange={handleChange} className={INPUT_CLASS} />
                </div>
                <div>
                    <label className={LABEL_CLASS}>Contact Person</label>
                    <input type="text" name="contactPerson" value={formData.contactPerson} onChange={handleChange} className={INPUT_CLASS} />
                </div>
                <div>
                    <label className={LABEL_CLASS}>Contact Email</label>
                    <input type="email" name="contactEmail" value={formData.contactEmail} onChange={handleChange} className={INPUT_CLASS} />
                </div>
                <div>
                    <label className={LABEL_CLASS}>Contact Phone</label>
                    <input type="text" name="contactPhone" value={formData.contactPhone} onChange={handleChange} className={INPUT_CLASS} />
                </div>
                <div>
                    <label className={LABEL_CLASS}>Category</label>
                    <input type="text" name="category" value={formData.category} onChange={handleChange} placeholder="e.g. Pumps, Electrical" className={INPUT_CLASS} />
                </div>
                <div>
                    <label className={LABEL_CLASS}>Status</label>
                    <select name="status" value={formData.status} onChange={handleChange} className={INPUT_CLASS}>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                        <option value="suspended">Suspended</option>
                    </select>
                </div>
                <div>
                    <label className={LABEL_CLASS}>Rating (0-5)</label>
                    <input type="number" min="0" max="5" step="0.5" name="rating" value={formData.rating} onChange={handleChange} className={INPUT_CLASS} />
                </div>
                <div>
                    <label className={LABEL_CLASS}>Typical Lead Time (days)</label>
                    <input type="number" min="0" name="leadTimeDays" value={formData.leadTimeDays} onChange={handleChange} className={INPUT_CLASS} />
                </div>
                <div>
                    <label className={LABEL_CLASS}>Payment Terms</label>
                    <input type="text" name="paymentTerms" value={formData.paymentTerms} onChange={handleChange} placeholder="e.g. Net 30" className={INPUT_CLASS} />
                </div>
                <div className="md:col-span-2">
                    <label className={LABEL_CLASS}>Address</label>
                    <input type="text" name="address" value={formData.address} onChange={handleChange} className={INPUT_CLASS} />
                </div>
                <div className="md:col-span-2">
                    <label className={LABEL_CLASS}>Notes</label>
                    <textarea name="notes" value={formData.notes} onChange={handleChange} rows="3" className={INPUT_CLASS} />
                </div>
            </div>
        </GlassModal>
    );
};

export default VendorModal;
