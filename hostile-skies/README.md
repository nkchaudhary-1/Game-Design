# Hostile Skies

An arcade flight simulator in the browser. You fly the **Sparrow** interceptor against an alien invasion fleet and
defend three coastal cities, across five waves that end with a mothership. Keyboard, mouse, gamepad or touch. No
server, no account, no art assets: everything (terrain, ships, sky, sound) is generated in code.

It lives beside Spinblade Arena and shares its `node_modules`, but builds on its own.

## Run it

```bash
npm install
npm run skies            # dev server: http://localhost:5174
npm run skies:build      # production build into dist-skies/
npm run skies:single     # ONE self-contained file: dist-skies-single/hostile-skies.html (open from disk, or host anywhere)
npm run skies:test       # 34 simulation tests (Vitest)
```

Needs a browser with WebGL. Fonts and everything else are bundled; nothing is fetched at runtime.

## Controls

| | Keyboard / mouse | Gamepad | Touch |
|---|---|---|---|
| Pitch | **S / ↓** up, **W / ↑** down (flight stick; "Arcade" swaps them) | left stick | left stick |
| Bank / roll | **A D / ← →** | left stick | left stick |
| Yaw (fine aim) | **Q E** | right stick X | |
| Throttle | **R F**, mouse wheel | D-pad up/down | auto 70 % |
| Afterburner | **Shift** (limited fuel) | A / LB | BOOST |
| Airbrake | **X** | B / LT | BRAKE |
| Cannon | **Space**, left click | RT | FIRE |
| Missile | **Enter**, **G**, right click | RB | MSL |
| Cycle target | **T** | X | TGT |
| Camera (chase / cockpit) | **C** | Y | CAM |
| Flight assist on / off | **H** | | |
| Mouse steering (cursor = stick) | **V** | | |
| Swap pitch direction | **Y** | | |
| Mute · Pause · Help | **M** · **Esc / P** · **F1** | Start | II |

## The game

**Goal.** Survive five waves and destroy the Leviathan, with as many of the three cities standing as you can. Lose all
three cities, or lose the aircraft, and the mission fails. One life per mission; each wave clear patches 35 % hull,
refills the shield and gives three missiles back.

| Ship | Behaviour | What it asks of you |
|---|---|---|
| **Wisp** | Small, fast swarm drone. Weaving strafing passes, weak bolts. Runs you down if you try to leave. | Short cannon bursts at close range; stay unpredictable. |
| **Lancer** | Alien fighter. Hunts you, fires 3-round bursts, jinks the moment you line it up. | Missiles. Lock, fire, then break. |
| **Harvester** | Slow saucer. Parks over a city and burns it (26 dps, a city has 1 500). Defends itself with slow plasma orbs. | The priority target. Watch the city bars and the red alerts. |
| **Leviathan** | Wave 5. Invulnerable hull, three **shield nodes**, then a **core**. Spawns drones; once the core is exposed it charges a beam that kills a city. | Nodes first, then the core, before the beam lands. Don't hit the hull. |

**Weapons.** *Cannon:* 18 rounds/s, free, heat-limited (hold it and it overheats). A white pipper shows the lead. *Missiles:*
you start with 6 (a resupply can take you to 8), one regenerates every 11 s up to 6, and they need a **lock** (keep the target in the cone until the ring closes; faster when it is centred).
**Defence.** A 100-point shield that recharges after five quiet seconds, then a 100-point hull that does not.

**Scoring.** Kills score by class, multiplied by a **combo** (kills within 5 s of each other, up to ×2.0). Wave-clear bonus
plus a bonus for city health, and a big bonus per surviving city at the end. Best score is remembered per difficulty
(in `localStorage`; everything works without it).

**Difficulty** changes the aliens, not your aircraft: hit points, damage, aim error and lead, rate of fire, group size.
Cadet also adds light cannon **aim assist** (rounds that were already close bend gently onto the selected target).
*Cadet · Pilot (intended) · Ace.* **Flight model** is separate: *Assisted* or *Manual*.

## Demo

**Watch demo** on the title screen (or `?demo`) plays a hands-off reel on the real engine, with the real HUD and sound.
Press any key or tap to fly. Three scenes, about 75 seconds: *Scramble* (wave one: run down a harvester, shake the
drones), *Harvest* (a harvester burning Harbor), *Leviathan* (nodes, core, break-up).

The reel is flown by `src/sim/demo.ts`, a scripted pilot that steers like an alien ship and writes the aircraft state
directly. It is held to 8 g and the real jet's speeds so the HUD stays honest, but the world gives it strong cannon aim
assist, extra damage and fast missile resupply, so every scene lands. It is not a replay of a human, and not a
benchmark of the real fight. The title screen's moving backdrop is the first scene on a loop.

**Record it** with `node hostile-skies/tools/record-demo.mjs` (needs Playwright and ffmpeg; see the header of that file).
The game opened with `?record` steps the reel at a fixed rate and exposes `window.__rec`, so frames are captured one by
one and the sound is rendered offline, which gives a smooth MP4 with audio even on a machine with no GPU.

## Flight model

The jet is rate-commanded (like a fly-by-wire fighter) but everything else is real physics, in `src/sim/aircraft.ts`.

- Lift, induced drag, parasite drag, a stall, thrust (with an afterburner), air density with height, and sideslip all act on
  the velocity vector. Energy is spent in hard turns; slow and nose-high means falling out of the sky.
- Structural limit ~12 g, reachable around 170 m/s; a sustained hard turn is ~35 °/s and bleeds about 8 m/s per second.
- **Assisted** (default): A/D command a *bank angle* (up to 80°; release to level out), turns are coordinated, releasing
  the stick eases the flight path back to level, and an angle-of-attack limiter keeps you out of stalls.
- **Manual**: A/D are a roll *rate*; no auto-level, no limiter. The nose can outrun the flight path.

## Design decisions worth knowing

- **Assisted = bank angle, not roll rate.** The first version used roll rate with auto-level and you could not hold a
  turn (hold A and you barrel-rolled). Bank-angle command is how every approachable flight game solves this; Manual keeps
  the full-roll feel for people who want it.
- **Aliens are kinematic, the player is not.** They steer a heading at a speed with a turn-rate limit. That keeps each
  class readable and learnable, and lets a Wisp out-turn you (it is a drone) without breaking the rules your jet follows.
- **Every threat is legible.** Aliens glow acid green, hostiles are red on the HUD, your instruments are cyan, danger is
  amber/red. Incoming fire that will pass close shows an arrow and sounds a warning; cities under attack call out on
  the HUD and radar.
- **Hit boxes are generous** (+30 % and 3 m on cannon rounds). Small fast targets with a 1 km range need it to be fun.
- **Pure simulation core.** `src/sim` has no DOM, WebGL or audio. It runs unchanged in Vitest, which is how the flight
  model, AI, waves and win/lose rules are tested, and how the title-screen dogfight is driven (the same autopilot).

## Code map

```
hostile-skies/
  index.html  vite.config.ts  tools/inline.mjs  tools/record-demo.mjs
  src/
    main.ts            state machine (title / playing / paused / ended), fixed sub-stepping, wiring
    sim/               PURE simulation (tested)
      demo.ts          the demo reel: scripted pilot + three scenes
      aircraft.ts      flight model + assist
      aliens.ts        ship classes, AI, Leviathan parts
      world.ts         player weapons, projectiles, collisions, cities, waves, scoring, win/lose, events
      terrain.ts       the height function shared by renderer, AI and crash checks; city sites
      difficulty.ts  controls.ts  autopilot.ts  util.ts
    render/            three.js
      view.ts          scene, camera rig, entity sync, event reactions, bloom
      sky.ts terrain.ts cities.ts models.ts particles.ts effects.ts quality.ts
    hud/hud.ts         canvas HUD: conformal ladder / boresight / targets, tapes, radar, warnings
    audio/audio.ts     Web Audio synthesis: engine, wind, alarms, combat pulse, one-shots
    input/input.ts     keyboard, mouse, gamepad, touch -> Controls
    ui/                title / pause / help / result screens + CSS
  tests/sim.test.ts
```

The sim talks to everything else through a single `events` array (explosions, hits, kills, warps, messages). The renderer,
HUD and audio drain it once per frame.

## Tuning

| To change | Where |
|---|---|
| Waves (counts, order) | `WAVES` in `sim/world.ts` |
| Alien hit points, speed, turn rate, score | `ALIEN_SPEC` in `sim/aliens.ts` |
| Alien aggression per difficulty | `TUNING` in `sim/difficulty.ts` |
| Cannon / missile / lock numbers | `CANNON`, `MISSILE`, `LOCK` in `sim/world.ts` |
| Aircraft mass, wing, thrust, g-limit | `JET` in `sim/aircraft.ts` |
| Map, cities, arena size | `terrain.ts` (`CITY_SITES`, `ARENA_RADIUS`, `SPAWN`) |
| Look (sky, fog, palette) | `PALETTE`, `SUN_DIR` in `render/sky.ts` |

## Graphics tiers

`high` (bloom, 4× MSAA, long view), `medium` (bloom), `low` (no bloom, short view). Picked from the GPU; software renderers
and phones start lower; the game steps down by itself if frames stay slow. Force one with `?quality=high|medium|low`.

## QA URL switches

`?demo` (play the reel) · `?record` (fixed-step recorder, see above) · `?autostart` (skip the title) · `?god` (take no damage) · `?wave=5` (start at a wave; 5 = the Leviathan) · `?seed=123` ·
`?quality=low` · `?shot` (keeps the WebGL buffer so headless screenshots are not blank). `window.__game` exposes the
world, view and sound for debugging.

## MVP vs later

**In the MVP:** the full loop (title, five waves, boss, result with stats and best score), three alien classes plus the
boss, assisted and manual flight, chase and cockpit cameras, three input schemes, procedural audio, three graphics tiers,
34 simulation tests.

**Later, in the order I would do it:**
1. *Checkpoint / continue from wave N.* One life over a ~10 minute run is the sharpest edge in the current design.
2. *Tutorial mission.* The help screen and 15 s of hints carry a lot; a 90 s guided first wave would carry them better.
3. *Second map and a night variant.* The terrain function and sky palette are the only places that change.
4. *Cockpit canopy and instruments* (the cockpit view is currently HUD only).
5. *Upgrades between waves* (spend score on missiles, shield, a spread cannon).
6. *Alien variety:* a bomber that targets cities from altitude; a shielded elite.
7. *Replays or a daily seed* (the sim is deterministic for a given seed and input, so both are cheap).

**Known limits.** Mobile is playable but tuned second; the HUD is a canvas, so screen readers get only the menus; one
alien per class is "kinematic" and will not obey player physics; no multiplayer.
