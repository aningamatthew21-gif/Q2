import React from 'react';
import { motion } from 'framer-motion';
import { cardHover, TRANSITION_OUT } from '../v2/motion';

/**
 * Card — v1 API, Fluent 2 visuals.
 *
 * Same prop contract as the original (title / subtitle / actions /
 * padding / dense / as) so call sites keep working unchanged. The
 * card is now a Fluent 2 surface: white background, 1px neutral
 * border, very subtle shadow, soft -1px hover-lift driven by
 * framer-motion. Header typography reduced from `text-base` to the
 * Fluent `text-[13px]` and the divider rule moved to the bottom of
 * the header for a clearer information hierarchy.
 */
export default function Card({
  title,
  subtitle,
  actions,
  padding,
  dense = false,
  as: Tag = 'section',
  className = '',
  children,
  interactive = false,
  ...rest
}) {
  const effectivePadding = padding ?? (dense ? 'p-4' : 'p-5');
  const hasHeader = title || subtitle || actions;

  const Inner = (
    <Tag
      className={[
        'bg-white',
        'border border-n-200',
        'rounded-card',
        'shadow-card',
        'overflow-hidden',
        className
      ].join(' ')}
      {...rest}
    >
      {hasHeader && (
        <header
          className={[
            'flex items-start justify-between gap-4',
            'px-5 py-3 border-b border-n-200'
          ].join(' ')}
        >
          <div className="min-w-0">
            {title && (
              <h3 className="text-[13px] font-semibold text-n-800 leading-tight truncate">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="mt-0.5 text-xs text-n-500 leading-snug">
                {subtitle}
              </p>
            )}
          </div>
          {actions && (
            <div className="flex items-center gap-2 flex-shrink-0">
              {actions}
            </div>
          )}
        </header>
      )}
      <div className={hasHeader ? effectivePadding : effectivePadding}>
        {children}
      </div>
    </Tag>
  );

  if (interactive) {
    return (
      <motion.div whileHover={cardHover} transition={TRANSITION_OUT}>
        {Inner}
      </motion.div>
    );
  }
  return Inner;
}
