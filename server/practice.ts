import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { practiceCheck, practiceHelp, taskKinds, type PracticePuzzle, type TaskKind } from '../shared/protocol.js';
import { advance, newCodebook, puzzle, reveal, solved, type Codebook } from './tasks/index.js';
import { GameError } from './store/index.js';

// Practice puzzles live only in memory: no session, room or database involved.
// The oldest are forgotten once there are too many.
const LIMIT = 500;

// Try any task game outside a round (/practice), checked by the same code as real tasks.
export function practiceRoutes() {
  const open = new Map<string, { task: PracticePuzzle['puzzle']; book?: Codebook }>();
  const router = Router();
  router.get('/:kind', (req, res) => {
    const kind = req.params.kind as TaskKind;
    if (!taskKinds.includes(kind)) throw new GameError('INVALID_INPUT');
    const id = randomUUID();
    const task = puzzle(kind, { station: null, stations: [], deliveryObject: null, pairCodes: new Set([...open.values()].flatMap(entry => entry.task.kind === 'twokeys' ? [entry.task.pair] : [])) });
    // The codebook stands in for the printed station sheet.
    const book = kind === 'codebook' ? newCodebook() : undefined;
    open.set(id, { task, book });
    if (open.size > LIMIT) open.delete(open.keys().next().value!);
    res.json({ id, puzzle: reveal(task), codebook: book } satisfies PracticePuzzle);
  });
  // Practise helping: the unlock code for an open two-keys practice puzzle.
  router.post('/help', (req, res) => {
    const parsed = practiceHelp.safeParse(req.body);
    if (!parsed.success) throw new GameError('INVALID_INPUT');
    const entry = [...open.values()].find(({ task }) => task.kind === 'twokeys' && task.pair === parsed.data.code);
    if (!entry || entry.task.kind !== 'twokeys') throw new GameError('HELP_CODE_NOT_FOUND', 404);
    res.json({ unlock: entry.task.unlock });
  });
  router.post('/check', (req, res) => {
    const parsed = practiceCheck.safeParse(req.body);
    if (!parsed.success) throw new GameError('INVALID_INPUT');
    const entry = open.get(parsed.data.id);
    if (!entry) throw new GameError('TASK_NOT_FOUND', 404);
    // A step of a game with several steps: the next step, under the same id.
    const next = advance(entry.task, parsed.data.answer);
    if (next) { entry.task = next.puzzle; res.json({ solved: false, puzzle: reveal(next.puzzle) }); return; }
    if (!solved(entry.task, parsed.data.answer, entry.book)) throw new GameError('WRONG_ANSWER');
    open.delete(parsed.data.id);
    res.json({ solved: true });
  });
  return router;
}
