import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('each device chooses its own look, which persists and never reaches printed sheets', async ({ page, browser, baseURL }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/');
  await page.getByText('EN', { exact: true }).click();
  const html = page.locator('html');
  const looks = page.getByRole('radiogroup', { name: 'Look' });
  await looks.getByTitle('Classic').click();
  await expect(html).toHaveAttribute('data-theme', 'classic');

  // Arrow keys move between looks like any radio group.
  await looks.getByRole('radio', { name: 'Classic' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(looks.getByRole('radio', { name: 'Space' })).toBeChecked();
  await expect(html).toHaveAttribute('data-theme', 'space');
  const toolbar = page.locator('meta[name="theme-color"]');
  await expect(toolbar).toHaveAttribute('content', await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-page').trim()));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('space-home-mobile.png'), fullPage: true });

  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'space');
  await expect(page.getByRole('radio', { name: 'Space' })).toBeChecked();
  await page.goto('/print');
  await expect(html).toHaveAttribute('data-theme', 'classic');
  await expect(page.getByRole('radiogroup', { name: 'Look' })).toHaveCount(0);

  // Another phone keeps its own choice.
  const other = await browser.newContext({ baseURL, locale: 'en-GB', storageState: undefined });
  try {
    const phone = await other.newPage();
    await phone.addInitScript(() => localStorage.removeItem('home-theme'));
    await phone.goto('/');
    await expect(phone.locator('html')).not.toHaveAttribute('data-theme', 'space');
  } finally { await other.close(); }
});

test('a player can change the look from the private role card', async ({ page, browser, baseURL }, testInfo) => {
  await page.request.post('/api/games', { data: { name: 'Organiser' } });
  await page.goto('/');
  await page.getByText('EN', { exact: true }).click();
  const code = await page.locator('[class*=invite] strong').innerText();
  const context = await browser.newContext({ baseURL, locale: 'en-GB', viewport: { width: 390, height: 844 } });
  try {
    expect((await context.request.post('/api/games/join', { data: { code, name: 'Guest' } })).status()).toBe(201);
    const guest = await context.newPage();
    await guest.goto('/');
    await page.getByRole('button', { name: 'Start round', exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'Your secret role' })).toBeVisible();
    await guest.getByRole('radiogroup', { name: 'Look' }).getByTitle('Space').click();
    await expect(guest.locator('html')).toHaveAttribute('data-theme', 'space');
    await guest.getByRole('button', { name: 'Reveal my role', exact: true }).click();
    await expect(guest.getByRole('heading', { name: /^(Crewmate|Impostor)$/ })).toBeVisible();
    expect((await new AxeBuilder({ page: guest }).analyze()).violations).toEqual([]);
    await guest.screenshot({ path: testInfo.outputPath('space-role-mobile.png'), fullPage: true });
  } finally { await context.close(); }
});
