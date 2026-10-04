import type { CompleteTask, SymbolId, TaskKind, TaskPuzzle } from '../../shared/protocol.js';

// Each station's printed codebook: the digit for every symbol.
export type Codebook = Record<SymbolId, number>;
export type Puzzle<K extends TaskKind> = Extract<TaskPuzzle, { kind: K }>;

// The server side of a task game: makes a new puzzle and checks an answer to it.
export type TaskRules<K extends TaskKind> = {
  generate(): Puzzle<K>;
  check(puzzle: Puzzle<K>, answer: CompleteTask['answer'], book: Codebook | undefined): boolean;
};
