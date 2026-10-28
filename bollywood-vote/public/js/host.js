// Host / projector screen: QR + live turnout, then the big reveal. Controls fade out when idle.

import { h, api, avatar, connect } from './common.js';

const main = document.getElementById('main');
const pill = document.getElementById('pill');
const bar = document.getElementById('bar');
const drawer = document.getElementById('drawer');
const canvas = document.getElementById('confetti');

// ---------- host key + vote URL ----------

const params = new URLSearchParams(location.search);
let hostKey = params.get('key');
try {
  if (hostKey) sessionStorage.setItem('bv:key', hostKey);
  else hostKey = sessionStorage.getItem('bv:key');
} catch { /* sessionStorage blocked: the key in the URL still works for this load */ }

let canControl = false;
if (hostKey) api('/api/host/ping', { hostKey }).then(() => { canControl = true; renderBar(); }).catch(() => {});

let voteUrls = [];
const URL_KEY = 'bv:voteUrl';
const savedUrl = () => { try { return localStorage.getItem(URL_KEY) || ''; } catch { return ''; } };
const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

function voteUrl() {
  return savedUrl() || (isLocal ? voteUrls[0] : `${location.origin}/`) || `${location.origin}/`;
}
api('/api/config').then((c) => { voteUrls = c.voteUrls; remountLobby(); }).catch(() => {});

// ---------- state ----------

let state = null;
let view = null; // { key, update(state) } for the phase currently mounted
let prevPhase = null;
let prevRevealedAt = null;
let revealRun = 0;

const byId = (id) => state.roster.find((p) => p.id === id);
const total = () => state.roster.length;

connect((s) => {
  const first = !state;
  state = s;
  const phaseChanged = s.phase !== prevPhase;
  const replay = s.phase === 'revealed' && prevRevealedAt !== null && s.revealedAt !== prevRevealedAt;
  const toReveal = s.phase === 'revealed' && !first && (phaseChanged || replay);
  prevPhase = s.phase;
  prevRevealedAt = s.revealedAt;
  renderPill();
  if (toReveal) playReveal();
  else if (s.phase !== 'revealed' || first) mountOrUpdate();
  renderBar();
  updateGuests();
});

function renderPill() {
  const label = { waiting: 'Opening soon', open: 'Voting open', closed: 'Voting closed', revealed: 'Results' }[state.phase];
  pill.className = `phase-pill ${state.phase}`;
  pill.querySelector('span').textContent = label;
}

/** Identity of the view the current state calls for; a change means rebuild, otherwise update in place. */
function viewKey() {
  const roster = state.roster.map((p) => p.id + p.name).join();
  if (state.phase === 'closed') return `closed|${state.epoch}|${roster}`;
  if (state.phase === 'revealed') return `revealed|${state.epoch}|${state.revealedAt}`;
  return `lobby|${state.epoch}|${roster}|${state.showLive && state.phase === 'open'}`;
}

function mountOrUpdate() {
  if (!view || view.key !== viewKey()) mount();
  else view.update(state);
}

function mount() {
  revealRun += 1; // cancels a drumroll in flight
  confettiRun += 1;
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  view = state.phase === 'closed' ? closedView() : state.phase === 'revealed' ? resultView() : lobbyView();
  main.replaceChildren(view.el);
  view.update(state);
}

function remountLobby() {
  if (state && view?.key.startsWith('lobby')) mount();
}

// ---------- lobby: QR + turnout ----------

function qrSvg(url) {
  const qr = window.qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 8, scalable: true });
}

function chip(p) {
  return h('div', { class: 'chip', 'data-id': p.id }, avatar(p), h('span', { class: 'n' }, p.name), h('span', { class: 'tick' }, ''));
}

function barRow(rank, p, count, max, win) {
  return h(
    'div',
    { class: `bar-row${win ? ' win' : ''}` },
    h('span', { class: 'rank' }, rank),
    h('span', { class: 'nm' }, p.name),
    h('span', { class: 'track' }, h('b', { style: `width:${max ? (count / max) * 100 : 0}%` })),
    h('span', { class: 'ct' }, count),
  );
}

function lobbyView() {
  const url = voteUrl();
  const liveOn = state.showLive && state.phase === 'open';
  const qrBox = h('div', { class: 'qr-card', role: 'img', 'aria-label': `QR code for ${url}` });
  qrBox.innerHTML = qrSvg(url); // markup comes from the QR library, built only from our own URL string
  const scan = h('div', { class: 'scan' });
  const urlLine = h('div', { class: 'url' }, h('span', {}, url.replace(/^https?:\/\//, '')));
  const num = h('span', { class: 'num' }, '0');
  const of = h('span', { class: 'of' }, '');
  const label = h('span', { class: 'label' }, '');
  const meter = h('b');
  const chips = h('div', { class: 'chips' }, state.roster.map(chip));
  const live = h('div', { class: 'live' });
  const warn = h('div', { class: 'notice', hidden: true }, '');

  const el = h(
    'div',
    { class: 'stage-main' },
    h('div', { class: 'qr-col' }, qrBox, scan, urlLine),
    h('div', { class: 'board' }, h('div', { class: 'turnout' }, num, of, label), h('div', { class: 'meter' }, meter), liveOn ? live : chips, warn),
  );

  let prev = new Set();
  let firstPaint = true;
  return {
    key: viewKey(),
    el,
    update(s) {
      const open = s.phase === 'open';
      scan.replaceChildren(open ? 'Scan & ' : 'Scan to ', h('em', {}, open ? 'vote' : 'join'));
      const on = new Set(open ? s.voted : s.claimed);
      num.textContent = on.size;
      of.textContent = `/ ${s.roster.length}`;
      label.textContent = open ? 'have voted' : 'have joined — voting opens soon';
      meter.style.width = `${s.roster.length ? (on.size / s.roster.length) * 100 : 0}%`;
      for (const c of chips.children) {
        const isOn = on.has(c.dataset.id);
        c.classList.toggle('on', isOn);
        c.querySelector('.tick').textContent = isOn ? (open ? '✓' : '') : '';
        if (isOn && !firstPaint && !prev.has(c.dataset.id)) {
          c.classList.remove('pop');
          void c.offsetWidth; // restart the animation
          c.classList.add('pop');
        }
      }
      prev = on;
      firstPaint = false;
      if (liveOn && s.tallies) {
        const rows = s.roster.map((p) => [p, s.tallies[p.id] ?? 0]).sort((a, b) => b[1] - a[1] || a[0].name.localeCompare(b[0].name)).slice(0, 6);
        const max = rows[0]?.[1] ?? 0;
        live.replaceChildren(h('h3', { class: 'kicker' }, 'Live standings'), ...rows.map(([p, n], i) => barRow(i + 1, p, n, max, false)));
      }
      const local = /^https?:\/\/(localhost|127\.|\[::1\])/.test(voteUrl());
      warn.hidden = !local;
      warn.textContent = local ? 'No WiFi address found, so phones cannot reach this link. Open Settings and set the voting link.' : '';
    },
  };
}

// ---------- closed ----------

function closedView() {
  const sub = h('div', { class: 'muted', style: 'font-size:clamp(16px,3vmin,40px)' });
  const el = h(
    'div',
    { class: 'stage-main' },
    h('div', { class: 'closed-card' }, h('div', { class: 'big' }, 'Voting ', h('em', {}, 'closed')), h('div', { class: 'big', style: 'font-size:clamp(24px,5vmin,70px)' }, 'Counting the votes…'), sub),
  );
  return { key: viewKey(), el, update: (s) => { sub.textContent = `${s.voted.length} of ${s.roster.length} votes in`; } };
}

// ---------- reveal ----------

function standings() {
  const t = state.tallies ?? {};
  return state.roster
    .map((p) => [p, t[p.id] ?? 0])
    .sort((a, b) => b[1] - a[1] || a[0].name.localeCompare(b[0].name));
}

function resultView() {
  const winners = (state.winners ?? []).map(byId);
  const tie = winners.length > 1;
  const rows = standings().filter(([, n]) => n > 0).slice(0, tie ? 4 : 10);
  const max = rows[0]?.[1] ?? 0;

  const cards = winners.map((p) =>
    h(
      'div',
      { class: 'winner' },
      h('div', { class: 'ribbon' }, tie ? '★ Joint winner ★' : '★ Best dressed ★'),
      avatar(p),
      h('div', { class: 'wname' }, p.name),
      p.character && h('div', { class: 'wchar' }, p.character),
      h('div', { class: 'wvotes' }, `${max} ${max === 1 ? 'vote' : 'votes'}`),
    ),
  );

  const el = winners.length
    ? h(
        'div',
        { class: `reveal${tie ? ' tie' : ''}` },
        tie && h('div', { class: 'tie-note' }, "It's a tie!"),
        h('div', { class: 'winners' }, cards),
        h('div', { class: 'ranking' }, rows.map(([p, n], i) => barRow(i + 1, p, n, max, winners.includes(p)))),
      )
    : h('div', { class: 'empty-note' }, 'No votes were cast.');

  return { key: viewKey(), el, update() {} };
}

async function playReveal() {
  const run = ++revealRun;
  view = null;
  bar.classList.add('idle');
  const stop = () => run !== revealRun;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const drum = h('div', { class: 'drum' });
  main.replaceChildren(drum);

  sound.drumroll(3.6);
  for (const n of [3, 2, 1]) {
    drum.replaceChildren(h('div', { class: 'count' }, n));
    await wait(1000);
    if (stop()) return;
  }
  drum.replaceChildren(h('div', { class: 'line' }, 'And the best dressed is…'));
  await wait(1700);
  if (stop()) return;

  const v = resultView();
  view = v;
  main.replaceChildren(v.el);
  if (state.winners?.length) {
    sound.fanfare();
    confetti();
  }
}

// ---------- sound (WebAudio, no assets) ----------

const sound = (() => {
  let ac;
  const ctx = () => (ac ??= new (window.AudioContext || window.webkitAudioContext)());
  const tone = (freq, t0, dur, type = 'sawtooth', gain = 0.1) => {
    const a = ctx();
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.value = freq;
    o.connect(g).connect(a.destination);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  };
  return {
    unlock() { try { ctx().resume(); } catch { /* no audio */ } },
    drumroll(seconds) {
      try {
        const a = ctx();
        const len = Math.floor(a.sampleRate * 0.09);
        const buf = a.createBuffer(1, len, a.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
        let at = 0;
        let gap = 0.17;
        while (at < seconds) {
          const src = a.createBufferSource();
          const f = a.createBiquadFilter();
          const g = a.createGain();
          src.buffer = buf;
          f.type = 'bandpass';
          f.frequency.value = 260;
          g.gain.value = 0.25 + (at / seconds) * 0.5;
          src.connect(f).connect(g).connect(a.destination);
          src.start(a.currentTime + at);
          at += gap;
          gap = Math.max(0.04, gap * 0.9);
        }
      } catch { /* no audio */ }
    },
    fanfare() {
      try {
        const t = ctx().currentTime;
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, t + i * 0.13, 1.1));
        tone(261.63, t, 1.6, 'triangle', 0.16);
      } catch { /* no audio */ }
    },
  };
})();

// ---------- confetti ----------

let confettiRun = 0;
function confetti() {
  const run = ++confettiRun;
  const ctx2d = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  const colors = ['#f6c453', '#ffe19a', '#ff3d81', '#ff8a3d', '#ffffff', '#7c4dff'];
  const bits = Array.from({ length: 220 }, () => ({
    x: Math.random() * canvas.width,
    y: -Math.random() * canvas.height * 0.5,
    w: (6 + Math.random() * 8) * dpr,
    hgt: (10 + Math.random() * 10) * dpr,
    vx: (Math.random() - 0.5) * 4 * dpr,
    vy: (2 + Math.random() * 5) * dpr,
    rot: Math.random() * 6.28,
    vr: (Math.random() - 0.5) * 0.3,
    c: colors[Math.floor(Math.random() * colors.length)],
  }));
  const end = performance.now() + 7000;
  (function frame(now) {
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    for (const b of bits) {
      b.x += b.vx;
      b.y += b.vy;
      b.rot += b.vr;
      ctx2d.save();
      ctx2d.translate(b.x, b.y);
      ctx2d.rotate(b.rot);
      ctx2d.fillStyle = b.c;
      ctx2d.fillRect(-b.w / 2, -b.hgt / 2, b.w, b.hgt);
      ctx2d.restore();
    }
    if (now < end && run === confettiRun) requestAnimationFrame(frame);
    else if (run === confettiRun) ctx2d.clearRect(0, 0, canvas.width, canvas.height);
  })(performance.now());
}

// ---------- host controls ----------

const post = (path, body) => api(path, { method: 'POST', body, hostKey });
const setPhase = (phase) => { sound.unlock(); post('/api/host/phase', { phase }).catch((e) => alert(`Could not change phase: ${e.message}`)); };

let barSig = '';
function renderBar() {
  if (!state || !canControl) return void (bar.hidden = true);
  const sig = `${state.phase}|${state.showLive}`;
  if (sig === barSig) return;
  barSig = sig;
  bar.hidden = false;
  const btn = (label, onclick, cls = 'btn ghost') => h('button', { class: cls, onclick }, label);
  const settings = btn('⚙ Settings', openDrawer);
  const live = h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: state.showLive, onchange: (e) => post('/api/host/live', { showLive: e.target.checked }) }), 'Live standings');
  const items = {
    waiting: [settings, btn('Open voting ▶', () => setPhase('open'), 'btn primary')],
    open: [live, settings, btn('Close voting ■', () => setPhase('closed'), 'btn primary')],
    closed: [settings, btn('Reopen voting', () => setPhase('open')), btn('Reveal winner 🏆', () => setPhase('revealed'), 'btn primary')],
    revealed: [settings, btn('Reopen voting', () => setPhase('open')), btn('Replay reveal ↻', () => setPhase('revealed'), 'btn primary')],
  }[state.phase];
  bar.replaceChildren(...items);
}

let idleTimer;
function wake() {
  if (drawer.classList.contains('open')) return;
  bar.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => bar.classList.add('idle'), 4000);
}
for (const ev of ['mousemove', 'pointerdown', 'keydown', 'touchstart']) addEventListener(ev, wake, { passive: true });
wake();

// ---------- settings drawer ----------

let guestsEl = null;

function openDrawer() {
  bar.classList.add('idle');
  const urlInput = h('input', { type: 'text', value: voteUrl(), 'aria-label': 'Voting link', spellcheck: 'false' });
  const choices = voteUrls.length > 1 ? h('select', { 'aria-label': 'Detected addresses', onchange: (e) => { urlInput.value = e.target.value; } }, voteUrls.map((u) => h('option', { value: u }, u))) : null;
  const saveUrl = h('button', { class: 'btn small', onclick: () => {
    try { localStorage.setItem(URL_KEY, urlInput.value.trim()); } catch { /* ignore */ }
    remountLobby();
  } }, 'Update QR');

  const locked = state.phase !== 'waiting';
  const ta = h('textarea', { 'aria-label': 'Roster', spellcheck: 'false', disabled: locked }, state.roster.map((p) => (p.character ? `${p.name} | ${p.character}` : p.name)).join('\n'));
  const saveRoster = h('button', { class: 'btn small', disabled: locked, onclick: async () => {
    try {
      const r = await post('/api/host/roster', { text: ta.value });
      saveRoster.textContent = `Saved ${r.count} people ✓`;
    } catch (e) {
      alert(e.code === 'need_two' ? 'Add at least two people.' : `Could not save: ${e.message}`);
    }
  } }, 'Save roster');

  guestsEl = h('div');
  const reset = h('button', { class: 'btn small danger', onclick: async () => {
    if (confirm('Clear all votes and let everyone pick their name again?')) await post('/api/host/reset', {});
  } }, 'Reset everything');

  drawer.replaceChildren(
    h('button', { class: 'btn ghost small', style: 'float:right', onclick: closeDrawer }, 'Close ✕'),
    h('h2', { class: 'display' }, 'Host settings'),
    h('section', {}, h('h3', {}, 'Voting link (in the QR)'), choices, urlInput, h('p', { class: 'hint' }, 'Phones must be on the same WiFi as this laptop, or use a public link.'), saveUrl),
    h('section', {}, h('h3', {}, `Guests (${total()})`), h('p', { class: 'hint' }, 'Name taken by mistake or a phone died? Release the name so they can pick again.'), guestsEl),
    h('section', {}, h('h3', {}, 'Roster'), ta, h('p', { class: 'hint' }, locked ? 'Locked once voting has opened. Reset to edit.' : 'One person per line: Name | Character'), saveRoster),
    h('section', {}, h('h3', {}, 'Danger zone'), reset),
  );
  updateGuests();
  drawer.classList.add('open');
}

function closeDrawer() {
  drawer.classList.remove('open');
  guestsEl = null;
  wake();
}

function updateGuests() {
  if (!guestsEl || !state) return;
  guestsEl.replaceChildren(
    ...state.roster.map((p) => {
      const claimed = state.claimed.includes(p.id);
      const voted = state.voted.includes(p.id);
      return h(
        'div',
        { class: 'row' },
        avatar(p, 28),
        h('span', {}, p.name),
        h('span', { class: `st${voted ? ' ok' : ''}` }, voted ? 'voted' : claimed ? 'joined' : '—'),
        claimed && h('button', { onclick: () => post('/api/host/release', { voterId: p.id }) }, 'Release'),
      );
    }),
  );
}
