import { C, Frame, MB, PK } from './core';

// ───────────────────────── outdoor props (world coordinates) ─────────────────────────
export function tree(mb: MB, x: number, z: number, s = 1, tone = 0) {
  const trunkH = 1.7 * s;
  mb.cbox(x, 0, z, 0.38 * s, trunkH, 0.38 * s, C.woodDark);
  const cols = [C.leaf, C.leafDark, C.leafLight];
  mb.prim(PK.ICO, x, trunkH + 0.85 * s, z, 2.7 * s, 2.3 * s, 2.7 * s, cols[tone % 3]);
  mb.prim(PK.ICO, x + 0.55 * s, trunkH + 0.25 * s, z - 0.3 * s, 1.6 * s, 1.4 * s, 1.6 * s, cols[(tone + 1) % 3]);
}
export function pine(mb: MB, x: number, z: number, s = 1) {
  mb.cbox(x, 0, z, 0.34 * s, 1.2 * s, 0.34 * s, C.woodDark);
  mb.prim(PK.CONE, x, 1.2 * s, z, 2.3 * s, 2.0 * s, 2.3 * s, C.leafDark);
  mb.prim(PK.CONE, x, 2.4 * s, z, 1.8 * s, 1.8 * s, 1.8 * s, C.leaf);
  mb.prim(PK.CONE, x, 3.5 * s, z, 1.2 * s, 1.5 * s, 1.2 * s, C.leafLight);
}
export function bush(mb: MB, x: number, z: number, s = 1, tone = 0) {
  const cols = [C.leaf, C.leafDark, C.leafLight];
  mb.box(x - 0.45 * s, 0, z - 0.45 * s, x + 0.45 * s, 0.7 * s, z + 0.45 * s, cols[tone % 3], { noPiece: true });
  mb.prim(PK.ICO, x, 0.4 * s, z, 1.1 * s, 0.9 * s, 1.1 * s, cols[tone % 3]);
}
export function lampPost(mb: MB, x: number, z: number, armDir: [number, number] = [0, 0]) {
  mb.cbox(x, 0, z, 0.18, 4.1, 0.18, C.charcoal);
  mb.cbox(x, 0, z, 0.38, 0.25, 0.38, C.charcoal, { solid: false });
  if (armDir[0] || armDir[1]) {
    mb.cbox(x + armDir[0] * 0.45, 3.95, z + armDir[1] * 0.45, 0.2 + Math.abs(armDir[0]) * 0.7, 0.12, 0.2 + Math.abs(armDir[1]) * 0.7, C.charcoal, { solid: false });
    mb.cbox(x + armDir[0] * 0.8, 3.78, z + armDir[1] * 0.8, 0.5, 0.2, 0.5, C.yellow, { solid: false });
  } else mb.prim(PK.SPHERE, x, 4.25, z, 0.5, 0.5, 0.5, C.yellow);
}
export function addSeat(mb: MB, x: number, y: number, z: number, yaw: number, group: number, name: string) {
  const id = mb.seats.length;
  mb.seats.push({ id, x, y, z, yaw, group, name });
  mb.interact('seat', x, y + 0.7, z, id, 'Sit', group);
}
/** Park/street bench. `along` = long axis, `facing` = which way the sitter faces on the other axis. */
export function bench(mb: MB, cx: number, cz: number, along: 'x' | 'z', facing: 1 | -1, y0 = 0, group = -1, color: number = C.wood) {
  const L = 1.8, D = 0.5;
  const yaw = along === 'x' ? (facing > 0 ? 0 : Math.PI) : facing > 0 ? Math.PI / 2 : -Math.PI / 2;
  const sx = along === 'x' ? L : D, sz = along === 'x' ? D : L;
  mb.cbox(cx, y0, cz, sx, 0.5, sz, color, { group });
  const bo = -facing * (D / 2 - 0.04);
  const bx = along === 'x' ? L : 0.08, bz = along === 'x' ? 0.08 : L;
  mb.cbox(cx + (along === 'z' ? bo : 0), y0 + 0.5, cz + (along === 'x' ? bo : 0), bx, 0.45, bz, color, { group });
  for (const o of [-0.45, 0.45])
    addSeat(mb, cx + (along === 'x' ? o : 0) - (along === 'z' ? facing * 0.05 : 0), y0, cz + (along === 'z' ? o : 0) - (along === 'x' ? facing * 0.05 : 0), yaw, group, 'bench');
}
export function mailbox(mb: MB, x: number, z: number, color: number = C.blueDark) {
  mb.cbox(x, 0, z, 0.1, 0.95, 0.1, C.charcoal);
  mb.cbox(x, 0.95, z, 0.34, 0.26, 0.5, color);
}
export function trashBin(mb: MB, x: number, z: number, color: number = C.sageDark, y0 = 0) {
  mb.cbox(x, y0, z, 0.55, 0.9, 0.55, color);
  mb.cbox(x, y0 + 0.9, z, 0.62, 0.08, 0.62, C.charcoal, { solid: false });
}
export function hedge(mb: MB, x0: number, z0: number, x1: number, z1: number, h = 1.1, color: number = C.leafDark) {
  mb.box(x0, 0, z0, x1, h, z1, color);
}
export function fenceX(mb: MB, x0: number, x1: number, z: number, h = 0.7, color: number = C.white) {
  mb.box(x0, 0, z - 0.05, x1, h, z + 0.05, color);
}
export function fenceZ(mb: MB, z0: number, z1: number, x: number, h = 0.7, color: number = C.white) {
  mb.box(x - 0.05, 0, z0, x + 0.05, h, z1, color);
}
export function car(mb: MB, x: number, z: number, along: 'x' | 'z', color: number, group = -1) {
  const L = 4.3, W = 1.85;
  const sx = along === 'x' ? L : W, sz = along === 'x' ? W : L;
  mb.cbox(x, 0.28, z, sx, 0.72, sz, color, { solid: false, group });
  const cx = along === 'x' ? 2.2 : W - 0.1, cz = along === 'x' ? W - 0.1 : 2.2;
  mb.cbox(x - (along === 'x' ? 0.2 : 0), 1.0, z - (along === 'z' ? 0.2 : 0), cx, 0.55, cz, color, { solid: false, group });
  mb.cbox(x - (along === 'x' ? 0.2 : 0), 1.05, z - (along === 'z' ? 0.2 : 0), cx + (along === 'x' ? 0.04 : 0.06), 0.4, cz + (along === 'z' ? 0.04 : 0.06), 0x6f8aa3, { solid: false, alpha: 0.9, cast: false, group });
  mb.cbox(x, 0, z, sx, 1.45, sz, color, { noPiece: true, group });
  for (const a of [-1.35, 1.35])
    for (const b of [-0.85, 0.85]) {
      const wx = along === 'x' ? x + a : x + b, wz = along === 'x' ? z + b : z + a;
      mb.prim(PK.CYL, wx, 0.32, wz, 0.64, along === 'x' ? 0.24 : 0.24, 0.64, C.charcoal, { ry: 0 });
    }
}
export function streetSign(mb: MB, x: number, z: number, text: string, ry: number) {
  mb.cbox(x, 0, z, 0.1, 2.6, 0.1, C.charcoal);
  mb.label(text, x, 2.55, z, 1.5, 0.36, ry, C.sageDark, C.white);
  mb.label(text, x, 2.55, z, 1.5, 0.36, ry + Math.PI, C.sageDark, C.white);
}

// ───────────────────────── interior props (framed) ─────────────────────────
type Side = 'u0' | 'u1' | 'v0' | 'v1';
export function sofa(mb: MB, f: Frame, u0: number, v0: number, u1: number, v1: number, y0: number, color: number, back: Side, group: number, name = 'sofa') {
  const T = 0.3, A = 0.22, base = 0.5;
  mb.fbox(f, u0, v0, u1, v1, y0, y0 + base, color, { group });
  const bu0 = back === 'u0' ? u0 : back === 'u1' ? u1 - T : u0;
  const bu1 = back === 'u0' ? u0 + T : back === 'u1' ? u1 : u1;
  const bv0 = back === 'v0' ? v0 : back === 'v1' ? v1 - T : v0;
  const bv1 = back === 'v0' ? v0 + T : back === 'v1' ? v1 : v1;
  mb.fbox(f, bu0, bv0, bu1, bv1, y0 + base, y0 + 0.98, color, { group });
  const alongU = back === 'v0' || back === 'v1';
  if (alongU) {
    mb.fbox(f, u0, v0, u0 + A, v1, y0 + base, y0 + 0.75, color, { group });
    mb.fbox(f, u1 - A, v0, u1, v1, y0 + base, y0 + 0.75, color, { group });
  } else {
    mb.fbox(f, u0, v0, u1, v0 + A, y0 + base, y0 + 0.75, color, { group });
    mb.fbox(f, u0, v1 - A, u1, v1, y0 + base, y0 + 0.75, color, { group });
  }
  const dir: [number, number] = back === 'u0' ? [1, 0] : back === 'u1' ? [-1, 0] : back === 'v0' ? [0, 1] : [0, -1];
  const [dx, dz] = f.vec(dir[0], dir[1]);
  const yaw = Math.atan2(dx, dz);
  const len = alongU ? u1 - u0 : v1 - v0;
  const n = len > 1.9 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const cu = alongU ? u0 + (u1 - u0) * t : (u0 + u1) / 2 - dir[0] * 0.1;
    const cv = alongU ? (v0 + v1) / 2 - dir[1] * 0.1 : v0 + (v1 - v0) * t;
    const [x, z] = f.p(cu, cv);
    addSeat(mb, x, y0, z, yaw, group, name);
  }
}
export function table(mb: MB, f: Frame, u0: number, v0: number, u1: number, v1: number, y0: number, h: number, color: number, group: number) {
  mb.fbox(f, u0, v0, u1, v1, y0 + h - 0.08, y0 + h, color, { group });
  const l = 0.1;
  for (const [a, b] of [[u0 + 0.05, v0 + 0.05], [u1 - 0.05 - l, v0 + 0.05], [u0 + 0.05, v1 - 0.05 - l], [u1 - 0.05 - l, v1 - 0.05 - l]])
    mb.fbox(f, a, b, a + l, b + l, y0, y0 + h - 0.08, color, { group, solid: false });
  mb.fbox(f, u0, v0, u1, v1, y0, y0 + h, color, { group, noPiece: true });
}
export function plant(mb: MB, f: Frame, u: number, v: number, y0: number, group: number, s = 1) {
  const [x, z] = f.p(u, v);
  mb.cbox(x, y0, z, 0.38 * s, 0.4 * s, 0.38 * s, C.terra, { group });
  mb.prim(PK.ICO, x, y0 + 0.4 * s + 0.4 * s, z, 0.7 * s, 0.8 * s, 0.7 * s, C.leaf, { group });
}
export function rug(mb: MB, f: Frame, u0: number, v0: number, u1: number, v1: number, y0: number, color: number, group: number) {
  mb.fbox(f, u0, v0, u1, v1, y0, y0 + 0.025, color, { group, solid: false, cast: false });
}
export function addSwitch(mb: MB, x: number, y: number, z: number, group: number, name: string): number {
  const id = mb.switches.length;
  mb.switches.push({ id, x, y, z, group, name });
  mb.interact('switch', x, y, z, id, name, group);
  return id;
}
export function addLamp(mb: MB, switchId: number, x: number, y: number, z: number, group: number, color: number = C.yellow) {
  mb.lamps.push({ id: mb.lamps.length, switchId, x, y, z, color, group });
}
/** Small flat wall plaque with text, facing along the given local normal. */
export function wallLabel(mb: MB, f: Frame, u: number, v: number, y: number, w: number, h: number, text: string, bg: number, fg: number, normal: [number, number], group: number) {
  const [x, z] = f.p(u, v);
  const [nx, nz] = f.vec(normal[0], normal[1]);
  mb.label(text, x + nx * 0.02, y, z + nz * 0.02, w, h, Math.atan2(nx, nz), bg, fg, group);
}
export function addFound(mb: MB, x: number, y: number, z: number, name: string, text: string, group = -1) {
  const id = mb.found.length;
  mb.found.push({ id, x, y, z, name, text, group });
  mb.interact('found', x, y + 0.4, z, id, `Pick up ${name}`, group);
}
