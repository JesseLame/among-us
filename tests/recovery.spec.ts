import { test, expect, type BrowserContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Lobby } from '../shared/protocol';

test('the organiser fixes a broken station, rejoins a lost player, and declares a winner', async ({ page, browser, baseURL }, testInfo) => {
  const host: Lobby = (await (await page.request.post('/api/games', { data: { name: 'Laptop', language: 'en', playing: false } })).json()).lobby;
  const contexts: BrowserContext[] = [];
  try {
    for (const name of ['Anna', 'Bram', 'Cas']) {
      const context = await browser.newContext({ baseURL, locale: 'en-GB', viewport: { width: 390, height: 844 } });
      contexts.push(context);
      await context.request.post('/api/games/join', { data: { code: host.code, name } });
    }
    await page.goto('/');
    await page.getByText('Open tasks without scanning', { exact: true }).click();
    await page.getByRole('button', { name: 'Start round', exact: true }).click();
    const anna = await contexts[0].newPage();
    await anna.goto('/');
    await expect(anna.getByRole('button', { name: /^Open: .*, Kitchen$/ })).toHaveCount(1);

    // A broken station: remove its tasks for everyone.
    await page.getByText('Fix a problem', { exact: true }).click();
    await page.getByRole('combobox', { name: 'Station', exact: true }).selectOption({ label: 'Kitchen' });
    await page.getByRole('button', { name: 'Remove its tasks' }).click();
    await expect(page.getByRole('dialog', { name: 'Remove its tasks: Kitchen?' })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('Done. Every phone has been updated.')).toBeVisible();
    await expect(anna.getByText('Kitchen', { exact: true })).toHaveCount(0);

    // Anna's phone is lost: a rejoin QR code puts a new browser in her place.
    await page.getByText('Room management', { exact: true }).click();
    await page.getByRole('button', { name: 'Rejoin: Anna' }).click();
    await expect(page.getByRole('img', { name: 'Rejoin as Anna' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('rejoin-host.png'), fullPage: true });
    const link = (await page.getByRole('dialog').locator('strong').innerText()).replace(/^https?:\/\/[^/]+/, '');
    const replacement = await browser.newContext({ baseURL, locale: 'en-GB' });
    contexts.push(replacement);
    const newPhone = await replacement.newPage();
    await newPhone.goto(link);
    await expect(newPhone.getByRole('heading', { name: 'Your secret role' })).toBeVisible();
    const restored = (await (await replacement.request.get('/api/session')).json()).lobby as Lobby;
    expect(restored.players.find(player => player.id === restored.you.id)!.name).toBe('Anna');
    await expect(anna.getByText('Your previous room is no longer available', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    // End with a declared winner.
    await page.getByRole('button', { name: 'End round…' }).click();
    await page.getByRole('radio', { name: 'The crew wins' }).check();
    await page.getByRole('button', { name: 'End and reveal roles' }).click();
    await expect(newPhone.getByText('The organiser declared a crew win.', { exact: false })).toBeVisible();
  } finally { for (const context of contexts) await context.close(); }
});

test('organiser help: previews, replacing tasks, undo and confirming a detected win', async ({ page, browser, baseURL }, testInfo) => {
  const host: Lobby = (await (await page.request.post('/api/games', { data: { name: 'Laptop', language: 'en', playing: false } })).json()).lobby;
  const contexts: BrowserContext[] = [];
  try {
    for (const name of ['Anna', 'Bram', 'Cas']) {
      const context = await browser.newContext({ baseURL, locale: 'en-GB', viewport: { width: 390, height: 844 } });
      contexts.push(context);
      await context.request.post('/api/games/join', { data: { code: host.code, name } });
    }
    await page.goto('/');
    await page.getByText('Open tasks without scanning', { exact: true }).click();
    await page.getByText('Confirm wins before they end the round', { exact: true }).click();
    await expect(page.getByText('On: when the app detects a win', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Start round', exact: true }).click();
    const anna = await contexts[0].newPage();
    await anna.goto('/');
    await expect(anna.getByRole('button', { name: /^Open: .*, Kitchen$/ })).toHaveCount(1);

    // Replace the Kitchen tasks: the preview says the round continues, and the change can be undone.
    await page.getByText('Fix a problem', { exact: true }).click();
    await page.getByRole('combobox', { name: 'Station', exact: true }).selectOption({ label: 'Kitchen' });
    await page.getByRole('button', { name: 'Replace with new tasks' }).click();
    const replace = page.getByRole('dialog', { name: 'Replace with new tasks: Kitchen?' });
    await expect(replace.getByText('The round continues.')).toBeVisible();
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(anna.getByRole('button', { name: /^Open: .*, Kitchen$/ })).toHaveCount(0);
    await expect(anna.getByRole('button', { name: /^Open: / })).toHaveCount(4);
    await expect(page.getByText('Tasks replaced at Kitchen')).toBeVisible();
    await page.getByRole('button', { name: 'Undo: Tasks replaced at Kitchen' }).click();
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('undone', { exact: true })).toBeVisible();
    await expect(anna.getByRole('button', { name: /^Open: .*, Kitchen$/ })).toHaveCount(1);

    // Marking the Impostor out: the preview warns, then play stops for the organiser to confirm.
    const roles = await Promise.all(contexts.map(async context => {
      const lobby = (await (await context.request.get('/api/session')).json()).lobby as Lobby;
      return { name: lobby.players.find(player => player.id === lobby.you.id)!.name, role: (await (await context.request.get(`/api/role?roundId=${lobby.roundId}`)).json()).role };
    }));
    const impostor = roles.find(entry => entry.role === 'impostor')!.name;
    await page.getByRole('combobox', { name: 'Player', exact: true }).selectOption({ label: impostor });
    await page.getByRole('button', { name: 'Mark as out' }).click();
    await expect(page.getByRole('dialog').getByText('This stops play so you can confirm a result.')).toBeVisible();
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('heading', { name: 'The app detected a result: The crew wins' })).toBeVisible();
    await expect(anna.getByText('The organiser is checking the result.')).toBeVisible();
    await expect(anna.getByText('The crew wins')).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('proposal-host.png'), fullPage: true });
    await page.getByRole('button', { name: 'Confirm and reveal roles' }).click();
    await expect(anna.getByRole('heading', { name: 'The crew did it.' })).toBeVisible();
  } finally { for (const context of contexts) await context.close(); }
});
