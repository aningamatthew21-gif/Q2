/**
 * useButtonEffects — sound + haptic layer for the Button primitive.
 *
 * Every `<Button>` calls `onClickEffect()` before firing the user's onClick,
 * so every button in the app gets audio + haptic feedback automatically.
 *
 * Sound styles (user-selectable in UserSettingsModal):
 *   • mouse      — short filtered-noise burst. A real desktop mouse click. (default)
 *   • soft       — sine blip ~1.7 kHz, 30 ms envelope. Apple-subtle.
 *   • bubble     — descending frequency sweep 800→200 Hz.
 *   • pop        — sine impulse 500 Hz with fast decay.
 *   • typewriter — two rapid noise bursts mimicking a mechanical keyboard.
 *
 * Behavior rules:
 *   • Audio generated live via Web Audio — no asset file.
 *   • Preferences read from localStorage (`ui:soundEnabled`, `ui:soundStyle`,
 *     `ui:hapticsEnabled`) so this hook works without the React context
 *     wired up (important because it's called inside Button during render).
 *   • `prefers-reduced-motion: reduce` is treated as a mute hint — the
 *     default drops to off. The user can still opt IN explicitly.
 *   • Haptics use `navigator.vibrate()` — Android / PWA only. iOS Safari
 *     silently no-ops (no Vibration API support, no polyfill possible
 *     without a native wrapper).
 *   • Every audio / haptic path is wrapped in try/catch — if AudioContext
 *     throws, if localStorage is unavailable, the button's onClick still
 *     fires normally.
 *   • Debounced 40 ms so machine-gun double-clicks don't stack.
 */

// ----- Preference helpers (localStorage, with safe fallbacks) ---------

function readPref(key, defaultValue) {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return defaultValue;
    return v === 'true';
  } catch {
    return defaultValue;
  }
}
function readStrPref(key, defaultValue) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? defaultValue : v;
  } catch {
    return defaultValue;
  }
}

function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// ----- Web Audio — lazy singleton context -----------------------------

let _audioCtx = null;
let _lastPlayAt = 0;

function getAudioCtx() {
  if (_audioCtx) return _audioCtx;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    _audioCtx = new Ctx();
  } catch {
    return null;
  }
  return _audioCtx;
}
function ensureResumed(ctx) {
  try {
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      ctx.resume().catch(() => { /* swallow */ });
    }
  } catch { /* swallow */ }
}

// ----- Sound synths ---------------------------------------------------

function noiseBuffer(ctx, duration, decay = true) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const env = decay ? (1 - i / len) : 1;
    data[i] = (Math.random() * 2 - 1) * env;
  }
  return buf;
}

/**
 * Real desktop-mouse click. Short filtered noise burst — the "tick" of a
 * mechanical switch closing. Two-stage filter (highpass + resonant peak)
 * gives it a plasticky, not-too-harsh character.
 */
function playMouse(ctx) {
  const now = ctx.currentTime;
  const duration = 0.018; // 18 ms total
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, duration);

  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2200;

  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 4500;
  bp.Q.value = 1.2;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.45, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  src.connect(hp).connect(bp).connect(gain).connect(ctx.destination);
  src.start(now);
  src.stop(now + duration + 0.005);
}

/** Apple-subtle sine blip. */
function playSoft(ctx, { variant } = {}) {
  const now = ctx.currentTime;
  const freq = variant === 'primary' ? 1900 : variant === 'danger' ? 1400 : 1700;
  const attack = 0.003, release = 0.030, peak = 0.08;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peak, now + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + attack + release);

  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + attack + release + 0.01);
}

/** Playful descending bubble. */
function playBubble(ctx) {
  const now = ctx.currentTime;
  const duration = 0.12;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(800, now);
  osc.frequency.exponentialRampToValueAtTime(200, now + duration);
  gain.gain.setValueAtTime(0.0, now);
  gain.gain.linearRampToValueAtTime(0.18, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration + 0.01);
}

/** Soft rubbery pop. */
function playPop(ctx) {
  const now = ctx.currentTime;
  const duration = 0.08;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(520, now);
  osc.frequency.exponentialRampToValueAtTime(180, now + duration);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.22, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration + 0.01);
}

/** Mechanical keyboard — double tick. */
function playTypewriter(ctx) {
  const fireOne = (at) => {
    const duration = 0.014;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, duration);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1500;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3200;
    bp.Q.value = 2.0;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.38, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
    src.connect(hp).connect(bp).connect(gain).connect(ctx.destination);
    src.start(at);
    src.stop(at + duration + 0.005);
  };
  const t0 = ctx.currentTime;
  fireOne(t0);           // down-stroke
  fireOne(t0 + 0.035);   // up-stroke
}

const STYLE_DISPATCH = {
  mouse:      (ctx)        => playMouse(ctx),
  soft:       (ctx, opts)  => playSoft(ctx, opts),
  bubble:     (ctx)        => playBubble(ctx),
  pop:        (ctx)        => playPop(ctx),
  typewriter: (ctx)        => playTypewriter(ctx)
};

function playClick({ variant } = {}) {
  // Debounce — 40 ms minimum gap between plays.
  const now = Date.now();
  if (now - _lastPlayAt < 40) return;
  _lastPlayAt = now;

  const ctx = getAudioCtx();
  if (!ctx) return;
  ensureResumed(ctx);

  try {
    const style = readStrPref('ui:soundStyle', 'mouse');
    const fn = STYLE_DISPATCH[style] || STYLE_DISPATCH.mouse;
    fn(ctx, { variant });
  } catch { /* swallow */ }
}

// ----- Haptics --------------------------------------------------------

function vibrate(pattern) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  } catch { /* swallow */ }
}

// ----- Preference gates ----------------------------------------------

function soundOk() {
  if (prefersReducedMotion()) return readPref('ui:soundEnabled', false);
  return readPref('ui:soundEnabled', true);
}
function hapticsOk() {
  if (prefersReducedMotion()) return readPref('ui:hapticsEnabled', false);
  return readPref('ui:hapticsEnabled', true);
}

// ----- Public hook ----------------------------------------------------

export function useButtonEffects() {
  return {
    onClickEffect: ({ variant } = {}) => {
      if (soundOk())   playClick({ variant });
      if (hapticsOk()) vibrate(8);
    },
    onSuccess: () => {
      if (soundOk())   playClick({ variant: 'primary' });
      if (hapticsOk()) vibrate([10, 40, 10]);
    },
    onError: () => {
      if (soundOk())   playClick({ variant: 'danger' });
      if (hapticsOk()) vibrate([40, 30, 40]);
    }
  };
}

// Exposed for the preferences UI — lets the user preview each sound style
// by passing its id. Returns quickly on unknown ids.
export function previewSoundStyle(styleId) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  ensureResumed(ctx);
  try {
    const fn = STYLE_DISPATCH[styleId];
    if (fn) fn(ctx, { variant: 'primary' });
  } catch { /* swallow */ }
}

export default useButtonEffects;
