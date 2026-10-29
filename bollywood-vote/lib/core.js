// Voting rules, with no Node or browser APIs: the server runs it over HTTP, the interactive demo runs it in a page.
// All I/O is injected (persist, randomId, now), and handle() maps a request to {status, body}.

export const PHASES = ['waiting', 'open', 'closed', 'revealed'];
const MAX_ROSTER = 40;

const clampSeconds = (v, fallback) => Math.min(1800, Math.max(15, Number(v) || fallback));
const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** "Name | Character" lines -> roster entries. Accepts a string or an array of {name, character}. */
export function parseRoster(input) {
  const rows = Array.isArray(input)
    ? input.map((r) => [r?.name, r?.character])
    : String(input ?? '').split(/\r?\n/).map((line) => line.split('|'));
  const roster = [];
  for (const [name, character] of rows) {
    const n = clean(name, 40);
    if (!n) continue;
    roster.push({ id: `p${roster.length + 1}`, name: n, character: clean(character, 60) });
  }
  return roster.slice(0, MAX_ROSTER);
}

export function createCore({ roster, saved = {}, hostKey, randomId, persist = () => {}, now = Date.now, random = Math.random }) {
  let s = {
    hostKey: hostKey || randomId().slice(0, 6),
    epoch: 1,
    phase: 'waiting',
    showLive: false,
    revealedAt: 0,
    endsAt: 0, // ms timestamp when the open vote closes by itself; 0 when no vote is running
    round: 1, // 1 = the main vote, 2 = the tie-break runoff
    contenders: null, // runoff only: the tied people, the only ones who can be voted for
    tie: null, // runoff only: { ids, votes } of the first-round tie, shown to everyone
    drawn: null, // set when the runoff is level too and a random draw settles it
    roster,
    claims: {}, // voterId -> device token
    votes: {}, // voterId -> candidateId
  };
  s = { ...s, ...saved, hostKey: hostKey || saved.hostKey || s.hostKey };

  const listeners = new Set();

  // ---------- derived state ----------

  function tallies() {
    const ids = new Set(s.roster.map((p) => p.id));
    const t = Object.fromEntries(s.roster.map((p) => [p.id, 0]));
    for (const c of Object.values(s.votes)) if (ids.has(c)) t[c] += 1;
    return t;
  }

  /** Highest tally and everyone on it. */
  function leaders() {
    const t = tallies();
    const top = Math.max(0, ...Object.values(t));
    return { top, ids: top > 0 ? s.roster.filter((p) => t[p.id] === top).map((p) => p.id) : [] };
  }

  /** Closes the vote when time is up or every guest has voted. Returns true if it changed anything. */
  function tick() {
    if (s.phase !== 'open') return false;
    const timeUp = s.endsAt > 0 && now() >= s.endsAt;
    const allIn = s.roster.length > 0 && Object.keys(s.votes).length >= s.roster.length;
    if (!timeUp && !allIn) return false;
    s.phase = 'closed';
    s.endsAt = 0;
    changed();
    return true;
  }

  function publicState() {
    const t = tallies();
    const revealed = s.phase === 'revealed';
    return {
      epoch: s.epoch,
      phase: s.phase,
      showLive: s.showLive,
      revealedAt: s.revealedAt,
      endsAt: s.endsAt,
      serverNow: now(), // lets screens show a countdown that agrees with the server's clock
      roster: s.roster,
      claimed: Object.keys(s.claims),
      voted: Object.keys(s.votes),
      // Standings never leave the server until the host reveals them (or turns live standings on).
      tallies: revealed || s.showLive ? t : null,
      winners: revealed ? (s.drawn ? [s.drawn] : leaders().ids) : null,
      round: s.round,
      contenders: s.contenders,
      tie: s.tie,
      tieBreak: s.round > 1 ? (s.drawn ? 'draw' : 'runoff') : null,
    };
  }

  function changed() {
    persist(s);
    const st = publicState();
    for (const fn of listeners) fn(st);
  }

  const person = (id) => s.roster.find((p) => p.id === id);
  const tokenOk = (voterId, token) => typeof token === 'string' && s.claims[voterId] === token;
  const res = (status, body) => ({ status, body });

  // ---------- requests ----------

  function handle({ method, path, query = {}, body = {}, hostKey: key }) {
    const route = `${method} ${path}`;
    tick(); // lazily applies the deadline, so it holds even when nothing else is running a timer

    if (route === 'GET /api/state') return res(200, publicState());

    if (route === 'GET /api/me') {
      if (!tokenOk(query.voterId, query.token)) return res(200, { valid: false });
      return res(200, { valid: true, candidateId: s.votes[query.voterId] ?? null });
    }

    // ----- host -----
    if (path.startsWith('/api/host/')) {
      if ((key || query.key) !== s.hostKey) return res(401, { error: 'bad_key' });
      if (route === 'GET /api/host/ping') return res(200, { ok: true });

      if (route === 'POST /api/host/phase') {
        const next = body.phase;
        if (!PHASES.includes(next)) return res(400, { error: 'bad_phase' });
        if (next === 'waiting') return res(400, { error: 'use_reset' });
        if (next === 'revealed' && s.phase !== 'revealed') {
          const { top, ids } = leaders();
          if (ids.length > 1) {
            if (s.round === 1) {
              // A tie never reaches the curtain: the tied people go to a 60-second runoff on the same phones.
              s.tie = { ids, votes: top };
              s.contenders = ids;
              s.round = 2;
              s.votes = {};
              s.drawn = null;
              s.phase = 'open';
              s.endsAt = now() + 60 * 1000;
              changed();
              return res(200, { ok: true, runoff: true });
            }
            s.drawn = ids[Math.floor(random() * ids.length)]; // level again after the runoff: a random draw settles it
          }
        }
        if (next === 'open') s.drawn = null;
        if (next === 'revealed') s.revealedAt = now(); // re-sending 'revealed' replays the reveal
        // Opening starts the clock (default 5 minutes, or the number of seconds the host asks for); anything else stops it.
        s.endsAt = next === 'open' ? now() + clampSeconds(body.seconds, 300) * 1000 : 0;
        s.phase = next;
        changed();
        return res(200, { ok: true });
      }

      if (route === 'POST /api/host/extend') {
        if (s.phase !== 'open') return res(409, { error: 'not_open' });
        s.endsAt = Math.max(s.endsAt, now()) + clampSeconds(body.seconds, 60) * 1000;
        changed();
        return res(200, { ok: true });
      }

      if (route === 'POST /api/host/live') {
        s.showLive = Boolean(body.showLive);
        changed();
        return res(200, { ok: true });
      }

      if (route === 'POST /api/host/roster') {
        if (s.phase !== 'waiting') return res(409, { error: 'locked' });
        const next = parseRoster(body.roster ?? body.text);
        if (next.length < 2) return res(400, { error: 'need_two' });
        s.roster = next;
        s.claims = {};
        s.votes = {};
        Object.assign(s, { round: 1, contenders: null, tie: null, drawn: null });
        s.epoch += 1;
        changed();
        return res(200, { ok: true, count: next.length });
      }

      if (route === 'POST /api/host/release') {
        if (!s.claims[body.voterId]) return res(404, { error: 'not_claimed' });
        delete s.claims[body.voterId];
        delete s.votes[body.voterId];
        changed();
        return res(200, { ok: true });
      }

      if (route === 'POST /api/host/reset') {
        s.phase = 'waiting';
        s.claims = {};
        s.votes = {};
        s.revealedAt = 0;
        s.endsAt = 0;
        Object.assign(s, { round: 1, contenders: null, tie: null, drawn: null });
        s.epoch += 1;
        changed();
        return res(200, { ok: true });
      }
    }

    // ----- guests -----
    if (route === 'POST /api/claim') {
      if (!person(body.voterId)) return res(400, { error: 'unknown_person' });
      if (s.phase === 'closed' || s.phase === 'revealed') return res(409, { error: 'closed' });
      const existing = s.claims[body.voterId];
      if (existing && existing !== body.token) return res(409, { error: 'taken' });
      const token = existing || randomId();
      s.claims[body.voterId] = token;
      if (!existing) changed();
      return res(200, { ok: true, token, epoch: s.epoch });
    }

    if (route === 'POST /api/unclaim') {
      if (!tokenOk(body.voterId, body.token)) return res(401, { error: 'bad_token' });
      if (s.votes[body.voterId]) return res(409, { error: 'already_voted' });
      delete s.claims[body.voterId];
      changed();
      return res(200, { ok: true });
    }

    if (route === 'POST /api/vote') {
      if (!tokenOk(body.voterId, body.token)) return res(401, { error: 'bad_token' });
      if (s.phase !== 'open') return res(409, { error: 'not_open' });
      if (!person(body.candidateId)) return res(400, { error: 'unknown_person' });
      if (body.candidateId === body.voterId) return res(400, { error: 'self_vote' });
      if (s.contenders && !s.contenders.includes(body.candidateId)) return res(400, { error: 'not_a_contender' });
      s.votes[body.voterId] = body.candidateId;
      if (!tick()) changed(); // the last guest's vote closes the round right away
      return res(200, { ok: true, candidateId: body.candidateId });
    }

    return res(404, { error: 'not_found' });
  }

  return {
    handle,
    tick,
    publicState,
    state: () => s,
    hostKey: () => s.hostKey,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
