import React from 'react';
import { useApp } from '../../context/AppContext';

/**
 * StatusBar — thin (28px) footer strip showing connection / role / build.
 *
 * Sits at the bottom of the workspace. Cosmetic only — no interactive
 * controls live here. The connection dot will be wired to the real
 * socket-state once we expose it from AppContext.
 */
export default function StatusBar() {
  const { appUser } = useApp();
  return (
    <footer
      className="h-7 bg-white border-t border-n-200 px-4 flex items-center gap-4 text-[11.5px] text-n-500"
      aria-label="Status bar"
    >
      <span className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-ok" aria-hidden />
        <span className="text-ok">Connected</span>
      </span>
      <span>Realtime: ON</span>
      {appUser?.role && (
        <span>Role: <span className="text-n-700 capitalize">{appUser.role}</span></span>
      )}
      <span className="ml-auto font-mono-num text-n-400">v0.9.5 · build 2026-04-27</span>
    </footer>
  );
}
