import { type Card, RANKS, SUIT_SYMBOLS, rankOf, suitOf } from '../engine/cards';

interface Props {
  card?: Card;
  faceDown?: boolean;
  size?: 'sm' | 'md' | 'lg';
  dim?: boolean;
  highlight?: boolean;
}

const rankLabel = (r: number) => (RANKS[r] === 'T' ? '10' : RANKS[r]);

export function CardView({ card, faceDown, size = 'md', dim, highlight }: Props) {
  if (card === undefined) return <div className={`card card-${size} card-empty`} aria-hidden />;
  if (faceDown) return <div className={`card card-${size} card-back`} aria-label="Face-down card" />;
  const s = suitOf(card);
  const red = s === 1 || s === 2;
  const label = `${rankLabel(rankOf(card))}${SUIT_SYMBOLS[s]}`;
  return (
    <div
      className={`card card-${size} ${red ? 'red' : 'black'} ${dim ? 'dim' : ''} ${highlight ? 'hl' : ''}`}
      aria-label={label}
    >
      <span className="card-rank">{rankLabel(rankOf(card))}</span>
      <span className="card-suit">{SUIT_SYMBOLS[s]}</span>
    </div>
  );
}
