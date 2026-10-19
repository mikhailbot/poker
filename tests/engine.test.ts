import { describe, expect, it } from 'vitest';
import { parseCards, type Card } from '../src/engine/cards';
import { evaluate, handName } from '../src/engine/evaluator';
import { applyDecision, legalActions, startHand, potTotal, type SeatConfig } from '../src/engine/game';

const ev = (s: string) => evaluate(parseCards(s));

describe('evaluator', () => {
  it('ranks categories correctly', () => {
    const hands = [
      'As Kd 9c 7h 3s 2d 4c', // high card
      'As Ad 9c 7h 3s 2d Jc', // pair
      'As Ad 9c 9h 3s 2d Jc', // two pair
      'As Ad Ac 9h 3s 2d Jc', // trips
      '5s 6d 7c 8h 9s 2d Jc', // straight
      'As 2s 9s 7s 3s Kd Jc', // flush
      'As Ad Ac 9h 9s 2d Jc', // full house
      'As Ad Ac Ah 9s 2d Jc', // quads
      '5s 6s 7s 8s 9s 2d Jc', // straight flush
    ];
    hands.forEach((h, i) => expect(handName(ev(h))).toBe(
      ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'][i],
    ));
  });

  it('handles the wheel and kickers', () => {
    expect(handName(ev('As 2d 3c 4h 5s Kd Kc'))).toBe('Straight');
    expect(ev('As 2d 3c 4h 5s 9d 8c')).toBeLessThan(ev('6s 2d 3c 4h 5s 9d 8c'));
    expect(ev('As Ad Kc 7h 3s')).toBeGreaterThan(ev('As Ad Qc 7h 3s'));
    expect(ev('Ks Kd 2c 2h As 3d 3c')).toBe(ev('Ks Kd 3h 3s Ac 9d 8c')); // two pair, best two plus kicker
    expect(ev('Ah Kh 2c 2d 2s Kd Kc')).toBeGreaterThan(ev('2h 2c 2d Ks Kd Qc Jc')); // KKK22 > 222KK
    expect(ev('9h 9c 9d 8s 8d 8c 2c')).toBe(ev('9h 9c 9d 8s 8d 4c 2c')); // two trips -> full house
    expect(handName(ev('Ah Kh Qh Jh Th 9h 8h'))).toBe('Straight flush');
  });

  it('chooses the best flush', () => {
    expect(ev('Ah 2h 3h 4h 9h Kh 5c')).toBeGreaterThan(ev('Ah 2h 3h 4h 9h Qh 5c'));
  });
});

function table(stacks: number[]): SeatConfig[] {
  return stacks.map((stack, i) => ({ name: `P${i}`, isHuman: i === 0, profileId: 'x', stack }));
}

/** Stacked deck: cards are dealt with pop(), so list them in reverse deal order. */
function deckFrom(dealOrder: string): Card[] {
  return parseCards(dealOrder).reverse();
}

describe('betting engine', () => {
  it('posts blinds and gives BB the option', () => {
    const h = startHand(table([200, 200, 200]), 0, 1, 2, 1);
    expect(h.sbSeat).toBe(1);
    expect(h.bbSeat).toBe(2);
    expect(h.toAct).toBe(0);
    applyDecision(h, { type: 'call' }); // BTN limps
    applyDecision(h, { type: 'call' }); // SB completes
    expect(h.toAct).toBe(2);
    expect(legalActions(h).canCheck).toBe(true);
    expect(legalActions(h).canRaise).toBe(true);
    applyDecision(h, { type: 'check' });
    expect(h.street).toBe('flop');
    expect(h.board).toHaveLength(3);
    expect(h.toAct).toBe(1); // SB first postflop
  });

  it('enforces min-raise and awards uncontested pots', () => {
    const h = startHand(table([200, 200, 200]), 0, 1, 2, 1);
    applyDecision(h, { type: 'raise', to: 3 }); // below min -> becomes 4
    expect(h.currentBet).toBe(4);
    applyDecision(h, { type: 'raise', to: 10 }); // SB 3-bets to 10 (raise of 6)
    expect(legalActions(h).minRaiseTo).toBe(16);
    applyDecision(h, { type: 'fold' });
    applyDecision(h, { type: 'fold' });
    expect(h.done).toBe(true);
    expect(h.players[1].stack).toBe(206);
    expect(h.net).toEqual([-4, 6, -2]);
  });

  it('heads-up: button is small blind and acts first preflop', () => {
    const h = startHand(table([100, 100]), 0, 1, 2, 1);
    expect(h.sbSeat).toBe(0);
    expect(h.toAct).toBe(0);
    applyDecision(h, { type: 'call' });
    applyDecision(h, { type: 'check' });
    expect(h.toAct).toBe(1); // BB acts first postflop
  });

  it('builds side pots and pays the right players', () => {
    // Seats: 0 (50), 1 (100), 2 (200). Deal order: s1, s2, s0, s1, s2, s0, then burn+flop, burn+turn, burn+river
    // seat0: AA, seat1: KK, seat2: QQ, board blanks
    const deck = deckFrom('Kc Qc Ac Kd Qd Ad 2h 3s 7d 9c 4h 8s Th 2c Jh');
    const h = startHand(table([50, 100, 200]), 0, 1, 2, 1, deck);
    expect(h.players[0].hole.map(String)).toHaveLength(2);
    applyDecision(h, { type: 'raise', to: 50 }); // seat0 all-in 50
    applyDecision(h, { type: 'raise', to: 100 }); // seat1 all-in 100
    applyDecision(h, { type: 'call' }); // seat2 calls 100
    expect(h.done).toBe(true);
    expect(h.board).toHaveLength(5);
    expect(potTotal(h)).toBe(250);
    // Main pot 150 -> seat0 (AA). Side pot 100 -> seat1 (KK).
    expect(h.players[0].stack).toBe(150);
    expect(h.players[1].stack).toBe(100);
    expect(h.players[2].stack).toBe(100);
    const total = h.players.reduce((s, p) => s + p.stack, 0);
    expect(total).toBe(350);
  });

  it('incomplete all-in raise does not reopen action', () => {
    // seat0 100, seat1 (SB) 200, seat2 (BB) 13
    const h = startHand(table([100, 200, 13]), 0, 1, 2, 1);
    applyDecision(h, { type: 'raise', to: 10 }); // BTN opens to 10
    applyDecision(h, { type: 'call' }); // SB calls 10
    applyDecision(h, { type: 'raise', to: 13 }); // BB all-in for 13: raise of 3 < 8
    expect(h.toAct).toBe(0);
    expect(legalActions(h).canRaise).toBe(false);
    applyDecision(h, { type: 'call' });
    expect(legalActions(h).canRaise).toBe(false);
    applyDecision(h, { type: 'call' });
    expect(h.street).toBe('flop');
  });

  it('conserves chips over many random hands', () => {
    for (let t = 0; t < 2000; t++) {
      const stacks = Array.from({ length: 2 + (t % 5) }, () => 20 + Math.floor(Math.random() * 300));
      const h = startHand(table(stacks), t % stacks.length, 1, 2, t);
      const startTotal = stacks.reduce((a, b) => a + b, 0);
      let guard = 0;
      while (!h.done && guard++ < 200) {
        const la = legalActions(h);
        const r = Math.random();
        if (r < 0.15) applyDecision(h, { type: 'fold' });
        else if (r < 0.6) applyDecision(h, { type: la.canCheck ? 'check' : 'call' });
        else applyDecision(h, { type: 'raise', to: la.minRaiseTo + Math.floor(Math.random() * 3) * h.bigBlind * 2 });
      }
      expect(h.done).toBe(true);
      const endTotal = h.players.reduce((s, p) => s + p.stack, 0);
      expect(endTotal).toBe(startTotal);
      expect(h.net.reduce((a, b) => a + b, 0)).toBe(0);
    }
  });
});
