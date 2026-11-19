/**
 * Browser smoke test + screenshot tour. Not part of `npm test` (needs Playwright + Chromium, which are not dependencies).
 *
 *   npm run dev            # in one terminal
 *   node scripts/tour.cjs  # in another   (BASE=http://localhost:5173 SHOTS=./shots)
 *
 * Two headless players join, see each other, chat, one opens a door and rides the lift.
 * Uses the `?debug` hooks (window.__nb) to drive the same input pipeline a keyboard would.
 */
const { chromium } = require('playwright');
const { mkdirSync } = require('node:fs');

const BASE = process.env.BASE || 'http://localhost:5173';
const SHOTS = process.env.SHOTS || './shots';
mkdirSync(SHOTS, { recursive: true });

async function player(browser, name) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 560 } });
  await ctx.addInitScript(() => localStorage.setItem('nb.settings', JSON.stringify({ quality: 'low' })));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/?debug&shot`);
  await page.waitForFunction(() => window.__nb);
  await page.fill('input[type=text]', name);
  await page.click('.cta');
  await page.waitForFunction(() => window.__nb.state().play === 'play', null, { timeout: 20000 });
  return { page, errors, state: () => page.evaluate(() => window.__nb.state()) };
}
async function walkTo(p, tx, tz, { sprint = false, tol = 0.35 } = {}) {
  for (let i = 0; i < 1500; i++) {
    const s = await p.state();
    const dx = tx - s.x, dz = tz - s.z, d = Math.hypot(dx, dz);
    if (d < tol) return p.page.evaluate(() => window.__nb.stop());
    await p.page.evaluate(([x, z, sp]) => window.__nb.drive(x, z, false, sp), [dx / d, dz / d, sprint]);
    await p.page.waitForTimeout(60);
  }
  throw new Error(`walkTo timed out heading for ${tx},${tz}`);
}
const ok = (cond, msg) => { console.log(`${cond ? '✔' : '✘'} ${msg}`); if (!cond) process.exitCode = 1; };

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const a = await player(browser, 'Mira');
  const b = await player(browser, 'Dev');
  await a.page.waitForTimeout(1500);
  ok((await a.state()).remotes === 1 && (await b.state()).remotes === 1, 'both players see each other');

  // chat
  await a.page.evaluate(() => window.__nb.game.net.send({ t: 'chat', text: 'hello from Mira' }));
  await b.page.waitForSelector('.chat .line', { timeout: 5000 });
  ok((await b.page.textContent('.chat .line')).includes('hello from Mira'), 'chat arrives');

  // pause menu + a click on it (guards against UI layers swallowing pointer events)
  await a.page.keyboard.press('Escape');
  await a.page.waitForSelector('.panel h2');
  await a.page.click('.btn.primary');
  ok(true, 'pause menu opens and Resume is clickable');

  // walk to the lift (via the street and the lobby) and ride to floor 3 with the real UI
  await a.page.evaluate(() => window.__nb.look(Math.PI / 2, 0.3));
  await walkTo(a, 15, 5.5, { sprint: true });
  await a.page.evaluate(() => window.__nb.look(0, 0.3));
  await walkTo(a, 15, 9.4, { tol: 0.25 });
  await a.page.waitForTimeout(1500);
  await a.page.evaluate(() => window.__nb.interact());                 // main entrance
  await a.page.waitForTimeout(1200);
  await walkTo(a, 15, 13);
  await walkTo(a, 13, 22.4, { tol: 0.25 });
  await a.page.evaluate(() => window.__nb.look(Math.PI / 2, 0.15));
  await a.page.waitForTimeout(1500);
  await a.page.evaluate(() => window.__nb.interact());                 // cab panel
  await a.page.click('.floors button:has-text("Floor 3")');
  await a.page.waitForFunction(() => { const s = window.__nb.state(); return s.lift.y > 9.79 && s.lift.mode === 0; }, null, { timeout: 60000 });
  const s = await a.state();
  ok(Math.abs(s.y - 9.8) < 0.05 && /Floor 3/.test(s.zone), `rode the lift to ${s.zone} (y=${s.y.toFixed(2)})`);
  await a.page.screenshot({ path: `${SHOTS}/tour-lift-arrived.png` });
  await b.page.screenshot({ path: `${SHOTS}/tour-second-player.png` });

  ok(a.errors.length === 0 && b.errors.length === 0, `no page errors ${a.errors.concat(b.errors).join(' | ')}`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
