import { randomInt } from 'node:crypto';
import { symbols } from '../../shared/protocol.js';
import { shuffle } from './random.js';
import type { Codebook, TaskRules } from './types.js';

// A new codebook for a station's printed sheet: a digit for every symbol.
export function newCodebook(): Codebook {
  return Object.fromEntries(symbols.map(symbol => [symbol, randomInt(10)])) as Codebook;
}

// Four symbols, looked up in the station's codebook to make the code.
export const codebook: TaskRules<'codebook'> = {
  generate() {
    return { kind: 'codebook', symbols: shuffle(symbols).slice(0, 4) };
  },
  check(puzzle, answer, book) {
    return typeof answer === 'string' && Boolean(book) && answer === puzzle.symbols.map(symbol => book![symbol]).join('');
  },
};
