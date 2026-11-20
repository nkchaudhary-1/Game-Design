import { ITEM_BY_ID, type ItemInst } from './items';

/** Every balance number lives here so it can be tuned (and tested) in one place. */
export const R = {
  startCash: 2000,
  homePrice: 1500,
  sellRate: 0.55,
  buyMarkup: 1.35,
  insuranceRate: 0.5,
  tierPrice: [0, 0, 3000, 6500],            // cost to reach tier index
  tierRep: [0, 0, 0, 15],                    // reputation needed for tier index
  displaySlots: [0, 3, 4, 5],                // by tier
  fine: 0.1, fineMax: 300,
  heistCooldown: 120,                        // s after a heist ends
  robbedProtection: 480,                     // s a house is left alone after being robbed
  newbieProtection: 300,                     // s of protection for a new player's home
  maxLoot: { npc: 3, player: 2 },
  heistTime: 360,                            // s inside before the resident comes home
  alarmTime: 45,                             // s the siren rings
  scoutTime: 4, scoutValid: 600,
  clearDistance: 24, clearSeconds: 6,
  burglarEvery: 240, burglarCooldown: 600,
  marketRefresh: 300, marketSize: 6,
  jobTime: 240, jobPay: [90, 150],
  jamTime: 25, dogSleep: 45,
  guardSpeed: 0.93, patrolSpeed: 0.7, guardCatch: 1.15,
  guardSight: { day: 15, night: 9.5 }, guardCone: 0.72,   // cos(half-angle)
};

export const LOCK_TIME = [2, 6, 12, 22];
export const LOCK_NAMES = ['Latch', 'Deadbolt', 'Reinforced door', 'Smart lock'];
export const LOCK_PRICE = [0, 250, 600, 1200];
export const LOCK_TIER = [1, 1, 2, 3];

/** Security devices are placed by hand, anywhere inside your home. Detection uses the spot you chose. */
export type DeviceKind = 'camera' | 'motion' | 'alarm' | 'dog' | 'safe' | 'decoy';
export interface DeviceDef { name: string; price: number; max: number[]; mount: 'ceiling' | 'floor'; desc: string }
export const DEVICE_DEFS: Record<DeviceKind, DeviceDef> = {
  camera: { name: 'CCTV camera', price: 450, max: [0, 1, 2, 3], mount: 'ceiling', desc: 'Watches a cone. Anyone in view raises the alert.' },
  motion: { name: 'Motion sensor', price: 350, max: [0, 1, 2, 3], mount: 'ceiling', desc: 'Trips on anyone moving within 3 m.' },
  alarm: { name: 'Alarm siren', price: 500, max: [0, 1, 1, 1], mount: 'ceiling', desc: 'Sounds early and tells you at once.' },
  dog: { name: 'Guard dog', price: 650, max: [0, 0, 1, 1], mount: 'floor', desc: 'Barks at anyone who comes close.' },
  safe: { name: 'Safe', price: 800, max: [0, 1, 1, 1], mount: 'floor', desc: 'Holds two valuables. Must be cracked open to steal from.' },
  decoy: { name: 'Decoy valuables', price: 150, max: [0, 1, 2, 3], mount: 'floor', desc: 'Looks like loot. Taking it sets off the alarm.' },
};
export const DEVICE_KINDS = Object.keys(DEVICE_DEFS) as DeviceKind[];
export const REFUND_RATE = 0.7;
export interface Device { id: number; kind: DeviceKind; x: number; z: number; yaw: number }
export const deviceCount = (devs: Device[], k: DeviceKind) => devs.reduce((n, d) => n + (d.kind === k ? 1 : 0), 0);
export const canPlaceDevice = (devs: Device[], kind: DeviceKind, tier: number): { ok: boolean; reason?: string } => {
  const max = DEVICE_DEFS[kind].max[Math.min(3, Math.max(0, tier))];
  if (max === 0) return { ok: false, reason: `${DEVICE_DEFS[kind].name}: needs a better home tier` };
  if (deviceCount(devs, kind) >= max) return { ok: false, reason: `You already have ${max} ${DEVICE_DEFS[kind].name}${max > 1 ? 's' : ''} for this tier` };
  return { ok: true };
};

export const SLOT_COUNT = 7;                 // 0–4 display, 5–6 inside the safe
export const isSafeSlot = (i: number) => i >= 5;
export function slotAvailable(tier: number, hasSafe: boolean, slot: number): boolean {
  if (slot < 0 || slot >= SLOT_COUNT) return false;
  return isSafeSlot(slot) ? hasSafe : slot < R.displaySlots[Math.min(3, Math.max(1, tier))];
}
export const SAFE_CRACK = 10;
export const DEVICE = { cameraRange: 7.5, cameraCos: 0.78, motionRadius: 3.2, dogRadius: 8, dogCrouchRadius: 4 };
export interface Security { lock: number; camera: number; motion: number; alarm: number; dog: number; safe: number; decoy: number }
export const securityOf = (lock: number, devs: Device[]): Security => ({
  lock, camera: deviceCount(devs, 'camera'), motion: deviceCount(devs, 'motion'), alarm: deviceCount(devs, 'alarm'),
  dog: deviceCount(devs, 'dog'), safe: deviceCount(devs, 'safe'), decoy: deviceCount(devs, 'decoy'),
});

export const lockSeconds = (lock: number, lockpicks: boolean, back: boolean) => Math.max(1.5, LOCK_TIME[lock] * (lockpicks ? 0.65 : 1) * (back ? 0.8 : 1));
export const lootSeconds = 1.6;
export const alarmThreshold = (sec: Security) => (sec.alarm ? 60 : 100);

export const sellPrice = (i: ItemInst) => Math.round((ITEM_BY_ID[i.def]?.value ?? 0) * R.sellRate);
export const buyPrice = (defId: string) => Math.round((ITEM_BY_ID[defId]?.value ?? 0) * R.buyMarkup);
export const insurancePayout = (items: ItemInst[]) => Math.round(items.reduce((s, i) => s + (ITEM_BY_ID[i.def]?.value ?? 0), 0) * R.insuranceRate);

export function lockUpgrade(lock: number, tier: number): { ok: boolean; price: number; reason?: string } {
  if (lock >= 3) return { ok: false, price: 0, reason: 'Already the best lock' };
  const next = lock + 1;
  if (tier < LOCK_TIER[next]) return { ok: false, price: LOCK_PRICE[next], reason: `Needs a tier ${LOCK_TIER[next]} home` };
  return { ok: true, price: LOCK_PRICE[next] };
}
export function tierUpgrade(tier: number, rep: number): { ok: boolean; price: number; reason?: string } {
  if (tier >= 3) return { ok: false, price: 0, reason: 'Already the top tier' };
  const next = tier + 1;
  if (rep < R.tierRep[next]) return { ok: false, price: R.tierPrice[next], reason: `Needs ${R.tierRep[next]} reputation` };
  return { ok: true, price: R.tierPrice[next] };
}

export const TITLES = [[0, 'Newcomer'], [10, 'Neighbor'], [30, 'Local'], [70, 'Fixture'], [150, 'Pillar of Maple Street']] as const;
export const repTitle = (rep: number) => [...TITLES].reverse().find(([n]) => rep >= n)![1];

export interface RaidCtx { now: number; ownerOnline: boolean; attackerHome: number; attackerCooldownUntil: number }
export interface RaidHouse { id: number; ownerKind: 'npc' | 'player' | 'vacant'; raidable: boolean; robbedUntil: number; protectedUntil: number }
/** The fairness gate. Everything the blueprint lists under "target eligibility" is checked here, on the server. */
export function canRaid(h: RaidHouse, ctx: RaidCtx): { ok: boolean; reason?: string } {
  if (ctx.attackerHome === h.id) return { ok: false, reason: 'That is your own home' };
  if (ctx.now < ctx.attackerCooldownUntil) return { ok: false, reason: `Lie low for ${Math.ceil(ctx.attackerCooldownUntil - ctx.now)} s` };
  if (h.ownerKind === 'vacant') return { ok: false, reason: 'Nobody lives there' };
  if (ctx.now < h.robbedUntil) return { ok: false, reason: 'Recently burgled; the street is on watch' };
  if (h.ownerKind === 'npc') return { ok: true };
  if (!h.raidable) return { ok: false, reason: 'The owner has not opted in to raids' };
  if (!ctx.ownerOnline) return { ok: false, reason: 'Homes are protected while the owner is away' };
  if (ctx.now < h.protectedUntil) return { ok: false, reason: 'New-resident protection' };
  return { ok: true };
}

export const homeValue = (items: (ItemInst | null)[]) => items.reduce((s, i) => s + (i ? ITEM_BY_ID[i.def]?.value ?? 0 : 0), 0);
export const wealthLabel = (v: number) => (v < 500 ? 'Modest' : v < 1800 ? 'Comfortable' : v < 5000 ? 'Wealthy' : 'Lavish');

/** Chance a burglar is turned away, given the defences and how tempting the house is. */
export function thwartChance(sec: Security, value: number): number {
  const defence = sec.lock + 1.5 * sec.alarm + sec.camera + sec.motion + 1.5 * sec.dog + 0.7 * sec.safe + 0.3 * sec.decoy;
  const temptation = 1 + Math.floor(value / 1500);
  return Math.min(0.92, Math.max(0.1, 0.22 + 0.14 * defence - 0.08 * temptation));
}
