import React from 'react';

/**
 * StatusPill — single source of truth for every colored status badge.
 *
 * Replaces the 5+ scattered `getStatusColor()` helpers and inline
 * ternary chains across AllInvoices, MyInvoices, ProcurementDashboard,
 * PurchaseRequisitionList, VendorManagement, SalesInvoiceApproval,
 * SalesInvoiceReview.
 *
 * Design philosophy — Enterprise Neutral:
 *   - Muted "soft" background + dark semantic text (e.g. bg-success-soft
 *     + text-success). Not the old "bg-green-100 / text-green-800"
 *     rainbow — one accent family per semantic.
 *   - Every status across the app (invoice, PR, RFQ, vendor, payment)
 *     collapses into four semantic bands: neutral, info, success,
 *     warn, danger. No per-status hue soup.
 *
 * Usage:
 *   <StatusPill status={inv.status} />                    // invoice
 *   <StatusPill status={pr.status}  domain="pr" />        // procurement
 *   <StatusPill tone="success">Custom</StatusPill>        // manual tone
 *
 * Props:
 *   - status: string from the backend (mapped via STATUS_MAP)
 *   - domain: 'invoice' | 'pr' | 'rfq' | 'vendor' | 'generic'
 *   - tone:   when set, bypasses mapping and uses tone directly
 *             one of 'neutral' | 'info' | 'success' | 'warn' | 'danger'
 *   - children: custom label (falls back to `status`)
 *   - size: 'sm' | 'md' (default 'sm')
 *   - className: pass-through
 */

const TONE = {
  neutral: 'bg-surface-sunken text-ink-muted',
  info:    'bg-info-soft    text-info',
  success: 'bg-success-soft text-success',
  warn:    'bg-warning-soft text-warning',
  danger:  'bg-danger-soft  text-danger'
};

// Canonical status → tone mapping. All historical backend status
// strings are covered. Unknown values fall back to 'neutral'.
const STATUS_MAP = {
  invoice: {
    'Paid':                 'success',
    'Customer Accepted':    'success',
    'Approved':             'info',       // "Ready to Send"
    'Awaiting Acceptance':  'warn',
    'Pending Approval':     'warn',
    'Pending Pricing':      'warn',       // procurement sourcing
    'Rejected':             'danger',
    'Customer Rejected':    'danger'
  },
  pr: {
    'OPEN':       'warn',
    'IN_RFQ':     'info',
    'AWARDED':    'success',
    'FULFILLED':  'success',
    'CANCELLED':  'neutral'
  },
  rfq: {
    'DRAFT':                'neutral',
    'SENT':                 'info',
    'AWAITING_RESPONSES':   'info',
    'RESPONSES_LOGGED':     'warn',
    'RECOMMENDED':          'warn',
    'APPROVED':             'success',
    'REJECTED':             'danger',
    'CANCELLED':            'neutral',
    'ESCALATED':            'danger'
  },
  vendor: {
    'active':    'success',
    'suspended': 'warn',
    'inactive':  'neutral'
  },
  generic: {
    // Ad-hoc status keywords; covers yes/no/fail/ok style outputs from
    // DatabaseDiagnostic and similar components.
    'ok':      'success',
    'OK':      'success',
    'PASS':    'success',
    'pass':    'success',
    'FAIL':    'danger',
    'fail':    'danger',
    'ERROR':   'danger',
    'error':   'danger',
    'WARNING': 'warn',
    'warning': 'warn'
  }
};

const SIZE = {
  sm: 'text-xs px-2 py-0.5',
  md: 'text-sm px-3 py-1'
};

function resolveTone({ status, domain, tone }) {
  if (tone && TONE[tone]) return tone;
  const map = STATUS_MAP[domain] ?? STATUS_MAP.invoice;
  return map[status] ?? 'neutral';
}

export default function StatusPill({
  status,
  domain = 'invoice',
  tone,
  size = 'sm',
  className = '',
  children
}) {
  const resolvedTone = resolveTone({ status, domain, tone });
  return (
    <span
      className={[
        'inline-flex items-center gap-1 font-medium whitespace-nowrap',
        'rounded-pill',
        TONE[resolvedTone],
        SIZE[size] ?? SIZE.sm,
        className
      ].join(' ')}
    >
      {children ?? status ?? '—'}
    </span>
  );
}

// Export the mapping for tests/storybook if ever needed.
export { TONE, STATUS_MAP };
