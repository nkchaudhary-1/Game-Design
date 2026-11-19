// The two worlds. 'alien' (the default) is the game's theme: a stylised violet dusk with stars, moons and a ringed planet
// filling a quarter of the sky, ground in plum, rose and coral, rock spires on the skyline, and menus and instruments in
// the same palette. 'earth' is the realistic golden-hour coast. Picked with ?look=alien|earth or the World switch on the
// title screen (remembered in localStorage). It changes colour, sky and a few props only: the simulation, the terrain
// shape and every number that matters to the fight stay identical.

export type LookName = 'earth' | 'alien';

const KEY = 'hostile-skies.look';

function pick(): LookName {
  try {
    const q = new URLSearchParams(location.search).get('look');
    if (q === 'alien' || q === 'earth') return q;
  } catch { /* no DOM (tests) */ }
  try { if (localStorage.getItem(KEY) === 'earth') return 'earth'; } catch { /* private mode */ }
  return 'alien';
}

export const LOOK: LookName = pick();
export const ALIEN = LOOK === 'alien';

// the menus pick their palette from this attribute (see ui.css), and the browser chrome follows
try {
  document.documentElement.dataset.look = LOOK;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', ALIEN ? '#150a2c' : '#0b1030');
} catch { /* no DOM (tests) */ }

/** Remember the choice and reload: the ground colours are baked into the terrain, so a reload is the honest way to switch. */
export function chooseLook(v: LookName): void {
  try { localStorage.setItem(KEY, v); } catch { /* fine */ }
  try {
    const u = new URL(location.href);
    u.searchParams.set('look', v);
    location.href = u.toString();
  } catch { /* fine */ }
}

type RGB = [number, number, number];

/** Luminance to colour: forest goes indigo, meadow and rock plum-rose, dry fields coral, sand peach, snow pale lilac. */
const RAMP: [number, RGB][] = [
  [0.03, [0.055, 0.022, 0.13]],
  [0.10, [0.26, 0.065, 0.30]],
  [0.17, [0.60, 0.15, 0.29]],
  [0.26, [0.90, 0.33, 0.21]],
  [0.42, [1.0, 0.60, 0.38]],
  [0.76, [0.93, 0.84, 0.95]],
];

/** Re-colour an Earth ground colour (linear RGB) for the alien look, in place. */
export function alienGround(c: RGB): void {
  const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  if (L <= RAMP[0]![0]) { c[0] = RAMP[0]![1][0]; c[1] = RAMP[0]![1][1]; c[2] = RAMP[0]![1][2]; return; }
  for (let i = 1; i < RAMP.length; i++) {
    const [l1, a] = RAMP[i]!;
    if (L <= l1) {
      const [l0, b] = RAMP[i - 1]!;
      const t = (L - l0) / (l1 - l0);
      c[0] = b[0] + (a[0] - b[0]) * t; c[1] = b[1] + (a[1] - b[1]) * t; c[2] = b[2] + (a[2] - b[2]) * t;
      return;
    }
  }
  const last = RAMP[RAMP.length - 1]![1];
  c[0] = last[0]; c[1] = last[1]; c[2] = last[2];
}
