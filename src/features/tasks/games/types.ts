import type { ComponentType } from 'react';
import type { CompleteTask, TaskKind, TaskPuzzle } from '../../../../shared/protocol';
import type { Copy } from '../../../i18n';

export type Puzzle<K extends TaskKind> = Extract<TaskPuzzle, { kind: K }>;

// What every task game gets, for real tasks and on the practice page alike.
export type TaskGameProps<K extends TaskKind = TaskKind> = {
  puzzle: Puzzle<K>;
  t: Copy;
  // No input: busy, offline, paused, or already solved.
  disabled: boolean;
  // The server accepted the answer; the solved game stays on screen briefly.
  solved: boolean;
  // Goes up each time the server turns an answer down, so a game can reset.
  rejected: number;
  onSubmit: (answer: CompleteTask['answer']) => void;
};

export type TaskGame<K extends TaskKind> = { label: keyof Copy; Game: ComponentType<TaskGameProps<K>> };
