import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('six players start, privately reveal, pause, end, and prepare another round', async ({ page, browser, baseURL }, testInfo) => {
  await page.goto('/');
  await page.getByText('NL', { exact: true }).click();
  await page.getByRole('tab', { name: 'Spel organiseren' }).click();
  await page.getByRole('textbox', { name: 'Je naam' }).fill('Organisator');
  await page.getByRole('button', { name: 'Maak een lobby' }).click();
  await expect(page.getByRole('button', { name: 'Start de ronde', exact: true })).toBeEnabled();
  await expect(page.getByText('Je kunt met 1–5 spelers starten om te testen.', { exact: false })).toBeVisible();
  const code = await page.locator('strong').innerText();
  const contexts = [];
  try {
    for (let index = 1; index <= 5; index++) {
      const context = await browser.newContext({ baseURL, locale: 'en-GB' });
      contexts.push(context);
      expect((await context.request.post('/api/games/join', { data: { code, name: `Guest ${index}` } })).status()).toBe(201);
    }
    const guest = await contexts[0].newPage();
    await guest.setViewportSize({ width: 390, height: 844 });
    await guest.goto('/');
    await expect(page.getByRole('button', { name: 'Start de ronde', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Start de ronde', exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'Your secret role' })).toBeVisible();
    await expect(guest.getByRole('button', { name: 'Pause round', exact: true })).toHaveCount(0);
    await expect(guest.getByRole('heading', { name: /^(Crewmate|Impostor)$/ })).toHaveCount(0);
    const state = (await (await contexts[0].request.get('/api/session')).json()).lobby;
    expect(JSON.stringify(state)).not.toMatch(/crewmate|impostor|"role"|revealedRoles/);
    await guest.getByRole('button', { name: 'Reveal my role', exact: true }).click();
    const ownRole = await guest.getByRole('heading', { name: /^(Crewmate|Impostor)$/ }).innerText();
    expect((await new AxeBuilder({ page: guest }).analyze()).violations).toEqual([]);
    await guest.screenshot({ path: testInfo.outputPath('private-role-mobile.png'), fullPage: true });
    await guest.getByRole('button', { name: 'Hide my role', exact: true }).click();
    await expect(guest.getByRole('heading', { name: /^(Crewmate|Impostor)$/ })).toHaveCount(0);
    await guest.getByRole('button', { name: 'Reveal my role', exact: true }).click();
    await expect(guest.getByRole('heading', { name: ownRole, exact: true })).toBeVisible();
    await guest.reload();
    await expect(guest.getByRole('button', { name: 'Reveal my role', exact: true })).toBeVisible();
    await expect(guest.getByRole('heading', { name: ownRole, exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Pauzeer de ronde', exact: true }).click();
    await expect(guest.getByText('Round paused. Wait for the organiser.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Hervat de ronde', exact: true }).click();
    await expect(guest.getByText('Round paused. Wait for the organiser.', { exact: true })).toHaveCount(0);
    await expect(guest.getByRole('heading', { name: 'Your secret role' })).toBeVisible();
    await guest.getByRole('button', { name: 'Reveal my role', exact: true }).click();
    await expect(guest.getByRole('heading', { name: ownRole, exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Beëindig de ronde…', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Stoppen en alle rollen tonen?' })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('end-round-dialog.png'), fullPage: true });
    await page.getByRole('button', { name: 'Bewaar deze ronde', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(guest.getByRole('heading', { name: 'Your secret role' })).toBeVisible();
    await page.getByRole('button', { name: 'Beëindig de ronde…', exact: true }).click();
    await page.getByRole('button', { name: 'Stop en toon de rollen', exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'The secret’s out.' })).toBeVisible();
    await expect(guest.getByText('Impostor', { exact: true })).toHaveCount(1);
    await expect(guest.getByText('Crewmate', { exact: true })).toHaveCount(5);
    await page.getByRole('button', { name: 'Bereid een nieuwe ronde voor', exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'The crew is assembling.' })).toBeVisible();
    await expect(guest.getByText('Impostor', { exact: true })).toHaveCount(0);
    await expect(page.getByText('6 / 8', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Start de ronde', exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'Your secret role' })).toBeVisible();
    const nextState = (await (await contexts[0].request.get('/api/session')).json()).lobby;
    expect(nextState.roundId).not.toBe(state.roundId);
  } finally { for (const context of contexts) await context.close(); }
});

test('a solo tester can start, and a late role response stays hidden after leaving the screen', async ({ page }) => {
    await page.request.post('/api/games', { data: { name: 'Solo tester' } });
    await page.goto('/');
    await page.getByText('EN', { exact: true }).click();
    await page.getByRole('button', { name: 'Start round', exact: true }).click();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/role?*', async route => { const response = await route.fetch(); await gate; await route.fulfill({ response }); });
    const responseReceived = page.waitForResponse('**/api/role?*');
    await page.getByRole('button', { name: 'Reveal my role', exact: true }).click();
    // Simulate the browser's blur event while the role response is in flight.
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    release(); await responseReceived;
    await expect(page.getByRole('button', { name: 'Reveal my role', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^(Crewmate|Impostor)$/ })).toHaveCount(0);
});
