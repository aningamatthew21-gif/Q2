import React, { useEffect, useRef } from 'react';
import clsx from 'clsx';

/**
 * StatusBadge — Fluent 2 pill with a coloured leading dot.
 *
 * Usage (auto-detect from label):
 *   <StatusBadge value="Pending Approval" />
 *
 * Usage (explicit tone):
 *   <StatusBadge tone="ok">Approved</StatusBadge>
 *
 * Tones map directly to the status tokens (ok / warn / err / info / muted).
 * The auto-detect ladder is conservative — anything unrecognised falls
 * through to `muted` so the UI never crashes on a new status string.
 */

const TONE = {
  ok:    'text-ok bg-ok-soft',
  warn:  'text-warn bg-warn-soft',
  err:   'text-err bg-err-soft',
  info:  'text-info bg-info-soft',
  muted: 'text-n-600 bg-n-100'
};

const RULES = [
  { tone: 'ok',    test: /^(approved|complete|fulfilled|awarded|accepted|active|paid|signed|won|delivered)/i },
  { tone: 'err',   test: /^(rejected|cancelled|canceled|failed|overdue|error|disputed|lost|escalated)/i },
  { tone: 'warn',  test: /(pending approval|pending pricing|pending|awaiting|review|stale|partial|sent back|on hold)/i },
  { tone: 'info',  test: /^(sent|sourcing|comparing|receiving|in progress|in.?rfq|recommended|submitted)/i }
];

function detectTone(value = '') {
  const v = String(value).trim();
  if (!v) return 'muted';
  for (const r of RULES) if (r.test.test(v)) return r.tone;
  return 'muted';
}

export default function StatusBadge({ value, tone, children, size = 'md', className = '' }) {
  const finalTone = tone || detectTone(value || children);
  const sizeCls   = size === 'sm'
    ? 'text-[10.5px] px-1.5 py-0.5 gap-1'
    : 'text-[11.5px] px-2 py-0.5 gap-1.5';

  // One-shot pulse-ring on mount for `warn` badges so the eye is drawn to
  // pending work as soon as a list / detail page lands. Repeat behaviour
  // would be obnoxious; we fire it once and never again.
  const ref = useRef(null);
  useEffect(() => {
    if (finalTone !== 'warn' || !ref.current) return;
    const node = ref.current;
    node.classList.add('v2-pulse-ring');
    const t = setTimeout(() => { node.classList.remove('v2-pulse-ring'); }, 1700);
    return () => clearTimeout(t);
  }, [finalTone]);

  return (
    <span ref={ref} className={clsx(
      'inline-flex items-center rounded-pill font-semibold leading-tight whitespace-nowrap',
      sizeCls,
      TONE[finalTone] ?? TONE.muted,
      className
    )}>
      <span
        className={clsx(
          'rounded-full flex-shrink-0 bg-current',
          size === 'sm' ? 'w-1 h-1' : 'w-1.5 h-1.5'
        )}
        aria-hidden="true"
      />
      <span>{children ?? value}</span>
    </span>
  );
}
