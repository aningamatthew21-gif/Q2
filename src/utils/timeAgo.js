/**
 * timeAgo — compact relative-time formatter for notification rows.
 *
 *   timeAgo(new Date())             // "just now"
 *   timeAgo('2026-05-13T10:00:00Z') // "2h ago"
 *
 * No `date-fns` dependency on purpose — a notification line needs five
 * buckets, that's it.
 */
export function timeAgo(input) {
  if (!input) return '';
  const t = typeof input === 'string' || typeof input === 'number'
    ? Date.parse(input)
    : input.getTime?.();
  if (!t || Number.isNaN(t)) return '';

  const secs = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (secs < 45)            return 'just now';
  if (secs < 90)            return '1m ago';
  const mins = Math.round(secs / 60);
  if (mins < 60)            return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24)             return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7)             return `${days}d ago`;
  // For older rows, fall back to a short date so the panel stays scannable.
  const d = new Date(t);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Bucket a timestamp into "Today" / "Yesterday" / "Earlier" — used to
 * group the notification list under date headers.
 */
export function dateBucket(input) {
  const t = typeof input === 'string' || typeof input === 'number'
    ? Date.parse(input)
    : input?.getTime?.();
  if (!t || Number.isNaN(t)) return 'Earlier';

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yest  = today - 24 * 60 * 60 * 1000;
  if (t >= today) return 'Today';
  if (t >= yest)  return 'Yesterday';
  return 'Earlier';
}
