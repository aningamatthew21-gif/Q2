import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Search, Bell, HelpCircle, Settings, ChevronDown, Menu
} from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '../../context/AppContext';
import UserSettingsModal from '../common/UserSettingsModal';

/**
 * TopBar — the 48px sticky header that sits above the LeftNav.
 *
 * Layout (left → right):
 *   - Mobile hamburger (md:hidden, opens drawer LeftNav)
 *   - Brand mark + wordmark (clickable → home)
 *   - Global search input  (⌘K  shortcut hint, palette wiring TBD)
 *   - Spacer
 *   - Notification / Help / Settings icon buttons
 *   - User pill — opens the existing UserSettingsModal (sound, haptics, theme, logout)
 *
 * Reuses UserSettingsModal so logout + preferences keep their Phase H wiring
 * untouched.
 */

export default function TopBar({ onOpenMobileNav }) {
  const { appUser, navigate } = useApp();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const avatarRef = useRef(null);

  const username = appUser?.name || appUser?.email?.split('@')[0] || 'User';
  const initials = (username || 'U')
    .split(/\s+/)
    .map(s => s.slice(0, 1))
    .join('')
    .slice(0, 2)
    .toUpperCase();

  // One-shot welcome pulse-ring on the avatar — only on the first render
  // after sign-in (gated by sessionStorage so a page refresh doesn't keep
  // re-firing it). Subtle but signals "you're logged in" with motion.
  useEffect(() => {
    if (!avatarRef.current) return;
    if (typeof sessionStorage === 'undefined') return;
    const fired = sessionStorage.getItem('ui:avatar-welcomed');
    if (fired) return;
    avatarRef.current.classList.add('v2-pulse-ring');
    sessionStorage.setItem('ui:avatar-welcomed', '1');
    const t = setTimeout(() => avatarRef.current?.classList.remove('v2-pulse-ring'), 1700);
    return () => clearTimeout(t);
  }, []);

  const goHome = () => {
    const role = appUser?.role || 'sales';
    navigate(
      role === 'sales' ? 'salesDashboard'
        : role === 'procurement' ? 'procurementDashboard'
        : 'controllerDashboard'
    );
  };

  const logout = () => {
    setSettingsOpen(false);
    navigate('login');
  };

  return (
    <>
      <header
        className={clsx(
          'sticky top-0 z-50 h-12 bg-white border-b border-n-200',
          'flex items-center gap-3 px-3 md:px-4'
        )}
      >
        {/* Mobile: open the drawer */}
        <button
          type="button"
          onClick={onOpenMobileNav}
          className="md:hidden w-8 h-8 inline-flex items-center justify-center rounded-md text-n-600 hover:bg-n-100"
          aria-label="Open navigation"
        >
          <Menu className="w-4 h-4" />
        </button>

        {/* Brand */}
        <button
          type="button"
          onClick={goHome}
          className="flex items-center gap-2 pr-3 md:pr-4 md:border-r md:border-n-200 h-8 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-md"
          aria-label="Home"
        >
          <span className="brand-mark-gradient w-6 h-6 rounded-md text-white grid place-items-center font-bold text-[13px] shadow-card">
            M
          </span>
          <span className="hidden md:inline font-semibold text-n-800 text-[14px] tracking-tight">
            MIDSA
          </span>
        </button>

        {/* Global search */}
        <div className="relative flex-1 max-w-[520px] hidden sm:block">
          <Search
            aria-hidden
            className="w-3.5 h-3.5 text-n-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
          />
          <input
            className={clsx(
              'h-8 w-full pl-8 pr-16 text-[13px] rounded-md',
              'bg-n-50 border border-n-200 text-n-700 placeholder:text-n-400',
              'focus:outline-none focus:bg-white focus:border-accent focus:shadow-focus',
              'transition-colors'
            )}
            placeholder="Search invoices, customers, RFQs"
            aria-label="Search"
          />
          <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-n-500 bg-n-100 border border-n-200 rounded px-1.5 py-0.5 font-mono">
            Ctrl K
          </kbd>
        </div>

        <div className="flex-1" />

        {/* Right cluster */}
        <div className="flex items-center gap-0.5">
          <IconButton title="Notifications"><Bell className="w-4 h-4" /></IconButton>
          <IconButton title="Help"><HelpCircle className="w-4 h-4" /></IconButton>
          <IconButton title="Settings" onClick={() => setSettingsOpen(true)}>
            <Settings className="w-4 h-4" />
          </IconButton>

          <motion.button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="ml-1 flex items-center gap-2 px-2 h-8 rounded-md hover:bg-n-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            whileTap={{ scale: 0.97 }}
            aria-label="Account"
          >
            <span ref={avatarRef} className="w-6 h-6 rounded-full bg-accent-soft text-accent-text font-semibold text-[11px] grid place-items-center">
              {initials}
            </span>
            <span className="hidden lg:inline text-[13px] text-n-700 truncate max-w-[140px]">
              {username}
            </span>
            <ChevronDown className="w-3 h-3 text-n-500" />
          </motion.button>
        </div>
      </header>

      <UserSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        appUser={appUser}
        onLogout={logout}
      />
    </>
  );
}

function IconButton({ children, ...rest }) {
  return (
    <motion.button
      type="button"
      className="w-8 h-8 grid place-items-center rounded-md text-n-600 hover:bg-n-100 hover:text-n-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      whileTap={{ scale: 0.92 }}
      {...rest}
    >
      {children}
    </motion.button>
  );
}
