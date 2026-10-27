// Records the demo reel to an MP4 with sound.
//
//   npm run skies:build
//   npx vite preview --config hostile-skies/vite.config.ts      # or any static server on dist-skies/
//   node hostile-skies/tools/record-demo.mjs                    # -> demo-out/hostile-skies-demo.mp4
//
// How it works: the game, opened with ?record, steps the demo reel at a fixed rate instead of on requestAnimationFrame
// and exposes window.__rec. This script plans how many frames the reel has, renders the sound offline (Web Audio's
// OfflineAudioContext), captures each frame from the page, then joins them with ffmpeg. Frames are deterministic, so
// the work can be split across browsers (WORKERS), although software WebGL already uses every core.
//
// Needs: playwright (npm i -D playwright, or a global install) and ffmpeg on the PATH.
// Env: URL (default http://localhost:4174/), OUT (demo-out), W/H (1024x576), FPS (24), QUALITY (medium), WORKERS (2).

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('This tool needs Playwright: npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

const env = process.env;
const URL = env.URL ?? 'http://localhost:4174/';
const OUT = env.OUT ?? 'demo-out';
const W = Number(env.W ?? 1024), H = Number(env.H ?? 576), FPS = Number(env.FPS ?? 24);
const WORKERS = Number(env.WORKERS ?? 2), QUALITY = env.QUALITY ?? 'medium';
mkdirSync(`${OUT}/frames`, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const t0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - t0) / 1000)}s]`, ...a);

async function open() {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`${URL}?record&shot&quality=${QUALITY}&fps=${FPS}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__rec, null, { timeout: 90_000 });
  return page;
}

const planPage = await open();
const frames = await planPage.evaluate(() => window.__rec.plan());
log(`reel is ${frames} frames (${(frames / FPS).toFixed(1)} s)`);

log('rendering sound');
const wav = await planPage.evaluate((n) => window.__rec.audio(n), frames);
writeFileSync(`${OUT}/audio.wav`, Buffer.from(wav, 'base64'));
await planPage.close();

let done = 0;
async function worker(k) {
  const start = Math.floor((frames * k) / WORKERS), end = Math.floor((frames * (k + 1)) / WORKERS);
  const page = await open();
  const warm = Math.max(0, start - 36); // run a second or so ahead so particles and the camera have settled
  await page.evaluate((n) => window.__rec.seek(n), warm);
  for (let i = warm; i < start; i++) await page.evaluate(() => window.__rec.frame());
  for (let f = start; f < end; f++) {
    const url = await page.evaluate(() => { window.__rec.frame(); return window.__rec.snap(0.92); });
    writeFileSync(`${OUT}/frames/${String(f).padStart(6, '0')}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
    if (++done % 100 === 0) log(`${done}/${frames} frames`);
  }
  await page.close();
}
await Promise.all(Array.from({ length: WORKERS }, (_, k) => worker(k)));
await browser.close();

log('encoding');
const dur = frames / FPS;
execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', `${OUT}/frames/%06d.jpg`, '-i', `${OUT}/audio.wav`,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k',
  '-af', `afade=t=in:st=0:d=0.6,afade=t=out:st=${(dur - 1.4).toFixed(2)}:d=1.4`, '-t', dur.toFixed(2), '-movflags', '+faststart',
  `${OUT}/hostile-skies-demo.mp4`,
], { stdio: 'inherit' });
log(`wrote ${OUT}/hostile-skies-demo.mp4`);
