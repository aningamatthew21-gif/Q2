import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * ParticleField — drifting biometric motes around the scanner.
 *
 * Visual story: the room appears to have a fine dust of light particles
 * floating against the dark blue wall, picking up the scanner's glow.
 * On `otp_requested` / `otp_pending` they intensify (size + opacity)
 * and converge slightly toward the scanner; on `otp_failed` they scatter
 * outward; on `otp_success` they cluster + brighten green.
 *
 * Implementation: a single THREE.Points mesh with a Float32 position
 * buffer and a Float32 base-position buffer. Per frame we lerp positions
 * toward (basePos + stateOffset) so transitions are smooth across state
 * changes. ~600 particles is the sweet spot for visual density on
 * mid-range mobile GPUs.
 */
const COUNT = 600;

export default function ParticleField({ state = 'idle', center = [0, 0, 0] }) {
  const pointsRef = useRef();
  const matRef    = useRef();

  // ── Initial positions: clustered around the scanner with a soft
  //    Gaussian-ish falloff so density is highest near the centre and
  //    thins out toward the room edges.
  const { positions, basePositions, sizes } = useMemo(() => {
    const positions     = new Float32Array(COUNT * 3);
    const basePositions = new Float32Array(COUNT * 3);
    const sizes         = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      // Sample a point with bias toward the centre
      const r     = Math.pow(Math.random(), 1.35) * 4.5;
      const theta = Math.random() * Math.PI * 2;
      const phi   = (Math.random() - 0.5) * Math.PI * 0.45;
      const x = center[0] + r * Math.cos(theta) * Math.cos(phi);
      const y = center[1] + r * Math.sin(phi)   * 1.1;
      const z = center[2] + r * Math.sin(theta) * Math.cos(phi) * 0.4
                          + (Math.random() - 0.5) * 1.2;

      positions[i * 3]       = x;
      positions[i * 3 + 1]   = y;
      positions[i * 3 + 2]   = z;
      basePositions[i * 3]     = x;
      basePositions[i * 3 + 1] = y;
      basePositions[i * 3 + 2] = z;
      sizes[i] = 0.5 + Math.random() * 1.5;
    }
    return { positions, basePositions, sizes };
  }, [center]);

  // Per-frame: drift + state-driven motion.
  const phase = useRef(0);
  useFrame((_, dt) => {
    if (!pointsRef.current) return;
    phase.current += dt;

    const posAttr = pointsRef.current.geometry.attributes.position;
    const array   = posAttr.array;

    const t = phase.current;
    const converge = state === 'otp_requested' || state === 'otp_pending';
    const scatter  = state === 'otp_failed';

    const cx = center[0], cy = center[1], cz = center[2];
    for (let i = 0; i < COUNT; i++) {
      const bx = basePositions[i * 3];
      const by = basePositions[i * 3 + 1];
      const bz = basePositions[i * 3 + 2];

      // Slow ambient drift — sinusoidal so the field never looks static.
      let tx = bx + Math.sin(t * 0.6 + i * 0.13) * 0.08;
      let ty = by + Math.cos(t * 0.5 + i * 0.19) * 0.06;
      let tz = bz + Math.sin(t * 0.7 + i * 0.11) * 0.05;

      if (converge) {
        // Pull each particle slightly toward the scanner.
        const dx = cx - bx, dy = cy - by, dz = (cz + 0.3) - bz;
        const pull = 0.18 + Math.sin(t * 2 + i) * 0.06;
        tx += dx * pull;
        ty += dy * pull;
        tz += dz * pull;
      } else if (scatter) {
        // Explode outward briefly. Multiplier decays naturally as
        // state transitions back to idle/pending.
        const dx = bx - cx, dy = by - cy, dz = bz - (cz + 0.3);
        tx += dx * 0.25 + Math.sin(t * 12 + i) * 0.04;
        ty += dy * 0.25 + Math.cos(t * 14 + i) * 0.04;
        tz += dz * 0.25;
      }

      // Smooth lerp toward target — exponential easing.
      const a = Math.min(1, dt * 2.4);
      array[i * 3]     += (tx - array[i * 3])     * a;
      array[i * 3 + 1] += (ty - array[i * 3 + 1]) * a;
      array[i * 3 + 2] += (tz - array[i * 3 + 2]) * a;
    }
    posAttr.needsUpdate = true;

    // Material colour + opacity by state.
    if (matRef.current) {
      const target =
        state === 'otp_success' ? new THREE.Color('#66bb6a') :
        state === 'otp_failed'  ? new THREE.Color('#ef5350') :
                                  new THREE.Color('#9be1ff');
      matRef.current.color.lerp(target, Math.min(1, dt * 4));
      const targetOpacity =
        state === 'otp_requested' || state === 'otp_pending' ? 0.85 :
        state === 'otp_success' ? 0.95 :
        state === 'otp_failed'  ? 0.8  :
        0.5;
      matRef.current.opacity += (targetOpacity - matRef.current.opacity) * Math.min(1, dt * 5);
    }
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
          count={COUNT}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-size"
          args={[sizes, 1]}
          count={COUNT}
          itemSize={1}
        />
      </bufferGeometry>
      <pointsMaterial
        ref={matRef}
        size={0.025}
        color="#9be1ff"
        transparent
        opacity={0.5}
        sizeAttenuation
        depthWrite={false}
        toneMapped={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}
