import React, { useState } from 'react';
import GlassModal from '../common/GlassModal';
import Button from '../common/Button';
import Label from '../v2/Label';

const INPUT_CLASS = 'mt-1 w-full p-2 border border-line rounded-card focus:ring-2 focus:ring-primary focus:border-primary outline-none bg-surface';
const LABEL_CLASS = 'text-sm font-medium text-ink-muted';

// Module 1 — controlled vocabularies for industry, size band, and payment
// terms. Kept in this file rather than a shared constants module because
// they are UI-only (the backend accepts any string). Promoting to a master
// table is a Module 4 concern.
const PAYMENT_TERMS_OPTIONS = [
    'Due on receipt', 'Net 7', 'Net 14', 'Net 30', 'Net 45', 'Net 60', 'Net 90', 'Custom'
];
const INDUSTRY_OPTIONS = [
    '', 'Banking', 'Telecom', 'Government', 'NGO', 'Healthcare',
    'Manufacturing', 'Retail', 'Education', 'Hospitality', 'Other'
];
const SIZE_BAND_OPTIONS = ['', 'Micro', 'Small', 'Medium', 'Large', 'Enterprise'];

const CustomerModal = ({ customer, onSave, onClose }) => {
    const [formData, setFormData] = useState(customer || {
        name: '',
        contactPerson: '',
        contactEmail: '',
        location: '',
        poBox: '',
        region: '',
        address: '',
        // Module 1 — master-data defaults for new customers
        tin: '',
        defaultPaymentTerms: 'Net 30',
        creditLimit: 0,
        creditHold: false,
        industry: '',
        sizeBand: '',
        whtProfileCode: ''
    });
    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        let finalValue;
        if (type === 'checkbox') {
            finalValue = checked;
        } else if (type === 'number') {
            finalValue = parseFloat(value) || 0;
        } else {
            finalValue = value;
        }
        setFormData(prev => ({ ...prev, [name]: finalValue }));
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
                    <Label className={LABEL_CLASS} required>Customer Name</Label>
                    <input type="text" name="name" value={formData.name} onChange={handleChange} className={INPUT_CLASS} />
                </div>
                <div>
                    <label className={LABEL_CLASS}>Contact Person</label>
                    <input type="text" name="contactPerson" value={formData.contactPerson} onChange={handleChange} className={INPUT_CLASS} />
                </div>
                <div>
                    <Label className={LABEL_CLASS} required>Contact Email</Label>
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

                {/* ── Module 1 — billing & segmentation ─────────────────
                    Visually separated by a top border so the new fields read
                    as a distinct "Billing & Classification" section, not
                    crammed into the contact-info row. */}
                <div className="md:col-span-2 mt-2 pt-4 border-t border-line">
                    <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3">
                        Billing &amp; Classification
                    </h3>
                </div>

                <div>
                    <label className={LABEL_CLASS}>TIN (Taxpayer ID)</label>
                    <input
                        type="text"
                        name="tin"
                        value={formData.tin || ''}
                        onChange={handleChange}
                        className={INPUT_CLASS}
                        placeholder="e.g. C0001234567"
                    />
                </div>
                <div>
                    <label className={LABEL_CLASS}>Default Payment Terms</label>
                    <select
                        name="defaultPaymentTerms"
                        value={formData.defaultPaymentTerms || 'Net 30'}
                        onChange={handleChange}
                        className={INPUT_CLASS}
                    >
                        {PAYMENT_TERMS_OPTIONS.map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className={LABEL_CLASS}>Credit Limit (GHS)</label>
                    <input
                        type="number"
                        name="creditLimit"
                        value={formData.creditLimit || 0}
                        onChange={handleChange}
                        className={INPUT_CLASS}
                        min="0"
                        step="0.01"
                    />
                </div>
                <div className="flex items-end">
                    <label className="flex items-center gap-2 cursor-pointer pb-2">
                        <input
                            type="checkbox"
                            name="creditHold"
                            checked={!!formData.creditHold}
                            onChange={handleChange}
                            className="h-4 w-4 rounded border-line text-primary focus:ring-primary"
                        />
                        <span className="text-sm font-medium text-ink">Credit Hold (block new sales)</span>
                    </label>
                </div>
                <div>
                    <label className={LABEL_CLASS}>Industry</label>
                    <select
                        name="industry"
                        value={formData.industry || ''}
                        onChange={handleChange}
                        className={INPUT_CLASS}
                    >
                        {INDUSTRY_OPTIONS.map(opt => (
                            <option key={opt} value={opt}>{opt || '— Not set —'}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className={LABEL_CLASS}>Size Band</label>
                    <select
                        name="sizeBand"
                        value={formData.sizeBand || ''}
                        onChange={handleChange}
                        className={INPUT_CLASS}
                    >
                        {SIZE_BAND_OPTIONS.map(opt => (
                            <option key={opt} value={opt}>{opt || '— Not set —'}</option>
                        ))}
                    </select>
                </div>
                {/* WHT Profile Code field intentionally hidden — withholding
                    tax PREDICTION was removed in the Module 2 post-launch
                    cleanup. Finance officers now enter WHT lines manually
                    per payment via LogPaymentModal. The QA_CUSTOMERS column
                    stays in place so existing values are preserved for any
                    future re-introduction of automatic prediction.
                <div className="md:col-span-2">
                    <label className={LABEL_CLASS}>WHT Profile Code</label>
                    ...
                </div>
                */}
            </div>
        </GlassModal>
    );
};

export default CustomerModal;
