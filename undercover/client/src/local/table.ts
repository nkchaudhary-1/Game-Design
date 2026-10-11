/**
 * Pass & play: every seat is a real person sharing one phone. Each seat owns a
 * connection to the in-tab server, so the server's own privacy projection decides
 * what each person sees when the phone is in their hands.
 */
import { useSyncExternalStore } from 'react';
import { PLAYER_COLORS, type ClientMessage, type PlayerColor, type RoomSettings, type RoomView, type ServerMessage } from '@undercover/shared';
import type { Conn, RoomManager } from '../../../server/src/manager.js';
import { makeConn, makeManager } from './transport.js';

export interface Seat {
  id: string | null;
  name: string;
  color: PlayerColor;
  conn: Conn;
  view: RoomView | null;
  error: { code: string; message: string; at: number } | null;
}

export class Table {
  manager: RoomManager;
  seats: Seat[] = [];
  code: string | null = null;
  private version = 0;
  private listeners = new Set<() => void>();

  constructor() {
    // Discussion runs on a real clock; every other timer is parked while the phone goes around.
    this.manager = makeManager({ now: () => Date.now(), scale: 1, scaleFor: (kind) => (kind === 'discussion' ? 1 : 400) });
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  snapshot = (): number => this.version;
  private bump(): void {
    this.version += 1;
    for (const l of this.listeners) l();
  }

  private makeSeat(name: string, color: PlayerColor): Seat {
    const seat: Seat = { id: null, name, color, conn: null as unknown as Conn, view: null, error: null };
    seat.conn = makeConn('seat', (msg: ServerMessage) => {
      if (msg.type === 'joined') seat.id = msg.playerId;
      else if (msg.type === 'roomState') seat.view = msg.view;
      else if (msg.type === 'voteTally' && seat.view) seat.view = { ...seat.view, voteTally: msg.tally };
      else if (msg.type === 'error') seat.error = { code: msg.code, message: msg.message, at: Date.now() };
      this.bump();
    });
    return seat;
  }

  async start(names: string[], settings: RoomSettings): Promise<void> {
    this.seats = names.map((n, i) => this.makeSeat(n, PLAYER_COLORS[i % PLAYER_COLORS.length]));
    const [host, ...rest] = this.seats;
    await this.manager.handle(host.conn, { type: 'createRoom', name: host.name, color: host.color, settings });
    this.code = host.view?.code ?? null;
    if (!this.code) throw new Error('Could not create the table');
    for (const seat of rest) {
      await this.manager.handle(seat.conn, { type: 'joinRoom', code: this.code, name: seat.name, color: seat.color });
    }
    await this.manager.handle(host.conn, { type: 'startGame' });
    this.bump();
  }

  send(seat: Seat, msg: ClientMessage): void {
    seat.error = null;
    void this.manager.handle(seat.conn, msg);
  }

  clearError(seat: Seat): void {
    seat.error = null;
    this.bump();
  }

  get host(): Seat | undefined {
    return this.seats[0];
  }
}

export function useTable(table: Table): number {
  return useSyncExternalStore(table.subscribe, table.snapshot, table.snapshot);
}
