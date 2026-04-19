import React from 'react';

export default function RippleButton({
  children,
  text,
  bgColor = '#ffffff', // default white button
  circleColor = '#173eff', // royal blue ripple
  width,
  height,
  className = '',
  ...rest
}) {
  const label = children || text || 'Click Me';
  return (
    <button
      {...rest}
      className={`ripple-btn ${className}`}
      style={{ backgroundColor: bgColor, width, height, color: '#111827', border: '1px solid rgba(0,0,0,0.1)' }}
    >
      <span className="circle1"></span>
      <span className="circle2"></span>
      <span className="circle3"></span>
      <span className="circle4"></span>
      <span className="circle5"></span>
      <span className="text">{label}</span>
      <style>{`
        .ripple-btn {
          font-family: Arial, Helvetica, sans-serif;
          font-weight: 600;
          /* L7 — explicit line-height prevents 1px drift from parent typography */
          line-height: 1;
          padding: 0.9em 1.8em;
          border: none;
          border-radius: 0.6rem;
          position: relative;
          cursor: pointer;
          overflow: hidden;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          vertical-align: middle;
          box-sizing: border-box;
          transition: transform 0.15s ease, box-shadow 0.2s ease;
        }
        .ripple-btn .text {
          line-height: 1;
          display: inline-flex;
          align-items: center;
        }
        .ripple-btn:active { transform: scale(0.97); }
        .ripple-btn span:not(:nth-child(6)) {
          position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
          height: 30px; width: 30px; background-color: ${circleColor}; border-radius: 50%;
          transition: 0.6s ease; pointer-events: none; opacity: 0.28; mix-blend-mode: multiply;
        }
        .ripple-btn span:nth-child(6) { position: relative; z-index: 1; }
        .ripple-btn .circle1 { transform: translate(-3.3em, -4em); }
        .ripple-btn .circle2 { transform: translate(-6em, 1.3em); }
        .ripple-btn .circle3 { transform: translate(-0.2em, 1.8em); }
        .ripple-btn .circle4 { transform: translate(3.5em, 1.4em); }
        .ripple-btn .circle5 { transform: translate(3.5em, -3.8em); }
        .ripple-btn:hover span:not(:nth-child(6)) { transform: translate(-50%, -50%) scale(4); transition: 1.2s ease; }
      `}</style>
    </button>
  );
}


