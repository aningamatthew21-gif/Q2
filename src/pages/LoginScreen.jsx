import React, { useState, useEffect } from 'react';
import companyLogo from '../assets/company-logo.png';
import AnimatedBubbleParticles from '../components/AnimatedBubbleParticles.jsx';
import LiquidGlassCard from '../components/LiquidGlassCard.jsx';
import RippleButton from '../components/RippleButton.jsx';

const LoginScreen = ({ onLogin, onOTPLogin, companyName = 'MIDSA', onDiagnostic }) => {
    const [role, setRole] = useState('sales');
    const [email, setEmail] = useState('');
    const [otpCode, setOtpCode] = useState('');
    const [hideSignInButton, setHideSignInButton] = useState(false);

    // Debug logging for logo integration
    useEffect(() => {
        console.log('🔍 [DEBUG] LoginScreen mounted with:', { companyName });
        console.log('🔍 [DEBUG] Company logo import:', companyLogo);
    }, [companyName]);

    return (
        <AnimatedBubbleParticles
            background="linear-gradient(135deg, #0b5cff 0%, #ff2a2a 100%)"
            bubbleColors={["#1f3bff", "#e02424"]}
            bubbleSize={30}
            spawnIntervalMs={150}
            enableGoo={true}
            blurStrength={12}
            zIndex={0}
        >
            <div className="max-w-md w-full mx-auto p-2">
                <LiquidGlassCard>
                    <div className="p-8">
                        <div className="text-center mb-8">
                            {/* Company Logo */}
                            <div className="flex justify-center mb-6">
                                <div className="bg-white rounded-xl p-4 sm:p-6 shadow-lg border border-gray-200 hover:shadow-xl transition-shadow duration-300">
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
                                    {/* Fallback text if logo fails to load or is not available */}
                                    <div
                                        className={`text-center text-gray-600 font-semibold text-lg sm:text-xl ${companyLogo ? 'hidden' : 'block'}`}
                                        style={companyLogo ? { display: 'none' } : {}}
                                    >
                                        {companyName}
                                    </div>
                                </div>
                            </div>
                            <h1 className="text-3xl font-bold text-gray-800">PROJECT QUOTE</h1>
                            <p className="text-gray-500">Intelligent Operations System</p>
                        </div>
                        <div className="space-y-6">
                            {/* <div><label className="block text-sm font-medium mb-4 text-gray-700">Sign in as</label><select value={role} onChange={e => setRole(e.target.value)} className="mt-1 block w-full pl-3 pr-10 py-2 text-base outline border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"><option value="sales">Salesperson</option><option value="controller">Financial Controller</option></select></div> */}
                            <div><label className="block text-sm font-medium mb-4 text-gray-700">Sign in with Email</label>  </div>
                            <input type="text" value={email} onChange={e => setEmail(e.target.value)} className="mt-1 block w-full pl-3 pr-10 py-2 text-base outline border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md" placeholder="Enter email" />

                            {hideSignInButton && <input type="text" value={otpCode} onChange={e => setOtpCode(e.target.value)} className="mt-1 block w-full pl-3 pr-10 py-2 text-base outline border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md" placeholder="Enter OTP" />}
                            {hideSignInButton &&
                                <RippleButton onClick={() => { onOTPLogin(otpCode); setHideSignInButton(false); }} className="w-full" bgColor="#ffffff" circleColor="#173eff">Proceed</RippleButton>}
                            {!hideSignInButton &&
                                <RippleButton onClick={() => { setHideSignInButton(true); onLogin(email) }} className="w-full" bgColor="#ffffff" circleColor="#173eff">Sign In</RippleButton>}


                            {/* {onDiagnostic && (
                        <div className="pt-4 border-t border-gray-200">
                            <RippleButton onClick={onDiagnostic} className="w-full" bgColor="#ffffff" circleColor="#173eff">🔧 Database Diagnostic Tool</RippleButton>
                        </div>
                    )} */}
                        </div>
                    </div>
                </LiquidGlassCard>
            </div>
        </AnimatedBubbleParticles>
    );
};

export default LoginScreen;
