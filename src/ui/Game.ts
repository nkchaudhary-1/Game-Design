// Game: the screen state machine and the single animation loop. Screens are plain objects; navigation is
// `ctx.go(name)`. Services (audio, renderers, session) are created once and handed to every screen.

import { AudioManager } from '../audio/AudioManager';
import { GameRenderer } from '../render/GameRenderer';
import { getArena } from '../arenas/arenaData';
import { Arena } from '../arenas/Arena';
import { paintFloorMaps } from '../arenas/arenaTextures';
import { PreviewRenderer, Thumbs } from './Previews';
import { BattleScreen } from './screens/BattleScreen';
import { HangarScreen } from './screens/Hangar';
import { LobbyScreen } from './screens/Lobby';
import { MenuScreen } from './screens/Menu';
import type { Ctx, Screen, ScreenName } from './screens/types';
import { WorkshopScreen } from './screens/Workshop';
import { Session } from './session';

export class Game {
  readonly session = new Session();
  readonly audio = new AudioManager();
  private readonly previews = new PreviewRenderer();
  private readonly thumbs = new Thumbs(this.previews);
  private readonly battleCanvas = document.createElement('canvas');
  private rr: GameRenderer | null = null;
  private current: Screen | null = null;
  private currentName: ScreenName | null = null;
  private last = performance.now();
  private readonly ctx: Ctx;

  constructor(private readonly root: HTMLElement, opts: { reduced: boolean; touch: boolean; latencyMs?: number }) {
    this.ctx = {
      session: this.session,
      audio: this.audio,
      previews: this.previews,
      thumbs: this.thumbs,
      battleRenderer: () => (this.rr ??= new GameRenderer(this.battleCanvas)),
      reduced: opts.reduced,
      touch: opts.touch,
      latencyMs: opts.latencyMs ?? 0,
      go: (screen, arg) => this.go(screen, arg),
    };

    // browsers only allow audio after a gesture; tap/key anywhere unlocks it, and buttons click
    const unlock = (): void => { this.audio.unlock(); };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    this.root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('button:not(:disabled)') && !t.closest('.pad')) this.audio.play('button_click');
    });
    window.addEventListener('resize', () => this.current?.resize?.());
  }

  start(initial: ScreenName = 'menu', arg?: string): void {
    this.go(initial, arg);
    // paint the arena's concrete maps while the player is still in the menu, so the first battle starts quickly
    window.setTimeout(() => {
      try { const a = new Arena(getArena('core-pit')); paintFloorMaps([a.spawn(0, 2), a.spawn(1, 2)], a.radius); } catch { /* built on demand instead */ }
    }, 1200);
    const loop = (now: number): void => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.current?.frame?.(dt);
    };
    requestAnimationFrame(loop);
  }

  go(name: ScreenName, arg?: string): void {
    this.current?.dispose?.();
    this.current?.el.remove();
    this.root.replaceChildren();
    let s: Screen;
    switch (name) {
      case 'menu': s = new MenuScreen(this.ctx); break;
      case 'hangar': s = new HangarScreen(this.ctx, arg); break;
      case 'workshop': s = new WorkshopScreen(this.ctx, arg ?? this.session.you); break;
      case 'lobby': s = new LobbyScreen(this.ctx); break;
      case 'battle': s = new BattleScreen(this.ctx); break;
    }
    this.current = s;
    this.currentName = name;
    this.root.append(s.el);
    s.resize?.();
    document.body.dataset.screen = name;
  }

  get screen(): ScreenName | null { return this.currentName; }
}
