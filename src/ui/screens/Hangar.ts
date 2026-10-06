// Hangar: all 21 blades as compact cards (filter by class and rarity), with a turntable preview and the
// blade's overview, customization summary and Super list on the right. Everything on screen comes from data.

import { BLADE_ORDER, BLADES } from '../../blades/bladeData';
import { recommendedBuild, defaultBuild, type BuiltBlade } from '../../blades/BladeFactory';
import { getPart } from '../../blades/parts';
import { CLASS_BEATS, CLASS_COLORS, PART_SLOTS, type BladeClass, type Rarity } from '../../core/types';
import { classChip, levelStepper, modSpans, statsGrid, topBar } from '../common';
import { canvasEl, cap, h, icon } from '../dom';
import { BladeStage, type StageView } from '../Previews';
import type { Ctx, Screen } from './types';

const CLASSES: BladeClass[] = ['ATTACK', 'DEFENSE', 'STAMINA'];
const RARITIES: Rarity[] = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY'];
type Tab = 'overview' | 'customize' | 'supers';

export class HangarScreen implements Screen {
  readonly el: HTMLElement;
  private readonly body = h('div.hangar-body');
  private readonly list = h('div.hangar-list');
  private readonly grid = h('div.card-grid');
  private readonly filters = h('div.filters');
  private readonly detail = h('div.detail');
  private readonly dyn = h('div.dyn', { style: 'display:grid;gap:12px' });
  private readonly canvas = canvasEl();
  private readonly stage = new BladeStage();
  private readonly viewBtns: Record<StageView, HTMLButtonElement>;
  private readonly detach: () => void;
  private selected: string;
  private clsFilter: BladeClass | 'ALL' = 'ALL';
  private rarityFilter: Rarity | 'ALL' = 'ALL';
  private tab: Tab = 'overview';
  private thumbQueue: Array<[HTMLImageElement, BuiltBlade]> = [];

  constructor(private readonly ctx: Ctx, initial?: string) {
    this.selected = initial && BLADES[initial] ? initial : ctx.session.you;
    this.stage.reduced = ctx.reduced;
    this.detach = this.stage.attach(this.canvas);

    const mkView = (v: StageView, ic: Parameters<typeof icon>[0], label: string): HTMLButtonElement =>
      h('button.iconbtn', { type: 'button', 'aria-label': label, title: label, 'aria-pressed': String(v === 'free'), onclick: () => this.setView(v) }, icon(ic, 18)) as HTMLButtonElement;
    this.viewBtns = { free: mkView('free', 'cube', '3D view'), top: mkView('top', 'top', 'Top view'), side: mkView('side', 'side', 'Side view') };
    const preview = h('div.preview', null,
      this.canvas,
      h('div.views', null, this.viewBtns.free, this.viewBtns.top, this.viewBtns.side),
      h('div.hint', null, 'Drag to rotate · scroll or pinch to zoom'),
    );
    this.detail.append(preview, this.dyn);
    this.list.append(this.filters, this.grid);
    this.body.append(this.list, this.detail);
    this.body.classList.toggle('detail-open', false);

    this.el = h('section.screen.hangar', null,
      topBar(ctx, 'Hangar', () => { if (!this.back()) ctx.go('menu'); }),
      this.body,
    );
    this.renderFilters();
    this.renderGrid();
    this.renderDetail();
  }

  back(): boolean {
    if (this.body.classList.contains('detail-open') && window.matchMedia('(max-width: 860px)').matches) {
      this.body.classList.remove('detail-open');
      return true;
    }
    return false;
  }

  private setView(v: StageView): void {
    this.stage.setView(v);
    for (const k of Object.keys(this.viewBtns) as StageView[]) this.viewBtns[k].setAttribute('aria-pressed', String(k === v));
  }

  // ------------------------------------------------------------------------------------------ list
  private renderFilters(): void {
    const seg = <T extends string>(label: string, opts: Array<[T, string]>, cur: T, set: (v: T) => void): HTMLElement =>
      h('div.seg', { role: 'group', 'aria-label': label },
        ...opts.map(([v, t]) => {
          const b = h('button', { type: 'button', 'aria-pressed': String(cur === v), onclick: () => set(v) }, t);
          if (CLASSES.includes(v as BladeClass)) { b.dataset.class = v; b.style.setProperty('--accent', CLASS_COLORS[v as BladeClass].main); }
          return b;
        }));
    const rar = h('select.sel', { 'aria-label': 'Filter by rarity', onchange: (e: Event) => { this.rarityFilter = (e.target as HTMLSelectElement).value as Rarity | 'ALL'; this.renderGrid(); } },
      h('option', { value: 'ALL' }, 'All rarities'),
      ...RARITIES.map((r) => h('option', { value: r, selected: this.rarityFilter === r }, cap(r))),
    );
    this.filters.replaceChildren(
      seg<BladeClass | 'ALL'>('Filter by class', [['ALL', 'All'], ...CLASSES.map((c) => [c, CLASS_COLORS[c].label] as [BladeClass, string])], this.clsFilter, (v) => { this.clsFilter = v; this.renderFilters(); this.renderGrid(); }),
      rar,
      h('span.chip.muted', { title: 'Playable now' }, `${BLADE_ORDER.filter((id) => BLADES[id].implemented).length} playable · ${BLADE_ORDER.length} in roster`),
    );
  }

  private renderGrid(): void {
    this.thumbQueue = [];
    const kids: Node[] = [];
    for (const c of CLASSES) {
      if (this.clsFilter !== 'ALL' && this.clsFilter !== c) continue;
      const ids = BLADE_ORDER.filter((id) => BLADES[id].class === c && (this.rarityFilter === 'ALL' || BLADES[id].rarity === this.rarityFilter));
      if (!ids.length) continue;
      const title = h('div.group-title', { 'data-class': c }, `${CLASS_COLORS[c].label} · ${ids.length}`);
      kids.push(title, ...ids.map((id) => this.card(id)));
    }
    if (!kids.length) kids.push(h('p', { style: 'color:var(--dim);grid-column:1/-1' }, 'No blades match these filters.'));
    this.grid.replaceChildren(...kids);
  }

  private card(id: string): HTMLElement {
    const b = this.ctx.session.built(id);
    const d = b.def;
    const img = h('img', { alt: '', width: 96, height: 96 }) as HTMLImageElement;
    this.thumbQueue.push([img, b]);
    const el = h('button.bcard', { type: 'button', 'data-class': d.class, 'aria-pressed': String(id === this.selected), 'data-id': id, class: d.implemented ? null : 'locked', onclick: () => this.select(id) },
      h('div.thumb', null, img),
      d.implemented ? null : h('span.chip.muted.soon', null, 'Soon'),
      h('div.nm', null, d.name),
      h('div.rl', null, d.role),
      h('div.row', null, h('span.chip', { class: `rarity-${d.rarity}` }, cap(d.rarity)), h('span.lv', null, `LV ${b.level}`)),
      h('div.keystat', null, 'ATK ', h('b', null, String(b.stats.attack)), ' DEF ', h('b', null, String(b.stats.defense)), ' STA ', h('b', null, String(b.stats.stamina))),
    );
    return el;
  }

  private select(id: string): void {
    this.selected = id;
    this.ctx.session.selectYou(BLADES[id].implemented ? id : this.ctx.session.you);
    this.grid.querySelectorAll<HTMLElement>('.bcard').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.id === id)));
    this.body.classList.add('detail-open');
    this.renderDetail();
  }

  // ---------------------------------------------------------------------------------------- detail
  private renderDetail(): void {
    const { session: s } = this.ctx;
    const b = s.built(this.selected);
    const d = b.def;
    this.detail.dataset.class = d.class;
    this.stage.setBlade(b);

    const tabBtn = (t: Tab, label: string): HTMLElement =>
      h('button', { type: 'button', role: 'tab', 'aria-selected': String(this.tab === t), onclick: () => { this.tab = t; this.renderDetail(); } }, label);

    const content = this.tab === 'overview' ? this.overview(b) : this.tab === 'customize' ? this.customize(b) : this.supers(b);

    this.dyn.replaceChildren(
      h('div.dhead', null,
        h('div.nm', null, d.name),
        h('div.fantasy', null, `“${d.fantasy}”`),
        h('div.meta', null,
          classChip(d.class), h('span.chip', { class: `rarity-${d.rarity}` }, cap(d.rarity)),
          h('span.chip.muted', null, d.role), h('span.chip.muted', null, `Difficulty ${cap(d.difficulty)}`),
          d.implemented ? null : h('span.chip.muted', null, 'Not playable yet'),
        ),
      ),
      h('div.tabs', { role: 'tablist' }, tabBtn('overview', 'Overview'), tabBtn('customize', 'Customize'), tabBtn('supers', 'Supers')),
      content,
      h('div.actions', null,
        d.implemented
          ? h('button.btn.primary', { type: 'button', onclick: () => { s.selectYou(d.id); this.ctx.go('lobby'); } }, `Battle with ${d.name}`)
          : h('button.btn.primary', { type: 'button', disabled: true }, 'Coming soon'),
        h('button.btn.secondary', { type: 'button', onclick: () => { s.returnTo = 'hangar'; this.ctx.go('workshop', d.id); } }, icon('wrench'), 'Workshop'),
      ),
    );
  }

  private levelRow(): HTMLElement {
    return levelStepper(this.ctx.session.level, (l) => {
      this.ctx.session.setLevel(l);
      this.renderGrid();
      this.renderDetail();
    });
  }

  private overview(b: BuiltBlade): HTMLElement {
    const d = b.def;
    return h('div', { style: 'display:grid;gap:12px' },
      this.levelRow(),
      h('p', { style: 'color:var(--dim)' }, b.description.summary),
      statsGrid(b),
      h('div.eyebrow', null, 'Basic moves'),
      h('div.moves', null, ...b.moves.map((m, i) =>
        h('div.move', null,
          h('span.k', null, String(i + 1)),
          h('div', null, h('div.nm', null, m.name), h('div.ds', null, m.description)),
          h('span.tg', null, m.charge ? 'Hold' : cap(m.type)),
        ))),
      h('div.matchup', null,
        h('span.tag.adv', null, 'Beats'), h('span', null, CLASS_COLORS[CLASS_BEATS[d.class]].label),
        h('span.tag.dis', null, 'Loses to'), h('span', null, CLASS_COLORS[CLASSES.find((c) => CLASS_BEATS[c] === d.class)!].label),
      ),
    );
  }

  private customize(b: BuiltBlade): HTMLElement {
    const d = b.def, s = this.ctx.session;
    return h('div', { style: 'display:grid;gap:12px' },
      this.levelRow(),
      h('div.moves', null, ...PART_SLOTS.map((slot) => {
        const p = getPart(b.build[slot]);
        return h('div.move', null,
          h('span.k', null, slot[0].toUpperCase()),
          h('div', null, h('div.nm', null, `${cap(slot)} · ${p.name}`), h('div.ds.mods', { style: 'display:flex;gap:4px 10px;flex-wrap:wrap' }, ...(modSpans(p.mods).length ? modSpans(p.mods) : [h('span', null, 'Stock: no trade-offs')]))),
          h('span.tg', null, cap(p.rarity)),
        );
      })),
      h('p', { style: 'color:var(--dim)' }, `Suggested: ${d.customizationProfile.hints.join(' · ')}.`),
      h('div.cta', null,
        h('button.btn.secondary.small', { type: 'button', onclick: () => { s.setBuild(d.id, recommendedBuild(d.id, s.level)); this.renderGrid(); this.renderDetail(); } }, 'Apply recommended build'),
        h('button.btn.ghost.small', { type: 'button', onclick: () => { s.setBuild(d.id, defaultBuild()); this.renderGrid(); this.renderDetail(); } }, 'Reset to stock'),
      ),
    );
  }

  private supers(b: BuiltBlade): HTMLElement {
    const s = this.ctx.session;
    return h('div', { style: 'display:grid;gap:12px' },
      this.levelRow(),
      h('p', { style: 'color:var(--dim)' }, 'Equip one Super. Each runs 6–8 seconds, then recharges for 10 seconds. Some need part stats or a higher level.'),
      h('div.supers', null, ...b.supers.map((st) => {
        const eq = st.def.id === b.equippedSuper;
        const el = h('button.sup', { type: 'button', 'aria-pressed': String(eq), disabled: !st.unlocked, onclick: () => { s.setSuper(b.def.id, st.def.id); this.renderDetail(); } },
          h('span.nm', null, st.def.name, st.def.ultimate ? ' ★' : ''),
          h('span.chip.muted', null, st.unlocked ? `${st.def.duration.toFixed(1)}s · ${st.def.recharge}s` : `Lv ${st.def.unlockLevel}`),
          h('span.ds', null, st.def.description),
          st.reason ? h('span.why', null, st.reason) : null,
        );
        return el;
      })),
    );
  }

  // ------------------------------------------------------------------------------------------ frame
  frame(dt: number): void {
    // thumbnails trickle in, two per frame
    for (let i = 0; i < 2 && this.thumbQueue.length; i++) {
      const [img, b] = this.thumbQueue.shift()!;
      img.src = this.ctx.thumbs.get(b);
    }
    if (this.canvas.clientWidth > 0) {
      this.stage.update(dt);
      this.stage.render(this.ctx.previews, this.canvas);
    }
  }

  dispose(): void { this.detach(); this.stage.dispose(); }
}
