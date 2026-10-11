import { ROLE_NAMES } from '@undercover/shared';
import { useEffect, useState } from 'react';
import { CtaBar, InlineError, PlayerRow, Timer } from '../components/ui.js';
import { nameOf, type ScreenProps } from './common.js';

export function GodRoster({ view }: Pick<ScreenProps, 'view'>) {
  return (
    <section className="stack">
      <h3>Roster (only you see roles)</h3>
      <div className="list" data-testid="roster">
        {view.players
          .filter((p) => p.id !== view.godId)
          .map((p) => (
            <PlayerRow key={p.id} player={p} youId={view.youId} sub={[p.role ? ROLE_NAMES[p.role] : '?', !p.alive ? 'Eliminated' : null, !p.connected ? 'Disconnected' : null].filter(Boolean).join(' · ')} />
          ))}
      </div>
    </section>
  );
}

export function GodNight({ view, send, offset, error, clearError }: ScreenProps) {
  const night = view.night!;
  const status = view.god?.nightStatus ?? {};
  const actors = view.players.filter((p) => status[p.id]);
  return (
    <>
      <main className="screen" data-screen={night.step === 'narrator' ? 'narrator' : 'night'}>
        <p className="eyebrow">Night {view.day} · Narrator</p>
        {night.step === 'narrator' ? (
          <>
            <p className="narration">"Everyone, close your eyes."</p>
            <p className="lead">Traitors are learning who their teammates are. Players tap Continue when ready; you can move on for them.</p>
          </>
        ) : (
          <>
            <p className="narration">The city sleeps. Some of it is awake.</p>
            <section className="card" data-testid="god-night-status">
              <h3>Night actions (live)</h3>
              <div className="stack">
                {actors.map((p) => (
                  <div key={p.id} className="row between">
                    <span>
                      <strong>{p.name}</strong> <span className="muted">· {p.role ? ROLE_NAMES[p.role] : ''}</span>
                    </span>
                    <span className="muted">
                      {status[p.id].targetId ? `→ ${nameOf(view, status[p.id].targetId)}` : 'undecided'}
                      {status[p.id].confirmed ? ' · confirmed' : ''}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
        <Timer endsAt={view.timerEndsAt} totalMs={view.timerTotalMs} offset={offset} label={night.step === 'narrator' ? 'Actions begin in' : 'Night ends in'} />
        <GodRoster view={view} />
        <InlineError error={error} onDismiss={clearError} />
      </main>
      <CtaBar>
        <button className="btn primary block" data-testid="advance" onClick={() => send({ type: 'advancePhase' })}>
          {night.step === 'narrator' ? 'Begin night actions' : 'Resolve the night now'}
        </button>
      </CtaBar>
    </>
  );
}

export function GodAnnouncement({ view, send, error, clearError }: ScreenProps) {
  const pending = view.god?.pendingAnnouncement ?? '';
  const [text, setText] = useState(pending);
  useEffect(() => setText(pending), [pending]);
  const isVote = view.phase === 'voteResult';
  const b = view.god?.lastNight;
  return (
    <>
      <main className="screen" data-screen={view.phase}>
        <p className="eyebrow">Day {view.day} · {isVote ? 'Vote result' : 'Dawn'} · Narrator</p>
        {!isVote && b && (
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
        )}
        {isVote && view.god?.votes && (
          <section className="card">
            <h3>Who voted for whom (private)</h3>
            <div className="log">
              {Object.entries(view.god.votes).map(([from, to]) => (
                <div key={from}>
                  {nameOf(view, from)} → {nameOf(view, to)}
                </div>
              ))}
              {Object.keys(view.god.votes).length === 0 && <div>No votes were cast.</div>}
            </div>
          </section>
        )}
        <div className="field">
          <label htmlFor="announce">Public announcement (players see exactly this)</label>
          <textarea id="announce" className="input" data-testid="announcement-input" value={text} maxLength={400} onChange={(e) => setText(e.target.value)} />
          <p className="muted">Keep the cause of death to yourself. Edit the words, not the facts.</p>
        </div>
        <GodRoster view={view} />
        <InlineError error={error} onDismiss={clearError} />
      </main>
      <CtaBar>
        <button className="btn primary block" data-testid="publish" disabled={!text.trim()} onClick={() => send({ type: 'publishAnnouncement', text })}>
          Publish to players
        </button>
      </CtaBar>
    </>
  );
}

export function GodVotes({ view, send, offset, error, clearError }: ScreenProps) {
  const tally = view.voteTally;
  const votes = view.god?.votes ?? {};
  return (
    <>
      <main className="screen" data-screen="voting">
        <div className="row between">
          <p className="eyebrow">Day {view.day} · Voting · Narrator</p>
          <span className="badge" data-testid="votes-cast">
            Votes cast {tally?.cast ?? 0} / {tally?.total ?? 0}
          </span>
        </div>
        <Timer endsAt={view.timerEndsAt} totalMs={view.timerTotalMs} offset={offset} label="Voting closes in" />
        <section className="stack">
          <h3>Tally and ballots (private)</h3>
          <div className="list">
            {view.players
              .filter((p) => p.alive && p.id !== view.godId)
              .map((p) => (
                <PlayerRow
                  key={p.id}
                  player={p}
                  youId={view.youId}
                  sub={`${p.role ? ROLE_NAMES[p.role] : ''}${votes[p.id] ? ` · voted ${nameOf(view, votes[p.id])}` : ' · deciding'}`}
                  right={<span className="count mono">{tally?.counts[p.id] ?? 0}</span>}
                />
              ))}
          </div>
        </section>
        <InlineError error={error} onDismiss={clearError} />
      </main>
      <CtaBar>
        <button className="btn primary block" data-testid="advance" onClick={() => send({ type: 'advancePhase' })}>
          End the vote now
        </button>
      </CtaBar>
    </>
  );
}
