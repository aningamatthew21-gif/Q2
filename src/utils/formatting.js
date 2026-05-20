export const formatCurrency = (currency, amount) => {

    if (!currency || typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency.trim())) {
        currency = 'GHS';
    } else {
        currency = currency.trim();
    }

    const numAmount = Number(amount);
    if (isNaN(numAmount) || !isFinite(numAmount)) {
        console.warn('⚠️ [WARNING] formatCurrency: Invalid amount', { amount, numAmount });
        return 'GH₵0.00';
    }
    const locale = currency === 'USD' ? 'en-US' : 'en-GH';
    if (currency === 'GHS') {
        // L8 — always render with thousand separators so "4473334.69" shows as "4,473,334.69".
        // Intl.NumberFormat handles grouping per locale; we still prefix with "GH₵" because
        // Ghana's own en-GH locale renders the ISO "GHS" token ahead of the number instead
        // of the symbol the business expects on invoices.
        return 'GH₵' + numAmount.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }
    return new Intl.NumberFormat(locale, { style: 'currency', currency: currency }).format(numAmount);
};

/**
 * L4 — canonical date formatters so every page renders dates identically.
 * Prefer these over ad-hoc `toLocaleDateString` / `new Intl.DateTimeFormat` calls.
 *
 *   formatDate(value)      -> "18 Apr 2026"        (invoice lists, tables)
 *   formatDateTime(value)  -> "18 Apr 2026, 14:30" (audit rows, event times)
 *   formatDateShort(value) -> "18/04/26"           (tight columns)
 *
 * Accepts Date, ISO string, timestamp number, or Oracle-style string.
 * Returns '—' for null/invalid input so the UI never shows "Invalid Date".
 */
const _toDate = (value) => {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(value);
    return isNaN(d.getTime()) ? null : d;
};

export const formatDate = (value) => {
    const d = _toDate(value);
    if (!d) return '—';
    return new Intl.DateTimeFormat('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric'
    }).format(d);
};

export const formatDateTime = (value) => {
    const d = _toDate(value);
    if (!d) return '—';
    return new Intl.DateTimeFormat('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false
    }).format(d);
};

export const formatDateShort = (value) => {
    const d = _toDate(value);
    if (!d) return '—';
    return new Intl.DateTimeFormat('en-GB', {
        day: '2-digit', month: '2-digit', year: '2-digit'
    }).format(d);
};
