import { chooseDiscards } from '../bots/draw';
import type { HandState } from '../engine/game';

interface Props {
  hand: HandState;
  selected: Set<number>;
  onSelect: (next: Set<number>) => void;
  onDraw: (discard: number[]) => void;
  /** Show the usual way to draw this hand. */
  showHint: boolean;
}

/** Five-card draw: choose which cards to swap. */
export function DrawBar({ hand: h, selected, onSelect, onDraw, showHint }: Props) {
  const me = h.players[0];
  const plan = chooseDiscards(me.hole);
  const n = selected.size;
  const matchesPlan = n === plan.discard.length && plan.discard.every((i) => selected.has(i));
  return (
    <div className="drawbar">
      <div className="slot">
        {showHint ? (
          <div className="draw-tip">
            <span>
              Usual play: <b>{plan.why}</b>
            </span>
            {!matchesPlan && (
              <button className="tip-btn" onClick={() => onSelect(new Set(plan.discard))}>
                Use it
              </button>
            )}
          </div>
        ) : (
          <p className="draw-hint">Tap the cards you want to swap, then draw.</p>
        )}
      </div>
      <div className="buttons">
        <button className="btn btn-fold" onClick={() => onDraw([])}>
          Stand pat
        </button>
        <button className="btn btn-raise" disabled={n === 0} onClick={() => onDraw([...selected])}>
          {n === 0 ? 'Pick cards' : `Draw ${n}`}
        </button>
      </div>
    </div>
  );
}
