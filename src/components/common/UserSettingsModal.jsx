import React from 'react';
import GlassModal from './GlassModal';
import Button from './Button';
import Icon from './Icon';
import { useUIPreferences, SOUND_STYLES } from '../../context/UIPreferencesContext';
import { previewSoundStyle } from '../../hooks/useButtonEffects';

/**
 * UserSettingsModal — the "account + preferences" popup.
 *
 * Entry point is the user pill in the sidebar. Houses:
 *   • Sound: on/off + style picker (with live preview)
 *   • Haptics: on/off
 *   • Theme: light / dark
 *   • Logout
 *
 * All preference writes flow through UIPreferencesContext so they persist
 * to localStorage immediately and the click-sound layer picks up the new
 * style on the very next click.
 */

function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="flex items-center justify-between gap-4 py-3 cursor-pointer">
      <div className="min-w-0">
        <div className="text-sm font-medium text-ink">{label}</div>
        {hint && <div className="text-xs text-ink-muted mt-0.5">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={[
          'relative inline-flex items-center h-7 w-12 flex-shrink-0 rounded-pill transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          checked ? 'bg-primary' : 'bg-line-strong'
        ].join(' ')}
      >
        <span
          className={[
            'inline-block h-5 w-5 rounded-pill bg-white shadow transition-transform',
            checked ? 'translate-x-6' : 'translate-x-1'
          ].join(' ')}
        />
      </button>
    </label>
  );
}

export default function UserSettingsModal({ open, onClose, appUser, onLogout }) {
  const {
    soundEnabled, soundStyle, hapticsEnabled, theme,
    setSoundEnabled, setSoundStyle, setHapticsEnabled, setTheme
  } = useUIPreferences();

  if (!open) return null;

  const username = appUser?.name || appUser?.email?.split('@')[0] || 'User';
  const email    = appUser?.email || '';
  const role     = appUser?.role  || 'guest';
  const initial  = (username || 'U').slice(0, 1).toUpperCase();

  const pickStyle = (id) => {
    setSoundStyle(id);
    // Only preview if sound is actually enabled, so muted users don't get
    // a surprise beep.
    if (soundEnabled) setTimeout(() => previewSoundStyle(id), 0);
  };

  return (
    <GlassModal
      open={open}
      onClose={onClose}
      title="Account & Preferences"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button variant="danger" onClick={onLogout} leftIcon={<Icon id="sign-out-alt" />}>
            Log out
          </Button>
        </>
      }
    >
      {/* Identity */}
      <section className="flex items-center gap-3 pb-5 border-b border-line/60">
        <span className="inline-flex items-center justify-center h-12 w-12 rounded-pill bg-primary-soft text-primary font-semibold text-lg flex-shrink-0">
          {initial}
        </span>
        <div className="min-w-0">
          <div className="text-base font-semibold text-ink truncate">{username}</div>
          {email && <div className="text-xs text-ink-muted truncate">{email}</div>}
          <div className="text-[11px] text-ink-subtle uppercase tracking-wider mt-0.5">{role}</div>
        </div>
      </section>

      {/* Appearance */}
      <section className="py-2 border-b border-line/60">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle pt-3 pb-1">
          Appearance
        </div>
        <div className="flex items-center justify-between gap-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-ink">Theme</div>
            <div className="text-xs text-ink-muted mt-0.5">
              Switch between a light canvas and a calm dark mode.
            </div>
          </div>
          <div className="inline-flex rounded-pill bg-surface-sunken p-0.5 border border-line">
            <button
              type="button"
              onClick={() => setTheme('light')}
              className={[
                'text-xs px-3 py-1.5 rounded-pill transition-colors flex items-center gap-1',
                theme === 'light' ? 'bg-surface text-ink shadow-card' : 'text-ink-muted'
              ].join(' ')}
            >
              <Icon id="sun" /> Light
            </button>
            <button
              type="button"
              onClick={() => setTheme('dark')}
              className={[
                'text-xs px-3 py-1.5 rounded-pill transition-colors flex items-center gap-1',
                theme === 'dark' ? 'bg-surface text-ink shadow-card' : 'text-ink-muted'
              ].join(' ')}
            >
              <Icon id="moon" /> Dark
            </button>
          </div>
        </div>
      </section>

      {/* Sound */}
      <section className="py-2 border-b border-line/60">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle pt-3 pb-1">
          Sound
        </div>
        <Toggle
          label="Click sounds"
          hint="Subtle audio feedback on every button."
          checked={soundEnabled}
          onChange={setSoundEnabled}
        />
        <div className={soundEnabled ? '' : 'opacity-50 pointer-events-none'}>
          <div className="text-xs text-ink-muted pb-2">Click sound style</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pb-3">
            {SOUND_STYLES.map(s => {
              const active = soundStyle === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => pickStyle(s.id)}
                  className={[
                    'text-left px-3 py-2 rounded-card border transition-colors',
                    active
                      ? 'border-primary bg-primary-soft text-primary'
                      : 'border-line bg-surface hover:bg-surface-sunken text-ink'
                  ].join(' ')}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">{s.label}</span>
                    {active && <Icon id="check" />}
                  </div>
                  <div className="text-[11px] text-ink-muted mt-0.5 truncate">{s.hint}</div>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => previewSoundStyle(soundStyle)}
            className="text-xs text-primary hover:underline"
          >
            Preview current sound
          </button>
        </div>
      </section>

      {/* Haptics */}
      <section className="py-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle pt-3 pb-1">
          Haptics
        </div>
        <Toggle
          label="Haptic feedback"
          hint="Vibration on tap (Android / supported devices only). No effect on iOS Safari."
          checked={hapticsEnabled}
          onChange={setHapticsEnabled}
        />
      </section>
    </GlassModal>
  );
}
