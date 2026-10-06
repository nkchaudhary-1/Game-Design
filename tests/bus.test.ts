import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildBlade } from '../src/blades/BladeFactory';
import { getArena } from '../src/arenas/arenaData';
import { Match } from '../src/combat/Match';
import { applyControllerMsg, feedbackFor, LocalBus, type ControllerMsg, type DisplayMsg } from '../src/core/InputBus';
import { initPhysics } from '../src/core/Physics';
import { makeRng } from '../src/core/Rng';

beforeAll(async () => { await initPhysics(); });

describe('controller ⇄ display boundary (PRD v2: Phase 2 swaps only the transport)', () => {
  it('controller messages reach the display, feedback reaches the controller', () => {
    const bus = new LocalBus();
    const atDisplay: ControllerMsg[] = [], atController: DisplayMsg[] = [];
    bus.display.subscribe((m) => atDisplay.push(m));
    bus.controller.subscribe((m) => atController.push(m));
    bus.controller.send({ t: 'steer', slot: 0, x: 1, z: 0 });
    bus.display.send({ t: 'hit', slot: 0, strength: 1 });
    expect(atDisplay).toEqual([{ t: 'steer', slot: 0, x: 1, z: 0 }]);
    expect(atController).toEqual([{ t: 'hit', slot: 0, strength: 1 }]);
  });

  it('can simulate network latency for feel-testing', () => {
    vi.useFakeTimers();
    const bus = new LocalBus();
    bus.latencyMs = 80;
    const got: ControllerMsg[] = [];
    bus.display.subscribe((m) => got.push(m));
    bus.controller.send({ t: 'super', slot: 0 });
    expect(got).toHaveLength(0);
    vi.advanceTimersByTime(81);
    expect(got).toHaveLength(1);
    vi.useRealTimers();
  });

  it('messages drive the match exactly like direct calls', () => {
    const m = new Match(getArena('core-pit'), [{ built: buildBlade('ravok', { level: 3 }), control: 'human' }, { built: buildBlade('gravion', { level: 3 }), control: 'ai' }], makeRng(5));
    applyControllerMsg(m, { t: 'launch', slot: 0, angle: -Math.PI / 2, power: 0.8 });
    applyControllerMsg(m, { t: 'launch', slot: 1, angle: Math.PI / 2, power: 0.5 });
    expect(m.phase).toBe('live');
    applyControllerMsg(m, { t: 'steer', slot: 0, x: 0.5, z: -0.5 });
    expect(m.blades[0].steerX).toBeCloseTo(0.5);
    applyControllerMsg(m, { t: 'move', slot: 0, index: 1, phase: 'down' });
    expect(m.blades[0].queue).toEqual([{ k: 'down', i: 1 }]);
    applyControllerMsg(m, { t: 'super', slot: 0 });
    expect(m.blades[0].queue.at(-1)).toEqual({ k: 'super' });
    m.dispose();
  });

  it('feedback carries what a controller needs to keep its meters honest', () => {
    const m = new Match(getArena('core-pit'), [{ built: buildBlade('ravok', { level: 3 }), control: 'human' }, { built: buildBlade('gravion', { level: 3 }), control: 'ai' }], makeRng(5));
    const fb = feedbackFor(m, 0);
    expect(fb).toMatchObject({ t: 'feedback', slot: 0, phase: 'ready', spin: 100, superState: 'READY', chargeIndex: -1 });
    expect(fb.cooldowns).toHaveLength(3);
    m.dispose();
  });

  it('a launch cannot be fired twice', () => {
    const m = new Match(getArena('core-pit'), [{ built: buildBlade('ravok', { level: 3 }), control: 'human' }, { built: buildBlade('gravion', { level: 3 }), control: 'ai' }], makeRng(5));
    m.launch(0, -Math.PI / 2, 1);
    const v = m.blades[0].vz;
    m.launch(0, Math.PI / 2, 0.1);
    expect(m.blades[0].vz).toBe(v);
    m.dispose();
  });
});
