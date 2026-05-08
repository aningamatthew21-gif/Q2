/**
 * Centralised motion variants for the v2 Fluent 2 shell.
 *
 * Why a shared file:
 *   - Every page transition / stagger / hover-lift goes through these
 *     constants so the feel stays consistent without per-component drift.
 *   - `prefers-reduced-motion` is honoured in CSS (see src/index.css L168);
 *     framer-motion also reads it via `MotionConfig` in AppShell, so
 *     the variants below collapse to instant when the OS asks for it.
 *
 * Curve choices:
 *   - 0.18s out, 0.24s in is the Fluent 2 standard for short transitions.
 *   - "smoothOut" cubic mimics the easing Microsoft uses in the Office UI.
 */

export const EASE_OUT     = [0.16, 1, 0.3, 1];      // smooth decel
export const EASE_IN_OUT  = [0.65, 0, 0.35, 1];     // symmetrical
export const EASE_SHARP   = [0.4, 0, 1, 1];         // for closes / dismisses

export const DUR = {
  fast:    0.14,
  normal:  0.20,
  slow:    0.28,
  page:    0.24
};

/* ── Page transitions (route-level) ──────────────────────────── */
export const pageVariants = {
  initial: { opacity: 0, y: 8 },
  enter:   { opacity: 1, y: 0, transition: { duration: DUR.page, ease: EASE_OUT } },
  exit:    { opacity: 0, y: -4, transition: { duration: DUR.fast, ease: EASE_SHARP } }
};

/* ── Stagger container for KPI tile rows, list grids ─────────── */
export const staggerContainer = {
  initial: {},
  enter: {
    transition: { staggerChildren: 0.04, delayChildren: 0.04 }
  }
};

export const staggerItem = {
  initial: { opacity: 0, y: 6 },
  enter:   { opacity: 1, y: 0, transition: { duration: DUR.normal, ease: EASE_OUT } }
};

/* ── Modals / dialogs ────────────────────────────────────────── */
export const dialogVariants = {
  initial: { opacity: 0, scale: 0.96 },
  enter:   { opacity: 1, scale: 1,    transition: { duration: DUR.normal, ease: EASE_OUT } },
  exit:    { opacity: 0, scale: 0.97, transition: { duration: DUR.fast,   ease: EASE_SHARP } }
};

export const backdropVariants = {
  initial: { opacity: 0 },
  enter:   { opacity: 1, transition: { duration: DUR.fast } },
  exit:    { opacity: 0, transition: { duration: DUR.fast } }
};

/* ── Side panels (right-drawer DetailPanel) ─────────────────── */
export const sidePanelVariants = {
  initial: { x: 32,  opacity: 0 },
  enter:   { x: 0,   opacity: 1, transition: { duration: DUR.normal, ease: EASE_OUT } },
  exit:    { x: 24,  opacity: 0, transition: { duration: DUR.fast,   ease: EASE_SHARP } }
};

/* ── Toasts (slide up from bottom) ──────────────────────────── */
export const toastVariants = {
  initial: { opacity: 0, y: 16, scale: 0.97 },
  enter:   { opacity: 1, y: 0,  scale: 1,    transition: { duration: DUR.normal, ease: EASE_OUT } },
  exit:    { opacity: 0, y: 8,  scale: 0.98, transition: { duration: DUR.fast,   ease: EASE_SHARP } }
};

/* ── Hover-lift card press states (used via whileHover/whileTap) ── */
export const cardHover = { y: -1, boxShadow: '0 4px 12px rgba(0,0,0,0.06)' };
export const cardTap   = { y: 0,  scale: 0.995 };

/* ── Button press (whileTap) ─────────────────────────────────── */
export const buttonTap = { scale: 0.98 };

/* ── Common transition presets for reuse ────────────────────── */
export const TRANSITION_OUT  = { duration: DUR.normal, ease: EASE_OUT };
export const TRANSITION_FAST = { duration: DUR.fast,   ease: EASE_OUT };

/* ── Section reveal (used on dashboard sections, detail bodies) ── */
export const sectionReveal = {
  initial: { opacity: 0, y: 12 },
  enter:   { opacity: 1, y: 0, transition: { duration: DUR.slow, ease: EASE_OUT } }
};

/* ── List row entry — staggered slide from the right ────────── */
export const listRow = {
  initial: { opacity: 0, x: -6 },
  enter:   { opacity: 1, x: 0, transition: { duration: DUR.normal, ease: EASE_OUT } }
};
export const listContainer = {
  initial: {},
  enter:   { transition: { staggerChildren: 0.025, delayChildren: 0.04 } }
};

/* ── Pulse — attention nudge for status changes / new badges ── */
export const pulse = {
  scale: [1, 1.06, 1],
  transition: { duration: 0.6, ease: EASE_IN_OUT }
};

/* ── Bounce-press for sidebar nav items on click ────────────── */
export const navTap = { scale: 0.96 };

/* ── Drawer / sheet (full-height side surface) ──────────────── */
export const drawerVariants = {
  initial: { x: '100%' },
  enter:   { x: 0,     transition: { duration: DUR.slow, ease: EASE_OUT  } },
  exit:    { x: '100%',transition: { duration: DUR.normal, ease: EASE_SHARP } }
};

/* ── Number tick (for KPI value count-up reveals) ───────────── */
export const numberTick = {
  initial: { opacity: 0, y: 4 },
  enter:   { opacity: 1, y: 0, transition: { duration: DUR.slow, ease: EASE_OUT } }
};

/* ── Fade-zoom (used for tab panel swaps inside detail pages) ── */
export const fadeZoom = {
  initial: { opacity: 0, scale: 0.985 },
  enter:   { opacity: 1, scale: 1,    transition: { duration: DUR.normal, ease: EASE_OUT } },
  exit:    { opacity: 0, scale: 0.99, transition: { duration: DUR.fast,   ease: EASE_SHARP } }
};

/* ── Loading shimmer (skeletons) ──────────────────────────── */
export const shimmer = {
  animate: {
    backgroundPosition: ['200% 0', '-200% 0'],
    transition: { duration: 1.6, repeat: Infinity, ease: 'linear' }
  }
};
