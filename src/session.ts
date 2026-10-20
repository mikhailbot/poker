import { decide, decideDraw, type BotChoice } from './bots/brain';
import { BOT_NAMES, PROFILE_IDS } from './bots/profiles';
import { emptyStats, recordHand, type PlayerStats } from './bots/stats';
import { type Decision, type HandState, applyDecision, applyDraw, nextSeat, startHand } from './engine/game';
import type { Variant } from './engine/omaha';

export interface SeatInfo {
  name: string;
  isHuman: boolean;
  profileId: string;
  stack: number;
  /** Total chips bought in (for net tracking). */
  buyIns: number;
  tilt: number;
}

export interface Settings {
  /** Texas hold'em or pot-limit Omaha. */
  variant: Variant;
  smallBlind: number;
  bigBlind: number;
  /** Starting stack in big blinds. */
  buyInBB: number;
  /** Table line-up: profile ids for the five bots, or 'random'. */
  lineup: string[] | 'random';
  /** Which preset line-up this is, for the settings screen. */
  table?: TableKind;
  /** Five-card draw: number of draws per hand (1-3). */
  draws?: number;
}

/** Table line-ups: which five personalities sit with you. */
export const TABLES = {
  lively: ['rec', 'station', 'lag', 'tag', 'maniac'],
  mixed: ['nit', 'tag', 'lag', 'station', 'maniac'],
  tough: ['tag', 'tag', 'lag', 'lag', 'nit'],
} satisfies Record<string, string[]>;
export type TableKind = keyof typeof TABLES | 'random';

export const DEFAULT_SETTINGS: Settings = {
  variant: 'holdem',
  smallBlind: 1,
  bigBlind: 2,
  buyInBB: 100,
  lineup: TABLES.lively,
  table: 'lively',
};

export interface Session {
  settings: Settings;
  seats: SeatInfo[];
  stats: PlayerStats[];
  button: number;
  handCount: number;
  hand: HandState | null;
  /** Bot reasoning for the current hand, per action index. */
  notes: Record<number, string>;
}

function shuffle<T>(xs: T[]): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function createSession(settings: Settings = DEFAULT_SETTINGS, humanName = 'You', includeHuman = true): Session {
  const names = shuffle(BOT_NAMES);
  const profiles =
    settings.lineup === 'random'
      ? Array.from({ length: 5 }, () => PROFILE_IDS[Math.floor(Math.random() * PROFILE_IDS.length)])
      : shuffle(settings.lineup);
  const stack = settings.buyInBB * settings.bigBlind;
  const seats: SeatInfo[] = [];
  const total = 6;
  for (let i = 0; i < total; i++) {
    const human = includeHuman && i === 0;
    const profileId = human ? 'human' : profiles[(i - (includeHuman ? 1 : 0)) % profiles.length];
    seats.push({ name: human ? humanName : names[i], isHuman: human, profileId, stack, buyIns: stack, tilt: 0 });
  }
  return {
    settings,
    seats,
    stats: seats.map(() => emptyStats()),
    button: Math.floor(Math.random() * total),
    handCount: 0,
    hand: null,
    notes: {},
  };
}

/** Bots reload when short; returns names of bots that rebought. */
function topUpBots(s: Session) {
  const full = s.settings.buyInBB * s.settings.bigBlind;
  for (const seat of s.seats) {
    if (seat.isHuman) continue;
    if (seat.stack < full * 0.4) {
      const add = full - seat.stack;
      seat.stack += add;
      seat.buyIns += add;
    }
  }
}

export function canDeal(s: Session) {
  return s.seats.filter((x) => x.stack > 0).length >= 2;
}

export function dealNext(s: Session): HandState {
  topUpBots(s);
  if (s.hand) {
    // move button to the next seat with chips
    const h = s.hand;
    s.button = nextSeat(h, s.button, (p) => s.seats[p.seat].stack > 0);
  }
  s.handCount++;
  s.notes = {};
  s.hand = startHand(
    s.seats.map((x) => ({ name: x.name, isHuman: x.isHuman, profileId: x.profileId, stack: x.stack })),
    s.button,
    s.settings.smallBlind,
    s.settings.bigBlind,
    s.handCount,
    undefined,
    s.settings.variant ?? 'holdem',
    s.settings.draws ?? 2,
  );
  if (s.hand.done) finishHand(s);
  return s.hand;
}

export function act(s: Session, d: Decision) {
  const h = s.hand!;
  applyDecision(h, d);
  if (h.done) finishHand(s);
}

/** Five-card draw: the player to act throws away these positions and draws replacements. */
export function drawCards(s: Session, discard: number[]) {
  const h = s.hand!;
  applyDraw(h, discard);
  if (h.done) finishHand(s);
}

/** Play the rest of the hand instantly (used once you've folded). */
export function runOut(s: Session) {
  let guard = 0;
  while (s.hand && !s.hand.done && !s.hand.players[s.hand.toAct].isHuman && guard++ < 200) botAct(s);
}

export function botAct(s: Session): BotChoice {
  const h = s.hand!;
  const seat = h.toAct;
  if (h.street === 'draw') {
    const d = decideDraw(h, seat, { stats: s.stats, tilt: s.seats[seat].tilt });
    s.notes[h.actions.length] = d.note;
    drawCards(s, d.discard);
    return { decision: { type: 'check' }, note: d.note };
  }
  const choice = decide(h, seat, { stats: s.stats, tilt: s.seats[seat].tilt });
  s.notes[h.actions.length] = choice.note + (choice.equity !== undefined ? ` (equity ${Math.round(choice.equity * 100)}%)` : '');
  act(s, choice.decision);
  return choice;
}

function finishHand(s: Session) {
  const h = s.hand!;
  recordHand(s.stats, h);
  const bb = s.settings.bigBlind;
  h.players.forEach((p, i) => {
    const seat = s.seats[i];
    seat.stack = p.stack;
    // Tilt: big losses build it, it fades over time
    seat.tilt *= 0.88;
    const lostBB = -h.net[i] / bb;
    if (lostBB > 25) seat.tilt = Math.min(1, seat.tilt + lostBB / 100);
    if (h.net[i] / bb > 25) seat.tilt *= 0.6;
  });
}

export function rebuyHuman(s: Session) {
  const seat = s.seats.find((x) => x.isHuman)!;
  const full = s.settings.buyInBB * s.settings.bigBlind;
  if (seat.stack >= full) return;
  const add = full - seat.stack;
  seat.stack += add;
  seat.buyIns += add;
}
