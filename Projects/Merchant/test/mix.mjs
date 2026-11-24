// The paper mix over many games (DESIGN 2.1; ARCHITECTURE 4.2): node test/mix.mjs [--games N], from Projects/Merchant/.
// Plays N seeded cairo games with the balance bots (default 1,000: careful, greedy and qirad in turn, so every
// house and every kind of trip), watches each season's opening through the engine's `steps`, and prints:
//   the share of trips of three seasons or more that bring a letter    target 70 percent, fails under 50
//   pool cards drawn a season, in all and while a trip is live          at most 2 while a trip is live
//   favours on the desk a season
// It also fails if any season broke a rule of the draw: more than two pool cards while a trip was live, a pool
// favour beside another favour, two pool cards of one kind, a card with no `kind`. The rules themselves are
// pinned one by one, each seen to fail without it, in test/engine.mjs (the draw) and test/letters.mjs (the letter).
// The letter share was 19.5 percent over 1,000 games on 2026-11-19 (four roads had no letter), 65.4 after MER-79 wrote letters
// for them, and reaches the target after MER-82: a trip that has written nothing is sure to write at the last opening it has
// (letters.js `chanceFor`), which the roads of one stop (Qus, Alexandria, Damascus) needed, since they have one opening and
// no ramp to climb. The share printed over 1,000 games is in the MER-82 report. HOLD is FLOOR, so the check that fails is the
// design's own floor; TARGET is printed each run with the gap and the table by route. A question still cannot be written on
// a road with no decision point left, and every letter is once a game, so a few trips bring none.
// Plain Node, no browser, no clock. bots.mjs reads process.argv when it is imported, so the one argument is `--games N`.
import fs from 'node:fs/promises';
import { loadContent } from '../js/data.js';
import { steps } from '../js/engine/turn.js';
import { playGame } from '../tools/bots.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? Number(process.argv[i + 1]) : fallback; };
const GAMES = arg('games', 1000);
export const TARGET = 0.7, FLOOR = 0.5, HOLD = FLOOR;

const content = await loadContent('cairo', { fs });
const kindOf = id => content.cards.find(c => c.id === id)?.kind;
const cardsAt = s => s.desk.filter(p => p.kind === 'card');

const seasons = [], trips = [], broke = [];
let game = null;

// watch the opening: what the draw added, what the letters step delivered, which trips came home
const { drawCards, letters, returns } = steps;
steps.returns = (s, c, ...a) => {
  const before = s.desk.length;
  returns(s, c, ...a);
  for (const p of s.desk.slice(before)) if (p.kind === 'return' && p.data?.trip) game.returned.push({ expedition: p.expedition, seasons: p.data.trip.seasons, route: p.data.trip.route });
};
steps.letters = (s, c, ...a) => {
  // a letter is put ahead of its own trip's return paper (letters.js `deliver`, MER-118), so it is not at the end of the desk: compare the papers, not the length
  const was = new Set(s.desk);
  letters(s, c, ...a);
  for (const p of s.desk) if (!was.has(p) && p.kind === 'letter') game.lettered.add(p.expedition);
};
steps.drawCards = (s, c, ...a) => {
  const before = s.desk.length, live = s.expeditions.length > 0 || s.desk.some(p => p.kind === 'return' || p.kind === 'lost');
  drawCards(s, c, ...a);
  if (s.t === 0) return;                                    // the first season is written (the opening), not drawn
  const pool = s.desk.slice(before).filter(p => p.kind === 'card');
  const kinds = pool.map(p => kindOf(p.ref));
  const favoursBefore = s.desk.slice(0, before).filter(p => p.kind === 'card' && kindOf(p.ref) === 'favour').length;
  const favours = cardsAt(s).filter(p => kindOf(p.ref) === 'favour').length;
  seasons.push({ pool: pool.length, live, favours });
  const why = [];
  if (live && pool.length > 2) why.push(`${pool.length} pool cards while a trip was live`);
  if (new Set(kinds).size !== kinds.length) why.push(`two pool cards of one kind (${kinds.join(', ')})`);
  if (kinds.includes('favour') && favoursBefore >= 1) why.push('a pool favour beside a favour already on the desk');
  if (pool.some(p => !kindOf(p.ref))) why.push('a pool card with no kind');
  if (why.length) broke.push(`game ${game.seed} season ${s.t}: ${why.join('; ')}`);
};

const bots = ['careful', 'greedy', 'qirad'], houses = content.houses.map(h => h.id);
const started = Date.now();
for (let i = 0; i < GAMES; i++) {
  game = { seed: 1000 + i, returned: [], lettered: new Set() };
  playGame(content, { bot: bots[i % bots.length], seed: game.seed, house: houses[i % houses.length] });
  for (const r of game.returned) if (r.seasons >= 3) trips.push({ seasons: r.seasons, route: r.route, letter: game.lettered.has(r.expedition) });
}
Object.assign(steps, { drawCards, letters, returns });

const n = seasons.length, mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const withLetter = trips.filter(t => t.letter).length, share = trips.length ? withLetter / trips.length : 0;
const live = seasons.filter(x => x.live), idle = seasons.filter(x => !x.live);
const fmt = x => (Number.isFinite(x) ? x.toFixed(2) : 'n/a');
console.log(`paper mix over ${GAMES} games, ${n} seasons opened after the first (${((Date.now() - started) / 1000).toFixed(0)} s)`);
console.log(`  trips of three seasons or more that came home: ${trips.length}; with a letter: ${withLetter} (${(share * 100).toFixed(1)} percent; target ${TARGET * 100}, floor ${FLOOR * 100})`);
console.log(`  pool cards a season: ${fmt(mean(seasons.map(x => x.pool)))} in all, ${fmt(mean(live.map(x => x.pool)))} while a trip is live (${live.length} seasons), ${fmt(mean(idle.map(x => x.pool)))} with none (${idle.length})`);
console.log(`  favours on the desk a season: ${fmt(mean(seasons.map(x => x.favours)))} on average, most ${Math.max(0, ...seasons.map(x => x.favours))}; seasons with two or more: ${seasons.filter(x => x.favours > 1).length}`);

let failed = false;
const fail = msg => { console.log(`FAIL ${msg}`); failed = true; };
const byRoute = {};
for (const t of trips) { const r = (byRoute[t.route] ??= { n: 0, letters: 0 }); r.n++; if (t.letter) r.letters++; }
console.log('  by route (trips of three seasons or more, with a letter):');
for (const [route, r] of Object.entries(byRoute).sort((a, b) => b[1].n - a[1].n)) console.log(`    ${route.padEnd(24)} ${String(r.n).padStart(4)} ${String(r.letters).padStart(4)}`);
const untagged = content.cards.filter(c => !c.kind).map(c => c.id);
if (untagged.length) fail(`cards with no kind: ${untagged.join(', ')}`);
if (broke.length) fail(`${broke.length} seasons broke a rule of the draw, first: ${broke[0]}`);
if (share < HOLD) fail(`only ${(share * 100).toFixed(1)} percent of trips of three seasons or more brought a letter; the engine gave about 70 when this was written, so it has lost letters (HOLD ${HOLD * 100})`);
if (share < FLOOR) console.log(`  BELOW THE DESIGN'S FLOOR of ${FLOOR * 100} percent by ${((FLOOR - share) * 100).toFixed(1)} points, and ${((TARGET - share) * 100).toFixed(1)} short of the ${TARGET * 100} percent target (see the head of this file)`);
else if (share < TARGET) console.log(`  above the floor, ${((TARGET - share) * 100).toFixed(1)} points short of the ${TARGET * 100} percent target`);
process.exitCode = failed ? 1 : 0;
