import React, { useState } from 'react';
import GlassModal from '../common/GlassModal';
import Button from '../common/Button';
import Label from '../v2/Label';

const QuantityModal = ({ item, onClose, onConfirm }) => {
    const [quantity, setQuantity] = useState(''); // Start with an empty string

    const handleQuantityChange = (e) => {
        const value = e.target.value;
        // Strict Validation: Allow empty string (for clearing) OR positive integers only
        if (value === '' || /^[1-9]\d*$/.test(value)) {
            setQuantity(value);
        }
    };

    const parsedQuantity = parseInt(quantity, 10);
    const isInvalid = isNaN(parsedQuantity) || parsedQuantity < 1;

    const handleConfirm = () => {
        if (!isInvalid) {
            onConfirm(item, parsedQuantity);
        }
    };

    const footer = (
        <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={handleConfirm} disabled={isInvalid}>
                Add to Quote
            </Button>
        </>
    );

    return (
        <GlassModal
            open
            onClose={onClose}
            title="Add Item to Quote"
            description={<>Enter quantity for: <span className="font-medium text-ink">{item.name}</span></>}
            size="sm"
            footer={footer}
        >
            <Label className="block text-sm font-medium text-ink-muted mb-1" required>Quantity</Label>
            <input
                type="number"
                value={quantity}
                onChange={handleQuantityChange}
                placeholder="Enter quantity..."
                className="w-full text-center text-lg p-2 border border-line rounded-card focus:ring-2 focus:ring-primary focus:border-primary outline-none"
                min="1"
                step="1"
                onKeyDown={(e) => {
                    if (['-', '.', 'e', 'E'].includes(e.key)) {
                        e.preventDefault();
                    }
                    if (e.key === 'Enter' && !isInvalid) {
                        handleConfirm();
                    }
                }}
                autoFocus
            />
        </GlassModal>
    );
};

export default QuantityModal;
