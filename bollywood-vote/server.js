// Bollywood Night — live "Best Dressed" voting server.
// Zero dependencies. In-memory state, mirrored to data/state.json so a restart mid-party loses nothing.
// Live updates go out over Server-Sent Events. The rules live in lib/core.js.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { exec } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCore, parseRoster } from './lib/core.js';

export { parseRoster };

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

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

/** Optional pre-filled guest list (roster.json: [{ "name", "character" }]). Without it the host types the names in. */
function seedRoster() {
  try {
    return parseRoster(JSON.parse(fs.readFileSync(path.join(ROOT, 'roster.json'), 'utf8')));
  } catch {
    return [];
  }
}

export function createServer({ port = 3000, dataDir = path.join(ROOT, 'data'), hostKey, publicUrl, defaultRoster, trustLocal = false } = {}) {
  const stateFile = path.join(dataDir, 'state.json');

  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    /* first run */
  }

  const save = (state) => {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(`${stateFile}.tmp`, JSON.stringify(state));
      fs.renameSync(`${stateFile}.tmp`, stateFile);
    } catch (err) {
      console.error('Could not persist state:', err.message);
    }
  };

  const core = createCore({
    roster: defaultRoster ?? seedRoster(),
    saved,
    hostKey,
    randomId: () => crypto.randomUUID(),
    persist: save,
  });

  // ---------- live push ----------

  const streams = new Set();
  core.subscribe((state) => {
    const frame = `data: ${JSON.stringify(state)}\n\n`;
    for (const res of streams) res.write(frame);
  });
  const heartbeat = setInterval(() => {
    for (const res of streams) res.write(': ping\n\n');
  }, 20000);
  heartbeat.unref();
  const clock = setInterval(core.tick, 1000); // closes the vote the moment time is up, even with nobody polling
  clock.unref();

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

  // ---------- who is the host ----------

  /**
   * Run on one laptop, the machine itself is the host and everyone else (phones on the WiFi) is a guest, so there is no
   * password to type. A tunnel or reverse proxy also connects from this machine, so any proxy header turns this off.
   */
  function isHostMachine(req) {
    if (!trustLocal) return false;
    if (['x-forwarded-for', 'forwarded', 'x-real-ip', 'cf-connecting-ip'].some((h) => req.headers[h])) return false;
    const addr = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
    return addr === '127.0.0.1' || addr === '::1' || lanAddresses().includes(addr);
  }

  // ---------- API ----------

  async function api(req, res, url) {
    const route = `${req.method} ${url.pathname}`;

    if (route === 'GET /api/config') {
      const voteUrls = publicUrl ? [publicUrl] : lanAddresses().map((ip) => `http://${ip}:${port}/`);
      return json(res, 200, { transport: 'sse', voteUrls });
    }

    if (route === 'GET /api/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`retry: 2000\ndata: ${JSON.stringify(core.publicState())}\n\n`);
      streams.add(res);
      req.on('close', () => streams.delete(res));
      return;
    }

    const out = core.handle({
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body: req.method === 'POST' ? await readBody(req) : {},
      hostKey: isHostMachine(req) ? core.hostKey() : req.headers['x-host-key'],
    });
    json(res, out.status, out.body);
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
    state: core.state,
    hostKey: core.hostKey,
    close: () => {
      clearInterval(heartbeat);
      clearInterval(clock);
      for (const res of streams) res.end();
      server.close();
    },
  };
}

// ---------- run ----------

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
  exec(`${cmd} "${url}"`, () => {}); // best effort: the link is printed too
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 3000;
  const publicUrl = process.env.PUBLIC_URL ? process.env.PUBLIC_URL.replace(/\/?$/, '/') : undefined;
  // Behind a public tunnel the "local" shortcut is off and the host link carries a key instead.
  const app = createServer({ port, publicUrl, hostKey: process.env.HOST_KEY, dataDir: process.env.DATA_DIR, trustLocal: !publicUrl });
  app.server.on('error', (err) => {
    console.error(err.code === 'EADDRINUSE' ? `\n  Port ${port} is already in use. Close the other copy, or run with PORT=3001.\n` : err);
    process.exit(1);
  });
  app.server.listen(port, '0.0.0.0', () => {
    const guests = publicUrl ? [publicUrl] : lanAddresses().map((ip) => `http://${ip}:${port}/`);
    const hostUrl = publicUrl ? `http://localhost:${port}/host?key=${app.hostKey()}` : `http://localhost:${port}/host`;
    console.log('\n  Bollywood Night — Best Dressed voting\n');
    console.log('  1. Host screen (this laptop, shared on the projector):');
    console.log(`       ${hostUrl}\n`);
    console.log('  2. Guests scan the QR code on that screen. It points to:');
    for (const u of guests.length ? guests : [`http://localhost:${port}/  (no WiFi address found: connect to WiFi first)`]) console.log(`       ${u}`);
    console.log('\n  Phones must be on the same WiFi as this laptop. Press Ctrl+C here to stop.\n');
    if (process.argv.includes('--open')) openBrowser(hostUrl);
  });
}
