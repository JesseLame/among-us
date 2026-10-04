import { randomInt } from 'node:crypto';
import { symbols, wireColours, type CompleteTask, type SymbolId, type TaskKind, type TaskPuzzle } from '../shared/protocol.js';

export type Codebook = Record<SymbolId, number>;
export type { TaskKind };

export function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = randomInt(index + 1);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export function codebook(): Codebook {
  return Object.fromEntries(symbols.map(symbol => [symbol, randomInt(10)])) as Codebook;
}

// Simon says: the full sequence is shown and repeated step by step, 1 pad, then 2, … up to 5.
const SIMON_LENGTH = 5;

export function puzzle(kind: TaskKind): TaskPuzzle {
  switch (kind) {
    case 'order': {
      const numbers = new Set<number>();
      while (numbers.size < 6) numbers.add(randomInt(1, 100));
      return { kind, numbers: [...numbers] };
    }
    case 'wires': {
      const colours = shuffle(wireColours).slice(0, 4);
      return { kind, left: colours, right: shuffle(colours) };
    }
    case 'codebook':
      return { kind, symbols: shuffle(symbols).slice(0, 4) };
    case 'simon':
      return { kind, sequence: Array.from({ length: SIMON_LENGTH }, () => randomInt(4)) };
  }
}

export function solved(task: TaskPuzzle, answer: CompleteTask['answer'], book: Codebook | undefined) {
  switch (task.kind) {
    case 'order': {
      const sorted = [...task.numbers].sort((a, b) => a - b);
      return Array.isArray(answer) && answer.length === sorted.length && answer.every((value, index) => value === sorted[index]);
    }
    case 'wires':
      return Array.isArray(answer) && answer.length === task.left.length
        && new Set(answer).size === answer.length
        && answer.every((right, left) => task.right[right] === task.left[left]);
    case 'simon':
      return Array.isArray(answer) && answer.length === task.sequence.length && answer.every((pad, index) => pad === task.sequence[index]);
    case 'codebook':
      return typeof answer === 'string' && Boolean(book) && answer === task.symbols.map(symbol => book![symbol]).join('');
  }
}
