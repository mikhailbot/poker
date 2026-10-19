import { PREFLOP } from '../bots/preflopTable';
import { PROFILES } from '../bots/profiles';
import { handKey } from '../engine/cards';
import { describeScore } from '../engine/evaluator';
import { scoreHand } from '../engine/omaha';
import { describePlo, ploPct } from '../bots/plo';
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
    if (a.street !== h.street) return null;
    if (a.type === 'post') return { word: a.amount === h.smallBlind ? 'SB' : 'BB', kind: 'post' };
    return { word: a.allIn ? 'All-in' : VERB[a.type], kind: a.allIn ? 'allin' : a.type };
  }
  return null;
}

interface Props {
  session: Session;
  revealStyles: boolean;
  /** Show folded players' cards once the hand is over. */
  revealMucked: boolean;
  /** Current bot think time in ms (drives the timer ring), 0 when idle. */
  thinking: number;
}

export function Table({ session, revealStyles, revealMucked, thinking }: Props) {
  const h = session.hand;
  if (!h) return null;
  return (
    <div className={`table ${h.variant === 'plo' ? 'is-plo' : ''}`}>
      <Opponents h={h} session={session} revealStyles={revealStyles} revealMucked={revealMucked} thinking={thinking} />
      <Stage h={h} />
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
            <div className="opp-stack">{p.stack === 0 && p.allIn ? 'All-in' : p.stack}</div>
            <div className="opp-pos">{positionOf(h, i)}</div>
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

function Stage({ h }: { h: HandState }) {
  const last = [...h.actions].reverse().find((a) => a.type !== 'post');
  const pot = h.done ? h.pots.reduce((s, p) => s + p.amount, 0) : potTotal(h);
  return (
    <section className="stage" aria-label="Board">
      <div className="stage-head">
        <span className="street">{h.done ? (h.showdown.length ? 'Showdown' : 'Hand over') : STREET[h.street]}</span>
        <span className="pot">
          <small>Pot</small>
          {pot}
        </span>
      </div>
      <div className="board">
        {[0, 1, 2, 3, 4].map((i) => (
          <CardView key={`${i}-${h.board[i] ?? 'x'}`} card={h.board[i]} size="lg" delay={i < 3 ? i * 70 : 0} />
        ))}
      </div>
      <div className="ticker" aria-live="polite">
        {h.done ? <Result h={h} /> : last ? describeAction(h, last) : `Blinds ${h.smallBlind}/${h.bigBlind}`}
      </div>
    </section>
  );
}

function Result({ h }: { h: HandState }) {
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
            {sd && <span>{sd.label}</span>}
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

// ------------------------------------------------------------ hero

/** Where a starting hand ranks: "top 4%" for strong hands, "bottom 1%" for weak ones. */
function rankPhrase(pct: number): string {
  return pct <= 0.5 ? `top ${Math.max(1, Math.round(pct * 100))}%` : `bottom ${Math.max(1, Math.round((1 - pct) * 100))}%`;
}

function Hero({ h }: { h: HandState }) {
  const me = h.players[0];
  const hole = [...me.hole].sort((a, b) => b - a);
  let read = '';
  if (hole.length === 4) {
    read =
      h.board.length >= 3
        ? describeScore(scoreHand('plo', hole, h.board))
        : `${describePlo(hole)}, ${rankPhrase(ploPct(hole))}`;
  } else if (hole.length === 2) {
    if (h.board.length >= 3) read = describeScore(scoreHand('holdem', hole, h.board));
    else {
      const key = handKey(hole[0], hole[1]);
      const name = key.length === 2 ? `Pocket ${key[0] === 'T' ? '10' : key[0]}s` : `${key.slice(0, 2).replace('T', '10')} ${key[2] === 's' ? 'suited' : 'offsuit'}`;
      read = `${name}, ${rankPhrase(PREFLOP[key][0])} of hands`;
    }
  }
  const active = !h.done && h.toAct === 0;
  return (
    <section className={`hero ${active ? 'active' : ''} ${me.folded ? 'folded' : ''}`} aria-label="Your hand">
      <div className="hero-cards">
        {hole.map((c, k) => (
          <CardView key={`${h.handId}-${k}`} card={c} size="lg" dim={me.folded} />
        ))}
      </div>
      <div className="hero-info">
        <div className="hero-read">{me.folded ? 'You folded' : read}</div>
        <div className="hero-meta">
          <span className="hero-pos">{positionOf(h, 0)}</span>
          <span>
            Stack <b>{me.stack}</b>
          </span>
          {me.bet > 0 && !h.done && (
            <span>
              In <b>{me.bet}</b>
            </span>
          )}
          {h.button === 0 && <span className="dealer inline">D</span>}
        </div>
      </div>
    </section>
  );
}
