import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const SHOTS = 'e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

async function screen(page: Page): Promise<string> {
  return (await page.locator('[data-screen]').first().getAttribute('data-screen')) ?? 'none';
}

async function createRoom(page: Page, mode: 'player' | 'god', name: string): Promise<string> {
  await page.goto('/');
  await page.getByLabel('Your name').fill(name);
  if (mode === 'god') await page.getByRole('radiogroup', { name: 'Mode' }).getByText('God').click();
  await page.getByRole('radiogroup', { name: 'Player count' }).getByText('5', { exact: true }).click();
  await page.getByTestId('create').click();
  const code = (await page.getByTestId('room-code').textContent())?.trim() ?? '';
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  return code;
}

async function joinRoom(page: Page, code: string, name: string): Promise<void> {
  await page.goto(`/join/${code}`);
  await expect(page.getByTestId('join-code')).toHaveText(code);
  await page.getByLabel('Your name').fill(name);
  await page.getByTestId('join').click();
  await expect(page.locator('[data-screen="waiting"]')).toBeVisible();
}

/** Every roster row that shows a role must be dead, or be me, or (for traitors) a fellow traitor. */
async function assertNoLeak(page: Page, label: string): Promise<void> {
  const current = await screen(page);
  if (current === 'ended' || current === 'rules') return;
  const isGod = (await page.locator('.app').getAttribute('data-role')) === null && current !== 'waiting' && current !== 'landing' && current !== 'join' && current !== 'loading'
    ? await page.locator('[data-testid="god-breakdown"], [data-testid="god-night-status"]').count().then((n) => n > 0 || current !== 'roleReveal')
    : false;
  const myRole = await page.locator('.app').getAttribute('data-role');
  const rows = page.locator('[data-testid="player-row"]');
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i);
    const revealed = await row.getAttribute('data-revealed-role');
    if (!revealed) continue;
    const self = (await row.getAttribute('data-self')) === 'true';
    const alive = (await row.getAttribute('data-alive')) === 'true';
    if (self || !alive) continue;
    if (myRole === 'traitor' && revealed === 'traitor') continue;
    if (isGod || myRole === null) continue; // God sees everyone by design
    throw new Error(`${label} (${myRole}) saw a living player's role "${revealed}" on screen ${current}`);
  }
}

const shot = new Set<string>();
async function snapshot(page: Page, label: string): Promise<void> {
  const s = await screen(page);
  const role = (await page.locator('.app').getAttribute('data-role')) ?? 'none';
  const key = `${s}-${label === 'god' ? 'god' : role}`;
  if (shot.has(key)) return;
  shot.add(key);
  await page.screenshot({ path: `${SHOTS}/${key}.png`, fullPage: true });
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const wide = doc.scrollWidth > window.innerWidth + 1;
    const clipped: string[] = [];
    document.querySelectorAll<HTMLElement>('button, h1, h2, h3, .narration, .lead, .badge, .chip').forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.textOverflow === 'ellipsis' || cs.whiteSpace === 'nowrap') return;
      if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) clipped.push(`${el.tagName}.${el.className}: ${el.textContent?.slice(0, 30)}`);
    });
    return { wide, clipped, scrollWidth: doc.scrollWidth, innerWidth: window.innerWidth };
  });
  expect(overflow.wide, `${key}: horizontal overflow ${overflow.scrollWidth} > ${overflow.innerWidth}`).toBe(false);
  expect(overflow.clipped, `${key}: clipped text`).toEqual([]);
}

async function act(page: Page, label: string, isController: boolean, isGod: boolean): Promise<void> {
  const s = await screen(page);
  await assertNoLeak(page, label);
  await snapshot(page, isGod ? 'god' : label);
  const click = async (testId: string) => {
    const btn = page.getByTestId(testId).first();
    if ((await btn.count()) && (await btn.isEnabled())) {
      await btn.click({ timeout: 2000 }).catch(() => {});
      return true;
    }
    return false;
  };
  switch (s) {
    case 'roleReveal':
      if (isGod) {
        // Let players read first: advance only once nobody is still on the ack.
        return;
      }
      await click('ack');
      return;
    case 'narrator':
      if (isGod) return;
      await click('ack');
      return;
    case 'night': {
      const confirm = page.getByTestId('confirm');
      if ((await confirm.count()) && (await confirm.isEnabled())) {
        await confirm.click().catch(() => {});
        return;
      }
      const targets = page.getByTestId('target');
      if ((await targets.count()) > 0) {
        await targets.first().click().catch(() => {});
      }
      return;
    }
    case 'dayReveal':
    case 'voteResult':
      if (isGod) {
        if (await click('publish')) return;
      }
      if (isController) await click('advance');
      return;
    case 'discussion':
      if (isController) await click('advance');
      return;
    case 'voting': {
      if (isGod) return;
      const picks = page.getByTestId('vote-pick');
      if ((await picks.count()) > 0) {
        await picks.first().click().catch(() => {});
        await click('vote');
      }
      return;
    }
    default:
      return;
  }
}

async function playToEnd(pages: { page: Page; label: string; controller: boolean; god: boolean }[]): Promise<void> {
  const deadline = Date.now() + 200_000;
  for (;;) {
    const screens = await Promise.all(pages.map((p) => screen(p.page)));
    if (screens.every((s) => s === 'ended')) return;
    if (Date.now() > deadline) throw new Error(`game did not end; screens: ${screens.join(', ')}`);
    for (const p of pages) await act(p.page, p.label, p.controller, p.god);
    // God waits for players to ack before moving the role reveal along.
    const god = pages.find((p) => p.god);
    if (god && (await screen(god.page)) === 'roleReveal' && screens.filter((s) => s === 'roleReveal').length === 1) {
      await god.page.getByTestId('advance').click().catch(() => {});
    }
    if (god && (await screen(god.page)) === 'narrator') {
      const othersWaiting = await Promise.all(pages.filter((p) => !p.god).map(async (p) => (await screen(p.page)) === 'narrator'));
      if (othersWaiting.every((w) => !w)) await god.page.getByTestId('advance').click().catch(() => {});
    }
    await pages[0].page.waitForTimeout(350);
  }
}

async function openPages(browser: Browser, n: number): Promise<Page[]> {
  const pages: Page[] = [];
  for (let i = 0; i < n; i++) {
    const ctx = await browser.newContext();
    pages.push(await ctx.newPage());
  }
  return pages;
}

test('five phones play a full game in Player mode without seeing each other\'s roles', async ({ browser }) => {
  const pages = await openPages(browser, 5);
  const code = await createRoom(pages[0], 'player', 'Host Harper');
  await snapshot(pages[0], 'host');
  for (let i = 1; i < 5; i++) await joinRoom(pages[i], code, `Guest ${i}`);
  await expect(pages[0].getByTestId('roster').locator('[data-testid="player-row"]')).toHaveCount(5);
  await snapshot(pages[1], 'guest');

  // Rules opens from any screen and returns to the exact same screen.
  await pages[1].getByRole('button', { name: 'Rules' }).click();
  await expect(pages[1].locator('[data-screen="rules"]')).toBeVisible();
  await snapshot(pages[1], 'rules');
  await pages[1].getByTestId('rules-back').click();
  await expect(pages[1].locator('[data-screen="waiting"]')).toBeVisible();

  await pages[0].getByTestId('start').click();
  await expect(pages[0].locator('[data-screen="roleReveal"]')).toBeVisible();

  // Each player sees exactly one role card, their own.
  const roles: string[] = [];
  for (const p of pages) {
    const card = p.getByTestId('role-card');
    await expect(card).toHaveCount(1);
    roles.push((await card.getAttribute('data-role')) ?? '');
  }
  expect(roles.filter((r) => r === 'traitor').length).toBe(1);
  expect(roles.filter((r) => r === 'doctor').length).toBe(1);
  expect(roles.filter((r) => r === 'innocent').length).toBe(3);

  await playToEnd(pages.map((page, i) => ({ page, label: i === 0 ? 'host' : `guest${i}`, controller: i === 0, god: false })));
  const winner = await pages[0].getByTestId('winner').textContent();
  expect(winner).toMatch(/win/);
  for (const p of pages) await snapshot(p, 'end');
  for (const p of pages) await p.context().close();
});

test('God mode: the narrator sees roles, publishes announcements and drives the game', async ({ browser }) => {
  const pages = await openPages(browser, 6);
  const code = await createRoom(pages[0], 'god', 'Narrator Nox');
  for (let i = 1; i < 6; i++) await joinRoom(pages[i], code, `Player ${i}`);
  await expect(pages[0].getByTestId('roster').locator('[data-testid="player-row"]')).toHaveCount(6);
  await pages[0].getByTestId('start').click();
  await expect(pages[0].locator('[data-screen="roleReveal"]')).toBeVisible();

  // God's roster shows every role; players' cards show only their own.
  const godRoles = pages[0].getByTestId('roster').locator('[data-revealed-role]');
  await expect(godRoles).toHaveCount(5);
  for (const p of pages.slice(1)) await expect(p.getByTestId('role-card')).toHaveCount(1);

  await playToEnd(pages.map((page, i) => ({ page, label: i === 0 ? 'god' : `player${i}`, controller: i === 0, god: i === 0 })));
  await expect(pages[0].getByTestId('winner')).toBeVisible();
  for (const p of pages) await p.context().close();
});

test('a reload mid-game rebuilds the screen from the server snapshot', async ({ browser }) => {
  const pages = await openPages(browser, 5);
  const code = await createRoom(pages[0], 'player', 'Reloader');
  for (let i = 1; i < 5; i++) await joinRoom(pages[i], code, `R ${i}`);
  await pages[0].getByTestId('start').click();
  await expect(pages[1].locator('[data-screen="roleReveal"]')).toBeVisible();
  const before = await pages[1].getByTestId('role-card').getAttribute('data-role');
  await pages[1].reload();
  await expect(pages[1].locator('[data-screen="roleReveal"]')).toBeVisible();
  const after = await pages[1].getByTestId('role-card').getAttribute('data-role');
  expect(after).toBe(before);
  for (const p of pages) await p.context().close();
});
