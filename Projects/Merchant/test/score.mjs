// The score (ARCHITECTURE 4.10): node test/score.mjs, from Projects/Merchant/. Plain Node, no clock.
// Each part and the multiplier has a named case, built from a state with nothing in it so the part
// under test is the only thing that moves the total. Then whole games of both cities' lengths end with one.
import fs from 'node:fs/promises';
import { test, eq, ok, done } from './lib.mjs';
import { loadContent } from '../js/data.js';
import { freshState } from '../js/engine/state.js';
import { newGame, openSeason, choose, paperChoices, endSeason, recall, score } from '../js/engine/index.js';
import { scaled, REP_POINTS, HOME_POINTS, HOME_TRUST_BONUS, NOTEBOOK_POINTS } from '../js/engine/score.js';

const testport = await loadContent('testport', { fs });
const cairo = await loadContent('cairo', { fs });

/** A plain-house state stripped to nothing: no money, stock, loans, rep, notebook, and no agent home. */
function bare(over = {}) {
  const s = freshState(testport, { seed: 1, length: 'acts', house: 'plain' });
  s.money = 0; s.stock = {}; s.loans = []; s.notebook = [];
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

test('score: reputation is the four groups summed, scaled, and never under 0', () => {
  const s = bare();
  s.rep = { partners: 1, agents: 2, court: 0, foreign: -1 };
  eq(part(s, 'reputation').points, 2 * REP_POINTS);
  s.rep = { partners: 3, agents: 3, court: 3, foreign: 3 };
  eq(part(s, 'reputation').points, 12 * REP_POINTS);
  s.rep = { partners: -3, agents: -3, court: -3, foreign: -3 };
  eq(part(s, 'reputation').points, 0);
});

test('score: people home counts the hired who are alive and in the home city, more at trust 2 or 3', () => {
  const s = bare();
  s.agents.mira.hired = true; s.agents.mira.where = home; s.agents.mira.trust = 1;
  eq(part(s, 'people').points, HOME_POINTS);
  s.agents.mira.trust = 2;
  eq(part(s, 'people').points, HOME_POINTS + HOME_TRUST_BONUS);
  s.agents.tobin.hired = true; s.agents.tobin.where = home; s.agents.tobin.trust = 3;
  eq(part(s, 'people').points, 2 * (HOME_POINTS + HOME_TRUST_BONUS));
});

test('score: an agent who is dead, gone, away or not hired earns nothing', () => {
  const s = bare();
  for (const where of ['dead', 'gone', 'road', 'hilltown']) {
    s.agents.mira.hired = true; s.agents.mira.where = where;
    eq(part(s, 'people').points, 0, where);
  }
  s.agents.mira.where = home; s.agents.mira.hired = false;
  eq(part(s, 'people').points, 0, 'not hired');
});

test('score: the notebook gives points per entry found', () => {
  const s = bare();
  s.notebook = ['a', 'b', 'c', 'd'];
  eq(part(s, 'notebook').points, 4 * NOTEBOOK_POINTS);
  eq(part(s, 'notebook').reason, '4 pages in the notebook.');
});

test('score: the house multiplier is on the sum, and the rank follows the total', () => {
  const plain = bare({ money: 1000 }); plain.notebook = ['a', 'b'];       // 20 + two pages
  const rich = bare({ money: 1000, house: 'rich' }); rich.notebook = ['a', 'b'];
  const sum = 20 + 2 * NOTEBOOK_POINTS;   // the testport scale gives 20 for 1000, the notebook is a rate
  const a = score(plain, testport), b = score(rich, testport);
  eq(a.sum, sum); eq(a.multiplier, 1); eq(a.total, Math.round(sum));
  eq(b.sum, sum); eq(b.multiplier, 1.2); eq(b.total, Math.round(sum * 1.2));
  const big = score(bare({ money: 8000, house: 'rich' }), testport);
  eq(big.total, 72);
  eq(big.rank, 'A small but steady house');
  // reputation and four notebook pages lift the same house over the line (rates are the game's, so the pin follows them)
  const lifted = score(bare({ money: 8000, house: 'rich', notebook: ['a', 'b', 'c', 'd'], rep: { partners: 3, agents: 3, court: 3, foreign: 3 } }), testport);
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
