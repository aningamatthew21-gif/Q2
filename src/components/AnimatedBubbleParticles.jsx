import React, { useCallback, useEffect, useRef, useState } from 'react';

// Animated bubbles background (pure React + SVG, no external deps)
// Props kept minimal; tuned for full-screen login usage
export default function AnimatedBubbleParticles({
  className = '',
  background = 'linear-gradient(135deg, #0b5cff 0%, #ff2a2a 100%)',
  bubbleColors = ['#1f3bff', '#e02424'], // royal blue, red
  bubbleSize = 28,
  spawnIntervalMs = 160,
  enableGoo = true,
  blurStrength = 10,
  zIndex = 0,
  // interaction
  interactionRadius = 160,
  interactionStrength = 22,
  hoverScaleBoost = 0.15,
  children
}) {
  const containerRef = useRef(null);
  const particlesRef = useRef(null);
  const rafRef = useRef();
  const intervalRef = useRef();
  const particlesArrRef = useRef([]);
  const [rect, setRect] = useState({ width: 0, height: 0 });
  const gooIdRef = useRef('goo-' + Math.random().toString(36).slice(2));
  const mouseRef = useRef({ x: 0, y: 0, active: false });

  const createSvg = useCallback(() => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.cssText = `display:block;width:${bubbleSize}px;height:${bubbleSize}px;position:absolute;transform:translateZ(0);`;
    svg.setAttribute('viewBox', '0 0 67.4 67.4');
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '33.7');
    circle.setAttribute('cy', '33.7');
    circle.setAttribute('r', '33.7');
    const color = bubbleColors[Math.floor(Math.random() * bubbleColors.length)] || '#3e82f7';
    circle.setAttribute('fill', color);
    svg.appendChild(circle);
    return svg;
  }, [bubbleColors, bubbleSize]);

  const popParticle = useCallback((el) => {
    const arr = particlesArrRef.current;
    const idx = arr.findIndex(p => p.el === el);
    if (idx === -1) return;
    const p = arr[idx];
    if (!p || p.popping) return;
    p.popping = true;
    try {
      const base = `translateX(${p.lastX || p.x}px) translateY(${p.lastY || p.y}px) rotate(0deg)`;
      el.style.transition = 'transform 180ms ease, opacity 180ms ease';
      el.style.transform = `${base} scale(${(p.lastScale || p.scale) * 1.6})`;
      // shrink to zero next frame
      requestAnimationFrame(() => {
        el.style.transform = `${base} scale(0.01)`;
        el.style.opacity = '0';
      });
      setTimeout(() => {
        if (el && el.parentNode) el.parentNode.removeChild(el);
        // remove from array
        particlesArrRef.current = particlesArrRef.current.filter(pp => pp !== p);
      }, 200);
    } catch {}
  }, []);

  const spawn = useCallback(() => {
    if (!particlesRef.current || rect.width === 0 || rect.height === 0) return;
    const el = createSvg();
    particlesRef.current.appendChild(el);
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => popParticle(el));
    const x = Math.random() * rect.width;
    const y = rect.height + 120;
    const steps = rect.height / 2;
    const friction = 1 + Math.random() * 1.4; // 1.0 - 2.4
    const scale = 0.5 + Math.random() * 2.2;  // 0.5 - 2.7
    const siner = (rect.width / 2.5) * Math.random();
    const rotationDir = Math.random() > 0.5 ? '+' : '-';
    el.style.transform = `translateX(${x}px) translateY(${y}px)`;

    particlesArrRef.current.push({ x, y, scale, friction, siner, steps, rotationDir, el, popping: false, lastX: x, lastY: y, lastScale: scale });
  }, [createSvg, rect, popParticle]);

  const tick = useCallback(() => {
    particlesArrRef.current = particlesArrRef.current.filter(p => {
      p.y -= p.friction;
      const left = p.x + Math.sin((p.y * Math.PI) / p.steps) * p.siner;
      const top = p.y;
      const rot = p.rotationDir + (p.y + bubbleSize);
      let drawX = left;
      let drawY = top;
      let drawScale = p.scale;
      if (mouseRef.current.active && !p.popping) {
        const dx = drawX - mouseRef.current.x;
        const dy = drawY - mouseRef.current.y;
        const dist = Math.hypot(dx, dy);
        if (dist < interactionRadius) {
          const t = (interactionRadius - dist) / interactionRadius; // 0..1
          const push = interactionStrength * t;
          const ux = (dx || 0.001) / (dist || 0.001);
          const uy = (dy || 0.001) / (dist || 0.001);
          drawX += ux * push;
          drawY += uy * push;
          drawScale = Math.min(3.0, drawScale + hoverScaleBoost * t);
        }
      }
      // persist last draw values for pop animation
      p.lastX = drawX; p.lastY = drawY; p.lastScale = drawScale;
      if (p.el && !p.popping) {
        p.el.style.transform = `translateX(${drawX}px) translateY(${drawY}px) scale(${drawScale}) rotate(${rot}deg)`;
      }
      if (p.y < -bubbleSize && !p.popping) {
        if (p.el && p.el.parentNode) p.el.parentNode.removeChild(p.el);
        return false;
      }
      return true;
    });
    rafRef.current = requestAnimationFrame(tick);
  }, [bubbleSize]);

  useEffect(() => {
    const update = () => {
      if (!containerRef.current) return;
      const r = containerRef.current.getBoundingClientRect();
      setRect({ width: r.width, height: r.height });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (rect.width > 0 && rect.height > 0) {
      rafRef.current = requestAnimationFrame(tick);
      intervalRef.current = setInterval(spawn, spawnIntervalMs);
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
      particlesArrRef.current.forEach(p => {
        if (p.el && p.el.parentNode) p.el.parentNode.removeChild(p.el);
      });
      particlesArrRef.current = [];
    };
  }, [rect, tick, spawn, spawnIntervalMs]);

  // mouse listeners on container
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const onMove = (e) => {
      const bounds = node.getBoundingClientRect();
      mouseRef.current.x = e.clientX - bounds.left;
      mouseRef.current.y = e.clientY - bounds.top;
      mouseRef.current.active = true;
    };
    const onLeave = () => { mouseRef.current.active = false; };
    node.addEventListener('mousemove', onMove);
    node.addEventListener('mouseleave', onLeave);
    return () => {
      node.removeEventListener('mousemove', onMove);
      node.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden w-screen h-screen ${className || ''}`}
      style={{ background, zIndex }}
    >
      <div
        ref={particlesRef}
        className="absolute inset-0 w-full h-full z-0"
        style={{ filter: enableGoo ? `url(#${gooIdRef.current})` : undefined }}
      />

      <div className="absolute inset-0 flex items-center justify-center z-10 w-full h-full">
        {children}
      </div>

      {enableGoo && (
        <svg className="absolute w-0 h-0 z-0">
          <defs>
            <filter id={gooIdRef.current}>
              <feGaussianBlur in="SourceGraphic" result="blur" stdDeviation={blurStrength} />
              <feColorMatrix in="blur" result="colormatrix" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 21 -9" />
              <feBlend in="SourceGraphic" in2="colormatrix" />
            </filter>
          </defs>
        </svg>
      )}
    </div>
  );
}


