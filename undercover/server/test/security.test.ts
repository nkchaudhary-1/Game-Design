import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PLAYER_COLORS, type RoomView, type ServerMessage } from '@undercover/shared';
import { Bot } from '../src/bot.js';
import { startSimServer } from '../src/simulate.js';
import type { RunningServer } from '../src/server.js';

let server: RunningServer;

beforeAll(async () => {
  server = await startSimServer(0.02);
});
afterAll(async () => {
  await server.close();
});

/**
 * Scan every message an ordinary (non-God, non-traitor) player received during a
 * full 9-player game. No other player's role may appear before that player's
 * elimination or the end of the game, and no God / traitor-only data may appear at all.
 */
describe('no role leakage', () => {
  it('ordinary players never see another living player\'s role before game end', async () => {
    const bots: Bot[] = [];
    for (let i = 0; i < 9; i++) bots.push(new Bot(server.url, { name: `P${i}`, record: true, impatient: true }));
    await Promise.all(bots.map((b) => b.connect()));
    bots[0].create({ mode: 'player', targetCount: 9, bodyguard: true, discussionMinutes: null }, PLAYER_COLORS[0]);
    await bots[0].waitForPhase('waiting');
    for (let i = 1; i < 9; i++) bots[i].join(bots[0].code!, PLAYER_COLORS[i]);
    await bots[0].waitFor((v) => v.players.length === 9, 5000, 'joined');
    await Promise.all(bots.map((b) => b.waitForPhase('waiting')));
    bots[0].send({ type: 'startGame' });
    await Promise.all(bots.map((b) => b.waitForPhase('ended', 60_000)));

    const room = server.manager.getRoom(bots[0].code!)!;
    const trueRoles = Object.fromEntries(room.players.map((p) => [p.id, p.role]));

    let scanned = 0;
    for (const bot of bots) {
      const myRole = trueRoles[bot.playerId!];
      if (myRole === 'traitor') continue; // traitors legitimately see teammates
      for (const msg of bot.messages) {
        if (msg.type !== 'roomState') continue;
        const view: RoomView = msg.view;
        scanned += 1;
        expect(view.god, `God data sent to ${bot.name}`).toBeUndefined();
        expect(view.night?.teamPicks, `team picks sent to ${bot.name}`).toBeUndefined();
        expect(view.night?.teammates, `teammates sent to ${bot.name}`).toBeUndefined();
        expect(view.you.role === null || view.you.role === myRole).toBe(true);
        if (view.phase === 'ended') continue;
        for (const p of view.players) {
          if (p.id === view.youId) continue;
          if (p.role !== undefined) {
            expect(p.alive, `${bot.name} saw living ${p.name}'s role in phase ${view.phase}`).toBe(false);
          }
        }
        if (myRole !== 'police') expect(view.policeFindings).toBeUndefined();
        // Belt and braces: the raw JSON of a mid-game view must not carry the private night breakdown.
        const raw = JSON.stringify(msg);
        expect(raw).not.toContain('"lastNight"');
        expect(raw).not.toContain('"pendingAnnouncement"');
      }
    }
    expect(scanned).toBeGreaterThan(50);
    for (const b of bots) b.close();
  });

  it('a wrong secret cannot take over a slot', async () => {
    const a = new Bot(server.url, { name: 'Owner' });
    const b = new Bot(server.url, { name: 'Thief', record: true });
    await Promise.all([a.connect(), b.connect()]);
    a.create({ mode: 'player', targetCount: 5, bodyguard: false, discussionMinutes: null });
    await a.waitForPhase('waiting');
    b.send({ type: 'rejoin', code: a.code!, playerId: a.playerId!, secret: 'nope' });
    await new Promise((r) => setTimeout(r, 200));
    const err = b.messages.find((m): m is Extract<ServerMessage, { type: 'error' }> => m.type === 'error');
    expect(err?.code).toBe('badSecret');
    expect(b.view).toBeNull();
    a.close();
    b.close();
  });
});
