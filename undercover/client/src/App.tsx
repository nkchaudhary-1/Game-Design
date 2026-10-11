import { isValidRoomCode } from '@undercover/shared';
import { useCallback, useEffect, useState } from 'react';
import { Atmosphere } from './components/Atmosphere.js';
import { Banner, TopBar } from './components/ui.js';
import { MotionPrompt } from './components/MotionPrompt.js';
import { Announcement, Discussion, Ended, Night, RoleReveal, Voting } from './screens/Game.js';
import { Join } from './screens/Join.js';
import { Landing } from './screens/Landing.js';
import { Rules } from './screens/Rules.js';
import { Waiting } from './screens/Waiting.js';
import { useGame } from './useGame.js';
import { client } from './ws.js';

function codeFromPath(path: string): string | null {
  const m = path.match(/^\/join\/([A-Za-z0-9]{6})\/?$/);
  if (!m) return null;
  const code = m[1].toUpperCase();
  return isValidRoomCode(code) ? code : null;
}

export function App() {
  const g = useGame();
  const [rules, setRules] = useState(false);
  const [path, setPath] = useState(location.pathname);
  const [manualCode, setManualCode] = useState<string | null>(null);

  useEffect(() => {
    client.connect();
    const nudge = () => {
      if (!document.hidden) client.nudge();
    };
    document.addEventListener('visibilitychange', nudge);
    window.addEventListener('online', nudge);
    window.addEventListener('focus', nudge);
    const onPop = () => setPath(location.pathname);
    window.addEventListener('popstate', onPop);
    return () => {
      document.removeEventListener('visibilitychange', nudge);
      window.removeEventListener('online', nudge);
      window.removeEventListener('focus', nudge);
      window.removeEventListener('popstate', onPop);
    };
  }, []);

  // Keep the address bar on the invite link while in a room, so sharing the URL just works.
  useEffect(() => {
    if (!client.staticPage && g.view && location.pathname !== `/join/${g.view.code}`) {
      history.replaceState(null, '', `/join/${g.view.code}`);
      setPath(`/join/${g.view.code}`);
    }
  }, [g.view?.code]);

  const leave = useCallback(() => {
    g.leave();
    setManualCode(null);
    if (!client.staticPage) {
      history.replaceState(null, '', '/');
      setPath('/');
    }
  }, [g]);

  const joinCode = manualCode ?? codeFromPath(path);
  const view = g.view;
  const phase = view?.phase ?? null;

  let content: React.ReactNode;
  if (rules) {
    content = <Rules onBack={() => setRules(false)} />;
  } else if (!g.resolved) {
    content = (
      <main className="screen center no-cta" data-screen="loading">
        <p className="narration">Lighting the lamps...</p>
      </main>
    );
  } else if (!view) {
    content = joinCode ? (
      <Join
        code={joinCode}
        send={g.send}
        error={g.error}
        clearError={g.clearError}
        onBack={() => {
          setManualCode(null);
          history.replaceState(null, '', '/');
          setPath('/');
        }}
      />
    ) : (
      <Landing send={g.send} error={g.error} clearError={g.clearError} onRules={() => setRules(true)} onJoin={(code) => setManualCode(code)} />
    );
  } else {
    const props = { view, send: g.send, offset: g.clockOffset, error: g.error, clearError: g.clearError };
    switch (view.phase) {
      case 'waiting':
        content = <Waiting {...props} onLeave={leave} />;
        break;
      case 'roleReveal':
        content = <RoleReveal {...props} />;
        break;
      case 'night':
        content = <Night {...props} />;
        break;
      case 'dayReveal':
      case 'voteResult':
        content = <Announcement {...props} />;
        break;
      case 'discussion':
        content = <Discussion {...props} />;
        break;
      case 'voting':
        content = <Voting {...props} />;
        break;
      case 'ended':
        content = <Ended {...props} onNewGame={leave} />;
        break;
    }
  }

  return (
    <>
      <Atmosphere />
      <div className="app" data-phase={phase ?? 'none'} data-role={view?.you.role ?? undefined} data-connection={g.status}>
        <TopBar day={view?.day ?? 0} phase={phase} onRules={() => setRules(true)} showRules={!rules} />
        <Banner status={g.status} />
        {content}
        <MotionPrompt />
      </div>
    </>
  );
}
