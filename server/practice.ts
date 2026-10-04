import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { practiceCheck, taskKinds, type PracticePuzzle, type TaskKind } from '../shared/protocol.js';
import { newCodebook, puzzle, solved, type Codebook } from './tasks/index.js';
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
    const task = puzzle(kind);
    // The codebook stands in for the printed station sheet.
    const book = kind === 'codebook' ? newCodebook() : undefined;
    open.set(id, { task, book });
    if (open.size > LIMIT) open.delete(open.keys().next().value!);
    res.json({ id, puzzle: task, codebook: book } satisfies PracticePuzzle);
  });
  router.post('/check', (req, res) => {
    const parsed = practiceCheck.safeParse(req.body);
    if (!parsed.success) throw new GameError('INVALID_INPUT');
    const entry = open.get(parsed.data.id);
    if (!entry) throw new GameError('TASK_NOT_FOUND', 404);
    if (!solved(entry.task, parsed.data.answer, entry.book)) throw new GameError('WRONG_ANSWER');
    open.delete(parsed.data.id);
    res.json({ solved: true });
  });
  return router;
}
