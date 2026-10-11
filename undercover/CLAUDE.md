# Undercover — architecture rules

Real-time social deduction game (Mafia / Werewolf style). TypeScript everywhere, npm workspaces:
`shared/` (pure engine + protocol), `server/` (Node + `ws`), `client/` (Vite + React). One deployable
service: the server serves the built client and the WebSocket on the same origin.

Spec: `docs/spec.md`. Visual direction: `docs/theme.md` (monochrome noir, strict grayscale).

## Non-negotiable rules

- **Server-authoritative.** Clients send intents (`nightAction`, `castVote`, ...). The server validates,
  decides and broadcasts. Never trust a client for role, phase or outcome.
- **No role leakage.** A client never receives another player's role except through a deliberate reveal:
  traitors see teammates from night 1; an eliminated player's role is public; God sees everyone.
  `viewFor(room, playerId)` in `server/src/game.ts` is the only projection; nothing leaves the server
  around it. Roles must never appear in logs.
- **Pure engine, separate from I/O.** Role counts, assignment, night resolution, vote tally and win check
  are pure functions in `shared/src/engine.ts` with unit tests. The socket layer only calls them.
  The RNG is injected so tests are deterministic.
- **Timers live on the server.** Store and broadcast `timerEndsAt` (epoch ms). Clients render a countdown
  to it. A client clock never ends a phase. `TIMER_SCALE` shrinks timers for simulations only.
- **No timing leaks.** A player without a night power waits as long as one with a power. The night ends
  early only when every connected acting role has confirmed.
- **Render only what the server sent.** The client rebuilds any screen from the latest `roomState` alone,
  so reconnects and server restarts are invisible.

## Commands

```
npm install
npm run build          # shared -> client -> server
npm run dev            # server (tsx watch, :8080) + Vite client (:5173, proxies /ws)
npm test               # shared engine tests + server security/validation tests
npm run simulate       # headless full games: 5/7/9/11 players, bodyguard on/off, player/god, idle clients
npm run simulate:chaos # same with random drops/reconnects
npm run test:restart   # kills the server mid-night against Redis and checks the game resumes
npm run test:e2e       # Playwright: five browsers play a full game (+ God run), screenshots at 375x812
```

## Conventions

- Phase order: `waiting -> roleReveal -> [night -> dayReveal -> discussion -> voting -> voteResult] -> ended`.
- Night 1 has a narrator step; later nights go straight to actions.
- God mode: the host narrates, never plays. God edits and publishes announcements and advances phases.
  In Player mode the announcement is public immediately and advances after a short pause (host may skip).
- Host/God transfers to the earliest-joined connected player after the 90 s grace period.
- Keep secrets out of the repo; `.env` is gitignored. See `.env.example`.
