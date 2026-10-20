import { useEffect, useMemo, useState } from 'react';
import { beliefFor } from '../bots/brain';
import { equityVsRanges } from '../bots/equity';
import type { PlayerStats } from '../bots/stats';
import { type Decision, type HandState, legalActions, potTotal } from '../engine/game';

interface Props {
  hand: HandState;
  stats: PlayerStats[];
  /** Odds help: what you need to call and your estimated chance of winning. */
  help: boolean;
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

export function ActionBar({ hand: h, stats, help, onAct }: Props) {
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
    () => (help ? estimateChance(h, stats) : null),
    // recompute when the situation changes, not on every render
    [help, h.handId, h.actions.length], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const needPct = Math.round(potOdds * 100);
  const chancePct = chance === null ? null : Math.round(chance * 100);
  const opponents = h.players.filter((p) => !p.isHuman && !p.folded).length;
  const allIn = amount >= me.bet + me.stack;
  const clampAmt = (v: number) => Math.round(Math.min(la.maxRaiseTo, Math.max(la.minRaiseTo, v)));
  /** +/− step: one big blind, or a tenth of the pot once pots get big */
  const step = Math.max(bb, Math.round((pot / 10) / bb) * bb);

  return (
    <div className="actionbar">
      {/* Fixed-height slot above the buttons: odds help, or the bet sizer. Its size never changes. */}
      <div className="slot">
        {sizing && la.canRaise ? (
          <div className="presets" role="group" aria-label="Bet sizes">
            {presets.map((p) => (
              <button key={p.label} className={`preset ${amount === p.to ? 'on' : ''}`} onClick={() => setAmount(p.to)}>
                {p.label}
              </button>
            ))}
          </div>
        ) : help && chancePct !== null ? (
          <div className="odds">
            <p className="odds-line">
              {la.callAmount > 0 ? (
                <>
                  Call {la.callAmount} to win {pot}: you need <b>{needPct}%</b>
                </>
              ) : (
                'Free to check'
              )}
            </p>
            <div className="chance">
              <div className="meter" role="img" aria-label={`Your chance about ${chancePct}%${la.callAmount > 0 ? `, needed ${needPct}%` : ''}`}>
                <span
                  className={`meter-fill ${la.callAmount > 0 ? (chancePct >= needPct ? 'ok' : 'short') : ''}`}
                  style={{ width: `${chancePct}%` }}
                />
                {la.callAmount > 0 && <span className="meter-mark" style={{ left: `${needPct}%` }} />}
              </div>
              <span className="chance-text">
                You win about <b>{chancePct}%</b> vs {opponents === 1 ? '1 player' : `${opponents} players`}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      {sizing && la.canRaise ? (
        <div className="buttons sizing">
          <button className="btn btn-fold" onClick={() => setSizing(false)}>
            Back
          </button>
          <div className="stepper">
            <button aria-label="Less" onClick={() => setAmount(clampAmt(amount - step))} disabled={amount <= la.minRaiseTo}>
              −
            </button>
            <input
              type="number"
              inputMode="numeric"
              value={amount}
              min={la.minRaiseTo}
              max={la.maxRaiseTo}
              onChange={(e) => setAmount(Number(e.target.value) || la.minRaiseTo)}
              onBlur={() => setAmount(clampAmt(amount))}
              aria-label="Bet amount in chips"
            />
            <button aria-label="More" onClick={() => setAmount(clampAmt(amount + step))} disabled={amount >= la.maxRaiseTo}>
              +
            </button>
          </div>
          <button className="btn btn-raise" onClick={() => onAct({ type: 'raise', to: clampAmt(amount) })}>
            {allIn ? `All-in ${amount}` : `${la.isBet ? 'Bet' : 'Raise to'} ${amount}`}
          </button>
        </div>
      ) : (
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
          {la.canRaise && (
            <button className="btn btn-raise" onClick={() => setSizing(true)}>
              {la.isBet ? 'Bet' : 'Raise'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
