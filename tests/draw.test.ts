import { describe, expect, it } from 'vitest';
import { applyDecision, applyDraw, legalActions, startHand, type SeatConfig } from '../src/engine/game';

const seats = (n: number, stack = 200): SeatConfig[] =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, isHuman: false, profileId: 'tag', stack }));

describe('five-card draw', () => {
  it('deals five cards, then a drawing round, then a final betting round', () => {
    const h = startHand(seats(3), 0, 1, 2, 1, undefined, 'draw');
    expect(h.players.every((p) => p.hole.length === 5)).toBe(true);
    expect(h.board).toHaveLength(0);
    applyDecision(h, { type: 'call' });
    applyDecision(h, { type: 'call' });
    applyDecision(h, { type: 'check' });
    expect(h.street).toBe('draw');
    expect(h.toAct).toBe(1); // first player left of the button draws first
    const before = [...h.players[1].hole];
    applyDraw(h, [0, 1, 2]);
    expect(h.players[1].hole.slice(3)).toEqual(before.slice(3));
    expect(h.players[1].hole.slice(0, 3)).not.toEqual(before.slice(0, 3));
    applyDraw(h, []); // stands pat
    applyDraw(h, [4]);
    expect(h.street).toBe('river');
    expect(h.board).toHaveLength(0);
    expect(h.actions.filter((a) => a.type === 'draw').map((a) => a.amount)).toEqual([3, 0, 1]);
  });

  it('reshuffles the discards when six players all draw five', () => {
    for (let t = 0; t < 50; t++) {
      const h = startHand(seats(6), 0, 1, 2, t, undefined, 'draw');
      while (h.street === 'preflop' && !h.done) applyDecision(h, { type: legalActions(h).canCheck ? 'check' : 'call' });
      while (h.street === 'draw') applyDraw(h, [0, 1, 2, 3, 4]);
      // No card may appear twice among live hands
      const all = h.players.flatMap((p) => p.hole);
      expect(new Set(all).size).toBe(all.length);
      expect(all.every((c) => c >= 0 && c < 52)).toBe(true);
    }
  });

  it('conserves chips and finishes every hand', () => {
    for (let t = 0; t < 1500; t++) {
      const n = 2 + (t % 5);
      const stacks = Array.from({ length: n }, () => 20 + Math.floor(Math.random() * 300));
      const h = startHand(
        stacks.map((stack, i) => ({ name: `P${i}`, isHuman: false, profileId: 'x', stack })),
        t % n,
        1,
        2,
        t,
        undefined,
        'draw',
      );
      let guard = 0;
      while (!h.done && guard++ < 300) {
        if (h.street === 'draw') {
          applyDraw(h, [0, 1, 2, 3, 4].filter(() => Math.random() < 0.4));
          continue;
        }
        const la = legalActions(h);
        const r = Math.random();
        if (r < 0.15) applyDecision(h, { type: 'fold' });
        else if (r < 0.6) applyDecision(h, { type: la.canCheck ? 'check' : 'call' });
        else applyDecision(h, { type: 'raise', to: la.minRaiseTo + Math.floor(Math.random() * 3) * 4 });
      }
      expect(h.done).toBe(true);
      expect(h.net.reduce((a, b) => a + b, 0)).toBe(0);
      expect(h.players.reduce((s, p) => s + p.stack, 0)).toBe(stacks.reduce((a, b) => a + b, 0));
      for (const sd of h.showdown) expect(sd.hole).toHaveLength(5);
    }
  });
});

import { parseCards } from '../src/engine/cards';
import { chooseDiscards, drawPct } from '../src/bots/draw';
import { botAct, createSession, dealNext, DEFAULT_SETTINGS } from '../src/session';

describe('multiple draws', () => {
  it('three draws with a betting round after each', () => {
    const h = startHand(seats(3), 0, 1, 2, 1, undefined, 'draw', 3);
    const bets: string[] = [];
    let guard = 0;
    while (!h.done && guard++ < 100) {
      if (h.street === 'draw') applyDraw(h, [0]);
      else {
        if (!bets.includes(h.street)) bets.push(h.street);
        applyDecision(h, { type: legalActions(h).canCheck ? 'check' : 'call' });
      }
    }
    expect(bets).toEqual(['preflop', 'flop', 'turn', 'river']);
    expect(h.drawsDone).toBe(3);
    const rounds = h.actions.filter((a) => a.type === 'draw').map((a) => a.round);
    expect(rounds).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3]);
    expect(h.showdown).toHaveLength(3);
  });

  it('bots play triple draw at a full table', () => {
    const s = createSession({ ...DEFAULT_SETTINGS, variant: 'draw', draws: 3 }, 'x', false);
    for (let i = 0; i < 150; i++) {
      const hh = dealNext(s);
      let guard = 0;
      while (!hh.done && guard++ < 400) botAct(s);
      expect(hh.done).toBe(true);
      expect(hh.net.reduce((a, b) => a + b, 0)).toBe(0);
      const all = hh.players.flatMap((p) => p.hole);
      expect(new Set(all).size).toBe(all.length);
    }
  }, 60000);
});

describe('five-card draw strategy', () => {
  const plan = (h: string) => chooseDiscards(parseCards(h)).discard.length;
  it('draws like a solid player', () => {
    expect(plan('5h 6d 7c 8s 9h')).toBe(0); // straight: pat
    expect(plan('Kh Kd Kc 4s 9h')).toBe(2); // trips: draw 2
    expect(plan('Kh Kd 4c 4s 9h')).toBe(1); // two pair: draw 1
    expect(plan('Qh Qd 4c 7s 9h')).toBe(3); // pair: draw 3
    expect(plan('Ah 2h 7h Th 9c')).toBe(1); // four-flush: draw 1
    expect(plan('5c 6d 7h 8s Kc')).toBe(1); // open-ended: draw 1
    expect(plan('Ac 3d 7h 9s Jc')).toBe(4); // nothing: keep the ace
  });
  it('ranks starting hands sensibly', () => {
    const p = (h: string) => drawPct(parseCards(h));
    expect(p('Ah Ad Ac 4s 9h')).toBeLessThan(p('Ah Ad 4c 7s 9h'));
    expect(p('Ah Ad 4c 7s 9h')).toBeLessThan(p('2h 2d 4c 7s 9h'));
    expect(p('2h 2d 4c 7s 9h')).toBeLessThan(p('Ac 3d 7h 9s Jc'));
  });
  it('bots play full sessions', () => {
    const s = createSession({ ...DEFAULT_SETTINGS, variant: 'draw' }, 'x', false);
    for (let i = 0; i < 400; i++) {
      const h = dealNext(s);
      let guard = 0;
      while (!h.done && guard++ < 300) botAct(s);
      expect(h.done).toBe(true);
      expect(h.net.reduce((a, b) => a + b, 0)).toBe(0);
    }
  }, 60000);
});
