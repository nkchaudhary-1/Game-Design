// Main menu: logo, the two entry points, a 3D hero of the playable blades, and a one-screen "how to play".

import { MVP_BLADES } from '../../blades/bladeData';
import { canvasEl, h, icon } from '../dom';
import { muteButton } from '../common';
import { HeroStage } from '../Previews';
import type { Ctx, Screen } from './types';

export class MenuScreen implements Screen {
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly hero: HeroStage;

  constructor(private readonly ctx: Ctx) {
    const s = ctx.session;
    this.hero = new HeroStage(MVP_BLADES.map((id) => s.built(id)));
    this.hero.reduced = ctx.reduced;
    this.canvas = canvasEl('hero-canvas');

    const score = s.played > 0
      ? h('span', null, `Session score  You ${s.score.you} – ${s.score.cpu} CPU`)
      : null;

    this.el = h('section.screen.menu', null,
      h('header.top', null, h('div.spacer'), muteButton(ctx)),
      h('div.menu-body', null,
        h('div.menu-copy', null,
          h('div.logo', null,
            h('div.bars', null, h('i'), h('i'), h('i')),
            'Spinblade', h('br'), 'Arena',
            h('small', null, 'Launch · Steer · Knock out'),
          ),
          h('p.tagline', null, 'Spin-blade duels in a pit. Slingshot in, hit hard, and either push them off the rim or spin them dry.'),
          h('div.menu-actions', null,
            h('button.btn.primary.big', { type: 'button', onclick: () => ctx.go('lobby') }, 'Quick battle'),
            h('button.btn.secondary.big', { type: 'button', onclick: () => ctx.go('hangar') }, 'Hangar · 21 blades'),
            h('button.btn.ghost', { type: 'button', onclick: () => this.how() }, icon('help'), 'How to play'),
          ),
        ),
        this.canvas,
      ),
      h('footer.menu-foot', null,
        h('span', null, 'Keyboard: WASD steer · 1 2 3 moves · Space Super'),
        h('span', null, 'MVP · Phase 1 browser test'),
        score,
      ),
    );
  }

  private how(): void {
    const item = (n: string, t: string, d: string): HTMLElement =>
      h('li', null, h('span.n', null, n), h('div', null, h('b', null, t), h('p', null, d)));
    const close = (): void => modal.remove();
    const modal = h('div.modal', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'How to play', onclick: (e: Event) => { if (e.target === modal) close(); } },
      h('div.sheet', null,
        h('div.head', null, h('h3', null, 'How to play'), h('button.iconbtn', { type: 'button', 'aria-label': 'Close', onclick: close }, icon('close'))),
        h('ol.how', null,
          item('1', 'Launch', 'Press on the pad, pull back, release. A longer pull is a harder launch.'),
          item('2', 'Steer', 'Drag on the pad to steer. Steering and moves cost spin, so spend it on purpose.'),
          item('3', 'Moves', 'Hold Move 1 to charge, release to hit. Charging drains spin. Move 2 defends, Move 3 repositions.'),
          item('4', 'Super', 'When it reads READY, fire it: 6–8 seconds of power, then 10 seconds to recharge.'),
          item('5', 'Win', 'RING-OUT: knock them over the rim. SPIN-OUT: drain their spin to zero. At 60 s, higher spin wins.'),
          item('6', 'Triangle', 'Attack beats Stamina. Stamina beats Defense. Defense beats Attack.'),
        ),
        h('button.btn.primary', { type: 'button', onclick: close }, 'Got it'),
      ),
    );
    this.el.append(modal);
  }

  frame(dt: number): void {
    this.hero.update(dt);
    this.hero.render(this.ctx.previews, this.canvas);
  }

  dispose(): void { this.hero.dispose(); }
}
