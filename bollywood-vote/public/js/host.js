// Host / projector screen. The night in four steps:
//   1. type the guest names   2. "ready" (awards happen)   3. QR + 5-minute clock   4. curtain reveal
// Controls fade out when idle so the projector stays clean.

import { h, api, avatar, connect, clock } from './common.js';

const main = document.getElementById('main');
const pill = document.getElementById('pill');
const bar = document.getElementById('bar');
const drawer = document.getElementById('drawer');
const canvas = document.getElementById('confetti');

const SAMPLE_NAMES = [
  'Aarav | Raj — DDLJ', 'Ananya | Simran — DDLJ', 'Rohan | Gabbar — Sholay', 'Meera | Basanti — Sholay', 'Kabir | Munna Bhai',
  'Isha | Geet — Jab We Met', 'Vikram | Rancho — 3 Idiots', 'Tara | Piku', 'Dev | Devdas', 'Naina | Naina — Kal Ho Naa Ho',
  'Arjun | Don', 'Riya | Anjali — Kuch Kuch Hota Hai', 'Sameer | Chulbul Pandey — Dabangg', 'Zoya | Zoya — ZNMD', 'Karan | Rocky — KKHH',
  'Pooja | Poo — K3G', 'Nikhil | Bhaiyyaji', 'Sana | Mastani — Bajirao Mastani', 'Yash | Veeru — Sholay', 'Diya | Chandni',
];

// ---------- host key + vote URL ----------

const params = new URLSearchParams(location.search);
let hostKey = params.get('key') || globalThis.__BV_HOST_KEY || null; // the global is set by the embedded demo, which has no URL
try {
  if (hostKey) sessionStorage.setItem('bv:key', hostKey);
  else hostKey = sessionStorage.getItem('bv:key');
} catch { /* sessionStorage blocked: the key in the URL still works for this load */ }

let canControl = false;
let checked = false; // until the server has said whether this screen is the host, show nothing rather than flash the wrong thing

/** Asks the server whether this screen is the host. Locally the laptop itself always is; hosted, it needs ?key=. */
function checkHost() {
  return api('/api/host/ping', { hostKey })
    .then(() => { canControl = true; })
    .catch(() => { canControl = false; })
    .finally(() => { checked = true; if (state) { renderPill(); mountOrUpdate(); renderBar(); } });
}
checkHost();

let voteUrls = [];
const URL_KEY = 'bv:voteUrl';
const MIN_KEY = 'bv:minutes';
const store = {
  get: (k, d = '') => { try { return localStorage.getItem(k) || d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
const isLocal = !location.hostname || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

function voteUrl() {
  return store.get(URL_KEY) || (isLocal ? voteUrls[0] : `${location.origin}/`) || `${location.origin}/`;
}
api('/api/config').then((c) => { voteUrls = c.voteUrls ?? []; remountVote(); }).catch(() => {});

const voteMinutes = () => Number(store.get(MIN_KEY, '5')) || 5;

// ---------- state ----------

let state = null;
let view = null; // { key, el, update(state), clockEl? } for what is mounted
let prevPhase = null;
let prevRevealedAt = null;
let revealRun = 0;
let editing = false; // the names screen reopened from "Edit names"

const byId = (id) => state.roster.find((p) => p.id === id);
const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function applyState(s) {
  const first = !state;
  state = s;
  const replay = s.phase === 'revealed' && prevRevealedAt !== null && s.revealedAt !== prevRevealedAt;
  const toReveal = s.phase === 'revealed' && !first && (s.phase !== prevPhase || replay);
  prevPhase = s.phase;
  prevRevealedAt = s.revealedAt;
  if (s.phase !== 'waiting') editing = false;
  renderPill();
  if (toReveal) playReveal();
  else if (s.phase !== 'revealed' || first) mountOrUpdate();
  renderBar();
  updateGuests();
}
connect(applyState, undefined, { pollMs: 1000 }); // the projector polls faster so the leaderboard feels live
const refresh = () => api('/api/state').then(applyState).catch(() => {});

function renderPill() {
  const label = {
    waiting: state.roster.length ? 'Ready' : 'Setting up',
    open: state.round > 1 ? 'Tie-break' : 'Voting open',
    closed: 'Voting closed',
    revealed: 'Results',
  }[state.phase];
  pill.className = `phase-pill ${state.phase}`;
  pill.querySelector('span').textContent = label;
}

/** Identity of the view the current state calls for; a change means rebuild, otherwise update in place. */
function viewKey() {
  if (!checked) return 'checking';
  const base = `${state.epoch}|${state.roster.map((p) => p.id + p.name).join()}`;
  switch (state.phase) {
    case 'waiting':
      return state.roster.length === 0 || editing ? `setup|${state.epoch}|${canControl}|${editing}` : `ready|${base}|${canControl}`;
    case 'open': return `vote|${base}|${state.round}|${state.showLive && state.round === 1}`;
    case 'closed': return `closed|${base}`;
    default: return `revealed|${state.epoch}|${state.revealedAt}`;
  }
}

function build() {
  if (!checked) return { key: viewKey(), el: h('div'), update() {} };
  switch (state.phase) {
    case 'waiting': return state.roster.length === 0 || editing ? setupView() : readyView();
    case 'open': return voteView();
    case 'closed': return closedView();
    default: return resultView();
  }
}

function mountOrUpdate() {
  if (!view || view.key !== viewKey()) mount();
  else view.update(state);
}

function mount() {
  revealRun += 1; // cancels a drumroll in flight
  confettiRun += 1;
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  view = build();
  main.replaceChildren(view.el);
  view.update(state);
}

function remountVote() {
  if (state && view?.key.startsWith('vote')) mount();
}

// ---------- 0. unavailable ----------

/** Shown when the first state request fails: a fresh deploy that isn't connected yet, or no connection. */
function showUnavailable(e) {
  const card = e.code === 'not_configured'
    ? h('div', { class: 'signin' },
        h('div', { class: 'kicker' }, 'Almost there'),
        h('h2', { class: 'display' }, 'Finish ', h('em', {}, 'setup')),
        h('p', { class: 'muted' }, 'The site is running but not connected to a database yet. In your Vercel project:'),
        h('ol', { class: 'muted' },
          h('li', {}, 'Storage → create an ', h('b', {}, 'Upstash Redis'), ' database and connect it to the project.'),
          h('li', {}, 'Deployments → ', h('b', {}, 'Redeploy'), '.')))
    : h('div', { class: 'signin' }, h('h2', { class: 'display' }, 'Can’t reach the server'), h('p', { class: 'muted' }, 'Retrying…'));
  main.replaceChildren(h('div', { class: 'signin-wrap' }, card));
  pill.querySelector('span').textContent = e.code === 'not_configured' ? 'Not set up' : 'Offline';
}
api('/api/state').catch((e) => { if (!state) showUnavailable(e); });

// ---------- 1. names ----------

const countNames = (text) => text.split(/\r?\n/).filter((l) => l.split('|')[0].trim()).length;

function setupView() {
  if (!canControl) {
    return { key: viewKey(), el: h('div', { class: 'signin-wrap' }, h('div', { class: 'signin' }, h('h2', { class: 'display' }, 'Getting ', h('em', {}, 'ready'), '…'), h('p', { class: 'muted' }, 'The host is adding the guest list.'))), update() {} };
  }
  const existing = state.roster.map((p) => (p.character ? `${p.name} | ${p.character}` : p.name)).join('\n');
  const ta = h('textarea', { id: 'names', spellcheck: 'false', 'aria-label': 'Guest names', placeholder: 'Priya\nRahul | Raj from DDLJ\nSneha | Geet' }, existing);
  const count = h('span', { class: 'count' });
  const save = h('button', { class: 'btn', type: 'button' }, 'Save guest list ▸');
  const err = h('p', { class: 'form-error', role: 'alert' });
  const sync = () => {
    const n = countNames(ta.value);
    count.textContent = n === 1 ? '1 guest' : `${n} guests`;
    save.disabled = n < 2;
    err.textContent = n < 2 ? 'Add at least two guests.' : '';
  };
  ta.addEventListener('input', sync);
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      await api('/api/host/roster', { method: 'POST', body: { text: ta.value }, hostKey });
      editing = false;
      await refresh();
    } catch (e) {
      err.textContent = e.code === 'locked' ? 'Names are locked once voting has started.' : `Could not save: ${e.message}`;
      save.disabled = false;
    }
  });
  const sample = h('button', { class: 'link-btn', type: 'button', onclick: () => { ta.value = SAMPLE_NAMES.join('\n'); sync(); } }, 'Try it with 20 sample names');
  const cancel = state.roster.length ? h('button', { class: 'btn ghost', type: 'button', onclick: () => { editing = false; mountOrUpdate(); renderBar(); } }, 'Cancel') : null;

  const el = h(
    'div',
    { class: 'setup' },
    h('div', { class: 'setup-copy' },
      h('div', { class: 'kicker' }, 'Step 1 of 3'),
      h('h2', { class: 'display' }, 'Who’s ', h('em', {}, 'coming'), '?'),
      h('p', { class: 'muted' }, 'One guest per line. After a | you can add the character they dressed as, so the ballot reads “Priya · Geet”. Everyone on this list can vote and be voted for.'),
      sample),
    h('div', { class: 'setup-form' }, ta, h('div', { class: 'setup-foot' }, count, err), h('div', { class: 'setup-actions' }, cancel, save)),
  );
  sync();
  return { key: viewKey(), el, update() {} };
}

// ---------- 2. ready ----------

function readyView() {
  const start = canControl ? h('button', { class: 'btn big-cta', type: 'button', onclick: () => startVote() }, `Start voting · ${voteMinutes()} min ▶`) : null;
  const el = h(
    'div',
    { class: 'ready' },
    h('div', { class: 'big' }, h('em', {}, state.roster.length), state.roster.length === 1 ? ' guest' : ' guests', ' on the list'),
    h('div', { class: 'chips ready-chips' }, state.roster.map((p) => h('div', { class: 'chip on' }, avatar(p), h('span', { class: 'n' }, p.name)))),
    h('p', { class: 'muted ready-note' }, `When the awards are done, start the vote. The QR code appears and everyone has ${voteMinutes()} minutes.`),
    start,
  );
  return { key: viewKey(), el, update() {} };
}

// ---------- 3. vote: QR + clock ----------

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

function voteView() {
  const url = voteUrl();
  const runoff = state.round > 1;
  const liveOn = state.showLive && !runoff;
  const qrBox = h('div', { class: 'qr-card', role: 'img', 'aria-label': `QR code for ${url}` });
  qrBox.innerHTML = qrSvg(url); // markup comes from the QR library, built only from our own URL string
  const clockEl = h('div', { class: 'clock', role: 'timer' }, '–:––');
  const num = h('span', { class: 'num' }, '0');
  const of = h('span', { class: 'of' }, '');
  const meter = h('b');
  const chips = h('div', { class: 'chips' }, state.roster.map(chip));
  // One row per guest, kept for the whole vote: updates reorder and resize them instead of rebuilding, so bars glide.
  const liveRows = new Map(state.roster.map((p) => [p.id, barRow(0, p, 0, 0, false)]));
  const liveEmpty = h('div', { class: 'live-empty' }, 'Waiting for the first vote…');
  const live = h('div', { class: 'live' }, h('h3', { class: 'kicker' }, 'Who’s winning'), liveEmpty, ...liveRows.values());
  const warn = h('div', { class: 'notice', hidden: true }, '');
  const versus = runoff
    ? h('div', { class: 'versus' }, (state.contenders ?? []).flatMap((id, i) => {
        const p = byId(id);
        const card = h('div', { class: 'vs-card', 'data-id': p.id }, avatar(p), h('div', { class: 'vs-name' }, p.name), p.character && h('div', { class: 'vs-char' }, p.character), h('div', { class: 'vs-count' }, '0'));
        return i ? [h('div', { class: 'vs-sep' }, 'vs'), card] : [card];
      }))
    : null;

  const el = h(
    'div',
    { class: 'stage-main' },
    h('div', { class: 'qr-col' }, qrBox, h('div', { class: 'scan' }, 'Scan & ', h('em', {}, 'vote')), h('div', { class: 'url' }, h('span', {}, url.replace(/^https?:\/\//, '')))),
    h('div', { class: 'board' },
      runoff && h('div', { class: 'tie-head' }, 'It’s a tie!', h('span', {}, ` ${state.tie?.votes ?? ''} votes each. One more vote settles it.`)),
      h('div', { class: 'clock-row' }, clockEl, h('div', { class: 'clock-label' }, runoff ? 'to settle the tie' : 'left to vote')),
      h('div', { class: 'turnout' }, num, of, h('span', { class: 'label' }, 'have voted')),
      h('div', { class: 'meter' }, meter),
      versus ?? (liveOn ? live : chips),
      warn),
  );

  let prev = new Set();
  let firstPaint = true;
  return {
    key: viewKey(),
    el,
    clockEl,
    update(s) {
      const on = new Set(s.voted);
      num.textContent = on.size;
      of.textContent = `/ ${s.roster.length}`;
      meter.style.width = `${s.roster.length ? (on.size / s.roster.length) * 100 : 0}%`;
      for (const c of chips.children) {
        const isOn = on.has(c.dataset.id);
        c.classList.toggle('on', isOn);
        c.querySelector('.tick').textContent = isOn ? '✓' : '';
        if (isOn && !firstPaint && !prev.has(c.dataset.id)) {
          c.classList.remove('pop');
          void c.offsetWidth; // restart the animation
          c.classList.add('pop');
        }
      }
      prev = on;
      firstPaint = false;
      if (liveOn && s.tallies) {
        const ranked = s.roster.map((p) => [p, s.tallies[p.id] ?? 0]).sort((a, b) => b[1] - a[1] || a[0].name.localeCompare(b[0].name));
        const max = ranked[0]?.[1] ?? 0;
        liveEmpty.hidden = max > 0;
        ranked.forEach(([p, n], i) => {
          const row = liveRows.get(p.id);
          row.style.order = i + 1;
          row.hidden = n === 0 || i >= 6; // the top six with at least one vote
          row.classList.toggle('win', i === 0 && n > 0);
          row.querySelector('.rank').textContent = i + 1;
          row.querySelector('.ct').textContent = n;
          row.querySelector('.track b').style.width = `${max ? (n / max) * 100 : 0}%`;
        });
      }
      if (runoff && s.tallies) {
        for (const c of el.querySelectorAll('.vs-card')) c.querySelector('.vs-count').textContent = s.tallies[c.dataset.id] ?? 0;
      }
      const local = /^https?:\/\/(localhost|127\.|\[::1\])/.test(voteUrl());
      warn.hidden = !local;
      warn.textContent = local ? 'No WiFi address found, so phones cannot reach this link. Open Settings and set the voting link.' : '';
      tickClock();
    },
  };
}

let lastPull = 0;
function tickClock() {
  if (!state || state.phase !== 'open' || !view?.clockEl) return;
  const left = state.endsAt - clock.now();
  view.clockEl.textContent = mmss(left);
  view.clockEl.classList.toggle('low', left <= 30000);
  if (left <= 0 && Date.now() - lastPull > 1000) {
    lastPull = Date.now();
    refresh(); // the server closes the vote on the first request after the deadline
  }
}
setInterval(tickClock, 250);

// ---------- 4. curtain ----------

/** A stage with a closed curtain; `behind` holds what the curtain hides. */
function curtainStage({ opened = false } = {}) {
  const behind = h('div', { class: 'behind' });
  const caption = h('div', { class: 'curtain-caption' });
  const el = h('div', { class: `curtain-stage${opened ? ' open instant' : ''}` }, behind, h('div', { class: 'panel left' }), h('div', { class: 'panel right' }), h('div', { class: 'valance' }), caption);
  return { el, behind, caption, open: () => el.classList.add('open') };
}

function closedView() {
  const stage = curtainStage();
  const sub = h('div', { class: 'cap-sub' });
  stage.caption.replaceChildren(h('div', { class: 'cap-line' }, 'Voting ', h('em', {}, 'closed')), h('div', { class: 'cap-sub' }, 'Counting the votes…'), sub);
  return { key: viewKey(), el: stage.el, update: (s) => { sub.textContent = `${s.voted.length} of ${s.roster.length} votes in`; } };
}

function standings() {
  const t = state.tallies ?? {};
  return state.roster.map((p) => [p, t[p.id] ?? 0]).sort((a, b) => b[1] - a[1] || a[0].name.localeCompare(b[0].name));
}

function resultContent() {
  const winner = byId((state.winners ?? [])[0]);
  if (!winner) return h('div', { class: 'empty-note' }, 'No votes were cast.');
  const rows = standings().filter(([, n]) => n > 0).slice(0, 8);
  const max = rows[0]?.[1] ?? 0;
  const note = state.tieBreak === 'runoff' ? 'Won the tie-break' : state.tieBreak === 'draw' ? 'Still level after the runoff, so a random draw settled it' : '';
  return h(
    'div',
    { class: 'reveal' },
    h('div', { class: 'winners' },
      h('div', { class: 'winner' },
        h('div', { class: 'ribbon' }, '★ Best dressed ★'),
        avatar(winner),
        h('div', { class: 'wname' }, winner.name),
        winner.character && h('div', { class: 'wchar' }, winner.character),
        h('div', { class: 'wvotes' }, `${max} ${max === 1 ? 'vote' : 'votes'}`),
        note && h('div', { class: 'wnote' }, note))),
    h('div', { class: 'ranking' }, note && h('h3', { class: 'kicker' }, 'Tie-break votes'), rows.map(([p, n], i) => barRow(i + 1, p, n, max, p === winner))),
  );
}

function resultView() {
  const stage = curtainStage({ opened: true });
  stage.behind.replaceChildren(resultContent());
  return { key: viewKey(), el: stage.el, update() {} };
}

async function playReveal() {
  const run = ++revealRun;
  const stop = () => run !== revealRun;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  bar.classList.add('idle');
  view = null;

  const stage = curtainStage();
  stage.caption.replaceChildren(h('div', { class: 'cap-line' }, 'And the best dressed is…'));
  stage.behind.replaceChildren(resultContent()); // already in place behind the curtain
  main.replaceChildren(stage.el);

  sound.drumroll(3.6);
  await wait(3800);
  if (stop()) return;
  stage.caption.classList.add('gone');
  stage.open();
  sound.fanfare();
  await wait(1100);
  if (stop()) return;
  view = { key: viewKey(), el: stage.el, update() {} };
  if (state.winners?.length) confetti();
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

/** Sends a host command, then pulls fresh state so the screen reacts at once (polling hosts would otherwise lag a couple of seconds). */
async function act(path, body = {}) {
  sound.unlock();
  try {
    await api(path, { method: 'POST', body, hostKey });
  } catch (e) {
    console.error(`${path} failed:`, e.message);
  }
  refresh();
}
const startVote = () => act('/api/host/phase', { phase: 'open', seconds: voteMinutes() * 60 });

let barSig = '';
function renderBar() {
  if (!state || !canControl) return void (bar.hidden = true);
  const hasNames = state.roster.length > 0;
  const sig = `${state.phase}|${state.showLive}|${hasNames}|${state.round}|${editing}`;
  if (sig === barSig) return;
  barSig = sig;
  bar.hidden = false;
  const btn = (label, onclick, cls = 'btn ghost') => h('button', { class: cls, type: 'button', onclick }, label);
  const settings = btn('⚙ Settings', openDrawer);
  const live = h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: state.showLive, onchange: (e) => act('/api/host/live', { showLive: e.target.checked }) }), 'Live standings');
  const reopen = btn('Reopen +1 min', () => act('/api/host/phase', { phase: 'open', seconds: 60 }));
  const items = {
    waiting: hasNames && !editing ? [btn('✎ Edit names', () => { editing = true; mountOrUpdate(); renderBar(); }), settings] : [settings],
    open: [btn('+1 min', () => act('/api/host/extend', { seconds: 60 })), state.round === 1 ? live : null, settings, btn('Close now ■', () => act('/api/host/phase', { phase: 'closed' }), 'btn primary')],
    closed: [settings, reopen, btn('Reveal winner 🏆', () => act('/api/host/phase', { phase: 'revealed' }), 'btn primary')],
    revealed: [settings, reopen, btn('Replay reveal ↻', () => act('/api/host/phase', { phase: 'revealed' }), 'btn primary')],
  }[state.phase];
  bar.replaceChildren(...items.filter(Boolean));
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
  const urlInput = h('input', { id: 'vote-url', type: 'text', value: voteUrl(), 'aria-label': 'Voting link', spellcheck: 'false' });
  const choices = voteUrls.length > 1 ? h('select', { 'aria-label': 'Detected addresses', onchange: (e) => { urlInput.value = e.target.value; } }, voteUrls.map((u) => h('option', { value: u }, u))) : null;
  const saveUrl = h('button', { class: 'btn small', type: 'button', onclick: () => { store.set(URL_KEY, urlInput.value.trim()); remountVote(); } }, 'Update QR');

  const minutes = h('select', { id: 'minutes', 'aria-label': 'Voting time', onchange: (e) => { store.set(MIN_KEY, e.target.value); if (view?.key.startsWith('ready')) mount(); } },
    [2, 3, 5, 8, 10].map((m) => h('option', { value: m, selected: m === voteMinutes() }, `${m} minutes`)));

  guestsEl = h('div');
  const reset = h('button', { class: 'btn small danger', type: 'button' }, 'Reset everything');
  let armed = false; // the viewer never shows confirm(), so a second tap confirms
  reset.addEventListener('click', async () => {
    if (!armed) { armed = true; reset.textContent = 'Tap again to clear all votes and names'; return; }
    await act('/api/host/reset');
    armed = false;
    reset.textContent = 'Reset everything';
  });

  drawer.replaceChildren(
    h('button', { class: 'btn ghost small', style: 'float:right', type: 'button', onclick: closeDrawer }, 'Close ✕'),
    h('h2', { class: 'display' }, 'Host settings'),
    h('section', {}, h('h3', {}, 'Voting time'), minutes, h('p', { class: 'hint' }, 'The clock starts when you press Start voting. Tie-breaks always get 60 seconds.')),
    h('section', {}, h('h3', {}, 'Voting link (in the QR)'), choices, urlInput, h('p', { class: 'hint' }, isLocal ? 'Phones must be on the same WiFi as this laptop, or use a public link.' : 'Guests need only an internet connection.'), saveUrl),
    h('section', {}, h('h3', {}, `Guests (${state.roster.length})`), h('p', { class: 'hint' }, 'Name taken by mistake or a phone died? Release the name so they can pick again.'), guestsEl),
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
        claimed && h('button', { type: 'button', onclick: () => act('/api/host/release', { voterId: p.id }) }, 'Release'),
      );
    }),
  );
}
