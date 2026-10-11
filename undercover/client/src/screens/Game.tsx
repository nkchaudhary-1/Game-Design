import { ROLE_FLAVOR, ROLE_NAMES, ROLE_POWER, type PublicPlayer, type Role } from '@undercover/shared';
import { useEffect, useState } from 'react';
import { ClosedEye, CtaBar, InlineError, PlayerRow, RoleCard, Timer } from '../components/ui.js';
import { me, nameOf, VERBS, type ScreenProps } from './common.js';
import { GodAnnouncement, GodNight, GodRoster, GodVotes } from './God.js';

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function PoliceFindings({ view }: Pick<ScreenProps, 'view'>) {
  if (!view.policeFindings?.length) return null;
  return (
    <section className="card">
      <h3>Your findings (private)</h3>
      <div className="stack">
        {view.policeFindings.map((f) => (
          <div key={f.day} className="row between">
            <span>
              Night {f.day}: <strong>{nameOf(view, f.targetId)}</strong>
            </span>
            <span className={`badge${f.isTraitor ? ' strong' : ''}`}>{f.isTraitor ? 'Traitor' : 'Not a Traitor'}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Roster({ view, title = 'The table' }: Pick<ScreenProps, 'view'> & { title?: string }) {
  return (
    <section className="stack">
      <h3>{title}</h3>
      <div className="list" data-testid="roster">
        {view.players
          .filter((p) => p.id !== view.godId)
          .map((p) => (
            <PlayerRow key={p.id} player={p} youId={view.youId} />
          ))}
      </div>
    </section>
  );
}

function Log({ view }: Pick<ScreenProps, 'view'>) {
  if (!view.log.length) return null;
  return (
    <section className="card">
      <h3>So far</h3>
      <div className="log">
        {view.log.slice(-6).map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </section>
  );
}

function Dead({ view }: Pick<ScreenProps, 'view'>) {
  return (
    <section className="card center">
      <p className="narration small">You watch from the shadows now.</p>
      <p className="muted">Eliminated players see only what everyone sees.</p>
      {view.you.role && <p className="muted">You were {view.you.role === 'innocent' ? 'an' : 'the'} {ROLE_NAMES[view.you.role]}.</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Role reveal
// ---------------------------------------------------------------------------

export function RoleReveal(props: ScreenProps) {
  const { view, send, offset, error, clearError } = props;
  if (view.isGod) {
    return (
      <>
        <main className="screen" data-screen="roleReveal">
          <h1>Roles dealt</h1>
          <p className="lead">Players are reading their roles. Only you see them all.</p>
          <GodRoster view={view} />
          <Timer endsAt={view.timerEndsAt} totalMs={view.timerTotalMs} offset={offset} label="Night falls in" />
          <InlineError error={error} onDismiss={clearError} />
        </main>
        <CtaBar>
          <button className="btn primary block" data-testid="advance" onClick={() => send({ type: 'advancePhase' })}>
            Begin the night
          </button>
        </CtaBar>
      </>
    );
  }
  const role = view.you.role;
  return (
    <>
      <main className="screen" data-screen="roleReveal">
        <p className="eyebrow">Your secret role</p>
        <RoleCard role={role} line={role ? ROLE_FLAVOR[role] : undefined} />
        {role && (
          <section className="card">
            <h3>What you can do</h3>
            <p className="lead">{ROLE_POWER[role]}</p>
          </section>
        )}
        <Timer endsAt={view.timerEndsAt} totalMs={view.timerTotalMs} offset={offset} label="Night falls in" />
        <InlineError error={error} onDismiss={clearError} />
      </main>
      <CtaBar>
        <button className="btn primary block" data-testid="ack" disabled={view.acked} onClick={() => send({ type: 'ackReveal' })}>
          {view.acked ? 'Waiting for the others...' : 'Got it. Hide my role.'}
        </button>
      </CtaBar>
    </>
  );
}

// ---------------------------------------------------------------------------
// Night
// ---------------------------------------------------------------------------

export function Night(props: ScreenProps) {
  const { view, send, offset, error, clearError } = props;
  const night = view.night!;
  const self = me(view);
  const [picked, setPicked] = useState<string | null>(night.yourPick?.targetId ?? null);
  useEffect(() => {
    if (night.yourPick?.targetId) setPicked(night.yourPick.targetId);
  }, [night.yourPick?.targetId]);

  if (view.isGod) return <GodNight {...props} />;

  if (night.step === 'narrator') {
    const isTraitor = view.you.role === 'traitor';
    const mates = (night.teammates ?? []).map((id) => nameOf(view, id));
    return (
      <>
        <main className="screen center" data-screen="narrator">
          <ClosedEye />
          <p className="narration">Everyone, close your eyes.</p>
          {isTraitor ? (
            <section className="card" style={{ width: '100%' }}>
              <h3>Traitors, open your eyes</h3>
              {mates.length ? (
                <>
                  <p className="lead">Your fellow Traitors:</p>
                  <div className="list" data-testid="teammates">
                    {view.players
                      .filter((p) => night.teammates?.includes(p.id))
                      .map((p) => (
                        <PlayerRow key={p.id} player={p} youId={view.youId} sub="Traitor" />
                      ))}
                  </div>
                </>
              ) : (
                <p className="lead">You work alone. Nobody else knows.</p>
              )}
            </section>
          ) : (
            <p className="lead">You see nothing.</p>
          )}
          <Timer endsAt={view.timerEndsAt} totalMs={view.timerTotalMs} offset={offset} label="The night begins in" />
          <InlineError error={error} onDismiss={clearError} />
        </main>
        <CtaBar>
          {self.alive ? (
            <button className="btn primary block" data-testid="ack" disabled={night.narratorAcked} onClick={() => send({ type: 'ackNarrator' })}>
              {night.narratorAcked ? 'Waiting for the others...' : 'Continue'}
            </button>
          ) : (
            <button className="btn block" disabled>
              The night goes on
            </button>
          )}
        </CtaBar>
      </>
    );
  }

  // Action step
  const role = view.you.role;
  if (!self.alive) {
    return (
      <>
        <main className="screen" data-screen="night">
          <Dead view={view} />
          <Timer endsAt={view.timerEndsAt} totalMs={view.timerTotalMs} offset={offset} label="Night ends in" />
          <Roster view={view} />
        </main>
      </>
    );
  }
  if (!night.canAct || !role || role === 'innocent') {
    return (
      <>
        <main className="screen center no-cta" data-screen="night">
          <ClosedEye />
          <p className="narration">The night is long. Keep your eyes closed.</p>
          <p className="lead">Someone in this city is awake. It is not you.</p>
          <Timer endsAt={view.timerEndsAt} totalMs={view.timerTotalMs} offset={offset} label="Night ends in" />
          <PoliceFindings view={view} />
        </main>
      </>
    );
  }

  const verbs = VERBS[role as Exclude<Role, 'innocent'>];
  const confirmed = night.yourPick?.confirmed ?? false;
  const legal = new Set(night.legalTargets ?? []);
  const targets = view.players.filter((p) => legal.has(p.id));
  const choose = (id: string) => {
    if (confirmed) return;
    setPicked(id);
    send({ type: 'nightAction', targetId: id, confirm: false });
  };
  return (
    <>
      <main className="screen" data-screen="night">
        <div className="row between">
          <h1>{ROLE_NAMES[role]}</h1>
          <span className="badge">Night {view.day}</span>
        </div>
        <p className="narration small">{confirmed ? 'Your choice is made. Wait for dawn.' : verbs.prompt}</p>
        <Timer endsAt={view.timerEndsAt} totalMs={view.timerTotalMs} offset={offset} label={role === 'traitor' ? 'Kill timer' : 'Night ends in'} />

        {role === 'traitor' && night.teamPicks && night.teamPicks.length > 1 && (
          <section className="card" data-testid="team-picks">
            <h3>Your team's picks</h3>
            <div className="stack">
              {night.teamPicks.map((tp) => (
                <div key={tp.traitorId} className="row between">
                  <span>
                    {nameOf(view, tp.traitorId)}
                    {tp.traitorId === view.youId ? ' (you)' : ''}
                  </span>
                  <span className="muted">
                    {tp.targetId ? `→ ${nameOf(view, tp.targetId)}` : 'undecided'}
                    {tp.confirmed ? ' · confirmed' : ''}
                  </span>
                </div>
              ))}
            </div>
            <p className="muted">Most picks wins. Ties go to the earliest pick. Picks can change until everyone confirms or the timer ends.</p>
          </section>
        )}

        <section className="stack">
          <h3>{confirmed ? 'Your target' : 'Choose a target'}</h3>
          <div className="list" data-testid="targets">
            {targets.map((p: PublicPlayer) => {
              const isPicked = picked === p.id;
              return (
                <PlayerRow
                  key={p.id}
                  player={p}
                  youId={view.youId}
                  selected={isPicked}
                  onClick={confirmed ? undefined : () => choose(p.id)}
                  sub={isPicked ? verbs.selected : p.id === view.youId ? 'Yourself' : ' '}
                  right={
                    !confirmed ? (
                      <button
                        className={`btn small${isPicked ? ' primary' : ''}`}
                        data-testid="target"
                        onClick={(e) => {
                          e.stopPropagation();
                          choose(p.id);
                        }}
                      >
                        {isPicked ? verbs.selected : verbs.verb}
                      </button>
                    ) : isPicked ? (
                      <span className="badge strong">{verbs.selected}</span>
                    ) : null
                  }
                />
              );
            })}
          </div>
        </section>
        <PoliceFindings view={view} />
        <InlineError error={error} onDismiss={clearError} />
      </main>
      <CtaBar>
        <button className="btn primary block" data-testid="confirm" disabled={confirmed || !picked} onClick={() => picked && send({ type: 'nightAction', targetId: picked, confirm: true })}>
          {confirmed ? 'Waiting for the night to end...' : picked ? verbs.confirm : `Choose someone to ${verbs.verb.toLowerCase()}`}
        </button>
      </CtaBar>
    </>
  );
}

// ---------------------------------------------------------------------------
// Day reveal and vote result (announcements)
// ---------------------------------------------------------------------------

export function Announcement(props: ScreenProps) {
  const { view, send, offset, error, clearError } = props;
  const isVote = view.phase === 'voteResult';
  const controller = view.isHost || view.isGod;
  const self = me(view);
  const eliminated = isVote && view.voteResult?.eliminatedId ? view.players.find((p) => p.id === view.voteResult!.eliminatedId) : null;

  if (view.isGod && view.god?.pendingAnnouncement !== undefined) return <GodAnnouncement {...props} />;

  return (
    <>
      <main className="screen" data-screen={view.phase}>
        <p className="eyebrow">{isVote ? `Day ${view.day} · The vote` : `Day ${view.day} · Dawn`}</p>
        {view.announcement !== null ? (
          <p className="narration" data-testid="announcement">
            {view.announcement}
          </p>
        ) : (
          <p className="narration">The city stirs. The narrator is choosing their words...</p>
        )}
        {eliminated?.role && <RoleCard role={eliminated.role} compact title={`${eliminated.name} · ${ROLE_NAMES[eliminated.role]}`} />}
        {!self.alive && <Dead view={view} />}
        {view.isGod && view.god?.lastNight && !isVote && <GodNightBreakdownCard {...props} />}
        <Timer endsAt={view.timerEndsAt} totalMs={view.timerTotalMs} offset={offset} label={isVote ? 'Night falls in' : 'Discussion begins in'} />
        <PoliceFindings view={view} />
        <Roster view={view} />
        <InlineError error={error} onDismiss={clearError} />
      </main>
      <CtaBar>
        {controller ? (
          <button className="btn primary block" data-testid="advance" disabled={view.announcement === null} onClick={() => send({ type: 'advancePhase' })}>
            {isVote ? 'Begin the night' : 'Begin discussion'}
          </button>
        ) : (
          <button className="btn block" disabled>
            {isVote ? 'Night is coming' : 'Discussion starts soon'}
          </button>
        )}
      </CtaBar>
    </>
  );
}

function GodNightBreakdownCard({ view }: ScreenProps) {
  const b = view.god!.lastNight!;
  return (
    <section className="card" data-testid="god-breakdown">
      <h3>What really happened (private)</h3>
      <div className="log">
        <div>
          Traitors ({b.traitors.map((id) => nameOf(view, id)).join(', ')}) targeted {nameOf(view, b.traitorTarget)}
        </div>
        {b.doctorId && <div>Doctor {nameOf(view, b.doctorId)} protected {b.doctorProtect ? nameOf(view, b.doctorProtect) : 'nobody'}</div>}
        {b.bodyguardId && <div>Bodyguard {nameOf(view, b.bodyguardId)} guarded {b.bodyguardGuard ? nameOf(view, b.bodyguardGuard) : 'nobody'}</div>}
        {b.policeId && (
          <div>
            Police {nameOf(view, b.policeId)} investigated {b.policeInvestigate ? nameOf(view, b.policeInvestigate) : 'nobody'}
            {b.policeResult !== null ? `, result: ${b.policeResult ? 'Traitor' : 'not a Traitor'}` : ''}
          </div>
        )}
        <div>Outcome: {b.outcome}</div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Discussion
// ---------------------------------------------------------------------------

export function Discussion(props: ScreenProps) {
  const { view, send, offset, error, clearError } = props;
  const controller = view.isHost || view.isGod;
  const self = me(view);
  return (
    <>
      <main className="screen" data-screen="discussion">
        <p className="eyebrow">Day {view.day} · Discussion</p>
        <p className="narration">{view.announcement ?? 'The city wakes.'}</p>
        <Timer endsAt={view.timerEndsAt} totalMs={view.timerTotalMs} offset={offset} label="Discussion" urgentMs={30_000} />
        <p className="lead">Talk it out. Who is lying? The vote opens when the timer ends{controller ? ' or when you move on' : ''}.</p>
        {!self.alive && !view.isGod && <Dead view={view} />}
        <PoliceFindings view={view} />
        {view.isGod ? <GodRoster view={view} /> : <Roster view={view} />}
        <Log view={view} />
        <InlineError error={error} onDismiss={clearError} />
      </main>
      <CtaBar>
        {controller ? (
          <button className="btn primary block" data-testid="advance" onClick={() => send({ type: 'advancePhase' })}>
            Go to the vote
          </button>
        ) : (
          <button className="btn block" disabled>
            Vote opens when the timer ends
          </button>
        )}
      </CtaBar>
    </>
  );
}

// ---------------------------------------------------------------------------
// Voting
// ---------------------------------------------------------------------------

export function Voting(props: ScreenProps) {
  const { view, send, offset, error, clearError } = props;
  const self = me(view);
  const tally = view.voteTally;
  const [picked, setPicked] = useState<string | null>(null);
  const voted = tally?.yourVote ?? null;
  const canVote = self.alive && !view.isGod && !voted;
  const candidates = view.players.filter((p) => p.alive && p.id !== view.godId && p.id !== view.youId);

  if (view.isGod) return <GodVotes {...props} />;

  return (
    <>
      <main className="screen" data-screen="voting">
        <div className="row between">
          <p className="eyebrow">Day {view.day} · Voting</p>
          <span className="badge" data-testid="votes-cast">
            Votes cast {tally?.cast ?? 0} / {tally?.total ?? 0}
          </span>
        </div>
        <p className="narration small">{voted ? `You voted for ${nameOf(view, voted)}. No take-backs.` : canVote ? 'Who do you accuse?' : 'The living are voting.'}</p>
        <Timer endsAt={view.timerEndsAt} totalMs={view.timerTotalMs} offset={offset} label="Voting closes in" />
        {!self.alive && <Dead view={view} />}
        <section className="stack">
          <h3>Live tally</h3>
          <div className="list" data-testid="candidates">
            {view.players
              .filter((p) => p.alive && p.id !== view.godId)
              .map((p) => {
                const n = tally?.counts[p.id] ?? 0;
                const selectable = canVote && p.id !== view.youId;
                return (
                  <PlayerRow
                    key={p.id}
                    player={p}
                    youId={view.youId}
                    selected={picked === p.id || voted === p.id}
                    onClick={selectable ? () => setPicked(p.id) : undefined}
                    sub={p.hasVoted ? 'Has voted' : 'Deciding'}
                    right={
                      <>
                        <span className="count mono" data-testid="count" aria-label={`${n} votes`}>
                          {n}
                        </span>
                        {selectable && (
                          <button
                            className={`btn small${picked === p.id ? ' primary' : ''}`}
                            data-testid="vote-pick"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPicked(p.id);
                            }}
                          >
                            {picked === p.id ? 'Chosen' : 'Accuse'}
                          </button>
                        )}
                      </>
                    }
                  />
                );
              })}
          </div>
          {candidates.length === 0 && <p className="muted">Nobody left to accuse.</p>}
        </section>
        <PoliceFindings view={view} />
        <InlineError error={error} onDismiss={clearError} />
      </main>
      <CtaBar>
        {canVote ? (
          <button className="btn primary block" data-testid="vote" disabled={!picked} onClick={() => picked && send({ type: 'castVote', targetId: picked })}>
            {picked ? `Cast your vote for ${nameOf(view, picked)}` : 'Choose someone to accuse'}
          </button>
        ) : (
          <button className="btn block" disabled>
            {voted ? 'Waiting for the others...' : 'Watching the vote'}
          </button>
        )}
      </CtaBar>
    </>
  );
}

// ---------------------------------------------------------------------------
// Game end
// ---------------------------------------------------------------------------

export function Ended({ view, onNewGame }: ScreenProps & { onNewGame: () => void }) {
  const ended = view.ended!;
  const traitorsWon = ended.winner === 'traitors';
  const self = me(view);
  const myRole = view.you.role;
  const iWon = view.isGod ? null : myRole === 'traitor' ? traitorsWon : !traitorsWon;
  return (
    <>
      <main className="screen" data-screen="ended">
        <p className="eyebrow">Game over</p>
        <h1 data-testid="winner">{traitorsWon ? 'The Traitors win' : 'The town wins'}</h1>
        <p className="narration">{traitorsWon ? 'The city belongs to the shadows now.' : 'Every liar has been dragged into the light.'}</p>
        {iWon !== null && (
          <p className="lead">
            {iWon ? 'You won.' : 'You lost.'} You were {myRole === 'innocent' ? 'an' : 'the'} {myRole ? ROLE_NAMES[myRole] : 'unknown'}
            {self.alive ? '' : ', and you did not make it'}.
          </p>
        )}
        <section className="stack">
          <h3>Everyone's role</h3>
          <div className="list" data-testid="roster">
            {view.players
              .filter((p) => p.id !== view.godId)
              .map((p) => (
                <PlayerRow key={p.id} player={p} youId={view.youId} sub={p.role ? ROLE_NAMES[p.role] : ''} right={p.role === 'traitor' ? <span className="badge strong">Traitor</span> : null} />
              ))}
          </div>
        </section>
        <Log view={view} />
      </main>
      <CtaBar>
        <button className="btn primary block" onClick={onNewGame}>
          Play again
        </button>
      </CtaBar>
    </>
  );
}
