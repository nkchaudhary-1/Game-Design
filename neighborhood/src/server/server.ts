import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { SIM_DT } from '../shared/consts';
import type { C2S } from '../shared/protocol';
import { GameWorld, type SPlayer } from './game';
import { Store } from './store';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon', '.map': 'application/json',
};

export interface ServerOpts { port: number; dataFile: string | null; dev: boolean; root: string }
export interface RunningServer { port: number; world: GameWorld; close(): Promise<void> }

export async function startServer(o: ServerOpts): Promise<RunningServer> {
  const store = new Store(o.dataFile);
  const world = new GameWorld(store);
  const dist = resolve(o.root, 'dist');
  let vite: import('vite').ViteDevServer | null = null;

  const server = http.createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    if (url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, online: world.online })); return; }
    if (vite) { vite.middlewares(req, res, () => { res.statusCode = 404; res.end('Not found'); }); return; }
    let file = normalize(join(dist, decodeURIComponent(url)));
    if (!file.startsWith(dist)) { res.statusCode = 403; res.end(); return; }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html');
    if (!existsSync(file)) { res.statusCode = 404; res.end('Run `npm run build` first (or use `npm run dev`).'); return; }
    const hashed = /\/assets\//.test(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache' });
    createReadStream(file).pipe(res);
  });

  if (o.dev) {
    const { createServer } = await import('vite');
    vite = await createServer({ root: o.root, server: { middlewareMode: true, hmr: { server } }, appType: 'spa', logLevel: 'warn' });
  }

  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    if ((req.url ?? '').split('?')[0] !== '/ws') return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });
  wss.on('connection', (ws: WebSocket) => {
    let player: SPlayer | null = null;
    const conn = { send: (m: unknown) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); }, close: () => ws.close() };
    const timeout = setTimeout(() => { if (!player) ws.close(); }, 5000);
    ws.on('message', (data) => {
      let m: C2S;
      try { m = JSON.parse(data.toString()); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (!player) {
        if (m.t === 'hello') player = world.join(conn as never, m.token, m.name, m.look);
        if (!player) ws.close();
        return;
      }
      world.onMessage(player, m);
    });
    ws.on('close', () => { clearTimeout(timeout); if (player) world.leave(player); });
    ws.on('error', () => ws.close());
  });

  let last = performance.now(), acc = 0;
  const loop = setInterval(() => {
    const now = performance.now();
    acc += Math.min(0.25, (now - last) / 1000); last = now;
    while (acc >= SIM_DT) { world.step(); acc -= SIM_DT; }
  }, 8);

  await new Promise<void>((r) => server.listen(o.port, '0.0.0.0', r));
  const port = (server.address() as { port: number }).port;
  return {
    port, world,
    async close() {
      clearInterval(loop);
      for (const c of wss.clients) c.close();
      store.flush();
      await vite?.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
