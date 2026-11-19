import type { CollisionWorld, Solid } from './collision';
import type { LiftDef, LiftPart } from './map/core';
import { clamp } from './math';

/** Server-authoritative lift. Clients mirror {y, v, door, mode, target} from snapshots and run only syncLiftSolids. */
export const LIFT = { vmax: 2.6, acc: 1.8, doorT: 0.9, minV: 0.35 };
export const LM = { IDLE: 0, CLOSING: 1, MOVING: 2, OPENING: 3 } as const;

export interface LiftState {
  y: number; v: number;
  door: number;      // 0 closed … 1 open (cab doors and, when parked, the landing doors)
  mode: number;
  target: number;    // floor index the lift is heading to
  queue: number[];
}

export const newLiftState = (def: LiftDef): LiftState => ({ y: def.floors[0], v: 0, door: 1, mode: LM.IDLE, target: 0, queue: [] });

/** Nearest stop (for the floor indicator). */
export function liftNearest(def: LiftDef, y: number): number {
  let best = 0;
  for (let i = 1; i < def.floors.length; i++) if (Math.abs(def.floors[i] - y) < Math.abs(def.floors[best] - y)) best = i;
  return best;
}
/** Stop the cab is exactly level with, or -1 while between floors. */
export function liftAtFloor(def: LiftDef, st: LiftState): number {
  const i = liftNearest(def, st.y);
  return Math.abs(def.floors[i] - st.y) < 0.02 ? i : -1;
}

/** Queue a stop. Returns false if it was a no-op. */
export function requestFloor(def: LiftDef, st: LiftState, floor: number): boolean {
  if (floor < 0 || floor >= def.floors.length) return false;
  if (st.mode === LM.IDLE && liftAtFloor(def, st) === floor) {
    if (st.door < 1) { st.mode = LM.OPENING; return true; }
    return false;
  }
  if ((st.mode === LM.MOVING || st.mode === LM.CLOSING) && st.target === floor) return false;
  if (st.queue.includes(floor)) return false;
  st.queue.push(floor);
  return true;
}

/** Advance the lift. `blocked` = someone is standing in the doorway (door safety). Returns 'arrived' on the step it stops. */
export function stepLift(def: LiftDef, st: LiftState, dt: number, blocked: boolean): 'arrived' | null {
  switch (st.mode) {
    case LM.IDLE: {
      if (st.queue.length) {
        st.target = st.queue.shift()!;
        const here = liftAtFloor(def, st) === st.target;
        if (here) st.mode = st.door < 1 ? LM.OPENING : LM.IDLE;
        else st.mode = st.door > 0 ? LM.CLOSING : LM.MOVING;
      }
      return null;
    }
    case LM.CLOSING: {
      st.door = blocked ? Math.min(1, st.door + dt / LIFT.doorT) : Math.max(0, st.door - dt / LIFT.doorT);
      if (st.door <= 0) st.mode = LM.MOVING;
      return null;
    }
    case LM.MOVING: {
      const ty = def.floors[st.target];
      const rem = Math.abs(ty - st.y);
      const dir = Math.sign(ty - st.y) || 1;
      const va = Math.abs(st.v);
      const brake = (va * va) / (2 * LIFT.acc);
      const a = rem <= brake + 0.02 ? -LIFT.acc : LIFT.acc;
      const nv = clamp(va + a * dt, LIFT.minV, LIFT.vmax);
      const step = nv * dt;
      if (step >= rem) {
        st.y = ty; st.v = 0; st.mode = LM.OPENING;
        return 'arrived';
      }
      st.y += dir * step; st.v = dir * nv;
      return null;
    }
    default: { // OPENING
      st.door = Math.min(1, st.door + dt / LIFT.doorT);
      if (st.door >= 1) st.mode = LM.IDLE;
      return null;
    }
  }
}

function applyPart(s: Solid, p: LiftPart, ox: number, oy: number, oz: number, d: number, slide: number) {
  const r = p.rel;
  let minX = r[0], maxX = r[3];
  if (p.leaf === -1) maxX -= slide * d;
  else if (p.leaf === 1) minX += slide * d;
  s.minX = ox + minX; s.maxX = ox + maxX;
  s.minY = oy + r[1]; s.maxY = oy + r[4];
  s.minZ = oz + r[2]; s.maxZ = oz + r[5];
}

/** Write the lift's current pose into the collision world (cab moves; landing doors follow the parked cab). */
export function syncLiftSolids(def: LiftDef, world: CollisionWorld, st: LiftState): void {
  for (const p of def.cab) applyPart(world.solids[p.solid], p, def.cx, st.y, def.cz, st.door, def.slide);
  const at = liftAtFloor(def, st);
  for (const l of def.landings) {
    const d = l.floor === at ? st.door : 0;
    for (const p of l.parts) applyPart(world.solids[p.solid], p, 0, 0, 0, d, def.slide);
  }
}

/** The doorway volume that must be clear before the doors may close. */
export function liftDoorway(def: LiftDef, st: LiftState) {
  const at = Math.max(0, liftNearest(def, st.y));
  return { x0: def.cx - def.doorW / 2 - 0.25, x1: def.cx + def.doorW / 2 + 0.25, z0: def.cz - def.hd - 0.7, z1: def.cz - def.hd + 0.35, y0: def.floors[at] - 0.3, y1: def.floors[at] + 2.2 };
}

/** Is a body (feet y) standing inside the cab? */
export function insideCab(def: LiftDef, st: LiftState, x: number, y: number, z: number): boolean {
  return Math.abs(x - def.cx) < def.hw + 0.05 && Math.abs(z - def.cz) < def.hd + 0.05 && y > st.y - 0.4 && y < st.y + 1.2;
}
