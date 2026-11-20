import { CAT_NAMES, ITEM_BY_ID, RARITY_COLORS, RARITY_NAMES, TOOLS, type ItemInst } from '../shared/game/items';
import {
  DEVICE_DEFS, DEVICE_KINDS, LOCK_NAMES, R, deviceCount, lockUpgrade, sellPrice, slotAvailable, tierUpgrade, type DeviceKind,
} from '../shared/game/rules';
import type { GameDto, HomePub } from '../shared/game/types';
import type { MapDef } from '../shared/map';

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
const money = (n: number) => '$' + n.toLocaleString();
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
type Child = Node | string | null | undefined | false;
function h(tag: string, cls = '', ...kids: Child[]): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k !== null && k !== undefined && k !== false) e.append(typeof k === 'string' ? document.createTextNode(k) : k);
  return e;
}
function btn(label: string, on: () => void, cls = 'btn', disabled = false, title = ''): HTMLButtonElement {
  const b = h('button', cls, label) as HTMLButtonElement;
  b.type = 'button'; b.disabled = disabled; if (title) b.title = title; b.onclick = on;
  return b;
}
export const SLOT_NAMES = ['Console, left', 'Console, right', 'Kitchen counter', 'Nightstand', 'Side table', 'Safe, shelf 1', 'Safe, shelf 2'];

export interface GameHandlers {
  act(a: string, extra?: Record<string, unknown>): void;
  onPanel(open: boolean): void;
  startPlacement(kind: DeviceKind): void;
  toast(kind: 'ok' | 'bad' | 'info', text: string): void;
}
type Panel = { kind: 'house'; id: number } | { kind: 'manager'; tab: 'display' | 'security' | 'home' } | { kind: 'market'; mode: 'market' | 'fence'; tab: 'buy' | 'tools' | 'sell' } | { kind: 'board' } | { kind: 'phone'; tab: 'profile' | 'items' | 'log' };

export class GameUI {
  g: GameDto | null = null;
  private panel: Panel | null = null;
  private sig = '';
  private modal = h('div', 'modal'); private box = h('div', 'panel wide');
  private wallet = h('div', 'wallet glass'); private heist = h('div', 'heist glass'); private chan = h('div', 'chan glass');
  private vig = h('div', 'vig'); private place = h('div', 'place glass'); private banner = h('div', 'banner glass');
  private pickSel = new Map<number, number>();

  constructor(root: HTMLElement, private map: MapDef, private H: GameHandlers) {
    this.modal.hidden = true; this.modal.append(this.box);
    this.modal.onclick = (e) => { if (e.target === this.modal) this.close(); };
    this.heist.hidden = true; this.chan.hidden = true; this.place.hidden = true; this.banner.hidden = true; this.wallet.hidden = true;
    root.append(this.vig, this.wallet, this.heist, this.chan, this.banner, this.place, this.modal);
  }
  get open() { return !this.modal.hidden; }

  // ───────────────────────── state ─────────────────────────
  update(g: GameDto) {
    this.g = g;
    for (const n of g.notes) this.H.toast(n.kind, n.text);
    this.renderHud();
    if (this.panel) {
      const sig = JSON.stringify([g.me.cash, g.me.inv.map((i) => i.uid), g.me.tools, g.me.job?.house, g.me.home, g.homes, g.view, g.scout, g.market.stock, g.me.log.length, g.me.stats]);
      if (sig !== this.sig) { this.sig = sig; this.render(); }
    }
  }
  close() { if (!this.panel) return; this.panel = null; this.modal.hidden = true; this.H.onPanel(false); }
  private show(p: Panel) {
    const was = !!this.panel; this.panel = p; this.sig = ''; this.modal.hidden = false; this.render(); if (!was) this.H.onPanel(true);
  }
  openHouse(id: number) { this.show({ kind: 'house', id }); }
  openManager(tab: 'display' | 'security' | 'home' = 'display') { this.show({ kind: 'manager', tab }); }
  openMarket(mode: 'market' | 'fence') { this.show({ kind: 'market', mode, tab: mode === 'fence' ? 'sell' : 'buy' }); }
  openBoard() { this.show({ kind: 'board' }); }
  openPhone(tab: 'profile' | 'items' | 'log' = 'profile') { this.show({ kind: 'phone', tab }); if (tab === 'log' || (this.g && this.g.me.unseen > 0)) this.H.act('seen_log'); }
  setPlacing(kind: DeviceKind | null, ok = true, extra = '') {
    this.place.hidden = !kind;
    if (kind) { this.place.className = 'place glass' + (ok ? '' : ' bad'); this.place.replaceChildren(h('b', '', `Placing: ${DEVICE_DEFS[kind].name}`), h('span', '', ` ${extra || (ok ? 'Looks good.' : 'Not here.')}`), h('small', '', 'Walk to aim · Q / R or wheel to turn · E to place · Esc to cancel')); }
  }

  // ───────────────────────── HUD ─────────────────────────
  private renderHud() {
    const g = this.g!, me = g.me, hs = g.heist;
    this.wallet.hidden = false;
    const bits = [h('b', '', money(me.cash)), h('span', '', `★ ${me.rep} ${me.title}`)];
    if (me.job) bits.push(h('span', 'tag', `Parcel → No. ${this.map.houses[me.job.house].number} · ${mmss(me.job.left)} · ${money(me.job.pay)}`));
    if (me.cooldown > 0) bits.push(h('span', 'tag warn', `Lie low ${mmss(me.cooldown)}`));
    if (me.unseen > 0) bits.push(h('span', 'tag info', `${me.unseen} security alert${me.unseen > 1 ? 's' : ''}`));
    this.wallet.replaceChildren(...bits);

    if (hs && hs.job) {
      const d = this.map.houses[hs.house];
      const pct = Math.min(100, hs.alert);
      this.heist.replaceChildren(
        h('div', 'hrow', h('b', '', `HEIST · No. ${d.number}`), h('span', hs.alarm ? 'tag warn' : 'tag', hs.alarm ? `ALARM ${hs.alarm}s` : hs.phase === 'inside' ? `Resident home in ${mmss(hs.left)}` : 'Get inside'),
          h('span', 'tag', `Bag ${hs.carrying.length}`)),
        (() => { const m = h('div', 'meter'); const f = h('i'); f.style.width = `${pct}%`; f.className = pct > 66 ? 'hot' : pct > 33 ? 'warm' : ''; const t = h('u'); t.style.left = `${hs.threshold}%`; m.append(f, t); return m; })(),
        h('div', 'hrow small', h('span', '', `Alert ${pct}`), hs.spotted ? h('span', 'tag warn', 'SPOTTED') : hs.wanted ? h('span', 'tag warn', 'Wanted') : h('span', 'tag', 'Unseen'),
          hs.clear > 0 ? h('span', 'tag info', `Getting clear ${hs.clear}%`) : null),
        h('div', 'hrow small',
          btn(`Jammer ×${g.me.tools.jammer ?? 0} [J]${hs.jam ? ` · ${hs.jam}s` : ''}`, () => this.H.act('use_jammer'), 'chip', !(g.me.tools.jammer ?? 0)),
          btn(`Treats ×${g.me.tools.treats ?? 0} [T]${hs.dogAsleep ? ` · ${hs.dogAsleep}s` : ''}`, () => this.H.act('use_treats'), 'chip', !(g.me.tools.treats ?? 0)),
          btn('Call it off [X]', () => this.H.act('heist_abort'), 'chip')),
      );
      this.heist.hidden = false;
    } else this.heist.hidden = true;
    const ch = hs?.channel;
    this.chan.hidden = !ch;
    if (ch) { const bar = h('div', 'cbar'); const i = h('i'); i.style.width = `${Math.round(ch.p * 100)}%`; bar.append(i); this.chan.replaceChildren(h('span', '', ch.label), bar, h('small', '', 'Stay still')); }
    this.vig.className = 'vig' + (hs?.spotted ? ' spotted' : hs?.wanted ? ' wanted' : '');
  }
  banner$(text: string, ms = 3500) { this.banner.hidden = false; this.banner.textContent = text; setTimeout(() => (this.banner.hidden = true), ms); }

  // ───────────────────────── rendering ─────────────────────────
  private head(title: string, sub = '') { return h('div', 'phead', h('div', '', h('h2', '', title), sub ? h('p', '', sub) : null), btn('Close', () => this.close(), 'btn small')); }
  private tabs(names: [string, string][], cur: string, on: (k: string) => void) {
    const t = h('div', 'tabs'); for (const [k, n] of names) { const b = btn(n, () => on(k), k === cur ? 'tab on' : 'tab'); t.append(b); } return t;
  }
  private itemCard(it: ItemInst, ...extra: Child[]) {
    const d = ITEM_BY_ID[it.def]; const dot = h('i', 'dot'); dot.style.background = hex(RARITY_COLORS[d.rarity]);
    return h('div', 'item', dot, h('div', 'itxt', h('b', '', d.name), h('small', '', `${CAT_NAMES[d.cat]} · ${RARITY_NAMES[d.rarity]}${it.hot ? ' · hot' : ''}`)), h('span', 'val', money(d.value)), ...extra);
  }
  private render() {
    const g = this.g, p = this.panel; if (!g || !p) return;
    const body = p.kind === 'house' ? this.rHouse(p.id) : p.kind === 'manager' ? this.rManager(p.tab) : p.kind === 'market' ? this.rMarket(p) : p.kind === 'board' ? this.rBoard() : this.rPhone(p.tab);
    this.box.replaceChildren(...body);
  }

  private reason(hp: HomePub): string | null {
    const me = this.g!.me;
    if (hp.mine) return 'This is your home.';
    if (hp.owner === 'vacant') return 'Nobody lives here.';
    if (hp.robbed) return 'Recently burgled. The street is on watch.';
    if (me.cooldown > 0) return `Lie low for ${me.cooldown} s.`;
    if (hp.owner === 'player' && !hp.raidable) return 'The owner has not opted in to raids.';
    return null;
  }
  private rHouse(id: number): Node[] {
    const g = this.g!, hp = g.homes[id], d = this.map.houses[id], me = g.me;
    const sub = hp.owner === 'vacant' ? 'For sale' : hp.mine ? 'Your home' : `${hp.ownerName}${hp.owner === 'player' ? ' (neighbour)' : ''}`;
    const out: Node[] = [this.head(`No. ${d.number}`, sub)];
    if (hp.owner === 'vacant') {
      out.push(h('div', 'sec', h('p', '', `A tier 1 home: a living room, kitchen, bedroom and storage, three display shelves. ${money(R.homePrice)}.`),
        btn(`Buy for ${money(R.homePrice)}`, () => this.H.act('buy_home', { house: id }), 'btn primary', me.home >= 0 || me.cash < R.homePrice, me.home >= 0 ? 'You already own a home' : me.cash < R.homePrice ? 'Not enough cash' : ''),
        me.home >= 0 ? h('small', '', 'You already own a home.') : null));
      return out;
    }
    if (hp.mine) {
      out.push(h('div', 'sec', h('p', '', `Tier ${hp.tier} · ${LOCK_NAMES[g.view?.id === id ? g.view.lock : 1]} front door.`), h('div', 'row2', btn('Manage home', () => this.openManager('display'), 'btn primary'), h('small', '', 'Arrange valuables and place security from inside.'))));
      return out;
    }
    if (me.job?.house === id) out.push(h('div', 'sec', h('p', '', `Parcel for this door. ${money(me.job.pay)} on delivery.`), btn('Deliver the parcel', () => this.H.act('job_deliver'), 'btn primary')));
    out.push(h('div', 'sec', h('p', '', hp.open ? 'The owner welcomes visitors. The door is unlocked.' : 'Locked.'), hp.robbed ? h('small', 'warn', 'Recently burgled: the street is on watch.') : null));
    const sc = g.scout[id];
    out.push(h('div', 'sec', h('h3', '', 'Scout'),
      sc ? h('div', 'scout', h('div', '', h('small', '', 'Door'), h('b', '', LOCK_NAMES[Math.min(3, sc.sec.lock)])),
        h('div', '', h('small', '', 'Security'), h('b', '', this.secText(sc.sec))),
        h('div', '', h('small', '', 'Valuables'), h('b', '', `${sc.items} · best: ${sc.best >= 0 ? RARITY_NAMES[sc.best] : 'nothing'}`)),
        h('div', '', h('small', '', 'Lifestyle'), h('b', '', sc.wealth))) : h('p', '', 'You know nothing about this house. Case it from outside: stand still for a few seconds.'),
      btn(sc ? 'Case again' : 'Case the house (4 s)', () => { this.H.act('scout', { house: id }); this.close(); }, 'btn')));
    const why = this.reason(hp);
    out.push(h('div', 'sec', h('h3', '', 'Heist'),
      why ? h('p', 'warn', why) : h('p', '', 'Pick the lock, stay out of sight, take what you can carry, and get clear of the street before the Watch finds you. You can only carry '
        + `${hp.owner === 'player' ? R.maxLoot.player : R.maxLoot.npc} items.`),
      h('div', 'row2', btn('Start the heist', () => { this.H.act('heist_start', { house: id }); this.close(); }, 'btn primary', !!why),
        h('small', '', `Tools: ${TOOLS.map((t) => `${t.name} ×${me.tools[t.id] ?? 0}`).join(' · ')}`))));
    return out;
  }
  private secText(sec: { camera: number; motion: number; alarm: number; dog: number; safe: number }) {
    const a = [sec.camera ? `${sec.camera} camera${sec.camera > 1 ? 's' : ''}` : '', sec.motion ? 'motion sensor' : '', sec.alarm ? 'alarm' : '', sec.dog ? 'dog' : '', sec.safe ? 'safe' : ''].filter(Boolean);
    return a.length ? a.join(', ') : 'None you can see';
  }

  private rManager(tab: 'display' | 'security' | 'home'): Node[] {
    const g = this.g!, me = g.me, v = g.view, hp = g.homes[me.home];
    if (me.home < 0 || !hp) return [this.head('Home'), h('p', '', 'You do not own a home yet. Find a house with a For Sale sign.')];
    const inside = v?.mine;
    const out: Node[] = [this.head(`Your home · No. ${this.map.houses[me.home].number}`, `Tier ${hp.tier}`),
      this.tabs([['display', 'Display'], ['security', 'Security'], ['home', 'Home']], tab, (k) => { (this.panel as Panel & { tab: string }).tab = k; this.sig = ''; this.render(); })];
    if (!inside) out.push(h('p', 'warn', 'Go inside your home to arrange it.'));
    if (tab === 'display') {
      const hasSafe = !!v?.devices.some((d) => d.kind === 'safe');
      const free = me.inv;
      for (let s = 0; s < 7; s++) {
        if (!slotAvailable(hp.tier, hasSafe, s)) { if (s < 5) out.push(h('div', 'slotrow locked', h('span', '', SLOT_NAMES[s]), h('small', '', `Needs tier ${s < 3 ? 1 : s < 4 ? 2 : 3}`))); continue; }
        const it = v?.slots[s];
        const row = h('div', 'slotrow', h('span', '', SLOT_NAMES[s]));
        if (it) row.append(this.itemCard(it), btn('Take', () => this.H.act('take_item', { slot: s }), 'btn small', !inside));
        else {
          const sel = h('select') as HTMLSelectElement; sel.append(new Option('Choose an item…', ''));
          for (const i of free) sel.append(new Option(`${ITEM_BY_ID[i.def].name} (${money(ITEM_BY_ID[i.def].value)})`, String(i.uid)));
          sel.value = String(this.pickSel.get(s) ?? ''); sel.onchange = () => this.pickSel.set(s, Number(sel.value) || 0);
          row.append(sel, btn('Place', () => { const uid = Number(sel.value); if (uid) { this.H.act('place_item', { slot: s, uid }); this.pickSel.delete(s); } }, 'btn small', !inside));
        }
        out.push(row);
      }
      if (!free.length) out.push(h('small', '', 'Nothing in your pockets to display. Buy at the market, or find things around the street.'));
    } else if (tab === 'security') {
      const lu = lockUpgrade(v?.lock ?? 1, hp.tier);
      out.push(h('div', 'slotrow', h('span', '', `Door: ${LOCK_NAMES[v?.lock ?? 1]}`), lu.reason ? h('small', '', lu.reason) : null, btn(lu.ok ? `Upgrade ${money(lu.price)}` : 'Upgrade', () => this.H.act('upgrade_lock'), 'btn small', !lu.ok || me.cash < lu.price)));
      out.push(h('h3', '', 'Devices'), h('p', 'hint', 'You place these by hand. Walk to the spot, aim, and confirm. Cameras and sensors show their reach in red.'));
      for (const k of DEVICE_KINDS) {
        const def = DEVICE_DEFS[k], n = deviceCount(v?.devices ?? [], k), max = def.max[Math.min(3, hp.tier)];
        out.push(h('div', 'slotrow', h('div', 'itxt', h('b', '', `${def.name} · ${n}/${max}`), h('small', '', def.desc)),
          btn(`Place ${money(def.price)}`, () => { this.close(); this.H.startPlacement(k); }, 'btn small', !inside || n >= max || me.cash < def.price, max === 0 ? 'Needs a higher tier' : '')));
      }
      if (v?.devices.length) {
        out.push(h('h3', '', 'Installed'));
        for (const d of v.devices) out.push(h('div', 'slotrow', h('span', '', DEVICE_DEFS[d.kind].name), btn('Remove (70% back)', () => this.H.act('pickup_device', { id: d.id }), 'btn small', !inside)));
      }
    } else {
      const tu = tierUpgrade(hp.tier, me.rep);
      out.push(h('div', 'slotrow', h('div', 'itxt', h('b', '', `Tier ${hp.tier}`), h('small', '', hp.tier >= 3 ? 'The top tier.' : tu.reason ?? 'More display space and better security.')), btn(tu.ok ? `Upgrade ${money(tu.price)}` : 'Upgrade', () => this.H.act('upgrade_tier'), 'btn small', !tu.ok || me.cash < tu.price)));
      const flag = (key: 'open' | 'raidable', label: string, desc: string, on: boolean) => h('label', 'toggle', (() => { const c = h('input') as HTMLInputElement; c.type = 'checkbox'; c.checked = on; c.onchange = () => this.H.act('set_flag', { flag: key, v: c.checked }); return c; })(), h('div', '', h('b', '', label), h('small', '', desc)));
      out.push(flag('open', 'Visitors welcome', 'Unlocks your door so neighbours can come in and look at your collection.', hp.open));
      out.push(flag('raidable', 'Open to raids', 'Other players may try to rob you, but only while you are online. Their haul is capped at two items and you are insured for half the value. Off by default.', hp.raidable));
      out.push(h('p', 'hint', `Protections: new-resident cover for ${mmss(R.newbieProtection)}, a ${mmss(R.robbedProtection)} breather after a robbery, offline homes are never raided, burglars are held off by your devices even when you are away.`));
    }
    return out;
  }

  private rMarket(p: Extract<Panel, { kind: 'market' }>): Node[] {
    const g = this.g!, me = g.me, fence = p.mode === 'fence';
    const out: Node[] = [this.head(fence ? 'The Back Room' : 'Maple Market', fence ? 'No questions. Half of what it is worth.' : `Stock changes in ${mmss(g.market.resetIn)}. Stolen goods are not welcome.`)];
    if (!fence) out.push(this.tabs([['buy', 'Buy'], ['tools', 'Tools'], ['sell', 'Sell']], p.tab, (k) => { p.tab = k as typeof p.tab; this.sig = ''; this.render(); }));
    if (p.tab === 'buy' && !fence) g.market.stock.forEach((s, i) => out.push(h('div', 'slotrow', this.itemCard({ uid: 0, def: s.def }), btn(`Buy ${money(s.price)}`, () => this.H.act('buy_item', { i }), 'btn small', me.cash < s.price))));
    if (p.tab === 'tools' && !fence) for (const t of TOOLS) out.push(h('div', 'slotrow', h('div', 'itxt', h('b', '', `${t.name}${me.tools[t.id] ? ` · you have ${me.tools[t.id]}` : ''}`), h('small', '', t.desc)), btn(`Buy ${money(t.price)}`, () => this.H.act('buy_tool', { tool: t.id }), 'btn small', me.cash < t.price)));
    if (p.tab === 'sell' || fence) {
      const inv = me.inv.filter((i) => fence || !i.hot);
      if (!inv.length) out.push(h('p', '', fence ? 'Nothing to sell.' : 'Nothing the market will take.'));
      for (const it of inv) out.push(h('div', 'slotrow', this.itemCard(it), btn(`Sell ${money(fence ? Math.round(ITEM_BY_ID[it.def].value * 0.5) : sellPrice(it))}`, () => this.H.act('sell', { uid: it.uid, where: p.mode }), 'btn small')));
      if (!fence && me.inv.some((i) => i.hot)) out.push(h('small', 'warn', 'Stolen goods can only be sold in the back room behind the Community Hall.'));
    }
    return out;
  }

  private rBoard(): Node[] {
    const g = this.g!, me = g.me;
    const out: Node[] = [this.head('Crime Board', 'Jobs, leads and notices')];
    out.push(h('div', 'sec', h('h3', '', 'Delivery job'),
      me.job ? h('p', '', `Parcel for No. ${this.map.houses[me.job.house].number}. ${mmss(me.job.left)} left. ${money(me.job.pay)} on delivery.`) : h('p', '', 'Honest work: carry a parcel to a neighbour’s door.'),
      btn(me.job ? 'Job in progress' : 'Take a parcel', () => this.H.act('job_take'), 'btn primary', !!me.job)));
    out.push(h('h3', '', 'Leads'));
    for (const hp of g.homes) {
      if (hp.owner === 'vacant' || hp.mine) continue;
      const d = this.map.houses[hp.id], why = this.reason(hp), sc = g.scout[hp.id];
      out.push(h('div', 'slotrow', h('div', 'itxt', h('b', '', `No. ${d.number} · ${hp.ownerName}`), h('small', '', `${'★'.repeat(hp.tier)}${'☆'.repeat(3 - hp.tier)} tier${sc ? ` · cased: ${sc.items} valuables, ${LOCK_NAMES[Math.min(3, sc.sec.lock)].toLowerCase()}` : ' · not cased'}`)),
        h('span', why ? 'tag warn' : 'tag ok', why ? (hp.robbed ? 'Burgled' : hp.owner === 'player' ? 'Closed' : 'Cooling down') : 'Open target')));
    }
    out.push(h('div', 'sec', h('h3', '', 'Neighborhood Watch'), h('p', '', 'The Watch patrols the pavements. Officers only chase people who are wanted: an alarm is ringing, or they are carrying stolen goods in plain view. Walls and closed doors hide you. Press R near a thief to report them.')));
    return out;
  }

  private rPhone(tab: 'profile' | 'items' | 'log'): Node[] {
    const g = this.g!, me = g.me;
    const out: Node[] = [this.head('Phone', `${me.title} · ★ ${me.rep}`), this.tabs([['profile', 'Profile'], ['items', 'Items'], ['log', `Security log${me.unseen ? ` (${me.unseen})` : ''}`]], tab, (k) => { (this.panel as Extract<Panel, { kind: 'phone' }>).tab = k as typeof tab; this.sig = ''; this.render(); if (k === 'log') this.H.act('seen_log'); })];
    if (tab === 'profile') {
      out.push(h('div', 'stats', ...[['Cash', money(me.cash)], ['Reputation', `${me.rep} · ${me.title}`], ['Heists pulled off', String(me.stats.heists)], ['Items taken', String(me.stats.stolen)], ['Arrests', String(me.stats.arrests)], ['Burglars turned away', String(me.stats.thwarted)], ['Deliveries', String(me.stats.deliveries)], ['Home', me.home >= 0 ? `No. ${this.map.houses[me.home].number} · tier ${g.homes[me.home].tier}` : 'None yet']].map(([a, b]) => h('div', '', h('small', '', a), h('b', '', b)))));
      out.push(h('p', 'hint', 'Keys: WASD move · Shift sprint · C crouch · E interact · Tab this phone · J jammer · T treats · X call off a heist · R report a thief.'));
    } else if (tab === 'items') {
      if (!me.inv.length) out.push(h('p', '', 'Your pockets are empty.'));
      for (const it of me.inv) out.push(this.itemCard(it));
      const tl = TOOLS.filter((t) => me.tools[t.id]); if (tl.length) out.push(h('h3', '', 'Tools'), ...tl.map((t) => h('div', 'slotrow', h('span', '', t.name), h('b', '', `×${me.tools[t.id]}`))));
    } else {
      if (!me.log.length) out.push(h('p', '', 'Quiet so far. Security events at your home will appear here, even while you are away.'));
      for (const l of [...me.log].reverse()) out.push(h('div', `logrow ${l.kind}`, h('small', '', new Date(l.t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })), h('span', '', l.text)));
    }
    return out;
  }
}
