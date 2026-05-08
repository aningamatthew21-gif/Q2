import React from 'react';
import { motion } from 'framer-motion';
import { MoreHorizontal } from 'lucide-react';
import clsx from 'clsx';
import { staggerItem, cardHover, TRANSITION_OUT } from './motion';

/**
 * ChartCard — header-and-canvas wrapper for any Recharts (or custom) chart.
 *
 *   <ChartCard title="Revenue trend" subtitle="Weekly · last quarter" height={260}>
 *     <BarChart .../>
 *   </ChartCard>
 *
 * Renders a card with a 14px title + 12px subtitle, an optional
 * right-side action slot (defaults to a 3-dot menu), and a
 * fixed-height canvas area for the chart.
 */
export default function ChartCard({
  title, subtitle, right,
  height = 260, padded = true,
  children, className = ''
}) {
  return (
    <motion.div
      variants={staggerItem}
      whileHover={cardHover}
      transition={TRANSITION_OUT}
      className={clsx('bg-white border border-n-200 rounded-card overflow-hidden', className)}
    >
      <div className="px-4 py-3 border-b border-n-200 flex items-center justify-between gap-3">
        <div className="min-w-0">
          {title    && <div className="text-[13px] font-semibold text-n-800 truncate">{title}</div>}
          {subtitle && <div className="text-xs text-n-500 mt-0.5 truncate">{subtitle}</div>}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {right ?? (
            <button
              type="button"
              className="w-7 h-7 grid place-items-center rounded-md text-n-500 hover:bg-n-100 hover:text-n-700"
              aria-label="More"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      <div className={clsx(padded && 'p-4')} style={{ height }}>
        {children}
      </div>
    </motion.div>
  );
}

/* Shared chart palette — keeps every chart on the same colour ramp. */
export const CHART_COLORS = {
  accent:  '#0F6CBD',
  ok:      '#107C10',
  warn:    '#B7710E',
  err:     '#C4314B',
  info:    '#005FB8',
  neutral: '#605E5C',
  grid:    '#EDEBE9',
  axis:    '#A19F9D'
};
export const CHART_SERIES = [
  '#0F6CBD', '#5C2E91', '#0E7C7B', '#B7710E',
  '#8A8886', '#107C10', '#C4314B', '#005FB8'
];
