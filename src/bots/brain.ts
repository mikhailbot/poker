import {
  type Decision,
  type HandState,
  type Position,
  legalActions,
  positionOf,
  potTotal,
} from '../engine/game';
import { type Card, rankOf, suitOf } from '../engine/cards';
import { equityVsRanges, preflopPct, type RangeBelief } from './equity';
import { PROFILES, type Profile } from './profiles';
import { estimate, type PlayerStats } from './stats';

export interface BotContext {
  stats: PlayerStats[];
  /** 0..1 current tilt level for this bot. */
  tilt: number;
}

export interface BotChoice {
  decision: Decision;
  /** Short explanation, kept for hand review. */
  note: string;
  equity?: number;
}

const r = Math.random;
const jitter = (x: number, amt = 0.15) => x * (1 + (r() * 2 - 1) * amt);
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** How much wider than average each seat opens. */
const POS_MULT: Record<Position, number> = {
  UTG: 0.55,
  'UTG+1': 0.6,
  MP: 0.7,
  HJ: 0.85,
  CO: 1.2,
  BTN: 2.0,
  SB: 1.4,
  BB: 1.0,
};

/** Apply tilt: plays looser, bluffier and stickier. */
function tilted(p: Profile, tilt: number): Profile {
  if (tilt <= 0.01) return p;
  const t = tilt * p.tilt * 2;
  return {
    ...p,
    vpip: p.vpip * (1 + 0.8 * t),
    pfr: p.pfr * (1 + 0.6 * t),
    threeBet: p.threeBet * (1 + 0.8 * t),
    bluff: clamp(p.bluff + 0.25 * t, 0, 0.7),
    aggression: clamp(p.aggression + 0.15 * t, 0, 1),
    stickiness: p.stickiness * (1 - 0.2 * t),
  };
}

export function decide(h: HandState, seat: number, ctx: BotContext): BotChoice {
  const me = h.players[seat];
  const prof = tilted(PROFILES[me.profileId] ?? PROFILES.tag, ctx.tilt);
  return h.street === 'preflop' ? preflop(h, seat, prof, ctx) : postflop(h, seat, prof, ctx);
}

// ---------------------------------------------------------------- preflop

function preflop(h: HandState, seat: number, p: Profile, ctx: BotContext): BotChoice {
  const me = h.players[seat];
  const la = legalActions(h);
  const bb = h.bigBlind;
  const pos = positionOf(h, seat);
  const hp = preflopPct(me.hole);
  // Omaha hands run closer in equity, so everyone plays more of them
  const wide = h.variant === 'plo' ? 1.45 : 1;
  const acts = h.actions.filter((a) => a.street === 'preflop' && a.type !== 'post');
  const raises = acts.filter((a) => a.type === 'raise').length;
  const limpers = raises === 0 ? acts.filter((a) => a.type === 'call').length : 0;
  const effBB = effectiveStack(h, seat) / bb;
  const mult = POS_MULT[pos];

  const raiseTo = (to: number, note: string): BotChoice => {
    // Commit fully if the raise would use most of the stack
    const total = me.bet + me.stack;
    if (to >= total * 0.45) to = total;
    return { decision: { type: 'raise', to: Math.round(to) }, note };
  };
  const call = (note: string): BotChoice => ({ decision: { type: la.canCheck ? 'check' : 'call' }, note });
  const fold = (note: string): BotChoice =>
    la.canCheck ? { decision: { type: 'check' }, note } : { decision: { type: 'fold' }, note };

  // Short stack: push or fold
  if (effBB <= 13 && la.canRaise) {
    const pushPct = clamp((raises === 0 ? 0.18 * mult + 0.05 : 0.07) * (p.vpip / 23), 0.03, 0.7);
    if (hp <= jitter(pushPct, 0.1)) return raiseTo(la.maxRaiseTo, 'short-stack shove');
    if (la.canCheck) return call('short stack, free check');
    return fold('short stack, not strong enough to shove');
  }

  const openPct = clamp((p.pfr / 100) * mult * wide, 0.02, 0.85);
  const playPct = clamp((p.vpip / 100) * mult * wide, openPct, 0.95);

  if (raises === 0) {
    if (pos === 'BB') {
      // Limped pot or walk
      if (la.canRaise && hp <= jitter(openPct * 0.45)) return raiseTo(bb * (3 + limpers), 'raises the limpers');
      return call('checks the option');
    }
    if (limpers > 0) {
      if (la.canRaise && hp <= jitter(openPct * 0.75)) return raiseTo(bb * (p.openSize + 1 + limpers), 'isolation raise');
      if (hp <= jitter(playPct * (pos === 'SB' ? 1.1 : 0.9))) return call('over-limps');
      return fold('folds to the limp');
    }
    // First in
    if (hp <= jitter(openPct)) {
      if (r() < p.limp * 0.3) return call('limps a strong hand');
      const size = pos === 'SB' ? p.openSize + 0.5 : p.openSize;
      return raiseTo(bb * jitter(size, 0.06), 'open raise');
    }
    if (hp <= jitter(playPct) && r() < p.limp) return call('open limps');
    // Occasional loose steal from late position
    if ((pos === 'BTN' || pos === 'CO' || pos === 'SB') && hp < openPct * 1.6 && r() < p.bluff * 0.5)
      return raiseTo(bb * p.openSize, 'steal attempt');
    return fold('folds preflop');
  }

  // Facing a raise
  const raiser = h.lastAggressor;
  const rs = estimate(ctx.stats[raiser]);
  const raiserPos = positionOf(h, raiser);
  const raiserRange = clamp(rs.pfr * POS_MULT[raiserPos] * (raises >= 2 ? 0.35 : 1), 0.02, 0.9);
  const sizeBB = h.currentBet / bb;
  const callers = acts.filter((a) => a.type === 'call').length;
  const toCallFrac = la.callAmount / (me.stack + 1);

  if (raises === 1) {
    const threeBetPct = clamp(((p.threeBet * wide) / 100) * (pos === 'BTN' || pos === 'SB' || pos === 'BB' ? 1.2 : 0.9), 0.015, 0.4);
    // value range scales with how wide the raiser is
    const valueLine = threeBetPct * clamp(raiserRange / 0.2, 0.6, 1.8);
    if (la.canRaise && hp <= jitter(valueLine)) {
      const ip = pos !== 'SB' && pos !== 'BB';
      return raiseTo(h.currentBet * (ip ? 3 : 3.8) + callers * h.currentBet, '3-bets');
    }
    // light 3-bet bluffs with suited/blocker hands just outside the call range
    if (la.canRaise && hp > valueLine && hp < valueLine + 0.18 && isBluffable3bet(me.hole) && r() < p.bluff * 0.6)
      return raiseTo(h.currentBet * 3.2, '3-bet bluff');

    let callPct = Math.min(playPct * 0.85, raiserRange * 1.4);
    callPct *= clamp(3 / sizeBB, 0.45, 1.2); // bigger opens -> tighter
    if (pos === 'BB') callPct *= 1.7; // getting a price
    if (callers > 0) callPct *= 1.1; // multiway implied odds
    callPct *= 1 / p.stickiness;
    if (toCallFrac > 0.2) callPct *= 0.6;
    if (hp <= jitter(callPct)) return call('calls the raise');
    return fold('folds to the raise');
  }

  // Facing a 3-bet or more
  const amOriginalRaiser = acts.some((a) => a.seat === seat && a.type === 'raise');
  const tier = raises >= 3 ? 0.012 : 0.025;
  const valueLine = tier * (p.threeBet / 7) ** 0.6;
  if (la.canRaise && hp <= jitter(valueLine, 0.1)) {
    return raiseTo(raises >= 3 ? la.maxRaiseTo : h.currentBet * 2.3, raises >= 3 ? 'jams over the 4-bet' : '4-bet');
  }
  let callPct = ((raises >= 3 ? 0.02 : amOriginalRaiser ? 0.07 : 0.035) * wide * wide) / p.stickiness;
  callPct *= clamp(raiserRange / 0.06, 0.7, 2.2);
  if (toCallFrac > 0.35) callPct *= 0.6;
  if (hp <= jitter(callPct)) return call(raises >= 3 ? 'calls the 4-bet' : 'calls the 3-bet');
  return fold(raises >= 3 ? 'folds to the 4-bet' : 'folds to the 3-bet');
}

function isBluffable3bet(hole: Card[]) {
  if (hole.length > 2) {
    // Omaha: suited ace (nut-flush blocker) or a connected rundown
    const ace = hole.find((c) => rankOf(c) === 12);
    return ace !== undefined && hole.some((c) => c !== ace && suitOf(c) === suitOf(ace));
  }
  const [a, b] = hole;
  const suited = suitOf(a) === suitOf(b);
  const hi = Math.max(rankOf(a), rankOf(b));
  const lo = Math.min(rankOf(a), rankOf(b));
  return suited && (hi === 12 || hi - lo <= 2);
}

function effectiveStack(h: HandState, seat: number) {
  const me = h.players[seat];
  const mine = me.stack + me.bet;
  let biggest = 0;
  for (const o of h.players) if (o.seat !== seat && !o.folded && !o.sittingOut) biggest = Math.max(biggest, o.stack + o.bet);
  return Math.min(mine, biggest);
}

// ---------------------------------------------------------------- ranges

export function beliefFor(h: HandState, v: number, stats: PlayerStats[]): RangeBelief {
  const s = estimate(stats[v]);
  const pre = h.actions.filter((a) => a.street === 'preflop' && a.type !== 'post');
  let raisesSeen = 0;
  type Cls = 'none' | 'open' | '3bet' | '4bet' | 'callRaise' | 'limp';
  let cls = 'none' as Cls;
  for (const a of pre) {
    if (a.seat === v) {
      if (a.type === 'raise') cls = raisesSeen === 0 ? 'open' : raisesSeen === 1 ? '3bet' : '4bet';
      else if (a.type === 'call') cls = raisesSeen === 0 ? 'limp' : cls === 'open' || cls === '3bet' ? cls : 'callRaise';
    }
    if (a.type === 'raise') raisesSeen++;
  }
  const posM = POS_MULT[positionOf(h, v)];
  let lo = 0;
  let hi = 1;
  switch (cls) {
    case 'open':
      hi = clamp(s.pfr * posM * 1.1, 0.04, 0.85);
      break;
    case '3bet':
      hi = clamp(s.threeBet * 1.2, 0.02, 0.35);
      break;
    case '4bet':
      hi = clamp(s.threeBet * 0.45, 0.012, 0.15);
      break;
    case 'callRaise':
      lo = clamp(s.threeBet * 0.4, 0, 0.05);
      hi = clamp(s.vpip * posM * 0.85, 0.08, 0.9);
      break;
    case 'limp':
      lo = clamp(s.pfr * 0.4, 0, 0.12);
      hi = clamp(s.vpip * posM, 0.15, 0.95);
      break;
    case 'none':
      // Checked the big blind (or posted and saw a free flop)
      lo = clamp(s.pfr * 0.4, 0, 0.1);
      hi = 1;
  }

  // Postflop: weigh their bets/raises/calls this hand
  let narrow = 1;
  for (const a of h.actions) {
    if (a.seat !== v || a.street === 'preflop') continue;
    if (a.type === 'raise') narrow += 1.6;
    else if (a.type === 'bet') narrow += 0.9;
    else if (a.type === 'call') narrow += 0.45;
  }
  // Big current bet narrows more
  const pv = h.players[v];
  const pot = potTotal(h) - pv.bet;
  if (pv.bet > 0 && pv.bet > 0.8 * pot) narrow += 0.6;
  const bluffy = clamp(0.12 + 0.12 * (s.af - 1.5) + 0.5 * Math.max(0, s.pfr - 0.2), 0.05, 0.55);
  return { lo, hi, narrow, bluffy };
}

// ---------------------------------------------------------------- postflop

function postflop(h: HandState, seat: number, p: Profile, ctx: BotContext): BotChoice {
  const me = h.players[seat];
  const la = legalActions(h);
  const opps = h.players.filter((o) => o.seat !== seat && !o.folded && !o.sittingOut);
  const nOpp = opps.length;
  const beliefs = opps.map((o) => beliefFor(h, o.seat, ctx.stats));
  const sims = h.variant === 'plo' ? (nOpp > 2 ? 180 : 300) : nOpp > 2 ? 500 : 800;
  const E = equityVsRanges(me.hole, h.board, beliefs, sims, h.variant);
  const pot = potTotal(h);
  const street = h.street;
  const draw = drawStrength(me.hole, h.board);
  const wet = boardWetness(h.board);

  // Equity a hand needs to be "value" depends on how many players it must beat
  const valueT = jitter(0.58 / (1 + 0.42 * (nOpp - 1)) + (street === 'river' ? 0.03 : 0), 0.06);
  const strongT = Math.min(0.93, valueT + 0.17 / Math.sqrt(nOpp));

  const sizeBet = (base: number) => {
    let f = base + 0.15 * p.sizing + (wet - 0.5) * 0.2;
    f = jitter(clamp(f, 0.25, 1.6), 0.1);
    return Math.round(Math.max(h.bigBlind, pot * f));
  };
  const bet = (frac: number, note: string): BotChoice => {
    let amount = sizeBet(frac);
    const total = me.bet + me.stack;
    if (amount >= total * 0.7) amount = total;
    return { decision: { type: 'raise', to: amount }, note, equity: E };
  };
  const check = (note: string): BotChoice => ({ decision: { type: 'check' }, note, equity: E });

  // ---- No bet to face
  if (la.canCheck) {
    if (!la.canRaise) return check('checks');
    if (E >= strongT && r() < p.slowplay && street !== 'river') return check('slowplays a monster');
    if (E >= valueT && r() < p.aggression) {
      const frac = E > strongT ? 0.72 : 0.55;
      return bet(street === 'river' && E > strongT && p.sizing > 0.5 && r() < 0.3 ? 1.3 : frac, 'value bet');
    }
    const wasAggressor = h.preflopAggressor === seat;
    if (street === 'flop' && wasAggressor && r() < p.cbet * (nOpp === 1 ? 1 : nOpp === 2 ? 0.6 : 0.35) * (wet > 0.6 ? 0.8 : 1.1))
      return bet(0.4, 'continuation bet');
    if (street === 'turn' && wasAggressor && lastStreetBetBy(h, seat, 'flop') && (E > valueT * 0.8 || draw > 0.3) && r() < p.aggression * 0.6)
      return bet(0.6, 'barrels the turn');
    const bluffBase = p.bluff * (nOpp === 1 ? 1 : nOpp === 2 ? 0.45 : 0.15);
    if (street !== 'river' && draw > 0.3 && r() < bluffBase * 2) return bet(0.6, 'semi-bluff');
    if (street === 'river' && E < 0.2 && r() < bluffBase * 1.3) return bet(0.75, 'river bluff');
    // Everyone checked to us: take a stab at the pot
    const checkedTo = opps.every(
      (o) => o.allIn || h.actions.some((a) => a.street === street && a.seat === o.seat && a.type === 'check'),
    );
    const stabChance = (bluffBase * 1.2 + 0.12 * p.aggression) * (nOpp === 1 ? 1 : 0.35);
    if (checkedTo && nOpp <= 2 && E < valueT && r() < stabChance) return bet(0.5, 'stabs after everyone checks');
    if (nOpp === 1 && street !== 'river' && E < valueT * 0.6 && r() < bluffBase * 0.7) return bet(0.5, 'bluffs');
    if (E >= valueT) return check(checkedTo ? 'checks back to control the pot' : 'checks a decent hand');
    return check('checks');
  }

  // ---- Facing a bet
  const toCall = la.callAmount;
  const potOdds = toCall / (pot + toCall);
  // Realisation: on earlier streets, weak hands realise less equity; draws realise more
  const realise = street === 'river' ? 1 : 1 + 0.12 * (1 - draw) - 0.1 * draw;
  let need = potOdds * p.stickiness * realise;
  const commitFrac = toCall / Math.max(1, me.stack);
  if (commitFrac > 0.5) need += 0.04 * p.stickiness; // big decisions: be a bit more careful
  need = jitter(need, 0.08);

  if (la.canRaise && E >= strongT && r() < p.aggression * 0.85) {
    const to = h.currentBet * jitter(2.7 + p.sizing * 0.4, 0.08) + (pot - h.currentBet) * 0.3;
    const total = me.bet + me.stack;
    return { decision: { type: 'raise', to: to >= total * 0.6 ? total : Math.round(to) }, note: 'raises for value', equity: E };
  }
  if (E >= need) {
    if (la.canRaise && street !== 'river' && draw > 0.35 && nOpp === 1 && r() < p.bluff * 0.5)
      return { decision: { type: 'raise', to: Math.round(h.currentBet * 2.8) }, note: 'semi-bluff raise', equity: E };
    return { decision: { type: 'call' }, note: E > valueT ? 'calls with a strong hand' : 'calls, getting the right price', equity: E };
  }
  if (la.canRaise && nOpp === 1 && street !== 'river' && commitFrac < 0.3 && r() < p.bluff * 0.15)
    return { decision: { type: 'raise', to: Math.round(h.currentBet * 3) }, note: 'bluff raise', equity: E };
  return { decision: { type: 'fold' }, note: 'folds, not enough equity', equity: E };
}

function lastStreetBetBy(h: HandState, seat: number, street: string) {
  return h.actions.some((a) => a.street === street && a.seat === seat && (a.type === 'bet' || a.type === 'raise'));
}

/** 0..1 rough strength of draws (flush/straight) — used for semi-bluffing and realisation. */
export function drawStrength(hole: Card[], board: Card[]): number {
  if (board.length >= 5) return 0;
  if (hole.length > 2) {
    // Omaha: draws must use exactly two hole cards, so take the best pair
    let best = 0;
    for (let a = 0; a < hole.length; a++)
      for (let b = a + 1; b < hole.length; b++) best = Math.max(best, drawStrength([hole[a], hole[b]], board));
    return best;
  }
  const all = [...hole, ...board];
  const suits = [0, 0, 0, 0];
  for (const c of all) suits[suitOf(c)]++;
  let s = 0;
  const flushSuit = suits.findIndex((n) => n === 4);
  if (flushSuit >= 0 && hole.some((c) => suitOf(c) === flushSuit)) s += 0.55;
  let mask = 0;
  for (const c of all) mask |= 1 << rankOf(c);
  if (mask & (1 << 12)) mask |= 1; // ace low (bit 0 doubles as 2 here; fine for a heuristic)
  let best = 0;
  for (let lo = 0; lo <= 8; lo++) {
    let cnt = 0;
    for (let k = 0; k < 5; k++) if (mask & (1 << (lo + k))) cnt++;
    best = Math.max(best, cnt);
  }
  if (best === 4) s += 0.35;
  return clamp(s, 0, 1);
}

/** 0..1 how coordinated the board is. */
export function boardWetness(board: Card[]): number {
  if (board.length === 0) return 0.5;
  const suits = [0, 0, 0, 0];
  for (const c of board) suits[suitOf(c)]++;
  const maxSuit = Math.max(...suits);
  const ranks = board.map(rankOf).sort((a, b) => a - b);
  let connected = 0;
  for (let i = 1; i < ranks.length; i++) if (ranks[i] - ranks[i - 1] <= 2 && ranks[i] !== ranks[i - 1]) connected++;
  return clamp(0.15 + (maxSuit >= 3 ? 0.4 : maxSuit === 2 ? 0.2 : 0) + connected * 0.15, 0, 1);
}
