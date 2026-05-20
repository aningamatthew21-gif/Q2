import React, { useRef, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import Scanner from './Scanner';

/**
 * Scene — studio shot of the biometric scanner on a clean white backdrop.
 *
 * Layout (2026-05-13 revision — "one integrated device"):
 *   - No hand, no fingertip — removed entirely.
 *   - White right-side backdrop (set in LoginCinematic.jsx) contrasts the
 *     brand-blue left panel.
 *   - Scanner is the hero: a taller kiosk body with MIDSA wordmark on
 *     top, the HTML login card overlaying its mid display zone, and a
 *     recessed glowing fingerprint sensor at the bottom.
 *   - A subtle reflective floor plane + ContactShadows give the scanner
 *     real weight on the white surface — fixes the "flat / pasted on"
 *     look.
 *   - Camera pulled back to 6.2 so the taller scanner body fits the
 *     frame with breathing room.
 *
 * Lighting: key (warm, upper-right, only shadow caster) + cool fill
 * (upper-left) + warm rim (lower-right) + hemisphere + faint ambient.
 * No HDR env map (avoids the suspending-CDN crash from earlier).
 */
export default function Scene({ state = 'idle' }) {
  return (
    <Canvas
      /* Canvas fills its wrapper at 100% — the wrapper (in
         LoginCinematic.jsx) does the `absolute inset-0` positioning.
         Putting `absolute inset-0` on the Canvas itself made R3F's
         resize-observer measure 0 on first paint and the canvas got
         stuck at its 300×150 default. Filling a normally-positioned
         parent is the canonical R3F sizing pattern. */
      style={{ width: '100%', height: '100%', display: 'block', background: 'transparent' }}
      resize={{ scroll: false, debounce: { scroll: 0, resize: 0 } }}
      camera={{ position: [0, 0.05, 6.2], fov: 30, near: 0.1, far: 40 }}
      gl={{
        antialias: true,
        alpha: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.05
      }}
      shadows
      dpr={[1, 2]}
      onCreated={({ scene }) => {
        console.log('[LoginCinematic] Canvas created. WebGL OK.');
        scene.background = null;
      }}
    >
      {/* ── Key light: bright warm, upper-right; the only shadow caster. */}
      <directionalLight
        position={[3.5, 4.5, 4]}
        intensity={1.9}
        color="#fffaf0"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0005}
      >
        <orthographicCamera attach="shadow-camera" args={[-3.5, 3.5, 3.5, -3.5, 0.1, 14]} />
      </directionalLight>

      {/* ── Cool fill from upper-left — cleans the body's left edge. */}
      <pointLight position={[-3.2, 2.8, 3]} intensity={0.85} color="#e6efff" distance={10} />

      {/* ── Warm rim from below-right — soft warmth on the lower body. */}
      <pointLight position={[2.6, -1.6, 2.2]} intensity={0.55} color="#fff1d8" distance={8} />

      {/* ── Hemisphere ambient — sky from above, soft slate from below. */}
      <hemisphereLight intensity={0.6} color="#ffffff" groundColor="#dfe4ee" />

      {/* ── Faint ambient floor — nothing reads pitch-black. */}
      <ambientLight intensity={0.3} color="#ffffff" />

      {/* ── Reflective studio floor — a near-white plane below the scanner.
              It catches the scanner's silhouette as a soft reflection,
              which is what "grounds" the device and kills the flat look.
              Kept very subtle so it still reads as a clean white studio. */}
      <Floor />

      {/* ── Soft contact shadow right under the scanner base. */}
      <ContactShadows
        position={[0, -1.62, 0]}
        opacity={0.38}
        scale={6.5}
        blur={2.8}
        far={3}
        color="#0c1730"
      />

      {/* ── Scanner: the hero. Taller body (2.6 units). At this scale +
              camera distance it occupies ~70% of the frame height with
              white margin top and bottom. */}
      <group scale={1.0} position={[0, -0.05, 0]}>
        <Scanner state={state} position={[0, 0, 0]} />
      </group>

      <SceneCamera />
    </Canvas>
  );
}

/**
 * Floor — a large soft-white plane laid flat beneath the scanner. Slight
 * metalness + low roughness make it pick up a faint, blurred reflection
 * of the scanner so the device feels seated on a real surface. The plane
 * is angled flat (rotated -90° on X) and positioned just below the
 * scanner's base.
 */
function Floor() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.62, 0]} receiveShadow>
      <planeGeometry args={[40, 40]} />
      <meshStandardMaterial
        color="#f4f6fa"
        roughness={0.55}
        metalness={0.15}
        envMapIntensity={0.4}
      />
    </mesh>
  );
}

/**
 * SceneCamera — tiny mouse-driven parallax so the shot isn't dead-static.
 * Movement is capped hard so the scanner's display zone stays under the
 * absolute-positioned HTML login card regardless of pointer position.
 */
function SceneCamera() {
  const { camera, mouse } = useThree();
  const base = useRef(new THREE.Vector3(0, 0.05, 6.2));
  useFrame((_, dt) => {
    const tx = base.current.x + mouse.x * 0.05;
    const ty = base.current.y + mouse.y * 0.035;
    camera.position.x += (tx - camera.position.x) * Math.min(1, dt * 2.5);
    camera.position.y += (ty - camera.position.y) * Math.min(1, dt * 2.5);
    camera.lookAt(0, -0.05, 0);
  });
  return null;
}
