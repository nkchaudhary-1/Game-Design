/**
 * Solo mode: you against bots. The ordinary App talks to an in-tab server through a
 * WebSocket look-alike; bots join the room you create and act legally with human-ish delays.
 */
import { PLAYER_COLORS, suggestName, type ClientMessage, type ServerMessage } from '@undercover/shared';
import { BotBrain } from '../../../server/src/botBrain.js';
import type { RoomManager } from '../../../server/src/manager.js';
import { client, type SocketLike } from '../ws.js';
import { makeConn, makeManager } from './transport.js';

const SCALE = 0.5; // night 15 s, voting 30 s, discussion 90 s (host can skip)

function spawnBots(manager: RoomManager, code: string, count: number): void {
  const taken = new Set<string>();
  for (let i = 0; i < count; i++) {
    let name = suggestName();
    while (taken.has(name)) name = suggestName();
    taken.add(name);
    const brain = new BotBrain({ impatient: false });
    const conn = makeConn('bot', (msg: ServerMessage) => {
      if (msg.type !== 'roomState') return;
      brain.act(msg.view).forEach((m, idx) => {
        const delay = 600 + Math.random() * 1800 + idx * 300;
        setTimeout(() => void manager.handle(conn, m), delay);
      });
    });
    const delay = 400 + i * 700 + Math.random() * 500;
    setTimeout(() => void manager.handle(conn, { type: 'joinRoom', code, name, color: PLAYER_COLORS[(i + 3) % PLAYER_COLORS.length] }), delay);
  }
}

class LocalSocket implements SocketLike {
  readonly OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private pendingCreate: { targetCount: number; mode: 'player' | 'god' } | null = null;
  private conn = makeConn('you', (msg: ServerMessage) => {
    if (msg.type === 'joined' && this.pendingCreate) {
      const { targetCount, mode } = this.pendingCreate;
      this.pendingCreate = null;
      spawnBots(this.manager, msg.code, mode === 'god' ? targetCount : targetCount - 1);
    }
    queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(msg) }));
  });
  constructor(private manager: RoomManager) {
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
    }, 0);
  }
  send(data: string): void {
    const msg = JSON.parse(data) as ClientMessage;
    if (msg.type === 'createRoom') this.pendingCreate = { targetCount: msg.settings.targetCount, mode: msg.settings.mode };
    if (msg.type === 'joinRoom') {
      const err: ServerMessage = { type: 'error', code: 'roomNotFound', message: 'Solo mode has no other phones. Create a room and bots will join you.', ref: 'joinRoom' };
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(err) }));
      return;
    }
    void this.manager.handle(this.conn, msg);
  }
  close(): void {
    this.readyState = 3;
    void this.manager.onDisconnect(this.conn);
    this.onclose?.();
  }
}

export function configureSolo(): void {
  const manager = makeManager({ now: () => Date.now(), scale: SCALE });
  client.configure({ socketFactory: () => new LocalSocket(manager), persist: false, staticPage: true });
}
