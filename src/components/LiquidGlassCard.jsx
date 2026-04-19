import React, { useEffect, useRef, useState } from 'react';

// Liquid glass card with backdrop blur, tint, breathing animation and mouse-follow sheen
export default function LiquidGlassCard({ className = '', children, radius = 24, blur = 14, tint = 'rgba(255,255,255,0.06)' }) {
  const [mouse, setMouse] = useState({ x: 50, y: 50 });
  const ref = useRef(null);

  useEffect(() => {
    const onMove = (e) => {
      if (!ref.current) return;
      const r = ref.current.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 100;
      const y = ((e.clientY - r.top) / r.height) * 100;
      setMouse({ x, y });
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  const fluidCss = `
  @keyframes breathLg {
    0%,100% { transform: scale(1); box-shadow: 0 14px 40px -10px rgba(0,0,0,0.18), 0 0 0 1px rgba(255,255,255,0.18); }
    50% { transform: scale(1.005); box-shadow: 0 18px 56px -12px rgba(0,0,0,0.22), 0 0 0 1px rgba(255,255,255,0.26); }
  }
  .liquid-glass-card { 
    animation: breathLg 7s ease-in-out infinite alternate;
    backdrop-filter: blur(${blur}px) saturate(180%);
    -webkit-backdrop-filter: blur(${blur}px) saturate(180%);
    border: 1px solid rgba(255,255,255,0.28);
    background: ${tint};
    position: relative;
  }
  .glass-sheen { 
    background: radial-gradient(circle at var(--mx,50%) var(--my,50%), rgba(255,255,255,0.35) 0%, transparent 28%);
    opacity: .9; pointer-events: none;
  }
  `;

  return (
    <div className={className}>
      <style dangerouslySetInnerHTML={{ __html: fluidCss }} />
      <div
        ref={ref}
        className="liquid-glass-card rounded-3xl shadow-xl overflow-hidden relative"
        style={{ '--mx': `${mouse.x}%`, '--my': `${mouse.y}%` }}
      >
        <div className="glass-sheen absolute inset-0 rounded-3xl" />
        <div className="relative z-10">
          {children}
        </div>
      </div>
    </div>
  );
}


