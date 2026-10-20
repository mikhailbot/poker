import { useEffect, useState, type ReactNode } from 'react';
import { PROFILES } from '../bots/profiles';
import { pct, type PlayerStats } from '../bots/stats';
import type { HistoryEntry, Prefs } from '../store/persist';
import type { Session } from '../session';
import { CardView } from './CardView';
import { nutsFor } from '../engine/nuts';

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

const fmtBB = (chips: number, bb: number) => {
  const v = chips / bb;
  const abs = Math.abs(v);
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Number.isInteger(abs) ? abs : abs.toFixed(1)} BB`;
};

// ------------------------------------------------------------ History

export function HistorySheet({ history, onClose }: { history: HistoryEntry[]; onClose: () => void }) {
  const [open, setOpen] = useState<HistoryEntry | null>(null);
  if (open) return <HandDetail entry={open} onBack={() => setOpen(null)} onClose={onClose} />;
  return (
    <Sheet title="Hand history" onClose={onClose}>
      {history.length === 0 && <p className="empty">Hands you play will appear here, with every player's cards revealed.</p>}
      <ul className="hist-list">
        {history.map((e) => {
          const hero = e.players.find((p) => p.isHuman);
          return (
            <li key={`${e.id}-${e.time}`}>
              <button className="hist-row" onClick={() => setOpen(e)}>
                <span className="hist-id">#{e.id}</span>
                <span className="hist-cards">
                  {hero?.hole.map((c, i) => <CardView key={i} card={c} size="sm" />)}
                </span>
                <span className="hist-pos">{hero?.position}</span>
                <span className={`hist-net ${e.heroNet > 0 ? 'up' : e.heroNet < 0 ? 'down' : ''}`}>
                  {e.heroNet === 0 ? '0' : fmtBB(e.heroNet, e.bigBlind)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

const STREET_LABEL: Record<string, string> = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River' };
/** Five-card draw streets in order, with headings, for a hand with `draws` draws. */
function drawStreets(draws: number): { id: string; label: string }[] {
  const betting = draws >= 3 ? ['flop', 'turn', 'river'] : draws === 2 ? ['turn', 'river'] : ['river'];
  const out = [{ id: 'preflop', label: draws > 1 ? 'Before draw 1' : 'Before the draw' }];
  for (let k = 1; k <= draws; k++) {
    out.push({ id: `draw${k}`, label: draws > 1 ? `Draw ${k}` : 'The draw' });
    out.push({ id: betting[k - 1], label: draws > 1 ? `After draw ${k}` : 'After the draw' });
  }
  return out;
}
const boardFor = (street: string, board: number[]) =>
  street === 'flop' ? board.slice(0, 3) : street === 'turn' ? board.slice(3, 4) : street === 'river' ? board.slice(4, 5) : [];

function HandDetail({ entry: e, onBack, onClose }: { entry: HistoryEntry; onBack: () => void; onClose: () => void }) {
  const isDraw = e.variant === 'draw';
  const order = isDraw
    ? drawStreets(e.draws ?? 1)
    : ['preflop', 'flop', 'turn', 'river'].map((id) => ({ id, label: STREET_LABEL[id] }));
  // older saved draw hands used plain 'draw' for the draw lines
  const lineStreet = (st: string) => (isDraw && st === 'draw' ? 'draw1' : st);
  const labels: Record<string, string> = Object.fromEntries(order.map((o) => [o.id, o.label]));
  const streets = order.map((o) => o.id).filter((id) => e.lines.some((l) => lineStreet(l.street) === id));
  const name = (seat: number) => e.players.find((p) => p.seat === seat)?.name ?? '';
  return (
    <Sheet title={`Hand #${e.id}`} onClose={onClose}>
      <button className="link-btn" onClick={onBack}>
        ‹ All hands
      </button>
      <table className="hd-players">
        <tbody>
          {e.players.map((p) => (
            <tr key={p.seat} className={p.isHuman ? 'me' : ''}>
              <td className="hd-pos">{p.position}</td>
              <td>
                {p.name}
                {!p.isHuman && PROFILES[p.profileId] && <span className="hd-style">{PROFILES[p.profileId].style}</span>}
              </td>
              <td className="hd-cards">
                {p.hole.map((c, i) => (
                  <CardView key={i} card={c} size="sm" dim={p.folded} />
                ))}
              </td>
              <td className={`hd-net ${p.net > 0 ? 'up' : p.net < 0 ? 'down' : ''}`}>{p.net === 0 ? '' : fmtBB(p.net, e.bigBlind)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {streets.map((s) => (
        <section key={s} className="hd-street">
          <h3>
            {labels[s]}
            <span className="hd-board">
              {boardFor(s, e.board).map((c, i) => (
                <CardView key={i} card={c} size="sm" />
              ))}
            </span>
          </h3>
          <ol>
            {e.lines
              .filter((l) => lineStreet(l.street) === s)
              .map((l, i) => (
                <li key={i}>
                  {l.text}
                  {l.note && l.note !== 'folds preflop' && <div className="hd-note">{l.note}</div>}
                </li>
              ))}
          </ol>
        </section>
      ))}
      {e.board.length > 0 && !streets.includes('river') && e.board.length === 5 && (
        <section className="hd-street">
          <h3>
            Run-out
            <span className="hd-board">
              {e.board.map((c, i) => (
                <CardView key={i} card={c} size="sm" />
              ))}
            </span>
          </h3>
        </section>
      )}
      <section className="hd-street">
        <h3>Result</h3>
        <ol>
          {e.showdown.map((s) => (
            <li key={s.seat}>
              {name(s.seat)} shows {s.label.toLowerCase()}
            </li>
          ))}
          {e.winners.map((w) => (
            <li key={w.seat}>
              <strong>{name(w.seat)}</strong> collects {w.amount}
            </li>
          ))}
          {(() => {
            const n = nutsFor(e.variant ?? 'holdem', e.board);
            if (!n) return null;
            return (
              <li className="hd-nuts">
                The nuts:{' '}
                {n.cards.length ? (
                  <span className="hd-board">
                    {n.cards.map((c) => (
                      <CardView key={c} card={c} size="sm" />
                    ))}
                  </span>
                ) : (
                  'the board'
                )}{' '}
                {n.label.toLowerCase()}
              </li>
            );
          })()}
        </ol>
      </section>
    </Sheet>
  );
}

// ------------------------------------------------------------ Stats

export function StatsSheet({ session, onClose }: { session: Session; onClose: () => void }) {
  const bb = session.settings.bigBlind;
  const row = (name: string, st: PlayerStats, style: string, net: number) => (
    <tr key={name}>
      <td>
        {name}
        {style && <span className="hd-style">{style}</span>}
      </td>
      <td>{st.hands}</td>
      <td>{pct(st.vpip, st.hands)}</td>
      <td>{pct(st.pfr, st.hands)}</td>
      <td>{pct(st.threeBet, st.threeBetOpp)}</td>
      <td>{st.passiveActions ? (st.aggActions / st.passiveActions).toFixed(1) : '–'}</td>
      <td>{pct(st.wentToShowdown, st.sawFlop)}</td>
      <td className={net > 0 ? 'up' : net < 0 ? 'down' : ''}>{st.hands ? ((net / bb / st.hands) * 100).toFixed(1) : '–'}</td>
    </tr>
  );
  return (
    <Sheet title="Session stats" onClose={onClose}>
      <div className="stats-scroll">
        <table className="stats">
          <thead>
            <tr>
              <th>Player</th>
              <th>Hands</th>
              <th title="Voluntarily put money in pot %">VPIP</th>
              <th title="Preflop raise %">PFR</th>
              <th title="3-bet % when facing a raise">3-bet</th>
              <th title="Postflop bets+raises per call">AF</th>
              <th title="Went to showdown % after seeing a flop">WTSD</th>
              <th title="Big blinds won per 100 hands">BB/100</th>
            </tr>
          </thead>
          <tbody>
            {session.seats.map((s, i) =>
              row(s.name, session.stats[i], s.isHuman ? '' : PROFILES[s.profileId]?.style ?? '', s.stack - s.buyIns),
            )}
          </tbody>
        </table>
      </div>
      <p className="fine">
        A solid 6-max player usually sits around 22–26 VPIP and 18–22 PFR. If your VPIP is far above your PFR, you're
        calling too much.
      </p>
    </Sheet>
  );
}

// ------------------------------------------------------------ Settings

interface SettingsProps {
  prefs: Prefs;
  gameName: string;
  onPrefs: (p: Prefs) => void;
  onResetGame: () => void;
  onClearHistory: () => void;
  onResetAll: () => void;
  onClose: () => void;
}

/** A destructive button that asks for a second tap instead of a pop-up. */
function ConfirmButton({ label, confirmLabel, onConfirm }: { label: string; confirmLabel: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button className={`reset-btn ${armed ? 'armed' : ''}`} onClick={() => (armed ? onConfirm() : setArmed(true))}>
      {armed ? confirmLabel : label}
    </button>
  );
}

export function SettingsSheet({ prefs, gameName, onPrefs, onResetGame, onClearHistory, onResetAll, onClose }: SettingsProps) {
  const toggle = (k: 'showChance' | 'revealStyles' | 'revealMucked' | 'autoDeal', label: string, hint: string) => (
    <label className="toggle">
      <span>
        {label}
        <small>{hint}</small>
      </span>
      <input type="checkbox" checked={prefs[k]} onChange={(e) => onPrefs({ ...prefs, [k]: e.target.checked })} />
    </label>
  );
  return (
    <Sheet title="Settings" onClose={onClose}>
      <div className="field">
        <span>Bot speed</span>
        <div className="seg">
          {(['relaxed', 'normal', 'fast'] as const).map((s) => (
            <button key={s} className={prefs.speed === s ? 'on' : ''} onClick={() => onPrefs({ ...prefs, speed: s })}>
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {toggle(
        'showChance',
        'Show odds help',
        'What you need to win to call ("Call 5 to win 10: you need 33%"), your estimated chance of winning, and the usual draw in five-card draw.',
      )}
      {toggle('revealMucked', 'Show all cards after the hand', 'Reveal the hands of players who folded, so you can see what they had.')}
      {toggle('revealStyles', 'Reveal player styles', 'Label each bot with how it plays. Off is more realistic.')}
      {toggle('autoDeal', 'Deal next hand automatically after you fold', 'Waits a few seconds (longer when cards are shown). Hands you play to the end always wait for you.')}
      <div className="field">
        <span>Reset</span>
        <div className="resets">
          <div className="reset-row">
            <div>
              <b>Restart {gameName}</b>
              <small>Fresh stacks and stats for this game, same table. Other games and history are kept.</small>
            </div>
            <ConfirmButton label="Restart" confirmLabel="Tap to confirm" onConfirm={onResetGame} />
          </div>
          <div className="reset-row">
            <div>
              <b>Clear hand history</b>
              <small>Deletes the saved hands. Stacks and stats are kept.</small>
            </div>
            <ConfirmButton label="Clear" confirmLabel="Tap to confirm" onConfirm={onClearHistory} />
          </div>
          <div className="reset-row">
            <div>
              <b>Reset everything</b>
              <small>All games, stats, history and settings, back to a fresh start.</small>
            </div>
            <ConfirmButton label="Reset" confirmLabel="Tap to confirm" onConfirm={onResetAll} />
          </div>
        </div>
      </div>
    </Sheet>
  );
}
