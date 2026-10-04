import { randomInt } from 'node:crypto';
import type { TaskRules } from './types.js';

// Six different numbers, tapped from lowest to highest.
export const order: TaskRules<'order'> = {
  generate() {
    const numbers = new Set<number>();
    while (numbers.size < 6) numbers.add(randomInt(1, 100));
    return { kind: 'order', numbers: [...numbers] };
  },
  check(puzzle, answer) {
    const sorted = [...puzzle.numbers].sort((a, b) => a - b);
    return Array.isArray(answer) && answer.length === sorted.length && answer.every((value, index) => value === sorted[index]);
  },
};
