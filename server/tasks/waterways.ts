import { randomInt } from 'node:crypto';
import { mazeStep, valveSides, waterFlow, type ValveShape } from '../../shared/protocol.js';
import { shuffle } from './random.js';
import type { TaskRules } from './types.js';

// Open waterways: a 4 × 4 grid of valves. A random channel of at least MIN_LENGTH valves runs
// from the source on the left to the drain on the right; the other valves are random decoys.
// Every valve is then turned at random, and the player turns them back until water flows.
const SIZE = 4;
const MIN_LENGTH = 6;
const all = Array.from({ length: SIZE * SIZE }, (_, index) => index);

// A random path through the grid from the left column to the right column, or null if this
// attempt got stuck.
function channel(): number[] | null {
  const path = [randomInt(SIZE) * SIZE];
  const seen = new Set(path);
  function walk(): boolean {
    const cell = path[path.length - 1];
    if (cell % SIZE === SIZE - 1 && path.length >= MIN_LENGTH) return true;
    for (const move of shuffle([0, 1, 2, 3])) {
      const next = mazeStep(SIZE, all.map(() => 15), cell, move);
      if (next === null || seen.has(next)) continue;
      path.push(next); seen.add(next);
      if (walk()) return true;
      path.pop(); seen.delete(next);
    }
    return false;
  }
  return walk() ? path : null;
}

// The side of `from` that faces its neighbour `to`.
const sideTowards = (from: number, to: number) =>
  to === from - SIZE ? 1 : to === from + 1 ? 2 : to === from + SIZE ? 4 : 8;

export const waterways: TaskRules<'waterways'> = {
  generate() {
    let path = channel();
    while (!path) path = channel();
    const valves: ValveShape[] = all.map(() => (randomInt(2) ? 'straight' : 'bend'));
    const solution = all.map(() => randomInt(4));
    path.forEach((cell, index) => {
      // Water comes in from the left of the first valve and leaves to the right of the last.
      const entry = index === 0 ? 8 : sideTowards(cell, path[index - 1]);
      const exit = index === path.length - 1 ? 2 : sideTowards(cell, path[index + 1]);
      valves[cell] = (entry | exit) === 10 || (entry | exit) === 5 ? 'straight' : 'bend';
      solution[cell] = [0, 1, 2, 3].find(turn => valveSides(valves[cell], turn) === (entry | exit))!;
    });
    const puzzle = { kind: 'waterways' as const, size: SIZE, valves, turns: solution, source: Math.floor(path[0] / SIZE), drain: Math.floor(path[path.length - 1] / SIZE) };
    // Scramble until the water no longer flows.
    do puzzle.turns = all.map(() => randomInt(4)); while (waterFlow(puzzle, puzzle.turns).out);
    return puzzle;
  },
  check(puzzle, answer) {
    // Any set of turns that lets the water out counts, not only the generated channel.
    return Array.isArray(answer) && answer.length === puzzle.valves.length && answer.every(turn => turn <= 3)
      && waterFlow(puzzle, answer).out;
  },
};
