import type { Card } from './cards';

/**
 * Evaluates the best 5-card hand from 5–7 cards.
 * Returns an integer score; higher is better. Category lives in bits 20+,
 * up to five tie-breaking ranks in 4-bit nibbles below it.
 */
export const HAND_NAMES = [
  'High card',
  'Pair',
  'Two pair',
  'Three of a kind',
  'Straight',
  'Flush',
  'Full house',
  'Four of a kind',
  'Straight flush',
];

const rc = new Uint8Array(13);

function straightHigh(mask: number): number {
  for (let h = 12; h >= 4; h--) {
    const need = 0x1f << (h - 4);
    if ((mask & need) === need) return h;
  }
  // Wheel: A-2-3-4-5
  if ((mask & 0b1111) === 0b1111 && mask & (1 << 12)) return 3;
  return -1;
}

function topBits(mask: number, n: number): number {
  let out = 0;
  let taken = 0;
  for (let r = 12; r >= 0 && taken < n; r--) {
    if (mask & (1 << r)) {
      out = (out << 4) | r;
      taken++;
    }
  }
  // left-align into 5 nibbles
  return out << (4 * (5 - taken));
}

export function evaluate(cards: readonly Card[]): number {
  rc.fill(0);
  let s0 = 0,
    s1 = 0,
    s2 = 0,
    s3 = 0,
    rankMask = 0;
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const r = c >> 2;
    rc[r]++;
    rankMask |= 1 << r;
    switch (c & 3) {
      case 0: s0 |= 1 << r; break;
      case 1: s1 |= 1 << r; break;
      case 2: s2 |= 1 << r; break;
      default: s3 |= 1 << r;
    }
  }

  let flushMask = 0;
  for (const m of [s0, s1, s2, s3]) {
    if (popcount(m) >= 5) {
      const sf = straightHigh(m);
      if (sf >= 0) return (8 << 20) | (sf << 16);
      flushMask = m;
    }
  }

  let quad = -1;
  let trip1 = -1,
    trip2 = -1;
  let pair1 = -1,
    pair2 = -1,
    pair3 = -1;
  for (let r = 12; r >= 0; r--) {
    const n = rc[r];
    if (n === 4) quad = r;
    else if (n === 3) {
      if (trip1 < 0) trip1 = r;
      else if (trip2 < 0) trip2 = r;
    } else if (n === 2) {
      if (pair1 < 0) pair1 = r;
      else if (pair2 < 0) pair2 = r;
      else if (pair3 < 0) pair3 = r;
    }
  }

  if (quad >= 0) {
    const kick = highestExcept(rankMask, [quad]);
    return (7 << 20) | (quad << 16) | (kick << 12);
  }
  if (trip1 >= 0 && (trip2 >= 0 || pair1 >= 0)) {
    const p = Math.max(trip2, pair1);
    return (6 << 20) | (trip1 << 16) | (p << 12);
  }
  if (flushMask) return (5 << 20) | topBits(flushMask, 5);
  const st = straightHigh(rankMask);
  if (st >= 0) return (4 << 20) | (st << 16);
  if (trip1 >= 0) {
    const rest = topBits(rankMask & ~(1 << trip1), 2) >> 8;
    return (3 << 20) | (trip1 << 16) | rest;
  }
  if (pair1 >= 0 && pair2 >= 0) {
    const kick = highestExcept(rankMask, [pair1, pair2]);
    return (2 << 20) | (pair1 << 16) | (pair2 << 12) | (kick << 8);
  }
  if (pair1 >= 0) {
    const rest = topBits(rankMask & ~(1 << pair1), 3) >> 4;
    return (1 << 20) | (pair1 << 16) | rest;
  }
  void pair3;
  return topBits(rankMask, 5);
}

function highestExcept(mask: number, exclude: number[]): number {
  for (let r = 12; r >= 0; r--) {
    if (mask & (1 << r) && !exclude.includes(r)) return r;
  }
  return 0;
}

function popcount(x: number): number {
  x = x - ((x >> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
  return (((x + (x >> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export const handCategory = (score: number) => score >> 20;
export const handName = (score: number) => HAND_NAMES[score >> 20];
