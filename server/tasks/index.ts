import type { CompleteTask, TaskKind, TaskPuzzle } from '../../shared/protocol.js';
import { codebook, newCodebook } from './codebook.js';
import { maze } from './maze.js';
import { order } from './order.js';
import { simon } from './simon.js';
import type { Codebook, TaskRules } from './types.js';
import { waterways } from './waterways.js';
import { wires } from './wires.js';

export type { Codebook };
export { newCodebook };
export { shuffle } from './random.js';

// Every task game's rules. The type makes the build fail when a kind in
// `taskKinds` (shared/protocol.ts) has no rules here.
const rules: { [K in TaskKind]: TaskRules<K> } = { order, wires, codebook, simon, maze, waterways };

export function puzzle(kind: TaskKind): TaskPuzzle {
  return rules[kind].generate();
}

export function solved(task: TaskPuzzle, answer: CompleteTask['answer'], book: Codebook | undefined) {
  // The registry pairs each kind with its own rules, so the puzzle always fits.
  return (rules[task.kind] as TaskRules<TaskKind>).check(task, answer, book);
}
