// Cel-shaded look: a 3-step toon gradient plus an inverted-hull outline gives bold silhouettes with
// almost no geometry. Everything is flat colour; there are no textures except two tiny generated ones.

import * as THREE from 'three';

let gradient: THREE.DataTexture | null = null;
export function toonGradient(): THREE.DataTexture {
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array([88, 168, 255]), 3, 1, THREE.RedFormat);
    gradient.minFilter = THREE.NearestFilter;
    gradient.magFilter = THREE.NearestFilter;
    gradient.needsUpdate = true;
  }
  return gradient;
}

const toonCache = new Map<string, THREE.MeshToonMaterial>();
export function toon(color: string | number, emissive?: string | number, emissiveIntensity = 0.55): THREE.MeshToonMaterial {
  const key = `${color}|${emissive ?? ''}|${emissiveIntensity}`;
  let m = toonCache.get(key);
  if (!m) {
    m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });
    if (emissive !== undefined) { m.emissive = new THREE.Color(emissive); m.emissiveIntensity = emissiveIntensity; }
    toonCache.set(key, m);
  }
  return m;
}

const basicCache = new Map<string, THREE.MeshBasicMaterial>();
export function glow(color: string | number, opacity = 1): THREE.MeshBasicMaterial {
  const key = `${color}|${opacity}`;
  let m = basicCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
    basicCache.set(key, m);
  }
  return m;
}

let outlineMat: THREE.MeshBasicMaterial | null = null;
export function outline(): THREE.MeshBasicMaterial {
  return (outlineMat ??= new THREE.MeshBasicMaterial({ color: 0x070a16, side: THREE.BackSide }));
}

/** Add an inverted-hull outline to `mesh` (a slightly larger back-faced copy). */
export function addOutline(mesh: THREE.Mesh, thickness = 0.05): THREE.Mesh {
  const o = new THREE.Mesh(mesh.geometry, outline());
  o.scale.setScalar(1 + thickness);
  o.renderOrder = -1;
  mesh.add(o);
  return mesh;
}

let blobTex: THREE.CanvasTexture | null = null;
/** Soft round shadow blob (generated once). */
export function blobTexture(): THREE.CanvasTexture {
  if (!blobTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const r = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    r.addColorStop(0, 'rgba(0,0,0,0.55)');
    r.addColorStop(0.6, 'rgba(0,0,0,0.25)');
    r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    blobTex = new THREE.CanvasTexture(c);
  }
  return blobTex;
}

export function disposeMaterials(): void {
  toonCache.forEach((m) => m.dispose());
  basicCache.forEach((m) => m.dispose());
  toonCache.clear(); basicCache.clear();
}

// ------------------------------------------------------------------------------- v2: faceted PBR + glow
/** Flat-shaded standard material: crisp facets, glossy highlights from the environment. */
export function facet(color: string | number, o: { metal?: number; rough?: number; env?: number; emissive?: string | number; glowK?: number; opacity?: number } = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color, metalness: o.metal ?? 0.35, roughness: o.rough ?? 0.38, flatShading: true, envMapIntensity: o.env ?? 0.75,
  });
  if (o.emissive !== undefined) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = o.glowK ?? 1; }
  if (o.opacity !== undefined && o.opacity < 1) { m.transparent = true; m.opacity = o.opacity; }
  return m;
}

/** Unlit HDR colour: values above 1 are what the bloom pass picks up. */
export function hdr(color: string | number, k = 2.4): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ toneMapped: false });
  m.color.set(color).multiplyScalar(k);
  return m;
}
