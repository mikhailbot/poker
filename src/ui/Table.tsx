import { PROFILES } from '../bots/profiles';
import { type HandState, type Player, positionOf, potBeforeStreet } from '../engine/game';
import type { Session } from '../session';
import { CardView } from './CardView';

const SEAT_POS: [number, number][] = [
  [50, 86],
  [11, 67],
  [11, 31],
  [50, 11],
  [89, 31],
  [89, 67],
];
const CENTER: [number, number] = [50, 47];

const toward = ([x, y]: [number, number], f: number): [number, number] => [x + (CENTER[0] - x) * f, y + (CENTER[1] - y) * f];

function lastAction(h: HandState, seat: number): string {
  for (let i = h.actions.length - 1; i >= 0; i--) {
    const a = h.actions[i];
    if (a.street !== h.street) break;
    if (a.seat !== seat) continue;
    if (a.type === 'post') return '';
    const word = { fold: 'Fold', check: 'Check', call: 'Call', bet: 'Bet', raise: 'Raise', post: '' }[a.type];
    return a.allIn ? 'All-in' : word;
  }
  return '';
}

interface Props {
  session: Session;
  revealStyles: boolean;
  thinking: number;
}

export function Table({ session, revealStyles, thinking }: Props) {
  const h = session.hand;
  const winners = new Set(h?.done ? h.pots.flatMap((p) => p.winners) : []);
  const shown = new Set(h?.showdown.map((s) => s.seat) ?? []);

  return (
    <div className="table-wrap">
      <div className="felt">
        <div className="felt-inner" />
      </div>

      {h && (
        <div className="center" style={{ left: `${CENTER[0]}%`, top: `${CENTER[1]}%` }}>
          <div className="pot">
            <span className="pot-label">Pot</span>
            <span className="pot-amt">{h.done ? h.pots.reduce((s, p) => s + p.amount, 0) : potBeforeStreet(h)}</span>
          </div>
          <div className="board">
            {[0, 1, 2, 3, 4].map((i) => (
              <CardView key={i} card={h.board[i]} size="md" />
            ))}
          </div>
          {h.done && <ResultLine h={h} />}
        </div>
      )}

      {session.seats.map((seat, i) => {
        const p: Player | undefined = h?.players[i];
        const [x, y] = SEAT_POS[i];
        const [bx, by] = toward(SEAT_POS[i], i === 0 ? 0.42 : 0.5);
        const [dx, dy] = toward(SEAT_POS[i], 0.28);
        const active = h && !h.done && h.toAct === i;
        const folded = p?.folded;
        const faceUp = p && (seat.isHuman || (h?.done && shown.has(i)));
        const act = h && p ? lastAction(h, i) : '';
        const stack = p ? p.stack : seat.stack;
        const prof = PROFILES[seat.profileId];
        const sd = h?.showdown.find((s) => s.seat === i);
        return (
          <div key={i}>
            <div
              className={`seat ${seat.isHuman ? 'hero' : ''} ${active ? 'active' : ''} ${folded ? 'folded' : ''} ${winners.has(i) ? 'winner' : ''}`}
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              <div className="seat-cards">
                {p && p.hole.length === 2 && !(folded && !seat.isHuman) ? (
                  [...p.hole].sort((a, b) => b - a).map((c, k) => (
                    <CardView key={k} card={c} faceDown={!faceUp} size={seat.isHuman ? 'lg' : 'sm'} dim={folded} />
                  ))
                ) : (
                  <div className="cards-placeholder" />
                )}
              </div>
              <div className="plate">
                <div className="plate-name">
                  {seat.name}
                  {h && p && !p.sittingOut && <span className="pos">{positionOf(h, i)}</span>}
                </div>
                <div className="plate-stack">{stack === 0 && p?.allIn ? 'All-in' : stack}</div>
                {active && !seat.isHuman && thinking > 0 && <div className="thinking" />}
              </div>
              {act && !h?.done && <div className={`act act-${act.toLowerCase().replace('-', '')}`}>{act}</div>}
              {sd && h?.done && <div className="sd-label">{sd.label}</div>}
              {revealStyles && prof && <div className="style-tag">{prof.style}</div>}
            </div>
            {p && p.bet > 0 && !h?.done && (
              <div className="bet" style={{ left: `${bx}%`, top: `${by}%` }}>
                <span className="chip" />
                {p.bet}
              </div>
            )}
            {h && h.button === i && (
              <div className="dealer" style={{ left: `${dx + (i === 0 ? 9 : 0)}%`, top: `${dy}%` }} aria-label="Dealer button">
                D
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ResultLine({ h }: { h: HandState }) {
  const won = new Map<number, number>();
  for (const pot of h.pots) {
    // Don't count an uncalled bet returned to its owner as a "win"
    if (pot.eligible.length === 1 && h.pots.length > 1) continue;
    for (const w of pot.winners) won.set(w, (won.get(w) ?? 0) + Math.floor(pot.amount / pot.winners.length));
  }
  if (won.size === 0 && h.pots[0]) won.set(h.pots[0].winners[0], h.pots[0].amount);
  return (
    <div className="result">
      {[...won.entries()].map(([seat, amt]) => {
        const p = h.players[seat];
        const sd = h.showdown.find((s) => s.seat === seat);
        return (
          <div key={seat}>
            {p.isHuman ? 'You win' : `${p.name} wins`} {amt}
            {sd ? ` with ${sd.label.toLowerCase()}` : ''}
          </div>
        );
      })}
    </div>
  );
}
