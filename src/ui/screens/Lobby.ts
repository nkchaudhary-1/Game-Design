// Pre-battle: pick your blade, the CPU's blade and difficulty, see the class matchup, go.
// (PRD v2 lobby for Phase 1: a single local player vs the CPU; the slot cards are built for N players.)

import type { AIDifficulty } from '../../ai/AIStates';
import { ARENA_ORDER, ARENAS } from '../../arenas/arenaData';
import { MVP_BLADES } from '../../blades/bladeData';
import { CLASS_COLORS } from '../../core/types';
import { classChip, levelStepper, topBar } from '../common';
import { BLADE_ART, ARENA_ART } from '../art';
import { cap, h } from '../dom';
import { matchupInfo } from '../text';
import type { Ctx, Screen } from './types';

const DIFFS: AIDifficulty[] = ['EASY', 'NORMAL', 'HARD'];

export class LobbyScreen implements Screen {
  readonly el: HTMLElement;
  private readonly body = h('div.lobby-body');

  constructor(private readonly ctx: Ctx) {
    const s = ctx.session;
    if (s.cpuRandom) s.rollCpu();
    this.el = h('section.screen.lobby', null,
      topBar(ctx, 'Pre-battle', () => ctx.go('menu'),
        s.played > 0 ? h('span.chip.muted', { title: 'Running score this session' }, `Score ${s.score.you}–${s.score.cpu}`) : null,
        s.played > 0 ? h('button.btn.ghost.small', { type: 'button', onclick: () => { s.resetScore(); this.render(); } }, 'Reset') : null,
      ),
      this.body,
    );
    this.render();
  }

  private slotCard(slot: 0 | 1): HTMLElement {
    const s = this.ctx.session;
    const b = slot === 0 ? s.built(s.you) : s.cpuBuilt();
    const cls = b.def.class;
    const card = h('div.slotcard', { 'data-class': cls },
      h('div.who', null,
        h('span.tagc', { style: slot === 0 ? 'background:var(--ink);color:#fff' : 'background:var(--cpu);color:var(--ink)' }, slot === 0 ? 'YOU' : 'CPU'),
        classChip(cls),
        h('span.chip.muted', null, `Lv ${b.level}`),
        slot === 1 ? h('span.chip.muted', null, cap(s.difficulty)) : null,
      ),
      h('div.thumb', null, h('img', { src: BLADE_ART[b.def.id] ?? this.ctx.thumbs.get(b), alt: '', class: BLADE_ART[b.def.id] ? 'art' : null })),
      h('div.nm', null, b.def.name),
      h('div.role', null, `${b.def.role} — ${b.def.fantasy}`),
      h('div.sum', null, slot === 0 ? b.description.summary : 'Stock build, same level as you.'),
    );
    return card;
  }

  private mini(id: string, pressed: boolean, onclick: () => void): HTMLElement {
    const b = this.ctx.session.built(id);
    const m = h('button.mini', { type: 'button', 'data-class': b.def.class, 'aria-pressed': String(pressed), onclick },
      h('img', { src: this.ctx.thumbs.get(b), alt: '' }), b.def.name);
    m.style.setProperty('--accent', CLASS_COLORS[b.def.class].main);
    return m;
  }

  private render(): void {
    const { session: s } = this.ctx;
    const you = s.built(s.you), cpu = s.cpuBuilt();
    const mu = matchupInfo(you.def.class, cpu.def.class);

    const yourRow = h('div.pickrow', null, h('span.lbl', null, 'Your blade'),
      ...MVP_BLADES.map((id) => this.mini(id, s.you === id, () => { s.selectYou(id); if (s.cpuRandom) s.rollCpu(); this.render(); })),
      h('button.btn.ghost.small', { type: 'button', onclick: () => this.ctx.go('hangar') }, '+18 in Hangar'),
    );
    const cpuRow = h('div.pickrow', null, h('span.lbl', null, 'CPU blade'),
      ...MVP_BLADES.map((id) => this.mini(id, !s.cpuRandom && s.cpu === id, () => { s.cpu = id; s.cpuRandom = false; this.render(); })),
      h('button.mini', { type: 'button', style: '--accent:var(--stamina-light);padding:6px 14px', 'aria-pressed': String(s.cpuRandom), onclick: () => { s.cpuRandom = true; s.rollCpu(); this.render(); } }, 'Random'),
    );
    const diffRow = h('div.pickrow', null, h('span.lbl', null, 'CPU difficulty'),
      h('div.seg', { role: 'group', 'aria-label': 'CPU difficulty' },
        ...DIFFS.map((d) => h('button', { type: 'button', 'aria-pressed': String(s.difficulty === d), onclick: () => { s.difficulty = d; this.render(); } }, cap(d))),
      ),
    );
    const arenaRow = h('div', { style: 'display:grid;gap:8px' },
      h('span.lbl', { style: 'font:800 15px var(--f-display);letter-spacing:.16em;text-transform:uppercase;color:var(--dim)' }, 'Arena'),
      h('div.arenas', null, ...ARENA_ORDER.map((id) => {
        const a = ARENAS[id];
        return h('button.acard', { type: 'button', class: a.implemented ? null : 'locked', 'aria-pressed': String(id === s.arenaId), disabled: !a.implemented, title: `${a.mechanic} Favours: ${a.favours ?? 'nobody'}.`, onclick: () => { if (a.implemented) { s.arenaId = id; this.render(); } } },
          h('img', { src: ARENA_ART[id], alt: '', loading: 'lazy' }),
          h('div.an', null, a.name, h('span.as', null, a.tagline)),
        );
      })),
    );

    this.body.replaceChildren(
      h('div.versus', null, this.slotCard(0), h('div.vs', null, 'VS'), this.slotCard(1)),
      h('div.matchup', null,
        h('span.tag.' + mu.tag, null, mu.label),
        h('span', null, mu.text),
      ),
      yourRow, cpuRow, diffRow, arenaRow,
      levelStepper(s.level, (l) => { s.setLevel(l); this.render(); }),
      h('div.cta', null,
        h('button.btn.primary.big', { type: 'button', onclick: () => this.ctx.go('battle') }, 'Battle'),
        h('button.btn.secondary.big', { type: 'button', onclick: () => { s.returnTo = 'lobby'; this.ctx.go('workshop', s.you); } }, 'Customize ' + you.def.name),
      ),
    );
  }
}
