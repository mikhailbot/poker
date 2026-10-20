import type { HandState } from '../engine/game';

/** Running HUD-style stats for one player. Bots read these to estimate ranges. */
export interface PlayerStats {
  hands: number;
  vpip: number;
  pfr: number;
  threeBetOpp: number;
  threeBet: number;
  /** Postflop bets + raises. */
  aggActions: number;
  /** Postflop calls. */
  passiveActions: number;
  sawFlop: number;
  wentToShowdown: number;
  wonAtShowdown: number;
  /** Net chips won. */
  net: number;
}

export const emptyStats = (): PlayerStats => ({
  hands: 0,
  vpip: 0,
  pfr: 0,
  threeBetOpp: 0,
  threeBet: 0,
  aggActions: 0,
  passiveActions: 0,
  sawFlop: 0,
  wentToShowdown: 0,
  wonAtShowdown: 0,
  net: 0,
});

/** Update stats for every seat from a finished hand. */
export function recordHand(stats: PlayerStats[], h: HandState): void {
  for (const p of h.players) {
    if (p.sittingOut) continue;
    const s = stats[p.seat];
    s.hands++;
    s.net += h.net[p.seat];
    const pre = h.actions.filter((a) => a.street === 'preflop' && a.type !== 'post');
    const mine = pre.filter((a) => a.seat === p.seat);
    if (mine.some((a) => a.type === 'call' || a.type === 'raise' || a.type === 'bet')) s.vpip++;
    if (mine.some((a) => a.type === 'raise' || a.type === 'bet')) s.pfr++;

    // 3-bet opportunity: first decision faced exactly one raise
    let raisesBefore = 0;
    let firstDecisionCounted = false;
    for (const a of pre) {
      if (a.seat === p.seat && !firstDecisionCounted) {
        firstDecisionCounted = true;
        if (raisesBefore === 1) {
          s.threeBetOpp++;
          if (a.type === 'raise') s.threeBet++;
        }
      }
      if (a.type === 'raise') raisesBefore++;
    }

    const post = h.actions.filter((a) => a.street !== 'preflop' && a.seat === p.seat);
    s.aggActions += post.filter((a) => a.type === 'bet' || a.type === 'raise').length;
    s.passiveActions += post.filter((a) => a.type === 'call').length;
    const foldedPre = mine.some((a) => a.type === 'fold');
    // "Saw the flop" (or, in draw, got to the draw): still in after the first betting round
    if (!foldedPre && h.actions.some((a) => a.street !== 'preflop')) s.sawFlop++;
    const sd = h.showdown.find((x) => x.seat === p.seat);
    if (sd) {
      s.wentToShowdown++;
      if (h.pots.some((pot) => pot.winners.includes(p.seat))) s.wonAtShowdown++;
    }
  }
}

/** Stats blended with a population prior so small samples don't mislead. */
export function estimate(s: PlayerStats) {
  const w = 20; // prior weight in hands
  const vpip = (s.vpip + 0.26 * w) / (s.hands + w);
  const pfr = (s.pfr + 0.18 * w) / (s.hands + w);
  const threeBet = (s.threeBet + 0.07 * 8) / (s.threeBetOpp + 8);
  const af = (s.aggActions + 1.5 * 6) / (s.passiveActions + 6);
  return { vpip, pfr: Math.min(pfr, vpip), threeBet, af };
}

export const pct = (num: number, den: number) => (den === 0 ? '–' : `${Math.round((100 * num) / den)}`);
