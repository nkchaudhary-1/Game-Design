import { describe, expect, it } from 'vitest';
import { CollisionWorld, newBody, stepBody, type Body, type MoveInput } from '../src/shared/collision';
import { SIM_DT } from '../src/shared/consts';

const box = (w: CollisionWorld, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, dyn = false) =>
  w.add({ minX: x0, minY: y0, minZ: z0, maxX: x1, maxY: y1, maxZ: z1, group: -1, tag: 0, dyn });
const idle: MoveInput = { mx: 0, mz: 0, jump: false, sprint: false };
function run(w: CollisionWorld, b: Body, inp: MoveInput, secs: number, onStep?: (b: Body) => void) {
  for (let i = 0; i < Math.round(secs / SIM_DT); i++) { stepBody(w, b, inp, SIM_DT); onStep?.(b); }
}
function ground() {
  const w = new CollisionWorld();
  box(w, -100, -1, -100, 100, 0, 100);
  return w;
}

describe('character controller', () => {
  it('lands on the ground and stays put with no input', () => {
    const w = ground();
    const b = newBody(0, 2, 0);
    run(w, b, idle, 1);
    expect(b.grounded).toBe(true);
    expect(b.y).toBeCloseTo(0, 5);
    expect(Math.hypot(b.x, b.z)).toBeLessThan(1e-6);
  });

  it('walks at walk speed and sprints faster', () => {
    const w = ground();
    const a = newBody(0, 0, 0), s = newBody(0, 0, 0);
    run(w, a, { ...idle, mz: 1 }, 2);
    run(w, s, { ...idle, mz: 1, sprint: true }, 2);
    expect(a.z).toBeGreaterThan(5.5); expect(a.z).toBeLessThan(6.3);
    expect(s.z).toBeGreaterThan(10); expect(s.z).toBeGreaterThan(a.z * 1.5);
  });

  it('cannot exceed speed by sending a long input vector', () => {
    const w = ground();
    const b = newBody(0, 0, 0);
    run(w, b, { ...idle, mz: 50 }, 2);
    expect(b.z).toBeLessThan(6.3);
  });

  it('is stopped by a wall and slides along it', () => {
    const w = ground();
    box(w, -5, 0, 3, 5, 3, 3.5);
    const b = newBody(0, 0, 0);
    run(w, b, { ...idle, mz: 1, mx: 1 }, 1.5);
    expect(b.z).toBeLessThan(2.7 + 1e-3);
    expect(b.x).toBeGreaterThan(2); // kept sliding along the wall
    run(w, b, { ...idle, mz: 1, mx: 1 }, 3);
    expect(b.z).toBeGreaterThan(3.6); // and eventually got around its end
  });

  it('never tunnels through a thin wall at sprint speed', () => {
    const w = ground();
    box(w, -5, 0, 3, 5, 3, 3.1);
    const b = newBody(0, 0, 0);
    run(w, b, { ...idle, mz: 1, sprint: true }, 4);
    expect(b.z).toBeLessThan(2.7 + 1e-3);
  });

  it('walks up a staircase with no teleport, and back down', () => {
    const w = ground();
    // 8 treads, rise 0.2, run 0.3, in front of a landing
    for (let i = 1; i <= 8; i++) box(w, -1, 0, 2 + (i - 1) * 0.3, 1, 0.2 * i, 2 + i * 0.3);
    box(w, -1, 0, 4.4, 1, 1.6, 30);
    const b = newBody(0, 0, 0);
    let maxJump = 0, last = b.y;
    run(w, b, { ...idle, mz: 1 }, 3, (bb) => { maxJump = Math.max(maxJump, Math.abs(bb.y - last)); last = bb.y; });
    expect(b.y).toBeCloseTo(1.6, 3);
    expect(b.grounded).toBe(true);
    expect(maxJump).toBeLessThanOrEqual(0.2 + 1e-6); // one riser at a time, never more
    // and down again, without launching off the steps
    let airFrames = 0;
    run(w, b, { ...idle, mz: -1 }, 4, (bb) => { if (!bb.grounded) airFrames++; });
    expect(b.y).toBeCloseTo(0, 3);
    expect(airFrames).toBeLessThan(6);
  });

  it('blocks a step that is too tall and can jump onto a low one', () => {
    const w = ground();
    box(w, -2, 0, 2, 2, 0.9, 3);   // 0.9 m counter: too tall to step
    box(w, -2, 0, 5, 2, 0.45, 6);  // 0.45 m sofa: steppable
    const b = newBody(0, 0, 0);
    run(w, b, { ...idle, mz: 1 }, 1.2);
    expect(b.z).toBeLessThan(1.7 + 1e-3);
    expect(b.y).toBeCloseTo(0, 3);
    const c = newBody(0, 0, 4);
    run(w, c, { ...idle, mz: 1 }, 0.5);
    expect(c.y).toBeCloseTo(0.45, 3);
  });

  it('does not step up under a low ceiling', () => {
    const w = ground();
    box(w, -2, 0, 2, 2, 0.3, 4);   // 0.3 m step
    box(w, -2, 1.2, 2, 2, 1.6, 4); // ceiling 1.2 m up: no headroom above the step
    const b = newBody(0, 0, 0);
    run(w, b, { ...idle, mz: 1 }, 1.5);
    expect(b.z).toBeLessThan(1.7 + 1e-3);
  });

  it('jump reaches roughly a metre and lands again', () => {
    const w = ground();
    const b = newBody(0, 0, 0);
    run(w, b, idle, 0.2);
    let maxY = 0;
    run(w, b, { ...idle, jump: true }, 0.05, (bb) => (maxY = Math.max(maxY, bb.y)));
    run(w, b, idle, 1.5, (bb) => (maxY = Math.max(maxY, bb.y)));
    expect(maxY).toBeGreaterThan(0.8); expect(maxY).toBeLessThan(1.1);
    expect(b.grounded).toBe(true);
  });

  it('is carried by a moving platform in both directions', () => {
    const w = ground();
    const plat = box(w, -1, 0.1, -1, 1, 0.3, 1, true);
    const b = newBody(0, 1, 0);
    run(w, b, idle, 0.5);
    expect(b.support).toBe(plat.id);
    for (let i = 0; i < 120; i++) { plat.minY += 0.04; plat.maxY += 0.04; stepBody(w, b, idle, SIM_DT); }
    expect(b.y).toBeCloseTo(plat.maxY, 3);
    for (let i = 0; i < 120; i++) { plat.minY -= 0.04; plat.maxY -= 0.04; stepBody(w, b, idle, SIM_DT); }
    expect(b.y).toBeCloseTo(plat.maxY, 3);
    expect(b.grounded).toBe(true);
  });
});
