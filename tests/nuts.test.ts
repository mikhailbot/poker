import { describe, expect, it } from 'vitest';
import { parseCards, cardToString } from '../src/engine/cards';
import { nutsFor } from '../src/engine/nuts';

const nuts = (v: 'holdem' | 'plo', board: string) => nutsFor(v, parseCards(board))!;

describe('the nuts', () => {
  it("hold'em", () => {
    expect(nuts('holdem', 'Ah Kh Qh 7c 2d').label).toBe('Royal flush');
    expect(nuts('holdem', 'Ah Kh 7h 7c 2d').label).toBe('Four sevens');
    expect(nuts('holdem', 'As 9d 7c 4h 2s').label).toBe('Straight, five high'); // 3-5 makes the wheel
    const s = nuts('holdem', '9s 8d 7c 2h 2s');
    expect(s.label).toBe('Four twos');
    expect(nuts('holdem', 'Ks Td 7c 4h 2s').label).toBe('Three kings');
    expect(nuts('holdem', 'Js Td 7c 4h 2s').label).toBe('Straight, jack high'); // 9-8
  });
  it('the board itself can be the nuts', () => {
    const n = nuts('holdem', 'Ts Js Qs Ks As');
    expect(n.label).toBe('Royal flush');
    expect(n.cards).toHaveLength(0);
  });
  it('Omaha must use two hole cards', () => {
    // Four hearts on board: in hold'em one heart makes a flush, in Omaha you need two
    expect(nuts('plo', 'Ah Kh 7h 4h 2c').label).toBe('Flush, ace high'); // needs two hearts in hand; no straight flush is possible
    expect(nuts('plo', 'As Ad Ac 7h 2c').label).toBe('Four aces');
    const n = nuts('plo', 'Qh Jh 4c 7d 2s');
    expect(n.label).toBe('Three queens');
    expect(n.cards.map(cardToString).every((c) => c[0] === 'Q')).toBe(true);
  });
  it('none before the flop or in draw', () => {
    expect(nutsFor('holdem', [])).toBeNull();
    expect(nutsFor('draw', parseCards('Ah Kh Qh Jh Th'))).toBeNull();
  });
});
