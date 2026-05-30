import React from 'react';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import { useButtonEffects } from '../../hooks/useButtonEffects';
import { buttonTap, TRANSITION_FAST } from './motion';

/**
 * CommandBar — Office-style action ribbon for list / detail pages.
 *
 * <CommandBar items={[
 *   { icon:<Plus/>, label:'New', primary:true, onClick },
 *   { divider:true },
 *   { icon:<Edit/>, label:'Edit', disabled:!sel },
 *   { icon:<Filter/>, label:'Filters' },
 *   { spacer:true },
 *   { icon:<Columns/>, label:'Columns' },
 * ]}/>
 *
 * `divider` and `spacer` are layout sentinels.
 */

export default function CommandBar({ items = [], className = '' }) {
  return (
    <div className={clsx(
      'bg-white border border-n-200 rounded-card p-1 flex items-center gap-0.5 mb-4 flex-wrap',
      className
    )}>
      {items.map((it, i) => {
        if (it.divider) {
          return <span key={i} className="w-px h-5 bg-n-200 mx-1" aria-hidden />;
        }
        if (it.spacer) {
          return <span key={i} className="flex-1" />;
        }
        // Custom render slot — lets callers drop in bespoke controls
        // (e.g. a stateful Columns chooser dropdown) without forking
        // the CommandBar. Additive, zero impact on existing call sites.
        if (typeof it.render === 'function') {
          return <React.Fragment key={i}>{it.render()}</React.Fragment>;
        }
        return <CommandButton key={i} {...it} />;
      })}
    </div>
  );
}

function CommandButton({ icon, label, primary, disabled, onClick, title }) {
  // Same bug as v2/Button: `handleClick` is not on the hook's return shape.
  // Use `onClickEffect` and never let an audio/haptic failure block the user's
  // click — the click must always reach the consumer's onClick handler.
  const effects = useButtonEffects();
  const handler = (e) => {
    if (disabled) return;
    try { effects.onClickEffect?.({ variant: primary ? 'primary' : 'subtle' }); } catch { /* never block */ }
    onClick?.(e);
  };
  return (
    <motion.button
      type="button"
      onClick={handler}
      disabled={disabled}
      title={title || label}
      whileTap={!disabled ? buttonTap : undefined}
      transition={TRANSITION_FAST}
      className={clsx(
        'inline-flex items-center gap-1.5 px-2.5 h-7 rounded-[4px] text-[13px] font-medium',
        'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        primary
          ? 'text-accent-text hover:bg-accent-soft'
          : 'text-n-700 hover:bg-n-100',
        disabled && 'text-n-400 hover:bg-transparent cursor-not-allowed'
      )}
    >
      {icon && <span className="w-3.5 h-3.5 grid place-items-center [&_svg]:w-3.5 [&_svg]:h-3.5">{icon}</span>}
      {label && <span>{label}</span>}
    </motion.button>
  );
}
