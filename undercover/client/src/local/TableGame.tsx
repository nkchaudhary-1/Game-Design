import { BODYGUARD_MIN_PLAYERS, MAX_PLAYERS, MIN_PLAYERS, ROLE_NAMES, suggestName, type PlayerCount, type PublicPlayer, type RoomSettings, type RoomView } from '@undercover/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { art, portraitArt } from '../art.js';
import { Art, Avatar, Chevron, CtaBar, InlineError, PlayerRow, RoleCard, Timer } from '../components/ui.js';
import { Skyline } from '../components/Hero.js';
import { Night, RoleReveal, Voting } from '../screens/Game.js';
import { Table, useTable, type Seat } from './table.js';

// ---------------------------------------------------------------------------
// Setup: names around the table
// ---------------------------------------------------------------------------

/** A suggested name that no other seat already has. */
function freshName(taken: string[]): string {
  const lower = new Set(taken.map((n) => n.trim().toLowerCase()));
  for (let i = 0; i < 50; i++) {
    const n = suggestName();
    if (!lower.has(n.toLowerCase())) return n;
  }
  return `${suggestName()} ${taken.length + 1}`;
}

function Setup({ onStart }: { onStart: (names: string[], settings: RoomSettings) => void }) {
  const [names, setNames] = useState<string[]>(() => {
    const out: string[] = [];
    for (let i = 0; i < 6; i++) out.push(freshName(out));
    return out;
  });
  const [bodyguard, setBodyguard] = useState(false);
  const [minutes, setMinutes] = useState('');
  const n = names.length;
  const bodyguardAllowed = n >= BODYGUARD_MIN_PLAYERS;
  const clean = names.map((x) => x.trim()).filter(Boolean);
  const ok = clean.length === n && new Set(clean.map((x) => x.toLowerCase())).size === n;
  return (
    <>
      <main className="screen" data-screen="setup">
        <div className="hero">
          <p className="eyebrow ruled">Pass &amp; play</p>
          <h1 className="textured">Who's at the table?</h1>
          <p className="lead">One phone for everyone. It goes around for the private moments, and stays in the middle for the rest.</p>
        </div>
        <section className="stack" data-testid="seats">
          {names.map((name, i) => (
            <div className="seat-row" key={i}>
              <span className="seat-no mono">{i + 1}</span>
              <Avatar player={{ name, color: 'fog', avatar: i }} size={52} square />
              <input className="input" aria-label={`Player ${i + 1} name`} value={name} maxLength={20} onChange={(e) => setNames(names.map((x, j) => (j === i ? e.target.value : x)))} />
              <button className="btn small icon-btn" aria-label="Shuffle name" title="Shuffle name" onClick={() => setNames(names.map((x, j) => (j === i ? freshName(names.filter((_, k) => k !== i)) : x)))}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 7h4l3 4M3 17h4l10-10h4M14 17h3M17 4l3 3-3 3M17 14l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button className="btn small ghost remove" aria-label="Remove player" disabled={n <= MIN_PLAYERS} onClick={() => setNames(names.filter((_, j) => j !== i))}>
                ×
              </button>
            </div>
          ))}
          <button className="btn add-seat" data-testid="add-seat" disabled={n >= MAX_PLAYERS} onClick={() => setNames([...names, freshName(names)])}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            Add a player <span className="muted">({n} of {MAX_PLAYERS})</span>
          </button>
        </section>
        <section className="card option-card">
          <div className="option-media" aria-hidden="true">
            <Art src={art('role-bodyguard.jpg')} />
          </div>
          <div className="toggle">
            <div className="copy">
              <strong>Bodyguard</strong>
              <span className="muted">{bodyguardAllowed ? 'Dies in place of whoever they guard.' : 'Needs 7 or more players.'}</span>
            </div>
            <button type="button" role="switch" aria-checked={bodyguard && bodyguardAllowed} aria-label="Bodyguard" className="switch" disabled={!bodyguardAllowed} onClick={() => setBodyguard((b) => !b)} />
          </div>
        </section>
        <div className="field">
          <label htmlFor="table-minutes">Discussion minutes (optional)</label>
          <div className="select-wrap">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" className="select-icon">
              <circle cx="12" cy="13" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M12 9v4l2.5 2M10 3h4M12 3v2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <select id="table-minutes" className="input select" value={minutes} onChange={(e) => setMinutes(e.target.value)}>
              <option value="">Default {n <= 6 ? 3 : n <= 9 ? 5 : 7}</option>
              {[1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20].map((m) => (
                <option key={m} value={String(m)}>
                  {m} minute{m === 1 ? '' : 's'}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="muted">
          {n} players: {n <= 6 ? '1 Traitor, 1 Doctor' : n <= 9 ? '2 Traitors, 1 Doctor, 1 Police' : '3 Traitors, 1 Doctor, 1 Police'}
          {bodyguard && bodyguardAllowed ? ', 1 Bodyguard' : ''}, the rest Innocent.
        </p>
        {!ok && <p className="inline-error">Every seat needs a different name.</p>}
        <Skyline />
      </main>
      <CtaBar>
        <button
          className="btn primary block with-chevron"
          data-testid="table-start"
          disabled={!ok}
          onClick={() => {
            const m = minutes.trim() ? Math.max(1, Math.min(30, Number(minutes))) : null;
            onStart(clean, { mode: 'player', targetCount: ([5, 7, 9, 11].find((c) => c >= n) ?? 11) as PlayerCount, bodyguard: bodyguard && bodyguardAllowed, discussionMinutes: m });
          }}
        >
          Deal the roles
          <Chevron />
        </button>
      </CtaBar>
    </>
  );
}

// ---------------------------------------------------------------------------
// Turn logic: who needs the phone right now?
// ---------------------------------------------------------------------------

type Stage = 'reveal' | 'narrator' | 'night' | 'vote';

function stageOf(view: RoomView): Stage | null {
  if (view.phase === 'roleReveal') return 'reveal';
  if (view.phase === 'night') return view.night?.step === 'narrator' ? 'narrator' : 'night';
  if (view.phase === 'voting') return 'vote';
  return null;
}

function needsTurn(seat: Seat, seen: Set<string>): boolean {
  const v = seat.view;
  if (!v) return false;
  switch (stageOf(v)) {
    case 'reveal':
      return !v.acked;
    case 'narrator':
      return v.you.alive && !v.night!.narratorAcked;
    case 'night':
      if (!v.you.alive) return false;
      if (v.night!.canAct) return !v.night!.yourPick?.confirmed;
      return !seen.has(`${v.day}:${seat.id}`);
    case 'vote':
      return v.you.alive && !v.voteTally?.yourVote;
    default:
      return false;
  }
}

const STAGE_COPY: Record<Stage, { why: string; hint: string }> = {
  reveal: { why: 'to see their secret role', hint: 'Nobody else should be looking.' },
  narrator: { why: 'for the first night', hint: 'Everyone else, eyes closed.' },
  night: { why: 'for the night', hint: 'Every player takes the phone, whether or not they have a power. No peeking at how long it takes.' },
  vote: { why: 'to cast a secret ballot', hint: 'One vote each. No take-backs.' },
};

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

function GatePortrait({ seat, index }: { seat: Seat; index: number }) {
  const [photo, setPhoto] = useState(true);
  return (
    <div className="gate-card">
      {photo ? <Art src={portraitArt(index)} className="portrait" onMissing={() => setPhoto(false)} /> : <Avatar player={{ name: seat.name, color: seat.color }} size={300} square />}
      <Art src={art('frame.png')} className="frame" />
    </div>
  );
}

function Gate({ table, seat, stage, progress, onUnlock }: { table: Table; seat: Seat; stage: Stage; progress: string; onUnlock: () => void }) {
  return (
    <>
      <main className="screen center" data-screen="gate">
        <p className="eyebrow">{progress}</p>
        <p className="narration">Pass the phone to</p>
        <GatePortrait seat={seat} index={seat.view?.players.find((p) => p.id === seat.id)?.avatar ?? table.seats.indexOf(seat)} />
        <h1 data-testid="gate-name" className="textured gate-name">
          {seat.name}
        </h1>
        <p className="lead">{STAGE_COPY[stage].why}.</p>
        <p className="muted">{STAGE_COPY[stage].hint}</p>
      </main>
      <CtaBar>
        <button className="btn primary block with-chevron" data-testid="unlock" onClick={onUnlock}>
          I'm {seat.name}
          <Chevron />
        </button>
      </CtaBar>
    </>
  );
}

function publicPlayers(view: RoomView): PublicPlayer[] {
  const ended = view.phase === 'ended';
  return view.players.map((p) => ({ ...p, role: ended || !p.alive ? p.role : undefined }));
}

function SharedRoster({ view }: { view: RoomView }) {
  return (
    <section className="stack">
      <h3>The table</h3>
      <div className="list" data-testid="roster">
        {publicPlayers(view).map((p) => (
          <PlayerRow key={p.id} player={p} youId="" />
        ))}
      </div>
    </section>
  );
}

function Shared({ table, view, onNewGame }: { table: Table; view: RoomView; onNewGame: () => void }) {
  const host = table.host!;
  const advance = () => table.send(host, { type: 'advancePhase' });
  switch (view.phase) {
    case 'dayReveal':
    case 'voteResult': {
      const isVote = view.phase === 'voteResult';
      const eliminated = isVote && view.voteResult?.eliminatedId ? view.players.find((p) => p.id === view.voteResult!.eliminatedId) : null;
      return (
        <>
          <main className="screen" data-screen={view.phase}>
            <p className="eyebrow">{isVote ? `Day ${view.day} · The vote` : `Day ${view.day} · Dawn`}</p>
            <p className="narration" data-testid="announcement">
              {view.announcement}
            </p>
            {eliminated?.role && <RoleCard role={eliminated.role} compact title={`${eliminated.name} · ${ROLE_NAMES[eliminated.role]}`} />}
            <SharedRoster view={view} />
          </main>
          <CtaBar>
            <button className="btn primary block" data-testid="advance" onClick={advance}>
              {isVote ? 'Begin the night' : 'Begin discussion'}
            </button>
          </CtaBar>
        </>
      );
    }
    case 'discussion':
      return (
        <>
          <main className="screen" data-screen="discussion">
            <p className="eyebrow">Day {view.day} · Discussion</p>
            <p className="narration">{view.announcement ?? 'The city wakes.'}</p>
            <div className="table-timer">
              <Timer endsAt={view.timerEndsAt} totalMs={view.timerTotalMs} offset={0} label="Discussion" urgentMs={30_000} />
            </div>
            <p className="lead">Put the phone in the middle. Argue. Accuse. When the timer ends or the table is ready, move to the vote.</p>
            <SharedRoster view={view} />
          </main>
          <CtaBar>
            <button className="btn primary block" data-testid="advance" onClick={advance}>
              Go to the vote
            </button>
          </CtaBar>
        </>
      );
    case 'ended': {
      const traitorsWon = view.ended!.winner === 'traitors';
      return (
        <>
          <main className="screen" data-screen="ended">
            <p className="eyebrow">Game over</p>
            <h1 data-testid="winner" className="textured">
              {traitorsWon ? 'The Traitors win' : 'The town wins'}
            </h1>
            <p className="narration">{traitorsWon ? 'The city belongs to the shadows now.' : 'Every liar has been dragged into the light.'}</p>
            <section className="stack">
              <h3>Everyone's role</h3>
              <div className="list" data-testid="roster">
                {view.players.map((p) => (
                  <PlayerRow key={p.id} player={p} youId="" sub={p.role ? ROLE_NAMES[p.role] : ''} right={p.role === 'traitor' ? <span className="badge strong">Traitor</span> : null} />
                ))}
              </div>
            </section>
            <section className="card">
              <h3>How it went</h3>
              <div className="log">
                {view.log.map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
              </div>
            </section>
          </main>
          <CtaBar>
            <button className="btn primary block" onClick={onNewGame}>
              New game
            </button>
          </CtaBar>
        </>
      );
    }
    default:
      return (
        <main className="screen center no-cta" data-screen="between">
          <p className="narration">The city holds its breath.</p>
        </main>
      );
  }
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

export function TableGame({ onExit }: { onExit: () => void }) {
  const tableRef = useRef<Table | null>(null);
  if (!tableRef.current) tableRef.current = new Table();
  const table = tableRef.current;
  useTable(table);
  const [started, setStarted] = useState(false);
  const [unlocked, setUnlocked] = useState<string | null>(null);
  const seen = useMemo(() => new Set<string>(), []);

  const host = table.host;
  const view = host?.view ?? null;
  const stage = view ? stageOf(view) : null;
  const pending = stage ? table.seats.filter((s) => needsTurn(s, seen)) : [];
  const current = pending.find((s) => s.conn.id === unlocked) ?? null;

  // Once the person holding the phone has done their part, lock it again for the next handoff.
  useEffect(() => {
    if (unlocked && !current) setUnlocked(null);
  }, [unlocked, current]);

  if (!started || !view) {
    return (
      <Setup
        onStart={(names, settings) => {
          setStarted(true);
          void table.start(names, settings);
        }}
      />
    );
  }

  if (stage && pending.length > 0) {
    const seat = pending[0];
    const total = table.seats.filter((s) => s.view?.you.alive || stage === 'reveal').length;
    const done = total - pending.length;
    const progress = `${done} of ${total} done`;
    if (!current) return <Gate table={table} seat={seat} stage={stage} progress={progress} onUnlock={() => setUnlocked(seat.conn.id)} />;

    const v = current.view!;
    const props = { view: v, send: (m: Parameters<Table['send']>[1]) => table.send(current, m), offset: 0, error: current.error, clearError: () => table.clearError(current) };
    const passOn = (
      <CtaBar>
        <button className="btn primary block table-cta" data-testid="pass" onClick={() => { seen.add(`${v.day}:${current.id}`); setUnlocked(null); }}>
          Seen it. Pass the phone on
        </button>
      </CtaBar>
    );
    return (
      <div className="private-view" data-seat={current.name}>
        {stage === 'reveal' && <RoleReveal {...props} />}
        {stage === 'narrator' && <Night {...props} />}
        {stage === 'night' && (
          <>
            <Night {...props} />
            {!v.night!.canAct && passOn}
          </>
        )}
        {stage === 'vote' && <Voting {...props} />}
      </div>
    );
  }

  return <Shared table={table} view={view} onNewGame={onExit} />;
}
