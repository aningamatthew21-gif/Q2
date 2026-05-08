import React from 'react';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import { useButtonEffects } from '../../hooks/useButtonEffects';
import { buttonTap, TRANSITION_FAST } from './motion';

/**
 * Button — Fluent 2 primitive.
 *
 * Variants:
 *   primary  — cobalt accent fill (call-to-action)
 *   default  — white with neutral border (secondary)
 *   subtle   — transparent, hover background only (in command bars)
 *   ghost    — same as subtle but no padding (icon-only)
 *   danger   — bordered, red text/hover (destructive)
 *
 * Sizes:
 *   sm (24px), md (32px — Fluent default), lg (40px)
 *
 * Behaviour:
 *   - whileTap scales to 0.98 (skipped under prefers-reduced-motion via MotionConfig)
 *   - useButtonEffects() plays the configured click sound + haptic on every click,
 *     unchanged from v1 — this Button is a drop-in for `common/Button.jsx`.
 *   - Renders as <button> by default; pass `as="a"` and `href` for navigation.
 */

const VARIANT = {
  primary:
    'bg-accent text-white border border-accent ' +
    'hover:bg-accent-hover hover:border-accent-hover ' +
    'active:bg-accent-pressed active:border-accent-pressed ' +
    'disabled:bg-n-200 disabled:border-n-200 disabled:text-n-400',
  default:
    'bg-white text-n-800 border border-n-300 ' +
    'hover:bg-n-50 hover:border-n-400 ' +
    'active:bg-n-100 ' +
    'disabled:bg-n-50 disabled:text-n-400 disabled:border-n-200',
  subtle:
    'bg-transparent text-n-700 border border-transparent ' +
    'hover:bg-n-100 active:bg-n-200 ' +
    'disabled:text-n-400',
  ghost:
    'bg-transparent text-n-600 border border-transparent ' +
    'hover:bg-n-100 hover:text-n-800 active:bg-n-200 ' +
    'disabled:text-n-300',
  danger:
    'bg-white text-err border border-n-300 ' +
    'hover:bg-err-soft hover:border-err ' +
    'active:bg-err-soft ' +
    'disabled:bg-n-50 disabled:text-n-400 disabled:border-n-200'
};

const SIZE = {
  sm: 'h-6 px-2.5 text-xs gap-1.5 rounded-[4px]',
  md: 'h-8 px-3.5 text-[13px] gap-1.5 rounded-[4px]',
  lg: 'h-10 px-5 text-sm gap-2 rounded-[6px]'
};

const ICON_SIZE = { sm: 'w-3.5 h-3.5', md: 'w-3.5 h-3.5', lg: 'w-4 h-4' };

export default function Button({
  variant = 'default',
  size = 'md',
  iconLeft,
  iconRight,
  loading = false,
  disabled = false,
  children,
  className = '',
  onClick,
  type = 'button',
  as = 'button',
  ...rest
}) {
  // useButtonEffects() returns { onClickEffect, onSuccess, onError }. Earlier
  // versions of this Button destructured a non-existent `handleClick`, which
  // threw inside the click handler and silently swallowed every onClick in the
  // app — including Sign In. We now use the real export and wrap it so a
  // failure inside the audio path NEVER blocks the user's click.
  const effects = useButtonEffects();
  const Tag = as === 'a' ? motion.a : motion.button;

  const classes = clsx(
    'inline-flex items-center justify-center font-medium select-none',
    'transition-colors',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1',
    'disabled:cursor-not-allowed',
    SIZE[size] ?? SIZE.md,
    VARIANT[variant] ?? VARIANT.default,
    className
  );

  const onClickInternal = (e) => {
    if (disabled || loading) { e.preventDefault?.(); return; }
    try { effects.onClickEffect?.({ variant }); } catch { /* never block the click */ }
    onClick?.(e);
  };

  const iconClass = ICON_SIZE[size] ?? ICON_SIZE.md;
  const wrapIcon = (node) =>
    node ? React.cloneElement(node, {
      className: clsx(iconClass, 'flex-shrink-0', node.props?.className)
    }) : null;

  return (
    <Tag
      type={as === 'button' ? type : undefined}
      className={classes}
      whileTap={!disabled && !loading ? buttonTap : undefined}
      transition={TRANSITION_FAST}
      onClick={onClickInternal}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <span className={clsx(iconClass, 'animate-spin border-2 border-current border-t-transparent rounded-full')} />
      ) : wrapIcon(iconLeft)}
      {children && <span className="truncate">{children}</span>}
      {!loading && wrapIcon(iconRight)}
    </Tag>
  );
}
