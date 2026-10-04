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
