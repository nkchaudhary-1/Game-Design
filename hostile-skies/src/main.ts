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
import { SPAWN } from './sim/terrain';
import { World, WAVES, type SimEvent } from './sim/world';
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

type Mode = 'title' | 'playing' | 'paused' | 'ended';
let mode: Mode = 'title';
let world = newAttract();
let missionTime = 0;
let endShown = false;
let lastIncoming = false;
const camera: { mode: 'chase' | 'cockpit' } = { mode: 'chase' };
const pointer = { x: 0, y: 0 };
window.addEventListener('mousemove', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; });

function newAttract(): World {
  return new World({ seed: Math.floor(Math.random() * 1e6), god: true, startWave: 3, difficulty: 'cadet' });
}

function fit(): void {
  const w = window.innerWidth, h = window.innerHeight;
  view.resize(w, h);
  hud.resize(w, h, Math.min(window.devicePixelRatio || 1, 1.5));
}
window.addEventListener('resize', fit);

// ---- flow ---------------------------------------------------------------------------------------------------------

function apply(patch: Partial<Settings>): void {
  settings = { ...settings, ...patch };
  input.settings.flightStick = settings.flightStick;
  sound.setMuted(settings.muted);
  if (mode === 'playing' || mode === 'paused') world.assist = settings.assist;
}
ui.onSettings = (s) => apply(s);

function startMission(): void {
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
ui.onResume = () => resume();
ui.onRestart = () => startMission();
ui.onQuit = () => toTitle();

function flash(text: string, tone: 'info' | 'warn' | 'good' | 'bad' = 'info'): void {
  hud.consume([{ type: 'msg', text, tone }]);
}

input.onGesture = () => sound.unlock();
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
  } else if (mode === 'title') {
    const n = Math.max(1, Math.ceil(dt / MAX_STEP));
    for (let i = 0; i < n; i++) world.step(dt / n, autopilot(world, 'cinematic'));
    world.events.length = 0;
    if (world.state !== 'play') world = newAttract();
  }

  // view
  const state: ViewState = mode === 'title'
    ? { mode: 'orbit', orbit: orbitShot(now / 1000) }
    : { mode: camera.mode };
  view.consume(events);
  view.render(world, mode === 'paused' ? 0 : dt, state);

  // hud
  if (mode === 'playing' || mode === 'ended') {
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
    sound.update(world, dt, listener, { incoming: lastIncoming, lock, playing: mode === 'playing' });
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
  view.prime(SPAWN.x, SPAWN.z);
  loading.remove();
  if (params.has('autostart')) { ui.currentSettings.difficulty = settings.difficulty; startMission(); }
  else ui.showTitle();
  last = performance.now();
  requestAnimationFrame(frame);
}));

// QA hooks (inert unless you open the console)
(window as unknown as Record<string, unknown>).__game = {
  get world() { return world; }, view, hud, sound, input, ui, waves: WAVES.length,
  get mode() { return mode; }, pause, resume, startMission, toTitle, autopilot,
};
