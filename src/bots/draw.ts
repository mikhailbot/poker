import { type Card, rankOf, suitOf } from '../engine/cards';
import { evaluate } from '../engine/evaluator';

/**
 * Five-card draw strategy and hand ranking.
 *
 * chooseDiscards() is the standard way to draw (what most solid players do);
 * bots use it for their own draws, and also to work out what an opponent
 * probably holds from how many cards they took.
 */

const NAMES = ['twos', 'threes', 'fours', 'fives', 'sixes', 'sevens', 'eights', 'nines', 'tens', 'jacks', 'queens', 'kings', 'aces'];

export interface DrawPlan {
  /** Positions in the hand to throw away. */
  discard: number[];
  /** Plain-English reason, e.g. "Keep the pair of kings, draw 3". */
  why: string;
}

function rankCounts(hole: readonly Card[]) {
  const counts = new Map<number, number[]>(); // rank -> positions
  hole.forEach((c, i) => counts.set(rankOf(c), [...(counts.get(rankOf(c)) ?? []), i]));
  return counts;
}

/** Four cards to a flush: position of the odd card, or -1. */
function fourFlush(hole: readonly Card[]): number {
  for (let s = 0; s < 4; s++) {
    const off = hole.map((c, i) => (suitOf(c) === s ? -1 : i)).filter((i) => i >= 0);
    if (off.length === 1) return off[0];
  }
  return -1;
}

/** Four consecutive ranks (open-ended straight draw): position of the odd card, or -1. */
function openEnded(hole: readonly Card[]): number {
  for (let skip = 0; skip < 5; skip++) {
    const rs = hole.filter((_, i) => i !== skip).map(rankOf).sort((a, b) => a - b);
    const unique = new Set(rs).size === 4;
    // 4 in a row, not ending at the ace (A-K-Q-J can only fill one way)
    if (unique && rs[3] - rs[0] === 3 && rs[3] !== 12) return skip;
  }
  return -1;
}

export function chooseDiscards(hole: readonly Card[], opts: { snow?: boolean; keepKicker?: boolean } = {}): DrawPlan {
  const cat = evaluate(hole) >> 20;
  const all = [0, 1, 2, 3, 4];
  if (cat >= 4) return { discard: [], why: 'Made hand: stand pat' };
  const counts = rankCounts(hole);
  const groups = [...counts.entries()].sort((a, b) => b[1].length - a[1].length || b[0] - a[0]);
  if (cat === 7 || cat === 6) return { discard: [], why: 'Made hand: stand pat' };
  if (cat === 3) {
    const keep = groups[0][1];
    return { discard: all.filter((i) => !keep.includes(i)), why: `Keep three ${NAMES[groups[0][0]]}, draw 2` };
  }
  if (cat === 2) {
    const keep = [...groups[0][1], ...groups[1][1]];
    return { discard: all.filter((i) => !keep.includes(i)), why: 'Keep two pair, draw 1' };
  }
  if (cat === 1) {
    const [pairRank, pairPos] = groups[0];
    const ace = hole.findIndex((c, i) => rankOf(c) === 12 && !pairPos.includes(i));
    if (opts.keepKicker && ace >= 0) {
      const keep = [...pairPos, ace];
      return { discard: all.filter((i) => !keep.includes(i)), why: `Keep ${NAMES[pairRank]} with an ace kicker, draw 2` };
    }
    return { discard: all.filter((i) => !pairPos.includes(i)), why: `Keep the pair of ${NAMES[pairRank]}, draw 3` };
  }
  // No pair
  if (opts.snow) return { discard: [], why: 'Stand pat as a bluff' };
  const ff = fourFlush(hole);
  if (ff >= 0) return { discard: [ff], why: 'Four to a flush, draw 1' };
  const oe = openEnded(hole);
  if (oe >= 0) return { discard: [oe], why: 'Open-ended straight draw, draw 1' };
  const top = hole.reduce((best, c, i) => (rankOf(c) > rankOf(hole[best]) ? i : best), 0);
  return { discard: all.filter((i) => i !== top), why: 'Nothing to keep but the high card, draw 4' };
}

/** Pre-draw strength score (higher is better), counting made hands and draws. */
export function drawPreScore(hole: readonly Card[]): number {
  const score = evaluate(hole);
  const cat = score >> 20;
  const r1 = (score >> 16) & 15;
  const r2 = (score >> 12) & 15;
  if (cat >= 4) return 60 + cat * 5 + r1 * 0.2;
  if (cat === 3) return 50 + r1 * 0.6;
  if (cat === 2) return 38 + r1 * 0.6 + r2 * 0.2;
  if (cat === 1) return 20 + r1 * 1.2;
  // Draws are worth about a middle pair before the draw: people call raises with them
  if (fourFlush(hole) >= 0) return 30;
  if (openEnded(hole) >= 0) return 27;
  return r1 * 0.8 + r2 * 0.2;
}

let sorted: Float64Array | null = null;
function table(): Float64Array {
  if (sorted) return sorted;
  const N = 40000;
  const arr = new Float64Array(N);
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let n = 0; n < N; n++) {
    for (let i = 0; i < 5; i++) {
      const j = i + Math.floor(Math.random() * (52 - i));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    arr[n] = drawPreScore(deck.slice(0, 5));
  }
  arr.sort();
  sorted = arr;
  return arr;
}

/** Percentile of a five-card starting hand among all hands (0 = best, 1 = worst). */
export function drawPct(hole: readonly Card[]): number {
  const t = table();
  const v = drawPreScore(hole);
  // Ties are common (many hands share a score), so use the middle of the tied block
  let lo = 0,
    hi = t.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (t[m] < v) lo = m + 1;
    else hi = m;
  }
  let up = lo;
  while (up < t.length && t[up] === v) up++;
  return 1 - (lo + up) / 2 / t.length;
}
