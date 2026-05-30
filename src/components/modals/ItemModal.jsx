import React, { useState } from 'react';
import GlassModal from '../common/GlassModal';
import Button from '../common/Button';
import Label from '../v2/Label';

const ITEM_TYPES = ['Hardware', 'Software', 'Service'];
const CURRENCIES = ['USD', 'GHS', 'EUR', 'GBP'];

const INPUT_CLASS = 'mt-1 w-full p-2 border border-line rounded-card focus:ring-2 focus:ring-primary focus:border-primary outline-none bg-surface';
const LABEL_CLASS = 'text-sm font-medium text-ink-muted';

const ItemModal = ({ item, onSave, onClose }) => {
    const [formData, setFormData] = useState(item || {
        name: '', vendor: '', stock: 0, price: 0, restockLimit: 10,
        currency: 'GHS', itemType: 'Hardware', weightKg: 0,
        // Module 1 — item taxonomy (free text initially; promoted to
        // controlled vocabulary in Module 5 if fragmentation appears).
        itemCategory: '', itemSubcategory: ''
    });

    const handleChange = (e) => {
        const { name, value, type } = e.target;
        let finalValue = value;

        if (type === 'number') {
            const numVal = parseFloat(value);
            if (numVal < 0) return;
            finalValue = isNaN(numVal) ? '' : numVal;
        }

        setFormData(prev => ({ ...prev, [name]: finalValue }));
    };

    const handleSave = () => {
        const cleanData = {
            ...formData,
            id: item?.id,
            stock: Math.floor(Math.max(0, Number(formData.stock) || 0)),
            restockLimit: Math.floor(Math.max(0, Number(formData.restockLimit) || 0)),
            price: Math.max(0, Number(formData.price) || 0),
            weightKg: Math.max(0, Number(formData.weightKg) || 0),
            currency: formData.currency || 'GHS',
            itemType: formData.itemType || 'Hardware'
        };
        onSave(cleanData);
    };

    const footer = (
        <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={handleSave}>Save Item</Button>
        </>
    );

    return (
        <GlassModal
            open
            onClose={onClose}
            title={item ? 'Edit Item' : 'Add New Item'}
            size="md"
            footer={footer}
        >
            <div className="space-y-4">
                <div>
                    <Label className={LABEL_CLASS} required>Item Name</Label>
                    <input type="text" name="name" value={formData.name} onChange={handleChange} className={INPUT_CLASS} />
                </div>
                <div>
                    <label className={LABEL_CLASS}>Vendor</label>
                    <input type="text" name="vendor" value={formData.vendor} onChange={handleChange} className={INPUT_CLASS} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className={LABEL_CLASS}>Item Type</label>
                        <select name="itemType" value={formData.itemType || 'Hardware'} onChange={handleChange} className={INPUT_CLASS}>
                            {ITEM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className={LABEL_CLASS}>Currency</label>
                        <select name="currency" value={formData.currency || 'GHS'} onChange={handleChange} className={INPUT_CLASS}>
                            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <Label className={LABEL_CLASS} required>Price ({formData.currency || 'GHS'})</Label>
                        <input
                            type="number"
                            name="price"
                            value={formData.price}
                            onChange={handleChange}
                            className={INPUT_CLASS}
                            min="0"
                            step="0.01"
                            onKeyDown={(e) => ['-', 'e'].includes(e.key) && e.preventDefault()}
                        />
                    </div>
                    <div>
                        <label className={LABEL_CLASS}>Weight (kg)</label>
                        <input
                            type="number"
                            name="weightKg"
                            value={formData.weightKg || 0}
                            onChange={handleChange}
                            className={INPUT_CLASS}
                            min="0"
                            step="0.1"
                            onKeyDown={(e) => ['-', 'e'].includes(e.key) && e.preventDefault()}
                        />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className={LABEL_CLASS}>Stock</label>
                        <input
                            type="number"
                            name="stock"
                            value={formData.stock}
                            onChange={handleChange}
                            className={INPUT_CLASS}
                            min="0"
                            step="1"
                            onKeyDown={(e) => ['-', '.', 'e'].includes(e.key) && e.preventDefault()}
                        />
                    </div>
                    <div>
                        <label className={LABEL_CLASS}>Restock At</label>
                        <input
                            type="number"
                            name="restockLimit"
                            value={formData.restockLimit}
                            onChange={handleChange}
                            className={INPUT_CLASS}
                            min="0"
                            step="1"
                            onKeyDown={(e) => ['-', '.', 'e'].includes(e.key) && e.preventDefault()}
                        />
                    </div>
                </div>

                {/* Module 1 — item taxonomy. Two free-text inputs that feed
                    the Spend-by-Category report (Module 5). Free text rather
                    than a dropdown for now — we don't have a master category
                    table yet. Existing items get blank values until edited. */}
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className={LABEL_CLASS}>Category</label>
                        <input
                            type="text"
                            name="itemCategory"
                            value={formData.itemCategory || ''}
                            onChange={handleChange}
                            className={INPUT_CLASS}
                            placeholder="e.g. Networking, Power, Cabling"
                        />
                    </div>
                    <div>
                        <label className={LABEL_CLASS}>Subcategory (optional)</label>
                        <input
                            type="text"
                            name="itemSubcategory"
                            value={formData.itemSubcategory || ''}
                            onChange={handleChange}
                            className={INPUT_CLASS}
                            placeholder="e.g. Switches, UPS, Cat6"
                        />
                    </div>
                </div>
            </div>
        </GlassModal>
    );
};

export default ItemModal;
