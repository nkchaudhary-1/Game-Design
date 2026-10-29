import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, parseRoster } from '../server.js';

let app;
let base;
const KEY = 'testkey';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bv-'));

const call = async (method, url, body, headers = {}) => {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};
const host = (url, body) => call('POST', url, body, { 'X-Host-Key': KEY });

before(async () => {
  app = createServer({ port: 0, dataDir, hostKey: KEY, defaultRoster: parseRoster(Array.from({ length: 20 }, (_, i) => ({ name: `Guest ${i + 1}`, character: '' }))) });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(() => app.close());

test('parseRoster handles "Name | Character" lines and drops blanks', () => {
  const r = parseRoster('Aarav | Raj — DDLJ\n\n  Meera  \r\nZoya|');
  assert.deepEqual(r.map((p) => [p.name, p.character]), [['Aarav', 'Raj — DDLJ'], ['Meera', ''], ['Zoya', '']]);
});

test('guests can claim a name, but not take someone else’s', async () => {
  const a = await call('POST', '/api/claim', { voterId: 'p1' });
  assert.equal(a.status, 200);
  assert.ok(a.body.token);
  const again = await call('POST', '/api/claim', { voterId: 'p1', token: a.body.token });
  assert.equal(again.body.token, a.body.token, 'same phone re-claims idempotently');
  const clash = await call('POST', '/api/claim', { voterId: 'p1', token: 'someone-else' });
  assert.equal(clash.status, 409);
  assert.equal(clash.body.error, 'taken');
});

test('voting only works while open, with a valid token, never for yourself', async () => {
  const { body: me } = await call('POST', '/api/claim', { voterId: 'p2' });
  const vote = (candidateId, token = me.token, voterId = 'p2') => call('POST', '/api/vote', { voterId, token, candidateId });

  assert.equal((await vote('p3')).body.error, 'not_open', 'waiting phase');
  assert.equal((await host('/api/host/phase', { phase: 'open' })).status, 200);

  assert.equal((await vote('p2')).body.error, 'self_vote');
  assert.equal((await vote('p3', 'forged')).status, 401);
  assert.equal((await vote('nobody')).status, 400);
  assert.equal((await vote('p3')).status, 200);
  assert.equal((await vote('p4')).status, 200, 'vote can be changed while open');

  const st = (await call('GET', '/api/state')).body;
  assert.ok(st.voted.includes('p2'));
  assert.equal(st.voted.filter((id) => id === 'p2').length, 1, 'one vote per person');
});

test('standings stay hidden until revealed or live standings is on', async () => {
  let st = (await call('GET', '/api/state')).body;
  assert.equal(st.tallies, null);
  assert.equal(st.winners, null);
  assert.ok(!JSON.stringify(st).includes('"candidateId"'), 'no per-person ballots in public state');

  await host('/api/host/live', { showLive: true });
  st = (await call('GET', '/api/state')).body;
  assert.equal(st.tallies.p4, 1);
  await host('/api/host/live', { showLive: false });
  assert.equal((await call('GET', '/api/state')).body.tallies, null);
});

test('host endpoints require the key', async () => {
  assert.equal((await call('POST', '/api/host/phase', { phase: 'closed' })).status, 401);
  assert.equal((await call('POST', '/api/host/phase', { phase: 'closed' }, { 'X-Host-Key': 'wrong' })).status, 401);
});

test('closed phase rejects votes; reveal returns the winner', async () => {
  await host('/api/host/phase', { phase: 'closed' });
  const { body: c } = await call('POST', '/api/claim', { voterId: 'p5' });
  assert.equal(c.error, 'closed');

  await host('/api/host/phase', { phase: 'revealed' });
  const st = (await call('GET', '/api/state')).body;
  assert.deepEqual(st.winners, ['p4']);
  assert.equal(st.tallies.p4, 1);
});

test('release frees a name and drops its vote; unclaim is blocked after voting', async () => {
  await host('/api/host/phase', { phase: 'open' });
  const { body: p6 } = await call('POST', '/api/claim', { voterId: 'p6' });
  await call('POST', '/api/vote', { voterId: 'p6', token: p6.token, candidateId: 'p3' });
  const before = (await call('GET', '/api/state')).body;
  assert.ok(before.claimed.includes('p6') && before.voted.includes('p6'));
  assert.equal((await host('/api/host/release', { voterId: 'p6' })).status, 200);
  const after = (await call('GET', '/api/state')).body;
  assert.ok(!after.claimed.includes('p6'));
  assert.ok(!after.voted.includes('p6'));

  const { body: p7 } = await call('POST', '/api/claim', { voterId: 'p7' });
  assert.equal((await call('POST', '/api/unclaim', { voterId: 'p7', token: p7.token })).status, 200, 'unclaim before voting');
  const { body: p8 } = await call('POST', '/api/claim', { voterId: 'p8' });
  await call('POST', '/api/vote', { voterId: 'p8', token: p8.token, candidateId: 'p1' });
  assert.equal((await call('POST', '/api/unclaim', { voterId: 'p8', token: p8.token })).status, 409);
});

test('roster edits only while waiting; reset clears everything and bumps the epoch', async () => {
  assert.equal((await host('/api/host/roster', { text: 'A\nB' })).body.error, 'locked');
  const e0 = (await call('GET', '/api/state')).body.epoch;
  await host('/api/host/reset', {});
  const st = (await call('GET', '/api/state')).body;
  assert.equal(st.phase, 'waiting');
  assert.equal(st.voted.length + st.claimed.length, 0);
  assert.equal(st.epoch, e0 + 1);

  assert.equal((await host('/api/host/roster', { text: 'Only One' })).body.error, 'need_two');
  const ok = await host('/api/host/roster', { text: 'Ria | Geet\nSam | Don\nLee' });
  assert.equal(ok.body.count, 3);
  assert.deepEqual((await call('GET', '/api/state')).body.roster.map((p) => p.name), ['Ria', 'Sam', 'Lee']);
});

test('state survives a restart', async () => {
  const key = app.hostKey();
  const snapshot = app.state().roster;
  app.close();
  app = createServer({ port: 0, dataDir, hostKey: key });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  assert.deepEqual((await call('GET', '/api/state')).body.roster, snapshot);
});

test('static pages are served and path traversal is refused', async () => {
  for (const p of ['/', '/host', '/css/style.css', '/vendor/qrcode.js']) {
    const res = await fetch(base + p);
    assert.equal(res.status, 200, p);
  }
  const res = await fetch(base + '/..%2fserver.js');
  assert.notEqual(res.status, 200);
  const raw = await new Promise((resolve) => {
    import('node:http').then(({ default: http }) => {
      const r = http.request({ host: '127.0.0.1', port: app.server.address().port, path: '/../server.js' }, (x) => resolve(x.statusCode));
      r.end();
    });
  });
  assert.notEqual(raw, 200);
});
