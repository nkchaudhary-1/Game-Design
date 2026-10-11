/**
 * npm run simulate         - play full games with headless clients across every configuration
 * npm run simulate:chaos   - same, while randomly dropping and reconnecting clients
 */
import { checkWin, PLAYER_COLORS, seededRng, type PlayerCount, type RoomSettings } from '@undercover/shared';
import { Bot } from './bot.js';
import { createServer, type RunningServer } from './server.js';
import { MemoryStore } from './store.js';

export interface SimConfig {
  players: PlayerCount | number;
  bodyguard: boolean;
  mode: 'player' | 'god';
  lazyCount?: number;
  chaos?: boolean;
  seed?: number;
}

export interface SimResult {
  config: SimConfig;
  winner: 'traitors' | 'town';
  days: number;
  ms: number;
  errors: number;
}

export const SIM_TIMER_SCALE = Number(process.env.TIMER_SCALE ?? '0.02') || 0.02;

export async function startSimServer(scale = SIM_TIMER_SCALE, store = new MemoryStore()): Promise<RunningServer> {
  return createServer({
    port: 0,
    staticDir: null,
    store,
    clock: { now: () => Date.now(), scale },
    graceMs: Math.max(300, 4000 * scale),
    rateLimits: false,
  });
}

export async function runGame(server: RunningServer, cfg: SimConfig, log: (s: string) => void = () => {}): Promise<SimResult> {
  const rng = seededRng(cfg.seed ?? 1);
  const started = Date.now();
  const total = cfg.players + (cfg.mode === 'god' ? 1 : 0);
  const bots: Bot[] = [];
  for (let i = 0; i < total; i++) {
    const lazy = i >= total - (cfg.lazyCount ?? 0) && !(cfg.mode === 'god' && i === 0);
    bots.push(new Bot(server.url, { name: `Bot ${i + 1}`, lazy, impatient: true, rng: seededRng((cfg.seed ?? 1) * 100 + i), log }));
  }
  await Promise.all(bots.map((b) => b.connect()));

  const host = bots[0];
  const settings: RoomSettings = {
    mode: cfg.mode,
    targetCount: ([5, 7, 9, 11].find((n) => n >= cfg.players) ?? 11) as PlayerCount,
    bodyguard: cfg.bodyguard,
    discussionMinutes: null,
  };
  host.create(settings, PLAYER_COLORS[0]);
  await host.waitForPhase('waiting');
  const code = host.code!;
  for (let i = 1; i < bots.length; i++) {
    bots[i].join(code, PLAYER_COLORS[i % PLAYER_COLORS.length]);
  }
  await host.waitFor((v) => v.players.length === total, 10_000, 'everyone joined');
  await Promise.all(bots.map((b) => b.waitForPhase('waiting')));

  host.send({ type: 'startGame' });

  let chaosTimer: NodeJS.Timeout | null = null;
  if (cfg.chaos) {
    const tick = () => {
      const victim = bots[Math.floor(rng() * bots.length)];
      if (victim.ws) {
        victim.drop();
        setTimeout(() => void victim.reconnect().catch(() => {}), 50 + rng() * 300);
      }
      chaosTimer = setTimeout(tick, 80 + rng() * 200);
    };
    chaosTimer = setTimeout(tick, 100);
  }

  const timeout = 90_000;
  const finals = await Promise.all(bots.filter((b) => !b.opts.lazy || true).map((b) => b.waitForPhase('ended', timeout).catch((e) => e as Error)));
  if (chaosTimer) clearTimeout(chaosTimer);

  const room = server.manager.getRoom(code);
  if (!room) throw new Error('room vanished');
  const roles: Record<string, 'traitor' | 'doctor' | 'police' | 'bodyguard' | 'innocent'> = {};
  for (const p of room.players) if (p.role) roles[p.id] = p.role;
  const alive = room.players.filter((p) => p.alive && p.id !== room.godId).map((p) => p.id);
  const expected = checkWin(roles, alive);
  if (room.phase !== 'ended' || !room.winner) throw new Error(`game ${code} did not end (phase ${room.phase})`);
  if (expected !== room.winner) throw new Error(`winner mismatch: state says ${room.winner}, engine says ${expected}`);

  // Every bot that is still connected must have received the end state.
  for (const f of finals) {
    if (f instanceof Error) {
      const name = f.message.split(':')[0];
      const bot = bots.find((b) => b.name === name);
      if (bot && bot.ws && !bot.opts.lazy && !cfg.chaos) throw f;
    }
  }
  const errors = bots.reduce((n, b) => n + b.errors.length, 0);
  for (const b of bots) b.close();
  return { config: cfg, winner: room.winner, days: room.day, ms: Date.now() - started, errors };
}

export function matrix(chaos: boolean): SimConfig[] {
  const configs: SimConfig[] = [];
  let seed = 7;
  for (const players of [5, 7, 9, 11]) {
    for (const bodyguard of players >= 7 ? [false, true] : [false]) {
      for (const mode of ['player', 'god'] as const) {
        configs.push({ players, bodyguard, mode, chaos, seed: seed++ });
      }
    }
  }
  configs.push({ players: 7, bodyguard: true, mode: 'player', lazyCount: 2, chaos, seed: seed++ });
  configs.push({ players: 9, bodyguard: false, mode: 'god', lazyCount: 3, chaos, seed: seed++ });
  return configs;
}

async function main(): Promise<void> {
  const chaos = process.argv.includes('--chaos');
  const verbose = process.argv.includes('--verbose');
  const server = await startSimServer();
  const configs = matrix(chaos);
  let failed = 0;
  console.log(`Simulating ${configs.length} games (${chaos ? 'chaos, ' : ''}TIMER_SCALE=${SIM_TIMER_SCALE})`);
  for (const cfg of configs) {
    const label = `${String(cfg.players).padStart(2)} players, bodyguard=${cfg.bodyguard ? 'on ' : 'off'}, ${cfg.mode.padEnd(6)}${cfg.lazyCount ? `, ${cfg.lazyCount} idle` : ''}`;
    try {
      const r = await runGame(server, cfg, verbose ? (s) => console.log('   ', s) : undefined);
      console.log(`  ok   ${label} -> ${r.winner} win after ${r.days} day(s) in ${r.ms}ms${r.errors ? ` (${r.errors} client errors)` : ''}`);
    } catch (err) {
      failed += 1;
      console.log(`  FAIL ${label}: ${(err as Error).message}`);
    }
  }
  await server.close();
  if (failed) {
    console.log(`${failed} simulation(s) failed`);
    process.exit(1);
  }
  console.log('All simulations reached gameEnd.');
}

const isMain = process.argv[1] && /simulate\.(ts|js)$/.test(process.argv[1]);
if (isMain) main().catch((e) => { console.error(e); process.exit(1); });
