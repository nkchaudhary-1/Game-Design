// Shared helpers for the guest page and the host screen.

/** Tiny hyperscript: h('div', {class: 'x', onclick: fn}, 'text', childNode). Text goes through textContent, never innerHTML. */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// Nothing here talks HTTP: the host's browser holds the game, so requests go through a transport. On the host screen it is a
// direct call into the voting rules; on a guest's phone it is a message over a WebRTC data channel to the host (see p2p.js).
let transport = null;
export function setTransport(t) { transport = t; }

/** Sends a request like the old HTTP API: api('/api/vote', { method: 'POST', body }) -> body, or throws with .code/.status. */
export async function api(path, { method = 'GET', body, hostKey } = {}) {
  const u = new URL(path, 'http://x');
  const out = await transport.request({ method, path: u.pathname, query: Object.fromEntries(u.searchParams), body: body ?? {}, hostKey });
  if (out.status >= 400) throw Object.assign(new Error(out.body?.error || `HTTP ${out.status}`), { code: out.body?.error, status: out.status });
  return out.body;
}

const HUES = ['#e8336d', '#ff8a3d', '#c9890a', '#7c4dff', '#1f9d8a', '#d9467a', '#4f6df5', '#b5532a'];
export function avatarColor(id) {
  let n = 0;
  for (const ch of id) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[n % HUES.length];
}

export function avatar(person, size) {
  return h(
    'span',
    { class: 'avatar', 'aria-hidden': 'true', style: `--av:${avatarColor(person.id)}${size ? `;--size:${size}px` : ''}` },
    [...person.name][0]?.toUpperCase() ?? '?',
  );
}

/** The host's clock, as seen from this device: clock.now() is "now" in the host's time, so countdowns agree on every screen. */
export const clock = { offset: 0, now: () => Date.now() + clock.offset };

/**
 * Live state: the host pushes every change, with a slow pull as a safety net.
 * onState(state) fires for every change; onConn(true|false) reports whether the link to the host is up.
 */
export function connect(onState, onConn = () => {}) {
  let last = '';
  const push = (state) => {
    if (state.serverNow) clock.offset = state.serverNow - Date.now();
    const { serverNow, ...rest } = state; // the host's clock changes on every message and must not defeat de-duplication
    const sig = JSON.stringify(rest);
    if (sig === last) return;
    last = sig;
    onState(state);
  };
  const pull = () => api('/api/state').then(push).catch(() => {});

  transport.subscribe?.(push);
  transport.onStatus?.((status) => onConn(status === 'connected'));
  pull();
  setInterval(() => { if (!document.hidden) pull(); }, 10000);
}
