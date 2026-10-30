import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCore, parseRoster } from '../public/js/core.js';

const KEY = 'host-secret';
const roster = parseRoster(Array.from({ length: 6 }, (_, i) => ({ name: `G${i + 1}`, character: `Char ${i + 1}` })));

/** A game with a fake clock; `saved` restores an earlier save like a page refresh would. */
function game({ saved, persist } = {}) {
  let t = 1_000_000;
  let n = 0;
  const core = createCore({ roster, saved, hostKey: KEY, randomId: () => `tok${++n}`, now: () => t, persist });
  const req = (method, path, body, hostKey, query) => core.handle({ method, path, body: body ?? {}, query: query ?? {}, hostKey });
  const host = (path, body) => req('POST', path, body, KEY);
  return {
    core, req, host,
    state: () => req('GET', '/api/state').body, // through a request, like a real client, so deadlines apply
    join: (id) => req('POST', '/api/claim', { voterId: id }).body.token,
    vote: (voterId, token, candidateId) => req('POST', '/api/vote', { voterId, token, candidateId }),
    advance: (ms) => { t += ms; },
  };
}

/** Everyone joins, then each votes as listed: { p1: 'p2', ... } */
function voteAll(g, picks) {
  const tokens = Object.fromEntries(roster.map((p) => [p.id, g.join(p.id)]));
  for (const [voter, cand] of Object.entries(picks)) assert.equal(g.vote(voter, tokens[voter], cand).status, 200, `${voter}->${cand}`);
  return tokens;
}

test('parseRoster handles "Name | Character" lines and arrays, and drops blank names', () => {
  assert.deepEqual(parseRoster('Aarav | Raj\n\n  Meera  \r\nZoya|').map((p) => [p.name, p.character]), [['Aarav', 'Raj'], ['Meera', ''], ['Zoya', '']]);
  assert.deepEqual(parseRoster([{ name: ' Ria ', character: 'Geet' }, { name: '', character: 'x' }]).map((p) => p.id), ['p1']);
});

test('the host picks a duration; the clock runs and closes voting by itself at zero', () => {
  const g = game();
  g.host('/api/host/phase', { phase: 'open', seconds: 120 });
  assert.equal(g.state().endsAt - g.state().serverNow, 120_000);
  const tok = g.join('p1');
  g.advance(119_000);
  assert.equal(g.vote('p1', tok, 'p2').status, 200);
  g.advance(2_000);
  assert.equal(g.state().phase, 'closed');
  assert.equal(g.vote('p1', tok, 'p3').body.error, 'not_open', 'late votes are refused');
  assert.equal(g.state().endsAt, 0);
});

test('durations are clamped to something sensible', () => {
  const g = game();
  g.host('/api/host/phase', { phase: 'open', seconds: 1 });
  assert.equal(g.state().endsAt - g.state().serverNow, 15_000);
  g.host('/api/host/phase', { phase: 'open', seconds: 99999 });
  assert.equal(g.state().endsAt - g.state().serverNow, 1_800_000);
});

test('voting stays open until zero even if everyone has voted', () => {
  const g = game();
  g.host('/api/host/phase', { phase: 'open', seconds: 120 });
  voteAll(g, { p1: 'p2', p2: 'p3', p3: 'p1', p4: 'p1', p5: 'p1', p6: 'p1' });
  assert.equal(g.state().phase, 'open');
});

test('no scores or rankings anywhere until the host reveals', () => {
  const g = game();
  g.host('/api/host/phase', { phase: 'open', seconds: 120 });
  voteAll(g, { p1: 'p2', p2: 'p3', p3: 'p2' });
  for (const phase of ['open', 'closed']) {
    if (phase === 'closed') g.host('/api/host/phase', { phase: 'closed' });
    const st = g.state();
    assert.equal(st.tallies, null, `${phase}: no tallies`);
    assert.equal(st.winners, null, `${phase}: no winner`);
    assert.ok(!JSON.stringify(st).includes('candidateId'), `${phase}: no ballots`);
    assert.deepEqual(st.voted.sort(), ['p1', 'p2', 'p3'], 'only who has voted is visible, never for whom');
  }
  g.host('/api/host/phase', { phase: 'revealed' });
  const st = g.state();
  assert.deepEqual(st.winners, ['p2']);
  assert.equal(st.tallies.p2, 2);
});

test('host-only routes need the host key; it cannot be passed in the query', () => {
  const g = game();
  assert.equal(g.req('POST', '/api/host/reset', {}, 'wrong').status, 401);
  assert.equal(g.req('POST', '/api/host/reset', {}).status, 401);
  assert.equal(g.req('POST', '/api/host/reset', {}, undefined, { key: KEY }).status, 401);
  assert.equal(g.req('GET', '/api/host/ping', {}, KEY).status, 200);
});

test('a tie shows joint winners and never picks one at random', () => {
  const g = game();
  g.host('/api/host/phase', { phase: 'open', seconds: 120 });
  voteAll(g, { p1: 'p2', p2: 'p1', p3: 'p1', p4: 'p2' });
  g.host('/api/host/phase', { phase: 'closed' });
  g.host('/api/host/phase', { phase: 'revealed' });
  const st = g.state();
  assert.deepEqual(st.winners, ['p1', 'p2']);
  assert.deepEqual([st.tallies.p1, st.tallies.p2], [2, 2]);
});

test('no votes at all: nobody wins', () => {
  const g = game();
  g.host('/api/host/phase', { phase: 'open', seconds: 120 });
  g.advance(121_000);
  g.host('/api/host/phase', { phase: 'revealed' });
  assert.deepEqual(g.state().winners, []);
});

test('the host can hold a tie-break among the tied; it is optional and only after a tie', () => {
  const g = game();
  assert.equal(g.host('/api/host/tiebreak', {}).body.error, 'not_revealed');
  g.host('/api/host/phase', { phase: 'open', seconds: 120 });
  const tokens = voteAll(g, { p1: 'p2', p2: 'p1', p3: 'p1', p4: 'p2' });
  g.host('/api/host/phase', { phase: 'revealed' });
  assert.equal(g.state().phase, 'revealed', 'revealing a tie does not start anything by itself');

  assert.equal(g.host('/api/host/tiebreak', {}).status, 200);
  let st = g.state();
  assert.deepEqual([st.phase, st.round, st.contenders, st.tie], ['open', 2, ['p1', 'p2'], { ids: ['p1', 'p2'], votes: 2 }]);
  assert.equal(st.endsAt - st.serverNow, 60_000);
  assert.deepEqual(st.voted, [], 'first-round ballots are cleared');
  assert.equal(st.claimed.length, 6, 'phones keep their identity');
  assert.equal(st.tallies, null, 'hidden again');

  assert.equal(g.vote('p3', tokens.p3, 'p4').body.error, 'not_a_contender');
  assert.equal(g.vote('p1', tokens.p1, 'p1').body.error, 'self_vote');
  g.vote('p3', tokens.p3, 'p2');
  g.vote('p4', tokens.p4, 'p2');
  g.vote('p5', tokens.p5, 'p1');
  g.advance(61_000);
  assert.equal(g.state().phase, 'closed');
  g.host('/api/host/phase', { phase: 'revealed' });
  st = g.state();
  assert.deepEqual(st.winners, ['p2']);
  assert.equal(st.round, 2);
});

test('tie-break needs a tie; a second tie is again shown as joint winners', () => {
  const g = game();
  g.host('/api/host/phase', { phase: 'open', seconds: 120 });
  voteAll(g, { p1: 'p2', p3: 'p2' });
  g.host('/api/host/phase', { phase: 'revealed' });
  assert.equal(g.host('/api/host/tiebreak', {}).body.error, 'no_tie');

  const h = game();
  h.host('/api/host/phase', { phase: 'open', seconds: 120 });
  const tokens = voteAll(h, { p1: 'p2', p2: 'p1' });
  h.host('/api/host/phase', { phase: 'revealed' });
  h.host('/api/host/tiebreak', {});
  h.vote('p1', tokens.p1, 'p2'); // level again: the two can only vote for each other
  h.vote('p2', tokens.p2, 'p1');
  h.advance(61_000);
  h.host('/api/host/phase', { phase: 'revealed' });
  assert.deepEqual(h.state().winners, ['p1', 'p2']);
  assert.equal(h.host('/api/host/tiebreak', {}).status, 200, 'the host may try again');
});

test('names: one phone per guest, a claim is idempotent, release frees it, unclaim is blocked after voting', () => {
  const g = game();
  const t1 = g.join('p1');
  assert.equal(g.req('POST', '/api/claim', { voterId: 'p1', token: t1 }).body.token, t1);
  assert.equal(g.req('POST', '/api/claim', { voterId: 'p1', token: 'other' }).body.error, 'taken');
  g.host('/api/host/phase', { phase: 'open', seconds: 120 });
  g.vote('p1', t1, 'p2');
  assert.equal(g.req('POST', '/api/unclaim', { voterId: 'p1', token: t1 }).status, 409);
  assert.equal(g.host('/api/host/release', { voterId: 'p1' }).status, 200);
  assert.deepEqual([g.state().claimed, g.state().voted], [[], []]);
  assert.equal(g.vote('p1', t1, 'p2').status, 401, 'the old phone is out');
  g.host('/api/host/phase', { phase: 'closed' });
  assert.equal(g.req('POST', '/api/claim', { voterId: 'p3' }).body.error, 'closed');
});

test('voting rules: not before it opens, never for yourself, never twice (a change replaces)', () => {
  const g = game();
  const tok = g.join('p1');
  assert.equal(g.vote('p1', tok, 'p2').body.error, 'not_open');
  g.host('/api/host/phase', { phase: 'open', seconds: 120 });
  assert.equal(g.vote('p1', tok, 'p1').body.error, 'self_vote');
  assert.equal(g.vote('p1', 'forged', 'p2').status, 401);
  assert.equal(g.vote('p1', tok, 'nobody').status, 400);
  g.vote('p1', tok, 'p2');
  g.vote('p1', tok, 'p3');
  assert.equal(g.state().voted.length, 1);
  g.host('/api/host/phase', { phase: 'revealed' });
  assert.deepEqual(g.state().winners, ['p3']);
});

test('the guest list can only change before voting; Save needs two people', () => {
  const g = game();
  assert.equal(g.host('/api/host/roster', { roster: [{ name: 'Only', character: '' }] }).body.error, 'need_two');
  assert.equal(g.host('/api/host/roster', { roster: [{ name: 'Ria', character: 'Geet' }, { name: 'Sam', character: 'Don' }] }).body.count, 2);
  assert.deepEqual(g.state().roster.map((p) => [p.name, p.character]), [['Ria', 'Geet'], ['Sam', 'Don']]);
  g.host('/api/host/phase', { phase: 'open', seconds: 120 });
  assert.equal(g.host('/api/host/roster', { roster: roster }).body.error, 'locked');
});

test('reset starts a fresh vote but keeps the guest list', () => {
  const g = game();
  g.host('/api/host/phase', { phase: 'open', seconds: 120 });
  voteAll(g, { p1: 'p2', p2: 'p1' });
  g.host('/api/host/phase', { phase: 'revealed' });
  g.host('/api/host/tiebreak', {});
  assert.equal(g.state().round, 2);
  const epoch = g.state().epoch;
  g.host('/api/host/reset', {});
  const st = g.state();
  assert.deepEqual([st.phase, st.round, st.contenders, st.claimed, st.voted, st.roster.length], ['waiting', 1, null, [], [], 6]);
  assert.equal(st.epoch, epoch + 1, 'phones see a new epoch and forget their old identity');
});

test('everything is saved on each change and survives a refresh (restoring from the save)', () => {
  let save = null;
  const g = game({ persist: (s) => { save = JSON.parse(JSON.stringify(s)); } });
  g.host('/api/host/phase', { phase: 'open', seconds: 300 });
  const tok = g.join('p1');
  g.vote('p1', tok, 'p2');

  const after = game({ saved: save }); // a refreshed host page
  const st = after.state();
  assert.deepEqual([st.phase, st.voted, st.claimed], ['open', ['p1'], ['p1']]);
  assert.equal(after.vote('p1', tok, 'p3').status, 200, 'the same phone token still works after the refresh');
  assert.equal(after.req('POST', '/api/host/reset', {}, KEY).status, 200, 'and the host key survives too');
});
