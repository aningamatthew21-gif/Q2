import React, { useEffect, useRef, useState, Suspense, lazy } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, KeyRound, ArrowRight, Loader2, ShieldCheck, Volume2, VolumeX } from 'lucide-react';
import companyLogo from '../assets/company-logo.png';
import Button from '../components/v2/Button';
import { dialogVariants, EASE_OUT } from '../components/v2/motion';
import SceneErrorBoundary from '../components/cinematic/SceneErrorBoundary';
import {
  enableSounds,
  disableSounds,
  playHover,
  playTouch,
  startScanLoop,
  stopScanLoop,
  playSuccess,
  playFailure,
  teardownSounds
} from '../components/cinematic/sceneSounds';

/**
 * LoginCinematic — replaces LoginScreen with a 3D Fluent 2 + R3F login.
 *
 * Same auth interface as LoginScreen:
 *   onLogin(email)      — emails OTP, transitions to step='otp'
 *   onOTPLogin(code)    — verifies OTP, parent navigates on success
 *   companyName         — display name
 *   onDiagnostic        — optional dev tool link
 *
 * Visual story: left panel keeps the brand pitch; right panel is a
 * full 3D scene of a wall-mounted biometric scanner with an animated
 * fingertip that reacts to the auth state. The login card floats
 * over the scene with glass styling.
 *
 * Performance considerations:
 *   - Scene is lazy-loaded so the three.js bundle only ships when this
 *     page actually mounts (matters for the bundle-size budget).
 *   - The 3D fallback while loading is a static gradient — the page is
 *     fully usable before the scene paints.
 *   - prefers-reduced-motion: we still render the scene but the
 *     fingertip / particles read motion preferences from MotionConfig
 *     in AppShell — and we explicitly skip the scanner-touch sound.
 *
 * State machine drives BOTH the 3D scene (via the `sceneState` prop
 * passed into <Scene>) AND the form UX. There is exactly one source
 * of truth: `sceneState`. The card animations + button states all
 * derive from it.
 */
const Scene = lazy(() => import('../components/cinematic/Scene.jsx'));

const STATES = {
  IDLE:          'idle',
  EMAIL_FOCUSED: 'email_focused',
  OTP_REQUESTED: 'otp_requested',
  OTP_PENDING:   'otp_pending',
  OTP_FAILED:    'otp_failed',
  OTP_SUCCESS:   'otp_success'
};

/**
 * STAGE_BACKDROP — the right-panel background per auth state.
 *
 * The white side used to be a flat slab. Each entry is a layered
 * radial-gradient: a state-tinted glow positioned roughly where the
 * scanner sits, fading out to near-white at the edges. The <main>
 * element transitions between these over 700 ms so the white side
 * "breathes" with the auth state — calm blue at idle, brighter on
 * focus, green on success, red on failure.
 */
const STAGE_BACKDROP = {
  idle:
    'radial-gradient(900px 700px at 62% 48%, rgba(66,165,245,0.14) 0%, rgba(66,165,245,0.04) 35%, #ffffff 70%)',
  email_focused:
    'radial-gradient(900px 700px at 62% 48%, rgba(66,165,245,0.26) 0%, rgba(66,165,245,0.08) 38%, #ffffff 72%)',
  otp_requested:
    'radial-gradient(900px 700px at 62% 48%, rgba(33,150,243,0.34) 0%, rgba(33,150,243,0.10) 40%, #ffffff 74%)',
  otp_pending:
    'radial-gradient(900px 700px at 62% 48%, rgba(33,150,243,0.34) 0%, rgba(33,150,243,0.10) 40%, #ffffff 74%)',
  otp_failed:
    'radial-gradient(900px 700px at 62% 48%, rgba(239,83,80,0.30) 0%, rgba(239,83,80,0.08) 40%, #ffffff 74%)',
  otp_success:
    'radial-gradient(900px 700px at 62% 48%, rgba(102,187,106,0.32) 0%, rgba(102,187,106,0.09) 40%, #ffffff 74%)'
};

/**
 * CARD_LED — the colour of the status strip along the top edge of the
 * login card, per state. Keeps the card visually tied to the scanner:
 * the strip is the same palette as the scanner's LED + fingerprint glow.
 */
const CARD_LED = {
  idle:          '#42a5f5',
  email_focused: '#64b5f6',
  otp_requested: '#2196f3',
  otp_pending:   '#2196f3',
  otp_failed:    '#ef5350',
  otp_success:   '#66bb6a'
};

export default function LoginCinematic({ onLogin, onOTPLogin, companyName = 'MIDSA', onDiagnostic }) {
  const [email, setEmail]               = useState('');
  const [otpCode, setOtpCode]           = useState('');
  const [step, setStep]                 = useState('email');     // 'email' | 'otp'
  const [sceneState, setSceneState]     = useState(STATES.IDLE);
  const [submitting, setSubmitting]     = useState(false);
  const [error, setError]               = useState(null);
  const [soundOn, setSoundOn]           = useState(true);
  const sceneStateRef                    = useRef(sceneState);

  useEffect(() => { sceneStateRef.current = sceneState; }, [sceneState]);

  // ── Timer bookkeeping ─────────────────────────────────────────────
  // Every setTimeout used to choreograph the scene is registered here so
  // we can cancel ALL pending ones in one call. The login-sound-never-
  // stops bug was caused by a pending `startScanLoop` timer firing AFTER
  // a fast OTP verify had already succeeded — restarting the loop with
  // nothing left to stop it. `clearTimers()` kills every pending timer
  // before we tear sound down.
  const timersRef = useRef([]);
  const track = (fn, delay) => {
    const id = setTimeout(() => {
      // Drop our own id from the list when we fire.
      timersRef.current = timersRef.current.filter(t => t !== id);
      fn();
    }, delay);
    timersRef.current.push(id);
    return id;
  };
  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

  // Unmount cleanup: cancel every pending timer AND hard-stop all audio
  // (suspends the AudioContext) so nothing bleeds into the authenticated
  // app after navigation.
  useEffect(() => () => {
    clearTimers();
    teardownSounds();
  }, []);

  // ── R3F resize kick ───────────────────────────────────────────────
  // The cinematic <Scene> is lazy-loaded inside <Suspense>. When the
  // chunk resolves, R3F's resize-observer can measure the wrapper as
  // 0×0 (the flex layout / lazy boundary hasn't settled) and the
  // canvas gets stuck at its 300×150 browser default. R3F also listens
  // to `window.resize` as a fallback — so we dispatch a few resize
  // events on a short ramp after mount to force a clean re-measure.
  useEffect(() => {
    const kicks = [120, 350, 800, 1600].map(delay =>
      setTimeout(() => window.dispatchEvent(new Event('resize')), delay)
    );
    return () => kicks.forEach(clearTimeout);
  }, []);

  // ── Sound toggle ──────────────────────────────────────────────────
  const toggleSound = () => {
    if (soundOn) { disableSounds(); setSoundOn(false); }
    else         { enableSounds();  setSoundOn(true);  }
  };

  // ── Step 1: request OTP ─────────────────────────────────────────
  const submitEmail = async () => {
    if (!email.trim()) { setError('Enter your work email to continue.'); return; }
    setError(null);
    setSubmitting(true);
    setSceneState(STATES.OTP_REQUESTED);
    enableSounds();
    playTouch();
    // `track()` — registered so the resolve/reject path can cancel it.
    track(() => {
      setSceneState(STATES.OTP_PENDING);
      startScanLoop();
    }, 850);
    try {
      await onLogin(email);
      // Cancel the pending "start scan loop" timer FIRST — if onLogin
      // resolved faster than 850ms, that timer would otherwise fire and
      // start a loop with nothing left to stop it.
      clearTimers();
      stopScanLoop();
      setStep('otp');
      // Keep the scanner glowing while waiting for the OTP entry.
      setSceneState(STATES.OTP_PENDING);
    } catch (err) {
      clearTimers();
      stopScanLoop();
      setError(err?.message || 'Could not send the code. Try again.');
      setSceneState(STATES.OTP_FAILED);
      playFailure();
      track(() => setSceneState(STATES.EMAIL_FOCUSED), 1300);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Step 2: verify OTP ──────────────────────────────────────────
  const submitOtp = async () => {
    if (!otpCode.trim()) { setError('Enter the 6-digit code we emailed you.'); return; }
    setError(null);
    setSubmitting(true);
    setSceneState(STATES.OTP_REQUESTED);
    enableSounds();
    playTouch();
    track(() => { setSceneState(STATES.OTP_PENDING); startScanLoop(); }, 450);
    try {
      await onOTPLogin(otpCode);
      // SUCCESS — full teardown. Cancel every pending timer (so the
      // 450ms startScanLoop can't fire after we've already won), stop
      // the loop, play the success chime, then hard-stop all audio once
      // the chime has finished so nothing bleeds into the dashboard the
      // parent is about to navigate to.
      clearTimers();
      stopScanLoop();
      setSceneState(STATES.OTP_SUCCESS);
      playSuccess();
      track(() => teardownSounds(), 900);   // chime is ~680ms; 900 covers it
      // AppContext handles the navigation on success.
    } catch (err) {
      clearTimers();
      stopScanLoop();
      setError(err?.message || 'Code did not match. Try again.');
      setSceneState(STATES.OTP_FAILED);
      playFailure();
      track(() => setSceneState(STATES.OTP_PENDING), 1300);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Input handlers ────────────────────────────────────────────────
  const onEmailFocus = () => {
    if (sceneState === STATES.IDLE || sceneState === STATES.EMAIL_FOCUSED) {
      setSceneState(STATES.EMAIL_FOCUSED);
      enableSounds();
      playHover();
    }
  };

  const onKey = (e, fn) => {
    if (e.key === 'Enter' && !submitting) { e.preventDefault(); fn(); }
  };

  return (
    <div className="min-h-screen bg-n-50 flex items-stretch overflow-hidden">
      {/* ── LEFT BRAND PANEL ──────────────────────────────────────── */}
      <aside
        className="hidden lg:flex w-[42%] xl:w-[40%] flex-col justify-between p-12 text-white relative overflow-hidden z-10"
        style={{
          background:
            'radial-gradient(900px 500px at 100% 0%, rgba(255,255,255,0.10) 0%, transparent 60%),' +
            'radial-gradient(700px 600px at 0% 100%, rgba(0,0,0,0.25) 0%, transparent 60%),' +
            'linear-gradient(135deg, #0d4e96 0%, #0F6CBD 60%, #1483D6 100%)'
        }}
      >
        <div aria-hidden className="absolute -top-24 -right-24 w-[420px] h-[420px] rounded-full bg-white/5 blur-2xl" />
        <div aria-hidden className="absolute -bottom-32 -left-16 w-[360px] h-[360px] rounded-full bg-white/5 blur-2xl" />

        <div className="relative z-10 flex items-center gap-3">
          <span className="brand-mark-gradient w-8 h-8 rounded-md grid place-items-center font-bold text-white shadow-card text-[15px]">M</span>
          <span className="font-semibold tracking-tight text-[15px]">{companyName}</span>
        </div>

        <motion.div
          className="relative z-10 max-w-md"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE_OUT }}
        >
          <div className="text-[12px] uppercase tracking-[0.18em] text-white/70 mb-3">Identity Systems</div>
          <h1 className="text-4xl xl:text-5xl font-semibold leading-tight tracking-tight">
            Verify once.<br />Work everywhere.
          </h1>
          <p className="mt-5 text-white/80 text-[15px] leading-relaxed">
            Enterprise-grade identity for quoting, sourcing, and approvals.
            Real-time invoices, RFQs, and procurement — together in one
            secure workspace.
          </p>

          <ul className="mt-8 space-y-3">
            {[
              { icon: <ShieldCheck />, text: 'Single sign-on with one-time email passcode' },
              { icon: <KeyRound />,    text: 'Role-aware: sales, procurement, finance' },
              { icon: <ShieldCheck />, text: 'Audit trail on every state-change' }
            ].map((row, i) => (
              <motion.li
                key={i}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.35, delay: 0.15 + i * 0.06, ease: EASE_OUT }}
                className="flex items-center gap-3 text-[14px] text-white/90"
              >
                <span className="w-7 h-7 rounded-md bg-white/15 grid place-items-center text-white">
                  {React.cloneElement(row.icon, { className: 'w-3.5 h-3.5' })}
                </span>
                {row.text}
              </motion.li>
            ))}
          </ul>
        </motion.div>

        <div className="relative z-10 text-[12px] text-white/60">
          © {new Date().getFullYear()} {companyName}. All rights reserved. · v0.9.5
        </div>
      </aside>

      {/* ── RIGHT STAGE — WHITE STUDIO, SCANNER HERO ──────────────
          The right panel is a clean white studio. Behind the
          transparent 3D canvas sits a soft state-tinted radial
          gradient so the white side has depth + reacts to the auth
          state (blue idle, brighter on focus, green/red on result)
          instead of reading as a flat slab. The login card overlays
          the scanner's mid display zone — MIDSA wordmark shows above
          it, the fingerprint sensor shows below it. */}
      <main
        className="flex-1 relative overflow-hidden transition-[background] duration-700"
        style={{ background: STAGE_BACKDROP[sceneState] || STAGE_BACKDROP.idle }}
      >
        {/* The 3D canvas wrapper does the absolute positioning; the
            <Canvas> inside fills it at 100%×100%. This is the sizing
            pattern R3F's resize-observer needs to measure correctly. */}
        <div className="absolute inset-0">
          <SceneErrorBoundary>
            <Suspense fallback={<div className="absolute inset-0 bg-white" />}>
              <Scene state={sceneState} />
            </Suspense>
          </SceneErrorBoundary>
        </div>

        {/* Sound toggle — dark icon on the white backdrop */}
        <button
          type="button"
          onClick={toggleSound}
          className="absolute bottom-5 right-5 z-20 w-10 h-10 grid place-items-center rounded-full bg-white/80 hover:bg-white backdrop-blur-sm text-n-700 border border-n-200 shadow-card transition-colors"
          aria-label={soundOn ? 'Mute sound' : 'Enable sound'}
          title={soundOn ? 'Mute' : 'Enable sound'}
        >
          {soundOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
        </button>

        {/* ── LOGIN CARD — overlay on the scanner's display zone ───
            Shifted UP from dead-centre via translateY so the MIDSA
            wordmark on the scanner's face shows above the card and
            the fingerprint sensor shows below it. Width 300 px keeps
            the scanner's bezel visible on all sides. The card carries
            a state-coloured LED status strip along its top edge so it
            visually belongs to the scanner, not floating over it. */}
        <motion.div
          className="absolute inset-0 flex items-center justify-center p-4 sm:p-8 z-10"
          style={{ transform: 'translateY(-7%)' }}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: EASE_OUT }}
        >
          <div className="w-full max-w-[300px]">
            {/* Mobile-only banner (left panel is hidden) */}
            {/* Mobile-only banner — text colours flipped to dark since
                the right-stage background is now white, not navy. */}
            <div className="lg:hidden mb-5 flex items-center gap-3">
              <span className="brand-mark-gradient w-8 h-8 rounded-md grid place-items-center font-bold text-white shadow-card text-[15px]">M</span>
              <div>
                <div className="font-semibold text-n-800 text-[15px] tracking-tight">{companyName}</div>
                <div className="text-[11px] text-n-500 uppercase tracking-wider">Identity Systems</div>
              </div>
            </div>

            <div
              className="rounded-[18px] px-6 pt-7 pb-6 sm:px-7 border relative overflow-hidden"
              style={{
                /* The card IS the scanner's display surface. It reads as
                   the device's UI: warm-white panel, a state-coloured LED
                   strip along the top edge tying it to the scanner, and a
                   soft tinted shadow + glow that grounds it on the device
                   face rather than floating over it. */
                background: 'rgba(252, 253, 255, 0.97)',
                backdropFilter: 'blur(10px) saturate(115%)',
                WebkitBackdropFilter: 'blur(10px) saturate(115%)',
                borderColor: 'rgba(15, 108, 189, 0.12)',
                boxShadow:
                  /* Soft outer drop — grounds it on the scanner face */
                  '0 18px 40px rgba(13, 30, 60, 0.22), ' +
                  /* Tight bezel separation line */
                  '0 0 0 1px rgba(15, 23, 42, 0.04), ' +
                  /* State-coloured outer glow — the card "belongs to"
                     the scanner because it picks up the same LED hue */
                  `0 0 60px ${CARD_LED[sceneState] || CARD_LED.idle}33, ` +
                  /* Inset top highlight — looks like backlight */
                  'inset 0 1px 0 rgba(255, 255, 255, 0.95)',
                transition: 'box-shadow 600ms ease'
              }}
            >
              {/* State-coloured LED status strip along the card's top
                  edge — same palette as the scanner's LED + fingerprint.
                  In the searching states it pulses; on success/failure
                  it's solid. This is the single biggest "one device"
                  connector between the HTML card and the 3D scanner. */}
              <div
                className="absolute top-0 left-0 right-0 h-[3px]"
                style={{
                  background: `linear-gradient(90deg, transparent, ${CARD_LED[sceneState] || CARD_LED.idle}, transparent)`,
                  boxShadow: `0 0 12px ${CARD_LED[sceneState] || CARD_LED.idle}`,
                  transition: 'background 500ms ease, box-shadow 500ms ease',
                  animation:
                    (sceneState === 'otp_requested' || sceneState === 'otp_pending')
                      ? 'v2-led-flicker 0.45s steps(2, jump-none) infinite'
                      : 'none'
                }}
              />

              <div className="flex justify-center mb-5">
                <div className="bg-white rounded-card p-3 border border-n-200 shadow-card">
                  {companyLogo
                    ? <img src={companyLogo} alt={`${companyName} Logo`} className="h-10 sm:h-12 w-auto object-contain" />
                    : <div className="text-n-700 font-semibold">{companyName}</div>}
                </div>
              </div>

              <div className="text-center mb-5">
                <h2 className="text-xl font-semibold text-n-800 tracking-tight">
                  {step === 'email' ? 'Sign in' : 'Verify your identity'}
                </h2>
                <p className="text-[13px] text-n-500 mt-1">
                  {step === 'email'
                    ? 'Place your finger on the scanner — we’ll email you a one-time code.'
                    : <>We sent a 6-digit code to <span className="text-n-700 font-medium">{email}</span></>}
                </p>
              </div>

              <AnimatePresence mode="wait">
                {step === 'email' ? (
                  <motion.div key="email" variants={dialogVariants} initial="initial" animate="enter" exit="exit" className="space-y-4">
                    <FormField
                      label="Work email"
                      icon={<Mail />}
                      type="email"
                      autoFocus
                      autoComplete="email"
                      placeholder="you@company.com"
                      value={email}
                      onFocus={onEmailFocus}
                      onChange={(e) => setEmail(e.target.value)}
                      onKeyDown={(e) => onKey(e, submitEmail)}
                      disabled={submitting}
                    />
                    {error && <ErrorRow message={error} />}
                    <Button
                      variant="primary"
                      size="lg"
                      className="w-full"
                      onClick={submitEmail}
                      disabled={submitting}
                      iconRight={submitting ? <Loader2 className="animate-spin" /> : <ArrowRight />}
                    >
                      {submitting ? 'Sending code…' : 'Continue with email'}
                    </Button>
                    <p className="text-[12px] text-n-500 text-center mt-2">
                      By continuing you agree to {companyName}’s acceptable-use policy.
                    </p>
                  </motion.div>
                ) : (
                  <motion.div key="otp" variants={dialogVariants} initial="initial" animate="enter" exit="exit" className="space-y-4">
                    <FormField
                      label="One-time code"
                      icon={<KeyRound />}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="6-digit code"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                      onKeyDown={(e) => onKey(e, submitOtp)}
                      disabled={submitting}
                      autoFocus
                      monospace
                    />
                    {error && <ErrorRow message={error} />}
                    <Button
                      variant="primary"
                      size="lg"
                      className="w-full"
                      onClick={submitOtp}
                      disabled={submitting}
                      iconRight={submitting ? <Loader2 className="animate-spin" /> : <ArrowRight />}
                    >
                      {submitting ? 'Verifying…' : 'Verify and sign in'}
                    </Button>
                    <div className="flex items-center justify-between text-[12px]">
                      <button
                        type="button"
                        onClick={() => { setStep('email'); setOtpCode(''); setError(null); setSceneState(STATES.EMAIL_FOCUSED); stopScanLoop(); }}
                        className="text-accent-text hover:underline"
                      >← Use a different email</button>
                      <button
                        type="button"
                        onClick={submitEmail}
                        disabled={submitting}
                        className="text-accent-text hover:underline disabled:text-n-400"
                      >Resend code</button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {onDiagnostic && (
                <div className="pt-5 mt-5 border-t border-n-100">
                  <Button variant="subtle" size="sm" className="w-full" onClick={onDiagnostic}>
                    Database diagnostic
                  </Button>
                </div>
              )}
            </div>

            {/* Helper line below the card — sits on white now, so dark text. */}
            <div className="text-center text-[12px] text-n-500 mt-5">
              Trouble signing in? Contact your {companyName} administrator.
            </div>
          </div>
        </motion.div>
      </main>
    </div>
  );
}

/* ── Form pieces ───────────────────────────────────────────────── */
function FormField({ label, icon, monospace, ...inputProps }) {
  return (
    <div>
      <label className="block text-[12px] font-semibold text-n-700 mb-1.5">{label}</label>
      <div className="relative">
        {icon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-n-400 pointer-events-none">
            {React.cloneElement(icon, { className: 'w-4 h-4' })}
          </span>
        )}
        <input
          {...inputProps}
          className={[
            'w-full h-11 pl-10 pr-3 text-[14px] bg-white border border-n-300 rounded-md',
            'text-n-800 placeholder:text-n-400',
            'focus:outline-none focus:border-accent focus:shadow-focus',
            'transition-colors',
            'disabled:bg-n-50 disabled:text-n-400 disabled:cursor-not-allowed',
            monospace ? 'font-mono-num tracking-[0.2em] text-center text-[16px]' : ''
          ].join(' ')}
        />
      </div>
    </div>
  );
}

function ErrorRow({ message }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="bg-err-soft border border-err/30 text-err text-[12.5px] px-3 py-2 rounded-md"
      role="alert"
    >{message}</motion.div>
  );
}
