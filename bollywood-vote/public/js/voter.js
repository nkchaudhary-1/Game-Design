// Guest (phone) flow: pick who you are -> vote for the best dressed -> wait for the big screen.

import { h, api, avatar, connect, clock, setTransport } from './common.js';
import { createGuestTransport } from './p2p.js';

const KEY = 'bollywood-vote:v1';
const app = document.getElementById('app');
const cta = document.getElementById('cta');
const ctaInner = document.getElementById('cta-inner');
const toastEl = document.getElementById('toast');
const connEl = document.getElementById('conn');
const countdown = document.getElementById('countdown');

// The QR code carries the host's peer id after the #. Votes go straight to the host's browser (see p2p.js).
const hostId = decodeURIComponent(location.hash.slice(1));
const guestLink = globalThis.__BN_GUEST_TRANSPORT ?? (hostId ? createGuestTransport({ hostId }) : null); // the demo supplies its own
let link = { status: 'connecting', detail: '' };
if (guestLink) setTransport(guestLink);

const load = () => {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; }
};
const store = (m) => {
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* private mode: the session still works, it just won't survive a reload */ }
};

let state = null; // latest public state from the server
let me = load(); // { epoch, voterId, token, candidateId }
const ui = { pick: null, editing: false, busy: false };
let lastSig = '';
let seenRound = 1;
let toastTimer;

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 4500);
}

const byId = (id) => state.roster.find((p) => p.id === id);
const first = (p) => p.name.split(' ')[0];

// ---------- server is the source of truth; local state only remembers who this phone is ----------

function reconcile() {
  const stale =
    (me.epoch !== undefined && me.epoch !== state.epoch) || // host reset or changed the roster
    (me.voterId && !state.claimed.includes(me.voterId)) || // host released this name
    (me.voterId && !byId(me.voterId));
  if (stale) {
    me = {};
    ui.pick = null;
    ui.editing = false;
  }
  if (state.round !== seenRound) { ui.pick = null; ui.editing = false; seenRound = state.round; } // a tie-break starts from a clean ballot
  if (me.voterId) {
    const voted = state.voted.includes(me.voterId);
    if (!voted) { me.candidateId = null; if (!ui.editing) ui.pick = null; }
    else if (!me.candidateId) recoverVote(); // vote landed but the reply was lost
  }
  store(me);
}

async function recoverVote() {
  try {
    const r = await api(`/api/me?voterId=${encodeURIComponent(me.voterId)}&token=${encodeURIComponent(me.token)}`);
    if (r.valid && r.candidateId) {
      me.candidateId = r.candidateId;
      store(me);
      render(true);
    }
  } catch { /* the next state push retries */ }
}

// ---------- actions ----------

async function claim(voterId) {
  ui.busy = true;
  render(true);
  try {
    const r = await api('/api/claim', { method: 'POST', body: { voterId, token: me.voterId === voterId ? me.token : undefined } });
    me = { epoch: r.epoch, voterId, token: r.token, candidateId: null };
    store(me);
    ui.pick = null;
  } catch (e) {
    toast(
      e.code === 'taken' ? 'Someone already picked that name on another phone. Ask the host to release it.'
      : e.code === 'closed' ? 'Voting has closed.'
      : 'Could not reach the host. Check your connection and try again.',
    );
  }
  ui.busy = false;
  render(true);
}

async function unclaim() {
  try {
    await api('/api/unclaim', { method: 'POST', body: { voterId: me.voterId, token: me.token } });
  } catch (e) {
    if (e.code !== 'bad_token') return toast('Could not switch name. Ask the host.');
  }
  me = {};
  store(me);
  ui.pick = null;
  render(true);
}

async function castVote() {
  const candidateId = ui.pick;
  ui.busy = true;
  render(true);
  try {
    await api('/api/vote', { method: 'POST', body: { voterId: me.voterId, token: me.token, candidateId } });
    me.candidateId = candidateId;
    store(me);
    ui.editing = false;
    navigator.vibrate?.(40);
  } catch (e) {
    if (e.code === 'bad_token') { me = {}; store(me); }
    toast(
      e.code === 'not_open' ? 'Voting just closed — sorry!'
      : e.code === 'bad_token' ? 'The host reset the session. Pick your name again.'
      : 'Vote did not go through. Check your connection and try again.',
    );
  }
  ui.busy = false;
  render(true);
}

// ---------- views ----------

function row(p, { selected = false, disabled = false, tag = '', onPick }) {
  return h(
    'button',
    { class: 'person', role: 'radio', 'aria-checked': String(selected), 'data-id': p.id, disabled, onclick: () => onPick?.(p) },
    avatar(p),
    h('span', { class: 'who' }, h('span', { class: 'name' }, p.name), p.character && h('span', { class: 'char' }, p.character)),
    tag ? h('span', { class: 'tag' }, tag) : h('span', { class: 'mark' }, selected ? '✓' : ''),
  );
}

function pickList(people, { initial, isDisabled = () => false, tagFor = () => '', onChange }) {
  const list = h('div', { class: 'list', role: 'radiogroup' });
  const select = (id) => {
    for (const b of list.querySelectorAll('.person')) {
      const on = b.dataset.id === id;
      b.setAttribute('aria-checked', String(on));
      const mark = b.querySelector('.mark');
      if (mark) mark.textContent = on ? '✓' : '';
    }
    onChange(id);
  };
  for (const p of people) {
    list.append(row(p, { selected: p.id === initial, disabled: isDisabled(p), tag: tagFor(p), onPick: () => select(p.id) }));
  }
  return list;
}

function hero(kicker, title, lead) {
  return h('header', { class: 'hero' }, h('div', { class: 'kicker' }, kicker), h('h1', { class: 'display' }, ...title), h('p', { class: 'lead' }, lead));
}

function message(icon, title, text, extra) {
  return h(
    'section',
    { class: 'center' },
    h('div', { class: 'badge pop' }, icon),
    h('h2', { class: 'display' }, title),
    text && h('p', {}, text),
    extra,
  );
}

function setCta(...nodes) {
  ctaInner.replaceChildren(...nodes.filter(Boolean));
  cta.hidden = nodes.filter(Boolean).length === 0;
}

function viewWho() {
  const selectedBtn = h('button', { class: 'btn', disabled: true }, 'Tap your name');
  let chosen = null;
  const list = pickList(state.roster, {
    isDisabled: (p) => state.claimed.includes(p.id),
    tagFor: (p) => (state.claimed.includes(p.id) ? 'Joined' : ''),
    onChange: (id) => {
      chosen = id;
      selectedBtn.disabled = false;
      selectedBtn.textContent = `I'm ${first(byId(id))}`;
    },
  });
  selectedBtn.addEventListener('click', () => chosen && claim(chosen));
  setCta(selectedBtn);
  return [hero('Bollywood Night', ['Who are ', h('em', {}, 'you'), '?'], "Tap your name so we know it's you. You can't vote for yourself."), list];
}

function viewWaiting() {
  const p = byId(me.voterId);
  setCta();
  return message('🎬', `You're in, ${first(p)}!`, "Voting hasn't started yet. Keep this page open — the ballot appears here by itself.", h('button', { class: 'link-btn', onclick: unclaim }, `Not ${first(p)}?`));
}

function viewPick() {
  const tieBreak = state.round > 1 && state.contenders;
  const others = state.roster.filter((p) => p.id !== me.voterId && (!tieBreak || state.contenders.includes(p.id)));
  const btn = h('button', { class: 'btn', disabled: !ui.pick || ui.busy }, ui.pick ? `Vote for ${first(byId(ui.pick))}` : 'Pick someone');
  btn.addEventListener('click', castVote);
  const list = pickList(others, {
    initial: ui.pick,
    onChange: (id) => {
      ui.pick = id;
      btn.disabled = false;
      btn.textContent = `Vote for ${first(byId(id))}`;
    },
  });
  const back = ui.editing && me.candidateId ? h('button', { class: 'btn ghost', onclick: () => { ui.editing = false; ui.pick = null; render(true); } }, 'Keep my current vote') : null;
  setCta(btn, back);
  return [
    tieBreak
      ? hero('Tie-break', ['It’s a ', h('em', {}, 'tie'), '!'], 'These two finished level. Your vote settles it. You can change it until the clock runs out.')
      : hero(`Hi ${first(byId(me.voterId))}`, ['Who’s ', h('em', {}, 'best dressed'), '?'], 'Pick one. You can change your vote until voting closes.'),
    list,
  ];
}

function viewDone() {
  const c = byId(me.candidateId);
  setCta();
  return message(
    '✓',
    'Vote locked in',
    'Eyes on the big screen — the winner is revealed soon.',
    [
      h('div', { class: 'person', 'aria-label': `You voted for ${c.name}` }, avatar(c), h('span', { class: 'who' }, h('span', { class: 'name' }, c.name), c.character && h('span', { class: 'char' }, c.character)), h('span', { class: 'tag' }, 'Your pick')),
      h('button', { class: 'link-btn', onclick: () => { ui.editing = true; ui.pick = me.candidateId; render(true); } }, 'Change my vote'),
    ],
  );
}

function viewClosed() {
  setCta();
  const c = me.candidateId && byId(me.candidateId);
  return message('🔒', 'Voting is closed', c ? `You voted for ${c.name}. The result is coming up on the big screen.` : 'The result is coming up on the big screen.');
}

function viewRevealed() {
  setCta();
  return message('🏆', 'Winner is on the big screen!', 'Thanks for playing — and for the outfits.');
}

function viewLoading() {
  setCta();
  if (!guestLink) return message('🔗', 'This link is incomplete', 'Scan the QR code on the big screen again to open the voting page.');
  const stuck = link.status === 'host-offline' || link.status === 'offline';
  return message(stuck ? '📡' : '🎬', stuck ? 'Can’t reach the host' : 'Connecting to the host…', stuck ? link.detail : 'Hang on a second.');
}

function currentView() {
  if (!state) return ['loading', viewLoading];
  if (state.roster.length === 0) return ['empty', () => message('🎬', 'Nothing to vote on yet', 'The host is still setting up.', h('a', { class: 'link-btn', href: '/' }, 'I’m the host →'))];
  if (state.phase === 'revealed') return ['revealed', viewRevealed];
  if (state.phase === 'closed') return ['closed', viewClosed];
  if (!me.voterId) return ['who', viewWho];
  if (state.phase === 'waiting') return ['waiting', viewWaiting];
  if (!me.candidateId || ui.editing) return ['pick', viewPick];
  return ['done', viewDone];
}

/** Re-render only when something this view shows has changed, so other guests' votes never disturb a tap in progress. */
function render(force = false) {
  const [name, view] = currentView();
  const dep = state
    ? JSON.stringify([state.roster, name === 'who' ? state.claimed : null, state.phase === 'revealed' ? state.revealedAt : null])
    : '';
  const sig = `${name}|${dep}|${me.voterId}|${me.candidateId}|${ui.editing}|${ui.busy}|${state?.epoch}|${state?.round}|${state ? '' : link.status}`;
  if (!force && sig === lastSig) return;
  lastSig = sig;
  const out = view();
  app.replaceChildren(...[out].flat());
  if (ui.busy) for (const b of cta.querySelectorAll('button')) b.disabled = true;
}

if (guestLink) {
  guestLink.onStatus?.((status, detail) => {
    link = { status, detail };
    if (!state) render(true); // before the first state, the loading screen says what is happening
  });
  connect(
    (s) => {
      state = s;
      reconcile();
      render();
    },
    (ok) => { connEl.hidden = ok; },
  );
}
render(true);

// Countdown strip: server time, so every phone and the projector agree.
setInterval(() => {
  const running = state?.phase === 'open' && state.endsAt > 0;
  countdown.hidden = !running;
  if (!running) return;
  const left = state.endsAt - clock.now();
  const s = Math.max(0, Math.ceil(left / 1000));
  countdown.firstElementChild.textContent = state.round > 1 ? 'Tie-break closes in' : 'Voting closes in';
  countdown.querySelector('b').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  countdown.classList.toggle('low', left <= 30000);
}, 500);
