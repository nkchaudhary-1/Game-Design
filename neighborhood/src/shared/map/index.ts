import { Frame, MB, type MapDef } from './core';
import { buildApartment } from './apartment';
import { buildHouse, type HouseSpec } from './house';
import { buildCommunity, buildParking, buildPark, buildStreetscape, WORLD } from './outdoors';
import { C } from './core';

export * from './core';
export { APT } from './apartment';
export { WORLD } from './outdoors';

/** Block 01 · Maple Street. Deterministic: server and client both build it and agree on every id. */
export function buildMaple(): MapDef {
  const mb = new MB();
  buildStreetscape(mb);

  const north = (xc: number, mirror = false) => new Frame(mirror ? xc - 5 : xc + 5, -11, 2, mirror);
  const south = (xc: number, mirror = false) => new Frame(mirror ? xc + 5 : xc - 5, 11, 0, mirror);
  const laneW = (zc: number) => new Frame(-25, zc - 5, 1);
  const laneE = (zc: number) => new Frame(-3, zc + 5, 3);
  const base = { trim: C.offWhite };
  const houses: Omit<HouseSpec, 'bid'>[] = [
    { number: '12', owner: 'The Okafors', frame: north(-49), enterable: true, wall: C.terra, roof: C.roofDark, door: C.blueDark, accent: C.sageDark, variant: 0, yardTree: true, secret: true, ...base },
    { number: '13', owner: 'The Lindqvists', frame: south(-49, true), enterable: true, wall: C.sage, roof: C.roofTerra, door: C.terra, accent: C.blueDark, variant: 1, yardTree: true, ...base },
    { number: '14', owner: 'Mira & Dev', frame: north(-35), enterable: false, wall: C.blue, roof: C.roofDark, door: C.terra, accent: C.sageDark, variant: 1, yardTree: true, ...base },
    { number: '15', owner: 'The Haddads', frame: south(-35), enterable: false, wall: C.yellow, roof: C.roofDark, door: C.sageDark, accent: C.terra, variant: 0, ...base },
    { number: '17', owner: 'Ms. Ferreira', frame: south(-20), enterable: false, wall: C.beige, roof: C.roofTerra, door: C.blueDark, accent: C.blue, variant: 1, yardTree: true, ...base },
    { number: '19', owner: 'The Parks', frame: south(-6), enterable: false, wall: C.terra, roof: C.roofDark, door: C.offWhite, accent: C.sage, variant: 0, ...base },
    { number: '2', owner: 'Old Mr. Abe', frame: laneW(-30), enterable: false, wall: C.sage, roof: C.roofTerra, door: C.terra, accent: C.blue, variant: 0, ...base },
    { number: '4', owner: 'The Tanakas', frame: laneW(-42), enterable: false, wall: C.yellow, roof: C.roofDark, door: C.blueDark, accent: C.terra, variant: 1, ...base },
    { number: '1', owner: 'Priya & Sam', frame: laneE(-30), enterable: false, wall: C.blue, roof: C.roofDark, door: C.terra, accent: C.sage, variant: 1, yardTree: true, ...base },
    { number: '3', owner: 'The Nowaks', frame: laneE(-42), enterable: false, wall: C.beige, roof: C.roofTerra, door: C.sageDark, accent: C.blue, variant: 0, ...base },
  ];
  let bid = 0;
  for (const h of houses) buildHouse(mb, { ...h, bid: bid++ });
  const lift = buildApartment(mb, new Frame(3, 11, 0), bid++);
  buildPark(mb);
  buildParking(mb);
  buildCommunity(mb, bid++);

  return {
    world: mb.world, pieces: mb.pieces, doors: mb.doors, seats: mb.seats, switches: mb.switches, lamps: mb.lamps,
    labels: mb.labels, found: mb.found, interactables: mb.interactables, buildings: mb.buildings, groups: mb.groups,
    zones: mb.zones, mapRects: mb.mapRects, lift, spawns: mb.spawns, bounds: { x0: WORLD.x0, z0: WORLD.z0, x1: WORLD.x1, z1: WORLD.z1 },
  };
}
