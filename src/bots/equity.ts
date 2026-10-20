import { type Card, handKey } from '../engine/cards';
import { evaluate } from '../engine/evaluator';
import { evaluateOmaha, type Variant } from '../engine/omaha';
import { ploPct } from './plo';
import { PREFLOP } from './preflopTable';
import { chooseDiscards, drawPct } from './draw';

/** All 1326 two-card combos with their preflop percentile (0 = best). */
interface Combo {
  cards: Card[];
  pct: number;
}
const COMBOS: Combo[] = [];
for (let a = 0; a < 52; a++)
  for (let b = a + 1; b < 52; b++) COMBOS.push({ cards: [a, b], pct: PREFLOP[handKey(a, b)][0] });

export const preflopPct = (hole: Card[]) =>
  hole.length === 5 ? drawPct(hole) : hole.length === 4 ? ploPct(hole) : PREFLOP[handKey(hole[0], hole[1])][0];

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
  /** Five-card draw: how many cards they drew (undefined if they haven't drawn yet). */
  drew?: number;
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
  /** Five-card draw only: how many draws are still to come in this hand. */
  drawsLeft = 0,
): number {
  if (ranges.length === 0) return 1;
  if (variant === 'draw') return equityDraw(hole, ranges, sims, drawsLeft);
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

// ---------------------------------------------------------------- five-card draw

/**
 * Hands an opponent could have started with: inside their preflop range and,
 * if they've drawn, consistent with how many cards they took (a pat hand may
 * be a bluff). Sampled once per decision for speed.
 */
function drawPool(r: RangeBelief, dead: Set<Card>, size = 120): Card[][] {
  const lo = Math.max(0, r.lo);
  const hi = Math.min(1, Math.max(r.hi, lo + 0.03));
  const live = Array.from({ length: 52 }, (_, i) => i).filter((c) => !dead.has(c));
  const pool: Card[][] = [];
  const bluffs: Card[][] = []; // stood pat with nothing ("snowing")
  const loose: Card[][] = [];
  for (let tries = 0; tries < 7000 && pool.length < size; tries++) {
    for (let i = 0; i < 5; i++) {
      const j = i + ((rand() * (live.length - i)) | 0);
      [live[i], live[j]] = [live[j], live[i]];
    }
    const h = live.slice(0, 5);
    if (r.drew === undefined) {
      const p = drawPct(h);
      if (p >= lo && p <= hi) pool.push(h);
      continue;
    }
    const n = chooseDiscards(h).discard.length;
    if (n === r.drew) {
      const p = drawPct(h);
      // Their range before the draw still applies, loosely: what they draw says more
      if (p >= lo - 0.05 && p <= hi + 0.1) pool.push(h);
      else if (loose.length < size) loose.push(h);
    } else if (r.drew === 0 && n >= 4 && bluffs.length < 60) bluffs.push(h);
  }
  let out = pool.length >= 15 ? pool : pool.concat(loose).slice(0, size);
  if (r.drew === 0 && out.length) {
    // Mix in bluffs at the rate this player bluffs
    const want = Math.round((out.length * r.bluffy) / Math.max(0.05, 1 - r.bluffy));
    out = out.concat(bluffs.slice(0, want));
  }
  return out.length ? out : loose;
}

function equityDraw(hole: Card[], ranges: RangeBelief[], sims: number, drawsLeft: number): number {
  const dead = new Set<Card>(hole);
  const pools = ranges.map((r) => drawPool(r, dead));
  const used = new Uint8Array(52);
  const fresh = () => {
    let c: number;
    let guard = 0;
    do c = (rand() * 52) | 0;
    while (used[c] && ++guard < 500); // the deck can't run dry: thrown cards go back in (see redraw)
    used[c] = 1;
    return c;
  };
  let total = 0;
  let valid = 0;
  for (let s = 0; s < sims; s++) {
    used.fill(0);
    for (const c of hole) used[c] = 1;
    const opp: Card[][] = [];
    let ok = true;
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      const k = rand() < r.bluffy ? 1 : Math.max(1, Math.round(r.narrow + (rand() - 0.5)));
      let best: Card[] | null = null;
      let bestScore = -1;
      for (let t = 0, tries = 0; t < k && tries < 40; tries++) {
        const start = pools[i][(rand() * pools[i].length) | 0];
        if (start.some((c) => used[c])) continue;
        t++;
        // Replace the cards this hand would throw away (a pat hand, even a bluff, keeps all five)
        const plan = r.drew === 0 ? [] : chooseDiscards(start).discard;
        const hand = start.slice();
        for (const c of hand) used[c] = 1;
        const drawn: Card[] = [];
        for (const idx of plan) {
          const c = fresh();
          drawn.push(c);
          hand[idx] = c;
        }
        // release so other candidates can be tried; the kept one is re-marked below
        for (const c of start) used[c] = 0;
        for (const c of drawn) used[c] = 0;
        for (const c of hole) used[c] = 1;
        for (const o of opp) for (const c of o) used[c] = 1;
        const sc = evaluate(hand);
        if (sc > bestScore) {
          bestScore = sc;
          best = hand;
        }
        if (k === 1) break;
      }
      if (!best) {
        ok = false;
        break;
      }
      for (const c of best) used[c] = 1;
      opp.push(best);
    }
    if (!ok) continue;
    // Draws still to come: everyone draws the standard way
    const redraw = (hand: Card[]) => {
      for (let d = 0; d < drawsLeft; d++)
        for (const idx of chooseDiscards(hand).discard) {
          const thrown = hand[idx];
          hand[idx] = fresh();
          used[thrown] = 0; // discards are reshuffled into the deck, as at a real table
        }
    };
    for (const o of opp) redraw(o);
    const me = hole.slice();
    redraw(me);
    const hero = evaluate(me);
    let ties = 1;
    let lost = false;
    for (const o of opp) {
      const v = evaluate(o);
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
