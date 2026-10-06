import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/barlow-condensed/latin-800.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow/latin-700.css';
import './ui/ui.css';
import { initPhysics } from './core/Physics';
import { detectTier, setTier } from './render/quality';
import { mountControllerPage } from './ui/ControllerPage';
import { Game } from './ui/Game';
import type { ScreenName } from './ui/screens/types';

const root = document.getElementById('app')!;

function fail(message: string): void {
  root.replaceChildren();
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:0;display:grid;place-content:center;gap:12px;text-align:center;padding:24px;font:600 18px Barlow,system-ui,sans-serif;color:#f3f6ff';
  const h = document.createElement('div');
  h.style.cssText = 'font:800 36px "Barlow Condensed",system-ui,sans-serif;text-transform:uppercase;letter-spacing:.06em';
  h.textContent = 'Spinblade Arena can’t start';
  const p = document.createElement('p');
  p.textContent = message;
  box.append(h, p);
  root.append(box);
}

try {
  const q = new URLSearchParams(location.search);
  setTier(detectTier());
  if (q.get('role') === 'controller') {
    mountControllerPage(root, q);
  } else {
  await initPhysics();
  const game = new Game(root, {
    reduced: q.has('reduced') || window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    touch: window.matchMedia('(pointer: coarse)').matches,
    latencyMs: Math.max(0, Math.min(500, Number(q.get('latency')) || 0)),
  });
  (window as unknown as { __game: Game }).__game = game;
  const screen = (q.get('screen') ?? 'menu') as ScreenName;
  game.start(screen, q.get('blade') ?? undefined);
  }
} catch (err) {
  console.error(err);
  fail('This game needs WebGL and WebAssembly. Try a current version of Chrome, Edge, Firefox or Safari with hardware acceleration enabled.');
}
