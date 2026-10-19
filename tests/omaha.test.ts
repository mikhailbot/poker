import { describe, expect, it } from 'vitest';
import { parseCards } from '../src/engine/cards';
import { describeScore } from '../src/engine/evaluator';
import { evaluateOmaha } from '../src/engine/omaha';
import { applyDecision, legalActions, startHand, type SeatConfig } from '../src/engine/game';
import { botAct, createSession, dealNext, DEFAULT_SETTINGS } from '../src/session';

const om = (hole: string, board: string) => describeScore(evaluateOmaha(parseCards(hole), parseCards(board)));

describe('omaha evaluator', () => {
  it('needs exactly two hole cards for a flush', () => {
    expect(om('Ah 2c 3d 4s', 'Kh Qh Jh 9h 8c')).not.toMatch(/Flush/);
    expect(om('Ah 2h 3d 4s', 'Kh Qh Jh 9c 8c')).toBe('Flush, ace high');
  });
  it('uses exactly three board cards', () => {
    // Board has four to a straight but only one hole card fits; trips on board need two hole cards
    expect(om('9c 2d 3h 4s', 'Ts Jd Qh Kc 5d')).not.toMatch(/Straight/);
    expect(om('Ac Kd 7h 7s', 'Qs Qd Qh 2c 5d')).toBe('Full house, queens full of sevens');
    expect(om('Ac Kd 8h 3s', 'Qs Qd Qh Qc 5d')).toBe('Three queens');
  });
});

describe('pot-limit betting', () => {
  const seats: SeatConfig[] = Array.from({ length: 6 }, (_, i) => ({ name: `P${i}`, isHuman: false, profileId: 'tag', stack: 200 }));
  it('caps a raise at the size of the pot', () => {
    const h = startHand(seats, 0, 1, 2, 1, undefined, 'plo');
    expect(h.players.every((p) => p.hole.length === 4)).toBe(true);
    // UTG first in: pot is 3, call 2 -> max raise to 2 + 3 + 2 = 7
    expect(legalActions(h).maxRaiseTo).toBe(7);
    applyDecision(h, { type: 'raise', to: 100 });
    expect(h.currentBet).toBe(7);
    // Next player: pot 10, call 7 -> raise to 7 + 10 + 7 = 24
    expect(legalActions(h).maxRaiseTo).toBe(24);
  });

  it('plays full PLO sessions without errors', () => {
    const s = createSession({ ...DEFAULT_SETTINGS, variant: 'plo' }, 'x', false);
    for (let i = 0; i < 200; i++) {
      const h = dealNext(s);
      let guard = 0;
      while (!h.done && guard++ < 300) botAct(s);
      expect(h.done).toBe(true);
      expect(h.net.reduce((a, b) => a + b, 0)).toBe(0);
    }
  }, 60000);
});
