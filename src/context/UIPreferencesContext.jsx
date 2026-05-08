import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * UIPreferencesContext — user-facing UI preferences, persisted to localStorage.
 *
 * Kept deliberately small — this is UI polish, not auth or business state.
 * Any throw from localStorage is swallowed so a locked-down browser never
 * crashes the app.
 *
 * Keys (localStorage):
 *   ui:soundEnabled    'true' | 'false'       default 'true'
 *   ui:soundStyle      one of SOUND_STYLES    default 'mouse'
 *   ui:hapticsEnabled  'true' | 'false'       default 'true'
 *   ui:theme           'light' | 'dark'       default 'light'
 *
 * Theme is applied by toggling a `dark` class on <html>. CSS variable
 * overrides in index.css handle the actual palette swap — no per-component
 * class changes required.
 */

export const SOUND_STYLES = [
  { id: 'soft',       label: 'Soft Tap',       hint: 'Office-style subtle blip (default)' },
  { id: 'mouse',      label: 'Mouse Click',    hint: 'Classic desktop click' },
  { id: 'bubble',     label: 'Bubble Pop',     hint: 'Playful descending pop' },
  { id: 'pop',        label: 'Button Pop',     hint: 'Rubbery click' },
  { id: 'typewriter', label: 'Typewriter',     hint: 'Mechanical keyboard feel' }
];

const DEFAULTS = {
  soundEnabled:   true,
  // Default flipped from 'mouse' → 'soft' for the Fluent 2 Office look.
  // Existing users keep their saved preference (read from localStorage).
  soundStyle:     'soft',
  hapticsEnabled: true,
  theme:          'light'
};

function readBool(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return v === 'true';
  } catch {
    return fallback;
  }
}
function readStr(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}
function writeStr(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* ignore */ }
}

const UIPreferencesContext = createContext(null);

export function UIPreferencesProvider({ children }) {
  const [soundEnabled,   setSoundEnabledState]   = useState(() => readBool('ui:soundEnabled',   DEFAULTS.soundEnabled));
  const [soundStyle,     setSoundStyleState]     = useState(() => readStr ('ui:soundStyle',     DEFAULTS.soundStyle));
  const [hapticsEnabled, setHapticsEnabledState] = useState(() => readBool('ui:hapticsEnabled', DEFAULTS.hapticsEnabled));
  const [theme,          setThemeState]          = useState(() => readStr ('ui:theme',          DEFAULTS.theme));

  // Apply theme to <html> whenever it changes.
  useEffect(() => {
    try {
      const root = document.documentElement;
      if (theme === 'dark') root.classList.add('dark');
      else                  root.classList.remove('dark');
    } catch { /* ignore */ }
  }, [theme]);

  const setSoundEnabled = useCallback((v) => {
    setSoundEnabledState(v);
    writeStr('ui:soundEnabled', v);
  }, []);
  const setSoundStyle = useCallback((v) => {
    // Validate — fall back to default if someone passes an unknown id.
    const valid = SOUND_STYLES.some(s => s.id === v) ? v : DEFAULTS.soundStyle;
    setSoundStyleState(valid);
    writeStr('ui:soundStyle', valid);
  }, []);
  const setHapticsEnabled = useCallback((v) => {
    setHapticsEnabledState(v);
    writeStr('ui:hapticsEnabled', v);
  }, []);
  const setTheme = useCallback((v) => {
    const valid = v === 'dark' ? 'dark' : 'light';
    setThemeState(valid);
    writeStr('ui:theme', valid);
  }, []);

  const value = useMemo(() => ({
    soundEnabled, soundStyle, hapticsEnabled, theme,
    setSoundEnabled, setSoundStyle, setHapticsEnabled, setTheme
  }), [soundEnabled, soundStyle, hapticsEnabled, theme,
      setSoundEnabled, setSoundStyle, setHapticsEnabled, setTheme]);

  return (
    <UIPreferencesContext.Provider value={value}>
      {children}
    </UIPreferencesContext.Provider>
  );
}

export function useUIPreferences() {
  const ctx = useContext(UIPreferencesContext);
  // Safe fallback when used outside the provider (e.g. early boot): mirror
  // defaults, and persist silently — hooks that call this from the Button
  // primitive never have to guard.
  if (!ctx) {
    return {
      ...DEFAULTS,
      setSoundEnabled:   () => {},
      setSoundStyle:     () => {},
      setHapticsEnabled: () => {},
      setTheme:          () => {}
    };
  }
  return ctx;
}

export default UIPreferencesContext;
