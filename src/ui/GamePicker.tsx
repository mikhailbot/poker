import { useState } from 'react';
import type { Variant } from '../engine/omaha';
import type { TableKind } from '../session';
import { Sheet } from './Sheets';

export const GAMES: { id: Variant; name: string; short: string; cards: number; about: string }[] = [
  {
    id: 'holdem',
    name: "No-limit Hold'em",
    short: "Hold'em",
    cards: 2,
    about: 'Two cards each and five shared on the board. The most popular game.',
  },
  {
    id: 'plo',
    name: 'Pot-limit Omaha',
    short: 'Omaha',
    cards: 4,
    about: 'Four cards each. Use exactly two with three from the board. Bigger hands, bigger pots.',
  },
  {
    id: 'draw',
    name: 'Five-card draw',
    short: 'Draw',
    cards: 5,
    about: 'Five cards each and no board. Swap cards between betting rounds, with one to three draws.',
  },
];

export const TABLE_INFO: { id: TableKind; label: string; hint: string }[] = [
  { id: 'lively', label: 'Lively', hint: 'Casual players, a calling station and a maniac: lots of action.' },
  { id: 'mixed', label: 'Mixed', hint: 'One of each style, including a tight nit.' },
  { id: 'tough', label: 'Tough', hint: 'Mostly solid, aggressive regulars. Fewer mistakes to exploit.' },
  { id: 'random', label: 'Random', hint: 'Five styles picked at random.' },
];

interface Props {
  current: Variant;
  table: TableKind;
  summaries: Partial<Record<Variant, { hands: number; netBB: number } | null>>;
  onPickGame: (g: Variant) => void;
  drawRounds: number;
  onDrawRounds: (n: number) => void;
  onNewTable: (t: TableKind) => void;
  onClose: () => void;
}

/** A small fan of face-down cards showing how many each player gets. */
function Fan({ n }: { n: number }) {
  const spread = n === 2 ? 14 : n === 4 ? 9 : 8;
  return (
    <span className="fan" aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} style={{ transform: `rotate(${(i - (n - 1) / 2) * spread}deg)` }} />
      ))}
    </span>
  );
}

const fmt = (bb: number) => `${bb > 0 ? '+' : bb < 0 ? '−' : ''}${Math.abs(bb).toFixed(1)} BB`;

export function GamePicker({ current, table, summaries, onPickGame, drawRounds, onDrawRounds, onNewTable, onClose }: Props) {
  const [pick, setPick] = useState<TableKind>(table);
  const gameName = GAMES.find((g) => g.id === current)!.name;
  return (
    <Sheet title="Choose a game" onClose={onClose}>
      <ul className="games">
        {GAMES.map((g) => {
          const sum = summaries[g.id];
          const isCurrent = g.id === current;
          return (
            <li key={g.id}>
              <button className={`game ${isCurrent ? 'current' : ''}`} onClick={() => (isCurrent ? onClose() : onPickGame(g.id))}>
                <Fan n={g.cards} />
                <span className="game-text">
                  <span className="game-title">{g.name}</span>
                  <span className="game-about">{g.about}</span>
                </span>
                <span className="game-state">
                  {isCurrent ? (
                    <span className="badge">Playing</span>
                  ) : sum && sum.hands > 0 ? (
                    <>
                      <span>Resume</span>
                      <small className={sum.netBB > 0 ? 'up' : sum.netBB < 0 ? 'down' : ''}>{fmt(sum.netBB)}</small>
                    </>
                  ) : (
                    <span>Start</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="fine">Each game keeps its own stacks and stats, so you can switch back and forth.</p>

      <h3 className="picker-h">Draws in five-card draw</h3>
      <div className="seg">
        {[1, 2, 3].map((n) => (
          <button key={n} className={drawRounds === n ? 'on' : ''} onClick={() => onDrawRounds(n)}>
            {n === 1 ? '1 draw' : `${n} draws`}
          </button>
        ))}
      </div>
      <p className="fine">
        {drawRounds === 1
          ? 'Classic draw: one chance to swap cards.'
          : `A betting round after each of ${drawRounds} draws.`}{' '}
        {current === 'draw' ? 'Applies from the next hand.' : ''}
      </p>

      <h3 className="picker-h">Who's at the table</h3>
      <div className="tables" role="radiogroup" aria-label="Table">
        {TABLE_INFO.map((t) => (
          <button
            key={t.id}
            role="radio"
            aria-checked={pick === t.id}
            className={`table-opt ${pick === t.id ? 'on' : ''}`}
            onClick={() => setPick(t.id)}
          >
            <span className="table-name">
              {t.label}
              {t.id === table && <small>current</small>}
            </span>
            <span className="table-hint">{t.hint}</span>
          </button>
        ))}
      </div>
      <button className="btn btn-primary picker-go" onClick={() => onNewTable(pick)}>
        Start a new {TABLE_INFO.find((t) => t.id === pick)!.label.toLowerCase()} table
      </button>
      <p className="fine">Starts {gameName} again with fresh stacks and stats. Hand history is kept.</p>
    </Sheet>
  );
}
