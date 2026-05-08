import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import clsx from 'clsx';
import { ResponsiveContainer, AreaChart, Area } from 'recharts';
import { staggerItem, cardHover, TRANSITION_OUT } from './motion';

/**
 * MetricTile — Fluent 2 KPI card.
 *
 *   <MetricTile
 *     label="Quotes sent"
 *     value={142}
 *     format="number"
 *     delta={12}            // %, positive=up, negative=down
 *     deltaSuffix="%"
 *     trend="up"
 *     spark={[8,9,11,9,12,14,15,13,17,18,16,19]}
 *   />
 *
 * Behaviour:
 *   - Numeric value tickers from 0 → final on mount.
 *   - Animates in via staggerItem when wrapped in a stagger container.
 *   - Soft hover-lift.
 *   - Spark area chart underneath, accent-tinted.
 */

const fmt = (v, format = 'number') => {
  if (v == null) return '–';
  const n = Number(v);
  if (format === 'currency') {
    return n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  }
  if (format === 'percent') return `${n.toFixed(0)}%`;
  if (format === 'compact') {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k';
    return String(Math.round(n));
  }
  return n.toLocaleString();
};

function useNumberTicker(target, duration = 700) {
  const [val, setVal] = useState(0);
  const startRef = useRef(null);
  const rafRef = useRef(0);
  useEffect(() => {
    if (typeof target !== 'number' || Number.isNaN(target)) {
      setVal(target);
      return;
    }
    cancelAnimationFrame(rafRef.current);
    startRef.current = null;
    const tick = (t) => {
      if (!startRef.current) startRef.current = t;
      const progress = Math.min(1, (t - startRef.current) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);  // easeOutCubic
      setVal(target * eased);
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
      else setVal(target);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);
  return val;
}

export default function MetricTile({
  label, value, format = 'number',
  delta, deltaSuffix = '%', trend = 'flat',
  prefix = '', spark = [],
  onClick, ariaLabel,
  className = ''
}) {
  const isNumeric = typeof value === 'number';
  const ticked = useNumberTicker(isNumeric ? value : 0);
  const display = isNumeric ? fmt(ticked, format) : value;

  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  const trendCls  = trend === 'up'   ? 'text-ok bg-ok-soft'
                  : trend === 'down' ? 'text-err bg-err-soft'
                  :                    'text-n-600 bg-n-100';

  // Recharts data needs objects
  const sparkData = spark.map((y, i) => ({ i, y }));

  return (
    <motion.div
      variants={staggerItem}
      whileHover={cardHover}
      whileTap={onClick ? { scale: 0.99 } : undefined}
      transition={TRANSITION_OUT}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={ariaLabel ?? (onClick ? `${label}: ${value}. Click to view.` : undefined)}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } } : undefined}
      className={clsx(
        'bg-white border border-n-200 rounded-card p-4 flex flex-col gap-2',
        'relative overflow-hidden v2-sweep',
        onClick && 'cursor-pointer hover:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        className
      )}
    >
      <div className="text-xs text-n-500">{label}</div>
      <div className="flex items-end justify-between gap-2">
        <div className="text-2xl font-semibold text-n-800 leading-none font-mono-num">
          {prefix}{display}
        </div>
        {delta != null && (
          <span className={clsx(
            'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-pill text-[11px] font-semibold',
            trendCls
          )}>
            <TrendIcon className="w-3 h-3" />
            {delta > 0 ? '+' : ''}{delta}{deltaSuffix}
          </span>
        )}
      </div>

      {sparkData.length > 1 && (
        <div className="h-9 -mx-1 -mb-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparkData} margin={{ top:2, bottom:0, left:0, right:0 }}>
              <defs>
                <linearGradient id={`spark-${label?.replace(/\s/g,'')}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"  stopColor="#0F6CBD" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#0F6CBD" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="y"
                stroke="#0F6CBD"
                strokeWidth={1.5}
                fill={`url(#spark-${label?.replace(/\s/g,'')})`}
                isAnimationActive
                animationDuration={900}
                animationEasing="ease-out"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </motion.div>
  );
}
