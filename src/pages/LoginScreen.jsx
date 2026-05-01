import React, { useState, useEffect } from 'react';
import companyLogo from '../assets/company-logo.png';
import GlassSurface from '../components/common/GlassSurface.jsx';
import Button from '../components/common/Button.jsx';

/**
 * LoginScreen — pre-auth entry point.
 *
 * Styled with the same glass language as the rest of the app (GlassSurface
 * + Inter + primary navy accents). AnimatedBubbleParticles was removed in
 * favour of a subtle gradient canvas — the bubble backdrop competed with
 * the glass card and felt playful in a way that clashed with the new
 * enterprise-neutral direction. RippleButton was swapped for the shared
 * Button primitive so login also benefits from the sound + haptic layer.
 */
const LoginScreen = ({ onLogin, onOTPLogin, companyName = 'MIDSA', onDiagnostic }) => {
    const [email, setEmail] = useState('');
    const [otpCode, setOtpCode] = useState('');
    const [hideSignInButton, setHideSignInButton] = useState(false);

    // Debug logging for logo integration
    useEffect(() => {
        console.log('🔍 [DEBUG] LoginScreen mounted with:', { companyName });
        console.log('🔍 [DEBUG] Company logo import:', companyLogo);
    }, [companyName]);

    const inputClass =
        'mt-1 block w-full px-3 py-2.5 text-sm bg-white/80 border border-line rounded-card ' +
        'focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary placeholder:text-ink-subtle';

    return (
        <div
            className="min-h-screen flex items-center justify-center p-4"
            style={{
                background:
                    'radial-gradient(1200px 600px at 10% 0%, #eef2f7 0%, transparent 60%),' +
                    'radial-gradient(900px 500px at 90% 100%, #dce4ef 0%, transparent 60%),' +
                    'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)'
            }}
        >
            <div className="max-w-md w-full">
                <GlassSurface tint="strong" radius="glass" padding="p-0" interactive>
                    <div className="p-8">
                        <div className="text-center mb-8">
                            <div className="flex justify-center mb-6">
                                <div className="bg-white rounded-panel p-4 sm:p-6 shadow-card border border-line">
                                    {companyLogo ? (
                                        <img
                                            src={companyLogo}
                                            alt={`${companyName} Logo`}
                                            className="h-16 sm:h-20 md:h-24 w-auto object-contain max-w-full"
                                            onLoad={() => {
                                                console.log('✅ [DEBUG] Company logo loaded successfully');
                                            }}
                                            onError={(e) => {
                                                console.warn('⚠️ [DEBUG] Logo failed to load, showing fallback');
                                                e.target.style.display = 'none';
                                                e.target.nextSibling.style.display = 'block';
                                            }}
                                        />
                                    ) : null}
                                    <div
                                        className={`text-center text-ink-muted font-semibold text-lg sm:text-xl ${companyLogo ? 'hidden' : 'block'}`}
                                        style={companyLogo ? { display: 'none' } : {}}
                                    >
                                        {companyName}
                                    </div>
                                </div>
                            </div>
                            <h1 className="text-2xl font-semibold text-ink tracking-tight">PROJECT QUOTE</h1>
                            <p className="text-sm text-ink-muted mt-1">Intelligent Operations System</p>
                        </div>

                        <div className="space-y-5">
                            <div>
                                <label className="block text-sm font-medium text-ink mb-2">
                                    Sign in with Email
                                </label>
                                <input
                                    type="text"
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                    className={inputClass}
                                    placeholder="Enter email"
                                />
                            </div>

                            {hideSignInButton && (
                                <div>
                                    <label className="block text-sm font-medium text-ink mb-2">
                                        One-Time Code
                                    </label>
                                    <input
                                        type="text"
                                        value={otpCode}
                                        onChange={e => setOtpCode(e.target.value)}
                                        className={inputClass}
                                        placeholder="Enter OTP"
                                    />
                                </div>
                            )}

                            {hideSignInButton ? (
                                <Button
                                    variant="primary"
                                    fullWidth
                                    onClick={() => { onOTPLogin(otpCode); setHideSignInButton(false); }}
                                >
                                    Proceed
                                </Button>
                            ) : (
                                <Button
                                    variant="primary"
                                    fullWidth
                                    onClick={() => { setHideSignInButton(true); onLogin(email); }}
                                >
                                    Sign In
                                </Button>
                            )}

                            {onDiagnostic && (
                                <div className="pt-4 border-t border-line/60">
                                    <Button
                                        variant="secondary"
                                        fullWidth
                                        onClick={onDiagnostic}
                                    >
                                        🔧 Database Diagnostic Tool
                                    </Button>
                                </div>
                            )}
                        </div>
                    </div>
                </GlassSurface>
            </div>
        </div>
    );
};

export default LoginScreen;
