import api from '../api';

// Helper function to remove undefined values from objects
export const removeUndefinedValues = (obj) => {
    if (obj === null || obj === undefined) return null;
    if (typeof obj !== 'object') return obj;

    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
        if (value !== undefined) {
            cleaned[key] = removeUndefinedValues(value);
        }
    }
    return cleaned;
};

/**
 * Helper to safely extract a Date object from an invoice for sorting.
 * Handles ISO date strings and Oracle TIMESTAMP values.
 */
export const getInvoiceDate = (invoice) => {
    if (!invoice) return new Date(0);

    // 1. Priority: ISO timestamp from Oracle (CREATED_AT / UPDATED_AT)
    if (invoice.createdAt) {
        const d = new Date(invoice.createdAt);
        if (!isNaN(d)) return d;
    }

    // 2. Secondary: 'sentAt' or 'timestamp'  
    if (invoice.sentAt) {
        const d = new Date(invoice.sentAt);
        if (!isNaN(d)) return d;
    }

    // 3. Fallback: Date string field (handle DD/MM/YYYY format)
    if (typeof invoice.date === 'string') {
        const parts = invoice.date.split('/');
        if (parts.length === 3) {
            return new Date(parts[2], parts[1] - 1, parts[0]);
        }
        return new Date(invoice.date);
    }

    return new Date(0); // Default to old date to push to bottom
};

/**
 * Generates a temporary ID for new quotes/invoices.
 * Format: INV-YYYY-TIMESTAMP
 * Example: INV-2025-1732801234567
 */
export const generateTemporaryId = () => {
    const now = new Date();
    return `INV-${now.getFullYear()}-${now.getTime()}`;
};

/**
 * Generates a permanent approved ID.
 * Format: MIDSA-INV-{SEQ}-{YYYY}-{DD}-{TIME}
 * Example: MIDSA-INV-001-2025-28-1314
 */
export const generatePermanentId = (sequence) => {
    const now = new Date();
    const seq = String(sequence).padStart(3, '0');
    const year = now.getFullYear();
    const day = String(now.getDate()).padStart(2, '0');
    const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;

    return `MIDSA-INV-${seq}-${year}-${day}-${time}`;
};

/**
 * Gets the next sequence number from Oracle (atomic increment).
 */
export const getNextSequenceNumber = async () => {
    try {
        const response = await api.post('/settings/invoiceCounter');
        if (response.success) {
            return response.nextSeq;
        }
        throw new Error(response.error || 'Failed to get next sequence');
    } catch (error) {
        console.error("Error getting next sequence number:", error);
        throw error;
    }
};
