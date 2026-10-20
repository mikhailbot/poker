import { useEffect, useMemo, useState } from 'react';
import { beliefFor } from '../bots/brain';
import { equityVsRanges } from '../bots/equity';
import type { PlayerStats } from '../bots/stats';
import { type Decision, type HandState, legalActions, potTotal } from '../engine/game';

interface Props {
  hand: HandState;
  stats: PlayerStats[];
  showOdds: boolean;
  showChance: boolean;
  onAct: (d: Decision) => void;
}

/** Your chance of winning against the hands opponents are likely to hold, given how they've played. */
function estimateChance(h: HandState, stats: PlayerStats[]): number {
  const me = h.players[h.toAct];
  const opps = h.players.filter((p) => p.seat !== me.seat && !p.folded && !p.sittingOut);
  const beliefs = opps.map((o) => beliefFor(h, o.seat, stats));
  const drawsLeft = h.variant === 'draw' ? h.draws - h.drawsDone : 0;
  const sims = h.variant === 'plo' ? 300 : h.variant === 'draw' ? 500 : 900;
  return equityVsRanges(me.hole, h.board, beliefs, sims, h.variant, drawsLeft);
}

export function ActionBar({ hand: h, stats, showOdds, showChance, onAct }: Props) {
  const la = legalActions(h);
  const me = h.players[h.toAct];
  const pot = potTotal(h);
  const bb = h.bigBlind;

  const presets = useMemo(() => {
    const out: { label: string; to: number }[] = [];
    const add = (label: string, to: number) => {
      to = Math.round(Math.min(Math.max(to, la.minRaiseTo), la.maxRaiseTo));
      if (!out.some((o) => o.to === to)) out.push({ label, to });
    };
    if (h.variant === 'plo') {
      // Pot-limit: sizes as fractions of a pot-sized raise
      const potRaise = (f: number) => h.currentBet + f * (pot + la.callAmount);
      add('Min', la.minRaiseTo);
      add('½ pot', potRaise(0.5));
      add('¾ pot', potRaise(0.75));
      add('Pot', potRaise(1));
    } else if (h.street === 'preflop') {
      if (h.currentBet === bb) {
        add('2.5 BB', bb * 2.5);
        add('3 BB', bb * 3);
      } else {
        add('3×', h.currentBet * 3);
        add('4×', h.currentBet * 4);
      }
      add('Pot', h.currentBet + pot + la.callAmount);
    } else if (la.isBet) {
      add('⅓ pot', pot / 3);
      add('½ pot', pot / 2);
      add('⅔ pot', (pot * 2) / 3);
      add('Pot', pot);
    } else {
      add('2.5×', h.currentBet * 2.5);
      add('3×', h.currentBet * 3);
      add('Pot', h.currentBet + pot + la.callAmount);
    }
    add(la.maxRaiseTo === me.bet + me.stack ? 'All-in' : 'Max', la.maxRaiseTo);
    return out;
  }, [h, la.minRaiseTo, la.maxRaiseTo, la.callAmount, la.isBet, pot, bb, me.bet, me.stack]);

  const [sizing, setSizing] = useState(false);
  const [amount, setAmount] = useState(presets[0]?.to ?? la.minRaiseTo);
  useEffect(() => {
    setSizing(false);
    setAmount(presets[1]?.to ?? presets[0]?.to ?? la.minRaiseTo);
  }, [h.actions.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const potOdds = la.callAmount > 0 ? la.callAmount / (pot + la.callAmount) : 0;
  const chance = useMemo(
    () => (showChance ? estimateChance(h, stats) : null),
    // recompute when the situation changes, not on every render
    [showChance, h.handId, h.actions.length], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const needPct = Math.round(potOdds * 100);
  const chancePct = chance === null ? null : Math.round(chance * 100);
  const opponents = h.players.filter((p) => !p.isHuman && !p.folded).length;
  const raiseWord = la.isBet ? 'Bet' : 'Raise to';
  const allIn = amount >= me.bet + me.stack;

  return (
    <div className="actionbar">
      {(showOdds && la.callAmount > 0) || chancePct !== null ? (
        <div className="odds">
          {showOdds && la.callAmount > 0 && (
            <p className="odds-line">
              Calling {la.callAmount} to win {pot} pays off if you win at least <b>{needPct}%</b> of the time.
            </p>
          )}
          {chancePct !== null && (
            <div className="chance">
              <div className="meter" role="img" aria-label={`Your chance about ${chancePct}%, needed ${needPct}%`}>
                <span className={`meter-fill ${la.callAmount > 0 ? (chancePct >= needPct ? 'ok' : 'short') : ''}`} style={{ width: `${chancePct}%` }} />
                {la.callAmount > 0 && showOdds && <span className="meter-mark" style={{ left: `${needPct}%` }} />}
              </div>
              <span className="chance-text">
                You win about <b>{chancePct}%</b> vs {opponents === 1 ? '1 player' : `${opponents} players`}
              </span>
            </div>
          )}
        </div>
      ) : null}

      {sizing && la.canRaise && (
        <div className="sizer">
          <div className="presets">
            {presets.map((p) => (
              <button key={p.label} className={`preset ${amount === p.to ? 'on' : ''}`} onClick={() => setAmount(p.to)}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="slider-row">
            <input
              type="range"
              min={la.minRaiseTo}
              max={la.maxRaiseTo}
              step={1}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              aria-label="Bet amount"
            />
            <input
              className="amt-input"
              type="number"
              inputMode="numeric"
              value={amount}
              min={la.minRaiseTo}
              max={la.maxRaiseTo}
              onChange={(e) => setAmount(Number(e.target.value) || la.minRaiseTo)}
              aria-label="Bet amount in chips"
            />
          </div>
        </div>
      )}

      <div className="buttons">
        {la.canFold && (
          <button className="btn btn-fold" onClick={() => onAct({ type: 'fold' })}>
            Fold
          </button>
        )}
        {la.canCheck ? (
          <button className="btn btn-call" onClick={() => onAct({ type: 'check' })}>
            Check
          </button>
        ) : (
          <button className="btn btn-call" onClick={() => onAct({ type: 'call' })}>
            {la.callAmount >= me.stack ? `Call all-in ${la.callAmount}` : `Call ${la.callAmount}`}
          </button>
        )}
        {la.canRaise &&
          (sizing ? (
            <button className="btn btn-raise" onClick={() => onAct({ type: 'raise', to: amount })}>
              {allIn ? `All-in ${amount}` : `${raiseWord} ${amount}`}
            </button>
          ) : (
            <button className="btn btn-raise" onClick={() => setSizing(true)}>
              {la.isBet ? 'Bet' : 'Raise'}
            </button>
          ))}
      </div>
    </div>
  );
}
