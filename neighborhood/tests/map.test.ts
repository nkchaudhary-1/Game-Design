import { describe, expect, it } from 'vitest';
import { bodyFree, newBody, stepBody, type Body } from '../src/shared/collision';
import { SIM_DT } from '../src/shared/consts';
import { APT, buildMaple, type MapDef } from '../src/shared/map';
import { insideCab, LM, newLiftState, requestFloor, stepLift, syncLiftSolids } from '../src/shared/lift';

const map: MapDef = buildMaple();
const idle = { mx: 0, mz: 0, jump: false, sprint: false };

function settle(b: Body, secs = 0.5) { for (let i = 0; i < secs / SIM_DT; i++) stepBody(map.world, b, idle, SIM_DT); }
/** Walk straight at (tx,tz) until within `tol` (or give up). Returns steps taken. */
function walk(b: Body, tx: number, tz: number, o: { tol?: number; max?: number; sprint?: boolean; each?: () => void } = {}) {
  const tol = o.tol ?? 0.2, max = o.max ?? 60 / SIM_DT;
  for (let i = 0; i < max; i++) {
    const dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz);
    if (d < tol) return i;
    stepBody(map.world, b, { mx: dx / d, mz: dz / d, jump: false, sprint: o.sprint ?? false }, SIM_DT);
    o.each?.();
  }
  return max;
}
const openDoor = (name: string) => { for (const d of map.doors) if (d.name === name) map.world.solids[d.solid].enabled = false; };
const closeDoor = (name: string) => { for (const d of map.doors) if (d.name === name) map.world.solids[d.solid].enabled = true; };
const apt = (u: number, v: number): [number, number] => [3 + u, 11 + v];

describe('Maple Street map', () => {
  it('builds with a sane amount of content', () => {
    expect(map.world.solids.length).toBeGreaterThan(300);
    expect(map.pieces.length).toBeGreaterThan(800);
    expect(map.doors.length).toBeGreaterThanOrEqual(10);
    expect(map.seats.length).toBeGreaterThanOrEqual(15);
    expect(map.found.length).toBe(3);
    expect(map.buildings.length).toBeGreaterThanOrEqual(11);
    expect(map.lift.floors).toHaveLength(4);
  });

  it('every spawn point is free standing ground', () => {
    for (const s of map.spawns) {
      expect(bodyFree(map.world, s.x, 0.12, s.z)).toBe(true);
      const b = newBody(s.x, 1, s.z);
      settle(b);
      expect(b.grounded).toBe(true);
      expect(b.y).toBeCloseTo(0.12, 2); // spawns are on the pavement
    }
  });

  it('every interactable and seat sits in free space or on a surface (nothing buried inside solids)', () => {
    for (const s of map.seats) {
      const under = map.world.query(s.x - 0.01, s.z - 0.01, s.x + 0.01, s.z + 0.01, []);
      expect(under.some((o) => Math.abs(o.maxY - s.y) < 0.03), `seat ${s.id} (${s.name}) at ${s.x},${s.y},${s.z} has no floor under it`).toBe(true);
    }
  });

  it('the street is walkable end to end, and the world edge holds', () => {
    const b = newBody(-54, 1, 5.5); settle(b);
    walk(b, 60, 5.5, { sprint: true });
    expect(b.x).toBeGreaterThan(59);
    expect(b.y).toBeCloseTo(0.12, 2);
    // run into the boundary hedge/wall: must stay inside
    for (let i = 0; i < 400; i++) stepBody(map.world, b, { ...idle, mx: 1, mz: 0.4, sprint: true }, SIM_DT);
    expect(b.x).toBeLessThan(map.bounds.x1 + 0.1);
    expect(b.z).toBeLessThan(map.bounds.z1 + 0.1);
  });

  it('a closed front door blocks, an open one lets you into the living room', () => {
    // house No. 12 is on the north side: its front door is on the wall at z=-11
    const d = map.doors.find((x) => x.name === 'Front door')!;
    const b = newBody(d.cx, 1, -8.2); settle(b);
    walk(b, d.cx, -14, { max: 300 });
    expect(b.z).toBeGreaterThan(-11.2); // stopped at the door
    openDoor('Front door');
    walk(b, d.cx, -14, { max: 600 });
    const blockers = map.world.query(b.x - 0.4, b.z - 0.4, b.x + 0.4, b.z + 0.4, []).map((o) => `${o.id}[${o.minX.toFixed(2)},${o.minY.toFixed(2)},${o.minZ.toFixed(2)}→${o.maxX.toFixed(2)},${o.maxY.toFixed(2)},${o.maxZ.toFixed(2)}]`);
    expect(b.z, `at ${b.x},${b.y},${b.z}: ${blockers.join(' | ')}`).toBeLessThan(-12.5);   // inside
    closeDoor('Front door');
  });

  it('you can walk from the lobby up the staircase to every floor and the roof, never teleporting', () => {
    openDoor('Main entrance');
    const b = newBody(...apt(12, -3), 0) as Body; b.y = 1; settle(b);
    let maxDy = 0, last = b.y;
    const track = () => { maxDy = Math.max(maxDy, Math.abs(b.y - last)); last = b.y; };
    walk(b, ...apt(12, 3), { each: track });
    openDoor('Roof access door');
    for (let k = 0; k < 4; k++) {
      expect(b.y, `start of flight ${k}`).toBeCloseTo(APT.F[k], 1);
      // lane A south, across the landing, lane B north
      for (const [u, v] of [[12.4, 9.0], [12.4, 12.1], [12.4, 13.2], [13.8, 13.2], [13.8, 12.0], [13.8, 9.4]] as const) {
        const reached = walk(b, ...apt(u, v), { tol: 0.25, max: 600, each: track });
        const bl = map.world.query(b.x - 0.5, b.z - 0.5, b.x + 0.5, b.z + 0.5, []).filter((o) => o.maxY > b.y - 0.1 && o.minY < b.y + 2.2).map((o) => `${o.id}[${(o.minX - 3).toFixed(2)},${o.minY.toFixed(2)},${(o.minZ - 11).toFixed(2)}→${(o.maxX - 3).toFixed(2)},${o.maxY.toFixed(2)},${(o.maxZ - 11).toFixed(2)}]`);
        expect(reached, `flight ${k} waypoint ${u},${v}: at u=${(b.x - 3).toFixed(2)} v=${(b.z - 11).toFixed(2)} y=${b.y.toFixed(2)} | ${bl.join(' ')}`).toBeLessThan(600);
      }
      expect(b.y, `top of flight ${k}`).toBeCloseTo(APT.F[k + 1], 1);
      expect(b.grounded).toBe(true);
      if (k < 3) walk(b, ...apt(12.4, 8.4), { tol: 0.2, max: 300, each: track }); // step back from the edge to the corridor
      if (k < 3) walk(b, ...apt(12.4, 9.0), { tol: 0.2, max: 300, each: track });
    }
    // out onto the roof terrace
    walk(b, ...apt(12, 5), { tol: 0.3, max: 600, each: track });
    expect(b.y).toBeCloseTo(APT.F[4], 2);
    expect(Math.abs(b.z - (11 + 5))).toBeLessThan(0.5);
    expect(maxDy).toBeLessThanOrEqual(0.21 + 1e-6);
    closeDoor('Main entrance'); closeDoor('Roof access door');
  });

  it('the lift carries riders between all four floors with doors that really open and close', () => {
    const def = map.lift, st = newLiftState(def);
    syncLiftSolids(def, map.world, st);
    const b = newBody(def.cx, def.floors[0] + 0.5, def.cz + 0.3);
    const tick = (blocked = false) => { stepLift(def, st, SIM_DT, blocked); syncLiftSolids(def, map.world, st); stepBody(map.world, b, idle, SIM_DT); };
    for (let i = 0; i < 60; i++) tick();
    expect(b.grounded).toBe(true);
    expect(insideCab(def, st, b.x, b.y, b.z)).toBe(true);

    for (const target of [3, 1, 2, 0]) {
      expect(requestFloor(def, st, target)).toBe(true);
      let sawClosed = false, minGap = Infinity;
      for (let i = 0; i < 20 / SIM_DT && !(st.mode === LM.IDLE && st.door >= 1 && Math.abs(st.y - def.floors[target]) < 0.01); i++) {
        tick();
        if (st.door === 0) sawClosed = true;
        minGap = Math.min(minGap, Math.abs(b.y - st.y));
        expect(insideCab(def, st, b.x, b.y, b.z), `rider stayed in cab heading to ${target} (y=${b.y.toFixed(2)} cab=${st.y.toFixed(2)})`).toBe(true);
      }
      expect(sawClosed).toBe(true);
      expect(st.y).toBeCloseTo(def.floors[target], 2);
      expect(b.y).toBeCloseTo(def.floors[target], 2);
    }
  });

  it('a rider can walk out of the lift onto each landing once the doors are open', () => {
    const def = map.lift, st = newLiftState(def);
    const b = newBody(def.cx, def.floors[0] + 0.5, def.cz); 
    const tick = () => { stepLift(def, st, SIM_DT, false); syncLiftSolids(def, map.world, st); stepBody(map.world, b, idle, SIM_DT); };
    syncLiftSolids(def, map.world, st);
    for (let i = 0; i < 30; i++) tick();
    requestFloor(def, st, 2);
    for (let i = 0; i < 20 / SIM_DT && !(st.mode === LM.IDLE && st.door >= 1 && Math.abs(st.y - def.floors[2]) < 0.01); i++) tick();
    // walk north out through the doors
    for (let i = 0; i < 180; i++) { stepLift(def, st, SIM_DT, false); syncLiftSolids(def, map.world, st); stepBody(map.world, b, { ...idle, mz: -1 }, SIM_DT); }
    expect(b.z).toBeLessThan(def.cz - def.hd - 1.5);
    expect(b.y).toBeCloseTo(def.floors[2], 2);
  });

  it('closed landing doors keep people out of the empty shaft', () => {
    const def = map.lift, st = newLiftState(def);
    // park the cab on floor 3 and try to walk into the shaft from the ground-floor lobby
    st.y = def.floors[3]; st.door = 1;
    syncLiftSolids(def, map.world, st);
    const b = newBody(def.cx, def.floors[0], def.cz - def.hd - 2.2); settle(b);
    walk(b, def.cx, def.cz, { max: 400 });
    expect(b.z).toBeLessThan(def.cz - def.hd - 0.5);
    expect(b.y).toBeCloseTo(def.floors[0], 2);
  });
});

describe('every house is a real, enterable home', () => {
  it('has all ten houses with doors, slots and sane anchors', () => {
    expect(map.houses).toHaveLength(10);
    for (const h of map.houses) {
      expect(h.slots).toHaveLength(5);
      for (const k of ['front', 'back', 'bedroom', 'storage'] as const) expect(map.doors[h.doors[k]].house).toBe(h.id);
      for (const [name, p] of Object.entries(h.rooms)) {
        if (name === 'yard') continue;
        expect(p.x > h.fp.x0 && p.x < h.fp.x1 && p.z > h.fp.z0 && p.z < h.fp.z1, `house ${h.id} room ${name} inside footprint`).toBe(true);
        expect(bodyFree(map.world, p.x, h.floorY, p.z), `house ${h.id} ${name} is free standing space`).toBe(true);
      }
    }
  });

  it('you can walk from the street through the front door to every room and out the back, in all ten houses', () => {
    for (const h of map.houses) {
      const toOpen = [h.doors.front, h.doors.bedroom, h.doors.storage, h.doors.back];
      for (const id of toOpen) map.world.solids[map.doors[id].solid].enabled = false;
      const b = newBody(h.front.x, h.floorY + 0.05, h.front.z); settle(b);
      const go = (name: string, x: number, z: number) => {
        const n = walk(b, x, z, { tol: 0.3, max: 900 });
        expect(n, `house ${h.id}: reached ${name} (${b.x.toFixed(1)},${b.z.toFixed(1)} → ${x.toFixed(1)},${z.toFixed(1)})`).toBeLessThan(900);
      };
      const fd = map.doors[h.doors.front];
      const dl = Math.hypot(fd.cx - h.front.x, fd.cz - h.front.z), ux = (fd.cx - h.front.x) / dl, uz = (fd.cz - h.front.z) / dl;
      go('door centre', fd.cx, fd.cz);
      go('inside the door', fd.cx + ux * 1.1, fd.cz + uz * 1.1);
      go('living', h.rooms.living.x, h.rooms.living.z);
      go('kitchen', h.rooms.kitchen.x, h.rooms.kitchen.z);
      go('living again', h.rooms.living.x, h.rooms.living.z);
      go('archway', h.arch.x, h.arch.z);
      go('hall', h.rooms.hall.x, h.rooms.hall.z);
      go('bedroom', h.rooms.bedroom.x, h.rooms.bedroom.z);
      go('hall again', h.rooms.hall.x, h.rooms.hall.z);
      go('storage', h.rooms.storage.x, h.rooms.storage.z);
      go('hall again 2', h.rooms.hall.x, h.rooms.hall.z);
      const bd = map.doors[h.doors.back];
      go('back door centre', bd.cx, bd.cz);
      go('back door', h.back.x, h.back.z);
      for (const id of toOpen) map.world.solids[map.doors[id].solid].enabled = true;
    }
  });
});
