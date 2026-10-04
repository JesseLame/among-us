import { randomInt } from 'node:crypto';

export function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = randomInt(index + 1);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}
