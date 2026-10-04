import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Lobby, PrintableStation, Task } from '../shared/protocol';

test('organiser edits stations and prints sheets; a player completes phone and codebook tasks', async ({ page, browser, baseURL }, testInfo) => {
  await page.goto('/');
  await page.getByText('EN', { exact: true }).click();
  await page.getByRole('tab', { name: 'Host a game' }).click();
  await page.getByRole('textbox', { name: 'Your name' }).fill('Organiser');
  await page.getByRole('button', { name: 'Create a lobby' }).click();
  await expect(page.getByRole('heading', { name: 'Task stations' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove Study', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove Study', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'New station' }).fill('Attic');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove Attic', exact: true })).toBeVisible();

  const print = await page.context().newPage();
  await print.goto('/print');
  await expect(print.getByRole('heading', { name: 'Attic' })).toBeVisible();
  await expect(print.getByRole('heading', { level: 2 })).toHaveCount(4);
  expect((await new AxeBuilder({ page: print }).analyze()).violations).toEqual([]);
  await print.screenshot({ path: testInfo.outputPath('station-sheets.png'), fullPage: true });
  const stations: PrintableStation[] = (await (await page.request.get('/api/stations/print')).json()).stations;

  const code = await page.locator('strong').first().innerText();
  const context = await browser.newContext({ baseURL, locale: 'en-GB', viewport: { width: 390, height: 844 } });
  try {
    expect((await context.request.post('/api/games/join', { data: { code, name: 'Guest' } })).status()).toBe(201);
    expect((await context.request.get('/api/stations/print')).status()).toBe(403);
    const guest = await context.newPage();
    await guest.goto('/');
    await page.getByRole('button', { name: 'Start round', exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'Your tasks' })).toBeVisible();
    await expect(guest.getByRole('button', { name: /^Open: / })).toHaveCount(4);
    expect((await new AxeBuilder({ page: guest }).analyze()).violations).toEqual([]);

    const lobby: Lobby = (await (await context.request.get('/api/session')).json()).lobby;
    const name = (task: Task) => lobby.stations.find(station => station.id === task.stationId)!.name;
    const order = lobby.you.tasks.find(task => task.puzzle.kind === 'order');
    if (order && order.puzzle.kind === 'order') {
      await guest.getByRole('button', { name: `Open: Number order, ${name(order)}` }).click();
      await expect(guest.getByRole('heading', { name: 'Number order' })).toBeFocused();
      const [smallest, ...rest] = [...order.puzzle.numbers].sort((a, b) => a - b);
      await guest.getByRole('button', { name: String(rest[0]), exact: true }).click();
      await expect(guest.getByText('Not quite. Start again from the smallest number.')).toBeVisible();
      for (const value of [smallest, ...rest]) await guest.getByRole('button', { name: String(value), exact: true }).click();
      await expect(guest.getByText('Task complete.')).toBeVisible();
    }
    const codebook = lobby.you.tasks.find(task => task.puzzle.kind === 'codebook');
    if (codebook && codebook.puzzle.kind === 'codebook') {
      const book = stations.find(station => station.id === codebook.stationId)!.codebook;
      await guest.getByRole('button', { name: `Open: Codebook, ${name(codebook)}` }).click();
      expect((await new AxeBuilder({ page: guest }).analyze()).violations).toEqual([]);
      await guest.screenshot({ path: testInfo.outputPath('codebook-task-mobile.png'), fullPage: true });
      await guest.getByRole('textbox', { name: 'Code' }).fill(codebook.puzzle.symbols.map(symbol => book[symbol]).join(''));
      await guest.getByRole('button', { name: 'Check code' }).click();
      await expect(guest.getByText('Task complete.')).toBeVisible();
    }
    await expect(guest.getByText('✓ Done')).toHaveCount([order, codebook].filter(Boolean).length);
    await guest.reload();
    await expect(guest.getByText('✓ Done')).toHaveCount([order, codebook].filter(Boolean).length);
  } finally { await context.close(); }
});
