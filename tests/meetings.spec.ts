import { test, expect, type BrowserContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Lobby } from '../shared/protocol';

test('reports and emergency meetings gather everyone, reveal ghosts, and can be switched off', async ({ page, browser, baseURL }, testInfo) => {
  let host: Lobby = (await (await page.request.post('/api/games', { data: { name: 'Laptop', language: 'en', playing: false } })).json()).lobby;
  const contexts: BrowserContext[] = [];
  try {
    for (const name of ['Anna', 'Bram', 'Cas', 'Dirk']) {
      const context = await browser.newContext({ baseURL, locale: 'en-GB', viewport: { width: 390, height: 844 } });
      contexts.push(context);
      await context.request.post('/api/games/join', { data: { code: host.code, name } });
    }
    host = (await (await page.request.get('/api/session')).json()).lobby;
    await page.request.post('/api/settings/commands', { data: { commandId: crypto.randomUUID(), expectedRevision: host.revision, roundId: null, openingProtection: 0 } });
    await page.goto('/');
    await page.getByRole('button', { name: 'Start round', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Playing' })).toBeVisible();

    const round = (await (await page.request.get('/api/session')).json()).lobby as Lobby;
    const roles = await Promise.all(contexts.map(async context => (await (await context.request.get(`/api/role?roundId=${round.roundId}`)).json()).role as string));
    const crew = contexts.filter((_, index) => roles[index] === 'crewmate');
    const impostor = contexts[roles.indexOf('impostor')];
    const own = async (context: BrowserContext) => (await (await context.request.get('/api/session')).json()).lobby as Lobby;
    const victim = await own(crew[0]);
    const victimName = victim.players.find(player => player.id === victim.you.id)!.name;
    expect((await impostor.request.post('/api/eliminate', { data: { commandId: crypto.randomUUID(), roundId: round.roundId, targetId: victim.you.id } })).status()).toBe(200);

    const pages = await Promise.all(crew.map(async context => { const tab = await context.newPage(); await tab.goto('/'); return tab; }));
    await expect(pages[0].getByRole('button', { name: 'Report body' })).toHaveCount(0);
    // The host already tapped Start round, which unlocks audio; count the alarm tones it plays.
    await page.evaluate(() => {
      const original = AudioContext.prototype.createOscillator;
      (window as unknown as { alarms: number }).alarms = 0;
      AudioContext.prototype.createOscillator = function () { (window as unknown as { alarms: number }).alarms++; return original.call(this); };
    });
    await pages[1].getByRole('button', { name: 'Report body' }).click();
    await expect(pages[1].getByRole('dialog', { name: 'Report a body?' })).toBeVisible();
    await pages[1].getByRole('dialog').getByRole('button', { name: 'Report body' }).click();

    for (const tab of [page, ...pages]) {
      await expect(tab.getByRole('heading', { name: 'Body reported!' })).toBeVisible();
      await expect(tab.getByText(`Found out, now ghosts: ${victimName}`)).toBeVisible();
    }
    await expect(pages[0].getByText('You’re a ghost: stay quiet and don’t vote.')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { alarms: number }).alarms)).toBe(1);
    await expect(page.getByText('Ghost', { exact: true })).toHaveCount(1);
    expect((await new AxeBuilder({ page: pages[1] }).analyze()).violations).toEqual([]);
    await pages[1].screenshot({ path: testInfo.outputPath('meeting-mobile.png'), fullPage: true });
    await page.screenshot({ path: testInfo.outputPath('meeting-host.png'), fullPage: true });

    await page.getByRole('button', { name: 'End meeting and continue' }).click();
    await expect(pages[1].getByRole('heading', { name: 'Body reported!' })).toHaveCount(0);
    await expect(pages[0].getByText('You’re a ghost. Keep doing tasks, but don’t talk or vote.')).toBeVisible();

    // One emergency meeting per living player.
    await pages[2].getByRole('button', { name: /^Emergency meeting/ }).click();
    await pages[2].getByRole('button', { name: 'Call meeting' }).click();
    await expect(page.getByRole('heading', { name: 'Emergency meeting!' })).toBeVisible();
    await expect(pages[1].getByText('No bodies were found.')).toBeVisible();
    await page.getByRole('button', { name: 'End meeting and continue' }).click();
    await expect(pages[2].getByRole('button', { name: 'Report body' })).toBeVisible();
    await expect(pages[2].getByRole('button', { name: /^Emergency meeting/ })).toHaveCount(0);

    // Switching both off removes the buttons; the organiser can still call a meeting.
    await page.getByText('Body reports', { exact: true }).click();
    await page.getByText('Emergency meetings', { exact: true }).click();
    await expect(pages[1].getByRole('button', { name: 'Report body' })).toHaveCount(0);
    await expect(pages[1].getByRole('button', { name: /^Emergency meeting/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Call meeting' }).click();
    await expect(pages[1].getByRole('heading', { name: 'Meeting called.' })).toBeVisible();
  } finally { for (const context of contexts) await context.close(); }
});

test('the organiser changes game settings with number fields', async ({ page }, testInfo) => {
  await page.request.post('/api/games', { data: { name: 'Laptop', language: 'en', playing: false } });
  await page.goto('/');
  await page.getByText('Game settings', { exact: true }).click();
  const increase = page.getByRole('button', { name: 'Increase Time before the first elimination (seconds)' });
  await increase.click();
  await increase.click();
  await page.getByRole('textbox', { name: 'Discussion time (seconds, 0 = no limit)' }).fill('0');
  await page.getByRole('textbox', { name: 'Discussion time (seconds, 0 = no limit)' }).blur();
  await expect.poll(async () => (await (await page.request.get('/api/session')).json()).lobby.settings).toMatchObject({ openingProtection: 70, discussionTime: 0 });
  await expect(page.getByRole('textbox', { name: 'Time before the first elimination (seconds)' })).toHaveValue('70');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByText('Game settings', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('game-settings-mobile.png'), fullPage: true });
});
