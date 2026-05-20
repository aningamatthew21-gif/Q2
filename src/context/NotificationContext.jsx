import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import api from '../api';
import socket from '../socket';
import { useApp } from './AppContext';

/**
 * NotificationContext — drives the bell badge + dropdown panel.
 *
 * RESPONSIBILITIES
 * ───────────────
 *  1. On login (when `appUser` becomes available), fetch the user's
 *     unread + recent list once so the bell paints correctly on first
 *     render.
 *  2. Open the websocket, join the user's PERSONAL Socket.io room
 *     (`user:<email>`), and listen for `notification:new` events. The
 *     backend emits each new row to exactly that room, so a user only
 *     receives notifications addressed to them.
 *  3. Expose mark-read / mark-all-read / archive / refresh actions that
 *     hit the REST endpoints AND update local state optimistically so
 *     the UI feels instant.
 *  4. Re-join the room automatically after a socket reconnect so a
 *     mobile sleep / brief disconnect doesn't silently drop the
 *     subscription.
 *
 * Rendered INSIDE AppContext.Provider in src/context/AppContext.jsx so
 * `useApp()` is available. Read state from any component via
 * `useNotifications()`.
 */

const NotificationContext = createContext(null);

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
}

export function NotificationProvider({ children }) {
  const { appUser } = useApp();
  const email = appUser?.email || null;

  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount]     = useState(0);
  const [loading, setLoading]             = useState(false);

  // Track the email the listeners were attached for, so we can detect
  // user changes and re-attach if needed.
  const attachedFor = useRef(null);

  // ── Fetch the recent list (initial + manual refresh) ──────────────
  const refresh = useCallback(async () => {
    if (!email) return;
    setLoading(true);
    try {
      const res = await api.get('/notifications', { params: { limit: 30 } });
      if (res?.success) {
        setNotifications(res.data || []);
        setUnreadCount(res.unreadCount || 0);
      }
    } catch (err) {
      console.error('[Notifications] fetch failed:', err?.message);
    } finally {
      setLoading(false);
    }
  }, [email]);

  // ── Mutations ──────────────────────────────────────────────────────
  const markRead = useCallback(async (id) => {
    // Optimistic update
    setNotifications(list => list.map(n => n.id === id ? { ...n, isRead: true } : n));
    setUnreadCount(c => {
      const target = notifications.find(n => n.id === id);
      return target && !target.isRead ? Math.max(0, c - 1) : c;
    });
    try {
      await api.patch(`/notifications/${id}/read`);
    } catch (err) {
      console.error('[Notifications] markRead failed:', err?.message);
    }
  }, [notifications]);

  const markAllRead = useCallback(async () => {
    setNotifications(list => list.map(n => ({ ...n, isRead: true })));
    setUnreadCount(0);
    try {
      await api.patch('/notifications/read-all');
    } catch (err) {
      console.error('[Notifications] markAllRead failed:', err?.message);
    }
  }, []);

  const archive = useCallback(async (id) => {
    // Remove from the visible list ("delete" in the UI).
    setNotifications(list => {
      const target = list.find(n => n.id === id);
      if (target && !target.isRead) setUnreadCount(c => Math.max(0, c - 1));
      return list.filter(n => n.id !== id);
    });
    try {
      await api.patch(`/notifications/${id}/archive`);
    } catch (err) {
      console.error('[Notifications] archive failed:', err?.message);
    }
  }, []);

  // ── Socket subscription ───────────────────────────────────────────
  useEffect(() => {
    if (!email) {
      // Logged out — clear and bail.
      attachedFor.current = null;
      setNotifications([]);
      setUnreadCount(0);
      return;
    }

    refresh();

    const room = `user:${email.toLowerCase()}`;

    const joinRoom = () => socket.emit('join_room', room);
    const handleNew = (notification) => {
      // Guard: only accept events truly addressed to us. Personal room
      // routing on the server already does this, but a defensive check is
      // cheap and prevents oddities if rooms are ever misconfigured.
      if (!notification) return;
      if (notification.recipient && notification.recipient.toLowerCase() !== email.toLowerCase()) return;
      setNotifications(list => {
        if (list.some(n => n.id === notification.id)) return list; // dedup
        return [notification, ...list].slice(0, 50);
      });
      if (!notification.isRead) setUnreadCount(c => c + 1);
    };
    const handleReconnect = () => {
      joinRoom();
      // Catch up on anything that fired while we were offline.
      refresh();
    };

    socket.on('notification:new', handleNew);
    socket.on('connect',           joinRoom);
    socket.io.on('reconnect',      handleReconnect);

    if (!socket.connected) {
      socket.connect();
    } else {
      // Already connected — join immediately. The 'connect' listener
      // will handle every subsequent (re)connect.
      joinRoom();
    }

    attachedFor.current = email;

    return () => {
      socket.off('notification:new', handleNew);
      socket.off('connect',          joinRoom);
      socket.io.off('reconnect',     handleReconnect);
    };
  }, [email, refresh]);

  const value = {
    notifications,
    unreadCount,
    loading,
    refresh,
    markRead,
    markAllRead,
    archive
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}
