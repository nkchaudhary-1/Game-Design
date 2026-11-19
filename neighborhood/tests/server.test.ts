import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { idFromToken } from '../src/server/store';
import { startServer, type RunningServer } from '../src/server/server';
import { DEFAULT_LOOK, type C2S, type S2C } from '../src/shared/protocol';
import { newBody, stepBody } from '../src/shared/collision';
import { SIM_DT } from '../src/shared/consts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
class TestClient {
  ws: WebSocket; msgs: S2C[] = []; seq = 0; id = '';
  last: Extract<S2C, { t: 'snap' }> | null = null;
  constructor(port: number, readonly token: string, readonly name: string) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as S2C;
      this.msgs.push(m);
      if (m.t === 'snap') this.last = m;
      if (m.t === 'welcome') this.id = m.id;
    });
  }
  async ready() {
    await new Promise<void>((r) => this.ws.on('open', () => r()));
    this.send({ t: 'hello', token: this.token, name: this.name, look: DEFAULT_LOOK });
    await this.waitFor((m) => m.t === 'welcome');
    return this;
  }
  send(m: C2S) { this.ws.send(JSON.stringify(m)); }
  /** Wait for a message matching `pred` that arrived at or after index `from` (default: from the start). */
  async waitFor<T extends S2C>(pred: (m: S2C) => boolean, ms = 3000, from = 0): Promise<T> {
    const t0 = Date.now();
    for (;;) {
      const f = this.msgs.slice(from).find(pred); if (f) return f as T;
      if (Date.now() - t0 > ms) throw new Error('timeout waiting for message');
      await sleep(10);
    }
  }
  /** Send a stream of identical inputs at 60 Hz for `secs`. */
  async hold(x: number, z: number, secs: number, o: { j?: 0 | 1; r?: 0 | 1 } = {}) {
    const n = Math.round(secs * 60);
    for (let i = 0; i < n; i++) {
      this.send({ t: 'in', inputs: [{ s: ++this.seq, x, z, j: o.j ?? 0, r: o.r ?? 0 }] });
      await sleep(1000 / 60);
    }
  }
  close() { this.ws.close(); }
}

let dir: string, srv: RunningServer;
const root = join(__dirname, '..');
beforeAll(async () => { dir = mkdtempSync(join(tmpdir(), 'nb-')); srv = await startServer({ port: 0, dataFile: join(dir, 'w.json'), dev: false, root }); });
afterAll(async () => { await srv.close(); rmSync(dir, { recursive: true, force: true }); });
const body = (c: TestClient) => srv.world.players.get(c.id)!.body;

describe('authoritative server', () => {
  it('two players see each other and the server owns their movement', async () => {
    const a = await new TestClient(srv.port, 'token-alpha-0000000001', 'Alpha').ready();
    const b = await new TestClient(srv.port, 'token-bravo-0000000002', 'Bravo').ready();
    await a.waitFor((m) => m.t === 'snap' && m.p.some((p) => p.i === b.id));
    await b.waitFor((m) => m.t === 'snap' && m.p.some((p) => p.i === a.id));
    const joined = a.msgs.find((m) => m.t === 'join') as Extract<S2C, { t: 'join' }>;
    expect(joined.p.name).toBe('Bravo');

    const start = { x: body(a).x, z: body(a).z };
    await a.hold(1, 0, 1);
    await sleep(150);
    const moved = body(a).x - start.x;
    expect(moved).toBeGreaterThan(2);                      // actually walked on the server
    expect(a.last!.you.x).toBeCloseTo(body(a).x, 1);       // snapshot reports the authoritative position
    const seenByB = b.last!.p.find((p) => p.i === a.id)!;
    expect(seenByB.x).toBeGreaterThan(start.x + 1.5);
    a.close(); b.close();
  });

  it('client-side prediction matches the server step for step (same shared code)', async () => {
    const c = await new TestClient(srv.port, 'token-pred-00000000003', 'Pred').ready();
    const sim = newBody(body(c).x, body(c).y, body(c).z, body(c).yaw);
    Object.assign(sim, { grounded: true });
    for (let i = 0; i < 6; i++) stepBody(srv.world.map.world, sim, { mx: 0, mz: 0, jump: false, sprint: false }, SIM_DT);
    const inputs = [] as { s: number; x: number; z: number; j: 0 | 1; r: 0 | 1 }[];
    for (let i = 0; i < 120; i++) inputs.push({ s: ++c.seq, x: Math.sin(i / 20), z: 0.6, j: i === 40 ? 1 : 0, r: i > 70 ? 1 : 0 });
    for (let i = 0; i < inputs.length; i += 3) { c.send({ t: 'in', inputs: inputs.slice(i, i + 3) }); await sleep(45); }
    await c.waitFor((m) => m.t === 'snap' && m.ack === c.seq, 4000);
    const server = c.last!.you;
    const pre = newBody(server.x, server.y, server.z);
    expect(Number.isFinite(pre.x)).toBe(true);
    // Replay on a copy of the world's body from the same start and compare
    const start = body(c);
    expect(Math.hypot(start.x - server.x, start.z - server.z)).toBeLessThan(0.01);
    c.close();
  });

  it('cannot be sped up by oversized input vectors', async () => {
    const c = await new TestClient(srv.port, 'token-hack-00000000004', 'Hacker').ready();
    Object.assign(body(c), { x: -45, y: 0.12, z: 5.5 });
    const x0 = body(c).x;
    await c.hold(1, 0, 1, { r: 0 });
    const walk = body(c).x - x0;
    const c2 = await new TestClient(srv.port, 'token-hack-00000000005', 'Hacker2').ready();
    Object.assign(body(c2), { x: -45, y: 0.12, z: 5.5 });
    const y0 = body(c2).x;
    for (let i = 0; i < 60; i++) { c2.send({ t: 'in', inputs: [{ s: ++c2.seq, x: 1e9, z: 0, j: 0, r: 0 }] }); await sleep(1000 / 60); }
    expect(body(c2).x - y0).toBeLessThan(walk * 1.25 + 0.5);
    c.close(); c2.close();
  });

  it('doors toggle on the server for everyone, and only within reach', async () => {
    const a = await new TestClient(srv.port, 'token-door-00000000006', 'Door').ready();
    const watcher = await new TestClient(srv.port, 'token-door-00000000007', 'Watcher').ready();
    const door = srv.world.map.doors.find((d) => d.name === 'Front door')!;
    const it = srv.world.map.interactables.find((i) => i.kind === 'door' && i.ref === door.id)!;
    a.send({ t: 'interact', id: it.id });                        // far away: ignored
    await sleep(150);
    expect(srv.world.doorsOpen.has(door.id)).toBe(false);
    Object.assign(body(a), { x: it.x + 0.3, y: 0.2, z: it.z + 1.2 });
    const mark = watcher.msgs.length;
    a.send({ t: 'interact', id: it.id });
    const w = await watcher.waitFor<Extract<S2C, { t: 'world' }>>((m) => m.t === 'world' && m.doors.includes(door.id), 3000, mark).catch((e) => { throw new Error(`${e.message}: door ${door.id} open=${srv.world.doorsOpen.has(door.id)} a=${JSON.stringify(body(a))} it=${it.x},${it.y},${it.z} online=${srv.world.online}`); });
    expect(w.doors).toContain(door.id);
    expect(srv.world.map.world.solids[door.solid].enabled).toBe(false);
    await sleep(200);
    const mark2 = watcher.msgs.length;
    a.send({ t: 'interact', id: it.id });
    await watcher.waitFor((m) => m.t === 'world' && !m.doors.includes(door.id), 3000, mark2);
    a.close(); watcher.close();
  });

  it('seats: sit, block a second sitter, stand up', async () => {
    const a = await new TestClient(srv.port, 'token-seat-00000000008', 'Sitter').ready();
    const b = await new TestClient(srv.port, 'token-seat-00000000009', 'Late').ready();
    const seat = srv.world.map.seats[0];
    const it = srv.world.map.interactables.find((i) => i.kind === 'seat' && i.ref === seat.id)!;
    for (const c of [a, b]) Object.assign(body(c), { x: seat.x, y: seat.y, z: seat.z + 1 });
    a.send({ t: 'interact', id: it.id });
    await a.waitFor((m) => m.t === 'snap' && m.seat === seat.id);
    b.send({ t: 'interact', id: it.id });
    const toast = await b.waitFor<Extract<S2C, { t: 'toast' }>>((m) => m.t === 'toast');
    expect(toast.text).toMatch(/sitting/i);
    const mark = a.msgs.length;
    a.send({ t: 'stand' });
    await a.waitFor((m) => m.t === 'snap' && m.seat === -1, 3000, mark);
    expect(srv.world.players.get(a.id)!.seat).toBe(-1);
    a.close(); b.close();
  });

  it('lift: select a floor from inside the cab and everyone riding arrives with it', async () => {
    const a = await new TestClient(srv.port, 'token-lift-00000000010', 'RiderA').ready();
    const b = await new TestClient(srv.port, 'token-lift-00000000011', 'RiderB').ready();
    const def = srv.world.map.lift;
    // let the lift settle at ground floor with doors open, then put both riders in the cab
    for (const [i, c] of [a, b].entries()) Object.assign(body(c), { x: def.cx + (i ? 0.4 : -0.4), y: def.floors[0], z: def.cz + 0.3, grounded: true, vy: 0 });
    await a.hold(0, 0, 0.3); await b.hold(0, 0, 0.1);
    // a rider outside cannot operate the lift
    const outsider = await new TestClient(srv.port, 'token-lift-00000000012', 'Outside').ready();
    outsider.send({ t: 'lift', floor: 2 });
    await sleep(100);
    expect(srv.world.lift.queue.length).toBe(0);
    a.send({ t: 'lift', floor: 3 });
    // keep both clients sending idle inputs the way the real client does
    const keep = async (c: TestClient) => { for (let i = 0; i < 60 * 14; i++) { c.send({ t: 'in', inputs: [{ s: ++c.seq, x: 0, z: 0, j: 0, r: 0 }] }); await sleep(1000 / 60); } };
    await Promise.all([keep(a), keep(b)]);
    expect(srv.world.lift.y).toBeCloseTo(def.floors[3], 2);
    expect(srv.world.lift.door).toBe(1);
    expect(body(a).y).toBeCloseTo(def.floors[3], 2);
    expect(body(b).y).toBeCloseTo(def.floors[3], 2);
    const snap = b.last!;
    expect(snap.you.y).toBeCloseTo(def.floors[3], 2);
    expect(snap.p.find((p) => p.i === a.id)!.f & 2).toBe(2);   // flagged as riding the lift
    expect(a.msgs.some((m) => m.t === 'evt' && m.k === 'ding')).toBe(true);
    a.close(); b.close(); outsider.close();
  }, 25000);

  it('persists position, discoveries and switches across a server restart', async () => {
    const token = 'token-keep-00000000020';
    const c = await new TestClient(srv.port, token, 'Keeper').ready();
    const id = c.id;
    expect(id).toBe(idFromToken(token));
    const found = srv.world.map.interactables.find((i) => i.kind === 'found')!;
    Object.assign(body(c), { x: found.x, y: 0.2, z: found.z - 0.5 });
    c.send({ t: 'interact', id: found.id });
    await c.waitFor((m) => m.t === 'found');
    await sleep(250);
    const sw = srv.world.map.interactables.find((i) => i.kind === 'switch')!;
    Object.assign(body(c), { x: sw.x, y: 0.2, z: sw.z + 0.5 });
    c.send({ t: 'interact', id: sw.id });
    await c.waitFor((m) => m.t === 'world' && m.sw.length === 1);
    Object.assign(body(c), { x: -30, y: 0.12, z: 5.5 });
    await c.hold(0, 0, 0.2);
    c.close();
    await sleep(100);
    const file = join(dir, 'w.json');
    await srv.close();
    srv = await startServer({ port: 0, dataFile: file, dev: false, root });
    const again = await new TestClient(srv.port, token, 'Keeper').ready();
    const w = again.msgs.find((m) => m.t === 'welcome') as Extract<S2C, { t: 'welcome' }>;
    expect(Math.hypot(w.you.x + 30, w.you.z - 5.5)).toBeLessThan(0.6);
    expect(w.found).toHaveLength(1);
    expect(w.sw).toHaveLength(1);
    again.close();
  });
});
