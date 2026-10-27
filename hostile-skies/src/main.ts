import '@fontsource/chakra-petch/latin-500.css';
import '@fontsource/chakra-petch/latin-600.css';
import '@fontsource/chakra-petch/latin-700.css';
import '@fontsource/rajdhani/latin-500.css';
import '@fontsource/rajdhani/latin-600.css';
import '@fontsource/rajdhani/latin-700.css';
import './ui/ui.css';
import { Vector3 } from 'three';
import { Sound, type Listener } from './audio/audio';
import { Hud } from './hud/hud';
import { Input, type Command } from './input/input';
import { detectTier, GFX, lowerTier, setTier } from './render/quality';
import { GameView, type ViewState } from './render/view';
import { autopilot } from './sim/autopilot';
import { newControls } from './sim/controls';
import { createScene, DEMO_SCENES, type DemoScene } from './sim/demo';
import { SPAWN } from './sim/terrain';
import { World, WAVES, type SimEvent } from './sim/world';
import { lerp } from './sim/util';
import { loadSettings, Ui, type Settings } from './ui/screens';

// ---- boot ---------------------------------------------------------------------------------------------------------

const params = new URLSearchParams(location.search);
setTier(detectTier());

const glCanvas = document.getElementById('gl') as HTMLCanvasElement;
const hudCanvas = document.getElementById('hud') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui')!;
const touchRoot = document.getElementById('touch')!;

let settings = loadSettings();
const view = new GameView(glCanvas);
view.reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const hud = new Hud(hudCanvas);
const sound = new Sound();
sound.muted = settings.muted;
const input = new Input(window, glCanvas);
input.settings.flightStick = settings.flightStick;
input.mountTouch(touchRoot);
const ui = new Ui(uiRoot, settings);

type Mode = 'title' | 'playing' | 'paused' | 'ended' | 'demo';
let mode: Mode = 'title';
let missionTime = 0;
let endShown = false;
let lastIncoming = false;
const camera: { mode: 'chase' | 'cockpit' } = { mode: 'chase' };
const pointer = { x: 0, y: 0 };
window.addEventListener('mousemove', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; });

/** The title screen's backdrop is the first demo scene on a loop. */
let attract: DemoScene = createScene(0);
let attractFade = { phase: 'play' as 'play' | 'out', t: 0 };
function newAttract(): World {
  attract = createScene(0);
  attractFade = { phase: 'play', t: 0 };
  glCanvas.style.opacity = '1';
  return attract.world;
}
let world = attract.world;

function fit(): void {
  const w = window.innerWidth, h = window.innerHeight;
  view.resize(w, h);
  hud.resize(w, h, Math.min(window.devicePixelRatio || 1, 1.5));
}
window.addEventListener('resize', fit);

// ---- demo reel ----------------------------------------------------------------------------------------------------

const fadeEl = document.createElement('div');
fadeEl.id = 'fade';
document.body.appendChild(fadeEl);
const reel: { index: number; loop: number; scene: DemoScene | null; phase: 'play' | 'out'; outT: number } = { index: 0, loop: 0, scene: null, phase: 'play', outT: 0 };
const FADE_IN = 0.6, FADE_OUT = 0.7;

/** Recording and planning skip the (slow) terrain prime between scenes. */
let noPrime = false;

function loadScene(index: number): void {
  reel.index = index;
  reel.scene = createScene(index);
  reel.phase = 'play';
  reel.outT = 0;
  world = reel.scene.world;
  view.reset();
  hud.reset();
  if (!noPrime) view.prime(world.ac.pos.x, world.ac.pos.z);
  lastIncoming = false;
}

function startDemo(): void {
  glCanvas.style.opacity = '1';
  mode = 'demo';
  input.active = false;
  reel.loop = 0;
  ui.hide();
  sound.unlock();
  loadScene(0);
}

function exitDemo(): void {
  fadeEl.style.opacity = '0';
  reel.scene = null;
  toTitle();
}

/** Where the camera is for the current moment of the current scene. */
function reelView(sc: DemoScene): ViewState {
  const t = sc.world.time;
  const shot = sc.shots.find((x) => t >= x.t0 && t < x.t1) ?? sc.shots[0]!;
  if (shot.mode === 'orbit') {
    const k = clamp01((t - shot.t0) / Math.max(shot.t1 - shot.t0, 1e-3));
    return { mode: 'orbit', orbit: { dist: shot.dist ?? 60, az: lerp(shot.az0 ?? 0, shot.az1 ?? 0, k), el: shot.el ?? 0.15 } };
  }
  return { mode: shot.mode };
}
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

// ---- flow ---------------------------------------------------------------------------------------------------------

function apply(patch: Partial<Settings>): void {
  settings = { ...settings, ...patch };
  input.settings.flightStick = settings.flightStick;
  sound.setMuted(settings.muted);
  if (mode === 'playing' || mode === 'paused') world.assist = settings.assist;
}
ui.onSettings = (s) => apply(s);

function startMission(): void {
  glCanvas.style.opacity = '1';
  settings = ui.currentSettings;
  world = new World({
    seed: params.has('seed') ? Number(params.get('seed')) : Math.floor(Math.random() * 1e9),
    difficulty: settings.difficulty,
    assist: settings.assist,
    startWave: params.has('wave') ? Number(params.get('wave')) : 1,
    god: params.has('god'),
  });
  view.reset();
  hud.reset();
  view.prime(SPAWN.x, SPAWN.z);
  missionTime = 0;
  endShown = false;
  camera.mode = 'chase';
  mode = 'playing';
  input.active = true;
  ui.hide();
  sound.unlock();
}

function toTitle(): void {
  mode = 'title';
  input.active = false;
  world = newAttract();
  view.reset();
  hud.clear();
  ui.showTitle();
}

function pause(): void {
  if (mode !== 'playing') return;
  mode = 'paused';
  input.active = false;
  ui.showPause();
}
function resume(): void {
  if (mode !== 'paused') return;
  mode = 'playing';
  input.active = true;
  ui.hide();
}

ui.onLaunch = () => startMission();
ui.onDemo = () => startDemo();
ui.onResume = () => resume();
ui.onRestart = () => startMission();
ui.onQuit = () => toTitle();

function flash(text: string, tone: 'info' | 'warn' | 'good' | 'bad' = 'info'): void {
  hud.consume([{ type: 'msg', text, tone }]);
}

input.onGesture = () => sound.unlock();
input.onAnyKey = (code) => { if (mode === 'demo' && code !== 'KeyM') exitDemo(); };
input.onCommand = (c: Command) => {
  switch (c) {
    case 'pause':
      if (mode === 'playing') pause();
      else if (mode === 'paused' || ui.current === 'help') ui.back();
      break;
    case 'confirm':
      if (mode !== 'playing') ui.confirm();
      break;
    case 'camera':
      if (mode === 'playing') { camera.mode = camera.mode === 'chase' ? 'cockpit' : 'chase'; }
      break;
    case 'mute': ui.update({ muted: !settings.muted }); break;
    case 'assist':
      if (mode === 'playing' || mode === 'paused') { ui.update({ assist: !settings.assist }); if (mode === 'playing') flash(settings.assist ? 'Flight assist ON' : 'Flight assist OFF — you are flying manual', 'info'); }
      break;
    case 'mouse':
      if (mode === 'playing') {
        input.settings.mouseSteer = !input.settings.mouseSteer;
        flash(input.settings.mouseSteer ? 'Mouse steering ON — the cursor is your stick' : 'Mouse steering OFF', 'info');
      }
      break;
    case 'invert':
      if (mode === 'playing') { ui.update({ flightStick: !settings.flightStick }); flash(settings.flightStick ? 'Pitch: S / ↓ pulls up' : 'Pitch: W / ↑ climbs', 'info'); }
      break;
    case 'help':
      if (mode === 'playing') { pause(); ui.showHelp('pause'); }
      break;
  }
};

document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('blur', () => pause());

// ---- loop ---------------------------------------------------------------------------------------------------------

const listener: Listener = { pos: new Vector3(), right: new Vector3(1, 0, 0) };
let last = performance.now();
const coarsePointer = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
let slowFor = 0;
let ema = 16;
const MAX_STEP = 1 / 60;

/** One slice of the demo reel: advance the scene, handle fades and cuts. Returns the sim events of the slice. */
function stepReel(dt: number): SimEvent[] {
  const sc = reel.scene!;
  const events: SimEvent[] = [];
  const n = Math.max(1, Math.ceil(dt / MAX_STEP));
  for (let i = 0; i < n; i++) {
    world.step(dt / n, sc.flight.controls());
    for (const e of world.events) events.push(e);
    world.events.length = 0;
  }
  if (reel.phase === 'play' && sc.done()) { reel.phase = 'out'; reel.outT = 0; }
  if (reel.phase === 'out') {
    reel.outT += dt;
    if (reel.outT >= FADE_OUT) { loadScene((reel.index + 1) % DEMO_SCENES); if (reel.index === 0) reel.loop++; }
  }
  const fin = clamp01(1 - world.time / FADE_IN);
  fadeEl.style.opacity = String(reel.phase === 'out' ? clamp01(reel.outT / FADE_OUT) : fin);
  return events;
}

function drawHud(events: SimEvent[], state: ViewState, dt: number): void {
  hud.consume(events);
  hud.draw(world, view, {
    assist: true, mouseSteer: false, cockpit: state.mode === 'cockpit', mouse: pointer, missionTime: 99, touch: false,
    demo: { title: reel.scene!.name, caption: reel.scene!.caption },
  }, dt);
}

function frame(now: number): void {
  const rawDt = Math.min(0.1, Math.max(0.0001, (now - last) / 1000));
  last = now;
  const dt = Math.min(1 / 20, rawDt);

  const size = { w: window.innerWidth, h: window.innerHeight };
  const controls = mode === 'playing' ? input.poll(dt, size) : newControls();
  const events: SimEvent[] = [];

  if (mode === 'playing' || mode === 'ended') {
    const n = Math.max(1, Math.ceil(dt / MAX_STEP));
    for (let i = 0; i < n; i++) {
      world.step(dt / n, mode === 'playing' ? controls : newControls());
      for (const e of world.events) events.push(e);
      world.events.length = 0;
    }
    if (mode === 'playing') missionTime += dt;
    if (mode === 'playing' && world.finished) endMission();
  } else if (mode === 'demo' && reel.scene) {
    for (const e of stepReel(dt)) events.push(e);
  } else if (mode === 'title') {
    const n = Math.max(1, Math.ceil(dt / MAX_STEP));
    for (let i = 0; i < n; i++) world.step(dt / n, attract.flight.controls());
    world.events.length = 0;
    // loop the scene, fading the 3D view (not the menu) through black
    if (attractFade.phase === 'play' && attract.done()) attractFade = { phase: 'out', t: 0 };
    if (attractFade.phase === 'out') {
      attractFade.t += dt;
      glCanvas.style.opacity = String(1 - clamp01(attractFade.t / 0.6));
      if (attractFade.t >= 0.6) { world = newAttract(); view.reset(); }
    } else glCanvas.style.opacity = String(clamp01(world.time / 0.6));
  }

  // view
  const state: ViewState = mode === 'title'
    ? { mode: 'orbit', orbit: orbitShot(now / 1000) }
    : mode === 'demo' && reel.scene ? reelView(reel.scene)
    : { mode: camera.mode };
  view.consume(events);
  view.render(world, mode === 'paused' ? 0 : dt, state);

  // hud
  if (mode === 'demo' && reel.scene) {
    drawHud(events, state, dt);
  } else if (mode === 'playing' || mode === 'ended') {
    hud.consume(events);
    if (mode === 'playing') {
      hud.draw(world, view, {
        assist: world.assist, mouseSteer: input.settings.mouseSteer, cockpit: camera.mode === 'cockpit',
        mouse: pointer, missionTime, touch: input.touchMode,
      }, dt);
    } else hud.clear();
  } else if (mode === 'paused') {
    // keep the last HUD frame; nothing to update
  } else hud.clear();

  // audio
  if (mode !== 'title') {
    listener.pos.copy(view.camera.position);
    listener.right.set(1, 0, 0).applyQuaternion(view.camera.quaternion);
    if (mode !== 'paused') sound.consume(events, listener);
    const lock = !world.target ? 0 : world.lock >= 1 ? 2 : world.lock > 0.02 ? 1 : 0;
    lastIncoming = hud.incomingAlert === 1;
    sound.update(world, dt, listener, { incoming: lastIncoming, lock, playing: mode === 'playing' || mode === 'demo' });
  } else sound.update(world, dt, listener, { incoming: false, lock: 0, playing: false });

  // touch controls only while flying
  touchRoot.hidden = !(mode === 'playing' && (input.touchMode || coarsePointer));

  // keep the frame rate honest: step the graphics tier down if we are persistently slow
  ema += (rawDt * 1000 - ema) * 0.05;
  if (mode === 'playing' || mode === 'title') {
    slowFor = ema > 34 ? slowFor + rawDt : Math.max(0, slowFor - rawDt);
    const lower = lowerTier(GFX.tier);
    if (slowFor > 4 && lower && !params.has('quality')) {
      setTier(lower);
      view.applyTier();
      slowFor = 0; ema = 16;
      if (mode === 'playing') flash(`Graphics set to ${lower} to keep the frame rate up`, 'info');
    }
  }
  requestAnimationFrame(frame);
}

function orbitShot(t: number): { dist: number; az: number; el: number } {
  return { dist: 58 + Math.sin(t * 0.13) * 12, az: -0.6 + Math.sin(t * 0.11) * 0.95, el: 0.14 + Math.sin(t * 0.17) * 0.07 };
}

function endMission(): void {
  if (endShown) return;
  endShown = true;
  mode = 'ended';
  input.active = false;
  hud.clear();
  const won = world.state === 'won';
  window.setTimeout(() => {
    if (mode !== 'ended') return;
    ui.showResult({
      won, reason: world.endReason || world.deathCause, score: world.score, wave: world.wave, stats: world.stats,
      accuracy: world.accuracy, citiesSaved: world.cities.filter((c) => c.alive).length, citiesTotal: world.cities.length,
      difficulty: settings.difficulty,
    });
  }, won ? 500 : 250);
}

// ---- start --------------------------------------------------------------------------------------------------------

function loadingNote(): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;background:#0a0e24;color:#6ff3ff;font:600 13px "Chakra Petch",system-ui,sans-serif;letter-spacing:.3em;text-transform:uppercase;z-index:20';
  el.textContent = 'Preparing airspace';
  document.body.appendChild(el);
  return el;
}

const loading = loadingNote();
fit();
requestAnimationFrame(() => requestAnimationFrame(() => {
  if (params.has('record')) { installRecorder(); loading.remove(); return; }
  view.prime(SPAWN.x, SPAWN.z);
  loading.remove();
  if (params.has('demo')) startDemo();
  else if (params.has('autostart')) { ui.currentSettings.difficulty = settings.difficulty; startMission(); }
  else ui.showTitle();
  last = performance.now();
  requestAnimationFrame(frame);
}));

// QA hooks (inert unless you open the console)
(window as unknown as Record<string, unknown>).__game = {
  get world() { return world; }, view, hud, sound, input, ui, waves: WAVES.length,
  get mode() { return mode; }, pause, resume, startMission, toTitle, startDemo, autopilot,
};

// ---- recorder (?record) -------------------------------------------------------------------------------------------
// Steps the demo reel at a fixed rate instead of on requestAnimationFrame, so frames can be captured one by one (and
// by several browsers in parallel) and the sound rendered offline. Used to make the demo video; inert otherwise.

let snapCanvas: HTMLCanvasElement | null = null;

function installRecorder(): void {
  const FPS = Number(params.get('fps') ?? 30);
  const dt = 1 / FPS;
  const begin = (): void => {
    mode = 'demo';
    input.active = false;
    reel.loop = 0;
    ui.hide();
    hud.clear();
    noPrime = true;
    loadScene(0);
  };
  const finishPrime = (): void => { noPrime = false; view.prime(world.ac.pos.x, world.ac.pos.z); };
  /** Frames in one pass of the reel, found by running the sim alone. */
  const plan = (): number => {
    begin();
    let n = 0;
    while (reel.loop < 1 && n < FPS * 400) { stepReel(dt); n++; }
    return n;
  };
  const rec = {
    fps: FPS,
    plan,
    /** Start from frame `n` (sim only), ready to render. */
    seek(n: number): void {
      begin();
      for (let i = 0; i < n; i++) stepReel(dt);
      finishPrime();
      hud.reset();
    },
    /** Advance one frame and draw it. */
    frame(): { scene: number; t: number } {
      const events = stepReel(dt);
      const state = reelView(reel.scene!);
      view.consume(events);
      view.render(world, dt, state);
      drawHud(events, state, dt);
      return { scene: reel.index, t: world.time };
    },
    /** The current frame as a JPEG data URL: GL canvas + HUD + the fade, composited by hand (faster than a page screenshot). */
    snap(quality = 0.9): string {
      if (!snapCanvas) { snapCanvas = document.createElement('canvas'); }
      const c = snapCanvas;
      c.width = glCanvas.width; c.height = glCanvas.height;
      const g = c.getContext('2d')!;
      g.drawImage(glCanvas, 0, 0, c.width, c.height);
      g.drawImage(hudCanvas, 0, 0, c.width, c.height);
      const f = Number(fadeEl.style.opacity || 0);
      if (f > 0) { g.fillStyle = `rgba(0,0,0,${f})`; g.fillRect(0, 0, c.width, c.height); }
      return c.toDataURL('image/jpeg', quality);
    },
    /** Render the whole reel's sound offline; returns a 16-bit stereo WAV as base64. */
    async audio(frames: number): Promise<string> {
      const sr = 44100;
      const ctx = new OfflineAudioContext(2, Math.ceil((frames / FPS + 1) * sr), sr);
      settings = { ...settings, muted: false };
      sound.muted = false;
      sound.attachOffline(ctx);
      begin();
      const l: Listener = { pos: new Vector3(), right: new Vector3(1, 0, 0) };
      for (let f = 0; f < frames; f++) {
        const events = stepReel(dt);
        sound.setClock(f * dt);
        const ac = world.ac;
        l.pos.copy(ac.pos).add(new Vector3(0, 5, 22).applyQuaternion(ac.q));
        l.right.set(1, 0, 0).applyQuaternion(ac.q);
        sound.consume(events, l);
        if (f % 3 === 0) {
          const lock = !world.target ? 0 : world.lock >= 1 ? 2 : world.lock > 0.02 ? 1 : 0;
          sound.update(world, dt * 3, l, { incoming: false, lock, playing: true });
        }
      }
      const buf = await ctx.startRendering();
      const L = buf.getChannelData(0), R = buf.getChannelData(1);
      const bytes = new Uint8Array(44 + L.length * 4);
      const dv = new DataView(bytes.buffer);
      const w4 = (o: number, v: string) => { for (let i = 0; i < 4; i++) dv.setUint8(o + i, v.charCodeAt(i)); };
      w4(0, 'RIFF'); dv.setUint32(4, 36 + L.length * 4, true); w4(8, 'WAVE'); w4(12, 'fmt ');
      dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true); dv.setUint32(24, sr, true);
      dv.setUint32(28, sr * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true); w4(36, 'data'); dv.setUint32(40, L.length * 4, true);
      for (let i = 0; i < L.length; i++) {
        dv.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i]!)) * 32767, true);
        dv.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i]!)) * 32767, true);
      }
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    },
  };
  (window as unknown as Record<string, unknown>).__rec = rec;
}
