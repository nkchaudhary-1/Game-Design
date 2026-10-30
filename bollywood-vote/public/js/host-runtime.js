// The host's browser is the server: it holds the game in localStorage, runs the voting rules, and answers the phones.
// host.js only talks to what this returns, so a different runtime (the click-through demo) can stand in.

import { createCore } from './core.js';
import { startHostServer, createLocalTransport, newHostId } from './p2p.js';

const STATE_KEY = 'bn:state'; // the whole game: guest list, claims, votes, phase, clock
const ID_KEY = 'bn:hostId'; // keeps the QR code valid across a refresh

const storage = {
  read(key) { try { return localStorage.getItem(key); } catch { return null; } },
  write(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};

const randomId = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Calls fn twice a second. A background tab's own timers are slowed to once a minute after a while, which would delay the
 * auto-close if the host switches tabs while sharing their screen; a worker's timer is not slowed that way.
 */
function startTicker(fn) {
  try {
    const url = URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 500)'], { type: 'text/javascript' }));
    const worker = new Worker(url);
    worker.onmessage = fn;
    return;
  } catch { /* workers blocked: fall back to the page's own timer */ }
  setInterval(fn, 500);
}

export function startHostRuntime() {
  let saved = {};
  try { saved = JSON.parse(storage.read(STATE_KEY) ?? '{}') ?? {}; } catch { /* a damaged save is treated as a fresh start */ }

  let canSave = true;
  const core = createCore({ saved, randomId, persist: (s) => { canSave = storage.write(STATE_KEY, JSON.stringify(s)); } });
  const transport = createLocalTransport(core, core.hostKey());

  let hostId = storage.read(ID_KEY) || newHostId();
  storage.write(ID_KEY, hostId);
  const listeners = new Set();
  let last = { state: 'connecting', id: hostId, guests: 0, detail: '' };
  const server = startHostServer({
    core,
    getId: () => hostId,
    setId: (id) => { hostId = id; storage.write(ID_KEY, id); },
    onStatus: (s) => { last = s; for (const fn of listeners) fn(s); },
  });
  startTicker(core.tick); // closes the vote the moment time is up

  return {
    core,
    transport,
    /** What the QR code opens: the guest page, carrying the host's peer id. */
    joinUrl: () => `${new URL('vote', location.href).href}#${last.id ?? hostId}`,
    link: () => ({ ...last }),
    onLink(fn) { listeners.add(fn); fn({ ...last }); return () => listeners.delete(fn); },
    /** False when the browser refuses to save (private mode, storage full): details would be lost on refresh. */
    canSave: () => canSave && storage.write('bn:probe', '1'),
    /** Forget everything stored in this browser: guest list, votes and the QR code's id. */
    wipe() { storage.remove(STATE_KEY); storage.remove(ID_KEY); },
    stop: () => server.stop(),
  };
}
