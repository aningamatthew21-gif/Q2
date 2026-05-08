import React from 'react';
import V2Button from '../v2/Button';

/**
 * Button — v1 surface, v2 internals.
 *
 * The original v1 API (variant `primary`/`secondary`/`ghost`/`danger`/`link`,
 * size `sm`/`md`/`lg`, `leftIcon`/`rightIcon`/`fullWidth`/`loading`) is
 * preserved verbatim so every existing call site keeps working without
 * edits. Internally we render the Fluent 2 v2 Button so the look,
 * motion, sound, and haptics all flip in one shot.
 *
 * Variant mapping:
 *   v1 primary    -> v2 primary
 *   v1 secondary  -> v2 default
 *   v1 ghost      -> v2 subtle
 *   v1 danger     -> v2 danger
 *   v1 link       -> rendered as an unstyled v2 ghost with text-accent
 *
 * Size mapping:
 *   v1 sm/md/lg   -> v2 sm/md/lg
 *
 * Icons:
 *   v1 used `leftIcon` / `rightIcon`. v2 expects `iconLeft` / `iconRight`.
 *   The shim translates the prop names so the icon JSX flows through.
 */

const VARIANT_MAP = {
  primary:   'primary',
  secondary: 'default',
  ghost:     'subtle',
  danger:    'danger',
  link:      'ghost'
};

export default function Button({
  variant = 'primary',
  size = 'md',
  leftIcon,
  rightIcon,
  fullWidth = false,
  loading = false,
  disabled = false,
  className = '',
  children,
  ...rest
}) {
  const v2Variant = VARIANT_MAP[variant] ?? 'default';
  const linkClasses = variant === 'link'
    ? '!h-auto !p-0 !border-0 !bg-transparent !text-accent hover:!underline'
    : '';

  return (
    <V2Button
      variant={v2Variant}
      size={size}
      iconLeft={leftIcon}
      iconRight={rightIcon}
      loading={loading}
      disabled={disabled}
      className={[fullWidth ? 'w-full' : '', linkClasses, className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </V2Button>
  );
}
