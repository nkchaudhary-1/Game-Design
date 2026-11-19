import { TAG_CAB, TAG_NOCAM } from '../collision';
import { C, Frame, MB, PK, type LiftDef, type LiftPart } from './core';
import { addFound, addLamp, addSwitch, bench, plant, rug, sofa, table, wallLabel } from './props';

export const APT = {
  W: 24, D: 18, WT: 0.3, IT: 0.2, SLAB: 0.25,
  F: [0.2, 3.4, 6.6, 9.8, 13.0],           // floor-top y: ground, 1, 2, 3, roof
  names: ['G', '1', '2', '3'],
  levelNames: ['Ground floor', 'Floor 1', 'Floor 2', 'Floor 3', 'Roof terrace'],
};
type R = [number, number, number, number];
function subtract(r: R, holes: R[]): R[] {
  let out: R[] = [r];
  for (const h of holes) {
    const next: R[] = [];
    for (const a of out) {
      if (h[2] <= a[0] || h[0] >= a[2] || h[3] <= a[1] || h[1] >= a[3]) { next.push(a); continue; }
      if (h[0] > a[0]) next.push([a[0], a[1], h[0], a[3]]);
      if (h[2] < a[2]) next.push([h[2], a[1], a[2], a[3]]);
      const m0 = Math.max(a[0], h[0]), m1 = Math.min(a[2], h[2]);
      if (h[1] > a[1]) next.push([m0, a[1], m1, h[1]]);
      if (h[3] < a[3]) next.push([m0, h[3], m1, a[3]]);
    }
    out = next;
  }
  return out;
}

/** Maple Court: lobby + 3 floors + roof terrace, a dog-leg stair and a real lift. Frame must be unrotated (lift doors face −z). */
export function buildApartment(mb: MB, f: Frame, bid: number): LiftDef {
  if (f.rot !== 0 || f.mirror) throw new Error('apartment frame must be rot 0');
  const { W, D, WT, IT, SLAB, F } = APT;
  const G = [0, 1, 2, 3, 4, 5].map((l) => mb.newGroup(bid, l));
  const [x0, z0, x1, z1] = f.rect(-0.3, -0.3, W + 0.3, D + 0.3);
  mb.buildings.push({ id: bid, name: 'Maple Court', x0, z0, x1, z1, floors: [...F], levelGroups: G });
  mb.mapRects.push({ x0, z0, x1, z1, color: C.blue, kind: 'building' });
  mb.zones.push({ name: 'Maple Court', x0: x0, z0, x1, z1, prio: 5, building: bid });
  const zone = (name: string, u0: number, v0: number, u1: number, v1: number, y0?: number, y1?: number) => {
    const [a, b, c, d] = f.rect(u0, v0, u1, v1);
    mb.zones.push({ name, x0: a, z0: b, x1: c, z1: d, prio: 6, building: bid, y0, y1 });
  };
  const SH0 = 9.85, SH1 = 12.8;           // lift shaft block v-range
  const holes = (k: number): R[] => {
    const h: R[] = [[11.7, 11.0, 14.4, 13.9], [13.0, 10.0, 14.4, 11.0]];
    if (k >= 1 && k <= 3) h.push([8.8, 10.05, 11.2, 12.5]);
    return h;
  };

  // ── slabs
  mb.fbox(f, -0.27, -0.27, W + 0.27, D + 0.27, 0, F[0], C.offWhite, { group: G[0] });
  for (let k = 1; k <= 4; k++) {
    for (const r of subtract([-0.27, -0.27, W + 0.27, D + 0.27], holes(k)))
      mb.fbox(f, r[0], r[1], r[2], r[3], F[k] - SLAB, F[k], k === 4 ? C.grey : C.offWhite, { group: G[k] });
    if (k <= 3) mb.fbox(f, 0.3, 6.7, W - 0.3, 9.9, F[k], F[k] + 0.02, C.rugBlue, { group: G[k], solid: false, cast: false });
  }
  mb.fbox(f, 0.3, 0.3, W - 0.3, 9.9, F[0], F[0] + 0.02, C.tile, { group: G[0], solid: false, cast: false });
  mb.fbox(f, 0.3, 0.3, W - 0.3, 0.9, F[0], F[0] + 0.03, C.beige, { group: G[0], solid: false, cast: false });

  // ── levels
  const win = (a: number, b: number, k: number, lo = 0.9, hi = 2.3) => ({ a, b, lo: F[k] + lo, hi: F[k] + hi, glass: true });
  for (let k = 0; k <= 3; k++) {
    const yb = F[k], yt = F[k + 1] - SLAB, g = G[k];
    const ext = (outerSide: 1 | -1) => ({ group: g, inner: C.offWhite, outerSide });
    const frontOps = k === 0
      ? [{ a: 11.2, b: 12.8, lo: yb, hi: yb + 2.25, glass: false }, win(2.0, 6.0, 0, 0.5, 2.5), win(18.0, 22.0, 0, 0.5, 2.5)]
      : [win(2.6, 5.0, k), win(7.0, 9.4, k), win(14.6, 17.0, k), win(19.0, 21.4, k)];
    const backOps = k === 0 ? [win(3.0, 5.5, 0), win(18.5, 21.0, 0)] : [win(2.6, 5.0, k), win(7.0, 9.4, k), win(14.6, 17.0, k), win(19.0, 21.4, k)];
    const sideOps = k === 0 ? [win(2.2, 4.6, 0, 0.7, 2.3), win(5.8, 8.2, 0, 0.7, 2.3)] : [win(7.0, 9.3, k)];
    mb.wall(f, 'u', 0, -WT / 2, W + WT / 2, yb, yt, WT, C.blue, frontOps, ext(-1));
    mb.wall(f, 'u', D, -WT / 2, W + WT / 2, yb, yt, WT, C.blue, backOps, ext(1));
    mb.wall(f, 'v', 0, WT / 2, D - WT / 2, yb, yt, WT, C.blue, sideOps, ext(-1));
    mb.wall(f, 'v', W, WT / 2, D - WT / 2, yb, yt, WT, C.blue, sideOps, ext(1));

    // lift shaft block (three solid walls + front wall with the landing opening)
    const cw = { group: g };
    mb.fbox(f, 8.5, SH0, 8.8, SH1, yb, yt, C.offWhite, cw);
    mb.fbox(f, 11.2, SH0, 11.5, SH1, yb, yt, C.offWhite, cw);
    mb.fbox(f, 8.8, 12.5, 11.2, SH1, yb, yt, C.offWhite, cw);
    mb.wall(f, 'u', 9.95, 8.5, 11.5, yb, yt, 0.2, C.offWhite, [{ a: 9.4, b: 10.6, lo: yb, hi: yb + 2.2 }], cw);
    // stair well walls + service block
    mb.fbox(f, 11.5, 10.0, 11.7, 14.1, yb, yt, C.offWhite, cw);
    mb.fbox(f, 14.4, 10.0, 14.6, 14.1, yb, yt, C.offWhite, cw);
    mb.fbox(f, 11.7, 13.9, 14.4, 14.1, yb, yt, C.offWhite, cw);
    mb.fbox(f, 8.5, 14.1, 14.6, D - 0.15, yb, yt, C.sand, cw);

    const door = (n: string) => `${k}${n}`;
    if (k === 0) {
      mb.fbox(f, 0.15, 10.0, 8.5, D - 0.15, yb, yt, C.sand, cw);                 // parcel room (locked)
      mb.lockedDoor(f, 'u', 10.0, 3.5, 1.0, yb, 2.1, C.terra, g, 'Parcel room', 0, -1);
      wallLabel(mb, f, 4.0, 9.97, 2.35, 1.3, 0.28, 'PARCELS', C.charcoal, C.white, [0, -1], g);
      // residents' lounge (hollow, enterable)
      mb.wall(f, 'u', 10.0, 14.6, W - 0.15, yb, yt, IT, C.sand, [{ a: 19.0, b: 20.1, lo: yb, hi: yb + 2.1 }], cw);
      mb.door(f, 'u', 10.0, 19.0, 1.1, yb, 2.1, { hingeA: true, swing: 1, color: C.terra, group: g, name: "Residents' lounge door" });
      wallLabel(mb, f, 21.7, 9.89, 1.9, 1.5, 0.3, "RESIDENTS' LOUNGE", C.charcoal, C.white, [0, -1], g);
      zone('Lobby', 0.3, 0.3, W - 0.3, 9.9, F[0] - 0.3, F[0] + 2.8);
      zone("Residents' lounge", 14.7, 10.2, W - 0.15, D - 0.15, F[0] - 0.3, F[0] + 2.8);
      lounge(mb, f, g);
    } else {
      // unit blocks: solid, each with a numbered (locked) corridor door
      mb.fbox(f, 0.15, 0.15, 12.0, 6.6, yb, yt, C.sand, cw);
      mb.fbox(f, 0.15, 10.0, 8.5, D - 0.15, yb, yt, C.sand, cw);
      mb.fbox(f, 14.6, 10.0, W - 0.15, D - 0.15, yb, yt, C.sand, cw);
      const plate = (u: number, v: number, text: string, n: 1 | -1) => wallLabel(mb, f, u, v, 1.7, 0.4, 0.28, text, C.charcoal, C.white, [0, n], g);
      mb.lockedDoor(f, 'u', 6.6, 4.0, 1.0, yb, 2.1, C.terra, g, `Unit ${door('A')}`, 0, 1); plate(5.5, 6.62, door('A'), 1);
      mb.lockedDoor(f, 'u', 10.0, 3.5, 1.0, yb, 2.1, C.terraDark, g, `Unit ${door('C')}`, 0, -1); plate(4.9, 9.98, door('C'), -1);
      mb.lockedDoor(f, 'u', 10.0, 19.0, 1.0, yb, 2.1, C.blueDark, g, `Unit ${door('D')}`, 0, -1); plate(20.4, 9.98, door('D'), -1);
      if (k === 1) {
        openUnit(mb, f, g);
        zone('Unit 1B', 12.3, 0.2, W - 0.15, 6.4, F[1] - 0.3, F[1] + 2.8);
      } else {
        mb.fbox(f, 12.0, 0.15, W - 0.15, 6.6, yb, yt, C.sand, cw);
        mb.lockedDoor(f, 'u', 6.6, 17.0, 1.0, yb, 2.1, C.sageDark, g, `Unit ${door('B')}`, 0, 1); plate(18.1, 6.62, door('B'), 1);
      }
      if (k === 1) plate(18.1, 6.62, '1B', 1);
      zone(`${APT.levelNames[k]} corridor`, 0.3, 6.6, W - 0.3, 10.0, F[k] - 0.3, F[k] + 2.8);
    }
    // numbers + lift/stairs signage
    wallLabel(mb, f, 13.0, 9.93, yb + 2.65, 0.55, 0.38, APT.names[k], C.charcoal, C.gold, [0, -1], g);
    wallLabel(mb, f, 12.9, 9.995, yb + 1.9, 1.0, 0.26, 'STAIRS', C.sageDark, C.white, [0, -1], g);
    wallLabel(mb, f, 11.05, 9.84, yb + 1.75, 0.34, 0.26, 'LIFT', C.charcoal, C.white, [0, -1], g);
  }

  // ── stairs: dog-leg stacked in the core. Lane A (u 11.8–13.0) climbs south, lane B (13.2–14.4) climbs back north.
  for (let k = 0; k <= 3; k++) {
    const base = F[k], g = G[k];
    const tread = (u0: number, u1: number, v0: number, v1: number, top: number) =>
      mb.fbox(f, u0, v0, u1, v1, Math.max(base, top - 0.4), top, C.beige, { group: g });
    for (let i = 1; i <= 8; i++) {
      tread(11.8, 13.0, 10.0 + 0.3 * (i - 1), 10.0 + 0.3 * i, base + 0.2 * i);
      tread(13.2, 14.4, 12.4 - 0.3 * i, 12.4 - 0.3 * (i - 1), base + 1.6 + 0.2 * i);
    }
    tread(11.8, 14.4, 12.4, 13.9, base + 1.6);
    mb.fbox(f, 13.0, 10.0, 13.2, 12.4, base, base + 4.2, C.offWhite, { group: g });   // stringer, doubles as the railing above
  }

  // ── lift
  const lift = buildLift(mb, f, G);

  // ── entrance, signage, lobby dressing
  mb.door(f, 'u', 0, 11.2, 1.6, F[0], 2.25, { hingeA: true, swing: 1, color: C.terra, group: G[0], name: 'Main entrance' });
  mb.fbox(f, 9.8, -2.3, 14.2, -0.27, F[0] + 2.5, F[0] + 2.65, C.terra, { group: G[0], solid: false });
  for (const u of [10.0, 14.0]) mb.fbox(f, u - 0.08, -2.2, u + 0.08, -2.04, F[0], F[0] + 2.5, C.charcoal, { group: G[0] });
  { const [lx, lz] = f.p(12.0, -0.5); mb.label('MAPLE COURT', lx, F[0] + 2.95, lz, 3.4, 0.5, Math.PI, C.charcoal, C.white, G[0]); }
  mb.fbox(f, 9.6, -3.5, 14.4, -0.27, 0, 0.03, C.path, { solid: false, cast: false });
  mb.fbox(f, 11.1, -3.95, 12.9, -3.5, 0, 0.03, C.path, { solid: false, cast: false });
  lobby(mb, f, G[0]);
  roof(mb, f, G);
  return lift;
}

function lobby(mb: MB, f: Frame, g: number) {
  const y = APT.F[0];
  mb.fbox(f, 4.2, 2.2, 8.4, 3.1, y, y + 1.05, C.woodDark, { group: g });
  mb.fbox(f, 4.1, 2.1, 8.5, 3.2, y + 1.05, y + 1.12, C.offWhite, { group: g, solid: false });
  { const [x, z] = f.p(6.3, 2.2); mb.interact('info', x, y + 1.2, z, 0, 'Reception', g, 'The desk is empty. A sticky note: "Back in five. — Concierge". (NPCs arrive in a later prototype.)'); }
  mb.fbox(f, 0.15, 3.0, 0.45, 6.5, y + 0.9, y + 2.1, C.greyDark, { group: g });
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) mb.fbox(f, 0.45, 3.1 + i * 0.8, 0.5, 3.1 + i * 0.8 + 0.7, y + 0.95 + j * 0.38, y + 0.95 + j * 0.38 + 0.32, i % 2 ? C.beige : C.blue, { group: g, solid: false });
  { const [x, z] = f.p(0.7, 4.8); mb.interact('info', x, y + 1.4, z, 0, 'Check mailboxes', g, 'Brass mailboxes for 1A–3D. All empty. The postal service arrives with the economy.'); }
  { const [bx, bz] = f.p(18.0, 3.4); bench(mb, bx, bz, 'x', 1, y, g); }
  { const [bx, bz] = f.p(20.9, 7.6); bench(mb, bx, bz, 'x', -1, y, g, C.sageDark); }
  { const [bx, bz] = f.p(3.4, 8.6); bench(mb, bx, bz, 'x', -1, y, g, C.sageDark); }
  plant(mb, f, 1.0, 1.0, y, g, 1.5); plant(mb, f, 22.9, 1.0, y, g, 1.5); plant(mb, f, 7.2, 9.5, y, g, 1.3); plant(mb, f, 16.5, 9.5, y, g, 1.3);
  rug(mb, f, 9.6, 1.0, 14.4, 5.5, y + 0.03, C.rug, g);
  { const [x, z] = f.p(16.5, 0.4); mb.interact('info', x, y + 1.4, z, 0, 'Read directory', g, 'MAPLE COURT · Lobby · Residents\' lounge → right · Units 1A–3D · Unit 1B is open for viewing · Roof terrace via the stairs (3rd floor, up one more).'); mb.fbox(f, 15.8, 0.3, 17.2, 0.42, y + 1.0, y + 1.9, C.charcoal, { group: g, solid: false }); }
}

function lounge(mb: MB, f: Frame, g: number) {
  const y = APT.F[0];
  mb.fbox(f, 14.7, 10.2, 23.85, 17.85, y, y + 0.025, C.wood, { group: g, solid: false, cast: false });
  sofa(mb, f, 15.2, 16.3, 18.8, 17.4, y, C.sageDark, 'v1', g, 'lounge sofa');
  sofa(mb, f, 21.5, 12.2, 23.4, 15.2, y, C.terra, 'u1', g, 'lounge sofa');
  table(mb, f, 17.4, 13.6, 19.6, 14.8, y, 0.5, C.woodDark, g);
  rug(mb, f, 16.6, 12.8, 20.4, 15.6, y + 0.025, C.rugBlue, g);
  mb.fbox(f, 15.0, 10.35, 17.4, 10.8, y, y + 2.0, C.wood, { group: g });
  { const [x, z] = f.p(16.2, 10.9); mb.interact('info', x, y + 1.3, z, 0, 'Browse the bookshelf', g, '"A Field Guide to Maple Street", "Locks & Latches", "Nobody Home: A Neighborhood History".'); }
  plant(mb, f, 23.2, 10.7, y, g, 1.4); plant(mb, f, 15.0, 17.3, y, g, 1.2);
  const [sx, sz] = f.p(14.85, 12.4);
  const sw = addSwitch(mb, sx, 1.3, sz, g, 'Lounge lights');
  { const [x, z] = f.p(19, 14.2); addLamp(mb, sw, x, y + 2.7, z, g); }
}

function openUnit(mb: MB, f: Frame, g: number) {
  const k = 1, y = APT.F[k], yt = APT.F[k + 1] - APT.SLAB;
  const iw = { group: g };
  mb.wall(f, 'u', 6.5, 12.0, APT.W - 0.15, y, yt, 0.2, C.sand, [{ a: 17.0, b: 18.0, lo: y, hi: y + 2.1 }], iw);
  mb.wall(f, 'v', 12.1, 0.15, 6.4, y, yt, 0.2, C.sand, [], iw);
  mb.door(f, 'u', 6.5, 17.0, 1.0, y, 2.1, { hingeA: true, swing: -1, color: C.sageDark, group: g, name: 'Unit 1B door' });
  mb.fbox(f, 12.2, 0.15, APT.W - 0.15, 6.4, y, y + 0.025, C.wood, { group: g, solid: false, cast: false });
  rug(mb, f, 15.2, 2.0, 19.6, 5.2, y + 0.025, C.rug, g);
  sofa(mb, f, 14.2, 5.0, 17.6, 6.1, y, C.blueDark, 'v1', g, 'sofa');
  table(mb, f, 15.5, 3.2, 17.3, 4.1, y, 0.5, C.woodDark, g);
  mb.fbox(f, 21.2, 0.4, 23.6, 2.6, y, y + 0.5, C.woodDark, iw);                      // bed
  mb.fbox(f, 21.25, 0.45, 23.55, 2.55, y + 0.5, y + 0.68, C.offWhite, { group: g, solid: false });
  mb.fbox(f, 21.25, 0.45, 23.55, 0.95, y + 0.68, y + 0.8, C.white, { group: g, solid: false });
  mb.fbox(f, 12.3, 0.4, 13.1, 4.8, y, y + 0.9, C.offWhite, iw);                      // kitchenette
  mb.fbox(f, 12.25, 0.35, 13.15, 4.85, y + 0.9, y + 0.97, C.woodDark, { group: g, solid: false });
  plant(mb, f, 23.2, 5.7, y, g, 1.3); plant(mb, f, 13.0, 5.8, y, g, 1.1);
  const [sx, sz] = f.p(17.0, 6.3);
  const sw = addSwitch(mb, sx - 0.0, 1.3, sz, g, 'Unit lights');
  const [lx, lz] = f.p(17.5, 3.2); addLamp(mb, sw, lx, y + 2.7, lz, g);
  { const [x, z] = f.p(12.5, 5.6); mb.interact('info', x, y + 1.2, z, 0, 'Read the viewing card', g, 'UNIT 1B · Open for viewing. Furnished studio. Residents will be able to buy and fit out their own homes in a later prototype.'); mb.fbox(f, 12.2, 5.4, 12.3, 6.0, y + 1.0, y + 1.5, C.yellow, { group: g, solid: false }); }
}

function roof(mb: MB, f: Frame, G: number[]) {
  const { W, D, F } = APT;
  const y = F[4], g = G[4], g5 = G[5];
  const par = { group: g };
  mb.wall(f, 'u', 0, -0.15, W + 0.15, y, y + 1.1, 0.3, C.offWhite, [], par);
  mb.wall(f, 'u', D, -0.15, W + 0.15, y, y + 1.1, 0.3, C.offWhite, [], par);
  mb.wall(f, 'v', 0, 0.15, D - 0.15, y, y + 1.1, 0.3, C.offWhite, [], par);
  mb.wall(f, 'v', W, 0.15, D - 0.15, y, y + 1.1, 0.3, C.offWhite, [], par);
  mb.fbox(f, 0.3, 0.3, W - 0.3, 9.7, y, y + 0.02, C.sage, { group: g, solid: false, cast: false });
  // stair head
  const sh = { group: g };
  mb.fbox(f, 11.5, 10.0, 11.7, 14.1, y, y + 2.8, C.offWhite, sh);
  mb.fbox(f, 14.4, 10.0, 14.6, 14.1, y, y + 2.8, C.offWhite, sh);
  mb.fbox(f, 11.7, 13.9, 14.4, 14.1, y, y + 2.8, C.offWhite, sh);
  mb.wall(f, 'u', 9.95, 11.5, 14.6, y, y + 2.8, 0.2, C.offWhite, [{ a: 13.2, b: 14.4, lo: y, hi: y + 2.15 }], sh);
  mb.door(f, 'u', 9.95, 13.2, 1.2, y, 2.15, { hingeA: true, swing: -1, color: C.terra, group: g, name: 'Roof access door' });
  mb.fbox(f, 11.4, 9.75, 14.7, 14.2, y + 2.8, y + 3.05, C.grey, { group: g5 });
  mb.fbox(f, 8.5, 9.85, 11.5, 12.8, y, y + 2.4, C.blueDark, { group: g });       // lift machine room
  for (const u of [9.2, 9.8, 10.4]) mb.fbox(f, u, 9.8, u + 0.3, 9.85, y + 1.4, y + 2.1, C.charcoal, { group: g, solid: false });
  // dressing
  mb.fbox(f, 2.5, 13.5, 4.5, 15.0, y, y + 1.3, C.greyDark, par); mb.fbox(f, 5.2, 13.5, 7.2, 15.0, y, y + 1.3, C.greyDark, par);
  { const [x, z] = f.p(20.0, 14.5); mb.prim(PK.CYL, x, y + 2.3, z, 2.2, 1.8, 2.2, C.terra, { group: g }); mb.cbox(x, y, z, 1.8, 1.4, 1.8, C.charcoal, par); }
  { const [bx, bz] = f.p(7.0, 3.0); bench(mb, bx, bz, 'x', -1, y, g, C.wood); }
  { const [bx, bz] = f.p(16.5, 3.0); bench(mb, bx, bz, 'x', -1, y, g, C.wood); }
  for (const u of [3.0, 10.5, 21.0]) { plant(mb, f, u, 1.1, y, g, 1.6); }
  roofZone(mb, f, y);
  { const [x, z] = f.p(22.6, 16.9); addFound(mb, x, y + 0.05, z, 'Golden Pigeon', 'A tiny golden pigeon, tucked behind the water tank. Someone loved this rooftop.', g); }
  { const [x, z] = f.p(22.5, 8.0); mb.interact('info', x, y + 1.2, z, 0, 'Take in the view', g, 'Maple Street from above: the park to the north, the lane to the west, and a road that continues into Block 02 — soon.'); mb.fbox(f, W - 0.45, 7.5, W - 0.3, 8.5, y + 1.0, y + 1.1, C.gold, { group: g, solid: false }); }
}
function roofZone(mb: MB, f: Frame, y: number) {
  const [a, b, c, d] = f.rect(0.2, 0.2, APT.W - 0.2, APT.D - 0.2);
  mb.zones.push({ name: 'Roof terrace', x0: a, z0: b, x1: c, z1: d, prio: 6, building: mb.buildings[mb.buildings.length - 1].id, y0: y - 0.5 });
}

// ─────────────────────────────────── the lift ───────────────────────────────────
function buildLift(mb: MB, f: Frame, G: number[]): LiftDef {
  const { F } = APT;
  const [cx, cz] = f.p(10.0, 11.25);
  const hw = 1.0, hd = 1.0, doorW = 1.2, slide = 0.5;
  const mk = (rel: LiftPart['rel'], color: number, leaf: -1 | 0 | 1, ox: number, oy: number, oz: number, group: number, noCam = false): LiftPart => {
    const s = mb.world.add({
      minX: ox + rel[0], minY: oy + rel[1], minZ: oz + rel[2], maxX: ox + rel[3], maxY: oy + rel[4], maxZ: oz + rel[5],
      group, tag: (noCam ? TAG_NOCAM : 0) | (oy === F[0] && group === -1 ? TAG_CAB : 0), dyn: true,
    });
    return { rel, color, solid: s.id, leaf, noCam };
  };
  const cab: LiftPart[] = [
    mk([-1.1, -0.15, -1.1, 1.1, 0, 1.1], C.woodDark, 0, cx, F[0], cz, -1),
    mk([-1.1, 0, 1.0, 1.1, 2.5, 1.1], C.offWhite, 0, cx, F[0], cz, -1),
    mk([-1.1, 0, -1.1, -1.0, 2.5, 1.1], C.sand, 0, cx, F[0], cz, -1),
    mk([1.0, 0, -1.1, 1.1, 2.5, 1.1], C.sand, 0, cx, F[0], cz, -1),
    mk([-1.1, 0, -1.1, -0.6, 2.5, -1.0], C.greyDark, 0, cx, F[0], cz, -1),
    mk([0.6, 0, -1.1, 1.1, 2.5, -1.0], C.greyDark, 0, cx, F[0], cz, -1),
    mk([-0.6, 2.2, -1.1, 0.6, 2.5, -1.0], C.greyDark, 0, cx, F[0], cz, -1),
    mk([-1.1, 2.5, -1.1, 1.1, 2.65, 1.1], C.offWhite, 0, cx, F[0], cz, -1, true),
    mk([-0.6, 0, -1.08, 0, 2.2, -1.02], C.grey, -1, cx, F[0], cz, -1),
    mk([0, 0, -1.08, 0.6, 2.2, -1.02], C.grey, 1, cx, F[0], cz, -1),
  ];
  const zf = cz - hd - 0.3;                // landing door plane (shaft front wall centre z)
  const landings = F.slice(0, 4).map((y, k) => ({
    floor: k, group: G[k],
    parts: [
      mk([cx - 0.6, y, zf - 0.04, cx, y + 2.2, zf + 0.04], C.grey, -1, 0, 0, 0, G[k]),
      mk([cx, y, zf - 0.04, cx + 0.6, y + 2.2, zf + 0.04], C.grey, 1, 0, 0, 0, G[k]),
    ],
  }));
  const callPos = F.slice(0, 4).map((y) => ({ x: cx + 1.05, y: y + 1.1, z: zf - 0.1 }));
  const indicatorPos = F.slice(0, 4).map((y) => ({ x: cx, y: y + 2.45, z: zf - 0.11 }));
  F.slice(0, 4).forEach((y, k) => mb.interact('liftCall', cx + 1.05, y + 1.1, zf - 0.3, k, 'Call lift', G[k]));
  mb.interact('liftPanel', cx + hw - 0.2, F[0] + 1.1, cz - hd + 0.55, 0, 'Lift buttons', -1);
  mb.mapRects.push({ x0: cx - 1.1, z0: cz - 1.1, x1: cx + 1.1, z1: cz + 1.1, color: C.greyDark, kind: 'building' });
  return {
    cx, cz, hw, hd, floors: F.slice(0, 4), names: APT.names, doorW, doorH: 2.2, slide, cab, landings, callPos,
    panelPos: { x: cx + hw - 0.04, y: F[0] + 1.1, z: cz - hd + 0.55 },
    indicatorPos,
    cabIndicatorPos: { x: cx, y: F[0] + 2.35, z: cz - hd + 0.05 },
  };
}
