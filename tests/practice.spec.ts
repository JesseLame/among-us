import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.use({ viewport: { width: 375, height: 812 } });

test('practice page plays every task game without a room, in both languages', async ({ page }) => {
  const solvedNote = page.getByText('Solved! The server accepted this answer.');
  await page.goto('/');
  await page.getByText('EN', { exact: true }).click();
  await page.getByRole('link', { name: 'Practise the task games' }).click();
  await expect(page.getByRole('heading', { name: 'Try the task games' })).toBeVisible();
  const games = page.getByRole('navigation', { name: 'Task games' }).getByRole('button');
  await expect(games).toHaveText(['Codebook', 'Number order', 'Fix the wiring']);

  // Codebook: read the practice sheet and key in the numbers.
  await expect(page.getByRole('heading', { name: 'Codebook', level: 2 })).toBeVisible();
  await page.getByText('Practice station sheet').click();
  const slots = page.getByRole('list', { name: 'Code' }).getByRole('listitem');
  await expect(slots).toHaveCount(4);
  for (const name of await slots.locator('small').allInnerTexts()) {
    const entry = page.locator('[class*=practiceSheet] dl > div').filter({ has: page.getByText(name, { exact: true }) });
    await page.locator(`[data-key="${await entry.locator('dd').innerText()}"]`).click();
  }
  await page.getByRole('button', { name: 'Check code' }).click();
  await expect(solvedNote).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // Number order: tap the lights from low to high.
  await games.getByText('Number order').click();
  await expect(page).toHaveURL(/game=order/);
  await expect(page.getByRole('heading', { name: 'Number order', level: 2 })).toBeVisible();
  const lights = page.locator('[class*=lightBoard] button');
  await expect(lights).toHaveCount(6);
  const values = (await lights.allInnerTexts()).map(Number).sort((a, b) => a - b);
  for (const value of values) await lights.getByText(String(value), { exact: true }).click();
  await expect(solvedNote).toBeVisible();
  await page.getByRole('button', { name: 'Next puzzle' }).click();
  await expect(solvedNote).toHaveCount(0);
  await expect(lights).toHaveCount(6);

  // Wiring: select each wire, then the socket of the same colour.
  await games.getByText('Fix the wiring').click();
  const wires = page.getByRole('group', { name: 'Wires' }).getByRole('button');
  await expect(wires).toHaveCount(4);
  for (const colour of await wires.allInnerTexts()) {
    await page.getByRole('group', { name: 'Wires' }).getByRole('button', { name: colour, exact: true }).press('Enter');
    await page.getByRole('group', { name: 'Sockets' }).getByRole('button', { name: colour, exact: true }).click();
  }
  await expect(solvedNote).toBeVisible();

  // Deep links and Dutch.
  await page.goto('/practice?game=wires');
  await page.getByText('NL', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Probeer de taakspellen' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Draden verbinden', level: 2 })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  // Practice never creates a room.
  expect((await (await page.request.get('/api/session')).json()).lobby).toBeNull();
});
