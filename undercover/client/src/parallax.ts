/**
 * Parallax driver. Writes --px / --py (each in -1..1) on <html>; layers translate by a depth multiplier.
 * Sources, in priority order: device orientation (phones), pointer position (desktop), scroll, and a
 * slow idle drift so the scene breathes even with no input. Honours prefers-reduced-motion.
 */
export type MotionState = 'unsupported' | 'needs-permission' | 'granted' | 'denied';

const KEY = 'undercover.motion';
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let target = { x: 0, y: 0 };
let current = { x: 0, y: 0 };
let gyroActive = false;
let lastInput = 0;
let baseline: { beta: number; gamma: number } | null = null;
let raf = 0;
let started = false;
const listeners = new Set<(s: MotionState) => void>();

function clamp(v: number, lo = -1, hi = 1): number {
  return Math.max(lo, Math.min(hi, v));
}

function apply(): void {
  const root = document.documentElement.style;
  root.setProperty('--px', current.x.toFixed(4));
  root.setProperty('--py', current.y.toFixed(4));
}

function tick(now: number): void {
  const idle = now - lastInput > 2500;
  let tx = target.x;
  let ty = target.y;
  if (idle) {
    // Gentle Lissajous drift, 30 s period, small amplitude.
    const t = now / 1000;
    tx = 0.18 * Math.sin(t / 4.8);
    ty = 0.12 * Math.sin(t / 6.7 + 1.3);
  }
  const ease = idle ? 0.02 : 0.12;
  current.x += (tx - current.x) * ease;
  current.y += (ty - current.y) * ease;
  apply();
  raf = requestAnimationFrame(tick);
}

function onOrientation(e: DeviceOrientationEvent): void {
  if (e.beta === null || e.gamma === null) return;
  gyroActive = true;
  if (!baseline) baseline = { beta: e.beta, gamma: e.gamma };
  // Slowly re-centre on how the phone is being held so tilt is relative, not absolute.
  baseline.beta += (e.beta - baseline.beta) * 0.01;
  baseline.gamma += (e.gamma - baseline.gamma) * 0.01;
  const landscape = Math.abs((screen.orientation?.angle ?? window.orientation ?? 0) as number) === 90;
  const dx = landscape ? e.beta - baseline.beta : e.gamma - baseline.gamma;
  const dy = landscape ? e.gamma - baseline.gamma : e.beta - baseline.beta;
  target = { x: clamp(dx / 22), y: clamp(dy / 22) };
  lastInput = performance.now();
}

function onPointer(e: PointerEvent): void {
  if (gyroActive || e.pointerType !== 'mouse') return;
  target = { x: clamp((e.clientX / window.innerWidth) * 2 - 1), y: clamp((e.clientY / window.innerHeight) * 2 - 1) };
  lastInput = performance.now();
}

let lastScroll = 0;
function onScroll(): void {
  if (gyroActive) return;
  const dy = window.scrollY - lastScroll;
  lastScroll = window.scrollY;
  target = { x: target.x, y: clamp(target.y + dy / 600) };
  lastInput = performance.now();
}

export function motionState(): MotionState {
  if (typeof DeviceOrientationEvent === 'undefined') return 'unsupported';
  const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<'granted' | 'denied'> };
  if (typeof D.requestPermission !== 'function') return 'granted'; // Android, desktop: no gate
  const stored = localStorage.getItem(KEY);
  if (stored === 'granted' || stored === 'denied') return stored;
  return 'needs-permission';
}

export function onMotionState(fn: (s: MotionState) => void): () => void {
  listeners.add(fn);
  fn(motionState());
  return () => listeners.delete(fn);
}

function notify(): void {
  const s = motionState();
  for (const l of listeners) l(s);
}

/** Must be called from a user gesture on iOS. */
export async function requestMotion(): Promise<MotionState> {
  const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<'granted' | 'denied'> };
  if (typeof D.requestPermission !== 'function') {
    attachGyro();
    return 'granted';
  }
  try {
    const result = await D.requestPermission();
    try {
      localStorage.setItem(KEY, result === 'granted' ? 'granted' : 'denied');
    } catch {
      /* ignore */
    }
    if (result === 'granted') attachGyro();
    notify();
    return result === 'granted' ? 'granted' : 'denied';
  } catch {
    try {
      localStorage.setItem(KEY, 'denied');
    } catch {
      /* ignore */
    }
    notify();
    return 'denied';
  }
}

export function dismissMotion(): void {
  try {
    localStorage.setItem(KEY, 'denied');
  } catch {
    /* ignore */
  }
  notify();
}

let gyroAttached = false;
function attachGyro(): void {
  if (gyroAttached) return;
  gyroAttached = true;
  window.addEventListener('deviceorientation', onOrientation, { passive: true });
}

export function startParallax(): void {
  if (started) return;
  started = true;
  if (reduced()) {
    apply();
    return;
  }
  lastScroll = window.scrollY;
  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  if (motionState() === 'granted') attachGyro();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (!raf) {
      raf = requestAnimationFrame(tick);
    }
  });
  raf = requestAnimationFrame(tick);
}
