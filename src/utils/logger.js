import api from '../api';

/**
 * Standardized Activity Logger
 * Sends audit log entries to the backend Oracle database.
 * Uses fire-and-forget pattern — never blocks the UI.
 *
 * Action taxonomy: SCREAMING_SNAKE_CASE
 * Categories: auth | invoices | quotes | inventory | customers | settings | system
 * Severities: info | warning | critical
 * Outcomes: success | failure
 */

export const logActivity = (userId, action, details, extraData = {}) => {
  // Fire-and-forget: intentionally NOT awaited so it never blocks the UI
  const category = extraData.category || deriveCategory(action);
  const severity  = extraData.severity  || deriveSeverity(action);
  const outcome   = extraData.outcome   || 'success';
  const entityType = extraData.entityType || null;
  const entityId   = extraData.entityId   || null;

  // Remove keys we've already extracted to avoid duplicates
  const { category: _c, severity: _s, outcome: _o, entityType: _et, entityId: _ei, ...cleanExtra } = extraData;

  api.post('/audit-logs', {
    userId,
    action,
    details,
    category,
    severity,
    outcome,
    entityType,
    entityId,
    ...cleanExtra
  }).catch(err => {
    // Silent — log errors must never crash the application
    console.warn('[Logger] Failed to write audit log:', action, err?.message);
  });
};

// ─── helpers ────────────────────────────────────────────────
function deriveCategory(action) {
  if (!action) return 'system';
  const a = action.toUpperCase();
  if (a.includes('LOGIN') || a.includes('LOGOUT') || a.includes('OTP') || a.includes('SESSION')) return 'auth';
  if (a.includes('INVOICE')) return 'invoices';
  if (a.includes('QUOTE'))   return 'quotes';
  if (a.includes('INVENTORY') || a.includes('ITEM')) return 'inventory';
  if (a.includes('CUSTOMER')) return 'customers';
  if (a.includes('SETTINGS') || a.includes('TAX') || a.includes('PRICING') ||
      a.includes('TARGETS') || a.includes('SIGNATURE') || a.includes('COMPANY') ||
      a.includes('EXCHANGE')) return 'settings';
  if (a.includes('REPORT') || a.includes('EXPORT')) return 'system';
  return 'system';
}

function deriveSeverity(action) {
  if (!action) return 'info';
  const a = action.toUpperCase();
  if (a.includes('DELETE') || a.includes('REJECT') || a.includes('ERROR') || a.includes('FAIL')) return 'warning';
  if (a.includes('CLIENT_ERROR') || a.includes('UNAUTHORIZED')) return 'critical';
  return 'info';
}

// ─── Standardised action constants (use these in components) ─
export const AUDIT_ACTIONS = {
  // Auth
  LOGIN_SUCCESS:        'LOGIN_SUCCESS',
  LOGIN_RESTORE:        'LOGIN_RESTORE',
  USER_LOGOUT:          'USER_LOGOUT',
  CLIENT_ERROR:         'CLIENT_ERROR',

  // Invoices
  INVOICE_CREATED:       'INVOICE_CREATED',
  INVOICE_SUBMITTED:     'INVOICE_SUBMITTED',
  INVOICE_APPROVED:      'INVOICE_APPROVED',
  INVOICE_REJECTED:      'INVOICE_REJECTED',
  INVOICE_SENT_CUSTOMER: 'INVOICE_SENT_CUSTOMER',
  INVOICE_PAID:          'INVOICE_PAID',

  // Quotes
  QUOTE_CREATED:         'QUOTE_CREATED',
  QUOTE_UPDATED:         'QUOTE_UPDATED',

  // Inventory
  INVENTORY_CREATED:     'INVENTORY_CREATED',
  INVENTORY_UPDATED:     'INVENTORY_UPDATED',
  INVENTORY_DELETED:     'INVENTORY_DELETED',
  INVENTORY_IMPORTED:    'INVENTORY_IMPORTED',
  ITEM_PRICING_UPDATED:  'ITEM_PRICING_UPDATED',

  // Customers
  CUSTOMER_CREATED:      'CUSTOMER_CREATED',
  CUSTOMER_UPDATED:      'CUSTOMER_UPDATED',
  CUSTOMER_DELETED:      'CUSTOMER_DELETED',
  CUSTOMER_IMPORTED:     'CUSTOMER_IMPORTED',

  // Settings
  SETTINGS_TAX_UPDATED:           'SETTINGS_TAX_UPDATED',
  SETTINGS_PRICING_UPDATED:       'SETTINGS_PRICING_UPDATED',
  SETTINGS_EXCHANGE_RATE_UPDATED: 'SETTINGS_EXCHANGE_RATE_UPDATED',
  SETTINGS_COMPANY_UPDATED:       'SETTINGS_COMPANY_UPDATED',
  SIGNATURE_ADDED:                'SIGNATURE_ADDED',
  SIGNATURE_DELETED:              'SIGNATURE_DELETED',
  TARGETS_SAVED:                  'TARGETS_SAVED',

  // System
  REPORT_GENERATED:      'REPORT_GENERATED',
  REPORT_EXPORTED:       'REPORT_EXPORTED',
  PAGE_VIEW:             'PAGE_VIEW',
};
