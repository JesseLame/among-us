import { test, expect, type BrowserContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Lobby } from '../shared/protocol';

test('the Impostor eliminates privately, the victim becomes a body, and the Impostor can win', async ({ page, browser, baseURL }, testInfo) => {
  // A host-only organiser with no waiting time before eliminations.
  let host: Lobby = (await (await page.request.post('/api/games', { data: { name: 'Laptop', language: 'en', playing: false } })).json()).lobby;
  const contexts: BrowserContext[] = [];
  try {
    for (const name of ['Anna', 'Bram', 'Cas', 'Dirk']) {
      const context = await browser.newContext({ baseURL, locale: 'en-GB', viewport: { width: 390, height: 844 } });
      contexts.push(context);
      expect((await context.request.post('/api/games/join', { data: { code: host.code, name } })).status()).toBe(201);
    }
    host = (await (await page.request.get('/api/session')).json()).lobby;
    host = (await (await page.request.post('/api/settings/commands', { data: { commandId: crypto.randomUUID(), expectedRevision: host.revision, roundId: null, openingProtection: 0, killCooldown: 0 } })).json()).lobby;
    expect(host.settings).toMatchObject({ openingProtection: 0, killCooldown: 0 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Start round', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Playing' })).toBeVisible();

    const round = (await (await page.request.get('/api/session')).json()).lobby as Lobby;
    const roles = await Promise.all(contexts.map(async context => (await (await context.request.get(`/api/role?roundId=${round.roundId}`)).json()).role as string));
    const impostor = contexts[roles.indexOf('impostor')];
    const crew = contexts.filter(context => context !== impostor);
    const names = await Promise.all(crew.map(async context => {
      const own = (await (await context.request.get('/api/session')).json()).lobby as Lobby;
      return own.players.find(player => player.id === own.you.id)!.name;
    }));

    const killer = await impostor.newPage();
    await killer.goto('/');
    await expect(killer.getByRole('heading', { name: 'Eliminate' })).toHaveCount(0);
    await killer.getByRole('button', { name: 'Reveal my role' }).click();
    await expect(killer.getByRole('heading', { name: 'Eliminate' })).toBeVisible();
    // The organiser can switch recording off and on; the revealed card follows live.
    await page.getByText('Record eliminations in the app', { exact: true }).click();
    await expect(killer.getByText('Eliminations are not recorded in the app right now. Just give the signal.')).toBeVisible();
    await expect(killer.getByRole('heading', { name: 'Eliminate' })).toHaveCount(0);
    await page.getByText('Record eliminations in the app', { exact: true }).click();
    await expect(killer.getByRole('heading', { name: 'Eliminate' })).toBeVisible();
    const victim = await crew[0].newPage();
    await victim.goto('/');
    const bystander = await crew[1].newPage();
    await bystander.goto('/');

    await killer.getByRole('button', { name: names[0], exact: true }).click();
    await expect(killer.getByRole('dialog', { name: `Eliminate ${names[0]}?` })).toBeVisible();
    expect((await new AxeBuilder({ page: killer }).analyze()).violations).toEqual([]);
    await killer.screenshot({ path: testInfo.outputPath('eliminate-confirm.png'), fullPage: true });
    await killer.getByRole('button', { name: 'Confirm elimination' }).click();
    await expect(killer.getByRole('dialog')).toHaveCount(0);
    await expect(killer.getByRole('button', { name: names[0], exact: true })).toHaveCount(0);

    await expect(victim.getByRole('heading', { name: 'You’ve been eliminated.' })).toBeVisible();
    await expect(victim.getByRole('heading', { name: 'Your tasks' })).toHaveCount(0);
    expect((await new AxeBuilder({ page: victim }).analyze()).violations).toEqual([]);
    await victim.screenshot({ path: testInfo.outputPath('body-mobile.png'), fullPage: true });
    // Nobody else learns about it.
    await expect(bystander.getByRole('heading', { name: 'Your tasks' })).toBeVisible();
    await expect(bystander.getByText('eliminated', { exact: false })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Playing' })).toBeVisible();

    // Two of three Crewmates out leaves one: the Impostor wins.
    await killer.getByRole('button', { name: names[1], exact: true }).click();
    await killer.getByRole('button', { name: 'Confirm elimination' }).click();
    await expect(page.getByRole('heading', { name: 'The Impostor got away with it.' })).toBeVisible();
    await expect(victim.getByRole('heading', { name: 'The Impostor got away with it.' })).toBeVisible();
  } finally { for (const context of contexts) await context.close(); }
});
