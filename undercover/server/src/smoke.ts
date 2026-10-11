/** npm run smoke -- https://your-app.example  (creates a room, joins, starts a game) */
import { PLAYER_COLORS } from '@undercover/shared';
import { Bot } from './bot.js';

const base = (process.argv[2] ?? 'http://127.0.0.1:8080').replace(/\/$/, '');

async function main(): Promise<void> {
  const health = await fetch(`${base}/healthz`).then((r) => r.json() as Promise<{ ok: boolean }>);
  if (!health.ok) throw new Error('healthz not ok');
  console.log('healthz ok');
  const bots = Array.from({ length: 5 }, (_, i) => new Bot(base, { name: `Smoke ${i + 1}`, lazy: true }));
  await Promise.all(bots.map((b) => b.connect()));
  bots[0].create({ mode: 'player', targetCount: 5, bodyguard: false, discussionMinutes: null }, PLAYER_COLORS[0]);
  await bots[0].waitForPhase('waiting', 10_000);
  const code = bots[0].code!;
  console.log(`room ${code} created; invite ${base}/join/${code}`);
  for (let i = 1; i < 5; i++) bots[i].join(code, PLAYER_COLORS[i]);
  await bots[0].waitFor((v) => v.players.length === 5, 10_000, 'joins');
  console.log('5 players joined');
  bots[0].send({ type: 'startGame' });
  await Promise.all(bots.map((b) => b.waitForPhase('roleReveal', 10_000)));
  console.log('game started: every client received its role reveal');
  for (const b of bots) b.send({ type: 'leaveRoom' });
  await new Promise((r) => setTimeout(r, 200));
  for (const b of bots) b.close();
  console.log('smoke test passed');
}

main().catch((e) => {
  console.error('smoke test FAILED:', e.message);
  process.exit(1);
});
