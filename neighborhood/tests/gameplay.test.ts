import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SIM_DT } from '../src/shared/consts';
import { ITEM_BY_ID } from '../src/shared/game/items';
import { R, canPlaceDevice, canRaid, lockSeconds, lockUpgrade, slotAvailable, thwartChance, tierUpgrade, securityOf } from '../src/shared/game/rules';
import type { GameDto } from '../src/shared/game/types';
import { DEFAULT_LOOK, type S2C } from '../src/shared/protocol';
import { GameWorld, type SPlayer } from '../src/server/game';
import { hashToken, MemoryStore } from '../src/server/memstore';

// ───────────── rules (pure) ─────────────
describe('fairness rules', () => {
  const base = { now: 1000, ownerOnline: true, attackerHome: -1, attackerCooldownUntil: 0 };
  const house = (o: Partial<{ id: number; ownerKind: 'npc' | 'player' | 'vacant'; raidable: boolean; robbedUntil: number; protectedUntil: number }> = {}) => ({ id: 3, ownerKind: 'npc' as const, raidable: false, robbedUntil: 0, protectedUntil: 0, ...o });
  it('NPC households are always fair game; vacant, own and recently-burgled homes are not', () => {
    expect(canRaid(house(), base).ok).toBe(true);
    expect(canRaid(house({ ownerKind: 'vacant' }), base).ok).toBe(false);
    expect(canRaid(house(), { ...base, attackerHome: 3 }).reason).toMatch(/own home/);
    expect(canRaid(house({ robbedUntil: 2000 }), base).reason).toMatch(/Recently burgled/);
  });
  it('player homes need an explicit opt-in, an online owner, and no new-resident protection', () => {
    const p = house({ ownerKind: 'player' });
    expect(canRaid(p, base).reason).toMatch(/not opted in/);
    expect(canRaid({ ...p, raidable: true }, base).ok).toBe(true);
    expect(canRaid({ ...p, raidable: true }, { ...base, ownerOnline: false }).reason).toMatch(/away/);
    expect(canRaid({ ...p, raidable: true, protectedUntil: 1500 }, base).reason).toMatch(/protection/);
  });
  it('a raider on cooldown cannot start another heist', () => {
    expect(canRaid(house(), { ...base, attackerCooldownUntil: 1100 }).ok).toBe(false);
  });
  it('security changes the odds sensibly, and tiers and devices gate each other', () => {
    const none = securityOf(1, []), strong = securityOf(3, [
      { id: 1, kind: 'camera', x: 0, z: 0, yaw: 0 }, { id: 2, kind: 'alarm', x: 0, z: 0, yaw: 0 }, { id: 3, kind: 'dog', x: 0, z: 0, yaw: 0 }, { id: 4, kind: 'motion', x: 0, z: 0, yaw: 0 }]);
    expect(thwartChance(strong, 1000)).toBeGreaterThan(thwartChance(none, 1000) + 0.3);
    expect(thwartChance(none, 9000)).toBeLessThan(thwartChance(none, 100));
    expect(lockSeconds(3, false, false)).toBeGreaterThan(lockSeconds(0, false, false));
    expect(lockSeconds(2, true, false)).toBeLessThan(lockSeconds(2, false, false));
    expect(canPlaceDevice([], 'dog', 1).ok).toBe(false);
    expect(canPlaceDevice([], 'dog', 2).ok).toBe(true);
    expect(canPlaceDevice([{ id: 1, kind: 'camera', x: 0, z: 0, yaw: 0 }], 'camera', 1).ok).toBe(false);
    expect(tierUpgrade(1, 0).ok).toBe(true); expect(tierUpgrade(1, 0).price).toBe(R.tierPrice[2]);
    expect(tierUpgrade(2, 0).ok).toBe(false); expect(tierUpgrade(2, 20).ok).toBe(true);
    expect(lockUpgrade(0, 1).ok).toBe(true); expect(lockUpgrade(1, 1).ok).toBe(false); expect(lockUpgrade(1, 2).ok).toBe(true);
    expect(slotAvailable(1, false, 3)).toBe(false); expect(slotAvailable(2, false, 3)).toBe(true); expect(slotAvailable(3, false, 5)).toBe(false); expect(slotAvailable(3, true, 5)).toBe(true);
  });
});

// ───────────── world ─────────────
let simS = 0, simMs = 5000, clock: ReturnType<typeof vi.spyOn>;
let world: GameWorld, store: MemoryStore;
interface T { p: SPlayer; msgs: S2C[] }
function mk(): GameWorld {
  store = new MemoryStore();
  const w = new GameWorld(store, hashToken);
  w.epoch = () => 1e9 + simS;
  w.play.guards.freeze = true;
  return w;
}
function join(name: string, w = world): T {
  const msgs: S2C[] = [];
  let me!: SPlayer;
  const p = w.join({ send: (m) => { msgs.push(m); if (m.t === 'game' && me) keep(me, m.g); }, close: () => {} }, `test-token-${name}-000000`, name, DEFAULT_LOOK)!;
  me = p;
  return { p, msgs };
}
const tick = (n = 1) => { for (let i = 0; i < n; i++) { simS += SIM_DT; simMs += SIM_DT * 1000; world.step(); } };
const run = (sec: number) => tick(Math.round(sec / SIM_DT));
const tele = (p: SPlayer, x: number, y: number, z: number, yaw = 0) => Object.assign(p.body, { x, y, z, vx: 0, vy: 0, vz: 0, grounded: true, yaw });
let seqs = new Map<string, number>();
const allNotes = new Map<string, string[]>();
const keep = (p: SPlayer, g: GameDto) => { const a = allNotes.get(p.id) ?? []; for (const n of g.notes) a.push(n.text); allNotes.set(p.id, a); };
const drive = (p: SPlayer, mx: number, mz: number, sec: number, o: { sprint?: boolean; crouch?: boolean } = {}) => {
  for (let i = 0; i < Math.round(sec / SIM_DT); i++) { const s = (seqs.get(p.id) ?? 0) + 1; seqs.set(p.id, s); world.onMessage(p, { t: 'in', inputs: [{ s, x: mx, z: mz, j: 0, r: o.sprint ? 1 : 0, c: o.crouch ? 1 : 0 }] }); tick(); }
};
/** Walk toward a point with real inputs, to keep speed up inside a house. */
const go = (p: SPlayer, x: number, z: number, o: { sprint?: boolean; crouch?: boolean } = {}, max = 8) => {
  for (let i = 0; i < Math.round(max / SIM_DT); i++) { const dx = x - p.body.x, dz = z - p.body.z, dd = Math.hypot(dx, dz); if (dd < 0.4) return; drive(p, dx / dd, dz / dd, SIM_DT, o); }
};
const act = (p: SPlayer, a: string, extra: Record<string, unknown> = {}) => { world.onMessage(p, { t: 'act', a, ...extra }); run(0.25); };
const dto = (p: SPlayer): GameDto => { const g = world.play.dtoFor(p); keep(p, g); return g; };
const lastNote = (p: SPlayer) => { const a = allNotes.get(p.id) ?? []; return a[a.length - 1] ?? ''; };
const def = (id: number) => world.map.houses[id];
const goInside = (p: SPlayer, id: number, room: 'living' | 'hall' | 'storage' | 'bedroom' | 'kitchen' = 'living') => { const d = def(id); tele(p, d.rooms[room].x, d.floorY, d.rooms[room].z); };
const doorAt = (id: number, role: 'front' | 'back') => world.map.doors[def(id).doors[role]];
const interactOf = (doorId: number) => world.map.interactables.find((i) => i.kind === 'door' && i.ref === doorId)!;

beforeEach(() => { simS = 0; simMs = 5000; seqs = new Map(); allNotes.clear(); clock = vi.spyOn(performance, 'now').mockImplementation(() => simMs); world = mk(); });
afterEach(() => clock.mockRestore());

describe('ownership and the home', () => {
  it('buys a vacant home near it, once, with money taken', () => {
    const a = join('Ava');
    expect(dto(a.p).me.cash).toBe(R.startCash);
    tele(a.p, def(0).front.x, 0.2, def(0).front.z);
    act(a.p, 'buy_home', { house: 0 });
    expect(dto(a.p).me.cash).toBe(R.startCash - R.homePrice);
    expect(dto(a.p).homes[0]).toMatchObject({ owner: 'player', ownerName: 'Ava', mine: true });
    act(a.p, 'buy_home', { house: 1 });
    expect(lastNote(a.p)).toBeDefined();
    expect(dto(a.p).homes[1].owner).toBe('vacant');
    const b = join('Bo'); tele(b.p, def(0).front.x, 0.2, def(0).front.z);
    act(b.p, 'buy_home', { house: 0 });
    expect(dto(b.p).homes[0].mine).toBe(false);
    expect(dto(b.p).me.cash).toBe(R.startCash);
  });

  it('places and picks up devices by hand, with limits, costs and refunds', () => {
    const a = join('Ava'); tele(a.p, def(0).front.x, 0.2, def(0).front.z); act(a.p, 'buy_home', { house: 0 });
    const d = def(0), cash0 = dto(a.p).me.cash;
    goInside(a.p, 0);
    act(a.p, 'place_device', { kind: 'camera', x: d.anchors.camera.x, z: d.anchors.camera.z, yaw: d.anchors.camera.yaw });
    expect(world.play.houses[0].devices).toHaveLength(1);
    expect(dto(a.p).me.cash).toBe(cash0 - 450);
    act(a.p, 'place_device', { kind: 'camera', x: d.anchors.camera.x + 1, z: d.anchors.camera.z, yaw: 0 });
    expect(world.play.houses[0].devices).toHaveLength(1);                       // tier 1: one camera only
    act(a.p, 'place_device', { kind: 'dog', x: d.rooms.living.x, z: d.rooms.living.z, yaw: 0 });
    expect(world.play.houses[0].devices).toHaveLength(1);                       // dog needs tier 2
    act(a.p, 'place_device', { kind: 'motion', x: d.fp.x1 + 5, z: d.fp.z1 + 5, yaw: 0 });
    expect(world.play.houses[0].devices).toHaveLength(1);                       // outside the house
    act(a.p, 'pickup_device', { id: 1 });
    expect(world.play.houses[0].devices).toHaveLength(0);
    expect(dto(a.p).me.cash).toBe(cash0 - 450 + Math.round(450 * 0.7));
  });

  it('arranges valuables on display slots, and the safe unlocks safe slots', () => {
    const a = join('Ava'); tele(a.p, def(0).front.x, 0.2, def(0).front.z); act(a.p, 'buy_home', { house: 0 });
    goInside(a.p, 0);
    const [ring, fig] = dto(a.p).me.inv;
    act(a.p, 'place_item', { slot: 0, uid: ring.uid });
    expect(dto(a.p).view?.slots[0]?.uid).toBe(ring.uid);
    act(a.p, 'place_item', { slot: 5, uid: fig.uid });
    expect(dto(a.p).view?.slots[5]).toBeNull();                                  // no safe yet
    act(a.p, 'take_item', { slot: 0 });
    expect(dto(a.p).me.inv.some((i) => i.uid === ring.uid)).toBe(true);
  });
});

describe('heists', () => {
  /** Prepare a thief standing outside house `id`. */
  const thief = (id: number, tools: Record<string, number> = {}) => {
    const t = join('Thief'); world.play.games.get(t.p.id)!.tools = tools;
    tele(t.p, def(id).front.x, 0.2, def(id).front.z);
    return t;
  };
  const openFront = (t: T, id: number) => {
    const door = doorAt(id, 'front'), it = interactOf(door.id);
    tele(t.p, door.cx, 0.2, door.cz + (def(id).front.z - door.cz) * 0.4, 0);
    world.onMessage(t.p, { t: 'interact', id: it.id });
    return door;
  };

  it('refuses a house that is not an eligible target, and an own or vacant one', () => {
    const t = thief(0);
    act(t.p, 'heist_start', { house: 0 });                         // vacant
    expect(dto(t.p).heist).toBeNull();
    expect(lastNote(t.p)).toMatch(/Nobody lives/);
  });

  it('a locked door never traps you: from the inside it opens freely after it has swung shut behind you', () => {
    const id = 4, t = thief(id), d = def(id);
    act(t.p, 'heist_start', { house: id });
    const door = openFront(t, id);
    run(lockSeconds(1, false, false) + 0.3);
    expect(world.doorsOpen.has(door.id)).toBe(true);
    const dl = Math.hypot(door.cx - d.front.x, door.cz - d.front.z), ux = (door.cx - d.front.x) / dl, uz = (door.cz - d.front.z) / dl;
    goInside(t.p, id, 'bedroom'); run(34);                            // far from the door for longer than the auto-close delay (30 s): it swings shut
    expect(world.doorsOpen.has(door.id)).toBe(false);
    tele(t.p, door.cx + ux * 1.0, d.floorY, door.cz + uz * 1.0);   // just inside the door
    world.onMessage(t.p, { t: 'interact', id: interactOf(door.id).id }); run(0.3);
    expect(world.doorsOpen.has(door.id)).toBe(true);               // opened at once, no second pick
    expect(dto(t.p).heist?.channel).toBeNull();
  });

  it('full job on an easy house: pick the lock, take a valuable, slip away and bank it', () => {
    const id = 4, t = thief(id);
    const cash0 = dto(t.p).me.cash, item = world.play.houses[id].slots[0]!;
    act(t.p, 'scout', { house: id }); run(R.scoutTime + 0.5);
    expect(dto(t.p).scout[id]).toBeDefined();
    act(t.p, 'heist_start', { house: id });
    expect(dto(t.p).heist?.phase).toBe('approach');
    const door = openFront(t, id);
    expect(world.doorsOpen.has(door.id)).toBe(false);              // locked: it is a pick, not an open
    expect(dto(t.p).heist?.channel?.kind).toBe('pick');
    run(lockSeconds(1, false, false) + 0.3);
    expect(world.doorsOpen.has(door.id)).toBe(true);
    goInside(t.p, id);
    run(0.1);
    expect(dto(t.p).heist?.phase).toBe('inside');
    const s0 = def(id).slots[0];
    tele(t.p, s0.x, 0.2, s0.z + 0.8);
    act(t.p, 'loot', { slot: 0 }); run(2);
    expect(dto(t.p).heist?.carrying.map((i) => i.uid)).toEqual([item.uid]);
    expect(world.play.houses[id].slots[0]).toBeNull();
    // out of the house, far away, unseen
    const far = def(id).front; tele(t.p, far.x, 0.12, far.z > 0 ? far.z - 30 : far.z + 30);
    run(R.clearSeconds + 2);
    expect(dto(t.p).heist).toBeNull();
    const me = dto(t.p).me;
    expect(me.inv.find((i) => i.uid === item.uid)?.hot).toBe(true);
    expect(me.stats.heists).toBe(1); expect(me.cooldown).toBeGreaterThan(0);
    expect(me.cash).toBe(cash0);
    expect(world.play.houses[id].robbedUntil).toBeGreaterThan(world.epoch());
    // the street is now on watch: the same house cannot be hit again, and the thief must lie low
    act(t.p, 'heist_start', { house: id }); expect(dto(t.p).heist).toBeNull();
  });

  it('stolen goods cannot be sold at the market, but the back room takes them', () => {
    const id = 4, t = thief(id);
    const g = world.play.games.get(t.p.id)!; g.inv.push({ uid: 9001, def: 'silver_ring', hot: true });
    const market = world.map.interactables.find((i) => i.kind === 'market')!, fence = world.map.interactables.find((i) => i.kind === 'fence')!;
    tele(t.p, market.x, 0.03, market.z - 0.2); act(t.p, 'sell', { uid: 9001, where: 'market' });
    expect(dto(t.p).me.inv.some((i) => i.uid === 9001)).toBe(true);
    tele(t.p, fence.x, 0.03, fence.z - 0.2); act(t.p, 'sell', { uid: 9001, where: 'fence' });
    expect(dto(t.p).me.inv.some((i) => i.uid === 9001)).toBe(false);
    expect(dto(t.p).me.cash).toBe(R.startCash + Math.round(ITEM_BY_ID.silver_ring.value * 0.5));
  });

  it('a motion sensor in the hall trips on movement, but a jammer blinds it', () => {
    const id = 5, d = def(id);
    for (const jam of [false, true]) {
      world = mk(); seqs = new Map(); allNotes.clear();
      const t = thief(id, jam ? { jammer: 1 } : {});
      act(t.p, 'heist_start', { house: id });
      world.setDoor(doorAt(id, 'front').id, true, false);
      tele(t.p, d.rooms.hall.x, 0.2, d.rooms.hall.z); run(0.1);
      if (jam) act(t.p, 'use_jammer');
      for (let i = 0; i < 6; i++) { go(t.p, d.rooms.hall.x, d.rooms.hall.z - 1.0, {}, 1.5); go(t.p, d.rooms.hall.x, d.rooms.hall.z + 0.6, {}, 1.5); }
      const hs = dto(t.p).heist!;
      if (jam) { expect(hs.alert).toBeLessThan(10); expect(hs.alarm).toBe(0); } else { expect(hs.alarm).toBeGreaterThan(0); }
    }
  });

  it('crouching does not hide you from a motion sensor (it is slower, not silent)', () => {
    const id = 5, d = def(id), t = thief(id);
    act(t.p, 'heist_start', { house: id }); world.setDoor(doorAt(id, 'front').id, true, false);
    tele(t.p, d.rooms.hall.x, 0.2, d.rooms.hall.z); run(0.1);
    for (let i = 0; i < 6; i++) { go(t.p, d.rooms.hall.x, d.rooms.hall.z - 1.0, { crouch: true }, 2); go(t.p, d.rooms.hall.x, d.rooms.hall.z + 0.6, { crouch: true }, 2); }
    expect(dto(t.p).heist!.alert).toBeGreaterThan(30);
  });

  it('sprinting through a house with an alarm trips it early (60, not 100)', () => {
    const id = 6, d = def(id), t = thief(id);
    act(t.p, 'heist_start', { house: id }); world.setDoor(doorAt(id, 'front').id, true, false);
    tele(t.p, d.rooms.living.x, 0.2, d.rooms.living.z); run(0.1);
    for (let i = 0; i < 12 && dto(t.p).heist!.alarm === 0; i++) { go(t.p, d.rooms.kitchen.x, d.rooms.kitchen.z, { sprint: true }, 3); go(t.p, d.rooms.living.x, d.rooms.living.z, { sprint: true }, 3); }
    const hs = dto(t.p).heist!;
    expect(hs.alarm).toBeGreaterThan(0);
    expect(hs.threshold).toBe(60);
  });

  it('a guard dog barks at someone close, but treats put it to sleep', () => {
    const id = 7, d = def(id);
    for (const treats of [false, true]) {
      world = mk(); seqs = new Map();
      const t = thief(id, treats ? { treats: 1 } : {});
      act(t.p, 'heist_start', { house: id }); world.setDoor(doorAt(id, 'front').id, true, false);
      tele(t.p, d.anchors.dog.x + 1.5, 0.2, d.anchors.dog.z); run(0.1);
      if (treats) act(t.p, 'use_treats');
      run(1.5);
      const a = dto(t.p).heist!.alert;
      if (treats) expect(a).toBeLessThan(5); else expect(a).toBeGreaterThan(30);
    }
  });

  it('the Watch spots a thief carrying loot, chases, and arrests: loot returned, fine paid, sent to the booth', () => {
    const id = 4, t = thief(id), g = world.play.games.get(t.p.id)!;
    act(t.p, 'heist_start', { house: id });
    const hs = world.play.heistOf(t.p.id)!; const stolen = world.play.houses[id].slots[0]!;
    world.play.houses[id].slots[0] = null; hs.carrying.push(stolen); hs.phase = 'inside';
    const spot = { x: -30, z: 5.5 };
    tele(t.p, spot.x, 0.12, spot.z);
    world.play.guards.freeze = false;
    const guard = world.play.guards.list[1];
    tele(guard.p, spot.x + 9, 0.12, spot.z, -Math.PI / 2);            // facing the thief down the pavement
    const cash0 = g.cash;
    for (let i = 0; i < 25 && dto(t.p).heist; i++) run(1);
    expect(dto(t.p).heist).toBeNull();
    expect(g.stats.arrests).toBe(1);
    expect(g.cash).toBeLessThan(cash0);
    expect(world.play.houses[id].slots.some((s) => s?.uid === stolen.uid)).toBe(true);   // went back
    expect(Math.hypot(t.p.body.x - 42, t.p.body.z - 8)).toBeLessThan(3);
  });

  it('a thief who is not visible is left alone, and walls and closed doors stop guards seeing in', () => {
    const id = 4, t = thief(id);
    act(t.p, 'heist_start', { house: id });
    const hs = world.play.heistOf(t.p.id)!; hs.carrying.push({ uid: 777, def: 'figurine' }); hs.phase = 'inside';
    const d = def(id);
    tele(t.p, d.rooms.hall.x, 0.2, d.rooms.hall.z);                  // deep inside the house
    world.play.guards.freeze = false;
    const guard = world.play.guards.list[1];
    tele(guard.p, d.front.x, 0.2, d.front.z - 3, 0);                 // right outside the front door, facing it
    for (let i = 0; i < 10; i++) run(1);
    expect(dto(t.p).heist).not.toBeNull();
    expect(world.play.guards.sinceSeen(t.p.id)).toBe(Infinity);
  });

  it('a decoy sets off the alarm when taken', () => {
    const id = 6, d = def(id), t = thief(id);
    const h = world.play.houses[id]; h.devices.push({ id: 50, kind: 'decoy', x: d.anchors.decoy.x, z: d.anchors.decoy.z, yaw: 0 });
    act(t.p, 'heist_start', { house: id }); world.setDoor(doorAt(id, 'front').id, true, false);
    tele(t.p, d.anchors.decoy.x + (d.rooms.living.x - d.anchors.decoy.x) * 0.35, 0.2, d.anchors.decoy.z + (d.rooms.living.z - d.anchors.decoy.z) * 0.35); run(0.1);
    act(t.p, 'loot_decoy', { id: 50 });
    expect((allNotes.get(t.p.id) ?? []).join(' ')).toMatch(/decoy/i);
    expect(dto(t.p).heist!.alarm).toBeGreaterThan(0);
  });

  it('player homes: opt-in only, owner must be online, loss is capped and insured', () => {
    const owner = join('Olive'); tele(owner.p, def(0).front.x, 0.2, def(0).front.z); act(owner.p, 'buy_home', { house: 0 });
    goInside(owner.p, 0); act(owner.p, 'place_item', { slot: 0, uid: dto(owner.p).me.inv[0].uid });
    world.play.houses[0].protectedUntil = 0;
    const t = thief(0);
    act(t.p, 'heist_start', { house: 0 }); expect(dto(t.p).heist).toBeNull(); expect(lastNote(t.p)).toMatch(/not opted in/);
    act(owner.p, 'set_flag', { flag: 'raidable', v: true });
    act(t.p, 'heist_start', { house: 0 }); expect(dto(t.p).heist).not.toBeNull();
    // cap: at most two items leave a player's home in one job
    const hs = world.play.heistOf(t.p.id)!; hs.phase = 'inside';
    for (const i of [1, 2, 3]) world.play.houses[0].slots[i] = { uid: 100 + i, def: 'figurine' };
    tele(t.p, def(0).slots[1].x, 0.2, def(0).slots[1].z + 0.9);
    act(t.p, 'loot', { slot: 0 }); run(2); act(t.p, 'loot', { slot: 1 }); run(2); act(t.p, 'loot', { slot: 2 }); run(2);
    expect(dto(t.p).heist!.carrying.length).toBeLessThanOrEqual(R.maxLoot.player);
    // finish: the owner is insured
    const cash0 = dto(owner.p).me.cash;
    tele(t.p, def(0).front.x, 0.12, def(0).front.z + 30); run(R.clearSeconds + 2);
    expect(dto(owner.p).me.cash).toBeGreaterThan(cash0);
    // owner offline: protected
    world.leave(owner.p);
    act(t.p, 'heist_start', { house: 0 }); expect(dto(t.p).heist).toBeNull();
  });
});

describe('burglars, jobs, persistence', () => {
  it('burglars test the defences: weak homes lose things (insured), strong ones turn them away, and offline owners get a log', () => {
    const o = join('Olive'); tele(o.p, def(0).front.x, 0.2, def(0).front.z); act(o.p, 'buy_home', { house: 0 }); goInside(o.p, 0);
    act(o.p, 'place_item', { slot: 0, uid: dto(o.p).me.inv[0].uid }); act(o.p, 'place_item', { slot: 1, uid: dto(o.p).me.inv[0].uid });
    const g = world.play.games.get(o.p.id)!, cash0 = g.cash;
    world.play.setRandom(() => 0.999);
    run(R.burglarEvery + 1);
    expect(world.play.houses[0].slots.filter(Boolean)).toHaveLength(0);
    expect(g.cash).toBeGreaterThan(cash0);
    expect(g.log.some((l) => l.kind === 'burglar')).toBe(true);
    // strong defences + a lucky roll: thwarted, reputation up
    world.play.houses[0].devices.push({ id: 9, kind: 'alarm', x: 0, z: 0, yaw: 0 }, { id: 10, kind: 'camera', x: 0, z: 0, yaw: 0 });
    world.play.houses[0].slots[2] = { uid: 500, def: 'silver_ring' }; world.play.houses[0].lastBurglary = 0;
    world.play.setRandom(() => 0.01); const rep0 = g.rep;
    run(R.burglarEvery + 1);
    expect(world.play.houses[0].slots[2]).not.toBeNull();
    expect(g.rep).toBe(rep0 + 3);
    // offline: the outcome is still decided and logged for next login
    world.leave(o.p);
    world.play.houses[0].lastBurglary = 0; world.play.setRandom(() => 0.999);
    run(R.burglarEvery + 1);
    const rec = store.player(o.p.id)!.game!;
    expect(rec.log.length).toBeGreaterThan(g.log.length - 1);
  });

  it('delivery jobs pay at the right door, only from the board', () => {
    const a = join('Ava'), board = world.map.interactables.find((i) => i.kind === 'board')!;
    tele(a.p, 10, 0.12, 5.5); act(a.p, 'job_take'); expect(dto(a.p).me.job).toBeNull();
    tele(a.p, board.x, 0.03, board.z - 0.3); act(a.p, 'job_take');
    const job = dto(a.p).me.job!; expect(job).not.toBeNull();
    const cash0 = dto(a.p).me.cash;
    tele(a.p, 0, 0.12, 5.5); act(a.p, 'job_deliver'); expect(dto(a.p).me.cash).toBe(cash0);
    const d = def(job.house); tele(a.p, d.front.x, 0.2, d.front.z); act(a.p, 'job_deliver');
    expect(dto(a.p).me.cash).toBe(cash0 + job.pay); expect(dto(a.p).me.job).toBeNull();
  });

  it('everything survives a server restart: owner, devices, items, wallet, protection', () => {
    const a = join('Ava'); tele(a.p, def(0).front.x, 0.2, def(0).front.z); act(a.p, 'buy_home', { house: 0 }); goInside(a.p, 0);
    act(a.p, 'place_device', { kind: 'motion', x: def(0).anchors.motion.x, z: def(0).anchors.motion.z, yaw: 0 });
    act(a.p, 'place_item', { slot: 1, uid: dto(a.p).me.inv[0].uid });
    const cash = dto(a.p).me.cash; run(4);
    world.leave(a.p);
    const w2 = new GameWorld(store, hashToken); w2.epoch = () => 1e9 + simS; w2.play.guards.freeze = true;
    expect(w2.play.houses[0]).toMatchObject({ ownerKind: 'player', ownerName: 'Ava' });
    expect(w2.play.houses[0].devices.map((d) => d.kind)).toEqual(['motion']);
    expect(w2.play.houses[0].slots[1]).not.toBeNull();
    const back = join('Ava', w2);
    expect(w2.play.dtoFor(back.p).me.cash).toBe(cash); expect(w2.play.dtoFor(back.p).me.home).toBe(0);
  });
});

describe('the client learns which house it is in', () => {
  it('sends an update when you walk into your home, with its contents, and again when you walk out', () => {
    const a = join('Ava'); tele(a.p, def(0).front.x, 0.2, def(0).front.z); act(a.p, 'buy_home', { house: 0 });
    run(1); a.msgs.length = 0;
    goInside(a.p, 0); run(1.2);
    const inside = a.msgs.filter((m) => m.t === 'game').map((m) => (m as { g: GameDto }).g).pop();
    expect(inside?.view?.id).toBe(0); expect(inside?.view?.mine).toBe(true);
    a.msgs.length = 0;
    tele(a.p, def(0).front.x, 0.2, def(0).front.z); run(1.2);
    const outside = a.msgs.filter((m) => m.t === 'game').map((m) => (m as { g: GameDto }).g).pop();
    expect(outside?.view).toBeNull();
  });
});
