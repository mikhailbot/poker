/**
 * Bot-vs-bot simulation: checks each personality plays to its intended style
 * and reports win rates. Run: npx tsx scripts/simulate.ts [hands]
 */
import { PROFILES } from '../src/bots/profiles';
import { estimate, pct } from '../src/bots/stats';
import { botAct, createSession, dealNext, DEFAULT_SETTINGS } from '../src/session';

const HANDS = Number(process.argv[2] ?? 3000);
const VARIANT = (process.argv[3] ?? 'holdem') as 'holdem' | 'plo' | 'draw';
const lineup = ['nit', 'tag', 'lag', 'station', 'maniac', 'tag'];
const s = createSession({ ...DEFAULT_SETTINGS, lineup, variant: VARIANT }, 'x', false);
// force one of each profile into fixed seats
s.seats.forEach((seat, i) => (seat.profileId = lineup[i]));

const t0 = performance.now();
let decisions = 0;
let slowest = 0;
for (let i = 0; i < HANDS; i++) {
  const h = dealNext(s);
  while (!h.done) {
    const a = performance.now();
    botAct(s);
    slowest = Math.max(slowest, performance.now() - a);
    decisions++;
  }
}
const ms = performance.now() - t0;
const bb = s.settings.bigBlind;

console.log(`${HANDS} hands, ${decisions} decisions, ${(ms / decisions).toFixed(2)} ms avg, ${slowest.toFixed(1)} ms slowest\n`);
console.log('seat  style              VPIP  PFR  3B   AF   WTSD  bb/100   (target VPIP/PFR)');
s.seats.forEach((seat, i) => {
  const st = s.stats[i];
  const net = seat.stack - seat.buyIns;
  const prof = PROFILES[seat.profileId];
  const af = st.passiveActions ? (st.aggActions / st.passiveActions).toFixed(1) : '–';
  console.log(
    `${i}     ${prof.style.padEnd(18)} ${pct(st.vpip, st.hands).padStart(4)} ${pct(st.pfr, st.hands).padStart(4)} ${pct(st.threeBet, st.threeBetOpp).padStart(3)} ${af.padStart(4)} ${pct(st.wentToShowdown, st.sawFlop).padStart(5)} ${((net / bb / st.hands) * 100).toFixed(1).padStart(7)}   (${prof.vpip}/${prof.pfr})`,
  );
});
void estimate;
