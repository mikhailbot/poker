/** Prints the biggest pots from a bot-only session, with each bot's reasoning. Run: npx tsx scripts/bigpots.ts */
import { cardsToString, describeAction } from '../src/engine/game';
import { PROFILES } from '../src/bots/profiles';
import { botAct, createSession, dealNext, DEFAULT_SETTINGS } from '../src/session';

const s = createSession(DEFAULT_SETTINGS, 'x', false);
s.seats.forEach((seat, i) => (seat.profileId = ['nit', 'tag', 'lag', 'station', 'maniac', 'tag'][i]));
const logs: { pot: number; text: string }[] = [];
for (let i = 0; i < Number(process.argv[2] ?? 400); i++) {
  const h = dealNext(s);
  while (!h.done) botAct(s);
  const pot = h.pots.reduce((a, p) => a + p.amount, 0);
  const lines = h.players.map((p) => `  ${p.name} (${PROFILES[p.profileId].style}) ${cardsToString(p.hole)} net ${h.net[p.seat]}`);
  h.actions.forEach((a, k) => lines.push(`  [${a.street}] ${describeAction(h, a)}${s.notes[k] ? '  — ' + s.notes[k] : ''}`));
  lines.push(`  board ${cardsToString(h.board)}; showdown: ${h.showdown.map((x) => h.players[x.seat].name + ' ' + x.label).join(', ')}`);
  logs.push({ pot, text: lines.join('\n') });
}
logs.sort((a, b) => b.pot - a.pot);
for (const l of logs.slice(0, Number(process.argv[3] ?? 4))) console.log(`POT ${l.pot}\n${l.text}\n`);
