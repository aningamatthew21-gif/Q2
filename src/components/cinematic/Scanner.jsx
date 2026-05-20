import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Scanner — biometric reader styled as a real Suprema kiosk.
 *
 * Redesigned (2026-05-13) to read as ONE integrated device with three
 * visual zones stacked top → bottom:
 *
 *   ┌──────────────────────────┐  ← Top: MIDSA wordmark on the face plate
 *   │      MIDSA               │     (above the login card, visible)
 *   ├──────────────────────────┤
 *   │                          │  ← Middle: display area where the HTML
 *   │   [ login card sits ]    │     login card lives (overlay from
 *   │                          │     LoginCinematic.jsx, positioned to
 *   ├──────────────────────────┤     line up with this zone)
 *   │   ░░░ fingerprint ░░░    │  ← Bottom: recessed hollow fingerprint
 *   │       sensor pad          │     sensor — the LIVE status indicator.
 *   └──────────────────────────┘     Glows blue (idle), brighter blue
 *                                    (typing), flickering (searching),
 *                                    green (success), red (failure).
 *
 * Key changes from previous version:
 *   - Body is taller (1.2 × 2.6, was 1.2 × 2.0) to fit all three zones.
 *   - Sensor pad moved to lower portion (y = -0.85) and made wider
 *     + shorter so it reads as a proper fingerprint shape.
 *   - Sensor is HOLLOWED OUT: a recessed inset with darker interior +
 *     painted fingerprint pattern + inner rim glow — looks like a real
 *     opening you'd press a finger against.
 *   - Removed the standalone status LED dot — the sensor IS the
 *     status indicator now.
 *   - State-driven flicker animation during otp_pending so the user
 *     SEES the system searching.
 *
 * Props:
 *   state — 'idle' | 'email_focused' | 'otp_requested' | 'otp_pending'
 *           | 'otp_failed' | 'otp_success'. Drives sensor colour + intensity.
 */

// State → sensor colour palette. Linear-space hex.
const STATE_TINT = {
  idle:           { core: '#1976d2', glow: '#42a5f5', intensity: 1.8, flicker: 0    },
  email_focused:  { core: '#1e88e5', glow: '#64b5f6', intensity: 2.8, flicker: 0    },
  otp_requested:  { core: '#1e88e5', glow: '#90caf9', intensity: 3.4, flicker: 0.7  },
  otp_pending:    { core: '#1e88e5', glow: '#90caf9', intensity: 3.4, flicker: 0.8  },
  otp_failed:     { core: '#c62828', glow: '#ef5350', intensity: 4.5, flicker: 0    },
  otp_success:    { core: '#2e7d32', glow: '#66bb6a', intensity: 4.5, flicker: 0    }
};

// Rounded-rectangle 2D shape for extrusion.
function makeRoundedRectShape(w, h, r) {
  const x = -w / 2, y = -h / 2;
  const s = new THREE.Shape();
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

// Paint a clear, recognisable fingerprint on a 512×512 canvas.
//
// This is used as BOTH the emissive map (white ridges glow in the state
// colour) and the alpha map (black areas are transparent) on a flat
// plane — so the result reads unmistakably as a fingerprint, not a
// "blue dot". The pattern is a stylised loop/whorl: a stack of nested
// arcs whose openings rotate progressively, plus a curved "core" — the
// way real fingerprint ridges flow around a central loop.
//
// 512px (was 256) + thick 7px ridges keeps it crisp at the size it's
// displayed. Drawn deterministically (no Math.random) so it's stable.
function createFingerprintTexture() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');

  // Transparent background so the alpha map cuts the plane to just the
  // fingerprint shape.
  ctx.clearRect(0, 0, size, size);

  ctx.strokeStyle = '#ffffff';
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';

  const cx = size / 2;
  const cy = size / 2;

  // ── Outer ridge field: ~13 nested arcs, each with a gap (a real
  //    fingerprint ridge is an open curve, not a closed ring). The gap
  //    angle rotates a little per ring so the openings spiral, which is
  //    what gives the "ridge flow" look. ──
  for (let i = 0; i < 13; i++) {
    const r = 22 + i * 17;
    ctx.lineWidth = 7;
    ctx.beginPath();
    const gapStart = 1.15 + i * 0.13;          // rotating gap
    const sweep    = Math.PI * 1.78;            // not a full circle
    ctx.arc(cx, cy + i * 1.5, r, gapStart, gapStart + sweep);
    ctx.stroke();
  }

  // ── Core: two curved ridges forming the central "loop" of the print. ──
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(cx - 26, cy + 34);
  ctx.bezierCurveTo(cx - 30, cy - 18, cx + 30, cy - 18, cx + 24, cy + 30);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx - 14, cy + 30);
  ctx.bezierCurveTo(cx - 16, cy - 4, cx + 16, cy - 4, cx + 12, cy + 26);
  ctx.stroke();

  // ── Lower "delta" ridges — short strokes flowing off the bottom-left,
  //    a recognisable fingerprint feature. ──
  ctx.lineWidth = 6;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(cx - 70 - i * 14, cy + 90 + i * 10);
    ctx.quadraticCurveTo(cx - 30, cy + 120 + i * 8, cx + 20 + i * 12, cy + 150);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export default function Scanner({ state = 'idle', position = [0, 0, 0] }) {
  const groupRef        = useRef();
  const ledRingRef      = useRef();
  const sensorInnerRef  = useRef();
  const sensorRimRef    = useRef();
  const haloRef         = useRef();
  const tStartRef       = useRef(0);
  const prevStateRef    = useRef(state);
  const flickerSeedRef  = useRef(0);

  // ── Geometries (memoised — built once) ──────────────────────────
  const bodyGeo = useMemo(() => {
    // Taller body to accommodate top wordmark, card area, AND sensor.
    const shape = makeRoundedRectShape(1.2, 2.6, 0.14);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: 0.36,
      bevelEnabled: true,
      bevelSize: 0.025,
      bevelThickness: 0.025,
      bevelSegments: 5,
      curveSegments: 18
    });
    g.computeVertexNormals();
    return g;
  }, []);

  const faceGeo = useMemo(() => {
    const shape = makeRoundedRectShape(1.05, 2.44, 0.10);
    return new THREE.ExtrudeGeometry(shape, {
      depth: 0.02,
      bevelEnabled: true,
      bevelSize: 0.006,
      bevelThickness: 0.006,
      bevelSegments: 3,
      curveSegments: 16
    });
  }, []);

  // Outer sensor rim (the chrome ring around the recessed area).
  const sensorRimGeo = useMemo(() => {
    const shape = makeRoundedRectShape(0.72, 0.62, 0.18);
    const hole  = new THREE.Path();
    const w = 0.66, h = 0.56, r = 0.16;
    const x = -w / 2, y = -h / 2;
    hole.moveTo(x + r, y);
    hole.lineTo(x + w - r, y);
    hole.quadraticCurveTo(x + w, y, x + w, y + r);
    hole.lineTo(x + w, y + h - r);
    hole.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    hole.lineTo(x + r, y + h);
    hole.quadraticCurveTo(x, y + h, x, y + h - r);
    hole.lineTo(x, y + r);
    hole.quadraticCurveTo(x, y, x + r, y);
    shape.holes.push(hole);
    return new THREE.ExtrudeGeometry(shape, {
      depth: 0.03,
      bevelEnabled: true,
      bevelSize: 0.005,
      bevelThickness: 0.005,
      bevelSegments: 4,
      curveSegments: 16
    });
  }, []);

  // (The old `sensorWellGeo` ExtrudeGeometry was removed — the
  // fingerprint now lives on a flat plane with clean UVs, see the JSX.)

  const fingerprintTex = useMemo(() => createFingerprintTexture(), []);

  // ── Per-frame animation ────────────────────────────────────────
  useFrame((_, dt) => {
    const tint = STATE_TINT[state] || STATE_TINT.idle;
    const time = (tStartRef.current += dt);

    if (prevStateRef.current !== state) {
      prevStateRef.current = state;
      tStartRef.current = 0;
    }

    // Compute flicker for searching/scanning states. Random-walk seed
    // updated 12× per second gives a believable "system thinking" feel.
    let flickerMul = 1;
    if (tint.flicker > 0) {
      flickerSeedRef.current += dt * 12;
      const seed = Math.floor(flickerSeedRef.current);
      const r = pseudoRandom(seed);
      flickerMul = 1 + (r - 0.5) * 2 * tint.flicker;
    }

    // LED ring around the sensor.
    if (ledRingRef.current) {
      const m = ledRingRef.current.material;
      const breath = 0.85 + Math.sin(time * 2.4) * 0.15;
      m.color.set(tint.glow);
      m.emissive.set(tint.glow);
      m.emissiveIntensity = tint.intensity * breath * flickerMul;
    }

    // Fingerprint — the painted ridges glow in the state colour.
    // Brightened (0.9× the state intensity, was 0.55×) so the ridges
    // read clearly as a fingerprint shape, not a dim blob. The flicker
    // multiplier makes it stutter during the "searching" states.
    if (sensorInnerRef.current) {
      const m = sensorInnerRef.current.material;
      m.emissive.set(tint.glow);
      m.emissiveIntensity = (tint.intensity * 0.9) * flickerMul;
    }

    // Chrome rim around the sensor (subtle response to state).
    if (sensorRimRef.current) {
      const m = sensorRimRef.current.material;
      // Rim picks up the sensor colour very subtly.
      const targetEmissiveIntensity = 0.05 + (tint.intensity * 0.08);
      m.emissive.set(tint.glow);
      m.emissiveIntensity = targetEmissiveIntensity;
    }

    // Halo light follows the same palette.
    if (haloRef.current) {
      haloRef.current.color.set(tint.glow);
      haloRef.current.intensity = tint.intensity * 1.2 * flickerMul;
    }
  });

  return (
    <group ref={groupRef} position={position}>
      {/* ── Mount plate (back-mount against the surface) ── */}
      <mesh position={[0, 0, -0.02]} castShadow receiveShadow>
        <boxGeometry args={[1.35, 2.75, 0.04]} />
        <meshStandardMaterial color="#1a1d22" roughness={0.85} metalness={0.4} />
      </mesh>

      {/* ── Body (extruded rounded rectangle, brushed metal) ── */}
      <mesh geometry={bodyGeo} castShadow receiveShadow>
        <meshStandardMaterial
          color="#0f1218"
          roughness={0.4}
          metalness={0.6}
          emissive="#080d18"
          emissiveIntensity={0.2}
        />
      </mesh>

      {/* ── Inner face plate (recessed, very dark glossy surface) ── */}
      <mesh geometry={faceGeo} position={[0, 0, 0.36]} castShadow>
        <meshStandardMaterial
          color="#070b13"
          roughness={0.2}
          metalness={0.75}
        />
      </mesh>

      {/* ── MIDSA wordmark at the TOP of the face plate ── */}
      <BrandLabel position={[0, 1.05, 0.39]} />

      {/* ── Hairline LED status bar across the top — picks up state colour. */}
      <mesh ref={ledRingRef} position={[0, 0.78, 0.395]}>
        <planeGeometry args={[0.55, 0.012]} />
        <meshStandardMaterial
          color="#42a5f5"
          emissive="#42a5f5"
          emissiveIntensity={2.0}
          toneMapped={false}
        />
      </mesh>

      {/* ── FINGERPRINT SENSOR ZONE (bottom of scanner) ─────────── */}
      {/* Sits clearly below the HTML card overlay. Layer order, back→front:
            1. chrome rim (the bezel of the recessed opening)
            2. dark well backdrop (depth — pushed back)
            3. THE FINGERPRINT — a clean plane carrying the painted
               fingerprint as both alphaMap (cuts the plane to the print
               shape) and emissiveMap (the ridges glow in the state
               colour). This is the load-bearing element: a real
               fingerprint, not a dot.
          The stray white "touch-point ring" that previously read as a
          blue dot has been removed. */}
      <group position={[0, -0.85, 0.36]}>
        {/* Chrome rim around the recessed opening */}
        <mesh ref={sensorRimRef} geometry={sensorRimGeo} castShadow>
          <meshStandardMaterial
            color="#3a4456"
            roughness={0.35}
            metalness={0.85}
            emissive="#42a5f5"
            emissiveIntensity={0.1}
          />
        </mesh>

        {/* Dark recessed well — pushed back so the opening looks hollow. */}
        <mesh position={[0, 0, -0.04]} receiveShadow>
          <planeGeometry args={[0.66, 0.56]} />
          <meshStandardMaterial color="#02060d" roughness={1} metalness={0} />
        </mesh>

        {/* THE FINGERPRINT — painted ridges on a flat plane.
            • alphaMap   → only the ridges are visible (rest transparent)
            • emissiveMap→ the ridges glow; emissive colour is set per
                            state in useFrame (blue / green / red)
            • plane geometry → clean UVs, so the texture maps perfectly
              (the previous ExtrudeGeometry mangled the UVs, which is
               why it read as a featureless glowing blob). */}
        <mesh ref={sensorInnerRef} position={[0, 0, 0.005]}>
          <planeGeometry args={[0.5, 0.5]} />
          <meshStandardMaterial
            color="#000000"
            transparent
            alphaMap={fingerprintTex}
            emissiveMap={fingerprintTex}
            emissive="#42a5f5"
            emissiveIntensity={2.4}
            roughness={0.6}
            metalness={0}
            toneMapped={false}
          />
        </mesh>
      </group>

      {/* ── Halo point light driven by state palette ── */}
      <pointLight
        ref={haloRef}
        color="#42a5f5"
        intensity={2.0}
        distance={4.5}
        decay={1.6}
        position={[0, -0.85, 0.6]}
      />
    </group>
  );
}

/** MIDSA wordmark texture painted on the face plate. */
function BrandLabel({ position }) {
  const texture = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 128;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 512, 128);
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.font = 'bold 86px Inter, "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('MIDSA', 256, 56);
    ctx.font = '600 22px Inter, "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText('IDENTITY SYSTEMS', 256, 104);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, []);
  return (
    <mesh position={position}>
      <planeGeometry args={[0.92, 0.23]} />
      <meshBasicMaterial map={texture} transparent toneMapped={false} />
    </mesh>
  );
}

// Deterministic pseudo-random for the flicker animation — same seed
// produces same value, but we step the seed each frame to produce a
// natural-looking flicker without using Math.random (which would
// cause re-renders / non-reproducible behaviour).
function pseudoRandom(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
