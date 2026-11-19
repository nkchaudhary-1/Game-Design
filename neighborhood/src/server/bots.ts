import { liftAtFloor, LM } from '../shared/lift';
import { DEFAULT_LOOK, type Look } from '../shared/protocol';
import type { GameWorld, SPlayer } from './game';

/**
 * Simulated neighbours. They are ordinary players: they join, send the same inputs a person would, sit on real
 * benches, ride the real lift and open real doors. Nothing here bypasses the rules the server enforces.
 */
export type Step =
  | { go: [number, number] }
  | { door: string; open: boolean }
  | { call: number }                     // press the lift call button on this floor and wait for the cab
  | { ride: number }                     // choose a floor inside the cab and wait for arrival
  | { sit: [number, number]; secs: number }
  | { say: string }
  | { emote: 1 | 2; secs: number }
  | { wait: number };

export interface BotSpec { name: string; look: Look; start: [number, number]; route: Step[] }

const STUCK_SECS = 4;

export class Bot {
  readonly p: SPlayer;
  cycles = 0;
  stuckSkips = 0;
  log: string[] = [];
  private seq = 0;
  private i = 0;
  private t = 0;
  private sent = 0;
  private lastCheck = { x: 0, z: 0, t: 0 };

  constructor(private world: GameWorld, readonly spec: BotSpec) {
    const conn = { send() {}, close() {} };
    const p = world.join(conn, `bot-token-${spec.name.toLowerCase()}-0000`, spec.name, spec.look);
    if (!p) throw new Error('bot could not join');
    this.p = p;
    Object.assign(p.body, { x: spec.start[0], y: 0.12, z: spec.start[1], vx: 0, vy: 0, vz: 0, grounded: false, yaw: Math.PI / 2 });
    this.resetStep();
  }

  private get step(): Step { return this.spec.route[this.i]; }
  private next() { this.i++; if (this.i >= this.spec.route.length) { this.i = 0; this.cycles++; } this.resetStep(); }
  private resetStep() { this.t = 0; this.sent = 0; this.lastCheck = { x: this.p.body.x, z: this.p.body.z, t: 0 }; }
  private input(x: number, z: number) { this.world.onMessage(this.p, { t: 'in', inputs: [{ s: ++this.seq, x, z, j: 0, r: 0 }] }); }
  private interactable(kind: string, ref: number) { return this.world.map.interactables.find((i) => i.kind === kind && i.ref === ref); }
  private doorId(name: string) { return this.world.map.doors.find((d) => d.name === name)?.id ?? -1; }
  private cabReady(floor: number) {
    const def = this.world.map.lift, st = this.world.lift;
    return liftAtFloor(def, st) === floor && st.mode === LM.IDLE && st.door >= 0.99;
  }

  /** Call once per simulation step, before world.step(). */
  tick(dt: number) {
    this.t += dt;
    const s = this.step, b = this.p.body;
    let moving = false;
    if ('go' in s) {
      const dx = s.go[0] - b.x, dz = s.go[1] - b.z, d = Math.hypot(dx, dz);
      if (d < 0.4) { this.next(); }
      else {
        this.input(dx / d, dz / d); moving = true;
        if (this.t - this.lastCheck.t >= STUCK_SECS) {
          if (Math.hypot(b.x - this.lastCheck.x, b.z - this.lastCheck.z) < 0.5) { this.stuckSkips++; this.log.push(`stuck@${b.x.toFixed(1)},${b.z.toFixed(1)}→${s.go}`); this.next(); }
          else this.lastCheck = { x: b.x, z: b.z, t: this.t };
        }
      }
    } else if ('door' in s) {
      const id = this.doorId(s.door), isOpen = this.world.doorsOpen.has(id);
      if (isOpen === s.open || this.sent >= 3) this.next();
      else if (this.t > this.sent * 0.8 + 0.2) { const it = this.interactable('door', id); if (it) this.world.onMessage(this.p, { t: 'interact', id: it.id }); this.sent++; }
    } else if ('call' in s) {
      if (this.cabReady(s.call)) this.next();
      else if (this.sent === 0) { const it = this.interactable('liftCall', s.call); if (it) this.world.onMessage(this.p, { t: 'interact', id: it.id }); this.sent = 1; }
      else if (this.t > 60) { this.stuckSkips++; this.log.push('call timeout'); this.next(); }
    } else if ('ride' in s) {
      if (this.sent === 0) { this.world.onMessage(this.p, { t: 'lift', floor: s.ride }); this.sent = 1; this.t = 0; }
      else if (this.t > 0.5 && this.cabReady(s.ride)) { this.log.push(`rode:${s.ride}`); this.next(); }
      else if (this.t > 60) { this.stuckSkips++; this.log.push('ride timeout'); this.next(); }
    } else if ('sit' in s) {
      if (this.sent === 0) {
        let best = -1, bd = 1e9;
        for (const seat of this.world.map.seats) {
          const d = Math.hypot(seat.x - s.sit[0], seat.z - s.sit[1]);
          if (d < bd) { bd = d; best = seat.id; }
        }
        const it = this.interactable('seat', best);
        if (it) this.world.onMessage(this.p, { t: 'interact', id: it.id });
        this.sent = 1; this.t = 0;
      } else if (this.sent === 1) {
        if (this.p.seat >= 0) { this.sent = 2; this.t = 0; }
        else if (this.t > 1.5) { this.stuckSkips++; this.log.push('could not sit'); this.next(); }
      } else if (this.t >= s.secs) { this.world.onMessage(this.p, { t: 'stand' }); this.next(); }
    } else if ('say' in s) {
      this.world.onMessage(this.p, { t: 'chat', text: s.say }); this.next();
    } else if ('emote' in s) {
      if (this.sent === 0) { this.world.onMessage(this.p, { t: 'emote', id: s.emote }); this.sent = 1; }
      else if (this.t >= s.secs) { if (this.p.emote === s.emote) this.world.onMessage(this.p, { t: 'emote', id: s.emote }); this.next(); }
    } else if (this.t >= s.wait) this.next();
    if (!moving && this.p.seat < 0) this.input(0, 0);   // idle input keeps acks flowing and riders glued to the cab
  }
}

const look = (skin: number, hair: number, shirt: number, pants: number, style: number): Look => ({ ...DEFAULT_LOOK, skin, hair, shirt, pants, style });

/** Three neighbours with different habits: a bench-sitter on the south pavement, a park-goer, and a lift rider. */
export const NEIGHBOURS: BotSpec[] = [
  {
    name: 'Priya', look: look(2, 0, 3, 1, 1), start: [-46, 5.5],
    route: [
      { go: [-26.45, 5.4] }, { sit: [-26.45, 6.5], secs: 14 }, { say: 'Morning! The light on Maple Street is gorgeous today.' },
      { go: [-12, 5.5] }, { emote: 1, secs: 4 }, { go: [8, 5.5] }, { go: [35.55, 5.4] }, { sit: [35.55, 6.5], secs: 12 },
      { say: 'Have you been up on the Maple Court roof yet?' }, { go: [58, 5.5] }, { wait: 3 }, { go: [20, 5.5] }, { go: [-44, 5.5] },
    ],
  },
  {
    name: 'Sam', look: look(0, 4, 1, 3, 0), start: [-44, -5.5],
    route: [
      { go: [-3.45, -5.5] }, { sit: [-3.45, -6.5], secs: 10 }, { go: [26, -5.5] }, { go: [26, -19.5] }, { go: [22, -19.5] }, { go: [22, -23.3] },
      { go: [25.55, -23.3] }, { sit: [25.55, -22.15], secs: 14 }, { say: 'Someone told me there is a hidden garden somewhere.' },
      { go: [22, -23.3] }, { go: [22, -19.5] }, { go: [26, -19.5] }, { emote: 2, secs: 5 }, { go: [26, -5.5] }, { go: [-44, -5.5] },
    ],
  },
  {
    name: 'Dev', look: look(3, 1, 4, 0, 2), start: [10, 5.5],
    route: [
      { go: [15, 5.5] }, { go: [15, 9.4] }, { door: 'Main entrance', open: true }, { go: [15, 13] }, { go: [13.6, 19.4] }, { call: 0 },
      { go: [13, 22.3] }, { ride: 2 }, { go: [13, 19.6] }, { go: [8, 19.6] }, { say: 'This corridor is so quiet.' }, { wait: 4 }, { go: [13, 19.6] },
      { call: 2 }, { go: [13, 22.3] }, { ride: 0 }, { go: [13, 19.6] }, { go: [15, 13] }, { door: 'Main entrance', open: true }, { go: [15, 9.4] }, { go: [15, 5.5] },
      { go: [30, 5.5] }, { wait: 6 }, { go: [10, 5.5] },
    ],
  },
];

export function addNeighbours(world: GameWorld, specs: BotSpec[] = NEIGHBOURS) {
  const bots = specs.map((s) => new Bot(world, s));
  return { bots, tick: (dt: number) => { for (const b of bots) b.tick(dt); } };
}
