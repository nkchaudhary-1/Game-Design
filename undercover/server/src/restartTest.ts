/**
 * npm run test:restart
 * Starts a throwaway redis-server, plays a game to the night action step, kills the
 * game server, boots a fresh one against the same Redis and checks the game resumes
 * and ends. Also checks TTLs land on the stored rooms.
 */
import { spawn } from 'node:child_process';
import { PLAYER_COLORS } from '@undercover/shared';
import { Bot } from './bot.js';
import { createServer } from './server.js';
import { RedisStore } from './store.js';

const REDIS_PORT = 6390 + Math.floor(Math.random() * 100);
const SCALE = 0.05;

async function waitForRedis(url: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    try {
      const s = await RedisStore.connect(url, 'probe');
      await s.close();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('redis did not start');
}

async function main(): Promise<void> {
  const redis = spawn('redis-server', ['--port', String(REDIS_PORT), '--save', '', '--appendonly', 'no', '--loglevel', 'warning'], { stdio: 'ignore' });
  const url = `redis://127.0.0.1:${REDIS_PORT}`;
  try {
    await waitForRedis(url);
    const prefix = `uctest${Date.now()}`;
    const mk = async () =>
      createServer({
        port: 0,
        staticDir: null,
        store: await RedisStore.connect(url, prefix),
        clock: { now: () => Date.now(), scale: SCALE },
        graceMs: 1500,
        rateLimits: false,
      });

    let server = await mk();
    const bots = Array.from({ length: 7 }, (_, i) => new Bot(server.url, { name: `R${i}`, impatient: true }));
    await Promise.all(bots.map((b) => b.connect()));
    bots[0].create({ mode: 'player', targetCount: 7, bodyguard: true, discussionMinutes: null }, PLAYER_COLORS[0]);
    await bots[0].waitForPhase('waiting');
    const code = bots[0].code!;
    for (let i = 1; i < bots.length; i++) bots[i].join(code, PLAYER_COLORS[i]);
    await bots[0].waitFor((v) => v.players.length === 7, 5000, 'joined');
    await Promise.all(bots.map((b) => b.waitForPhase('waiting')));

    // Pause the bots so the night does not resolve before the restart.
    for (const b of bots) b.opts.lazy = true;
    bots[0].send({ type: 'startGame' });
    await bots[0].waitForPhase('roleReveal');
    bots[0].send({ type: 'advancePhase' }); // -> night narrator
    await bots[0].waitFor((v) => v.phase === 'night', 5000, 'night');
    bots[0].send({ type: 'advancePhase' }); // -> night action
    await bots[0].waitFor((v) => v.night?.step === 'action', 5000, 'night action');
    const roomBefore = server.manager.getRoom(code)!;
    const dayBefore = roomBefore.day;
    const timerBefore = roomBefore.timer?.endsAt ?? null;
    console.log(`  game ${code} is in night ${dayBefore} (action). Killing the server mid-night...`);

    // Kill the server. Sockets drop; rooms stay in Redis.
    const persisted = await RedisStore.connect(url, prefix);
    const stored = await persisted.get(code);
    if (!stored || stored.phase !== 'night') throw new Error('room not persisted in Redis before restart');
    await persisted.close();
    await server.close();
    await new Promise((r) => setTimeout(r, 300));

    server = await mk();
    const restored = server.manager.getRoom(code);
    if (!restored) throw new Error('room not restored after boot');
    if (restored.phase !== 'night' || restored.day !== dayBefore) throw new Error(`restored into wrong phase ${restored.phase}`);
    if ((restored.timer?.endsAt ?? null) !== timerBefore) throw new Error('timerEndsAt was not preserved across restart');
    console.log(`  server restarted; room restored in phase ${restored.phase}, timerEndsAt preserved.`);

    for (const b of bots) {
      b.opts.lazy = false;
      (b as unknown as { url: string }).url = server.url;
    }
    await Promise.all(bots.map((b) => b.reconnect()));
    await Promise.all(bots.map((b) => b.waitFor((v) => v.phase !== 'waiting', 5000, 'snapshot after rejoin')));
    const snap = bots[0].view!;
    if (!snap.you.role) throw new Error('snapshot after rejoin lacks own role');
    console.log(`  all clients rebound with a full snapshot (phase=${snap.phase}, day=${snap.day}).`);

    await Promise.all(bots.map((b) => b.waitForPhase('ended', 60_000)));
    const final = server.manager.getRoom(code)!;
    console.log(`  game resumed and ended: ${final.winner} win after ${final.day} day(s).`);

    const check = await RedisStore.connect(url, prefix);
    const ttl = await check.ttl(code);
    if (ttl <= 0 || ttl > 15 * 60) throw new Error(`ended room TTL is ${ttl}s, expected <= 15m`);
    console.log(`  ended room TTL in Redis: ${ttl}s (<= 15 minutes).`);
    await check.close();

    for (const b of bots) b.close();
    await server.close();
    console.log('Restart test passed.');
  } finally {
    redis.kill();
  }
}

main().catch((e) => {
  console.error('Restart test FAILED:', e);
  process.exit(1);
});
