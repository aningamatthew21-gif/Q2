import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell, CheckCircle, AlertTriangle, AlertOctagon, Info, Check, Trash2, X
} from 'lucide-react';
import clsx from 'clsx';
import { useNotifications } from '../../context/NotificationContext';
import { useApp } from '../../context/AppContext';
import { timeAgo, dateBucket } from '../../utils/timeAgo';

/**
 * NotificationBell — replaces the idle `<Bell />` IconButton in TopBar.
 *
 *   <NotificationBell />
 *
 * Behaviour:
 *   - Renders a 48-px-tall bell button styled to match the rest of the
 *     TopBar action cluster, with an unread-count badge on its top right.
 *   - Clicking the bell opens a 380-px-wide dropdown panel anchored to
 *     the right edge of the button. Click-outside / Escape closes it.
 *   - The panel lists the recent 30 notifications grouped under date
 *     headers (Today / Yesterday / Earlier). Each row carries a category
 *     icon, title, body, relative time, and an unread dot.
 *   - Row click → mark read + deep-link via `navigate(linkPage, linkContext)`.
 *     Hover reveals two icon buttons: ✓ (mark read) and 🗑 (archive).
 *   - Header has a "Mark all read" action. Empty state reads "You're all
 *     caught up."
 *
 * State + data come from `useNotifications()` so the bell is purely
 * presentational — every action goes through the shared context.
 */
export default function NotificationBell() {
  const { notifications, unreadCount, loading, markRead, markAllRead, archive } = useNotifications();
  const { navigate } = useApp();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // Click-outside + Escape to dismiss.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Group notifications under Today / Yesterday / Earlier for the panel.
  const grouped = useMemo(() => {
    const buckets = { Today: [], Yesterday: [], Earlier: [] };
    for (const n of notifications) {
      buckets[dateBucket(n.createdAt)]?.push(n);
    }
    return buckets;
  }, [notifications]);

  const handleRowClick = (n) => {
    if (!n.isRead) markRead(n.id);
    if (n.linkPage) {
      navigate(n.linkPage, n.linkContext || null);
    }
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative">
      <motion.button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={clsx(
          'relative w-8 h-8 grid place-items-center rounded-md text-n-600 hover:bg-n-100 hover:text-n-800',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          open && 'bg-n-100 text-n-800'
        )}
        whileTap={{ scale: 0.92 }}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-err text-white text-[10px] font-bold leading-none grid place-items-center shadow-sm"
            aria-hidden="true"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 top-10 z-50 w-[380px] max-h-[520px] flex flex-col bg-white border border-n-200 rounded-panel shadow-card overflow-hidden"
            role="dialog"
            aria-label="Notifications"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-n-200 bg-white">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-n-800">Notifications</span>
                {unreadCount > 0 && (
                  <span className="text-[11px] font-medium text-accent">{unreadCount} unread</span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={markAllRead}
                  disabled={unreadCount === 0}
                  className="text-[11.5px] text-n-600 hover:text-n-800 disabled:text-n-300 disabled:cursor-not-allowed px-2 py-1 rounded hover:bg-n-100"
                >
                  Mark all read
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="w-6 h-6 grid place-items-center rounded text-n-500 hover:text-n-800 hover:bg-n-100"
                  aria-label="Close"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {loading && notifications.length === 0 ? (
                <div className="py-8 text-center text-[12.5px] text-n-500">
                  <div className="inline-block w-5 h-5 rounded-full border-2 border-n-100 border-t-accent animate-spin mb-2" />
                  <div>Loading notifications…</div>
                </div>
              ) : notifications.length === 0 ? (
                <div className="py-10 text-center px-6">
                  <div className="w-10 h-10 mx-auto rounded-full bg-n-50 grid place-items-center mb-2">
                    <Bell className="w-4 h-4 text-n-400" />
                  </div>
                  <div className="text-[13px] font-medium text-n-700">You’re all caught up</div>
                  <div className="text-[11.5px] text-n-500 mt-0.5">New activity will appear here in real time.</div>
                </div>
              ) : (
                ['Today', 'Yesterday', 'Earlier'].map(bucket => {
                  const rows = grouped[bucket];
                  if (!rows || rows.length === 0) return null;
                  return (
                    <div key={bucket}>
                      <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-n-500 bg-n-50/60">
                        {bucket}
                      </div>
                      {rows.map(n => (
                        <NotificationRow
                          key={n.id}
                          n={n}
                          onOpen={() => handleRowClick(n)}
                          onRead={() => markRead(n.id)}
                          onArchive={() => archive(n.id)}
                        />
                      ))}
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="px-3 py-1.5 border-t border-n-200 bg-n-50 text-[10.5px] text-n-500">
              Showing the latest {notifications.length}. Archive a row to remove it.
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** One row in the notifications list. */
function NotificationRow({ n, onOpen, onRead, onArchive }) {
  const { Icon, tone } = iconForNotification(n);
  return (
    <div
      className={clsx(
        'group relative flex gap-2.5 px-3 py-2 border-b border-n-100 last:border-b-0 cursor-pointer transition-colors',
        n.isRead ? 'hover:bg-n-50' : 'bg-accent-soft/30 hover:bg-accent-soft/50'
      )}
      onClick={onOpen}
    >
      {/* Icon */}
      <div className={clsx('flex-shrink-0 w-7 h-7 rounded-md grid place-items-center mt-0.5', tone.bg, tone.fg)}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      {/* Body */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className={clsx('text-[12.5px] truncate', n.isRead ? 'font-medium text-n-700' : 'font-semibold text-n-800')}>
            {n.title}
          </div>
          {!n.isRead && (
            <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-accent mt-1.5" aria-hidden="true" />
          )}
        </div>
        {n.body && (
          <div className="text-[11.5px] text-n-600 mt-0.5 line-clamp-2">{n.body}</div>
        )}
        <div className="flex items-center gap-2 mt-1 text-[10.5px] text-n-500">
          <span>{timeAgo(n.createdAt)}</span>
          {n.category && <span>· {n.category}</span>}
        </div>
      </div>
      {/* Hover actions (do not propagate to row click) */}
      <div className="absolute top-1.5 right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {!n.isRead && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRead(); }}
            className="w-6 h-6 grid place-items-center rounded text-n-500 hover:text-n-800 hover:bg-white"
            aria-label="Mark read"
            title="Mark read"
          >
            <Check className="w-3 h-3" />
          </button>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onArchive(); }}
          className="w-6 h-6 grid place-items-center rounded text-n-500 hover:text-err hover:bg-white"
          aria-label="Delete"
          title="Delete"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

/** Pick the right Lucide icon and a colour tone for a notification. */
function iconForNotification(n) {
  const sev = n.severity || 'info';
  if (sev === 'success')  return { Icon: CheckCircle,   tone: { bg: 'bg-emerald-50', fg: 'text-emerald-600' } };
  if (sev === 'warning')  return { Icon: AlertTriangle, tone: { bg: 'bg-amber-50',   fg: 'text-amber-600'   } };
  if (sev === 'critical') return { Icon: AlertOctagon,  tone: { bg: 'bg-red-50',     fg: 'text-red-600'     } };
  return                        { Icon: Info,           tone: { bg: 'bg-blue-50',    fg: 'text-blue-600'    } };
}
