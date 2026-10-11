/**
 * Room state machine. Every function here mutates the given RoomState and
 * returns nothing or a result; persistence, broadcasting and real timers live in
 * RoomManager. The pure rules (roles, night resolution, votes, win) come from
 * @undercover/shared and are only *called* here.
 */
import {
  assignRoles,
  checkWin,
  discussionTimerMs,
  MAX_PLAYERS,
  MIN_PLAYERS,
  NARRATOR_TIMER_MS,
  nightTimerMs,
  resolveNight,
  resolveTraitorTarget,
  REVEAL_PAUSE_MS,
  ROLE_NAMES,
  ROLE_REVEAL_TIMER_MS,
  tallyVotes,
  VOTING_TIMER_MS,
  type ErrorCode,
  type GodNightBreakdown,
  type NightView,
  type PlayerColor,
  type Rng,
  type Role,
  type RoomSettings,
  type RoomView,
  type TraitorPick,
  type VoteTallyView,
} from '@undercover/shared';
import { alivePlayers, findPlayer, gamePlayers, playerName, rolesOf, type PlayerState, type RoomState, type TimerState } from './state.js';

function withArticle(role: Role): string {
  return `${role === 'innocent' ? 'an' : 'the'} ${ROLE_NAMES[role]}`;
}

export class GameError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface Clock {
  now(): number;
  /** Multiplier applied to all timer durations (TIMER_SCALE). */
  scale: number;
  /** Optional per-timer multiplier (pass-and-play keeps discussion real and parks the rest). */
  scaleFor?(kind: TimerState['kind']): number;
}

export const realClock: Clock = {
  now: () => Date.now(),
  scale: Number((typeof process !== 'undefined' && process.env ? process.env.TIMER_SCALE : undefined) ?? '1') || 1,
};

function setTimer(room: RoomState, clock: Clock, kind: TimerState['kind'], ms: number): void {
  const total = Math.max(250, Math.round(ms * (clock.scaleFor?.(kind) ?? clock.scale)));
  room.timer = { kind, endsAt: clock.now() + total, totalMs: total };
}

function touch(room: RoomState, clock: Clock): void {
  room.updatedAt = clock.now();
}

// ---------------------------------------------------------------------------
// Room creation and lobby
// ---------------------------------------------------------------------------

export function createRoom(
  code: string,
  host: { id: string; name: string; color: PlayerColor; secret: string },
  settings: RoomSettings,
  clock: Clock,
): RoomState {
  const now = clock.now();
  const room: RoomState = {
    code,
    createdAt: now,
    updatedAt: now,
    settings,
    mode: settings.mode,
    hostId: host.id,
    godId: settings.mode === 'god' ? host.id : null,
    phase: 'waiting',
    day: 0,
    players: [],
    timer: null,
    acks: [],
    night: null,
    lastNight: null,
    votes: {},
    announcement: null,
    pendingAnnouncement: null,
    lastVoteResult: null,
    policeFindings: [],
    log: [],
    winner: null,
    traitorsRevealed: false,
  };
  addPlayer(room, host, clock);
  return room;
}

export function addPlayer(room: RoomState, p: { id: string; name: string; color: PlayerColor; secret: string }, clock: Clock): PlayerState {
  if (room.phase !== 'waiting') throw new GameError('gameStarted', 'This game has already started.');
  if (gamePlayers(room).length >= MAX_PLAYERS && p.id !== room.godId) throw new GameError('roomFull', 'This room is full.');
  const player: PlayerState = {
    id: p.id,
    name: p.name,
    color: p.color,
    secret: p.secret,
    joinedAt: clock.now(),
    connected: true,
    disconnectedAt: null,
    alive: true,
    role: null,
  };
  room.players.push(player);
  touch(room, clock);
  return player;
}

export function removePlayer(room: RoomState, playerId: string, clock: Clock): void {
  const idx = room.players.findIndex((p) => p.id === playerId);
  if (idx === -1) return;
  const [gone] = room.players.splice(idx, 1);
  room.acks = room.acks.filter((id) => id !== playerId);
  if (room.phase === 'waiting' && room.hostId === playerId) {
    transferHost(room, clock, `${gone.name} left.`);
  }
  touch(room, clock);
}

/** Give host controls to the earliest-joined connected player. */
export function transferHost(room: RoomState, clock: Clock, prefix?: string): boolean {
  const candidates = room.players
    .filter((p) => p.connected && p.id !== room.hostId && (room.mode === 'player' || p.id !== room.godId))
    .sort((a, b) => a.joinedAt - b.joinedAt);
  const next = candidates[0];
  if (!next) return false;
  room.hostId = next.id;
  room.log.push(`${prefix ? prefix + ' ' : ''}${next.name} is now the host.`);
  touch(room, clock);
  return true;
}

export function isController(room: RoomState, playerId: string): boolean {
  return room.hostId === playerId || (room.godId !== null && room.godId === playerId);
}

// ---------------------------------------------------------------------------
// Start and role reveal
// ---------------------------------------------------------------------------

export function startGame(room: RoomState, byId: string, rng: Rng, clock: Clock): void {
  if (!isController(room, byId)) throw new GameError('notHost', 'Only the host can start the game.');
  if (room.phase !== 'waiting') throw new GameError('wrongPhase', 'The game has already started.');
  const players = gamePlayers(room);
  if (players.length < MIN_PLAYERS) throw new GameError('tooFewPlayers', `You need at least ${MIN_PLAYERS} players.`);
  const roles = assignRoles(
    players.map((p) => p.id),
    room.settings.bodyguard,
    rng,
  );
  for (const p of players) {
    p.role = roles[p.id];
    p.alive = true;
  }
  room.phase = 'roleReveal';
  room.day = 0;
  room.acks = [];
  room.log.push(`The game begins with ${players.length} players.`);
  setTimer(room, clock, 'roleReveal', ROLE_REVEAL_TIMER_MS);
  touch(room, clock);
}

/** Players who must acknowledge a step before it may end early. */
function ackers(room: RoomState): PlayerState[] {
  return alivePlayers(room).filter((p) => p.connected);
}

function allAcked(room: RoomState): boolean {
  const need = ackers(room);
  return need.length > 0 && need.every((p) => room.acks.includes(p.id));
}

export function ackReveal(room: RoomState, playerId: string, clock: Clock): boolean {
  if (room.phase !== 'roleReveal') throw new GameError('wrongPhase', 'Not the role reveal.');
  if (!room.acks.includes(playerId)) room.acks.push(playerId);
  touch(room, clock);
  if (allAcked(room)) {
    beginNight(room, clock);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Night
// ---------------------------------------------------------------------------

export function beginNight(room: RoomState, clock: Clock): void {
  room.day += 1;
  room.phase = 'night';
  room.acks = [];
  room.votes = {};
  room.announcement = null;
  room.pendingAnnouncement = null;
  room.lastVoteResult = null;
  room.night = { step: room.day === 1 ? 'narrator' : 'action', picks: {}, seq: 0 };
  if (room.night.step === 'narrator') {
    room.traitorsRevealed = true;
    setTimer(room, clock, 'narrator', NARRATOR_TIMER_MS);
  } else {
    setTimer(room, clock, 'night', nightTimerMs(gamePlayers(room).length));
  }
  room.log.push(`Night ${room.day} falls over the city.`);
  touch(room, clock);
}

export function ackNarrator(room: RoomState, playerId: string, clock: Clock): boolean {
  if (room.phase !== 'night' || room.night?.step !== 'narrator') throw new GameError('wrongPhase', 'Not the narrator step.');
  if (!room.acks.includes(playerId)) room.acks.push(playerId);
  touch(room, clock);
  if (allAcked(room)) {
    beginNightAction(room, clock);
    return true;
  }
  return false;
}

export function beginNightAction(room: RoomState, clock: Clock): void {
  if (!room.night) return;
  room.night.step = 'action';
  room.acks = [];
  setTimer(room, clock, 'night', nightTimerMs(gamePlayers(room).length));
  touch(room, clock);
}

export function hasNightPower(role: Role | null): boolean {
  return role === 'traitor' || role === 'doctor' || role === 'police' || role === 'bodyguard';
}

export function legalNightTargets(room: RoomState, actor: PlayerState): string[] {
  const alive = alivePlayers(room);
  switch (actor.role) {
    case 'traitor':
      return alive.filter((p) => p.role !== 'traitor').map((p) => p.id);
    case 'doctor':
    case 'bodyguard':
      return alive.map((p) => p.id);
    case 'police':
      return alive.filter((p) => p.id !== actor.id).map((p) => p.id);
    default:
      return [];
  }
}

/** Submit or change a night pick. Returns true when the night resolved as a result. */
export function nightAction(room: RoomState, playerId: string, targetId: string | null, confirm: boolean, rng: Rng, clock: Clock): boolean {
  if (room.phase !== 'night' || !room.night || room.night.step !== 'action') throw new GameError('wrongPhase', 'It is not time to act.');
  const actor = findPlayer(room, playerId);
  if (!actor || playerId === room.godId) throw new GameError('notInRoom', 'You are not a player in this game.');
  if (!actor.alive) throw new GameError('notAlive', 'The dead do not act.');
  if (!hasNightPower(actor.role)) throw new GameError('wrongRole', 'You have no night power.');
  const current = room.night.picks[playerId];
  if (current?.confirmed) throw new GameError('alreadyActed', 'You have already confirmed your choice.');
  if (targetId !== null && !legalNightTargets(room, actor).includes(targetId)) {
    throw new GameError('illegalTarget', 'You cannot choose that player.');
  }
  if (confirm && targetId === null) throw new GameError('illegalTarget', 'Choose someone first.');
  room.night.seq += 1;
  room.night.picks[playerId] = { targetId, confirmed: confirm, submittedAt: room.night.seq };
  touch(room, clock);
  if (allActorsConfirmed(room)) {
    resolveNightPhase(room, rng, clock);
    return true;
  }
  return false;
}

function actors(room: RoomState): PlayerState[] {
  return alivePlayers(room).filter((p) => hasNightPower(p.role));
}

function allActorsConfirmed(room: RoomState): boolean {
  if (!room.night) return false;
  const need = actors(room).filter((p) => p.connected);
  return need.every((p) => room.night!.picks[p.id]?.confirmed);
}

/** Resolve the night with whatever picks exist (auto-resolve on timeout). */
export function resolveNightPhase(room: RoomState, rng: Rng, clock: Clock): void {
  if (room.phase !== 'night' || !room.night) return;
  const alive = alivePlayers(room);
  const traitors = alive.filter((p) => p.role === 'traitor');
  const doctor = alive.find((p) => p.role === 'doctor') ?? null;
  const bodyguard = alive.find((p) => p.role === 'bodyguard') ?? null;
  const police = alive.find((p) => p.role === 'police') ?? null;

  const picks: TraitorPick[] = traitors.map((t) => {
    const p = room.night!.picks[t.id];
    return { traitorId: t.id, targetId: p?.targetId ?? null, submittedAt: p?.submittedAt ?? Number.MAX_SAFE_INTEGER };
  });
  const legal = alive.filter((p) => p.role !== 'traitor').map((p) => p.id);
  const traitorTarget = traitors.length > 0 ? resolveTraitorTarget(picks, legal, rng) : null;

  const pickOf = (p: PlayerState | null) => (p ? room.night!.picks[p.id]?.targetId ?? null : null);
  const roles = rolesOf(room);
  const outcome = resolveNight(
    {
      traitorTarget,
      doctorProtect: pickOf(doctor),
      bodyguardId: bodyguard?.id ?? null,
      bodyguardGuard: pickOf(bodyguard),
      policeId: police?.id ?? null,
      policeInvestigate: pickOf(police),
    },
    roles,
  );

  if (outcome.policeResult) {
    room.policeFindings.push({ day: room.day, ...outcome.policeResult });
  }
  if (outcome.killedId) {
    const victim = findPlayer(room, outcome.killedId);
    if (victim) victim.alive = false;
  }

  const outcomeText =
    outcome.reason === 'killed'
      ? `${playerName(room, outcome.killedId)} was killed.`
      : outcome.reason === 'doctorSaved'
        ? `${playerName(room, traitorTarget)} was attacked but the Doctor saved them.`
        : outcome.reason === 'bodyguardDied'
          ? `${playerName(room, traitorTarget)} was attacked; the Bodyguard ${playerName(room, outcome.killedId)} died in their place.`
          : 'No attack was made.';

  const breakdown: GodNightBreakdown = {
    traitors: traitors.map((t) => t.id),
    traitorTarget,
    doctorId: doctor?.id ?? null,
    doctorProtect: pickOf(doctor),
    bodyguardId: bodyguard?.id ?? null,
    bodyguardGuard: pickOf(bodyguard),
    policeId: police?.id ?? null,
    policeInvestigate: pickOf(police),
    policeResult: outcome.policeResult?.isTraitor ?? null,
    outcome: outcomeText,
  };
  room.lastNight = breakdown;

  const publicText = outcome.killedId
    ? `${playerName(room, outcome.killedId)} did not survive the night.`
    : 'Everyone wakes up. No one was harmed last night.';

  room.night = null;
  room.phase = 'dayReveal';
  room.acks = [];
  enterAnnouncement(room, 'dayReveal', publicText, clock);
  if (outcome.killedId) {
    const victim = findPlayer(room, outcome.killedId);
    room.log.push(`Day ${room.day}: ${publicText}${victim?.role ? ` They were ${withArticle(victim.role)}.` : ''}`);
  } else {
    room.log.push(`Day ${room.day}: ${publicText}`);
  }
  checkEnd(room, clock);
}

/**
 * In Player mode the announcement is public immediately and the phase auto-advances after a pause.
 * In God mode the narrator edits and publishes it, then advances.
 */
function enterAnnouncement(room: RoomState, kind: 'dayReveal' | 'voteResult', defaultText: string, clock: Clock): void {
  if (room.mode === 'god' && godPresent(room)) {
    room.announcement = null;
    room.pendingAnnouncement = defaultText;
    room.timer = null;
  } else {
    room.announcement = defaultText;
    room.pendingAnnouncement = null;
    setTimer(room, clock, kind, REVEAL_PAUSE_MS);
  }
}

function godPresent(room: RoomState): boolean {
  if (!room.godId) return false;
  const god = findPlayer(room, room.godId);
  return !!god && (god.connected || room.hostId === room.godId);
}

export function publishAnnouncement(room: RoomState, byId: string, text: string, clock: Clock): void {
  if (!isController(room, byId)) throw new GameError('notHost', 'Only the narrator can publish announcements.');
  if (room.phase !== 'dayReveal' && room.phase !== 'voteResult') throw new GameError('wrongPhase', 'Nothing to announce right now.');
  const clean = text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, 400);
  room.announcement = clean || room.pendingAnnouncement || '';
  room.pendingAnnouncement = null;
  touch(room, clock);
}

// ---------------------------------------------------------------------------
// Day: discussion, voting, result
// ---------------------------------------------------------------------------

export function beginDiscussion(room: RoomState, clock: Clock): void {
  if (room.announcement === null && room.pendingAnnouncement !== null) {
    room.announcement = room.pendingAnnouncement;
    room.pendingAnnouncement = null;
  }
  room.phase = 'discussion';
  room.acks = [];
  setTimer(room, clock, 'discussion', discussionTimerMs(gamePlayers(room).length, room.settings.discussionMinutes));
  touch(room, clock);
}

export function beginVoting(room: RoomState, clock: Clock): void {
  room.phase = 'voting';
  room.votes = {};
  room.acks = [];
  setTimer(room, clock, 'voting', VOTING_TIMER_MS);
  touch(room, clock);
}

export function castVote(room: RoomState, voterId: string, targetId: string, clock: Clock): boolean {
  if (room.phase !== 'voting') throw new GameError('wrongPhase', 'Voting is not open.');
  const voter = findPlayer(room, voterId);
  if (!voter || voterId === room.godId) throw new GameError('notInRoom', 'You are not a voter in this game.');
  if (!voter.alive) throw new GameError('notAlive', 'The dead do not vote.');
  if (room.votes[voterId]) throw new GameError('alreadyActed', 'You have already voted.');
  if (targetId === voterId) throw new GameError('illegalTarget', 'You cannot vote for yourself.');
  const target = findPlayer(room, targetId);
  if (!target || !target.alive || targetId === room.godId) throw new GameError('illegalTarget', 'That player cannot be voted for.');
  room.votes[voterId] = targetId;
  touch(room, clock);
  const voters = alivePlayers(room).filter((p) => p.connected);
  if (voters.every((p) => room.votes[p.id])) {
    resolveVoting(room, clock);
    return true;
  }
  return false;
}

export function resolveVoting(room: RoomState, clock: Clock): void {
  if (room.phase !== 'voting') return;
  const tally = tallyVotes(room.votes);
  let text: string;
  let role: Role | null = null;
  if (tally.eliminatedId) {
    const victim = findPlayer(room, tally.eliminatedId);
    if (victim) {
      victim.alive = false;
      role = victim.role;
    }
    text = `${playerName(room, tally.eliminatedId)} was voted out. They were ${role ? withArticle(role) : 'unknown'}.`;
  } else if (tally.cast === 0) {
    text = 'No votes were cast. No one was eliminated.';
  } else {
    text = 'The vote was tied. No one was eliminated.';
  }
  room.lastVoteResult = { eliminatedId: tally.eliminatedId, role, tied: tally.tied };
  room.phase = 'voteResult';
  room.acks = [];
  enterAnnouncement(room, 'voteResult', text, clock);
  room.log.push(`Day ${room.day}: ${text}`);
  checkEnd(room, clock);
}

function checkEnd(room: RoomState, clock: Clock): void {
  const winner = checkWin(rolesOf(room), new Set(alivePlayers(room).map((p) => p.id)));
  if (!winner) return;
  room.winner = winner;
  room.phase = 'ended';
  if (room.announcement === null && room.pendingAnnouncement !== null) {
    room.announcement = room.pendingAnnouncement;
    room.pendingAnnouncement = null;
  }
  room.timer = null;
  room.log.push(winner === 'traitors' ? 'The Traitors have taken the city.' : 'The town is safe. Every Traitor is gone.');
  touch(room, clock);
}

// ---------------------------------------------------------------------------
// Advancing (host / God / timers)
// ---------------------------------------------------------------------------

/** Host or God advances the current phase early. */
export function advancePhase(room: RoomState, byId: string, rng: Rng, clock: Clock): void {
  if (!isController(room, byId)) throw new GameError('notHost', 'Only the host can advance the game.');
  const isGod = room.godId === byId;
  switch (room.phase) {
    case 'roleReveal':
      beginNight(room, clock);
      return;
    case 'night':
      if (room.night?.step === 'narrator') {
        beginNightAction(room, clock);
        return;
      }
      if (!isGod) throw new GameError('wrongPhase', 'The night ends when everyone has acted or the timer runs out.');
      resolveNightPhase(room, rng, clock);
      return;
    case 'dayReveal':
      beginDiscussion(room, clock);
      return;
    case 'discussion':
      beginVoting(room, clock);
      return;
    case 'voting':
      resolveVoting(room, clock);
      return;
    case 'voteResult':
      beginNight(room, clock);
      return;
    default:
      throw new GameError('wrongPhase', 'Nothing to advance.');
  }
}

/** The server timer fired. Auto-resolve whatever the current phase needs. */
export function onTimeout(room: RoomState, rng: Rng, clock: Clock): void {
  const kind = room.timer?.kind;
  room.timer = null;
  switch (kind) {
    case 'roleReveal':
      if (room.phase === 'roleReveal') beginNight(room, clock);
      return;
    case 'narrator':
      if (room.phase === 'night' && room.night?.step === 'narrator') beginNightAction(room, clock);
      return;
    case 'night':
      if (room.phase === 'night' && room.night?.step === 'action') resolveNightPhase(room, rng, clock);
      return;
    case 'dayReveal':
      if (room.phase === 'dayReveal') beginDiscussion(room, clock);
      return;
    case 'discussion':
      if (room.phase === 'discussion') beginVoting(room, clock);
      return;
    case 'voting':
      if (room.phase === 'voting') resolveVoting(room, clock);
      return;
    case 'voteResult':
      if (room.phase === 'voteResult') beginNight(room, clock);
      return;
    default:
      return;
  }
}

// ---------------------------------------------------------------------------
// Personalised projection. Nothing leaves the server around this function.
// ---------------------------------------------------------------------------

export function tallyView(room: RoomState, viewerId: string): VoteTallyView {
  const counts: Record<string, number> = {};
  for (const t of Object.values(room.votes)) counts[t] = (counts[t] ?? 0) + 1;
  return {
    cast: Object.keys(room.votes).length,
    total: alivePlayers(room).length,
    counts,
    yourVote: room.votes[viewerId] ?? null,
    voted: Object.keys(room.votes),
  };
}

export function viewFor(room: RoomState, viewerId: string, clock: Clock): RoomView {
  const viewer = findPlayer(room, viewerId);
  const isGod = room.godId !== null && room.godId === viewerId;
  const ended = room.phase === 'ended';
  const viewerIsTraitor = viewer?.role === 'traitor';

  const players = room.players.map((p) => {
    const pub: RoomView['players'][number] = {
      id: p.id,
      name: p.name,
      color: p.color,
      alive: p.alive,
      connected: p.connected,
      isHost: p.id === room.hostId,
    };
    const revealed =
      p.role !== null &&
      (ended || !p.alive || isGod || p.id === viewerId || (viewerIsTraitor && p.role === 'traitor' && room.traitorsRevealed));
    if (revealed && p.role) pub.role = p.role;
    if (room.phase === 'voting') pub.hasVoted = !!room.votes[p.id];
    return pub;
  });

  const view: RoomView = {
    code: room.code,
    phase: room.phase,
    day: room.day,
    mode: room.mode,
    settings: room.settings,
    hostId: room.hostId,
    godId: room.godId,
    youId: viewerId,
    isGod,
    isHost: room.hostId === viewerId,
    players,
    timerEndsAt: room.timer?.endsAt ?? null,
    timerTotalMs: room.timer?.totalMs ?? null,
    you: { role: viewer?.role ?? null, alive: viewer?.alive ?? false },
    announcement: room.announcement,
    log: room.log.slice(-30),
    acked: room.acks.includes(viewerId),
    serverNow: clock.now(),
  };

  if (viewer?.role === 'police') view.policeFindings = room.policeFindings.slice();

  if (room.phase === 'night' && room.night && viewer) {
    const canAct = viewer.alive && viewerId !== room.godId && hasNightPower(viewer.role);
    const night: NightView = {
      step: room.night.step,
      narratorAcked: room.acks.includes(viewerId),
      canAct,
    };
    if (viewerIsTraitor && room.traitorsRevealed) {
      night.teammates = gamePlayers(room)
        .filter((p) => p.role === 'traitor' && p.id !== viewerId)
        .map((p) => p.id);
    }
    if (canAct && room.night.step === 'action') {
      const pick = room.night.picks[viewerId];
      night.yourPick = { targetId: pick?.targetId ?? null, confirmed: pick?.confirmed ?? false };
      night.legalTargets = legalNightTargets(room, viewer);
      if (viewerIsTraitor) {
        night.teamPicks = alivePlayers(room)
          .filter((p) => p.role === 'traitor')
          .map((t) => ({
            traitorId: t.id,
            targetId: room.night!.picks[t.id]?.targetId ?? null,
            confirmed: room.night!.picks[t.id]?.confirmed ?? false,
          }));
      }
    }
    view.night = night;
  }

  if (room.phase === 'voting' || room.phase === 'voteResult') view.voteTally = tallyView(room, viewerId);
  if (room.phase === 'voteResult' && room.lastVoteResult) view.voteResult = room.lastVoteResult;
  if (ended && room.winner) view.ended = { winner: room.winner, roles: rolesOf(room) };

  if (isGod) {
    view.god = { roles: rolesOf(room) };
    if (room.phase === 'night' && room.night) {
      const status: Record<string, { targetId: string | null; confirmed: boolean }> = {};
      for (const p of actors(room)) {
        const pick = room.night.picks[p.id];
        status[p.id] = { targetId: pick?.targetId ?? null, confirmed: pick?.confirmed ?? false };
      }
      view.god.nightStatus = status;
    }
    if (room.lastNight) view.god.lastNight = room.lastNight;
    if (room.pendingAnnouncement !== null) view.god.pendingAnnouncement = room.pendingAnnouncement;
    if (room.phase === 'voting' || room.phase === 'voteResult') view.god.votes = { ...room.votes };
  }

  return view;
}

/**
 * After a player disconnects, a step that waits on acks or confirmations may now be
 * able to end early. Returns true when the phase changed.
 */
export function recheckEarlyEnd(room: RoomState, rng: Rng, clock: Clock): boolean {
  switch (room.phase) {
    case 'roleReveal':
      if (allAcked(room)) {
        beginNight(room, clock);
        return true;
      }
      return false;
    case 'night':
      if (!room.night) return false;
      if (room.night.step === 'narrator') {
        if (allAcked(room)) {
          beginNightAction(room, clock);
          return true;
        }
        return false;
      }
      if (actors(room).some((p) => p.connected) && allActorsConfirmed(room)) {
        resolveNightPhase(room, rng, clock);
        return true;
      }
      return false;
    case 'voting': {
      const voters = alivePlayers(room).filter((p) => p.connected);
      if (voters.length > 0 && voters.every((p) => room.votes[p.id])) {
        resolveVoting(room, clock);
        return true;
      }
      return false;
    }
    default:
      return false;
  }
}
