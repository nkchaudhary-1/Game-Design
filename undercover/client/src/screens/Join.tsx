import { suggestName, type ClientMessage, type PlayerColor } from '@undercover/shared';
import { useState } from 'react';
import { CtaBar, InlineError } from '../components/ui.js';
import type { GameError } from '../ws.js';
import { NameAndColor } from './Landing.js';

interface Props {
  code: string;
  send: (m: ClientMessage) => void;
  error: GameError | null;
  clearError: () => void;
  onBack: () => void;
}

export function Join({ code, send, error, clearError, onBack }: Props) {
  const [name, setName] = useState(() => suggestName());
  const [color, setColor] = useState<PlayerColor>('fog');
  return (
    <>
      <main className="screen" data-screen="join">
        <div className="hero">
          <p className="eyebrow">You have been invited to room</p>
          <div className="code-display" data-testid="join-code">
            {code}
          </div>
          <p className="narration small">Pick a name. Nobody will know who you really are.</p>
        </div>
        <section className="card">
          <NameAndColor name={name} setName={setName} color={color} setColor={setColor} />
        </section>
        <button className="btn ghost" onClick={onBack}>
          Not this room? Go back
        </button>
        <InlineError error={error} onDismiss={clearError} />
      </main>
      <CtaBar>
        <button className="btn primary block" data-testid="join" onClick={() => send({ type: 'joinRoom', code, name: name.trim() || 'Stranger', color })}>
          Join the game
        </button>
      </CtaBar>
    </>
  );
}
