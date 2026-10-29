// Serverless adapter: every request loads the game from the store, runs the same rules as the Node server
// (lib/core.js), and writes back only what changed. Live updates are polled (see /api/config), not pushed.

import { createCore } from './core.js';
import { fromFields, diff } from './redis-store.js';

export function createApi({ store, defaultRoster, hostKey, randomId, now = Date.now, random = Math.random, pollMs = 2000, cacheMs = 500 }) {
  let cache = null; // { at, fields } — warm instances share one read between many polling phones

  async function load(useCache) {
    if (useCache && cache && now() - cache.at < cacheMs) return cache.fields;
    const fields = await store.load();
    cache = { at: now(), fields };
    return fields;
  }

  return async function dispatch(req) {
    if (!store || !hostKey) {
      return { status: 500, body: { error: 'not_configured', detail: 'Set HOST_KEY and connect a Redis database (see README).' } };
    }
    if (req.method === 'GET' && req.path === '/api/config') {
      return { status: 200, body: { transport: 'poll', pollMs, voteUrls: [] } };
    }

    const readOnly = req.method === 'GET';
    const core = createCore({ roster: defaultRoster, saved: fromFields(await load(readOnly)), hostKey, randomId, now, random });
    const before = structuredClone(core.state());
    const out = core.handle(req);

    // Even a read can change state: the first request after the deadline closes the vote.
    const ops = diff(before, core.state());
    if (!ops.length) return out;
    cache = null;
    const results = await store.apply(ops);
    // HSETNX returns 0 when another phone claimed the same name a moment earlier.
    if (ops.some((op, i) => op[0] === 'HSETNX' && results[i] === 0)) return { status: 409, body: { error: 'taken' } };
    return out;
  };
}

/** Wraps dispatch as a (req, res) function for Vercel's Node runtime. */
export function nodeHandler(dispatch) {
  return async (req, res) => {
    const send = (status, body) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(body));
    };
    try {
      const url = new URL(req.url, 'http://x');
      // Vercel serves this from a catch-all file; prefer the real URL, fall back to the matched segments.
      const path = url.pathname.startsWith('/api/') && !url.pathname.includes('[')
        ? url.pathname
        : `/api/${[].concat(req.query?.path ?? []).join('/')}`;
      const query = Object.fromEntries(url.searchParams);
      delete query.path;
      let body = req.body;
      if (typeof body === 'string') body = body ? JSON.parse(body) : {};
      if (!body || typeof body !== 'object' || Buffer.isBuffer(body)) body = {};
      const out = await dispatch({ method: req.method, path, query, body, hostKey: req.headers['x-host-key'] });
      send(out.status, out.body);
    } catch (err) {
      send(err instanceof SyntaxError ? 400 : 503, { error: err instanceof SyntaxError ? 'bad_json' : 'store_unavailable' });
    }
  };
}
