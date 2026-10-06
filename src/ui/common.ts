// Shared UI pieces used by several screens.

import type { BladeClass } from '../core/types';
import { CLASS_COLORS } from '../core/types';
import { h, icon } from './dom';
import type { Ctx } from './screens/types';

export function muteButton(ctx: Ctx): HTMLButtonElement {
  const on = icon('sound'); on.classList.add('on');
  const off = icon('mute'); off.classList.add('off');
  const b = h('button.iconbtn', { type: 'button', 'aria-label': 'Sound on/off', 'aria-pressed': String(ctx.session.muted), title: 'Sound on/off' }, on, off) as HTMLButtonElement;
  b.addEventListener('click', () => {
    ctx.session.muted = !ctx.session.muted;
    ctx.audio.setMuted(ctx.session.muted);
    document.querySelectorAll('.iconbtn[title="Sound on/off"]').forEach((x) => x.setAttribute('aria-pressed', String(ctx.session.muted)));
  });
  return b;
}

export function topBar(ctx: Ctx, title: string, onBack: (() => void) | null, ...extra: Array<Node | null>): HTMLElement {
  return h('header.top', null,
    onBack ? h('button.iconbtn', { type: 'button', 'aria-label': 'Back', onclick: onBack }, icon('back')) : null,
    h('h2', null, title),
    h('div.spacer'),
    ...extra,
    muteButton(ctx),
  );
}

export const classChip = (c: BladeClass): HTMLElement => h('span.chip', { 'data-class': c }, CLASS_COLORS[c].label);

/** Level stepper (a test control: there is no progression in the MVP, so Level is a dial). */
export function levelStepper(level: number, onChange: (l: number) => void, note = 'Test dial: unlocks parts, Supers and a small Super boost'): HTMLElement {
  const lv = h('span.lv', null, String(level));
  const dec = h('button.iconbtn', { type: 'button', 'aria-label': 'Lower level', onclick: () => onChange(level - 1) }, '−') as HTMLButtonElement;
  const inc = h('button.iconbtn', { type: 'button', 'aria-label': 'Raise level', onclick: () => onChange(level + 1) }, '+') as HTMLButtonElement;
  dec.disabled = level <= 1; inc.disabled = level >= 7;
  for (const b of [dec, inc]) { b.style.fontSize = '22px'; b.style.width = '36px'; b.style.height = '36px'; if (b.disabled) b.style.opacity = '.4'; }
  return h('div.levelrow', null, h('span.lbl', null, 'Level'), dec, lv, inc, h('span.note', null, note));
}

// ------------------------------------------------------------------------------------------ stat widgets
import type { BuiltBlade } from '../blades/BladeFactory';
import { spinSeconds } from '../core/Balance';
import { STAT_KEYS, STAT_LABELS, type StatRatings } from '../core/types';

/** The nine design ratings as bars, with green/red deltas where parts changed them. */
export function statsGrid(b: BuiltBlade): HTMLElement {
  const g = h('div.stats');
  for (const k of STAT_KEYS) {
    const base = b.baseStats[k], v = b.stats[k], d = v - base;
    const lo = Math.min(base, v);
    g.append(
      h('span.lbl', null, STAT_LABELS[k]),
      h('div.bar', { class: v >= 8 ? 'hi' : null, role: 'img', 'aria-label': `${STAT_LABELS[k]} ${v} of 10` },
        h('i', { style: `width:${lo * 10}%` }),
        d !== 0 ? h('b', { class: d > 0 ? 'up' : 'down', style: `left:${lo * 10}%;width:${Math.abs(d) * 10}%` }) : null,
      ),
      h('span.val', null, String(v), d !== 0 ? h('small', { class: d > 0 ? 'up' : 'down' }, `${d > 0 ? '+' : '−'}${Math.abs(d)}`) : null),
    );
  }
  // what Stamina means in play: how long the blade keeps spinning if nothing touches it
  const secs = Math.round(spinSeconds(b.stats.stamina));
  g.append(h('span.lbl', null, 'Spin time'), h('span', { style: 'grid-column: 2 / 4; font-weight: 700' }, `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} left alone`));
  return g;
}

/** "+2 Weight, −1 Agility" as coloured spans. */
export function modSpans(mods: Partial<StatRatings>): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const k of STAT_KEYS) {
    const v = mods[k];
    if (v) out.push(h('span', { class: v > 0 ? 'up' : 'down' }, `${v > 0 ? '+' : '−'}${Math.abs(v)} ${STAT_LABELS[k]}`));
  }
  return out;
}
