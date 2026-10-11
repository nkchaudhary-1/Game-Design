import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { isValidRoomCode, type ServerMessage } from '@undercover/shared';
import { RoomManager, type Conn, type ManagerOptions } from './manager.js';
import { clientMessageSchema, MAX_MESSAGE_BYTES } from './schema.js';

export interface ServerOptions extends ManagerOptions {
  port?: number;
  host?: string;
  /** Directory of the built client. Defaults to ../../client/dist relative to this file. */
  staticDir?: string | null;
  allowedOrigins?: string[];
  publicUrl?: string;
}

export interface RunningServer {
  http: HttpServer;
  wss: WebSocketServer;
  manager: RoomManager;
  port: number;
  url: string;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function defaultStaticDir(): string | null {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const candidates = [join(here, '..', '..', 'client', 'dist'), join(here, '..', 'client', 'dist'), join(here, '..', '..', '..', 'client', 'dist')];
  return candidates.find((c) => existsSync(join(c, 'index.html'))) ?? null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function createServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const manager = new RoomManager(opts);
  await manager.boot();

  const staticDir = opts.staticDir === undefined ? defaultStaticDir() : opts.staticDir;
  const indexHtml = staticDir ? readFileSync(join(staticDir, 'index.html'), 'utf8') : null;
  const publicUrl = (opts.publicUrl ?? process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
  const allowedOrigins = opts.allowedOrigins ?? (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

  const http = createHttpServer((req, res) => handleHttp(req, res));

  function handleHttp(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, rooms: manager.roomCount(), uptime: process.uptime() }));
      return;
    }
    if (!staticDir || !indexHtml) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Client not built. Run `npm run build`.');
      return;
    }
    const safePath = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    const filePath = join(staticDir, safePath);
    if (safePath !== '/' && filePath.startsWith(staticDir) && existsSync(filePath) && statSync(filePath).isFile()) {
      const ext = extname(filePath);
      const immutable = safePath.startsWith('/assets/');
      res.writeHead(200, {
        'content-type': MIME[ext] ?? 'application/octet-stream',
        'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
      });
      res.end(readFileSync(filePath));
      return;
    }
    // SPA fallback with Open Graph tags for invite links.
    let html = indexHtml;
    const joinMatch = safePath.match(/^\/join\/([A-Za-z0-9]{6})$/);
    const origin = publicUrl || `${req.headers['x-forwarded-proto'] ?? 'http'}://${req.headers.host ?? 'localhost'}`;
    let title = 'Undercover';
    let description = 'A real-time social deduction game. Someone at this table is lying.';
    let pageUrl = origin + safePath;
    if (joinMatch && isValidRoomCode(joinMatch[1].toUpperCase())) {
      const code = joinMatch[1].toUpperCase();
      title = `Join my Undercover game · ${code}`;
      description = `Tap to join room ${code}. Pick a name, get a secret role, and find the Traitors before they find you.`;
      pageUrl = `${origin}/join/${code}`;
    }
    html = html
      .replace(/__OG_TITLE__/g, escapeHtml(title))
      .replace(/__OG_DESCRIPTION__/g, escapeHtml(description))
      .replace(/__OG_URL__/g, escapeHtml(pageUrl))
      .replace(/__OG_IMAGE__/g, escapeHtml(`${origin}/og.png`));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html);
  }

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
  });

  http.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    const origin = req.headers.origin;
    if (origin) {
      const host = req.headers.host;
      const sameOrigin = (() => {
        try {
          return new URL(origin).host === host;
        } catch {
          return false;
        }
      })();
      const allowed = sameOrigin || allowedOrigins.includes(origin) || allowedOrigins.includes('*') || (publicUrl && origin === publicUrl);
      if (!allowed) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  let connSeq = 0;
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const forwarded = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
    const conn: Conn = {
      id: `c${++connSeq}`,
      ip: forwarded || req.socket.remoteAddress || 'unknown',
      playerId: null,
      code: null,
      send(msg: ServerMessage) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
    };
    let alive = true;
    ws.on('pong', () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    }, 30_000);
    heartbeat.unref?.();

    ws.on('message', (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        manager.sendError(conn, 'badMessage', 'Malformed message.');
        return;
      }
      const result = clientMessageSchema.safeParse(parsed);
      if (!result.success) {
        manager.sendError(conn, 'badMessage', 'Invalid message.');
        return;
      }
      void manager.handle(conn, result.data);
    });
    ws.on('close', () => {
      clearInterval(heartbeat);
      void manager.onDisconnect(conn);
    });
    ws.on('error', () => {
      /* close follows */
    });
  });

  const port = opts.port ?? Number(process.env.PORT ?? '8080');
  const host = opts.host ?? '0.0.0.0';
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(port, host, () => resolve());
  });
  const actualPort = (http.address() as { port: number }).port;

  return {
    http,
    wss,
    manager,
    port: actualPort,
    url: `http://127.0.0.1:${actualPort}`,
    async close() {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
      await manager.close();
    },
  };
}
