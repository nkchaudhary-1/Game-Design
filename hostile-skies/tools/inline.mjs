// Folds a Vite build (dist-skies-single/) into ONE self-contained hostile-skies.html: CSS, JS and fonts are already
// inlined by `SINGLE=1 vite build`; this puts the CSS and JS inside the page.
//   npm run skies:single   ->   dist-skies-single/hostile-skies.html (open it from disk, or host it anywhere)
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'dist-skies-single';
const html = readFileSync(join(dir, 'index.html'), 'utf8');
const assets = readdirSync(join(dir, 'assets'));
const read = (ext) => assets.filter((f) => f.endsWith(ext)).map((f) => readFileSync(join(dir, 'assets', f), 'utf8')).join('\n');
const css = read('.css');
// keep the script from ending the tag early or opening an HTML comment
const js = read('.js').replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const head = html.match(/<head>([\s\S]*?)<\/head>/)?.[1] ?? '';
const keep = head.split('\n').filter((l) => /<(meta|title|link rel="icon")\b/i.test(l)).join('\n');
const body = (html.match(/<body>([\s\S]*?)<\/body>/)?.[1] ?? '').replace(/<script\b[^>]*><\/script>/g, '').trim();
const out = `<!doctype html>\n<html lang="en">\n<head>\n${keep}\n<style>${css}</style>\n</head>\n<body>\n${body}\n<script type="module">${js}</script>\n</body>\n</html>\n`;
writeFileSync(join(dir, 'hostile-skies.html'), out);
console.log(`wrote ${join(dir, 'hostile-skies.html')} (${(out.length / 1e6).toFixed(2)} MB)`);
