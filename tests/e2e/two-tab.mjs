// End-to-end check of the real game in a real (headless) browser. Needs Playwright, which is NOT a project
// dependency:   npm i -D playwright && npx playwright install chromium
//
//   npm run dev &                       # or: npm run build && npm run preview
//   node tests/e2e/two-tab.mjs [baseUrl]
//
// Screenshots go to $SHOTS (default: the OS temp dir).
import { createRequire } from 'node:module';
import os from 'node:os';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = createRequire('/opt/node22/lib/node_modules/')('playwright')); }
const SP = process.env.SHOTS || os.tmpdir();
const base = process.argv[2] || 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } });
const A = await ctx.newPage();
const errs = []; A.on('pageerror', e => errs.push('A ' + e.message));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
await A.goto(base + '?screen=lobby&quality=' + (process.env.QUALITY || 'low')); await A.waitForTimeout(1200);
await A.click('.cta .btn.primary'); await A.waitForTimeout(1200);
const [B] = await Promise.all([ctx.waitForEvent('page'), A.click('button[aria-label="Open controller in a new tab"]')]);
B.on('pageerror', e => errs.push('B ' + e.message));
await B.waitForLoadState(); await B.waitForTimeout(1200);
ok(/connected/i.test(await B.locator('.status').innerText()), 'controller tab connects (' + (await B.locator('.status').innerText()) + ')');
const pad = await B.locator('.pad-surface').boundingBox();
const cx = pad.x + pad.width / 2, cy = pad.y + pad.height * 0.3;
await B.mouse.move(cx, cy); await B.mouse.down(); await B.mouse.move(cx, cy + 60, { steps: 5 });
await A.waitForTimeout(100);
const aim = await A.evaluate(() => 'ready');
await B.mouse.up();
await A.waitForFunction(() => window.__battle.currentPhase === 'live', null, { timeout: 15000 }).catch(() => {});
ok(await A.evaluate(() => window.__battle.currentPhase) === 'live', 'launch from controller tab starts the match on the display tab');
await B.mouse.move(cx, cy); await B.mouse.down(); await B.mouse.move(cx - 40, cy, { steps: 4 });
await A.waitForFunction(() => window.__battle.match.blades[0].steerX < -0.4, null, { timeout: 15000 }).catch(() => {});
ok((await A.evaluate(() => window.__battle.match.blades[0].steerX)) < -0.4, 'steering crosses tabs');
await B.mouse.up();
await B.locator('.sbtn').click();
await A.waitForFunction(() => window.__battle.match.blades[0].superState === 'ACTIVE', null, { timeout: 15000 }).catch(() => {});
await B.waitForFunction(() => document.querySelector('.sbtn[data-state="ACTIVE"]'), null, { timeout: 15000 }).catch(() => {});
ok(await A.evaluate(() => window.__battle.match.blades[0].superState) === 'ACTIVE', 'Super from controller tab');
ok(await B.locator('.sbtn[data-state="ACTIVE"]').count() === 1, 'feedback returns to controller tab (Super ACTIVE)');
await B.screenshot({ path: `${SP}/two-controller.png` });
await A.evaluate(() => { window.__battle.speed = 8; });
await A.waitForSelector('.result .sheet', { timeout: 120000 });
await A.click('.result .btn.primary'); await A.waitForTimeout(1200);
await B.waitForTimeout(400);
ok(/Slingshot/i.test(await B.locator('.pad-surface .label').innerText()), 'controller resets for the rematch');
console.log('errors:', errs.length ? errs : 'none'); console.log(fails ? fails + ' FAILED' : 'ALL PASS');
await browser.close();
