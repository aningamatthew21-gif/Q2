import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import { useApp } from '../../context/AppContext';
import TopBar    from './TopBar';
import LeftNav   from './LeftNav';
import StatusBar from './StatusBar';
import { pageVariants } from './motion';

/**
 * AppShell — the v2 root chrome (replaces v1 AppLayout).
 *
 * Layout (md+):
 *   ┌──────────────────────────────────────┐
 *   │ TopBar (48px sticky)                 │
 *   ├────────┬─────────────────────────────┤
 *   │ LeftNav│ <Workspace>                 │
 *   │ (224px)│   children rendered here    │
 *   │        │ </Workspace>                │
 *   ├────────┴─────────────────────────────┤
 *   │ StatusBar (28px)                     │
 *   └──────────────────────────────────────┘
 *
 * Mobile collapses LeftNav into a drawer toggled from TopBar's hamburger.
 *
 * MotionConfig wraps the whole app so framer-motion globally respects
 * `prefers-reduced-motion`. AnimatePresence + page key drives the route
 * fade/slide transition.
 */

export default function AppShell({ children }) {
  const { page } = useApp();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const prevPageRef = useRef(page);

  // Close mobile nav whenever the page changes (defensive — LeftNav
  // already calls onCloseMobile on click, but in-app `navigate()`
  // calls from elsewhere should still collapse the drawer).
  useEffect(() => { setMobileNavOpen(false); }, [page]);

  // Track navigation order so the page transition can pick a directional
  // motion (forward = slide up, back = slide down). The ordering uses a
  // simple stack so deep-link arrivals don't pollute the heuristic.
  const directionRef = useRef('forward');
  useEffect(() => {
    if (prevPageRef.current !== page) {
      // No reliable history index here; default to "forward" but allow
      // a hash like #back to flip the variant when AppContext signals it.
      directionRef.current = 'forward';
      prevPageRef.current = page;
    }
  }, [page]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-n-50 text-n-700">
        {/*
          WCAG 2.1 § 2.4.1 — Bypass Blocks (Level A).
          Visually hidden until the user tabs to it; then jumps focus
          past the TopBar + LeftNav to the page content. Single point
          of access for keyboard / screen-reader users on every page.
        */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-3 focus:py-2 focus:bg-accent focus:text-white focus:rounded-md focus:shadow-popover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-accent"
        >
          Skip to main content
        </a>
        {/* Sticky top bar (48px) */}
        <TopBar onOpenMobileNav={() => setMobileNavOpen(true)} />

        {/* Body row: LeftNav (sticky) + scrollable workspace */}
        <div className="flex">
          <LeftNav
            mobileOpen={mobileNavOpen}
            onCloseMobile={() => setMobileNavOpen(false)}
          />

          <main
            id="main-content"
            tabIndex={-1}
            className="flex-1 min-w-0 min-h-[calc(100vh-3rem)]"
            /* Pad bottom by status-bar height + a breath of room so the
               last interactive control is never sitting under the fixed
               status strip. */
            style={{ paddingBottom: 'calc(1.75rem + 12px)' }}
          >
            <div className="px-4 sm:px-6 lg:px-8 py-5 max-w-[1600px] w-full mx-auto">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={page}
                  variants={pageVariants}
                  initial="initial"
                  animate="enter"
                  exit="exit"
                >
                  {children}
                </motion.div>
              </AnimatePresence>
            </div>
          </main>
        </div>

        {/* Fixed status bar at the bottom of the viewport (Office-style). */}
        <div className="fixed bottom-0 left-0 right-0 z-30 md:left-56">
          <StatusBar />
        </div>
      </div>
    </MotionConfig>
  );
}
