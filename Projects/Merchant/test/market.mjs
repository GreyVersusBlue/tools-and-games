// Markets and old news (ARCHITECTURE 4.2 step 3, 4.8): node test/market.mjs, from Projects/Merchant/.
// Every rule runs on testport (the invented city) and on cairo. Plain Node, no browser, no clock.
import fs from 'node:fs/promises';
import { test, eq, ok, throws, done } from './lib.mjs';
import { loadContent } from '../js/data.js';
import { validateContent } from '../js/engine/content.js';
import { holds } from '../js/engine/conditions.js';
import { apply } from '../js/engine/effects.js';
import { seasonIndex } from '../js/engine/calendar.js';
import * as M from '../js/engine/market.js';
import { newGame, endSeason, view, paperChoices, choose } from '../js/engine/index.js';

const CITIES = {
  testport: { content: await loadContent('testport', { fs }), house: 'plain', stop: 'saltmarsh', good: 'lamps', far: 'hilltown', farLag: 2, nearLag: 1, foldAt: 2 },
  cairo: { content: await loadContent('cairo', { fs }), house: 'spice', stop: 'damascus', good: 'linen', far: 'tabriz', farLag: 4, nearLag: 1, foldAt: 1 },
};
for (const c of Object.values(CITIES)) c.orig = c.content;
for (const c of Object.values(CITIES)) c.content = { ...c.content, city: { ...c.content.city, priceNews: true } };

/** First choice whose requirement holds, for every open paper. */
function answer(s, content) {
  for (const p of s.desk) {
    if (p.state !== 'open') continue;
    const ch = paperChoices(s, content, p.id).find(c => holds(c.requires, s, content));
    s = choose(s, content, p.id, ch.id);
  }
  return s;
}
const play = (s, content, seasons) => { for (let i = 0; i < seasons; i++) s = endSeason(answer(s, content), content); return s; };
const idxOf = (s, content) => seasonIndex(s, content);
const firstGood = (content, stop) => Object.keys(content.stops.find(x => x.id === stop).sells)[0];

for (const [name, C] of Object.entries(CITIES)) {
  const { content } = C;
  const game = (over = {}) => newGame(content, { seed: 7, length: 'acts', house: C.house, ...over });
  const T = n => `${name}: ${n}`;
  const home = content.city.home;
  const farStop = C.far, nearStop = C.stop;
  const g0 = firstGood(content, home);
  const setF = (s, stop, good, f, glut = 0) => { s.market[stop][good].f = f; s.market[stop][good].glut = glut; return s; };
  const flat = (edit = () => {}) => { // no randomness in the drift, so the arithmetic is the rule alone
    const c = structuredClone(content);
    for (const g of c.goods) g.sigma = 0;
    edit(c);
    return c;
  };

  test(T('the true price is the base times f times one minus glut, rounded to whole dinars'), () => {
    const s = game();
    const base = content.stops.find(x => x.id === home).sells[g0].base;
    eq(M.truePrice(s, content, home, g0), Math.round(base), 'a level market is the base');
    setF(s, home, g0, 1.37, 0.2);
    eq(M.truePrice(s, content, home, g0), Math.round(base * 1.37 * 0.8));
    eq(M.truePrice(s, content, home, 'nothing-trades-here'), null);
  });

  test(T('drift is repeatable by seed, differs by seed, and never draws from state.rng'), () => {
    // two seasons, not three: testport's third season crosses the act gap, where ARCH 4.7 resets markets
    const a = play(game(), content, 2), b = play(game(), content, 2), c = play(game({ seed: 8 }), content, 2);
    const fs_ = s => JSON.stringify(Object.values(s.market).map(m => Object.values(m).map(e => e.f)));
    eq(fs_(a), fs_(b));
    ok(fs_(a) !== fs_(c), 'a different seed drifts differently');
    ok(fs_(a) !== fs_(game()), 'prices moved at all');
    // drift alone leaves the game's one random source where it was
    const s = game(), before = s.rng;
    M.drift(s, content);
    eq(s.rng, before);
  });

  test(T('revert pulls f toward 1 from above and from below, by the good\'s own rate'), () => {
    const c = flat();
    const rev = c.goods.find(g => g.id === g0).revert;
    for (const start of [1.8, 0.6]) {
      const s = setF(newGame(c, { seed: 7, length: 'acts', house: C.house }), home, g0, start);
      M.drift(s, c);
      const f = s.market[home][g0].f;
      ok(Math.abs(f - 1) < Math.abs(start - 1), `${start} moved toward 1, got ${f}`);
      ok(Math.abs(f - Math.pow(start, 1 - rev)) < 1e-3, `${start}^(1 - ${rev}) is ${Math.pow(start, 1 - rev)}, got ${f}`);
    }
    const level = newGame(c, { seed: 7, length: 'acts', house: C.house });
    M.drift(level, c);
    eq(level.market[home][g0].f, 1, 'with no noise a level market stays level');
  });

  test(T('f is clamped to 0.5 and 2.0 however wild the noise'), () => {
    const c = structuredClone(content);
    for (const g of c.goods) { g.sigma = 5; g.revert = 0; }
    let s = newGame(c, { seed: 3, length: 'acts', house: C.house });
    for (let i = 0; i < 40; i++) {
      M.drift(s, c);
      s.t = 0; // the season index is part of the stream; walk it by hand
      s.seed += 1;
      for (const m of Object.values(s.market)) for (const e of Object.values(m)) ok(e.f >= 0.5 && e.f <= 2, `f ${e.f}`);
    }
    const all = Object.values(s.market).flatMap(m => Object.values(m).map(e => e.f));
    ok(all.some(f => f === 0.5 || f === 2), 'sigma 5 pins at least one factor to a bound');
  });

  test(T('selling raises glut and lowers the price; it halves each season and is capped at 0.6'), () => {
    const c = flat();
    const s = newGame(c, { seed: 7, length: 'acts', house: C.house });
    const depth = c.stops.find(x => x.id === home).sells[g0].depth;
    const before = M.sellPrice(s, c, home, g0);
    M.noteSale(s, c, home, g0, 2);
    eq(s.market[home][g0].glut, Math.round(2 / depth * 1e4) / 1e4);
    ok(M.sellPrice(s, c, home, g0) < before, 'the price fell');
    const g = s.market[home][g0].glut;
    M.drift(s, c);
    ok(Math.abs(s.market[home][g0].glut - g / 2) < 1e-3, `glut halves: ${g} to ${s.market[home][g0].glut}`);
    M.noteSale(s, c, home, g0, 100000);
    eq(s.market[home][g0].glut, 0.6);
    for (let i = 0; i < 20; i++) M.drift(s, c);
    eq(s.market[home][g0].glut, 0, 'it decays to nothing and stays there');
  });

  test(T('buying makes scarcity: the price rises, glut goes negative and is floored at -0.3'), () => {
    const s = game();
    const before = M.buyPrice(s, content, home, g0);
    M.notePurchase(s, content, home, g0, 1);
    ok(s.market[home][g0].glut < 0);
    ok(M.buyPrice(s, content, home, g0) > before, 'the price rose');
    M.notePurchase(s, content, home, g0, 100000);
    eq(s.market[home][g0].glut, -0.3);
    throws(() => M.noteSale(s, content, home, g0, -1), /not a number of loads/);
    throws(() => M.noteSale(s, content, home, 'nowhere', 1), /does not trade/);
  });

  test(T('a price event multiplies f, and two events multiply'), () => {
    const s = game();
    const before = M.truePrice(s, content, home, g0);
    apply(s, content, { price: home, good: g0, by: 0.5 });
    eq(s.market[home][g0].f, 0.5);
    ok(M.truePrice(s, content, home, g0) <= Math.round(before * 0.5) + 1);
    apply(s, content, { price: home, good: g0, by: 2 });
    eq(s.market[home][g0].f, 1, 'two events multiply');
  });

  test(T('baseByAct sets the base in the three-act game and not in the full game'), () => {
    const c = structuredClone(content);
    const sell = c.stops.find(x => x.id === home).sells[g0];
    sell.baseByAct = [sell.base, sell.base * 2, sell.base * 3];
    const acts = newGame(c, { seed: 7, length: 'acts', house: C.house });
    eq(M.baseOf(acts, c, home, g0, 0), sell.base, 'act one');
    const last = c.calendar.lengths.acts.acts.at(-1).from;
    eq(M.baseOf(acts, c, home, g0, last), sell.base * (c.calendar.lengths.acts.acts.length === 3 ? 3 : 2), 'the last act');
    const full = newGame(c, { seed: 7, length: 'full', house: C.house });
    eq(M.baseOf(full, c, home, g0, last), sell.base, 'the full game is on the base alone');
  });

  test(T('the history keeps the last 12 seasons of true prices per stop and good, newest last'), () => {
    const c = flat(x => { x.calendar.lengths.full.acts = [{ from: 0, to: 20 }]; });
    let s = newGame(c, { seed: 7, length: 'full', house: C.house });
    const seen = [];
    for (let i = 0; i < 15; i++) {
      seen.push(M.truePrice(s, c, home, g0));
      M.drift(s, c);
      s.t += 1;
    }
    const h = s.market[home][g0].h;
    eq(h.length, 12);
    eq(h.map(e => e[0]), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(n => n - 0));
    eq(M.priceAt(s, home, g0, 14), seen[14]);
    eq(M.priceAt(s, home, g0, 2), null, 'older than twelve is gone');
  });

  test(T('lag is the distance home in seasons along the route: a near stop and a far one'), () => {
    eq(M.lagOf(content, home), 0);
    eq(M.lagOf(content, nearStop), C.nearLag);
    eq(M.lagOf(content, farStop), C.farLag);
    ok(C.farLag > C.nearLag);
  });

  test(T('a price letter carries the prices of now minus lag and sets known with that season'), () => {
    const c = content;
    let s = game({ length: 'full' });
    const written = idxOf(s, c);
    const truth = {};
    for (const stop of c.stops) for (const g of Object.keys(s.market[stop.id])) truth[`${stop.id}/${g}`] = M.truePrice(s, c, stop.id, g);
    s = play(s, c, C.farLag);
    const idx = idxOf(s, c);
    eq(idx, C.farLag);
    const fg = Object.keys(s.market[farStop])[0];
    eq(s.known[farStop]?.[fg], { p: truth[`${farStop}/${fg}`], at: written }, 'the far stop\'s news was written lag seasons ago');
    const news = s.desk.find(p => p.kind === 'news');
    const letter = news.letters.find(l => l.stop === farStop);
    eq(letter.at, written);
    eq(letter.prices[fg], truth[`${farStop}/${fg}`]);
    // the near stop's letter of this same season was written one season ago, not at the start
    const near = news.letters.find(l => l.stop === nearStop);
    eq(near.at, idx - C.nearLag);
  });

  test(T('a far stop sends nothing before its lag has passed, a near one sends the first season it can'), () => {
    let s = game({ length: 'full' });
    eq(s.desk.some(p => p.kind === 'news'), false, 'no news in the first season: nothing is a season old');
    s = play(s, content, 1);
    const letters = s.desk.find(p => p.kind === 'news')?.letters ?? [];
    ok(letters.some(l => l.stop === nearStop), 'near stop wrote');
    ok(!letters.some(l => l.stop === farStop), 'far stop has not arrived');
    ok(!s.known[farStop]);
  });

  test(T('letters that arrive together are one paper, with one line in the first year and none after'), () => {
    let s = game({ length: 'full' });
    s = play(s, content, C.foldAt);
    const papers = s.desk.filter(p => p.kind === 'news');
    eq(papers.length, 1, 'folded into one paper');
    ok(papers[0].letters.length >= 2, 'with more than one letter in it');
    ok(/ pays \d+ for /.test(papers[0].line), `the one line: ${papers[0].line}`);
    s = play(s, content, 4 - C.foldAt);
    const later = s.desk.find(p => p.kind === 'news');
    ok(later && later.line === undefined, 'from the second year there is no one-line form');
    eq(paperChoices(s, content, later.id), [{ id: 'ok', label: 'Noted' }]);
    s = choose(s, content, later.id, 'ok');
    eq(s.desk.find(p => p.kind === 'news').state, 'done');
  });

  // ---- MER-72: what the house expects a good to fetch, and what the first letter names
  test(T('first year line: it names every good the house holds that the stop sells, then home\'s price for each, once'), () => {
    let s = game({ length: 'full' });
    const held = Object.keys(s.stock).filter(g => s.stock[g] > 0 && s.market[home]?.[g]);
    s = play(s, content, C.foldAt);
    const paper = s.desk.find(p => p.kind === 'news');
    const stopName = id => content.stops.find(x => x.id === id).name;
    const gname = id => content.goods.find(x => x.id === id).name.toLowerCase();
    for (const l of paper.letters) {
      const goods = held.filter(g => l.prices[g] !== undefined);
      if (!goods.length) continue;
      for (const g of goods) ok(paper.line.includes(`${l.prices[g]} for ${gname(g)}`), `${stopName(l.stop)} letter names ${g}: ${paper.line}`);
    }
    ok(held.length >= 1, 'the house holds goods to name');
    eq(paper.line.split(`${content.stops.find(x => x.id === home).name} pays`).length, 2, `home's sentence once: ${paper.line}`);
  });

  test(T('expectedPrice: no news is null; a price known this season is itself; an old one is pulled toward the base; it reads only what the house knows'), () => {
    let s = game({ length: 'full' });
    const good = Object.keys(content.stops.find(x => x.id === nearStop).sells)[0];
    eq(M.expectedPrice(s, content, nearStop, good), null, 'no news at the start');
    const idx = idxOf(s, content), base = M.baseOf(s, content, nearStop, good);
    const rev = content.goods.find(g => g.id === good).revert;
    s.known[nearStop] = { [good]: { p: Math.round(base * 1.6), at: idx } };
    eq(M.expectedPrice(s, content, nearStop, good).p, Math.round(base * 1.6), 'age 0 is the known price');
    const ages = [1, 2, 4, 8].map(a => { const t = structuredClone(s); t.known[nearStop][good].at = idx - a; return M.expectedPrice(t, content, nearStop, good); });
    for (const e of ages) ok(e && e.p >= base && e.p <= Math.round(base * 1.6), `between base ${base} and 1.6 x base: ${e && e.p}`);
    // aged by the same factor drift pulls with: f^(1-revert) a season, no noise
    const one = structuredClone(s); one.known[nearStop][good].at = idx - 1;
    eq(M.expectedPrice(one, content, nearStop, good).p, Math.round(base * Math.pow(Math.round(base * 1.6) / base, 1 - rev)), 'one season old');
    const old = structuredClone(s); old.known[nearStop][good].at = idx - 12;
    ok(Math.abs(M.expectedPrice(old, content, nearStop, good).p - base) < Math.abs(Math.round(base * 1.6) - base) / 2, 'twelve seasons old is nearer the base than the price was');
    // a below-base price is pulled up, not down
    const low = structuredClone(s); low.known[nearStop][good] = { p: Math.round(base * 0.6), at: idx - 3 };
    const lowE = M.expectedPrice(low, content, nearStop, good);
    ok(lowE.p > Math.round(base * 0.6) && lowE.p <= base, `a low price rises toward the base: ${lowE.p}`);
    // the true market is not read: change it and nothing moves
    const a = M.expectedPrice(one, content, nearStop, good).p;
    one.market[nearStop][good].f = 2; one.market[nearStop][good].glut = 0.5; one.market[nearStop][good].h = [];
    eq(M.expectedPrice(one, content, nearStop, good).p, a, 'the true factor is not an input');
    eq(M.expectedPrice(s, content, nearStop, 'nothing'), null, 'a good nobody trades');
  });

  test(T('priceNews alone governs the price letters: a city with no letters file still gets them, one that says false gets none'), () => {
    const sent = c => play(newGame(c, { seed: 7, length: 'full', house: C.house }), c, 3).desk.some(p => p.kind === 'news');
    eq(sent({ ...content, letters: [] }), true, 'no letters file, priceNews true');
    eq(sent({ ...content, city: { ...content.city, priceNews: false } }), false, 'priceNews false');
  });

  test(T('the home stop\'s price is always current in known'), () => {
    const s = game();
    eq(s.known[home]?.[g0], { p: M.truePrice(s, content, home, g0), at: 0 });
  });

  test(T('view() shows known prices with the season written and the age in words, and never the truth'), () => {
    let s = game({ length: 'full' });
    s = play(s, content, C.farLag + 1);
    const v = view(s, content);
    const fg = Object.keys(s.market[farStop])[0];
    const e = v.prices[farStop][fg];
    ok(e.p > 0 && /^(Spring|Summer|Autumn|Winter) \d{4}$/.test(e.written), e.written);
    eq(e.ageWords, M.ageWords(idxOf(s, content) - e.at));
    eq(M.ageWords(0), 'this season'); eq(M.ageWords(2), 'two seasons old'); eq(M.ageWords(13), '13 seasons old');
    // the truth moves, the view does not
    const seen = JSON.stringify(view(s, content).prices);
    const t = structuredClone(s);
    for (const m of Object.values(t.market)) for (const x of Object.values(m)) { x.f = 1.9; x.glut = 0.5; x.h = []; }
    eq(JSON.stringify(view(t, content).prices), seen, 'only letters change what the view says');
    const flatten = (o, path = '') => Object.entries(o ?? {}).flatMap(([k, x]) => x && typeof x === 'object' ? flatten(x, `${path}.${k}`) : [`${path}.${k}`]);
    ok(!JSON.stringify(v).includes('"market"'), 'no market in the view');
    ok(!flatten(v).some(k => /\.(f|glut|h)$/.test(k)), 'no factor, glut or history in the view');
    // a stop never written to reads "no news"
    const lonely = structuredClone(s); lonely.known = {};
    eq(view(lonely, content).prices[farStop][fg], { p: null, at: null, written: null, age: null, ageWords: 'no news' });
  });

  test(T('a save of the market round-trips through JSON (history included)'), () => {
    const s = play(game(), content, 3);
    eq(JSON.parse(JSON.stringify(s.market)), s.market);
  });

  test(T('the content still validates'), () => {
    validateContent(structuredClone(C.orig));
  });
}

// ---- the stock condition leaf and the chest unit (cairo)
const cairo = CITIES.cairo.content;
test('stock leaf: true at the count and above it, false below, and a missing good counts as none', () => {
  const s = newGame(cairo, { seed: 7, length: 'acts', house: 'spice' });
  eq(holds({ stock: 'linen', gte: 20 }, s, cairo), true);
  eq(holds({ stock: 'linen', gte: 21 }, s, cairo), false);
  eq(holds({ stock: 'gold', gte: 1 }, s, cairo), false);
  throws(() => holds({ stock: 'linen' }, s, cairo), /needs gte/);
  throws(() => holds({ stock: 'linen', gte: 'x' }, s, cairo), /number/);
  throws(() => holds({ stock: 'linen', lte: 3 }, s, cairo), /unknown key/);
});

test('stock leaf: the two selling choices need the goods they sell', () => {
  const need = { 'linen-neighbour': ['linen', 10], 'gold-price-falls': ['gold', 2] };
  for (const [id, [good, n]] of Object.entries(need)) {
    const sell = cairo.cards.find(c => c.id === id).choices.find(c => c.id === 'sell');
    eq(sell.requires, { stock: good, gte: n });
    const s = newGame(cairo, { seed: 7, length: 'acts', house: 'spice' });
    s.stock = { [good]: n - 1 };
    eq(holds(sell.requires, s, cairo), false, `${id} with one load short`);
    s.stock = { [good]: n };
    eq(holds(sell.requires, s, cairo), true, `${id} with enough`);
  }
});

test('stock leaf: the lint accepts it on a card and refuses a good that does not exist', () => {
  const raw = structuredClone(cairo);
  const card = raw.cards.find(c => c.id === 'linen-neighbour');
  const sell = card.choices.find(c => c.id === 'sell');
  validateContent(raw);
  sell.requires = { stock: 'moonlight', gte: 1 };
  throws(() => validateContent(raw), /moonlight/);
  sell.requires = { stock: 'linen' };
  throws(() => validateContent(raw), /gte/);
});

test('chest unit: goods.json may say "chest"; an unknown unit is still refused', () => {
  const raw = structuredClone(cairo);
  raw.goods.find(g => g.id === 'gold').unit = 'chest';
  validateContent(raw);
  raw.goods.find(g => g.id === 'gold').unit = 'barrel';
  throws(() => validateContent(raw), /barrel|unit/);
});

done();
