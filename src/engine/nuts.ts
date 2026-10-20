import type { Card } from './cards';
import { describeScore, evaluate } from './evaluator';
import { evaluateOmaha, type Variant } from './omaha';

export interface Nuts {
  /** Hole cards that make the best possible hand (one example when several tie). */
  cards: Card[];
  score: number;
  label: string;
}

/**
 * The nuts: the best hand anyone could hold on this board.
 * Hold'em uses any two unseen cards; Omaha must use exactly two hole cards
 * with three from the board, so the same two-card search applies.
 * Five-card draw has no board, so there are no nuts.
 */
export function nutsFor(variant: Variant, board: readonly Card[]): Nuts | null {
  if (variant === 'draw' || board.length < 3) return null;
  const onBoard = new Set(board);
  let best = -1;
  let cards: Card[] = [];
  for (let a = 51; a >= 0; a--) {
    if (onBoard.has(a)) continue;
    for (let b = a - 1; b >= 0; b--) {
      if (onBoard.has(b)) continue;
      const v = variant === 'plo' ? evaluateOmaha([a, b], board) : evaluate([a, b, ...board]);
      if (v > best) {
        best = v;
        cards = [a, b];
      }
    }
  }
  // Hold'em: if the board itself is the nuts, no hole cards are needed
  const boardOnly = variant === 'holdem' && board.length === 5 && evaluate(board) === best;
  return { cards: boardOnly ? [] : cards, score: best, label: describeScore(best) };
}
