// Persistence for serverless hosting (Vercel). Functions share no memory, so the game lives in one Redis hash with one
// field per fact: phase/epoch/…, "c:<voterId>" for claims, "v:<voterId>" for votes. Each request writes only the fields it
// changed, so twenty phones voting at the same moment never overwrite each other.
//
// Talks to Upstash's REST API with plain fetch (no client library): https://upstash.com/docs/redis/features/restapi

export const KEY = 'bollywood-vote';

/** Hash fields -> the `saved` object createCore expects. */
export function fromFields(f = {}) {
  const saved = { claims: {}, votes: {} };
  if (f.phase) saved.phase = f.phase;
  if (f.epoch) saved.epoch = Number(f.epoch);
  if (f.showLive) saved.showLive = f.showLive === '1';
  if (f.revealedAt) saved.revealedAt = Number(f.revealedAt);
  if (f.endsAt) saved.endsAt = Number(f.endsAt);
  if (f.roster) saved.roster = JSON.parse(f.roster);
  if (f.round) saved.round = Number(f.round);
  if (f.contenders) saved.contenders = JSON.parse(f.contenders);
  if (f.tie) saved.tie = JSON.parse(f.tie);
  if (f.drawn) saved.drawn = f.drawn;
  for (const [field, value] of Object.entries(f)) {
    if (field.startsWith('c:')) saved.claims[field.slice(2)] = value;
    else if (field.startsWith('v:')) saved.votes[field.slice(2)] = value;
  }
  return saved;
}

/** Redis commands that turn state `before` into `after`. New claims use HSETNX so two phones can't both take one name. */
export function diff(before, after) {
  const ops = [];
  const set = (field, value) => ops.push(['HSET', KEY, field, String(value)]);
  if (before.phase !== after.phase) set('phase', after.phase);
  if (before.epoch !== after.epoch) set('epoch', after.epoch);
  if (before.showLive !== after.showLive) set('showLive', after.showLive ? 1 : 0);
  if (before.revealedAt !== after.revealedAt) set('revealedAt', after.revealedAt);
  if (before.endsAt !== after.endsAt) set('endsAt', after.endsAt);
  if (JSON.stringify(before.roster) !== JSON.stringify(after.roster)) set('roster', JSON.stringify(after.roster));
  if (before.round !== after.round) set('round', after.round);
  // Optional values are stored as '' when absent (fromFields reads '' as "not set").
  for (const field of ['contenders', 'tie', 'drawn']) {
    if (JSON.stringify(before[field] ?? null) === JSON.stringify(after[field] ?? null)) continue;
    const v = after[field];
    set(field, v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v));
  }

  for (const [prefix, was, now, addCmd] of [
    ['c:', before.claims, after.claims, 'HSETNX'],
    ['v:', before.votes, after.votes, 'HSET'],
  ]) {
    for (const [id, value] of Object.entries(now)) {
      if (was[id] === undefined) ops.push([addCmd, KEY, prefix + id, String(value)]);
      else if (was[id] !== value) set(prefix + id, value);
    }
    for (const id of Object.keys(was)) if (now[id] === undefined) ops.push(['HDEL', KEY, prefix + id]);
  }
  return ops;
}

export function createRedisStore({ url, token, fetchImpl = fetch }) {
  async function pipeline(commands) {
    const res = await fetchImpl(`${url.replace(/\/$/, '')}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
    });
    if (!res.ok) throw new Error(`Redis request failed (${res.status})`);
    return (await res.json()).map((r) => {
      if (r.error) throw new Error(r.error);
      return r.result;
    });
  }

  return {
    /** The raw hash as {field: value}. */
    async load() {
      const [flat] = await pipeline([['HGETALL', KEY]]);
      if (!Array.isArray(flat)) return flat ?? {};
      const fields = {};
      for (let i = 0; i < flat.length; i += 2) fields[flat[i]] = flat[i + 1];
      return fields;
    },
    /** Runs the commands in order and returns each one's result. */
    apply: (ops) => pipeline(ops),
  };
}
