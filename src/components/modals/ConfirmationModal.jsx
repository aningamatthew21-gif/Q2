import React, { useRef } from 'react';
import GlassModal from '../common/GlassModal';
import Button from '../common/Button';

/**
 * L5 — Confirmation modal.
 *
 * Phase B of the UI restyle moves all modals onto GlassModal so they
 * share the Apple liquid-glass language. The keyboard/focus/scroll-lock
 * behavior that used to live inline here is now provided by GlassModal,
 * so this file is just a thin shell over it.
 *
 * Prop contract is identical to the pre-migration version — every
 * existing call site (CustomerManagement, VendorManagement,
 * InvoiceEditor, InventoryManagement, PurchaseRequisitionDetail,
 * RFQDetail, QuotingModule) keeps working without changes.
 *
 *   - confirmColor is kept for backward compat. If it contains "red"
 *     we render the confirm button with Button variant="danger";
 *     otherwise variant="primary". The className is also forwarded so
 *     callers that pass custom tone classes still get them.
 */
const ConfirmationModal = ({
    onConfirm,
    onCancel,
    title,
    message,
    confirmText,
    confirmColor = ''
}) => {
    const confirmRef = useRef(null);

    // Map the legacy confirmColor className to a Button variant.
    const variant = /red/i.test(confirmColor) ? 'danger' : 'primary';

    const footer = (
        <>
            <Button variant="secondary" onClick={onCancel}>Cancel</Button>
            <Button
                ref={confirmRef}
                variant={variant}
                onClick={onConfirm}
            >
                {confirmText}
            </Button>
        </>
    );

    return (
        <GlassModal
            open
            onClose={onCancel}
            title={title}
            size="sm"
            footer={footer}
            initialFocusRef={confirmRef}
            hideCloseButton
        >
            <p className="text-ink-muted">{message}</p>
        </GlassModal>
    );
};

export default ConfirmationModal;
