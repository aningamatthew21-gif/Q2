/**
 * shared/permissions.js — single source of truth for the authorization model.
 *
 * Imported by BOTH:
 *   - the frontend (src/utils/permissions.js re-exports it for the UI gates)
 *   - the Express backend (backend/middleware/authMiddleware.js for requirePermission)
 *
 * Written as CommonJS so the Node backend (which is CJS) can `require()` it
 * directly. Vite handles the CJS-to-ESM interop on the frontend transparently
 * via its built-in commonjs plugin, so React modules can still `import` from
 * here using ESM syntax.
 *
 * Why one file:
 *   Splitting the permission table between frontend and backend is the most
 *   common source of authorization drift — the UI hides a button, the server
 *   forgets to gate the route, and a crafted POST sails through. By keeping
 *   the catalogue here, every action has exactly one definition that both
 *   sides read. Adding a new action means editing one place.
 *
 * Naming convention for action keys:
 *   <entity>.<verb>[.<scope>]
 *     entity   — invoice, rfq, pr, vendor, customer, inventory, pricing, tax,
 *                fx, signature, user, audit, dashboard, settings
 *     verb     — read, create, edit, delete, approve, reject, sign, cancel,
 *                send, accept, recommend, fulfill, export
 *     scope    — finance | sales | procurement | own | all | team (optional)
 *
 *   Examples:
 *     invoice.read.all           — see every invoice
 *     invoice.read.own           — see invoices I created
 *     invoice.approve.finance    — finance-head approval (controller signature)
 *     invoice.approve.sales      — pre-customer-send sales-head approval
 *     rfq.approve.award          — procurement-head awards the RFQ
 *     tax.edit                   — change tax configuration
 *     user.manage                — admin user management
 *
 * Changing this catalogue:
 *   1. Add the action key to ACTIONS (so the lint catches typos elsewhere).
 *   2. Grant it to the right roles in ROLE_ACTIONS.
 *   3. If it gates a page, add it to PAGE_PERMISSIONS.
 *   4. If it's an approval, consider whether SOD_RULES should mention it.
 */

// ── Roles ──────────────────────────────────────────────────────────────────
// New tiered model. Existing single-word roles (`sales`, `controller`,
// `procurement`, `admin`) map to these via the migration helper at the
// bottom of this file. Day-one rollout default-conservative: every existing
// `controller` keeps full power (mapped to `finance_head`), every existing
// `sales` user becomes `sales_officer` (no approval power) and individual
// promotions are deliberate. See `legacyRoleToTiered()`.
export const ROLES = Object.freeze({
  ADMIN:                'admin',

  FINANCE_OFFICER:      'finance_officer',
  FINANCE_HEAD:         'finance_head',

  SALES_OFFICER:        'sales_officer',
  SALES_HEAD:           'sales_head',

  PROCUREMENT_OFFICER:  'procurement_officer',
  PROCUREMENT_HEAD:     'procurement_head',

  CUSTOMER:             'customer'    // external; portal only
});

export const ALL_ROLES = Object.values(ROLES);

// ── Departments ────────────────────────────────────────────────────────────
export const DEPARTMENTS = Object.freeze({
  FINANCE:      'finance',
  SALES:        'sales',
  PROCUREMENT:  'procurement',
  SYSTEM:       'system',
  EXTERNAL:     'external'
});

export const ROLE_DEPARTMENT = Object.freeze({
  [ROLES.ADMIN]:               DEPARTMENTS.SYSTEM,
  [ROLES.FINANCE_OFFICER]:     DEPARTMENTS.FINANCE,
  [ROLES.FINANCE_HEAD]:        DEPARTMENTS.FINANCE,
  [ROLES.SALES_OFFICER]:       DEPARTMENTS.SALES,
  [ROLES.SALES_HEAD]:          DEPARTMENTS.SALES,
  [ROLES.PROCUREMENT_OFFICER]: DEPARTMENTS.PROCUREMENT,
  [ROLES.PROCUREMENT_HEAD]:    DEPARTMENTS.PROCUREMENT,
  [ROLES.CUSTOMER]:            DEPARTMENTS.EXTERNAL
});

export const ROLE_TIER = Object.freeze({
  [ROLES.ADMIN]:               'admin',
  [ROLES.FINANCE_OFFICER]:     'officer',
  [ROLES.FINANCE_HEAD]:        'head',
  [ROLES.SALES_OFFICER]:       'officer',
  [ROLES.SALES_HEAD]:          'head',
  [ROLES.PROCUREMENT_OFFICER]: 'officer',
  [ROLES.PROCUREMENT_HEAD]:    'head',
  [ROLES.CUSTOMER]:            'customer'
});

// ── Display labels (for the user-management UI) ───────────────────────────
export const ROLE_LABEL = Object.freeze({
  [ROLES.ADMIN]:               'Administrator',
  [ROLES.FINANCE_OFFICER]:     'Finance Officer',
  [ROLES.FINANCE_HEAD]:        'Finance Head',
  [ROLES.SALES_OFFICER]:       'Sales Officer',
  [ROLES.SALES_HEAD]:          'Sales Head',
  [ROLES.PROCUREMENT_OFFICER]: 'Procurement Officer',
  [ROLES.PROCUREMENT_HEAD]:    'Procurement Head',
  [ROLES.CUSTOMER]:            'Customer (Portal)'
});

// ── Actions ────────────────────────────────────────────────────────────────
// Flat list of every gated capability. Used for typo defence — referencing an
// action that isn't here yields a clear error at boot rather than silently
// granting access.
export const ACTIONS = Object.freeze({
  // ── Sales workspace ────────────────────────────────────────
  'dashboard.sales.read':        'View sales dashboard',
  'quote.create':                'Create / edit a quote (draft)',
  'invoice.send.customer':       'Send approved invoice / quote to customer',
  'invoice.read.own':            'View invoices I created',
  'invoice.read.team':           'View invoices my team created',
  'invoice.approve.sales':       'Approve a quote pre-customer-send (sales head)',
  'invoice.reject.sales':        'Reject a quote pre-customer-send (sales head)',
  'invoice.customer_action':     'Mark accept / reject on behalf of the customer',

  // ── Finance workspace ──────────────────────────────────────
  'dashboard.finance.read':      'View finance / controller dashboard',
  'invoice.read.all':            'View every invoice in the system',
  'invoice.edit.pricing':        'Edit invoice pricing (Pending Pricing state)',
  'invoice.approve.finance':     'Finance-approve (controller signature)',
  'invoice.reject.finance':      'Finance-reject / send-back',
  'invoice.reapprove':           'Re-approve invoice after sourcing variance',
  'invoice.mark_paid':           'Mark invoice as paid',

  // ── Procurement workspace ──────────────────────────────────
  'dashboard.procurement.read':  'View procurement dashboard',
  'pr.read':                     'View purchase requisitions',
  'pr.create':                   'Create a purchase requisition',
  'pr.cancel':                   'Cancel a purchase requisition',
  'pr.fulfill':                  'Mark a PR fulfilled',

  'rfq.read':                    'View RFQs',
  'rfq.create':                  'Build an RFQ',
  'rfq.send':                    'Send RFQ to vendors',
  'rfq.response.log':            'Log a vendor response (with attachments)',
  'rfq.recommend':               'Recommend a vendor for award',
  'rfq.approve.award':           'Approve the recommended award (procurement head)',
  'rfq.reject':                  'Reject the recommendation, send back',
  'rfq.cancel':                  'Cancel an RFQ',

  // ── Master data ────────────────────────────────────────────
  'customer.read':               'View customers',
  'customer.write':              'Create / edit / delete a customer',

  'inventory.read':              'View inventory',
  'inventory.write':             'Create / edit / delete an inventory item',

  'vendor.read':                 'View vendors',
  'vendor.write':                'Create / edit a vendor',
  'vendor.deactivate':           'Deactivate / re-activate a vendor',

  'pricing.read':                'View pricing rules',
  'pricing.write':               'Edit pricing rules',

  'tax.read':                    'View tax configuration',
  'tax.edit':                    'Edit tax configuration',

  'fx.read':                     'View exchange rates',
  'fx.edit':                     'Edit exchange rates',

  // ── Signatures / audit / settings ─────────────────────────
  'signature.manage':            'Manage my approval signatures',
  'audit.read.own':              'View my own audit trail',
  'audit.read.department':       'View audit for my department',
  'audit.read.all':              'View audit across all departments',
  'reports.run.sales':           'Run / export sales reports',
  'reports.run.finance':         'Run / export finance reports',
  'reports.run.procurement':     'Run / export procurement reports',
  'procurement.settings.edit':   'Edit procurement thresholds / approvals',

  // ── System / admin ─────────────────────────────────────────
  'user.manage':                 'Provision / promote / deactivate users',
  'user.impersonate':            'Act-as another user (audited)',
  'system.act_as_emergency':     'Emergency override (double-audited)',

  // ── Customer portal ────────────────────────────────────────
  'portal.read.own':             'View my own customer portal',
  'portal.accept':               'Accept / reject an invoice as the customer'
});

export const ALL_ACTIONS = Object.keys(ACTIONS);

// ── Role × Action grants ───────────────────────────────────────────────────
// An action is permitted iff the role appears in ROLE_ACTIONS[role] and the
// action key is in the array. Missing role = no permissions. Missing
// action = denied (lint defence via ACTIONS).

const FINANCE_OFFICER_ACTIONS = [
  // RO across departments for context
  'dashboard.sales.read',
  'dashboard.finance.read',
  'dashboard.procurement.read',
  // Finance side — read only for sensitive, write for master data
  'invoice.read.all',
  'invoice.edit.pricing',           // Pending Pricing state — data entry, head approves
  // Master data (their primary job)
  'customer.read',     'customer.write',
  'inventory.read',    'inventory.write',
  'vendor.read',
  'pricing.read',      'pricing.write',
  'tax.read',
  'fx.read',           'fx.edit',
  // Audit (own scope)
  'audit.read.own',
  'reports.run.finance'             // RO export
];

const FINANCE_HEAD_ACTIONS = [
  ...FINANCE_OFFICER_ACTIONS,
  // Approvals (finance side only)
  'invoice.approve.finance',
  'invoice.reject.finance',
  'invoice.reapprove',
  'invoice.mark_paid',
  // Master data — full power
  'tax.edit',
  'vendor.write',
  // Visibility across all departments (per the design)
  'pr.read',
  'rfq.read',
  'audit.read.all',
  'reports.run.sales',
  'reports.run.procurement',
  // Signatures
  'signature.manage'
];

const SALES_OFFICER_ACTIONS = [
  'dashboard.sales.read',
  'quote.create',
  'invoice.send.customer',
  'invoice.read.own',
  'invoice.customer_action',        // SoD-checked against own quotes
  // Read access to master data they need
  'customer.read',
  'inventory.read',
  'pricing.read',
  'fx.read',
  'audit.read.own',
  'reports.run.sales'
];

const SALES_HEAD_ACTIONS = [
  ...SALES_OFFICER_ACTIONS,
  'invoice.read.team',
  'invoice.approve.sales',
  'invoice.reject.sales',
  'invoice.reapprove',
  'audit.read.department',
  'signature.manage'
];

const PROCUREMENT_OFFICER_ACTIONS = [
  'dashboard.procurement.read',
  'pr.read', 'pr.create', 'pr.cancel', 'pr.fulfill',
  'rfq.read', 'rfq.create', 'rfq.send', 'rfq.response.log', 'rfq.recommend',
  'vendor.read', 'vendor.write',
  'customer.read',
  'inventory.read',
  'audit.read.own',
  'reports.run.procurement',
  'procurement.settings.edit'
];

const PROCUREMENT_HEAD_ACTIONS = [
  ...PROCUREMENT_OFFICER_ACTIONS,
  'rfq.approve.award',
  'rfq.reject',
  'rfq.cancel',
  'vendor.deactivate',
  'audit.read.department',
  'signature.manage'
];

const ADMIN_ACTIONS = [
  ...ALL_ACTIONS                    // admin has every gate
];

const CUSTOMER_ACTIONS = [
  'portal.read.own',
  'portal.accept'
];

export const ROLE_ACTIONS = Object.freeze({
  [ROLES.ADMIN]:                ADMIN_ACTIONS,
  [ROLES.FINANCE_OFFICER]:      FINANCE_OFFICER_ACTIONS,
  [ROLES.FINANCE_HEAD]:         FINANCE_HEAD_ACTIONS,
  [ROLES.SALES_OFFICER]:        SALES_OFFICER_ACTIONS,
  [ROLES.SALES_HEAD]:           SALES_HEAD_ACTIONS,
  [ROLES.PROCUREMENT_OFFICER]:  PROCUREMENT_OFFICER_ACTIONS,
  [ROLES.PROCUREMENT_HEAD]:     PROCUREMENT_HEAD_ACTIONS,
  [ROLES.CUSTOMER]:             CUSTOMER_ACTIONS
});

// ── Page → required action ────────────────────────────────────────────────
// Drives both AppContext's render gate AND the LeftNav visibility. Pages
// not listed are public (e.g. login).
export const PAGE_PERMISSIONS = Object.freeze({
  // Sales
  salesDashboard:               'dashboard.sales.read',
  quoting:                      'quote.create',
  myInvoices:                   'invoice.read.own',
  salesInvoiceApproval:         'invoice.approve.sales',
  salesInvoiceReview:           'invoice.approve.sales',
  mySignatures:                 'signature.manage',

  // Finance
  controllerDashboard:          'dashboard.finance.read',
  invoices:                     'invoice.read.all',
  invoiceEditor:                'invoice.read.all',

  // Procurement
  procurementDashboard:         'dashboard.procurement.read',
  purchaseRequisitions:         'pr.read',
  purchaseRequisitionDetail:    'pr.read',
  rfqList:                      'rfq.read',
  rfqBuilder:                   'rfq.create',
  rfqDetail:                    'rfq.read',
  procurementSettings:          'procurement.settings.edit',

  // Master / settings
  customers:                    'customer.read',
  inventory:                    'inventory.read',
  pricingManagement:            'pricing.read',
  taxSettings:                  'tax.read',
  vendors:                      'vendor.read',

  // System
  auditTrail:                   'audit.read.own',
  userManagement:               'user.manage',

  // Public — no gate
  login:                        null,
  customerPortal:               'portal.read.own'
});

// ── Separation of duties ──────────────────────────────────────────────────
// Runtime invariants enforced by the backend on the four sensitive routes.
// Each rule includes its description (for the docs / audit trail) and the
// concrete `check(user, entity)` predicate. Returning TRUE means the action
// is allowed; FALSE means SoD violation → 403.
export const SOD_RULES = Object.freeze({
  'invoice.approve.sales': {
    description: 'Sales-head approval — approver must NOT be the user who created the invoice.',
    check: (user, invoice) => {
      if (!user?.email || !invoice) return false;
      return user.email !== invoice.createdBy
          && user.email !== invoice.salesPersonId;
    }
  },
  'invoice.approve.finance': {
    description: 'Finance-head approval — approver must NOT be the original sales creator.',
    check: (user, invoice) => {
      if (!user?.email || !invoice) return false;
      return user.email !== invoice.createdBy
          && user.email !== invoice.salesPersonId;
    }
  },
  'rfq.approve.award': {
    description: 'RFQ award approval — approver must NOT be the procurement officer who recommended.',
    check: (user, rfq) => {
      if (!user?.email || !rfq) return false;
      return user.email !== rfq.recommendedBy;
    }
  },
  'invoice.customer_action': {
    description: 'Customer-accept on behalf — the internal user marking accept cannot be the same who sent it.',
    check: (user, invoice) => {
      if (!user?.email || !invoice) return false;
      return user.email !== invoice.sentBy;
    }
  }
});

// ── Legacy role → new role mapping (used by the migration script) ─────────
// Day-one defaults are conservative: existing power users keep their power.
export function legacyRoleToTiered(legacyRole) {
  switch (String(legacyRole || '').toLowerCase()) {
    case 'admin':        return ROLES.ADMIN;
    case 'controller':   return ROLES.FINANCE_HEAD;
    case 'procurement':  return ROLES.PROCUREMENT_HEAD;
    case 'sales':        return ROLES.SALES_OFFICER;
    case 'customer':     return ROLES.CUSTOMER;
    default:             return ROLES.SALES_OFFICER;
  }
}

/** True iff `role` has permission to perform `action`. */
export function can(role, action) {
  if (!role || !action) return false;
  // Admin shortcut so we don't replay the full ADMIN_ACTIONS array each call.
  if (role === ROLES.ADMIN) return true;
  const grants = ROLE_ACTIONS[role];
  if (!grants) return false;
  return grants.indexOf(action) >= 0;
}

/** True iff `role` can open `page` (used by AppContext + LeftNav). */
export function canOpenPage(role, page) {
  const required = PAGE_PERMISSIONS[page];
  if (required === null || required === undefined) return true;
  return can(role, required);
}

/** All action keys granted to `role` (frozen list, do not mutate). */
export function actionsFor(role) {
  return ROLE_ACTIONS[role] || [];
}

// Module style: pure ESM (`export ...` above). The local `shared/package.json`
// declares `"type": "module"` so Node treats this file as ESM. Backend
// requires this via Node 22's stable `require(esm)` support; the frontend
// uses native `import` statements.
