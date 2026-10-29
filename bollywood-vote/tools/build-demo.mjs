// Builds the click-through demo: the real host and guest pages in two iframes, with the host's browser played by the page
// around them. Nothing is simulated in the app itself: the same voting rules (public/js/core.js) answer both screens.
//   node tools/build-demo.mjs   -> demo/dist/demo.html        (page content only, for publishing as an Artifact)
//                                  demo/dist/standalone.html  (same, wrapped as a full document to open locally)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

// Module syntax -> plain script: drop `export` and every local import (the pieces are concatenated in front).
const plain = (src) => src.replace(/^export (?=(async function|function|const|let)\b)/gm, '').replace(/^import [^;]*from '\.\/[a-z0-9-]+\.js';\n/gm, '');

const css = read('public/css/style.css');
const qr = read('public/vendor/qrcode.js');
const common = plain(read('public/js/common.js'));

// The WebRTC link and the host's localStorage are replaced by messages to the page that holds the game.
const stubs = {
  host: 'const startHostRuntime = () => { throw new Error("the demo supplies its own host runtime"); };',
  voter: 'const createGuestTransport = () => null;',
};

const shim = (role) => `
(() => {
  let n = 0;
  const pending = new Map();
  const subs = new Set();
  const linkFns = new Set();
  let link = { state: 'ready', id: 'bn-demo1234', guests: 0, detail: '' };
  const ask = (msg) => new Promise((resolve) => { const id = ++n; pending.set(id, resolve); parent.postMessage({ bn: 1, id, ...msg }, '*'); });
  addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.bn !== 1 || e.source !== parent) return;
    if (d.type === 'resp') { pending.get(d.id)?.(d); pending.delete(d.id); }
    if (d.type === 'state') for (const fn of subs) fn(d.state);
    if (d.type === 'link') { link = d.link; for (const fn of linkFns) fn(link); }
  });
  const transport = {
    request: ({ method, path, query, body }) => ask({ type: 'req', method, path, query, body }).then((r) => ({ status: r.status, body: r.body })),
    subscribe: (fn) => { subs.add(fn); ask({ type: 'sub' }); return () => subs.delete(fn); },
    onStatus: (fn) => fn('connected'),
  };
  ${role === 'host'
    ? `window.__BN_HOST_RUNTIME = {
    transport,
    joinUrl: () => ${JSON.stringify('https://your-site.vercel.app/vote#bn-demo1234')},
    link: () => link,
    onLink: (fn) => { linkFns.add(fn); fn(link); },
    canSave: () => true,
    wipe() {},
    stop() {},
  };`
    : 'window.__BN_GUEST_TRANSPORT = transport;'}
})();`;

function page(file, role, scripts) {
  let html = read('public', file);
  html = html.replace(/<link rel="stylesheet" href="\/css\/style.css">/, () => `<style>${css}</style>`);
  html = html.replace(/<script[^>]*src="[^"]+"[^>]*><\/script>\n?/g, '');
  return html.replace('</body>', () => `<script>${shim(role)}</script>\n${scripts}\n</body>`);
}

const docs = {
  voter: page('vote.html', 'voter', `<script type="module">${common}\n${stubs.voter}\n${plain(read('public/js/voter.js'))}</script>`),
  host: page('index.html', 'host', `<script>${qr}</script>\n<script type="module">${common}\n${stubs.host}\n${plain(read('public/js/host.js'))}</script>`),
};

// A JSON string inside a <script> must not contain a literal "</script" or "<!--".
const embed = (value) => JSON.stringify(value).replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

const content = read('demo/shell.html')
  .replace('/*__CORE__*/', () => plain(read('public/js/core.js')))
  .replace('/*__DOCS__*/ {}', () => embed(docs));

const out = path.join(ROOT, 'demo/dist');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'demo.html'), content);
fs.writeFileSync(
  path.join(out, 'standalone.html'),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${content}</body></html>`,
);
console.log(`demo.html ${(content.length / 1024).toFixed(0)} KB`);
