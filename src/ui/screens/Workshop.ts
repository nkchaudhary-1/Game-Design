// Workshop: Ring / Core / Weight / Tip. Preview | exploded part stack | stats + Supers | part selector.
// Every choice changes the 3D model, the ratings (and through Balance the physics), which Supers unlock,
// and the generated build description. Stock parts cost nothing; every other part trades something away.

import { recommendedBuild, defaultBuild, partLockReason, type BuiltBlade } from '../../blades/BladeFactory';
import { getBlade } from '../../blades/bladeData';
import { getPart, partsForSlot, type PartDef } from '../../blades/parts';
import { PART_SLOTS, type PartSlot } from '../../core/types';
import { classChip, levelStepper, modSpans, statsGrid, topBar } from '../common';
import { canvasEl, cap, h, icon } from '../dom';
import { BladeStage, type StageView } from '../Previews';
import type { Ctx, Screen } from './types';

export class WorkshopScreen implements Screen {
  readonly el: HTMLElement;
  private readonly canvas = canvasEl();
  private readonly stage = new BladeStage();
  private readonly detach: () => void;
  private readonly exploded = h('div.exploded');
  private readonly wstats = h('div.wstats.panel');
  private readonly partrow = h('div.partrow', { role: 'listbox' });
  private readonly viewBtns: Record<StageView, HTMLButtonElement>;
  private readonly header: HTMLElement;
  private slot: PartSlot = 'ring';

  constructor(private readonly ctx: Ctx, private readonly bladeId: string) {
    const def = getBlade(bladeId);
    this.stage.reduced = ctx.reduced;
    this.detach = this.stage.attach(this.canvas);
    const mk = (v: StageView, ic: Parameters<typeof icon>[0], label: string): HTMLButtonElement =>
      h('button.iconbtn', { type: 'button', 'aria-label': label, title: label, 'aria-pressed': String(v === 'free'), onclick: () => this.setView(v) }, icon(ic, 18)) as HTMLButtonElement;
    this.viewBtns = { free: mk('free', 'cube', '3D view'), top: mk('top', 'top', 'Top view'), side: mk('side', 'side', 'Side view') };
    const preview = h('div.preview', null,
      this.canvas,
      h('div.views', { style: 'position:absolute;right:8px;top:8px;display:flex;gap:4px' }, this.viewBtns.free, this.viewBtns.top, this.viewBtns.side),
      h('div.hint', { style: 'position:absolute;left:12px;bottom:8px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);pointer-events:none' }, 'Drag to rotate'),
    );
    this.header = topBar(ctx, `Workshop · ${def.name}`, () => ctx.go(ctx.session.returnTo),
      classChip(def.class),
    );
    this.el = h('section.screen.workshop-screen', { 'data-class': def.class }, this.header,
      h('div.workshop', null, preview, this.exploded, this.wstats, this.partrow),
    );
    preview.dataset.class = def.class;
    this.refresh();
  }

  private setView(v: StageView): void {
    this.stage.setView(v);
    for (const k of Object.keys(this.viewBtns) as StageView[]) this.viewBtns[k].setAttribute('aria-pressed', String(k === v));
  }

  private built(): BuiltBlade { return this.ctx.session.built(this.bladeId); }

  private choose(part: PartDef): void {
    const s = this.ctx.session;
    const b = this.built();
    s.setBuild(this.bladeId, { ...b.build, [part.slot]: part.id });
    this.ctx.audio.play('upgrade');
    this.refresh();
  }

  private refresh(): void {
    const s = this.ctx.session;
    const b = this.built();
    this.stage.setBlade(b);

    // exploded stack, top to bottom: ring, core, weight, tip
    this.exploded.replaceChildren(...PART_SLOTS.map((slot) => {
      const p = getPart(b.build[slot]);
      const mods = modSpans(p.mods);
      return h('button.slot', { type: 'button', 'aria-pressed': String(slot === this.slot), onclick: () => { this.slot = slot; this.refresh(); } },
        h('span.sl', null, slot),
        h('span.pn', null, p.name),
        h('span.pc', { style: 'display:flex;gap:2px 8px;flex-wrap:wrap' }, ...(mods.length ? mods.slice(0, 3) : [h('span', null, 'Stock')])),
      );
    }));
    this.exploded.querySelectorAll('.pc .up').forEach((e) => ((e as HTMLElement).style.color = 'var(--good)'));
    this.exploded.querySelectorAll('.pc .down').forEach((e) => ((e as HTMLElement).style.color = 'var(--bad)'));

    // stats + supers
    this.wstats.replaceChildren(
      levelStepper(s.level, (l) => { s.setLevel(l); this.refresh(); }, 'Locks parts & Supers'),
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
        h('button.btn.secondary.small', { type: 'button', onclick: () => { s.setBuild(this.bladeId, recommendedBuild(this.bladeId, s.level)); this.refresh(); } }, 'Recommended build'),
        h('button.btn.ghost.small', { type: 'button', onclick: () => { s.setBuild(this.bladeId, defaultBuild()); this.refresh(); } }, 'Reset to stock'),
      ),
      h('div', null,
        h('div.eyebrow', null, b.description.headline),
        h('p.desc', null, b.description.summary),
        b.description.changes.length ? h('p.desc', { style: 'color:var(--text)' }, `Changes: ${b.description.changes.join(', ')}`) : null,
      ),
      h('h3', null, 'Ratings'),
      statsGrid(b),
      h('h3', null, 'Supers'),
      h('div.supers', null, ...b.supers.map((st) => h('div.sup', { style: 'padding:6px 10px', 'aria-pressed': String(st.def.id === b.equippedSuper), class: st.unlocked ? null : 'locked', 'data-locked': String(!st.unlocked) },
        h('span.nm', null, st.def.name, st.def.ultimate ? ' ★' : ''),
        h('span.chip.muted', null, st.unlocked ? (st.def.id === b.equippedSuper ? 'Equipped' : 'Unlocked') : 'Locked'),
        st.reason ? h('span.why', null, st.reason) : null,
      ))),
    );
    this.wstats.querySelectorAll<HTMLElement>('.sup[data-locked="true"]').forEach((e) => (e.style.opacity = '.55'));

    // part selector for the chosen slot
    const parts = partsForSlot(this.slot);
    const compat = parts.filter((p) => p.classes.includes(b.def.class));
    const hidden = parts.length - compat.length;
    this.partrow.replaceChildren(...compat.map((p) => {
      const why = partLockReason(this.bladeId, p, s.level);
      const eq = b.build[this.slot] === p.id;
      return h('button.part', { type: 'button', role: 'option', 'aria-selected': String(eq), 'aria-pressed': String(eq), disabled: !!why, onclick: () => this.choose(p) },
        h('span.nm', null, p.name),
        h('span.mods', null, ...(modSpans(p.mods).length ? modSpans(p.mods) : [h('span', { style: 'color:var(--dim)' }, 'No trade-offs')])),
        h('span', { style: 'color:var(--dim);font-size:13px' }, p.description),
        why ? h('span.why', null, why) : h('span.chip', { class: `rarity-${p.rarity}`, style: 'justify-self:start' }, cap(p.rarity)),
      );
    }), hidden > 0 ? h('div', { style: 'flex:none;align-self:center;color:var(--faint);font-size:13px;padding:0 8px;max-width:140px' }, `${hidden} part${hidden > 1 ? 's' : ''} for other classes hidden`) : '');
  }

  frame(dt: number): void {
    if (this.canvas.clientWidth > 0) {
      this.stage.update(dt);
      this.stage.render(this.ctx.previews, this.canvas);
    }
  }

  dispose(): void { this.detach(); this.stage.dispose(); }
}
