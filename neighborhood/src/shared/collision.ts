import { P } from './consts';
import { approachAngle } from './math';

/**
 * The whole world is axis-aligned boxes. That keeps the character controller small, deterministic and
 * identical on client and server. Doors and the lift cab are "dynamic" solids that are toggled/moved.
 */
export const TAG_GLASS = 1; // blocks bodies, never blocks the camera
export const TAG_NOCAM = 2; // blocks bodies, never blocks the camera (railings, cab ceiling…)

export interface Solid {
  id: number;
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
  group: number;   // visibility group (-1 = always); used by the camera to ignore cut-away geometry
  tag: number;
  enabled: boolean;
  dyn: boolean;
}

const CELL = 4;
const key = (cx: number, cz: number) => (cx + 1024) * 4096 + (cz + 1024);

export class CollisionWorld {
  readonly solids: Solid[] = [];
  private cells = new Map<number, Solid[]>();
  private dyn: Solid[] = [];
  private big: Solid[] = [];
  private stamp = 0;
  private seen: number[] = [];

  add(s: Omit<Solid, 'id' | 'enabled'> & { enabled?: boolean }): Solid {
    const solid: Solid = { ...s, id: this.solids.length, enabled: s.enabled ?? true };
    this.solids.push(solid);
    if (solid.dyn) this.dyn.push(solid);
    else {
      const x0 = Math.floor(solid.minX / CELL), x1 = Math.floor(solid.maxX / CELL);
      const z0 = Math.floor(solid.minZ / CELL), z1 = Math.floor(solid.maxZ / CELL);
      if ((x1 - x0 + 1) * (z1 - z0 + 1) > 36) this.big.push(solid);
      else
        for (let cx = x0; cx <= x1; cx++)
          for (let cz = z0; cz <= z1; cz++) {
            const k = key(cx, cz);
            let arr = this.cells.get(k);
            if (!arr) this.cells.set(k, (arr = []));
            arr.push(solid);
          }
    }
    return solid;
  }

  /** Enabled solids whose XZ footprint touches the rect. `out` is reused. */
  query(x0: number, z0: number, x1: number, z1: number, out: Solid[]): Solid[] {
    out.length = 0;
    const st = ++this.stamp;
    const seen = this.seen;
    const take = (s: Solid) => {
      if (!s.enabled || seen[s.id] === st) return;
      seen[s.id] = st;
      if (x1 > s.minX && x0 < s.maxX && z1 > s.minZ && z0 < s.maxZ) out.push(s);
    };
    const cx0 = Math.floor(x0 / CELL), cx1 = Math.floor(x1 / CELL);
    const cz0 = Math.floor(z0 / CELL), cz1 = Math.floor(z1 / CELL);
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cz = cz0; cz <= cz1; cz++) {
        const arr = this.cells.get(key(cx, cz));
        if (arr) for (let i = 0; i < arr.length; i++) take(arr[i]);
      }
    for (let i = 0; i < this.big.length; i++) take(this.big[i]);
    for (let i = 0; i < this.dyn.length; i++) take(this.dyn[i]);
    return out;
  }

  /** Distance along the ray to the first blocking solid (expanded by `margin`), or Infinity. Used by the camera. */
  raycast(
    ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
    maxT: number, margin: number, skip: (s: Solid) => boolean,
  ): number {
    const ex = ox + dx * maxT, ez = oz + dz * maxT;
    const list = this.query(Math.min(ox, ex) - margin, Math.min(oz, ez) - margin, Math.max(ox, ex) + margin, Math.max(oz, ez) + margin, rayTmp);
    let best = Infinity;
    for (const s of list) {
      if (skip(s)) continue;
      let t0 = 0, t1 = maxT;
      const axes: [number, number, number, number][] = [
        [ox, dx, s.minX - margin, s.maxX + margin],
        [oy, dy, s.minY - margin, s.maxY + margin],
        [oz, dz, s.minZ - margin, s.maxZ + margin],
      ];
      let hit = true;
      for (const [o, d, lo, hi] of axes) {
        if (Math.abs(d) < 1e-9) {
          if (o < lo || o > hi) { hit = false; break; }
        } else {
          let a = (lo - o) / d, b = (hi - o) / d;
          if (a > b) [a, b] = [b, a];
          if (a > t0) t0 = a;
          if (b < t1) t1 = b;
          if (t0 > t1) { hit = false; break; }
        }
      }
      if (hit && t0 < best) best = t0;
    }
    return best;
  }
}
const rayTmp: Solid[] = [];

// ───────────────────────── character controller ─────────────────────────

export interface Body {
  x: number; y: number; z: number;       // y = feet
  vx: number; vy: number; vz: number;
  yaw: number;                            // facing; forward = (sin yaw, cos yaw) in (x, z)
  grounded: boolean;
  coyote: number;
  support: number;                        // id of the solid being stood on (-1 none)
}
export interface MoveInput { mx: number; mz: number; jump: boolean; sprint: boolean }

export const newBody = (x = 0, y = 0, z = 0, yaw = 0): Body => ({
  x, y, z, vx: 0, vy: 0, vz: 0, yaw, grounded: false, coyote: 0, support: -1,
});

const R = P.r, H = P.h, STEP = P.step;
const E1 = 1e-4, GAP = 1e-3, INSET = 0.02;
const qa: Solid[] = [], qb: Solid[] = [], qc: Solid[] = [];

function headroomOk(w: CollisionWorld, x: number, z: number, y: number): boolean {
  const l = w.query(x - R, z - R, x + R, z + R, qb);
  for (const s of l) if (s.maxY > y + E1 && s.minY < y + H - E1) return false;
  return true;
}

function moveAxis(w: CollisionWorld, b: Body, dx: number, dz: number): void {
  if (dx === 0 && dz === 0) return;
  let nx = b.x + dx, nz = b.z + dz;
  const list = w.query(Math.min(b.x, nx) - R, Math.min(b.z, nz) - R, Math.max(b.x, nx) + R, Math.max(b.z, nz) + R, qa);
  const canStep = b.grounded || b.coyote > 0;
  const steps: Solid[] = [];
  const blockers: Solid[] = [];
  for (const s of list) {
    if (s.maxY <= b.y + E1 || s.minY >= b.y + H - E1) continue;
    if (!(nx + R > s.minX && nx - R < s.maxX && nz + R > s.minZ && nz - R < s.maxZ)) continue;
    if (canStep && s.maxY - b.y <= STEP + E1) steps.push(s);
    else blockers.push(s);
  }
  const clip = (arr: Solid[]) => {
    for (const s of arr) {
      if (dx > 0) nx = Math.min(nx, s.minX - R - GAP);
      else if (dx < 0) nx = Math.max(nx, s.maxX + R + GAP);
      if (dz > 0) nz = Math.min(nz, s.minZ - R - GAP);
      else if (dz < 0) nz = Math.max(nz, s.maxZ + R + GAP);
    }
  };
  clip(blockers);
  if (steps.length) {
    let top = -Infinity;
    for (const s of steps) if (nx + R > s.minX && nx - R < s.maxX && nz + R > s.minZ && nz - R < s.maxZ && s.maxY > top) top = s.maxY;
    if (top > -Infinity) {
      if (headroomOk(w, nx, nz, top)) b.y = top;
      else clip(steps);
    }
  }
  b.x = nx; b.z = nz;
}

function vertical(w: CollisionWorld, b: Body, dt: number, jump: boolean): void {
  if (jump && (b.grounded || b.coyote > 0)) {
    b.vy = P.jumpV; b.grounded = false; b.coyote = 0; b.support = -1;
  }
  if (!b.grounded) b.vy = Math.max(-P.maxFall, b.vy - P.gravity * dt);
  let ny = b.y + b.vy * dt;
  const list = w.query(b.x - R + INSET, b.z - R + INSET, b.x + R - INSET, b.z + R - INSET, qc);
  if (b.vy > 0) {
    let cl = Infinity;
    for (const s of list) if (s.minY >= b.y + H - E1 && s.minY < ny + H) cl = Math.min(cl, s.minY - H);
    if (cl < ny) { ny = cl; b.vy = 0; }
  }
  const reach = b.grounded ? b.y + STEP : b.y;
  let top = -Infinity, topId = -1;
  for (const s of list) if (s.maxY <= reach + E1 && s.maxY > top) { top = s.maxY; topId = s.id; }
  if (b.grounded) {
    if (top > -Infinity && top >= b.y - STEP - E1) { b.y = top; b.vy = 0; b.support = topId; }
    else { b.grounded = false; b.coyote = P.coyote; b.support = -1; }
  } else if (b.vy <= 0 && top > -Infinity && ny <= top + E1) {
    b.y = top; b.vy = 0; b.grounded = true; b.coyote = 0; b.support = topId;
  } else {
    b.y = ny;
    b.coyote = Math.max(0, b.coyote - dt);
  }
}

/** Advance one fixed step. Pure function of (world state, body, input) — client and server run the same code. */
export function stepBody(w: CollisionWorld, b: Body, inp: MoveInput, dt: number): void {
  let mx = inp.mx, mz = inp.mz;
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  const has = len > 0.01;
  const speed = inp.sprint ? P.sprint : P.walk;
  const tvx = has ? mx * speed : 0, tvz = has ? mz * speed : 0;
  const control = b.grounded ? 1 : P.airControl;
  const a = (has ? P.accel : P.decel) * control * dt;
  const dvx = tvx - b.vx, dvz = tvz - b.vz, dl = Math.hypot(dvx, dvz);
  if (dl <= a) { b.vx = tvx; b.vz = tvz; }
  else { b.vx += (dvx / dl) * a; b.vz += (dvz / dl) * a; }
  if (has) b.yaw = approachAngle(b.yaw, Math.atan2(mx, mz), P.turn * dt);

  moveAxis(w, b, b.vx * dt, 0);
  moveAxis(w, b, 0, b.vz * dt);
  vertical(w, b, dt, inp.jump);
}

/** True if a standing body at (x,y,z) would overlap any solid. Used to validate spawn points. */
export function bodyFree(w: CollisionWorld, x: number, y: number, z: number): boolean {
  const l = w.query(x - R, z - R, x + R, z + R, qb);
  for (const s of l) if (s.maxY > y + E1 + 0.05 && s.minY < y + H - E1) return false;
  return true;
}

/** Does the body's footprint overlap this solid's footprint (any height)? */
export function bodyOverlapsXZ(b: { x: number; z: number }, s: Solid, pad = 0): boolean {
  return b.x + R + pad > s.minX && b.x - R - pad < s.maxX && b.z + R + pad > s.minZ && b.z - R - pad < s.maxZ;
}
