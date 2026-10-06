// Procedural texture toolkit: tileable value noise, a height→normal converter and canvas helpers. Everything the
// realistic materials need (concrete, rock, brushed metal) is generated here at start, so nothing is downloaded.

import * as THREE from 'three';
import { makeRng } from '../core/Rng';

/** Tileable fractal value noise, 0..1, size×size. */
export function fbm(size: number, seed: number, octaves = 5, cells = 4, persistence = 0.5): Float32Array {
  const out = new Float32Array(size * size);
  const rnd = makeRng(seed);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = cells << o;
    const lat = new Float32Array(n * n);
    for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    const inv = n / size;
    for (let y = 0; y < size; y++) {
      const fy = y * inv, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
      const ya = (y0 % n) * n, yb = ((y0 + 1) % n) * n;
      for (let x = 0; x < size; x++) {
        const fx = x * inv, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
        const xa = x0 % n, xb = (x0 + 1) % n;
        const a = lat[ya + xa] + (lat[ya + xb] - lat[ya + xa]) * sx;
        const b = lat[yb + xa] + (lat[yb + xb] - lat[yb + xa]) * sx;
        out[y * size + x] += (a + (b - a) * sy) * amp;
      }
    }
    total += amp;
    amp *= persistence;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/** Anisotropic noise: stretched along x, for brushed metal. */
export function streaks(size: number, seed: number, cellsX = 3, cellsY = 90): Float32Array {
  const out = new Float32Array(size * size);
  const rnd = makeRng(seed);
  const nx = cellsX, ny = cellsY;
  const lat = new Float32Array(nx * ny);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  for (let y = 0; y < size; y++) {
    const fy = (y * ny) / size, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < size; x++) {
      const fx = (x * nx) / size, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
      const a = lat[(y0 % ny) * nx + (x0 % nx)] + (lat[(y0 % ny) * nx + ((x0 + 1) % nx)] - lat[(y0 % ny) * nx + (x0 % nx)]) * sx;
      const b = lat[((y0 + 1) % ny) * nx + (x0 % nx)] + (lat[((y0 + 1) % ny) * nx + ((x0 + 1) % nx)] - lat[((y0 + 1) % ny) * nx + (x0 % nx)]) * sx;
      out[y * size + x] = a + (b - a) * sy;
    }
  }
  return out;
}

export function grayCanvas(h: Float32Array, size: number, lo = 0, hi = 255): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  for (let i = 0; i < h.length; i++) {
    const v = lo + (hi - lo) * Math.max(0, Math.min(1, h[i]));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Luminance of a canvas as 0..1 floats. */
export function heightOf(c: HTMLCanvasElement): Float32Array {
  const g = c.getContext('2d')!;
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const h = new Float32Array(c.width * c.height);
  for (let i = 0; i < h.length; i++) h[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) / 255;
  return h;
}

/** Height field → tangent-space normal map (Sobel, wrapping at the edges). */
export function normalCanvas(h: Float32Array, size: number, strength = 3): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  const at = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -dx * strength, ny = dy * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * size + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255; img.data[i + 1] = (ny * 0.5 + 0.5) * 255; img.data[i + 2] = (nz * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function tex(c: HTMLCanvasElement, opts: { srgb?: boolean; repeat?: number; aniso?: number } = {}): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (opts.srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(opts.repeat, opts.repeat); }
  t.anisotropy = opts.aniso ?? 8;
  return t;
}

// ------------------------------------------------------------------- brushed metal for the blades (tiny, shared)
let metalSet: { bump: THREE.CanvasTexture; rough: THREE.CanvasTexture } | null = null;
export function brushedMetal(): { bump: THREE.CanvasTexture; rough: THREE.CanvasTexture } {
  if (metalSet) return metalSet;
  const S = 256;
  const a = streaks(S, 5, 2, 70), b = fbm(S, 9, 4, 6);
  const h = new Float32Array(S * S);
  const rnd = makeRng(21);
  for (let i = 0; i < h.length; i++) h[i] = a[i] * 0.55 + b[i] * 0.45;
  // fine scratches
  for (let k = 0; k < 120; k++) {
    let x = rnd() * S, y = rnd() * S; const len = 8 + rnd() * 40, ang = (rnd() - 0.5) * 0.5;
    for (let s = 0; s < len; s++) { const ix = Math.floor(x) % S, iy = Math.floor(y) % S; h[iy * S + ix] = Math.min(1, h[iy * S + ix] + 0.35); x += Math.cos(ang); y += Math.sin(ang); }
  }
  const bump = tex(grayCanvas(h, S), { repeat: 1.2 });
  const rough = tex(grayCanvas(h.map((v) => 0.3 + v * 0.45), S), { repeat: 1.2 });
  metalSet = { bump, rough };
  return metalSet;
}
