# Undercover — complete Claude Code build prompt

Paste everything below the line into a fresh Claude Code session in an empty project folder. It is self-contained. If `client/prototype-reference.html` (a working solo prototype) exists in the folder, treat it as the reference for look, copy and game logic; otherwise the spec below is the source of truth.

---

## Task

Build **Undercover**, a real-time social deduction web game (Mafia/Werewolf style), as a mobile-first web app, then get it hosted at a public URL. No login. A host creates a room, shares a link, friends join on their phones, roles are assigned secretly, and the game plays out in night/day rounds.

Work in the five phases below, in order. At the end of each phase, run its verification, then post a short report (built, files, commands run and results, defaults you took, anything inferred) and continue. Stop and ask only if a decision is expensive to undo and the spec doesn't settle it. Otherwise take the stated default and flag it.

## Stack

TypeScript everywhere. npm workspaces: `shared/` (game engine + protocol types), `server/` (Node, `ws`), `client/` (Vite + React). `vitest` for tests, `playwright` for end-to-end. The server also serves the built client, so the whole app is **one deployable service and one URL**. Redis is added for persistence in Phase 4.

## Architecture rules (non-negotiable)

- **Server-authoritative.** Clients send intents (`nightAction`, `castVote`). The server validates, decides and broadcasts. Never trust a client for role, phase or outcome.
- **No role leakage.** A client never receives another player's role, except through a deliberate reveal: traitors see teammates on night 1; an eliminated player's role is revealed publicly; God sees everyone. Build one `viewFor(room, playerId)` projection; nothing leaves the server around it. Roles must not appear in logs.
- **Pure engine, separate from I/O.** Role counts, role assignment, night resolution, vote tally and win check are pure functions in `shared/engine` with unit tests. The socket layer only calls them. Inject the RNG so tests are deterministic.
- **Timers live on the server.** Store and broadcast `timerEndsAt` (epoch ms). Clients render a countdown to it. Never let a client clock end a phase.
- **No timing leaks.** A player with no night power waits as long as one with a power. The night ends early only when every acting role has confirmed.

## Game rules

### Setup
- No accounts. Name + color picked at create/join. A "shuffle" button suggests a funny name; the player can edit it.
- Room code: 6 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. Invite link `/join/{code}`.
- Host chooses: mode (**Player** or **God**), target player count (5 / 7 / 9 / 11), optional Bodyguard (only if count >= 7), optional custom discussion minutes.
- **God mode:** the host is a narrator, not a player. God sees every role, never votes, can't be eliminated.
- The host can start with >= 5 joined; roles scale to the actual count. Cap 11 players (+ God).

### Roles

| Players | Traitor | Doctor | Police | Bodyguard (optional) |
|---|---|---|---|---|
| <= 6 | 1 | 1 | 0 | never (needs >= 7) |
| 7-9 | 2 | 1 | 1 | +1 if enabled |
| 10+ | 3 | 1 | 1 | +1 if enabled |

The rest are Innocent. Assignment is random and server-side, after the host starts.

- **Traitor:** kills one non-traitor each night as a team, on a timer. Wins when alive traitors >= alive non-traitors.
- **Doctor:** protects one alive player each night, self allowed.
- **Bodyguard:** guards one alive player each night, self allowed. If that player is the traitors' target, the Bodyguard dies instead and the target lives.
- **Police:** investigates one other alive player each night and privately learns "Traitor" or "not a Traitor". May share or lie about it in discussion.
- **Innocent:** no night power. Wins by voting out every Traitor.

### Phases

`waiting -> roleReveal -> [night -> dayReveal -> discussion -> voting -> voteResult] loop -> ended`

**Night.** Night 1 starts with a narrator step: "Everyone, close your eyes." Traitors (only) see their fellow traitors once; everyone else sees "you see nothing." Then each role with a power submits one private choice. Button verbs: **Kill / Protect / Guard / Investigate** (selected: Marked / Protecting / Guarding / Investigating). Confirm CTAs: "Confirm the kill", "Confirm protection", "Confirm the guard", "Confirm investigation". Traitors can't target traitors; Police can't investigate themselves. Traitor kill timer: 30s (<=6 players), 45s (<=9), 60s (10+).

**Traitor team coordination.** Every traitor sees every teammate's current pick live ("Your team's picks"). Picks can change until the timer ends or all traitors have confirmed. Final target = the pick with the most traitor votes; ties go to the earliest-submitted pick among the tied targets; if nobody picked, a random non-traitor.

**Night resolution priority:** (1) if the Doctor protected the target, the attack fails and nobody dies, not even a Bodyguard guarding them; (2) else if the Bodyguard guarded the target, the Bodyguard dies and the target survives; (3) else the target dies. Traitors never target teammates, so guarding or protecting a traitor is always wasted. That's intended.

**Day reveal.** Public message only: "{name} did not survive the night." or "Everyone wakes up. No one was harmed last night." Never reveal why. Police's result stays private.

**Discussion.** Timed: 3:00 (<=6 players), 5:00 (<=9), 7:00 (10+), or the host's custom minutes. Auto-advances to voting at zero. The host/God may advance early. No in-game chat in v1.

**Voting.** One vote per alive player, no self-votes, no changing. **Live tally:** everyone sees "Votes cast N / total" and a running count per player as votes land (counts only, never who voted for whom). Plurality eliminates; **a tie eliminates no one.** The eliminated player's role is revealed publicly. Voting timer 60s; non-voters abstain.

**Win check** after every night kill and every vote: Traitors win when alive traitors >= alive non-traitors; Town wins when zero traitors remain. Game end reveals all roles.

### God mode
Real players still submit their own night actions. God sees a live roster with roles, then a private breakdown after each night ("Traitors (names) targeted X / Doctor protected Y / Bodyguard guarded Z / Police investigated W, result R / Outcome: ..."). God **writes or edits** the public announcement for each death and each vote result (pre-filled default text); that text is what players see. God advances phases.

### Explicitly out of scope
Mister X (undefined), the "accuse and check a role" mechanic (cut on purpose), accounts, in-game chat, push notifications, history/stats.

## Look and feel

Mobile first, max width 480px, fixed top bar (wordmark "Undercover" + day chip + **Rules** pill on every screen except Rules; Rules returns to the exact previous screen), sticky bottom CTA bar, safe-area insets, tap targets >= 44px, no horizontal scroll at 360px. Dark theme: background `#0B0B10`, surface `#15151C`, raised `#1C1C26`, border `#2A2A36`, text `#F3F1EA`, secondary `#9C9CAC`. Role colors: traitor `#E24B4A`, doctor `#4FBF9F`, police `#5B8DEF`, bodyguard `#F0A667`, god `#E9C77E`. Fraunces (light italic) for narration lines, Inter for UI. A role is never signaled by color alone; always show its name. Countdown bars turn red in the last 10s (night) / 30s (discussion).

## Phases

### Phase 1 — Engine (`shared/`)
Implement and unit-test: `roleCounts`, `assignRoles`, `resolveNight`, `tallyVotes`, `checkWin`, timer durations by player count, and the traitor-team target rule. Tests must cover: Doctor save beats Bodyguard on the same target; Bodyguard dies instead of the target; tie eliminates no one; every win-condition edge (2 traitors vs 2 others => Traitors win); Bodyguard never assigned below 7; role counts at 5, 6, 7, 9, 10, 11; traitor-team ties and empty picks. Define the full WebSocket protocol as a discriminated union in `shared/protocol.ts`.
**Done when:** `npm test` passes.

### Phase 2 — Room server (`server/`)
State machine per room as above; per-socket personalized `roomState`; server timers with `timerEndsAt`; auto-resolve on timeout (random legal target for the traitor team, no-op for other roles, abstain for votes); validation of every action (right role, alive, legal target, right phase); `voteTally` broadcast after each vote; God flows; schema validation of inbound messages (zod); name hygiene (trim, length cap, de-duplicate); rate limits on room creation and joins.
Security tests that must exist: (1) scan every message sent to each ordinary non-God, non-traitor socket across a full 9-player game, with no other player's role appearing before that player's elimination or the game's end; (2) a wrong-role or dead-player action gets an `error` and changes nothing.
`npm run simulate` spawns the server plus N headless clients (5, 7, 9, 11 players; Bodyguard on/off; Player and God mode), plays full games with legal actions, and asserts each reaches `gameEnd`. Include a run where one client never acts (use `TIMER_SCALE` to shorten timers).
**Done when:** tests and simulation pass.

### Phase 3 — Client (`client/`)
Landing/create screen (mode, name + color, player count, Bodyguard toggle disabled under 7, discussion-minutes override, "Read the full rules" link) and `/join/:code` join screen. Then: waiting room (code, invite link + Copy, live joined list, host-only Start at >= 5) -> role reveal (role tag, flavor line, plain power text) -> night 1 narrator -> night action (one reusable screen with role verbs, traitor team-picks panel and kill timer) -> day reveal -> discussion (countdown) -> voting -> live tally -> vote result -> game end; plus the God screens (roster, night control with breakdown, editable announcement textarea). A Rules page with the full rules per role. A connection banner ("Reconnecting...") with backoff retry. Server errors show inline near the control, never silent. Persist `{roomCode, playerId, secret}` in `localStorage`. Render only what the server sent.
Playwright: 5 browser contexts play a full game against the real server (plus one God-mode run), asserting each context only ever shows its own role. Screenshot every screen at 375x812 and check for overflow and clipped text.
**Done when:** Playwright passes and five tabs can create, join via link and finish a game.

### Phase 4 — Reconnect and persistence
On socket close, keep the player's slot for a grace period (default 90s), flag them disconnected publicly, and let a returning client rebind with `{roomCode, playerId, secret}` and receive a full personalized snapshot (phase, `timerEndsAt`, own role and private info, votes cast so far). The client rebuilds any screen from that snapshot alone. A player who never returns is a non-actor (auto-resolved at timeout, abstains, never blocks the game). If the host/God is gone past the grace period, transfer to the earliest-joined connected player and announce it. A wrong `secret` can't take over a slot.
Add a `RoomStore` interface with the in-memory implementation and a Redis one; persist on every transition; re-arm timers from `timerEndsAt` on boot so a server restart mid-game resumes. TTL: idle rooms 3h, ended games 15m, with a sweeper.
**Verify:** a chaos simulation where random clients drop and reconnect, all games still ending validly; a restart test that kills the server mid-night and confirms the game resumes.

### Phase 5 — Deploy
Make it one service: the Node server serves the built client and the WebSocket on the same origin (`wss://`). Provide a `Dockerfile`, `.env.example` (`PORT`, `REDIS_URL`, `ALLOWED_ORIGINS`), a `/healthz` endpoint, and `docs/deploy.md` with exact steps for **Fly.io** (default; Railway or Render are acceptable alternatives) plus a managed Redis (Upstash). Add Open Graph tags so `/join/:code` links preview well in WhatsApp/iMessage. Deploy it and give me the URL. **Ask me for any account or credentials; never invent them.** Run a smoke test against the deployed URL (create room, join with a second client, start a game).
**Done when:** I can open the URL on my phone, share a link, and play a game with friends.

## Working agreements
- Restate the plan in a few lines before each phase. Verify, don't claim: run the tests and simulations and report what you actually ran.
- Open decisions and their defaults: host may start at >= 5 players (not only when full); eliminated players see public events only; player-chosen names with a shuffle suggestion; host/God transfers on disconnect.
- Keep secrets out of the repo; add `.env` to `.gitignore`.
- Keep a `CLAUDE.md` in the repo root capturing the architecture rules above so later sessions don't drift.

## Final report
What was built per phase, the deployed URL, commands run and results, defaults taken, and known limitations.
