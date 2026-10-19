import { type Card, handKey } from '../engine/cards';
import { evaluate } from '../engine/evaluator';
import { evaluateOmaha, type Variant } from '../engine/omaha';
import { ploPct } from './plo';
import { PREFLOP } from './preflopTable';

/** All 1326 two-card combos with their preflop percentile (0 = best). */
interface Combo {
  cards: Card[];
  pct: number;
}
const COMBOS: Combo[] = [];
for (let a = 0; a < 52; a++)
  for (let b = a + 1; b < 52; b++) COMBOS.push({ cards: [a, b], pct: PREFLOP[handKey(a, b)][0] });

export const preflopPct = (hole: Card[]) => (hole.length === 4 ? ploPct(hole) : PREFLOP[handKey(hole[0], hole[1])][0]);

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

function holdemRange(r: RangeBelief, dead: Set<Card>): Combo[] {
  let lo = Math.max(0, r.lo);
  let hi = Math.min(1, Math.max(r.hi, lo + 0.02));
  const ok = (c: Combo) => c.pct >= lo && c.pct <= hi && !dead.has(c.cards[0]) && !dead.has(c.cards[1]);
  let list = COMBOS.filter(ok);
  // Widen if card removal empties the range
  while (list.length < 6 && (lo > 0 || hi < 1)) {
    lo = Math.max(0, lo - 0.05);
    hi = Math.min(1, hi + 0.05);
    list = COMBOS.filter(ok);
  }
  return list;
}

/**
 * Build a pool of Omaha hands from the live cards whose percentile is inside the range.
 * Scoring 4-card hands is relatively slow, so we sample a pool once per decision
 * and draw from it in every simulation.
 */
function omahaPool(r: RangeBelief, dead: Set<Card>, size = 220): Card[][] {
  const lo = Math.max(0, r.lo);
  const hi = Math.min(1, Math.max(r.hi, lo + 0.03));
  const live = Array.from({ length: 52 }, (_, i) => i).filter((c) => !dead.has(c));
  const pool: Card[][] = [];
  const any: Card[][] = [];
  for (let tries = 0; tries < 6000 && pool.length < size; tries++) {
    for (let i = 0; i < 4; i++) {
      const j = i + ((rand() * (live.length - i)) | 0);
      [live[i], live[j]] = [live[j], live[i]];
    }
    const h = live.slice(0, 4);
    if (any.length < size) any.push(h);
    const p = ploPct(h);
    if (p >= lo && p <= hi) pool.push(h);
  }
  return pool.length >= 20 ? pool : any;
}

/**
 * Monte Carlo equity of `hole` against opponents holding hands from their believed ranges.
 * Returns the share of the pot won on average (ties split).
 */
export function equityVsRanges(
  hole: Card[],
  board: Card[],
  ranges: RangeBelief[],
  sims = 700,
  variant: Variant = 'holdem',
): number {
  if (ranges.length === 0) return 1;
  const plo = variant === 'plo';
  const score = plo ? evaluateOmaha : (h: Card[], b: Card[]) => evaluate([...h, ...b]);
  const dead = new Set<Card>([...hole, ...board]);
  const lists = plo ? [] : ranges.map((r) => holdemRange(r, dead));
  const pools = plo ? ranges.map((r) => omahaPool(r, dead)) : [];
  const need = 5 - board.length;
  const used = new Uint8Array(52);
  const deadArr = [...dead];
  let total = 0;
  let valid = 0;

  for (let s = 0; s < sims; s++) {
    used.fill(0);
    for (const c of deadArr) used[c] = 1;
    const opp: Card[][] = [];
    let ok = true;

    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      // Postflop narrowing: draw k candidates and keep the best made hand,
      // unless this sample is one of their bluffs.
      const k = rand() < r.bluffy ? 1 : Math.max(1, Math.round(r.narrow + (rand() - 0.5)));
      let best: Card[] | null = null;
      let bestScore = -1;
      for (let t = 0, tries = 0; t < k && tries < 40; tries++) {
        let cand: Card[] | null;
        if (plo) {
          const c = pools[i][(rand() * pools[i].length) | 0];
          cand = used[c[0]] || used[c[1]] || used[c[2]] || used[c[3]] ? null : c;
        } else {
          const c = lists[i][(rand() * lists[i].length) | 0];
          cand = used[c.cards[0]] || used[c.cards[1]] ? null : c.cards;
        }
        if (!cand) continue;
        t++;
        if (k === 1 || board.length < 3) {
          best = cand;
          break;
        }
        const sc = score(cand, board);
        if (sc > bestScore) {
          bestScore = sc;
          best = cand;
        }
      }
      if (!best) {
        ok = false;
        break;
      }
      for (const c of best) used[c] = 1;
      opp.push(best);
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

    const hero = score(hole, full);
    let ties = 1;
    let lost = false;
    for (const o of opp) {
      const v = score(o, full);
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
