import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCore, parseRoster } from '../public/js/core.js';
import { startHostServer, createGuestTransport, createLocalTransport } from '../public/js/p2p.js';

// ---- a tiny in-memory stand-in for PeerJS: ids, connections, events, and "peer-unavailable" / "unavailable-id" errors ----
function fakeNetwork() {
  const peers = new Map();
  let counter = 0;

  class Emitter {
    constructor() { this.handlers = {}; }
    on(ev, fn) { (this.handlers[ev] ||= []).push(fn); return this; }
    emit(ev, ...args) { for (const fn of this.handlers[ev] ?? []) fn(...args); }
  }

  class FakeConn extends Emitter {
    constructor() { super(); this.open = false; this.other = null; }
    send(data) {
      if (!this.open) throw new Error('not open');
      const copy = JSON.parse(JSON.stringify(data)); // like the real thing: data is serialised
      queueMicrotask(() => this.other?.open && this.other.emit('data', copy));
    }
    close() {
      if (!this.open) return;
      this.open = false;
      const other = this.other;
      queueMicrotask(() => { this.emit('close'); if (other?.open) { other.open = false; other.emit('close'); } });
    }
  }

  class FakePeer extends Emitter {
    constructor(idOrOpts) {
      super();
      this.id = typeof idOrOpts === 'string' ? idOrOpts : `guest-${++counter}`;
      this.destroyed = false;
      this.disconnected = false;
      this.conns = new Set();
      queueMicrotask(() => {
        if (peers.has(this.id)) this.emit('error', { type: 'unavailable-id' });
        else { peers.set(this.id, this); this.emit('open', this.id); }
      });
    }
    connect(remoteId) {
      const mine = new FakeConn();
      const theirs = new FakeConn();
      mine.other = theirs;
      theirs.other = mine;
      this.conns.add(mine);
      queueMicrotask(() => {
        const remote = peers.get(remoteId);
        if (!remote || remote.destroyed) return this.emit('error', { type: 'peer-unavailable' });
        remote.conns.add(theirs);
        remote.emit('connection', theirs);
        mine.open = true;
        theirs.open = true;
        theirs.emit('open');
        mine.emit('open');
      });
      return mine;
    }
    reconnect() { this.disconnected = false; }
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      if (peers.get(this.id) === this) peers.delete(this.id);
      for (const c of this.conns) c.close();
    }
  }
  return { Peer: FakePeer, peers };
}

const settle = (ms = 15) => new Promise((r) => setTimeout(r, ms));
const roster = parseRoster(Array.from({ length: 4 }, (_, i) => ({ name: `G${i + 1}`, character: `C${i + 1}` })));

function setup({ now } = {}) {
  const net = fakeNetwork();
  let n = 0;
  const core = createCore({ roster, hostKey: 'secret', randomId: () => `tok${++n}`, ...(now ? { now } : {}) });
  const statuses = [];
  const server = startHostServer({ core, getId: () => 'bn-host', setId: () => {}, onStatus: (s) => statuses.push(s), PeerClass: net.Peer, retryMs: 5 });
  const guest = () => createGuestTransport({ hostId: 'bn-host', PeerClass: net.Peer, retryMs: 10, connectTimeoutMs: 200, requestTimeoutMs: 200 });
  const local = createLocalTransport(core, core.hostKey());
  return { net, core, server, statuses, guest, local };
}

test('a phone connects through the broker and talks to the host like a normal client', async () => {
  const { server, guest, statuses } = setup();
  const g = guest();
  const out = await g.request({ method: 'GET', path: '/api/state', query: {}, body: {} });
  assert.equal(out.status, 200);
  assert.deepEqual(out.body.roster.map((p) => p.name), ['G1', 'G2', 'G3', 'G4']);
  assert.equal(statuses.at(-1).guests, 1);
  assert.equal(g.status().status, 'connected');
  g.stop(); server.stop();
});

test('requests made before the link is up are held and answered once it is', async () => {
  const { server, guest } = setup();
  const g = guest();
  const early = g.request({ method: 'GET', path: '/api/state', query: {}, body: {} }); // before 'open'
  assert.equal(g.status().status, 'connecting');
  assert.equal((await early).status, 200);
  g.stop(); server.stop();
});

test('the host pushes every change to every phone, and the first state on connect', async () => {
  const { server, guest, local } = setup();
  const a = guest(); const b = guest();
  const seenA = []; const seenB = [];
  a.subscribe((s) => seenA.push(s)); b.subscribe((s) => seenB.push(s));
  await settle();
  assert.equal(seenA.at(-1).phase, 'waiting', 'state arrives on connect');

  await local.request({ method: 'POST', path: '/api/host/phase', body: { phase: 'open', seconds: 120 } });
  await settle();
  assert.equal(seenA.at(-1).phase, 'open');
  assert.equal(seenB.at(-1).phase, 'open');
  a.stop(); b.stop(); server.stop();
});

test('a phone can never use host-only routes, even if it sends the key it does not have', async () => {
  const { server, guest } = setup();
  const g = guest();
  const out = await g.request({ method: 'POST', path: '/api/host/reset', query: { key: 'secret' }, body: {}, hostKey: 'secret' });
  assert.equal(out.status, 401);
  assert.equal((await g.request({ method: 'POST', path: '/api/host/phase', query: {}, body: { phase: 'revealed' } })).status, 401);
  g.stop(); server.stop();
});

test('a full vote over the link: claim, vote, scores stay hidden, the reveal shows the winner', async () => {
  const { server, guest, local } = setup();
  const phones = [guest(), guest(), guest()];
  const call = (g, method, path, body) => g.request({ method, path, query: {}, body: body ?? {} });
  await local.request({ method: 'POST', path: '/api/host/phase', body: { phase: 'open', seconds: 120 } });

  const tokens = [];
  for (const [i, g] of phones.entries()) tokens.push((await call(g, 'POST', '/api/claim', { voterId: `p${i + 1}` })).body.token);
  await Promise.all(phones.map((g, i) => call(g, 'POST', '/api/vote', { voterId: `p${i + 1}`, token: tokens[i], candidateId: i === 2 ? 'p2' : 'p3' })));

  const mid = (await call(phones[0], 'GET', '/api/state')).body;
  assert.deepEqual([mid.tallies, mid.winners], [null, null]);
  assert.equal(mid.voted.length, 3);

  await local.request({ method: 'POST', path: '/api/host/phase', body: { phase: 'revealed' } });
  const end = (await call(phones[0], 'GET', '/api/state')).body;
  assert.deepEqual(end.winners, ['p3']);
  phones.forEach((p) => p.stop()); server.stop();
});

test('a phone that cannot find the host says so, and connects when the host appears', async () => {
  const net = fakeNetwork();
  const statuses = [];
  const g = createGuestTransport({ hostId: 'bn-host', PeerClass: net.Peer, retryMs: 10, connectTimeoutMs: 200, requestTimeoutMs: 200 });
  g.onStatus((s) => statuses.push(s));
  await settle(40);
  assert.ok(statuses.includes('host-offline'), 'told the guest the host is not there');

  const core = createCore({ roster, hostKey: 'k', randomId: () => 'tok' });
  const server = startHostServer({ core, getId: () => 'bn-host', setId: () => {}, PeerClass: net.Peer, retryMs: 5 });
  await settle(60);
  assert.equal(g.status().status, 'connected');
  assert.equal((await g.request({ method: 'GET', path: '/api/state', query: {}, body: {} })).status, 200);
  g.stop(); server.stop();
});

test('if the host drops and comes back with the same id, phones reconnect and resync', async () => {
  const net = fakeNetwork();
  const core = createCore({ roster, hostKey: 'k', randomId: () => 'tok' });
  let server = startHostServer({ core, getId: () => 'bn-host', setId: () => {}, PeerClass: net.Peer, retryMs: 5 });
  const g = createGuestTransport({ hostId: 'bn-host', PeerClass: net.Peer, retryMs: 10, connectTimeoutMs: 200, requestTimeoutMs: 200 });
  const seen = [];
  const statuses = [];
  g.subscribe((s) => seen.push(s)); g.onStatus((s) => statuses.push(s));
  await settle();
  assert.equal(g.status().status, 'connected');

  server.stop(); // the host refreshes its page
  await settle(20);
  assert.ok(statuses.includes('reconnecting'));
  core.handle({ method: 'POST', path: '/api/host/phase', body: { phase: 'open', seconds: 120 }, hostKey: 'k' });
  server = startHostServer({ core, getId: () => 'bn-host', setId: () => {}, PeerClass: net.Peer, retryMs: 5 });
  await settle(80);
  assert.equal(g.status().status, 'connected');
  assert.equal(seen.at(-1).phase, 'open', 'the phone got the current state again');
  g.stop(); server.stop();
});

test('a host whose id is still held by its previous tab keeps retrying until it is free', async () => {
  const net = fakeNetwork();
  const squatter = new net.Peer('bn-host');
  await settle();
  const core = createCore({ roster, hostKey: 'k', randomId: () => 'tok' });
  const statuses = [];
  const server = startHostServer({ core, getId: () => 'bn-host', setId: () => {}, onStatus: (s) => statuses.push(s), PeerClass: net.Peer, retryMs: 5 });
  await settle(40);
  assert.equal(statuses.at(-1).state, 'connecting');
  squatter.destroy();
  await settle(40);
  assert.equal(statuses.at(-1).state, 'ready');
  server.stop();
});
