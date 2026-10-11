import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const srv = spawn('python3', ['-m', 'http.server', '8777', '--bind', '127.0.0.1'], { cwd: process.argv[2], stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://127.0.0.1:8777/demo.html');
await page.getByLabel('Your name').fill('Neelesh');
await page.getByTestId('create').click();
await page.getByTestId('room-code').waitFor();
await page.locator('[data-testid="player-row"]').nth(4).waitFor({ timeout: 10000 });
await page.screenshot({ path: process.argv[3] + '/demo-waiting.png' });
await page.getByTestId('start').click();
const screen = async () => page.locator('[data-screen]').first().getAttribute('data-screen');
const deadline = Date.now() + 150000; const seen = new Set();
while (Date.now() < deadline) {
  const s = await screen();
  if (!seen.has(s)) { seen.add(s); await page.screenshot({ path: `${process.argv[3]}/demo-${s}.png` }); }
  if (s === 'ended') break;
  const click = async id => { const b = page.getByTestId(id).first(); if (await b.count() && await b.isEnabled()) await b.click({ timeout: 1500 }).catch(() => {}); };
  if (s === 'roleReveal' || s === 'narrator') await click('ack');
  else if (s === 'night') { const c = page.getByTestId('confirm'); if (await c.count() && await c.isEnabled()) await c.click().catch(()=>{}); else { const t = page.getByTestId('target'); if (await t.count()) await t.first().click().catch(()=>{}); } }
  else if (s === 'dayReveal' || s === 'voteResult' || s === 'discussion') await click('advance');
  else if (s === 'voting') { const p = page.getByTestId('vote-pick'); if (await p.count()) { await p.first().click().catch(()=>{}); await click('vote'); } }
  await page.waitForTimeout(500);
}
console.log('final screen:', await screen(), '| screens seen:', [...seen].join(', '));
console.log('winner:', await page.getByTestId('winner').textContent().catch(() => 'n/a'));
console.log('errors:', errors.length ? errors : 'none');
await browser.close(); srv.kill();
