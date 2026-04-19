'use strict';

const { execute } = require('../db');

/**
 * Auto-Audit Middleware
 * Automatically logs all state-changing API requests (POST/PUT/DELETE/PATCH)
 * to QA_AUDIT_LOGS after the response is sent.
 * This means even if a frontend developer forgets to call logActivity(),
 * all mutations are still captured server-side.
 */

// Routes to skip (too noisy or handled by frontend)
const SKIP_ROUTES = [
  '/api/audit-logs',   // Don't log the act of logging
  '/api/auth/send-otp', // OTP sends are sensitive
];

// Map route patterns to entity types for clean display
const ROUTE_ENTITY_MAP = [
  { pattern: /^\/api\/invoices\/([^/]+)$/,   entity: 'invoice',   idGroup: 1 },
  { pattern: /^\/api\/invoices$/,            entity: 'invoice',   idGroup: null },
  { pattern: /^\/api\/customers\/([^/]+)$/,  entity: 'customer',  idGroup: 1 },
  { pattern: /^\/api\/customers$/,           entity: 'customer',  idGroup: null },
  { pattern: /^\/api\/inventory\/([^/]+)$/,  entity: 'inventory', idGroup: 1 },
  { pattern: /^\/api\/inventory$/,           entity: 'inventory', idGroup: null },
  { pattern: /^\/api\/quotes\/([^/]+)$/,     entity: 'quote',     idGroup: 1 },
  { pattern: /^\/api\/quotes$/,              entity: 'quote',     idGroup: null },
  { pattern: /^\/api\/settings\//,           entity: 'settings',  idGroup: null },
  { pattern: /^\/api\/targets\//,            entity: 'targets',   idGroup: null },
];

// Map HTTP method + route to a readable action label
function deriveAction(method, path, body) {
  const methUpper = method.toUpperCase();

  if (path.startsWith('/api/invoices')) {
    if (methUpper === 'POST') return 'INVOICE_CREATED';
    if (methUpper === 'PUT' && body?.status) return `INVOICE_STATUS_CHANGED:${body.status.toUpperCase().replace(/ /g, '_')}`;
    if (methUpper === 'PUT') return 'INVOICE_UPDATED';
    if (methUpper === 'DELETE') return 'INVOICE_DELETED';
  }
  if (path.startsWith('/api/customers')) {
    if (methUpper === 'POST') return 'CUSTOMER_CREATED';
    if (methUpper === 'PUT') return 'CUSTOMER_UPDATED';
    if (methUpper === 'DELETE') return 'CUSTOMER_DELETED';
  }
  if (path.startsWith('/api/inventory')) {
    if (methUpper === 'POST') return 'INVENTORY_ITEM_CREATED';
    if (methUpper === 'PUT') return 'INVENTORY_ITEM_UPDATED';
    if (methUpper === 'DELETE') return 'INVENTORY_ITEM_DELETED';
  }
  if (path.startsWith('/api/quotes')) {
    if (methUpper === 'POST') return 'QUOTE_CREATED';
    if (methUpper === 'PUT') return 'QUOTE_UPDATED';
    if (methUpper === 'DELETE') return 'QUOTE_DELETED';
  }
  if (path.startsWith('/api/settings/taxes')) return 'SETTINGS_TAX_UPDATED';
  if (path.startsWith('/api/settings/pricing')) return 'SETTINGS_PRICING_UPDATED';
  if (path.startsWith('/api/settings/exchangeRates')) return 'SETTINGS_EXCHANGE_RATE_UPDATED';
  if (path.startsWith('/api/settings/signatures')) return 'SETTINGS_SIGNATURE_UPDATED';
  if (path.startsWith('/api/settings/company')) return 'SETTINGS_COMPANY_UPDATED';
  if (path.startsWith('/api/targets')) return 'TARGETS_SAVED';
  if (path.startsWith('/api/auth/verify-otp')) return 'USER_LOGIN';

  return `${methUpper}_${path.replace(/^\/api\//, '').replace(/\//g, '_').toUpperCase()}`;
}

function deriveCategory(path) {
  if (path.includes('/invoices')) return 'invoices';
  if (path.includes('/customers')) return 'customers';
  if (path.includes('/inventory')) return 'inventory';
  if (path.includes('/quotes')) return 'quotes';
  if (path.includes('/settings')) return 'settings';
  if (path.includes('/targets')) return 'settings';
  if (path.includes('/auth')) return 'auth';
  return 'system';
}

function deriveSeverity(method, path, statusCode) {
  if (statusCode >= 500) return 'critical';
  if (statusCode >= 400) return 'warning';
  if (method.toUpperCase() === 'DELETE') return 'warning';
  if (path.includes('/auth')) return 'warning';
  return 'info';
}

function deriveEntityId(path, body, responseBody) {
  // Try to extract ID from URL path
  const segments = path.split('/').filter(Boolean);
  const lastSegment = segments[segments.length - 1];
  if (lastSegment && !lastSegment.startsWith('api') && lastSegment.length < 100 && !/^[a-z]+$/.test(lastSegment)) {
    return lastSegment;
  }
  // Try from body
  if (body?.id) return String(body.id);
  if (body?.invoiceId) return String(body.invoiceId);
  if (body?.customerId) return String(body.customerId);
  // Try from response
  if (responseBody?.data?.id) return String(responseBody.data.id);
  return null;
}

function deriveEntityType(path) {
  for (const rule of ROUTE_ENTITY_MAP) {
    if (rule.pattern.test(path)) return rule.entity;
  }
  return null;
}

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || null;
}

const auditMiddleware = (req, res, next) => {
  const method = req.method.toUpperCase();

  // Only capture mutations
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return next();

  // Skip noisy or sensitive routes
  if (SKIP_ROUTES.some(r => req.path.startsWith(r.replace('/api', '')))) return next();

  // Capture original json() to intercept the response body
  const originalJson = res.json.bind(res);
  let capturedBody = null;
  res.json = (body) => {
    capturedBody = body;
    return originalJson(body);
  };

  // After response is finished, log asynchronously
  res.on('finish', async () => {
    try {
      const actor = req.user?.email || req.user?.userId || 'system';
      const path = req.path;
      const statusCode = res.statusCode;
      const outcome = statusCode >= 400 ? 'failure' : 'success';
      const action = deriveAction(method, '/api' + path, req.body);
      const category = deriveCategory('/api' + path);
      const severity = deriveSeverity(method, path, statusCode);
      const entityType = deriveEntityType('/api' + path);
      const entityId = deriveEntityId(path, req.body, capturedBody);
      const ipAddress = getClientIp(req);
      const userAgent = (req.headers['user-agent'] || '').substring(0, 495);

      // Sanitize body for logging (remove sensitive fields)
      const safeBody = req.body ? { ...req.body } : {};
      delete safeBody.password;
      delete safeBody.token;
      delete safeBody.otp;
      delete safeBody.signatureUrl; // Base64 images are too large
      const details = `${method} ${path} → ${statusCode}`;
      const extraData = Object.keys(safeBody).length > 0
        ? JSON.stringify(safeBody).substring(0, 3900)
        : null;

      await execute(
        `INSERT INTO QA_AUDIT_LOGS 
          (USER_ID, ACTION, DETAILS, CATEGORY, EXTRA_DATA, ENTITY_TYPE, ENTITY_ID, SEVERITY, OUTCOME, IP_ADDRESS, USER_AGENT)
         VALUES 
          (:usrid, :act, :det, :cat, :ext, :etype, :eid, :sev, :out, :ip, :ua)`,
        {
          usrid: actor,
          act: action,
          det: details,
          cat: category,
          ext: extraData,
          etype: entityType,
          eid: entityId,
          sev: severity,
          out: outcome,
          ip: ipAddress,
          ua: userAgent
        }
      );
    } catch (err) {
      // Never crash the server over a logging failure
      console.error('[AuditMiddleware] Failed to write log:', err.message);
    }
  });

  next();
};

module.exports = { auditMiddleware };
