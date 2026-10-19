import { type Card, cardToString, shuffledDeck } from './cards';
import { evaluate, handName } from './evaluator';

export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'post';

export interface Action {
  seat: number;
  type: ActionType;
  /** For bet/raise/post: total amount put in this street after the action ("raise to"). For call: chips added. */
  amount: number;
  street: Street;
  allIn: boolean;
}

export interface Player {
  seat: number;
  name: string;
  isHuman: boolean;
  profileId: string;
  stack: number;
  hole: Card[];
  folded: boolean;
  allIn: boolean;
  /** Chips put in on the current street. */
  bet: number;
  /** Chips put in this hand (all streets). */
  committed: number;
  /** Has acted since the last full raise on this street. */
  hasActed: boolean;
  /** Not dealt in (stack 0 and not rebought). */
  sittingOut: boolean;
}

export interface PotResult {
  amount: number;
  winners: number[];
  eligible: number[];
}

export interface Showdown {
  seat: number;
  hole: Card[];
  score: number;
  label: string;
}

export interface HandState {
  handId: number;
  button: number;
  sbSeat: number;
  bbSeat: number;
  smallBlind: number;
  bigBlind: number;
  players: Player[];
  board: Card[];
  deck: Card[];
  street: Street;
  /** Seat to act, or -1 if the hand is over. */
  toAct: number;
  currentBet: number;
  /** Size of the last full bet/raise increment on this street. */
  lastRaiseSize: number;
  /** Seat that made the last bet/raise on the current street. */
  lastAggressor: number;
  /** Seat that made the last raise preflop (the "preflop aggressor"). */
  preflopAggressor: number;
  actions: Action[];
  done: boolean;
  pots: PotResult[];
  showdown: Showdown[];
  /** Net chip change per seat for this hand, filled when done. */
  net: number[];
  startStacks: number[];
}

export interface SeatConfig {
  name: string;
  isHuman: boolean;
  profileId: string;
  stack: number;
}

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  callAmount: number; // chips needed to call (0 if check)
  canRaise: boolean;
  minRaiseTo: number; // total street bet after a min raise
  maxRaiseTo: number; // all-in total
  isBet: boolean; // no bet yet this street -> "bet" rather than "raise"
}

export type Decision =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'raise'; to: number }; // bet or raise to a street total

const n = (h: HandState) => h.players.length;

export function nextSeat(h: HandState, from: number, pred: (p: Player) => boolean): number {
  for (let i = 1; i <= n(h); i++) {
    const s = (from + i) % n(h);
    if (pred(h.players[s])) return s;
  }
  return -1;
}

const inHand = (p: Player) => !p.sittingOut && !p.folded;
const canAct = (p: Player) => inHand(p) && !p.allIn;

export function startHand(
  seats: SeatConfig[],
  button: number,
  smallBlind: number,
  bigBlind: number,
  handId: number,
  deck: Card[] = shuffledDeck(),
): HandState {
  const players: Player[] = seats.map((s, i) => ({
    seat: i,
    name: s.name,
    isHuman: s.isHuman,
    profileId: s.profileId,
    stack: s.stack,
    hole: [],
    folded: false,
    allIn: false,
    bet: 0,
    committed: 0,
    hasActed: false,
    sittingOut: s.stack <= 0,
  }));

  const h: HandState = {
    handId,
    button,
    sbSeat: -1,
    bbSeat: -1,
    smallBlind,
    bigBlind,
    players,
    board: [],
    deck: [...deck],
    street: 'preflop',
    toAct: -1,
    currentBet: 0,
    lastRaiseSize: bigBlind,
    lastAggressor: -1,
    preflopAggressor: -1,
    actions: [],
    done: false,
    pots: [],
    showdown: [],
    net: players.map(() => 0),
    startStacks: players.map((p) => p.stack),
  };

  const active = players.filter((p) => !p.sittingOut);
  if (active.length < 2) throw new Error('Need at least two players');

  // Button must be an active seat
  if (players[button].sittingOut) h.button = nextSeat(h, button, (p) => !p.sittingOut);

  if (active.length === 2) {
    // Heads-up: button posts the small blind and acts first preflop
    h.sbSeat = h.button;
    h.bbSeat = nextSeat(h, h.button, (p) => !p.sittingOut);
  } else {
    h.sbSeat = nextSeat(h, h.button, (p) => !p.sittingOut);
    h.bbSeat = nextSeat(h, h.sbSeat, (p) => !p.sittingOut);
  }

  // Deal two cards each, starting left of the button
  for (let round = 0; round < 2; round++) {
    let s = h.button;
    for (let k = 0; k < active.length; k++) {
      s = nextSeat(h, s, (p) => !p.sittingOut);
      h.players[s].hole.push(h.deck.pop()!);
    }
  }

  post(h, h.sbSeat, smallBlind);
  post(h, h.bbSeat, bigBlind);
  h.currentBet = bigBlind;
  h.lastRaiseSize = bigBlind;
  h.lastAggressor = h.bbSeat;

  h.toAct = nextSeat(h, h.bbSeat, canAct);
  // Rare: everyone all-in from blinds
  if (isRoundComplete(h)) advance(h);
  return h;
}

function post(h: HandState, seat: number, amount: number) {
  const p = h.players[seat];
  const amt = Math.min(amount, p.stack);
  p.stack -= amt;
  p.bet += amt;
  p.committed += amt;
  if (p.stack === 0) p.allIn = true;
  h.actions.push({ seat, type: 'post', amount: amt, street: 'preflop', allIn: p.allIn });
}

export function legalActions(h: HandState): LegalActions {
  const p = h.players[h.toAct];
  const toCall = Math.min(h.currentBet - p.bet, p.stack);
  const maxRaiseTo = p.bet + p.stack;
  const minRaiseTo = Math.min(h.currentBet + h.lastRaiseSize, maxRaiseTo);
  // Can raise if action is open to this player and they have chips beyond a call
  const othersCanRespond = h.players.some((o) => o.seat !== p.seat && canAct(o));
  const canRaise = !p.hasActed && p.stack > h.currentBet - p.bet && othersCanRespond;
  return {
    canFold: toCall > 0,
    canCheck: toCall === 0,
    callAmount: toCall,
    canRaise,
    minRaiseTo,
    maxRaiseTo,
    isBet: h.currentBet === 0,
  };
}

/** Clamp/normalise a decision to something legal. */
export function normalize(h: HandState, d: Decision): Decision {
  const la = legalActions(h);
  if (d.type === 'fold') return la.canCheck ? { type: 'check' } : d;
  if (d.type === 'check') return la.canCheck ? d : { type: 'fold' };
  if (d.type === 'call') return la.canCheck ? { type: 'check' } : d;
  if (!la.canRaise) return la.canCheck ? { type: 'check' } : { type: 'call' };
  let to = Math.round(d.to);
  if (to >= la.maxRaiseTo) to = la.maxRaiseTo;
  else if (to < la.minRaiseTo) to = la.minRaiseTo;
  return { type: 'raise', to };
}

export function applyDecision(h: HandState, raw: Decision): void {
  if (h.done) throw new Error('Hand is over');
  const d = normalize(h, raw);
  const p = h.players[h.toAct];
  const street = h.street;

  switch (d.type) {
    case 'fold':
      p.folded = true;
      h.actions.push({ seat: p.seat, type: 'fold', amount: 0, street, allIn: false });
      break;
    case 'check':
      h.actions.push({ seat: p.seat, type: 'check', amount: 0, street, allIn: false });
      break;
    case 'call': {
      const amt = Math.min(h.currentBet - p.bet, p.stack);
      p.stack -= amt;
      p.bet += amt;
      p.committed += amt;
      if (p.stack === 0) p.allIn = true;
      h.actions.push({ seat: p.seat, type: 'call', amount: amt, street, allIn: p.allIn });
      break;
    }
    case 'raise': {
      const add = d.to - p.bet;
      const isBet = h.currentBet === 0;
      p.stack -= add;
      p.committed += add;
      p.bet = d.to;
      if (p.stack === 0) p.allIn = true;
      const raiseSize = d.to - h.currentBet;
      if (raiseSize >= h.lastRaiseSize) {
        // Full raise: reopens action for everyone else
        h.lastRaiseSize = raiseSize;
        for (const o of h.players) if (o.seat !== p.seat) o.hasActed = false;
      }
      h.currentBet = Math.max(h.currentBet, d.to);
      h.lastAggressor = p.seat;
      if (street === 'preflop') h.preflopAggressor = p.seat;
      h.actions.push({ seat: p.seat, type: isBet ? 'bet' : 'raise', amount: d.to, street, allIn: p.allIn });
      break;
    }
  }
  p.hasActed = true;

  const remaining = h.players.filter(inHand);
  if (remaining.length === 1) {
    finish(h);
    return;
  }
  if (isRoundComplete(h)) advance(h);
  else h.toAct = nextSeat(h, p.seat, canAct);
}

function isRoundComplete(h: HandState): boolean {
  const actors = h.players.filter(canAct);
  if (actors.length === 0) return true;
  // Lone player with chips (everyone else all-in) only needs to act if facing a bet
  if (actors.length === 1) return actors[0].bet >= h.currentBet;
  return actors.every((p) => p.hasActed && p.bet === h.currentBet);
}

function advance(h: HandState) {
  // Move to the next street, or run out the board if betting is closed.
  while (true) {
    if (h.street === 'river') {
      finish(h);
      return;
    }
    h.street = h.street === 'preflop' ? 'flop' : h.street === 'flop' ? 'turn' : 'river';
    h.deck.pop(); // burn
    const count = h.street === 'flop' ? 3 : 1;
    for (let i = 0; i < count; i++) h.board.push(h.deck.pop()!);
    for (const p of h.players) {
      p.bet = 0;
      p.hasActed = false;
    }
    h.currentBet = 0;
    h.lastRaiseSize = h.bigBlind;
    h.lastAggressor = -1;

    const actors = h.players.filter(canAct);
    if (actors.length >= 2) {
      h.toAct = nextSeat(h, h.button, canAct);
      return;
    }
    // 0 or 1 player can act: no more betting, keep dealing
  }
}

function finish(h: HandState) {
  h.done = true;
  h.toAct = -1;
  const contenders = h.players.filter(inHand);

  if (contenders.length === 1) {
    const w = contenders[0];
    const total = h.players.reduce((s, p) => s + p.committed, 0);
    w.stack += total;
    h.pots = [{ amount: total, winners: [w.seat], eligible: [w.seat] }];
  } else {
    // Make sure the board is complete (all-in run-outs are handled in advance())
    while (h.board.length < 5) {
      h.deck.pop();
      h.board.push(h.deck.pop()!);
    }
    const scores = new Map<number, number>();
    for (const p of contenders) {
      const score = evaluate([...p.hole, ...h.board]);
      scores.set(p.seat, score);
      h.showdown.push({ seat: p.seat, hole: p.hole, score, label: handName(score) });
    }
    h.pots = buildPots(h);
    for (const pot of h.pots) {
      let best = -1;
      for (const s of pot.eligible) best = Math.max(best, scores.get(s)!);
      const winners = pot.eligible.filter((s) => scores.get(s) === best);
      pot.winners = winners;
      const share = Math.floor(pot.amount / winners.length);
      let odd = pot.amount - share * winners.length;
      // Odd chips go to the first winner left of the button
      const ordered = orderFromButton(h, winners);
      for (const s of ordered) {
        h.players[s].stack += share + (odd > 0 ? 1 : 0);
        if (odd > 0) odd--;
      }
    }
  }
  h.net = h.players.map((p, i) => p.stack - h.startStacks[i]);
}

function orderFromButton(h: HandState, seats: number[]): number[] {
  return [...seats].sort(
    (a, b) => ((a - h.button - 1 + n(h)) % n(h)) - ((b - h.button - 1 + n(h)) % n(h)),
  );
}

export function buildPots(h: HandState): PotResult[] {
  const contenders = h.players.filter(inHand);
  const levels = [...new Set(contenders.map((p) => p.committed))].sort((a, b) => a - b);
  const pots: PotResult[] = [];
  let prev = 0;
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i];
    const isLast = i === levels.length - 1;
    let amount = 0;
    for (const p of h.players) {
      const c = isLast ? p.committed : Math.min(p.committed, level);
      amount += Math.max(0, c - Math.min(p.committed, prev));
    }
    const eligible = contenders.filter((p) => p.committed >= level).map((p) => p.seat);
    if (amount > 0) {
      // Merge with previous pot if same eligible set (e.g. folded money)
      const last = pots[pots.length - 1];
      if (last && last.eligible.length === eligible.length && last.eligible.every((s, k) => s === eligible[k]))
        last.amount += amount;
      else pots.push({ amount, winners: [], eligible });
    }
    prev = level;
  }
  return pots;
}

// ---------- helpers for UI / bots ----------

export const potTotal = (h: HandState) => h.players.reduce((s, p) => s + p.committed, 0);

/** Pot excluding the current street's bets (what's "in the middle"). */
export const potBeforeStreet = (h: HandState) => h.players.reduce((s, p) => s + p.committed - p.bet, 0);

export type Position = 'BTN' | 'SB' | 'BB' | 'UTG' | 'UTG+1' | 'MP' | 'HJ' | 'CO';

export function positionOf(h: HandState, seat: number): Position {
  const active = h.players.filter((p) => !p.sittingOut).map((p) => p.seat);
  const count = active.length;
  // index clockwise from button
  const idx = (active.indexOf(seat) - active.indexOf(h.button) + count) % count;
  if (count === 2) return idx === 0 ? 'BTN' : 'BB';
  if (idx === 0) return 'BTN';
  if (idx === 1) return 'SB';
  if (idx === 2) return 'BB';
  const fromEnd = count - idx; // 1 = CO, 2 = HJ, ...
  const late: Position[] = ['CO', 'HJ', 'MP', 'UTG+1', 'UTG'];
  if (idx === 3) return 'UTG';
  return late[fromEnd - 1] ?? 'MP';
}

export function describeAction(h: HandState, a: Action): string {
  const p = h.players[a.seat];
  const name = p.isHuman ? 'You' : p.name;
  // "You call" vs "Vera calls"
  const v = (verb: string) => (p.isHuman ? verb : verb === 'raise to' ? 'raises to' : `${verb}s`);
  const ai = a.allIn ? ' (all-in)' : '';
  switch (a.type) {
    case 'post':
      return `${name} ${v('post')} ${a.amount}${ai}`;
    case 'fold':
      return `${name} ${v('fold')}`;
    case 'check':
      return `${name} ${v('check')}`;
    case 'call':
      return `${name} ${v('call')} ${a.amount}${ai}`;
    case 'bet':
      return `${name} ${v('bet')} ${a.amount}${ai}`;
    case 'raise':
      return `${name} ${v('raise to')} ${a.amount}${ai}`;
  }
}

export const cardsToString = (cs: Card[]) => cs.map(cardToString).join(' ');
