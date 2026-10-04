import { randomInt } from 'node:crypto';
import { mazeStep } from '../../shared/protocol.js';
import type { TaskRules } from './types.js';

// A 6 × 6 maze with exactly one route between any two cells, carved by a randomised
// depth-first walk. Start on the left edge, exit on the right edge.
const SIZE = 6;
// Up, right, down, left: the bit for that side, the matching bit on the neighbour, and the step.
const SIDES = [
  { bit: 1, opposite: 4, dx: 0, dy: -1 },
  { bit: 2, opposite: 8, dx: 1, dy: 0 },
  { bit: 4, opposite: 1, dx: 0, dy: 1 },
  { bit: 8, opposite: 2, dx: -1, dy: 0 },
];

export const maze: TaskRules<'maze'> = {
  generate() {
    const open = Array<number>(SIZE * SIZE).fill(0);
    const visited = new Set<number>();
    const start = randomInt(SIZE) * SIZE;
    const path = [start];
    visited.add(start);
    while (path.length) {
      const cell = path[path.length - 1];
      const x = cell % SIZE, y = Math.floor(cell / SIZE);
      const next = SIDES.filter(side => {
        const nx = x + side.dx, ny = y + side.dy;
        return nx >= 0 && ny >= 0 && nx < SIZE && ny < SIZE && !visited.has(ny * SIZE + nx);
      });
      if (!next.length) { path.pop(); continue; }
      const side = next[randomInt(next.length)];
      const neighbour = (y + side.dy) * SIZE + x + side.dx;
      open[cell] |= side.bit;
      open[neighbour] |= side.opposite;
      visited.add(neighbour);
      path.push(neighbour);
    }
    return { kind: 'maze', size: SIZE, open, start, exit: randomInt(SIZE) * SIZE + SIZE - 1 };
  },
  check(puzzle, answer) {
    if (!Array.isArray(answer)) return false;
    let cell: number | null = puzzle.start;
    for (const move of answer) {
      cell = mazeStep(puzzle.size, puzzle.open, cell, move);
      if (cell === null) return false;
    }
    return cell === puzzle.exit;
  },
};
