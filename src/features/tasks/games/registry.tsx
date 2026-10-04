import type { ComponentType } from 'react';
import type { TaskKind } from '../../../../shared/protocol';
import type { Copy } from '../../../i18n';
import type { TaskGame, TaskGameProps } from './types';
import OrderGame from './order/OrderGame';
import WiresGame from './wires/WiresGame';
import CodebookGame from './codebook/CodebookGame';
import SimonGame from './simon/SimonGame';
import MazeGame from './maze/MazeGame';

// Every task game on the phone. The type makes the build fail when a kind in
// `taskKinds` (shared/protocol.ts) has no game here.
export const taskGames: { [K in TaskKind]: TaskGame<K> } = {
  order: { label: 'kindOrder', Game: OrderGame },
  wires: { label: 'kindWires', Game: WiresGame },
  codebook: { label: 'kindCodebook', Game: CodebookGame },
  simon: { label: 'kindSimon', Game: SimonGame },
  maze: { label: 'kindMaze', Game: MazeGame },
};

export const kindLabel = (t: Copy, kind: TaskKind) => t[taskGames[kind].label];

// One task game. Used for real tasks and on the practice page, so both behave the same.
export function PuzzleView(props: TaskGameProps) {
  // The registry pairs each kind with its own game, so the puzzle always fits.
  const Game = taskGames[props.puzzle.kind].Game as ComponentType<TaskGameProps>;
  return <Game {...props}/>;
}
