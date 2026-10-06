// End-to-end check of the real game in a real (headless) browser. Needs Playwright, which is NOT a project
// dependency:   npm i -D playwright && npx playwright install chromium
//
//   npm run dev &                       # or: npm run build && npm run preview
//   node tests/e2e/flow.mjs [baseUrl]
//
// Screenshots go to $SHOTS (default: the OS temp dir).
import { createRequire } from 'node:module';
import os from 'node:os';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = createRequire('/opt/node22/lib/node_modules/')('playwright')); }
const SP = process.env.SHOTS || os.tmpdir();
const base = process.argv[2] || 'http://127.0.0.1:5173/';
const w = +(process.argv[3] || 1280), h = +(process.argv[4] || 720);
const tag = process.argv[5] || 'e';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: w, height: h }, hasTouch: false });
const errs = []; page.on('pageerror', e => errs.push('PAGEERR ' + e.message)); page.on('console', m => { if (m.type()==='error') errs.push(m.type()+': '+m.text()); });
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const ev = (fn, arg) => page.evaluate(fn, arg);
await page.goto(base + '?screen=lobby'); await page.waitForTimeout(1500);
await page.click('.cta .btn.primary'); await page.waitForTimeout(1500);
ok(await ev(() => window.__battle?.currentPhase) === 'ready', 'battle starts in ready phase');
const pad = await page.locator('.pad-surface').boundingBox();
const cx = pad.x + pad.width / 2, cy = pad.y + pad.height * 0.3;
// slingshot: pull straight back (down) 90px
await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx, cy + 45, { steps: 4 }); await page.mouse.move(cx, cy + 90, { steps: 4 });
await page.waitForTimeout(250);
await page.screenshot({ path: `${SP}/${tag}-1-sling.png` });
await page.mouse.up(); await page.waitForTimeout(500);
ok(await ev(() => window.__battle.currentPhase) === 'live', 'release launches (phase live)');
const v = await ev(() => { const b = window.__battle.match.blades[0]; return { vz: b.vz, speed: b.speed }; });
ok(v.vz < -1, `launch heads up-screen (vz=${v.vz.toFixed(2)})`);
// steer right
await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 40, cy, { steps: 4 });
await page.waitForTimeout(150);
const st = await ev(() => { const b = window.__battle.match.blades[0]; return { x: b.steerX, z: b.steerZ }; });
ok(st.x > 0.4, `joystick steers right (steerX=${st.x.toFixed(2)})`);
await page.screenshot({ path: `${SP}/${tag}-2-steer.png` });
await page.mouse.up(); await page.waitForTimeout(100);
ok((await ev(() => window.__battle.match.blades[0].steerX)) === 0, 'releasing joystick stops steering');
// hold Move 1 to charge
const m1 = await page.locator('.mbtn').nth(0).boundingBox();
await page.mouse.move(m1.x + m1.width / 2, m1.y + m1.height / 2); await page.mouse.down();
// software-rendered CI can be slow, so wait for the charge to build rather than for a fixed time
await page.waitForFunction(() => window.__battle.match.blades[0].charge.t > 0.2, null, { timeout: 8000 }).catch(() => {});
const ch = await ev(() => { const b = window.__battle.match.blades[0]; return { idx: b.charge.index, t: b.charge.t, spin: b.spin }; });
ok(ch.idx === 0 && ch.t > 0.2, `holding Move 1 charges (t=${ch.t.toFixed(2)})`);
ok(await page.locator('.mbtn.charging').count() === 1, 'pad shows charging state');
await page.screenshot({ path: `${SP}/${tag}-3-charge.png` });
await page.mouse.up();
await page.waitForFunction(() => window.__battle.match.blades[0].stats.abilitiesUsed > 0, null, { timeout: 8000 }).catch(() => {});
ok(await ev(() => window.__battle.match.blades[0].charge.index) === -1, 'release fires the charged move');
const used = await ev(() => window.__battle.match.blades[0].stats.abilitiesUsed);
ok(used > 0, `the move was used (${used}) and goes on cooldown`);
// Super
await page.locator('.sbtn').click();
await page.waitForFunction(() => window.__battle.match.blades[0].superState === 'ACTIVE', null, { timeout: 8000 }).catch(() => {});
ok(await ev(() => window.__battle.match.blades[0].superState) === 'ACTIVE', 'Super button activates Super');
await page.waitForFunction(() => document.querySelector('.sbtn[data-state="ACTIVE"]'), null, { timeout: 8000 }).catch(() => {});
ok(await page.locator('.sbtn[data-state="ACTIVE"]').count() === 1, 'pad shows ACTIVE');
await page.screenshot({ path: `${SP}/${tag}-4-super.png` });
// fast-forward to a result
await ev(() => { window.__battle.speed = 8; });
await page.waitForSelector('.result .sheet h2', { timeout: 120000 });
await ev(() => { window.__battle.speed = 1; });
await page.waitForTimeout(500);
const title = await page.locator('.result h2').innerText();
const cause = await page.locator('.result .cause').innerText();
console.log('RESULT:', title, '/', cause);
ok(['VICTORY', 'DEFEAT', 'DRAW'].includes(title.toUpperCase()), 'result sheet shows outcome');
ok(/RING|SPIN|DOUBLE|TIME/i.test(cause), 'result names the cause');
console.log((await page.locator('.result .sheet').innerText()).replace(/\n+/g, ' | '));
await page.screenshot({ path: `${SP}/${tag}-5-result.png` });
await page.click('.result .btn.primary'); await page.waitForTimeout(1200);
ok(await ev(() => window.__battle?.currentPhase) === 'ready', 'rematch returns to ready phase');
const score = await page.locator('.hud-round .score').innerText();
console.log('score text:', score.replace(/\s+/g, ' '));
await page.screenshot({ path: `${SP}/${tag}-6-rematch.png` });
console.log('errors:', errs.length ? errs : 'none');
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
await browser.close();
