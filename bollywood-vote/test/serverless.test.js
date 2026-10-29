import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createCore, parseRoster } from '../lib/core.js';
import { createRedisStore, fromFields, diff } from '../lib/redis-store.js';
import { createApi, nodeHandler } from '../lib/serverless.js';

// A just-enough Upstash REST server: POST /pipeline with [[CMD, ...args], ...] over one in-memory hash.
let fake;
let url;
const hash = new Map();
let delayMs = 0;

const run = ([cmd, , field, value]) => {
  switch (cmd) {
    case 'HGETALL': return [...hash].flat();
    case 'HSET': { const isNew = !hash.has(field); hash.set(field, value); return isNew ? 1 : 0; }
    case 'HSETNX': if (hash.has(field)) return 0; hash.set(field, value); return 1;
    case 'HDEL': return hash.delete(field) ? 1 : 0;
    default: throw new Error(`unsupported ${cmd}`);
  }
};

before(async () => {
  fake = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (req.headers.authorization !== 'Bearer secret') { res.writeHead(401); return res.end('{"error":"unauthorized"}'); }
      const commands = JSON.parse(raw);
      setTimeout(() => {
        const results = commands.map((c) => { try { return { result: run(c) }; } catch (e) { return { error: e.message }; } });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(results));
      }, delayMs);
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${fake.address().port}`;
});
after(() => fake.close());

const roster = parseRoster(Array.from({ length: 20 }, (_, i) => ({ name: `Guest ${i + 1}`, character: '' })));
const KEY = 'hostkey';
let n = 0;
const api = (opts = {}) =>
  createApi({ store: createRedisStore({ url, token: 'secret' }), defaultRoster: roster, hostKey: KEY, randomId: () => `tok-${++n}`, cacheMs: 0, ...opts });
const call = (a, method, path, body, hk) => a({ method, path, body: body ?? {}, query: {}, hostKey: hk });
const host = (a, path, body) => call(a, 'POST', path, body, KEY);

test('diff only emits what changed, and claims use HSETNX', () => {
  const core = createCore({ roster, hostKey: KEY, randomId: () => 'tok' });
  const before = structuredClone(core.state());
  assert.deepEqual(diff(before, core.state()), []);
  core.handle({ method: 'POST', path: '/api/claim', body: { voterId: 'p1' } });
  assert.deepEqual(diff(before, core.state()), [['HSETNX', 'bollywood-vote', 'c:p1', 'tok']]);
});

test('fromFields round-trips what diff writes', () => {
  const f = { phase: 'open', epoch: '3', showLive: '1', revealedAt: '0', 'c:p1': 't', 'v:p1': 'p2' };
  assert.deepEqual(fromFields(f), { phase: 'open', epoch: 3, showLive: true, revealedAt: 0, claims: { p1: 't' }, votes: { p1: 'p2' } });
  const tie = fromFields({ round: '2', contenders: '["p1","p2"]', tie: '{"ids":["p1","p2"],"votes":3}', drawn: '' });
  assert.deepEqual([tie.round, tie.contenders, tie.tie, tie.drawn], [2, ['p1', 'p2'], { ids: ['p1', 'p2'], votes: 3 }, undefined]);
});

test('a runoff survives across instances and a draw is stored once', async () => {
  hash.clear();
  let roll = 0;
  const a = (extra) => api({ random: () => roll, ...extra });
  const small = parseRoster(Array.from({ length: 4 }, (_, i) => ({ name: `G${i + 1}`, character: '' })));
  const run = (inst, m, path, body, hk) => call(inst, m, path, body, hk);
  await host(a(), '/api/host/roster', { text: small.map((p) => p.name).join('\n') });
  await host(a(), '/api/host/phase', { phase: 'open' });
  const tok = {};
  for (const p of small) tok[p.id] = (await run(a(), 'POST', '/api/claim', { voterId: p.id })).body.token;
  await run(a(), 'POST', '/api/vote', { voterId: 'p1', token: tok.p1, candidateId: 'p2' });
  await run(a(), 'POST', '/api/vote', { voterId: 'p2', token: tok.p2, candidateId: 'p1' });
  await host(a(), '/api/host/phase', { phase: 'closed' });
  assert.equal((await host(a(), '/api/host/phase', { phase: 'revealed' })).body.runoff, true);

  const st = (await call(a(), 'GET', '/api/state')).body;
  assert.deepEqual([st.phase, st.round, st.contenders, st.voted], ['open', 2, ['p1', 'p2'], []]);
  assert.equal((await run(a(), 'POST', '/api/vote', { voterId: 'p3', token: tok.p3, candidateId: 'p4' })).body.error, 'not_a_contender');

  await run(a(), 'POST', '/api/vote', { voterId: 'p3', token: tok.p3, candidateId: 'p1' });
  await run(a(), 'POST', '/api/vote', { voterId: 'p4', token: tok.p4, candidateId: 'p2' });
  await host(a(), '/api/host/phase', { phase: 'closed' });
  roll = 0.99;
  await host(a(), '/api/host/phase', { phase: 'revealed' });
  roll = 0; // a later instance must read the stored draw, not roll again
  const end = (await call(a(), 'GET', '/api/state')).body;
  assert.deepEqual([end.winners, end.tieBreak], [['p2'], 'draw']);
});

test('a read after the deadline closes the vote in the store', async () => {
  hash.clear();
  let t = 5_000_000;
  const a = () => api({ now: () => t });
  await host(a(), '/api/host/roster', { text: 'A\nB\nC' });
  await host(a(), '/api/host/phase', { phase: 'open' });
  assert.equal((await call(a(), 'GET', '/api/state')).body.phase, 'open');
  t += 301_000;
  assert.equal((await call(a(), 'GET', '/api/state')).body.phase, 'closed');
  assert.equal(hash.get('phase'), 'closed');
});

test('full flow through the store: claim, vote, close, reveal', async () => {
  hash.clear();
  const a = api();
  assert.equal((await call(a, 'GET', '/api/config')).body.transport, 'poll');
  assert.equal((await call(a, 'GET', '/api/state')).body.phase, 'waiting');

  const { body: me } = await call(a, 'POST', '/api/claim', { voterId: 'p1' });
  assert.equal((await call(a, 'POST', '/api/vote', { voterId: 'p1', token: me.token, candidateId: 'p2' })).body.error, 'not_open');
  assert.equal((await host(a, '/api/host/phase', { phase: 'open' })).status, 200);
  assert.equal((await call(a, 'POST', '/api/vote', { voterId: 'p1', token: me.token, candidateId: 'p2' })).status, 200);

  // A different "instance" (fresh createApi, no shared memory) sees the same game.
  const other = api();
  const st = (await call(other, 'GET', '/api/state')).body;
  assert.equal(st.phase, 'open');
  assert.deepEqual(st.voted, ['p1']);
  assert.equal(st.tallies, null, 'standings stay hidden');

  await host(other, '/api/host/phase', { phase: 'revealed' });
  const done = (await call(a, 'GET', '/api/state')).body;
  assert.deepEqual(done.winners, ['p2']);
});

test('twenty phones claiming and voting at once lose nothing', async () => {
  hash.clear();
  delayMs = 15; // widen the window so every request loads before any writes
  const a = api();
  await host(a, '/api/host/phase', { phase: 'open' });
  const phones = roster.map((p) => api());
  const claims = await Promise.all(phones.map((ph, i) => call(ph, 'POST', '/api/claim', { voterId: roster[i].id })));
  assert.ok(claims.every((c) => c.status === 200));
  const votes = await Promise.all(
    phones.map((ph, i) => call(ph, 'POST', '/api/vote', { voterId: roster[i].id, token: claims[i].body.token, candidateId: roster[(i + 1) % 20].id })),
  );
  assert.ok(votes.every((v) => v.status === 200));
  delayMs = 0;
  const st = (await call(api(), 'GET', '/api/state')).body;
  assert.equal(st.claimed.length, 20);
  assert.equal(st.voted.length, 20);
});

test('two phones grabbing the same name: exactly one wins', async () => {
  hash.clear();
  delayMs = 15;
  const results = await Promise.all([api(), api(), api()].map((a) => call(a, 'POST', '/api/claim', { voterId: 'p5' })));
  delayMs = 0;
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal(results.filter((r) => r.status === 409).length, 2);
  assert.equal([...hash.keys()].filter((k) => k === 'c:p5').length, 1);
});

test('reset and roster edits clear votes and claims in the store', async () => {
  hash.clear();
  const a = api();
  const { body: me } = await call(a, 'POST', '/api/claim', { voterId: 'p1' });
  await host(a, '/api/host/phase', { phase: 'open' });
  await call(a, 'POST', '/api/vote', { voterId: 'p1', token: me.token, candidateId: 'p2' });
  await host(a, '/api/host/reset', {});
  const st = (await call(api(), 'GET', '/api/state')).body;
  assert.equal(st.phase, 'waiting');
  assert.deepEqual([st.claimed, st.voted], [[], []]);
  assert.equal(st.epoch, 2);
  assert.equal((await host(api(), '/api/host/roster', { text: 'Ria | Geet\nSam' })).body.count, 2);
  assert.deepEqual((await call(api(), 'GET', '/api/state')).body.roster.map((p) => p.name), ['Ria', 'Sam']);
});

test('host calls need the key; missing config is a clear error', async () => {
  assert.equal((await call(api(), 'POST', '/api/host/reset', {}, 'wrong')).status, 401);
  const bad = await call(api({ hostKey: undefined }), 'GET', '/api/state');
  assert.equal(bad.status, 500);
  assert.equal(bad.body.error, 'not_configured');
  assert.equal((await call(api({ store: null }), 'GET', '/api/state')).body.error, 'not_configured');
});

test('the Vercel entry file serves requests end to end', async () => {
  hash.clear();
  process.env.HOST_KEY = KEY;
  process.env.KV_REST_API_URL = url;
  process.env.KV_REST_API_TOKEN = 'secret';
  const { default: handler } = await import('../api/[...path].js');

  const invoke = (method, path, { body, headers = {}, query } = {}) =>
    new Promise((resolve) => {
      const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { resolve({ status: this.statusCode, json: JSON.parse(b), headers: this.headers }); } };
      handler({ method, url: path, headers, body, query }, res);
    });

  const state = await invoke('GET', '/api/state?t=1');
  assert.equal(state.status, 200);
  assert.equal(state.json.roster.length, 0, 'the host types the names in');
  assert.equal((await invoke('POST', '/api/host/roster', { body: { text: 'Ria | Geet\nSam | Don\nLee' }, headers: { 'x-host-key': KEY } })).status, 200);
  assert.equal(state.headers['Cache-Control'], 'no-store');

  assert.equal((await invoke('POST', '/api/host/phase', { body: { phase: 'open' }, headers: { 'x-host-key': KEY } })).status, 200);
  const claim = await invoke('POST', '/api/claim', { body: JSON.stringify({ voterId: 'p3' }) });
  assert.equal(claim.status, 200, 'string bodies are parsed');
  assert.ok(claim.json.token);

  // If the platform only exposes the matched segments, the path is rebuilt from them.
  const viaQuery = await invoke('GET', '/api/[...path]?path=state', { query: { path: ['state'] } });
  assert.equal(viaQuery.json.phase, 'open');
});
