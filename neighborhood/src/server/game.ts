import { bodyFree, bodyOverlapsXZ, newBody, stepBody, type Body } from '../shared/collision';
import { INTERACT_SERVER_RANGE, MAX_CHAT, SIM_DT, SNAP_EVERY } from '../shared/consts';
import { insideCab, liftDoorway, liftNearest, LM, newLiftState, requestFloor, stepLift, syncLiftSolids } from '../shared/lift';
import { buildMaple, type MapDef } from '../shared/map';
import { round3 } from '../shared/math';
import {
  cleanLook, cleanName, FL, type BodyWire, type C2S, type InputCmd, type Look, type LiftWire, type PlayerInfo, type PlayerWire, type S2C,
} from '../shared/protocol';
import type { StoreApi } from './types';

export interface Conn { send(msg: S2C): void; close(): void }

interface SPlayer {
  id: string; name: string; look: Look; body: Body; conn: Conn;
  queue: InputCmd[]; ack: number; seat: number; emote: number; found: Set<number>;
  lastChat: number; lastInteract: number; speed: number;
}

const MAX_PLAYERS = 40;
const DOOR_AUTOCLOSE_S = 30;

/** Authoritative world: ownership of every rule that matters lives here, never on the client. */
export class GameWorld {
  readonly map: MapDef;
  readonly players = new Map<string, SPlayer>();
  readonly lift;
  readonly doorsOpen = new Set<number>();
  readonly switchesOn = new Set<number>();
  private doorOpenedAt = new Map<number, number>();
  private stepNo = 0;
  private clock = 0;                 // seconds of simulated time
  private cabFloorSolid: number;

  constructor(readonly store: StoreApi, private idOf: (token: string) => string) {
    this.map = buildMaple();
    this.lift = newLiftState(this.map.lift);
    syncLiftSolids(this.map.lift, this.map.world, this.lift);
    this.cabFloorSolid = this.map.lift.cab[0].solid;
    for (const id of store.world.doors) this.setDoor(id, true, false);
    for (const id of store.world.sw) this.switchesOn.add(id);
  }

  get online() { return this.players.size; }
  get serverMs() { return Math.round(this.clock * 1000); }

  // ───────────────────────── join / leave ─────────────────────────
  join(conn: Conn, token: string, name: string, look: Look): SPlayer | null {
    if (typeof token !== 'string' || token.length < 12 || token.length > 128) { conn.send({ t: 'error', text: 'Bad token' }); return null; }
    const id = this.idOf(token);
    const existing = this.players.get(id);
    if (existing) { this.leave(existing); existing.conn.close(); }
    if (this.players.size >= MAX_PLAYERS) { conn.send({ t: 'error', text: 'Neighborhood is full' }); return null; }
    const rec = this.store.player(id);
    name = cleanName(name); look = cleanLook(look);
    const body = this.resolveSpawn(rec);
    const p: SPlayer = {
      id, name, look, body, conn, queue: [], ack: 0, seat: -1, emote: 0, found: new Set(rec?.found ?? []),
      lastChat: 0, lastInteract: 0, speed: 0,
    };
    this.players.set(id, p);
    this.persist(p);
    conn.send({
      t: 'welcome', id, name, look, you: this.bodyWire(body), seat: -1,
      players: [...this.players.values()].filter((o) => o !== p).map((o): PlayerInfo => ({ id: o.id, name: o.name, look: o.look })),
      doors: [...this.doorsOpen], sw: [...this.switchesOn], found: [...p.found], lift: this.liftWire(), st: this.serverMs, online: this.players.size,
    });
    this.broadcast({ t: 'join', p: { id, name, look } }, p);
    return p;
  }

  leave(p: SPlayer) {
    if (this.players.get(p.id) !== p) return;
    if (p.seat >= 0) this.unseat(p);
    this.persist(p);
    this.players.delete(p.id);
    this.broadcast({ t: 'leave', id: p.id });
  }

  /** Last saved position if it is still valid standing ground, else a spawn point on the pavement. */
  private resolveSpawn(rec?: { x: number; y: number; z: number; yaw: number }): Body {
    const m = this.map, def = m.lift;
    if (rec && [rec.x, rec.y, rec.z].every(Number.isFinite)) {
      const inShaft = Math.abs(rec.x - def.cx) < def.hw + 0.6 && Math.abs(rec.z - def.cz) < def.hd + 0.6 && rec.y > def.floors[0] - 0.5;
      if (!inShaft && rec.y > -0.5 && bodyFree(m.world, rec.x, rec.y + 0.02, rec.z)) {
        const b = newBody(rec.x, rec.y + 0.05, rec.z, rec.yaw || 0);
        for (let i = 0; i < 30; i++) stepBody(m.world, b, { mx: 0, mz: 0, jump: false, sprint: false }, SIM_DT);
        if (b.grounded && Math.abs(b.y - rec.y) < 0.6) return b;
      }
    }
    const s = m.spawns[Math.floor(Math.random() * m.spawns.length)];
    const b = newBody(s.x + (Math.random() - 0.5) * 0.8, 0.5, s.z, s.yaw);
    for (let i = 0; i < 30; i++) stepBody(m.world, b, { mx: 0, mz: 0, jump: false, sprint: false }, SIM_DT);
    return b;
  }

  private persist(p: SPlayer) {
    const b = p.body;
    this.store.setPlayer(p.id, { name: p.name, look: p.look, x: b.x, y: b.y, z: b.z, yaw: b.yaw, found: [...p.found], seen: Date.now() });
  }

  // ───────────────────────── messages ─────────────────────────
  onMessage(p: SPlayer, m: C2S) {
    switch (m.t) {
      case 'in': {
        if (!Array.isArray(m.inputs)) return;
        for (const c of m.inputs.slice(0, 12)) {
          if (!c || !Number.isFinite(c.s) || c.s <= p.ack) continue;
          if (p.queue.length >= 24) p.queue.shift();     // a flooding client only hurts itself
          p.queue.push({ s: c.s, x: num(c.x), z: num(c.z), j: c.j ? 1 : 0, r: c.r ? 1 : 0 });
        }
        return;
      }
      case 'interact': return this.interact(p, m.id);
      case 'lift': {
        const def = this.map.lift;
        if (insideCab(def, this.lift, p.body.x, p.body.y, p.body.z) && Number.isInteger(m.floor) && requestFloor(def, this.lift, m.floor))
          this.broadcast({ t: 'evt', k: 'liftgo', x: def.cx, y: this.lift.y, z: def.cz });
        return;
      }
      case 'emote':
        if (p.seat < 0 && p.body.grounded && p.speed < 0.5 && (m.id === 1 || m.id === 2)) p.emote = p.emote === m.id ? 0 : m.id;
        return;
      case 'stand': if (p.seat >= 0) this.unseat(p); return;
      case 'chat': {
        const text = String(m.text ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, MAX_CHAT);
        if (!text || wall() - p.lastChat < 0.7) return;
        p.lastChat = wall();
        this.broadcast({ t: 'chat', id: p.id, name: p.name, text });
        return;
      }
      case 'ping': p.conn.send({ t: 'pong', c: m.c, st: this.serverMs }); return;
    }
  }

  private interact(p: SPlayer, id: number) {
    const it = this.map.interactables[id];
    if (!it || wall() - p.lastInteract < 0.15) return;
    const def = this.map.lift;
    const ay = it.kind === 'liftPanel' ? this.lift.y + 1.1 : it.y;
    const d = Math.hypot(it.x - p.body.x, ay - (p.body.y + 1.0), it.z - p.body.z);
    if (d > INTERACT_SERVER_RANGE) return;
    p.lastInteract = wall();
    switch (it.kind) {
      case 'door': {
        const open = !this.doorsOpen.has(it.ref);
        if (!open && this.doorBlocked(it.ref)) { p.conn.send({ t: 'toast', text: 'Something is in the way.' }); return; }
        this.setDoor(it.ref, open, true);
        const dd = this.map.doors[it.ref];
        this.broadcast({ t: 'evt', k: 'door', x: dd.cx, y: dd.y0, z: dd.cz, o: open ? 1 : 0 });
        return;
      }
      case 'knock': this.broadcast({ t: 'evt', k: 'knock', x: it.x, y: it.y, z: it.z }); return;
      case 'bell': this.broadcast({ t: 'evt', k: 'bell', x: it.x, y: it.y, z: it.z }); return;
      case 'switch': {
        if (this.switchesOn.has(it.ref)) this.switchesOn.delete(it.ref); else this.switchesOn.add(it.ref);
        this.store.setWorld([...this.doorsOpen], [...this.switchesOn]);
        this.broadcastWorld();
        this.broadcast({ t: 'evt', k: 'click', x: it.x, y: it.y, z: it.z });
        return;
      }
      case 'seat': {
        if (p.seat >= 0) return;
        for (const o of this.players.values()) if (o.seat === it.ref) { p.conn.send({ t: 'toast', text: 'Someone is sitting there.' }); return; }
        const s = this.map.seats[it.ref];
        p.seat = s.id; p.emote = 0; p.queue.length = 0;
        Object.assign(p.body, { x: s.x, y: s.y, z: s.z, vx: 0, vy: 0, vz: 0, yaw: s.yaw, grounded: true, coyote: 0, support: -1 });
        return;
      }
      case 'liftCall': {
        if (Math.abs(p.body.y - def.floors[it.ref]) > 1.2) return;
        if (requestFloor(def, this.lift, it.ref)) this.broadcast({ t: 'evt', k: 'liftgo', x: def.cx, y: this.lift.y, z: def.cz });
        return;
      }
      case 'found': {
        if (p.found.has(it.ref)) return;
        p.found.add(it.ref);
        const f = this.map.found[it.ref];
        this.persist(p);
        p.conn.send({ t: 'found', id: f.id, name: f.name, text: f.text, total: this.map.found.length, count: p.found.size });
        return;
      }
      default: return;
    }
  }

  private setDoor(id: number, open: boolean, persist: boolean) {
    const d = this.map.doors[id];
    if (!d) return;
    this.map.world.solids[d.solid].enabled = !open;
    if (open) { this.doorsOpen.add(id); this.doorOpenedAt.set(id, this.clock); } else { this.doorsOpen.delete(id); this.doorOpenedAt.delete(id); }
    if (persist) { this.store.setWorld([...this.doorsOpen], [...this.switchesOn]); this.broadcastWorld(); }
  }
  private doorBlocked(id: number): boolean {
    const d = this.map.doors[id], s = this.map.world.solids[d.solid];
    for (const o of this.players.values()) if (o.body.y < s.maxY && o.body.y + 1.75 > s.minY && bodyOverlapsXZ(o.body, s, 0.12)) return true;
    return false;
  }
  private unseat(p: SPlayer) {
    const s = this.map.seats[p.seat];
    p.seat = -1;
    if (!s) return;
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    for (const [dx, dz] of [[fx, fz], [-fz, fx], [fz, -fx], [-fx, -fz]] as const)
      for (const r of [0.8, 1.1]) {
        const x = s.x + dx * r, z = s.z + dz * r;
        if (bodyFree(this.map.world, x, s.y + 0.02, z)) { Object.assign(p.body, { x, y: s.y + 0.02, z, vx: 0, vy: 0, vz: 0, grounded: false, coyote: 0 }); return; }
      }
    Object.assign(p.body, { y: s.y + 0.1, vy: 0, grounded: false });
  }

  // ───────────────────────── simulation ─────────────────────────
  step() {
    this.stepNo++; this.clock += SIM_DT;
    const def = this.map.lift;
    // lift (door safety: stays open while someone stands in the doorway)
    const dw = liftDoorway(def, this.lift);
    let blocked = false;
    for (const p of this.players.values()) {
      const b = p.body;
      if (b.x > dw.x0 && b.x < dw.x1 && b.z > dw.z0 && b.z < dw.z1 && b.y > dw.y0 && b.y < dw.y1) { blocked = true; break; }
    }
    const was = this.lift.mode;
    if (stepLift(def, this.lift, SIM_DT, blocked) === 'arrived')
      this.broadcast({ t: 'evt', k: 'ding', x: def.cx, y: this.lift.y, z: def.cz });
    if (was !== LM.MOVING && this.lift.mode === LM.MOVING) this.broadcast({ t: 'evt', k: 'liftgo', x: def.cx, y: this.lift.y, z: def.cz });
    syncLiftSolids(def, this.map.world, this.lift);

    if (this.stepNo % 60 === 0) this.autoCloseDoors();

    for (const p of this.players.values()) {
      const b = p.body;
      if (p.seat >= 0) { while (p.queue.length) p.ack = p.queue.shift()!.s; continue; }
      if (!p.queue.length) {
        // no input this tick: only keep riders glued to the cab (idempotent with the client's replay)
        if (b.grounded && b.support === this.cabFloorSolid) b.y = this.map.world.solids[b.support].maxY;
        p.speed = 0;
        continue;
      }
      let n = p.queue.length > 4 ? 2 : 1;
      while (n-- > 0 && p.queue.length) {
        const c = p.queue.shift()!;
        stepBody(this.map.world, b, { mx: c.x, mz: c.z, jump: !!c.j, sprint: !!c.r }, SIM_DT);
        p.ack = c.s;
        if (c.x || c.z || c.j) p.emote = 0;
      }
      p.speed = Math.hypot(b.vx, b.vz);
      if (b.y < -15) { Object.assign(b, this.resolveSpawn(undefined)); p.conn.send({ t: 'toast', text: 'Back to the street.' }); }
    }
    if (this.stepNo % SNAP_EVERY === 0) this.snapshot();
    if (this.stepNo % (60 * 15) === 0) for (const p of this.players.values()) this.persist(p);
  }

  private autoCloseDoors() {
    for (const id of [...this.doorsOpen]) {
      if (this.clock - (this.doorOpenedAt.get(id) ?? 0) < DOOR_AUTOCLOSE_S) continue;
      const d = this.map.doors[id];
      let near = false;
      for (const p of this.players.values()) if (Math.hypot(p.body.x - d.cx, p.body.z - d.cz) < 3.2 && Math.abs(p.body.y - d.y0) < 2.5) { near = true; break; }
      if (near || this.doorBlocked(id)) continue;
      this.setDoor(id, false, true);
      this.broadcast({ t: 'evt', k: 'door', x: d.cx, y: d.y0, z: d.cz, o: 0 });
    }
  }

  // ───────────────────────── snapshots ─────────────────────────
  private bodyWire(b: Body): BodyWire {
    return { x: round3(b.x), y: round3(b.y), z: round3(b.z), vx: round3(b.vx), vy: round3(b.vy), vz: round3(b.vz), yaw: round3(b.yaw), g: b.grounded ? 1 : 0, c: round3(b.coyote) };
  }
  private liftWire(): LiftWire {
    const l = this.lift;
    return { y: round3(l.y), v: round3(l.v), d: round3(l.door), m: l.mode, tg: l.target };
  }
  private playerWire(p: SPlayer): PlayerWire {
    const b = p.body;
    const onLift = b.grounded && b.support === this.cabFloorSolid;
    const f = (b.grounded ? FL.GROUNDED : 0) | (onLift ? FL.ON_LIFT : 0) | (p.emote << FL.EMOTE_SHIFT) | (p.seat >= 0 ? FL.SEATED : 0);
    return { i: p.id, x: round3(b.x), y: round3(b.y), z: round3(b.z), r: round3(b.yaw), s: Math.round(p.speed * 10), f, k: p.seat + 1 };
  }
  private snapshot() {
    const all = [...this.players.values()];
    const wires = all.map((p) => this.playerWire(p));
    const l = this.liftWire(), st = this.serverMs;
    for (let i = 0; i < all.length; i++) {
      const p = all[i];
      p.conn.send({ t: 'snap', st, ack: p.ack, you: this.bodyWire(p.body), seat: p.seat, p: wires.filter((_, j) => j !== i), l });
    }
  }

  private broadcast(m: S2C, except?: SPlayer) { for (const p of this.players.values()) if (p !== except) p.conn.send(m); }
  private broadcastWorld() { this.broadcast({ t: 'world', doors: [...this.doorsOpen], sw: [...this.switchesOn] }); }

  /** Nearest stop to the cab (used by tests/diagnostics). */
  liftFloor() { return liftNearest(this.map.lift, this.lift.y); }
}

const wall = () => performance.now() / 1000;   // rate limits use wall-clock time, not sim time
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
export type { SPlayer };
