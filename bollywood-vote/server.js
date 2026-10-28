// Bollywood Night — live "Best Dressed" voting server.
// Zero dependencies. In-memory state, mirrored to data/state.json so a restart mid-party loses nothing.
// Live updates go out over Server-Sent Events.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const MAX_ROSTER = 40;
const PHASES = ['waiting', 'open', 'closed', 'revealed'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

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

function lanAddresses() {
  const out = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  // Home/office WiFi ranges first; VPN and container adapters last.
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('172.') ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b));
}

export function createServer({ port = 3000, dataDir = path.join(ROOT, 'data'), hostKey, publicUrl } = {}) {
  const stateFile = path.join(dataDir, 'state.json');
  const defaultRoster = () => parseRoster(JSON.parse(fs.readFileSync(path.join(ROOT, 'roster.json'), 'utf8')));

  let s = {
    hostKey: hostKey || crypto.randomBytes(3).toString('hex'),
    epoch: 1,
    phase: 'waiting',
    showLive: false,
    revealedAt: 0,
    roster: defaultRoster(),
    claims: {}, // voterId -> device token
    votes: {}, // voterId -> candidateId
  };

  try {
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    s = { ...s, ...saved, hostKey: hostKey || saved.hostKey || s.hostKey };
  } catch {
    /* first run */
  }

  const save = () => {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(`${stateFile}.tmp`, JSON.stringify(s));
      fs.renameSync(`${stateFile}.tmp`, stateFile);
    } catch (err) {
      console.error('Could not persist state:', err.message);
    }
  };

  // ---------- derived state ----------

  const rosterIds = () => new Set(s.roster.map((p) => p.id));

  function tallies() {
    const ids = rosterIds();
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

  // ---------- live push ----------

  const streams = new Set();
  function broadcast() {
    save();
    const frame = `data: ${JSON.stringify(publicState())}\n\n`;
    for (const res of streams) res.write(frame);
  }
  const heartbeat = setInterval(() => {
    for (const res of streams) res.write(': ping\n\n');
  }, 20000);
  heartbeat.unref();

  // ---------- http helpers ----------

  const json = (res, code, body) => {
    res.writeHead(code, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let raw = '';
      req.on('data', (c) => {
        raw += c;
        if (raw.length > 100_000) {
          reject(new Error('too large'));
          req.destroy();
        }
      });
      req.on('end', () => {
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch {
          reject(new Error('bad json'));
        }
      });
      req.on('error', reject);
    });

  const isHost = (req, url) => (req.headers['x-host-key'] || url.searchParams.get('key')) === s.hostKey;
  const person = (id) => s.roster.find((p) => p.id === id);
  const tokenOk = (voterId, token) => typeof token === 'string' && s.claims[voterId] === token;

  function voteUrls() {
    if (publicUrl) return [publicUrl];
    return lanAddresses().map((ip) => `http://${ip}:${port}/`);
  }

  // ---------- API ----------

  async function api(req, res, url) {
    const route = `${req.method} ${url.pathname}`;

    if (route === 'GET /api/state') return json(res, 200, publicState());

    if (route === 'GET /api/config') return json(res, 200, { voteUrls: voteUrls() });

    if (route === 'GET /api/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`retry: 2000\ndata: ${JSON.stringify(publicState())}\n\n`);
      streams.add(res);
      req.on('close', () => streams.delete(res));
      return;
    }

    if (route === 'GET /api/me') {
      const voterId = url.searchParams.get('voterId');
      const token = url.searchParams.get('token');
      if (!tokenOk(voterId, token)) return json(res, 200, { valid: false });
      return json(res, 200, { valid: true, candidateId: s.votes[voterId] ?? null });
    }

    // ----- host -----
    if (url.pathname.startsWith('/api/host/')) {
      if (!isHost(req, url)) return json(res, 401, { error: 'bad_key' });
      if (route === 'GET /api/host/ping') return json(res, 200, { ok: true });

      const body = req.method === 'POST' ? await readBody(req) : {};

      if (route === 'POST /api/host/phase') {
        const next = body.phase;
        if (!PHASES.includes(next)) return json(res, 400, { error: 'bad_phase' });
        if (next === 'waiting') return json(res, 400, { error: 'use_reset' });
        if (next === 'revealed') s.revealedAt = Date.now(); // re-sending 'revealed' replays the reveal
        s.phase = next;
        broadcast();
        return json(res, 200, { ok: true });
      }

      if (route === 'POST /api/host/live') {
        s.showLive = Boolean(body.showLive);
        broadcast();
        return json(res, 200, { ok: true });
      }

      if (route === 'POST /api/host/roster') {
        if (s.phase !== 'waiting') return json(res, 409, { error: 'locked' });
        const roster = parseRoster(body.roster ?? body.text);
        if (roster.length < 2) return json(res, 400, { error: 'need_two' });
        s.roster = roster;
        s.claims = {};
        s.votes = {};
        s.epoch += 1;
        broadcast();
        return json(res, 200, { ok: true, count: roster.length });
      }

      if (route === 'POST /api/host/release') {
        if (!s.claims[body.voterId]) return json(res, 404, { error: 'not_claimed' });
        delete s.claims[body.voterId];
        delete s.votes[body.voterId];
        broadcast();
        return json(res, 200, { ok: true });
      }

      if (route === 'POST /api/host/reset') {
        s.phase = 'waiting';
        s.claims = {};
        s.votes = {};
        s.revealedAt = 0;
        s.epoch += 1;
        broadcast();
        return json(res, 200, { ok: true });
      }
    }

    // ----- guests -----
    if (route === 'POST /api/claim') {
      const body = await readBody(req);
      if (!person(body.voterId)) return json(res, 400, { error: 'unknown_person' });
      if (s.phase === 'closed' || s.phase === 'revealed') return json(res, 409, { error: 'closed' });
      const existing = s.claims[body.voterId];
      if (existing && existing !== body.token) return json(res, 409, { error: 'taken' });
      const token = existing || crypto.randomUUID();
      s.claims[body.voterId] = token;
      if (!existing) broadcast();
      return json(res, 200, { ok: true, token, epoch: s.epoch });
    }

    if (route === 'POST /api/unclaim') {
      const body = await readBody(req);
      if (!tokenOk(body.voterId, body.token)) return json(res, 401, { error: 'bad_token' });
      if (s.votes[body.voterId]) return json(res, 409, { error: 'already_voted' });
      delete s.claims[body.voterId];
      broadcast();
      return json(res, 200, { ok: true });
    }

    if (route === 'POST /api/vote') {
      const body = await readBody(req);
      if (!tokenOk(body.voterId, body.token)) return json(res, 401, { error: 'bad_token' });
      if (s.phase !== 'open') return json(res, 409, { error: 'not_open' });
      if (!person(body.candidateId)) return json(res, 400, { error: 'unknown_person' });
      if (body.candidateId === body.voterId) return json(res, 400, { error: 'self_vote' });
      s.votes[body.voterId] = body.candidateId;
      broadcast();
      return json(res, 200, { ok: true, candidateId: body.candidateId });
    }

    return json(res, 404, { error: 'not_found' });
  }

  // ---------- static ----------

  function serveStatic(req, res, url) {
    const pretty = { '/': '/index.html', '/host': '/host.html' };
    const rel = pretty[url.pathname] ?? url.pathname;
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return json(res, 403, { error: 'forbidden' });
    fs.readFile(file, (err, data) => {
      if (err) return json(res, 404, { error: 'not_found' });
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else serveStatic(req, res, url);
    } catch (err) {
      if (!res.headersSent) json(res, err.message === 'too large' ? 413 : 400, { error: err.message });
    }
  });

  return {
    server,
    state: () => s,
    hostKey: () => s.hostKey,
    close: () => {
      clearInterval(heartbeat);
      for (const res of streams) res.end();
      server.close();
    },
  };
}

// ---------- run ----------

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 3000;
  const publicUrl = process.env.PUBLIC_URL ? process.env.PUBLIC_URL.replace(/\/?$/, '/') : undefined;
  const app = createServer({ port, publicUrl, hostKey: process.env.HOST_KEY, dataDir: process.env.DATA_DIR });
  app.server.listen(port, '0.0.0.0', () => {
    const guests = publicUrl ? [publicUrl] : lanAddresses().map((ip) => `http://${ip}:${port}/`);
    console.log('\n  Bollywood Night — Best Dressed voting\n');
    console.log(`  Host screen (open on the projector laptop):`);
    console.log(`    http://localhost:${port}/host?key=${app.hostKey()}\n`);
    console.log(`  Guests scan the QR on that screen, which points to:`);
    for (const u of guests.length ? guests : [`http://localhost:${port}/  (no WiFi/LAN address found)`]) console.log(`    ${u}`);
    console.log('');
  });
}
