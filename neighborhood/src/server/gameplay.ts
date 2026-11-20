import { TAG_GLASS } from '../shared/collision';
import { INTERACT_SERVER_RANGE } from '../shared/consts';
import { FOUND_ITEMS, ITEMS, ITEM_BY_ID, TOOLS, TOOL_BY_ID, itemValue, type ItemInst } from '../shared/game/items';
import {
  DEVICE, DEVICE_DEFS, DEVICE_KINDS, LOCK_NAMES, R, REFUND_RATE, SAFE_CRACK, alarmThreshold, buyPrice, canPlaceDevice, canRaid, homeValue, insurancePayout,
  isSafeSlot, lockSeconds, lockUpgrade, lootSeconds, repTitle, securityOf, sellPrice, slotAvailable, thwartChance, tierUpgrade, wealthLabel, type DeviceKind,
} from '../shared/game/rules';
import {
  newPlayerGame, type GameDto, type HeistDto, type HomePub, type HouseState, type HouseView, type PlayerGame, type ScoutInfo,
} from '../shared/game/types';
import type { DoorDef, HouseDef } from '../shared/map';
import type { C2S } from '../shared/protocol';
import type { GameWorld, SPlayer } from './game';
import { Guards } from './guards';

type Act = Extract<C2S, { t: 'act' }>;
interface Channel { kind: 'pick' | 'loot' | 'crack' | 'scout'; label: string; target: number; total: number; done: number; x: number; z: number; extra?: number }
export interface Heist {
  house: number; phase: 'approach' | 'inside'; startedAt: number; insideAt: number; alert: number; quiet: number; alarm: number; alarmed: boolean;
  carrying: ItemInst[]; jam: number; channel: Channel | null; clear: number; softsoles: boolean; cracked: boolean; timedOut: boolean; barkAt: number;
}
interface Note { kind: 'ok' | 'bad' | 'info'; text: string }

const rectHas = (x: number, z: number, r: { x0: number; z0: number; x1: number; z1: number }, pad = 0) => x > r.x0 + pad && x < r.x1 - pad && z > r.z0 + pad && z < r.z1 - pad;
const dist2 = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);
export const WATCH_STATION = { x: 42, z: 8.0 };

/** Preset NPC households: the raid targets. Slots 0–4 on display, 5–6 inside the safe. */
const NPC_PRESETS: Record<number, { tier: number; lock: number; devices: DeviceKind[]; items: (string | null)[] }> = {
  4: { tier: 1, lock: 1, devices: [], items: ['silver_ring', 'figurine', 'old_phone', null, null, null, null] },
  5: { tier: 1, lock: 1, devices: ['motion'], items: ['cash_bundle', 'instant_camera', 'figurine', null, null, null, null] },
  6: { tier: 2, lock: 2, devices: ['alarm'], items: ['pearl_necklace', 'steel_watch', 'retro_console', 'trading_card', null, null, null] },
  7: { tier: 2, lock: 2, devices: ['camera', 'dog'], items: ['watercolor', 'coin_set', 'trophy', 'handbag', null, null, null] },
  8: { tier: 3, lock: 3, devices: ['camera', 'motion', 'alarm', 'safe'], items: ['gold_bracelet', 'first_comic', 'studio_drone', 'bronze_sculpture', 'trading_card', 'diamond_choker', 'gold_watch'] },
  9: { tier: 3, lock: 3, devices: ['camera', 'camera', 'motion', 'alarm', 'dog', 'safe'], items: ['oil_landscape', 'vinyl_test', 'retro_console', 'pearl_necklace', 'steel_watch', 'maple_diamond', 'gold_bracelet'] },
};
const NPC_NAMES: Record<number, string> = {};

export class Gameplay {
  houses: HouseState[] = [];
  games = new Map<string, PlayerGame>();
  heists = new Map<string, Heist>();
  scouts = new Map<string, Record<number, ScoutInfo>>();
  guards!: Guards;
  creatingNpc = false;
  private uid = 1;
  private t = 0;                              // simulated seconds
  private notes = new Map<string, Note[]>();
  private dirty = new Set<string>();
  private lastFlush = 0;
  private burglarTimer = 0;
  private houseDirty = false;
  private houseSaveAt = 0;
  private dogAsleep = new Map<string, number>();   // `${house}:${deviceId}` → sim time until asleep
  private rng = Math.random;

  constructor(private w: GameWorld) {
    const saved = w.store.houses as { houses?: HouseState[]; uid?: number } | undefined;
    const defs = w.map.houses;
    this.houses = defs.map((d) => saved?.houses?.[d.id] ?? this.initialHouse(d));
    this.uid = Math.max(this.uid, saved?.uid ?? 1);
    for (const d of defs) NPC_NAMES[d.id] = d.npcName;
  }
  /** Spawns the Watch. Called once the world is fully constructed. */
  start() { this.creatingNpc = true; this.guards = new Guards(this.w, this); this.creatingNpc = false; }
  setRandom(fn: () => number) { this.rng = fn; }
  now() { return this.w.epoch(); }
  def(id: number): HouseDef { return this.w.map.houses[id]; }

  // ───────────────────────── initial world ─────────────────────────
  private initialHouse(d: HouseDef): HouseState {
    const base: HouseState = {
      id: d.id, ownerKind: 'vacant', ownerId: '', ownerName: '', tier: 1, lock: 1, devices: [], nextDev: 1, slots: Array(7).fill(null),
      open: false, raidable: false, robbedUntil: 0, protectedUntil: 0, lastBurglary: 0, restockAt: 0,
    };
    const pre = NPC_PRESETS[d.id];
    if (!pre) return base;
    base.ownerKind = 'npc'; base.ownerName = d.npcName; base.ownerId = `npc-${d.id}`;
    this.fillNpc(base, d, pre);
    return base;
  }
  private fillNpc(h: HouseState, d: HouseDef, pre = NPC_PRESETS[h.id]) {
    h.tier = pre.tier; h.lock = pre.lock; h.devices = []; h.nextDev = 1;
    let cams = 0;
    for (const k of pre.devices) {
      const a = d.anchors;
      const spot = k === 'camera' ? (cams++ === 0 ? { ...a.camera } : { x: a.decoy.x + 1.2, z: a.decoy.z + 0.4, yaw: a.camera.yaw }) : k === 'dog' ? a.dog : k === 'safe' ? a.safe : k === 'alarm' ? { ...a.alarm, yaw: 0 } : { ...a.motion, yaw: 0 };
      h.devices.push({ id: h.nextDev++, kind: k, x: spot.x, z: spot.z, yaw: (spot as { yaw?: number }).yaw ?? 0 });
    }
    h.slots = pre.items.map((id) => (id ? { uid: this.uid++, def: id } : null));
  }
  private saveHouses() { this.w.store.setHouses({ houses: this.houses, uid: this.uid }); this.houseDirty = false; }
  private touchHouses() { this.houseDirty = true; }

  // ───────────────────────── players ─────────────────────────
  gameOf(id: string) { return this.games.get(id); }
  onJoin(p: SPlayer) {
    if (this.creatingNpc) return;
    const rec = this.w.store.player(p.id);
    const g = rec?.game ?? newPlayerGame(R.startCash);
    if (!rec?.game) { g.inv.push({ uid: this.uid++, def: 'silver_ring' }, { uid: this.uid++, def: 'figurine' }); this.touchHouses(); }
    if (g.home >= 0 && this.houses[g.home]?.ownerId !== p.id) g.home = -1;
    this.games.set(p.id, g);
    this.note(p, 'info', `Welcome to Maple Street. You have $${g.cash.toLocaleString()}.`);
    this.dirty.add(p.id);
    const unseen = g.log.length - g.seenLog;
    if (unseen > 0) this.note(p, 'info', `While you were away: ${unseen} security event${unseen > 1 ? 's' : ''}. Check your phone.`);
  }
  onLeave(p: SPlayer) {
    const h = this.heists.get(p.id);
    if (h) this.endHeist(p, h, 'left');
    this.games.delete(p.id);
    this.scouts.delete(p.id);
    this.notes.delete(p.id);
  }
  private g(p: SPlayer) { return this.games.get(p.id); }
  private note(p: SPlayer, kind: Note['kind'], text: string) {
    const a = this.notes.get(p.id) ?? [];
    a.push({ kind, text }); this.notes.set(p.id, a); this.dirty.add(p.id);
  }
  private noteById(id: string, kind: Note['kind'], text: string) { const p = this.w.players.get(id); if (p) this.note(p, kind, text); }
  private log(g: PlayerGame, kind: 'burglar' | 'thwart' | 'heist' | 'info', text: string) {
    g.log.push({ t: this.now(), kind, text });
    if (g.log.length > 30) { g.log.shift(); g.seenLog = Math.max(0, g.seenLog - 1); }
  }
  private myHouse(p: SPlayer): HouseState | null { const g = this.g(p); return g && g.home >= 0 ? this.houses[g.home] : null; }
  private near(p: SPlayer, x: number, z: number, r: number) { return dist2(p.body.x, p.body.z, x, z) <= r; }
  private insideHouse(p: SPlayer, id: number, pad = 0) { const d = this.def(id); return rectHas(p.body.x, p.body.z, d.fp, pad) && Math.abs(p.body.y - d.floorY) < 1.5; }
  houseAt(p: SPlayer): number { for (const d of this.w.map.houses) if (this.insideHouse(p, d.id)) return d.id; return -1; }
  private interactablePos(kind: 'market' | 'fence' | 'board') { return this.w.map.interactables.find((i) => i.kind === kind); }
  private nearKiosk(p: SPlayer, kind: 'market' | 'fence' | 'board') { const it = this.interactablePos(kind); return !!it && Math.hypot(p.body.x - it.x, p.body.z - it.z) < 4.2; }

  // ───────────────────────── door access (called by GameWorld) ─────────────────────────
  canOpenDoor(p: SPlayer, d: DoorDef): boolean {
    if (d.house === undefined || d.role === 'inner' || d.house < 0) return true;
    const h = this.houses[d.house];
    return h.ownerId === p.id || h.open || h.ownerKind === 'vacant';
  }
  /** A locked house door was used. With an active heist against that house this starts lock-picking. */
  onLockedDoor(p: SPlayer, d: DoorDef) {
    const hs = this.heists.get(p.id);
    const house = this.houses[d.house!];
    if (!hs || hs.house !== d.house) { this.note(p, 'info', house.ownerKind === 'vacant' ? 'Nobody lives here.' : 'Locked. Ask the owner, or plan a heist from the porch.'); return; }
    if (hs.channel) return;
    const g = this.g(p)!;
    const secs = lockSeconds(house.lock, (g.tools.lockpicks ?? 0) > 0, d.role === 'back');
    hs.channel = { kind: 'pick', label: `Picking the ${LOCK_NAMES[house.lock].toLowerCase()}`, target: d.id, total: secs, done: 0, x: p.body.x, z: p.body.z };
    this.w.broadcast({ t: 'evt', k: 'pick', x: d.cx, y: d.y0, z: d.cz });
  }
  onFound(p: SPlayer, foundId: number) {
    const g = this.g(p); const def = FOUND_ITEMS[foundId];
    if (!g || !def) return;
    g.inv.push({ uid: this.uid++, def }); g.rep += 5;
    this.note(p, 'ok', `${ITEM_BY_ID[def].name} added to your collection (+5 reputation)`);
    this.dirty.add(p.id);
  }

  // ───────────────────────── client actions ─────────────────────────
  onAct(p: SPlayer, m: Act) {
    const g = this.g(p); if (!g) return;
    const n = (k: string) => (typeof m[k] === 'number' && Number.isFinite(m[k] as number) ? (m[k] as number) : NaN);
    switch (m.a) {
      case 'buy_home': return this.buyHome(p, g, n('house'));
      case 'upgrade_tier': return this.upgradeTier(p, g);
      case 'upgrade_lock': return this.upgradeLock(p, g);
      case 'place_device': return this.placeDevice(p, g, String(m.kind) as DeviceKind, n('x'), n('z'), n('yaw'));
      case 'pickup_device': return this.pickupDevice(p, g, n('id'));
      case 'place_item': return this.placeItem(p, g, n('slot'), n('uid'));
      case 'take_item': return this.takeItem(p, g, n('slot'));
      case 'set_flag': return this.setFlag(p, g, String(m.flag), !!m.v);
      case 'sell': return this.sell(p, g, n('uid'), m.where === 'fence' ? 'fence' : 'market');
      case 'buy_item': return this.buyItem(p, g, n('i'));
      case 'buy_tool': return this.buyTool(p, g, String(m.tool));
      case 'job_take': return this.jobTake(p, g);
      case 'job_deliver': return this.jobDeliver(p, g);
      case 'scout': return this.scout(p, g, n('house'));
      case 'heist_start': return this.heistStart(p, g, n('house'));
      case 'heist_abort': { const h = this.heists.get(p.id); if (h) this.endHeist(p, h, 'abort'); return; }
      case 'loot': return this.loot(p, n('slot'));
      case 'loot_decoy': return this.lootDecoy(p, n('id'));
      case 'use_jammer': return this.useJammer(p, g);
      case 'use_treats': return this.useTreats(p, g);
      case 'report': return this.report(p, g, String(m.target));
      case 'cancel': { const h = this.heists.get(p.id); if (h?.channel) { h.channel = null; this.dirty.add(p.id); } return; }
      case 'seen_log': g.seenLog = g.log.length; this.dirty.add(p.id); return;
    }
  }

  private buyHome(p: SPlayer, g: PlayerGame, id: number) {
    const h = this.houses[id];
    if (!h || h.ownerKind !== 'vacant') return this.note(p, 'bad', 'That home is not for sale.');
    if (g.home >= 0) return this.note(p, 'bad', 'You already own a home.');
    if (!this.near(p, this.def(id).front.x, this.def(id).front.z, 12)) return this.note(p, 'bad', 'Go to the house first.');
    if (g.cash < R.homePrice) return this.note(p, 'bad', `You need $${R.homePrice.toLocaleString()}.`);
    g.cash -= R.homePrice; g.home = id;
    Object.assign(h, { ownerKind: 'player', ownerId: p.id, ownerName: p.name, tier: 1, lock: 1, devices: [], nextDev: 1, slots: Array(7).fill(null), open: false, raidable: false, protectedUntil: this.now() + R.newbieProtection, robbedUntil: 0 });
    this.touchHouses(); this.note(p, 'ok', `You own No. ${this.def(id).number}. Walk in and make it yours.`); this.cash(p);
    this.dirty.add(p.id);
  }
  private upgradeTier(p: SPlayer, g: PlayerGame) {
    const h = this.myHouse(p); if (!h) return this.note(p, 'bad', 'Buy a home first.');
    const u = tierUpgrade(h.tier, g.rep);
    if (!u.ok) return this.note(p, 'bad', u.reason ?? 'Cannot upgrade.');
    if (g.cash < u.price) return this.note(p, 'bad', `You need $${u.price.toLocaleString()}.`);
    g.cash -= u.price; h.tier++; this.touchHouses(); this.cash(p);
    this.note(p, 'ok', `Home upgraded to tier ${h.tier}. More display space and better security options.`); this.dirty.add(p.id);
  }
  private upgradeLock(p: SPlayer, g: PlayerGame) {
    const h = this.myHouse(p); if (!h) return;
    const u = lockUpgrade(h.lock, h.tier);
    if (!u.ok) return this.note(p, 'bad', u.reason ?? 'Cannot upgrade.');
    if (g.cash < u.price) return this.note(p, 'bad', `You need $${u.price.toLocaleString()}.`);
    g.cash -= u.price; h.lock++; this.touchHouses(); this.cash(p);
    this.note(p, 'ok', `Door fitted with a ${LOCK_NAMES[h.lock].toLowerCase()}.`); this.dirty.add(p.id);
  }
  private placeDevice(p: SPlayer, g: PlayerGame, kind: DeviceKind, x: number, z: number, yaw: number) {
    const h = this.myHouse(p);
    if (!h || !DEVICE_KINDS.includes(kind) || !Number.isFinite(x + z)) return;
    const d = this.def(h.id);
    if (!this.insideHouse(p, h.id)) return this.note(p, 'bad', 'Go inside your home to place devices.');
    if (!rectHas(x, z, d.fp, 0.45)) return this.note(p, 'bad', 'That spot is outside your home.');
    if (dist2(p.body.x, p.body.z, x, z) > 5.5) return this.note(p, 'bad', 'Too far from where you are standing.');
    const ok = canPlaceDevice(h.devices, kind, h.tier);
    if (!ok.ok) return this.note(p, 'bad', ok.reason ?? 'Cannot place that.');
    const def = DEVICE_DEFS[kind];
    if (g.cash < def.price) return this.note(p, 'bad', `You need $${def.price.toLocaleString()}.`);
    if (def.mount === 'floor') {
      for (const s of this.w.map.world.query(x - 0.32, z - 0.32, x + 0.32, z + 0.32, [])) if (s.maxY > d.floorY + 0.08 && s.minY < d.floorY + 0.9) return this.note(p, 'bad', 'No room there. Pick a clear spot of floor.');
    }
    g.cash -= def.price;
    h.devices.push({ id: h.nextDev++, kind, x, z, yaw: Number.isFinite(yaw) ? yaw : 0 });
    this.touchHouses(); this.cash(p); this.dirty.add(p.id);
    this.note(p, 'ok', `${def.name} installed.`);
  }
  private pickupDevice(p: SPlayer, g: PlayerGame, id: number) {
    const h = this.myHouse(p); if (!h || !this.insideHouse(p, h.id)) return;
    const i = h.devices.findIndex((d) => d.id === id); if (i < 0) return;
    const dev = h.devices[i];
    if (dist2(p.body.x, p.body.z, dev.x, dev.z) > 4) return this.note(p, 'bad', 'Too far away.');
    h.devices.splice(i, 1);
    if (dev.kind === 'safe') for (const s of [5, 6]) if (h.slots[s]) { g.inv.push(h.slots[s]!); h.slots[s] = null; }
    const refund = Math.round(DEVICE_DEFS[dev.kind].price * REFUND_RATE);
    g.cash += refund; this.touchHouses(); this.cash(p); this.dirty.add(p.id);
    this.note(p, 'info', `${DEVICE_DEFS[dev.kind].name} removed. Refunded $${refund}.`);
  }
  private placeItem(p: SPlayer, g: PlayerGame, slot: number, uid: number) {
    const h = this.myHouse(p); if (!h || !this.insideHouse(p, h.id)) return this.note(p, 'bad', 'Be inside your home to arrange it.');
    if (!slotAvailable(h.tier, h.devices.some((d) => d.kind === 'safe'), slot)) return this.note(p, 'bad', 'That slot is not available.');
    if (h.slots[slot]) return this.note(p, 'bad', 'Something is already there.');
    const i = g.inv.findIndex((x) => x.uid === uid); if (i < 0) return;
    h.slots[slot] = g.inv.splice(i, 1)[0];
    this.touchHouses(); this.dirty.add(p.id);
  }
  private takeItem(p: SPlayer, g: PlayerGame, slot: number) {
    const h = this.myHouse(p); if (!h || !this.insideHouse(p, h.id)) return;
    const it = h.slots[slot]; if (!it) return;
    h.slots[slot] = null; g.inv.push(it); this.touchHouses(); this.dirty.add(p.id);
  }
  private setFlag(p: SPlayer, g: PlayerGame, flag: string, v: boolean) {
    const h = this.myHouse(p); if (!h) return;
    if (flag === 'open') h.open = v; else if (flag === 'raidable') h.raidable = v; else return;
    this.touchHouses(); this.dirty.add(p.id);
    this.note(p, 'info', flag === 'open' ? (v ? 'Visitors are welcome.' : 'Your door is locked to visitors.') : v ? 'Your home is open to raids (online only, with loss caps and insurance).' : 'Your home is not open to raids.');
    void g;
  }
  private sell(p: SPlayer, g: PlayerGame, uid: number, where: 'market' | 'fence') {
    if (!this.nearKiosk(p, where)) return this.note(p, 'bad', where === 'fence' ? 'Find the back room behind the Community Hall.' : 'Go to the Maple Market stall.');
    const i = g.inv.findIndex((x) => x.uid === uid); if (i < 0) return;
    const it = g.inv[i];
    if (where === 'market' && it.hot) return this.note(p, 'bad', 'The market will not touch stolen goods. Try the back room.');
    const price = where === 'fence' ? Math.round(itemValue(it) * 0.5) : sellPrice(it);
    g.inv.splice(i, 1); g.cash += price; this.cash(p); this.dirty.add(p.id);
    this.note(p, 'ok', `Sold ${ITEM_BY_ID[it.def].name} for $${price.toLocaleString()}.`);
  }
  marketStock() {
    const bucket = Math.floor(this.now() / R.marketRefresh);
    let s = (bucket * 9301 + 49297) % 233280;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    const pool = ITEMS.filter((i) => i.rarity <= 3 && i.cat !== 'secret' && i.id !== 'maple_diamond');
    const out: { def: string; price: number }[] = [];
    while (out.length < R.marketSize) { const it = pool[Math.floor(rnd() * pool.length)]; if (!out.some((o) => o.def === it.id)) out.push({ def: it.id, price: buyPrice(it.id) }); }
    return { stock: out.sort((a, b) => a.price - b.price), resetIn: Math.max(0, Math.round((bucket + 1) * R.marketRefresh - this.now())) };
  }
  private buyItem(p: SPlayer, g: PlayerGame, i: number) {
    if (!this.nearKiosk(p, 'market')) return this.note(p, 'bad', 'Go to the Maple Market stall.');
    const e = this.marketStock().stock[i]; if (!e) return;
    if (g.cash < e.price) return this.note(p, 'bad', `You need $${e.price.toLocaleString()}.`);
    g.cash -= e.price; g.inv.push({ uid: this.uid++, def: e.def }); this.cash(p); this.dirty.add(p.id);
    this.note(p, 'ok', `Bought ${ITEM_BY_ID[e.def].name}.`);
  }
  private buyTool(p: SPlayer, g: PlayerGame, id: string) {
    const t = TOOL_BY_ID[id]; if (!t) return;
    if (!this.nearKiosk(p, 'market')) return this.note(p, 'bad', 'Tools are sold at the Maple Market.');
    if (g.cash < t.price) return this.note(p, 'bad', `You need $${t.price}.`);
    g.cash -= t.price; g.tools[id] = (g.tools[id] ?? 0) + t.uses; this.cash(p); this.dirty.add(p.id);
    this.note(p, 'ok', `${t.name}: ${g.tools[id]} use${g.tools[id] > 1 ? 's' : ''} left.`);
  }
  private jobTake(p: SPlayer, g: PlayerGame) {
    if (!this.nearKiosk(p, 'board')) return this.note(p, 'bad', 'Jobs are on the Crime Board by the Community Hall.');
    if (g.job) return this.note(p, 'bad', 'Finish your current delivery first.');
    if (this.now() < g.jobReadyAt) return this.note(p, 'info', 'No parcels right now. Check back in a moment.');
    const cands = this.houses.filter((h) => h.ownerKind !== 'vacant' && h.id !== g.home);
    const h = cands[Math.floor(this.rng() * cands.length)];
    const pay = Math.round(R.jobPay[0] + this.rng() * (R.jobPay[1] - R.jobPay[0]));
    g.job = { house: h.id, until: this.now() + R.jobTime, pay };
    this.note(p, 'info', `Parcel for No. ${this.def(h.id).number}. Take it to their door. $${pay} on delivery.`); this.dirty.add(p.id);
  }
  private jobDeliver(p: SPlayer, g: PlayerGame) {
    const j = g.job; if (!j) return;
    if (this.now() > j.until) { g.job = null; this.note(p, 'bad', 'Too late. The parcel was sent back.'); this.dirty.add(p.id); return; }
    const d = this.def(j.house);
    if (!this.near(p, d.front.x, d.front.z, 6)) return this.note(p, 'bad', 'Take it to the right front door.');
    g.cash += j.pay; g.rep += 2; g.stats.deliveries++; g.job = null; g.jobReadyAt = this.now() + 15;
    this.cash(p); this.note(p, 'ok', `Delivered. +$${j.pay}, +2 reputation.`); this.dirty.add(p.id);
  }

  // ───────────────────────── scouting and heists ─────────────────────────
  private scout(p: SPlayer, g: PlayerGame, id: number) {
    const h = this.houses[id]; if (!h || h.ownerKind === 'vacant') return;
    const hs = this.heists.get(p.id);
    const d = this.def(id);
    if (!this.near(p, d.front.x, d.front.z, 14) || this.insideHouse(p, id)) return this.note(p, 'bad', 'Stand outside near the house to case it.');
    if (hs?.channel) return;
    const ch: Channel = { kind: 'scout', label: 'Casing the house', target: id, total: R.scoutTime, done: 0, x: p.body.x, z: p.body.z };
    if (hs) hs.channel = ch; else this.scoutCh.set(p.id, ch);
    void g;
  }
  private scoutCh = new Map<string, Channel>();
  private finishScout(p: SPlayer, id: number) {
    const h = this.houses[id];
    const shown = h.slots.slice(0, 5);
    const inSafe = h.slots[5] || h.slots[6];
    const best = shown.reduce((m, i) => Math.max(m, i ? ITEM_BY_ID[i.def].rarity : -1), inSafe ? 3 : -1);
    const info: ScoutInfo = { sec: securityOf(h.lock, h.devices), items: shown.filter(Boolean).length + (inSafe ? 1 : 0), best, wealth: wealthLabel(homeValue(shown)), until: this.now() + R.scoutValid };
    const m = this.scouts.get(p.id) ?? {}; m[id] = info; this.scouts.set(p.id, m);
    this.note(p, 'ok', `Cased No. ${this.def(id).number}: ${info.items} valuable${info.items === 1 ? '' : 's'}, ${LOCK_NAMES[h.lock].toLowerCase()}.`); this.dirty.add(p.id);
  }
  eligibility(p: SPlayer, id: number) {
    const g = this.g(p)!, h = this.houses[id];
    return canRaid(h, { now: this.now(), ownerOnline: this.w.players.has(h.ownerId), attackerHome: g.home, attackerCooldownUntil: g.cooldownUntil });
  }
  private heistStart(p: SPlayer, g: PlayerGame, id: number) {
    const h = this.houses[id]; if (!h) return;
    if (this.heists.has(p.id)) return this.note(p, 'bad', 'You are already on a job.');
    const e = this.eligibility(p, id);
    if (!e.ok) return this.note(p, 'bad', e.reason ?? 'Not an eligible target.');
    if (this.near(p, this.def(id).front.x, this.def(id).front.z, 40) === false) return this.note(p, 'bad', 'Get closer to the house first.');
    const soft = (g.tools.softsoles ?? 0) > 0;
    if (soft) g.tools.softsoles--;
    const hs: Heist = { house: id, phase: 'approach', startedAt: this.t, insideAt: 0, alert: 0, quiet: 0, alarm: 0, alarmed: false, carrying: [], jam: 0, channel: null, clear: 0, softsoles: soft, cracked: false, timedOut: false, barkAt: 0 };
    this.heists.set(p.id, hs);
    this.note(p, 'info', `Heist on No. ${this.def(id).number}. Get in through the front or back door. Stay quiet.`); this.dirty.add(p.id);
  }
  private loot(p: SPlayer, slot: number) {
    const hs = this.heists.get(p.id); if (!hs || hs.phase !== 'inside' || hs.channel) return;
    const h = this.houses[hs.house], d = this.def(hs.house);
    if (!this.insideHouse(p, hs.house)) return;
    const cap = h.ownerKind === 'player' ? R.maxLoot.player : R.maxLoot.npc;
    if (hs.carrying.length >= cap) return this.note(p, 'bad', 'Your bag is full. Get out while you can.');
    const it = h.slots[slot]; if (!it) return;
    if (isSafeSlot(slot)) {
      const safe = h.devices.find((x) => x.kind === 'safe');
      if (!safe || dist2(p.body.x, p.body.z, safe.x, safe.z) > 2.6) return this.note(p, 'bad', 'Get closer to the safe.');
      if (!hs.cracked) { hs.channel = { kind: 'crack', label: 'Cracking the safe', target: slot, total: SAFE_CRACK, done: 0, x: p.body.x, z: p.body.z }; return; }
    } else {
      const s = d.slots[slot];
      if (!s || dist2(p.body.x, p.body.z, s.x, s.z) > 2.6) return this.note(p, 'bad', 'Get closer.');
    }
    hs.channel = { kind: 'loot', label: `Taking the ${ITEM_BY_ID[it.def].name.toLowerCase()}`, target: slot, total: lootSeconds, done: 0, x: p.body.x, z: p.body.z };
  }
  private lootDecoy(p: SPlayer, id: number) {
    const hs = this.heists.get(p.id); if (!hs || hs.phase !== 'inside') return;
    const h = this.houses[hs.house];
    const i = h.devices.findIndex((x) => x.id === id && x.kind === 'decoy');
    if (i < 0 || dist2(p.body.x, p.body.z, h.devices[i].x, h.devices[i].z) > 2.4) return;
    h.devices.splice(i, 1); this.touchHouses();
    this.note(p, 'bad', 'A decoy. It was wired to the alarm.');
    this.triggerAlarm(p, hs, 'decoy');
  }
  private useJammer(p: SPlayer, g: PlayerGame) {
    const hs = this.heists.get(p.id); if (!hs) return;
    if ((g.tools.jammer ?? 0) <= 0) return this.note(p, 'bad', 'You have no signal jammer.');
    if (hs.jam > this.t) return;
    g.tools.jammer--; hs.jam = this.t + R.jamTime; this.dirty.add(p.id); this.note(p, 'ok', `Jammer on. Cameras and sensors are blind for ${R.jamTime} s.`);
  }
  private useTreats(p: SPlayer, g: PlayerGame) {
    const hs = this.heists.get(p.id); if (!hs) return;
    if ((g.tools.treats ?? 0) <= 0) return this.note(p, 'bad', 'You have no dog treats.');
    const h = this.houses[hs.house];
    const dog = h.devices.find((x) => x.kind === 'dog');
    if (!dog || dist2(p.body.x, p.body.z, dog.x, dog.z) > 10) return this.note(p, 'bad', 'No dog in range.');
    g.tools.treats--; this.dogAsleep.set(`${h.id}:${dog.id}`, this.t + R.dogSleep); this.dirty.add(p.id); this.note(p, 'ok', 'The dog settles down.');
  }
  private report(p: SPlayer, g: PlayerGame, targetId: string) {
    const t = this.w.players.get(targetId), th = this.heists.get(targetId);
    if (!t || !th || t === p) return this.note(p, 'info', 'Nothing to report.');
    if (!(th.carrying.length || th.alarm > 0)) return this.note(p, 'info', 'They have not done anything wrong. Yet.');
    if (dist2(p.body.x, p.body.z, t.body.x, t.body.z) > 20) return this.note(p, 'bad', 'You are too far away to be sure.');
    this.guards.tip(targetId, t.body.x, t.body.z);
    g.rep += 3; this.note(p, 'ok', 'Reported to the Watch. +3 reputation.'); this.dirty.add(p.id);
  }

  triggerAlarm(p: SPlayer, hs: Heist, why: string) {
    if (hs.alarmed) return;
    hs.alarmed = true; hs.alarm = R.alarmTime; hs.alert = 100;
    const d = this.def(hs.house), h = this.houses[hs.house];
    this.w.broadcast({ t: 'evt', k: 'alarm', x: d.front.x, y: d.floorY, z: d.front.z, o: 1 });
    this.guards.dispatch(d.front.x, d.front.z);
    this.note(p, 'bad', why === 'timeout' ? 'The resident is back. Get out!' : 'ALARM! The Watch is on its way. Get out of sight.');
    if (h.ownerKind === 'player') {
      const t = `Alarm at No. ${d.number}: someone is inside.`;
      const og = this.games.get(h.ownerId); if (og) this.log(og, 'burglar', t);
      this.noteById(h.ownerId, 'bad', t);
    }
  }

  private endHeist(p: SPlayer, hs: Heist, how: 'escaped' | 'abort' | 'arrested' | 'left') {
    const g = this.g(p); const h = this.houses[hs.house], d = this.def(hs.house);
    this.heists.delete(p.id); this.scoutCh.delete(p.id);
    this.guards.stand(p.id);
    if (hs.alarm > 0) this.w.broadcast({ t: 'evt', k: 'alarm', x: d.front.x, y: d.floorY, z: d.front.z, o: 0 });
    if (!g) return;
    if (how === 'escaped' && hs.carrying.length) {
      const total = hs.carrying.reduce((s, i) => s + itemValue(i), 0);
      for (const it of hs.carrying) g.inv.push({ ...it, hot: true });
      g.stats.heists++; g.stats.stolen += hs.carrying.length; g.rep += 2 + hs.carrying.filter((i) => ITEM_BY_ID[i.def].rarity >= 3).length * 2;
      h.robbedUntil = this.now() + R.robbedProtection;
      if (h.ownerKind === 'npc') h.restockAt = this.now() + 600;
      if (h.ownerKind === 'player') {
        const pay = insurancePayout(hs.carrying); const og = this.games.get(h.ownerId);
        if (og) { og.cash += pay; this.log(og, 'burglar', `Break-in at No. ${d.number}: lost ${hs.carrying.map((i) => ITEM_BY_ID[i.def].name).join(', ')}. Insurance paid $${pay}.`); }
        this.noteById(h.ownerId, 'bad', `You were burgled! Insurance paid $${pay}.`); this.dirty.add(h.ownerId);
      }
      g.cooldownUntil = this.now() + R.heistCooldown;
      this.note(p, 'ok', `Clean getaway! ${hs.carrying.length} item${hs.carrying.length > 1 ? 's' : ''} worth $${total.toLocaleString()}. Sell them at the back room.`);
      this.touchHouses();
    } else if (how === 'escaped') {
      g.cooldownUntil = this.now() + R.heistCooldown; this.note(p, 'info', 'You got out empty-handed.');
    } else if (how === 'abort') {
      if (hs.phase === 'inside') g.cooldownUntil = this.now() + R.heistCooldown / 2;
      this.returnLoot(h, hs); this.note(p, 'info', 'Heist called off.');
    } else if (how === 'left') this.returnLoot(h, hs);
    this.dirty.add(p.id);
  }
  private returnLoot(h: HouseState, hs: Heist) {
    for (const it of hs.carrying) { const i = h.slots.findIndex((s, k) => !s && k < 5); if (i >= 0) h.slots[i] = it; }
    hs.carrying = []; this.touchHouses();
  }
  arrest(p: SPlayer) {
    const hs = this.heists.get(p.id); const g = this.g(p);
    if (!hs || !g) return;
    const lost = hs.carrying.length;
    this.returnLoot(this.houses[hs.house], hs);
    const fine = Math.min(Math.round(g.cash * R.fine), R.fineMax); g.cash -= fine; g.stats.arrests++;
    g.cooldownUntil = this.now() + R.heistCooldown;
    this.endHeist(p, hs, 'arrested');
    Object.assign(p.body, { x: WATCH_STATION.x, y: 0.12, z: WATCH_STATION.z, vx: 0, vy: 0, vz: 0, grounded: false });
    p.queue.length = 0; p.emote = 0;
    this.w.broadcast({ t: 'evt', k: 'arrest', x: WATCH_STATION.x, y: 0.12, z: WATCH_STATION.z });
    this.note(p, 'bad', `Arrested by the Watch. Fined $${fine}.${lost ? ' The loot went back.' : ''} Lie low for ${R.heistCooldown} s.`);
    this.cash(p); this.dirty.add(p.id);
  }
  private cash(p: SPlayer) { this.w.broadcast({ t: 'evt', k: 'cash', x: p.body.x, y: p.body.y, z: p.body.z }); }

  // ───────────────────────── per-step simulation ─────────────────────────
  tick(dt: number) {
    this.t += dt;
    this.guards.tick(dt);
    for (const [pid, hs] of [...this.heists]) {
      const p = this.w.players.get(pid);
      if (!p) { this.heists.delete(pid); continue; }
      this.tickHeist(p, hs, dt);
    }
    for (const [pid, ch] of [...this.scoutCh]) {
      const p = this.w.players.get(pid); if (!p) { this.scoutCh.delete(pid); continue; }
      if (!this.advance(p, ch, dt)) this.scoutCh.delete(pid);
      else if (ch.done >= ch.total) { this.scoutCh.delete(pid); this.finishScout(p, ch.target); }
    }
    this.burglarTimer += dt;
    if (this.burglarTimer >= R.burglarEvery) { this.burglarTimer = 0; this.runBurglars(); }
    if (Math.floor(this.t * 2) !== Math.floor((this.t - dt) * 2)) this.slowTick();
    this.flush();
  }
  private slowTick() {
    const now = this.now();
    for (const h of this.houses) {
      if (h.ownerKind === 'npc' && h.restockAt && now >= h.restockAt) { this.fillNpc(h, this.def(h.id)); h.restockAt = 0; this.touchHouses(); }
    }
    for (const [pid, g] of this.games) if (g.job && now > g.job.until + 30) { g.job = null; this.dirty.add(pid); }
    if (this.houseDirty && this.t - this.houseSaveAt > 3) { this.houseSaveAt = this.t; this.saveHouses(); }
  }
  /** Returns false if the channel was interrupted. */
  private advance(p: SPlayer, ch: Channel, dt: number): boolean {
    if (dist2(p.body.x, p.body.z, ch.x, ch.z) > 0.7 || p.speed > 0.9) { this.note(p, 'bad', 'You moved. Interrupted.'); const hs = this.heists.get(p.id); if (hs) hs.channel = null; return false; }
    ch.done += dt; this.dirty.add(p.id); return true;
  }
  private tickHeist(p: SPlayer, hs: Heist, dt: number) {
    const g = this.g(p)!, h = this.houses[hs.house], d = this.def(hs.house);
    const b = p.body, inside = this.insideHouse(p, hs.house);
    if (hs.phase === 'approach' && inside) { hs.phase = 'inside'; hs.insideAt = this.t; }
    if (hs.alarm > 0) { hs.alarm = Math.max(0, hs.alarm - dt); if (hs.alarm === 0) this.w.broadcast({ t: 'evt', k: 'alarm', x: d.front.x, y: d.floorY, z: d.front.z, o: 0 }); }
    if (hs.phase === 'inside' && !hs.timedOut && this.t - hs.insideAt > R.heistTime) { hs.timedOut = true; this.triggerAlarm(p, hs, 'timeout'); }

    // channel
    if (hs.channel) {
      const ch = hs.channel;
      if (!this.advance(p, ch, dt)) { hs.channel = null; }
      else if (ch.done >= ch.total) { hs.channel = null; this.completeChannel(p, g, hs, h, ch); }
    }
    // detection
    if (inside || hs.channel?.kind === 'pick') this.detect(p, g, hs, h, dt, inside);
    // getting clear
    const sinceSeen = this.guards.sinceSeen(p.id), chased = this.guards.chasing(p.id);
    const far = dist2(b.x, b.z, d.front.x, d.front.z) > R.clearDistance;
    if (hs.phase === 'inside' && !inside && far && sinceSeen > R.clearSeconds && !chased) hs.clear += dt; else hs.clear = 0;
    if (hs.clear >= R.clearSeconds) this.endHeist(p, hs, 'escaped');
  }
  private completeChannel(p: SPlayer, g: PlayerGame, hs: Heist, h: HouseState, ch: Channel) {
    if (ch.kind === 'pick') {
      const door = this.w.map.doors[ch.target];
      this.w.setDoor(door.id, true, true);
      this.w.broadcast({ t: 'evt', k: 'door', x: door.cx, y: door.y0, z: door.cz, o: 1 });
      if ((g.tools.lockpicks ?? 0) > 0) g.tools.lockpicks--;
      this.note(p, 'ok', 'Click. The door is open.');
    } else if (ch.kind === 'crack') {
      hs.cracked = true; this.note(p, 'ok', 'The safe swings open.');
    } else if (ch.kind === 'loot') {
      const it = h.slots[ch.target];
      if (it) { h.slots[ch.target] = null; hs.carrying.push(it); hs.alert = Math.min(100, hs.alert + 6); this.touchHouses(); this.note(p, 'ok', `Took the ${ITEM_BY_ID[it.def].name}. ${ITEM_BY_ID[it.def].rarity >= 3 ? 'Nice find. ' : ''}Now get out.`); }
    }
    this.dirty.add(p.id);
  }
  private detect(p: SPlayer, g: PlayerGame, hs: Heist, h: HouseState, dt: number, inside: boolean) {
    const b = p.body, jammed = hs.jam > this.t;
    let rate = 0;
    const eye = b.y + 1.35;
    if (inside) {
      for (const dv of h.devices) {
        const dx = b.x - dv.x, dz = b.z - dv.z, dist = Math.hypot(dx, dz);
        if (dv.kind === 'camera' && !jammed && dist < DEVICE.cameraRange) {
          const cos = (dx * Math.sin(dv.yaw) + dz * Math.cos(dv.yaw)) / (dist || 1);
          if (cos > DEVICE.cameraCos) {
            const cy = this.def(h.id).floorY + 2.2;
            const t = this.w.map.world.raycast(dv.x, cy, dv.z, dx / dist, (eye - cy) / dist, dz / dist, dist, 0.02, (s) => (s.tag & TAG_GLASS) !== 0);
            if (t > dist - 0.35) rate += 30;
          }
        } else if (dv.kind === 'motion' && !jammed && dist < DEVICE.motionRadius && p.speed > 0.8) rate += 60;
        else if (dv.kind === 'dog' && (this.dogAsleep.get(`${h.id}:${dv.id}`) ?? 0) < this.t && dist < (p.crouch ? DEVICE.dogCrouchRadius : DEVICE.dogRadius)) {
          rate += 32;
          if (this.t > hs.barkAt) { hs.barkAt = this.t + 1.8; this.w.broadcast({ t: 'evt', k: 'dog', x: dv.x, y: this.def(h.id).floorY, z: dv.z }); }
        }
      }
      if (p.speed > 4.5) rate += 12 * (hs.softsoles ? 0.6 : 1);
    }
    if (hs.channel?.kind === 'pick') rate += 2 + h.lock * 2;
    if (hs.channel?.kind === 'crack') rate += 6;
    if (rate > 0) { hs.alert = Math.min(100, hs.alert + rate * dt); hs.quiet = 0; }
    else { hs.quiet += dt; if (hs.quiet > 1.5) hs.alert = Math.max(0, hs.alert - 6 * dt); }
    if (!hs.alarmed && hs.alert >= alarmThreshold(securityOf(h.lock, h.devices))) this.triggerAlarm(p, hs, 'alert');
    void g;
  }

  /** Burglars test the homes of players: your defences decide, whether you are online or not. */
  private runBurglars() {
    const now = this.now();
    for (const h of this.houses) {
      if (h.ownerKind !== 'player' || now < h.lastBurglary + R.burglarCooldown) continue;
      const items = h.slots.map((s, i) => ({ s, i })).filter((x) => x.s && !isSafeSlot(x.i));
      const value = homeValue(h.slots);
      if (!items.length && !value) continue;
      const g = this.games.get(h.ownerId) ?? this.w.store.player(h.ownerId)?.game;
      if (!g) continue;
      const sec = securityOf(h.lock, h.devices);
      const d = this.def(h.id);
      if (this.rng() < thwartChance(sec, value)) {
        g.stats.thwarted++; g.rep += 3;
        this.log(g, 'thwart', `A burglar tried No. ${d.number} and ${sec.alarm ? 'the alarm scared them off' : sec.dog ? 'the dog saw them off' : sec.camera ? 'the camera spooked them' : 'the lock held'}. +3 reputation.`);
        this.noteById(h.ownerId, 'ok', 'Your security turned a burglar away.');
      } else {
        h.lastBurglary = now;
        const take = items.sort((a, b) => itemValue(b.s!) - itemValue(a.s!)).slice(0, 2);
        if (!take.length) continue;
        const stolen = take.map((x) => x.s!);
        for (const x of take) h.slots[x.i] = null;
        const pay = insurancePayout(stolen); g.cash += pay;
        this.log(g, 'burglar', `Burglars got into No. ${d.number} and took ${stolen.map((i) => ITEM_BY_ID[i.def].name).join(', ')}. Insurance paid $${pay}.`);
        this.noteById(h.ownerId, 'bad', `Burglars hit your home. Insurance paid $${pay}.`);
      }
      this.touchHouses(); this.dirty.add(h.ownerId);
      const og = this.w.players.get(h.ownerId); if (!og) this.w.store.setPlayer(h.ownerId, { ...this.w.store.player(h.ownerId)!, game: g });
    }
  }

  // ───────────────────────── DTO ─────────────────────────
  private flush() {
    if (this.t - this.lastFlush < 0.2) return;
    this.lastFlush = this.t;
    for (const pid of this.heists.keys()) this.dirty.add(pid);
    if (!this.dirty.size) return;
    for (const pid of this.dirty) { const p = this.w.players.get(pid); if (p) p.conn.send({ t: 'game', g: this.dtoFor(p) }); }
    this.dirty.clear();
  }
  markDirty(id: string) { this.dirty.add(id); }
  homePub(p: SPlayer): HomePub[] {
    const now = this.now(), g = this.g(p);
    return this.houses.map((h) => ({
      id: h.id, owner: h.ownerKind, ownerName: h.ownerName, tier: h.tier, price: R.homePrice, open: h.open, raidable: h.raidable && h.ownerKind === 'player',
      robbed: now < h.robbedUntil, mine: g?.home === h.id,
    }));
  }
  dtoFor(p: SPlayer): GameDto {
    const g = this.g(p)!, now = this.now();
    const hs = this.heists.get(p.id) ?? null;
    const at = this.houseAt(p);
    let view: HouseView | null = null;
    if (at >= 0) { const h = this.houses[at]; view = { id: at, slots: h.slots, lock: h.lock, devices: h.devices, tier: h.tier, mine: h.ownerId === p.id }; }
    let heist: HeistDto | null = null;
    if (hs) {
      const h = this.houses[hs.house], ch = hs.channel ?? this.scoutCh.get(p.id) ?? null;
      const dog = h.devices.find((x) => x.kind === 'dog');
      heist = {
        house: hs.house, phase: hs.phase, alert: Math.round(hs.alert), threshold: alarmThreshold(securityOf(h.lock, h.devices)), alarm: Math.ceil(hs.alarm),
        left: hs.phase === 'inside' ? Math.max(0, Math.round(R.heistTime - (this.t - hs.insideAt))) : R.heistTime, carrying: hs.carrying, jam: Math.max(0, Math.ceil(hs.jam - this.t)),
        dogAsleep: dog ? Math.max(0, Math.ceil((this.dogAsleep.get(`${h.id}:${dog.id}`) ?? 0) - this.t)) : 0,
        wanted: hs.alarm > 0 || (hs.carrying.length > 0 && this.guards.sinceSeen(p.id) < 3), spotted: this.guards.sinceSeen(p.id) < 2,
        channel: ch ? { kind: ch.kind, p: Math.min(1, ch.done / ch.total), label: ch.label } : null, clear: Math.round((hs.clear / R.clearSeconds) * 100),
      };
    } else {
      const sc = this.scoutCh.get(p.id);
      if (sc) heist = { house: sc.target, phase: 'approach', alert: 0, threshold: 100, alarm: 0, left: 0, carrying: [], jam: 0, dogAsleep: 0, wanted: false, spotted: false, channel: { kind: 'scout', p: Math.min(1, sc.done / sc.total), label: sc.label }, clear: 0 };
    }
    const scoutAll = this.scouts.get(p.id) ?? {};
    const scout: Record<number, ScoutInfo> = {};
    for (const [k, v] of Object.entries(scoutAll)) if (v.until > now) scout[Number(k)] = v;
    const mk = this.marketStock();
    const notes = this.notes.get(p.id) ?? []; this.notes.delete(p.id);
    return {
      me: {
        cash: g.cash, rep: g.rep, title: repTitle(g.rep), inv: g.inv, tools: g.tools, home: g.home,
        job: g.job ? { house: g.job.house, left: Math.max(0, Math.round(g.job.until - now)), pay: g.job.pay } : null, stats: g.stats,
        cooldown: Math.max(0, Math.ceil(g.cooldownUntil - now)), newbie: g.home >= 0 ? Math.max(0, Math.ceil(this.houses[g.home].protectedUntil - now)) : 0,
        log: g.log.slice(-12), unseen: g.log.length - g.seenLog,
      },
      homes: this.homePub(p), view, scout, heist, market: { stock: mk.stock, resetIn: mk.resetIn }, notes,
    };
  }
  /** Players who are actively wanted: the Watch looks for these. */
  wanted(): SPlayer[] {
    const out: SPlayer[] = [];
    for (const [pid, hs] of this.heists) { const p = this.w.players.get(pid); if (p && (hs.alarm > 0 || hs.carrying.length > 0)) out.push(p); }
    return out;
  }
  heistOf(id: string) { return this.heists.get(id); }
  nowT() { return this.t; }
  // exposed for tests
  _nearRange() { return INTERACT_SERVER_RANGE; }
  _tools() { return TOOLS; }
}
