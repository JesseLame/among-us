import { randomInt } from 'node:crypto';
import { cargos } from '../../shared/protocol.js';
import type { TaskRules } from './types.js';

const is = (answer: unknown, step: number) => Array.isArray(answer) && answer.length === 1 && answer[0] === step;

// Delivery: in the app, load cargo at one station and unload it at another, so the player
// walks between rooms. With a real object the player brings that object to the station.
export const delivery: TaskRules<'delivery'> = {
  generate({ station, stations, deliveryObject }) {
    const cargo = cargos[randomInt(cargos.length)];
    if (deliveryObject) return { kind: 'delivery', cargo, object: deliveryObject, stage: 'dropoff', to: null };
    // With a single station both steps happen there; practice has no stations at all.
    const others = stations.filter(other => other !== station);
    const to = others.length ? others[randomInt(others.length)] : station;
    return { kind: 'delivery', cargo, object: null, stage: 'pickup', to };
  },
  check(puzzle, answer) {
    return puzzle.stage === 'dropoff' && is(answer, 1);
  },
  advance(puzzle, answer) {
    if (!is(answer, 0)) return null;
    // Picking up again (a retry after a lost reply) changes nothing.
    if (puzzle.stage === 'dropoff') return { puzzle, station: null };
    return { puzzle: { ...puzzle, stage: 'dropoff' }, station: puzzle.to };
  },
};
