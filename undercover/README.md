# Undercover

A real-time social deduction game (Mafia / Werewolf style) for 5 to 11 friends. No accounts: a host
creates a room, shares a link, everyone joins on their phone, roles are dealt in secret, and the game plays
out in night and day rounds. Monochrome film-noir look. One deployable service, one URL. Also playable
with no server at all: one phone passed around the table, or solo against bots.

Spec: [`docs/spec.md`](docs/spec.md). Visual direction: [`docs/theme.md`](docs/theme.md).
Architecture rules for future work: [`CLAUDE.md`](CLAUDE.md). Hosting: [`docs/deploy.md`](docs/deploy.md).

## Stack

TypeScript everywhere, npm workspaces:

| Package | What | Tech |
|---|---|---|
| `shared/` | Pure game engine (role counts, assignment, night resolution, vote tally, win check, traitor-team targeting) and the WebSocket protocol types | TS, Vitest |
| `server/` | Room state machine, personalised `viewFor` projection, server-side timers, reconnect grace, host transfer, in-memory and Redis stores, rate limits, static client serving, Open Graph tags | Node 22, `ws`, zod, ioredis |
| `client/` | Mobile-first UI (max 480 px), noir atmosphere, every screen rebuilt from the server snapshot | Vite, React 19, plain CSS |

## Browser-only play (no server)

```bash
npm install
npm run build:local -w client     # -> client/dist-local/ (static, host it anywhere or open local.html)
```

The page offers **Pass & play** (one phone goes around the table for roles, night moves and secret
ballots, and sits in the middle for discussion and reveals) and **Solo vs bots** (bots join your room and
play legally; God mode lets you narrate). Both run the real room server inside the tab. The online server
also serves this page at `/local.html`.

`node client/tools/local-check.mjs client/dist-local <screenshot-dir>` plays both modes end to end in Chromium.

## Online play (one service, one URL)

```bash
npm install
npm run dev          # server on :8080, Vite on :5173 (proxies /ws). Open http://localhost:5173
# or a production build on one port:
npm run build && npm start     # http://localhost:8080
```

Open the URL on several phones or tabs. The host creates a room; others open `/join/CODE`.
Hosting steps for Fly.io, Railway, Render or Docker are in `docs/deploy.md`.

## Verify

```bash
npm test               # 39 engine tests + 14 server tests (role-leak scan over a full 9-player game, action validation)
npm run simulate       # 16 headless games: 5/7/9/11 players, Bodyguard on/off, Player and God mode, idle clients
npm run simulate:chaos # same games with random disconnects and rejoins
npm run test:restart   # throwaway Redis: kill the server mid-night, boot a new one, game resumes and ends
npm run test:e2e       # Playwright: 5 phones play a full game, a God-mode game, and a mid-game reload
npm run smoke -- https://your-deployed-url   # create, join, start against a live deploy
```

Playwright screenshots of every screen at 375×812 land in `client/e2e/screenshots/`.

## Rules in brief

- 5 to 6 players: 1 Traitor, 1 Doctor. 7 to 9: 2 Traitors, 1 Doctor, 1 Police. 10 to 11: 3 Traitors, 1 Doctor,
  1 Police. Bodyguard is optional from 7 players. Everyone else is Innocent.
- Night: Traitors agree on a kill, Doctor protects, Bodyguard guards, Police investigates. Doctor beats
  Bodyguard; Bodyguard dies in place of their charge.
- Day: public reveal of who died (never why), timed discussion, one vote each with a live tally, plurality
  eliminates and reveals the role. Ties eliminate nobody.
- Traitors win at parity or better. Town wins when every Traitor is gone.
- God mode: the host narrates, sees everything, writes the announcements, never plays.

Full rules are on the in-app Rules page.
