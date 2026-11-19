// Turns dist-artifact/artifact.html into ONE self-contained HTML fragment (title + style + canvas + classic script),
// the shape the Artifact tool wraps in a document. Output: dist-artifact/neighborhood-playable.html
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist-artifact');
let html = readFileSync(join(dir, 'artifact.html'), 'utf8');
const read = (p) => readFileSync(join(dir, p.replace(/^\.\//, '')), 'utf8');

const css = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)].map((m) => read(m[1])).join('\n');
const js = [...html.matchAll(/<script[^>]+src="([^"]+)"[^>]*><\/script>/g)].map((m) => read(m[1])).join('\n;\n');
if (!js) throw new Error('no script found in artifact.html');
if (/import\.meta/.test(js)) throw new Error('bundle still contains import.meta; it cannot run as a classic script');

const title = (html.match(/<title>(.*?)<\/title>/) ?? [])[1] ?? 'Neighborhood';
const safeJs = js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const out = `<title>${title}</title>\n<style>\n${css}\n</style>\n<canvas id="c"></canvas>\n<div id="ui"></div>\n<script>\n${safeJs}\n</script>\n`;
writeFileSync(join(dir, 'neighborhood-playable.html'), out);
console.log(`neighborhood-playable.html  ${(out.length / 1024).toFixed(0)} kB  (js ${(js.length / 1024).toFixed(0)} kB, css ${(css.length / 1024).toFixed(0)} kB)`);
