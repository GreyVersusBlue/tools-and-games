// The score (ARCHITECTURE 4.10): node test/score.mjs, from Projects/Merchant/. Plain Node, no clock.
// Each part and the multiplier has a named case, built from a state with nothing in it so the part
// under test is the only thing that moves the total. Then whole games of both cities' lengths end with one.
import fs from 'node:fs/promises';
import { test, eq, ok, done } from './lib.mjs';
import { loadContent } from '../js/data.js';
import { freshState } from '../js/engine/state.js';
import { newGame, openSeason, choose, paperChoices, endSeason, recall, score, outfit } from '../js/engine/index.js';
import { readEntry } from '../js/engine/turn.js';
import { recallRisk, chanceWord } from '../js/engine/routes.js';
import { scaled, netWealth, REP_GROUP_POINTS, HOME_POINTS, HOME_TRUST_BONUS, NOTEBOOK_POINTS } from '../js/engine/score.js';

const testport = await loadContent('testport', { fs });
const cairo = await loadContent('cairo', { fs });

/** A plain-house state stripped to nothing: no money, stock, loans, notebook, no agent home, and every
    group of reputation at -3, which earns nothing (a group at 0 would earn half). */
function bare(over = {}) {
  const s = freshState(testport, { seed: 1, length: 'acts', house: 'plain' });
  s.money = 0; s.stock = {}; s.loans = []; s.notebook = []; s.notebookRead = [];
  for (const g of Object.keys(s.rep)) s.rep[g] = -3;
  for (const a of Object.values(s.agents)) a.where = 'dead';
  return Object.assign(s, over);
}
const part = (s, id, c = testport) => score(s, c).parts.find(p => p.id === id);
const home = testport.city.home;

test('score: an empty house scores nothing and takes the lowest rank', () => {
  const r = score(bare(), testport);
  eq(r.total, 0);
  eq(r.rank, testport.city.score.ranks[0].name);
  eq(r.parts.map(p => p.id), ['wealth', 'reputation', 'people', 'notebook']);
});

test('score: every part carries a one-line reason in words', () => {
  const s = bare({ money: 700 }); s.rep.court = 2; s.notebook = ['a'];
  s.agents.mira.where = home; s.agents.mira.hired = true;
  for (const p of score(s, testport).parts) ok(typeof p.reason === 'string' && p.reason.length > 10 && !p.reason.includes('\n'), p.id);
});

test('score: wealth runs money through the city scale, straight between its steps', () => {
  eq(part(bare({ money: 500 }), 'wealth').points, 10);
  eq(part(bare({ money: 750 }), 'wealth').points, 15);
  eq(part(bare({ money: 99999 }), 'wealth').points, 60);
  eq(part(bare({ money: 0 }), 'wealth').points, 0);
  eq(scaled([[0, 0], [100, 10]], -50), 0);
});

test('score: wealth counts stock at the last known price at home, and a good with no known price at nothing', () => {
  const s = bare({ money: 500 }); const g = Object.keys(testport.goods.length ? Object.fromEntries(testport.goods.map(x => [x.id, 1])) : {})[0];
  s.stock = { [g]: 10 };
  eq(part(s, 'wealth').points, 10, 'no known price');
  s.known = { [home]: { [g]: { p: 50, at: 0 } } };
  eq(part(s, 'wealth').points, 20, '500 money and 10 at 50 is 1000');
  s.known = { elsewhere: { [g]: { p: 50, at: 0 } } };
  eq(part(s, 'wealth').points, 10, 'a price known only elsewhere is not the home price');
});

test('score: wealth takes loans away', () => {
  const s = bare({ money: 1000 });
  eq(part(s, 'wealth').points, 20);
  s.loans = [{ id: 'l1', from: 'x', principal: 500, due: 9, rate: 0.1 }];
  eq(part(s, 'wealth').points, 10);
  s.loans.push({ id: 'l2', from: 'x', principal: 5000, due: 9, rate: 0.1 });
  eq(part(s, 'wealth').points, 0, 'a house in debt scores 0 here, never less');
});

test('score: reputation counts from the middle: a group at 0 earns half, -3 nothing, +3 all', () => {
  const s = bare();
  const rep = (...v) => { s.rep = { partners: v[0], agents: v[1], court: v[2], foreign: v[3] }; return part(s, 'reputation').points; };
  eq(rep(-3, -3, -3, -3), 0);
  eq(rep(0, 0, 0, 0), 4 * REP_GROUP_POINTS / 2, 'a house that never met anyone sits at half, not at the floor');
  eq(rep(3, 3, 3, 3), 4 * REP_GROUP_POINTS);
  eq(rep(0, 0, 0, 0) > rep(-3, 0, 0, 0), true, 'one group that was annoyed scores under a house that met no one');
  eq(rep(3, -3, 0, 0), REP_GROUP_POINTS + 0 + REP_GROUP_POINTS / 2 * 2, 'each group is its own line: +3 all, -3 none, two at 0 half each');
  eq(rep(1, 0, 0, 0), REP_GROUP_POINTS * (4 + 3 + 3 + 3) / 6);
});

test('score: the named case: an annoyed partner costs points a house that met no one keeps', () => {
  const met = bare(); met.rep = { partners: 0, agents: 0, court: 0, foreign: 0 };
  const annoyed = bare(); annoyed.rep = { partners: -2, agents: 0, court: 0, foreign: 0 };
  const lost = part(met, 'reputation').points - part(annoyed, 'reputation').points;
  ok(Math.abs(lost - REP_GROUP_POINTS / 6 * 2) < 1e-9, `lost ${lost}`);
  ok(/below the middle/.test(part(annoyed, 'reputation').reason) && /at the middle/.test(part(met, 'reputation').reason), part(annoyed, 'reputation').reason);
});

test('score: people home counts the hired who made a trip and are alive in the home city, more at trust 2 or 3', () => {
  const s = bare();
  s.agents.mira.hired = true; s.agents.mira.where = home; s.agents.mira.trust = 1; s.agents.mira.trips = 1;
  eq(part(s, 'people').points, HOME_POINTS);
  s.agents.mira.trust = 2;
  eq(part(s, 'people').points, HOME_POINTS + HOME_TRUST_BONUS);
  s.agents.tobin.hired = true; s.agents.tobin.where = home; s.agents.tobin.trust = 3; s.agents.tobin.trips = 2;
  eq(part(s, 'people').points, 2 * (HOME_POINTS + HOME_TRUST_BONUS));
});

test('score: an agent who is dead, gone, away or not hired earns nothing', () => {
  const s = bare();
  s.agents.mira.trips = 3;
  for (const where of ['dead', 'gone', 'road', 'hilltown']) {
    s.agents.mira.hired = true; s.agents.mira.where = where;
    eq(part(s, 'people').points, 0, where);
  }
  s.agents.mira.where = home; s.agents.mira.hired = false;
  eq(part(s, 'people').points, 0, 'not hired');
});

test('score: a hire who never left home scores nothing for people, whenever they were hired (the M4 play\'s last-season hires)', () => {
  const s = bare();
  s.agents.mira.hired = true; s.agents.mira.where = home; s.agents.mira.trust = 3;   // trusted, alive, home, and never sent
  eq(part(s, 'people').points, 0);
  ok(/never left Harbour and counts for nothing/.test(part(s, 'people').reason), part(s, 'people').reason);
  s.agents.mira.trips = 1;
  eq(part(s, 'people').points, HOME_POINTS + HOME_TRUST_BONUS, 'one trip is enough');
  ok(!/never left/.test(part(s, 'people').reason), part(s, 'people').reason);
  s.agents.tobin.hired = true; s.agents.tobin.where = home;   // a second hire who never left
  eq(part(s, 'people').points, HOME_POINTS + HOME_TRUST_BONUS, 'the one who stayed adds nothing');
  s.agents.mira.where = 'dead';
  eq(part(s, 'people').points, 0, 'a traveller who died before the end scores nothing either');
});

test('score: sending an agent counts a trip, and it is what the people part reads end to end', () => {
  let s = newGame(testport, { seed: 7, length: 'acts', house: 'plain' });
  eq(s.agents.mira.trips ?? 0, 0);
  s = outfit(s, testport, { agent: 'mira', route: 'harbour-hilltown', cargo: { wool: 10 }, purse: 0, contract: 'own', sell: ['wool'], buy: [] });
  eq(s.agents.mira.trips, 1);
  const home0 = JSON.parse(JSON.stringify(s)); home0.expeditions = []; home0.agents.mira.where = home;
  ok(part(home0, 'people').points >= HOME_POINTS, 'back from that trip, Mira scores');
  const never = newGame(testport, { seed: 7, length: 'acts', house: 'plain' });
  eq(part(never, 'people').points, 0, 'a house that sent nobody has no one who counts');
});

test('score: the wealth part carries cash, stock with its loads, loans and what a recall brought, and says them with separators', () => {
  const g = testport.goods[0].id;
  const s = bare({ money: 2000 });
  s.stock = { [g]: 12 }; s.known = { [home]: { [g]: { p: 50, at: 0 } } };
  s.loans = [{ id: 'l1', from: 'x', principal: 147, due: 9, rate: 0.1 }];
  s.log = [{ at: 5, kind: 'recall', results: [{ agent: 'mira', how: 'recalled', survived: true, brought: 300 }, { agent: 'tobin', how: 'home', survived: true }] }];
  const w = part(s, 'wealth');
  eq(w.data, { cash: 2000, stock: { value: 600, loads: 12, goods: [{ good: g, loads: 12, price: 50 }], unpriced: 0 }, loans: 147, brought: 300, net: 2453 });
  eq(w.reason, 'The house holds 2,453 dinars: 2,000 in cash (300 of it brought home by a recall), 600 in 12 loads of stock at the last prices known at home, less 147 owed.'.replace('dinars', testport.city.currency));
  eq(netWealth(s, testport).net, 2453);
  const plain = part(bare({ money: 1200 }), 'wealth');
  eq(plain.reason, `The house holds 1,200 ${testport.city.currency}: 1,200 in cash, no stock, and owes nothing.`);
  const unknown = bare({ money: 100 }); unknown.stock = { [g]: 3 };
  ok(/3 loads of it with no known price and counted for nothing/.test(part(unknown, 'wealth').reason), part(unknown, 'wealth').reason);
});

test('recall: the engine says each person\'s odds in words, on the road and at home, from the numbers it rolls with', () => {
  const c = structuredClone(testport);
  c.city.recall = { reach: { start: 0.9, perSeason: 0, floor: 0 }, recalledKeeps: 0.5, recalledSurvives: 0.9, stayedSurvives: 0.5, homeSurvives: 0.6, byStop: {} };
  let s = newGame(c, { seed: 7, length: 'acts', house: 'plain' });
  let facts = recallRisk(s, c);
  const m = facts.find(f => f.agent === 'mira');
  eq([m.where, m.place, m.ifStays, m.risk], ['home', home, 0.6, 'maybe'], 'at home the plague takes 4 in 10: "maybe"');
  s = outfit(s, c, { agent: 'mira', route: 'harbour-hilltown', cargo: { wool: 10 }, purse: 0, contract: 'own', sell: ['wool'], buy: [] });
  const r = recallRisk(s, c).find(f => f.agent === 'mira');
  eq([r.where, r.expedition, r.reach, r.reachWord, r.ifStays, r.risk], ['road', 'x1', 0.9, 'sure', 0.5, 'likely']);
  ok(Math.abs(r.ifCalled - (0.9 * 0.9 + 0.1 * 0.5)) < 1e-9, `ifCalled ${r.ifCalled}`);
  eq(r.riskIfCalled, 'unlikely', 'called, 14 in 100 die: unlikely');
  eq(recallRisk(s, c).filter(f => f.agent === 'mira').length, 1, 'one fact per person, not one at home as well');
  s.agents.tobin.where = 'dead'; s.agents.mira.hired = false;
  eq(recallRisk(s, c).find(f => f.agent === 'tobin'), undefined, 'the dead are not asked about');
  eq([0.8, 0.79, 0.5, 0.49, 0.25, 0.24].map(chanceWord), ['sure', 'likely', 'likely', 'maybe', 'maybe', 'unlikely']);
});

test('recall: a return at the end writes the money it brought, and the score\'s wealth says it', () => {
  const c = structuredClone(testport);
  for (const r of c.routes) for (const l of r.legs) l.risk = 0;
  c.city.recall = { reach: { start: 1, perSeason: 0, floor: 1 }, recalledKeeps: 1, recalledSurvives: 1, stayedSurvives: 1, homeSurvives: 1, byStop: {} };
  let s = newGame(c, { seed: 7, length: 'acts', house: 'plain' });
  s = outfit(s, c, { agent: 'mira', route: 'harbour-hilltown', cargo: { wool: 10 }, purse: 40, contract: 'own', sell: ['wool'], buy: [] });
  s.phase = 'recall';
  const before = s.money;
  const e = recall(s, c, { [s.expeditions[0].id]: 'recall' });
  const line = e.log.at(-1).results[0];
  eq(line.how, 'recalled');
  eq(line.brought, e.money - before, 'brought is exactly what the cash gained');
  ok(line.brought >= 40, `the purse alone is 40, got ${line.brought}`);
  eq(e.score.parts.find(p => p.id === 'wealth').data.brought, line.brought);
  eq(e.agents.mira.trips, 1);
});

test('score: the notebook gives points per entry opened and read, not per entry found', () => {
  const s = bare();
  s.notebook = ['a', 'b', 'c', 'd'];
  eq(part(s, 'notebook').points, 0, 'found and never opened is worth nothing');
  eq(part(s, 'notebook').reason, 'No page of the notebook was opened and read.');
  s.notebookRead = ['a', 'b', 'b', 'zz'];   // a repeat counts once, and a page never found is not counted
  eq(part(s, 'notebook').points, 2 * NOTEBOOK_POINTS);
  eq(part(s, 'notebook').reason, '2 pages in the notebook opened and read.');
  s.notebookRead = ['a', 'b', 'c', 'd'];
  eq(part(s, 'notebook').points, 4 * NOTEBOOK_POINTS);
});

test('score: an old save with no read list reads as having read nothing', () => {
  const s = bare(); s.notebook = ['a', 'b']; delete s.notebookRead;
  eq(part(s, 'notebook').points, 0);
  eq(score(s, testport).total, 0);
});

test('readEntry: adds a found entry once, ignores one not found, and leaves its input alone', () => {
  let s = bare(); s.notebook = ['a', 'b'];
  const before = structuredClone(s);
  const one = readEntry(s, testport, 'a');
  eq(one.notebookRead, ['a']); eq(s, before);
  eq(readEntry(one, testport, 'a'), one, 'a second reading changes nothing');
  eq(readEntry(one, testport, 'zz').notebookRead, ['a'], 'an entry not found is not read');
  eq(readEntry(readEntry(one, testport, 'b'), testport, 'a').notebookRead, ['a', 'b']);
  delete s.notebookRead;
  eq(readEntry(s, testport, 'b').notebookRead, ['b'], 'a state with no list gets one');
  eq(part(readEntry(readEntry(s, testport, 'a'), testport, 'b'), 'notebook').points, 2 * NOTEBOOK_POINTS);
});

test('score: the house multiplier is on the sum, and the rank follows the total', () => {
  const plain = bare({ money: 1000 }); plain.notebook = plain.notebookRead = ['a', 'b'];       // 20 + two pages read
  const rich = bare({ money: 1000, house: 'rich' }); rich.notebook = rich.notebookRead = ['a', 'b'];
  const sum = 20 + 2 * NOTEBOOK_POINTS;   // the testport scale gives 20 for 1000, the notebook is a rate
  const a = score(plain, testport), b = score(rich, testport);
  eq(a.sum, sum); eq(a.multiplier, 1); eq(a.total, Math.round(sum));
  eq(b.sum, sum); eq(b.multiplier, 1.2); eq(b.total, Math.round(sum * 1.2));
  const big = score(bare({ money: 8000, house: 'rich' }), testport);
  eq(big.total, 72);
  eq(big.rank, 'A small but steady house');
  // reputation and four notebook pages lift the same house over the line (rates are the game's, so the pin follows them)
  const lifted = score(bare({ money: 8000, house: 'rich', notebook: ['a', 'b', 'c', 'd'], notebookRead: ['a', 'b', 'c', 'd'], rep: { partners: 3, agents: 3, court: 3, foreign: 3 } }), testport);
  ok(lifted.total >= 80, `total ${lifted.total} is under the respected line`);
  eq(lifted.rank, 'A respected house');
});

test('score: it is pure, and the state it reads is left alone', () => {
  const s = bare({ money: 900 }); const before = structuredClone(s);
  const one = score(s, testport), two = score(s, testport);
  eq(s, before); eq(one, two);
});

// ---- whole games

// The first choice on each paper that the engine allows: a bot would play better, and this need not.
const answer = (s, c) => {
  for (const p of s.desk) {
    if (p.state !== 'open') continue;
    for (const ch of paperChoices(s, c, p.id)) {
      try { s = choose(s, c, p.id, ch.id); break; } catch { /* not allowed now: try the next */ }
    }
  }
  return s;
};
function play(content, opts) {
  let s = newGame(content, opts), n = 0;
  while (s.phase !== 'recall') {
    s = s.phase === 'interlude' ? openSeason(s, content) : endSeason(answer(s, content), content);
    if (++n > 200) throw new Error('no recall in 200 steps');
  }
  ok(s.score === null, 'no score before the end');
  return recall(s, content, {});
}

test('score: testport and both lengths of cairo end with a score that matches score()', () => {
  for (const [c, name, houses] of [[testport, 'testport', ['plain', 'rich']], [cairo, 'cairo', ['spice', 'cloth', 'newcomer']]]) {
    for (const length of Object.keys(c.calendar.lengths)) {
      for (const house of houses) {
        const s = play(c, { seed: 11, length, house });
        const tag = `${name} ${length} ${house}`;
        eq(s.phase, 'ended', tag);
        ok(s.score && Number.isInteger(s.score.total) && s.score.total >= 0 && s.score.rank, tag);
        eq(s.score, score(s, c), tag);
      }
    }
  }
});

test('score: a save taken after the end carries the score through JSON', () => {
  const s = play(testport, { seed: 3, length: 'acts', house: 'rich' });
  eq(JSON.parse(JSON.stringify(s)).score, s.score);
});

await done();
