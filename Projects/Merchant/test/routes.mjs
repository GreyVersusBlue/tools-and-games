// Expeditions, contracts, returns, the act jump and the ending (ARCHITECTURE 4.2, 4.3, 4.5, 4.7, 4.9):
// node test/routes.mjs, from Projects/Merchant/. Plain Node, no browser, no clock.
// Testport (the invented city) carries the arithmetic; cairo carries the Venice roads, the
// between-act events and a whole three-act game.
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { test, eq, ok, throws, done } from './lib.mjs';
import { loadContent } from '../js/data.js';
import { validateContent } from '../js/engine/content.js';
import { repair } from '../js/save.js';
import * as R from '../js/engine/routes.js';
import * as rng from '../js/engine/rng.js';
import * as M from '../js/engine/market.js';
import { steps } from '../js/engine/turn.js';
import { seasonIndex } from '../js/engine/calendar.js';
import { newGame, openSeason, endSeason, choose, paperChoices, recall, outfit, suggestPlan, checkPlan, routeFor, destinations, view } from '../js/engine/index.js';
import { holds } from '../js/engine/conditions.js';

const T = await loadContent('testport', { fs });
const C = await loadContent('cairo', { fs });

const variant = (c, edit) => { const x = structuredClone(c); edit(x); return x; };
/** The same city with every leg's risk set to `p`, so a test about trade is not a test about luck. */
const risk = (c, p = 0) => variant(c, x => { for (const r of x.routes) for (const l of r.legs) l.risk = p; });
// Mira is careful, and a careful agent takes a season more on a leg of two or more (agents.js). The
// timeline cases below pin the roads for an agent with no such trait; 'a careful agent takes one more
// season' has its own cases on the unmodified content.
const plainMira = c => variant(c, x => { x.agents.find(a => a.id === 'mira').traits = ['honest']; });
const calm = plainMira(risk(T, 0));
const calmC = risk(C, 0);
const game = (c = calm, over = {}) => newGame(c, { seed: 7, length: 'full', house: 'plain', ...over });
const cairo = (over = {}) => newGame(calmC, { seed: 7, length: 'full', house: 'spice', ...over });

/** First choice that holds for every open paper. */
function answer(s, c) {
  for (const p of s.desk) {
    if (p.state !== 'open') continue;
    const ch = paperChoices(s, c, p.id).find(x => holds(x.requires, s, c));
    s = choose(s, c, p.id, ch.id);
  }
  return s;
}
const step = (s, c) => (s.phase === 'interlude' ? openSeason(s, c) : endSeason(answer(s, c), c));
const play = (s, c, n) => { for (let i = 0; i < n; i++) s = step(s, c); return s; };
const idx = (s, c) => seasonIndex(s, c);
const at = (s, t) => ({ ...s, t });
const peek = state => rng.next({ rng: state.rng });

const WOOL = { agent: 'mira', route: 'harbour-hilltown', cargo: { wool: 10 }, purse: 0, contract: 'own', sell: ['wool'], buy: [] };
const reasons = (s, c, plan) => checkPlan(s, c, plan).reasons;

// ---- outfit: every refusal, in words

test('outfit refuses each bad plan with its reason in words, and checkPlan says the same without sending', () => {
  const s = game();
  const rich = game(calm, { house: 'rich' });
  const cases = [
    ['no one chosen', { ...WOOL, agent: undefined }, /Choose who goes/],
    ['an agent the house has never heard of', { ...WOOL, agent: 'nobody' }, /no one called "nobody"/],
    ['an agent the house has not hired', { ...WOOL, agent: 'tobin' }, /Tobin does not work for the house/],
    ['no road chosen', { ...WOOL, route: undefined }, /Choose where/],
    ['a road that does not exist', { ...WOOL, route: 'nowhere' }, /no road called "nowhere"/],
    ['a good that does not exist', { ...WOOL, cargo: { ghost: 1 } }, /no good called "ghost"/],
    ['half a load', { ...WOOL, cargo: { wool: 1.5 } }, /1.5 is not a number of loads/],
    ['nothing carried at all', { ...WOOL, cargo: {}, purse: 0 }, /Send some goods or some coins/],
    ['a good the house lacks and home does not sell', { ...WOOL, cargo: { lamps: 3 }, sell: [] }, /none in the warehouse and Harbour does not sell lamps/],
    ['more money than the house has', { ...WOOL, purse: 9999 }, /The house has 500 coins and this costs 9,999 coins/],
    ['selling what is not carried', { ...WOOL, sell: ['salt'] }, /Mira is not carrying any salt to sell/],
    ['selling where the stop does not trade the good', { ...WOOL, cargo: { wool: 1, salt: 1 }, sell: ['salt'] }, /Hilltown does not trade in salt/],
    ['buying what the stop does not have', { ...WOOL, buy: ['lamps'] }, /Hilltown has no lamps to buy/],
    ['a contract that does not exist', { ...WOOL, contract: 'gift' }, /no contract called "gift"/],
    ['a qirad in a city without one', { ...WOOL, contract: 'qirad', partners: 50 }, /A qirad is not an option in Testport/],
  ];
  for (const [what, plan, re] of cases) {
    const c = what.startsWith('selling where') ? rich : s;
    const state = what.startsWith('selling where') ? { ...rich, stock: { ...rich.stock, salt: 6 }, agents: rich.agents } : c;
    const got = reasons(state, calm, plan);
    ok(got.some(m => re.test(m)), `${what}: expected ${re}, got ${JSON.stringify(got)}`);
    throws(() => outfit(state, calm, plan), re);
  }
  ok(reasons({ ...s, phase: 'ended' }, calm, WOOL).some(m => /only while the desk is open/.test(m)), 'a closed desk');
  const fine = checkPlan(s, calm, WOOL);
  eq([fine.ok, fine.reasons], [true, []]);
  ok(/The mules from Hilltown to Harbour can only leave in spring, summer or autumn/.test(fine.warnings[0]), 'the winter the way back would arrive in is warned of');
  const sent = outfit(s, calm, WOOL);
  ok(reasons(sent, calm, WOOL).some(m => /Mira is already on the road/.test(m)), 'an agent already out');
  ok(reasons({ ...s, agents: { ...s.agents, mira: { ...s.agents.mira, where: 'dead' } } }, calm, WOOL).some(m => /Mira is not in Harbour/.test(m)), 'an agent who is not at home');
  eq(s.expeditions.length, 0, 'checkPlan and a refused outfit leave the state alone');
});

// ---- MER-72: the number on the sheet is the number taken
test('estimate: checkPlan\'s cost.total is exactly what outfit takes from the house, for an own plan, a qirad and a bought-in cargo', () => {
  const c = variant(calm, x => { x.city.contracts = { qirad: { agentShare: [1, 3] } }; });
  const s = game(c);
  const plans = [
    ['stock only', { ...WOOL, cargo: { wool: 10 } }],
    ['bought in, price rising with each load', { ...WOOL, cargo: { wool: 28 }, purse: 10 }],
    ['a qirad: the partners\' share is not the house\'s', { ...WOOL, cargo: { wool: 20 }, purse: 100, contract: 'qirad', partners: 60 }],
    ['money only', { ...WOOL, cargo: {}, purse: 75, sell: [] }],
  ];
  for (const [what, plan] of plans) {
    const chk = checkPlan(s, c, plan);
    ok(chk.ok, `${what}: ${JSON.stringify(chk.reasons)}`);
    const t = outfit(s, c, plan);
    eq(chk.cost.total, s.money - t.money, `${what}: the estimate is the amount taken, to the coin`);
    const parts = chk.cost.bought + chk.cost.purse - chk.cost.partners + chk.cost.wagePaid;
    eq(parts, chk.cost.total, `${what}: the listed parts add up to the total`);
    eq(chk.cost.goods.reduce((n, g) => n + g.cost, 0), chk.cost.bought, `${what}: the goods lines add up to what was bought`);
  }
  // the bought-in line prices each load as the market will, not at the flat home price
  const dear = checkPlan(s, c, { ...WOOL, cargo: { wool: 28 } }).cost;
  const flat = (dear.goods[0].bought) * M.truePrice(s, c, 'harbour', 'wool');
  ok(dear.goods[0].bought === 18 && dear.goods[0].cost > flat, `twenty loads bought cost ${dear.goods[0].cost}, more than ${flat} at the flat price`);
  eq(dear.goods[0].fromWarehouse, 10);
});

test('estimate: what the road takes later is listed apart from what is taken now, and a prepaid wage moves into the total', () => {
  const s = game();
  const k = checkPlan(s, calm, WOOL).cost;
  eq(k.later.wagePerSeason, 10, 'Mira\'s wage');
  ok(k.later.wage > 0 && k.later.tolls >= 0, JSON.stringify(k.later));
  eq(k.total, 0, 'a cargo from the warehouse and no purse costs nothing at Send');
  eq(checkPlan(s, calm, { ...WOOL, cargo: {} , purse: 0 }).cost.later, k.later, 'the road costs the same whatever is on it');
  ok(checkPlan(s, calm, { ...WOOL, route: undefined }).cost.later === null, 'no road, nothing known of it');
  eq(checkPlan(s, calm, undefined).cost, null, 'no plan, no cost');
});

test('refusals write numbers with commas, on any machine', () => {
  const rich = game(calm, { house: 'rich' });
  const r = reasons(rich, calm, { ...WOOL, purse: 1234567 });
  ok(r.some(m => /costs 1,234,567 coins/.test(m)), JSON.stringify(r));
  ok(reasons(game(), calm, { ...WOOL, purse: 999 }).some(m => /costs 999 coins/.test(m)), 'three digits carry no comma');
});

test('outfit: a qirad needs partners, and partners cannot put in more than goes out', () => {
  const c = variant(calm, x => { x.city.contracts = { qirad: { agentShare: [1, 3] } }; });
  const s = game(c);
  ok(reasons(s, c, { ...WOOL, contract: 'qirad' }).some(m => /needs partners/.test(m)));
  ok(reasons(s, c, { ...WOOL, contract: 'qirad', partners: 500, purse: 50 }).some(m => /cannot put in more than the 50 coins/.test(m)));
  eq(reasons(s, c, { ...WOOL, contract: 'qirad', partners: 50, purse: 50 }), []);
});

test('outfit moves the cargo and the money out of the house, buys the rest at the home price with glut, and puts the agent on the road', () => {
  const s = game();
  const plan = { ...WOOL, cargo: { wool: 15 }, purse: 40 };      // ten from the warehouse, five bought now at 20 and rising
  const t = outfit(s, calm, plan);
  const x = t.expeditions[0];
  eq([t.stock.wool, x.cargo, x.purse, t.agents.mira.where], [undefined, { wool: 15 }, 40, 'road']);
  const paid = s.money - t.money - 40;
  ok(paid > 5 * 20 && paid < 5 * 26, `five loads bought at 20 and rising cost ${paid}`);
  ok(t.market.harbour.wool.glut < 0, 'buying makes wool scarcer at home');
  eq(x.staked, { house: 200 + paid + 40, partners: 0 }, 'the house put in the ten it held (at 20) and all it paid');
  eq([x.id, x.route, x.leg, x.left, x.sent, x.contract, x.orders], ['x1', 'harbour-hilltown', 0, 2, 0, { kind: 'own' }, []]);
  eq(t.log.at(-1), { at: 0, kind: 'outfit', ref: 'x1', choice: 'harbour-hilltown' });
  eq(game().expeditions.length, 0, 'the input state is untouched');
});

// ---- legs: `opens`, `when`, the waits a plan warns about

test('legs honour `opens`: a leg closed the season after sending waits one season, and a plan that would wait longer is refused', () => {
  const s = at(game(), 2);                              // autumn: hilltown legs are closed in winter, open in spring
  const p = R.project(s, calm, calm.routes.find(r => r.id === 'harbour-hilltown'));
  eq([p.ok, p.legs[0].waits, p.legs[0].startK], [true, 1, 2], 'the first leg waits for spring');
  const x = outfit(s, calm, WOOL).expeditions[0];
  eq([x.status, x.start], ['waiting', 4], 'sent in autumn, it waits for spring (season 4)');
  const c = variant(calm, y => { y.routes.find(r => r.id === 'harbour-hilltown').legs[0].opens = ['summer']; });
  const refused = reasons(at(game(c), 1), c, WOOL);
  ok(refused.some(m => /The first leg, Harbour to Hilltown, can only start in summer/.test(m)), JSON.stringify(refused));
});

test('legs honour `opens` on the way: an expedition whose next leg is closed waits, pays upkeep each season and starts when it opens', () => {
  const c = risk(variant(plainMira(T), y => { for (const l of y.routes.find(r => r.id === 'harbour-hilltown').legs) l.toll = 0; }), 0);
  let s = outfit(game(c), c, { ...WOOL, purse: 20 });
  s = play(s, c, 1);                                     // sent in spring (0); summer (1) it rides
  eq([s.expeditions[0].status, s.expeditions[0].left], ['out', 2]);
  s = play(s, c, 2);                                     // arrives at the end of autumn (2), trades; winter (3) is closed
  let x = s.expeditions[0];
  eq([idx(s, c), x.status, x.leg, x.waiting], [3, 'waiting', 1, 0]);
  const purse = x.purse;
  s = play(s, c, 1);                                     // the winter passes with the expedition waiting
  x = s.expeditions[0];
  eq([x.status, x.waiting, x.purse, x.start], ['out', 1, purse - R.UPKEEP, 4], 'one season waited, one upkeep paid, the spring leg started');
  eq(x.book.upkeep, R.UPKEEP);
});

test('a plan warns when a later leg will be closed, in words that name the stop and the wait', () => {
  const c = variant(calm, y => { y.routes.find(r => r.id === 'harbour-hilltown').legs[1].opens = ['spring']; });
  const w = checkPlan(at(game(c), 0), c, WOOL).warnings;
  eq(w.length, 1);
  ok(/The mules from Hilltown to Harbour can only leave in spring\. The expedition will wait in Hilltown for \w+ seasons?\./.test(w[0]), w[0]);
});

test('legs honour `when`: cairo has two roads to Venice, and before 1345 only the one by Famagusta', () => {
  const venice = s => routeFor(s, calmC, 'venice');
  const before = venice(at(cairo(), 70));                // spring 1341
  eq([before.route.id, before.seasons], ['cairo-venice', 7], 'six legs, and the return opens the season after the last of them');
  const direct = C.routes.find(r => r.id === 'cairo-venice-direct');
  eq(R.project(at(cairo(), 70), calmC, direct).ok, false, 'the direct road is closed in 1341 and for the four seasons after');
  const after = venice(at(cairo(), 90));                 // 1346
  eq([after.route.id, after.seasons], ['cairo-venice-direct', 5], 'once open, the shorter road is the one offered');
  const edge = venice(at(cairo(), 78));                  // summer 1343: the direct road would wait four seasons for 1345 and take 9
  eq([edge.route.id, edge.seasons], ['cairo-venice', 7], 'a road that must wait for its window is not shorter than the open one');
  eq(R.project(at(cairo(), 78), calmC, direct).seasons, 9);
  eq(venice(at(cairo(), 80)).route.id, 'cairo-venice-direct', 'in spring 1344 the two take as long, and the one with fewer legs wins');
  ok(destinations(at(cairo(), 90), calmC).find(d => d.stop === 'venice').route === 'cairo-venice-direct', 'the outfitting list offers the open, shorter one');
});

test('suggestPlan offers the open, shorter road to Venice and a plan that outfit accepts; checkPlan refuses the closed one in words', () => {
  const s = at(cairo(), 90);
  const plan = suggestPlan(s, calmC, 'venice');
  eq([plan.route, plan.agent, plan.contract, plan.purse], ['cairo-venice-direct', 'yusuf', 'own', 0]);
  ok(outfit(s, calmC, plan).expeditions.length === 1);
  const old = at(cairo(), 70);
  eq(suggestPlan(old, calmC, 'venice').route, 'cairo-venice');
  const closed = reasons(old, calmC, { ...plan, route: 'cairo-venice-direct' });
  ok(closed.some(m => /A later leg, Alexandria to Venice, is not open in these years/.test(m)), JSON.stringify(closed));
});

test('suggestPlan: a free agent who knows the stop, the best road, half the stock of a good the stop trades; null when nothing fits', () => {
  const s = cairo();
  const plan = suggestPlan(s, calmC, 'damascus');
  eq([plan.agent, plan.route, plan.cargo, plan.sell], ['yusuf', 'cairo-damascus', { linen: 10 }, ['linen']]);
  eq(checkPlan(s, calmC, plan).ok, true);
  eq(suggestPlan(s, calmC, 'cairo'), null, 'nowhere to go from home to home');
  eq(suggestPlan(game(calm, { house: 'plain' }), calm, 'saltmarsh'), null, 'saltmarsh trades no wool, so nothing in the warehouse fits');
  const out = outfit(s, calmC, plan);
  eq(suggestPlan(out, calmC, 'damascus')?.agent, 'ali', 'Yusuf is on the road, so the next free agent');
  eq(suggestPlan(game(calm, { house: 'plain' }), calm, 'hilltown').agent, 'mira');
  eq(suggestPlan({ ...cairo({ house: 'newcomer' }) }, calmC, 'damascus'), null, 'a house with nobody to send');
});

// ---- a careful agent's timing is read everywhere a route is timed (MER-47's paths, pinned by MER-48)

/** Testport with a second road to Hilltown: two legs of one season, so no agent is slowed on it, whose way
    back opens only in the summer of 1201 (idx 5). Sent in spring 1200 it takes 6 seasons for everyone,
    the same as the written two-by-two road for a plain agent and one fewer than it takes a careful one. */
const withRiver = c => variant(c, y => {
  const [out, back] = structuredClone(y.routes.find(r => r.id === 'harbour-saltmarsh').legs);
  out.to = 'hilltown'; back.from = 'hilltown';
  back.opens = ['summer']; back.when = { year: [1201, 1201] };
  y.routes.push({ id: 'harbour-hilltown-river', to: 'hilltown', legs: [out, back] });
});
/** Plays an expedition at risk 0 until it is home and its paper has landed; the steps it took. */
function ride(s, c, seen = () => {}) {
  let n = 0;
  while (s.expeditions.length) { s = step(s, c); n++; seen(s); ok(n < 30, 'it never came home'); }
  return n;
}

test('a careful agent plays out the seasons project() counted: the later leg of two seasons or more starts with one more', () => {
  // MER-60: testport has letters now, and a careful agent who has asked a question waits at the end of the leg
  // (test/letters.mjs), so this case, which is about legs, plays without any.
  const c = variant(risk(T, 0), y => { y.letters = []; });
  const road = c.routes.find(r => r.id === 'harbour-hilltown');
  const s = game(c, { house: 'rich' });
  for (const [name, agent, seasons, later] of [['careful', 'mira', 7, 3], ['bold', 'tobin', 6, 2]]) {
    const who = c.agents.find(a => a.id === agent);
    eq(R.project(s, c, road, who).seasons, seasons, `${name}: what project says`);
    let started;
    const n = ride(outfit(s, c, { ...WOOL, agent }), c, t => {
      const x = t.expeditions[0];
      if (!started && x?.leg === 1 && x.status === 'out') started = x.left;
    });
    eq(started, later, `${name}: the second leg starts with ${later} seasons to ride`);
    eq(n, seasons, `${name}: seasons from sending to the return paper`);
  }
});

test('at the recall, a careful agent is further from word than a plain one by perSeason for each later leg of two seasons or more', () => {
  // The first draw of recall() is the reach test, so the chance is placed around it: the plain agent's
  // reach lands just above the draw and the careful agent's just below (one season less per slowed leg).
  const long = c => variant(c, y => {
    const legs = structuredClone(y.routes.find(r => r.id === 'harbour-hilltown').legs);
    legs.push(structuredClone(legs[1]));
    for (const l of legs) l.opens = ['spring', 'summer', 'autumn', 'winter'];
    y.routes.push({ id: 'long', to: 'hilltown', legs });
  });
  const careful = long(risk(T, 0)), plain = plainMira(careful);
  const p = 0.1;
  const SEED = 6;                                   // its first draw is mid-range, so there is room either side of it
  const how = (c, start, edit, route = 'harbour-hilltown') => {
    const recallBlock = { reach: { start, perSeason: p, floor: 0 }, recalledSurvives: 1, recalledKeeps: 1, stayedSurvives: 1, homeSurvives: 1, byStop: {} };
    const k = variant(c, y => { y.city.recall = recallBlock; });
    let s = game(k, { length: 'acts', seed: SEED });
    s = outfit(s, k, { ...WOOL, route });
    s.phase = 'recall';
    const x = s.expeditions[0];
    edit(x);
    return { how: recall(s, k, { [x.id]: 'recall' }).log.at(-1).results[0].how, u: peek(s) };
  };
  const u = how(plain, 1, () => {}).u;
  ok(u > 0.2 && u < 0.7, `the seeded draw is ${u}; this case needs room either side of it`);
  const cases = [
    ['riding the first of two legs, one to go', 'harbour-hilltown', x => { x.leg = 0; x.status = 'out'; x.left = 1; }, 3, 1],
    ['waiting to start the second of two legs', 'harbour-hilltown', x => { x.leg = 1; x.status = 'waiting'; x.left = 0; }, 2, 1],
    ['riding the first of three legs, two to go', 'long', x => { x.leg = 0; x.status = 'out'; x.left = 1; }, 5, 2],
  ];
  for (const [what, route, edit, plainLag, extra] of cases) {
    // plain reach = u + p/2 + (extra - 1) p for a plain agent; with only one slowed leg counted it would still pass
    const start = u + plainLag * p + (extra - 0.5) * p + 0.0001;
    eq(how(plain, start, edit, route).how, 'recalled', `${what}: the plain agent is reached`);
    eq(how(careful, start, edit, route).how, 'no word', `${what}: the careful agent is ${extra} season${extra > 1 ? 's' : ''} further off and is not`);
  }
});

test('checkPlan and outfit time the plan for the agent named: a careful agent waits less here and is refused less there', () => {
  const c = risk(T, 0);
  const gate = year => variant(c, y => { y.routes.find(r => r.id === 'harbour-hilltown').legs[1].when = { year }; });
  const s = c0 => game(c0, { house: 'rich' });
  // the way back opens in 1201: the written timing waits a season in Hilltown, the careful timing arrives as it opens
  const g1 = gate([1201, 1201]);
  const blind = checkPlan(s(g1), g1, { ...WOOL, agent: 'tobin' });
  const slow = checkPlan(s(g1), g1, WOOL);
  eq([blind.ok, slow.ok], [true, true]);
  ok(/will wait in Hilltown for one season\./.test(blind.warnings.join(' ')), `the written timing: ${JSON.stringify(blind.warnings)}`);
  eq(slow.warnings.filter(w => /will wait/.test(w)), [], 'the careful timing has no wait to warn of');
  // the way back opens only in 1202: the written timing would wait five seasons (over MAX_WAIT), the careful one four
  const g2 = gate([1202, 1202]);
  const refused = reasons(s(g2), g2, { ...WOOL, agent: 'tobin' });
  ok(refused.some(m => /A later leg, Hilltown to Harbour, can only start in spring, summer or autumn/.test(m)), JSON.stringify(refused));
  const allowed = checkPlan(s(g2), g2, WOOL);
  eq([allowed.ok, allowed.reasons], [true, []], 'the careful agent is not refused');
  ok(/will wait in Hilltown for four seasons\./.test(allowed.warnings.join(' ')), JSON.stringify(allowed.warnings));
  eq(outfit(s(g2), g2, WOOL).expeditions.length, 1, 'and outfit sends it');
  throws(() => outfit(s(g2), g2, { ...WOOL, agent: 'tobin' }), /A later leg, Hilltown to Harbour/);
});

test('destinations() takes an optional agent, and its seasons and waits are that agent\'s', () => {
  const c = risk(T, 0);
  const s = game(c, { house: 'rich' });
  const hill = (agent) => destinations(s, c, agent && c.agents.find(a => a.id === agent)).find(d => d.stop === 'hilltown');
  eq([hill().seasons, hill('tobin').seasons, hill('mira').seasons], [6, 6, 7], 'written, bold, careful');
  const salt = agent => destinations(s, c, agent && c.agents.find(a => a.id === agent)).find(d => d.stop === 'saltmarsh').seasons;
  eq([salt(), salt('mira')], [salt('tobin'), salt('tobin')], 'a road of one-season legs is the same for everyone');
  const g = variant(c, y => { y.routes.find(r => r.id === 'harbour-hilltown').legs[1].when = { year: [1201, 1201] }; });
  const w = agent => destinations(s, g, agent && g.agents.find(a => a.id === agent)).find(d => d.stop === 'hilltown');
  eq([w('tobin').waits, w('mira').waits], [1, 0], 'the waits are the agent\'s too');
});

test('the best road to a stop can flip for a careful agent, and suggestPlan, routeFor and destinations all pick the careful agent\'s road', () => {
  const c = withRiver(risk(T, 0));
  const plain = plainMira(c);
  const s = game(c);
  const sp = game(plain);
  const mira = c.agents.find(a => a.id === 'mira');
  const via = (st, k, agent) => routeFor(st, k, 'hilltown', agent);
  eq([via(sp, plain, plain.agents[0]).route.id, via(sp, plain, plain.agents[0]).seasons], ['harbour-hilltown', 6], 'a plain agent: the written road wins the tie by coming first');
  eq([via(s, c, mira).route.id, via(s, c, mira).seasons], ['harbour-hilltown-river', 6], 'a careful agent: the two-by-two road is 7, the river road is still 6');
  eq(via(s, c).route.id, 'harbour-hilltown', 'no agent named: the legs as written');
  eq(destinations(s, c, mira).find(d => d.stop === 'hilltown').route, 'harbour-hilltown-river');
  eq(destinations(s, c).find(d => d.stop === 'hilltown').route, 'harbour-hilltown');
  const careful = suggestPlan(s, c, 'hilltown');
  eq([careful.agent, careful.route], ['mira', 'harbour-hilltown-river'], 'suggestPlan sends Mira the careful agent\'s road');
  eq(checkPlan(s, c, careful).ok, true);
  eq(outfit(s, c, careful).expeditions[0].left, 1, 'and her first leg is the one season the river road takes');
  eq(suggestPlan(sp, plain, 'hilltown').route, 'harbour-hilltown', 'the same house with a plain Mira is sent the written road');
});

// ---- risk

test('a careful agent takes one more season on a leg of two seasons or more, and the same as anyone on a leg of one', () => {
  const c = risk(T, 0);
  const road = c.routes.find(r => r.id === 'harbour-hilltown');    // two legs of two seasons
  const mira = c.agents.find(a => a.id === 'mira'), tobin = c.agents.find(a => a.id === 'tobin');
  const s = game(c, { house: 'rich' });
  eq([road.legs[0].seasons, road.legs[1].seasons], [2, 2], 'the road this case reads');
  eq(R.project(s, c, road, tobin).seasons, 6, 'a bold agent: 2 and 2, and a winter wait before the way back, which is closed in winter');
  eq(R.project(s, c, road, mira).seasons, 7, 'a careful agent: 3 and 3, and the way back opens as the first leg ends, so no wait');
  eq(R.project(s, c, road).seasons, 6, 'no agent named: the legs as written');
  // outfitted, the careful agent's expedition has three seasons to ride on its first leg, the bold one two
  const left = agent => outfit(s, c, { ...WOOL, agent }).expeditions[0].left;
  eq([left('mira'), left('tobin')], [3, 2]);
  // a leg of one season is not slowed
  const damascus = C.routes.find(r => r.id === 'cairo-damascus');
  eq(damascus.legs.map(l => l.seasons), [1, 1]);
  eq(R.project(cairo(), C, damascus, C.agents.find(a => a.id === 'mariam')).seasons, R.project(cairo(), C, damascus).seasons, 'Mariam is careful and Damascus is a season off');
});

test('winter risk: a galley leg started in winter carries its risk times 1.5, a caravan leg does not, a careful agent halves either', () => {
  const galley = C.routes.find(r => r.id === 'cairo-famagusta').legs[1];
  const caravan = C.routes.find(r => r.id === 'cairo-damascus').legs[0];
  const hana = C.agents.find(a => a.id === 'hana');   // sharp: no risk trait
  const careful = C.agents.find(a => a.id === 'mariam');
  eq(R.WINTER_GALLEY, 1.5);
  const winter = 3, summer = 1;
  eq([winter, summer].map(i => R.legRisk(C, hana, galley, i)), [galley.risk * 1.5, galley.risk]);
  eq([winter, summer].map(i => R.legRisk(C, hana, caravan, i)), [0.04, 0.04], 'winter changes the galleys only');
  eq(R.legRisk(C, careful, galley, winter), galley.risk * 1.5 * 0.5);
  eq(galley.risk, 0.09, 'the Alexandria to Famagusta leg is 0.09 (MER-51b moved it from 0.06); a pin that moves with the data is how this line was found');
});

test('winter risk: the roll itself is made against the winter figure for a galley that started in winter', () => {
  // find the first draw u of the seed and make the leg's risk u / 1.2: a summer start survives it, a winter one (x1.5) does not
  let s = cairo({ seed: 11 });
  s.agents.hana.hired = true;
  const u = peek(s);
  ok(u < 0.7, `seed 11 draws ${u}`);
  const c = variant(calmC, y => { y.routes.find(r => r.id === 'cairo-famagusta').legs[1].risk = u / 1.2; });
  const fam = { agent: 'hana', route: 'cairo-famagusta', cargo: { linen: 5 }, purse: 10, contract: 'own' };
  const ride = start => {
    const t = outfit(s, c, fam);
    t.expeditions[0].rode = { leg: 1, start };
    R.risk(t, c);
    return t;
  };
  eq(ride(1).expeditions.length, 1, 'started in summer: the draw is above the risk, nothing is lost');
  const w = ride(3);
  ok(w.expeditions.length === 0 || Object.keys(w.expeditions[0].cargo).length < 1 || w.expeditions[0].cargo.linen < 5, 'started in winter: the same draw is below the risk and something is lost');
  eq(w.desk.at(-1).kind, 'lost');
});

test('risk: traits adjust it in the table in agents.js, and each effect is its own number', () => {
  const leg = { from: 'a', to: 'b', risk: 0.1 };
  const agent = (...traits) => ({ traits });
  eq(R.legRisk(C, agent('careful'), leg, 1), 0.05);
  eq(R.legRisk(C, agent('bold'), leg, 1), 0.125);
  eq(R.legRisk(C, agent('honest'), leg, 1), 0.1);
  eq(R.legRisk(C, agent('knows-b'), { ...leg }, 1), 0.1 * 0.85, 'knows a stop the leg reaches');
  eq(R.legRisk(C, agent('knows-z'), leg, 1), 0.1, 'knows some other stop');
  eq(R.legRisk(C, agent('careful', 'knows-a'), leg, 1), 0.1 * 0.5 * 0.85);
  eq(R.legRisk(C, agent('bold'), { ...leg, risk: 5 }, 1), 0.95, 'never above 0.95');
});

test('risk: a loss is whole or partial from the seeded source; a partial one takes part of each good, a whole one the vessel, and both put a lost paper on the desk', () => {
  const c = risk(T, 1);
  const base = outfit(game(c), c, { ...WOOL, cargo: { wool: 10 }, purse: 30 });
  const seen = { whole: 0, partial: 0, none: 0 };
  for (let seed = 1; seed <= 120; seed++) {
    const s = structuredClone(base);
    s.rng = seed;
    s.expeditions[0].rode = { leg: 0, start: 1 };
    R.risk(s, c);
    const paper = s.desk.at(-1);
    if (s.expeditions.length === 0) {
      seen.whole++;
      eq(paper.kind, 'lost');
      eq(paper.data.whole, true);
      eq(s.agents.mira.where, paper.data.survived ? 'harbour' : 'dead', 'the agent is home or dead');
      ok(/was lost on the way from Harbour to Hilltown/.test(paper.data.headline), paper.data.headline);
    } else if (s.expeditions[0].cargo.wool < 10) {
      seen.partial++;
      const left = s.expeditions[0].cargo.wool;
      ok(left >= 1 && left <= 9, `a partial loss left ${left} of 10`);
      eq([paper.kind, paper.data.whole, s.expeditions[0].purse, s.agents.mira.where], ['lost', false, 30, 'road']);
    } else seen.none++;
  }
  ok(seen.whole > 10 && seen.partial > 20 && seen.none > 30, `over 120 rolls at 0.5 (a careful agent halves 1): ${JSON.stringify(seen)}`);
  const calmRoll = structuredClone(base); calmRoll.expeditions[0].rode = { leg: 0, start: 1 };
  const safe = risk(T, 0);
  R.risk(calmRoll, safe);
  eq([calmRoll.expeditions.length, calmRoll.desk.length], [1, base.desk.length], 'a leg with no risk loses nothing and writes no paper');
});

test('risk: a vessel lost on the way never sells its cargo first, and a rolled season does not roll twice', () => {
  const c = risk(T, 0.95);
  let lost = 0;
  for (let seed = 1; seed <= 40; seed++) {
    let s = outfit(game(c, { seed }), c, WOOL);
    s = play(s, c, 3);                                    // sent in 0; rides 1 and 2; would arrive at the end of 2
    const x = s.expeditions[0];
    if (!x) { lost++; eq(s.market.hilltown.wool.glut, 0, 'nothing was sold at Hilltown'); continue; }
    ok(x.leg === 0 || x.book.sold.length > 0, 'an expedition that got through traded');
  }
  ok(lost >= 8, `${lost} of 40 lost`);
});

// ---- tolls and trade

test('tolls are paid from the purse, then from the cargo at its home price, and nothing is invented', () => {
  const c = variant(calm, y => { y.routes.find(r => r.id === 'harbour-saltmarsh').legs[0].toll = 7; });
  const mk = purse => outfit(game(c), c, { agent: 'mira', route: 'harbour-saltmarsh', cargo: { wool: 3 }, purse, contract: 'own', sell: [], buy: [] });
  let s = play(mk(30), c, 2);                             // ride (1), arrive (end of 1): toll 7
  eq([s.expeditions[0].purse, s.expeditions[0].cargo.wool, s.expeditions[0].book.tolls], [23, 3, 7]);
  s = play(mk(0), c, 2);                                  // no purse: the toll is paid in wool, worth 20 a load: one load covers 7
  const x = s.expeditions[0];
  eq([x.cargo.wool, x.book.paidInGoods], [2, { wool: 1 }]);
  ok(x.purse >= 8 && x.purse <= 23, `a load worth about 20 paid a toll of 7 and the keeper gave change: ${x.purse}`);
  const poor = variant(c, y => { y.routes.find(r => r.id === 'harbour-saltmarsh').legs[0].toll = 500; });
  s = play(outfit(game(poor), poor, { agent: 'mira', route: 'harbour-saltmarsh', cargo: { wool: 3 }, purse: 0, contract: 'own', sell: [], buy: [] }), poor, 2);
  eq([s.expeditions[0].purse, s.expeditions[0].cargo], [0, {}], 'a toll bigger than everything carried takes everything and no more');
});

test('trade at the far end goes through market.js with glut: each load sells for less than the one before, and the stop is left glutted', () => {
  let s = outfit(game(), calm, WOOL);
  s = play(s, calm, 3);                                   // arrives at Hilltown at the end of season 2
  const x = s.expeditions[0];
  const sold = x.book.sold[0];
  eq([sold.good, sold.q, sold.stop], ['wool', 10, 'hilltown']);
  ok(sold.got < 10 * 30 && sold.got > 10 * 30 * 0.6, `ten loads at 30 with depth 15 fetched ${sold.got}`);
  eq(x.purse, sold.got - 5, 'the takings less the toll, which is paid after the goods are sold');
  ok(s.market.hilltown.wool.glut >= 0.3, `Hilltown is glutted: ${s.market.hilltown.wool.glut}`);
  eq(x.cargo, {}, 'everything the plan sold is gone from the cargo');
});

test('buying at the far end spends the money there, each load costs more than the last, and the stop is left short', () => {
  const plan = { agent: 'mira', route: 'harbour-saltmarsh', cargo: { wool: 1 }, purse: 100, contract: 'own', sell: [], buy: ['lamps'] };
  let s = play(outfit(game(), calm, plan), calm, 2);
  const x = s.expeditions[0];
  const b = x.book.bought[0];
  eq([b.good, b.stop], ['lamps', 'saltmarsh']);
  ok(b.q >= 4 && b.q <= 6, `a budget of about 98 buys about six lamps at 15 and rising, got ${b.q}`);
  ok(b.cost / b.q > 15, `the average price (${b.cost / b.q}) is above the base because buying raises it`);
  eq(x.purse, 100 - 2 - b.cost, 'the purse paid the toll and the lamps');
  eq(x.cargo, { wool: 1, lamps: b.q });
  const g = s.market.saltmarsh.lamps.glut;
  ok(g < 0 && g >= -0.3, `lamps are scarcer at Saltmarsh: ${g}`);
});

test('a trait that bargains changes what a load fetches: sharp sells for 5 percent more', () => {
  const c = variant(calm, y => { y.agents.find(a => a.id === 'mira').traits = ['sharp']; y.routes.find(r => r.id === 'harbour-hilltown').legs[0].toll = 0; });
  const sharp = play(outfit(game(c), c, WOOL), c, 3).expeditions[0].book.sold[0].got;
  const plain = variant(c, y => { y.agents.find(a => a.id === 'mira').traits = []; });
  const flat = play(outfit(game(plain), plain, WOOL), plain, 3).expeditions[0].book.sold[0].got;
  ok(sharp > flat && sharp <= Math.round(flat * 1.06), `sharp ${sharp}, plain ${flat}`);
});

// ---- returns

test('returns put a return paper on the desk: the headline sentence first, then the account, and the goods and money come home', () => {
  const c = risk(variant(plainMira(T), y => { for (const l of y.routes.find(r => r.id === 'harbour-hilltown').legs) l.toll = 0; y.agents.find(a => a.id === 'mira').wage = 2; }), 0);
  const s0 = game(c);
  const six = { ...WOOL, cargo: { wool: 6 } };
  let s = outfit(s0, c, six);
  const sent = s.money;
  s = play(s, c, 5);                                      // seasons 1..5: out, trade, wait, back
  eq(s.expeditions.length, 1, 'not home yet');
  s = step(s, c);                                         // the season that opens with the return
  eq(s.expeditions.length, 0);
  const paper = s.desk.find(p => p.kind === 'return');
  const d = paper.data;
  eq([paper.agent, paper.expedition, paper.state], ['mira', 'x1', 'open']);
  ok(/^Mira came home from Hilltown\. The house made \d+ coins\.$/.test(d.headline), d.headline);
  eq(d.route, 'Harbour to Hilltown and back, six seasons');
  eq(d.account.map(r => r.label), ['Sent out', 'Sold', 'Waiting', 'Back home', 'Profit', "Mira's wage"]);
  eq(d.account[2].text, 'one season at a stop, kept at 4 coins a season');
  eq(d.account[0].text, '6 loads of wool');
  ok(/^6 loads of wool in Hilltown$/.test(d.account[1].text));
  eq(paperChoices(s, c, paper.id), [{ id: 'ok', label: 'Into the ledger' }]);
  eq(s.agents.mira.where, 'harbour');
  const profit = d.account.find(r => r.label === 'Profit').amount;
  eq(d.houseNet, profit - 10, 'the headline is the account\'s profit less the wage, which the account also shows');
  eq(d.account.find(r => r.label === "Mira's wage").amount, -10, 'five seasons on the road (the season it was sent in is not one) at 2 a season');
  eq(d.account.find(r => r.label === "Mira's wage").text, '2 coins a season for five seasons');
  ok(d.houseNet > 0, `six loads sent at 20 and sold at 30 falling by a fifteenth a load: ${d.houseNet}`);
  void sent;
  eq(s.log.at(-1).kind === 'return' || s.log.some(e => e.kind === 'return' && e.ref === 'x1'), true);
  eq(choose(s, c, paper.id, 'ok').desk.find(p => p.id === paper.id).state, 'done');
});

test('a loss comes home as a plain headline: the house lost, and says how much', () => {
  const c = risk(variant(T, y => { for (const l of y.routes.find(r => r.id === 'harbour-saltmarsh').legs) l.toll = 0; }), 0);
  // wool sold nowhere at Saltmarsh: carried there and back, the wool is worth the same, the wage is the loss
  let s = outfit(game(c), c, { agent: 'mira', route: 'harbour-saltmarsh', cargo: { wool: 10 }, purse: 0, contract: 'own', sell: [], buy: [] });
  s = play(s, c, 3);
  const d = s.desk.find(p => p.kind === 'return').data;
  ok(/^Mira came home from Saltmarsh\. The house lost \d+ coins\.$/.test(d.headline), d.headline);
  eq(d.outcome, 'loss');
});

// ---- contracts: the split

test('split conserves, a win: a qirad of one third gives the agent a third of the profit, the rest by stake, the remainder to the house', () => {
  const qirad = { kind: 'qirad', agentShare: 1, of: 3 };
  const a = R.split(qirad, { house: 400, partners: 200 }, 900);   // profit 300
  eq(a, { agent: 100, partners: 266, house: 534 });
  eq(a.agent + a.partners + a.house, 900, 'no coin created or lost');
  const odd = R.split(qirad, { house: 401, partners: 200 }, 902);
  eq(odd.agent + odd.partners + odd.house, 902);
  eq(odd.agent, 100, 'profit 301, a third rounded down');
});

test('split conserves, a loss: the agent gets nothing and the capital bears it in proportion to stake', () => {
  const qirad = { kind: 'qirad', agentShare: 1, of: 3 };
  const a = R.split(qirad, { house: 400, partners: 200 }, 300);   // lost half
  eq(a, { agent: 0, partners: 100, house: 200 });
  eq(a.agent + a.partners + a.house, 300);
  eq(R.split(qirad, { house: 400, partners: 200 }, 0), { agent: 0, partners: 0, house: 0 }, 'everything lost');
  eq(R.split(qirad, { house: 400, partners: 200 }, 600), { agent: 0, partners: 200, house: 400 }, 'break even: no profit, no share');
});

test('split conserves for every value, stake and share: nothing negative, nothing lost', () => {
  const s = { rng: 99 };
  for (let i = 0; i < 400; i++) {
    const staked = { house: rng.int(s, 0, 900), partners: rng.int(s, 0, 900) };
    const of = rng.int(s, 2, 6), contract = { kind: 'qirad', agentShare: rng.int(s, 1, of - 1), of };
    const v = rng.int(s, 0, 4000);
    const r = R.split(contract, staked, v);
    eq(r.agent + r.partners + r.house, v, JSON.stringify({ staked, contract, v }));
    ok(r.agent >= 0 && r.partners >= 0 && r.house >= 0, `negative share in ${JSON.stringify(r)}`);
  }
  eq(R.split({ kind: 'own' }, { house: 100, partners: 0 }, 250), { agent: 0, partners: 0, house: 250 }, 'an own contract gives the house all of it');
});

test('a qirad end to end: the partners are paid their stake and share out of what came home, the agent his third, and the coins add up', () => {
  const c = risk(variant(plainMira(T), y => {
    y.city.contracts = { qirad: { agentShare: [1, 3] } };
    for (const l of y.routes.find(r => r.id === 'harbour-hilltown').legs) l.toll = 0;
  }), 0);
  let s = outfit(game(c, { house: 'plain' }), c, { ...WOOL, contract: 'qirad', partners: 100, purse: 100 });
  eq(s.expeditions[0].staked, { house: 200, partners: 100 });
  eq(s.expeditions[0].contract, { kind: 'qirad', agentShare: 1, of: 3 });
  const money0 = s.money;
  let before;
  const saved = steps.returns;
  steps.returns = (st, ...a) => { before = { money: st.money, x: structuredClone(st.expeditions[0]), stock: { ...st.stock } }; return saved(st, ...a); };
  try { s = play(s, c, 6); } finally { steps.returns = saved; }
  const d = s.desk.find(p => p.kind === 'return').data;
  const cash = before.x.purse;
  const { agent, partners, house } = d.shares;
  eq(agent + partners + house, cash + 0, 'with every load sold, what came home is cash, and the three shares are all of it');
  eq(s.money - before.money, cash - agent - partners, 'the house\'s money rose by the cash less what it paid out');
  ok(agent > 0 && partners >= 100, `agent ${agent}, partners ${partners}`);
  eq(d.account.map(r => r.label).slice(-2), ["Mira's share", "The partners' share"]);
  ok(/keeps one third of a profit and bears none of a loss/.test(d.account.at(-2).text), d.account.at(-2).text);
  void money0;
});

test('a qirad that loses everything costs the partners their stake and the house its own, and the agent gets nothing', () => {
  const c = risk(variant(T, y => { y.city.contracts = { qirad: { agentShare: [1, 3] } }; }), 1);
  let found = null;
  for (let seed = 1; seed <= 200 && !found; seed++) {
    let s = outfit(game(c, { seed }), c, { ...WOOL, contract: 'qirad', partners: 100, purse: 100 });
    const money = s.money;
    s = play(s, c, 1);
    s = play(s, c, 1);
    const lost = s.desk.find(p => p.kind === 'lost' && p.data.whole);
    if (lost) found = { s, lost, money };
  }
  ok(found, 'a whole loss turns up');
  eq(found.lost.data.costs.partners, 100, 'the partners lose what they put in');
  eq(found.s.expeditions.length, 0);
  ok(found.lost.data.lines.some(l => l.label === 'The partners'), 'the paper names the partners');
});

// ---- accounts

test('later effects with no follow-up card are recorded and the next season opens with one folded Accounts paper naming each card and choice', () => {
  const s0 = answer(game(), calm);
  const s1 = { ...s0, queue: [
    { at: 1, do: [{ money: 400 }, { stock: 'wool', by: 2 }], from: 'wool-offer/pass' },
    { at: 1, do: [{ rep: 'partners', by: 1 }], from: 'lamp-order/decline' },
    { at: 1, do: [{ flag: 'quiet', set: true }], from: 'lamp-order/commission' },       // nothing the player can see
    { at: 1, do: [], card: 'wool-due', from: 'wool-offer/buy' },                         // has its own card
  ] };
  const s = endSeason(s1, calm);
  const papers = s.desk.filter(p => p.kind === 'accounts');
  eq(papers.length, 1, 'one paper, however many items');
  eq(papers[0].items.map(i => i.text), [
    'From Four loads of wool, "Say no, politely": +400 coins, +2 wool',
    'From Lamps for the winter, "Decline for now": good name with partners +1',
  ], 'each item names its card and choice');
  eq(paperChoices(s, calm, papers[0].id), [{ id: 'ok', label: 'Noted' }]);
  ok(s.desk.some(p => p.ref === 'wool-due'), 'the follow-up card is a card, not an account');
  eq(s.log.filter(e => e.kind === 'accounts').length, 1);
  eq(choose(s, calm, papers[0].id, 'ok').desk.find(p => p.id === papers[0].id).state, 'done');
});

// ---- the act jump

test('the act jump settles every expedition at the quoted prices, resets markets to the new act, and lists each on the interlude page', () => {
  const c = risk(T, 0);
  let s = game(c, { length: 'acts' });
  s = play(s, c, 1);
  s = outfit(s, c, WOOL);                                 // sent in season 1; the act ends after season 2
  s.market.hilltown.wool.glut = 0.4;
  s.market.harbour.wool.f = 1.7;
  s = play(s, c, 2);
  eq([s.phase, s.expeditions.length, s.t], ['interlude', 0, 3], 'the expedition is no longer on the road');
  eq(s.agents.mira.where, 'harbour');
  eq(s.market.hilltown.wool, { f: 1, glut: 0 }, 'markets are back to the base, with no glut and no history');
  eq(s.market.harbour.wool, { f: 1, glut: 0 });
  const page = view(s, c).interlude;
  eq([page.from, page.to, page.years], [1200, 1202, 2], 'testport: season 2 is autumn 1200, season 8 is spring 1202');
  eq(page.settled.length, 1);
  ok(/^Mira came home from Hilltown\. The house made \d+ coins\.$/.test(page.settled[0].text), page.settled[0].text);
  eq(page.settled[0].result, 'home');
  ok(s.stock.wool === undefined && s.money > 500, 'the wool was sold at the quote and the money came home');
  const o = openSeason(s, c);
  eq([o.phase, view(o, c).interlude], ['desk', null]);
});

test('the act jump charges an expedition on the road the wage of its whole road, not of the seasons it had ridden (MER-51b)', () => {
  const run = wage => {
    const c = risk(variant(T, y => { y.agents.find(a => a.id === 'mira').wage = wage; }), 0);
    let s = game(c, { length: 'acts' });
    s = play(s, c, 1);
    s = outfit(s, c, WOOL);
    s.expeditions[0].out = 0;
    const road = R.wholeRoad(c, s.expeditions[0]);
    s = play(s, c, 2);
    return { money: s.money, road, line: view(s, c).interlude.settled[0] };
  };
  const free = run(0), paid = run(3);
  ok(free.road >= 4, `the road is ${free.road} seasons there and back, more than the one season ridden at the jump`);
  eq(free.money - paid.money, 3 * free.road, `at 3 a season the whole road of ${free.road} seasons costs ${3 * free.road}`);
  eq(free.line.houseNet - paid.line.houseNet, 3 * free.road, 'the interlude line counts the same wage');
});

test('the act jump: an expedition that left at the last season settles too, and each leg left is one roll of its risk (two legs here)', () => {
  const c = risk(T, 0.95);   // testport's road to Hilltown has two legs
  let lostCount = 0;
  for (let seed = 1; seed <= 200; seed++) {
    let s = game(c, { length: 'acts', seed });
    s = play(s, c, 2);
    s = outfit(s, c, WOOL);
    s = endSeason(answer(s, c), c);
    eq(s.phase, 'interlude');
    const line = view(s, c).interlude.settled[0];
    if (line.result === 'lost') lostCount++;
  }
  // a careful agent halves 0.95, a whole loss is 0.4 of those: 0.19 a leg, and the route's two legs lose 34 in 100
  ok(lostCount >= 50 && lostCount <= 90, `two legs lose about 69 of 200: ${lostCount}`);
});

test('the act jump: loans fall due with interest for the years passed, and what cannot be paid costs good name', () => {
  const c = risk(T, 0);
  let s = game(c, { length: 'acts' });
  s.loans = [{ id: 'bank-1', from: 'bank', principal: 100, due: 5, rate: 0.1 }, { id: 'bank-2', from: 'bank', principal: 50, due: 20, rate: 0 }];
  s = play(s, c, 3);
  eq(s.loans.map(l => l.id), ['bank-2'], 'the loan due before the next act is paid, the later one stays');
  eq(view(s, c).interlude.loans, [{ id: 'bank-1', from: 'bank', owed: 120, short: 0 }], 'a hundred at 10 percent a year for two years');
  const broke = { ...game(c, { length: 'acts' }), loans: [{ id: 'l', from: 'bank', principal: 100000, due: 5, rate: 0 }] };
  const t = play(broke, c, 3);
  const control = play({ ...broke, loans: [] }, c, 3);
  eq([t.money, t.stock, t.rep.partners], [0, {}, control.rep.partners - 1], 'it sold the warehouse and still fell short');
  eq(view(t, c).interlude.loans[0].short > 99000, true);
});

test('the act jump: trust halves toward 0, an agent at -2 or lower leaves, and some retire', () => {
  const c = risk(T, 0);
  let s = game(c, { length: 'acts', house: 'rich' });
  s.agents.mira.trust = 3;
  s = play(s, c, 2);
  s.agents.tobin.trust = -2;   // set late: an agent at home with -2 at an opening leaves then, before any jump
  s = play(s, c, 1);
  eq([s.agents.tobin.hired, s.agents.tobin.where], [false, 'gone']);
  ok(s.agents.mira.trust === 1 || s.agents.mira.where === 'gone', `mira's trust 3 halves to 1: ${s.agents.mira.trust}`);
  eq(view(s, c).interlude.agents.find(a => a.id === 'tobin'), { id: 'tobin', left: 'trust' });
  let retired = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const t = play(game(c, { length: 'acts', seed }), c, 3);
    if (t.agents.mira.where === 'gone') retired++;
  }
  ok(retired > 5 && retired < 50, `${retired} of 200 retired at ${R.jumpChances(c).retires}`);
});

test('the act jump applies the between events of that gap in order and shows their paragraphs, and does not fire them by `at` in the three-act game', () => {
  const c = variant(risk(T, 0), y => {
    y.events.push({ id: 'between-a', at: 9, between: [1, 2], do: [{ flag: 'a', set: 1 }, { unlock: 'testport' }], interlude: 'Years passed in the north.' });
    y.events.push({ id: 'between-b', at: 5, between: [1, 2], do: [{ flag: 'b', set: 2 }, { flag: 'a', clear: true }], interlude: 'Then more years passed.' });
    y.events.push({ id: 'between-c', at: 5, between: [2, 3], do: [{ flag: 'c', set: 3 }], interlude: 'Not this gap.' });
    y.events.push({ id: 'between-d', at: 9, between: [2, 3], do: [{ flag: 'd', set: 4 }], interlude: 'A gap testport never reaches.' });  // a played season, and no jump will apply it
  });
  // season 9 is played in the acts calendar: the event at 9 must not fire there
  let s = game(c, { length: 'acts' });
  s = play(s, c, 3);
  eq(view(s, c).interlude.paragraphs.map(p => p.id), ['between-b', 'between-a'], 'in the order of their seasons');
  eq(view(s, c).interlude.paragraphs[0].text, 'Then more years passed.');
  eq([s.flags.b, s.flags.a, s.flags.c], [2, 1, undefined], 'b then a: a was cleared by b and then set by a, which comes later; the other gap\'s event did not run');
  s = openSeason(s, c);
  s = play(s, c, 1);                                      // season 9: no second firing by `at`
  eq([s.flags.d, s.seen['event:between-d']], [undefined, undefined], 'season 9 is played, and an event meant for a gap is not fired by it in the three-act game');
  // in the full game there is no gap, and the same event fires in its own season
  let f = game(c, { length: 'full' });
  f = play(f, c, 9);
  eq([idx(f, c), f.flags.a, f.seen['event:between-a'], f.flags.d], [9, 1, 1, 4], 'the full game fires them at their seasons');
  // cairo: act one to act two
  const cairoEvents = C.events.filter(e => e.between?.[0] === 1 && e.between?.[1] === 2).map(e => e.id);
  eq(cairoEvents, ['ibn-battuta-alexandria', 'aydhab-closed-1326', 'aydhab-open-again', 'sultan-pilgrimage-1332']);
});

test('the act jump in cairo: act one to act two applies seven-paragraph material in order and leaves the Aydhab road open again', () => {
  let s = newGame(calmC, { seed: 5, length: 'acts', house: 'spice' });
  s = play(s, calmC, 8);
  eq(s.phase, 'interlude');
  const p = view(s, calmC).interlude;
  eq([p.from, p.to, p.years], [1325, 1335, 9], 'winter 1325 to spring 1335');
  eq(p.paragraphs.map(x => x.id), ['ibn-battuta-alexandria', 'aydhab-closed-1326', 'sultan-pilgrimage-1332']);
  eq(s.flags['aydhab-shut'], undefined, 'shut in 1326, open again in 1330');
  ok(s.notebook.includes('person-ibn-battuta') && s.notebook.includes('person-al-nasir'));
  const next = openSeason(s, calmC);
  eq(M.truePrice(next, calmC, 'cairo', 'pepper'), 120, 'a level market at the base');
});

// ---- the ending

test('recall: city.json carries the chances, a schema checks them, and a decision changes the outcome', () => {
  const edit = recallBlock => variant(risk(T, 0), y => { y.city.recall = recallBlock; });
  const atEnd = c => {
    let s = game(c, { length: 'acts' });
    s = play(s, c, 2);
    s = outfit(s, c, WOOL);
    while (s.phase !== 'recall') s = step(s, c);
    return s;
  };
  const sure = edit({ reach: { start: 1, perSeason: 0, floor: 1 }, recalledKeeps: 0.5, recalledSurvives: 1, stayedSurvives: 0, byStop: {}, homeSurvives: 1 });
  let s = atEnd(sure);
  // the expedition sent in the last act is settled by the jump; send one at the very end instead
  s = { ...game(sure, { length: 'acts' }) };
  s = play(s, sure, 2); s = openSeason(play(s, sure, 1), sure);
  s = play(s, sure, 2);
  s = outfit(s, sure, WOOL);
  s = { ...s, phase: 'recall' };
  const x = s.expeditions[0];
  x.cargo = { wool: 9 };
  const called = recall(s, sure, { [x.id]: 'recall' });
  eq(called.phase, 'ended');
  eq(called.stock.wool, 4, 'recalled: word reached it, and part of the cargo (half of nine, rounded down) came home');
  eq(called.agents.mira.where, 'harbour');
  const stayed = recall(s, sure, { [x.id]: 'stay' });
  eq(stayed.agents.mira.where, 'dead', 'staying with a stayedSurvives of 0');
  const unreached = recall(s, edit({ reach: { start: 0, perSeason: 0, floor: 0 }, stayedSurvives: 1, homeSurvives: 1 }), { [x.id]: 'recall' });
  ok(unreached.stock.wool === undefined || unreached.stock.wool >= 9, 'word did not reach: it finished its road with the whole cargo');
  const byStop = edit({ stayedSurvives: 1, byStop: { hilltown: 0 }, reach: { start: 0, perSeason: 0, floor: 0 }, homeSurvives: 1 });
  eq(recall(s, byStop, { [x.id]: 'stay' }).agents.mira.where, 'dead', 'byStop overrides the general chance for the place the agent is in');
  const plague = edit({ homeSurvives: 0 });
  const t = recall({ ...game(plague, { length: 'acts' }), phase: 'recall' }, plague, {});
  eq(t.agents.mira.where, 'dead', 'an agent at home faces the plague');
  eq(t.log.at(-1).results.at(-1).text, 'Mira was in Harbour and died of the plague.');
  const lives = recall({ ...game(sure, { length: 'acts' }), phase: 'recall' }, sure, {});
  eq(lives.agents.mira.where, 'harbour');
  throws(() => recall(game(), calm, {}), /not at its end/);
});

test('recall: word reaches a far agent less often than a near one, and the draw is taken whatever was decided', () => {
  const c = variant(risk(T, 0), y => { y.city.recall = { reach: { start: 1, perSeason: 0.3, floor: 0 }, recalledSurvives: 1, recalledKeeps: 1, homeSurvives: 1 }; });
  const count = route => {
    let reached = 0;
    for (let seed = 1; seed <= 200; seed++) {
      let s = { ...game(c, { length: 'acts', seed }), phase: 'recall' };
      s = outfit({ ...s, phase: 'desk' }, c, { ...WOOL, route, sell: route === 'harbour-hilltown' ? ['wool'] : [] });
      s = { ...s, phase: 'recall' };
      const r = recall(s, c, { x1: 'recall' });
      if (r.log.at(-1).results[0].how === 'recalled') reached++;
    }
    return reached;
  };
  const near = count('harbour-saltmarsh'), far = count('harbour-hilltown');
  ok(near > far + 40, `near ${near}, far ${far}`);
  const a = { ...game(c), phase: 'recall' };
  const withX = outfit({ ...a, phase: 'desk' }, c, WOOL); withX.phase = 'recall';
  const r1 = recall(withX, c, { x1: 'recall' }), r2 = recall(withX, c, { x1: 'stay' });
  eq(r1.rng, r2.rng, 'recalling or staying takes the same draws, so the rest of the game is the same');
});

test('the recall schema: every chance is a number from 0 to 1, an unknown key is refused, and a stop must exist', () => {
  const fine = variant(T, y => { y.city.recall = { reach: { start: 1 }, byStop: { hilltown: 0.2 } }; });
  validateContent(fine);
  for (const [what, block, re] of [
    ['a chance above 1', { recalledKeeps: 1.5 }, /recalledKeeps: needs a number from 0 to 1/],
    ['a key nobody reads', { recalled: 0.5 }, /unknown key "recalled"/],
    ['a stop that is not in the city', { byStop: { atlantis: 0.5 } }, /no stop "atlantis"/],
    ['a reach with a bad number', { reach: { start: -1 } }, /start: needs a number from 0 to 1/],
  ]) {
    const bad = variant(T, y => { y.city.recall = block; });
    throws(() => validateContent(bad), re);
    void what;
  }
  eq(R.recallChances(T).reach, { start: 0.9, perSeason: 0.2, floor: 0.1 }, 'testport sets its own');
  eq(R.recallChances(variant(C, y => { delete y.city.recall; })), R.DEFAULT_RECALL, 'a city with no block gets the defaults');
  eq(R.recallChances(C), { ...R.DEFAULT_RECALL, ...C.city.recall }, 'cairo reads its own block');
  eq(R.recallChances(variant(C, y => { y.city.recall.reach.start = 0.5; })).reach.start, 0.5, 'and changing it in city.json changes the chance');
});

// ---- city.json's jump block

test('jump: cairo has a recall block and a jump block, routes.js reads them, and a city with none gets the defaults', () => {
  ok(C.city.recall && C.city.jump, 'cairo carries both blocks');
  eq(R.jumpChances(C), { ...R.DEFAULT_JUMP, ...C.city.jump });
  eq(R.jumpChances(variant(C, y => { delete y.city.jump; })), R.DEFAULT_JUMP, 'no block, the defaults');
  eq(R.DEFAULT_JUMP, { retires: 0.1, wholeLoss: 0.4, survivesWhole: 0.75, partial: [0.25, 0.75] }, 'the numbers MER-41 shipped');
  eq(C.city.jump, R.DEFAULT_JUMP, 'cairo writes down the same numbers, so nothing the bots measure moves');
});

test('jump: retires in city.json decides who retires across the act jump', () => {
  const retired = retires => {
    const c = variant(risk(T, 0), y => { y.city.jump = { retires }; });
    const s = play(game(c, { length: 'acts', house: 'rich' }), c, 3);
    return ['mira', 'tobin'].filter(id => s.agents[id].where === 'gone').length;
  };
  eq(retired(1), 2, 'everyone at home retires');
  eq(retired(0), 0, 'nobody does');
});

test('jump: wholeLoss, survivesWhole and partial in city.json decide what a loss takes', () => {
  const base = c => outfit(game(c), c, { ...WOOL, cargo: { wool: 10 }, purse: 30 });
  const roll = (jump, seed) => {
    const c = variant(risk(T, 1), y => { y.city.jump = jump; });
    const s = base(c);
    s.rng = seed; s.expeditions[0].rode = { leg: 0, start: 1 };
    R.risk(s, c);
    return s;
  };
  let checked = 0;
  for (let seed = 1; seed <= 80; seed++) {
    const whole = roll({ wholeLoss: 1, survivesWhole: 0 }, seed);
    if (whole.desk.at(-1)?.kind === 'lost') checked++;
    if (whole.desk.at(-1)?.kind === 'lost') eq([whole.expeditions.length, whole.desk.at(-1).data.whole, whole.desk.at(-1).data.survived, whole.agents.mira.where], [0, true, false, 'dead'], `seed ${seed}: always whole, nobody lives`);
    const half = roll({ wholeLoss: 0, partial: [0.5, 0.5] }, seed);
    if (half.desk.at(-1)?.kind === 'lost') eq([half.desk.at(-1).data.whole, half.expeditions[0]?.cargo.wool], [false, 5], `seed ${seed}: never whole, half of the wool`);
  }
  ok(checked > 20, `${checked} of 80 rolls at risk 0.95 were a loss to check`);
  for (const [bad, re] of [
    [{ retires: 2 }, /retires: needs a number from 0 to 1/],
    [{ partial: [0.8, 0.2] }, /needs \[least, most\]/],
    [{ partial: [0.5] }, /needs \[least, most\]/],
  ]) throws(() => validateContent(variant(T, y => { y.city.jump = bad; })), re);
});

// ---- price news

test('priceNews: false turns price letters off, the default is on, and testport says false', () => {
  eq(T.city.priceNews, false);
  eq(C.city.priceNews, undefined, 'cairo leaves the default');
  const letters = [{ id: 'any' }];
  const news = c => { let s = newGame(c, { seed: 7, length: 'full', house: c.city.id === 'cairo' ? 'spice' : 'plain' }); let n = 0; for (let i = 0; i < 5; i++) { s = step(s, c); n += s.desk.filter(p => p.kind === 'news').length; } return n; };
  eq(news({ ...T, letters }), 0, 'testport says false: none, even with correspondents');
  ok(news({ ...variant(T, y => { delete y.city.priceNews; }), letters }) > 0, 'default true: letters are sent');
  ok(news(C) > 0, 'cairo sends letters by default');
  eq(news(variant(C, y => { y.city.priceNews = false; })), 0, 'cairo with the switch off sends none');
  throws(() => validateContent(variant(T, y => { y.city.priceNews = 'no'; })), /priceNews: needs true or false/);
});

// ---- the small things the unit changed in other files

test('repairMarket keeps a negative glut down to -0.3 and no lower, and a positive one as it was', () => {
  const s = game();
  const sick = structuredClone(s);
  sick.market.harbour.wool.glut = -0.2;
  sick.market.harbour.salt.glut = -0.9;
  sick.market.saltmarsh.lamps.glut = 0.4;
  sick.market.saltmarsh.salt.glut = 'lots';
  const r = repair(sick, T);
  eq([r.market.harbour.wool.glut, r.market.harbour.salt.glut, r.market.saltmarsh.lamps.glut, r.market.saltmarsh.salt.glut], [-0.2, -0.3, 0.4, 0]);
});

test('gold is traded by the chest: the goods file says so, and the account says "chests"', () => {
  eq(C.goods.find(g => g.id === 'gold').unit, 'chest');
  eq(C.goods.filter(g => g.unit === 'chest').map(g => g.id), ['gold']);
  const s = cairo();
  s.stock.gold = 3;
  const out = outfit(s, calmC, { agent: 'yusuf', route: 'cairo-damascus', cargo: { gold: 2 }, purse: 0, contract: 'own', sell: ['gold'], buy: [] });
  const home = play(out, calmC, 3);
  const paper = home.desk.find(p => p.kind === 'return');
  ok(paper, 'the expedition came home');
  eq(paper.data.account[0].text, '2 chests of gold');
  ok(/^2 chests of gold in Damascus$/.test(paper.data.account[1].text), paper.data.account[1].text);
});

// ---- whole games, scripted

/** Plays a game to its end with a scripted plan: answer everything, send whoever is free to each stop in
    turn when suggestPlan has a plan, recall everyone at the end. */
/** A plan for the final season: the first free agent, one load of a good the stop trades bought at home if the warehouse has none, the house's own contract. */
function lastPlan(s, c, stop) {
  const home = c.city.home;
  const agent = c.agents.find(a => s.agents[a.id].hired && s.agents[a.id].where === home && !s.expeditions.some(x => x.agent === a.id));
  const good = Object.keys(s.market[home] ?? {}).find(g => c.stops.find(x => x.id === stop)?.sells?.[g]);
  const hit = agent && good && R.routeFor(s, c, stop, agent);
  const plan = hit && { agent: agent.id, route: hit.route.id, cargo: { [good]: 1 }, purse: 0, contract: 'own', sell: [good], buy: [] };
  return plan && checkPlan(s, c, plan).ok ? plan : null;
}
function run(c, { seed, length, house, stops, last = [] }) {
  let s = newGame(c, { seed, length, house });
  let sent = 0, lastSent = false;
  while (s.phase !== 'recall') {
    if (s.phase === 'interlude') { s = openSeason(s, c); continue; }
    s = answer(s, c);
    for (const stop of stops) { const p = suggestPlan(s, c, stop); if (p) { s = outfit(s, c, p); sent++; } }
    // `last`: in the final season send one more, to the first of these stops the house can, so an expedition has just left when the game ends
    if (view(s, c).last) for (const stop of last) { const p = !lastSent && lastPlan(s, c, stop); if (p) { s = outfit(s, c, p); sent++; lastSent = true; } }
    s = endSeason(s, c);
  }
  const decisions = Object.fromEntries(s.expeditions.map(x => [x.id, 'recall']));
  return { s: recall(s, c, decisions), sent, lastSent };
}
const sound = s => {
  ok(Number.isInteger(s.money) && s.money >= 0, `money ${s.money}`);
  for (const [g, n] of Object.entries(s.stock)) ok(Number.isInteger(n) && n > 0, `stock ${g} ${n}`);
  eq(s.expeditions, []);
  for (const m of Object.values(s.market)) for (const e of Object.values(m)) ok(e.glut >= -0.3 && e.glut <= 0.6 && Number.isFinite(e.f), JSON.stringify(e));
};

test('a seeded testport game with a scripted plan runs to the end in both lengths, and is the same game twice', () => {
  for (const length of ['acts', 'full']) {
    const a = run(T, { seed: 7, length, house: 'rich', stops: ['hilltown'] });
    const b = run(T, { seed: 7, length, house: 'rich', stops: ['hilltown'] });
    eq(a.s.phase, 'ended');
    sound(a.s);
    eq(JSON.stringify(a.s), JSON.stringify(b.s), `${length}: a second run is the same game`);
    ok(a.sent >= 2, `${length}: sent ${a.sent}`);
    if (length === 'full') ok(a.s.log.some(e => e.kind === 'return'), 'something came home');
    else ok(a.s.log.find(e => e.kind === 'jump').settled.length > 0, 'the jump settled an expedition');
    ok(a.s.log.some(e => e.kind === 'recall'), 'the ending is in the log');
    eq(a.s.log.some(e => e.kind === 'jump'), length === 'acts');
  }
  ok(JSON.stringify(run(T, { seed: 8, length: 'full', house: 'rich', stops: ['hilltown'] }).s) !== JSON.stringify(run(T, { seed: 7, length: 'full', house: 'rich', stops: ['hilltown'] }).s));
});

test('a seeded cairo three-act game with a scripted plan runs to the end in Node, jumps twice, and ends with the recall', () => {
  // an expedition is sent in the final season, so it is on the road when the game ends whatever the cards drew
  // MER-78: seed 10 became 13. The draw's one-favour and no-two-of-a-kind rules deal other cards, so no agent was home to face the plague in seed 10's game.
  const plan = { seed: 13, length: 'acts', house: 'spice', stops: ['damascus', 'alexandria', 'venice'], last: ['damascus', 'alexandria', 'venice'] };
  const a = run(C, plan);
  const b = run(C, plan);
  ok(a.lastSent || a.s.log.find(e => e.kind === 'recall').results.some(r => r.expedition), 'an agent was free to send in the final season, or one was already out');
  eq(a.s.phase, 'ended');
  sound(a.s);
  eq(JSON.stringify(a.s), JSON.stringify(b.s), 'a second run is the same game');
  eq(a.s.log.filter(e => e.kind === 'jump').map(e => [e.from, e.to]), [[7, 44], [51, 87]]);
  ok(a.sent >= 6, `sent ${a.sent}`);
  ok(a.s.log.filter(e => e.kind === 'return').length >= 3, 'expeditions came home');
  const end = a.s.log.find(e => e.kind === 'recall');
  ok(end.results.some(r => r.expedition), 'an expedition was still on the road and the ending says what became of it');
  ok(end.results.some(r => r.how === 'home'), 'and an agent at home faced the plague');
  eq(new Set(end.results.map(r => r.agent)).size, end.results.length, 'no agent is rolled for twice');
  eq(end.results.every(r => typeof r.text === 'string' && r.text.length > 0), true);
});

// ---- MER-78: what a return and a loss ask (returns.json, DESIGN 2.1 rules 3 and 4). data.js does not load returns.json yet, so
// the cases put the file into the content by hand.
const RET = JSON.parse(await fs.readFile(new URL('../data/testport/returns.json', import.meta.url), 'utf8'));
const withReturns = (c, extra = []) => variant(c, y => { y.returns = [...structuredClone(RET), ...structuredClone(extra)]; });
const entry = (id, paper, facts, over = {}) => ({ id, paper, ...(facts ? { facts } : {}), title: 'T', body: 'B', choices: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], note: 'n', sources: [{ src: 'testport-fiction' }], ...over });
const homeWith = (c, plan = WOOL) => {
  let s = outfit(game(c), c, plan);
  for (let i = 0; i < 12 && !s.desk.some(p => p.kind === 'return'); i++) s = step(s, c);
  return s;
};

test('returns.json of both cities is valid content, and a bad entry is refused in words', () => {
  validateContent(withReturns(T), {});
  const cairoRet = JSON.parse(readFileSyncOf('cairo'));
  validateContent(variant(C, y => { y.returns = cairoRet; }), {});
  const bad = e => { try { validateContent(withReturns(T, [e]), {}); } catch (err) { return err.problems.map(p => p.message).join(' | '); } return null; };
  ok(/no fact "by"/.test(bad(entry('x', 'return', { by: ['galley'] }))), 'a return has no vessel fact');
  ok(/no fact "outcome"/.test(bad(entry('x', 'loss', { outcome: ['profit'] }))), 'a loss has no outcome fact');
  ok(/needs one of profit, loss, even/.test(bad(entry('x', 'return', { outcome: ['lucky'] }))));
  ok(/no stop "nowhere"/.test(bad(entry('x', 'return', { to: ['nowhere'] }))));
  ok(/needs a number/.test(bad(entry('x', 'return', { seasons: { gte: 'three' } }))));
  ok(/used twice/.test(bad(entry('return-bonus', 'return'))));
  ok(/needs at least 1 item/.test(bad(entry('x', 'return', null, { choices: [] }))));
});
function readFileSyncOf(city) { return fsSync.readFileSync(new URL(`../data/${city}/returns.json`, import.meta.url), 'utf8'); }

test('a return paper carries the trip in data (route, to, good, seasons, orders) and a choices list from returns.json by its facts', () => {
  const c = withReturns(calm), s = homeWith(c), p = s.desk.find(q => q.kind === 'return'), d = p.data;
  eq([d.trip.route, d.trip.to, d.trip.good, d.trip.agent, d.trip.expedition], ['harbour-hilltown', 'hilltown', 'wool', 'mira', p.expedition]);
  eq(d.trip.seasons, idx(s, c) - 0, 'the seasons are the ones between the sending (season 0) and the opening that brought it home');
  eq(d.trip.orders, [], 'no order took effect');
  eq(d.entry, d.outcome === 'profit' ? 'return-bonus' : 'return-out-again', `by the outcome, ${d.outcome}`);
  eq(d.choices.map(x => x.id), d.outcome === 'profit' ? ['bonus', 'none'] : ['again', 'rest']);
  ok(d.choices.every(x => !/[{}]/.test(x.label)) && /Mira/.test(JSON.stringify(d.choices)), 'the agent\'s name is in the words, no braces are left');
  ok(/Mira is home from Hilltown after/.test(d.ask.body), d.ask.body);
  eq(d.choices[0].now.length > 0, true, 'the entry\'s own effects ride on the choice');
});
test('a return paper of a city with no returns.json has an empty choices list and no entry, and still plays', () => {
  const s = homeWith(calm), d = s.desk.find(q => q.kind === 'return').data;
  eq([d.entry, d.choices, d.ask], [null, [], null]);
});
test('returns.json: the entry that names the most facts wins, and an entry whose fact does not fit is shut out', () => {
  const s = game(withReturns(calm)), pick = (c, facts, paper = 'return') => R.pickEntry(s, c, paper, facts)?.id;
  const base = { outcome: 'profit', agent: 'mira', to: 'hilltown', good: 'wool', seasons: 4, orders: false, contract: 'own', lost: false };
  const c = withReturns(calm, [
    entry('mira-profit', 'return', { outcome: ['profit'], agent: ['mira'] }),
    entry('far-profit', 'return', { outcome: ['profit'], seasons: { gte: 6 } }),
    entry('saltmarsh', 'return', { outcome: ['profit'], to: ['saltmarsh'] }),
    entry('never', 'return', { outcome: ['profit'], agent: ['mira'], good: ['wool'] }, { weight: 0 }),
    entry('shut', 'return', { outcome: ['profit'], agent: ['mira'], good: ['wool'], orders: false }, { when: { flag: 'no-such-flag' } }),
  ]);
  eq(pick(c, base), 'mira-profit', 'two facts beat one (return-bonus), and the entries of weight 0 or a failing `when` are out');
  eq(pick(c, { ...base, agent: 'tobin' }), 'return-bonus', 'another agent: back to the one-fact entry');
  eq(pick(c, { ...base, seasons: 6, agent: 'tobin' }), 'far-profit', 'a range of seasons fits at its edge');
  eq(pick(c, { ...base, seasons: 5, agent: 'tobin' }), 'return-bonus', 'and not below it');
  eq(pick(c, { ...base, to: 'saltmarsh', agent: 'tobin' }), 'saltmarsh', 'a stop fits by name');
  eq(pick(c, { ...base, outcome: 'loss' }), 'return-out-again', 'a loss: only the entry that names no fact fits');
  eq(R.pickEntry(s, withReturns(calm), 'loss', { whole: false, survived: true })?.id, 'loss-survivor');
  eq(R.pickEntry(s, { ...calm, returns: [] }, 'return', base), null, 'no entry, no choices');
});
test('a loss paper carries the trip and a choices list likewise: a lost agent and a safe one are asked different things', () => {
  const c = withReturns(risk(T, 1));
  const lose = (jump, seed) => {
    const x = variant(c, y => { y.city.jump = jump; });
    const s = outfit(game(x), x, { ...WOOL, purse: 30 });
    s.rng = seed; s.expeditions[0].rode = { leg: 0, start: 1 };
    R.risk(s, x);
    return s;
  };
  let seen = 0;
  for (let seed = 1; seed <= 60 && seen < 2; seed++) {
    const dead = lose({ wholeLoss: 1, survivesWhole: 0 }, seed), paper = dead.desk.find(p => p.kind === 'lost');
    if (paper) {
      seen++;
      eq([paper.data.entry, paper.data.choices.map(x => x.id)], ['loss-lost-agent', ['family', 'nothing']]);
      eq([paper.data.trip.agent, paper.data.trip.to, paper.data.trip.good, paper.data.trip.expedition], ['mira', 'hilltown', 'wool', paper.expedition]);
      ok(/Mira did not come back/.test(paper.data.ask.title) && /lost on the road to Hilltown/.test(paper.data.ask.body), JSON.stringify(paper.data.ask));
    }
  }
  ok(seen === 2, 'two whole losses turned up');
  let safe = 0;
  for (let seed = 1; seed <= 60 && !safe; seed++) {
    const s = lose({ wholeLoss: 0, partial: [0.5, 0.5] }, seed), paper = s.desk.find(p => p.kind === 'lost');
    if (paper) { safe++; eq([paper.data.entry, paper.data.choices.map(x => x.id)], ['loss-survivor', ['forgive', 'blame']]); }
  }
  ok(safe, 'a partial loss turned up');
});

done();
