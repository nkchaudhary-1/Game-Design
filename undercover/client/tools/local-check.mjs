// Plays the browser-only build end to end in Chromium: pass & play with 6 seats, then solo vs bots.
//   node tools/local-check.mjs <dist-local dir> <screenshot dir>
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const [dir, shots] = process.argv.slice(2);
const srv = spawn('python3', ['-m', 'http.server', '8777', '--bind', '127.0.0.1'], { cwd: dir, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const errors = [];

async function run(label, drive) {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(`${label}: ${m.text()}`); });
  await page.goto('http://127.0.0.1:8777/local.html');
  const screen = async () => page.locator('[data-screen]').first().getAttribute('data-screen');
  const click = async (id) => { const b = page.getByTestId(id).first(); if ((await b.count()) && (await b.isEnabled())) { await b.click({ timeout: 1500 }).catch(() => {}); return true; } return false; };
  const seen = new Set();
  const deadline = Date.now() + 180_000;
  await drive.start(page, click);
  while (Date.now() < deadline) {
    const s = await screen();
    if (!seen.has(s)) { seen.add(s); await page.screenshot({ path: `${shots}/${label}-${s}.png` }); }
    if (s === 'ended') break;
    await drive.step(page, s, click);
    await page.waitForTimeout(250);
  }
  console.log(`${label}: final=${await screen()} winner=${await page.getByTestId('winner').textContent().catch(() => 'n/a')} screens=${[...seen].join(',')}`);
  await page.close();
}

const act = async (page, s, click) => {
  if (s === 'gate') return click('unlock');
  if (s === 'roleReveal' || s === 'narrator') return click('ack');
  if (s === 'night') {
    const c = page.getByTestId('confirm');
    if ((await c.count()) && (await c.isEnabled())) return c.click().catch(() => {});
    const t = page.getByTestId('target');
    if (await t.count()) return t.first().click().catch(() => {});
    return click('pass');
  }
  if (s === 'dayReveal' || s === 'voteResult' || s === 'discussion') return click('advance');
  if (s === 'voting') { const p = page.getByTestId('vote-pick'); if (await p.count()) { await p.first().click().catch(() => {}); await click('vote'); } }
};

await run('table', {
  start: async (page, click) => { await click('pick-table'); await page.getByTestId('table-start').waitFor(); await click('table-start'); },
  step: act,
});
await run('solo', {
  start: async (page, click) => {
    await click('pick-solo');
    await page.getByLabel('Your name').fill('Neelesh');
    await click('create');
    await page.locator('[data-testid="player-row"]').nth(4).waitFor({ timeout: 15000 });
    await click('start');
  },
  step: act,
});
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
srv.kill();
