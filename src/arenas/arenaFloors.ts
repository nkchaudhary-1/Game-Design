// Floor art for the seven hazard arenas. Same pipeline as the Core Pit (albedo + tangent-space normals from a height
// canvas + roughness, all lined up), but each arena paints its own mechanic onto the floor: platform outlines, field
// lines, crystal pads, plate seams, wind lanes, the lava channel, gravity zones. Everything is drawn in world units
// (the context is scaled so 1 unit = 1 metre, z up the page), which keeps the art exactly where the physics is.

import { TAU } from '../core/types';
import { makeRng, type Rng } from '../core/Rng';
import { fbm, grayCanvas, heightOf, normalCanvas, tex } from '../render/procTex';
import { GFX } from '../render/quality';
import type { ArenaDef } from './arenaData';
import type { FloorMaps } from './arenaTextures';
import { LavaHazard, WindHazard, GRAVITY_ZONES } from './hazards';

type G = CanvasRenderingContext2D;
interface Ctx { S: number; C: number; k: number; R: number; rnd: Rng; p: ArenaDef['palette']; spawns: Array<{ x: number; z: number }> }

const cache = new Map<string, FloorMaps>();

/** Painted once per arena and tier, then reused by every battle. */
export function paintArenaFloor(def: ArenaDef, spawns: Array<{ x: number; z: number }>): FloorMaps {
  const key = `${def.id}|${GFX.texSize}`;
  let m = cache.get(key);
  if (!m) { m = paint(def, spawns); cache.set(key, m); }
  return m;
}

/** Run `fn` with the canvas in world units: origin at the arena centre, +x right, +z up the page. */
function world(g: G, c: Ctx, fn: () => void): void {
  g.save(); g.translate(c.C, c.C); g.scale(c.k, -c.k); fn(); g.restore();
}
const circle = (g: G, r: number): void => { g.beginPath(); g.arc(0, 0, r, 0, TAU); };
const sector = (g: G, r0: number, r1: number, a0: number, a1: number): void => {
  g.beginPath(); g.arc(0, 0, r1, a0, a1); g.arc(0, 0, r0, a1, a0, true); g.closePath();
};

type Layer = 'height' | 'albedo' | 'rough';
type Marks = (g: G, c: Ctx, layer: Layer) => void;

const PLATFORM_ANGLES = [0, 1, 2, 3].map((k) => Math.PI / 4 + (k * Math.PI) / 2);

const MARKS: Record<string, Marks> = {
  'elevation-ring': (g, c, layer) => world(g, c, () => {
    for (const a of PLATFORM_ANGLES) {
      if (layer === 'albedo') {
        sector(g, 5.2, 12.4, a - 0.52, a + 0.52); g.fillStyle = 'rgba(255,170,110,0.07)'; g.fill();
        sector(g, 7, 12.4, a - 0.3, a + 0.3); g.fillStyle = 'rgba(255,196,140,0.16)'; g.fill();
        g.strokeStyle = c.p.accent; g.lineWidth = 0.1; g.globalAlpha = 0.85;
        g.beginPath(); g.arc(0, 0, 7, a - 0.3, a + 0.3); g.moveTo(Math.cos(a - 0.3) * 7, Math.sin(a - 0.3) * 7); g.lineTo(Math.cos(a - 0.3) * 11.8, Math.sin(a - 0.3) * 11.8);
        g.moveTo(Math.cos(a + 0.3) * 7, Math.sin(a + 0.3) * 7); g.lineTo(Math.cos(a + 0.3) * 11.8, Math.sin(a + 0.3) * 11.8); g.stroke(); g.globalAlpha = 1;
        // grip stripes up the ramps either side of the platform
        g.strokeStyle = 'rgba(255,200,150,0.35)'; g.lineWidth = 0.07;
        for (let r = 5.6; r < 7.2; r += 0.28) { g.beginPath(); g.arc(0, 0, r, a - 0.52, a - 0.3); g.stroke(); g.beginPath(); g.arc(0, 0, r, a + 0.3, a + 0.52); g.stroke(); }
      } else if (layer === 'height') {
        sector(g, 7, 12.4, a - 0.3, a + 0.3); g.fillStyle = 'rgba(255,255,255,0.12)'; g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 0.12; sector(g, 7, 12.4, a - 0.3, a + 0.3); g.stroke();
      } else {
        sector(g, 7, 12.4, a - 0.3, a + 0.3); g.fillStyle = '#9a9a9a'; g.fill();
      }
    }
    if (layer === 'albedo') {
      g.strokeStyle = 'rgba(255,138,58,0.5)'; g.lineWidth = 0.08; g.setLineDash([0.5, 0.4]);
      circle(g, 2.2); g.stroke(); g.setLineDash([]);
    }
  }),

  'magnetic-core': (g, c, layer) => world(g, c, () => {
    const rings = [1.7, 3.6, 5.6, 7.9, 10.3];
    if (layer === 'height') {
      g.strokeStyle = 'rgba(0,0,0,0.8)'; g.lineWidth = 0.16; for (const r of rings) { circle(g, r); g.stroke(); }
      g.fillStyle = 'rgba(0,0,0,0.5)'; circle(g, 1.6); g.fill();
      return;
    }
    if (layer === 'rough') { g.fillStyle = '#3a3a3a'; circle(g, 1.7); g.fill(); return; }
    const glowRing = (r: number, w: number, a: number): void => { g.strokeStyle = c.p.accent; g.globalAlpha = a; g.lineWidth = w; circle(g, r); g.stroke(); g.globalAlpha = 1; };
    for (const r of rings) { glowRing(r, 0.22, 0.12); glowRing(r, 0.06, 0.55); }
    // curved field lines from the core out, like iron filings round a magnet
    g.strokeStyle = c.p.accent; g.lineWidth = 0.05; g.globalAlpha = 0.4;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      g.beginPath();
      for (let s = 0; s <= 1; s += 0.04) { const r = 1.9 + s * 8.6, aa = a + s * 0.9; const x = Math.cos(aa) * r, z = Math.sin(aa) * r; if (s === 0) g.moveTo(x, z); else g.lineTo(x, z); }
      g.stroke();
    }
    g.globalAlpha = 1;
    // the magnet itself: a dark well with a bright lip
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, 1.8);
    grd.addColorStop(0, '#04070d'); grd.addColorStop(0.75, '#0b1a2e'); grd.addColorStop(1, 'rgba(47,134,255,0.6)');
    g.fillStyle = grd; circle(g, 1.8); g.fill();
    // hazard chevrons at the rim: the push throws you at the wall
    g.fillStyle = 'rgba(255,207,58,0.55)';
    for (let i = 0; i < 36; i++) { const a = (i / 36) * TAU; sector(g, 11.05, 11.5, a, a + TAU / 72); g.fill(); }
    // spawn pads
    g.strokeStyle = 'rgba(230,242,255,0.6)'; g.lineWidth = 0.09; g.setLineDash([0.5, 0.35]);
    for (const sp of c.spawns) { g.beginPath(); g.arc(sp.x, sp.z, 2, 0, TAU); g.stroke(); }
    g.setLineDash([]);
  }),

  'crystal-arena': (g, c, layer) => world(g, c, () => {
    const rnd = makeRng(41);
    // shards: a broken, faceted floor
    for (let i = 0; i < 46; i++) {
      const a = rnd() * TAU, r = Math.sqrt(rnd()) * 11.6, s = 0.9 + rnd() * 2.2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r, t = rnd() * TAU;
      g.beginPath();
      g.moveTo(x + Math.cos(t) * s, z + Math.sin(t) * s);
      g.lineTo(x + Math.cos(t + 2.2) * s * 0.8, z + Math.sin(t + 2.2) * s * 0.8);
      g.lineTo(x + Math.cos(t + 4.1) * s * 0.9, z + Math.sin(t + 4.1) * s * 0.9);
      g.closePath();
      if (layer === 'albedo') { g.fillStyle = `rgba(${rnd() < 0.5 ? '120,90,220' : '60,40,130'},${0.10 + rnd() * 0.14})`; g.fill(); g.strokeStyle = 'rgba(39,224,255,0.28)'; g.lineWidth = 0.05; g.stroke(); }
      else if (layer === 'height') { g.fillStyle = `rgba(255,255,255,${0.04 + rnd() * 0.12})`; g.fill(); g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 0.09; g.stroke(); }
      else { g.fillStyle = '#9a9a9a'; g.fill(); }
    }
    if (layer !== 'albedo') return;
    // crystal pads: a glowing ring where each crystal grows
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2, x = Math.cos(a) * 7.2, z = Math.sin(a) * 7.2;
      const grd = g.createRadialGradient(x, z, 0, x, z, 1.7);
      grd.addColorStop(0, 'rgba(39,224,255,0.4)'); grd.addColorStop(1, 'rgba(39,224,255,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, z, 1.7, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(39,224,255,0.9)'; g.lineWidth = 0.08; g.beginPath(); g.arc(x, z, 1.15, 0, TAU); g.stroke();
    }
    g.strokeStyle = 'rgba(234,219,255,0.55)'; g.lineWidth = 0.09; g.setLineDash([0.5, 0.35]);
    for (const sp of c.spawns) { g.beginPath(); g.arc(sp.x, sp.z, 2, 0, TAU); g.stroke(); }
    g.setLineDash([]);
  }),

  // the plates are separate meshes; this is the machinery you see through the seams and when a plate sinks
  'shift-floor': (g, c, layer) => world(g, c, () => {
    if (layer === 'height') {
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 0.1;
      for (let r = 0.8; r < 12; r += 0.8) { circle(g, r); g.stroke(); }
      return;
    }
    if (layer === 'rough') return;
    g.fillStyle = '#05100f'; circle(g, 12.2); g.fill();
    for (const r of [4.1, 8.2]) {
      g.strokeStyle = c.p.accent; g.lineWidth = 0.5; g.globalAlpha = 0.18; circle(g, r); g.stroke();
      g.lineWidth = 0.1; g.globalAlpha = 0.8; circle(g, r); g.stroke(); g.globalAlpha = 1;
    }
    g.strokeStyle = c.p.accent; g.globalAlpha = 0.3; g.lineWidth = 0.05;
    for (let r = 0.8; r < 12; r += 0.8) { circle(g, r); g.stroke(); }
    for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU; g.beginPath(); g.moveTo(Math.cos(a) * 0.8, Math.sin(a) * 0.8); g.lineTo(Math.cos(a) * 12, Math.sin(a) * 12); g.stroke(); }
    g.globalAlpha = 1;
  }),

  'wind-tunnel': (g, c, layer) => world(g, c, () => {
    const w = new WindHazard();
    for (const l of w.lanes) {
      const half = Math.sqrt(Math.max(0, 12.2 * 12.2 - l.z * l.z));
      g.save();
      circle(g, 12.2); g.clip();
      if (layer === 'albedo') {
        g.fillStyle = 'rgba(111,224,255,0.09)'; g.fillRect(-half, l.z - l.hw, half * 2, l.hw * 2);
        g.strokeStyle = c.p.accent; g.lineWidth = 0.09; g.globalAlpha = 0.7; g.setLineDash([0.9, 0.45]);
        g.beginPath(); g.moveTo(-half, l.z - l.hw); g.lineTo(half, l.z - l.hw); g.moveTo(-half, l.z + l.hw); g.lineTo(half, l.z + l.hw); g.stroke();
        g.setLineDash([]); g.globalAlpha = 1;
      } else if (layer === 'height') {
        g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 0.12;
        g.beginPath(); g.moveTo(-half, l.z - l.hw); g.lineTo(half, l.z - l.hw); g.moveTo(-half, l.z + l.hw); g.lineTo(half, l.z + l.hw); g.stroke();
      } else {
        g.fillStyle = '#8a8a8a'; g.fillRect(-half, l.z - l.hw, half * 2, l.hw * 2);
      }
      g.restore();
    }
    if (layer === 'albedo') {
      g.strokeStyle = 'rgba(230,244,255,0.6)'; g.lineWidth = 0.09; g.setLineDash([0.5, 0.35]);
      for (const sp of c.spawns) { g.beginPath(); g.arc(sp.x, sp.z, 2, 0, TAU); g.stroke(); }
      g.setLineDash([]);
    }
  }),

  'lava-ring': (g, c, layer) => world(g, c, () => {
    const rnd = makeRng(53);
    const { R0, R1 } = LavaHazard;
    if (layer === 'height') {
      g.fillStyle = 'rgba(0,0,0,0.85)'; sector(g, R0 - 0.1, R1 + 0.1, 0, TAU); g.fill();    // the channel is cut deep
      g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 0.16; circle(g, R0 - 0.18); g.stroke(); circle(g, R1 + 0.18); g.stroke();
      return;
    }
    if (layer === 'rough') { g.fillStyle = '#4a4a4a'; sector(g, R0 - 0.1, R1 + 0.1, 0, TAU); g.fill(); return; }
    // glowing cracks wandering over the basalt
    g.lineCap = 'round';
    for (let i = 0; i < 38; i++) {
      const a = rnd() * TAU, r = (rnd() < 0.5 ? 1.5 + rnd() * 5.2 : 9.3 + rnd() * 2.4);
      let x = Math.cos(a) * r, z = Math.sin(a) * r, t = rnd() * TAU;
      g.strokeStyle = `rgba(255,${90 + Math.floor(rnd() * 80)},40,${0.35 + rnd() * 0.4})`; g.lineWidth = 0.05 + rnd() * 0.08;
      g.beginPath(); g.moveTo(x, z);
      for (let s = 0; s < 14; s++) { t += (rnd() - 0.5) * 1.1; x += Math.cos(t) * 0.35; z += Math.sin(t) * 0.35; g.lineTo(x, z); }
      g.stroke();
    }
    // channel bed and its hot edges
    g.fillStyle = '#1a0806'; sector(g, R0 - 0.1, R1 + 0.1, 0, TAU); g.fill();
    for (const r of [R0 - 0.12, R1 + 0.12]) { g.strokeStyle = 'rgba(255,120,50,0.8)'; g.lineWidth = 0.14; circle(g, r); g.stroke(); g.strokeStyle = 'rgba(255,200,120,0.5)'; g.lineWidth = 0.04; circle(g, r); g.stroke(); }
    // vent craters
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2, r = (R0 + R1) / 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
      const grd = g.createRadialGradient(x, z, 0.2, x, z, LavaHazard.VENT_R);
      grd.addColorStop(0, 'rgba(0,0,0,0.75)'); grd.addColorStop(0.55, 'rgba(60,18,10,0.55)'); grd.addColorStop(1, 'rgba(255,90,54,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, z, LavaHazard.VENT_R, 0, TAU); g.fill();
    }
    g.strokeStyle = 'rgba(255,227,207,0.5)'; g.lineWidth = 0.09; g.setLineDash([0.5, 0.35]);
    for (const sp of c.spawns) { g.beginPath(); g.arc(sp.x, sp.z, 2, 0, TAU); g.stroke(); }
    g.setLineDash([]);
  }),

  'gravity-well': (g, c, layer) => world(g, c, () => {
    const { highOuter, lowInner } = GRAVITY_ZONES;
    if (layer === 'height') {
      g.strokeStyle = 'rgba(0,0,0,0.75)'; g.lineWidth = 0.15;
      for (let r = 0.9; r < highOuter; r += 0.42) { circle(g, r); g.stroke(); }
      circle(g, highOuter); g.stroke(); circle(g, lowInner); g.stroke();
      g.fillStyle = 'rgba(0,0,0,0.6)'; circle(g, 0.9); g.fill();
      return;
    }
    if (layer === 'rough') { g.fillStyle = '#6a6a6a'; circle(g, highOuter); g.fill(); return; }
    // high gravity: dense dark rings
    const core = g.createRadialGradient(0, 0, 0, 0, 0, highOuter);
    core.addColorStop(0, 'rgba(2,0,10,0.92)'); core.addColorStop(0.6, 'rgba(24,10,60,0.55)'); core.addColorStop(1, 'rgba(70,30,140,0.12)');
    g.fillStyle = core; circle(g, highOuter); g.fill();
    g.strokeStyle = c.p.accent; g.lineWidth = 0.05; g.globalAlpha = 0.55;
    for (let r = 0.9; r < highOuter; r += 0.42) { circle(g, r); g.stroke(); }
    g.globalAlpha = 1;
    // orbit zone: curved arrows running the way the blades are swept
    g.strokeStyle = c.p.accent; g.fillStyle = c.p.accent;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU, rr = (highOuter + lowInner) / 2;
      g.globalAlpha = 0.5; g.lineWidth = 0.1;
      g.beginPath(); g.arc(0, 0, rr, a, a + 0.5); g.stroke();
      const ax = Math.cos(a + 0.5) * rr, az = Math.sin(a + 0.5) * rr, tx = -Math.sin(a + 0.5), tz = Math.cos(a + 0.5), nx = Math.cos(a + 0.5), nz = Math.sin(a + 0.5);
      g.beginPath(); g.moveTo(ax + tx * 0.45, az + tz * 0.45); g.lineTo(ax + nx * 0.28, az + nz * 0.28); g.lineTo(ax - nx * 0.28, az - nz * 0.28); g.closePath(); g.fill();
    }
    g.globalAlpha = 1;
    // the zone borders glow
    for (const r of [highOuter, lowInner]) { g.strokeStyle = c.p.accent; g.lineWidth = 0.3; g.globalAlpha = 0.18; circle(g, r); g.stroke(); g.lineWidth = 0.07; g.globalAlpha = 0.9; circle(g, r); g.stroke(); g.globalAlpha = 1; }
    // low gravity: scattered motes
    const rnd = makeRng(61);
    g.fillStyle = 'rgba(228,220,255,0.5)';
    for (let i = 0; i < 90; i++) { const a = rnd() * TAU, r = lowInner + 0.6 + rnd() * 3.2; g.beginPath(); g.arc(Math.cos(a) * r, Math.sin(a) * r, 0.04 + rnd() * 0.07, 0, TAU); g.fill(); }
    g.strokeStyle = 'rgba(228,220,255,0.6)'; g.lineWidth = 0.09; g.setLineDash([0.5, 0.35]);
    for (const sp of c.spawns) { g.beginPath(); g.arc(sp.x, sp.z, 2, 0, TAU); g.stroke(); }
    g.setLineDash([]);
  }),
};

/** Base tones per arena (centre, mid, edge) and how rough/glossy the floor is. */
const BASE: Record<string, { tones: [string, string, string]; metal: number; gloss: string; seams: boolean }> = {
  'elevation-ring': { tones: ['#6b5d6e', '#554a63', '#3f3752'], metal: 0.05, gloss: '#d0d0d0', seams: true },
  'magnetic-core': { tones: ['#355673', '#2a4663', '#1d3448'], metal: 0.4, gloss: '#9a9a9a', seams: true },
  'crystal-arena': { tones: ['#4a3b7c', '#3a2d66', '#281f4c'], metal: 0.25, gloss: '#7a7a7a', seams: false },
  'shift-floor': { tones: ['#1c2b33', '#162329', '#0e171c'], metal: 0.3, gloss: '#9a9a9a', seams: false },
  'wind-tunnel': { tones: ['#4f6e8b', '#3f5d7a', '#2b4560'], metal: 0.35, gloss: '#8a8a8a', seams: true },
  'lava-ring': { tones: ['#3a2a2c', '#2d2022', '#1c1315'], metal: 0.02, gloss: '#e0e0e0', seams: false },
  'gravity-well': { tones: ['#3c3470', '#2d2760', '#1d1942'], metal: 0.3, gloss: '#8a8a8a', seams: false },
};

function paint(def: ArenaDef, spawns: Array<{ x: number; z: number }>): FloorMaps {
  const S = GFX.texSize, C = S / 2, K = S / 1024;
  const base = BASE[def.id];
  const marks = MARKS[def.id];
  const c: Ctx = { S, C, k: C / def.radius, R: C, rnd: makeRng(7), p: def.palette, spawns };
  const mk = (): [HTMLCanvasElement, CanvasRenderingContext2D] => { const cv = document.createElement('canvas'); cv.width = cv.height = S; return [cv, cv.getContext('2d')!]; };

  // ---- height
  const mottle = grayCanvas(fbm(512, 3, 6, 5), 512);
  const grain = grayCanvas(fbm(512, 9, 4, 40), 512);
  const [hc, hg] = mk();
  hg.imageSmoothingQuality = 'high';
  hg.drawImage(mottle, 0, 0, S, S);
  hg.globalAlpha = 0.5; hg.drawImage(grain, 0, 0, S, S); hg.globalAlpha = 1;
  if (base.seams) {
    hg.strokeStyle = 'rgba(0,0,0,0.7)'; hg.lineWidth = 5 * K;
    for (const f of [0.22, 0.46, 0.7, 0.9]) { hg.beginPath(); hg.arc(C, C, f * C, 0, TAU); hg.stroke(); }
    for (let j = 0; j < 24; j++) {
      const a = (j * TAU) / 24;
      hg.lineWidth = 3 * K; hg.beginPath(); hg.moveTo(C + Math.cos(a) * 0.46 * C, C + Math.sin(a) * 0.46 * C); hg.lineTo(C + Math.cos(a) * 0.97 * C, C + Math.sin(a) * 0.97 * C); hg.stroke();
    }
  }
  for (let i = 0; i < 200; i++) { // pits and chips
    const a = c.rnd() * TAU, r = Math.sqrt(c.rnd()) * C;
    hg.fillStyle = `rgba(0,0,0,${0.15 + c.rnd() * 0.25})`;
    hg.beginPath(); hg.arc(C + Math.cos(a) * r, C + Math.sin(a) * r, (0.8 + c.rnd() * 2.2) * K, 0, TAU); hg.fill();
  }
  marks(hg, c, 'height');
  const normalMap = tex(normalCanvas(heightOf(hc), S, 4));

  // ---- albedo
  const [ac, ag] = mk();
  const grd = ag.createRadialGradient(C, C, 30 * K, C, C, C);
  grd.addColorStop(0, base.tones[0]); grd.addColorStop(0.65, base.tones[1]); grd.addColorStop(1, base.tones[2]);
  ag.fillStyle = grd; ag.fillRect(0, 0, S, S);
  ag.globalCompositeOperation = 'overlay'; ag.globalAlpha = 0.55; ag.drawImage(hc, 0, 0); ag.globalAlpha = 1; ag.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 34; i++) { // soft stains
    const x = c.rnd() * S, y = c.rnd() * S, r = (30 + c.rnd() * 120) * K;
    const g2 = ag.createRadialGradient(x, y, 0, x, y, r);
    g2.addColorStop(0, `rgba(8,8,20,${0.08 + c.rnd() * 0.1})`); g2.addColorStop(1, 'rgba(8,8,20,0)');
    ag.fillStyle = g2; ag.fillRect(x - r, y - r, r * 2, r * 2);
  }
  if (base.seams) {
    ag.strokeStyle = 'rgba(10,12,24,0.55)'; ag.lineWidth = 5 * K;
    for (const f of [0.22, 0.46, 0.7, 0.9]) { ag.beginPath(); ag.arc(C, C, f * C, 0, TAU); ag.stroke(); }
  }
  marks(ag, c, 'albedo');
  const edge = ag.createRadialGradient(C, C, C * 0.86, C, C, C);
  edge.addColorStop(0, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(4,6,16,0.55)');
  ag.fillStyle = edge; ag.fillRect(0, 0, S, S);
  const map = tex(ac, { srgb: true });

  // ---- roughness
  const [rc, rg] = mk();
  rg.fillStyle = base.gloss; rg.fillRect(0, 0, S, S);
  rg.globalCompositeOperation = 'multiply'; rg.globalAlpha = 0.5; rg.drawImage(mottle, 0, 0, S, S); rg.globalAlpha = 1; rg.globalCompositeOperation = 'source-over';
  marks(rg, c, 'rough');
  const roughnessMap = tex(rc);
  return { map, normalMap, roughnessMap };
}

/** How metallic this arena's floor reads (the Core Pit is concrete). */
export const floorMetal = (id: string): number => BASE[id]?.metal ?? 0.04;

