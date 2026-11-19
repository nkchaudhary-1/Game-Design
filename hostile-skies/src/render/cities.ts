// The three cities. Each is one merged mesh of procedural towers with lit windows, a dark urban footprint on the
// ground, and a pale beacon so the pilot can find home from anywhere in the arena. Damage dims the lights, starts fires,
// and finally flattens the skyline.

import {
  BufferGeometry, CanvasTexture, CircleGeometry, Color, Float32BufferAttribute,
  Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, Vector3,
} from 'three';
import { CITY_SITES, terrainHeight, type CitySite } from '../sim/terrain';
import { makeRng } from '../sim/util';
import type { City } from '../sim/world';
import type { Effects } from './effects';

const FLOOR_H = 3.6;
const TILE_W = 32;
const TILE_H = 28.8; // eight floors

function facadeTextures(): { map: CanvasTexture; glow: CanvasTexture } {
  const S = 256, cols = 8, rows = 8;
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return c; };
  const a = mk(), e = mk();
  const ga = a.getContext('2d')!, ge = e.getContext('2d')!;
  ga.fillStyle = '#c4bdb0'; ga.fillRect(0, 0, S, S);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, S, S);
  const rng = makeRng(21);
  const cw = S / cols, ch = S / rows;
  for (let r = 0; r < rows; r++) {
    // floor slab line
    ga.fillStyle = 'rgba(70,66,62,0.55)'; ga.fillRect(0, r * ch + ch * 0.9, S, ch * 0.1);
    for (let c = 0; c < cols; c++) {
      const x = c * cw + cw * 0.24, y = r * ch + ch * 0.24, w = cw * 0.52, h = ch * 0.5;
      const gr = ga.createLinearGradient(0, y, 0, y + h);
      gr.addColorStop(0, '#5d7690'); gr.addColorStop(1, '#2a384a');
      ga.fillStyle = gr; ga.fillRect(x, y, w, h);
      ga.fillStyle = 'rgba(255,255,255,0.10)'; ga.fillRect(x, y, w, h * 0.12);
      if (rng() < 0.5) {
        const k = rng();
        const col = k < 0.62 ? '#ffd58a' : k < 0.85 ? '#ffe9c2' : '#9fd8ff';
        ge.fillStyle = col; ge.fillRect(x, y, w, h);
      }
    }
  }
  // a dark patch in the corner for roofs to sample
  ga.fillStyle = '#6f6d69'; ga.fillRect(0, 0, 6, 6);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, 6, 6);
  const map = new CanvasTexture(a), glow = new CanvasTexture(e);
  for (const t of [map, glow]) { t.wrapS = t.wrapT = RepeatWrapping; t.colorSpace = SRGBColorSpace; t.anisotropy = 4; }
  return { map, glow };
}

/** Soft-edged dark disc under each city: reads as paving and lights, and blends into the terrain. */
function padTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 8, 64, 64, 64);
  gr.addColorStop(0, 'rgba(74,72,68,0.95)');
  gr.addColorStop(0.78, 'rgba(78,76,70,0.8)');
  gr.addColorStop(1, 'rgba(78,76,70,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function buildCity(site: CitySite): { geo: BufferGeometry; count: number } {
  const rng = makeRng(1000 + site.id * 77);
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  let vi = 0;
  const quad = (p: number[][], n: number[], uvs: number[][], c: number[]) => {
    for (let k = 0; k < 4; k++) { pos.push(...p[k]!); nor.push(...n); uv.push(...uvs[k]!); col.push(...c); }
    idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
    vi += 4;
  };
  const o = (x: number, y: number, z: number): number[] => [x, y - site.level, z];
  const R0 = 0.012; // uv inside the dark corner of the facade texture: no windows, no emission
  const flat = (x0: number, z0: number, x1: number, z1: number, y: number, c: number[]) =>
    quad([o(x0, y, z1), o(x1, y, z1), o(x1, y, z0), o(x0, y, z0)], [0, 1, 0], [[R0, R0], [R0, R0], [R0, R0], [R0, R0]], c);

  /** A windowed block with a flat roof (optionally with a rooftop box). */
  const block = (cx: number, cz: number, w: number, dp: number, y0: number, H: number, c: number[], roof: number[], plant = false) => {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - dp / 2, z1 = cz + dp / 2, yt = y0 + H;
    const uw = w / TILE_W, ud = dp / TILE_W, vh = H / TILE_H;
    quad([o(x0, y0, z1), o(x1, y0, z1), o(x1, yt, z1), o(x0, yt, z1)], [0, 0, 1], [[0, 0], [uw, 0], [uw, vh], [0, vh]], c);
    quad([o(x1, y0, z0), o(x0, y0, z0), o(x0, yt, z0), o(x1, yt, z0)], [0, 0, -1], [[0, 0], [uw, 0], [uw, vh], [0, vh]], c);
    quad([o(x1, y0, z1), o(x1, y0, z0), o(x1, yt, z0), o(x1, yt, z1)], [1, 0, 0], [[0, 0], [ud, 0], [ud, vh], [0, vh]], c);
    quad([o(x0, y0, z0), o(x0, y0, z1), o(x0, yt, z1), o(x0, yt, z0)], [-1, 0, 0], [[0, 0], [ud, 0], [ud, vh], [0, vh]], c);
    flat(x0, z0, x1, z1, yt, roof);
    if (plant) { // rooftop plant room
      const pw = w * 0.32, pd = dp * 0.3, ph = 4.5;
      const qx0 = cx - pw / 2 + w * 0.1, qx1 = cx + pw / 2 + w * 0.1, qz0 = cz - pd / 2, qz1 = cz + pd / 2;
      quad([o(qx0, yt, qz1), o(qx1, yt, qz1), o(qx1, yt + ph, qz1), o(qx0, yt + ph, qz1)], [0, 0, 1], [[R0, R0], [R0, R0], [R0, R0], [R0, R0]], [0.5, 0.5, 0.5]);
      quad([o(qx1, yt, qz0), o(qx0, yt, qz0), o(qx0, yt + ph, qz0), o(qx1, yt + ph, qz0)], [0, 0, -1], [[R0, R0], [R0, R0], [R0, R0], [R0, R0]], [0.5, 0.5, 0.5]);
      quad([o(qx1, yt, qz1), o(qx1, yt, qz0), o(qx1, yt + ph, qz0), o(qx1, yt + ph, qz1)], [1, 0, 0], [[R0, R0], [R0, R0], [R0, R0], [R0, R0]], [0.45, 0.45, 0.45]);
      quad([o(qx0, yt, qz0), o(qx0, yt, qz1), o(qx0, yt + ph, qz1), o(qx0, yt + ph, qz0)], [-1, 0, 0], [[R0, R0], [R0, R0], [R0, R0], [R0, R0]], [0.45, 0.45, 0.45]);
      flat(qx0, qz0, qx1, qz1, yt + ph, [0.55, 0.55, 0.55]);
    }
  };

  /** A small house with a pitched roof (ridge along x). */
  const house = (cx: number, cz: number, w: number, dp: number, y0: number, c: number[], roof: number[]) => {
    const H = 6 + rng() * 2.5, rh = 3.2 + rng() * 1.2;
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - dp / 2, z1 = cz + dp / 2, yt = y0 + H, zm = cz, yr = yt + rh;
    const uw = w / TILE_W, ud = dp / TILE_W, vh = H / TILE_H;
    quad([o(x0, y0, z1), o(x1, y0, z1), o(x1, yt, z1), o(x0, yt, z1)], [0, 0, 1], [[0, 0], [uw, 0], [uw, vh], [0, vh]], c);
    quad([o(x1, y0, z0), o(x0, y0, z0), o(x0, yt, z0), o(x1, yt, z0)], [0, 0, -1], [[0, 0], [uw, 0], [uw, vh], [0, vh]], c);
    quad([o(x1, y0, z1), o(x1, y0, z0), o(x1, yt, z0), o(x1, yt, z1)], [1, 0, 0], [[0, 0], [ud, 0], [ud, vh], [0, vh]], c);
    quad([o(x0, y0, z0), o(x0, y0, z1), o(x0, yt, z1), o(x0, yt, z0)], [-1, 0, 0], [[0, 0], [ud, 0], [ud, vh], [0, vh]], c);
    const sl = Math.hypot(rh, dp / 2), nz = rh / sl, ny = (dp / 2) / sl;
    quad([o(x0, yt, z1), o(x1, yt, z1), o(x1, yr, zm), o(x0, yr, zm)], [0, ny, nz], [[R0, R0], [R0, R0], [R0, R0], [R0, R0]], roof);
    quad([o(x1, yt, z0), o(x0, yt, z0), o(x0, yr, zm), o(x1, yr, zm)], [0, ny, -nz], [[R0, R0], [R0, R0], [R0, R0], [R0, R0]], roof);
    // gable ends (triangles as degenerate quads)
    quad([o(x1, yt, z1), o(x1, yt, z0), o(x1, yr, zm), o(x1, yr, zm)], [1, 0, 0], [[0, 0], [ud, 0], [ud / 2, 0.2], [ud / 2, 0.2]], c);
    quad([o(x0, yt, z0), o(x0, yt, z1), o(x0, yr, zm), o(x0, yr, zm)], [-1, 0, 0], [[0, 0], [ud, 0], [ud / 2, 0.2], [ud / 2, 0.2]], c);
  };

  const cell = 54, R = site.radius;
  const lines = Math.ceil(R / cell);
  const asphalt = [0.075, 0.075, 0.08], lane = [0.5, 0.48, 0.38];
  // streets every fourth grid line, drawn as dark strips with a centre line
  for (let g = -lines; g <= lines; g += 4) {
    const along = g * cell, half = Math.sqrt(Math.max(0, R * R - along * along)) * 1.02;
    if (half < 20) continue;
    for (const axis of [0, 1]) {
      const a0 = axis === 0 ? along - 7 : -half, a1 = axis === 0 ? along + 7 : half;
      const b0 = axis === 0 ? -half : along - 7, b1 = axis === 0 ? half : along + 7;
      const gy = site.level + 0.45;
      flat(Math.min(a0, a1), Math.min(b0, b1), Math.max(a0, a1), Math.max(b0, b1), gy, asphalt);
      if (axis === 0) flat(along - 0.35, -half, along + 0.35, half, gy + 0.06, lane);
      else flat(-half, along - 0.35, half, along + 0.35, gy + 0.06, lane);
    }
  }

  let count = 0;
  for (let gx = -lines; gx <= lines; gx++) {
    for (let gz = -lines; gz <= lines; gz++) {
      if (gx % 4 === 0 || gz % 4 === 0) continue;
      const cx = gx * cell, cz = gz * cell;
      const d = Math.hypot(cx, cz) / R;
      if (d > 1.0) continue;
      const wx = site.x + cx, wz = site.z + cz;
      const y0 = terrainHeight(wx, wz) - 0.6;
      const r = rng();
      // parks and empty lots
      if (r < 0.07 + d * 0.1) { flat(cx - 22, cz - 22, cx + 22, cz + 22, site.level + 0.5, [0.09, 0.17, 0.045]); continue; }
      const kind = rng();
      const tint = 0.78 + rng() * 0.3;
      const c = kind < 0.28 ? [tint * 1.04, tint * 0.8, tint * 0.66]         // brick
        : kind < 0.55 ? [tint * 0.98, tint * 0.98, tint]                       // concrete
        : kind < 0.75 ? [tint * 0.74, tint * 0.9, tint * 1.12]                 // glass
        : [tint * 1.08, tint * 1.0, tint * 0.78];                              // sand
      const core = 1 - d;
      if (d > 0.68) {
        // outskirts: a block of houses in each cell
        const roof = rng() < 0.6 ? [0.46, 0.18, 0.1] : [0.28, 0.27, 0.27];
        for (const [ox, oz] of [[-13, -13], [13, -13], [-13, 13], [13, 13]] as const) {
          if (rng() < 0.18) continue;
          house(cx + ox + (rng() - 0.5) * 3, cz + oz + (rng() - 0.5) * 3, 15 + rng() * 4, 10 + rng() * 3, y0, [c[0]! * 1.05, c[1]! * 1.05, c[2]! * 1.05], roof);
          count++;
        }
        continue;
      }
      const roofC = [0.26 + rng() * 0.08, 0.26 + rng() * 0.08, 0.27 + rng() * 0.08];
      if (core > 0.5 && rng() < 0.55) {
        // downtown tower, usually with a setback
        const H1 = FLOOR_H * Math.round((34 + rng() * 40) / FLOOR_H), H2 = FLOOR_H * Math.round((20 + rng() * 70) / FLOOR_H);
        const w = cell * (0.62 + rng() * 0.2), dp = cell * (0.62 + rng() * 0.2);
        block(cx, cz, w, dp, y0, H1, c, roofC);
        block(cx, cz, w * 0.62, dp * 0.62, y0 + H1, H2, [c[0]! * 0.92, c[1]! * 0.95, c[2]! * 1.02], roofC, true);
        count += 2;
      } else if (rng() < 0.22) {
        // L-shaped block
        const H = FLOOR_H * Math.round((14 + rng() * 34) / FLOOR_H);
        block(cx - 8, cz, cell * 0.5, cell * 0.78, y0, H, c, roofC);
        block(cx + 14, cz + 12, cell * 0.36, cell * 0.4, y0, H * 0.7, c, roofC, true);
        count += 2;
      } else {
        const w = cell * (0.55 + rng() * 0.3), dp = cell * (0.55 + rng() * 0.3);
        const H = FLOOR_H * Math.max(2, Math.round((10 + Math.pow(rng(), 1.5) * 44 + core * core * 40) / FLOOR_H));
        block(cx, cz, w, dp, y0, H, c, roofC, rng() < 0.5);
        count++;
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return { geo: g, count };
}

interface CityMesh {
  group: Group;
  buildings: Mesh;
  mat: MeshStandardMaterial;
  fireT: number;
}

export class CityView {
  readonly group = new Group();
  private views: CityMesh[] = [];

  constructor() {
    const tex = facadeTextures();
    const footprint = new MeshBasicMaterial({ map: padTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    for (const site of CITY_SITES) {
      const g = new Group();
      g.position.set(site.x, site.level, site.z);
      const { geo } = buildCity(site);
      const mat = new MeshStandardMaterial({
        map: tex.map, emissiveMap: tex.glow, emissive: new Color(1, 0.86, 0.6), emissiveIntensity: 0.16, vertexColors: true,
        roughness: 0.8, metalness: 0.04,
      });
      const buildings = new Mesh(geo, mat);
      const pad = new Mesh(new CircleGeometry(site.radius * 1.12, 40).rotateX(-Math.PI / 2), footprint);
      pad.position.y = 0.6;
      g.add(pad, buildings);
      this.group.add(g);
      this.views.push({ group: g, buildings, mat, fireT: 0 });
    }
  }

  update(cities: readonly City[], time: number, dt: number, fx: Effects): void {
    for (let i = 0; i < this.views.length; i++) {
      const v = this.views[i]!, c = cities[i]!;
      const frac = c.hp / c.maxHp;
      const hurt = c.hurtT < 1.2;
      if (c.alive) {
        v.mat.emissiveIntensity = 0.03 + 0.13 * frac * (hurt ? 0.65 + 0.35 * Math.sin(time * 40) : 1);
        v.mat.color.setScalar(1);
        v.buildings.scale.y = 1;
      } else {
        v.mat.emissiveIntensity = 0.0;
        v.mat.color.setScalar(0.3);
        v.buildings.scale.y += (0.28 - v.buildings.scale.y) * Math.min(1, dt * 1.5);
      }
      // fires: more of them the worse the damage
      const burn = c.alive ? (frac < 0.7 ? (0.7 - frac) / 0.7 : 0) : 1;
      if (burn > 0) {
        v.fireT -= dt;
        if (v.fireT <= 0) {
          v.fireT = (c.alive ? 0.45 : 0.18) - burn * 0.12;
          const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * c.site.radius * 0.8;
          const p = new Vector3(c.site.x + Math.cos(a) * r, c.site.level + 18 + Math.random() * 30, c.site.z + Math.sin(a) * r);
          fx.fireTrail(p, 22 + burn * 20);
          fx.smokeTrail(p.setY(p.y + 12), 34 + burn * 24, true);
        }
      }
    }
  }
}
