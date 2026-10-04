// Solvers for the puzzles with many possible answers, shared by the server and browser tests.
import { mazeStep, valveSides, type ValveShape } from '../../shared/protocol.js';

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

// Turns that let the water out: follow a channel from the source, trying each turn of each valve.
export function waterwaysTurns(puzzle: { size: number; valves: ValveShape[]; turns: number[]; source: number; drain: number }) {
  const { size } = puzzle;
  const turns = [...puzzle.turns];
  const visited = new Set<number>();
  const moves = [[1, -size], [2, 1], [4, size], [8, -1]] as const;
  function follow(cell: number, entry: number): boolean {
    visited.add(cell);
    for (let turn = 0; turn < 4; turn++) {
      const sides = valveSides(puzzle.valves[cell], turn);
      if (!(sides & entry)) continue;
      const exit = sides ^ entry;
      turns[cell] = turn;
      if (exit === 2 && cell === puzzle.drain * size + size - 1) return true;
      const [, offset] = moves.find(([side]) => side === exit)!;
      const next = cell + offset;
      const wraps = (exit === 2 && cell % size === size - 1) || (exit === 8 && cell % size === 0);
      if (next < 0 || next >= size * size || wraps || visited.has(next)) continue;
      if (follow(next, exit === 1 ? 4 : exit === 4 ? 1 : exit === 2 ? 8 : 2)) return true;
    }
    visited.delete(cell);
    turns[cell] = puzzle.turns[cell];
    return false;
  }
  if (!follow(puzzle.source * size, 8)) throw new Error('No channel through the waterways');
  return turns;
}
