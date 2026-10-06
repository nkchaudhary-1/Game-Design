// Procedural PBR maps for the Core Pit: albedo (concrete + paint), tangent-space normals (grain, carved grooves,
// plate seams, cracks, pits) and roughness (glossier paint, rougher worn concrete). One canvas pipeline so the
// grooves in the albedo and the normals always line up. Size follows the graphics tier.

import * as THREE from 'three';
import { TAU } from '../core/types';
import { makeRng } from '../core/Rng';
import { drawEmblem } from '../render/emblem';
import { fbm, grayCanvas, heightOf, normalCanvas, tex } from '../render/procTex';
import { GFX } from '../render/quality';

const BANDS = [0.22, 0.46, 0.7, 0.9];
const HAZARD_DEG = [-52, 38, 128, 218];

export interface FloorMaps { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture }

const floorCache = new Map<string, FloorMaps>();

/** Painted once per tier and reused by every battle (the generation takes about a second at High). */
export function paintFloorMaps(spawns: Array<{ x: number; z: number }>, radius: number): FloorMaps {
  const key = `${GFX.texSize}|${radius}`;
  let m = floorCache.get(key);
  if (!m) { m = paintFloorMapsNow(spawns, radius); floorCache.set(key, m); }
  return m;
}

function paintFloorMapsNow(spawns: Array<{ x: number; z: number }>, radius: number): FloorMaps {
  const S = GFX.texSize, C = S / 2, K = S / 1024;
  const R = C * 0.97;
  const rnd = makeRng(7);
  const mk = (): [HTMLCanvasElement, CanvasRenderingContext2D] => { const c = document.createElement('canvas'); c.width = c.height = S; return [c, c.getContext('2d')!]; };

  // ---- height: mottled concrete + carved features
  const mottle = grayCanvas(fbm(512, 3, 6, 5), 512);
  const grain = grayCanvas(fbm(512, 9, 4, 40), 512);
  const [hc, hg] = mk();
  hg.imageSmoothingQuality = 'high';
  hg.drawImage(mottle, 0, 0, S, S);
  hg.globalAlpha = 0.5; hg.drawImage(grain, 0, 0, S, S); hg.globalAlpha = 1;
  const carve = (alpha: number, width: number, fn: () => void, color = '0,0,0'): void => { hg.strokeStyle = `rgba(${color},${alpha})`; hg.lineWidth = width; fn(); };
  BANDS.forEach((f, i) => {
    carve(0.85, (i === 1 ? 11 : 8) * K, () => { hg.beginPath(); hg.arc(C, C, f * R, 0, TAU); hg.stroke(); });
    carve(0.4, 3 * K, () => { hg.beginPath(); hg.arc(C, C, f * R + 8 * K, 0, TAU); hg.stroke(); }, '255,255,255');
  });
  const sect = 24;
  for (let j = 0; j < sect; j++) {
    const a = (j * TAU) / sect;
    for (const [r0, r1] of [[0.46, 0.7], [0.7, 0.9], [0.9, 0.97]]) {
      carve(0.8, 4 * K, () => { hg.beginPath(); hg.moveTo(C + Math.cos(a) * r0 * R, C + Math.sin(a) * r0 * R); hg.lineTo(C + Math.cos(a) * r1 * R, C + Math.sin(a) * r1 * R); hg.stroke(); });
    }
  }
  // plate steps: alternate plates sit a hair higher
  BANDS.forEach((f, b) => {
    const r0 = b === 0 ? 0 : BANDS[b - 1];
    for (let j = 0; j < sect; j++) {
      if ((j + b) % 2) continue;
      hg.fillStyle = 'rgba(255,255,255,0.07)';
      hg.beginPath(); hg.arc(C, C, f * R, (j * TAU) / sect, ((j + 1) * TAU) / sect); hg.arc(C, C, r0 * R, ((j + 1) * TAU) / sect, (j * TAU) / sect, true); hg.fill();
    }
  });
  // cracks that wander off the seams, with a few branches
  const crack = (x: number, y: number, ang: number, len: number, w: number, depth: number): void => {
    hg.strokeStyle = `rgba(0,0,0,${depth})`; hg.lineWidth = w; hg.lineCap = 'round';
    hg.beginPath(); hg.moveTo(x, y);
    for (let s = 0; s < len; s += 6 * K) {
      ang += (rnd() - 0.5) * 0.7; x += Math.cos(ang) * 6 * K; y += Math.sin(ang) * 6 * K; hg.lineTo(x, y);
      if (rnd() < 0.04 && w > 1.2 * K) crack(x, y, ang + (rnd() - 0.5) * 1.6, len * 0.3, w * 0.6, depth * 0.9);
    }
    hg.stroke();
  };
  for (let i = 0; i < 26; i++) {
    const a = rnd() * TAU, r = (0.45 + rnd() * 0.5) * R;
    crack(C + Math.cos(a) * r, C + Math.sin(a) * r, rnd() * TAU, (60 + rnd() * 160) * K, (1.2 + rnd() * 2.2) * K, 0.7);
  }
  for (let i = 0; i < 260; i++) { // pits and chips
    const a = rnd() * TAU, r = Math.sqrt(rnd()) * R;
    hg.fillStyle = `rgba(0,0,0,${0.18 + rnd() * 0.25})`;
    hg.beginPath(); hg.arc(C + Math.cos(a) * r, C + Math.sin(a) * r, (0.8 + rnd() * 2.4) * K, 0, TAU); hg.fill();
  }
  const normalMap = tex(normalCanvas(heightOf(hc), S, 4.2));

  // ---- albedo: tone + paint
  const [ac, ag] = mk();
  const base = ag.createRadialGradient(C, C, 40 * K, C, C, C);
  base.addColorStop(0, '#9a9ca8'); base.addColorStop(0.7, '#868999'); base.addColorStop(1, '#666a7e');
  ag.fillStyle = base; ag.fillRect(0, 0, S, S);
  ag.globalCompositeOperation = 'overlay'; ag.globalAlpha = 0.65; ag.drawImage(hc, 0, 0); ag.globalAlpha = 1; ag.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 46; i++) { // soft stains and oil
    const x = rnd() * S, y = rnd() * S, r = (30 + rnd() * 130) * K;
    const g = ag.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(20,22,36,${0.1 + rnd() * 0.12})`); g.addColorStop(1, 'rgba(20,22,36,0)');
    ag.fillStyle = g; ag.fillRect(x - r, y - r, r * 2, r * 2);
  }
  BANDS.forEach((f) => { ag.strokeStyle = 'rgba(26,28,44,0.7)'; ag.lineWidth = 7 * K; ag.beginPath(); ag.arc(C, C, f * R, 0, TAU); ag.stroke(); });
  ag.strokeStyle = 'rgba(26,28,44,0.5)'; ag.lineWidth = 3 * K;
  for (let j = 0; j < sect; j++) {
    const a = (j * TAU) / sect;
    for (const [r0, r1] of [[0.46, 0.7], [0.7, 0.9], [0.9, 0.97]]) { ag.beginPath(); ag.moveTo(C + Math.cos(a) * r0 * R, C + Math.sin(a) * r0 * R); ag.lineTo(C + Math.cos(a) * r1 * R, C + Math.sin(a) * r1 * R); ag.stroke(); }
  }
  // hazard patches with worn paint
  for (const deg of HAZARD_DEG) {
    const a0 = ((deg - 9) * Math.PI) / 180, a1 = ((deg + 9) * Math.PI) / 180;
    ag.save();
    ag.beginPath(); ag.arc(C, C, 0.965 * R, a0, a1); ag.arc(C, C, 0.9 * R, a1, a0, true); ag.closePath(); ag.clip();
    ag.fillStyle = '#e9a92f'; ag.fillRect(0, 0, S, S);
    ag.strokeStyle = 'rgba(28,20,6,0.8)'; ag.lineWidth = 11 * K;
    for (let k = -30; k < 30; k++) { ag.beginPath(); ag.moveTo(C + k * 22 * K, C - R); ag.lineTo(C + k * 22 * K + 120 * K, C + R); ag.stroke(); }
    ag.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 160; i++) { ag.fillStyle = `rgba(0,0,0,${0.2 + rnd() * 0.5})`; ag.fillRect(C + (rnd() - 0.5) * 2 * R, C + (rnd() - 0.5) * 2 * R, (2 + rnd() * 10) * K, (1 + rnd() * 3) * K); }
    ag.restore();
  }
  // spawn pads, painted as dashed rings
  ag.strokeStyle = 'rgba(240,238,230,0.62)'; ag.lineWidth = 4 * K; ag.setLineDash([22 * K, 16 * K]);
  for (const sp of spawns) { ag.beginPath(); ag.arc(C + (sp.x / radius) * R, C + (sp.z / radius) * R, 2.0 * (R / radius), 0, TAU); ag.stroke(); }
  ag.setLineDash([]);
  // centre: engraved emblem
  ag.strokeStyle = 'rgba(24,27,46,0.4)'; ag.lineWidth = 9 * K; ag.beginPath(); ag.arc(C, C, 0.19 * R, 0, TAU); ag.stroke();
  ag.globalAlpha = 0.24; drawEmblem(ag, S, '#222542', 0.27); ag.globalAlpha = 1;
  const edge = ag.createRadialGradient(C, C, R * 0.88, C, C, C);
  edge.addColorStop(0, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(6,8,20,0.6)');
  ag.fillStyle = edge; ag.fillRect(0, 0, S, S);
  const map = tex(ac, { srgb: true });

  // ---- roughness: worn concrete is rough, paint is glossier, grooves are dusty
  const [rc, rg] = mk();
  rg.fillStyle = '#d4d4d4'; rg.fillRect(0, 0, S, S);
  rg.globalCompositeOperation = 'multiply'; rg.globalAlpha = 0.5; rg.drawImage(mottle, 0, 0, S, S); rg.globalAlpha = 1; rg.globalCompositeOperation = 'source-over';
  for (const deg of HAZARD_DEG) {
    const a0 = ((deg - 9) * Math.PI) / 180, a1 = ((deg + 9) * Math.PI) / 180;
    rg.fillStyle = '#7a7a7a'; rg.beginPath(); rg.arc(C, C, 0.965 * R, a0, a1); rg.arc(C, C, 0.9 * R, a1, a0, true); rg.closePath(); rg.fill();
  }
  BANDS.forEach((f) => { rg.strokeStyle = '#f0f0f0'; rg.lineWidth = 9 * K; rg.beginPath(); rg.arc(C, C, f * R, 0, TAU); rg.stroke(); });
  const roughnessMap = tex(rc);
  return { map, normalMap, roughnessMap };
}

/** Painted panel for crates: frame, rivets, hazard base, emblem or a word. */
export function crateCanvas(color: string, mark: string, text: string | null): HTMLCanvasElement {
  const S = 512, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = color; g.fillRect(0, 0, S, S);
  // scuffed paint
  const rnd = makeRng(color.length * 31 + (text ? text.length : 3));
  for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.1})`; g.fillRect(rnd() * S, rnd() * S, 2 + rnd() * 24, 1 + rnd() * 3); }
  for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(255,255,255,${rnd() * 0.07})`; g.fillRect(rnd() * S, rnd() * S, 2 + rnd() * 18, 1 + rnd() * 2); }
  // frame
  g.strokeStyle = 'rgba(0,0,0,0.38)'; g.lineWidth = 14; g.strokeRect(10, 10, S - 20, S - 20);
  g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 3; g.strokeRect(20, 20, S - 40, S - 40);
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 6;
  g.beginPath(); g.moveTo(10, 10); g.lineTo(S - 10, S - 10); g.moveTo(S - 10, 10); g.lineTo(10, S - 10); g.stroke();
  // rivets
  for (const [x, y] of [[34, 34], [S - 34, 34], [34, S - 34], [S - 34, S - 34], [S / 2, 34], [S / 2, S - 34], [34, S / 2], [S - 34, S / 2]]) {
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.beginPath(); g.arc(x + 2, y + 2, 9, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.45)'; g.beginPath(); g.arc(x, y, 8, 0, TAU); g.fill();
  }
  g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(70, 70, S - 140, S - 140);
  g.fillStyle = color; g.fillRect(78, 78, S - 156, S - 156);
  if (text) {
    g.fillStyle = mark; g.font = '800 170px "Barlow Condensed", "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, S / 2, S / 2 + 6);
  } else drawEmblem(g, S, mark, 0.46);
  return c;
}
