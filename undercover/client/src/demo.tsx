/**
 * Solo demo: the real client UI and the real room server, both running in this tab.
 * You play against bots that join your room and act legally. Timers are shortened.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { PLAYER_COLORS, suggestName, type ClientMessage, type ServerMessage } from '@undercover/shared';
import { RoomManager, type Conn } from '../../server/src/manager.js';
import { MemoryStore } from '../../server/src/memoryStore.js';
import { BotBrain } from '../../server/src/botBrain.js';
import { App } from './App.js';
import { client, type SocketLike } from './ws.js';
import './styles.css';

const SCALE = 0.5; // night 15 s, voting 30 s, discussion 90 s (host can skip)

const manager = new RoomManager({
  store: new MemoryStore(),
  clock: { now: () => Date.now(), scale: SCALE },
  rateLimits: false,
  graceMs: 5000,
});

let seq = 0;

function spawnBots(code: string, count: number): void {
  const taken = new Set<string>();
  for (let i = 0; i < count; i++) {
    let name = suggestName();
    while (taken.has(name)) name = suggestName();
    taken.add(name);
    const brain = new BotBrain({ impatient: false });
    const conn: Conn = {
      id: `bot${++seq}`,
      ip: 'bot',
      playerId: null,
      code: null,
      send(msg: ServerMessage) {
        if (msg.type !== 'roomState') return;
        const actions = brain.act(msg.view);
        actions.forEach((m, idx) => {
          // Humans take a moment. Bots do too, so the table feels alive.
          const delay = 600 + Math.random() * 1800 + idx * 300;
          setTimeout(() => void manager.handle(conn, m), delay);
        });
      },
    };
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
  private conn: Conn = {
    id: `you${++seq}`,
    ip: 'you',
    playerId: null,
    code: null,
    send: (msg: ServerMessage) => {
      if (msg.type === 'joined' && this.pendingCreate) {
        const { targetCount, mode } = this.pendingCreate;
        this.pendingCreate = null;
        spawnBots(msg.code, mode === 'god' ? targetCount : targetCount - 1);
      }
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(msg) }));
    },
  };
  constructor() {
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
    }, 0);
  }
  send(data: string): void {
    const msg = JSON.parse(data) as ClientMessage;
    if (msg.type === 'createRoom') this.pendingCreate = { targetCount: msg.settings.targetCount, mode: msg.settings.mode };
    if (msg.type === 'joinRoom') {
      // There is no network here; joining someone else's code is not possible in the solo demo.
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: 'error', code: 'roomNotFound', message: 'This is the solo demo. Create a room and bots will join you.', ref: 'joinRoom' } satisfies ServerMessage) }));
      return;
    }
    void manager.handle(this.conn, msg);
  }
  close(): void {
    this.readyState = 3;
    void manager.onDisconnect(this.conn);
    this.onclose?.();
  }
}

client.configure({ socketFactory: () => new LocalSocket(), persist: false });

function DemoChip() {
  return (
    <div className="demo-chip" aria-label="Solo demo">
      Solo demo · you + bots · short timers
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <DemoChip />
  </React.StrictMode>,
);
