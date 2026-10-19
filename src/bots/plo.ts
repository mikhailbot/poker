import { type Card, rankOf, suitOf } from '../engine/cards';

/**
 * Pot-limit Omaha starting-hand strength. There are too many 4-card hands for a
 * lookup table, so this scores the features that matter in PLO: high pairs,
 * nut-flush potential (double-suited with an ace), connectedness (rundowns),
 * and penalties for trips, quads and disconnected "dangler" cards.
 */
const HIGH = [0, 0, 0, 0, 0, 0.3, 0.6, 0.9, 1.3, 1.8, 2.3, 2.8, 3.6];

export function ploScore(hole: readonly Card[]): number {
  const ranks = hole.map(rankOf);
  const suits = hole.map(suitOf);
  const rc = new Array(13).fill(0);
  for (const r of ranks) rc[r]++;
  let s = 0;

  for (const r of ranks) s += HIGH[r];

  for (let r = 0; r < 13; r++) {
    if (rc[r] === 2) s += 3 + r * 0.55;
    else if (rc[r] === 3) s += 1 + r * 0.2 - 2.5;
    else if (rc[r] === 4) s -= 6;
  }

  // Suits: two cards of a suit is ideal; the higher the top card, the more nut-flush value
  let suitedGroups = 0;
  for (let su = 0; su < 4; su++) {
    const inSuit = ranks.filter((_, i) => suits[i] === su);
    if (inSuit.length >= 2) {
      const top = Math.max(...inSuit);
      const base = inSuit.length === 2 ? 2.4 : inSuit.length === 3 ? 1.4 : 0.4;
      s += base + (top === 12 ? 1.8 : top === 11 ? 0.8 : top >= 9 ? 0.3 : 0);
      if (inSuit.length === 2) suitedGroups++;
    }
  }
  if (suitedGroups === 2) s += 1; // double-suited bonus

  // Connectedness among distinct ranks (ace also counts low)
  const uniq = [...new Set(ranks)].sort((a, b) => b - a);
  for (let i = 0; i < uniq.length; i++)
    for (let j = i + 1; j < uniq.length; j++) {
      let g = uniq[i] - uniq[j];
      if (uniq[i] === 12 && uniq[j] <= 3) g = Math.min(g, uniq[j] + 1);
      const w = uniq[j] >= 7 ? 1 : 0.7; // high connectors make better straights
      if (g === 1) s += 1.6 * w;
      else if (g === 2) s += 1.2 * w;
      else if (g === 3) s += 0.8 * w;
      else if (g === 4) s += 0.3 * w;
    }
  if (uniq.length === 4 && uniq[0] - uniq[3] <= 4) s += 2.2; // rundown
  else if (uniq.length >= 3 && uniq[0] - uniq[2] <= 3) s += 0.8;

  // Dangler: an unpaired card far from every other card
  for (const r of uniq) {
    if (rc[r] > 1) continue;
    const near = uniq.some((o) => o !== r && Math.abs(o - r) <= 4);
    if (!near && r < 12) s -= 1.6;
  }
  return s;
}

// Percentile lookup built from a random sample of hands (0 = best)
let sorted: Float64Array | null = null;
function table(): Float64Array {
  if (sorted) return sorted;
  const N = 40000;
  const arr = new Float64Array(N);
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let n = 0; n < N; n++) {
    for (let i = 0; i < 4; i++) {
      const j = i + Math.floor(Math.random() * (52 - i));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    arr[n] = ploScore(deck.slice(0, 4));
  }
  arr.sort();
  sorted = arr;
  return arr;
}

/** Percentile of a PLO hand among all starting hands (0 = best, 1 = worst). */
export function ploPct(hole: readonly Card[]): number {
  const t = table();
  const v = ploScore(hole);
  let lo = 0,
    hi = t.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (t[m] <= v) lo = m + 1;
    else hi = m;
  }
  return 1 - lo / t.length;
}

/** Plain description of a PLO starting hand, e.g. "Double-suited rundown". */
export function describePlo(hole: readonly Card[]): string {
  const suits = hole.map(suitOf);
  const counts = [0, 0, 0, 0];
  for (const s of suits) counts[s]++;
  const pairs = counts.filter((c) => c === 2).length;
  const suitedness = pairs === 2 ? 'Double-suited' : counts.some((c) => c >= 2) ? 'Single-suited' : 'Rainbow';
  const ranks = hole.map(rankOf);
  const rc = new Array(13).fill(0);
  for (const r of ranks) rc[r]++;
  const pairRanks = rc.map((c, r) => (c >= 2 ? r : -1)).filter((r) => r >= 0);
  const uniq = [...new Set(ranks)].sort((a, b) => b - a);
  let shape = 'mixed cards';
  if (pairRanks.length === 2) shape = 'two pair';
  else if (pairRanks.includes(12)) shape = 'aces';
  else if (pairRanks.length === 1) shape = 'with a pair';
  else if (uniq.length === 4 && uniq[0] - uniq[3] <= 4) shape = 'rundown';
  else if (uniq[0] === 12) shape = 'ace-high';
  return `${suitedness} ${shape}`;
}
