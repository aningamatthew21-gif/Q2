import React, { useState } from 'react';
import GlassModal from '../common/GlassModal';
import Button from '../common/Button';

const INPUT_CLASS = 'mt-1 w-full p-2 border border-line rounded-card focus:ring-2 focus:ring-primary focus:border-primary outline-none bg-surface';
const LABEL_CLASS = 'text-sm font-medium text-ink-muted';

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

    const footer = (
        <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={handleSave}>Save Customer</Button>
        </>
    );

    return (
        <GlassModal
            open
            onClose={onClose}
            title={customer ? 'Edit Customer' : 'Add New Customer'}
            size="lg"
            footer={footer}
        >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                    <label className={LABEL_CLASS}>Customer Name</label>
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
                    <label className={LABEL_CLASS}>Location</label>
                    <input type="text" name="location" value={formData.location} onChange={handleChange} className={INPUT_CLASS} />
                </div>
                <div>
                    <label className={LABEL_CLASS}>P.O. Box</label>
                    <input type="text" name="poBox" value={formData.poBox} onChange={handleChange} className={INPUT_CLASS} />
                </div>
                <div>
                    <label className={LABEL_CLASS}>Region</label>
                    <input type="text" name="region" value={formData.region} onChange={handleChange} className={INPUT_CLASS} />
                </div>
                <div className="md:col-span-2">
                    <label className={LABEL_CLASS}>Address</label>
                    <input type="text" name="address" value={formData.address} onChange={handleChange} className={INPUT_CLASS} />
                </div>
            </div>
        </GlassModal>
    );
};

export default CustomerModal;
