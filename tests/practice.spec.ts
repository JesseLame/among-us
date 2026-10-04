import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mazeStep, type TaskPuzzle } from '../shared/protocol';
import { mazeRoute, waterwaysTurns } from '../server/test/solvers';

test.use({ viewport: { width: 375, height: 812 } });

test('practice page plays every task game without a room, in both languages', async ({ page }) => {
  const solvedNote = page.getByText('Solved! The server accepted this answer.');
  // The Next puzzle button fades to its solved colour; check contrast once it has.
  const settled = () => page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished)));
  await page.goto('/');
  await page.getByText('EN', { exact: true }).click();
  await page.getByRole('link', { name: 'Practise the task games' }).click();
  await expect(page.getByRole('heading', { name: 'Try the task games' })).toBeVisible();
  const games = page.getByRole('navigation', { name: 'Task games' }).getByRole('button');
  await expect(games).toHaveText(['Codebook', 'Number order', 'Fix the wiring', 'Simon says', 'Maze', 'Open waterways']);

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
  await settled();
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

  // Simon says: watch each round, then repeat it. A wrong pad replays the same round.
  const loaded = page.waitForResponse(response => response.url().endsWith('/api/practice/simon'));
  await games.getByText('Simon says').click();
  const { puzzle } = await (await loaded).json() as { puzzle: { sequence: number[] } };
  const pads = ['Green', 'Red', 'Yellow', 'Blue'];
  const board = page.locator('[class*=simonPads]');
  const yourTurn = page.getByRole('status').filter({ hasText: 'Your turn' });
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(yourTurn).toHaveText('Your turn: 0 / 1', { timeout: 5000 });
  await board.getByRole('button', { name: pads[(puzzle.sequence[0] + 1) % 4], exact: true }).click();
  await expect(page.getByText('Wrong pad. Watch again.')).toBeVisible();
  for (let stage = 1; stage <= puzzle.sequence.length; stage++) {
    await expect(yourTurn).toHaveText(`Your turn: 0 / ${stage}`, { timeout: 8000 });
    for (const pad of puzzle.sequence.slice(0, stage)) await board.getByRole('button', { name: pads[pad], exact: true }).click();
  }
  await expect(solvedNote).toBeVisible();
  await settled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // Maze: a wall stops the marker; the arrows and arrow keys walk the route to the flag.
  const mazeLoaded = page.waitForResponse(response => response.url().endsWith('/api/practice/maze'));
  await games.getByText('Maze').click();
  const maze = (await (await mazeLoaded).json() as { puzzle: { size: number; open: number[]; start: number; exit: number } }).puzzle;
  const directions = ['Up', 'Right', 'Down', 'Left'];
  const controls = page.getByRole('group', { name: 'Move' });
  const blocked = [0, 1, 2, 3].find(move => mazeStep(maze.size, maze.open, maze.start, move) === null)!;
  await controls.getByRole('button', { name: directions[blocked] }).click();
  await expect(page.getByText('A wall is in the way.')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const route = mazeRoute(maze);
  const [first, ...rest] = route;
  await controls.getByRole('button', { name: directions[first] }).click();
  await page.getByRole('group', { name: 'Maze', exact: true }).focus();
  for (const move of rest) await page.keyboard.press(`Arrow${directions[move]}`);
  await expect(solvedNote).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('maze-mobile.png'), fullPage: true });

  // Open waterways: each tap turns a valve a quarter; the water flows once the channel is open.
  const waterLoaded = page.waitForResponse(response => response.url().endsWith('/api/practice/waterways'));
  await games.getByText('Open waterways').click();
  const water = (await (await waterLoaded).json() as { puzzle: Extract<TaskPuzzle, { kind: 'waterways' }> }).puzzle;
  const valves = page.getByRole('group', { name: 'Open waterways' }).getByRole('button');
  await expect(valves).toHaveCount(16);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const target = waterwaysTurns(water);
  for (const [index, turn] of target.entries()) {
    for (let tap = 0; tap < (turn - water.turns[index] + 4) % 4; tap++) await valves.nth(index).click();
  }
  await expect(page.getByText('The water flows!')).toBeVisible();
  await expect(solvedNote).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('waterways-mobile.png'), fullPage: true });

  // Deep links and Dutch.
  await page.goto('/practice?game=wires');
  await page.getByText('NL', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Probeer de taakspellen' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Draden verbinden', level: 2 })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  // Practice never creates a room.
  expect((await (await page.request.get('/api/session')).json()).lobby).toBeNull();
});
