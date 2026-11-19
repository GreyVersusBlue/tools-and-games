// Balance bots, the fast pass for CI (ARCHITECTURE 7.3): node test/bots-smoke.mjs, from Projects/Merchant/.
// Plays 200 three-act games (50 for each of the four bots) and checks that the bots work, not that the
// game is balanced: the thresholds in tools/bots.mjs are judged by `node tools/bots.mjs`, which needs
// thousands of games to mean anything and is run by hand. Plain Node, no browser, no clock.
import os from 'node:os';
import fs from 'node:fs/promises';
import { test, eq, ok, done } from './lib.mjs';
import { loadContent } from '../js/data.js';
import { BOTS, LIMITS, DIRECTIONS, SENSIBLE, directionOf, directionShares, run, check, playGame, table, ranked, worthOf } from '../tools/bots.mjs';

const content = await loadContent('cairo', { fs });
const PER_BOT = 50;
const workers = Math.max(1, Math.min(3, os.availableParallelism?.() ?? 2));
const res = await run({ games: PER_BOT, bots: BOTS, content, workers });
const all = Object.values(res.results).flat();

test('smoke: 200 games were played, 50 for each of the four bots, every one to the ended phase', () => {
  eq(all.length, 200);
  for (const b of BOTS) eq(res.results[b].length, PER_BOT, b);
  for (const g of all) ok(Number.isFinite(g.worth), `${g.bot}/${g.seed} worth ${g.worth}`);
});

test('smoke: the games rotate through every house of the content', () => {
  const seen = new Set(res.results.careful.map(g => g.house));
  eq([...seen].sort(), content.houses.map(h => h.id).sort());
});

test('smoke: every bot sent expeditions and every round trip is a finite share', () => {
  for (const b of BOTS) {
    const trips = res.results[b].flatMap(g => g.trips);
    ok(trips.length > 0, `${b} made no round trip in ${PER_BOT} games`);
    for (const t of trips) ok(Number.isFinite(t) && t > -10 && t < 20, `${b} trip ${t}`);
  }
});

test('smoke: an expedition still on the road at an act jump counts as a trip (the jump entry is found even when later log entries follow it)', () => {
  const settled = all.reduce((n, g) => n + g.settled, 0);
  ok(settled > 0, `no expedition settled at a jump was counted in ${all.length} games`);
});

test('smoke: the bots differ (the careful bot sends smaller stakes than the greedy one)', () => {
  // the mean, not the median: both bots' stakes sit on the same few depth-capped sizes (450 for both at 50 games), so
  // a median over 50 games only measures which size the middle trip landed on
  const mean = b => { const a = res.results[b].flatMap(g => g.capital); return a.reduce((n, x) => n + x, 0) / a.length; };
  ok(mean('careful') < mean('greedy'), `careful ${mean('careful')}, greedy ${mean('greedy')}`);
});

test('smoke: the same seed plays the same game twice', () => {
  const args = { bot: 'greedy', seed: 4242, house: 'cloth' };
  eq(playGame(content, args), playGame(content, args));
});

test('smoke: a game on a worker thread equals the same game in this thread', async () => {
  const a = await run({ games: 3, bots: ['careful', 'qirad'], content, workers: 1 });
  const b = await run({ games: 3, bots: ['careful', 'qirad'], content, workers: 2 });
  const line = g => `${g.bot}/${g.seed}/${g.house}: worth ${g.worth}, routes ${JSON.stringify(g.routes)}`;
  eq(Object.values(b.results).flat().map(line), Object.values(a.results).flat().map(line));
  eq(b.results, a.results);
});

test('smoke: an unknown bot and an unknown house are refused, not played as something else', () => {
  for (const args of [{ bot: 'sneaky', seed: 1, house: 'cloth' }, { bot: 'careful', seed: 1, house: 'nobody' }]) {
    let threw = false;
    try { playGame(content, args); } catch { threw = true; }
    ok(threw, `${args.bot}/${args.house} must throw`);
  }
});

test('smoke: the check returns one row per threshold and the table prints', () => {
  const checked = check(res);
  const names = checked.rows.map(r => r.name).join(' | ');
  for (const part of ['most-used', 'broke by season', '75th percentile', 'after wage', 'under a doubling', 'every card drawn', 'choices taken', 'rep.agents', 'mediterranean: share', 'levant-persia: share', 'redsea-india: share', 'sahara: share', 'redsea-india: median round trip']) ok(names.includes(part), `no row for "${part}"`);
  ok(table(res, checked).includes('worth by house'));
});

// ---- the checks fail when their thresholds are breached (the guard-rails of tools/bots.mjs)
const doctored = edit => { const r = structuredClone({ results: res.results, offered: res.offered, taken: res.taken, games: res.games }); edit(r); return check({ ...r, content }); };
const failing = c => c.rows.filter(r => !r.ok).map(r => r.name);

test('check: one route that every greedy game uses most is a breach of the route share', () => {
  const c = doctored(r => { for (const g of r.results.greedy) g.routes = { 'cairo-calicut': 3 }; });
  ok(failing(c).some(n => n.includes('most-used')), failing(c).join('; '));
  ok(!c.ok);
});

test('check: a careful player broke by season 5 in every game is a breach', () => {
  const c = doctored(r => { for (const g of r.results.careful) g.brokeBy = LIMITS.brokeBySeason; });
  ok(failing(c).some(n => n.includes('broke by season')), failing(c).join('; '));
});

test('check: careful no better than random is a breach of the score spread', () => {
  const c = doctored(r => { for (const g of r.results.careful) g.worth = 0; });
  ok(failing(c).some(n => n.includes('75th percentile')), failing(c).join('; '));
});

test('check: a card no game draws is a breach, and the row names it', () => {
  const c = doctored(r => { for (const l of Object.values(r.results)) for (const g of l) g.cards = g.cards.filter(x => x !== 'first-expedition'); });
  const row = c.rows.find(x => x.name.includes('every card drawn'));
  ok(!row.ok && row.note.includes('first-expedition'), JSON.stringify(row));
});

test('check: a median round trip that doubles the money is a breach', () => {
  const c = doctored(r => { for (const g of r.results.qirad) g.trips = g.trips.map(() => 1.4); });
  ok(failing(c).some(n => n.startsWith('qirad') && n.includes('doubling')), failing(c).join('; '));
});

test('check: a round trip median outside 10 to 30 percent is a breach and one inside is not', () => {
  const inside = doctored(r => { for (const b of ['careful', 'greedy']) for (const g of r.results[b]) g.trips = g.trips.map(() => 0.2); });
  eq(failing(inside).filter(n => n.includes('after wage')), []);
  const below = doctored(r => { for (const g of r.results.careful) g.trips = g.trips.map(() => 0.02); });
  ok(failing(below).some(n => n.startsWith('careful') && n.includes('after wage')));
});

// ---- the long roads paid most (MER-51b): the Red Sea and India's median trip is at least the Mediterranean's
const medianRow = c => c.rows.find(r => r.name.startsWith('redsea-india: median round trip'));
/** Every sensible bot's games get one trip on each route named, with the profit given per route. */
const withTrips = profit => doctored(r => { for (const b of SENSIBLE) for (const g of r.results[b]) { g.tripRoute = Object.keys(profit); g.trips = Object.values(profit); } });

test('median by direction: the Red Sea and India paying 20 against the Mediterranean\'s 15 passes, and a tie passes', () => {
  ok(medianRow(withTrips({ 'cairo-calicut': 0.2, 'cairo-venice': 0.15 })).ok);
  ok(medianRow(withTrips({ 'cairo-calicut': 0.15, 'cairo-venice': 0.15 })).ok, 'equal is fine');
});

test('median by direction: the Red Sea and India paying under the Mediterranean is a breach, by one point of a hundred', () => {
  const c = withTrips({ 'cairo-calicut': 0.14, 'cairo-venice': 0.15 });
  ok(!medianRow(c).ok && !c.ok, JSON.stringify(medianRow(c)));
});

test('median by direction: a run with no Red Sea trip at all is a breach, not a pass by default', () => {
  ok(!medianRow(withTrips({ 'cairo-venice': 0.15 })).ok);
});

// ---- the four directions (MER-51): where the careful, greedy and qirad bots' trips end
const dirRoutes = { mediterranean: 'cairo-venice', 'levant-persia': 'cairo-damascus', 'redsea-india': 'cairo-calicut', sahara: 'cairo-tuat' };
/** Gives every sensible bot's games the same expeditions: `mix` is a count per direction for each of 100 games. */
const withMix = mix => doctored(r => { for (const b of SENSIBLE) for (const g of r.results[b]) g.routes = Object.fromEntries(Object.entries(mix).filter(([, n]) => n).map(([d, n]) => [dirRoutes[d], n])); });
const dirRows = c => c.rows.filter(r => /^(mediterranean|levant-persia|redsea-india|sahara): share/.test(r.name));

test('direction: every destination of the content belongs to one direction and the four lists do not overlap', () => {
  const all = Object.values(DIRECTIONS).flat();
  eq(new Set(all).size, all.length);
  const ends = new Set(content.routes.map(r => r.to));
  for (const e of ends) ok(directionOf(e), `${e} is in no direction`);
  for (const d of all) ok(content.stops.some(s => s.id === d), `${d} is not a stop`);
});

test('direction: the mediterranean at 40 percent and each other direction at 20, 20 and 20 passes all four rows', () => {
  const c = withMix({ mediterranean: 40, 'levant-persia': 20, 'redsea-india': 20, sahara: 20 });
  eq(dirRows(c).length, 4);
  eq(dirRows(c).filter(r => !r.ok).map(r => r.name), []);
});

test('direction: every trip to the mediterranean breaches all four rows, so one road can no longer carry the game', () => {
  const c = withMix({ mediterranean: 5 });
  eq(dirRows(c).filter(r => !r.ok).map(r => r.name.split(':')[0]).sort(), ['levant-persia', 'mediterranean', 'redsea-india', 'sahara']);
  ok(!c.ok);
});

test('direction: the mediterranean at 65 percent is a breach and the others at 12, 12 and 11 are not', () => {
  const c = withMix({ mediterranean: 65, 'levant-persia': 12, 'redsea-india': 12, sahara: 11 });
  eq(dirRows(c).filter(r => !r.ok).map(r => r.name.split(':')[0]), ['mediterranean']);
});

test('direction: the sahara at 5 percent is a breach and the mediterranean at 50 is not', () => {
  const c = withMix({ mediterranean: 50, 'levant-persia': 20, 'redsea-india': 25, sahara: 5 });
  eq(dirRows(c).filter(r => !r.ok).map(r => r.name.split(':')[0]), ['sahara']);
});

test('direction: the shares count each bot together, so a direction the careful bot never visits can be saved by the greedy one', () => {
  const r = structuredClone(res.results);
  for (const g of r.careful) g.routes = { 'cairo-venice': 4 };
  for (const g of r.greedy) g.routes = { 'cairo-tuat': 4 };
  for (const g of r.qirad) g.routes = {};
  const sh = directionShares(content, SENSIBLE.flatMap(b => r[b]));
  eq([sh.mediterranean, sh.sahara, sh['redsea-india']], [0.5, 0.5, 0]);
});

test('direction: a route that ends nowhere in the four directions throws instead of being left out of the shares', () => {
  const r = structuredClone(res.results);
  r.careful[0].routes = { 'cairo-nowhere': 1 };
  let threw = false;
  try { directionShares({ routes: [...content.routes, { id: 'cairo-nowhere', to: 'atlantis' }] }, r.careful); } catch { threw = true; }
  ok(threw);
});

test('direction: a run without the careful, greedy and qirad bots has no direction rows and does not throw', () => {
  const c = check({ ...res, results: { random: res.results.random } });
  eq(dirRows(c).length, 0);
});

// ---- the card policy (MER-68)
const choice = (id, now = [], later = []) => ({ id, now, later });
const pick = (bot, list, state = { money: 1000, stock: {} }, temper = {}) => ranked(bot, state, content, list, () => 0.5, temper).map(c => c.id);

test('policy: careful takes the choice with the least money at risk, greedy the most money now plus later', () => {
  const list = [choice('spend', [{ money: -100 }], [{ in: 2, do: [{ money: 300 }] }]), choice('hold'), choice('earn', [{ money: 20 }])];
  eq(pick('careful', list), ['earn', 'hold', 'spend'], 'no outlay first, then the more money');
  eq(pick('qirad', list)[0], 'earn');
  eq(pick('greedy', list)[0], 'spend');
  eq(pick('greedy', list).length, 3, 'every open choice is ranked, so a refused one falls through to the next');
});

test('policy: a follow-up card counts at its best answer for greedy, scaled by how far greedy trusts it', () => {
  const k = content.cards.find(c => c.id === 'silk-order'), agree = k.choices.find(c => c.id === 'agree');
  const full = worthOf({ money: 1000, stock: {} }, content, agree, 1).net, none = worthOf({ money: 1000, stock: {} }, content, agree, 0).net;
  ok(full > none + 400, `follow-up worth ${full} against ${none}`);
});

test('policy: standing breaks a money tie for careful and is bought with cash by greedy', () => {
  const list = [choice('cold', [{ rep: 'partners', by: -1 }]), choice('warm', [{ rep: 'partners', by: 1 }])];
  eq(pick('careful', list)[0], 'warm');
  eq(pick('greedy', list, { money: 1000, stock: {} }, { partners: 0.1 })[0], 'warm');
  const paid = [choice('cash', [{ money: 50 }]), choice('warm', [{ rep: 'partners', by: 1 }])];
  eq(pick('greedy', paid, { money: 1000, stock: {} }, { partners: 0.01 })[0], 'cash');
  eq(pick('greedy', paid, { money: 1000, stock: {} }, { partners: 0.1 })[0], 'warm', 'a house that values standing flips the same card');
});

test('policy: random shuffles the open choices and never reads their worth', () => {
  const list = [choice('a'), choice('b', [{ money: 500 }]), choice('c')];
  const seen = new Set();
  for (let i = 0; i < 40; i++) { let x = i * 0.37 + 0.11; seen.add(ranked('random', { money: 0, stock: {} }, content, list, () => (x = (x * 7.13) % 1))[0].id); }
  ok(seen.size >= 2, [...seen].join());
});

test('policy: over the smoke games a bot with the policy and a bot without differ in what they take', () => {
  const answered = b => Object.entries(res.results[b].reduce((m, g) => { for (const [k, n] of Object.entries(g.takes)) m[k] = (m[k] ?? 0) + n; return m; }, {})).sort().map(([k, n]) => `${k}:${n}`).join();
  ok(answered('careful') !== answered('greedy'));
});

test('check: a choice greedy takes every time its card is offered is a breach, and the row names it', () => {
  const offered = { 'greedy|some-card': 100 }, taken = { 'greedy|some-card|yes': 95, 'greedy|some-card|no': 5 };
  const row = c => c.rows.find(x => x.name.includes('choices taken'));
  const c = check({ ...res, offered, taken });
  ok(!row(c).ok && row(c).note.includes('some-card/yes'), JSON.stringify(row(c)));
  ok(!check({ ...res, offered, taken: { 'greedy|some-card|yes': 90, 'greedy|some-card|no': 10 } }).rows.find(x => x.name.includes('choices taken')).note.includes('some-card'), '90 percent is not over 90');
});

test('check: a card with fewer than the minimum offers is not judged, and a listed choice is skipped, not forgiven by name alone', () => {
  const row = c => c.rows.find(x => x.name.includes('choices taken'));
  ok(row(check({ ...res, offered: { 'greedy|few': LIMITS.choiceMinOffers - 1 }, taken: { 'greedy|few|yes': LIMITS.choiceMinOffers - 1 } })).ok);
  const listed = LIMITS.choiceExempt[0], [card, id] = listed.split('/');
  ok(row(check({ ...res, offered: { [`greedy|${card}`]: 100 }, taken: { [`greedy|${card}|${id}`]: 100 } })).ok, 'a listed choice is skipped');
  ok(!row(check({ ...res, offered: { [`greedy|${card}`]: 100 }, taken: { [`greedy|${card}|other`]: 100 } })).ok, 'the same card, another choice, is judged');
});

test('check: every exempt choice names a card and a choice that exist in the content', () => {
  for (const key of LIMITS.choiceExempt) {
    const [card, id] = key.split('/'), k = content.cards.find(c => c.id === card);
    ok(k && k.choices.some(c => c.id === id), `${key} is not in the content`);
  }
});

test('check: careful ending the game with rep.agents at 3 in half the games is a breach, and in a third is not', () => {
  const row = c => c.rows.find(x => x.name.startsWith('careful: rep.agents'));
  const half = doctored(r => r.results.careful.forEach((g, i) => { g.repAgents = i % 2 ? 3 : 0; }));
  ok(!row(half).ok, JSON.stringify(row(half)));
  const third = doctored(r => r.results.careful.forEach((g, i) => { g.repAgents = i % 3 ? 0 : 3; }));
  ok(row(third).ok, JSON.stringify(row(third)));
});

test('smoke: every game reports rep.agents in range and the table prints its distribution', () => {
  for (const g of all) ok(Number.isInteger(g.repAgents) && g.repAgents >= -3 && g.repAgents <= 3, `${g.bot}/${g.seed} ${g.repAgents}`);
  ok(table(res, check(res)).includes('rep.agents at game end'));
});

test('check: a run with no greedy bot has no greedy rows and does not throw', () => {
  const only = { ...res, results: { careful: res.results.careful } };
  const c = check(only);
  ok(!c.rows.some(r => r.name.startsWith('greedy')));
});

await done();
