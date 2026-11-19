import { describe, expect, it, vi } from 'vitest';
import { SIM_DT } from '../src/shared/consts';
import { addNeighbours } from '../src/server/bots';
import { GameWorld } from '../src/server/game';
import { hashToken, MemoryStore } from '../src/server/memstore';

describe('simulated neighbours', () => {
  it('complete their routes with no stuck steps: sit on benches, open doors, ride the lift both ways', () => {
    // rate limits use wall-clock time; run the headless loop on simulated time instead
    let simMs = 5000;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => simMs);
    const world = new GameWorld(new MemoryStore(), hashToken);
    const { bots, tick } = addNeighbours(world);
    const sat = new Set<string>();
    let maxLiftY = 0, chats = 0;
    const origBroadcast = (world as unknown as { broadcast: (m: { t: string }) => void }).broadcast.bind(world);
    (world as unknown as { broadcast: (m: { t: string }) => void }).broadcast = (m) => { if (m.t === 'chat') chats++; origBroadcast(m); };
    const steps = Math.round(420 / SIM_DT);
    for (let i = 0; i < steps; i++) {
      simMs += SIM_DT * 1000;
      tick(SIM_DT); world.step();
      for (const b of bots) if (b.p.seat >= 0) sat.add(b.spec.name);
      maxLiftY = Math.max(maxLiftY, world.lift.y);
    }
    clock.mockRestore();
    for (const b of bots) expect(b.stuckSkips, `${b.spec.name}: ${b.log.join(' | ')}`).toBe(0);
    for (const b of bots) expect(b.cycles, `${b.spec.name} finished a full loop`).toBeGreaterThanOrEqual(1);
    expect([...sat].sort()).toEqual(['Priya', 'Sam']);
    expect(maxLiftY).toBeGreaterThan(6);                       // Dev rode to floor 2 (6.6 m)
    expect(bots[2].log.filter((l) => l.startsWith('rode'))).toEqual(expect.arrayContaining(['rode:2', 'rode:0']));
    expect(chats).toBeGreaterThanOrEqual(4);
  }, 60000);
});
