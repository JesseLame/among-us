import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('organiser removes a player and deletes the room with bilingual confirmations', async ({ page, browser, baseURL }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByText('NL', { exact: true }).click();
  await page.getByRole('tab', { name: 'Spel organiseren' }).click();
  await page.getByRole('textbox', { name: 'Je naam' }).fill('Jesse');
  await page.getByRole('button', { name: 'Maak een lobby', exact: true }).click();
  const code = await page.locator('strong').innerText();
  const guestContext = await browser.newContext({ baseURL, locale: 'en-GB' });
  const offlineContext = await browser.newContext({ baseURL, locale: 'en-GB' });
  try {
    const guest = await guestContext.newPage();
    await guest.goto(`/?code=${code}`);
    await guest.getByRole('textbox', { name: 'Your name' }).fill('Alex');
    await guest.getByRole('button', { name: 'Join the crew', exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'The crew is assembling.' })).toBeVisible();
    await expect(guest.getByText('Room management', { exact: true })).toHaveCount(0);
    await page.getByText('Kamerbeheer', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Verwijder Jesse', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Verwijder Alex', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Verwijder Alex?' })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole('button', { name: 'Annuleren', exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'The crew is assembling.' })).toBeVisible();
    await page.getByRole('button', { name: 'Verwijder Alex', exact: true }).click();
    await page.getByRole('button', { name: 'Verwijder speler', exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'Get the crew together.' })).toBeVisible();
    await expect(guest.getByRole('status')).toContainText('The organiser removed you');
    await expect(guest.getByRole('textbox', { name: 'Game code' })).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Verwijder Alex', exact: true })).toHaveCount(0);
    await guest.reload();
    await expect(guest.getByRole('heading', { name: 'Get the crew together.' })).toBeVisible();

    // Rejoining uses a new player identity and remains possible in an open lobby.
    await guest.getByRole('textbox', { name: 'Your name' }).fill('Alex');
    await guest.getByRole('textbox', { name: 'Game code' }).fill(code);
    await guest.getByRole('button', { name: 'Join the crew', exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'The crew is assembling.' })).toBeVisible();
    await offlineContext.request.post('/api/games/join', { data: { code, name: 'Offline guest' } });
    const offline = await offlineContext.newPage();
    await offline.goto('/');
    await expect(offline.getByText('Live connection', { exact: true })).toBeVisible();
    await offlineContext.setOffline(true);
    await expect(offline.getByText('Reconnecting…', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Verwijder kamer…', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Deze kamer voor iedereen verwijderen?' })).toBeVisible();
    await page.getByRole('button', { name: 'Annuleren', exact: true }).click();
    await page.getByText('EN', { exact: true }).click();
    await page.getByRole('button', { name: 'Delete room…', exact: true }).click();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('delete-room-mobile.png'), fullPage: true });
    await page.getByRole('button', { name: 'Delete room for everyone', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Get the crew together.' })).toBeVisible();
    await expect(guest.getByRole('status')).toContainText('The organiser deleted the room');
    await offlineContext.setOffline(false);
    await expect(offline.getByRole('heading', { name: 'Get the crew together.' })).toBeVisible({ timeout: 15000 });
    await expect(offline.getByRole('status')).toContainText('no longer available');
    await page.getByRole('tab', { name: 'Host a game', exact: true }).click();
    await page.getByRole('textbox', { name: 'Your name' }).fill('Jesse');
    await page.getByRole('button', { name: 'Create a lobby', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'The crew is assembling.' })).toBeVisible();
  } finally { await guestContext.close(); await offlineContext.close(); }
});

test('an organiser can remove a player during a round without revealing their role beforehand', async ({ page, browser, baseURL }) => {
  const host = await page.request.post('/api/games', { data: { name: 'Host' } });
  const { lobby } = await host.json();
  const guestContext = await browser.newContext({ baseURL, locale: 'en-GB' });
  try {
    await guestContext.request.post('/api/games/join', { data: { code: lobby.code, name: 'Guest' } });
    const guest = await guestContext.newPage();
    await page.goto('/'); await guest.goto('/');
    await page.getByText('EN', { exact: true }).click();
    await page.getByRole('button', { name: 'Start round', exact: true }).click();
    await expect(guest.getByRole('button', { name: 'Reveal my role', exact: true })).toBeVisible();
    await guest.getByRole('button', { name: 'Reveal my role', exact: true }).click();
    await expect(guest.getByRole('button', { name: 'Hide my role', exact: true })).toBeVisible();
    await page.getByText('Room management', { exact: true }).click();
    await page.getByRole('button', { name: 'Remove Guest', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toContainText('Impostor');
    await expect(page.getByRole('dialog')).not.toContainText('Crewmate');
    await page.getByRole('button', { name: 'Remove player', exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'Get the crew together.' })).toBeVisible();
    await expect(guest.getByRole('heading', { name: /^(Crewmate|Impostor)$/ })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /^(Hold that thought\.|The secret’s out\.)$/ })).toBeVisible();
  } finally { await guestContext.close(); }
});
