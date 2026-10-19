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
}

export const DEFAULT_PREFS: Prefs = { speed: 'normal', showOdds: true, revealStyles: false, autoDeal: true };

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
  time: number;
  bigBlind: number;
  board: Card[];
  players: HistoryPlayer[];
  lines: { street: string; text: string; note?: string; seat: number }[];
  showdown: { seat: number; label: string }[];
  winners: { seat: number; amount: number }[];
  heroNet: number;
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

/** Persist everything except the hand in progress. */
export function saveSession(s: Session) {
  write(KEY_SESSION, { ...s, hand: null, notes: {} });
}

export function loadSession(): Session | null {
  const s = read<Session | null>(KEY_SESSION, null);
  if (!s || !Array.isArray(s.seats) || s.seats.length !== 6) return null;
  return s;
}

export const loadHistory = (): HistoryEntry[] => read<HistoryEntry[]>(KEY_HISTORY, []);

export function clearAll() {
  try {
    localStorage.removeItem(KEY_SESSION);
    localStorage.removeItem(KEY_HISTORY);
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
    lines: h.actions.map((a, i) => ({ street: a.street, text: describeAction(h, a), note: notes[i], seat: a.seat })),
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
