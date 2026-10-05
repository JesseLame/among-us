import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('the organiser adds Security, a scan is reported, and Security opens the live view once', async ({ page, browser, baseURL }, testInfo) => {
  await page.request.post('/api/games', { data: { name: 'Laptop', language: 'en', playing: false } });
  await page.goto('/');
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole('heading', { name: 'Extra roles' })).toBeVisible();
  // The checkbox follows the server's reply, so click and wait rather than check().
  await page.getByRole('checkbox', { name: /^Security/ }).click();
  await expect(page.getByRole('checkbox', { name: /^Security/ })).toBeChecked();
  const length = page.getByRole('textbox', { name: 'Live view length (seconds)' });
  await expect(length).toHaveValue('15');
  await length.fill('10');
  await length.blur();
  await expect.poll(async () => (await (await page.request.get('/api/session')).json()).lobby.settings).toMatchObject({ roles: ['security'], securityTime: 10 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  const code = (await (await page.request.get('/api/session')).json()).lobby.code;
  const contexts = [];
  try {
    for (let index = 1; index <= 4; index++) {
      const context = await browser.newContext({ baseURL, locale: 'en-GB' });
      contexts.push(context);
      expect((await context.request.post('/api/games/join', { data: { code, name: `Guest ${index}` } })).status()).toBe(201);
    }
    await page.getByRole('button', { name: 'Start round', exact: true }).click();
    const lobby = (await (await contexts[0].request.get('/api/session')).json()).lobby;
    const roles = await Promise.all(contexts.map(async context => (await (await context.request.get(`/api/role?roundId=${lobby.roundId}`)).json()).role));
    const security = contexts[roles.indexOf('security')];
    const otherIndex = roles.findIndex(role => role !== 'security');
    expect(roles.filter(role => role === 'security')).toHaveLength(1);

    // Another player scans the first station's QR code, which opens the app at that station.
    const scanner = await contexts[otherIndex].newPage();
    await scanner.goto(`/?station=${lobby.stations[0].id}`);
    await expect(scanner.getByRole('heading', { name: 'Your secret role' })).toBeVisible();

    const phone = await security.newPage();
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.goto('/');
    await phone.getByRole('button', { name: 'Reveal my role', exact: true }).click();
    await expect(phone.getByRole('heading', { name: 'Security', exact: true })).toBeVisible();
    await phone.getByRole('button', { name: 'Open live view', exact: true }).click();
    await expect(phone.getByRole('dialog', { name: 'Open the live view?' })).toBeVisible();
    await phone.getByRole('button', { name: 'Open it', exact: true }).click();
    const row = phone.getByRole('row', { name: new RegExp(`Guest ${otherIndex + 1}`) });
    await expect(row).toContainText(lobby.stations[0].name);
    await expect(phone.getByRole('timer')).toContainText('Closes in');
    expect((await new AxeBuilder({ page: phone }).analyze()).violations).toEqual([]);
    await phone.screenshot({ path: testInfo.outputPath('security-live-view-mobile.png'), fullPage: true });
    await expect(phone.getByText('You have used your live view this round.', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(phone.getByRole('button', { name: 'Open live view', exact: true })).toHaveCount(0);
  } finally { for (const context of contexts) await context.close(); }
});
