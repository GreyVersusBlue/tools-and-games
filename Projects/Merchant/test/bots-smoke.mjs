// Balance bots, the fast pass for CI (ARCHITECTURE 7.3): node test/bots-smoke.mjs, from Projects/Merchant/.
// Plays 200 three-act games (50 for each of the four bots) and checks that the bots work, not that the
// game is balanced: the thresholds in tools/bots.mjs are judged by `node tools/bots.mjs`, which needs
// thousands of games to mean anything and is run by hand. Plain Node, no browser, no clock.
import os from 'node:os';
import fs from 'node:fs/promises';
import { test, eq, ok, done } from './lib.mjs';
import { loadContent } from '../js/data.js';
import { BOTS, LIMITS, run, check, playGame, table } from '../tools/bots.mjs';

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

test('smoke: the bots differ (the careful bot sends smaller stakes than the greedy one)', () => {
  const med = b => { const a = res.results[b].flatMap(g => g.capital).sort((x, y) => x - y); return a[a.length >> 1]; };
  ok(med('careful') < med('greedy'), `careful ${med('careful')}, greedy ${med('greedy')}`);
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
  for (const part of ['most-used', 'broke by season', '75th percentile', 'after wage', 'under a doubling', 'every card drawn', 'choices taken']) ok(names.includes(part), `no row for "${part}"`);
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

test('check: the choice rule is pending until a card policy exists, and fails once it is switched on', () => {
  const offered = { 'greedy|some-card': 100 }, taken = { 'greedy|some-card|yes': 95, 'greedy|some-card|no': 5 };
  const row = c => c.rows.find(x => x.name.includes('choices taken'));
  const pending = check({ ...res, offered, taken });
  ok(LIMITS.choicePending && row(pending).ok && row(pending).pending && row(pending).note.includes('some-card/yes'), JSON.stringify(row(pending)));
  LIMITS.choicePending = false;
  try { ok(!row(check({ ...res, offered, taken })).ok); } finally { LIMITS.choicePending = true; }
});

test('check: a run with no greedy bot has no greedy rows and does not throw', () => {
  const only = { ...res, results: { careful: res.results.careful } };
  const c = check(only);
  ok(!c.rows.some(r => r.name.startsWith('greedy')));
});

await done();
