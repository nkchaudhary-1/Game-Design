// Wire protocol (JSON over WebSocket). Short keys keep 20 Hz snapshots small; swap for binary + quantisation later.

import type { GameDto } from './game/types';

export interface Look { skin: number; hair: number; shirt: number; pants: number; style: number }
export const LOOK_SKIN = [0xf2d3b8, 0xe0b48c, 0xc68b61, 0x8d5a3c, 0x5b3a26];
export const LOOK_HAIR = [0x2b2118, 0x5a3a22, 0xa0693a, 0xd8b45a, 0xc4573b, 0x8a8f96];
export const LOOK_SHIRT = [0xc7714e, 0x8ea8be, 0x9fb59b, 0xf1dd98, 0xf3ede0, 0x2f3236, 0x8c6f86, 0x2b3f6b, 0xdfe6ee];
export const LOOK_PANTS = [0x3a4252, 0x6f8aa3, 0x8c6a47, 0x2f3236, 0xddcfb4];
export const LOOK_STYLES = ['Short', 'Long', 'Bun', 'Cap'] as const;
export const DEFAULT_LOOK: Look = { skin: 1, hair: 1, shirt: 1, pants: 0, style: 0 };
export function cleanLook(l: unknown): Look {
  const o = (l ?? {}) as Partial<Look>;
  const pick = (v: unknown, n: number, d: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < n ? v : d);
  return {
    skin: pick(o.skin, LOOK_SKIN.length, DEFAULT_LOOK.skin), hair: pick(o.hair, LOOK_HAIR.length, DEFAULT_LOOK.hair),
    shirt: pick(o.shirt, LOOK_SHIRT.length, DEFAULT_LOOK.shirt), pants: pick(o.pants, LOOK_PANTS.length, DEFAULT_LOOK.pants),
    style: pick(o.style, LOOK_STYLES.length, DEFAULT_LOOK.style),
  };
}
export function cleanName(n: unknown): string {
  const s = typeof n === 'string' ? n.replace(/[\u0000-\u001f<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14) : '';
  return s.length >= 2 ? s : 'Neighbor';
}

export interface InputCmd { s: number; x: number; z: number; j: 0 | 1; r: 0 | 1; c?: 0 | 1 }   // seq, move x/z (world space), jump, run
export interface BodyWire { x: number; y: number; z: number; vx: number; vy: number; vz: number; yaw: number; g: 0 | 1; c: number }
export interface PlayerWire { i: string; x: number; y: number; z: number; r: number; s: number; f: number; k: number }
export interface LiftWire { y: number; v: number; d: number; m: number; tg: number }
export interface PlayerInfo { id: string; name: string; look: Look }

export type EmoteId = 0 | 1 | 2;   // none, wave, dance
export const EMOTES = ['', 'wave', 'dance'] as const;
// PlayerWire.f bits: 1 grounded · 2 on the lift · 12<<2 emote · 16 seated · 32 running(>4.2 m/s)
export const FL = { GROUNDED: 1, ON_LIFT: 2, EMOTE_SHIFT: 2, EMOTE_MASK: 3, SEATED: 16, CROUCH: 32 };

export type C2S =
  | { t: 'hello'; token: string; name: string; look: Look }
  | { t: 'in'; inputs: InputCmd[] }
  | { t: 'interact'; id: number }
  | { t: 'lift'; floor: number }
  | { t: 'emote'; id: number }
  | { t: 'chat'; text: string }
  | { t: 'stand' }
  | { t: 'ping'; c: number }
  | { t: 'act'; a: string; [k: string]: unknown };

export type S2C =
  | { t: 'welcome'; id: string; name: string; look: Look; you: BodyWire; seat: number; players: PlayerInfo[];
      doors: number[]; sw: number[]; found: number[]; lift: LiftWire; st: number; online: number }
  | { t: 'snap'; st: number; ack: number; you: BodyWire; seat: number; p: PlayerWire[]; l: LiftWire }
  | { t: 'join'; p: PlayerInfo }
  | { t: 'leave'; id: string }
  | { t: 'world'; doors: number[]; sw: number[] }
  | { t: 'evt'; k: 'ding' | 'door' | 'knock' | 'bell' | 'click' | 'liftgo' | 'alarm' | 'cash' | 'pick' | 'arrest' | 'dog'; x: number; y: number; z: number; o?: number }
  | { t: 'game'; g: GameDto }
  | { t: 'chat'; id: string; name: string; text: string }
  | { t: 'toast'; text: string }
  | { t: 'found'; id: number; name: string; text: string; total: number; count: number }
  | { t: 'pong'; c: number; st: number }
  | { t: 'error'; text: string };
