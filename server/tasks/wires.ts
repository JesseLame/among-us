import { wireColours } from '../../shared/protocol.js';
import { shuffle } from './random.js';
import type { TaskRules } from './types.js';

// Four coloured wires on the left; the answer gives the matching socket for each.
export const wires: TaskRules<'wires'> = {
  generate() {
    const colours = shuffle(wireColours).slice(0, 4);
    return { kind: 'wires', left: colours, right: shuffle(colours) };
  },
  check(puzzle, answer) {
    return Array.isArray(answer) && answer.length === puzzle.left.length
      && new Set(answer).size === answer.length
      && answer.every((right, left) => puzzle.right[right] === puzzle.left[left]);
  },
};
