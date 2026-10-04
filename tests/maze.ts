import { mazeStep } from '../shared/protocol';

// The direct route through a maze puzzle (0 up, 1 right, 2 down, 3 left).
export function mazeRoute(puzzle: { size: number; open: number[]; start: number; exit: number }) {
  const routes = new Map<number, number[]>([[puzzle.start, []]]);
  const queue = [puzzle.start];
  while (queue.length) {
    const cell = queue.shift()!;
    for (let move = 0; move < 4; move++) {
      const next = mazeStep(puzzle.size, puzzle.open, cell, move);
      if (next !== null && !routes.has(next)) { routes.set(next, [...routes.get(cell)!, move]); queue.push(next); }
    }
  }
  return routes.get(puzzle.exit)!;
}
