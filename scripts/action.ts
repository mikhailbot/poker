/** How "lively" bot tables are: flops seen, players per flop, BB defence, fold to c-bet. Run: npx tsx scripts/action.ts [hands] [plo] */
import { botAct, createSession, dealNext, DEFAULT_SETTINGS } from '../src/session';
import { positionOf } from '../src/engine/game';

const N = Number(process.argv[2] ?? 3000);
const s = createSession({ ...DEFAULT_SETTINGS, variant: (process.argv[3] ?? 'holdem') as 'holdem' | 'plo' | 'draw' }, 'x', false);
let flops = 0, playersOnFlop = 0, walks = 0, bbFacingOpen = 0, bbDefend = 0, cbets = 0, cbetFolds = 0, cbetResponses = 0, facingBet = 0, foldsToBet = 0;
for (let i = 0; i < N; i++) {
  const h = dealNext(s);
  while (!h.done) botAct(s);
  const pre = h.actions.filter((a) => a.street === 'preflop' && a.type !== 'post');
  if (h.board.length >= 3 && h.actions.some((a) => a.street === 'flop')) {
    flops++;
    playersOnFlop += new Set(h.actions.filter((a) => a.street === 'flop').map((a) => a.seat)).size;
  }
  if (pre.every((a) => a.type === 'fold')) walks++;
  // BB facing a single open with no callers
  const raises = pre.filter((a) => a.type === 'raise');
  const bbAct = pre.find((a) => a.seat === h.bbSeat);
  if (raises.length >= 1 && bbAct && pre.indexOf(bbAct) > pre.indexOf(raises[0]) && pre.slice(0, pre.indexOf(bbAct)).filter((a) => a.type === 'raise').length === 1) {
    bbFacingOpen++;
    if (bbAct.type !== 'fold') bbDefend++;
  }
  // c-bet on flop by preflop aggressor, and responses
  const flop = h.actions.filter((a) => a.street === 'flop');
  const cb = flop.findIndex((a) => a.seat === h.preflopAggressor && a.type === 'bet');
  if (cb >= 0) {
    cbets++;
    for (const a of flop.slice(cb + 1)) { if (a.type === 'raise' || a.type === 'call' || a.type === 'fold') { cbetResponses++; if (a.type === 'fold') cbetFolds++; } }
  }
  // all postflop responses to a bet
  for (const st of ['flop', 'turn', 'river']) {
    let betOpen = false;
    for (const a of h.actions.filter((x) => x.street === st)) {
      if (betOpen && (a.type === 'fold' || a.type === 'call' || a.type === 'raise')) { facingBet++; if (a.type === 'fold') foldsToBet++; }
      if (a.type === 'bet' || a.type === 'raise') betOpen = true;
    }
  }
}
const p = (a: number, b: number) => `${Math.round((100 * a) / Math.max(1, b))}%`;
console.log(`hands ${N}: flop seen ${p(flops, N)}, avg players on flop ${(playersOnFlop / Math.max(1, flops)).toFixed(2)}, folded round to BB ${p(walks, N)}`);
console.log(`BB defends vs single open ${p(bbDefend, bbFacingOpen)}, fold to c-bet ${p(cbetFolds, cbetResponses)}, fold to any postflop bet ${p(foldsToBet, facingBet)}`);
