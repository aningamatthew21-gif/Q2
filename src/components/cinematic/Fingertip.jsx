import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Fingertip — a partial finger (capsule + nail), not a full hand.
 *
 * Why partial: full hands are notoriously hard to model and any procedural
 * attempt looks like a sausage assembly. A fingertip emerging from off-frame
 * sidesteps the uncanny-valley problem entirely — the viewer's brain fills
 * in the rest the way it does in close-up product photography.
 *
 * Construction:
 *   - One capsule (cylinder + 2 hemispheres) for the finger pad.
 *   - One half-cylinder fingernail with a curved profile via geometry
 *     displacement (not just a flat plane).
 *   - Skin material uses MeshPhysicalMaterial with subsurface-approximating
 *     transmission + warm sheen for the under-skin blood undertone.
 *   - The finger enters from the right edge, oriented horizontally
 *     pointing left toward the scanner. Movement driven by parent.
 *
 * Props:
 *   state          — drives entry / approach / press animations
 *   scannerCenter  — world position of the scanner sensor pad
 *
 * The parent (Scene) positions this group via lerp; this component owns
 * the geometry + materials + idle micro-motion only.
 */

// Skin shader values tuned for "mid-tone, warm undertone, slight specular
// from natural skin oil". These read well under both blue and warm key lights.
const SKIN_COLOR        = '#d39a7c';
const SKIN_SUBSURFACE   = '#6e2a17';   // warm bloodish hint
const NAIL_COLOR        = '#f7d8c5';

export default function Fingertip({
  state = 'idle',
  visible = false,
  targetPosition = [0, 0, 0],
  className
}) {
  const groupRef       = useRef();
  const fingerMeshRef  = useRef();
  const tRef           = useRef(0);
  const positionRef    = useRef(new THREE.Vector3(4.5, -0.2, 1.4));   // off-screen right

  // ── Geometries (built once) ───────────────────────────────────────
  // CapsuleGeometry is three.js's built-in primitive — radius, length,
  // capSubdivisions, radialSubdivisions. Far smoother than the
  // cylinder-cone-sphere stack the prior attempt used.
  const fingerGeo = useMemo(() => {
    const g = new THREE.CapsuleGeometry(0.085, 0.95, 16, 32);
    // Rotate so the long axis is along X (pointing into the scanner).
    g.rotateZ(Math.PI / 2);
    // Taper toward the tip — narrower at the leftmost end.
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const taper = THREE.MathUtils.smoothstep(x, -0.5, -0.1);   // 0..1 across the tip
      const factor = 1 - taper * 0.18;                           // shrink up to 18%
      pos.setY(i, pos.getY(i) * factor);
      pos.setZ(i, pos.getZ(i) * factor);
    }
    g.computeVertexNormals();
    return g;
  }, []);

  // Curved fingernail: half-cylinder with a slight outward bow.
  const nailGeo = useMemo(() => {
    const g = new THREE.SphereGeometry(0.08, 24, 12, 0, Math.PI, 0, Math.PI / 2);
    g.scale(1.0, 1.0, 0.45);     // flatten the dome — nail-like profile
    g.rotateX(Math.PI / 2);
    return g;
  }, []);

  // ── Animation ─────────────────────────────────────────────────────
  // The scene-level motion controller drives `targetPosition` based on
  // the state. Here we only smooth-lerp toward that target plus add a
  // tiny breathing micro-tremor so the finger never looks frozen.
  useFrame((_, dt) => {
    if (!groupRef.current) return;
    tRef.current += dt;

    const tgt = positionRef.current;
    tgt.set(targetPosition[0], targetPosition[1], targetPosition[2]);

    // Smooth lerp toward target. Speed varies with state — fast for
    // approach, slow for idle drift.
    const speed =
      state === 'otp_requested' ? 2.4 :
      state === 'otp_failed'    ? 3.2 :
      state === 'idle'          ? 1.0 :
      1.6;
    groupRef.current.position.lerp(tgt, Math.min(1, dt * speed));

    // Subtle hover tremor — breathing micro-motion so the finger never
    // looks frozen between states.
    const tremor = Math.sin(tRef.current * 4.5) * 0.004
                 + Math.sin(tRef.current * 7.1) * 0.002;
    groupRef.current.position.y += tremor;

    // On failure, a one-shot horizontal recoil already handled by parent
    // via target position change. No special logic needed here.
  });

  if (!visible) return null;

  return (
    <group ref={groupRef} position={positionRef.current.toArray()}>
      {/* ── Finger pad (capsule, tapered toward tip) ── */}
      <mesh ref={fingerMeshRef} geometry={fingerGeo} castShadow receiveShadow>
        {/* MeshStandardMaterial — without an HDR env map the fancier
            PBR properties (transmission, sheen, clearcoat) just add
            cost without producing the look they imply. Standard skin
            tone reads well under our key + fill + hemisphere lighting. */}
        <meshStandardMaterial
          color={SKIN_COLOR}
          roughness={0.55}
          metalness={0.0}
          emissive={SKIN_SUBSURFACE}
          emissiveIntensity={0.08}
        />
      </mesh>

      {/* ── Fingernail (on top of the finger near the tip) ── */}
      <mesh geometry={nailGeo} position={[-0.42, 0.058, 0]} castShadow>
        <meshStandardMaterial
          color={NAIL_COLOR}
          roughness={0.22}
          metalness={0.1}
        />
      </mesh>
    </group>
  );
}

/**
 * Helpers exposed for the scene to choreograph finger positions.
 * Returned positions are world-space coordinates.
 */
export const FINGER_POSITIONS = {
  // Off-screen to the right (entry/exit).
  hidden:    [4.5, -0.2, 1.4],
  // Hovering near the scanner but not touching.
  ready:     [1.6, -0.05, 1.1],
  // Touching the sensor face. X aligned with scanner centre.
  pressing:  [0.55, -0.05, 0.48],
  // Recoil after failure — slight withdraw + small Y shift.
  recoil:    [1.0, 0.1, 0.9]
};
