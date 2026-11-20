import { C, Frame, MB, PK } from './core';
import { addFound, bench, bush, car, fenceX, fenceZ, hedge, lampPost, pine, streetSign, trashBin, tree } from './props';

export const WORLD = { x0: -61, x1: 65, z0: -51, z1: 41 };
const road = (mb: MB, x0: number, z0: number, x1: number, z1: number) => mb.box(x0, 0, z0, x1, 0.03, z1, C.asphalt, { solid: false, cast: false });
const path = (mb: MB, x0: number, z0: number, x1: number, z1: number, y = 0.04) => mb.box(x0, 0, z0, x1, y, z1, C.path, { solid: false, cast: false });
const lawn = (mb: MB, x0: number, z0: number, x1: number, z1: number, c: number = C.grassLight) => mb.box(x0, 0, z0, x1, 0.025, z1, c, { solid: false, cast: false });

/** Ground, roads, sidewalks, boundary, street furniture, gate. */
export function buildStreetscape(mb: MB) {
  const { x0, x1, z0, z1 } = WORLD;
  mb.box(-70, -1, -62, 74, 0, 52, C.grass);
  mb.mapRects.push({ x0, z0, x1, z1, color: C.grass, kind: 'green' });
  // invisible boundary walls (visible hedges sit just inside)
  for (const r of [[x0 - 2, -60, x0, 50], [x1, -60, x1 + 2, 50], [-70, z0 - 2, 74, z0], [-70, z1, 74, z1 + 2]] as const)
    mb.box(r[0], -1, r[1], r[2], 6, r[3], C.grass, { noPiece: true });
  hedge(mb, x0 + 0.1, z0 + 0.1, x1 - 0.1, z0 + 1.3, 1.3); hedge(mb, x0 + 0.1, z1 - 1.3, x1 - 0.1, z1 - 0.1, 1.3);
  hedge(mb, x0 + 0.1, z0 + 1.3, x0 + 1.3, z1 - 1.3, 1.3);
  hedge(mb, x1 - 1.3, z0 + 1.3, x1 - 0.1, z1 - 1.3, 1.3);

  // roads
  road(mb, -60, -4, 64, 4); road(mb, -18, -48, -10, -4);
  mb.mapRects.push({ x0: -60, z0: -4, x1: 64, z1: 4, color: C.asphalt, kind: 'road' }, { x0: -18, z0: -48, x1: -10, z1: -4, color: C.asphalt, kind: 'road' });
  for (let x = -58; x < 62; x += 5) if (x + 2.5 < -18 || x > -10) mb.box(x, 0.03, -0.1, x + 2.5, 0.04, 0.1, C.offWhite, { solid: false, cast: false });
  for (let z = -46; z < -9; z += 5) mb.box(-14.1, 0.03, z, -13.9, 0.04, z + 2.5, C.offWhite, { solid: false, cast: false });
  for (const cx of [-8.6, 12.4]) for (let z = -3.4; z < 3.6; z += 0.9) mb.box(cx, 0.03, z, cx + 3, 0.045, z + 0.5, C.white, { solid: false, cast: false });
  // sidewalks (0.12 kerb: walkable by step-up)
  const sw = (a: number, b: number, c: number, d: number) => { mb.box(a, 0, b, c, 0.12, d, C.grey); mb.mapRects.push({ x0: a, z0: b, x1: c, z1: d, color: C.grey, kind: 'path' }); };
  sw(-60, -7, -21, -4); sw(-7, -7, 64, -4); sw(-60, 4, 64, 7); sw(-21, -48, -18, -7); sw(-10, -48, -7, -7);
  // driveway into the car park
  mb.box(44, 0, -8.5, 48, 0.13, -4, C.asphalt);

  // entrance gate (spawn side) and road-closed barrier (Block 02 side)
  for (const z of [-8.6, 8.6]) { mb.cbox(-57, 0, z, 1.2, 4.6, 1.2, C.terra); mb.cbox(-57, 4.6, z, 1.5, 0.2, 1.5, C.terraDark, { solid: false }); }
  mb.cbox(-57, 4.5, 0, 0.9, 0.9, 18.2, C.beige, { solid: false });
  mb.label('MAPLE STREET  ·  BLOCK 01', -57.5, 4.95, 0, 8, 0.7, -Math.PI / 2, C.charcoal, C.white);
  mb.label('MAPLE STREET  ·  BLOCK 01', -56.5, 4.95, 0, 8, 0.7, Math.PI / 2, C.charcoal, C.white);
  for (const z of [-8.6, 8.6]) { bush(mb, -58.3, z * 0.94, 1.1, 2); bush(mb, -55.7, z * 0.94, 1.1, 0); }
  for (let i = 0; i < 6; i++) mb.box(62.8, 0, -3.9 + i * 1.3, 63.2, 1.2, -2.8 + i * 1.3, i % 2 ? C.terra : C.white);
  mb.label('ROAD CLOSED · BLOCK 02 COMING SOON', 62.55, 1.55, 0, 5.4, 0.6, -Math.PI / 2, C.terra, C.white);
  mb.interact('info', 61.8, 1.2, 0, 0, 'Read sign', -1, 'Block 02 is under construction. This prototype is one block: walk it, enter the buildings, ride the lift. Heists and security come after the world feels good to walk.');

  // lamps, benches, bins, cars
  for (const x of [-54, -42, -30, -4, 8, 20, 32, 52, 60]) lampPost(mb, x, -4.8, [0, 1]);
  for (const x of [-48, -36, -24, -12, 0, 30, 42, 54]) lampPost(mb, x, 4.8, [0, -1]);
  for (const z of [-14, -26, -38]) lampPost(mb, -19.5, z, [1, 0]);
  for (const z of [-20, -32, -44]) lampPost(mb, -8.5, z, [-1, 0]);
  bench(mb, -26, 6.45, 'x', -1, 0.12); bench(mb, 36, 6.45, 'x', -1, 0.12); bench(mb, -3, -6.45, 'x', 1, 0.12); bench(mb, 56, -6.45, 'x', 1, 0.12);
  trashBin(mb, -24.2, 6.5, C.sageDark, 0.12); trashBin(mb, 38.2, 6.5, C.sageDark, 0.12); trashBin(mb, -0.8, -6.5, C.sageDark, 0.12); trashBin(mb, 54, -6.5, C.sageDark, 0.12);
  car(mb, -38, 2.95, 'x', C.terra); car(mb, -12, 2.95, 'x', C.blue); car(mb, 26, 2.95, 'x', C.yellow);
  car(mb, -26, -2.95, 'x', C.sage); car(mb, 6, -2.95, 'x', C.offWhite); car(mb, 34, -2.95, 'x', C.plum);
  streetSign(mb, -9.2, -7.4, 'MAPLE LANE →', 0);
  streetSign(mb, -6.4, 7.4, 'MAPLE ST', 0);
  for (const x of [-54.6, -52.4]) mb.cbox(x, 0, -6.7, 0.12, 1.5, 0.12, C.woodDark);
  mb.cbox(-53.5, 1.5, -6.7, 2.8, 1.0, 0.12, C.charcoal);
  mb.label('YOU ARE HERE', -53.5, 2.2, -6.62, 2.4, 0.5, 0, C.charcoal, C.white);
  mb.interact('info', -53.5, 1.6, -6.0, 0, 'Read the map board', -1, 'MAPLE STREET · Block 01. Houses along the street, Residential Lane to the north-west, the park and its hidden corners to the north-east, Maple Court Apartments south-east, the car park beyond. Three secrets are hidden around the block.');
  // lawns & trees outside the lots
  lawn(mb, -7, -23, 11.5, -7.1, C.grassLight);
  for (const [x, z, s, t] of [[-3, -12, 1.1, 0], [4, -18, 1.2, 1], [8, -10, 1, 2], [-4, -20, 0.9, 1]] as const) tree(mb, x, z, s, t);
  for (const [x, z, s, t] of [[-6, 24, 1.1, 0], [-16, 28, 1.2, 2], [-30, 30, 1, 1], [-45, 30, 1.2, 0], [-55, 26, 1, 2], [32, 31, 1.2, 1], [58, 30, 1.1, 0], [60, 20, 1, 2], [30, 36, 1, 1]] as const) tree(mb, x, z, s, t);
  for (const [x, z] of [[-12, 33], [8, 35], [44, 34], [-40, 34]] as const) pine(mb, x, z, 1.1);
  bench(mb, 7.5, -9.6, 'x', 1);
  mb.cbox(2, 0, -8.7, 0.12, 1.4, 1.6, C.woodDark); mb.cbox(2, 1.4, -8.7, 0.2, 0.9, 2.2, C.sageDark);
  mb.label('NEIGHBORHOOD WATCH', 2.11, 2.0, -8.7, 2.0, 0.5, Math.PI / 2, C.sageDark, C.white);
  mb.interact('info', 2.4, 1.5, -8.7, 0, 'Read the notice board', -1, 'NEIGHBORHOOD WATCH · Be kind, lock your door, say hi. Reporting, alerts and reputation arrive with the community systems.');
  // zones
  mb.zones.push(
    { name: 'Main Street', x0: -60, z0: -7, x1: 64, z1: 7, prio: 1 },
    { name: 'Residential Lane', x0: -21, z0: -48, x1: -7, z1: -7, prio: 2 },
    { name: 'Maple Street · Block 01', x0: x0, z0, x1, z1, prio: 0 },
  );
  for (const x of [-56, -54, -52, -50]) mb.spawns.push({ x, z: 5.5, yaw: Math.PI / 2 }, { x, z: -5.5, yaw: Math.PI / 2 });
}

/** The central park, playground and the hidden garden. */
export function buildPark(mb: MB) {
  const X0 = 12, X1 = 40, Z0 = -44, Z1 = -8;
  mb.mapRects.push({ x0: X0, z0: Z0, x1: X1, z1: Z1, color: C.leafLight, kind: 'green' });
  lawn(mb, X0, Z0, X1, Z1 - 0.2, C.grassLight);
  mb.zones.push({ name: 'Central Park', x0: X0, z0: Z0, x1: X1, z1: Z1, prio: 3 });
  // perimeter hedge, with a main gate (south) and a hidden gap (east)
  hedge(mb, X0, Z1 - 0.4, 23.8, Z1, 1.0); hedge(mb, 28.2, Z1 - 0.4, X1, Z1, 1.0);
  hedge(mb, X0, Z0, X1, Z0 + 0.5, 1.2); hedge(mb, X0 - 0.4, Z0, X0, Z1, 1.2);
  hedge(mb, X1, Z0, X1 + 0.5, -36.2, 1.3); hedge(mb, X1, -33.8, X1 + 0.5, Z1, 1.3);
  hedge(mb, 36.6, -37.2, 37.4, -32.4, 1.1); bush(mb, 39.0, -37.0, 1.2, 1);
  for (const x of [23.9, 28.1]) { mb.cbox(x, 0, Z1 - 0.2, 0.5, 1.9, 0.5, C.terra); mb.prim(PK.SPHERE, x, 2.1, Z1 - 0.2, 0.55, 0.55, 0.55, C.yellow); }
  // paths + fountain plaza
  path(mb, 24.8, -26, 27.2, Z1 - 0.1); path(mb, 20, -27.2, 38.2, -24.8); path(mb, 16.5, -28, 17.9, -12); path(mb, 17.9, -13.2, 24.8, -11.8); path(mb, 36, -35.4, 40.5, -34.6, 0.04);
  mb.box(21.2, 0, -30.8, 30.8, 0.05, -21.2, C.path, { solid: false, cast: false });
  const fx = 26, fz = -26;
  mb.box(fx - 2.2, 0, fz - 2.2, fx + 2.2, 0.62, fz + 2.2, C.grey, { noPiece: true });
  mb.prim(PK.CYL, fx, 0.3, fz, 4.6, 0.6, 4.6, C.grey); mb.prim(PK.CYL, fx, 0.55, fz, 4.0, 0.12, 4.0, 0x9cc3d9, { cast: false });
  mb.prim(PK.CYL, fx, 1.0, fz, 0.7, 1.2, 0.7, C.beige); mb.prim(PK.CYL, fx, 1.65, fz, 2.0, 0.18, 2.0, C.beige); mb.prim(PK.CYL, fx, 1.78, fz, 1.7, 0.1, 1.7, 0x9cc3d9, { cast: false });
  mb.mapRects.push({ x0: fx - 2, z0: fz - 2, x1: fx + 2, z1: fz + 2, color: 0x9cc3d9, kind: 'water' });
  bench(mb, 22.2, fz, 'z', 1); bench(mb, 29.8, fz, 'z', -1); bench(mb, fx, -22.2, 'x', -1); bench(mb, fx, -29.8, 'x', 1);
  bench(mb, 15.2, -20, 'z', 1); bench(mb, 19.5, -12.8, 'x', -1, 0, -1, C.wood); bench(mb, 33.5, -29, 'x', 1);
  trashBin(mb, 23.2, -9.4); trashBin(mb, 22.8, -22.6);
  for (const [x, z, s, t] of [[15, -40, 1.3, 0], [20, -37, 1.1, 1], [31, -40, 1.3, 2], [36, -41, 1.1, 0], [15, -33, 1.2, 1], [33, -20, 1.1, 2], [37, -13, 1.2, 0], [14.5, -10, 1, 1], [30, -12, 1.2, 2], [20, -17, 1, 0], [35, -26, 1.2, 1], [18, -24, 1.1, 2]] as const) tree(mb, x, z, s, t);
  for (const [x, z] of [[14, -36], [38, -22], [31.5, -10.5]] as const) pine(mb, x, z, 1);
  for (const [x, z] of [[19, -14.5], [34, -34], [14, -26], [38, -28]] as const) bush(mb, x, z, 1, 2);
  // playground
  const px = 33, pz = -16;
  mb.box(px - 2.4, 0, pz - 2.4, px + 2.4, 0.03, pz + 2.4, C.sand, { solid: false, cast: false });
  mb.box(px - 2.5, 0, pz - 2.5, px + 2.5, 0.3, pz - 2.4, C.woodDark); mb.box(px - 2.5, 0, pz + 2.4, px + 2.5, 0.3, pz + 2.5, C.woodDark);
  mb.box(px - 2.5, 0, pz - 2.4, px - 2.4, 0.3, pz + 2.4, C.woodDark); mb.box(px + 2.4, 0, pz - 2.4, px + 2.5, 0.3, pz + 2.4, C.woodDark);
  mb.box(px + 0.6, 0, pz - 1.8, px + 2.0, 1.1, pz - 0.4, C.blue);       // play tower
  for (let i = 1; i <= 4; i++) mb.box(px + 0.6 - 0.3 * (5 - i), 0, pz - 1.8, px + 0.6 - 0.3 * (4 - i), 0.25 * i, pz - 0.4, C.sand);
  for (const [dx, dz] of [[0.65, -1.75], [1.95, -1.75], [0.65, -0.45], [1.95, -0.45]] as const) mb.cbox(px + dx, 1.1, pz + dz, 0.1, 1.9, 0.1, C.yellow, { solid: false });
  mb.prim(PK.GABLE, px + 1.3, 3.0 + 0.4, pz - 1.1, 1.9, 0.8, 1.9, C.terra);
  mb.cbox(px + 2.9, 0.05, pz - 1.1, 1.8, 0.12, 0.7, C.grey, { solid: false }); mb.cbox(px + 2.9, 0.4, pz - 1.1, 1.0, 0.7, 0.7, C.grey, { solid: false });
  for (const x of [px - 1.6, px - 0.2]) { mb.cbox(x, 0, pz + 1.2, 0.12, 2.2, 0.12, C.charcoal); }
  mb.cbox(px - 0.9, 2.15, pz + 1.2, 1.5, 0.1, 0.1, C.charcoal, { solid: false });
  for (const x of [px - 1.3, px - 0.5]) mb.cbox(x, 0.7, pz + 1.2, 0.4, 0.06, 0.26, C.terra, { solid: false });
  mb.zones.push({ name: 'Playground', x0: px - 2.6, z0: pz - 2.6, x1: px + 4, z1: pz + 2.6, prio: 4 });
  // community board
  mb.cbox(22.6, 0, -9.6, 0.15, 1.5, 0.15, C.woodDark); mb.cbox(29.4, 0, -9.6, 0.15, 1.5, 0.15, C.woodDark);
  mb.cbox(26, 1.0, -9.6, 7.0, 1.2, 0.12, C.sageDark, { solid: false });
  mb.label('COMMUNITY BOARD', 26, 1.95, -9.52, 3.6, 0.45, 0, C.charcoal, C.white);
  mb.interact('info', 26, 1.4, -9.0, 0, 'Read the community board', -1, 'THIS WEEK ON MAPLE STREET · Movie night in the park, Friday. Lost: one grey cat named Concrete. Wanted: someone to water the plants at No. 12. Events and the auction house are coming.');

  // ── hidden garden
  const GX0 = 41, GX1 = 60, GZ0 = -47, GZ1 = -27;
  mb.mapRects.push({ x0: GX0, z0: GZ0, x1: GX1, z1: GZ1, color: C.leaf, kind: 'green' });
  lawn(mb, GX0, GZ0, GX1, GZ1, C.grassDark);
  mb.zones.push({ name: 'Hidden Garden', x0: GX0, z0: GZ0, x1: GX1, z1: GZ1, prio: 4 });
  hedge(mb, GX0, GZ0, GX1, GZ0 + 0.7, 1.4); hedge(mb, GX0, GZ1 - 0.7, GX1, GZ1, 1.4); hedge(mb, GX1 - 0.7, GZ0, GX1, GZ1, 1.4); hedge(mb, GX0, GZ0, GX0 + 0.5, -36.2, 1.4); hedge(mb, GX0, -33.8, GX0 + 0.5, GZ1, 1.4);
  for (const [x, z] of [[44, -42], [46, -30], [57, -30], [57, -44], [43.5, -29]] as const) bush(mb, x, z, 1.3, x % 3);
  for (let i = 0; i < 6; i++) mb.box(41.6 + i * 1.2, 0, -35.3 + (i % 2) * 0.3, 42.4 + i * 1.2, 0.05, -34.7 + (i % 2) * 0.3, C.grey, { solid: false, cast: false });
  mb.prim(PK.CYL, 54.5, 0.02, -41.5, 6.5, 0.06, 4.8, 0x9cc3d9, { cast: false });
  mb.mapRects.push({ x0: 51.3, z0: -43.9, x1: 57.7, z1: -39.1, color: 0x9cc3d9, kind: 'water' });
  for (const [x, z] of [[51.5, -39.4], [57.5, -43.6], [52.0, -44.0]] as const) mb.prim(PK.ICO, x, 0.2, z, 0.7, 0.4, 0.6, C.greyDark);
  // gazebo
  const gx = 49.5, gz = -37;
  mb.box(gx - 2.2, 0, gz - 2.2, gx + 2.2, 0.18, gz + 2.2, C.beige);
  for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]] as const) mb.cbox(gx + dx, 0.18, gz + dz, 0.22, 2.6, 0.22, C.offWhite);
  mb.prim(PK.CONE, gx, 2.78 + 0.6, gz, 5.4, 1.2, 5.4, C.terra);
  for (const o of [-1.1, 1.1]) mb.box(gx + o - 0.4, 0.18, gz - 2.0, gx + o + 0.4, 0.5, gz - 1.7, C.wood, { solid: false });
  mb.prim(PK.CYL, gx, 0.18 + 0.35, gz, 0.55, 0.7, 0.55, C.greyDark);
  addFound(mb, gx, 0.18 + 0.7, gz, 'Maple Cup', 'A tiny trophy engraved "Best Kept Secret, Maple Street". You found the hidden garden.', -1);
  for (let i = 0; i < 14; i++) mb.cbox(GX0 + 2 + (i * 7.3) % 15, 0, GZ0 + 2.5 + ((i * 3.7) % 14), 0.3, 0.45, 0.3, [C.terra, C.yellow, C.plum, C.red][i % 4], { solid: false });
}

/** Parking lot and garage block. */
export function buildParking(mb: MB) {
  mb.mapRects.push({ x0: 41, z0: -19, x1: 62, z1: -8.5, color: C.asphalt, kind: 'road' });
  road(mb, 41, -19, 62, -8.5);
  mb.zones.push({ name: 'Parking Area', x0: 41, z0: -24.5, x1: 62, z1: -8.4, prio: 3 });
  for (let i = 0; i <= 6; i++) mb.box(41.5 + i * 3.3 - 0.05, 0.03, -17.5, 41.5 + i * 3.3 + 0.05, 0.04, -13, C.white, { solid: false, cast: false });
  for (const i of [0, 2, 3, 5]) car(mb, 43.15 + i * 3.3, -15.2, 'z', [C.blue, C.terra, C.sage, C.yellow][[0, 2, 3, 5].indexOf(i)]);
  hedge(mb, 41, -8.5, 44, -8.3, 0.9); hedge(mb, 48, -8.5, 62, -8.3, 0.9);
  // garage bays
  const gx0 = 44, gx1 = 60, gz0 = -24.2, gz1 = -19;
  mb.box(gx0 - 0.2, 0, gz0, gx1 + 0.2, 0.06, gz1, C.grey, { solid: false, cast: false });
  mb.box(gx0 - 0.2, 0, gz0, gx1 + 0.2, 3.0, gz0 + 0.3, C.sand);
  for (const x of [gx0 - 0.2, 49.33, 54.67, gx1]) mb.box(x, 0, gz0, x + 0.3, 3.0, gz1, C.sand);
  mb.box(gx0 - 0.5, 3.0, gz0 - 0.3, gx1 + 0.5, 3.3, gz1 + 0.5, C.terra, { noPiece: false });
  mb.box(gx0 - 0.5, 2.5, gz1 + 0.5, gx1 + 0.5, 3.0, gz1 + 0.6, C.charcoal, { solid: false });
  mb.label('GARAGES', 52, 2.75, gz1 + 0.62, 4, 0.4, 0, C.charcoal, C.white);
  for (const x of [46.7, 52, 57.3]) car(mb, x, -21.6, 'z', x < 50 ? C.offWhite : x < 55 ? C.plum : C.blue);
  mb.mapRects.push({ x0: gx0 - 0.2, z0: gz0, x1: gx1 + 0.3, z1: gz1, color: C.sand, kind: 'building' });
}

/** The community hall (shell only in this prototype). */
export function buildCommunity(mb: MB, bid: number) {
  const f = new Frame(33, 11, 0);
  const W = 20, D = 13, H = 4.2, T = 0.3;
  const [x0, z0, x1, z1] = f.rect(-0.2, -0.2, W + 0.2, D + 0.2);
  mb.buildings.push({ id: bid, name: 'Community Hall', x0, z0, x1, z1, floors: [0.2], levelGroups: [] });
  mb.mapRects.push({ x0, z0, x1, z1, color: C.yellow, kind: 'building' });
  mb.zones.push({ name: 'Community Hall', x0, z0, x1, z1, prio: 3 });
  mb.fbox(f, -0.3, -0.3, W + 0.3, D + 0.3, 0, 0.2, C.offWhite);
  const win = (a: number, b: number) => ({ a, b, lo: 1.1, hi: 3.0, glass: true });
  const wo = (outerSide: 1 | -1) => ({ inner: C.offWhite, outerSide });
  mb.wall(f, 'u', 0, -T / 2, W + T / 2, 0.2, H, T, C.yellow, [win(1.5, 4.5), win(5.5, 8.5), win(11.5, 14.5), win(15.5, 18.5)], wo(-1));
  mb.wall(f, 'u', D, -T / 2, W + T / 2, 0.2, H, T, C.yellow, [win(2, 5), win(7, 10), win(12, 15)], wo(1));
  mb.wall(f, 'v', 0, T / 2, D - T / 2, 0.2, H, T, C.yellow, [win(3, 6), win(8, 11)], wo(-1));
  mb.wall(f, 'v', W, T / 2, D - T / 2, 0.2, H, T, C.yellow, [win(3, 6), win(8, 11)], wo(1));
  mb.fbox(f, 0.2, 0.2, W - 0.2, D - 0.2, 0.2, H, C.beige, { noPiece: false });
  mb.fbox(f, -0.5, -0.5, W + 0.5, D + 0.5, H, H + 0.25, C.terra);
  mb.fbox(f, 1.5, -0.5, 18.5, 0.0, H - 0.4, H, C.terraDark, { solid: false });
  mb.lockedDoor(f, 'u', 0, 9.0, 2.0, 0.2, 2.5, C.terra, -1, 'Community office', T, -1);
  mb.fbox(f, 8.2, -1.6, 11.8, -0.2, 2.9, 3.02, C.terra, { solid: false });
  for (const u of [8.3, 11.7]) mb.fbox(f, u - 0.06, -1.5, u + 0.06, -1.38, 0.2, 2.9, C.charcoal);
  { const [lx, lz] = f.p(10, -0.2); mb.label('COMMUNITY HALL', lx, 3.6, lz - 0.03, 5.5, 0.62, Math.PI, C.charcoal, C.white); }
  { const [lx, lz] = f.p(10, -1.4); mb.label('Office · Auction House · Events — opening in a later prototype', lx, 2.5, lz, 4.6, 0.3, Math.PI, C.beige, C.charcoal); }
  mb.fbox(f, 8.2, -4.0, 11.8, -1.6, 0, 0.03, C.path, { solid: false, cast: false });
  mb.box(33, 0, 7.1, 53, 0.03, 11, C.path, { solid: false, cast: false });
  // ── the economy: market stall, crime board, the Watch booth, and a back room behind the hall
  mb.box(48.2, 0, 8.4, 51.8, 1.0, 9.2, C.terra); mb.box(48.0, 1.0, 8.3, 52.0, 1.08, 9.3, C.woodDark, { solid: false });
  for (const x of [48.0, 51.9]) mb.cbox(x, 0, 8.1, 0.12, 2.6, 0.12, C.charcoal);
  mb.box(47.7, 2.6, 7.9, 52.3, 2.76, 9.5, C.sageDark, { solid: false });
  mb.label('MAPLE MARKET', 50, 2.3, 7.95, 3.6, 0.5, Math.PI, C.charcoal, C.white);
  for (const [dx, c] of [[48.9, C.yellow], [50, C.blue], [51.1, C.sage]] as const) mb.box(dx - 0.28, 1.08, 8.55, dx + 0.28, 1.4, 8.95, c, { solid: false });
  mb.interact('market', 50, 1.3, 7.7, 0, 'Browse the market', -1);
  for (const x of [35.7, 38.3]) mb.cbox(x, 0, 8.95, 0.14, 2.5, 0.14, C.woodDark);
  mb.box(35.5, 1.0, 8.9, 38.5, 2.4, 9.0, C.sageDark, { solid: false });
  mb.label('CRIME BOARD', 37, 2.05, 8.86, 2.6, 0.45, Math.PI, C.charcoal, C.white);
  mb.label('JOBS · LEADS · WATCH', 37, 1.55, 8.86, 2.4, 0.28, Math.PI, C.beige, C.charcoal);
  mb.interact('board', 37, 1.4, 8.2, 0, 'Read the Crime Board', -1);
  mb.box(41.4, 0, 8.8, 43.4, 2.4, 10.0, 0x2b3f6b); mb.box(41.2, 2.4, 8.6, 43.6, 2.55, 10.2, C.offWhite, { solid: false });
  mb.label('NEIGHBORHOOD WATCH', 42.4, 1.95, 8.76, 1.9, 0.34, Math.PI, 0x2b3f6b, C.white);
  mb.box(42.0, 0, 27.0, 46.0, 2.7, 29.0, C.charcoal); mb.box(41.8, 2.7, 26.8, 46.2, 2.85, 29.2, C.terraDark, { solid: false });
  mb.box(42.3, 0, 26.35, 45.7, 0.95, 26.9, C.woodDark, { solid: false });
  mb.label('THE BACK ROOM', 44, 2.2, 26.96, 3.0, 0.42, Math.PI, C.terraDark, C.white);
  mb.label('no questions', 44, 1.7, 26.96, 1.6, 0.26, Math.PI, C.charcoal, C.beige);
  mb.interact('fence', 44, 1.3, 25.9, 0, 'Visit the back room', -1);
  mb.zones.push({ name: 'Maple Market', x0: 46, z0: 7, x1: 54, z1: 11, prio: 4 }, { name: 'The Back Room', x0: 40, z0: 24.5, x1: 48, z1: 30, prio: 4 });
  mb.mapRects.push({ x0: 42, z0: 27, x1: 46, z1: 29, color: C.charcoal, kind: 'building' }, { x0: 41.4, z0: 8.8, x1: 43.4, z1: 10, color: 0x2b3f6b, kind: 'building' });
  bench(mb, 29.5, 8.6, 'z', 1); bench(mb, 56, 8.8, 'x', -1, 0, -1, C.sageDark);
  for (const [x, z] of [[30.5, 12], [54.5, 13]] as const) tree(mb, x, z, 1.1, 1);
  fenceX(mb, 53, 62, 10.9, 0.7); fenceZ(mb, 11, 25, 62, 0.7);
}
