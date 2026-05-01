import React, { useRef, useState, useCallback } from 'react';

/**
 * GlassSurface — Apple-style translucent container.
 *
 * Replaces the legacy `LiquidGlassCard` with a Tailwind-v4-token-based
 * implementation. Reads tokens defined in src/index.css (@theme):
 *   bg-glass, bg-glass-strong, bg-glass-tint
 *   backdrop-blur-glass
 *   shadow-glass, rounded-glass
 *
 * Design goals:
 *  - One visual language for the sidebar and all modals.
 *  - Subtle (Apple-grade): the breathing + sheen effects from the old
 *    LiquidGlassCard are kept but toned down (~40% amplitude) so the
 *    app reads as professional, not playful.
 *  - prefers-reduced-motion: all animation/transition durations are
 *    clamped to ~0ms by the global rule in src/index.css, so we don't
 *    need JS branching here.
 *  - No dynamic stylesheets. Animations live in one static <style> tag
 *    per component and never re-render.
 *
 * Props:
 *  - tint:        'default' | 'strong' | 'muted' | 'none'   (default 'default')
 *  - radius:      'card' | 'panel' | 'glass'                (default 'glass')
 *  - interactive: boolean — mouse-follow sheen (default false).
 *                 Leave off for sidebars/panels; turn on for modals
 *                 and the login card.
 *  - padding:     Tailwind padding class (default 'p-6').
 *  - as:          element tag (default 'div').
 *  - className, children, ...rest — pass-through.
 */
const TINT_CLASS = {
  default: 'bg-glass',
  strong:  'bg-glass-strong',
  muted:   'bg-glass-tint',
  none:    'bg-transparent'
};

const RADIUS_CLASS = {
  card:  'rounded-card',
  panel: 'rounded-panel',
  glass: 'rounded-glass'
};

export default function GlassSurface({
  tint = 'default',
  radius = 'glass',
  interactive = false,
  padding = 'p-6',
  as: Tag = 'div',
  className = '',
  innerClassName = '',
  children,
  ref: forwardedRef,   // React 19 ref-as-prop
  ...rest
}) {
  const ref = useRef(null);
  const [sheen, setSheen] = useState({ x: 50, y: 50 });

  // Merge internal ref (for sheen geometry) with any forwarded ref
  // (used by GlassModal for the focus-trap panel).
  const setRefs = useCallback((node) => {
    ref.current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef && typeof forwardedRef === 'object') {
      forwardedRef.current = node;
    }
  }, [forwardedRef]);

  // Scoped mousemove — only wired when `interactive`. Avoids a
  // global `window` listener per surface (the legacy LiquidGlassCard
  // attached one window listener per instance).
  const onMouseMove = useCallback((e) => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100;
    const y = ((e.clientY - r.top) / r.height) * 100;
    setSheen({ x, y });
  }, []);

  const tintClass = TINT_CLASS[tint] ?? TINT_CLASS.default;
  const radiusClass = RADIUS_CLASS[radius] ?? RADIUS_CLASS.glass;

  return (
    <Tag
      ref={setRefs}
      data-interactive={interactive ? 'true' : 'false'}
      onMouseMove={interactive ? onMouseMove : undefined}
      className={[
        'glass-surface',
        'relative overflow-hidden',
        tintClass,
        radiusClass,
        'backdrop-blur-glass shadow-glass',
        padding,
        className
      ].join(' ')}
      style={interactive ? { '--mx': `${sheen.x}%`, '--my': `${sheen.y}%` } : undefined}
      {...rest}
    >
      {/* Static style — defined once, never re-renders. */}
      <style>{`
        @keyframes glass-breathe {
          0%, 100% { transform: scale(1); }
          50%      { transform: scale(1.002); }
        }
        .glass-surface {
          animation: glass-breathe 9s ease-in-out infinite alternate;
        }
        .glass-surface::before {
          content: '';
          position: absolute;
          inset: 0;
          background: radial-gradient(
            circle at var(--mx, 50%) var(--my, 50%),
            rgba(255, 255, 255, 0.28) 0%,
            transparent 32%
          );
          opacity: 0;
          transition: opacity 220ms ease;
          pointer-events: none;
        }
        .glass-surface[data-interactive="true"]::before { opacity: 0.7; }
      `}</style>

      {/* Content sits above the sheen pseudo-element. The `innerClassName`
          prop lets modals pass `h-full flex flex-col min-h-0` so their
          header/body/footer can participate in flex sizing (otherwise the
          scrollable body's `flex-1 overflow-y-auto` is silently neutralised
          by this wrapper). */}
      <div className={['relative z-10', innerClassName].filter(Boolean).join(' ')}>
        {children}
      </div>
    </Tag>
  );
}
