import React from 'react';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import { cardHover, TRANSITION_OUT } from './motion';

/**
 * Card — flat Fluent 2 surface.
 *
 * Default is a static container; pass `interactive` to opt into
 * the hover-lift (-1px translate + softer shadow) used on tiles
 * and clickable list items.
 *
 * Sub-parts:
 *   <CardHead title subtitle right />  — bordered top section
 *   <CardBody pad>                     — main padded content
 */

export default function Card({
  interactive = false,
  className = '',
  children,
  onClick,
  ...rest
}) {
  const Tag = interactive ? motion.div : 'div';
  const classes = clsx(
    'bg-white border border-n-200 rounded-card overflow-hidden',
    interactive && 'cursor-pointer',
    className
  );
  return (
    <Tag
      className={classes}
      onClick={onClick}
      whileHover={interactive ? cardHover : undefined}
      transition={interactive ? TRANSITION_OUT : undefined}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function CardHead({ title, subtitle, right, children, className = '' }) {
  return (
    <div className={clsx(
      'px-4 py-3 border-b border-n-200 flex items-center justify-between gap-3',
      className
    )}>
      <div className="min-w-0">
        {title && <div className="text-[13px] font-semibold text-n-800 truncate">{title}</div>}
        {subtitle && <div className="text-xs text-n-500 mt-0.5 truncate">{subtitle}</div>}
        {children}
      </div>
      {right && <div className="flex items-center gap-1 flex-shrink-0">{right}</div>}
    </div>
  );
}

export function CardBody({ pad = true, className = '', children }) {
  return (
    <div className={clsx(pad && 'p-4', className)}>{children}</div>
  );
}
