import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, KeyRound, ArrowRight, ShieldCheck, Sparkles, Loader2, Wrench } from 'lucide-react';
import companyLogo from '../assets/company-logo.png';
import Button from '../components/v2/Button';
import Label from '../components/v2/Label';
import { dialogVariants, EASE_OUT } from '../components/v2/motion';

/**
 * LoginScreen — Fluent 2 enterprise sign-in.
 *
 * Replaces the previous glass-card-on-radial-gradient with a two-pane
 * layout in the spirit of Microsoft / Office 365 sign-in:
 *
 *   ┌────────────────────────┬───────────────────────┐
 *   │  Hero panel             │  Sign-in card        │
 *   │  (cobalt gradient,      │  (white, flat,       │
 *   │   product moniker,      │   email → OTP step)  │
 *   │   value-prop bullets)   │                      │
 *   └────────────────────────┴───────────────────────┘
 *
 * Stacks vertically on small screens. The hero panel collapses to a
 * compact 88px banner so the sign-in card stays the focus on mobile.
 *
 * The auth flow itself (handleLogin / handleOTPLogin in AppContext) is
 * UNCHANGED. We only swap the visual chrome.
 */
const LoginScreen = ({ onLogin, onOTPLogin, companyName = 'MIDSA', onDiagnostic }) => {
  const [email, setEmail]               = useState('');
  const [otpCode, setOtpCode]           = useState('');
  const [step, setStep]                 = useState('email');   // 'email' | 'otp'
  const [submitting, setSubmitting]     = useState(false);
  const [error, setError]               = useState(null);

  useEffect(() => {
    console.log('🔍 [DEBUG] LoginScreen mounted with:', { companyName });
  }, [companyName]);

  const submitEmail = async () => {
    if (!email.trim()) { setError('Enter your work email to continue.'); return; }
    setError(null);
    setSubmitting(true);
    try {
      await onLogin(email);
      setStep('otp');
    } catch (err) {
      setError(err?.message || 'Could not send the code. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitOtp = async () => {
    if (!otpCode.trim()) { setError('Enter the 6-digit code we just emailed you.'); return; }
    setError(null);
    setSubmitting(true);
    try {
      await onOTPLogin(otpCode);
    } catch (err) {
      setError(err?.message || 'Code did not match. Try again or request a new one.');
    } finally {
      setSubmitting(false);
    }
  };

  const onKeyDown = (e, fn) => {
    if (e.key === 'Enter' && !submitting) {
      e.preventDefault();
      fn();
    }
  };

  return (
    <div className="min-h-screen bg-n-50 flex items-stretch">
      {/* HERO PANEL — visible on lg+ */}
      <aside
        className="hidden lg:flex w-1/2 xl:w-[44%] flex-col justify-between p-12 text-white relative overflow-hidden"
        style={{
          background:
            'radial-gradient(900px 500px at 100% 0%, rgba(255,255,255,0.10) 0%, transparent 60%),' +
            'radial-gradient(700px 600px at 0% 100%, rgba(0,0,0,0.20) 0%, transparent 60%),' +
            'linear-gradient(135deg, #0F548C 0%, #0F6CBD 60%, #1483D6 100%)'
        }}
      >
        {/* Decorative geometry */}
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
          <div className="text-[12px] uppercase tracking-[0.18em] text-white/70 mb-3">Project Quote</div>
          <h1 className="text-4xl xl:text-5xl font-semibold leading-tight tracking-tight">
            Quote, source, and approve <br />without leaving the workspace.
          </h1>
          <p className="mt-5 text-white/80 text-[15px] leading-relaxed">
            Intelligent operations for modern enterprises. Real-time invoices, RFQs,
            and procurement — together in one place.
          </p>

          <ul className="mt-8 space-y-3">
            {[
              { icon: <ShieldCheck />, text: 'Single sign-on with one-time passcode by email' },
              { icon: <Sparkles />,    text: 'AI-assisted quoting, sourcing, and approvals' },
              { icon: <KeyRound />,    text: 'Role-aware: sales, procurement, controller, admin' }
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

      {/* SIGN-IN COLUMN */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <motion.div
          className="w-full max-w-[420px]"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE_OUT }}
        >
          {/* Mobile-only banner so the brand still appears above the card */}
          <div className="lg:hidden mb-6 flex items-center gap-3">
            <span className="brand-mark-gradient w-8 h-8 rounded-md grid place-items-center font-bold text-white shadow-card text-[15px]">M</span>
            <div>
              <div className="font-semibold text-n-800 text-[15px] tracking-tight">{companyName}</div>
              <div className="text-[11px] text-n-500 uppercase tracking-wider">Project Quote</div>
            </div>
          </div>

          {/* Card */}
          <div className="bg-white border border-n-200 rounded-panel shadow-card p-6 sm:p-8">
            {/* Logo block */}
            <div className="flex justify-center mb-6">
              <div className="bg-n-50 rounded-card p-3 border border-n-200">
                {companyLogo ? (
                  <img
                    src={companyLogo}
                    alt={`${companyName} Logo`}
                    className="h-12 sm:h-14 w-auto object-contain"
                    onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'block'; }}
                  />
                ) : null}
                <div
                  className={`text-center text-n-700 font-semibold ${companyLogo ? 'hidden' : 'block'}`}
                  style={companyLogo ? { display: 'none' } : {}}
                >{companyName}</div>
              </div>
            </div>

            <div className="text-center mb-5">
              <h2 className="text-xl font-semibold text-n-800 tracking-tight">
                {step === 'email' ? 'Sign in' : 'Check your email'}
              </h2>
              <p className="text-[13px] text-n-500 mt-1">
                {step === 'email'
                  ? 'We’ll email you a one-time code to verify it’s you.'
                  : <>We sent a 6-digit code to <span className="text-n-700 font-medium">{email}</span></>}
              </p>
            </div>

            {/* Step swap */}
            <AnimatePresence mode="wait">
              {step === 'email' ? (
                <motion.div
                  key="step-email"
                  variants={dialogVariants}
                  initial="initial"
                  animate="enter"
                  exit="exit"
                  className="space-y-4"
                >
                  <FormField
                    label="Work email"
                    icon={<Mail />}
                    type="email"
                    required
                    autoFocus
                    autoComplete="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => onKeyDown(e, submitEmail)}
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
                <motion.div
                  key="step-otp"
                  variants={dialogVariants}
                  initial="initial"
                  animate="enter"
                  exit="exit"
                  className="space-y-4"
                >
                  <FormField
                    label="One-time code"
                    icon={<KeyRound />}
                    inputMode="numeric"
                    required
                    autoComplete="one-time-code"
                    placeholder="6-digit code"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                    onKeyDown={(e) => onKeyDown(e, submitOtp)}
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
                      onClick={() => { setStep('email'); setOtpCode(''); setError(null); }}
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
                <Button
                  variant="subtle"
                  size="sm"
                  className="w-full"
                  onClick={onDiagnostic}
                  iconLeft={<Wrench />}
                >Database diagnostic</Button>
              </div>
            )}
          </div>

          <div className="text-center text-[12px] text-n-500 mt-5">
            Trouble signing in? Contact your {companyName} administrator.
          </div>
        </motion.div>
      </main>
    </div>
  );
};

/* ── Form pieces ──────────────────────────────────────────── */

function FormField({ label, icon, monospace, required = false, ...inputProps }) {
  return (
    <div>
      <Label className="block text-[12px] font-semibold text-n-700 mb-1.5" required={required}>{label}</Label>
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

export default LoginScreen;
