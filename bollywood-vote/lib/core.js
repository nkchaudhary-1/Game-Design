// Voting rules, with no Node or browser APIs: the server runs it over HTTP, the interactive demo runs it in a page.
// All I/O is injected (persist, randomId, now), and handle() maps a request to {status, body}.

export const PHASES = ['waiting', 'open', 'closed', 'revealed'];
const MAX_ROSTER = 40;

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

export function createCore({ roster, saved = {}, hostKey, randomId, persist = () => {}, now = Date.now }) {
  let s = {
    hostKey: hostKey || randomId().slice(0, 6),
    epoch: 1,
    phase: 'waiting',
    showLive: false,
    revealedAt: 0,
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

  function publicState() {
    const t = tallies();
    const revealed = s.phase === 'revealed';
    const top = Math.max(0, ...Object.values(t));
    return {
      epoch: s.epoch,
      phase: s.phase,
      showLive: s.showLive,
      revealedAt: s.revealedAt,
      roster: s.roster,
      claimed: Object.keys(s.claims),
      voted: Object.keys(s.votes),
      // Standings never leave the server until the host reveals them (or turns live standings on).
      tallies: revealed || s.showLive ? t : null,
      winners: revealed && top > 0 ? s.roster.filter((p) => t[p.id] === top).map((p) => p.id) : revealed ? [] : null,
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
        if (next === 'revealed') s.revealedAt = now(); // re-sending 'revealed' replays the reveal
        s.phase = next;
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
      s.votes[body.voterId] = body.candidateId;
      changed();
      return res(200, { ok: true, candidateId: body.candidateId });
    }

    return res(404, { error: 'not_found' });
  }

  return {
    handle,
    publicState,
    state: () => s,
    hostKey: () => s.hostKey,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
