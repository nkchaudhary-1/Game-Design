// The Powers panel: every move and the equipped Super of a blade, in plain words. Used before a fight (Lobby), in the
// Hangar, and in the in-battle help sheet. The "what it does" lines come from the data that runs (blades/powerText.ts).

import type { BuiltBlade } from '../blades/BladeFactory';
import { cpuVoice, moveInfo, superInfo, YOU, type PowerInfo, type Voice } from '../blades/powerText';
import { CLASS_COLORS } from '../core/types';
import { abilityIcon, h, icon } from './dom';

/** `v` is whose point of view the sentences take: "You take 45% less damage" for your blade, "Aegiron takes…" for the CPU's. */
export function powerInfos(b: BuiltBlade, superId: string | null = b.equippedSuper, v: Voice = YOU): PowerInfo[] {
  const out = b.moves.map((m, i) => moveInfo(m, i + 1, v));
  const sup = b.supers.find((s) => s.def.id === superId)?.def;
  if (sup) out.push(superInfo(sup, b.levelBoost, v));
  return out;
}

const TYPE_LABEL: Record<string, string> = { ATTACK: 'Attack', DEFENSE: 'Defense', MOVEMENT: 'Movement', CONTROL: 'Control', BUFF: 'Buff', DEBUFF: 'Debuff', SUPER: 'Super' };

/** One power: key, name, how to use it, what it is for, and exactly what it does. */
export function powerRow(p: PowerInfo): HTMLElement {
  const dur = p.kind === 'super' ? `Lasts ${p.duration} s · recharges ${p.cooldown} s` : `Cooldown ${p.cooldown} s`;
  return h('div.pw', { 'data-kind': p.kind, 'data-type': p.type },
    h('span.k', null, p.kind === 'super' ? icon('super', 18) : p.key),
    h('div.pw-body', null,
      h('div.pw-head', null,
        h('b.nm', null, p.name),
        h('span.tg', null, p.kind === 'super' ? 'Super' : TYPE_LABEL[p.type] ?? p.type),
        h('span.mt', null, dur),
      ),
      h('div.pw-how', null, icon(p.kind === 'super' ? 'super' : abilityIcon(p.type), 15), p.how),
      h('p.pw-flavor', null, p.flavor),
      h('ul.pw-lines', null, ...p.lines.map((l) => h('li', null, l))),
      h('div.pw-cost', null, `Cost: ${p.cost}`),
    ),
  );
}

/** A blade's whole kit. `onChangeSuper` adds a button that opens the Super picker. */
export function powersPanel(b: BuiltBlade, opts: { title?: string; voice?: Voice; onChangeSuper?: () => void } = {}): HTMLElement {
  const cls = b.def.class;
  const el = h('div.powers', { 'data-class': cls },
    h('div.powers-head', null,
      h('span.eyebrow', null, opts.title ?? 'Powers'),
      h('b.nm', { style: `color:${CLASS_COLORS[cls].main}` }, b.def.name),
      opts.onChangeSuper ? h('button.btn.ghost.small', { type: 'button', onclick: opts.onChangeSuper }, 'Change Super') : null,
    ),
    ...powerInfos(b, b.equippedSuper, opts.voice).map(powerRow),
  );
  return el;
}

/** The in-battle help sheet: your powers, then the CPU's, so you know what it can do to you too. */
export function powersSheet(you: BuiltBlade, cpu: BuiltBlade, onClose: () => void): HTMLElement {
  const modal = h('div.modal.powers-modal', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'What the powers do', onclick: (e: Event) => { if (e.target === modal) onClose(); } },
    h('div.sheet.wide', null,
      h('div.head', null, h('h3', null, 'Powers'), h('button.iconbtn', { type: 'button', 'aria-label': 'Close', onclick: onClose }, icon('close'))),
      h('p.pw-intro', null, 'Keys 1, 2, 3 are the three moves; Space is the Super. Hold the Move 1 button to charge it for a bigger hit, or just tap it for a quick jab.'),
      h('div.powers-cols', null,
        powersPanel(you, { title: 'You' }),
        powersPanel(cpu, { title: 'CPU', voice: cpuVoice(cpu.def.name) }),
      ),
      h('button.btn.primary', { type: 'button', onclick: onClose }, icon('play'), 'Back to the fight'),
    ),
  );
  return modal;
}
