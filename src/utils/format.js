/**
 * src/utils/format.js — shared display formatters.
 *
 * Standards anchor:
 *   - ISO/IEC 25010 Maintainability — single source of truth means
 *     a currency-format change (e.g. "show 4 decimals for FX rates")
 *     happens in ONE place instead of 15+.
 *
 * Why this file exists:
 *   Every Module 5 report page was defining its own
 *
 *     const fmtMoney = (v) => Number(v || 0).toLocaleString(undefined, {
 *         minimumFractionDigits: 2, maximumFractionDigits: 2
 *     });
 *
 *   …which is 65 occurrences of the same code across 9 files. Drift
 *   risk: any page that forgets the `|| 0` fallback crashes on `null`.
 *   Any page that wants a different number of decimals diverges silently.
 *
 *   Centralised here so every formatter is correct and consistent.
 */

/**
 * Format a monetary value. Defaults to 2-decimal locale string.
 * Pass a currency to prepend it (e.g. `fmtMoney(1234.5, 'GHS')` →
 * `'GHS 1,234.50'`).
 *
 *   fmtMoney(1234.5)            → '1,234.50'
 *   fmtMoney(null)              → '0.00'
 *   fmtMoney(1234.5, 'GHS')     → 'GHS 1,234.50'
 *   fmtMoney(1234.5678, 'GHS', { decimals: 4 }) → 'GHS 1,234.5678'
 */
export function fmtMoney(value, currency = '', opts = {}) {
    const decimals = opts.decimals != null ? opts.decimals : 2;
    const n = Number(value || 0);
    const formatted = n.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
    return currency ? `${currency} ${formatted}` : formatted;
}

/**
 * Format an ISO date / Date / timestamp string as YYYY-MM-DD.
 * Null / undefined / invalid → '—'.
 *
 *   fmtDate('2026-05-25T14:30:00')  → '2026-05-25'
 *   fmtDate(null)                    → '—'
 *   fmtDate(new Date())              → '2026-05-25'
 */
export function fmtDate(value, fallback = '—') {
    if (!value) return fallback;
    try {
        const d = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(d.getTime())) return fallback;
        return d.toISOString().slice(0, 10);
    } catch (_) {
        return fallback;
    }
}

/**
 * Format a date+time as locale string (browser locale).
 *   fmtDateTime('2026-05-25T14:30:00')  → '5/25/2026, 2:30:00 PM'
 */
export function fmtDateTime(value, fallback = '—') {
    if (!value) return fallback;
    try {
        const d = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(d.getTime())) return fallback;
        return d.toLocaleString();
    } catch (_) {
        return fallback;
    }
}

/**
 * Format an integer with thousands separators.
 *   fmtNumber(1234567)  → '1,234,567'
 *   fmtNumber(null)     → '0'
 */
export function fmtNumber(value, decimals = 0) {
    const n = Number(value || 0);
    return n.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}

/**
 * Format a 0–100 number as a percent string.
 *   fmtPercent(78.45)  → '78.5 %'
 *   fmtPercent(null)   → '0.0 %'
 *
 * Pass `{ decimals: 0 }` for `78 %`.
 */
export function fmtPercent(value, opts = {}) {
    const decimals = opts.decimals != null ? opts.decimals : 1;
    return `${Number(value || 0).toFixed(decimals)} %`;
}

/**
 * Format a byte count human-readably.
 *   fmtBytes(1024)     → '1.0 KB'
 *   fmtBytes(1234567)  → '1.18 MB'
 *   fmtBytes(0)        → '0 B'
 */
export function fmtBytes(value) {
    const n = Number(value || 0);
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Truncate a string with ellipsis at a character budget.
 *   fmtTruncate('Hello world', 5)  → 'Hello…'
 *   fmtTruncate('Hi', 5)           → 'Hi'
 */
export function fmtTruncate(value, maxLen = 50) {
    const s = String(value || '');
    return s.length <= maxLen ? s : s.slice(0, maxLen) + '…';
}

export default {
    fmtMoney,
    fmtDate,
    fmtDateTime,
    fmtNumber,
    fmtPercent,
    fmtBytes,
    fmtTruncate
};
