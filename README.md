# Spinblade Arena

A browser-based, physics-driven spinning-top battler. One self-contained page, Canvas 2D + vanilla JS,
no install, no account, no backend, no network calls. Built from the *Spinblade Arena PRD* (MVP slice).

## Play

Open `index.html` in any modern browser, or serve the folder (`npx serve .`). Once loaded it keeps working
offline (a tiny service worker caches the page when it is served over http/https).

| | Touch / mouse | Keyboard |
|---|---|---|
| Pick a blade | tap a card | ← → on the cards, **Enter** to start |
| Aim + charge | press, **pull back**, release (longer pull = more power) | ← → aim, ↑ ↓ power, **Space** to launch |
| Steer (light) | press and drag anywhere | WASD / arrows |
| Mute | speaker button | **M** |
| Back to blade select | “Blades” button | **Esc** |

**The loop:** choose blade → aim + charge → physics battle → result (with *why*) → rematch / change blade.

**The counter-triangle:** Striker (Attack) beats Vortex (Stamina) beats Aegis (Defense) beats Striker.
Win by **ring-out** (pushed past the rim) or **spin-out** (spin hits zero).

## Files

| File | What |
|---|---|
| `index.html` | The whole game: design tokens + layout (CSS), the pure simulation (`SIM` block), rendering, input, audio, flow. Orbitron + Rajdhani are embedded as base64 latin subsets (SIL OFL), so nothing is fetched at runtime. |
| `sw.js` | Offline cache. Network-first, so a new deploy is never stuck behind a stale copy. |
| `tools/balance.mjs` | Headless balance check. Runs the `SIM` block from `index.html` CPU-vs-CPU. |

## Tuning and balance

Every tunable lives in the `T` and `BLADES` objects at the top of the `SIM` block in `index.html`, with a
comment on each. After changing any of them:

```
node tools/balance.mjs                      # 300 battles per matchup, pass/fail against the design targets
node tools/balance.mjs -n 1000 -s 4242      # more battles / a different seed block
node tools/balance.mjs --set DRAG=1.4       # try an override without editing the file
node tools/balance.mjs --brief              # one-line summary, handy for sweeps
```

It checks that each counter wins from **both** seats (the player always sits at the bottom, so a seat bias
would be a real bug: one was found and fixed during the build), mirrors are coin-flips, fights are neither
instant nor endless, ring-outs and spin-outs both occur, and a full-power launch can never ring itself out.

Steering is the PRD's DL-2 knob: `STEER_COST` (what agency costs in spin) and each blade's `accel`. The CPU
steers with exactly the same acceleration and spin cost as the player. It has no dash or other advantage.

## How the build maps to the PRD

| PRD requirement | Where / how |
|---|---|
| 3 blades, counter-triangle | `BLADES`; triangle emerges from knockback (atk ÷ def), spin damage (atk ÷ def^1.85), mass, decay |
| Aim + charge via drag | Pull-back slingshot (touch/mouse) and keyboard; launch speed is capped and blades spawn at mid-radius |
| Physics: momentum collisions, spin decay, attack/defense modifiers, bowl | `SIM`: fixed 120 Hz step, impulse collisions, spin decay, bowl pull + swirl, contact kick |
| Ring-out + spin-out | Both implemented; result screen names the cause in a chip, a sentence and a banner at the moment it happens |
| Double KO → tiebreak by remaining spin, equal → draw | Implemented. A second ring-out within 0.1 s counts as the same moment; two blades running dry on the same tick are compared on the spin they had going in |
| CPU with per-archetype behaviour | Chase (Striker) / hold centre + intercept (Aegis) / evade, dodge and hit-and-run (Vortex) |
| Running score, rematch, change blade | HUD score persists for the session; rematch keeps both blades |
| Game feel | Sparks, shock rings, screen shake, hit-stop, spin streaks and trails, synthesised SFX, mute (persisted) |
| 60 fps on mid-tier phones | Cached static layers and sprites, no per-frame shadows, capped particles, automatic FX downgrade if frames run slow |
| Offline, no backend, no PII, no network | Single file + service worker; the only request is the page itself |
| Reduced motion | Follows `prefers-reduced-motion`: no shake, sparks or hit-stop; the loop stays fully playable |
| One screen, ~360 px, portrait + landscape | Grid layout; arena scales to the free area. Checked from 320×568 to 1280×800 |
| Legibility is a hard requirement | Spin meters in the HUD, rim danger glow, low-spin wobble + pulse, rising/falling hum, slow-mo + banner on the KO, loser marked, “why” line on the result |

### Open items: defaults taken

| PRD open question | Default implemented |
|---|---|
| Match timeout? | **60 s → higher spin wins** (`T.TIMEOUT`). Almost never reached (typical fight 15–40 s) |
| CPU difficulty scaling? | One fixed difficulty (`AI_PERIOD`, `AI_NOISE`) |
| Mirror matches? | Allowed; the CPU picks a random blade |
| Portfolio or product? | Built as a craft piece: no analytics, no accounts |

### Additions beyond the PRD (small, all removable)

- **Wall grip scales with spin** (`GRIP_MIN`): high-spin blades ride the wall, low-spin blades slide off it. It makes ring-outs a consequence of spin loss rather than a launch lottery.
- **Contact kick** (`CLASH_KICK`): contact always pushes blades apart, so two blades can't jam at the centre.
- **Hit-stop** on heavy collisions (a few tens of ms): the cheapest way to buy “collision weight”.
- **“No contact” tip** on the result screen when a loss had zero hits, since that usually means the player didn't realise they can steer.

## Measuring success

The PRD's metrics are play-again rate, battles per session and time-to-first-launch. They are recorded
**locally only** (the PRD forbids network calls). Append `?debug` to the URL for an on-screen panel (fps,
slow frames, battles, rematch %, time-to-first-launch) and `window.__spinblade` for the raw counters.
Collecting them from real players needs a decision the PRD doesn't make: see the note in the hand-off.

## Watch in playtest

- **Ring-outs are mostly Striker's win condition.** In CPU-vs-CPU runs they are ~15% of decisive results. Humans push opponents towards the wall on purpose, so expect more; if not, loosen `LIP` / raise `KB_EXP`.
- **Counters are strong in CPU-vs-CPU (~100%)** but not locks for people: a mediocre chasing player lands around 35–50% depending on the blade. Check the human numbers.
- **Does steering read as skill or noise?** (the PRD's own flag on DL-2). A passive player does follow the triangle, so steering has to earn its keep. Tune with `STEER_COST` and `accel`.
- The Vortex mirror can be a long stand-off (~45 s) because two evaders only engage when one falls behind.
