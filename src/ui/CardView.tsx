import { type Card, RANKS, SUIT_SYMBOLS, rankOf, suitOf } from '../engine/cards';

interface Props {
  card?: Card;
  faceDown?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  dim?: boolean;
  /** Fade in with a short delay (ms), for dealing the board. */
  delay?: number;
}

const SUIT_NAMES = ['clubs', 'diamonds', 'hearts', 'spades'];
const rankLabel = (r: number) => (RANKS[r] === 'T' ? '10' : RANKS[r]);

/** Four-colour deck: suits never get confused at a glance. */
export function CardView({ card, faceDown, size = 'md', dim, delay }: Props) {
  if (card === undefined) return <div className={`card card-${size} card-slot`} aria-hidden />;
  if (faceDown) return <div className={`card card-${size} card-back`} aria-label="Face-down card" />;
  const s = suitOf(card);
  const rank = rankLabel(rankOf(card));
  return (
    <div
      className={`card card-${size} suit-${s} ${dim ? 'dim' : ''}`}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
      aria-label={`${rank} of ${SUIT_NAMES[s]}`}
    >
      <span className="card-rank">{rank}</span>
      <span className="card-suit">{SUIT_SYMBOLS[s]}</span>
    </div>
  );
}
