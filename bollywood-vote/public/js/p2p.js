// Phone <-> host link, with no server of our own. PeerJS's free public broker only introduces the two browsers; after that,
// requests and votes travel directly between them over a WebRTC data channel and never touch any third-party storage.
//
//   host:  startHostServer()  answers guests' requests with the voting rules and pushes every change to every phone
//   guest: createGuestTransport()  looks like a normal request/response client plus a "state changed" push
//
// Messages (JSON):  guest -> host {t:'req', id, method, path, query, body}   host -> guest {t:'res', id, status, body}
//                   host -> guest {t:'state', state}   (sent on connect and on every change)

const safeSend = (conn, data) => {
  try { conn.send(data); } catch { /* the connection is going away; its close handler cleans up */ }
};

/** A short, hard-to-guess id for the host's peer: it is what the QR code carries. */
export function newHostId() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return `bn-${[...bytes].map((b) => alphabet[b % alphabet.length]).join('')}`;
}

/** Direct, in-page transport for the host's own screen: no network involved. */
export function createLocalTransport(core, hostKey) {
  return {
    request: async ({ method, path, query, body, hostKey: key }) => core.handle({ method, path, query, body, hostKey: key ?? hostKey }),
    subscribe: (fn) => core.subscribe(fn),
    onStatus: (fn) => fn('connected'),
  };
}

// ---------------------------------------------------------------------------------------------------- host

export function startHostServer({ core, getId, setId, onStatus = () => {}, PeerClass = globalThis.Peer, peerOpts = globalThis.BN_PEER_OPTS ?? {}, retryMs = 2000 }) {
  const conns = new Set();
  const status = { state: 'connecting', id: null, guests: 0, detail: '' };
  let peer = null;
  let stopped = false;
  let idTries = 0;
  const emit = (patch) => { Object.assign(status, patch); onStatus({ ...status }); };

  const unsubscribe = core.subscribe((state) => {
    for (const c of conns) safeSend(c, { t: 'state', state });
  });

  function onMessage(conn, msg) {
    if (!msg || msg.t !== 'req' || typeof msg.path !== 'string') return;
    let out;
    try {
      // A guest never supplies a host key: host-only routes always answer 401 to a phone.
      out = core.handle({ method: String(msg.method || 'GET').toUpperCase(), path: msg.path, query: msg.query || {}, body: msg.body || {}, hostKey: undefined });
    } catch {
      out = { status: 500, body: { error: 'host_error' } };
    }
    safeSend(conn, { t: 'res', id: msg.id, status: out.status, body: out.body });
  }

  function start() {
    if (stopped) return;
    peer = new PeerClass(getId(), peerOpts);

    peer.on('open', (id) => {
      idTries = 0;
      emit({ state: 'ready', id, detail: '' });
    });

    peer.on('connection', (conn) => {
      conn.on('open', () => {
        conns.add(conn);
        emit({ guests: conns.size });
        safeSend(conn, { t: 'state', state: core.publicState() });
      });
      conn.on('data', (msg) => onMessage(conn, msg));
      const drop = () => { if (conns.delete(conn)) emit({ guests: conns.size }); };
      conn.on('close', drop);
      conn.on('error', drop);
    });

    peer.on('disconnected', () => {
      // Lost the broker (WiFi blip): phones already connected keep working, but new ones can't join until we re-register.
      emit({ state: 'connecting', detail: 'Reconnecting to the connection service…' });
      setTimeout(() => { if (!stopped && peer && !peer.destroyed) peer.reconnect(); }, retryMs);
    });

    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        // The broker still holds this id from a tab that just closed or refreshed; it expires within a minute or so.
        idTries += 1;
        try { peer.destroy(); } catch { /* already gone */ }
        if (idTries > 20) { setId(newHostId()); idTries = 0; }
        emit({ state: 'connecting', detail: idTries > 3 ? 'Waiting for the previous host tab to close. Is another tab open?' : 'Connecting…' });
        setTimeout(start, retryMs);
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
        emit({ state: 'error', detail: 'Can’t reach the connection service. Check the internet connection.' });
      } else if (err.type === 'browser-incompatible') {
        emit({ state: 'error', detail: 'This browser can’t do WebRTC. Use a recent Chrome, Edge, Safari or Firefox.' });
      } else {
        emit({ state: 'error', detail: `Connection problem (${err.type}).` });
      }
    });
  }

  start();
  return {
    status: () => ({ ...status }),
    stop() {
      stopped = true;
      unsubscribe();
      for (const c of conns) { try { c.close(); } catch { /* ignore */ } }
      try { peer?.destroy(); } catch { /* ignore */ }
    },
  };
}

// ---------------------------------------------------------------------------------------------------- guest

export function createGuestTransport({ hostId, PeerClass = globalThis.Peer, peerOpts = globalThis.BN_PEER_OPTS ?? {}, requestTimeoutMs = 8000, connectTimeoutMs = 12000, retryMs = 1500 }) {
  const stateListeners = new Set();
  const statusListeners = new Set();
  const pending = new Map(); // request id -> { resolve, reject, timer }
  const waiting = new Set(); // requests made while the link is down: { send, reject, timer }
  let peer = null;
  let conn = null;
  let connected = false;
  let stopped = false;
  let retryTimer = null;
  let status = 'connecting';
  let detail = '';
  let n = 0;

  const setStatus = (s, d = '') => {
    status = s;
    detail = d;
    for (const fn of statusListeners) fn(s, d);
  };

  function failPending(message) {
    for (const [id, p] of pending) { clearTimeout(p.timer); p.reject(new Error(message)); pending.delete(id); }
  }

  function scheduleRetry() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connectToHost, retryMs);
  }

  function connectToHost() {
    if (stopped || !peer || peer.destroyed) return;
    if (peer.disconnected) { try { peer.reconnect(); } catch { /* retried below */ } }
    const c = peer.connect(hostId, { reliable: true, serialization: 'json' });
    conn = c;
    const giveUp = setTimeout(() => {
      if (conn === c && !connected) {
        try { c.close(); } catch { /* ignore */ }
        setStatus('host-offline', 'Can’t find the host. Is their screen still open?');
        scheduleRetry();
      }
    }, connectTimeoutMs);

    c.on('open', () => {
      clearTimeout(giveUp);
      connected = true;
      setStatus('connected');
      for (const w of [...waiting]) { clearTimeout(w.timer); waiting.delete(w); w.send(); }
    });
    c.on('data', (msg) => {
      if (!msg) return;
      if (msg.t === 'res') {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        clearTimeout(p.timer);
        p.resolve({ status: msg.status, body: msg.body });
      } else if (msg.t === 'state') {
        for (const fn of stateListeners) fn(msg.state);
      }
    });
    const lost = () => {
      clearTimeout(giveUp);
      if (conn !== c) return;
      const wasUp = connected;
      connected = false;
      failPending('connection_lost');
      setStatus(wasUp ? 'reconnecting' : status, wasUp ? 'Reconnecting…' : detail);
      scheduleRetry();
    };
    c.on('close', lost);
    c.on('error', lost);
  }

  function start() {
    peer = new PeerClass(peerOpts);
    peer.on('open', connectToHost);
    peer.on('disconnected', () => { if (!stopped && !peer.destroyed) { try { peer.reconnect(); } catch { /* retried */ } } });
    peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') {
        setStatus('host-offline', 'Can’t find the host. Is their screen still open, and is this the latest QR code?');
        scheduleRetry();
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
        setStatus('offline', 'Can’t reach the connection service. Check your internet connection.');
      } else if (err.type === 'browser-incompatible') {
        setStatus('offline', 'This browser can’t connect to the host. Try Chrome or Safari.');
      }
    });
  }

  start();
  return {
    request({ method, path, query, body }) {
      return new Promise((resolve, reject) => {
        const send = () => {
          const id = ++n;
          const timer = setTimeout(() => { pending.delete(id); reject(new Error('timeout')); }, requestTimeoutMs);
          pending.set(id, { resolve, reject, timer });
          try {
            conn.send({ t: 'req', id, method, path, query, body });
          } catch (e) {
            pending.delete(id);
            clearTimeout(timer);
            reject(e);
          }
        };
        if (connected) return send();
        const w = { send, reject };
        w.timer = setTimeout(() => { waiting.delete(w); reject(new Error('not_connected')); }, connectTimeoutMs);
        waiting.add(w);
      });
    },
    subscribe(fn) { stateListeners.add(fn); return () => stateListeners.delete(fn); },
    onStatus(fn) { statusListeners.add(fn); fn(status, detail); return () => statusListeners.delete(fn); },
    status: () => ({ status, detail }),
    stop() {
      stopped = true;
      clearTimeout(retryTimer);
      failPending('stopped');
      try { peer?.destroy(); } catch { /* ignore */ }
    },
  };
}
