import { APT, type MapDef } from '../shared/map';
import { DEFAULT_LOOK, LOOK_HAIR, LOOK_PANTS, LOOK_SHIRT, LOOK_SKIN, LOOK_STYLES, type Look } from '../shared/protocol';
import { DEFAULT_SETTINGS, type Settings } from './input';

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const hue = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 55% 72%)`; };

export interface PlayerRow { id: string; name: string; me?: boolean }

export class UI {
  root = document.getElementById('ui')!;
  // menu
  private menu = el('div', 'menu');
  private nameIn = el('input');
  private enterBtn = el('button', 'cta', 'Enter Maple Street');
  private status = el('div', 'status');
  private look: Look = { ...DEFAULT_LOOK };
  onEnter: (name: string, look: Look) => void = () => {};
  onLookChange: (look: Look) => void = () => {};
  // hud
  private hud = el('div');
  private profileDot = el('div', 'dot');
  private profileName = el('b');
  private profileSub = el('small');
  private stars = el('div', 'stars');
  private zoneEl = el('div', 'zone');
  private prompt = el('div', 'prompt glass');
  private promptText = el('span');
  private toasts = el('div', 'toasts');
  private cardInfo = el('div', 'card-info glass');
  private chatLog = el('div', 'log');
  chatInput = el('input');
  private chatBox = el('div', 'chat');
  private onlineBox = el('div', 'online glass');
  private onlineList = el('ul');
  private hints = el('div', 'hints glass');
  private clickHint = el('div', 'click-hint glass', 'Click to look around');
  private mm = el('canvas');
  private mmLvl = el('div', 'lvl glass');
  private fps = el('div', 'fps');
  private infoTimer = 0;
  onChatSend: (text: string) => void = () => {};
  onChatClose: () => void = () => {};
  // modals
  private liftModal = el('div', 'modal');
  private pauseModal = el('div', 'modal');
  private minimapBase: HTMLCanvasElement;
  private mmScale = 4;
  chatOpen = false;

  constructor(private map: MapDef) {
    this.root.append(this.menu, this.hud, this.liftModal, this.pauseModal);
    this.buildMenu();
    this.buildHud();
    this.liftModal.hidden = true; this.pauseModal.hidden = true; this.hud.hidden = true;
    this.minimapBase = this.renderMinimapBase();
  }

  // ───────────────────────── menu ─────────────────────────
  private buildMenu() {
    const card = el('div', 'card');
    const brand = el('div', 'brand'); brand.append(el('i'), document.createTextNode('NEIGHBORHOOD'));
    card.append(brand, el('h1', '', 'Maple Street'), el('p', 'sub', 'Block 01 · a living street you can actually walk.'));
    const nf = el('div', 'field'); nf.append(el('label', '', 'Your name'));
    this.nameIn.type = 'text'; this.nameIn.maxLength = 14; this.nameIn.autocomplete = 'off'; this.nameIn.spellcheck = false;
    nf.append(this.nameIn);
    card.append(nf);
    const sw = (label: string, colors: number[], key: keyof Look) => {
      const f = el('div', 'field'); f.append(el('label', '', label));
      const row = el('div', 'sw');
      colors.forEach((c, i) => {
        const b = el('button'); b.style.background = hex(c); b.title = `${label} ${i + 1}`; b.setAttribute('aria-label', `${label} ${i + 1}`);
        b.onclick = () => { this.look[key] = i; this.syncLook(); this.onLookChange(this.look); };
        row.append(b);
      });
      f.append(row); card.append(f);
      return row;
    };
    const rows = { skin: sw('Skin', LOOK_SKIN, 'skin'), hair: sw('Hair', LOOK_HAIR, 'hair'), shirt: sw('Top', LOOK_SHIRT, 'shirt'), pants: sw('Trousers', LOOK_PANTS, 'pants') };
    const sf = el('div', 'field'); sf.append(el('label', '', 'Style'));
    const seg = el('div', 'seg');
    LOOK_STYLES.forEach((n, i) => { const b = el('button', '', n); b.onclick = () => { this.look.style = i; this.syncLook(); this.onLookChange(this.look); }; seg.append(b); });
    sf.append(seg); card.append(sf);
    this.enterBtn.onclick = () => this.onEnter(this.nameIn.value, this.look);
    this.nameIn.onkeydown = (e) => { if (e.key === 'Enter') this.enterBtn.click(); };
    card.append(this.enterBtn, this.status);
    const c = el('div', 'controls');
    for (const [k, t] of [['WASD', 'move'], ['Shift', 'sprint'], ['Space', 'jump'], ['E', 'interact'], ['Mouse', 'look'], ['Enter', 'chat']] as const) {
      const s = el('span'); s.append(el('kbd', '', k), document.createTextNode(t)); c.append(s);
    }
    card.append(c);
    this.menu.append(card);
    (this as unknown as { rows: unknown }).rows = { rows, seg };
  }
  private syncLook() {
    const { rows, seg } = (this as unknown as { rows: { rows: Record<string, HTMLElement>; seg: HTMLElement } }).rows;
    for (const k of ['skin', 'hair', 'shirt', 'pants'] as const) [...rows[k].children].forEach((b, i) => b.setAttribute('aria-pressed', String(this.look[k] === i)));
    [...seg.children].forEach((b, i) => b.setAttribute('aria-pressed', String(this.look.style === i)));
  }
  showMenu(name: string, look: Look) {
    this.menu.hidden = false; this.hud.hidden = true;
    this.nameIn.value = name; this.look = { ...look }; this.syncLook();
    this.enterBtn.disabled = false; this.enterBtn.textContent = 'Enter Maple Street';
  }
  hideMenu() { this.menu.hidden = true; }
  setStatus(text: string, err = false) { this.status.textContent = text; this.status.className = 'status' + (err ? ' err' : ''); }
  setConnecting(b: boolean) { this.enterBtn.disabled = b; this.enterBtn.textContent = b ? 'Connecting…' : 'Enter Maple Street'; }

  // ───────────────────────── HUD ─────────────────────────
  private buildHud() {
    const prof = el('div', 'profile glass');
    const t = el('div'); t.append(this.profileName, this.profileSub);
    prof.append(this.profileDot, t, this.stars);
    const mini = el('div', 'mini');
    this.mm.width = 352; this.mm.height = 352;
    mini.append(this.mm, this.mmLvl);
    this.onlineBox.append(el('h4', '', 'On the street'), this.onlineList);
    this.promptText.textContent = '';
    const k = el('kbd', '', 'E'); this.prompt.append(k, this.promptText); this.prompt.hidden = true;
    this.chatInput.type = 'text'; this.chatInput.maxLength = 120; this.chatInput.placeholder = 'Say something nice…'; this.chatInput.hidden = true; this.chatInput.autocomplete = 'off';
    this.chatInput.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { const v = this.chatInput.value.trim(); if (v) this.onChatSend(v); this.closeChat(); }
      else if (e.key === 'Escape') this.closeChat();
    };
    this.chatBox.append(this.chatLog, this.chatInput);
    for (const [kk, tt] of [['WASD', 'move'], ['Shift', 'sprint'], ['Space', 'jump'], ['E', 'interact'], ['1', 'wave'], ['2', 'dance'], ['Enter', 'chat'], ['Esc', 'menu']] as const) {
      const s = el('span'); s.append(el('kbd', '', kk), document.createTextNode(tt)); this.hints.append(s);
    }
    this.cardInfo.hidden = true; this.clickHint.hidden = true;
    this.hud.append(prof, this.zoneEl, mini, this.onlineBox, this.fps, this.prompt, this.toasts, this.cardInfo, this.chatBox, this.hints, this.clickHint);
  }
  showHud(name: string, look: Look) {
    this.hud.hidden = false;
    this.profileDot.style.background = hex(LOOK_SHIRT[look.shirt]);
    this.profileDot.textContent = name.slice(0, 1).toUpperCase();
    this.profileName.textContent = name;
    this.hints.style.opacity = '1';
    setTimeout(() => (this.hints.style.opacity = '0'), 22000);
  }
  setZone(text: string) { this.zoneEl.textContent = text; }
  setPlace(sub: string) { this.profileSub.textContent = sub; }
  setStars(c: number, t: number) { this.stars.textContent = `★ ${c}/${t}`; }
  setClickHint(show: boolean) { this.clickHint.hidden = !show; }
  setFps(text: string) { this.fps.textContent = text; }
  setPrompt(label: string | null, x = 0, y = 0) {
    if (!label) { this.prompt.hidden = true; return; }
    this.prompt.hidden = false;
    if (this.promptText.textContent !== label) this.promptText.textContent = label;
    this.prompt.style.left = `${x}px`; this.prompt.style.top = `${y}px`;
  }
  toast(text: string, kind: '' | 'found' = '', sub = '', ms = 3200) {
    const t = el('div', 'toast glass' + (kind ? ' ' + kind : ''), text);
    if (sub) t.append(el('small', '', sub));
    this.toasts.append(t);
    while (this.toasts.children.length > 3) this.toasts.firstElementChild!.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 450); }, ms);
  }
  info(title: string, text: string) {
    this.cardInfo.replaceChildren(el('b', '', title), document.createTextNode(text));
    this.cardInfo.hidden = false;
    clearTimeout(this.infoTimer);
    this.infoTimer = window.setTimeout(() => (this.cardInfo.hidden = true), 7000);
  }
  setOnline(rows: PlayerRow[]) {
    this.onlineList.replaceChildren(...rows.map((r) => { const li = el('li', r.me ? 'me' : '', r.me ? `${r.name} (you)` : r.name); return li; }));
  }

  // ───────────────────────── chat ─────────────────────────
  chatLine(name: string, text: string) {
    const l = el('div', 'line'); const b = el('b', '', name); b.style.color = hue(name);
    l.append(b, document.createTextNode(text));
    this.chatLog.append(l);
    while (this.chatLog.children.length > 7) this.chatLog.firstElementChild!.remove();
    setTimeout(() => { if (!this.chatOpen) l.style.opacity = '0'; }, 9000);
    setTimeout(() => l.remove(), 14000);
  }
  openChat() { this.chatOpen = true; this.chatInput.hidden = false; this.chatInput.value = ''; this.chatInput.focus(); for (const l of this.chatLog.children) (l as HTMLElement).style.opacity = '1'; }
  closeChat() { this.chatOpen = false; this.chatInput.hidden = true; this.chatInput.blur(); this.onChatClose(); }

  // ───────────────────────── lift panel ─────────────────────────
  showLift(names: string[], current: number, onPick: (f: number) => void, onClose: () => void) {
    const p = el('div', 'panel');
    p.append(el('h2', '', 'Maple Court Lift'), el('p', '', 'Pick a floor. Press its number, or Esc to step back.'));
    const f = el('div', 'floors');
    const labels = ['Lobby · Residents’ lounge', 'Unit 1B open for viewing', 'Apartments', 'Apartments · stairs to the roof'];
    for (let i = names.length - 1; i >= 0; i--) {
      const b = el('button', i === current ? 'cur' : ''); b.append(el('b', '', names[i]), document.createTextNode(i === 0 ? 'Ground floor' : `Floor ${names[i]}`), el('small', '', labels[i] ?? ''));
      b.onclick = () => onPick(i);
      f.append(b);
    }
    p.append(f);
    const btns = el('div', 'btns'); const c = el('button', 'btn', 'Close'); c.onclick = onClose; btns.append(c); p.append(btns);
    this.liftModal.replaceChildren(p);
    this.liftModal.hidden = false;
    this.liftModal.onclick = (e) => { if (e.target === this.liftModal) onClose(); };
  }
  hideLift() { this.liftModal.hidden = true; }
  get liftOpen() { return !this.liftModal.hidden; }

  // ───────────────────────── pause / settings ─────────────────────────
  showPause(s: Settings, h: { change: (s: Settings) => void; resume: () => void; leave: () => void }) {
    const p = el('div', 'panel');
    p.append(el('h2', '', 'Paused'), el('p', '', 'The street keeps going while you’re here.'));
    const row = (label: string, ctl: HTMLElement) => { const r = el('div', 'row'); r.append(el('span', '', label), ctl); p.append(r); };
    const range = (v: number, min: number, max: number, step: number, on: (v: number) => void) => { const i = el('input'); i.type = 'range'; i.min = String(min); i.max = String(max); i.step = String(step); i.value = String(v); i.oninput = () => on(Number(i.value)); return i; };
    const check = (v: boolean, on: (v: boolean) => void) => { const i = el('input'); i.type = 'checkbox'; i.checked = v; i.onchange = () => on(i.checked); return i; };
    const cur = { ...s };
    const upd = () => h.change({ ...cur });
    row('Mouse sensitivity', range(cur.sens, 0.3, 2.5, 0.05, (v) => { cur.sens = v; upd(); }));
    row('Invert Y', check(cur.invertY, (v) => { cur.invertY = v; upd(); }));
    row('Camera distance', range(cur.zoom, 2.2, 8, 0.1, (v) => { cur.zoom = v; upd(); }));
    row('Volume', range(cur.volume, 0, 1, 0.05, (v) => { cur.volume = v; upd(); }));
    row('Mute', check(cur.muted, (v) => { cur.muted = v; upd(); }));
    const q = el('select'); for (const [v, t] of [['high', 'High (shadows)'], ['low', 'Low (faster)']] as const) { const o = el('option', '', t); o.value = v; q.append(o); }
    q.value = cur.quality; q.onchange = () => { cur.quality = q.value as Settings['quality']; upd(); };
    row('Graphics', q);
    const help = el('div', 'help');
    for (const [k, t] of [['WASD', 'move'], ['Shift', 'sprint'], ['Space', 'jump'], ['E', 'interact'], ['Mouse', 'look · wheel zooms'], ['1 / 2', 'wave / dance'], ['Enter', 'chat'], ['Esc', 'this menu']] as const) { const s2 = el('span'); s2.append(el('kbd', '', k), document.createTextNode(t)); help.append(s2); }
    p.append(help);
    const btns = el('div', 'btns');
    const leave = el('button', 'btn', 'Leave'); leave.onclick = h.leave;
    const res = el('button', 'btn primary', 'Resume'); res.onclick = h.resume;
    btns.append(leave, res); p.append(btns);
    this.pauseModal.replaceChildren(p);
    this.pauseModal.hidden = false;
  }
  hidePause() { this.pauseModal.hidden = true; }
  get pauseOpen() { return !this.pauseModal.hidden; }

  // ───────────────────────── minimap ─────────────────────────
  private renderMinimapBase() {
    const b = this.map.bounds, S = this.mmScale;
    const c = document.createElement('canvas'); c.width = Math.ceil((b.x1 - b.x0) * S); c.height = Math.ceil((b.z1 - b.z0) * S);
    const ctx = c.getContext('2d')!;
    const rank = { green: 0, road: 1, path: 2, water: 3, building: 4 } as const;
    const colors: Record<string, string> = { green: '#c5d8b6', road: '#9a9d9f', path: '#e6dfcc', water: '#9cc3d9' };
    ctx.fillStyle = '#c5d8b6'; ctx.fillRect(0, 0, c.width, c.height);
    for (const r of [...this.map.mapRects].sort((a, z) => rank[a.kind] - rank[z.kind])) {
      if (r.kind === 'green' && r.x1 - r.x0 > 100) continue;
      ctx.fillStyle = r.kind === 'building' ? hex(r.color) : colors[r.kind];
      ctx.fillRect((r.x0 - b.x0) * S, (r.z0 - b.z0) * S, (r.x1 - r.x0) * S, (r.z1 - r.z0) * S);
      if (r.kind === 'building') { ctx.strokeStyle = 'rgba(47,50,54,.35)'; ctx.lineWidth = 1.5; ctx.strokeRect((r.x0 - b.x0) * S, (r.z0 - b.z0) * S, (r.x1 - r.x0) * S, (r.z1 - r.z0) * S); }
    }
    return c;
  }
  drawMinimap(me: { x: number; z: number; yaw: number; y: number }, others: { x: number; z: number }[], levelLabel: string) {
    const ctx = this.mm.getContext('2d')!, W = this.mm.width, S = this.mmScale, b = this.map.bounds;
    const span = 62, px = (me.x - b.x0) * S, pz = (me.z - b.z0) * S, half = (span / 2) * S;
    ctx.save();
    ctx.fillStyle = '#c5d8b6'; ctx.fillRect(0, 0, W, W);
    ctx.drawImage(this.minimapBase, px - half, pz - half, half * 2, half * 2, 0, 0, W, W);
    const k = W / (half * 2);
    for (const o of others) {
      const x = ((o.x - b.x0) * S - (px - half)) * k, y = ((o.z - b.z0) * S - (pz - half)) * k;
      ctx.fillStyle = '#c7714e'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, 6.283); ctx.fill(); ctx.stroke();
    }
    ctx.translate(W / 2, W / 2); ctx.rotate(Math.PI - me.yaw);
    ctx.fillStyle = '#2f3236'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(0, -17); ctx.lineTo(12, 13); ctx.lineTo(0, 7); ctx.lineTo(-12, 13); ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.restore();
    this.mmLvl.textContent = levelLabel; this.mmLvl.hidden = !levelLabel;
  }
}
export { DEFAULT_SETTINGS, APT };
