import '@fontsource-variable/outfit';
import './style.css';
import { DEFAULT_LOOK, LOOK_HAIR, LOOK_PANTS, LOOK_SHIRT, LOOK_SKIN, LOOK_STYLES, type Look } from '../shared/protocol';
import { Game, type Profile } from './game';
import { DEFAULT_SETTINGS, type Settings } from './input';
import { LocalHost } from './local';

/** Single-file build for the Artifact page: the game server runs in-page, so no network is needed. */
const store = {
  get<T>(k: string): T | null { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sandboxed */ } },
};
function newProfile(): Profile {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const pick = (n: number) => Math.floor(Math.random() * n);
  const look: Look = { ...DEFAULT_LOOK, skin: pick(LOOK_SKIN.length), hair: pick(LOOK_HAIR.length), shirt: pick(LOOK_SHIRT.length), pants: pick(LOOK_PANTS.length), style: pick(LOOK_STYLES.length) };
  return { token: [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(''), name: `Neighbor-${100 + pick(900)}`, look };
}

async function boot() {
  try { await Promise.race([document.fonts.load('700 32px "Outfit Variable"'), new Promise((r) => setTimeout(r, 1500))]); } catch { /* system font */ }
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const profile = store.get<Profile>('nb.profile') ?? newProfile();
  store.set('nb.profile', profile);
  const settings = { ...DEFAULT_SETTINGS, ...(store.get<Settings>('nb.settings') ?? {}) };
  const host = new LocalHost(true);
  const game = new Game(canvas, profile, settings, (s) => store.set('nb.settings', s), (p) => store.set('nb.profile', p), {
    net: host, note: 'Playable demo: you plus three simulated neighbours. The real game is multiplayer.',
  });
  addEventListener('pagehide', () => host.close());
  if (new URLSearchParams(location.search).has('debug')) game.expose();
}
void boot();
