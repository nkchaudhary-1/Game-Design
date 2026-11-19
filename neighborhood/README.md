# NEIGHBORHOOD — Prototype 01: Walkable Neighborhood

A persistent, multiplayer, browser-based 3D street. This build is the **exploration slice** from the blueprint (§18):
walk Maple Street, step into homes, climb real stairs, ride a real lift, meet other people. **No heists, no economy, no
ownership yet** — on purpose. The bet of this prototype is *"is this place enjoyable to walk through?"* before any game is layered on top.

```
npm install
npm run dev          # http://localhost:5173  (client + game server, one process, one port)
npm test             # 27 tests: controller, the real map, lift, and a real-WebSocket server suite
npm run build && npm start   # production: static client + game server on $PORT
```

Open it in **two tabs** (or two browsers) to see each other. State lives in `data/world.json` (gitignored).

**Single-file playable demo** (no server, no network — used for the Artifact page):

```
npm run build:artifact    # → dist-artifact/neighborhood-playable.html (~720 kB, fully self-contained)
```

The whole authoritative game server runs inside the page (`src/client/local.ts`), plus three simulated neighbours
(`src/server/bots.ts`) who sit on benches, wave, chat, open doors and ride the lift using the same rules as any player.

## First playable — checklist (blueprint §18)

| Requirement | Status |
|---|---|
| Log in, spawn on Maple Street | ✅ guest identity (name + avatar, token in `localStorage`); spawns at the gate, or where you left off |
| Walk, sprint, jump, rotate camera, zoom | ✅ WASD · Shift · Space · mouse (pointer lock) · wheel; sensitivity/invert/zoom in the pause menu |
| One walkable street, houses both sides, connected roads | ✅ Main Street + Residential Lane, 10 houses, kerbs, crossings, lamps, benches, bins, cars, signs |
| **Two enterable houses** | ✅ No. 12 and No. 13 (mirrored plan): living room, kitchen, bedroom, storage, hall, fenced backyard; real doors |
| **One apartment block, three floors** | ✅ Maple Court: lobby + floors 1–3 + roof terrace, residents' lounge, open unit 1B |
| **Working lift** | ✅ call button, cab panel → floor UI, doors close, cab moves, doors open, indicator, synced for everyone, riders share it |
| **Walkable stairs** | ✅ dog-leg flights with landings, real step collision, no teleporting (asserted in tests) |
| One park | ✅ fountain, playground, community board, benches, hidden garden with a secret |
| **Two+ multiplayer characters, real-time sync** | ✅ client prediction + server reconciliation for you, interpolation for others |
| Doors and basic interactions | ✅ doors, light switches, doorbell/knock, benches & sofas (sit), info objects, 3 hidden collectibles |
| Flat-colour 3D, browser | ✅ palette from §15; no textures; the static street is merged into a few dozen meshes (~105 draw calls/frame measured, including doors, labels and avatars) |
| State persists | ✅ position, collectibles found, light switches, open doors — across disconnects *and* server restarts |

Extras that earn their keep: chat with bubbles, wave/dance emotes, minimap, zone names, synthesized audio (lift hum + ding, doors, birds), auto graphics downgrade.

### A five-minute tour
1. Spawn → walk east. House **No. 12** (north side): press **E** at the door, step in, flip the light switch by the door, find the **Brass Key** in the storage room (back hall → right).
2. House **No. 13** opposite is the same house mirrored.
3. **Maple Court** (south-east): E on the entrance → lobby → lift. Stand in the cab, press **E** at the panel, pick a floor, watch the doors. Floor **1B** is open for viewing. From the 3rd floor take the stairs up to the **roof** for the view (and a **Golden Pigeon** behind the water tank).
4. **Central Park**: sit on a bench (E), wave (1) or dance (2). The east hedge has a gap at the back — the **Hidden Garden** has the third secret.

## Architecture

```
src/shared/   ← runs on BOTH sides, deterministic
  collision.ts   AABB world + kinematic character controller (steps, slopes-by-steps, moving platforms)
  lift.ts        lift state machine + door safety + syncing the cab into the collision world
  map/           the whole world as code: Frame/MB builder → houses, apartment, park, streetscape
  protocol.ts    wire types, avatar palette, input validation helpers
src/server/    ← authoritative
  game.ts        GameWorld: players, input queues, doors, seats, switches, lift, discoveries, snapshots @ 20 Hz
  server.ts      http + ws (+ Vite middleware in dev), 60 Hz fixed-step loop
  store.ts       JSON-file persistence behind a repository-shaped interface
src/client/    ← presentation + prediction
  game.ts        loop, prediction/reconciliation, interpolation, interaction targeting, cut-away
  world3d.ts     merges the map into a few meshes; doors, lamps, lift visuals, labels
  avatar.ts      procedural low-poly person + animation (idle/walk/run/jump/sit/wave/dance)
```

### Decisions and trade-offs

**Authoritative, with shared simulation.** The client predicts with the *same* `stepBody` the server runs, then replays
unacknowledged inputs on every snapshot and smooths the residual. Movement feels instant at any latency, and the server
still owns position, ownership-relevant state, the lift, doors, seats and discoveries. Inputs are clamped (a 1e9 vector
moves you at walk speed — tested) and queues are bounded.

**All-AABB world.** Every collider is an axis-aligned box. That's why client and server agree to the millimetre, why the
controller is ~150 lines, and why stairs are just boxes (step-up 0.46 m, 0.2 m risers). The cost: no slopes/curves; walls
are axis-aligned. For a neighborhood of rectilinear houses that's the right trade. Visual meshes can be curved later while
collision stays boxy.

**The lift is a state machine, not an animation.** `idle → closing → moving → opening`, ease-in/ease-out, doorway
"light curtain" (won't close on a person), queued calls. Riders aren't parented: the cab is a moving solid and the
controller snaps riders to it each step, so multiple riders, jumping inside, and late joiners all just work.

**Server tech: plain `ws` now, Colyseus when we have rooms.** I evaluated Colyseus (what the blueprint leans to). For one
block and a handful of players, a ~300-line loop is simpler to reason about, and the game logic (`GameWorld`) has no
socket knowledge: `join / onMessage / step / snapshot`. Moving it into a Colyseus `Room` is mechanical. **Switch when**
we add multiple blocks (rooms per zone), matchmaking, or reconnection tokens.

**Vite + Three.js, not Next + R3F — yet.** The per-frame loop (prediction, interpolation, camera) fights React's
reconciliation; plain Three is simpler and faster here. Next.js earns its place for accounts, marketplace and profile pages.
The game mounts into any route as a client component later.

**The map is code.** `buildMaple()` is deterministic and runs on server and client, so ids line up with zero sync and
tests can walk the real map. Blender/glTF takes over *visuals* (hero props, avatars) when we have art; keep the box
colliders. One authoring format for collision + visuals is what let this be built and tested fast.

**Persistence is a seam.** `Store` is shaped like a repository (`player(id)`, `setPlayer`, `world`). Swap in Postgres /
Supabase without touching `GameWorld`. Identity is a random token in `localStorage`; the server stores only a hash. Supabase
Auth replaces it when accounts matter. **Don't ship persistence before accounts** — ownership without login is a support
nightmare.

**Cut-away instead of fading roofs.** Walking into a building hides everything *above you* (roofs, upper floors) per
visibility group; the camera ignores hidden geometry. It reads like a doll's house, keeps interiors playable with a third-person
camera, and costs nothing per frame. In the lift the camera rises and looks down into the cab, since a 2 m box has no room behind you.

### Performance
- Static world merged by visibility group with vertex colours (one material per group); no textures. Measured **~105 draw calls/frame** in the two-player tour (doors, labels, lamps and avatars are separate objects) — comfortable, with headroom to instance trees and lamps later.
- Shadow camera follows the player (±36 m, 2048²); point lights are a fixed pool of 6 (changing light count recompiles shaders).
- Spatial-hash colliders; per-frame allocations avoided in the controller. Snapshots are ~40 bytes/player at 20 Hz.
- Auto-downgrades to "Low" (no shadows, DPR 1) if FPS stays under 28 for 4 s. Pause menu has the manual switch.
- **Not yet:** LOD, instancing (trees/lamps are merged, not instanced), zone streaming, binary protocol, interest management.
  None are needed for one block; all become relevant at Block 03+.

### Testing
`npm test` — 27 tests, ~25 s:
- **controller**: walls, no tunnelling at sprint speed, stair up/down with a max 0.2 m step per frame, step/headroom rules, jump height, moving platforms.
- **map**: all spawns valid, the street is walkable end-to-end, world edge holds, door blocks/opens, **walk from the lobby up the stairs through every floor to the roof**, closed lift doors keep you out of the shaft, **lift carries riders between all four floors**.
- **neighbours**: a 7-minute simulated run in which all three complete their routes with no stuck steps, sit, chat, and ride the lift to floor 2 and back.
- **server (real WebSockets)**: two players see each other, authoritative movement, speed-hack clamp, door/seat rules, multi-rider lift trip, restart persistence.

## Deliberately not here (MVP vs later)

| Later phase | Why not now |
|---|---|
| Heist loop, security devices, loot, cooldowns | You said it yourself: make the world enjoyable first. The hooks exist (server validates every interaction; doors/seats/switches are the same pattern as locks/cameras). |
| House ownership, purchase, customization | Needs accounts + economy design. Houses already carry id, group, interior definition. |
| Day/night, weather, NPCs | Cheap to add (server clock → light), but not what proves the walk. |
| Touch controls, gamepad, first-person | Pointer-lock desktop first. |
| Moderation, friends, reporting | **Chat is open and unfiltered in this prototype.** Needs rate/profanity/report tooling before any public link. |

## Hosting
Client and server ship together (`npm run build && npm start`) on any Node host that supports WebSockets (Fly.io, Railway,
Render, a VPS). If the client is on Vercel, set `VITE_WS_URL=wss://your-game-server/ws` at build time and keep the server on a
persistent host — **serverless functions can't hold the game loop**. Env: `PORT`, `DATA_FILE`.

## Product notes (things I'd decide before building the heist layer)
1. **Opt-in raiding.** "Eligible properties" is the most important design lever in the doc. A player who never wants to be
   robbed will quit; a player who *wants* the thrill will tolerate loss caps. Make raid eligibility an explicit house setting
   with visible risk/reward, and keep insurance/cooldowns server-side from day one.
2. **Offline protection is a data-model decision**, not a feature: store `last_online`, `protection_until`, `loss_cap_window`
   on the property now so it is never retrofitted.
3. **Social first.** The strongest retention hook in this prototype is *being somewhere with someone* (benches, lift rides,
   chat bubbles). Watch whether two strangers talk in the lift before building anything else.
4. **Measure**: time-to-first-door, % who ride the lift, % who find ≥1 secret, session length with ≥2 players.
