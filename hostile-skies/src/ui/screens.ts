// DOM screens laid over the live 3D scene: title/setup, how-to-fly, pause and the mission result. The HUD itself is a
// canvas (see hud/hud.ts); everything here is plain HTML so it is focusable, scalable and easy to restyle.

import { TUNING, type Difficulty } from '../sim/difficulty';
import { WAVES, type Stats } from '../sim/world';

export interface Settings {
  difficulty: Difficulty;
  assist: boolean;
  flightStick: boolean;
  muted: boolean;
}

export interface MissionSummary {
  won: boolean;
  reason: string;
  score: number;
  wave: number;
  stats: Stats;
  accuracy: number;
  citiesSaved: number;
  citiesTotal: number;
  difficulty: Difficulty;
}

const KEY = 'hostile-skies:v1';

interface Saved { settings?: Partial<Settings>; best?: Record<string, number> }

function readSaved(): Saved {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Saved; } catch { return {}; }
}
function writeSaved(s: Saved): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: fine */ }
}

export function loadSettings(): Settings {
  const s = readSaved().settings ?? {};
  return {
    difficulty: s.difficulty && s.difficulty in TUNING ? s.difficulty : 'pilot',
    assist: s.assist ?? true,
    flightStick: s.flightStick ?? true,
    muted: s.muted ?? false,
  };
}
export function saveSettings(s: Settings): void { const d = readSaved(); d.settings = s; writeSaved(d); }
export function bestScore(d: Difficulty): number { return readSaved().best?.[d] ?? 0; }
/** Records a score; returns true if it is a new best. */
export function recordScore(d: Difficulty, score: number): boolean {
  const data = readSaved();
  const best = data.best ?? {};
  const isBest = score > (best[d] ?? 0);
  if (isBest) { best[d] = score; data.best = best; writeSaved(data); }
  return isBest;
}

const fmt = (n: number): string => n.toLocaleString('en-US');
const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const keysFor = (flightStick: boolean): { group: string; rows: [string, string][] }[] => [
  { group: 'Fly', rows: [flightStick ? ['S / ↓', 'Pitch up (pull back)'] : ['W / ↑', 'Pitch up'], flightStick ? ['W / ↑', 'Pitch down (push)'] : ['S / ↓', 'Pitch down'], ['A D / ← →', 'Bank (assisted) or roll (manual)'], ['Q E', 'Yaw (fine aim)'], ['R F · wheel', 'Throttle up / down'], ['Shift', 'Afterburner (limited fuel)'], ['X', 'Airbrake']] },
  { group: 'Fight', rows: [['Space · click', 'Cannon (overheats if held)'], ['Enter · G · right-click', 'Missile (needs a lock)'], ['T', 'Cycle target'], ['', 'Hold the target inside the diamond until the lock ring closes']] },
  { group: 'View & system', rows: [['C', 'Chase / cockpit camera'], ['H', 'Assist on / off'], ['V', 'Mouse steering on / off (the cursor is where the nose goes)'], ['Y', 'Swap pitch direction'], ['M', 'Mute'], ['Esc · P', 'Pause'], ['Pad', 'Sticks fly, RT cannon, RB missile, A afterburner']] },
];

export class Ui {
  private root: HTMLElement;
  private settings: Settings;
  private screen: HTMLElement | null = null;

  onLaunch: (s: Settings) => void = () => undefined;
  onResume: () => void = () => undefined;
  onRestart: () => void = () => undefined;
  onQuit: () => void = () => undefined;
  onSettings: (s: Settings) => void = () => undefined;

  constructor(root: HTMLElement, settings: Settings) {
    this.root = root;
    this.settings = settings;
  }

  get current(): 'title' | 'help' | 'pause' | 'result' | null { return (this.screen?.dataset.kind as 'title' | 'help' | 'pause' | 'result' | undefined) ?? null; }

  private mount(kind: string, html: string, cls = ''): HTMLElement {
    this.hide();
    const el = document.createElement('div');
    el.className = `screen ${cls}`;
    el.dataset.kind = kind;
    el.innerHTML = html;
    this.root.appendChild(el);
    this.screen = el;
    requestAnimationFrame(() => el.classList.add('in'));
    return el;
  }

  hide(): void {
    this.screen?.remove();
    this.screen = null;
  }

  private seg<T extends string>(el: HTMLElement, name: string, value: T, on: (v: T) => void): void {
    const group = el.querySelector<HTMLElement>(`[data-seg="${name}"]`)!;
    const sync = (v: string) => group.querySelectorAll<HTMLButtonElement>('button').forEach((b) => { b.classList.toggle('sel', b.dataset.v === v); b.setAttribute('aria-pressed', String(b.dataset.v === v)); });
    sync(String(value));
    group.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => { sync(b.dataset.v!); on(b.dataset.v as T); }));
  }

  private change(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    this.onSettings(this.settings);
  }

  // ---- screens ---------------------------------------------------------------------------------------------------

  showTitle(): void {
    const s = this.settings;
    const best = bestScore(s.difficulty);
    const el = this.mount('title', `
      <div class="scrim"></div>
      <div class="title-col">
        <div class="eyebrow">Arcade flight simulator</div>
        <h1>Hostile<br><span>Skies</span></h1>
        <p class="lede">The Veil fleet has dropped out of warp over the coast. Three cities. One interceptor. Keep the harvesters off the skyline until the mothership shows itself.</p>

        <div class="card">
          <div class="field">
            <label>Difficulty</label>
            <div class="seg" data-seg="difficulty" role="group" aria-label="Difficulty">
              ${(Object.keys(TUNING) as Difficulty[]).map((d) => `<button data-v="${d}">${TUNING[d].label}</button>`).join('')}
            </div>
            <div class="hint" data-hint="difficulty"></div>
          </div>
          <div class="field">
            <label>Flight model</label>
            <div class="seg" data-seg="assist" role="group" aria-label="Flight model">
              <button data-v="on">Assisted</button><button data-v="off">Manual</button>
            </div>
            <div class="hint" data-hint="assist"></div>
          </div>
          <div class="field">
            <label>Pitch</label>
            <div class="seg" data-seg="pitch" role="group" aria-label="Pitch direction">
              <button data-v="stick">Flight stick</button><button data-v="arcade">Arcade</button>
            </div>
            <div class="hint" data-hint="pitch"></div>
          </div>
        </div>

        <div class="cta">
          <button class="primary" data-act="launch">Launch <kbd>Enter</kbd></button>
          <button class="ghost" data-act="help">How to fly</button>
        </div>
        <div class="best" data-best>${best ? `Best on ${TUNING[s.difficulty].label}: <b>${fmt(best)}</b>` : ''}</div>
      </div>
      <div class="foot">Best with sound on and the window large. <span class="dim">Works with keyboard, mouse, gamepad or touch.</span></div>
    `, 'title');

    const hints = () => {
      el.querySelector('[data-hint="difficulty"]')!.textContent = TUNING[this.settings.difficulty].blurb;
      el.querySelector('[data-hint="assist"]')!.textContent = this.settings.assist
        ? 'A / D set your bank angle (release to level out), turns are coordinated, and a limiter keeps you out of stalls. Bank, then pull to turn.'
        : 'Raw aerodynamics: the nose can outrun your flight path and you can stall. Real energy management.';
      el.querySelector('[data-hint="pitch"]')!.textContent = this.settings.flightStick
        ? 'S / ↓ pulls the nose up, like a real stick.'
        : 'W / ↑ climbs, S / ↓ dives.';
      const b = bestScore(this.settings.difficulty);
      el.querySelector('[data-best]')!.innerHTML = b ? `Best on ${TUNING[this.settings.difficulty].label}: <b>${fmt(b)}</b>` : '';
    };
    this.seg(el, 'difficulty', s.difficulty, (v) => { this.change({ difficulty: v }); hints(); });
    this.seg(el, 'assist', s.assist ? 'on' : 'off', (v) => { this.change({ assist: v === 'on' }); hints(); });
    this.seg(el, 'pitch', s.flightStick ? 'stick' : 'arcade', (v) => { this.change({ flightStick: v === 'stick' }); hints(); });
    hints();
    el.querySelector('[data-act="launch"]')!.addEventListener('click', () => this.onLaunch(this.settings));
    el.querySelector('[data-act="help"]')!.addEventListener('click', () => this.showHelp('title'));
    (el.querySelector('[data-act="launch"]') as HTMLButtonElement).focus({ preventScroll: true });
  }

  showHelp(from: 'title' | 'pause'): void {
    const el = this.mount('help', `
      <div class="scrim heavy"></div>
      <div class="panel wide">
        <header><h2>How to fly</h2><button class="x" data-act="close" aria-label="Close">✕</button></header>
        <div class="keys">
          ${keysFor(this.settings.flightStick).map((g) => `<section><h3>${g.group}</h3>${g.rows.map(([k, d]) => k
            ? `<div class="row"><span class="keycap">${k}</span><span>${d}</span></div>`
            : `<div class="row note"><span></span><span>${d}</span></div>`).join('')}</section>`).join('')}
        </div>
        <div class="tips">
          <div><b>Protect the cities.</b> Harvesters (slow saucers) park over a city and burn it. A city at zero is lost; lose all three and it is over.</div>
          <div><b>Missiles need a lock.</b> Keep the target inside the lock cone until the ring closes. Cannon rounds are free but overheat: fire in bursts, aim at the white pipper.</div>
          <div><b>Mind the ground.</b> PULL UP means about three seconds. Low, slow and nose-high is how pilots stall.</div>
          <div><b>The Leviathan.</b> Wave 5. Its core is shielded: destroy the three glowing nodes first, then the core.</div>
        </div>
        <footer><button class="primary" data-act="close">${from === 'pause' ? 'Back' : 'Got it'}</button></footer>
      </div>
    `, 'help');
    const back = () => (from === 'pause' ? this.showPause() : this.showTitle());
    el.querySelectorAll('[data-act="close"]').forEach((b) => b.addEventListener('click', back));
    (el.querySelector('footer .primary') as HTMLButtonElement).focus({ preventScroll: true });
  }

  showPause(): void {
    const el = this.mount('pause', `
      <div class="scrim heavy"></div>
      <div class="panel">
        <header><h2>Paused</h2></header>
        <div class="stack">
          <button class="primary" data-act="resume">Resume <kbd>Esc</kbd></button>
          <button data-act="restart">Restart mission</button>
          <button data-act="help">How to fly</button>
          <button data-act="quit">Quit to title</button>
        </div>
        <div class="toggles">
          <label class="toggle"><input type="checkbox" data-t="assist" ${this.settings.assist ? 'checked' : ''}><span>Flight assist <kbd>H</kbd></span></label>
          <label class="toggle"><input type="checkbox" data-t="mute" ${this.settings.muted ? 'checked' : ''}><span>Mute <kbd>M</kbd></span></label>
        </div>
      </div>
    `, 'pause');
    const on = (a: string, f: () => void) => el.querySelector(`[data-act="${a}"]`)!.addEventListener('click', f);
    on('resume', () => this.onResume());
    on('restart', () => this.onRestart());
    on('help', () => this.showHelp('pause'));
    on('quit', () => this.onQuit());
    el.querySelector<HTMLInputElement>('[data-t="assist"]')!.addEventListener('change', (e) => this.change({ assist: (e.target as HTMLInputElement).checked }));
    el.querySelector<HTMLInputElement>('[data-t="mute"]')!.addEventListener('change', (e) => this.change({ muted: (e.target as HTMLInputElement).checked }));
    (el.querySelector('[data-act="resume"]') as HTMLButtonElement).focus({ preventScroll: true });
  }

  /** Sync the pause toggles when a hotkey changed a setting while the menu was open. */
  refreshPause(): void {
    if (this.current !== 'pause') return;
    const a = this.screen!.querySelector<HTMLInputElement>('[data-t="assist"]');
    const m = this.screen!.querySelector<HTMLInputElement>('[data-t="mute"]');
    if (a) a.checked = this.settings.assist;
    if (m) m.checked = this.settings.muted;
  }

  showResult(r: MissionSummary): void {
    const isBest = recordScore(r.difficulty, r.score);
    const best = bestScore(r.difficulty);
    const k = r.stats.kills;
    const totalKills = k.wisp + k.lancer + k.harvester + k.pod + k.core;
    const el = this.mount('result', `
      <div class="scrim heavy ${r.won ? 'win' : 'loss'}"></div>
      <div class="panel wide result">
        <div class="eyebrow ${r.won ? 'good' : 'bad'}">${r.won ? 'Mission complete' : 'Mission failed'}</div>
        <h2 class="big">${r.won ? 'The skies are ours' : prettyReason(r.reason)}</h2>
        <p class="sub">${r.won ? `${r.citiesSaved} of ${r.citiesTotal} cities still standing.` : `Reached wave ${r.wave} of ${WAVES.length} on ${TUNING[r.difficulty].label}.`}</p>
        <div class="score"><span class="label">Score</span><span class="num">${fmt(r.score)}</span>${isBest && r.score > 0 ? '<span class="tag">New best</span>' : `<span class="dim">Best ${fmt(best)}</span>`}</div>
        <div class="grid">
          ${stat('Cities saved', `${r.citiesSaved}/${r.citiesTotal}`)}
          ${stat('Hostiles down', String(totalKills))}
          ${stat('Accuracy', `${Math.round(r.accuracy * 100)}%`)}
          ${stat('Missiles', String(r.stats.missilesFired))}
          ${stat('Best combo', `x${(1 + Math.min(Math.max(r.stats.maxCombo - 1, 0), 10) * 0.1).toFixed(1)}`)}
          ${stat('Flight time', mmss(r.stats.time))}
        </div>
        <div class="kills">
          <span><i class="dot wisp"></i>Wisps <b>${k.wisp}</b></span>
          <span><i class="dot lancer"></i>Lancers <b>${k.lancer}</b></span>
          <span><i class="dot harvester"></i>Harvesters <b>${k.harvester}</b></span>
          <span><i class="dot pod"></i>Nodes <b>${k.pod}</b></span>
        </div>
        <footer>
          <button class="primary" data-act="again">Fly again <kbd>Enter</kbd></button>
          <button class="ghost" data-act="title">Title</button>
        </footer>
      </div>
    `, 'result');
    el.querySelector('[data-act="again"]')!.addEventListener('click', () => this.onRestart());
    el.querySelector('[data-act="title"]')!.addEventListener('click', () => this.onQuit());
    (el.querySelector('[data-act="again"]') as HTMLButtonElement).focus({ preventScroll: true });
  }

  /** Enter on the current screen = its primary action. */
  confirm(): void {
    const k = this.current;
    if (k === 'title') this.onLaunch(this.settings);
    else if (k === 'pause') this.onResume();
    else if (k === 'result') this.onRestart();
    else if (k === 'help') (this.screen!.querySelector('footer .primary') as HTMLButtonElement | null)?.click();
  }

  /** Esc on the current screen. */
  back(): void {
    const k = this.current;
    if (k === 'pause') this.onResume();
    else if (k === 'help') (this.screen!.querySelector('[data-act="close"]') as HTMLButtonElement | null)?.click();
  }

  get currentSettings(): Settings { return this.settings; }
  update(patch: Partial<Settings>): void { this.change(patch); this.refreshPause(); }
}

const stat = (label: string, value: string): string => `<div class="stat"><span class="v">${value}</span><span class="l">${label}</span></div>`;

function prettyReason(r: string): string {
  const t = r.toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
