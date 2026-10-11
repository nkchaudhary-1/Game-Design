import { useState } from 'react';
import { App } from '../App.js';
import { Atmosphere } from '../components/Atmosphere.js';
import { TopBar } from '../components/ui.js';
import { Rules } from '../screens/Rules.js';
import { configureSolo } from './solo.js';
import { TableGame } from './TableGame.js';

type Mode = 'choose' | 'table' | 'solo';

function Choose({ onPick, onRules }: { onPick: (m: Mode) => void; onRules: () => void }) {
  return (
    <main className="screen no-cta" data-screen="choose">
      <div className="hero">
        <div className="wordmark-big">Undercover</div>
        <p className="narration">Someone at this table is lying.</p>
        <p className="lead">A social deduction game for 5 to 11 friends. Nothing to install, nothing to sign up for.</p>
      </div>
      <button className="card raised" style={{ textAlign: 'left', cursor: 'pointer' }} data-testid="pick-table" onClick={() => onPick('table')}>
        <h2>Pass &amp; play</h2>
        <p className="lead">One phone, everyone in the same room. The phone goes around for roles, night moves and secret ballots, and sits in the middle for the rest.</p>
        <span className="badge strong">Recommended</span>
      </button>
      <button className="card" style={{ textAlign: 'left', cursor: 'pointer' }} data-testid="pick-solo" onClick={() => onPick('solo')}>
        <h2>Solo vs bots</h2>
        <p className="lead">Learn the flow on your own. Bots join your room and play legally. Try God mode to narrate.</p>
      </button>
      <button className="btn ghost" onClick={onRules}>
        Read the full rules
      </button>
      <p className="muted center">Playing on separate phones needs the hosted version of Undercover.</p>
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
        {rules ? <Rules onBack={() => setRules(false)} /> : mode === 'choose' ? <Choose onPick={pick} onRules={() => setRules(true)} /> : <TableGame key={tableKey} onExit={() => { setTableKey((k) => k + 1); setMode('choose'); }} />}
      </div>
    </>
  );
}
