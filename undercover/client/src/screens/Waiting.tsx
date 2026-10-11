import { MIN_PLAYERS, ROLE_NAMES, roleCounts } from '@undercover/shared';
import { CopyButton, CtaBar, InlineError, PlayerRow } from '../components/ui.js';
import { inviteLink, type ScreenProps } from './common.js';

export function Waiting({ view, send, error, clearError, onLeave }: ScreenProps & { onLeave: () => void }) {
  const gamePlayers = view.players.filter((p) => p.id !== view.godId);
  const canStart = gamePlayers.length >= MIN_PLAYERS;
  const link = inviteLink(view.code);
  const counts = gamePlayers.length >= MIN_PLAYERS ? roleCounts(gamePlayers.length, view.settings.bodyguard) : null;
  const controller = view.isHost || view.isGod;
  return (
    <>
      <main className="screen" data-screen="waiting">
        <div className="hero">
          <p className="eyebrow">Room code</p>
          <div className="code-display" data-testid="room-code">
            {view.code}
          </div>
          <p className="muted">Friends join at the link below, or enter the code on the home screen.</p>
        </div>

        <section className="card">
          <div className="row between">
            <span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {link}
            </span>
            <CopyButton text={link} label="Copy link" />
          </div>
          {typeof navigator.share === 'function' && (
            <button className="btn small" onClick={() => navigator.share({ title: 'Join my Undercover game', text: `Room ${view.code}`, url: link }).catch(() => {})}>
              Share invite
            </button>
          )}
        </section>

        <section className="stack">
          <div className="row between">
            <h3>
              Joined {gamePlayers.length} / {view.settings.targetCount}
              {view.mode === 'god' ? ' + narrator' : ''}
            </h3>
            <span className="muted">{view.settings.mode === 'god' ? 'God mode' : 'Player mode'}</span>
          </div>
          <div className="list" data-testid="roster">
            {view.players.map((p) => (
              <PlayerRow key={p.id} player={p} youId={view.youId} sub={p.id === view.godId ? 'Narrator' : p.connected ? 'Ready' : 'Disconnected'} right={<span className={`dot${p.connected ? ' on' : ''}`} aria-hidden="true" />} />
            ))}
          </div>
        </section>

        <section className="card">
          <h3>Setup</h3>
          <p className="lead">
            {counts
              ? `With ${gamePlayers.length} players: ${Object.entries(counts)
                  .filter(([, n]) => n > 0)
                  .map(([r, n]) => `${n} ${ROLE_NAMES[r as keyof typeof ROLE_NAMES]}${n > 1 ? 's' : ''}`)
                  .join(', ')}.`
              : `Waiting for at least ${MIN_PLAYERS} players.`}
          </p>
          <p className="muted">
            Bodyguard {view.settings.bodyguard ? 'on' : 'off'} · Discussion {view.settings.discussionMinutes ? `${view.settings.discussionMinutes} min` : 'default'}
          </p>
        </section>

        <button className="btn ghost" onClick={onLeave}>
          Leave room
        </button>
        <InlineError error={error} onDismiss={clearError} />
      </main>
      <CtaBar>
        {controller ? (
          <button className="btn primary block" data-testid="start" disabled={!canStart} onClick={() => send({ type: 'startGame' })}>
            {canStart ? `Start with ${gamePlayers.length} players` : `Need ${MIN_PLAYERS - gamePlayers.length} more to start`}
          </button>
        ) : (
          <button className="btn block" disabled>
            Waiting for the host to start
          </button>
        )}
      </CtaBar>
    </>
  );
}
