import React, { useMemo } from 'react';
import * as THREE from 'three';

/**
 * Wall — the surface behind the scanner.
 *
 * Brand-blue, with a procedurally generated normal map to give it real
 * surface texture (very subtle micro-roughness — without this it reads
 * as flat plastic). The normal map is drawn into an offscreen canvas
 * with Perlin-ish noise then promoted to a THREE.CanvasTexture.
 *
 * Rendered as a very large plane to fill the camera frustum at the
 * scene's far plane. Receives shadows so the scanner casts a soft
 * presence onto the wall — critical for selling the "mounted on wall"
 * illusion.
 */
export default function Wall({ position = [0, 0, -2] }) {
  // Procedural normal map: low-amplitude noise driven by sine waves.
  // Gives the wall surface micro-roughness that reflects the HDR env
  // subtly differently across the plane.
  const normalMap = useMemo(() => {
    const size = 512;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        // Low-frequency noise mixed with high-frequency speckle.
        const n =
          Math.sin(x * 0.04) * 0.18 +
          Math.cos(y * 0.05) * 0.18 +
          (Math.random() - 0.5) * 0.05;
        // Encode as tangent-space normal: x,y in -1..1 mapped to 0..255.
        img.data[i]     = 128 + Math.floor(n * 60);             // X
        img.data[i + 1] = 128 + Math.floor(n * 60);             // Y
        img.data[i + 2] = 255;                                  // Z (mostly up)
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(4, 4);
    return t;
  }, []);

  return (
    <group>
      {/* Main wall plane — wide enough to fill the frustum at z = -2.
          Color bumped up since there's no HDR env map any more; we
          need the wall to be visibly blue from direct lighting alone. */}
      <mesh position={position} receiveShadow>
        <planeGeometry args={[24, 14]} />
        <meshStandardMaterial
          color="#155497"
          roughness={0.72}
          metalness={0.05}
          normalMap={normalMap}
          normalScale={new THREE.Vector2(0.35, 0.35)}
          emissive="#0a2552"
          emissiveIntensity={0.45}
        />
      </mesh>

      {/* Subtle vignette glow ring around the scanner mounting area —
          a soft second plane with a radial gradient texture that makes
          the wall feel lit by the scanner, not the room's only source. */}
      <mesh position={[position[0], position[1], position[2] + 0.05]}>
        <circleGeometry args={[3.2, 64]} />
        <meshBasicMaterial
          color="#1565c0"
          transparent
          opacity={0.18}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}
