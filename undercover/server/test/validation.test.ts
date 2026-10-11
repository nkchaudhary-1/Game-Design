import { describe, expect, it } from 'vitest';
import { seededRng } from '@undercover/shared';
import {
  advancePhase,
  ackReveal,
  beginNight,
  beginNightAction,
  castVote,
  createRoom,
  GameError,
  nightAction,
  startGame,
  viewFor,
  type Clock,
} from '../src/game.js';
import { addPlayer } from '../src/game.js';
import { alivePlayers, type RoomState } from '../src/state.js';
import { RoomManager, type Conn } from '../src/manager.js';
import { MemoryStore } from '../src/store.js';

const clock: Clock = { now: () => 1_000_000, scale: 1 };

function makeRoom(n: number, mode: 'player' | 'god' = 'player'): RoomState {
  const room = createRoom('ABCDEF', { id: 'host', name: 'Host', color: 'moon', secret: 's0' }, { mode, targetCount: 7, bodyguard: true, discussionMinutes: null }, clock);
  for (let i = 1; i < n; i++) addPlayer(room, { id: `p${i}`, name: `P${i}`, color: 'silver', secret: `s${i}` }, clock);
  return room;
}

function snapshot(room: RoomState): string {
  return JSON.stringify({ ...room, updatedAt: 0 });
}

describe('action validation', () => {
  it('rejects a start with too few players', () => {
    const room = makeRoom(4);
    expect(() => startGame(room, 'host', seededRng(1), clock)).toThrow(GameError);
    expect(room.phase).toBe('waiting');
  });

  it('only the host can start', () => {
    const room = makeRoom(5);
    expect(() => startGame(room, 'p1', seededRng(1), clock)).toThrowError(/host/);
  });

  it('wrong-role and dead-player night actions get an error and change nothing', () => {
    const room = makeRoom(7);
    startGame(room, 'host', seededRng(3), clock);
    beginNight(room, clock);
    beginNightAction(room, clock);
    const innocent = room.players.find((p) => p.role === 'innocent')!;
    const doctor = room.players.find((p) => p.role === 'doctor')!;
    const traitor = room.players.find((p) => p.role === 'traitor')!;
    const police = room.players.find((p) => p.role === 'police')!;

    const before = snapshot(room);
    expect(() => nightAction(room, innocent.id, doctor.id, true, seededRng(1), clock)).toThrowError(expect.objectContaining({ code: 'wrongRole' }));
    expect(snapshot(room)).toBe(before);

    // traitor cannot target a traitor
    const otherTraitor = room.players.find((p) => p.role === 'traitor' && p.id !== traitor.id)!;
    expect(() => nightAction(room, traitor.id, otherTraitor.id, true, seededRng(1), clock)).toThrowError(expect.objectContaining({ code: 'illegalTarget' }));
    expect(snapshot(room)).toBe(before);

    // police cannot investigate themselves
    expect(() => nightAction(room, police.id, police.id, true, seededRng(1), clock)).toThrowError(expect.objectContaining({ code: 'illegalTarget' }));
    expect(snapshot(room)).toBe(before);

    // dead doctor cannot act
    doctor.alive = false;
    const beforeDead = snapshot(room);
    expect(() => nightAction(room, doctor.id, innocent.id, true, seededRng(1), clock)).toThrowError(expect.objectContaining({ code: 'notAlive' }));
    expect(snapshot(room)).toBe(beforeDead);
    doctor.alive = true;

    // wrong phase
    room.phase = 'discussion';
    expect(() => nightAction(room, traitor.id, innocent.id, true, seededRng(1), clock)).toThrowError(expect.objectContaining({ code: 'wrongPhase' }));
  });

  it('confirmed picks cannot change; unconfirmed picks can', () => {
    const room = makeRoom(7);
    startGame(room, 'host', seededRng(3), clock);
    beginNight(room, clock);
    beginNightAction(room, clock);
    const traitor = room.players.find((p) => p.role === 'traitor')!;
    const [a, b] = room.players.filter((p) => p.role !== 'traitor');
    nightAction(room, traitor.id, a.id, false, seededRng(1), clock);
    nightAction(room, traitor.id, b.id, false, seededRng(1), clock);
    expect(room.night!.picks[traitor.id].targetId).toBe(b.id);
    nightAction(room, traitor.id, b.id, true, seededRng(1), clock);
    expect(() => nightAction(room, traitor.id, a.id, true, seededRng(1), clock)).toThrowError(expect.objectContaining({ code: 'alreadyActed' }));
  });

  it('vote validation: dead, self, duplicate, god', () => {
    const room = makeRoom(8, 'god');
    startGame(room, 'host', seededRng(5), clock);
    room.phase = 'voting';
    const [v1, v2, v3] = alivePlayers(room);
    expect(() => castVote(room, 'host', v1.id, clock)).toThrowError(expect.objectContaining({ code: 'notInRoom' }));
    expect(() => castVote(room, v1.id, v1.id, clock)).toThrowError(expect.objectContaining({ code: 'illegalTarget' }));
    expect(() => castVote(room, v1.id, 'host', clock)).toThrowError(expect.objectContaining({ code: 'illegalTarget' }));
    castVote(room, v1.id, v2.id, clock);
    expect(() => castVote(room, v1.id, v3.id, clock)).toThrowError(expect.objectContaining({ code: 'alreadyActed' }));
    v3.alive = false;
    expect(() => castVote(room, v3.id, v1.id, clock)).toThrowError(expect.objectContaining({ code: 'notAlive' }));
    expect(() => castVote(room, v2.id, v3.id, clock)).toThrowError(expect.objectContaining({ code: 'illegalTarget' }));
    expect(Object.keys(room.votes)).toEqual([v1.id]);
  });

  it('non-host cannot advance; host cannot skip the night action step', () => {
    const room = makeRoom(5);
    startGame(room, 'host', seededRng(2), clock);
    expect(() => advancePhase(room, 'p1', seededRng(1), clock)).toThrowError(expect.objectContaining({ code: 'notHost' }));
    advancePhase(room, 'host', seededRng(1), clock); // roleReveal -> night narrator
    expect(room.phase).toBe('night');
    advancePhase(room, 'host', seededRng(1), clock); // narrator -> action
    expect(room.night?.step).toBe('action');
    expect(() => advancePhase(room, 'host', seededRng(1), clock)).toThrowError(expect.objectContaining({ code: 'wrongPhase' }));
  });

  it('role reveal ends early when every connected player acks', () => {
    const room = makeRoom(5);
    startGame(room, 'host', seededRng(2), clock);
    for (const p of room.players.slice(0, 4)) expect(ackReveal(room, p.id, clock)).toBe(false);
    expect(ackReveal(room, room.players[4].id, clock)).toBe(true);
    expect(room.phase).toBe('night');
    expect(room.night?.step).toBe('narrator');
  });
});

describe('viewFor', () => {
  it('traitors see teammates, innocents do not; God sees everyone', () => {
    const room = makeRoom(8, 'god');
    startGame(room, 'host', seededRng(9), clock);
    beginNight(room, clock);
    const traitors = room.players.filter((p) => p.role === 'traitor');
    const innocent = room.players.find((p) => p.role === 'innocent')!;
    const tView = viewFor(room, traitors[0].id, clock);
    expect(tView.night?.teammates).toEqual([traitors[1].id]);
    expect(tView.players.find((p) => p.id === traitors[1].id)?.role).toBe('traitor');
    expect(tView.players.find((p) => p.id === innocent.id)?.role).toBeUndefined();
    const iView = viewFor(room, innocent.id, clock);
    expect(iView.night?.teammates).toBeUndefined();
    expect(iView.players.filter((p) => p.role !== undefined).map((p) => p.id)).toEqual([innocent.id]);
    expect(iView.god).toBeUndefined();
    const gView = viewFor(room, 'host', clock);
    expect(Object.keys(gView.god!.roles).length).toBe(7);
    expect(gView.isGod).toBe(true);
  });

  it('timer is exposed as timerEndsAt and roles are revealed at the end', () => {
    const room = makeRoom(5);
    startGame(room, 'host', seededRng(1), clock);
    const v = viewFor(room, 'p1', clock);
    expect(v.timerEndsAt).toBe(1_000_000 + 20_000);
    room.phase = 'ended';
    room.winner = 'town';
    const e = viewFor(room, 'p1', clock);
    expect(Object.keys(e.ended!.roles).length).toBe(5);
    expect(e.players.every((p) => p.role !== undefined)).toBe(true);
  });
});

describe('RoomManager over fake connections', () => {
  function conn(id: string): Conn & { out: unknown[] } {
    const out: unknown[] = [];
    return { id, ip: '1.1.1.1', playerId: null, code: null, out, send: (m) => out.push(m) };
  }

  it('rate limits room creation per IP and reports errors with the originating message type', async () => {
    const mgr = new RoomManager({ store: new MemoryStore(), clock });
    const c = conn('c1');
    for (let i = 0; i < 6; i++) {
      await mgr.handle(c, { type: 'createRoom', name: 'X', color: 'moon', settings: { mode: 'player', targetCount: 5, bodyguard: false, discussionMinutes: null } });
    }
    await mgr.handle(c, { type: 'createRoom', name: 'X', color: 'moon', settings: { mode: 'player', targetCount: 5, bodyguard: false, discussionMinutes: null } });
    const errors = c.out.filter((m) => (m as { type: string }).type === 'error') as { code: string; ref: string }[];
    expect(errors.at(-1)?.code).toBe('rateLimited');
    expect(errors.at(-1)?.ref).toBe('createRoom');
    await mgr.close();
  });

  it('names are cleaned and de-duplicated on join', async () => {
    const mgr = new RoomManager({ store: new MemoryStore(), clock, rateLimits: false });
    const host = conn('h');
    await mgr.handle(host, { type: 'createRoom', name: '  Sly   Doyle  ', color: 'moon', settings: { mode: 'player', targetCount: 5, bodyguard: false, discussionMinutes: null } });
    const code = host.code!;
    const dup = conn('d');
    await mgr.handle(dup, { type: 'joinRoom', code, name: 'sly doyle', color: 'fog' });
    const room = mgr.getRoom(code)!;
    expect(room.players.map((p) => p.name)).toEqual(['Sly Doyle', 'sly doyle 2']);
    await mgr.close();
  });

  it('a disconnected player in the lobby loses their seat after the grace period', async () => {
    const mgr = new RoomManager({ store: new MemoryStore(), graceMs: 30, rateLimits: false });
    const host = conn('h');
    await mgr.handle(host, { type: 'createRoom', name: 'Host', color: 'moon', settings: { mode: 'player', targetCount: 5, bodyguard: false, discussionMinutes: null } });
    const code = host.code!;
    const p = conn('p');
    await mgr.handle(p, { type: 'joinRoom', code, name: 'Guest', color: 'fog' });
    await mgr.onDisconnect(p);
    expect(mgr.getRoom(code)!.players.find((x) => x.name === 'Guest')?.connected).toBe(false);
    await new Promise((r) => setTimeout(r, 80));
    expect(mgr.getRoom(code)!.players.length).toBe(1);
    await mgr.close();
  });
});
