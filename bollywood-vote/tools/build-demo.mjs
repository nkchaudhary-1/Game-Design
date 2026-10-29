// Builds the click-through demo: the real guest and host pages in two iframes, wired to the real voting rules in-page.
//   node tools/build-demo.mjs            -> demo/dist/demo.html        (page content only, for publishing as an Artifact)
//                                           demo/dist/standalone.html  (same, wrapped as a full document to open locally)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

// Module syntax -> plain script: drop `export`, drop the import of common.js (it is concatenated in front).
const plain = (src) => src.replace(/^export (?=(async function|function|const|let)\b)/gm, '').replace(/^import .*from '\.\/common\.js';\n/m, '');

const css = read('public/css/style.css');
const qr = read('public/vendor/qrcode.js');
const common = plain(read('public/js/common.js'));

// Stands in for the network: /api/* goes to the page that holds the voting rules, live updates come back the same way.
const shim = (hostKey) => `
${hostKey ? `window.__BV_HOST_KEY = ${JSON.stringify(hostKey)};` : ''}
(() => {
  let n = 0;
  const pending = new Map();
  const streams = new Set();
  const ask = (msg) => new Promise((resolve) => { const id = ++n; pending.set(id, resolve); parent.postMessage({ bv: 1, id, ...msg }, '*'); });
  addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.bv !== 1 || e.source !== parent) return;
    if (d.type === 'resp') { pending.get(d.id)?.(d); pending.delete(d.id); }
    if (d.type === 'state') for (const s of streams) s.onmessage?.({ data: d.data });
  });
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, opts = {}) => {
    const u = new URL(input, 'http://demo.local/');
    if (!u.pathname.startsWith('/api/')) return realFetch(input, opts);
    const r = await ask({ type: 'req', method: opts.method || 'GET', path: u.pathname, query: Object.fromEntries(u.searchParams), body: opts.body ? JSON.parse(opts.body) : {}, hostKey: opts.headers && opts.headers['X-Host-Key'] });
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  };
  window.EventSource = class {
    constructor() {
      streams.add(this);
      ask({ type: 'sub' }).then((r) => this.onmessage?.({ data: JSON.stringify(r.body) }));
    }
    close() { streams.delete(this); }
  };
})();`;

function page(file, { scripts, hostKey }) {
  let html = read('public', file);
  html = html.replace('<link rel="stylesheet" href="/css/style.css">', () => `<style>${css}</style>`);
  html = html.replace(/<script[^>]*src="[^"]+"[^>]*><\/script>\n?/g, '');
  const inline = `<script>${shim(hostKey)}</script>\n${scripts}`;
  return html.replace('</body>', () => `${inline}\n</body>`);
}

const voterJs = plain(read('public/js/voter.js'));
const hostJs = plain(read('public/js/host.js'));
const docs = {
  voter: page('index.html', { scripts: `<script type="module">${common}\n${voterJs}</script>` }),
  host: page('host.html', { hostKey: 'demo', scripts: `<script>${qr}</script>\n<script type="module">${common}\n${hostJs}</script>` }),
};

// A JSON string inside a <script> must not contain a literal "</script" or "<!--".
const embed = (value) => JSON.stringify(value).replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

const content = read('demo/shell.html')
  .replace('/*__CORE__*/', () => plain(read('lib/core.js')))
  .replace('/*__DOCS__*/ {}', () => embed(docs));

const out = path.join(ROOT, 'demo/dist');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'demo.html'), content);
fs.writeFileSync(
  path.join(out, 'standalone.html'),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${content}</body></html>`,
);
console.log(`demo.html ${(content.length / 1024).toFixed(0)} KB`);
