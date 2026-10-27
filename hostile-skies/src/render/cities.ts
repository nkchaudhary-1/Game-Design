// The three cities. Each is one merged mesh of procedural towers with lit windows, a dark urban footprint on the
// ground, and a pale beacon so the pilot can find home from anywhere in the arena. Damage dims the lights, starts fires,
// and finally flattens the skyline.

import {
  AdditiveBlending, BufferGeometry, CanvasTexture, CircleGeometry, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute,
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
  ga.fillStyle = '#272b3c'; ga.fillRect(0, 0, S, S);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, S, S);
  const rng = makeRng(21);
  const cw = S / cols, ch = S / rows;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = c * cw + cw * 0.2, y = r * ch + ch * 0.22, w = cw * 0.6, h = ch * 0.5;
    ga.fillStyle = '#12151f'; ga.fillRect(x, y, w, h);
    if (rng() < 0.52) {
      const k = rng();
      const col = k < 0.62 ? '#ffd58a' : k < 0.85 ? '#ffe9c2' : '#9fd8ff';
      ge.fillStyle = col; ge.fillRect(x, y, w, h);
    }
  }
  // a dark patch in the corner for roofs to sample
  ga.fillStyle = '#10131c'; ga.fillRect(0, 0, 6, 6);
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
  gr.addColorStop(0, 'rgba(20,20,30,0.92)');
  gr.addColorStop(0.7, 'rgba(22,22,32,0.8)');
  gr.addColorStop(1, 'rgba(22,22,32,0)');
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
  const cell = 54, R = site.radius;
  let count = 0;
  for (let gx = -Math.ceil(R / cell); gx <= Math.ceil(R / cell); gx++) {
    for (let gz = -Math.ceil(R / cell); gz <= Math.ceil(R / cell); gz++) {
      // streets every fourth line
      if (gx % 4 === 0 || gz % 4 === 0) continue;
      const cx = gx * cell + (rng() - 0.5) * 8, cz = gz * cell + (rng() - 0.5) * 8;
      const d = Math.hypot(cx, cz) / R;
      if (d > 1.0 || rng() < 0.12 + d * 0.3) continue;
      const w = cell * (0.5 + rng() * 0.28), dp = cell * (0.5 + rng() * 0.28);
      const core = 1 - d;
      const h = (10 + Math.pow(rng(), 1.6) * 60 + core * core * 85 * (0.4 + rng() * 0.8)) * (d > 0.85 ? 0.5 : 1);
      const floors = Math.max(2, Math.round(h / FLOOR_H));
      const H = floors * FLOOR_H;
      const wx = site.x + cx, wz = site.z + cz;
      const y0 = terrainHeight(wx, wz) - 1;
      const tint = 0.75 + rng() * 0.5;
      const c = [tint, tint, tint * 1.05];
      const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - dp / 2, z1 = cz + dp / 2, yt = y0 + H;
      const uw = w / TILE_W, ud = dp / TILE_W, vh = H / TILE_H;
      const o = (x: number, y: number, z: number) => [x, y - site.level, z];
      // four walls (wrapped around), wound outwards
      quad([o(x0, y0, z1), o(x1, y0, z1), o(x1, yt, z1), o(x0, yt, z1)], [0, 0, 1], [[0, 0], [uw, 0], [uw, vh], [0, vh]], c);
      quad([o(x1, y0, z0), o(x0, y0, z0), o(x0, yt, z0), o(x1, yt, z0)], [0, 0, -1], [[0, 0], [uw, 0], [uw, vh], [0, vh]], c);
      quad([o(x1, y0, z1), o(x1, y0, z0), o(x1, yt, z0), o(x1, yt, z1)], [1, 0, 0], [[0, 0], [ud, 0], [ud, vh], [0, vh]], c);
      quad([o(x0, y0, z0), o(x0, y0, z1), o(x0, yt, z1), o(x0, yt, z0)], [-1, 0, 0], [[0, 0], [ud, 0], [ud, vh], [0, vh]], c);
      // roof samples the dark corner of the facade texture
      const r = 0.012;
      quad([o(x0, yt, z1), o(x1, yt, z1), o(x1, yt, z0), o(x0, yt, z0)], [0, 1, 0], [[r, r], [r, r], [r, r], [r, r]], [0.6, 0.6, 0.66]);
      count++;
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
  beam: Mesh;
  beamMat: MeshBasicMaterial;
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
        map: tex.map, emissiveMap: tex.glow, emissive: new Color(1, 0.86, 0.6), emissiveIntensity: 1.5, vertexColors: true,
        roughness: 0.75, metalness: 0.15,
      });
      const buildings = new Mesh(geo, mat);
      const pad = new Mesh(new CircleGeometry(site.radius * 1.12, 40).rotateX(-Math.PI / 2), footprint);
      pad.position.y = 0.6;
      // a long soft column of light: the objective marker
      const beamMat = new MeshBasicMaterial({ color: new Color(0.2, 0.9, 1.3), transparent: true, opacity: 0.2, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false });
      const beam = new Mesh(new CylinderGeometry(26, 40, 2600, 16, 1, true).translate(0, 1300, 0), beamMat);
      beam.renderOrder = 4;
      g.add(pad, buildings, beam);
      this.group.add(g);
      this.views.push({ group: g, buildings, mat, beam, beamMat, fireT: 0 });
    }
  }

  update(cities: readonly City[], time: number, dt: number, fx: Effects): void {
    for (let i = 0; i < this.views.length; i++) {
      const v = this.views[i]!, c = cities[i]!;
      const frac = c.hp / c.maxHp;
      const hurt = c.hurtT < 1.2;
      if (c.alive) {
        v.mat.emissiveIntensity = 0.25 + 1.25 * frac * (hurt ? 0.65 + 0.35 * Math.sin(time * 40) : 1);
        v.mat.color.setScalar(1);
        v.buildings.scale.y = 1;
        // beacon: calm cyan, urgent red while under attack
        const alarm = c.hurtT < 4;
        v.beamMat.color.setRGB(alarm ? 2.2 : 0.2, alarm ? 0.35 : 0.9, alarm ? 0.25 : 1.3);
        v.beamMat.opacity = alarm ? 0.22 + 0.14 * Math.sin(time * 9) : 0.16;
      } else {
        v.mat.emissiveIntensity = 0.04;
        v.mat.color.setScalar(0.35);
        v.buildings.scale.y += (0.28 - v.buildings.scale.y) * Math.min(1, dt * 1.5);
        v.beamMat.opacity = 0;
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
