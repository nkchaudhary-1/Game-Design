// Minimal in-battle HUD (build spec: top-left player, top-right opponent, centre status). Everything on it is
// something a player needs in the moment: who is who, spin, Super state, score, why a round ended.
// It only reads the Match; the controls live on the pad.

import * as THREE from 'three';
import type { Match } from '../combat/Match';
import type { MatchResult, SimEvent } from '../combat/events';
import { CRYSTAL_INFO, CRYSTAL_KINDS } from '../arenas/hazards';
import { TEAM_COLORS } from '../render/BattleView';
import { TUNING } from '../core/Balance';
import { chipFor, cpuVoice, moveInfo, superInfo, YOU, type PowerInfo, type StatusChip } from '../blades/powerText';
import { CLASS_COLORS, clamp } from '../core/types';
import { h } from './dom';

export interface Score { you: number; cpu: number; draws: number }

export interface HudOptions {
  match: Match;
  names: [string, string];
  score: Score;
  camera: () => THREE.Camera;
  /** World position to hang a floating tag on, per slot. */
  anchor: (slot: number) => THREE.Vector3;
  size: () => { w: number; h: number };
  touch: boolean;
  /** Practice round: the arena tag says so. */
  practice?: boolean;
}

interface Card {
  el: HTMLElement;
  bar: HTMLElement;
  num: HTMLElement;
  spin: HTMLElement;
  sup: HTMLElement;
}

export class HUD {
  readonly el: HTMLElement;
  private readonly cards: Card[] = [];
  private readonly tags: HTMLElement[] = [];
  private readonly status: HTMLElement;
  private readonly scoreEl: HTMLElement;
  private readonly bannerEl: HTMLElement;
  private readonly calloutEl: HTMLElement;
  private lastCallout = -9;
  private readonly chipEls: HTMLElement[] = [];
  private readonly chipSig = ['', ''];
  private readonly feeds: HTMLElement[] = [];
  /** Per slot: the three moves, then the equipped Super, as text. */
  private readonly infos: PowerInfo[][] = [];
  private readonly hintEl: HTMLElement;
  private liveStart = -1;
  private shownKo = -1;
  private shownEnd = false;
  private readonly v = new THREE.Vector3();

  constructor(private readonly o: HudOptions) {
    const { match } = o;
    this.el = h('div.hud');

    for (let slot = 0; slot < 2; slot++) {
      const b = match.blades[slot];
      const cls = b.built.def.class;
      const bar = h('i');
      const num = h('b', null, '100');
      const spin = h('div.spin', null, h('div.bar', null, bar), num);
      const sup = h('span.sstate', null, 'Super');
      const el = h('div.hud-card.p' + slot, { 'data-class': cls },
        h('div.top',
          null,
          h('span.who', null, slot === 0 ? 'YOU' : 'CPU'),
          h('span.nm', null, o.names[slot]),
        ),
        h('div.sub', null,
          h('span.chip', { 'data-class': cls }, CLASS_COLORS[cls].label),
          h('span.chip.muted', null, `Lv ${b.built.level}`),
          sup,
        ),
        spin,
      );
      el.style.setProperty('--accent', CLASS_COLORS[cls].main);
      const chips = h('div.hud-chips', { 'aria-label': 'Active effects' });
      el.append(chips);
      this.chipEls.push(chips);
      this.cards.push({ el, bar, num, spin, sup });
      this.el.append(el);
      const feed = h('div.hud-feed.p' + slot, { 'aria-live': 'polite' });
      this.feeds.push(feed);
      this.el.append(feed);
      const voice = slot === 0 ? YOU : cpuVoice(b.built.def.name);
      const infos: PowerInfo[] = b.built.moves.map((mv, k) => moveInfo(mv, k + 1, voice));
      const sd = b.built.supers.find((x) => x.def.id === b.built.equippedSuper)?.def;
      if (sd) infos.push(superInfo(sd, b.built.levelBoost, voice));
      this.infos.push(infos);
    }

    this.scoreEl = h('div.score');
    this.status = h('div.status');
    this.el.append(h('div.hud-round', null, this.scoreEl, this.status, h('div.arena-tag', null, match.arena.def.name + (o.practice ? ' · practice' : ''))));
    this.renderScore();

    for (let slot = 0; slot < 2; slot++) {
      const t = h('div.tagfloat.p' + slot, null, slot === 0 ? 'YOU' : 'CPU');
      t.style.background = TEAM_COLORS[slot];
      this.tags.push(t);
      this.el.append(t);
    }

    this.bannerEl = h('div.banner', { 'aria-live': 'assertive' });
    this.calloutEl = h('div.callout', { 'aria-live': 'polite' });
    this.hintEl = h('div.hint.pulse');
    this.el.append(this.bannerEl, this.calloutEl, this.hintEl);
    this.setReadyHint();
  }

  /** A blade used a move or its Super: show what it is and what it does, for you and for the CPU. */
  powerUsed(e: Extract<SimEvent, { type: 'ability' | 'super' }>): void {
    if (e.type === 'super' && e.state !== 'activate') return;
    const info = this.infos[e.slot]?.[e.type === 'ability' ? e.index : 3];
    if (!info) return;
    const feed = this.feeds[e.slot];
    const item = h('div.feed-item', { class: info.kind === 'super' ? 'super' : null }, h('b', null, `${e.slot === 0 ? '' : 'CPU · '}${info.name}`), ' ', info.lines[0] ?? info.flavor);
    feed.prepend(item);
    while (feed.children.length > 2) feed.lastElementChild?.remove();
    window.setTimeout(() => item.remove(), 4200);
  }

  /** The arena did something: say so in a line at the top, so a mechanic is never a surprise. */
  arenaEvent(e: Extract<SimEvent, { type: 'arena' }>): void {
    const who = e.slot >= 0 ? this.o.names[e.slot] : '';
    const info = e.kind === 'crystalBreak' ? CRYSTAL_INFO[CRYSTAL_KINDS[Math.max(0, Math.min(3, Math.round(e.power)))]] : null;
    const say: Partial<Record<typeof e.kind, [string, string]>> = {
      pull: ['Magnet pulling in', '#35a0ff'], push: ['Magnet pushing out', '#ff7a3a'],
      gapWarn: ['A floor plate is about to drop', '#ff9a2a'], gustWarn: ['Gust incoming', '#6fe0ff'],
      lavaWarn: ['Vents about to erupt', '#ff6a2a'],
      crystalBreak: [`${who}: ${info?.name ?? 'Crystal'}. ${info?.text ?? ''}`, info?.color ?? '#27e0ff'],
      drop: [`${who}: drop attack`, '#ff8a3a'],
    };
    const s = say[e.kind];
    if (!s) return;
    const t = this.o.match.t;
    if (t - this.lastCallout < 1.1 && e.kind !== 'crystalBreak') return;
    this.lastCallout = t;
    const el = this.calloutEl;
    el.textContent = s[0];
    el.style.setProperty('--c', s[1]);
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }

  private setReadyHint(): void {
    this.hintEl.textContent = this.o.touch
      ? 'Pull back on the pad and release to launch'
      : 'Pull back on the pad and release — or ← → aim, ↑ ↓ power, Space launch';
    this.hintEl.classList.add('pulse');
  }

  private renderScore(): void {
    const s = this.o.score;
    this.scoreEl.replaceChildren(
      h('span.a', null, String(s.you)), h('i', null, '–'), h('span.b', null, String(s.cpu)),
    );
  }

  /** Append extra HUD children (pause button, mute) from the owner. */
  add(...els: HTMLElement[]): void { this.el.append(...els); }

  private banner(kind: 'ring' | 'spin' | 'neutral', title: string, sub: string): void {
    const b = this.bannerEl;
    b.className = `banner ${kind}`;
    b.replaceChildren(document.createTextNode(title), h('small', null, sub));
    void b.offsetWidth; // restart the animation
    b.classList.add('show');
  }

  /** Write text only when it changed: re-setting identical text every frame still invalidates layout. */
  private readonly memo = new WeakMap<Element, string>();
  private put(el: HTMLElement, text: string, cls?: string): void {
    const key = cls === undefined ? text : `${cls}|${text}`;
    if (this.memo.get(el) === key) return;
    this.memo.set(el, key);
    if (cls !== undefined) el.className = cls;
    el.textContent = text;
  }

  update(): void {
    const { match, names } = this.o;
    const t = match.t;

    if (match.phase === 'live' && this.liveStart < 0) {
      this.liveStart = t;
      this.hintEl.classList.remove('pulse');
      this.hintEl.textContent = '';
    }

    // cards
    match.blades.forEach((b, i) => {
      const c = this.cards[i];
      const sp = clamp(b.spin, 0, 100);
      c.bar.style.width = `${sp.toFixed(1)}%`;
      this.put(c.num, String(Math.round(sp)));
      c.spin.classList.toggle('low', sp < 22 && !b.out);
      const sb = c.sup;
      if (!b.built.equippedSuper) { this.put(sb, 'No Super', 'sstate'); return; }
      const st = b.superState;
      this.put(sb, st === 'READY' ? 'Super ready' : st === 'ACTIVE' ? `Super ${b.superT.toFixed(1)}s` : `Super ${Math.ceil(b.superT)}s`, `sstate ${st}`);
    });

    // active effects under each card
    match.blades.forEach((b, i) => {
      const chips: StatusChip[] = [];
      if (b.alive) {
        for (const a of b.mods) { const c = chipFor(a, t, i === 0); if (c && c.remaining > 0.05) chips.push(c); }
        if (b.shield && b.shield.hits > 0) chips.push({ label: `Shield ×${b.shield.hits}`, good: true, remaining: Math.max(0, b.shield.until - t) });
      }
      const merged = new Map<string, StatusChip>();
      for (const c of chips) { const k = c.label; const prev = merged.get(k); if (!prev || prev.remaining < c.remaining) merged.set(k, c); }
      const list = [...merged.values()].slice(0, 4);
      const sig = list.map((c) => `${c.label}${c.good ? '+' : '-'}${c.remaining.toFixed(1)}`).join('|');
      if (sig === this.chipSig[i]) return;
      this.chipSig[i] = sig;
      this.chipEls[i].replaceChildren(...list.map((c) => h('span.st-chip', { class: c.good ? null : 'bad' }, c.label, c.remaining < 30 ? h('i', null, `${c.remaining.toFixed(1)}s`) : null)));
    });

    // status line
    if (match.phase === 'ready') this.put(this.status, 'Launch');
    else if (match.phase === 'live') {
      const el = Math.max(0, t - this.liveStart);
      const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
      this.put(this.status, `${clock(el)} / ${clock(TUNING.TIMEOUT)}`);
    } else this.put(this.status, 'Round over');

    // floating tags follow the blades
    const cam = this.o.camera();
    const { w, h: hh } = this.o.size();
    this.tags.forEach((tag, i) => {
      const b = match.blades[i];
      const gone = b.out !== null && b.fallen;
      this.v.copy(this.o.anchor(i));
      this.v.y += b.radius * 0.9 + 0.6;
      this.v.project(cam);
      // transform, not left/top: moving a tag every frame must not trigger layout
      tag.style.transform = `translate(${((this.v.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-this.v.y * 0.5 + 0.5) * hh - 14).toFixed(1)}px) translate(-50%, -50%)`;
      const live = match.phase === 'live' ? clamp(1 - (t - this.liveStart - 3.5) / 1.5, 0.35, 1) : 1;
      tag.style.opacity = gone || this.v.z > 1 ? '0' : String(live);
    });

    // knock-out banner: first blade out, then upgraded to DOUBLE KO / TIME-OUT by the result
    if (this.shownKo < 0) {
      for (const b of match.blades) {
        if (b.out) {
          this.shownKo = b.slot;
          const who = names[b.slot];
          this.banner(b.out === 'ring' ? 'ring' : 'spin', b.out === 'ring' ? 'Ring-out' : 'Spin-out',
            b.out === 'ring' ? `${who} left the arena` : `${who} ran out of spin`);
          break;
        }
      }
    }
    const r = match.result;
    if (r && !this.shownEnd) {
      this.shownEnd = true;
      if (r.doubleKO) this.banner('neutral', 'Double KO', 'Both blades went out together');
      else if (r.timeout) this.banner('neutral', 'Time-out', 'Higher spin wins');
      else if (this.shownKo < 0) this.banner('neutral', 'Round over', '');
    }
  }

  /** Called when the whole round is over (the result sheet takes over the bottom). */
  showResult(_r: MatchResult, score: Score): void {
    this.o.score.you = score.you; this.o.score.cpu = score.cpu; this.o.score.draws = score.draws;
    this.renderScore();
  }

  dispose(): void { this.el.remove(); }
}
