import { TAG_GLASS } from '../shared/collision';
import { nightness, hourAt } from '../shared/daycycle';
import { R } from '../shared/game/rules';
import { DEFAULT_LOOK, type Look } from '../shared/protocol';
import type { GameWorld, SPlayer } from './game';
import type { Gameplay } from './gameplay';

/**
 * The Neighborhood Watch. Two officers walk the pavements. They are ordinary players to the server: same inputs,
 * same collision, same line of sight. They only act on people who are *wanted*: an alarm is ringing, or the
 * person is carrying stolen goods in view. Doors they cannot open stop them, so a house is a place to hide.
 */
type State = 'patrol' | 'respond' | 'chase' | 'search';
const NAVY: Look = { ...DEFAULT_LOOK, skin: 1, hair: 0, shirt: 7, pants: 3, style: 3 };

class Guard {
  p!: SPlayer;
  state: State = 'patrol';
  seq = 0;
  wp = 0;
  target: { x: number; z: number } | null = null;
  targetId = '';
  hold = 0;
  searchT = 0;
  stuck = { x: 0, z: 0, t: 0 };
  side = 0;
  constructor(readonly name: string, readonly route: [number, number][], w: GameWorld) {
    const p = w.join({ send() {}, close() {} }, `watch-token-${name.toLowerCase().replace(/\W/g, '')}-0000`, name, NAVY);
    if (!p) throw new Error('guard could not join');
    this.p = p;
    Object.assign(p.body, { x: route[0][0], y: 0.12, z: route[0][1], vx: 0, vy: 0, vz: 0, grounded: false });
  }
}

export class Guards {
  list: Guard[] = [];
  freeze = false;                      // tests
  private lastSeen = new Map<string, number>();
  private t = 0;
  private visionTimer = 0;
  constructor(private w: GameWorld, private play: Gameplay) {
    this.list.push(
      new Guard('Officer Reyes', [[-50, -5.5], [-14, -5.5], [-14, -44], [-14, -5.5], [58, -5.5], [20, -5.5]], w),
      new Guard('Officer Tan', [[-50, 5.5], [60, 5.5], [20, 5.5]], w),
    );
  }
  sinceSeen(pid: string) { const s = this.lastSeen.get(pid); return s === undefined ? Infinity : this.t - s; }
  chasing(pid: string) { return this.list.some((g) => g.state === 'chase' && g.targetId === pid); }
  stand(pid: string) {
    this.lastSeen.delete(pid);
    for (const g of this.list) if (g.targetId === pid) { g.state = 'patrol'; g.targetId = ''; g.target = null; }
  }
  /** An alarm is ringing at (x,z): the nearest officer heads there and waits. */
  dispatch(x: number, z: number) {
    let best: Guard | null = null, bd = Infinity;
    for (const g of this.list) { const d = Math.hypot(g.p.body.x - x, g.p.body.z - z); if (d < bd) { bd = d; best = g; } }
    if (best && best.state !== 'chase') { best.state = 'respond'; best.target = { x, z }; best.hold = this.t + R.alarmTime + 25; }
  }
  /** A neighbour pointed the thief out. */
  tip(pid: string, x: number, z: number) {
    this.lastSeen.set(pid, this.t - 0.5);
    let best: Guard | null = null, bd = Infinity;
    for (const g of this.list) { const d = Math.hypot(g.p.body.x - x, g.p.body.z - z); if (d < bd) { bd = d; best = g; } }
    if (best) { best.state = 'chase'; best.targetId = pid; best.target = { x, z }; }
  }

  private input(g: Guard, dx: number, dz: number, mag: number, run: boolean) {
    const l = Math.hypot(dx, dz) || 1;
    this.w.onMessage(g.p, { t: 'in', inputs: [{ s: ++g.seq, x: (dx / l) * mag, z: (dz / l) * mag, j: 0, r: run ? 1 : 0 }] });
  }
  private idle(g: Guard) { this.w.onMessage(g.p, { t: 'in', inputs: [{ s: ++g.seq, x: 0, z: 0, j: 0, r: 0 }] }); }

  tick(dt: number) {
    this.t += dt;
    this.visionTimer += dt;
    if (this.visionTimer >= 0.2) { this.visionTimer = 0; this.look(); }
    if (!this.freeze) for (const g of this.list) this.act(g, dt);
  }

  private sees(g: Guard, t: SPlayer): boolean {
    const gb = g.p.body, tb = t.body;
    const dx = tb.x - gb.x, dz = tb.z - gb.z, dist = Math.hypot(dx, dz);
    const night = nightness(hourAt(this.w.serverMs / 1000));
    const range = R.guardSight.day + (R.guardSight.night - R.guardSight.day) * night;
    if (dist > range || Math.abs(tb.y - gb.y) > 3.2) return false;
    const cos = (dx * Math.sin(gb.yaw) + dz * Math.cos(gb.yaw)) / (dist || 1);
    if (dist > 4 && cos < R.guardCone) return false;
    const oy = gb.y + 1.55, ty = tb.y + 1.2, dy = ty - oy, len = Math.hypot(dist, dy) || 1;
    const hit = this.w.map.world.raycast(gb.x, oy, gb.z, dx / len, dy / len, dz / len, len, 0.02, (s) => (s.tag & TAG_GLASS) !== 0);
    return hit > len - 0.4;
  }
  private look() {
    for (const t of this.play.wanted()) {
      for (const g of this.list) {
        if (!this.sees(g, t)) continue;
        this.lastSeen.set(t.id, this.t);
        if (g.state !== 'chase' || g.targetId !== t.id) { g.state = 'chase'; g.targetId = t.id; this.w.broadcast({ t: 'evt', k: 'dog', x: g.p.body.x, y: g.p.body.y, z: g.p.body.z, o: 9 }); }
        g.target = { x: t.body.x, z: t.body.z };
      }
    }
  }

  private act(g: Guard, dt: number) {
    const b = g.p.body;
    if (g.state === 'chase') {
      const t = this.w.players.get(g.targetId);
      if (!t || !this.play.heistOf(g.targetId)) { g.state = 'patrol'; g.targetId = ''; return this.idle(g); }
      if (this.sinceSeen(g.targetId) < 0.5) g.target = { x: t.body.x, z: t.body.z };
      const d = Math.hypot(t.body.x - b.x, t.body.z - b.z);
      if (d < R.guardCatch && Math.abs(t.body.y - b.y) < 1.6) { this.play.arrest(t); g.state = 'patrol'; g.targetId = ''; return this.idle(g); }
      if (this.sinceSeen(g.targetId) > 6) { g.state = 'search'; g.searchT = 4; }
      return this.walk(g, g.target!.x, g.target!.z, R.guardSpeed, true, dt);
    }
    if (g.state === 'search') {
      g.searchT -= dt;
      if (g.searchT <= 0) { g.state = 'patrol'; g.targetId = ''; }
      return this.idle(g);
    }
    if (g.state === 'respond') {
      const tg = g.target!;
      if (Math.hypot(tg.x - b.x, tg.z - b.z) > 1.2) return this.walk(g, tg.x, tg.z, 0.9, true, dt);
      if (this.t > g.hold) { g.state = 'patrol'; g.target = null; }
      return this.idle(g);
    }
    const [wx, wz] = g.route[g.wp];
    if (Math.hypot(wx - b.x, wz - b.z) < 0.8) { g.wp = (g.wp + 1) % g.route.length; return this.idle(g); }
    this.walk(g, wx, wz, R.patrolSpeed, false, dt);
  }

  private walk(g: Guard, x: number, z: number, mag: number, run: boolean, dt: number) {
    const b = g.p.body, gs = g;
    gs.stuck.t += dt;
    if (gs.stuck.t > 1.2) {
      if (Math.hypot(b.x - gs.stuck.x, b.z - gs.stuck.z) < 0.35) gs.side = Math.random() < 0.5 ? -1 : 1; else gs.side = 0;
      gs.stuck = { x: b.x, z: b.z, t: 0 };
    }
    let dx = x - b.x, dz = z - b.z;
    if (gs.side) { const px = -dz * gs.side, pz = dx * gs.side; dx = dx * 0.3 + px; dz = dz * 0.3 + pz; }
    this.input(g, dx, dz, mag, run);
  }
}
