import type { CompleteTask, SymbolId, TaskKind, TaskPuzzle } from '../../shared/protocol.js';

// Each station's printed codebook: the digit for every symbol.
export type Codebook = Record<SymbolId, number>;
export type Puzzle<K extends TaskKind> = Extract<TaskPuzzle, { kind: K }>;

// Where a new puzzle is handed out: its station and the room's other stations (none in
// practice), and the real object for deliveries if the organiser chose one.
export type TaskContext = { station: string | null; stations: string[]; deliveryObject: string | null };

// The server side of a task game: makes a new puzzle and checks an answer to it. A game with
// several steps also has `advance`: the puzzle for its next step, and the station that step
// moves to, or null when the answer is not a correct step.
export type TaskRules<K extends TaskKind> = {
  generate(context: TaskContext): Puzzle<K>;
  check(puzzle: Puzzle<K>, answer: CompleteTask['answer'], book: Codebook | undefined): boolean;
  advance?(puzzle: Puzzle<K>, answer: CompleteTask['answer']): { puzzle: Puzzle<K>; station: string | null } | null;
};
