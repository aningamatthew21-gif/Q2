import React from 'react';
import useButtonEffects from '../../hooks/useButtonEffects';

/**
 * Button — the app's single button primitive.
 *
 * Replaces the inline `py-2 px-4 bg-indigo-600 text-white ...`
 * pattern duplicated across 23 pages, as well as the legacy
 * `RippleButton` animated component. Keep the prop contract narrow
 * and native-<button>-compatible so migrations are 1-for-1.
 *
 * Props:
 *  - variant: 'primary' | 'secondary' | 'ghost' | 'danger' | 'link'
 *             default 'primary'
 *  - size:    'sm' | 'md' | 'lg'     default 'md'
 *  - leftIcon / rightIcon:  React nodes rendered inside the button
 *  - fullWidth: boolean
 *  - loading:   boolean — disables the button and swaps content for
 *               a subtle "…" indicator (styled later if desired)
 *  - onClick, disabled, type, className, children — pass-through
 *  - ...rest — forwarded to the underlying <button>
 *
 * Behavior:
 *  - Wraps the user's onClick so that `useButtonEffects().onClickEffect()`
 *    fires FIRST (producing the click sound + haptic in Phase H).
 *  - Effects are no-ops in Phase A; swapping them on is a single-file
 *    change to `src/hooks/useButtonEffects.js`, and every button gains
 *    the behavior without touching call sites.
 *  - active:scale-[0.99] gives a soft press micro-interaction without
 *    the playful RippleButton animation.
 */

const BASE = [
  'inline-flex items-center justify-center gap-2',
  'font-medium whitespace-nowrap',
  'rounded-card',
  'transition-colors duration-150',
  'select-none',
  'active:scale-[0.99]',
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-primary',
  'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100'
].join(' ');

const VARIANT = {
  primary:
    'bg-primary text-white hover:bg-primary-hover',
  secondary:
    'bg-surface text-ink border border-line hover:bg-surface-muted',
  ghost:
    'bg-transparent text-ink hover:bg-surface-sunken',
  danger:
    'bg-danger text-white hover:brightness-95',
  link:
    'bg-transparent text-primary hover:underline px-0 py-0 h-auto'
};

const SIZE = {
  sm: 'text-xs px-3 py-1.5 h-8',
  md: 'text-sm px-4 py-2 h-10',
  lg: 'text-base px-5 py-2.5 h-11'
};

export default function Button({
  variant = 'primary',
  size = 'md',
  leftIcon,
  rightIcon,
  fullWidth = false,
  loading = false,
  disabled = false,
  onClick,
  type = 'button',
  className = '',
  children,
  ref,              // React 19 treats ref as a regular prop on function components
  ...rest
}) {
  const effects = useButtonEffects();
  const isDisabled = disabled || loading;

  const handleClick = (e) => {
    if (isDisabled) return;
    // Fire click effect FIRST (sound + haptic in Phase H). If the
    // effect throws for any reason, ignore it and still call onClick.
    try { effects.onClickEffect({ variant }); } catch { /* noop */ }
    onClick?.(e);
  };

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      onClick={handleClick}
      className={[
        BASE,
        VARIANT[variant] ?? VARIANT.primary,
        variant === 'link' ? '' : SIZE[size] ?? SIZE.md,
        fullWidth ? 'w-full' : '',
        className
      ].filter(Boolean).join(' ')}
      {...rest}
    >
      {leftIcon && <span className="flex-shrink-0">{leftIcon}</span>}
      <span className={loading ? 'opacity-70' : ''}>{children}</span>
      {rightIcon && <span className="flex-shrink-0">{rightIcon}</span>}
    </button>
  );
}
