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

export async function api(path, { method = 'GET', body, hostKey } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(hostKey ? { 'X-Host-Key': hostKey } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { code: data.error, status: res.status });
  return data;
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

/** The server's clock, as seen from this device: clock.now() is "now" in server time, for countdowns that agree on every screen. */
export const clock = { offset: 0, now: () => Date.now() + clock.offset };

/**
 * Live state. The Node server pushes over Server-Sent Events (with a slow poll as a safety net); a serverless host
 * (/api/config says transport "poll") is polled every couple of seconds, pausing while the tab is hidden.
 * onState(state) fires for every change; onConn(true|false) reports link health.
 */
export function connect(onState, onConn = () => {}) {
  let last = '';
  const push = (state) => {
    if (state.serverNow) clock.offset = state.serverNow - Date.now();
    const { serverNow, ...rest } = state; // the server's clock changes on every response and must not defeat de-duplication
    const sig = JSON.stringify(rest);
    if (sig === last) return;
    last = sig;
    onState(state);
  };
  const poll = () => api('/api/state').then((st) => { onConn(true); push(st); }).catch(() => onConn(false));

  poll();
  api('/api/config')
    .catch(() => ({}))
    .then((cfg) => {
      if (cfg.transport === 'poll') {
        setInterval(() => { if (!document.hidden) poll(); }, cfg.pollMs || 2000);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
        return;
      }
      const es = new EventSource('/api/stream');
      es.onmessage = (e) => { onConn(true); push(JSON.parse(e.data)); };
      es.onerror = () => onConn(false);
      setInterval(poll, 8000);
    });
}
