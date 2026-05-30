import React from 'react';

/**
 * RequiredMark — visual red asterisk for required form fields.
 *
 * Standards anchor:
 *   - WCAG 3.3.2 (Labels or Instructions) — fields requiring user input
 *     must be clearly identified
 *   - ISO 9241-110 — Suitability for User Expectations (forms behave the
 *     way users expect from every other government / banking / SaaS form)
 *
 * Why `aria-hidden="true"`:
 *   The asterisk is decorative duplication for SIGHTED users. Screen
 *   readers should announce required-ness via the `aria-required` /
 *   `required` attributes on the INPUT itself, not by reading "*"
 *   aloud (which would be confusing). If you ever wire aria-required
 *   on the input, the SR experience is correct without us having to
 *   un-hide this span.
 *
 * Why a separate tiny component instead of inline span:
 *   Single source of truth for color, spacing, and ARIA. If we later
 *   need to adjust (e.g. switch to a subtler dot, add a tooltip, etc.)
 *   we change one file.
 *
 * Usage:
 *   <label>Customer Name <RequiredMark /></label>
 *
 * Or use the <Label required> wrapper for the most common case.
 */
export default function RequiredMark({ className = '' }) {
  return (
    <span
      className={`text-red-500 ml-0.5 ${className}`}
      aria-hidden="true"
      title="Required"
    >*</span>
  );
}
