import type { Card } from './cards';
import { evaluate } from './evaluator';

export type Variant = 'holdem' | 'plo';

export const HOLE_CARDS: Record<Variant, number> = { holdem: 2, plo: 4 };

const five: Card[] = [0, 0, 0, 0, 0];

/**
 * Omaha: the best hand using exactly two hole cards and exactly three board cards.
 * Works with a 3-, 4- or 5-card board.
 */
export function evaluateOmaha(hole: readonly Card[], board: readonly Card[]): number {
  let best = -1;
  const nb = board.length;
  for (let a = 0; a < hole.length; a++)
    for (let b = a + 1; b < hole.length; b++) {
      five[0] = hole[a];
      five[1] = hole[b];
      for (let x = 0; x < nb; x++)
        for (let y = x + 1; y < nb; y++)
          for (let z = y + 1; z < nb; z++) {
            five[2] = board[x];
            five[3] = board[y];
            five[4] = board[z];
            const v = evaluate(five);
            if (v > best) best = v;
          }
    }
  return best;
}

/** Score a player's hand for the given game. */
export function scoreHand(variant: Variant, hole: readonly Card[], board: readonly Card[]): number {
  return variant === 'plo' ? evaluateOmaha(hole, board) : evaluate([...hole, ...board]);
}
