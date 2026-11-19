import { C, Frame, MB, PK } from './core';
import { addFound, addLamp, addSwitch, bench, bush, mailbox, plant, rug, sofa, table, tree, wallLabel } from './props';

export interface HouseSpec {
  bid: number; number: string; owner: string; frame: Frame; enterable: boolean;
  wall: number; trim: number; roof: number; door: number; accent: number; variant: 0 | 1;
  yardTree?: boolean; secret?: boolean;
}

export const HOUSE_W = 10, HOUSE_D = 9;
const FY = 0.2, TOP = 3.0, T = 0.26;
const W = HOUSE_W, D = HOUSE_D;

/** One house: exterior + (for enterable ones) a fully furnished interior with operable doors. */
export function buildHouse(mb: MB, s: HouseSpec): void {
  const f = s.frame;
  const g0 = mb.newGroup(s.bid, 0), g1 = mb.newGroup(s.bid, 1);
  const [bx0, bz0, bx1, bz1] = f.rect(-0.14, -0.14, W + 0.14, D + 0.14);
  mb.buildings.push({ id: s.bid, name: `No. ${s.number}`, x0: bx0, z0: bz0, x1: bx1, z1: bz1, floors: [FY], levelGroups: [g0, g1] });
  mb.mapRects.push({ x0: bx0, z0: bz0, x1: bx1, z1: bz1, color: s.wall, kind: 'building' });
  const zone = (name: string, u0: number, v0: number, u1: number, v1: number, prio: number) => {
    const [x0, z0, x1, z1] = f.rect(u0, v0, u1, v1);
    mb.zones.push({ name, x0, z0, x1, z1, prio, building: s.bid });
  };
  zone(`No. ${s.number}`, -0.2, -0.2, W + 0.2, D + 0.2, 5);

  // ── floors
  const fl = (u0: number, v0: number, u1: number, v1: number, color: number) => mb.fbox(f, u0, v0, u1, v1, 0, FY, color, { group: g0 });
  if (s.enterable) {
    fl(-0.13, -0.13, 5.0, 5.2, C.wood); fl(5.0, -0.13, W + 0.13, 5.2, C.tile);
    fl(-0.13, 5.2, 5.0, D + 0.13, C.sage); fl(5.0, 5.2, 6.4, D + 0.13, C.wood); fl(6.4, 5.2, W + 0.13, D + 0.13, C.grey);
  } else fl(-0.13, -0.13, W + 0.13, D + 0.13, C.sand);
  mb.fbox(f, 3.4, -1.5, 6.6, -0.13, 0, FY, C.grey, { group: g0 });   // porch

  // ── exterior walls
  const front = [{ a: 1.0, b: 3.2, lo: 1.0, hi: 2.3, glass: true }, { a: 6.8, b: 9.0, lo: 1.0, hi: 2.3, glass: true }];
  if (s.enterable) front.push({ a: 4.4, b: 5.6, lo: FY, hi: FY + 2.15, glass: false });
  const back = [{ a: 1.4, b: 3.6, lo: 1.0, hi: 2.3, glass: true }, { a: 7.2, b: 9.0, lo: 1.0, hi: 2.3, glass: true }];
  if (s.enterable) back.push({ a: 5.1, b: 6.3, lo: FY, hi: FY + 2.15, glass: false });
  const side = [{ a: 1.8, b: 3.8, lo: 1.0, hi: 2.3, glass: true }, { a: 6.0, b: 8.0, lo: 1.0, hi: 2.3, glass: true }];
  const wo = (outerSide: 1 | -1) => ({ group: g0, inner: C.offWhite, outerSide });
  mb.wall(f, 'u', 0, -T / 2, W + T / 2, FY, TOP, T, s.wall, front, wo(-1));
  mb.wall(f, 'u', D, -T / 2, W + T / 2, FY, TOP, T, s.wall, back, wo(1));
  mb.wall(f, 'v', 0, T / 2, D - T / 2, FY, TOP, T, s.wall, side, wo(-1));
  mb.wall(f, 'v', W, T / 2, D - T / 2, FY, TOP, T, s.wall, side, wo(1));
  // plinth band + eave trim
  for (const [a, b, c, d] of [[-T / 2, W + T / 2, -T / 2 - 0.04, -T / 2], [-T / 2, W + T / 2, D + T / 2, D + T / 2 + 0.04]] as const)
    mb.fbox(f, a, c, b, d, FY, FY + 0.35, s.trim, { group: g0, solid: false });
  mb.fbox(f, -0.3, -0.3, W + 0.3, D + 0.3, TOP, TOP + 0.18, s.trim, { group: g1, solid: false });

  // ── door, plates, awning
  if (s.enterable) {
    mb.door(f, 'u', 0, 4.4, 1.2, FY, 2.15, { hingeA: true, swing: 1, color: s.door, group: g0, name: 'Front door' });
    const [dbx, dbz] = f.p(6.05, -0.5);
    mb.interact('bell', dbx, 1.3, dbz, 0, 'Ring doorbell', g0);
  } else mb.lockedDoor(f, 'u', 0, 4.4, 1.2, FY, 2.15, s.door, g0, 'Locked door', T, -1);
  mb.fbox(f, 3.7, -1.4, 6.3, -T / 2, FY + 2.3, FY + 2.42, s.trim, { group: g0, solid: false });
  for (const u of [3.8, 6.2]) mb.fbox(f, u - 0.05, -1.4, u + 0.05, -1.3, FY, FY + 2.3, s.trim, { group: g0, solid: false });
  wallLabel(mb, f, 6.4, -T / 2, 1.7, 0.42, 0.42, s.number, C.charcoal, C.white, [0, -1], g0);
  wallLabel(mb, f, 3.35, -T / 2, 1.45, 1.1, 0.3, s.owner, C.beige, C.charcoal, [0, -1], g0);

  // ── roof (hidden when you step inside)
  const [cx, cz] = f.p(W / 2, D / 2);
  const odd = f.rot % 2 === 1;
  mb.prim(PK.GABLE, cx, TOP + 0.18 + 0.85, cz, W + 1.0, 1.7, D + 1.0, s.roof, { ry: odd ? Math.PI / 2 : 0, group: g1 });
  const [chx, chz] = f.p(W * 0.78, D * 0.3);
  mb.cbox(chx, TOP, chz, 0.6, 2.3, 0.6, s.trim, { group: g1, solid: false });
  mb.chimneys.push({ x: chx, y: TOP + 2.35, z: chz });

  // ── yards (visual + low fences)
  const lawn = (u0: number, v0: number, u1: number, v1: number, color: number) => {
    const [x0, z0, x1, z1] = f.rect(u0, v0, u1, v1);
    mb.box(x0, 0, z0, x1, 0.03, z1, color, { solid: false, cast: false });
  };
  lawn(-1.6, -3.95, W + 1.6, -0.14, C.grassLight);
  lawn(4.15, -3.95, 5.85, -1.5, C.path);
  lawn(-1.6, D + 0.14, W + 1.6, D + 4.4, C.grassLight);
  const fenceU = (u0: number, u1: number, v: number, h: number, col: number) => { const [x0, z0, x1, z1] = f.rect(u0, v - 0.05, u1, v + 0.05); mb.box(x0, 0, z0, x1, h, z1, col); };
  const fenceV = (v0: number, v1: number, u: number, h: number, col: number) => { const [x0, z0, x1, z1] = f.rect(u - 0.05, v0, u + 0.05, v1); mb.box(x0, 0, z0, x1, h, z1, col); };
  fenceU(-1.6, 3.9, -3.6, 0.7, C.white); fenceU(6.1, W + 1.6, -3.6, 0.7, C.white);
  fenceV(-3.6, 0, -1.6, 0.7, C.white); fenceV(-3.6, 0, W + 1.6, 0.7, C.white);
  fenceU(-1.6, W + 1.6, D + 4.4, 0.95, C.beige); fenceV(D + 0.14, D + 4.4, -1.6, 0.95, C.beige); fenceV(D + 0.14, D + 4.4, W + 1.6, 0.95, C.beige);
  fenceV(0, D + 0.14, -1.6, 0.95, C.beige); fenceV(0, D + 0.14, W + 1.6, 0.95, C.beige);
  { const [mx, mz] = f.p(7.2, -3.9); mailbox(mb, mx, mz, s.accent); }
  { const [x, z] = f.p(-0.9, -1.7); bush(mb, x, z, 1, 0); }
  { const [x, z] = f.p(W + 0.9, -1.7); bush(mb, x, z, 1, 2); }
  if (s.yardTree) { const [x, z] = f.p(1.5, -2.4); tree(mb, x, z, 1, s.variant); }
  { const [x, z] = f.p(8.6, D + 2.6); tree(mb, x, z, 0.9, 1 + s.variant); }
  { const [x, z] = f.p(0.4, D + 3.6); bush(mb, x, z, 1, 1); }

  if (!s.enterable) return;

  // ═════════ interior ═════════
  const v = s.variant;
  zone('Living room', 0, 0, 5.0, 5.2, 6); zone('Kitchen', 5.0, 0, W, 5.2, 6); zone('Bedroom', 0, 5.2, 5.0, D, 6);
  zone('Hall', 5.0, 5.2, 6.4, D, 6); zone('Storage room', 6.4, 5.2, W, D, 6); zone('Backyard', -1.6, D + 0.2, W + 1.6, D + 4.4, 6);
  const IT = 0.2;
  const iw = { group: g0 };
  // partitions
  mb.wall(f, 'u', 5.2, 0, W, FY, TOP, IT, C.offWhite, [{ a: 5.0, b: 6.4, lo: FY, hi: FY + 2.3 }], iw);
  mb.wall(f, 'v', 5.0, 5.2, D, FY, TOP, IT, C.offWhite, [{ a: 6.3, b: 7.4, lo: FY, hi: FY + 2.1 }], iw);
  mb.wall(f, 'v', 6.4, 5.2, D, FY, TOP, IT, C.offWhite, [{ a: 6.5, b: 7.6, lo: FY, hi: FY + 2.1 }], iw);
  mb.door(f, 'v', 5.0, 6.3, 1.1, FY, 2.1, { hingeA: true, swing: -1, color: C.beige, group: g0, name: 'Bedroom door' });
  mb.door(f, 'v', 6.4, 6.5, 1.1, FY, 2.1, { hingeA: true, swing: 1, color: C.beige, group: g0, name: 'Storage door' });
  mb.door(f, 'u', D, 5.1, 1.2, FY, 2.15, { hingeA: true, swing: 1, color: s.door, group: g0, name: 'Back door' });

  // lights
  const [s1x, s1z] = f.p(3.9, 0.22), [s2x, s2z] = f.p(4.82, 5.7);
  const sw1 = addSwitch(mb, s1x, 1.3, s1z, g0, 'Light switch');
  const sw2 = addSwitch(mb, s2x, 1.3, s2z, g0, 'Bedroom switch');
  { const [x, z] = f.p(2.5, 2.6); addLamp(mb, sw1, x, TOP - 0.25, z, g0); }
  { const [x, z] = f.p(7.6, 2.4); addLamp(mb, sw1, x, TOP - 0.25, z, g0); }
  { const [x, z] = f.p(2.5, 7.0); addLamp(mb, sw2, x, TOP - 0.25, z, g0); }

  // living room
  sofa(mb, f, 0.6, 0.95, 3.6, 1.95, FY, s.accent, 'v0', g0, 'sofa');
  table(mb, f, 1.3, 2.55, 2.9, 3.45, FY, 0.52, C.woodDark, g0);
  rug(mb, f, 0.5, 2.2, 3.7, 4.1, FY, v ? C.rugBlue : C.rug, g0);
  mb.fbox(f, 1.2, 4.62, 3.2, 5.06, FY, FY + 0.5, C.woodDark, iw);
  mb.fbox(f, 1.55, 4.8, 2.85, 4.88, FY + 0.85, FY + 1.5, C.charcoal, { group: g0, solid: false });
  { const [x, z] = f.p(2.2, 4.6); mb.interact('info', x, FY + 1.1, z, 0, 'Check the TV', g0, 'Nothing but static. A broadcast studio is a later prototype.'); }
  sofa(mb, f, 4.0, 3.2, 4.8, 4.0, FY, s.trim, 'u1', g0, 'armchair');
  plant(mb, f, 0.5, 0.55, FY, g0, 1.2); plant(mb, f, 0.45, 4.8, FY, g0, 1);

  // kitchen
  mb.fbox(f, 9.15, 0.4, 9.88, 4.9, FY, FY + 0.9, C.offWhite, iw);
  mb.fbox(f, 9.1, 0.35, 9.93, 4.95, FY + 0.9, FY + 0.97, C.woodDark, { group: g0, solid: false });
  mb.fbox(f, 7.6, 4.45, 9.15, 5.08, FY, FY + 0.9, C.offWhite, iw);
  mb.fbox(f, 7.55, 4.4, 9.15, 5.1, FY + 0.9, FY + 0.97, C.woodDark, { group: g0, solid: false });
  mb.fbox(f, 6.55, 4.35, 7.4, 5.08, FY, FY + 1.85, C.grey, iw);   // fridge
  { const [x, z] = f.p(7.0, 4.3); mb.interact('info', x, FY + 1.2, z, 0, 'Open the fridge', g0, 'Oat milk, a lemon, and a note that says "Neighbors welcome". Nothing worth stealing — yet.'); }
  mb.fbox(f, 6.5, 2.0, 8.3, 3.0, FY, FY + 0.92, C.beige, iw);
  mb.fbox(f, 6.4, 1.9, 8.4, 3.1, FY + 0.92, FY + 1.0, C.woodDark, { group: g0, solid: false });
  for (const u of [6.9, 7.9]) mb.fbox(f, u - 0.18, 3.35, u + 0.18, 3.71, FY, FY + 0.56, s.accent, iw);
  rug(mb, f, 5.7, 0.4, 9.0, 1.5, FY, C.beige, g0);

  // bedroom
  mb.fbox(f, 0.4, 6.7, 2.6, 8.82, FY, FY + 0.52, C.woodDark, iw);
  mb.fbox(f, 0.45, 6.75, 2.55, 8.78, FY + 0.52, FY + 0.7, v ? C.blue : C.offWhite, { group: g0, solid: false });
  mb.fbox(f, 0.45, 8.0, 2.55, 8.78, FY + 0.7, FY + 0.82, C.white, { group: g0, solid: false });
  mb.fbox(f, 0.4, 8.78, 2.6, 8.9, FY, FY + 1.2, C.woodDark, { group: g0, solid: false });
  mb.fbox(f, 3.55, 8.2, 4.85, 8.88, FY, FY + 2.1, C.wood, iw);
  mb.fbox(f, 2.75, 8.3, 3.3, 8.85, FY, FY + 0.5, C.woodDark, iw);
  { const [x, z] = f.p(3.02, 8.57); mb.prim(PK.SPHERE, x, FY + 0.68, z, 0.28, 0.28, 0.28, C.yellow, { group: g0 }); }
  rug(mb, f, 0.3, 5.5, 3.3, 6.5, FY, v ? C.rug : C.rugBlue, g0);

  // hall + storage
  rug(mb, f, 5.3, 5.5, 6.1, 8.7, FY, C.rug, g0);
  mb.fbox(f, 7.0, 8.45, 9.7, 8.9, FY, FY + 1.9, C.wood, iw);
  for (const [u, y, c] of [[7.4, 1.05, C.terra], [8.4, 1.05, C.blue], [9.1, 1.45, C.yellow]] as const) mb.fbox(f, u - 0.25, 8.5, u + 0.25, 8.85, FY + y - 0.3, FY + y + 0.1, c, { group: g0, solid: false });
  mb.fbox(f, 9.0, 5.6, 9.85, 6.45, FY, FY + 0.8, C.woodDark, iw);
  mb.fbox(f, 9.15, 5.75, 9.7, 6.3, FY + 0.8, FY + 1.5, C.wood, iw);
  mb.fbox(f, 6.7, 8.1, 7.5, 8.9, FY, FY + 0.7, C.charcoal, iw);   // safe
  { const [x, z] = f.p(7.1, 8.1); mb.prim(PK.CYL, x, FY + 0.42, z, 0.2, 0.05, 0.2, C.gold, { group: g0 }); mb.interact('info', x, FY + 0.5, z, 0, 'Inspect safe', g0, 'A heavy safe. Vaults, valuables and security arrive in a later prototype.'); }
  if (s.secret) { const [x, z] = f.p(8.0, 5.95); addFound(mb, x, FY + 0.05, z, 'Brass Key', 'A tarnished brass key, wedged behind the crates. It does not fit anything here. Yet.', g0); }

  // backyard
  mb.fbox(f, 4.1, D + 0.14, 7.3, D + 2.2, 0, 0.05, C.path, { group: -1, solid: false });
  table(mb, f, 4.6, D + 1.0, 6.2, D + 1.9, 0.05, 0.75, C.woodDark, -1);
  for (const u of [4.5, 6.3]) mb.fbox(f, u - 0.2, D + 1.2, u + 0.2, D + 1.6, 0.05, 0.5, C.terra, { group: -1 });
  { // bench along the back fence, facing the house
    const [bx, bz] = f.p(1.8, D + 3.9);
    const [fx, fz] = f.vec(0, -1);
    if (Math.abs(fx) > Math.abs(fz)) bench(mb, bx, bz, 'z', fx > 0 ? 1 : -1, 0, -1);
    else bench(mb, bx, bz, 'x', fz > 0 ? 1 : -1, 0, -1);
  }
}
