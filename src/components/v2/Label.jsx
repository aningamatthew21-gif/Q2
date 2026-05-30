import React from 'react';
import RequiredMark from './RequiredMark';

/**
 * Label — drop-in replacement for the native <label> tag that adds a
 * red asterisk when `required` is true.
 *
 * Standards anchor:
 *   - WCAG 3.3.2 (Labels or Instructions)
 *   - ISO 9241-110 (User-expectation conformance)
 *
 * Backward-compat: takes the SAME props as <label> (className, htmlFor,
 * children, …). Migration is a one-line diff per field:
 *
 *   - <label className={LABEL_CLASS}>Customer Name</label>
 *   + <Label className={LABEL_CLASS} required>Customer Name</Label>
 *
 * The `required` prop is visual-only — the underlying input is NOT
 * given the HTML `required` attribute by this component (deliberate
 * blast-radius decision: JS save handlers stay the source of truth for
 * validation; this layer adds the visual cue without changing browser
 * submit behavior). If you DO want browser-blocking on empty submit,
 * add `required aria-required="true"` to the input itself.
 */
export default function Label({
  required = false,
  className = '',
  children,
  ...rest
}) {
  return (
    <label className={className} {...rest}>
      {children}{required && <RequiredMark />}
    </label>
  );
}
