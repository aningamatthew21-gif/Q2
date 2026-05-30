'use strict';

/**
 * shared/statuses.js — single source of truth for every workflow
 * status string in the app.
 *
 * Standards anchor:
 *   - ISO/IEC 25010 Maintainability — modifiability
 *   - ISO/IEC 27001:2022 A.8.28 (Secure coding) — eliminate magic strings
 *     so renames are caught by import errors instead of silent runtime drift
 *
 * Why this exists:
 *   Before this file, status strings like 'Pending Approval', 'AWARDED',
 *   'OPEN' lived as bare literals across 50+ backend route files and
 *   frontend pages. A typo or rename couldn't be caught by the build
 *   system; a future "Pending Approval" → "Pending Review" rename would
 *   require a manual grep across 80+ files and inevitably miss one.
 *
 *   With this catalogue:
 *     1. `import { INVOICE_STATUS } from '../../shared/statuses'`
 *        gives autocomplete in IDEs and an explicit type-like contract.
 *     2. STATUS_GROUPS bundle the "RECOGNISED_REVENUE" semantic check
 *        in ONE place instead of being re-written in every report.
 *     3. Future status additions get added here once; every caller
 *        inherits automatically.
 *
 * Frozen objects so callers cannot mutate the catalogue.
 *
 * Shared between backend (CommonJS via Node's require(ESM) interop on
 * Node 22) and frontend (ESM import). Same file, same constants, no
 * drift possible.
 */

// ═════════════════════════════════════════════════════════════════════════
// QA_INVOICES.STATUS — full sales-cycle states
// ═════════════════════════════════════════════════════════════════════════
export const INVOICE_STATUS = Object.freeze({
  DRAFT:                'Draft',
  PENDING_PRICING:      'Pending Pricing',        // procurement is sourcing
  PENDING_APPROVAL:     'Pending Approval',       // awaiting finance head
  APPROVED:             'Approved',               // signed by finance, ready to send
  AWAITING_ACCEPTANCE:  'Awaiting Acceptance',    // customer has it
  CUSTOMER_ACCEPTED:    'Customer Accepted',      // customer agreed; revenue recognised
  CUSTOMER_REJECTED:    'Customer Rejected',      // customer declined
  PAID:                 'Paid',                   // fully settled
  PARTIALLY_PAID:       'Partially Paid',         // some balance outstanding
  REJECTED:             'Rejected',               // finance rejected internally
  SIGNED:               'Signed',                 // legacy / external sign state
  CANCELLED:            'Cancelled'               // voided
});

// ═════════════════════════════════════════════════════════════════════════
// INVOICE_TRANSITIONS — declarative state-machine for QA_INVOICES.STATUS.
//
// Standards anchor:
//   - ISO/IEC 27001:2022 A.5.3 (Segregation of Duties)
//   - ISO/IEC 27001:2022 A.8.32 (Change Management — controlled state
//     transitions; terminal documents are immutable)
//   - ISO/IEC 25010 Reliability — Maturity: prevents accidental and
//     malicious state corruption (e.g. rejecting a paid invoice)
//   - ERP convention: SAP/Oracle EBS "posted documents" are immutable;
//     reversal is a separate document, NOT an edit
//
// How it's used:
//   - Backend enforces this matrix at the route layer (routes/invoices.js)
//     so any direct PUT that violates it gets 409 E_CONFLICT_STATE.
//   - Frontend reads this matrix to decide which action buttons render
//     (InvoiceEditor.jsx) — no false affordances.
//
// To allow a new transition: add it to the array for the source state.
// To deprecate a transition: remove it; both layers update on next deploy.
//
// Note on Awaiting Acceptance → Customer Accepted/Rejected:
//   This transition is performed by EITHER the customer (via the portal)
//   OR an internal sales user recording the customer's decision on
//   behalf (the `invoice.customer_action` flow, which has its own
//   SoD rule preventing the sender from also recording the response).
//   The matrix permits the transition; permission + SoD layers decide
//   whether THIS specific user may perform it.
// ═════════════════════════════════════════════════════════════════════════
export const INVOICE_TRANSITIONS = Object.freeze({
  [INVOICE_STATUS.DRAFT]:                [INVOICE_STATUS.PENDING_PRICING, INVOICE_STATUS.PENDING_APPROVAL, INVOICE_STATUS.CANCELLED],
  [INVOICE_STATUS.PENDING_PRICING]:      [INVOICE_STATUS.PENDING_APPROVAL, INVOICE_STATUS.APPROVED, INVOICE_STATUS.CANCELLED, INVOICE_STATUS.REJECTED],
  [INVOICE_STATUS.PENDING_APPROVAL]:     [INVOICE_STATUS.APPROVED, INVOICE_STATUS.REJECTED, INVOICE_STATUS.PENDING_PRICING],
  // Approved → Awaiting Acceptance (send to customer) is the forward path.
  // Approved → Pending Approval supports the invoice.reapprove path (sourcing
  // variance after award). Approved → Cancelled supports admin voiding before
  // sending. NO transition to Rejected from here — the decision was made.
  [INVOICE_STATUS.APPROVED]:             [INVOICE_STATUS.AWAITING_ACCEPTANCE, INVOICE_STATUS.PENDING_APPROVAL, INVOICE_STATUS.CANCELLED],
  // Customer's decision (or sales recording it on behalf via customer_action).
  [INVOICE_STATUS.AWAITING_ACCEPTANCE]:  [INVOICE_STATUS.CUSTOMER_ACCEPTED, INVOICE_STATUS.CUSTOMER_REJECTED],
  // Revenue recognised — only payment progresses status further.
  [INVOICE_STATUS.CUSTOMER_ACCEPTED]:    [INVOICE_STATUS.PARTIALLY_PAID, INVOICE_STATUS.PAID],
  [INVOICE_STATUS.PARTIALLY_PAID]:       [INVOICE_STATUS.PAID],
  // ── TERMINAL states — no further transitions permitted ──────────────
  // Reversal of a terminal invoice requires a separate credit-memo /
  // reversal workflow (planned as a future feature). Until then,
  // admin must use the soft-delete + restore path documented in
  // DR runbook §4.2.
  [INVOICE_STATUS.PAID]:                 [],
  [INVOICE_STATUS.CUSTOMER_REJECTED]:    [],
  [INVOICE_STATUS.REJECTED]:             [],
  [INVOICE_STATUS.CANCELLED]:            [],
  // Legacy state — treat as terminal for safety.
  [INVOICE_STATUS.SIGNED]:               []
});

/**
 * Invoice statuses from which NO further status change is permitted.
 * UI surfaces a "Locked" banner; backend returns 409 on any transition
 * attempt. The set is derived from INVOICE_TRANSITIONS so it can't drift.
 */
export const INVOICE_TERMINAL_STATUSES = Object.freeze(new Set(
  Object.entries(INVOICE_TRANSITIONS)
    .filter(([_, nexts]) => nexts.length === 0)
    .map(([s]) => s)
));

/**
 * isAllowedInvoiceTransition(from, to)
 * Returns true iff the matrix permits this state change. False for:
 *   - No-op (same state)
 *   - Unknown source state
 *   - Transition not listed in the matrix entry
 *
 * Callers:
 *   - backend/routes/invoices.js PUT handler — security enforcement
 *   - src/pages/InvoiceEditor.jsx — UI button-visibility logic
 *
 * Note: this only validates the STATE-MACHINE shape. The caller is
 * still responsible for permission checks (RBAC) and SoD rules.
 */
export function isAllowedInvoiceTransition(from, to) {
  if (!from || from === to) return false;
  const allowed = INVOICE_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

/** True iff the status admits no further changes (locked / immutable). */
export function isInvoiceTerminal(status) {
  return INVOICE_TERMINAL_STATUSES.has(status);
}

/**
 * INVOICE_EDITS_FROZEN_STATUSES — statuses at which the LINE ITEMS,
 * QUANTITIES, ORDER-LEVEL CHARGES (shipping / handling / discount),
 * TAX CHECKBOXES, and TAX RATES become immutable.
 *
 * This is a SUPERSET of TERMINAL because edits also freeze on Approved
 * and Awaiting Acceptance (the invoice has been committed by the
 * approver and/or sent to the customer; mutating it post-fact would
 * mean the finalized document no longer matches what the customer or
 * the approver saw).
 *
 * Standards anchor:
 *   - ISO/IEC 27001:2022 A.8.32 (Change Management) — a "Posted"
 *     document's numbers cannot change without a controlled reversal
 *   - SAP / Oracle EBS convention — Posted documents are immutable;
 *     all corrections happen via credit-memo or reversal documents
 *   - Audit integrity — the gross total an approver signed off on
 *     must equal the gross total on the customer-facing PDF, forever
 *
 * Pending Pricing is INTENTIONALLY excluded — finance officer needs
 * to edit prices during this state. That's the whole point of the state.
 * Pending Approval is INTENTIONALLY excluded — approver may want to
 * tweak before stamping. If a substantive change is needed after
 * Approved, the right path is to reject + re-author.
 */
export const INVOICE_EDITS_FROZEN_STATUSES = Object.freeze(new Set([
  INVOICE_STATUS.APPROVED,
  INVOICE_STATUS.AWAITING_ACCEPTANCE,
  INVOICE_STATUS.CUSTOMER_ACCEPTED,
  INVOICE_STATUS.CUSTOMER_REJECTED,
  INVOICE_STATUS.PAID,
  INVOICE_STATUS.PARTIALLY_PAID,
  INVOICE_STATUS.REJECTED,
  INVOICE_STATUS.CANCELLED,
  INVOICE_STATUS.SIGNED
]));

/**
 * True iff line items / quantities / taxes / charges cannot be edited
 * because the invoice has been committed (Approved or later).
 * Used by:
 *   - Frontend InvoiceEditor — disable inputs + show locked banner
 *   - Backend PUT /invoices/:id — reject mutation of frozen fields
 */
export function areInvoiceEditsFrozen(status) {
  return INVOICE_EDITS_FROZEN_STATUSES.has(status);
}

// ═════════════════════════════════════════════════════════════════════════
// QA_QUOTES.STATUS
// ═════════════════════════════════════════════════════════════════════════
export const QUOTE_STATUS = Object.freeze({
  DRAFT:      'DRAFT',
  SENT:       'SENT',
  CONVERTED:  'CONVERTED',
  EXPIRED:    'EXPIRED',
  REJECTED:   'REJECTED'
});

// ═════════════════════════════════════════════════════════════════════════
// QA_RFQS.STATUS
// ═════════════════════════════════════════════════════════════════════════
export const RFQ_STATUS = Object.freeze({
  DRAFT:             'DRAFT',
  SENT:              'SENT',
  RECEIVING:         'RECEIVING',
  COMPARING:         'COMPARING',
  PENDING_APPROVAL:  'PENDING_APPROVAL',
  AWARDED:           'AWARDED',
  CANCELLED:         'CANCELLED',
  CLOSED:            'CLOSED'
});

// ═════════════════════════════════════════════════════════════════════════
// QA_PURCHASE_REQUISITIONS.STATUS
// ═════════════════════════════════════════════════════════════════════════
export const PR_STATUS = Object.freeze({
  OPEN:       'OPEN',
  IN_RFQ:     'IN_RFQ',
  AWARDED:    'AWARDED',
  FULFILLED:  'FULFILLED',
  CANCELLED:  'CANCELLED',
  REJECTED:   'REJECTED'
});

// ═════════════════════════════════════════════════════════════════════════
// QA_GOODS_RECEIPTS.STATUS — Module 3
// ═════════════════════════════════════════════════════════════════════════
export const GOODS_RECEIPT_STATUS = Object.freeze({
  PENDING_QC:          'PENDING_QC',
  ACCEPTED:            'ACCEPTED',
  PARTIALLY_ACCEPTED:  'PARTIALLY_ACCEPTED',
  REJECTED:            'REJECTED'
});

// ═════════════════════════════════════════════════════════════════════════
// QA_INVOICE_PAYMENTS.STATUS — Module 2
// ═════════════════════════════════════════════════════════════════════════
export const PAYMENT_STATUS = Object.freeze({
  CONFIRMED:  'CONFIRMED',
  REVERSED:   'REVERSED',
  DRAFT:      'DRAFT'
});

// ═════════════════════════════════════════════════════════════════════════
// QA_UNALLOCATED_PAYMENTS.STATUS — Module 2
// ═════════════════════════════════════════════════════════════════════════
export const UNALLOC_STATUS = Object.freeze({
  UNAPPLIED:          'UNAPPLIED',
  PARTIALLY_APPLIED:  'PARTIALLY_APPLIED',
  APPLIED:            'APPLIED',
  REFUNDED:           'REFUNDED'
});

// ═════════════════════════════════════════════════════════════════════════
// STATUS_GROUPS — semantic bundles for SQL filters and JS predicates.
// Using Sets so `.has(s)` is O(1).
// ═════════════════════════════════════════════════════════════════════════
export const STATUS_GROUPS = Object.freeze({
  // Invoices that count toward recognised revenue (Sales Register, VAT,
  // WHT, DSO computations all use this). Customer-Accepted = the
  // earliest stage where revenue is recognised; Paid + Partial follow.
  INVOICE_RECOGNISED_REVENUE: new Set([
    INVOICE_STATUS.CUSTOMER_ACCEPTED,
    INVOICE_STATUS.PAID,
    INVOICE_STATUS.PARTIALLY_PAID
  ]),
  // Invoices with an outstanding balance — drive AR Aging, Bad-Debt.
  INVOICE_OPEN_AR: new Set([
    INVOICE_STATUS.AWAITING_ACCEPTANCE,
    INVOICE_STATUS.CUSTOMER_ACCEPTED,
    INVOICE_STATUS.PARTIALLY_PAID,
    INVOICE_STATUS.APPROVED,
    INVOICE_STATUS.SIGNED
  ]),
  // Invoices that should NEVER appear in financial reports.
  INVOICE_FINANCIALLY_EXCLUDED: new Set([
    INVOICE_STATUS.DRAFT,
    INVOICE_STATUS.REJECTED,
    INVOICE_STATUS.CUSTOMER_REJECTED,
    INVOICE_STATUS.CANCELLED
  ]),
  // Quote stages that are still "in pipeline" (not closed-out).
  QUOTE_OPEN: new Set([
    QUOTE_STATUS.DRAFT,
    QUOTE_STATUS.SENT
  ]),
  // PR stages with active procurement work happening.
  PR_OPEN: new Set([
    PR_STATUS.OPEN,
    PR_STATUS.IN_RFQ,
    PR_STATUS.AWARDED        // AWARDED + not yet FULFILLED = goods en route
  ]),
  // RFQ stages where vendors are still in play.
  RFQ_OPEN: new Set([
    RFQ_STATUS.SENT,
    RFQ_STATUS.RECEIVING,
    RFQ_STATUS.COMPARING,
    RFQ_STATUS.PENDING_APPROVAL
  ])
});

// ═════════════════════════════════════════════════════════════════════════
// SQL-friendly comma-separated string lists for use in `STATUS IN (…)`
// clauses. Avoids repeating string-array.map().join() boilerplate.
//
// Usage:
//   `… WHERE STATUS IN (${SQL_LIST.INVOICE_RECOGNISED_REVENUE}) …`
//
// Output is already wrapped in single quotes and comma-separated.
// ═════════════════════════════════════════════════════════════════════════
function sqlList(set) {
  return Array.from(set).map(s => `'${s.replace(/'/g, "''")}'`).join(',');
}

export const SQL_LIST = Object.freeze({
  INVOICE_RECOGNISED_REVENUE:      sqlList(STATUS_GROUPS.INVOICE_RECOGNISED_REVENUE),
  INVOICE_OPEN_AR:                 sqlList(STATUS_GROUPS.INVOICE_OPEN_AR),
  INVOICE_FINANCIALLY_EXCLUDED:    sqlList(STATUS_GROUPS.INVOICE_FINANCIALLY_EXCLUDED),
  QUOTE_OPEN:                      sqlList(STATUS_GROUPS.QUOTE_OPEN),
  PR_OPEN:                         sqlList(STATUS_GROUPS.PR_OPEN),
  RFQ_OPEN:                        sqlList(STATUS_GROUPS.RFQ_OPEN)
});

// ═════════════════════════════════════════════════════════════════════════
// Predicate helpers — semantic intent, not magic-string-replicated checks.
// ═════════════════════════════════════════════════════════════════════════

/** True iff this invoice status counts as recognised revenue. */
export function isRecognisedRevenue(status) {
  return STATUS_GROUPS.INVOICE_RECOGNISED_REVENUE.has(status);
}

/** True iff this invoice status carries outstanding AR balance. */
export function isOpenInvoice(status) {
  return STATUS_GROUPS.INVOICE_OPEN_AR.has(status);
}

/** True iff this PR is in an actively-being-worked state. */
export function isOpenPr(status) {
  return STATUS_GROUPS.PR_OPEN.has(status);
}

// ═════════════════════════════════════════════════════════════════════════
// Default exports as a single namespace for clients that want one import.
// ═════════════════════════════════════════════════════════════════════════
export default {
  INVOICE_STATUS,
  INVOICE_TRANSITIONS,
  INVOICE_TERMINAL_STATUSES,
  QUOTE_STATUS,
  RFQ_STATUS,
  PR_STATUS,
  GOODS_RECEIPT_STATUS,
  PAYMENT_STATUS,
  UNALLOC_STATUS,
  STATUS_GROUPS,
  SQL_LIST,
  isRecognisedRevenue,
  isOpenInvoice,
  isOpenPr,
  isAllowedInvoiceTransition,
  isInvoiceTerminal,
  INVOICE_EDITS_FROZEN_STATUSES,
  areInvoiceEditsFrozen
};
