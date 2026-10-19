import { type Card, handKey } from '../engine/cards';
import { evaluate } from '../engine/evaluator';
import { PREFLOP } from './preflopTable';

/** All 1326 two-card combos with their preflop percentile (0 = best). */
interface Combo {
  a: Card;
  b: Card;
  pct: number;
}
const COMBOS: Combo[] = [];
for (let a = 0; a < 52; a++)
  for (let b = a + 1; b < 52; b++) COMBOS.push({ a, b, pct: PREFLOP[handKey(a, b)][0] });

export const preflopPct = (a: Card, b: Card) => PREFLOP[handKey(a, b)][0];

/**
 * What we believe about one opponent's holding.
 * lo/hi bound their preflop range by percentile; `narrow` > 1 means postflop
 * aggression makes stronger made hands more likely; `bluffy` is the chance that
 * this aggression is a bluff and shouldn't narrow the range.
 */
export interface RangeBelief {
  lo: number;
  hi: number;
  narrow: number;
  bluffy: number;
}

const rand = Math.random;

function rangeCombos(r: RangeBelief, dead: Set<Card>): Combo[] {
  let lo = Math.max(0, r.lo);
  let hi = Math.min(1, Math.max(r.hi, lo + 0.02));
  let list = COMBOS.filter((c) => c.pct >= lo && c.pct <= hi && !dead.has(c.a) && !dead.has(c.b));
  // Widen if card removal empties the range
  while (list.length < 6 && (lo > 0 || hi < 1)) {
    lo = Math.max(0, lo - 0.05);
    hi = Math.min(1, hi + 0.05);
    list = COMBOS.filter((c) => c.pct >= lo && c.pct <= hi && !dead.has(c.a) && !dead.has(c.b));
  }
  return list;
}

/**
 * Monte Carlo equity of `hole` against opponents holding hands from their believed ranges.
 * Returns share of the pot won on average (ties split).
 */
export function equityVsRanges(
  hole: Card[],
  board: Card[],
  ranges: RangeBelief[],
  sims = 700,
): number {
  if (ranges.length === 0) return 1;
  const dead = new Set<Card>([...hole, ...board]);
  const lists = ranges.map((r) => rangeCombos(r, dead));
  const need = 5 - board.length;
  const used = new Uint8Array(52);
  const deadArr = [...dead];
  const scratch: Card[] = new Array(7);
  let total = 0;
  let valid = 0;

  for (let s = 0; s < sims; s++) {
    used.fill(0);
    for (const c of deadArr) used[c] = 1;
    const opp: Card[][] = [];
    let ok = true;

    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      const list = lists[i];
      // Postflop narrowing: draw k candidates and keep the best made hand,
      // unless this sample is one of their bluffs.
      const k = rand() < r.bluffy ? 1 : Math.max(1, Math.round(r.narrow + (rand() - 0.5)));
      let best: Combo | null = null;
      let bestScore = -1;
      for (let t = 0, tries = 0; t < k && tries < 40; tries++) {
        const c = list[(rand() * list.length) | 0];
        if (used[c.a] || used[c.b]) continue;
        t++;
        if (k === 1 || board.length < 3) {
          best = c;
          break;
        }
        const sc = evaluate([c.a, c.b, ...board]);
        if (sc > bestScore) {
          bestScore = sc;
          best = c;
        }
      }
      if (!best) {
        ok = false;
        break;
      }
      used[best.a] = used[best.b] = 1;
      opp.push([best.a, best.b]);
    }
    if (!ok) continue;

    // Complete the board
    const full = board.slice();
    for (let i = 0; i < need; i++) {
      let c: number;
      do c = (rand() * 52) | 0;
      while (used[c]);
      used[c] = 1;
      full.push(c);
    }

    scratch.length = 0;
    const hero = evaluate([...hole, ...full]);
    let ties = 1;
    let lost = false;
    for (const o of opp) {
      const v = evaluate([o[0], o[1], ...full]);
      if (v > hero) {
        lost = true;
        break;
      }
      if (v === hero) ties++;
    }
    valid++;
    if (!lost) total += 1 / ties;
  }
  return valid ? total / valid : 0.5;
}
