import { randomInt } from 'node:crypto';
import type { TaskRules } from './types.js';

// Simon says: the full sequence is shown and repeated step by step, 1 pad, then 2, … up to 5.
const LENGTH = 5;

export const simon: TaskRules<'simon'> = {
  generate() {
    return { kind: 'simon', sequence: Array.from({ length: LENGTH }, () => randomInt(4)) };
  },
  check(puzzle, answer) {
    return Array.isArray(answer) && answer.length === puzzle.sequence.length && answer.every((pad, index) => pad === puzzle.sequence[index]);
  },
};
