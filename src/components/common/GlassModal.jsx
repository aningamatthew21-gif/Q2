import React from 'react';
import V2Dialog from '../v2/Dialog';

/**
 * GlassModal — v1 API, v2 Dialog under the hood.
 *
 * Every one of the 11 modals in the app imports `common/GlassModal`,
 * so this single rewrite swaps glass-and-blur for the flat Fluent 2
 * Dialog without touching any call site. The original prop contract
 * (open, onClose, title, description, footer, size, closeOnBackdrop,
 * hideCloseButton, initialFocusRef, className, children) is preserved
 * verbatim — the legacy size strings (`sm` / `md` / `lg` / `xl` / `fit`
 * / `full`) map 1-for-1 onto v2 Dialog's sizes.
 *
 * Behaviours that callers depend on (Escape closes, Tab cycles inside
 * the panel, body scroll locked, focus restored on close, ARIA roles)
 * are implemented inside the v2 Dialog so they carry over automatically.
 * The only behavioural change is the visual: glass-blur card → flat
 * white panel with a subtle elevation shadow, animated in via scale +
 * backdrop fade.
 *
 * Edge case preserved: a few v1 callers conditionally render the modal
 * at the parent level rather than passing `open`. v2 Dialog requires an
 * explicit boolean so we coerce a missing `open` to `true`, matching v1
 * semantics where "mounted" implied "open".
 */
export default function GlassModal({ open, ...rest }) {
  const isOpen = open === undefined ? true : !!open;
  return <V2Dialog open={isOpen} {...rest} />;
}
