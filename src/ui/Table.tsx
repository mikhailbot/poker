import { useLayoutEffect, useRef, useState } from 'react';
import { PREFLOP } from '../bots/preflopTable';
import { PROFILES } from '../bots/profiles';
import { handKey } from '../engine/cards';
import { describeScore } from '../engine/evaluator';
import { scoreHand } from '../engine/omaha';
import { nutsFor } from '../engine/nuts';
import { describePlo, ploPct } from '../bots/plo';
import { drawPct } from '../bots/draw';
import { type HandState, describeAction, positionOf, potTotal } from '../engine/game';
import type { Session } from '../session';
import { CardView } from './CardView';

const STREET: Record<string, string> = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River' };
const VERB: Record<string, string> = { fold: 'Folded', check: 'Check', call: 'Call', bet: 'Bet', raise: 'Raise', post: '' };

/** What a seat did most recently on the current street. */
function streetAction(h: HandState, seat: number) {
  for (let i = h.actions.length - 1; i >= 0; i--) {
    const a = h.actions[i];
    if (a.seat !== seat) continue;
    if (a.type === 'fold') return { word: 'Folded', kind: 'fold' };
    if (a.street !== h.street || a.type === 'draw') return null; // draw counts are shown on their own line
    if (a.type === 'post') return { word: a.amount === h.smallBlind ? 'SB' : 'BB', kind: 'post' };
    return { word: a.allIn ? 'All-in' : VERB[a.type], kind: a.allIn ? 'allin' : a.type };
  }
  return null;
}

function streetName(h: HandState): string {
  if (h.variant !== 'draw') return STREET[h.street] ?? '';
  const many = h.draws > 1;
  if (h.street === 'preflop') return many ? 'Before draw 1' : 'Before the draw';
  if (h.street === 'draw') return many ? `Draw ${h.drawsDone + 1} of ${h.draws}` : 'Drawing';
  return many ? `After draw ${h.drawsDone}` : 'After the draw';
}

/** Five-card draw: how many cards a player took in each draw, in words ("Drew 3, 1"). */
function drawWords(h: HandState, seat: number): string | null {
  const counts = h.actions.filter((x) => x.seat === seat && x.type === 'draw').map((x) => x.amount);
  if (counts.length === 0) return null;
  if (counts.length === 1 && counts[0] === 0) return 'Stood pat';
  return `Drew ${counts.map((c) => (c === 0 ? 'pat' : c)).join(', ')}`;
}

interface Props {
  session: Session;
  revealStyles: boolean;
  /** Show folded players' cards once the hand is over. */
  revealMucked: boolean;
  /** Current bot think time in ms (drives the timer ring), 0 when idle. */
  thinking: number;
  /** Five-card draw: positions in your hand marked to swap, and how to toggle one. */
  selected?: Set<number>;
  onToggle?: (index: number) => void;
}

export function Table({ session, revealStyles, revealMucked, thinking, selected, onToggle }: Props) {
  const h = session.hand;
  if (!h) return null;
  return (
    <div className={`table is-${h.variant}`}>
      <Opponents h={h} session={session} revealStyles={revealStyles} revealMucked={revealMucked} thinking={thinking} />
      <Stage h={h} revealMucked={revealMucked} selected={selected} onToggle={onToggle} />
      <Hero h={h} />
    </div>
  );
}

// ------------------------------------------------------------ opponents

function Opponents({ h, session, revealStyles, revealMucked, thinking }: { h: HandState } & Props) {
  const winners = new Set(h.done ? h.pots.filter((p) => p.eligible.length > 1 || h.pots.length === 1).flatMap((p) => p.winners) : []);
  const shown = new Set(h.showdown.map((s) => s.seat));
  return (
    <ol className="opps" aria-label="Opponents in acting order after you">
      {h.players.slice(1).map((p) => {
        const i = p.seat;
        const seat = session.seats[i];
        const act = streetAction(h, i);
        const active = !h.done && h.toAct === i;
        const reveal = h.done && shown.has(i);
        const mucked = h.done && !reveal && revealMucked && p.hole.length > 0;
        const cls = ['opp', `hue-${i}`, active && 'active', p.folded && 'folded', winners.has(i) && 'winner'].filter(Boolean).join(' ');
        return (
          <li key={i} className={cls}>
            <div className="token" aria-hidden>
              {active && thinking > 0 && (
                <svg className="timer" viewBox="0 0 44 44" key={h.actions.length}>
                  <circle cx="22" cy="22" r="20" style={{ animationDuration: `${thinking}ms` }} />
                </svg>
              )}
              <span>{seat.name[0]}</span>
              {h.button === i && <b className="dealer">D</b>}
            </div>
            <div className="opp-name">{seat.name}</div>
            <div className="opp-line">
              <span className="opp-stack">{p.stack === 0 && p.allIn ? 'All-in' : p.stack}</span>
              <span className="opp-pos">{positionOf(h, i)}</span>
            </div>
            {h.variant === 'draw' && <div className="opp-drew">{!p.folded ? drawWords(h, i) ?? '' : ''}</div>}
            <div className="opp-status">
              {reveal || mucked ? (
                <span className={`mini-cards ${mucked ? 'mucked' : ''}`} title={mucked ? 'Folded hand' : undefined}>
                  {p.hole.map((c, k) => (
                    <CardView key={k} card={c} size="xs" />
                  ))}
                </span>
              ) : p.folded ? (
                <span className="pill pill-fold">Folded</span>
              ) : p.bet > 0 && !h.done ? (
                <span className={`pill pill-${act?.kind ?? 'post'}`}>
                  {act && act.kind !== 'post' ? `${act.word} ` : ''}
                  {p.bet}
                </span>
              ) : act && !h.done ? (
                <span className={`pill pill-${act.kind}`}>{act.word}</span>
              ) : (
                <span className="cardbacks" aria-label="Holding cards">
                  <i />
                  <i />
                </span>
              )}
            </div>
            {revealStyles && PROFILES[seat.profileId] && <div className="opp-style">{PROFILES[seat.profileId].style}</div>}
          </li>
        );
      })}
    </ol>
  );
}

// ------------------------------------------------------------ stage

function Stage({
  h,
  revealMucked,
  selected,
  onToggle,
}: {
  h: HandState;
  revealMucked: boolean;
  selected?: Set<number>;
  onToggle?: (index: number) => void;
}) {
  const last = [...h.actions].reverse().find((a) => a.type !== 'post');
  const pot = h.done ? h.pots.reduce((s, p) => s + p.amount, 0) : potTotal(h);
  // Fade the bottom edge of the result when there's more to scroll to
  const tickerRef = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const checkOverflow = () => {
    const t = tickerRef.current;
    if (t) setMore(t.scrollHeight - t.scrollTop - t.clientHeight > 4);
  };
  useLayoutEffect(checkOverflow, [h.done, h.handId, h.actions.length]);
  return (
    <section className={`stage ${h.done ? 'is-done' : ''} ${more ? 'has-more' : ''}`} aria-label="Board">
      <div className="stage-head">
        <Progress h={h} />
        <span className="pot">
          <small>Pot</small>
          {pot}
        </span>
      </div>
      <div className="tray">
        {h.variant === 'draw' ? (
          <DrawHand h={h} selected={selected} onToggle={onToggle} />
        ) : (
          <div className="board">
            {[0, 1, 2, 3, 4].map((i) => (
              <CardView key={`${i}-${h.board[i] ?? 'x'}`} card={h.board[i]} size="lg" delay={i < 3 ? i * 70 : 0} />
            ))}
          </div>
        )}
      </div>
      <div className="ticker" aria-live="polite" ref={tickerRef} onScroll={checkOverflow}>
        <div className="ticker-inner">
          {h.done ? <Result h={h} revealMucked={revealMucked} /> : last ? describeAction(h, last) : `Blinds ${h.smallBlind}/${h.bigBlind}`}
        </div>
      </div>
    </section>
  );
}

/** Where the hand is: a label plus one segment per betting round or draw. */
function Progress({ h }: { h: HandState }) {
  const steps =
    h.variant === 'draw'
      ? 1 + 2 * h.draws // bet, then draw + bet for each draw
      : 4;
  let at: number;
  if (h.variant === 'draw') at = h.street === 'preflop' ? 0 : h.street === 'draw' ? 1 + 2 * h.drawsDone : 2 * h.drawsDone;
  else at = ['preflop', 'flop', 'turn', 'river'].indexOf(h.street);
  if (h.done) at = steps; // all complete
  const label = h.done ? (h.showdown.length ? 'Showdown' : 'Hand over') : streetName(h);
  return (
    <span className="progress">
      <span className="street">{label}</span>
      <span className="steps" aria-hidden>
        {Array.from({ length: steps }, (_, i) => (
          <i key={i} className={i < at ? 'past' : i === at ? 'now' : ''} />
        ))}
      </span>
    </span>
  );
}

/** Five-card draw: there's no board, so your hand takes centre stage (and is where you pick discards). */
function DrawHand({ h, selected, onToggle }: { h: HandState; selected?: Set<number>; onToggle?: (index: number) => void }) {
  const me = h.players[0];
  const picking = !h.done && h.street === 'draw' && h.toAct === 0 && !!onToggle;
  // Show high cards first, but keep each card's real position for discarding
  const order = me.hole.map((c, i) => ({ c, i })).sort((a, b) => b.c - a.c);
  return (
    <div className={`board draw-hand ${picking ? 'picking' : ''}`} aria-label="Your hand">
      {order.map(({ c, i }) => (
        <CardView
          key={`${h.handId}-${i}-${c}`}
          card={c}
          size="lg"
          dim={me.folded}
          selected={picking && selected?.has(i)}
          onClick={picking ? () => onToggle!(i) : undefined}
        />
      ))}
    </div>
  );
}

function Result({ h, revealMucked }: { h: HandState; revealMucked: boolean }) {
  const won = new Map<number, number>();
  for (const pot of h.pots) {
    if (pot.eligible.length === 1 && h.pots.length > 1) continue; // uncalled bet returned
    for (const w of pot.winners) won.set(w, (won.get(w) ?? 0) + Math.floor(pot.amount / pot.winners.length));
  }
  if (won.size === 0 && h.pots[0]) won.set(h.pots[0].winners[0], h.pots[0].amount);
  // Everyone who showed down without winning anything, best hand first
  const losers = h.showdown.filter((sd) => !won.has(sd.seat)).sort((a, b) => b.score - a.score);
  const who = (seat: number) => (h.players[seat].isHuman ? 'You' : h.players[seat].name);
  return (
    <div className="result">
      {[...won.entries()].map(([seat, amt]) => {
        const p = h.players[seat];
        const sd = h.showdown.find((s) => s.seat === seat);
        return (
          <div key={seat} className={p.isHuman ? 'result-me' : ''}>
            <strong>
              {p.isHuman ? 'You win' : `${p.name} wins`} {amt}
            </strong>
            {/* Winner's cards: shown at showdown, or (when not shown) only if mucked hands are revealed */}
            {(sd || p.isHuman || revealMucked) && (
              <span className="winner-hand">
                <span className="loser-cards">
                  {[...p.hole].sort((a, b) => b - a).map((c, k) => (
                    <CardView key={k} card={c} size="sm" />
                  ))}
                </span>
                {sd ? (
                  <span>{sd.label}</span>
                ) : (
                  <span className="no-show">
                    {handRead(h, p.hole)}
                    <small>Everyone else folded</small>
                  </span>
                )}
              </span>
            )}
          </div>
        );
      })}
      {losers.length > 0 && (
        <ul className="losers">
          {losers.map((sd) => (
            <li key={sd.seat}>
              <span className="loser-name">{who(sd.seat)}</span>
              <span className="loser-cards">
                {sd.hole.map((c, k) => (
                  <CardView key={k} card={c} size="xs" />
                ))}
              </span>
              <span>{sd.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The best hand possible on this board, and whether anyone held it. */
export function NutsLine({ h }: { h: HandState }) {
  const nuts = nutsFor(h.variant, h.board);
  if (!nuts) return null;
  const holders = h.showdown.filter((sd) => sd.score === nuts.score).map((sd) => sd.seat);
  // Players who won without a showdown still count if their cards make the nuts
  if (holders.length === 0)
    for (const p of h.players)
      if (!p.folded && !p.sittingOut && scoreHand(h.variant, p.hole, h.board) === nuts.score) holders.push(p.seat);
  const names = holders.map((s) => (h.players[s].isHuman ? 'You' : h.players[s].name));
  return (
    <div className="nuts">
      <span className="nuts-tag">The nuts</span>
      {nuts.cards.length > 0 ? (
        <span className="loser-cards">
          {nuts.cards.map((c) => (
            <CardView key={c} card={c} size="xs" />
          ))}
        </span>
      ) : (
        <span className="nuts-board">the board</span>
      )}
      <span className="nuts-label">{nuts.label}</span>
      {names.length > 0 && <span className="nuts-who">{names.join(' and ')} had it</span>}
    </div>
  );
}

// ------------------------------------------------------------ hero

/** Where a starting hand ranks: "top 4%" for strong hands, "bottom 1%" for weak ones. */
function rankPhrase(pct: number): string {
  return pct <= 0.5 ? `top ${Math.max(1, Math.round(pct * 100))}%` : `bottom ${Math.max(1, Math.round((1 - pct) * 100))}%`;
}

/** Plain-English read of a hand on the current board (or its starting-hand rank before the flop). */
function handRead(h: HandState, holeIn: number[]): string {
  const hole = [...holeIn].sort((a, b) => b - a);
  if (hole.length === 4) {
    return h.board.length >= 3
      ? describeScore(scoreHand('plo', hole, h.board))
      : `${describePlo(hole)}, ${rankPhrase(ploPct(hole))}`;
  }
  if (hole.length === 5) {
    const made = describeScore(scoreHand('draw', hole, []));
    return h.street === 'preflop' && !h.done ? `${made}, ${rankPhrase(drawPct(hole))}` : made;
  }
  if (hole.length !== 2) return '';
  if (h.board.length >= 3) return describeScore(scoreHand('holdem', hole, h.board));
  const key = handKey(hole[0], hole[1]);
  const name =
    key.length === 2
      ? `Pocket ${key[0] === 'T' ? '10' : key[0]}s`
      : `${key.slice(0, 2).replace('T', '10')} ${key[2] === 's' ? 'suited' : 'offsuit'}`;
  return `${name}, ${rankPhrase(PREFLOP[key][0])}`;
}

function Hero({ h }: { h: HandState }) {
  const me = h.players[0];
  const hole = [...me.hole].sort((a, b) => b - a);
  const read = handRead(h, me.hole);
  const active = !h.done && h.toAct === 0;
  return (
    <section className={`hero ${active ? 'active' : ''} ${me.folded ? 'folded' : ''}`} aria-label="Your hand">
      <div className="hero-cards">
        {h.variant !== 'draw' && hole.map((c, k) => (
          <CardView key={`${h.handId}-${k}`} card={c} size="lg" dim={me.folded} />
        ))}
      </div>
      <div className="hero-info">
        <div className="hero-read">{me.folded ? 'You folded' : read}</div>
        <div className="hero-meta">
          <span className="hero-pos">{positionOf(h, 0)}</span>
          {me.bet > 0 && !h.done && (
            <span>
              In <b>{me.bet}</b>
            </span>
          )}
          {h.variant === 'draw' && drawWords(h, 0) && <span className="hero-drew">You {drawWords(h, 0)!.toLowerCase()}</span>}
          {h.button === 0 && <span className="dealer inline">D</span>}
        </div>
      </div>
      <div className="hero-stack" aria-label={`Your chips: ${me.stack}`}>
        <span className="hero-stack-num">{me.stack === 0 && me.allIn ? 'All-in' : me.stack}</span>
        <span className="hero-stack-label">your chips</span>
      </div>
    </section>
  );
}
