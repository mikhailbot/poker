/** How aggressive the table is before the flop. Run: npx tsx scripts/preflop.ts [hands] [game] [table] */
import { botAct, createSession, dealNext, DEFAULT_SETTINGS, TABLES } from '../src/session';
import { PROFILES } from '../src/bots/profiles';

const N = Number(process.argv[2] ?? 3000);
const variant = (process.argv[3] ?? 'holdem') as 'holdem' | 'plo' | 'draw';
const table = (process.argv[4] ?? 'lively') as keyof typeof TABLES;
const s = createSession({ ...DEFAULT_SETTINGS, variant, lineup: TABLES[table] }, 'x', false);
let raised = 0, threeBet = 0, fourBet = 0, limpedOnly = 0, walks = 0;
const notes = new Map<string, number>();
for (let i = 0; i < N; i++) {
  const h = dealNext(s);
  while (!h.done) botAct(s);
  const pre = h.actions.map((a, k) => ({ a, k })).filter(({ a }) => a.street === 'preflop' && a.type !== 'post');
  const r = pre.filter(({ a }) => a.type === 'raise').length;
  if (r >= 1) raised++;
  if (r >= 2) threeBet++;
  if (r >= 3) fourBet++;
  if (r === 0 && pre.some(({ a }) => a.type === 'call')) limpedOnly++;
  if (pre.every(({ a }) => a.type === 'fold')) walks++;
  for (const { a, k } of pre) if (a.type === 'raise') { const n = (s.notes[k] ?? '').replace(/ \(.*/, ''); notes.set(n, (notes.get(n) ?? 0) + 1); }
}
const p = (x: number) => `${Math.round((100 * x) / N)}%`;
console.log(`${variant} ${table}: raised preflop ${p(raised)} of hands, 3-bet ${p(threeBet)}, 4-bet+ ${p(fourBet)}, limped pots ${p(limpedOnly)}, walks ${p(walks)}`);
console.log('raise reasons:', [...notes.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));
void PROFILES;
