/**
 * sceneSounds — Web Audio cues specific to the cinematic login scene.
 *
 * Built on top of the same Web Audio approach as src/hooks/useButtonEffects,
 * but with longer envelopes and richer harmonics suited to the scanner's
 * cinematic feel rather than the snappy micro-feedback of buttons.
 *
 * Five named cues:
 *   - hover     — soft chime when the email field is focused
 *   - touch     — physical "tap" the moment the finger reaches the sensor
 *   - scanPulse — looping pulse sound during otp_pending
 *   - success   — major-third ascending chime
 *   - failure   — minor-second descending dissonance
 *
 * Every cue is muted by default and a single call to `enableSounds()`
 * activates them — keeps autoplay policies happy.
 */

let ctx       = null;
let enabled   = false;
let scanLoop  = null;     // ScriptProcessor / interval handle for the looping pulse

function ensureCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function enableSounds() {
  ensureCtx();
  enabled = true;
}

export function disableSounds() {
  enabled = false;
  stopScanLoop();
}

export function isEnabled() { return enabled; }

// Master gain — every cue routes through this so we can lift the whole
// mix at once. The cues were inaudible at the old per-tone volumes
// (0.04–0.10); a 2.6× master plus higher per-cue volumes makes them
// clearly audible on laptop speakers without being harsh.
const MASTER = 2.6;

// ── primitive: short tone with attack-release envelope ───────────────
function tone({ freq, freqEnd, type = 'sine', dur = 0.2, vol = 0.08, delay = 0 }) {
  if (!enabled) return;
  const c   = ensureCtx();
  // If the context is still suspending (autoplay policy), retry the
  // resume — the very first cue otherwise plays into a dead context.
  if (c.state === 'suspended') c.resume();
  const osc = c.createOscillator();
  const g   = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, c.currentTime + delay);
  if (freqEnd) {
    osc.frequency.exponentialRampToValueAtTime(freqEnd, c.currentTime + delay + dur);
  }
  const peak = Math.min(0.9, vol * MASTER);
  g.gain.setValueAtTime(0.0001, c.currentTime + delay);
  g.gain.exponentialRampToValueAtTime(peak, c.currentTime + delay + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + delay + dur);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(c.currentTime + delay);
  osc.stop(c.currentTime + delay + dur + 0.02);
}

// ── named cues — volumes raised so they're actually audible ──────────
export function playHover() {
  tone({ freq: 540, freqEnd: 760, dur: 0.20, vol: 0.10 });
}

export function playTouch() {
  // Two-component "thump": low body + high click.
  tone({ freq: 90,   type: 'sine',     dur: 0.12, vol: 0.18 });
  tone({ freq: 1900, type: 'triangle', dur: 0.06, vol: 0.12, delay: 0.01 });
}

export function startScanLoop() {
  if (!enabled || scanLoop) return;
  // Clean digital "pip" every 760ms — unmistakably an electronic beep.
  //
  // The previous loop used a 200→560Hz sine SWEEP. A pitched glide like
  // that reads as a vowel sound, and when ticks overlapped (loop started
  // more than once before being cleared) the layered sweeps produced the
  // muffled "human conversation" artefact the user reported. A short,
  // fixed-pitch square pip cannot be mistaken for a voice.
  const tick = () => {
    tone({ freq: 1320, type: 'square', dur: 0.04, vol: 0.05 });
    tone({ freq: 1760, type: 'square', dur: 0.03, vol: 0.035, delay: 0.06 });
  };
  tick();
  scanLoop = setInterval(tick, 760);
}

export function stopScanLoop() {
  if (scanLoop) { clearInterval(scanLoop); scanLoop = null; }
}

/**
 * teardownSounds — hard stop for when the login page is left behind.
 *
 * Clears the scan-loop interval, flips `enabled` off so no further cues
 * can be triggered, and SUSPENDS the AudioContext so any tone already
 * scheduled on the audio clock is silenced immediately. Without this,
 * the scan loop (a setInterval) kept ticking after a successful login
 * because the component navigated away before anything cleared it.
 *
 * Call from LoginCinematic on success (after the success chime has had
 * time to play) and unconditionally on unmount.
 */
export function teardownSounds() {
  stopScanLoop();
  enabled = false;
  if (ctx && ctx.state === 'running') {
    try { ctx.suspend(); } catch { /* ignore */ }
  }
}

export function playSuccess() {
  stopScanLoop();
  // Major-third ascending: G4 → B4 → D5 (a clean ID-confirmed chime).
  tone({ freq: 392, type: 'sine', dur: 0.24, vol: 0.16 });
  tone({ freq: 494, type: 'sine', dur: 0.30, vol: 0.16, delay: 0.11 });
  tone({ freq: 587, type: 'sine', dur: 0.46, vol: 0.18, delay: 0.22 });
}

export function playFailure() {
  stopScanLoop();
  // Descending minor-second + low buzz — "access denied" feel.
  tone({ freq: 300, freqEnd: 220, type: 'sawtooth', dur: 0.20, vol: 0.14 });
  tone({ freq: 220, freqEnd: 165, type: 'sawtooth', dur: 0.32, vol: 0.14, delay: 0.13 });
  tone({ freq: 70,  type: 'sine',     dur: 0.42, vol: 0.12, delay: 0.06 });
}
