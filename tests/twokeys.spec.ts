import { test, expect, type Browser, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Lobby } from '../shared/protocol';

test.use({ viewport: { width: 375, height: 812 } });

async function join(browser: Browser, baseURL: string | undefined, code: string, name: string) {
  const context = await browser.newContext({ baseURL, locale: 'en-GB', viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  await page.goto(`/?code=${code}`);
  await page.getByRole('textbox', { name: 'Your name' }).fill(name);
  await page.getByRole('button', { name: 'Join the crew', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'The crew is assembling.' })).toBeVisible();
  return page;
}
const lobbyOf = async (page: Page): Promise<Lobby> => (await (await page.request.get('/api/session')).json()).lobby;

test('two players finish a two-keys task together: one shows the pairing code, the other reads out the unlock code', async ({ page, browser, baseURL }) => {
  await page.goto('/');
  await page.getByText('EN', { exact: true }).click();
  await page.getByRole('tab', { name: 'Host a game' }).click();
  await page.getByRole('textbox', { name: 'Your name' }).fill('Organiser');
  await page.getByRole('button', { name: 'Create a lobby' }).click();
  const code = await page.locator('[class*=invite] strong').innerText();
  const alex = await join(browser, baseURL, code, 'Alex');
  const sam = await join(browser, baseURL, code, 'Sam');
  // A third player keeps two Crewmates in the round, so it is not an instant Impostor win.
  const robin = await join(browser, baseURL, code, 'Robin');
  try {
    // Only two-keys tasks, opened from the list.
    for (const game of ['Codebook', 'Number order', 'Fix the wiring', 'Simon says', 'Maze', 'Open waterways', 'Delivery']) {
      await page.getByRole('checkbox', { name: game }).click();
      await expect(page.getByRole('checkbox', { name: game })).not.toBeChecked();
    }
    await page.getByText('Open tasks without scanning', { exact: true }).click();
    await expect(page.getByRole('switch', { name: 'Open tasks without scanning' })).toBeChecked();
    await page.getByRole('button', { name: 'Start round', exact: true }).click();

    const [task] = (await lobbyOf(alex)).you.tasks;
    if (task.puzzle.kind !== 'twokeys') throw new Error('Expected two keys');
    await alex.getByRole('button', { name: /^Open: Two keys/ }).first().click();
    await expect(alex.getByRole('heading', { name: 'Two keys' })).toBeFocused();
    await expect(alex.getByText(task.puzzle.pair, { exact: true })).toBeVisible();
    expect((await new AxeBuilder({ page: alex }).analyze()).violations).toEqual([]);

    // Sam helps: their own code is refused, Alex's code shows the unlock code.
    await sam.getByRole('button', { name: 'Help someone' }).click();
    await expect(sam.getByRole('heading', { name: 'Help someone' })).toBeFocused();
    const own = (await lobbyOf(sam)).you.tasks[0].puzzle;
    if (own.kind !== 'twokeys') throw new Error('Expected two keys');
    await sam.getByRole('textbox', { name: 'Their pairing code' }).fill(own.pair.toLowerCase());
    await sam.getByRole('button', { name: 'Show unlock code' }).click();
    await expect(sam.getByText('That’s your own task. Someone else has to help you.')).toBeVisible();
    await sam.getByRole('textbox', { name: 'Their pairing code' }).fill(task.puzzle.pair);
    await sam.getByRole('button', { name: 'Show unlock code' }).click();
    await expect(sam.getByText('Read this code out to them.')).toBeVisible();
    expect((await new AxeBuilder({ page: sam }).analyze()).violations).toEqual([]);
    const unlock = await sam.locator('[class*=unlockCode] span').innerText();
    expect(unlock).toMatch(/^\d{4}$/);

    await alex.getByRole('textbox', { name: 'Unlock code' }).fill(unlock);
    await alex.getByRole('button', { name: 'Check code' }).click();
    await expect(alex.getByText('Task complete.')).toBeVisible();
    await sam.getByRole('button', { name: 'Back to tasks' }).click();
    await expect(sam.getByRole('heading', { name: 'Your tasks' })).toBeFocused();
  } finally {
    await alex.context().close();
    await sam.context().close();
    await robin.context().close();
  }
});
