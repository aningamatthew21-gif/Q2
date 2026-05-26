'use strict';

/**
 * routes/reports/_shared.js — Module 5
 *
 * Helpers shared by every report endpoint. Keep this thin: every
 * function here gets touched by 24 reports, so each addition is a
 * 24×-multiplier on consistency (or 24×-multiplier on bugs).
 */

/**
 * Parse the `from` / `to` / `asOfDate` query params with sane defaults
 * and return Date objects that Oracle DATE binds accept directly.
 *
 *   - `from` defaults to first day of current month
 *   - `to`   defaults to today
 *   - `asOfDate` defaults to today
 *   - Strings like "2026-05-24" are parsed as local midnight (avoids
 *     the off-by-one timezone trap when binding to Oracle DATE)
 */
function parseDateRange(q = {}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  const parse = (s, fallback) => {
    if (!s) return fallback;
    // Anchored YYYY-MM-DD → local midnight, no TZ shift
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const d = new Date(s);
    return isNaN(d.getTime()) ? fallback : d;
  };

  return {
    from:      parse(q.from,      firstOfMonth),
    to:        parse(q.to,        today),
    asOfDate:  parse(q.asOfDate,  today)
  };
}

/**
 * Bucket a "days overdue" integer into the standard 5-bucket aging
 * scheme used by every aging-related report (AR Aging, Bad-Debt,
 * Quote Aging, PR Backlog, etc.).
 *
 *   <0       → 'CURRENT'   (not yet due)
 *   0..30    → '1-30'
 *   31..60   → '31-60'
 *   61..90   → '61-90'
 *   >90      → '90+'
 *
 * Pass negative `days` for invoices not yet past due (e.g. due in 12d
 * → days = -12 → 'CURRENT').
 */
function agingBucket(days) {
  const d = Number(days);
  if (!Number.isFinite(d) || d < 0) return 'CURRENT';
  if (d <= 30) return '1-30';
  if (d <= 60) return '31-60';
  if (d <= 90) return '61-90';
  return '90+';
}

const AGING_BUCKET_ORDER = ['CURRENT', '1-30', '31-60', '61-90', '90+'];

/**
 * Convert a `bind` object into the bind-clause + binds for a dynamic
 * IN(...) list. Caller-friendly:
 *
 *   const { clause, binds } = inClause('cid', ['c1','c2','c3']);
 *   // clause = ":cid0,:cid1,:cid2"
 *   // binds  = { cid0:'c1', cid1:'c2', cid2:'c3' }
 *   execute(`SELECT * FROM t WHERE customer_id IN (${clause})`, binds);
 */
function inClause(prefix, values) {
  const binds = {};
  const placeholders = values.map((v, i) => {
    const key = `${prefix}${i}`;
    binds[key] = v;
    return `:${key}`;
  });
  return { clause: placeholders.join(','), binds };
}

/**
 * Wrap a SELECT in Oracle's OFFSET/FETCH window for paginated reports.
 * Defaults: page=1, pageSize=100, capped at 500 to keep payloads sane
 * and PDF/XLSX exports manageable.
 */
function paginate(sql, page = 1, pageSize = 100) {
  const safeSize = Math.min(Math.max(Number(pageSize) || 100, 1), 500);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeSize;
  return `${sql} OFFSET ${offset} ROWS FETCH NEXT ${safeSize} ROWS ONLY`;
}

/**
 * Stable rounding helper — JS floats stringify weirdly for currency.
 * `n(123.456, 2) === 123.46`. Returns Number, not string.
 */
function n(v, decimals = 2) {
  const x = Number(v);
  if (!Number.isFinite(x)) return 0;
  const f = Math.pow(10, decimals);
  return Math.round(x * f) / f;
}

/**
 * Standard envelope every report endpoint should return so the
 * frontend ReportPage wrapper can render KPIs / charts / table
 * without per-report glue code.
 *
 *   {
 *     success: true,
 *     data: {
 *       title:       'AR Aging',
 *       subtitle:    'As of 2026-05-24',
 *       asOfDate:    Date,
 *       filtersApplied: [{label:'Industry', value:'Telecom'}, ...],
 *       kpis: [{label, value, fmt:'currency|number|percent', delta:{value,direction:'up'|'down'|'flat'}, tone:'good|bad|neutral'}],
 *       charts: [{type:'bar|line|pie', title, series:[{name, data:[{x,y}]}]}],
 *       columns: [{key, label, type:'string|number|date|currency|percent', drillPage, drillKey}],
 *       rows:    [{...}],
 *       totals:  {col1: N, col2: N}     // optional totals row
 *     }
 *   }
 */
function envelope(payload) {
  return {
    success: true,
    data: {
      title:           payload.title || '',
      subtitle:        payload.subtitle || '',
      asOfDate:        payload.asOfDate || new Date(),
      filtersApplied:  payload.filtersApplied || [],
      kpis:            payload.kpis    || [],
      charts:          payload.charts  || [],
      columns:         payload.columns || [],
      rows:            payload.rows    || [],
      totals:          payload.totals  || null,
      // `extras` lets a report attach report-specific structured data
      // that doesn't fit the standard kpi/chart/table model (e.g. VAT
      // filing summary box-codes, validation-warning rows). Pages can
      // render it freely outside the standard layout. Always optional.
      extras:          payload.extras  || null
    }
  };
}

/**
 * Map a tax-line label to the Ghana GRA box code. Used by every
 * report that breaks revenue out by tax type (Sales Register, VAT
 * Compliance, future Withholding report).
 *
 *   VAT 15%   → 'VAT'      (GRA box 040)
 *   NHIL 2.5% → 'NHIL'     (GRA box 050)
 *   GETFund   → 'GETFUND'  (GRA box 060)
 *   COVID 1%  → 'COVID'    (GRA box 070)
 *   anything else → 'OTHER'
 *
 * Match is case-insensitive on the label, with reasonable variants
 * (GET-Fund / GETFund / GET Fund all collapse to GETFUND).
 */
function graBoxFor(label) {
  const s = String(label || '').toUpperCase();
  if (/COVID/.test(s))                                  return 'COVID';
  if (/GET[ -]?FUND|GETFUND/.test(s))                   return 'GETFUND';
  if (/NHIL/.test(s))                                   return 'NHIL';
  if (/\bVAT\b/.test(s) || /VALUE[- ]?ADDED/.test(s))   return 'VAT';
  return 'OTHER';
}

/**
 * Safely parse a CLOB-JSON cell into an Array. Returns [] on null,
 * empty string, or parse failure. Used everywhere TAX_BREAKDOWN or
 * any other JSON-in-CLOB column is read.
 */
function safeJsonArray(s) {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch (_e) {
    return [];
  }
}

/**
 * Format YYYY-MM-DD from a JS Date. Used in subtitles / filter
 * captions where ISO is more readable than localised strings.
 */
function isoDay(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toISOString().slice(0, 10);
}

module.exports = {
  parseDateRange,
  agingBucket,
  AGING_BUCKET_ORDER,
  inClause,
  paginate,
  n,
  envelope,
  graBoxFor,
  safeJsonArray,
  isoDay
};
