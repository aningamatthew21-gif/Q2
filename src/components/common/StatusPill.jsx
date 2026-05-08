import React from 'react';
import V2StatusBadge from '../v2/StatusBadge';

/**
 * StatusPill — v1 API, v2 StatusBadge under the hood.
 *
 * The v1 API is preserved (status / domain / tone / size / className /
 * children) so all existing call sites — AllInvoices, MyInvoices, the
 * dashboards, RFQ list, vendor list — keep working with no edits.
 *
 * Tone resolution moves to v2 StatusBadge's auto-detector for free-form
 * strings, but explicit `tone="success"` / `tone="danger"` etc still
 * works via the v1→v2 tone map below. Domain-specific status maps that
 * v1 used (`pr`, `rfq`, `vendor`) are kept here so backend strings like
 * 'IN_RFQ' or 'AWAITING_RESPONSES' resolve to the right colour.
 */

const TONE_V1_TO_V2 = {
  neutral: 'muted',
  info:    'info',
  success: 'ok',
  warn:    'warn',
  danger:  'err'
};

const STATUS_MAP = {
  invoice: {
    'Paid':                 'success',
    'Customer Accepted':    'success',
    'Approved':             'info',
    'Awaiting Acceptance':  'warn',
    'Pending Approval':     'warn',
    'Pending Pricing':      'warn',
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
    'PENDING_APPROVAL':     'warn',
    'APPROVED':             'success',
    'AWARDED':              'success',
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
    'ok':'success','OK':'success','PASS':'success','pass':'success',
    'FAIL':'danger','fail':'danger','ERROR':'danger','error':'danger',
    'WARNING':'warn','warning':'warn'
  }
};

function resolveV1Tone({ status, domain, tone }) {
  if (tone) return tone;
  const map = STATUS_MAP[domain] ?? STATUS_MAP.invoice;
  return map[status] ?? null;       // null => let v2 auto-detect
}

export default function StatusPill({
  status,
  domain = 'invoice',
  tone,
  size = 'sm',
  className = '',
  children
}) {
  const v1Tone = resolveV1Tone({ status, domain, tone });
  const v2Tone = v1Tone ? TONE_V1_TO_V2[v1Tone] : undefined;

  return (
    <V2StatusBadge
      value={status}
      tone={v2Tone}
      size={size === 'md' ? 'md' : 'sm'}
      className={className}
    >
      {children ?? status ?? '—'}
    </V2StatusBadge>
  );
}

export { STATUS_MAP };
