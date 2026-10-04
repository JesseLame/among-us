import { randomInt } from 'node:crypto';
import type { TaskRules } from './types.js';

// Letters that cannot be mistaken for digits or each other when read out.
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

// Two keys: the player cannot finish alone. Another player enters the pairing code on their
// own phone, which shows them the unlock code, and reads it out. The unlock code never leaves
// the server with the puzzle.
export const twokeys: TaskRules<'twokeys'> = {
  generate({ pairCodes }) {
    let pair: string;
    do pair = Array.from({ length: 3 }, () => LETTERS[randomInt(LETTERS.length)]).join(''); while (pairCodes.has(pair));
    pairCodes.add(pair);
    return { kind: 'twokeys', pair, unlock: String(randomInt(10_000)).padStart(4, '0') };
  },
  check(puzzle, answer) {
    return typeof answer === 'string' && answer === puzzle.unlock;
  },
  reveal({ kind, pair }) {
    return { kind, pair };
  },
};
