import { describe, expect, it } from 'vitest';
import { parseCards } from '../src/engine/cards';
import { decide } from '../src/bots/brain';
import { equityVsRanges } from '../src/bots/equity';
import { emptyStats } from '../src/bots/stats';
import { startHand, type SeatConfig } from '../src/engine/game';
import { botAct, createSession, dealNext, DEFAULT_SETTINGS } from '../src/session';

const seats = (profile: string): SeatConfig[] =>
  Array.from({ length: 6 }, (_, i) => ({ name: `B${i}`, isHuman: false, profileId: profile, stack: 200 }));

/** Deal a hand where the first player to act (UTG, seat 3 with button 0) holds `hole`. */
function utgWith(hole: string, profile: string) {
  const h = startHand(seats(profile), 0, 1, 2, 1);
  const cards = parseCards(hole);
  const utg = h.players[h.toAct];
  // swap the wanted cards in from wherever they were dealt
  for (const p of h.players) p.hole = p.hole.map((c) => (cards.includes(c) ? -1 : c));
  utg.hole = cards;
  for (const p of h.players) p.hole = p.hole.map((c) => (c === -1 ? 51 - cards[0] : c));
  return h;
}

describe('bot preflop discipline', () => {
  const ctx = { stats: Array.from({ length: 6 }, emptyStats), tilt: 0 };

  it('never folds aces first in', () => {
    for (const prof of ['nit', 'tag', 'lag', 'station', 'maniac'])
      for (let i = 0; i < 50; i++) {
        const h = utgWith('As Ad', prof);
        expect(decide(h, h.toAct, ctx).decision.type).not.toBe('fold');
      }
  });

  it('tight players fold junk under the gun', () => {
    for (const prof of ['nit', 'tag'])
      for (let i = 0; i < 50; i++) {
        const h = utgWith('7c 2d', prof);
        expect(decide(h, h.toAct, ctx).decision.type).toBe('fold');
      }
  });
});

describe('equity', () => {
  it('AA is a big favourite against a random hand', () => {
    const e = equityVsRanges(parseCards('As Ah'), [], [{ lo: 0, hi: 1, narrow: 1, bluffy: 0 }], 4000);
    expect(e).toBeGreaterThan(0.8);
    expect(e).toBeLessThan(0.9);
  });

  it('a flush beats almost everything on the river', () => {
    const e = equityVsRanges(parseCards('Ah Kh'), parseCards('2h 7h 9h Jc 3s'), [{ lo: 0, hi: 1, narrow: 3, bluffy: 0 }], 2000);
    expect(e).toBeGreaterThan(0.95);
  });

  it('narrowing for aggression lowers a marginal hand’s equity', () => {
    const hole = parseCards('Qs Jd');
    const board = parseCards('Qh 8c 4d');
    const loose = equityVsRanges(hole, board, [{ lo: 0, hi: 0.5, narrow: 1, bluffy: 0 }], 3000);
    const tight = equityVsRanges(hole, board, [{ lo: 0, hi: 0.5, narrow: 4, bluffy: 0 }], 3000);
    expect(tight).toBeLessThan(loose - 0.1);
  });
});

describe('full bot sessions', () => {
  it('plays 1500 hands without errors and conserves chips', () => {
    const s = createSession(DEFAULT_SETTINGS, 'x', false);
    for (let i = 0; i < 1500; i++) {
      const h = dealNext(s);
      let guard = 0;
      while (!h.done && guard++ < 300) botAct(s);
      expect(h.done).toBe(true);
      expect(h.net.reduce((a, b) => a + b, 0)).toBe(0);
    }
    const inPlay = s.seats.reduce((a, x) => a + x.stack, 0);
    const bought = s.seats.reduce((a, x) => a + x.buyIns, 0);
    expect(inPlay).toBeLessThanOrEqual(bought + 1); // chips only move between players
    expect(s.seats.reduce((a, x) => a + (x.stack - x.buyIns), 0)).toBe(0);
  }, 60000);
});
