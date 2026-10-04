import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('English and Dutch persist, invitations join live, and refresh restores each identity', async ({ page, browser }) => {
  await page.goto('/');
  await page.getByText('NL', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'nl');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Verzamel je team.' })).toBeVisible();
  await page.getByRole('tab', { name: 'Spel organiseren' }).click();
  await page.getByRole('textbox', { name: 'Je naam' }).fill('Jesse');
  await page.getByRole('button', { name: 'Maak een lobby' }).click();
  await expect(page.getByRole('heading', { name: 'Het team komt samen.' })).toBeVisible();
  const code = await page.locator('[class*=invite] strong').innerText();
  const guestContext = await browser.newContext({ locale: 'en-GB' });
  const guest = await guestContext.newPage();
  await guest.goto(`/?code=${code}`);
  await guest.getByRole('textbox', { name: 'Your name' }).fill('Alex');
  await guest.getByRole('button', { name: 'Join the crew' }).click();
  await expect(guest.getByRole('heading', { name: 'The crew is assembling.' })).toBeVisible();
  await expect(page.getByText('Alex', { exact: true })).toBeVisible();
  await expect(guest.getByText('Alex', { exact: false })).toContainText('you');
  await page.reload();
  await expect(page.getByText('Jesse', { exact: false })).toContainText('jij');
  await expect(page.getByText('Live verbonden', { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await guestContext.close();
});

test('mobile entry is accessible and translates validation errors', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/');
  await page.getByText('EN', { exact: true }).click();
  await page.getByRole('button', { name: 'Join the crew' }).click();
  await expect(page.getByRole('alert')).toContainText('Enter a name');
  await page.getByRole('radio', { name: 'English' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('alert')).toContainText('Vul een naam');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('a host-only organiser shows a join QR code and runs the round without a role', async ({ page, browser, baseURL }) => {
  await page.goto('/');
  await page.getByText('EN', { exact: true }).click();
  await page.getByRole('tab', { name: 'Host a game' }).click();
  await expect(page.getByRole('radio', { name: /Just host on this screen/ })).toBeChecked();
  await page.getByRole('textbox', { name: 'Your name' }).fill('Laptop');
  await page.getByRole('button', { name: 'Create a lobby' }).click();
  const code = await page.locator('[class*=invite] strong').innerText();
  await expect(page.getByRole('img', { name: `Scan to join: ${code}` })).toBeVisible();
  await expect(page.getByText('Host', { exact: true })).toBeVisible();
  await expect(page.getByText('0 / 8', { exact: true })).toBeVisible();
  const context = await browser.newContext({ baseURL });
  try {
    expect((await context.request.post('/api/games/join', { data: { code, name: 'Phone' } })).status()).toBe(201);
    await expect(page.getByText('1 / 8', { exact: true })).toBeVisible();
    await page.getByText('Room management', { exact: true }).click();
    await page.getByRole('button', { name: 'Add test player' }).click();
    await page.getByRole('button', { name: 'Add test player' }).click();
    await expect(page.getByText('3 / 8', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove Test 2', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Start round', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Playing' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your secret role' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Your tasks' })).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    const guest = await context.newPage();
    await guest.goto('/');
    await expect(guest.getByRole('heading', { name: 'Your secret role' })).toBeVisible();
    // Test players are Crewmates, so the only real phone is the Impostor.
    await guest.getByRole('button', { name: 'Reveal my role' }).click();
    await expect(guest.getByRole('heading', { name: 'Impostor', exact: true })).toBeVisible();
  } finally { await context.close(); }
});
