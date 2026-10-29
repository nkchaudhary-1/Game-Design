// Host app. Two pages: (1) Guest details  (2) Best Dressed Award: QR code, countdown, hidden votes, curtain reveal.
// The host's browser is the server (host-runtime.js), so there is no backend: details and votes live in localStorage here.

import { h, api, avatar, connect, clock, setTransport } from './common.js';
import { startHostRuntime } from './host-runtime.js';

const main = document.getElementById('main');
const pill = document.getElementById('pill');
const tabsEl = document.getElementById('tabs');
const drawer = document.getElementById('drawer');
const canvas = document.getElementById('confetti');
const banner = document.getElementById('banner');

const runtime = globalThis.__BN_HOST_RUNTIME ?? startHostRuntime(); // the click-through demo supplies its own runtime
setTransport(runtime.transport);

const MIN_KEY = 'bn:minutes';
const store = {
  get: (k, d = '') => { try { return localStorage.getItem(k) || d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

const SAMPLE_GUESTS = [
  ['Aarav', 'Raj — DDLJ'], ['Ananya', 'Simran — DDLJ'], ['Rohan', 'Gabbar — Sholay'], ['Meera', 'Basanti — Sholay'], ['Kabir', 'Munna Bhai'],
  ['Isha', 'Geet — Jab We Met'], ['Vikram', 'Rancho — 3 Idiots'], ['Tara', 'Piku'], ['Dev', 'Devdas'], ['Naina', 'Naina — Kal Ho Naa Ho'],
  ['Arjun', 'Don'], ['Riya', 'Anjali — Kuch Kuch Hota Hai'], ['Sameer', 'Chulbul Pandey — Dabangg'], ['Zoya', 'Zoya — ZNMD'], ['Karan', 'Rocky — KKHH'],
  ['Pooja', 'Poo — K3G'], ['Nikhil', 'Bhaiyyaji'], ['Sana', 'Mastani — Bajirao Mastani'], ['Yash', 'Veeru — Sholay'], ['Diya', 'Chandni'],
].map(([name, character]) => ({ name, character }));

// ---------- state + pages ----------

let state = null;
let link = runtime.link();
let view = null; // { key, el, update(state), updateLink(link), clockEl? } for what is mounted
let page = null; // the page the host chose; null means "decide from the state"
let prevPhase = null;
let prevRevealedAt = null;
let revealRun = 0;
let confettiRun = 0;

const byId = (id) => state.roster.find((p) => p.id === id);
const rosterSig = () => state.roster.map((p) => `${p.id}${p.name}${p.character}`).join('|');
const minutesChoice = () => (Number(store.get(MIN_KEY, '5')) === 2 ? 2 : 5);
const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function currentPage() {
  const wanted = page ?? (['guests', 'award'].includes(location.hash.slice(1)) ? location.hash.slice(1) : null);
  const canAward = state.roster.length >= 2;
  if (wanted === 'guests') return 'guests';
  if (wanted === 'award' && canAward) return 'award';
  return canAward && state.phase !== 'waiting' ? 'award' : 'guests'; // a refresh mid-vote lands on the vote
}

function go(next) {
  page = next;
  try { history.replaceState(null, '', `#${next}`); } catch { /* sandboxed frames cannot change the URL */ }
  mountOrUpdate();
  renderTabs();
}

function applyState(s) {
  const first = !state;
  state = s;
  const replay = s.phase === 'revealed' && prevRevealedAt !== null && s.revealedAt !== prevRevealedAt;
  const toReveal = s.phase === 'revealed' && !first && (s.phase !== prevPhase || replay) && currentPage() === 'award';
  prevPhase = s.phase;
  prevRevealedAt = s.revealedAt;
  renderPill();
  renderTabs();
  if (toReveal) playReveal();
  else if (s.phase !== 'revealed' || first || currentPage() !== 'award') mountOrUpdate();
  updateGuests();
}
connect(applyState);
runtime.onLink((l) => { link = l; view?.updateLink?.(l); });

function renderPill() {
  const label = {
    waiting: state.roster.length >= 2 ? 'Ready' : 'Setting up',
    open: state.round > 1 ? 'Tie-break' : 'Voting open',
    closed: 'Voting closed',
    revealed: 'Results',
  }[state.phase];
  pill.className = `phase-pill ${state.phase}`;
  pill.querySelector('span').textContent = label;
}

function renderTabs() {
  const cur = currentPage();
  const canAward = state.roster.length >= 2;
  const tab = (id, n, label, disabled) =>
    h('button', { class: `tab${cur === id ? ' on' : ''}`, type: 'button', 'aria-current': cur === id ? 'page' : null, disabled, onclick: () => go(id) }, h('span', { class: 'tn' }, n), label);
  tabsEl.replaceChildren(tab('guests', '1', 'Guest details', false), tab('award', '2', 'Best Dressed Award', !canAward));
}

/** Identity of what the state calls for; a change means rebuild, otherwise update in place. */
function viewKey() {
  if (currentPage() === 'guests') return state.phase === 'waiting' ? 'guests|edit' : `guests|locked|${rosterSig()}`;
  const base = `award|${state.phase}|${state.epoch}|${state.round}|${rosterSig()}`;
  return state.phase === 'revealed' ? `${base}|${state.revealedAt}` : base;
}

function build() {
  if (currentPage() === 'guests') return state.phase === 'waiting' ? guestsView() : lockedGuestsView();
  switch (state.phase) {
    case 'waiting': return lobbyView();
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
  const first = !view;
  view = build();
  main.replaceChildren(view.el);
  view.update(state);
  view.updateLink?.(link);
  if (!first) window.scrollTo(0, 0); // a new page or phase starts at its top, not wherever the last one was scrolled
}

function note(message, ms = 5000) {
  banner.textContent = message;
  banner.hidden = false;
  clearTimeout(note.timer);
  note.timer = setTimeout(() => { banner.hidden = true; }, ms);
}

/** A button that needs a second tap to confirm (the viewer environment never shows confirm() dialogs). */
function confirmButton(label, armedLabel, run, cls = 'btn ghost') {
  const b = h('button', { class: cls, type: 'button' }, label);
  let armed = false;
  b.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      b.textContent = armedLabel;
      setTimeout(() => { armed = false; b.textContent = label; }, 4000);
      return;
    }
    armed = false;
    b.textContent = label;
    run();
  });
  return b;
}

const friendly = { locked: 'The guest list is locked once voting starts.', no_tie: 'There is no tie to settle.', need_two: 'Add at least two guests.' };
async function act(path, body = {}) {
  sound.unlock();
  try {
    await api(path, { method: 'POST', body });
  } catch (e) {
    note(friendly[e.code] ?? `That didn’t work (${e.message}).`);
  }
}

// ---------- page 1: guest details ----------

function guestsView() {
  const saved = state.roster.length >= 2;
  const rowsEl = h('div', { class: 'guest-rows' });
  const status = h('p', { class: 'form-status', role: 'status' });
  const next = h('button', { class: 'btn ghost', type: 'button', onclick: () => go('award') }, 'Go to Best Dressed Award ▸');
  const save = h('button', { class: 'btn', type: 'button' }, 'Save details');

  const renumber = () => {
    [...rowsEl.children].forEach((row, i) => {
      row.querySelector('.idx').textContent = i + 1;
      row.querySelector('.name-in').setAttribute('aria-label', `Guest ${i + 1} name`);
      row.querySelector('.char-in').setAttribute('aria-label', `Guest ${i + 1} Bollywood character`);
      row.querySelector('.del').setAttribute('aria-label', `Remove guest ${i + 1}`);
    });
  };
  const dirty = () => {
    status.textContent = 'Unsaved changes';
    status.className = 'form-status warn';
    next.disabled = true;
  };
  const addRow = (name = '', character = '', focus = false) => {
    const nameIn = h('input', { class: 'in name-in', type: 'text', placeholder: 'Name', maxlength: '40', value: name, autocomplete: 'off', enterkeyhint: 'next' });
    const charIn = h('input', { class: 'in char-in', type: 'text', placeholder: 'Bollywood character', maxlength: '60', value: character, autocomplete: 'off' });
    const del = h('button', { class: 'icon-btn del', type: 'button', onclick: () => { row.remove(); renumber(); dirty(); } }, '✕');
    const row = h('div', { class: 'guest-row' }, h('span', { class: 'idx' }), nameIn, charIn, del);
    row.addEventListener('input', dirty);
    rowsEl.append(row);
    renumber();
    if (focus) nameIn.focus();
  };
  const collect = () => [...rowsEl.children]
    .map((row) => ({ name: row.querySelector('.name-in').value.trim(), character: row.querySelector('.char-in').value.trim() }))
    .filter((g) => g.name || g.character);

  (saved ? state.roster : [{}, {}, {}]).forEach((p) => addRow(p.name, p.character));

  const paste = h('textarea', { class: 'in paste-in', id: 'paste', rows: '5', placeholder: 'Priya | Geet\nRahul | Raj\nSneha | Simran', 'aria-label': 'Paste guests, one per line' });
  const pasteBox = h('details', { class: 'paste' },
    h('summary', {}, 'Paste a list instead'),
    h('p', { class: 'muted' }, 'One guest per line: name, a bar (|), then the character.'),
    paste,
    h('button', { class: 'btn ghost small', type: 'button', onclick: () => {
      for (const line of paste.value.split(/\r?\n/)) {
        const [name, ...rest] = line.split('|');
        if (name.trim()) addRow(name.trim(), rest.join('|').trim());
      }
      paste.value = '';
      pasteBox.open = false;
      dirty();
    } }, 'Add to the list'));

  save.addEventListener('click', async () => {
    const guests = collect();
    const bad = [...rowsEl.children].findIndex((row) => !row.querySelector('.name-in').value.trim() && row.querySelector('.char-in').value.trim());
    if (bad >= 0) {
      status.textContent = `Guest ${bad + 1} has a character but no name.`;
      status.className = 'form-status err';
      rowsEl.children[bad].querySelector('.name-in').focus();
      return;
    }
    if (guests.length < 2) {
      status.textContent = 'Add at least two guests.';
      status.className = 'form-status err';
      return;
    }
    const unchanged = JSON.stringify(guests.map((g) => [g.name, g.character])) === JSON.stringify(state.roster.map((p) => [p.name, p.character]));
    try {
      // Re-saving an identical list must not wipe the names guests have already picked on their phones.
      if (!unchanged) await api('/api/host/roster', { method: 'POST', body: { roster: guests } });
      status.textContent = `Saved ${guests.length} guests ✓`;
      status.className = 'form-status ok';
      next.disabled = false;
      if (!runtime.canSave()) note('This browser is blocking saved data (private window?). Your details will be lost on refresh.', 12000);
    } catch (e) {
      status.textContent = friendly[e.code] ?? `Could not save (${e.message}).`;
      status.className = 'form-status err';
    }
  });

  if (saved) { status.textContent = `Saved ${state.roster.length} guests ✓`; status.className = 'form-status ok'; } else next.disabled = true;

  const el = h('section', { class: 'form-page' },
    h('div', { class: 'kicker' }, 'Step 1'),
    h('h2', { class: 'display h2' }, 'Guest ', h('em', {}, 'details')),
    h('p', { class: 'muted lead' }, 'Who is coming, and which Bollywood character is each one dressed as? Everyone on this list can vote and be voted for.'),
    h('div', { class: 'guest-head', 'aria-hidden': 'true' }, h('span'), h('span', {}, 'Name'), h('span', {}, 'Character'), h('span')),
    rowsEl,
    h('div', { class: 'form-tools' },
      h('button', { class: 'btn ghost small', type: 'button', onclick: () => { addRow('', '', true); dirty(); } }, '+ Add guest'),
      h('button', { class: 'link-btn', type: 'button', onclick: () => { rowsEl.replaceChildren(); SAMPLE_GUESTS.forEach((g) => addRow(g.name, g.character)); dirty(); } }, 'Fill with 20 sample guests')),
    pasteBox,
    h('div', { class: 'form-actions' }, save, next, status),
  );
  return { key: viewKey(), el, update() {} };
}

function lockedGuestsView() {
  const el = h('section', { class: 'form-page' },
    h('div', { class: 'kicker' }, 'Step 1'),
    h('h2', { class: 'display h2' }, 'Guest ', h('em', {}, 'details')),
    h('p', { class: 'muted lead' }, 'Voting has started, so the guest list is locked. To change it, start a new award night: this clears the votes.'),
    h('div', { class: 'contestants' }, state.roster.map((p) => h('div', { class: 'contestant' }, avatar(p), h('div', { class: 'who' }, h('div', { class: 'cn' }, p.name), h('div', { class: 'cc' }, p.character || ' '))))),
    h('div', { class: 'form-actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => go('award') }, 'Back to the award ▸'),
      confirmButton('Start a new award night', 'Tap again to clear all votes', async () => { await act('/api/host/reset'); go('guests'); })),
  );
  return { key: viewKey(), el, update() {} };
}

// ---------- page 2: Best Dressed Award ----------

function qrSvg(url) {
  const qr = window.qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 8, scalable: true });
}

/** The QR code, the short link under it, and whether phones can reach this screen. */
function qrPanel({ compact = false } = {}) {
  const box = h('div', { class: 'qr-card', role: 'img' });
  const urlLine = h('div', { class: 'url' });
  const chip = h('div', { class: 'link-chip' }, h('i'), h('span'));
  const el = h('div', { class: `qr-col${compact ? ' compact' : ''}` }, box, h('div', { class: 'scan' }, 'Scan to ', h('em', {}, 'vote')), urlLine, chip);
  let shown = '';
  function update(l = link) {
    const url = runtime.joinUrl();
    if (url !== shown) {
      shown = url;
      box.innerHTML = qrSvg(url); // markup comes from the QR library, built only from our own URL string
      box.setAttribute('aria-label', `QR code for ${url}`);
      urlLine.replaceChildren(h('span', {}, url.replace(/^https?:\/\//, '')));
    }
    chip.className = `link-chip ${l.state}`;
    chip.querySelector('span').textContent = l.state === 'ready'
      ? (l.guests ? `Ready · ${l.guests} ${l.guests === 1 ? 'phone' : 'phones'} connected` : 'Ready · waiting for phones')
      : (l.detail || 'Connecting…');
  }
  update();
  return { el, update };
}

function chip(p) {
  return h('div', { class: 'chip', 'data-id': p.id }, avatar(p), h('span', { class: 'n' }, p.name), h('span', { class: 'tick' }, ''));
}

function lobbyView() {
  const qr = qrPanel();
  const seg = h('fieldset', { class: 'seg' },
    h('legend', {}, 'Voting time'),
    h('div', { class: 'seg-opts' }, [2, 5].map((m) => h('label', { class: 'seg-opt' },
      h('input', { type: 'radio', name: 'duration', value: String(m), checked: m === minutesChoice(), onchange: () => store.set(MIN_KEY, String(m)) }),
      h('span', {}, `${m} minutes`)))));
  const start = h('button', { class: 'btn big-cta', type: 'button', onclick: () => act('/api/host/phase', { phase: 'open', seconds: minutesChoice() * 60 }) }, 'Start voting ▶');
  const items = state.roster.map((p) => h('div', { class: 'contestant', 'data-id': p.id }, avatar(p), h('div', { class: 'who' }, h('div', { class: 'cn' }, p.name), h('div', { class: 'cc' }, p.character || ' ')), h('i', { class: 'dot', title: 'On their phone' })));
  const joined = h('p', { class: 'muted joined-note' });

  const el = h('div', { class: 'stage-main award' },
    qr.el,
    h('div', { class: 'board' },
      h('div', { class: 'kicker' }, 'Step 2'),
      h('h2', { class: 'display h2' }, 'Best Dressed ', h('em', {}, 'Award')),
      h('p', { class: 'muted lead' }, 'Guests scan the QR code, tap their name and vote for their favourite. Nobody sees any scores until you reveal the winner.'),
      h('div', { class: 'start-row' }, seg, start),
      joined,
      h('div', { class: 'contestants' }, items)),
  );
  return {
    key: viewKey(),
    el,
    updateLink: qr.update,
    update(s) {
      let n = 0;
      for (const c of items) { const on = s.claimed.includes(c.dataset.id); c.classList.toggle('joined', on); n += on ? 1 : 0; }
      joined.textContent = n ? `${n} of ${s.roster.length} guests have picked their name.` : 'Guests who scan now can pick their name and wait for voting to start.';
    },
  };
}

function voteView() {
  const runoff = state.round > 1;
  const qr = qrPanel({ compact: true });
  const clockEl = h('div', { class: 'clock', role: 'timer' }, '–:––');
  const chips = h('div', { class: 'chips' }, state.roster.map(chip));
  const versus = runoff
    ? h('div', { class: 'versus' }, (state.contenders ?? []).flatMap((id, i) => {
        const p = byId(id);
        const card = h('div', { class: 'vs-card' }, avatar(p), h('div', { class: 'vs-name' }, p.name), p.character && h('div', { class: 'vs-char' }, p.character));
        return i ? [h('div', { class: 'vs-sep' }, 'vs'), card] : [card];
      }))
    : null;

  const el = h('div', { class: 'stage-main award' },
    qr.el,
    h('div', { class: 'board' },
      runoff && h('div', { class: 'tie-head' }, 'It’s a tie!', h('span', {}, ' The tied guests go head to head. One more vote settles it.')),
      h('div', { class: 'clock-row' }, clockEl, h('div', { class: 'clock-label' }, runoff ? 'to settle the tie' : 'left to vote')),
      h('p', { class: 'secret' }, '🔒 Votes stay secret until you reveal the winner. Names light up when a guest has voted.'),
      versus ?? chips,
      h('div', { class: 'vote-actions' }, h('button', { class: 'btn ghost small', type: 'button', onclick: () => act('/api/host/phase', { phase: 'closed' }) }, 'Close voting now'))),
  );
  return {
    key: viewKey(),
    el,
    clockEl,
    updateLink: qr.update,
    update(s) {
      const on = new Set(s.voted);
      for (const c of chips.children) {
        const isOn = on.has(c.dataset.id);
        c.classList.toggle('on', isOn);
        c.querySelector('.tick').textContent = isOn ? '✓' : '';
      }
      tickClock();
    },
  };
}

function tickClock() {
  if (!state || state.phase !== 'open' || !view?.clockEl) return;
  const left = state.endsAt - clock.now();
  view.clockEl.textContent = mmss(left);
  view.clockEl.classList.toggle('low', left <= 30000);
}
setInterval(tickClock, 250);

// ---------- the curtain ----------

/** A stage with a closed curtain; `behind` holds what the curtain hides, `caption` what is written on it. */
function curtainStage({ opened = false } = {}) {
  const behind = h('div', { class: 'behind' });
  const caption = h('div', { class: 'curtain-caption' });
  const el = h('div', { class: `curtain-stage${opened ? ' open instant' : ''}` }, behind, h('div', { class: 'panel left' }), h('div', { class: 'panel right' }), h('div', { class: 'valance' }), caption);
  return { el, behind, caption, open: () => el.classList.add('open') };
}

function closedView() {
  const stage = curtainStage();
  stage.caption.replaceChildren(
    h('div', { class: 'cap-line' }, 'Voting ', h('em', {}, 'closed')),
    h('div', { class: 'cap-sub' }, 'The votes are in and still secret.'),
    h('button', { class: 'btn big-cta', type: 'button', onclick: () => act('/api/host/phase', { phase: 'revealed' }) }, 'Reveal Winner 🏆'));
  return { key: viewKey(), el: stage.el, update() {} };
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

function standings() {
  const t = state.tallies ?? {};
  return state.roster.map((p) => [p, t[p.id] ?? 0]).sort((a, b) => b[1] - a[1] || a[0].name.localeCompare(b[0].name));
}

function resultContent() {
  const winners = (state.winners ?? []).map(byId).filter(Boolean);
  if (!winners.length) return h('div', { class: 'empty-note' }, 'No votes were cast.');
  const tie = winners.length > 1;
  const rows = standings().filter(([, n]) => n > 0).slice(0, tie ? 4 : 8);
  const max = rows[0]?.[1] ?? 0;
  const wonTieBreak = state.round > 1 && !tie;
  const ranked = rows.length > 1; // a ranking of one person only repeats the winner card
  return h(
    'div',
    { class: `reveal${tie ? ' multi' : ranked ? '' : ' solo'}` },
    tie && h('div', { class: 'tie-head' }, 'It’s a tie!', h('span', {}, ` ${winners.length} guests share the top spot with ${max} ${max === 1 ? 'vote' : 'votes'} each.`)),
    h('div', { class: 'winners' }, winners.map((p) =>
      h('div', { class: 'winner' },
        h('div', { class: 'ribbon' }, tie ? '★ Joint winner ★' : '★ Best dressed ★'),
        avatar(p),
        h('div', { class: 'wname' }, p.name),
        p.character && h('div', { class: 'wchar' }, p.character),
        h('div', { class: 'wvotes' }, `${max} ${max === 1 ? 'vote' : 'votes'}`),
        wonTieBreak && h('div', { class: 'wnote' }, 'Won the tie-break')))),
    ranked && h('div', { class: 'ranking' }, rows.map(([p, n], i) => barRow(i + 1, p, n, max, winners.includes(p)))),
  );
}

function afterActions() {
  const tie = (state.winners ?? []).length > 1;
  return h('div', { class: 'after-actions' },
    h('button', { class: 'btn ghost', type: 'button', onclick: () => act('/api/host/phase', { phase: 'revealed' }) }, 'Replay reveal ↻'),
    tie && h('button', { class: 'btn', type: 'button', onclick: () => act('/api/host/tiebreak', { seconds: 60 }) }, 'Hold a 60-second tie-break'),
    confirmButton('New award night', 'Tap again to clear all votes', () => act('/api/host/reset')));
}

function resultShell({ opened }) {
  const stage = curtainStage({ opened });
  const actions = afterActions();
  actions.hidden = !opened;
  return { stage, actions, el: h('div', { class: 'result-wrap' }, stage.el, actions) };
}

function resultView() {
  const shell = resultShell({ opened: true });
  shell.stage.behind.replaceChildren(resultContent());
  return { key: viewKey(), el: shell.el, update() {} };
}

async function playReveal() {
  const run = ++revealRun;
  const stop = () => run !== revealRun;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  view = null;

  const shell = resultShell({ opened: false });
  shell.stage.caption.replaceChildren(h('div', { class: 'cap-line' }, 'And the best dressed is…'));
  shell.stage.behind.replaceChildren(resultContent()); // already in place behind the curtain
  main.replaceChildren(shell.el);

  sound.drumroll(3.6);
  await wait(3800);
  if (stop()) return;
  shell.stage.caption.classList.add('gone');
  shell.stage.open();
  sound.fanfare();
  await wait(1100);
  if (stop()) return;
  shell.actions.hidden = false;
  view = { key: viewKey(), el: shell.el, update() {} };
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

// ---------- options drawer ----------

let guestsEl = null;

function openDrawer() {
  guestsEl = h('div');
  drawer.replaceChildren(
    h('button', { class: 'btn ghost small', style: 'float:right', type: 'button', onclick: closeDrawer }, 'Close ✕'),
    h('h2', { class: 'display' }, 'Options'),
    h('section', {}, h('h3', {}, 'Guests on their phones'), h('p', { class: 'hint' }, 'Someone picked the wrong name, or changed phone? Release the name so they can pick again.'), guestsEl),
    h('section', {}, h('h3', {}, 'Start over'),
      h('p', { class: 'hint' }, 'Everything is saved in this browser: guest details, votes and the QR code. Closing the tab keeps it; clearing site data erases it.'),
      confirmButton('New award night (keep guests)', 'Tap again to clear all votes', async () => { await act('/api/host/reset'); closeDrawer(); }, 'btn ghost small'),
      confirmButton('Erase everything on this device', 'Tap again to erase and reload', () => { runtime.wipe(); location.reload(); }, 'btn small danger')),
  );
  updateGuests();
  drawer.classList.add('open');
}

function closeDrawer() {
  drawer.classList.remove('open');
  guestsEl = null;
}
document.getElementById('options').addEventListener('click', () => (drawer.classList.contains('open') ? closeDrawer() : openDrawer()));
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

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
        h('span', { class: `st${voted ? ' ok' : ''}` }, voted ? 'voted' : claimed ? 'on phone' : '—'),
        claimed && h('button', { type: 'button', onclick: () => act('/api/host/release', { voterId: p.id }) }, 'Release'),
      );
    }),
  );
}

if (!runtime.canSave()) note('This browser is blocking saved data (private window?). Guest details will be lost on refresh.', 15000);
