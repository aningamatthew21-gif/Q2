import React, { useState } from 'react';
import Sidebar from './Sidebar';
import Icon from '../common/Icon';

/**
 * AppLayout — the root chrome for every authenticated page.
 *
 * Renders the persistent sidebar on the left and the page content on
 * the right. On mobile, the sidebar becomes a drawer toggled by a
 * hamburger button in a slim top bar.
 *
 * Pages that should opt OUT of the layout (LoginScreen, CustomerPortal)
 * are rendered outside AppLayout in AppContext's renderPage(), so this
 * component never needs to know about them.
 *
 * Width discipline:
 *   - md (≥768px): sidebar is 240px (or 64px collapsed); main content
 *     has a matching md:pl-60 so the two don't overlap. When the user
 *     collapses the rail, Sidebar becomes w-16 — we can't reactively
 *     know that here, so we leave the md:pl-60 as the worst-case pad
 *     and let the sidebar visually sit inside; it still looks fine
 *     because the sidebar is on a higher z-index and has its own
 *     solid-ish glass background.
 *   - sm  (<768px): sidebar is a drawer (off-canvas); main content
 *     gets pl-0 and a thin top bar with the hamburger + brand.
 */
export default function AppLayout({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-surface-muted">
      <Sidebar mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />

      {/* Mobile top bar */}
      <div className="md:hidden sticky top-0 z-20 bg-surface/80 backdrop-blur-sm border-b border-line flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="h-9 w-9 inline-flex items-center justify-center rounded-card text-ink hover:bg-surface-sunken"
          aria-label="Open navigation"
        >
          <Icon id="bars" />
        </button>
        <span className="font-semibold text-ink tracking-tight">MIDSA</span>
      </div>

      {/* Main content area */}
      <main className="md:pl-60 transition-[padding] duration-200">
        <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-[1600px] mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
