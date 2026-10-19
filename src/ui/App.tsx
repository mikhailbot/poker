import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Decision } from '../engine/game';
import {
  act,
  botAct,
  canDeal,
  createSession,
  dealNext,
  DEFAULT_SETTINGS,
  rebuyHuman,
  type Session,
} from '../session';
import {
  appendHistory,
  loadHistory,
  loadPrefs,
  loadSession,
  type Prefs,
  savePrefs,
  saveSession,
  toHistory,
} from '../store/persist';
import { ActionBar } from './ActionBar';
import { HistorySheet, SettingsSheet, StatsSheet } from './Sheets';
import { Table } from './Table';

const BOT_DELAY: Record<Prefs['speed'], [number, number]> = {
  relaxed: [1100, 2400],
  normal: [600, 1400],
  fast: [150, 350],
};
const NEXT_HAND_DELAY = { relaxed: 4500, normal: 3200, fast: 1600 };

type Panel = null | 'history' | 'stats' | 'settings';

export function App() {
  const sessionRef = useRef<Session>(loadSession() ?? createSession());
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [history, setHistory] = useState(loadHistory);
  const [panel, setPanel] = useState<Panel>(null);
  const [thinking, setThinking] = useState(0);
  const s = sessionRef.current;
  const h = s.hand;
  const hero = s.seats.find((x) => x.isHuman)!;
  const heroBusted = !!h?.done && hero.stack === 0;

  const onHandDone = useCallback(() => {
    const hand = sessionRef.current.hand!;
    setHistory(appendHistory(toHistory(hand, sessionRef.current.notes)));
    saveSession(sessionRef.current);
  }, []);

  const deal = useCallback(() => {
    const sess = sessionRef.current;
    if (!canDeal(sess)) return;
    dealNext(sess);
    if (sess.hand!.done) onHandDone();
    rerender();
  }, [onHandDone]);

  // First hand
  useEffect(() => {
    if (!sessionRef.current.hand) deal();
  }, [deal]);

  // Bots act; finished hands auto-advance
  useEffect(() => {
    if (!h) return;
    if (h.done) {
      if (!prefs.autoDeal || heroBusted || panel) return;
      const t = setTimeout(deal, NEXT_HAND_DELAY[prefs.speed]);
      return () => clearTimeout(t);
    }
    const p = h.players[h.toAct];
    if (p.isHuman) return;
    const [lo, hi] = BOT_DELAY[prefs.speed];
    const delay = lo + Math.random() * (hi - lo);
    setThinking(delay);
    const t = setTimeout(() => {
      botAct(sessionRef.current);
      setThinking(0);
      if (sessionRef.current.hand!.done) onHandDone();
      rerender();
    }, delay);
    return () => clearTimeout(t);
  }, [h, h?.actions.length, h?.done, prefs.autoDeal, prefs.speed, heroBusted, panel, deal, onHandDone]);

  const onAct = (d: Decision) => {
    act(sessionRef.current, d);
    if (sessionRef.current.hand!.done) onHandDone();
    rerender();
  };

  const updatePrefs = (p: Prefs) => {
    setPrefs(p);
    savePrefs(p);
  };

  const newSession = (lineup: 'default' | 'random') => {
    sessionRef.current = createSession({ ...DEFAULT_SETTINGS, lineup: lineup === 'random' ? 'random' : DEFAULT_SETTINGS.lineup });
    saveSession(sessionRef.current);
    setPanel(null);
    deal();
  };

  const heroTurn = h && !h.done && h.players[h.toAct].isHuman;
  // Seat stacks update when a hand finishes, so this is the result up to the last completed hand
  const net = hero.stack - hero.buyIns;
  const bb = s.settings.bigBlind;

  return (
    <div className="app">
      <header className="topbar">
        <button className="icon-btn" onClick={() => setPanel('settings')} aria-label="Settings">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
            <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <div className="title">
          <span className="blinds">
            {s.settings.smallBlind}/{s.settings.bigBlind} No-limit hold'em
          </span>
          <button className="session-net" onClick={() => setPanel('stats')}>
            <span>Hand {s.handCount}</span>
            <span className={net > 0 ? 'up' : net < 0 ? 'down' : ''}>
              {net >= 0 ? '+' : '−'}
              {Math.abs(net / bb).toFixed(1)} BB
            </span>
          </button>
        </div>
        <button className="icon-btn" onClick={() => setPanel('history')} aria-label="Hand history">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
            <path d="M12 7v5l3 2M21 12a9 9 0 1 1-3-6.7M21 4v4h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      <main className="main">
        <Table session={s} revealStyles={prefs.revealStyles} thinking={thinking} />
      </main>

      <footer className="dock">
        {heroTurn && h && <ActionBar hand={h} showOdds={prefs.showOdds} onAct={onAct} />}
        {h?.done && heroBusted && (
          <div className="dock-msg">
            <span>You're out of chips.</span>
            <button
              className="btn btn-raise"
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
          <div className="dock-msg">
            {hero.stack < s.settings.buyInBB * bb * 0.5 && (
              <button
                className="btn btn-ghost"
                onClick={() => {
                  rebuyHuman(sessionRef.current);
                  rerender();
                }}
              >
                Top up to {s.settings.buyInBB} BB
              </button>
            )}
            <button className="btn btn-call" onClick={deal}>
              Deal next hand
            </button>
          </div>
        )}
        {h && !h.done && !heroTurn && (
          <div className="dock-msg waiting">
            {h.players[0].folded ? 'You folded. Watching the hand…' : `Waiting for ${h.players[h.toAct].name}…`}
          </div>
        )}
      </footer>

      {panel === 'history' && <HistorySheet history={history} onClose={() => setPanel(null)} />}
      {panel === 'stats' && <StatsSheet session={s} onClose={() => setPanel(null)} />}
      {panel === 'settings' && (
        <SettingsSheet prefs={prefs} onPrefs={updatePrefs} onNewSession={newSession} onClose={() => setPanel(null)} />
      )}
    </div>
  );
}
