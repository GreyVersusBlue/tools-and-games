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
import { newGame, openSeason, endSeason, view, paperChoices, choose, outfit, sellHome, sellHomeQuote, BROKER_CUT } from '../js/engine/index.js';
import { steps } from '../js/engine/turn.js';
import { worthOf, NOTE } from '../js/engine/worth.js';
import { netWealth } from '../js/engine/score.js';
import { estimate } from '../js/engine/routes.js';

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

  test(T('letters that arrive together are one paper with a price line, in every year'), () => {
    let s = game({ length: 'full' });
    s = play(s, content, C.foldAt);
    const papers = s.desk.filter(p => p.kind === 'news');
    eq(papers.length, 1, 'folded into one paper');
    ok(papers[0].letters.length >= 2, 'with more than one letter in it');
    ok(typeof papers[0].line === 'string' && papers[0].line.length > 0, 'a line is always there, so the desk never shows the table');
    s = play(s, content, 4 - C.foldAt);
    const later = s.desk.find(p => p.kind === 'news');
    ok(later && typeof later.line === 'string', 'from the second year too');
    eq(paperChoices(s, content, later.id), [{ id: 'ok', label: 'Noted' }]);
    s = choose(s, content, later.id, 'ok');
    eq(s.desk.find(p => p.kind === 'news').state, 'done');
  });

  // ---- MER-94: price news as leads. A scene where every letter of the season is arriving, with the
  // far prices forced high, so the rules have more than two candidates to choose from.
  const scene = (edit = () => {}) => {
    const s = play(game({ length: 'full' }), content, C.foldAt);
    s.desk = s.desk.filter(p => p.kind !== 'news');
    const idx = idxOf(s, content);
    const due = content.stops.filter(st => { const lag = M.lagOf(content, st.id); return lag && idx % lag === 0; });
    for (const st of due) for (const g of Object.keys(s.market[st.id])) {
      s.market[st.id][g].h = [[idx - M.lagOf(content, st.id), 100 + 10 * due.indexOf(st) + g.length]];
    }
    edit(s, due);
    M.news(s, content);
    return { s, idx, due, paper: s.desk.find(p => p.kind === 'news') };
  };
  const lineCount = line => (line.match(/ pays \d+ for /g) ?? []).length;

  test(T('MER-94 never more than two price lines, widest margin first, written as the lead reads'), () => {
    const { s, paper } = scene();
    ok(paper.letters.length >= 2, 'several letters arrived');
    ok(paper.letters.reduce((n, l) => n + Object.keys(l.prices).length, 0) > 2, 'with more than two prices between them');
    eq(paper.leads.length, 2, 'two leads, not the whole table');
    eq(lineCount(paper.line), 2, `two price lines: ${paper.line}`);
    const m = l => l.p - l.home;
    ok(m(paper.leads[0]) >= m(paper.leads[1]), 'the widest margin first');
    for (const l of paper.leads) {
      const stop = content.stops.find(x => x.id === l.stop).name, good = content.goods.find(x => x.id === l.good).name.toLowerCase();
      const homeName = content.stops.find(x => x.id === home).name;
      ok(paper.line.includes(`${stop} pays ${l.p} for ${good}. ${homeName} pays ${l.home}.`), `the lead's own words: ${paper.line}`);
      ok(paper.line.includes(l.writtenIn), 'the news season is written');
      eq(l.home, M.truePrice(s, content, home, l.good), 'home price is the price now');
    }
    const worst = Math.min(...paper.leads.map(m));
    for (const l of paper.letters) for (const [g, p] of Object.entries(l.prices)) {
      if (paper.leads.some(d => d.stop === l.stop && d.good === g) || !s.market[home][g]) continue;
      ok(p - M.truePrice(s, content, home, g) <= worst, `${l.stop}/${g} is not wider than a lead`);
    }
  });

  test(T('MER-94 a good the house cannot touch never gets a line'), () => {
    // a good home does not trade: its price at a far stop is the highest on the table and still never leads
    let touched = null;
    const { paper } = scene((s, due) => {
      const stopId = due[0].id, g = Object.keys(s.market[stopId]).find(x => s.market[home][x]);
      touched = { stopId, g };
      delete s.market[home][g];
      s.market[stopId][g].h = [[idxOf(s, content) - M.lagOf(content, stopId), 9999]];
      s.stock[g] = 0;
    });
    const gname = content.goods.find(x => x.id === touched.g).name.toLowerCase();
    eq(paper.letters.find(l => l.stop === touched.stopId).prices[touched.g], 9999, 'the letter does carry the price');
    ok(!paper.leads.some(l => l.good === touched.g), 'no lead names it');
    ok(!paper.line.includes(` for ${gname}.`), `the line does not: ${paper.line}`);
  });

  test(T('MER-94 a stop with no open road gets no line, and known still updates for every city that wrote'), () => {
    const { s, idx, due, paper } = scene((s) => { s.known = {}; });
    for (const st of due) for (const g of Object.keys(paper.letters.find(l => l.stop === st.id).prices)) {
      eq(s.known[st.id][g], { p: paper.letters.find(l => l.stop === st.id).prices[g], at: idx - M.lagOf(content, st.id) }, `${st.id}/${g} known`);
    }
    // every route to the first due stop closed in every season (the legs stay, so the lag and the letter do too)
    const target = due[0].id;
    const shut = { ...content, routes: content.routes.map(r => r.to !== target ? r : { ...r, legs: r.legs.map(l => ({ ...l, opens: [] })) }) };
    const t = structuredClone(s); t.desk = t.desk.filter(p => p.kind !== 'news'); t.known = {};
    M.news(t, shut);
    const p2 = t.desk.find(p => p.kind === 'news');
    ok(!p2.leads.some(l => l.stop === target), 'no lead about a stop with no road');
    ok(p2.letters.some(l => l.stop === target), 'its letter is still there');
    ok(t.known[target] && Object.keys(t.known[target]).length > 0, 'and known still has its prices');
  });

  test(T('MER-94 no lead leaves one plain sentence, not the table'), () => {
    const { paper } = scene((s, due) => { for (const st of due) for (const g of Object.keys(s.market[st.id])) s.market[st.id][g].h = [[idxOf(s, content) - M.lagOf(content, st.id), 1]]; });
    eq(paper.leads, []);
    eq(paper.line, 'The letters hold no price worth a road this season.');
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

// ---- selling the warehouse at home (MER-139, M4d play problem 1)
const CAIRO = CITIES.cairo.content;
const withCopper = n => { const s = newGame(CAIRO, { seed: 7, length: 'acts', house: 'cloth' }); s.stock.copper = n; return s; };
test('sellHome: the money, the stock and the broker\'s cut come out as the quote said', () => {
  const s = withCopper(20), price = M.sellPrice(s, CAIRO, 'cairo', 'copper');
  const q = sellHomeQuote(s, CAIRO, 'copper', 1);
  eq([q.ok, q.first, q.got, q.cut], [true, Math.round(price * (1 - BROKER_CUT)), Math.round(price * (1 - BROKER_CUT)), price - Math.round(price * (1 - BROKER_CUT))], 'one load fetches the price less the cut');
  const t = sellHome(s, CAIRO, 'copper', 5), q5 = sellHomeQuote(s, CAIRO, 'copper', 5);
  eq(t.money - s.money, q5.got, 'the house gets what the quote said');
  eq([t.stock.copper, s.stock.copper], [15, 20], 'five loads left the warehouse, and the old state is untouched');
  ok(q5.got < q5.gross && q5.cut === q5.gross - q5.got, 'the cut is the gap between what the market paid and what the house kept');
  eq(BROKER_CUT, 0.15);
});
test('sellHome: the home market is marked by the house\'s own selling, as for any sale', () => {
  const s = withCopper(20), before = M.sellPrice(s, CAIRO, 'cairo', 'copper');
  const t = sellHome(s, CAIRO, 'copper', 10);
  ok(t.market.cairo.copper.glut > s.market.cairo.copper.glut, 'glut rose');
  ok(M.sellPrice(t, CAIRO, 'cairo', 'copper') < before, 'the next load fetches less');
  eq(t.market.cairo.copper.glut, 0.333, 'ten loads over a depth of thirty, a load at a time, as noteSale rounds it');
  eq(t.market.cairo.linen, s.market.cairo.linen, 'no other good moves');
});
test('sellHome: the Accounts paper and the ledger\'s log show the sale', () => {
  const s = withCopper(20), t = sellHome(s, CAIRO, 'copper', 4);
  const paper = t.desk.find(p => p.kind === 'accounts');
  ok(paper, 'an Accounts paper is on the desk');
  eq(paper.state, 'done', 'a sale the player made needs no answer');
  ok(/Sold 4 loads of copper/.test(paper.items[0].text) && /broker's cut/.test(paper.items[0].text), paper.items[0].text);
  eq(paper.items[0].changes[1], '−4 copper');
  eq(t.log.filter(e => e.kind === 'sale'), [{ at: 0, kind: 'sale', good: 'copper', loads: 4, got: t.money - s.money, cut: sellHomeQuote(s, CAIRO, 'copper', 4).cut }]);
  const u = sellHome(t, CAIRO, 'copper', 2);
  eq(u.desk.filter(p => p.kind === 'accounts').length, 1, 'a second sale goes on the same paper');
  eq(u.desk.find(p => p.kind === 'accounts').items.length, 2);
  ok(endSeason(answer(u, CAIRO), CAIRO).phase === 'desk', 'the season still ends with the paper there');
});
test('sellHome: a house with none of the good, too few, a good home does not buy, or a bad count is refused with a reason', () => {
  const s = withCopper(3);
  for (const [good, n, re] of [['pepper', 1, /no pepper in the warehouse/], ['copper', 4, /only 3 loads of copper/], ['copper', 0, /at least one/], ['copper', 1.5, /at least one/], ['mumbo', 1, /does not deal/]]) {
    const q = sellHomeQuote(s, CAIRO, good, n);
    ok(!q.ok && re.test(q.reason), `${good} ${n}: ${q.reason}`);
    throws(() => sellHome(s, CAIRO, good, n), re);
  }
  const c = structuredClone(CAIRO); delete c.stops.find(x => x.id === 'cairo').sells.copper; delete s.market.cairo.copper;
  ok(/does not buy copper/.test(sellHomeQuote(s, c, 'copper', 1).reason));
  eq(s.money, withCopper(3).money, 'a refusal changes nothing');
});
test('sellHome: selling all of 100 loads at once fetches less a load than selling 10', () => {
  const s = withCopper(100), all = sellHomeQuote(s, CAIRO, 'copper', 100), ten = sellHomeQuote(s, CAIRO, 'copper', 10);
  ok(all.average < ten.average, `${all.average} a load for 100, ${ten.average} for 10`);
  ok(all.last < all.first, 'the last load fetches less than the first');
  const t = sellHome(s, CAIRO, 'copper', 100);
  eq([t.stock.copper, t.money - s.money], [undefined, all.got], 'the warehouse is empty and the quote held');
});

// ---- MER-146 (M4e play problem 7): worth moves for a reason the log names

const C = CITIES.cairo.orig;   // Cairo as the data has it (the loop above reads `priceNews: true` copies of both cities)

test('(MER-146, 7) every move of worth of 10 dinars or more in a closing step with no paper of its own has a worth line in the log', () => {
  const own = new Set(['returns', 'risk', 'letters', 'fireDue', 'jump']);   // a return, a loss, a letter or later effect with an Accounts line, the Years pass page
  const marks = [];
  const wrapped = {};
  for (const name of Object.keys(steps)) {
    wrapped[name] = steps[name];
    steps[name] = function (s, ...rest) {
      const w0 = worthOf(s, C), n0 = s.log.length, held = s.expeditions.length;
      const r = wrapped[name].call(this, s, ...rest);
      const d = worthOf(s, C) - w0, lines = s.log.slice(n0).filter(e => e.kind === 'worth').reduce((n, e) => n + e.change, 0);
      if (Math.abs(d) >= NOTE && !own.has(name) && !(name === 'news' && s.t === 0)) marks.push({ name, d, lines, room: NOTE * (['tolls', 'move'].includes(name) ? held + 1 : 1) });
      return r;
    };
  }
  let causes = new Set();
  try {
    for (const [house, seeds] of [['spice', [1, 2, 3, 4, 5, 6]], ['cloth', [1, 2]]]) for (const seed of seeds) {
      let s = newGame(C, { seed, length: 'acts', house });
      for (let g = 0; g < 40 && !['recall', 'ended'].includes(s.phase); g++) {
        if (s.phase === 'interlude') { s = openSeason(s, C); continue; }
        for (const p of s.desk.filter(q => q.state === 'open')) { const ch = paperChoices(s, C, p.id); for (const c of ch) { try { s = choose(s, C, p.id, c.id); break; } catch { /* closed */ } } }
        const v = view(s, C).venture;
        if (v) { try { s = outfit(s, C, v.plan); } catch { /* did not fit */ } }
        s = endSeason(s, C);
        for (const e of s.log) if (e.kind === 'worth') causes.add(e.cause);
      }
    }
  } finally { Object.assign(steps, wrapped); }
  ok(marks.length >= 100, `${marks.length} moves of worth of ${NOTE} dinars or more in steps with no paper of their own were looked at`);
  const loose = marks.filter(m => Math.abs(m.d - m.lines) >= m.room);
  eq(loose, [], `${loose.length} moves of worth have no line: ${JSON.stringify(loose.slice(0, 3))}`);
  ok(['prices', 'trade'].every(c => causes.has(c)), `the log named drift and trade as causes (${[...causes]})`);
});

test('(MER-146, 7) the warehouse rising in price writes the line the ledger prints, with the dinars it moved worth by', () => {
  let s = newGame(C, { seed: 4, length: 'full', house: 'spice' });
  s.stock = { pepper: 7 };
  s.market.cairo.pepper.f = 1.4;
  s = answer(s, C);
  const held = sellHomeQuote(s, C, 'pepper', 7).got;   // what Sell pays for the seven loads before the closing
  const closing = s.t;
  s = endSeason(s, C);   // the closing's drift moves the price
  const line = s.log.find(e => e.kind === 'worth' && e.cause === 'prices' && e.part === 'warehouse');
  ok(line, 'a price line for the warehouse');
  eq(line.change, sellHomeQuote(s, C, 'pepper', 7).got - held, 'the line says what the seven loads would fetch now, less what they would have fetched');
  ok(/^The goods in the warehouse (rose|fell) in price: [+\u2212]\d+\.$/.test(line.text), line.text);
  eq(line.at, closing, 'it belongs to the season whose closing moved the price: that season\'s figure holds it');
});

// ---- MER-146 (M4e play problem 8): the ledger's last four seasons give each season's true change

test('(MER-146, 8) a season that sends a trip out is not a loss in the ledger: the trail gives the change in worth, the cash change stays as it was', () => {
  let s, v;
  for (const seed of [5, 1, 2, 3, 4, 6, 7, 8]) {   // the first game that has a plan to send on one of its first three desks
    s = newGame(C, { seed, length: 'acts', house: 'spice' });
    for (let k = 0; k < 3 && !v; k++) {
      s = answer(s, C);
      v = view(s, C).venture;
      if (!v) s = endSeason(s, C);
    }
    if (v) break;
  }
  ok(v, 'a seeded game with a plan on one of its first desks');
  s = outfit(s, C, v.plan);
  const stake = v.plan.purse + 1;
  s = endSeason(answer(s, C), C);
  const row = view(s, C).trail.at(-1), entry = s.log.filter(e => e.kind === 'season').at(-1);
  ok(entry.change < -300, `the money went out: ${entry.change}`);
  eq(row.cash, entry.change, 'the cash change is what the log had');
  ok(Math.abs(row.change) < Math.abs(entry.change) / 4, `the true change is ${row.change} against a cash change of ${entry.change}`);
  ok(stake >= 1);
});

test('(MER-146, 8) the trail follows the log across the jump: each season keeps its own change and the years are the line after the season they followed', () => {
  let s = newGame(C, { seed: 6, length: 'acts', house: 'cloth' });
  let at = 0;
  for (let g = 0; g < 40 && s.phase !== 'interlude'; g++) {
    s = answer(s, C);
    const v = view(s, C).venture;
    if (v) { try { s = outfit(s, C, v.plan); } catch { /* did not fit */ } }
    s = endSeason(s, C);
    at = g;
  }
  eq(s.phase, 'interlude');
  const seasons = s.log.filter(e => e.kind === 'season'), trail = view(s, C).trail, jump = s.log.find(e => e.kind === 'jump');
  eq(trail.length, 4, 'four seasons');
  const last = trail.at(-1);
  eq(last.at, jump.from, 'the last row is the season the years followed');
  eq(last.after.years, jump.years, 'with the jump as its line');
  eq(last.change, seasons.at(-1).worthChange - jump.worthChange, 'its own change leaves out what the years did');
  eq(last.change + jump.worthChange, seasons.at(-1).worthChange, 'and the two add to what worth moved by');
  const w = seasons.map(e => e.worth);
  seasons.slice(1).forEach((e, k) => eq(e.worthChange, w[k + 1] - w[k], `season ${k + 1}'s change is the move from the worth before it`));
  const opened = openSeason(s, C);
  eq(view(opened, C).trail.at(-1).at, jump.from, 'on the first desk after the years the trail still ends with that season and its jump line');
  ok(at > 0);
});

// ---- MER-148 (M4f play problem 1): goods are worth what Sell in Cairo would pay for them

/** Cairo with no drift and no loss on the road, so the arithmetic is the rule alone. */
const CALM = (() => { const c = structuredClone(C); for (const g of c.goods) g.sigma = 0; for (const r of c.routes) for (const l of r.legs) l.risk = 0; return c; })();
/** Yusuf takes two loads of pepper to Damascus with 300 dinars and brings sugar back; the state at the opening the return paper is on the desk, and the paper. */
function sugarTrip(content = CALM) {
  let s = newGame(content, { seed: 7, length: 'full', house: 'spice' });
  const plan = { agent: 'yusuf', route: 'cairo-damascus', cargo: { pepper: 2 }, purse: 300, contract: 'own', sell: ['pepper'], buy: ['sugar'] };
  const hoped = estimate(s, content, plan);
  s = outfit(s, content, plan);
  for (let i = 0; i < 8 && !s.desk.some(p => p.kind === 'return'); i++) s = endSeason(answer(s, content), content);
  return { s, paper: s.desk.find(p => p.kind === 'return'), hoped };
}

test('(MER-148, 1) the loads a trip brings home count at what Sell in Cairo pays for those loads, not at the first load\'s price times the loads', () => {
  const { s, paper } = sugarTrip();
  const n = s.stock.sugar;
  ok(n >= 5, `setup: ${n} loads of sugar came home`);
  const quote = sellHomeQuote(s, CALM, 'sugar', n);
  eq(paper.data.cargoValue, quote.got, 'the paper counts the sugar at what Sell would pay for all of it');
  ok(quote.got < n * M.truePrice(s, CALM, 'cairo', 'sugar'), `${quote.got} is less than ${n} loads at one load's price`);
  const back = paper.data.account.find(r => r.label === 'Back home');
  eq(back.amount, quote.got + paper.data.moneyBack, 'the account\'s back home is the loads at that figure and the money');
  ok(back.text.includes(`Cairo would pay ${quote.got} dinars for them now, after the broker's cut`), back.text);
  eq(paper.data.houseNet, back.amount + paper.data.account.filter(r => r.amount && !r.detail && r.label !== 'Back home' && r.label !== 'Profit' && r.label !== 'Loss').reduce((a, r) => a + r.amount, 0), 'and the profit row is that account added up');
});

test('(MER-148, 1) the house\'s worth does not fall when the loads a trip brought home are sold: worth counts them at what selling them fetches', () => {
  const { s } = sugarTrip();
  const n = s.stock.sugar, w0 = worthOf(s, CALM);
  const sold = sellHome(s, CALM, 'sugar', n);
  eq(worthOf(sold, CALM), w0, `worth is ${w0} before and after the ${n} loads are sold`);
  // in two sales as well: the second sells loads the first has already marked the market for
  const two = sellHome(sellHome(s, CALM, 'sugar', 3), CALM, 'sugar', n - 3);
  eq(worthOf(two, CALM), w0, 'sold in two parts, worth stays where it was');
  const flat = s.money + Object.entries(s.stock).reduce((a, [g, q]) => a + q * M.truePrice(s, CALM, 'cairo', g), 0);
  ok(netWealth(s, CALM).net < flat, 'and it is less than the flat count of every load at its first price');
});

test('(MER-148, 1) the estimate under Send counts the goods coming home the way the return counts them, to the dinar on a calm road', () => {
  const { s, paper, hoped } = sugarTrip();
  const sum = Object.values(hoped.homeValue).reduce((a, v) => a + v, 0);
  eq(paper.data.cargoValue, sum, 'the estimate\'s value of what comes home is the paper\'s');
  eq(paper.data.hoped, hoped.net, 'and so the profit hoped for and the profit made differ only by what the road changed');
  eq(paper.data.houseNet, hoped.net, 'which on a calm road is nothing');
  void s;
});

// ---- MER-148 (M4f play problem 8): a season's worth lines add up to that season's figure

test('(MER-148, 8) over played seasons, the lines of a season and the small moves left over add up to its figure, and nothing of 10 dinars or more is left over', () => {
  let seasons = 0, worst = 0;
  const loose = [];
  for (const [house, seeds] of [['spice', [1, 2, 3, 4]], ['cloth', [1, 2]]]) for (const seed of seeds) {
    let s = newGame(C, { seed, length: 'acts', house });
    for (let g = 0; g < 60 && !['recall', 'ended'].includes(s.phase); g++) {
      if (s.phase === 'interlude') { s = openSeason(s, C); continue; }
      s = answer(s, C);
      const v = view(s, C).venture;
      if (v) { try { s = outfit(s, C, v.plan); } catch { /* did not fit */ } }
      s = endSeason(s, C);
      const row = view(s, C).trail.at(-1);
      if (!row || row.rest === null) continue;
      seasons++;
      eq(row.lines + row.rest, row.change, `${house}/${seed} ${row.season}: the lines (${row.lines}) and what is left (${row.rest}) are the season's ${row.change}`);
      worst = Math.max(worst, Math.abs(row.rest));
      if (Math.abs(row.rest) >= 3 * NOTE) loose.push([house, seed, row.season, row.change, row.lines, row.rest]);
      ok(row.rest === 0 ? row.restWords === null : /^[+\u2212]\d+ from moves too small/.test(row.restWords), row.restWords);
    }
  }
  ok(seasons >= 100, `${seasons} closed seasons were read`);
  eq(loose, [], `seasons whose figure the lines leave ${3 * NOTE} dinars or more short of: ${JSON.stringify(loose.slice(0, 3))}`);
});

test('(MER-148, 8) a trip coming home, a paper answered and the letters of a season each write a worth line of their own when they move worth by 10 or more', () => {
  let trips = 0, answers = 0, letters = 0;
  for (const seed of [1, 2, 3, 4, 5]) {
    let s = newGame(C, { seed, length: 'acts', house: 'spice' });
    for (let g = 0; g < 30 && !['recall', 'ended'].includes(s.phase); g++) {
      if (s.phase === 'interlude') { s = openSeason(s, C); continue; }
      s = answer(s, C);
      const v = view(s, C).venture;
      if (v) { try { s = outfit(s, C, v.plan); } catch { /* did not fit */ } }
      s = endSeason(s, C);
    }
    for (const e of s.log) if (e.kind === 'worth') { if (e.cause === 'trip') trips++; if (e.cause === 'answer') answers++; if (e.cause === 'letter') letters++; }
  }
  ok(trips >= 5 && answers >= 3, `trip lines ${trips}, answer lines ${answers}, letter lines ${letters}`);
});

done();
