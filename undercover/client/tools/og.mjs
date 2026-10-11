// Renders public/og.png (1200x630) and public/apple-touch-icon.png with Chromium. Run once; outputs are committed.
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const html = (w, h, icon) => `<!doctype html><html><head><meta charset="utf-8">
<style>
html,body{margin:0;width:${w}px;height:${h}px;background:#050607;font-family:Inter,system-ui,sans-serif;color:#f2f3f4;overflow:hidden}
.bg{position:absolute;inset:0;background:radial-gradient(120% 70% at 50% -10%,#1a1d20 0%,#0b0d0f 45%,#050607 100%)}
.fog{position:absolute;left:-20%;right:-20%;bottom:-30%;height:70%;background:radial-gradient(60% 60% at 50% 50%,rgba(197,201,204,.22),rgba(197,201,204,0) 70%);filter:blur(40px)}
.v{position:absolute;inset:0;background:radial-gradient(90% 80% at 50% 45%,rgba(5,6,7,0) 40%,rgba(5,6,7,.8) 100%)}
.w{position:absolute;left:0;right:0;top:${icon ? 34 : 180}px;text-align:center;font-weight:800;letter-spacing:.2em;text-transform:uppercase;font-size:${icon ? 0 : 118}px;line-height:1}
.t{position:absolute;left:0;right:0;top:330px;text-align:center;font-style:italic;font-size:44px;color:#c5c9cc;font-family:Georgia,serif}
.s{position:absolute;left:0;right:0;top:420px;text-align:center;font-size:26px;color:#777d82;letter-spacing:.08em}
svg{position:absolute;left:50%;transform:translateX(-50%)}
</style></head><body><div class="bg"></div><div class="fog"></div>
<svg viewBox="0 0 64 64" width="${icon ? 130 : 110}" height="${icon ? 130 : 110}" style="top:${icon ? 25 : 60}px"><path d="M14 30c0-6 7-9 18-9s18 3 18 9l-3 2H17z" fill="#151719" stroke="#C5C9CC" stroke-width="1.5"/><path d="M20 23c0-9 4-13 12-13s12 4 12 13" fill="#151719" stroke="#C5C9CC" stroke-width="1.5"/><path d="M12 56c2-12 9-17 20-17s18 5 20 17" fill="#151719" stroke="#C5C9CC" stroke-width="1.5"/></svg>
${icon ? '' : '<div class="w">Undercover</div><div class="t">Someone at this table is lying.</div><div class="s">A REAL-TIME SOCIAL DEDUCTION GAME · 5 TO 11 PLAYERS</div>'}
<div class="v"></div></body></html>`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
for (const [file, w, h, icon] of [['public/og.png', 1200, 630, false], ['public/apple-touch-icon.png', 180, 180, true]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.setContent(html(w, h, icon));
  writeFileSync(file, await page.screenshot({ type: 'png' }));
  await page.close();
  console.log('wrote', file);
}
await browser.close();
