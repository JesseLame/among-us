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
  // A station's name by id (games that send players to another station). None in practice.
  stationName: (id: string) => string | undefined;
};

// `summary`: an extra line for the task list, for games whose task needs preparing before you
// reach the station (such as fetching an object).
export type TaskGame<K extends TaskKind> = {
  label: keyof Copy; Game: ComponentType<TaskGameProps<K>>;
  summary?: (puzzle: Puzzle<K>, t: Copy, stationName: TaskGameProps['stationName']) => string;
};
