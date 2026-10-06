import type { AudioManager } from '../../audio/AudioManager';
import type { GameRenderer } from '../../render/GameRenderer';
import type { PreviewRenderer, Thumbs } from '../Previews';
import type { Session } from '../session';

export type ScreenName = 'menu' | 'hangar' | 'workshop' | 'lobby' | 'battle';

/** What every screen gets: shared services plus navigation. */
export interface Ctx {
  session: Session;
  audio: AudioManager;
  previews: PreviewRenderer;
  thumbs: Thumbs;
  /** The battle renderer is created on first use (it needs a visible canvas). */
  battleRenderer(): GameRenderer;
  reduced: boolean;
  touch: boolean;
  /** Artificial controller→display latency (ms) for feel-testing; ?latency=80. 0 = none. */
  latencyMs: number;
  go(screen: ScreenName, arg?: string): void;
}

export interface Screen {
  readonly el: HTMLElement;
  /** Called every animation frame while this screen is current. */
  frame?(dt: number): void;
  resize?(): void;
  /** Return true if the screen handled "back" itself (e.g. closing a detail pane). */
  back?(): boolean;
  dispose?(): void;
}
