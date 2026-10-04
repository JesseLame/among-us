import type { Page } from '@playwright/test';

// Press and hold a hold-to-confirm button long enough for it to fill.
export async function hold(page: Page, name: string) {
  await page.getByRole('button', { name }).hover();
  await page.mouse.down();
  await page.waitForTimeout(1800);
  await page.mouse.up();
}
