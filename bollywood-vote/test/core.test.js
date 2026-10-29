import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCore, parseRoster } from '../lib/core.js';

const KEY = 'k';
const roster = parseRoster(Array.from({ length: 6 }, (_, i) => ({ name: `G${i + 1}`, character: '' })));

/** A game with a fake clock and a fixed "random" so timing and draws are deterministic. */
function game({ random = () => 0 } = {}) {
  let t = 1_000_000;
  let n = 0;
  const core = createCore({ roster, hostKey: KEY, randomId: () => `tok${++n}`, now: () => t, random });
  const req = (method, path, body, hostKey) => core.handle({ method, path, body: body ?? {}, query: {}, hostKey });
  const host = (path, body) => req('POST', path, body, KEY);
  const state = () => req('GET', '/api/state').body; // through a request, like a real client, so deadlines apply
  const join = (id) => req('POST', '/api/claim', { voterId: id }).body.token;
  return {
    core, req, host, state, join,
    advance: (ms) => { t += ms; },
    vote: (voterId, token, candidateId) => req('POST', '/api/vote', { voterId, token, candidateId }),
  };
}

/** p1..p6 join, then each votes as listed: { p1: 'p2', ... } */
function voteAll(g, picks) {
  const tokens = Object.fromEntries(roster.map((p) => [p.id, g.join(p.id)]));
  for (const [voter, cand] of Object.entries(picks)) assert.equal(g.vote(voter, tokens[voter], cand).status, 200, `${voter}->${cand}`);
  return tokens;
}

test('opening starts a 5-minute clock; time up closes the vote and later votes bounce', () => {
  const g = game();
  g.host('/api/host/phase', { phase: 'open' });
  assert.equal(g.state().endsAt - g.state().serverNow, 300_000);
  const tok = g.join('p1');
  g.advance(299_000);
  assert.equal(g.vote('p1', tok, 'p2').status, 200);
  g.advance(2_000);
  assert.equal(g.state().phase, 'closed', 'any request after the deadline closes it');
  assert.equal(g.vote('p1', tok, 'p3').body.error, 'not_open');
  assert.equal(g.state().endsAt, 0);
});

test('+1 minute extends an open vote; seconds are clamped', () => {
  const g = game();
  assert.equal(g.host('/api/host/extend', {}).status, 409, 'nothing to extend yet');
  g.host('/api/host/phase', { phase: 'open', seconds: 1 });
  assert.equal(g.state().endsAt - g.state().serverNow, 15_000, 'floor of 15s');
  g.host('/api/host/extend', {});
  assert.equal(g.state().endsAt - g.state().serverNow, 75_000);
});

test('the vote closes early once every guest has voted', () => {
  const g = game();
  g.host('/api/host/phase', { phase: 'open' });
  voteAll(g, { p1: 'p2', p2: 'p3', p3: 'p1', p4: 'p1', p5: 'p1', p6: 'p1' });
  assert.equal(g.state().phase, 'closed');
});

test('a tie goes to a 60s runoff among the tied people, and never reaches the reveal', () => {
  const g = game();
  g.host('/api/host/phase', { phase: 'open' });
  // p1 and p2 each get 3 votes
  const tokens = voteAll(g, { p1: 'p2', p2: 'p1', p3: 'p1', p4: 'p1', p5: 'p2', p6: 'p2' });
  g.host('/api/host/phase', { phase: 'closed' });
  const out = g.host('/api/host/phase', { phase: 'revealed' });
  assert.equal(out.body.runoff, true);

  const st = g.state();
  assert.equal(st.phase, 'open');
  assert.equal(st.round, 2);
  assert.deepEqual(st.contenders, ['p1', 'p2']);
  assert.deepEqual(st.tie, { ids: ['p1', 'p2'], votes: 3 });
  assert.equal(st.endsAt - st.serverNow, 60_000);
  assert.deepEqual(st.voted, [], 'first-round ballots are cleared');
  assert.ok(Object.values(st.tallies).every((n) => n === 0), 'live standings start from zero in the runoff');
  g.host('/api/host/live', { showLive: false });
  assert.equal(g.state().tallies, null, 'the host can hide standings for suspense');
  g.host('/api/host/live', { showLive: true });
  assert.equal(st.winners, null);
  assert.ok(st.claimed.length === 6, 'phones keep their identity');

  assert.equal(g.vote('p3', tokens.p3, 'p4').body.error, 'not_a_contender');
  assert.equal(g.vote('p1', tokens.p1, 'p1').body.error, 'self_vote');
  g.vote('p3', tokens.p3, 'p2');
  g.vote('p4', tokens.p4, 'p2');
  g.vote('p5', tokens.p5, 'p1');
  g.vote('p1', tokens.p1, 'p2');
  g.vote('p2', tokens.p2, 'p1');
  g.vote('p6', tokens.p6, 'p2');
  assert.equal(g.state().phase, 'closed', 'everyone voted in the runoff');

  g.host('/api/host/phase', { phase: 'revealed' });
  const done = g.state();
  assert.equal(done.phase, 'revealed');
  assert.deepEqual(done.winners, ['p2']);
  assert.equal(done.tieBreak, 'runoff');
});

test('level again after the runoff: a random draw picks exactly one winner', () => {
  for (const [roll, expected] of [[0, 'p1'], [0.99, 'p2']]) {
    const g = game({ random: () => roll });
    g.host('/api/host/phase', { phase: 'open' });
    const tokens = voteAll(g, { p1: 'p2', p2: 'p1', p3: 'p1', p4: 'p2', p5: 'p3', p6: 'p4' });
    g.host('/api/host/phase', { phase: 'closed' });
    assert.equal(g.host('/api/host/phase', { phase: 'revealed' }).body.runoff, true);
    g.vote('p3', tokens.p3, 'p1');
    g.vote('p4', tokens.p4, 'p2');
    g.host('/api/host/phase', { phase: 'closed' });
    g.host('/api/host/phase', { phase: 'revealed' });
    const st = g.state();
    assert.equal(st.phase, 'revealed');
    assert.deepEqual(st.winners, [expected]);
    assert.equal(st.tieBreak, 'draw');
    // replaying the reveal keeps the same winner
    g.host('/api/host/phase', { phase: 'revealed' });
    assert.deepEqual(g.state().winners, [expected]);
  }
});

test('no votes at all: reveal with no winner instead of a runoff', () => {
  const g = game();
  g.host('/api/host/phase', { phase: 'open' });
  g.host('/api/host/phase', { phase: 'closed' });
  g.host('/api/host/phase', { phase: 'revealed' });
  assert.equal(g.state().phase, 'revealed');
  assert.deepEqual(g.state().winners, []);
});

test('reset clears the tie-break state', () => {
  const g = game();
  g.host('/api/host/phase', { phase: 'open' });
  voteAll(g, { p1: 'p2', p2: 'p1' });
  g.host('/api/host/phase', { phase: 'closed' });
  g.host('/api/host/phase', { phase: 'revealed' });
  assert.equal(g.state().round, 2);
  g.host('/api/host/reset', {});
  const st = g.state();
  assert.deepEqual([st.round, st.contenders, st.tie, st.phase], [1, null, null, 'waiting']);
});
