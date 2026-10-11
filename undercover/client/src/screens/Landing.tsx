import { BODYGUARD_MIN_PLAYERS, PLAYER_COLORS, PLAYER_COUNTS, suggestName, type Mode, type PlayerColor, type PlayerCount, type RoomSettings } from '@undercover/shared';
import { useState } from 'react';
import type { ClientMessage } from '@undercover/shared';
import { COLOR_HEX, CtaBar, InlineError } from '../components/ui.js';
import type { GameError } from '../ws.js';

interface Props {
  send: (m: ClientMessage) => void;
  error: GameError | null;
  clearError: () => void;
  onRules: () => void;
  onJoin: (code: string) => void;
  initialCode?: string;
}

export function NameAndColor({
  name,
  setName,
  color,
  setColor,
}: {
  name: string;
  setName: (s: string) => void;
  color: PlayerColor;
  setColor: (c: PlayerColor) => void;
}) {
  return (
    <>
      <div className="field">
        <label htmlFor="name">Your name</label>
        <div className="row">
          <input id="name" className="input" value={name} maxLength={20} placeholder="Pick a name" onChange={(e) => setName(e.target.value)} autoComplete="off" />
          <button type="button" className="btn" onClick={() => setName(suggestName())} aria-label="Shuffle name">
            Shuffle
          </button>
        </div>
      </div>
      <div className="field">
        <span className="label">Your shade</span>
        <div className="swatches" role="radiogroup" aria-label="Shade">
          {PLAYER_COLORS.map((c) => (
            <button key={c} type="button" className="swatch" aria-pressed={color === c} aria-label={c} onClick={() => setColor(c)} style={{ background: COLOR_HEX[c] }}>
              <span />
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

export function Landing({ send, error, clearError, onRules, onJoin, initialCode }: Props) {
  const [mode, setMode] = useState<Mode>('player');
  const [name, setName] = useState(() => suggestName());
  const [color, setColor] = useState<PlayerColor>('silver');
  const [count, setCount] = useState<PlayerCount>(7);
  const [bodyguard, setBodyguard] = useState(false);
  const [customMinutes, setCustomMinutes] = useState('');
  const [code, setCode] = useState(initialCode ?? '');
  const bodyguardAllowed = count >= BODYGUARD_MIN_PLAYERS;

  const create = () => {
    const minutes = customMinutes.trim() ? Math.max(1, Math.min(30, Math.round(Number(customMinutes)))) : null;
    const settings: RoomSettings = { mode, targetCount: count, bodyguard: bodyguard && bodyguardAllowed, discussionMinutes: Number.isFinite(minutes) ? minutes : null };
    send({ type: 'createRoom', name: name.trim() || 'Stranger', color, settings });
  };

  return (
    <>
      <main className="screen" data-screen="landing">
        <div className="hero">
          <div className="wordmark-big">Undercover</div>
          <p className="narration">Someone at this table is lying.</p>
          <p className="lead">A real-time social deduction game for 5 to 11 friends. One phone each, no accounts.</p>
        </div>

        <section className="card">
          <h3>Join a game</h3>
          <div className="row">
            <input
              className="input code"
              value={code}
              placeholder="CODE"
              maxLength={6}
              aria-label="Room code"
              autoCapitalize="characters"
              autoComplete="off"
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            />
            <button className="btn" style={{ height: 60 }} disabled={code.length !== 6} onClick={() => onJoin(code)}>
              Join
            </button>
          </div>
        </section>

        <section className="card">
          <h3>Host a new game</h3>
          <div className="field">
            <span className="label">You play as</span>
            <div className="segmented" role="radiogroup" aria-label="Mode">
              <button type="button" aria-pressed={mode === 'player'} onClick={() => setMode('player')}>
                Player
              </button>
              <button type="button" aria-pressed={mode === 'god'} onClick={() => setMode('god')}>
                God (narrator)
              </button>
            </div>
            <p className="muted">{mode === 'god' ? 'You narrate, see every role, and never play or vote.' : 'You get a secret role like everyone else.'}</p>
          </div>

          <NameAndColor name={name} setName={setName} color={color} setColor={setColor} />

          <div className="field">
            <span className="label">Players</span>
            <div className="segmented" role="radiogroup" aria-label="Player count">
              {PLAYER_COUNTS.map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={count === n}
                  onClick={() => {
                    setCount(n);
                    if (n < BODYGUARD_MIN_PLAYERS) setBodyguard(false);
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="muted">You can start with 5 or more joined. Roles scale to who actually shows up.</p>
          </div>

          <div className="toggle">
            <div className="copy">
              <strong>Bodyguard</strong>
              <span className="muted">{bodyguardAllowed ? 'Dies in place of whoever they guard.' : 'Needs 7 or more players.'}</span>
            </div>
            <button type="button" role="switch" aria-checked={bodyguard && bodyguardAllowed} aria-label="Bodyguard" className="switch" disabled={!bodyguardAllowed} onClick={() => setBodyguard((b) => !b)} />
          </div>

          <div className="field">
            <label htmlFor="minutes">Discussion minutes (optional)</label>
            <input id="minutes" className="input" inputMode="numeric" placeholder={count <= 6 ? 'Default 3' : count <= 9 ? 'Default 5' : 'Default 7'} value={customMinutes} onChange={(e) => setCustomMinutes(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))} />
          </div>
        </section>

        <button className="btn ghost" onClick={onRules}>
          Read the full rules
        </button>
        <InlineError error={error} onDismiss={clearError} />
      </main>
      <CtaBar>
        <button className="btn primary block" onClick={create} data-testid="create">
          Create room
        </button>
      </CtaBar>
    </>
  );
}
