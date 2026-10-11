import { useState } from 'react';
import { App } from '../App.js';
import { art } from '../art.js';
import { Atmosphere } from '../components/Atmosphere.js';
import { Hero, Skyline } from '../components/Hero.js';
import { Art, Chevron, TopBar } from '../components/ui.js';
import { MotionPrompt } from '../components/MotionPrompt.js';
import { Rules } from '../screens/Rules.js';
import { configureSolo } from './solo.js';
import { TableGame } from './TableGame.js';

type Mode = 'choose' | 'table' | 'solo';

function ModeCard({ title, body, image, badge, testId, onClick }: { title: string; body: string; image: string; badge?: string; testId: string; onClick: () => void }) {
  return (
    <button className="mode-card" data-testid={testId} onClick={onClick}>
      <div className="mode-copy">
        <h2>{title}</h2>
        <p className="lead">{body}</p>
        {badge && <span className="badge strong">{badge}</span>}
      </div>
      <div className="mode-media" aria-hidden="true">
        <Art src={image} />
      </div>
      <Chevron />
    </button>
  );
}

function Choose({ onPick, onRules }: { onPick: (m: Mode) => void; onRules: () => void }) {
  return (
    <main className="screen no-cta flush" data-screen="choose">
      <Hero tagline="Someone at this table is lying." lead="A social deduction game for 5 to 11 friends. Nothing to install, nothing to sign up for." />
      <div className="stack gutter">
        <ModeCard
          title="Pass & play"
          body="One phone, everyone in the same room. The phone goes around for roles, night moves and secret ballots, and sits in the middle for the rest."
          image={art('card-table.jpg')}
          badge="Recommended"
          testId="pick-table"
          onClick={() => onPick('table')}
        />
        <ModeCard title="Solo vs bots" body="Learn the flow on your own. Bots join your room and play legally. Try God mode to narrate." image={art('card-solo.jpg')} testId="pick-solo" onClick={() => onPick('solo')} />
        <button className="btn ghost link-rules" onClick={onRules}>
          <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18">
            <path d="M6 3h9l4 4v14H6z M15 3v4h4 M9 12h7 M9 16h7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
          Read the full rules
        </button>
        <p className="muted center">Playing on separate phones needs the hosted version of Undercover.</p>
      </div>
      <Skyline />
    </main>
  );
}

export function LocalApp() {
  const [mode, setMode] = useState<Mode>('choose');
  const [rules, setRules] = useState(false);
  const [tableKey, setTableKey] = useState(0);
  const pick = (m: Mode) => {
    if (m === 'solo') configureSolo(); // before <App/> mounts and connects
    setMode(m);
  };

  if (mode === 'solo') return <App />;

  return (
    <>
      <Atmosphere />
      <div className={`app${mode === 'table' ? ' table-mode' : ''}`} data-phase={mode}>
        <TopBar day={0} phase={null} onRules={() => setRules(true)} showRules={!rules} />
        {rules ? (
          <Rules onBack={() => setRules(false)} />
        ) : mode === 'choose' ? (
          <Choose onPick={pick} onRules={() => setRules(true)} />
        ) : (
          <TableGame
            key={tableKey}
            onExit={() => {
              setTableKey((k) => k + 1);
              setMode('choose');
            }}
          />
        )}
        <MotionPrompt />
      </div>
    </>
  );
}
