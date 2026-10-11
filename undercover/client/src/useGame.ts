import { useEffect, useState } from 'react';
import { client, type ClientState } from './ws.js';

export function useGame(): ClientState & { send: typeof client.send; clearError: () => void; leave: () => void } {
  const [state, setState] = useState<ClientState>(client.state);
  useEffect(() => client.subscribe(setState), []);
  return {
    ...state,
    send: (m) => client.send(m),
    clearError: () => client.clearError(),
    leave: () => client.leave(),
  };
}

/** Countdown to a server timestamp, re-rendering about 4x per second. */
export function useCountdown(endsAt: number | null, offset: number): number | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (endsAt === null) return;
    const id = window.setInterval(() => tick((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, [endsAt]);
  if (endsAt === null) return null;
  return Math.max(0, endsAt - (Date.now() + offset));
}
