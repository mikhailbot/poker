import { useEffect, useMemo, useState } from 'react';
import { type Decision, type HandState, legalActions, potTotal } from '../engine/game';

interface Props {
  hand: HandState;
  showOdds: boolean;
  onAct: (d: Decision) => void;
}

export function ActionBar({ hand: h, showOdds, onAct }: Props) {
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
    if (h.street === 'preflop') {
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
    add('All-in', la.maxRaiseTo);
    return out;
  }, [h, la.minRaiseTo, la.maxRaiseTo, la.callAmount, la.isBet, pot, bb]);

  const [sizing, setSizing] = useState(false);
  const [amount, setAmount] = useState(presets[0]?.to ?? la.minRaiseTo);
  useEffect(() => {
    setSizing(false);
    setAmount(presets[1]?.to ?? presets[0]?.to ?? la.minRaiseTo);
  }, [h.actions.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const potOdds = la.callAmount > 0 ? la.callAmount / (pot + la.callAmount) : 0;
  const raiseWord = la.isBet ? 'Bet' : 'Raise to';
  const allIn = amount >= la.maxRaiseTo;

  return (
    <div className="actionbar">
      {showOdds && la.callAmount > 0 && (
        <div className="odds">
          Call {la.callAmount} to win {pot} — you need {Math.round(potOdds * 100)}% equity
        </div>
      )}

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
              {la.isBet ? 'Bet…' : 'Raise…'}
            </button>
          ))}
      </div>
    </div>
  );
}
