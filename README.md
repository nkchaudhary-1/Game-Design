# Spinblade Arena — MVP

A 3D, top-down spinning-blade duel. Slingshot in, hit hard, and win by **ring-out** (knock them over the
rim) or **spin-out** (drain their spin to zero). Browser only, no server, no account, nothing is stored.

Built from two documents:

* **PRD v2** — *Phase 1: browser-only functional test* (arena + on-page controller pad side by side, vs a CPU).
* **Blades, Types & Skills build spec** — the 21-blade roster, class triangle, Supers, customization, arenas, AI.

The earlier single-file 2D prototype (PRD v1) is kept, still playable, in [`v1-solo/`](v1-solo/README.md).

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build
npm run build:single   # ONE self-contained html file (dist-single/spinblade-arena.html) to open or host anywhere
npm test           # 86 unit/simulation tests (Vitest)
npm run balance    # headless CPU-vs-CPU balance check (see "Balance")
```

Needs a browser with WebGL and WebAssembly. Fonts, art and the physics engine are bundled; nothing is fetched at runtime.

## Controls

| | Pad (mouse / touch) | Keyboard |
|---|---|---|
| **Launch** | press on the pad, **pull back**, release (longer pull = harder launch) | A/D (or ←/→) aim, W/S (↑/↓) power, **Space** |
| **Steer** | drag anywhere on the pad (floating joystick) | WASD / arrows |
| **Move 1** | hold to **charge**, release to fire (charging drains spin) | hold **1** |
| **Move 2 / 3** | tap | **2** / **3** |
| **Super** | big button — shows READY / ACTIVE / RECHARGING | **Space** |
| Pause | pause button | **Esc** |
| Rematch (result screen) | Rematch button | **R** or **Enter** |

Round flow: **Menu → Pre-battle → Launch → Battle → Result (cause + why) → Rematch / Change blade / Hangar**,
with a running session score. The Hangar (all 21 blades) and Workshop (customization) are reachable from the menu.

### Test affordances (PRD Phase 1)

| | |
|---|---|
| **Two-tab mode** | In battle, the phone icon opens the controller in a second tab. It talks to the arena tab over a `BroadcastChannel` — the Phase 2 shape (phone = controller, big screen = display) with the browser standing in for the relay. |
| `?latency=80` | Adds artificial controller→display latency (ms) to feel-test responsiveness. |
| `?reduced=1` | Reduced effects (no hit-stop, calmer camera). Also follows the OS “reduce motion” setting. |
| `?quality=high\|medium\|low` | Force a graphics tier (see "Graphics tiers"). Default is picked from the GPU, then steps down if the frame rate drops. The pause menu has the same switch (it restarts the round). |
| `?shot` | Keeps the WebGL drawing buffer so headless screenshots aren't blank (test aid only). |
| `?screen=hangar&blade=gravion` | Deep-link a screen (`menu`, `hangar`, `workshop`, `lobby`, `battle`). |

## What is in the MVP

| Source | Item | Status |
|---|---|---|
| PRD Ph.1 | Arena + controller pad side by side, vs CPU as P2 | ✅ |
| PRD Ph.1 | Slingshot launch, continuous steering, hold-to-charge / release-to-dash with spin cost + cooldown | ✅ |
| PRD Ph.1 | Controller emits events / display consumes them (transport is swappable) | ✅ `core/InputBus.ts`, two-tab proof |
| PRD Ph.1 | Lobby → battle → result → rematch, running score | ✅ |
| PRD Ph.1 | Two visibly distinct win conditions (+ time-out, double KO) | ✅ banner, cause chip, “why” text |
| Spec §5 | 21-blade roster as data, 9 design ratings, 3 classes | ✅ all 21 browsable in the Hangar |
| Spec §5 | **Playable**: Ravok (Attack), Gravion (Defense), Phantom (Stamina) | ✅ |
| Spec §6–8 | Central Balance: ratings → physics; spin, collision, knockback, ring-out | ✅ `core/Balance.ts` |
| Spec §9 | 3 basic moves per blade | ✅ playable blades hand-built; other 18 are data stubs |
| Spec §10 | Supers: 6–8 s active (never > 8), 10 s recharge, READY/ACTIVE/RECHARGING UI | ✅ 22 implemented (7 + 7 + 8) |
| Spec §11 | 8 arenas as data | ✅ data; **Core Pit playable**, 7 later |
| Spec §12 | Customization: Ring/Core/Weight/Tip, stat trade-offs, compatibility, rarity, unlock level, live preview, build description, Super gating | ✅ ~35 parts |
| Spec §13 | Levels 1–7 | ✅ as a test dial (no XP/progression) |
| Spec §16 | Deterministic AI state machine, Easy/Normal/Hard | ✅ 8 states |
| Spec §14–15 | Class colour language, minimal HUD; look follows the reference pack | ✅ procedural high-poly geometry + generated PBR textures (no art assets in the 3D scene) |
| Spec | Audio events | ✅ synthesised placeholders, swap-by-event-name |
| Spec §21 | The 11 screens | ✅ 9 of 11: Main Menu, Blade Collection (class + rarity filters), Blade Detail, Customization, Super Selection (Supers tab), Pre-Battle, Battle, Victory, Defeat (+ Pause, How-to-play). ⚠ Arena Selection is one row (Core Pit). ❌ Upgrade/Progression (Phase 1 has no persistence; Level is a dial) |
| Later | Networking / QR / 3+ players / persistence / accounts | ⏭ not in Phase 1 by design |
| Later | The other 18 blades’ Supers and moves, 7 arenas, progression, campaign | ⏭ data exists, behaviour doesn’t |

## Graphics tiers

The 3D scene has three tiers (`src/render/quality.ts`). The game picks one from the device, and `BattleScreen` steps down
automatically if the frame rate stays low. Force one with `?quality=`.

| | High | Medium | Low |
|---|---|---|---|
| Blade geometry | lofted fins, bevelled/domed armour plates, bolts, lathe cores — **23k–84k tris per blade** (Phantom 23k, Gravion 33k, Ravok 84k) | 12k–35k | 7k–15k |
| Materials | clear-coat paint, brushed-metal bump/roughness, HDR glow seams | same, smaller maps | plain |
| Arena | PBR concrete floor (generated albedo/normal/roughness), 96-segment rim, rocks, crates, dust | fewer rocks/dust | minimal |
| Shadows / bloom | 2048 shadow map, bloom | 1024 shadow map, bloom | none |
| Max pixel ratio | 2 | 1.5 | 1 |

Every texture is generated at load from canvas noise (no image files), cached per tier and pre-warmed on the menu.
Built and checked in a software-rendered browser only: **frame rate on a real GPU has not been measured.**

## Decisions I made (please review)

1. **3D instead of 2D.** PRD v2 decision DL-1 says 2D. The build spec says 3D top-down (Three.js + Rapier). I followed the
   spec: gameplay is planar, the camera is a fixed top-down angle, so the 2D design intent holds. **DL-1 in the PRD needs updating.**
2. **Level is a dial, not progression.** No persistence means no XP. Level (default 3) is a stepper that unlocks parts/Supers so
   the customization and Super-gating rules can be tested. The CPU gets a stock build at your level.
3. **Time-out rule (PRD open item).** At 3:00, higher spin wins. Rare in practice (see Balance).
4. **Move slots.** Move 1 is the chargeable attack (the PRD’s charge-and-release), Move 2 defensive, Move 3 movement/stance.
5. **Nothing is persisted** — not even mute. Reload = clean state.
6. **Success metrics need a decision.** PRD v2 asks for “responsive < 100 ms, readable, replayable” but Phase 1 has no
   network or analytics. The build measures responsiveness structurally (input → sim in ≤ 1 frame; `?latency=` for feel-tests);
   “readable” and “replayable” need observed play sessions.

## How it is built

```
src/
  core/      Balance (ratings → physics), Physics (Rapier), Battle (display host), InputBus, Input, Rng
  combat/    Match + systems: spin, collision, abilities, supers, effects  — pure TS, no DOM, no Three
  blades/    bladeData (21 blades), abilities, supers, parts, BladeFactory, BladeMesh + shapes (one procedural silhouette per blade)
  arenas/    arenaData (8 arenas), Arena (Core Pit), ArenaView
  ai/        AI state machine + controller (CPU only ever sends controller messages)
  render/ vfx/ audio/   Three.js scene, camera rig, sparks/trails, Web Audio synth
  ui/        screens, controller pad, HUD, previews, session state, copy
  sim/       headless match runner (used by tests and the balance tool)
tests/       Vitest suite + e2e/ (Playwright scripts)
tools/       balance.ts
```

* **Simulation and rendering are separate.** `Match` runs a fixed 120 Hz step and never touches the DOM. The exact
  code that runs in the browser also runs headless in `npm run balance` and the tests.
* **Everything is data.** Blades, moves, Supers, parts and arenas are tables. Effects are reusable primitives
  (`dash, mod, radial, pull, zone, drain, teleport, spin, shield, decoy, slam`). No blade has bespoke gameplay code;
  if a blade feels wrong you change a rating or a Balance curve.
* **One boundary for input.** The pad, the keyboard and the CPU only send `ControllerMsg`s; `Battle` consumes them and
  replies with light `PadFeedback`. Phase 2 swaps the transport (`LocalBus` → WebSocket) and nothing else.
* **No universally best part.** Every non-stock part trades something away; a test enforces it.

## Pace and feel

**Spin time.** A blade left alone keeps spinning for up to three minutes, and the round clock stops a match at 3:00 (the HUD shows
`0:42 / 3:00`). How long depends on the blade's Stamina rating, and the Hangar shows it as *Spin time*:

| Blade | Stamina | Left alone | Typical fight (CPU Normal) |
|---|---|---|---|
| Phantom (Stamina) | 10 | 3:00 | 10 s vs Ravok, 50 s vs Gravion, 55 s mirror |
| Gravion (Defense) | 8 | 2:22 | 47 s vs Ravok, 50 s vs Phantom, 88 s mirror |
| Ravok (Attack) | 5 | 1:48 | 10 s vs Phantom, 47 s vs Gravion, 13 s mirror |

Hits, moves, steering and ring-outs end fights well before the clock does (mean battle ≈ 41 s, was ≈ 19 s; spin lost: decay 35%, moves and
steering 39%, hits 27%). Knobs, all in `core/Balance.ts`: `PACE` (decay speed), `DECAY_PER_STAMINA` (how much Stamina matters),
`ECON` (how hard hits and moves land), `TIMEOUT`, `SUPER_DECAY` (keeps Rage Mode's cost real at the slower pace).

*Why not 3:00 for every blade?* I tried. Slow decay alone made every Attack-vs-Stamina fight a ring-out (97% Ravok), because Phantom's
only trump, outlasting, now lives minutes away while Ravok keeps its pressure the whole time. The counters stay real only when Stamina
decides how long you spin, so the longest spin is Stamina 10. If you want every blade at 3:00, the Attack/Stamina matchup needs a design
decision (weaker first clash, or a real evasion mechanic) rather than a number.

**Control speed.** Blades used to take about a second to move one arena unit (Gravion, 0.4). Steering strength (`CTRL`) is now 2.4×,
Agility separates blades more sharply (`AGI_EXP` 2.0: Phantom is clearly the nimblest, Gravion the slowest), and the wall pull and
hit damage were retuned so faster blades don't ring each other out in two seconds. On top of that the **player's blade gets an
assist** the CPU doesn't: `HUMAN_CTRL` 1.5× and `KICK`, extra acceleration when steering from slow or against the current motion
(sharp starts and turn-arounds at the same top speed). Measured from rest with full steering, after one second: Ravok moves 5 units
(was 1.1), Phantom 7 (was 1.7), Gravion 3.4 (was 0.4). The CPU balance below is measured without the assist, so the triangle is a
CPU-vs-CPU number; against a human the player is a little stronger than the table says. (Putting KICK on the CPU too collapsed every
matchup to a coin flip, because everyone could then dodge everyone.)

**Smoothness.** What changed and why:

* *Rotation* is capped per frame at a third of the gap between two fins (`vfx/motion.ts`), so a fast spin or a slow frame can never
  look like the blade turning backwards (wagon-wheel strobing). Tilt, camera follow and zoom are eased instead of snapping.
* *Steering* is eased over about 35 ms in the simulation (`STEER_SMOOTH`), so a key press or a stick flick isn't a step change in the
  push on the blade. The pad stick has a longer throw (66 px) and a smaller dead zone.
* *Hit-stop* only fires on big hits and never twice within 0.45 s; before, a clash that kept re-contacting froze the game over and over.
* *Frame cost*: the first-battle tier is picked from the GPU (discrete or Apple-silicon GPUs get High, integrated GPUs get Medium,
  software rendering gets Low), High renders at up to 1.5× pixel ratio, the HUD no longer rewrites unchanged text every frame, and the
  game steps down a tier within about 1.2 s of sustained slow frames. Not measured on a real GPU yet.

## Balance

`npm run balance` plays the real simulation CPU-vs-CPU from both seats and checks design targets (triangle strength,
seat neutrality, battle length, ring-out/spin-out mix). Run it after touching any rating, part, move, Super or tuning value.

Latest run (`npm run balance`, CPU Normal, both seats; Level 1 and 7 at 60 battles per pair, Level 3 at 120):

| Row beats column | Level 1 | Level 3 | Level 7 |
|---|---|---|---|
| Ravok (Attack) → Phantom (Stamina) | 82% | 87% | 87% |
| Phantom (Stamina) → Gravion (Defense) | 65% | 73% | 80% |
| Gravion (Defense) → Ravok (Attack) | 80% | 78% | 83% |

* At the default Level 3 **every target passes**. Level 1 passes except Phantom → Gravion, which sits right on the 65% edge. At
  **Level 7** (all Supers unlocked) one mirror drifts to 60%: Level 7 is not tuned, so expect Supers to move results there.
* Every counter is a **real edge, not a lock** (65–88% target, both seats ≥ 55%). The first version of the triangle was 100%/0%,
  and it came back at the slower pace: a steady stat edge in passive decay beats the other blade every time once fights are long.
  Fixed with global knobs (Stamina spread, ±22% match-to-match spin variance, Agility curve, wall pull, hit damage) plus three rating
  nudges (Phantom Weight 4 → 5 and Stability 4 → 7, Gravion Stamina 7 → 8), not per-blade code. Faster controls pushed Ravok → Phantom
  to 97% (a first-clash ring-out) until the Agility curve and Phantom's weight were retuned.
* Mirrors are seat-neutral (52–59% for the bottom seat at Level 3). Mean battle ≈ 41 s; time-outs ≈ 0%; ring-out ≈ 28% of results,
  spin-out ≈ 71%.
* At **Hard** the Attack counter does not hold (Ravok → Phantom 43%) and the Phantom mirror drifts to 40%: Hard needs its own pass.
  Hard beats Easy 83% in the Phantom mirror but only 60% in the Ravok mirror, which is over in ~10 s, before skill shows.
* **Win-condition mix depends on the matchup.** Attack blades ring things out (Ravok vs Phantom: ~82% ring-outs, ≈ 10 s). **Gravion
  never rings anyone out in CPU play** (0%): Defense wins by outlasting (Gravion mirror ≈ 95 s). A human can shove with a charged Bash,
  but expect Defense games to end on spin-out.
* Fights under 6 s are ~17% (mostly Attack-vs-light-blade first-clash ring-outs); the target is < 20%.

## Tests

* `npm test` — data rules (roster, Supers ≤ 8 s / 10 s recharge, no dominant parts), Balance mapping, build/lock logic,
  every one of the 22 Supers through its READY → ACTIVE → RECHARGING → READY cycle, determinism, bus, result copy,
  the 3:00 spin time, steering easing and the per-frame rotation cap.
* `node tests/e2e/flow.mjs` / `two-tab.mjs` — real-browser checks (needs `npm i -D playwright`): slingshot, steering,
  charge, Super, result, rematch, and controller-in-another-tab. They also save screenshots.

## Known limits / next

* **18 blades are data only** (stats, moves, Supers listed as “coming soon”); **7 arenas** are data only.
* **No hazards** yet: `arenas/hazards.ts` is the hook for arena mechanics.
* **Bundle is ~5 MB (1.9 MB gzip)**, mostly the inlined physics WASM. Fine on broadband; lazy-loading physics is the first fix.
* **Visual direction** follows the supplied reference pack (cream paper + navy + red UI, spiral-fin armoured blades, concrete diorama arena). The realism pass made blades and the arena high-poly with physically based materials, but they are still generated in code: they match the references' palette, layering and glow, not their hand-sculpted surface detail. Hero-quality models need real meshes. Every one of the 21 blades has its own silhouette and palette (`blades/shapes.ts`: hooked blades, flame tongues, triple claw, saw ring, axe heads, castle octagon, boulders, orbiting discs, clock, petals, spiral arms…). Only four have reference art; the rest are my interpretation of the roster names and roles.
* The reference art (`src/assets/art/`, cropped by `tools/prep-art.sh`) is used for the Hangar cards, Pre-battle cards and arena thumbnails. The Core Arena reference shows a bunny emblem on the floor; in-game the floor carries the V-chevron instead.
* The CPU is tuned by simulation, not by people. Difficulty needs real playtests.
* Phase 2 (per PRD): WebSocket relay, QR join, controller on a phone, 3+ players — the pad/bus boundary is ready for it.
