import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import QRCode from 'qrcode';
import type { Lobby, PrintableStation, Task } from '../shared/protocol';
import { mazeRoute } from './maze';

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

  await expect(page.getByRole('link', { name: 'Print materials' })).toHaveAttribute('href', '/print');
  const print = await page.context().newPage();
  await print.goto('/print');
  await expect(print.getByRole('heading', { name: 'Attic' })).toBeVisible();
  // Join poster, four station sheets and the markers page, each with QR codes where relevant.
  await expect(print.getByRole('heading', { level: 2 })).toHaveCount(6);
  await expect(print.getByRole('img', { name: /^TASK STATION: / })).toHaveCount(4);
  await expect(print.locator('[role=img] svg')).toHaveCount(5);
  // Tests run on 127.0.0.1, so QR codes use this computer's network address instead.
  await expect(print.getByText('This screen is open on “localhost”. QR codes and links use', { exact: false })).toBeVisible();
  await expect(print.locator('[class*=phoneAddress]')).toHaveText(/^http:\/\/(\d+\.){3}\d+:5174$/);
  await print.getByRole('checkbox', { name: 'Body and ghost markers' }).uncheck();
  await expect(print.getByRole('heading', { name: 'Body and ghost markers' })).toHaveCount(0);
  expect((await new AxeBuilder({ page: print }).analyze()).violations).toEqual([]);
  await print.screenshot({ path: testInfo.outputPath('station-sheets.png'), fullPage: true });
  const stations: PrintableStation[] = (await (await page.request.get('/api/stations/print')).json()).stations;

  const code = await page.locator('[class*=invite] strong').innerText();
  const context = await browser.newContext({ baseURL, locale: 'en-GB', viewport: { width: 390, height: 844 } });
  try {
    expect((await context.request.post('/api/games/join', { data: { code, name: 'Guest' } })).status()).toBe(201);
    expect((await context.request.get('/api/stations/print')).status()).toBe(403);
    const guest = await context.newPage();
    await guest.goto('/');
    await page.getByRole('button', { name: 'Start round', exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'Your tasks' })).toBeVisible();
    // QR-only by default: nothing opens from the list until a station is scanned.
    await expect(guest.getByRole('button', { name: /^Open: / })).toHaveCount(0);
    await expect(guest.getByText('Scan QR')).toHaveCount(4);
    expect((await new AxeBuilder({ page: guest }).analyze()).violations).toEqual([]);

    const lobby: Lobby = (await (await context.request.get('/api/session')).json()).lobby;
    const name = (task: Task) => lobby.stations.find(station => station.id === task.stationId)!.name;
    const kinds = { order: 'Number order', wires: 'Fix the wiring', codebook: 'Codebook', simon: 'Simon says', maze: 'Maze' };

    // In-app scanner: a photo of an unrelated QR code is rejected, a station code opens its task.
    const scanned = lobby.you.tasks.find(task => lobby.you.tasks.filter(other => other.stationId === task.stationId).length === 1)!;
    const photo = async (text: string) => ({ name: 'qr.png', mimeType: 'image/png', buffer: await QRCode.toBuffer(text, { width: 600 }) });
    await guest.getByRole('button', { name: 'Scan station QR' }).click();
    await expect(guest.getByRole('heading', { name: 'Scan station QR' })).toBeFocused();
    expect((await new AxeBuilder({ page: guest }).analyze()).violations).toEqual([]);
    await guest.locator('input[type=file]').setInputFiles(await photo('https://example.com/?station=not-a-station'));
    await expect(guest.getByText('That QR code isn’t a station in this game.')).toBeVisible();
    await guest.locator('input[type=file]').setInputFiles(await photo(`http://192.168.1.99:3001/?station=${scanned.stationId}`));
    await expect(guest.getByRole('heading', { name: kinds[scanned.puzzle.kind] })).toBeVisible();
    await guest.getByRole('button', { name: 'Back to tasks' }).click();

    // Scanning with the phone's own camera app opens the same task through a link.
    await guest.goto(`/?station=${scanned.stationId}`);
    await expect(guest.getByRole('heading', { name: kinds[scanned.puzzle.kind] })).toBeVisible();
    await expect(guest.getByText(`Do this task at · ${name(scanned)}`)).toBeVisible();
    expect(new URL(guest.url()).search).toBe('');
    await guest.getByRole('button', { name: 'Back to tasks' }).click();
    await expect(guest.getByRole('heading', { name: 'Your tasks' })).toBeVisible();
    await expect(guest.getByText(`You’re at ${name(scanned)}.`)).toBeVisible();
    await expect(guest.getByRole('button', { name: /^Open: / })).toHaveCount(1);

    // The organiser allows opening tasks without scanning.
    await page.getByText('Open tasks without scanning', { exact: true }).click();
    await expect(page.getByRole('switch', { name: 'Open tasks without scanning' })).toBeChecked();
    // Every task game starts on; the organiser can switch games off, but not the last one.
    const taskGames = page.getByRole('group', { name: 'Task games' }).getByRole('checkbox');
    await expect(taskGames).toHaveCount(5);
    for (const box of await taskGames.all()) await expect(box).toBeChecked();
    const others = ['Codebook', 'Number order', 'Fix the wiring', 'Simon says'];
    // Each box follows the saved settings, so it changes once the server has the change.
    for (const game of others) {
      await page.getByRole('checkbox', { name: game }).click();
      await expect(page.getByRole('checkbox', { name: game })).not.toBeChecked();
    }
    await expect(page.getByRole('checkbox', { name: 'Maze' })).toBeDisabled();
    for (const game of others) {
      await page.getByRole('checkbox', { name: game }).click();
      await expect(page.getByRole('checkbox', { name: game })).toBeChecked();
    }
    await expect(page.getByRole('checkbox', { name: 'Maze' })).toBeEnabled();
    await expect(guest.getByRole('button', { name: /^Open: / })).toHaveCount(4);
    await expect(guest.getByText('Scan QR')).toHaveCount(0);
    const order = lobby.you.tasks.find(task => task.puzzle.kind === 'order');
    if (order && order.puzzle.kind === 'order') {
      await guest.getByRole('button', { name: `Open: Number order, ${name(order)}` }).click();
      await expect(guest.getByRole('heading', { name: 'Number order' })).toBeFocused();
      const [smallest, ...rest] = [...order.puzzle.numbers].sort((a, b) => a - b);
      await guest.getByRole('button', { name: String(rest[0]), exact: true }).click();
      await expect(guest.getByText('Not quite. Start again from the smallest number.')).toBeVisible();
      for (const value of [smallest, ...rest]) await guest.getByRole('button', { name: String(value), exact: true }).click();
      await guest.screenshot({ path: testInfo.outputPath('lights-mobile.png'), fullPage: true });
      await expect(guest.getByText('Task complete.')).toBeVisible();
    }
    const codebook = lobby.you.tasks.find(task => task.puzzle.kind === 'codebook');
    if (codebook && codebook.puzzle.kind === 'codebook') {
      const book = stations.find(station => station.id === codebook.stationId)!.codebook;
      await guest.getByRole('button', { name: `Open: Codebook, ${name(codebook)}` }).click();
      expect((await new AxeBuilder({ page: guest }).analyze()).violations).toEqual([]);
      await guest.screenshot({ path: testInfo.outputPath('codebook-task-mobile.png'), fullPage: true });
      // Keyboard digits, a rejected code, then the keypad.
      await guest.keyboard.type('0000');
      await guest.keyboard.press('Enter');
      await expect(guest.getByText('That’s not right. Check the station sheet and try again.')).toBeVisible();
      await expect(guest.getByRole('status').filter({ hasText: '0 / 4' })).toBeVisible();
      for (const digit of codebook.puzzle.symbols.map(symbol => String(book[symbol]))) await guest.getByRole('button', { name: digit, exact: true }).click();
      await guest.getByRole('button', { name: 'Check code' }).click();
      await expect(guest.getByText('OPEN', { exact: true })).toBeVisible();
      await guest.screenshot({ path: testInfo.outputPath('codebook-open-mobile.png'), fullPage: true });
      await expect(guest.getByText('Task complete.')).toBeVisible();
    }
    const wires = lobby.you.tasks.find(task => task.puzzle.kind === 'wires');
    if (wires && wires.puzzle.kind === 'wires') {
      await guest.getByRole('button', { name: `Open: Fix the wiring, ${name(wires)}` }).click();
      const plugs = guest.getByRole('group', { name: 'Wires' });
      const sockets = guest.getByRole('group', { name: 'Sockets' });
      const label = (colour: string) => colour.charAt(0).toUpperCase() + colour.slice(1);
      const [first, ...rest] = wires.puzzle.left;
      // Keyboard: choose a wire, then its socket.
      await plugs.getByRole('button', { name: label(first), exact: true }).focus();
      await guest.keyboard.press('Enter');
      await expect(plugs.getByRole('button', { name: label(first), exact: true })).toHaveAttribute('aria-pressed', 'true');
      await sockets.getByRole('button', { name: label(first), exact: true }).focus();
      await guest.keyboard.press('Enter');
      await expect(sockets.getByRole('button', { name: `${label(first)}, connected` })).toBeVisible();
      // A wrong drop is rejected; the rest are dragged with the mouse.
      const wrong = wires.puzzle.right.find(colour => colour !== rest[0] && colour !== first)!;
      await plugs.getByRole('button', { name: label(rest[0]), exact: true }).dragTo(sockets.getByRole('button', { name: label(wrong), exact: true }));
      await expect(guest.getByText('Those colours don’t match. Try again.')).toBeVisible();
      await guest.screenshot({ path: testInfo.outputPath('wires-mobile.png'), fullPage: true });
      for (const colour of rest) await plugs.getByRole('button', { name: label(colour), exact: true }).dragTo(sockets.getByRole('button', { name: label(colour), exact: true }));
      await expect(guest.getByText('Task complete.')).toBeVisible();
    }
    const simon = lobby.you.tasks.find(task => task.puzzle.kind === 'simon');
    if (simon && simon.puzzle.kind === 'simon') {
      await guest.getByRole('button', { name: `Open: Simon says, ${name(simon)}` }).click();
      await expect(guest.getByRole('heading', { name: 'Simon says' })).toBeFocused();
      await guest.getByRole('button', { name: 'Start' }).click();
      const pads = guest.locator('[class*=simonPads]');
      for (let stage = 1; stage <= simon.puzzle.sequence.length; stage++) {
        await expect(guest.getByRole('status').filter({ hasText: `Your turn: 0 / ${stage}` })).toBeVisible({ timeout: 8000 });
        for (const pad of simon.puzzle.sequence.slice(0, stage)) await pads.getByRole('button', { name: ['Green', 'Red', 'Yellow', 'Blue'][pad], exact: true }).click();
      }
      await expect(guest.getByRole('listitem').filter({ hasText: 'Simon says' }).getByText('✓ Done')).toBeVisible();
    }
    const maze = lobby.you.tasks.find(task => task.puzzle.kind === 'maze');
    if (maze && maze.puzzle.kind === 'maze') {
      await guest.getByRole('button', { name: `Open: Maze, ${name(maze)}` }).click();
      await expect(guest.getByRole('heading', { name: 'Maze' })).toBeFocused();
      const controls = guest.getByRole('group', { name: 'Move' });
      for (const move of mazeRoute(maze.puzzle)) await controls.getByRole('button', { name: ['Up', 'Right', 'Down', 'Left'][move] }).click();
      await expect(guest.getByRole('listitem').filter({ hasText: 'Maze' }).getByText('✓ Done')).toBeVisible();
    }
    // Four tasks, each a different game.
    await expect(guest.getByText('✓ Done')).toHaveCount(4);
    await guest.reload();
    await expect(guest.getByText('✓ Done')).toHaveCount(4);
  } finally { await context.close(); }
});
