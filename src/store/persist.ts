import type { Card } from '../engine/cards';
import { type HandState, type Position, describeAction, positionOf } from '../engine/game';
import type { Session } from '../session';

const KEY_SESSION = 'pt.session.v1';
const KEY_HISTORY = 'pt.history.v1';
const KEY_PREFS = 'pt.prefs.v1';
const MAX_HISTORY = 300;

export interface Prefs {
  speed: 'relaxed' | 'normal' | 'fast';
  showOdds: boolean;
  revealStyles: boolean;
  autoDeal: boolean;
  /** Show your estimated chance of winning next to the pot odds. */
  showChance: boolean;
  /** After a hand, show the cards of players who folded or lost without showing. */
  revealMucked: boolean;
  /** Five-card draw: draws per hand (1-3). */
  drawRounds: number;
}

export const DEFAULT_PREFS: Prefs = {
  speed: 'normal',
  showOdds: true,
  revealStyles: false,
  autoDeal: true,
  showChance: true,
  revealMucked: true,
  drawRounds: 2,
};

export interface HistoryPlayer {
  seat: number;
  name: string;
  profileId: string;
  isHuman: boolean;
  position: Position;
  hole: Card[];
  start: number;
  net: number;
  folded: boolean;
}

export interface HistoryEntry {
  id: number;
  variant?: 'holdem' | 'plo' | 'draw';
  time: number;
  bigBlind: number;
  board: Card[];
  players: HistoryPlayer[];
  lines: { street: string; text: string; note?: string; seat: number }[];
  showdown: { seat: number; label: string }[];
  winners: { seat: number; amount: number }[];
  heroNet: number;
  /** Five-card draw: draws per hand. */
  draws?: number;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable — the game still works, it just won't persist */
  }
}

export const loadPrefs = (): Prefs => ({ ...DEFAULT_PREFS, ...read<Partial<Prefs>>(KEY_PREFS, {}) });
export const savePrefs = (p: Prefs) => write(KEY_PREFS, p);

type GameId = 'holdem' | 'plo' | 'draw';
const KEY_CURRENT = 'pt.currentGame.v1';
const sessionKey = (g: GameId) => `pt.session.${g}.v2`;

/** One saved session per game, so switching games resumes where you left off. */
export function saveSession(s: Session) {
  const g = (s.settings.variant ?? 'holdem') as GameId;
  write(sessionKey(g), { ...s, hand: null, notes: {} });
  write(KEY_CURRENT, g);
}

export function loadCurrentGame(): GameId {
  const g = read<GameId | null>(KEY_CURRENT, null);
  if (g) return g;
  // Older versions kept a single session: carry it over
  const legacy = read<Session | null>(KEY_SESSION, null);
  return ((legacy?.settings?.variant as GameId) ?? 'holdem') as GameId;
}

export function loadSession(game: GameId = loadCurrentGame()): Session | null {
  let s = read<Session | null>(sessionKey(game), null);
  if (!s) {
    const legacy = read<Session | null>(KEY_SESSION, null);
    if (legacy && (legacy.settings?.variant ?? 'holdem') === game) s = legacy;
  }
  if (!s || !Array.isArray(s.seats) || s.seats.length !== 6) return null;
  return s;
}

/** A short summary of a saved game, for the game picker. */
export function sessionSummary(game: GameId): { hands: number; netBB: number } | null {
  const s = loadSession(game);
  if (!s) return null;
  const hero = s.seats.find((x) => x.isHuman);
  return { hands: s.handCount, netBB: hero ? (hero.stack - hero.buyIns) / s.settings.bigBlind : 0 };
}

export const loadHistory = (): HistoryEntry[] => read<HistoryEntry[]>(KEY_HISTORY, []);

export function clearHistory() {
  try {
    localStorage.removeItem(KEY_HISTORY);
  } catch {
    /* ignore */
  }
}

/** Remove everything this app has saved: every game's session, history, stats and settings. */
export function clearAll() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('pt.')) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

export function toHistory(h: HandState, notes: Record<number, string>): HistoryEntry {
  const winnings = new Map<number, number>();
  for (const pot of h.pots) {
    const share = pot.amount / pot.winners.length;
    for (const w of pot.winners) winnings.set(w, (winnings.get(w) ?? 0) + share);
  }
  const hero = h.players.find((p) => p.isHuman);
  return {
    id: h.handId,
    variant: h.variant,
    draws: h.draws,
    time: Date.now(),
    bigBlind: h.bigBlind,
    board: h.board,
    players: h.players
      .filter((p) => !p.sittingOut)
      .map((p) => ({
        seat: p.seat,
        name: p.name,
        profileId: p.profileId,
        isHuman: p.isHuman,
        position: positionOf(h, p.seat),
        hole: p.hole,
        start: h.startStacks[p.seat],
        net: h.net[p.seat],
        folded: p.folded,
      })),
    lines: h.actions.map((a, i) => ({
      street: a.type === 'draw' ? `draw${a.round ?? 1}` : a.street,
      text: describeAction(h, a),
      note: notes[i],
      seat: a.seat,
    })),
    showdown: h.showdown.map((x) => ({ seat: x.seat, label: x.label })),
    winners: [...winnings.entries()].map(([seat, amount]) => ({ seat, amount: Math.round(amount) })),
    heroNet: hero ? h.net[hero.seat] : 0,
  };
}

export function appendHistory(entry: HistoryEntry): HistoryEntry[] {
  const list = [entry, ...loadHistory()].slice(0, MAX_HISTORY);
  write(KEY_HISTORY, list);
  return list;
}
