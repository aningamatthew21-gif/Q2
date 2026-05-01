/**
 * LiquidGlassCard — backward-compat shim.
 *
 * This component used to implement its own backdrop-filter + sheen.
 * That behavior now lives in `src/components/common/GlassSurface.jsx`,
 * which is Tailwind-token based and shared across the sidebar and
 * all modals (Apple-style unified glass language).
 *
 * Existing call sites (currently only LoginScreen.jsx) keep working
 * because this file simply re-exports GlassSurface with prop
 * translation:
 *
 *   <LiquidGlassCard radius={24} blur={14} tint="rgba(...)">
 *      ↓
 *   <GlassSurface radius="glass" tint="default" interactive>
 *
 * Phase F will migrate LoginScreen directly to GlassSurface and this
 * shim can be deleted in a future cleanup sprint. For now it exists
 * solely so Phase A is non-breaking.
 */
import React from 'react';
import GlassSurface from './common/GlassSurface';

// Map legacy `tint` (rgba string) to the new enum. Anything with
// visible alpha gets 'default'; nearly-opaque gets 'strong'; fully
// transparent gets 'none'. Good enough for the one caller we have.
function translateTint(legacyTint) {
  if (!legacyTint || typeof legacyTint !== 'string') return 'default';
  const m = legacyTint.match(/rgba?\([^)]*,\s*([0-9.]+)\s*\)/i);
  if (!m) return 'default';
  const alpha = Number(m[1]);
  if (isNaN(alpha)) return 'default';
  if (alpha <= 0.02) return 'none';
  if (alpha >= 0.45) return 'strong';
  return 'default';
}

export default function LiquidGlassCard({
  className = '',
  children,
  radius,      // legacy number in px — ignored; GlassSurface uses token radii
  blur,        // legacy number in px — ignored; GlassSurface uses --blur-glass
  tint,        // legacy rgba string   — translated to GlassSurface enum
  ...rest
}) {
  // Preserve original behavior: sheen was always on, so mark
  // interactive=true.
  return (
    <GlassSurface
      tint={translateTint(tint)}
      radius="glass"
      interactive
      padding="p-0"
      className={className}
      {...rest}
    >
      {children}
    </GlassSurface>
  );
}
