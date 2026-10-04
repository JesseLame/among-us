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
  const code = await page.locator('strong').innerText();
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
