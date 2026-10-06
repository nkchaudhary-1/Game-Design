// Folds a Vite build (dist-single/) into ONE self-contained index.html: CSS, JS, fonts, art and the physics
// WASM are already inlined by `SINGLE=1 vite build`; this puts the CSS and JS inside the page.
//   npm run build:single   →   dist-single/spinblade-arena.html (open it from disk, or host it anywhere)
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'dist-single';
const html = readFileSync(join(dir, 'index.html'), 'utf8');
const assets = readdirSync(join(dir, 'assets'));
const css = assets.filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(dir, 'assets', f), 'utf8')).join('\n');
const js = assets.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(dir, 'assets', f), 'utf8')).join('\n');
// keep the script from ending the tag early or opening an HTML comment
const safeJs = js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const head = html.match(/<head>([\s\S]*?)<\/head>/)?.[1] ?? '';
const keep = head.split('\n').filter((l) => /<(meta|title)\b/i.test(l)).join('\n');
const out = `<!doctype html>\n<html lang="en">\n<head>\n${keep}\n<style>${css}</style>\n</head>\n<body>\n<div id="app"></div>\n<script type="module">${safeJs}</script>\n</body>\n</html>\n`;
writeFileSync(join(dir, 'spinblade-arena.html'), out);
console.log(`wrote ${join(dir, 'spinblade-arena.html')} (${(out.length / 1e6).toFixed(2)} MB)`);
