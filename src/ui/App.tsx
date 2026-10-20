import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Decision } from '../engine/game';
import type { Variant } from '../engine/omaha';
import {
  act,
  botAct,
  canDeal,
  createSession,
  dealNext,
  DEFAULT_SETTINGS,
  drawCards,
  rebuyHuman,
  runOut,
  TABLES,
  type Session,
  type TableKind,
} from '../session';
import {
  appendHistory,
  clearAll,
  clearHistory,
  loadHistory,
  loadPrefs,
  loadSession,
  type Prefs,
  savePrefs,
  saveSession,
  sessionSummary,
  toHistory,
} from '../store/persist';
import { ActionBar } from './ActionBar';
import { DrawBar } from './DrawBar';
import { GAMES, GamePicker } from './GamePicker';
import { HistorySheet, SettingsSheet, StatsSheet } from './Sheets';
import { Table } from './Table';

const BOT_DELAY: Record<Prefs['speed'], [number, number]> = {
  relaxed: [1100, 2300],
  normal: [550, 1300],
  fast: [150, 350],
};
/** Once you're out of the hand there's nothing to read, so bots play fast. */
const FOLDED_DELAY: [number, number] = [70, 140];
/** After you fold, how long the finished hand stays up before the next deal. */
const PAUSE_SHOWDOWN = 8000; // cards were shown: time to study them
const PAUSE_NO_SHOWDOWN = 4500;

type Panel = null | 'history' | 'stats' | 'settings' | 'games';

/** A fresh session for a game, at the given table. */
const freshSession = (game: Variant, table: TableKind) =>
  createSession({ ...DEFAULT_SETTINGS, variant: game, table, lineup: table === 'random' ? 'random' : TABLES[table] });

export function App() {
  const sessionRef = useRef<Session>(loadSession() ?? createSession());
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const [history, setHistory] = useState(loadHistory);
  const [panel, setPanel] = useState<Panel>(null);
  const [thinking, setThinking] = useState(0);
  /** Countdown (ms) until the next auto-deal, or 0 when none is running. */
  const [autoIn, setAutoIn] = useState(0);
  const [held, setHeld] = useState(false);
  /** Five-card draw: positions marked to swap. */
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const s = sessionRef.current;
  const h = s.hand;
  const hero = s.seats.find((x) => x.isHuman)!;
  const heroBusted = !!h?.done && hero.stack === 0;
  const heroFolded = !!h?.players[0].folded;
  const variant: Variant = s.settings.variant ?? 'holdem';

  const onHandDone = useCallback(() => {
    const hand = sessionRef.current.hand!;
    setHistory(appendHistory(toHistory(hand, sessionRef.current.notes)));
    saveSession(sessionRef.current);
  }, []);

  const deal = useCallback(() => {
    const sess = sessionRef.current;
    if (!canDeal(sess)) return;
    sess.settings.draws = prefsRef.current.drawRounds;
    dealNext(sess);
    setHeld(false);
    setPicked(new Set());
    setAutoIn(0);
    if (sess.hand!.done) onHandDone();
    rerender();
  }, [onHandDone]);

  useEffect(() => {
    if (!sessionRef.current.hand) deal();
  }, [deal]);

  // Bots act; finished hands auto-advance
  useEffect(() => {
    if (!h) return;
    if (h.done) {
      // If you stayed in to the end, wait so you can study the cards; only auto-deal after you fold
      if (!prefs.autoDeal || heroBusted || panel || held || !h.players[0].folded) {
        setAutoIn(0);
        return;
      }
      const wait = h.showdown.length ? PAUSE_SHOWDOWN : PAUSE_NO_SHOWDOWN;
      setAutoIn(wait);
      const t = setTimeout(deal, wait);
      return () => clearTimeout(t);
    }
    const p = h.players[h.toAct];
    if (p.isHuman) return;
    const [lo, hi] = h.players[0].folded ? FOLDED_DELAY : BOT_DELAY[prefs.speed];
    const delay = lo + Math.random() * (hi - lo);
    setThinking(delay);
    const t = setTimeout(() => {
      botAct(sessionRef.current);
      setThinking(0);
      if (sessionRef.current.hand!.done) onHandDone();
      rerender();
    }, delay);
    return () => clearTimeout(t);
  }, [h, h?.actions.length, h?.done, prefs.autoDeal, prefs.speed, heroBusted, panel, held, deal, onHandDone]);

  const onAct = (d: Decision) => {
    act(sessionRef.current, d);
    if (sessionRef.current.hand!.done) onHandDone();
    rerender();
  };

  const skip = () => {
    runOut(sessionRef.current);
    setThinking(0);
    if (sessionRef.current.hand!.done) onHandDone();
    rerender();
  };

  const updatePrefs = (p: Prefs) => {
    setPrefs(p);
    savePrefs(p);
  };

  /** Switch to another game, resuming its saved session if there is one. */
  const switchGame = (game: Variant) => {
    saveSession(sessionRef.current); // keeps this game's stacks (the hand in progress is abandoned)
    sessionRef.current = loadSession(game) ?? freshSession(game, s.settings.table ?? 'lively');
    sessionRef.current.hand = null;
    saveSession(sessionRef.current);
    setPanel(null);
    setPicked(new Set());
    deal();
  };

  /** Start the current game again at a new table. */
  const newTable = (table: TableKind) => {
    sessionRef.current = freshSession(variant, table);
    saveSession(sessionRef.current);
    setPanel(null);
    setPicked(new Set());
    deal();
  };

  const onDraw = (discard: number[]) => {
    drawCards(sessionRef.current, discard);
    setPicked(new Set());
    if (sessionRef.current.hand!.done) onHandDone();
    rerender();
  };

  const togglePick = (i: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const heroTurn = h && !h.done && h.players[h.toAct].isHuman;
  const net = hero.stack - hero.buyIns;
  const bb = s.settings.bigBlind;

  return (
    <div className="app">
      <header className="topbar">
        <button className="game-chip" onClick={() => setPanel('games')} aria-label="Switch game">
          <svg className="swap-icon" viewBox="0 0 20 20" width="16" height="16" aria-hidden>
            <path
              d="M4 7h11m0 0-3-3m3 3-3 3M16 13H5m0 0 3-3m-3 3 3 3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="game-name">{GAMES.find((g) => g.id === variant)!.short}</span>
        </button>
        <button className="session" onClick={() => setPanel('stats')} aria-label="Session stats">
          <span className={`session-net ${net > 0 ? 'up' : net < 0 ? 'down' : ''}`}>
            {net >= 0 ? '+' : '−'}
            {Math.abs(net / bb).toFixed(1)}
            <small> BB</small>
          </span>
          <span className="session-hands">Hand {s.handCount}</span>
        </button>
        <div className="top-icons">
          <button className="icon-btn" onClick={() => setPanel('history')} aria-label="Hand history">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
              <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4v4h4M12 7.5V12l3 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button className="icon-btn" onClick={() => setPanel('settings')} aria-label="Settings">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
              <path d="M4 7h10M18 7h2M4 17h2M10 17h10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="16" cy="7" r="2" fill="none" stroke="currentColor" strokeWidth="2" />
              <circle cx="8" cy="17" r="2" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>
        </div>
      </header>

      <main className="main">
        <Table
          session={s}
          revealStyles={prefs.revealStyles}
          revealMucked={prefs.revealMucked}
          thinking={thinking}
          selected={picked}
          onToggle={togglePick}
        />
      </main>

      <footer className="dock">
        {heroTurn && h && h.street === 'draw' && (
          <DrawBar hand={h} selected={picked} onSelect={setPicked} onDraw={onDraw} showHint={prefs.showChance} />
        )}
        {heroTurn && h && h.street !== 'draw' && (
          <ActionBar hand={h} stats={s.stats} showOdds={prefs.showOdds} showChance={prefs.showChance} onAct={onAct} />
        )}

        {h && !h.done && !heroTurn && heroFolded && (
          <div className="dock-row">
            <span className="dock-note">Playing out the hand</span>
            <button className="btn btn-quiet" onClick={skip}>
              Skip to result
            </button>
          </div>
        )}
        {h && !h.done && !heroTurn && !heroFolded && (
          <div className="dock-row">
            <span className="dock-note">{h.players[h.toAct].name} is thinking</span>
          </div>
        )}

        {h?.done && heroBusted && (
          <div className="dock-row">
            <span className="dock-note">You're out of chips.</span>
            <button
              className="btn btn-primary"
              onClick={() => {
                rebuyHuman(sessionRef.current);
                saveSession(sessionRef.current);
                deal();
              }}
            >
              Rebuy {s.settings.buyInBB} BB
            </button>
          </div>
        )}
        {h?.done && !heroBusted && (
          <div className="dock-row">
            {hero.stack < s.settings.buyInBB * bb * 0.5 && (
              <button
                className="btn btn-quiet"
                onClick={() => {
                  rebuyHuman(sessionRef.current);
                  saveSession(sessionRef.current);
                  rerender();
                }}
              >
                Top up to {s.settings.buyInBB} BB
              </button>
            )}
            {autoIn > 0 && !held && (
              <button className="btn btn-quiet" onClick={() => setHeld(true)}>
                Hold
              </button>
            )}
            <button className="btn btn-primary btn-countdown" onClick={deal}>
              {autoIn > 0 && !held && (
                <span key={h.handId} className="countdown-fill" style={{ animationDuration: `${autoIn}ms` }} aria-hidden />
              )}
              <span className="btn-label">Deal next hand</span>
            </button>
          </div>
        )}
      </footer>

      {panel === 'history' && <HistorySheet history={history} onClose={() => setPanel(null)} />}
      {panel === 'stats' && <StatsSheet session={s} onClose={() => setPanel(null)} />}
      {panel === 'settings' && (
        <SettingsSheet
          prefs={prefs}
          gameName={GAMES.find((g) => g.id === variant)!.name}
          onPrefs={updatePrefs}
          onResetGame={() => newTable(s.settings.table ?? 'lively')}
          onClearHistory={() => {
            clearHistory();
            setHistory([]);
            setPanel(null);
          }}
          onResetAll={() => {
            clearAll();
            setHistory([]);
            setPrefs(loadPrefs());
            sessionRef.current = freshSession('holdem', 'lively');
            saveSession(sessionRef.current);
            setPanel(null);
            deal();
          }}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'games' && (
        <GamePicker
          current={variant}
          table={s.settings.table ?? 'mixed'}
          summaries={{ holdem: sessionSummary('holdem'), plo: sessionSummary('plo'), draw: sessionSummary('draw') }}
          drawRounds={prefs.drawRounds}
          onDrawRounds={(n) => updatePrefs({ ...prefs, drawRounds: n })}
          onPickGame={switchGame}
          onNewTable={newTable}
          onClose={() => setPanel(null)}
        />
      )}
    </div>
  );
}
