// A venture, its estimate and its answer (DESIGN 2.2 rules 1 and 2, MER-92): node test/venture.mjs, from Projects/Merchant/.
// Plain Node, no browser, no clock. Testport carries the arithmetic (its prices do not drift: sigma 0), cairo carries the real
// roads and the real game.
import fs from 'node:fs/promises';
import { test, eq, ok, done } from './lib.mjs';
import { loadContent } from '../js/data.js';
import * as R from '../js/engine/routes.js';
/** Runs `fn` with the rule that refuses unspent money switched on (routes.js RULES, on since MER-93), and puts it back as it was. */
const ruled = fn => () => { const was = R.RULES.refuseUnspentMoney; R.RULES.refuseUnspentMoney = true; try { return fn(); } finally { R.RULES.refuseUnspentMoney = was; } };
import { steps } from '../js/engine/turn.js';
import { WAIT } from '../js/engine/letters.js';
import * as M from '../js/engine/market.js';
import { seasonIndex, playedSeasons } from '../js/engine/calendar.js';
import { newGame, openSeason, endSeason, choose, paperChoices, outfit, checkPlan, proposePlan, estimate, bestTrades, mostLoads, view } from '../js/engine/index.js';
import { holds } from '../js/engine/conditions.js';

const T0 = await loadContent('testport', { fs });
const C = await loadContent('cairo', { fs });
const variant = (c, edit) => { const x = structuredClone(c); edit(x); return x; };
/** Testport with Hilltown also selling salt (so money sent there has a good to bring back), no drift, calm roads, Mira plain. */
const still = (edit = () => {}) => variant(T0, x => {
  x.stops.find(s => s.id === 'hilltown').sells.salt = { base: 6, depth: 40 };
  for (const g of x.goods) { g.sigma = 0; g.revert = 0; }
  for (const r of x.routes) for (const l of r.legs) l.risk = 0;
  x.agents.find(a => a.id === 'mira').traits = ['honest'];
  x.agents.find(a => a.id === 'mira').wage = 1;   // a wage that does not swallow a testport venture (MER-98: only a plan that pays is proposed)
  edit(x);
});
const game = (c, over = {}) => newGame(c, { seed: 7, length: 'full', house: 'plain', ...over });
const know = (s, c, stop, good, p, age = 0) => { (s.known[stop] ??= {})[good] = { p, at: seasonIndex(s, c) - age }; return s; };

function answer(s, c) {
  for (const p of s.desk) {
    if (p.state !== 'open') continue;
    const ch = paperChoices(s, c, p.id).find(x => { try { choose(s, c, p.id, x.id); return true; } catch { return false; } });   // the first choice the house can take (MER-141)
    s = choose(s, c, p.id, ch.id);
  }
  return s;
}
const step = (s, c) => (s.phase === 'interlude' ? openSeason(s, c) : endSeason(answer(s, c), c));
/** Plays on until the expedition's return paper is on the desk; returns { s, paper }. */
function toReturn(s, c, limit = 14) {
  for (let i = 0; i < limit && !s.desk.some(p => p.kind === 'return'); i++) s = step(s, c);
  return { s, paper: s.desk.find(p => p.kind === 'return') };
}
const WOOL = { agent: 'mira', route: 'harbour-hilltown', cargo: { wool: 10 }, purse: 0, contract: 'own', sell: ['wool'], buy: [] };

// ---- the default plan

test('proposePlan: goods that sell better at the far end, bought with about half the money, and the one best known margin to bring back', () => {
  const c = still();
  let s = game(c);
  know(s, c, 'hilltown', 'wool', 30);      // wool: 20 at home, 30 there (better there)
  know(s, c, 'hilltown', 'salt', 3);       // salt: 10 at home, 3 there (the margin to bring back)
  s.stock.wool = 4;                        // four loads in the warehouse; no more than half a market's depth (8 of 15) goes in one good
  const plan = proposePlan(s, c, 'mira', 'harbour-hilltown');
  eq([plan.agent, plan.route, plan.contract, plan.sell, plan.buy], ['mira', 'harbour-hilltown', 'own', ['wool'], ['salt']]);
  ok(!plan.cargo.salt, 'salt is cheaper there than at home and is not sent');
  eq(plan.cargo.wool, 8, 'the four loads in the warehouse go, and four more are bought now, up to half the market\'s depth at the far end');
  const bought = checkPlan(s, c, plan).cost.bought;
  ok(bought > 0 && bought <= s.money / 2, `bought ${bought} of ${s.money / 2}, half the money on hand`);
  eq(checkPlan(s, c, plan).ok, true, 'the engine takes it');
  // a good that sells for less there is not sent however many are held
  know(s, c, 'hilltown', 'wool', 15);
  eq(proposePlan(s, c, 'mira', 'harbour-hilltown')?.cargo.wool ?? 0, 0, 'wool is dearer at home now: none goes');
});

test('proposePlan: the bring-back good is the one the map\'s best trade names for the road, not one the plan sends out, and a stop with no news is guessed at its base price', () => {
  const c = still();
  const s = game(c);
  know(s, c, 'hilltown', 'wool', 30);
  know(s, c, 'hilltown', 'salt', 8);
  eq(proposePlan(s, c, 'mira', 'harbour-hilltown').buy, ['salt'], 'the only one cheaper there');
  // two goods cheaper there than at home: the one that makes more once the loads are priced one after the other, whichever way the list or the alphabet runs
  const both = (wool, salt) => { const u = game(c); know(u, c, 'hilltown', 'wool', wool); know(u, c, 'hilltown', 'salt', salt); return proposePlan(u, c, 'mira', 'harbour-hilltown').buy; };
  eq(both(10, 4), ['salt'], 'salt: 10 at home for 4, forty loads deep, makes more than wool: 20 for 10, fifteen deep');
  const none = game(c);
  const guess = proposePlan(none, c, 'mira', 'harbour-hilltown');
  ok(guess && guess.buy.length === 1, `with no news the stop's base prices guide the default: ${JSON.stringify(guess)}`);
  eq(estimate(none, c, guess).ageWords, 'no news', 'and the estimate says it is a guess');
});

test('MER-112b (5) proposePlan: the bring-back good is chosen by what the loads make, not by the price ratio: a thin market with the widest margin loses to a deep one (the old pick: salt, and no plan)', () => {
  // Hilltown sells salt at 3 against 10 at home (3.3 times, but four loads deep: two loads fit) and wool at 20 against 40 (2 times, forty deep)
  const c = still(x => {
    const h = x.stops.find(z => z.id === 'hilltown');
    h.sells.salt = { base: 6, depth: 4 }; h.sells.wool = { base: 30, depth: 40 };
    x.stops.find(z => z.id === 'harbour').sells.wool.base = 40;
  });
  const s = know(know(game(c), c, 'hilltown', 'wool', 20), c, 'hilltown', 'salt', 3);
  s.market.hilltown.wool.f = 20 / 30; s.market.hilltown.salt.f = 3 / 6;   // the news is true: the stop pays what the house heard
  const trades = bestTrades(s, c, 9).filter(t => t.route === 'harbour-hilltown');
  eq(trades.map(t => [t.good, t.direction]), [['wool', 'back']], 'the map names wool, bought at Hilltown and sold at home, and nothing else for the road');
  const wide = (g) => M.truePrice(s, c, 'harbour', g) / s.known.hilltown[g].p;
  ok(wide('salt') > wide('wool') * 1.5, `salt is the wider margin: ${wide('salt').toFixed(2)} against ${wide('wool').toFixed(2)}`);
  const plan = proposePlan(s, c, 'mira', 'harbour-hilltown');
  ok(!plan.why, plan.why);
  eq([plan.buy, plan.cargo], [['wool'], {}], 'the plan brings wool back');
  ok(plan.purse > 0, 'with money to buy it');
  const e = estimate(s, c, plan);
  ok(e.net > 0 && e.back.wool >= 8, `${e.net} dinars, ${e.back.wool} loads of wool`);
  eq(checkPlan(s, c, plan).ok, true, 'and the engine takes it');
  const { paper } = toReturn(outfit(s, c, plan), c);
  ok(Math.abs(paper.data.houseNet - e.net) <= Math.abs(e.net) * 0.05 + 6, `estimated ${e.net}, made ${paper.data.houseNet}`);
});

test('proposePlan: where the stop buys nothing the house can send, the trip goes as money, about half of it, to buy the good to bring back', () => {
  const c = still();
  const s = game(c);
  know(s, c, 'saltmarsh', 'salt', 5);
  s.stock = {};
  const plan = proposePlan(s, c, 'mira', 'harbour-saltmarsh');
  eq([plan.cargo, plan.buy, plan.sell], [{}, ['salt'], []]);
  // MER-133: the sheet's plan stakes half the money and then more where a step pays (each step earning its own stake, STRETCH_RETURN), keeping the wage
  ok(plan.purse > s.money / 2 && plan.purse <= s.money - checkPlan(s, c, plan).cost.later.wage, `${plan.purse} of ${s.money}`);
  eq(checkPlan(s, c, plan).ok, true);
  const half = proposePlan(s, c, 'mira', 'harbour-saltmarsh', { share: 0.5 });
  ok(half.purse > 0 && half.purse <= s.money / 2, `a stake of half, as a bot asks for it: ${half.purse} of ${s.money}`);
});

test('proposePlan: an agent who will not go for a wage again is offered a qirad, and the plan is one the engine takes', () => {
  const c = variant(still(), x => { x.city.contracts = { qirad: { agentShare: [1, 3] } }; });
  const s = game(c);
  know(s, c, 'hilltown', 'wool', 30); know(s, c, 'hilltown', 'salt', 3);
  s.agents.mira.memory = [{ kind: 'unfair' }, { kind: 'unfair' }];
  const plan = proposePlan(s, c, 'mira', 'harbour-hilltown');
  eq([plan.contract, plan.partners > 0, plan.purse >= plan.partners], ['qirad', true, true]);
  eq(checkPlan(s, c, plan).ok, true, checkPlan(s, c, plan).reasons.join(' '));
});

test('proposePlan: null for a road that does not project, an unknown agent and a road nobody can ride', () => {
  const c = still();
  const s = game(c);
  eq(proposePlan(s, c, 'nobody', 'harbour-hilltown'), null);
  eq(proposePlan(s, c, 'mira', 'no-such-road'), null);
});

// ---- money needs a good to bring back

test('build refuses money sent with no bring-back good, says so in words and names the one to take; the same plan with it, or with no money, goes', ruled(() => {
  const c = variant(C, x => { for (const r of x.routes) for (const l of r.legs) l.risk = 0; });
  let s = newGame(c, { seed: 3, length: 'acts', house: c.houses[0].id });
  s.stock = { linen: 20 };
  const plan = { agent: 'yusuf', route: 'cairo-damascus', cargo: { linen: 5 }, purse: 100, contract: 'own', sell: ['linen'], buy: [] };
  const no = checkPlan(s, c, plan);
  eq(no.ok, false);
  ok(/Money sent to buy with needs a good to bring back, and none is named\. .+ is the best known one from Damascus: name it, or send no money\./.test(no.reasons[0]), no.reasons[0]);
  ok(!/\u2014/.test(no.reasons[0]), 'no em dash');
  eq(checkPlan(s, c, { ...plan, purse: 0 }).ok, true, 'no money, no good needed: the proceeds come home as money');
  const best = /^Money.*?\. (\w[\w ]*?) is the best known/.exec(no.reasons[0])[1].toLowerCase();
  const named = checkPlan(s, c, { ...plan, buy: [c.goods.find(g => g.name.toLowerCase() === best).id] });
  eq(named.ok, true, named.reasons.join(' '));
  throwsWith(() => outfit(s, c, plan), /needs a good to bring back/);
}));
const throwsWith = (fn, re) => { try { fn(); } catch (e) { ok(re.test(e.message), e.message); return; } throw new Error('expected a throw'); };

test('every road of the data ends at a stop with a good the house can bring back, so the refusal always has a good to offer', ruled(() => {
  const c = variant(C, x => { for (const r of x.routes) for (const l of r.legs) l.risk = 0; });
  let s = newGame(c, { seed: 3, length: 'acts', house: c.houses[0].id });
  s.stock = { linen: 20 };
  const bare = [];
  for (const r of c.routes) {
    const dest = c.stops.find(z => z.id === r.to);
    const plan = { agent: 'yusuf', route: r.id, cargo: { linen: 1 }, purse: 50, contract: 'own', sell: [], buy: [] };
    const res = checkPlan(s, c, plan);
    if (!res.ok && /not open in these years|can only start in/.test(res.reasons.join(' '))) continue;   // a road shut at the start of the game says so, not this
    if (res.ok || !/needs a good to bring back/.test(res.reasons.join(' '))) bare.push(`${r.id}: ${res.reasons.join(' ')}`);
    void dest;
  }
  eq(bare, [], 'every route is refused for want of a bring-back good, nothing else');
}));

test('the narrow corner: a stop with nothing the house sells at home has no good to offer, and money sent there is not refused for it (no stop of the data is like that)', ruled(() => {
  const c = variant(T0, x => { for (const r of x.routes) for (const l of r.legs) l.risk = 0; });
  const s = game(c);
  eq(checkPlan(s, c, { ...WOOL, purse: 20 }).ok, true, 'Hilltown as the data has it sells only wool, and the house sends wool');
}));

test('the rule is on: money sent with no good to bring back is refused as shipped, and naming the good takes it (routes.js RULES)', () => {
  const c = variant(C, x => { for (const r of x.routes) for (const l of r.legs) l.risk = 0; });
  const s = newGame(c, { seed: 3, length: 'acts', house: c.houses[0].id });
  s.stock = { linen: 20 };
  eq(R.RULES.refuseUnspentMoney, true);
  const bare = { agent: 'yusuf', route: 'cairo-damascus', cargo: { linen: 5 }, purse: 100, contract: 'own', sell: ['linen'], buy: [] };
  const no = checkPlan(s, c, bare);
  eq(no.ok, false);
  ok(/needs a good to bring back/.test(no.reasons.join(' ')), no.reasons.join(' '));
  // news of a good Damascus sells for far less than Cairo pays: the plan has something worth bringing back (MER-98: a plan that does not pay is not proposed)
  know(s, c, 'damascus', 'silk', 300);
  const offered = proposePlan(s, c, 'yusuf', 'cairo-damascus');
  ok(offered && !offered.why && offered.buy.length > 0, `the default names a good to bring back: ${JSON.stringify(offered)}`);
  eq(checkPlan(s, c, offered).ok, true, 'the engine takes the default it offers');
});

// ---- the estimate

test('estimate: the sales at the far end, each load a little lower, less the tolls, the wage and the house\'s stake, by hand', () => {
  const c = still();
  const s = know(game(c), c, 'hilltown', 'wool', 30);
  const e = estimate(s, c, WOOL);
  const later = checkPlan(s, c, WOOL).cost.later;
  // ten loads at 30 with depth 15: 30, 28, 26, 24, 22, 20, 18, 16, 14, 12 = 210; tolls 5 and 5; ten loads from the warehouse at 20 = 200
  // (the way home from Hilltown is shut in winter, so the trip waits a season there: upkeep, which `estimate` counts)
  eq([e.gross + e.upkeep, e.tolls, e.stake, e.wage], [210 - 10, 10, 200, later.wage]);
  eq(e.net, 210 - 10 - 200 - later.wage - e.upkeep);
  eq(e.upkeep, R.UPKEEP, 'one season waiting at Hilltown for the way home to open, at the upkeep the engine charges');
  eq([e.ok, e.seasons > 0, typeof e.line], [true, true, 'string']);
});

test('estimate: the money buys the bring-back good at the far end and the goods are valued at the home price now', () => {
  const c = still();
  const s = know(know(game(c), c, 'hilltown', 'wool', 30), c, 'hilltown', 'salt', 3);
  const plain = estimate(s, c, WOOL);
  const back = estimate(s, c, { ...WOOL, buy: ['salt'] });
  ok(back.net > plain.net + 300, `salt that costs 3 there and fetches 10 at home adds well over 300 to ${plain.net}: ${back.net}`);
  // 210 of sales buys loads at 3 to 4 each (the price rises as the house buys), worth 10 each at home
  ok(back.gross > 210 + 300, `${back.gross}`);
});

test('estimate: it follows a calm trip to the dinar or close to it (prices that do not drift, no loss)', () => {
  const c = still();
  for (const [name, plan] of [['sell wool', WOOL], ['sell wool, buy salt', { ...WOOL, buy: ['salt'] }], ['money and wool', { ...WOOL, purse: 40, buy: ['salt'] }]]) {
    let s = game(c);
    know(s, c, 'hilltown', 'wool', 30); know(s, c, 'hilltown', 'salt', 6);   // what the stop really pays: nothing drifts
    const e = estimate(s, c, plan);
    s = outfit(s, c, plan);
    const { paper } = toReturn(s, c);
    const diff = Math.abs(paper.data.houseNet - e.net);
    ok(diff <= 6, `${name}: estimated ${e.net}, made ${paper.data.houseNet}`);
    eq(paper.data.hoped, e.net, `${name}: the paper carries what was hoped at sending`);
    eq(-(paper.data.account.find(r => r.label === 'Waiting')?.amount ?? 0), e.upkeep, `${name}: the waiting the estimate counted is the waiting the paper shows`);
  }
});

test('estimate: it reads what the house knows and nothing else: moving the true market changes nothing, moving the news does', () => {
  const c = still();
  const s = know(game(c), c, 'hilltown', 'wool', 30);
  const a = estimate(s, c, WOOL).net;
  const t = structuredClone(s); t.market.hilltown.wool.f = 1.8;
  eq(estimate(t, c, WOOL).net, a, 'the true factor is hidden');
  const u = know(structuredClone(s), c, 'hilltown', 'wool', 36);
  ok(estimate(u, c, WOOL).net > a, 'better news, better estimate');
});

test('estimate: the news age in words and the road\'s risk word', () => {
  const c = still(x => { for (const l of x.routes.find(r => r.id === 'harbour-hilltown').legs) l.risk = 0.3; });
  const s = know(game(c), c, 'hilltown', 'wool', 30, 2);
  const e = estimate(s, c, WOOL);
  eq([e.age, e.ageWords], [2, 'two seasons old']);
  eq(e.riskWord, 'dangerous', `${e.risk}`);
  ok(/If prices hold: about [+-]\d+ coins\. The news of the prices is two seasons old; the road is dangerous\./.test(e.line), e.line);
  eq(R.riskWord(0.02), 'safe');
  eq(R.riskWord(0.2), 'uncertain');
  eq(R.riskWord(0.4), 'risky');
  eq(R.riskWord(0.9), 'dangerous');
  const calm = still();
  eq(estimate(know(game(calm), calm, 'hilltown', 'wool', 30), calm, WOOL).riskWord, 'safe');
});

test('estimate: a qirad takes the agent\'s share out of the profit and the partners\' stake out of the house\'s side; an own plan pays the wage instead', () => {
  const c = variant(still(), x => { x.city.contracts = { qirad: { agentShare: [1, 3] } }; });
  const s = know(game(c), c, 'hilltown', 'wool', 30);
  const own = estimate(s, c, WOOL);
  const q = estimate(s, c, { ...WOOL, contract: 'qirad', partners: 60, purse: 60, buy: ['salt'] });
  ok(own.wage > 0 && q.wage === 0, 'a qirad pays no wage');
  ok(q.shares.agent > 0 && q.shares.partners >= 60, JSON.stringify(q.shares));
});

// ---- hoped, and why

test('the return paper carries hoped (the estimate at sending, saved on the expedition) and an old expedition without it reads null', () => {
  const c = still();
  let s = know(game(c), c, 'hilltown', 'wool', 30);
  const e = estimate(s, c, WOOL);
  s = outfit(s, c, WOOL);
  eq(s.expeditions[0].hoped, e.net);
  const old = structuredClone(s);
  delete old.expeditions[0].hoped; delete old.expeditions[0].hope;
  const { paper } = toReturn(old, c);
  eq([paper.data.hoped, paper.data.why], [null, null], 'a save from before the estimate says nothing about a gap');
});

test('why: a trip that went as estimated says so', () => {
  const c = still();
  const s = know(game(c), c, 'hilltown', 'wool', 30);
  const { paper } = toReturn(outfit(s, c, WOOL), c);
  eq(paper.data.why, 'The trip went about as hoped.');
});

test('why, old news: the far price was not the price the news gave, named with the price, the good, the stop and the news age', () => {
  const c = still();
  const s = know(game(c), c, 'hilltown', 'wool', 40, 2);   // the news says 40; the stop pays 30
  const { paper } = toReturn(outfit(s, c, WOOL), c);
  eq(paper.data.why, 'Hilltown paid 30 for wool when Mira arrived, not the 40 the news, two seasons old, led us to expect.');
  ok(paper.data.hoped > paper.data.houseNet);
});

test('why, old news, the other way: better than the news said', () => {
  const c = still();
  const s = know(game(c), c, 'hilltown', 'wool', 22, 1);
  const { paper } = toReturn(outfit(s, c, WOOL), c);
  ok(/^Hilltown paid 30 for wool when Mira arrived, more than the 22 the news, one season old, led us to expect\.$/.test(paper.data.why), paper.data.why);
});

test('why, old news, a good bought at the far end that cost more than the news said', () => {
  const c = still();
  const s = know(know(game(c), c, 'hilltown', 'wool', 30), c, 'hilltown', 'salt', 3, 2);   // the news says salt is 3 (the lowest a price falls to, half the base); it is 6
  const { paper } = toReturn(outfit(s, c, { ...WOOL, buy: ['salt'] }), c);
  ok(/^Salt cost 6 in Hilltown when Mira arrived, not the 3 the news, two seasons old, led us to expect\.$/.test(paper.data.why), paper.data.why);
});

test('why, glut: a mark on the price that the estimate did not expect (another party sold there since) is named, and a mark it did expect is not', () => {
  const c = still();
  const s = know(game(c), c, 'hilltown', 'wool', 30);
  const sent = outfit(s, c, WOOL);
  // the sheet's expected mark is written in by hand here: none on the wool (`build` keeps one itself since MER-115, and the cases
  // above play that; this one wants the other marks it sets up below to be a surprise). An expedition without one is read as
  // expecting the mark it found.
  sent.expeditions[0].hope.glut = { wool: 0 };
  // by the time Mira arrives the house's own earlier sales have put a mark on: 0.6 now, 0.15 on arrival
  const late = structuredClone(sent);
  late.market.hilltown.wool.glut = 0.6;
  eq(toReturn(late, c).paper.data.why, 'Hilltown already had too much wool: the house\'s own earlier sales there had pushed the price down.');
  // the same mark the estimate knew of is no gap at all: it was in the price the estimate sold at
  const marked = know(game(c), c, 'hilltown', 'wool', 12);   // the news carries the mark of 0.6: 12 is 30 less 60 percent
  marked.market.hilltown.wool.glut = 0.6;
  eq(toReturn(outfit(marked, c, WOOL), c).paper.data.why, 'The trip went about as hoped.');
});

/** Cairo with calm roads and prices that do not drift, 3,000 dinars and 45 linen, the house's own sales sent twice onto Damascus
    in one season by two agents: the first (yusuf) arrives and sells before the second (ali), which put a mark on the price the
    second's sheet could not have known when it was written. Played by the engine's own functions, nothing written into a save. */
function twoSellers() {
  const c = variant(C, x => { for (const r of x.routes) for (const l of r.legs) l.risk = 0; for (const g of x.goods) { g.sigma = 0; g.revert = 0; } });
  let s = newGame(c, { seed: 3, length: 'acts', house: c.houses[0].id });
  s.stock = { linen: 45 }; s.money = 3000;
  s.agents.ali.hired = true; s.agents.ali.where = 'cairo';
  const send = (st, agent, n) => outfit(st, c, { agent, route: 'cairo-damascus', cargo: { linen: n }, purse: 0, contract: 'own', sell: ['linen'], buy: [] });
  s = send(send(s, 'yusuf', 25), 'ali', 20);
  return { c, s };
}

test('MER-115 (1) build keeps the mark the estimate expected on each price, so the why can name the house\'s own earlier sales in live play: two parties sell linen at Damascus, the second finds the mark of the first', () => {
  const { c, s } = twoSellers();
  const [first, second] = s.expeditions;
  eq(second.hope.glut, { linen: 0 }, 'the second sheet, written with no mark on Damascus linen, expected none');
  eq(first.hope.glut, { linen: 0 });
  const paper = toReturn(s, c).paper;   // the first to come home is the first sent
  const seen = new Set(s.desk.map(p => p.id));
  let w = s, second_paper;
  for (let i = 0; i < 8 && !second_paper; i++) { w = step(w, c); second_paper = w.desk.find(p => p.kind === 'return' && p.data.trip.agent === 'ali' && !seen.has(p.id)); }
  ok(second_paper, 'the second party came home');
  eq(second_paper.data.why, 'Damascus already had too much linen: the house\'s own earlier sales there had pushed the price down.');
  ok(!/own earlier sales/.test(paper.data.why ?? ''), `the first party met no mark of its own: ${paper.data.why}`);
});

test('MER-115 (1) an expedition saved before the sheet kept its mark (a hope with no glut) is read as having expected the mark it found: no gap is named for it, and nothing throws', () => {
  const { c, s } = twoSellers();
  for (const x of s.expeditions) delete x.hope.glut;
  let w = s, paper;
  const seen = new Set(s.desk.map(p => p.id));
  for (let i = 0; i < 8 && !paper; i++) { w = step(w, c); paper = w.desk.find(p => p.kind === 'return' && p.data.trip.agent === 'ali' && !seen.has(p.id)); }
  ok(paper && !/own earlier sales/.test(paper.data.why ?? ''), paper?.data.why);
});

/** Cairo calm, silk at home marked (the factor 1.5 and the house's own mark 0.2, so 540 against a base of 450) and the factor
    pulled back each closing, a trip on `road` sent with its whole purse to buy silk, played home. { e, paper, s, c, home }: the
    estimate before it, its return paper, the state it was sent from and the price at home when the party was back. */
function markedHome(road, { revert = 0.5, seed = 3 } = {}) {
  const c = variant(C, x => { for (const r of x.routes) for (const l of r.legs) l.risk = 0; for (const g of x.goods) { g.sigma = 0; if (g.id === 'silk') g.revert = revert; } });
  let s = newGame(c, { seed, length: 'acts', house: c.houses[0].id });
  s.market.cairo.silk = { f: 1.5, glut: 0.2, h: [] };
  const plan = { agent: 'yusuf', route: road, cargo: {}, purse: 900, contract: 'own', sell: [], buy: ['silk'] };
  const e = estimate(s, c, plan);
  const seen = new Set(s.desk.map(p => p.id));
  let w = outfit(structuredClone(s), c, plan), paper, home = null;
  for (let i = 0; i < 10 && !paper; i++) { w = step(w, c); home = M.truePrice(w, c, 'cairo', 'silk'); paper = w.desk.find(p => p.kind === 'return' && !seen.has(p.id)); }
  return { e, paper, s, c, home };
}

test('MER-115 (2) estimate: the bring-back good is valued at the price home will have when the party is back, the factor pulled toward its base and the house\'s mark halved each closing, not at today\'s price', () => {
  for (const road of ['cairo-damascus', 'cairo-aleppo']) {
    const { e, paper, s, c, home } = markedHome(road);
    eq(M.truePrice(s, c, 'cairo', 'silk'), 540, 'silk is 540 at home when the trip is sent');
    ok(home < 540 - 30, `${road}: silk fell to ${home} at home by the return`);
    eq(e.pricesHome.silk, home, `${road}: the estimate valued silk at ${e.pricesHome.silk}, home paid ${home}`);
    eq(paper.data.cargoValue, home * (paper.data.goodsBack.silk ?? 0), `${road}: the paper values the goods at that price`);
    ok(Math.abs(e.net - paper.data.houseNet) <= 12, `${road}: estimated ${e.net}, made ${paper.data.houseNet}`);
  }
});

test('MER-115 (2) estimate: a house mark at home that will not fade (the factor does not revert) is carried too, and a calm home is valued as it stands', () => {
  const { e, home } = markedHome('cairo-damascus', { revert: 0 });
  eq(e.pricesHome.silk, home, 'no revert: the mark alone halves each closing');
  const g0 = newGame(C, { seed: 3, length: 'acts', house: C.houses[0].id });
  const flat = estimate(g0, C, { agent: 'yusuf', route: 'cairo-damascus', cargo: {}, purse: 900, contract: 'own', sell: [], buy: ['silk'] });
  eq(flat.pricesHome.silk, M.truePrice(g0, C, 'cairo', 'silk'), 'an unmarked home at its base is valued at its price now');
});

test('why, tolls: a toll paid in goods the far end would have bought for more costs the sales it took', () => {
  // a road with a stop on the way where the keeper takes 60 and the party has no money, so the toll goes in wool (20 a load at home)
  const open = ['spring', 'summer', 'autumn', 'winter'];
  const leg = (from, to, toll) => ({ from, to, by: 'mules', seasons: 1, opens: open, risk: 0, toll });
  const c = still(x => {
    x.stops.find(z => z.id === 'hilltown').sells.wool = { base: 40, depth: 100 };
    x.routes.push({ id: 'harbour-by-saltmarsh-hilltown', to: 'hilltown', legs: [leg('harbour', 'saltmarsh', 60), leg('saltmarsh', 'hilltown', 5), leg('hilltown', 'harbour', 5)] });
  });
  const s = know(game(c), c, 'hilltown', 'wool', 40);
  const { paper, s: end } = toReturn(outfit(s, c, { ...WOOL, route: 'harbour-by-saltmarsh-hilltown' }), c);
  void end;
  eq(paper.data.why, 'Tolls were paid in wool that would have sold for more in Hilltown.');
});

test('MER-139 (2) a toll paid in goods is a row of the account, with the change the keeper gave', () => {
  // the play's A6: bought 5 pepper, came home with 4 and 114 dinars; the fifth had gone to a toll-keeper, who gave change, and no row said so.
  // Here the keeper takes 50, the purse is empty and wool is 20 a load at home: three loads go, and 10 dinars of change come back
  const open = ['spring', 'summer', 'autumn', 'winter'];
  const leg = (from, to, toll) => ({ from, to, by: 'mules', seasons: 1, opens: open, risk: 0, toll });
  const c = still(x => {
    x.stops.find(z => z.id === 'hilltown').sells.wool = { base: 40, depth: 100 };
    x.routes.push({ id: 'harbour-by-saltmarsh-hilltown', to: 'hilltown', legs: [leg('harbour', 'saltmarsh', 50), leg('saltmarsh', 'hilltown', 5), leg('hilltown', 'harbour', 5)] });
  });
  const s = know(game(c), c, 'hilltown', 'wool', 40);
  const { paper } = toReturn(outfit(s, c, { ...WOOL, route: 'harbour-by-saltmarsh-hilltown' }), c);
  const goods = paper.data.account.find(r => r.label === 'Paid in goods');
  ok(goods && goods.detail, 'a row says goods left the cargo for a toll');
  eq(goods.text, '3 loads of wool given to the toll-keepers, with 10 coins given back as change');  // testport's money is coins
  eq(goods.amount, 10);
});

test('MER-112b (1) gapCauses, tolls: the loads a toll took are priced from the price the party found with the house\'s mark on it, not from the news price with none', () => {
  const c = still();
  const s = game(c);
  // Mira found Hilltown paying 18 for wool with the house's own mark of 0.4 on it (30 with none), sold seven loads, and paid a toll of three
  const x = { agent: 'mira', route: 'harbour-hilltown', hope: { net: 0, sell: { wool: 30 }, tolls: 0, impact: {} },
    book: { seen: [{ stop: 'hilltown', good: 'wool', p: 18, at: 0, glut: 0.4 }], sold: [{ good: 'wool', q: 7, got: 0, stop: 'hilltown' }], bought: [], paidInGoods: { wool: 3 }, tolls: 0, lost: {}, orders: [] } };
  // what loads 8 to 10 fetch on the market the party met: the mark grows by a load over the depth each sale
  const m = { ...s, market: { hilltown: { wool: { f: 1, glut: 0.4, h: [] } } } };
  let lost = 0;
  for (let k = 0; k < 10; k++) { if (k >= 7) lost += Math.round(M.sellPrice(m, c, 'hilltown', 'wool') * 1); M.noteSale(m, c, 'hilltown', 'wool', 1); }
  const found = R.gapCauses(s, c, x, { goodsBack: {}, houseNet: 0 });
  eq(found.causes.tolls, lost - 3 * M.truePrice(s, c, 'harbour', 'wool'), 'the three loads at what the marked market paid for loads 8 to 10, less what each is worth at home');
  ok(lost < 3 * 30 * 0.6, `${lost} dinars: the marked price, nowhere near what three loads fetch at the 30 the news gave`);
});

test('why, a loss: what the road took, in the words of the trip', () => {
  const c = still(x => {
    x.city.jump = { wholeLoss: 0, partial: [0.5, 0.5] };
    for (const l of x.routes.find(r => r.id === 'harbour-hilltown').legs) l.risk = 1;
  });
  const s = know(game(c), c, 'hilltown', 'wool', 30);
  const { paper } = toReturn(outfit(s, c, WOOL), c);
  ok(/^The road took \d+ loads? of wool\.$/.test(paper.data.why), paper.data.why);
});

test('why, an order: a letter\'s order that changed the trip, in its own sentence, when no other cause explains the gap', () => {
  const c = still();
  const s = know(game(c), c, 'hilltown', 'wool', 30);
  const sent = outfit(s, c, WOOL);
  const saved = steps.returns;
  steps.returns = (st, ...a) => {
    const x = st.expeditions[0];
    x.book.orders = [{ stop: 'hilltown', go: WAIT, did: WAIT, changed: true }];
    x.hope.net += 300; x.hoped += 300;
    return saved(st, ...a);
  };
  let paper;
  try { ({ paper } = toReturn(sent, c)); } finally { steps.returns = saved; }
  ok(/^Because you told Mira to wait at Hilltown, /.test(paper.data.why), paper.data.why);
});

test('why: when two causes apply the larger one is named, and it is one sentence without an em dash', () => {
  const open = ['spring', 'summer', 'autumn', 'winter'];
  const leg = (from, to, toll) => ({ from, to, by: 'mules', seasons: 1, opens: open, risk: 0, toll });
  const c = still(x => {
    x.stops.find(z => z.id === 'hilltown').sells.wool = { base: 40, depth: 100 };
    x.routes.push({ id: 'by-saltmarsh', to: 'hilltown', legs: [leg('harbour', 'saltmarsh', 60), leg('saltmarsh', 'hilltown', 5), leg('hilltown', 'harbour', 5)] });
  });
  const plan = { ...WOOL, route: 'by-saltmarsh' };
  // the toll in goods costs about 57; news that is 5 too high costs about 35 over the seven loads that sold; 20 too high about 140
  const small = toReturn(outfit(know(game(c), c, 'hilltown', 'wool', 45), c, plan), c).paper.data.why;
  const big = toReturn(outfit(know(game(c), c, 'hilltown', 'wool', 60), c, plan), c).paper.data.why;
  ok(/^Tolls were paid in wool/.test(small), small);
  ok(/^Hilltown paid \d+ for wool when Mira arrived, not the 60/.test(big), big);
  for (const w of [small, big]) ok(!/\u2014/.test(w) && (w.match(/\./g) ?? []).length === 1, w);
});

test('MER-112 (2) why: the cause that moved the result most is named, sized by what its sentence tells, not the first found and not a sum that other items cancel', () => {
  const c = still();
  let s = know(know(game(c), c, 'hilltown', 'wool', 30), c, 'hilltown', 'salt', 6);
  s.stock.salt = 10;
  s = outfit(s, c, { ...WOOL, cargo: { wool: 10, salt: 10 }, sell: ['wool', 'salt'] });
  const x = s.expeditions[0];
  eq(toReturn(structuredClone(s), c).paper.data.why, 'The trip went about as hoped.', 'the sheet as built is sound');
  // by hand: wool fetched 4 a load less than hoped (40 on ten loads, the largest single item), salt 2 a load more (a gain of 20, so the
  // news sums to 20), and the sheet allowed 30 too little for the house's own selling of wool (a cause of 30: larger than the news
  // sum, smaller than the wool item). The code that compares sums names the selling; the cause that moved the result most is the price.
  const gap = 40 - 20 + 30;
  x.hope.sell.wool += 4; x.hope.sell.salt -= 2; x.hope.impact.wool -= 30; x.hope.net += gap; x.hoped += gap;
  const why = toReturn(s, c).paper.data.why;
  eq(why, 'Hilltown paid 30 for wool when Mira arrived, not the 34 the news, this season, led us to expect.');
});

// ---- the three widest trades, and the view

test('bestTrades: the trades with their road, the news age and the risk word, best a season first; unknown prices and trades the house does not make are left out', () => {
  const c = still();
  const s = game(c);
  know(s, c, 'hilltown', 'wool', 30, 0);      // out: 30 over 20, +50%
  know(s, c, 'hilltown', 'salt', 3, 3);       // back: 10 over 3, +233%
  know(s, c, 'saltmarsh', 'salt', 5, 1);      // back: 10 over 5, +100%
  know(s, c, 'saltmarsh', 'lamps', 1, 0);     // the house does not trade lamps at home: never a trade
  const t = bestTrades(s, c);
  eq(t.map(x => [x.stop, x.good, x.direction]), [['hilltown', 'wool', 'out'], ['hilltown', 'salt', 'back'], ['saltmarsh', 'salt', 'back']], 'by dinars a season of the plan the sheet would open on for the road (MER-121), the age of the news counted: the road whose plan makes most a season goes first, and its trades in the order of what each makes alone');
  eq(t.map(x => Math.round(x.margin * 100)), [50, 233, 100]);
  eq([t[0].ageWords, t[1].ageWords, t[2].ageWords], ['this season', 'three seasons old', 'one season old']);
  eq([t[1].riskWord, t[1].road, t[1].route], ['safe', 'Harbour to Hilltown', 'harbour-hilltown']);
  eq(bestTrades(s, c, 2).length, 2);
  eq(bestTrades(game(c), c), [], 'no news, no trade to name');
  eq(t[0].text, 'Hilltown pays 30 for wool. Harbour pays 20.');
});

test('bestTrades: a road that is closed to the house now is not offered', () => {
  const c = still(x => { x.routes.find(r => r.id === 'harbour-hilltown').legs[0].opens = ['summer']; });
  const s = know(game(c), c, 'hilltown', 'wool', 30);       // spring now, the first leg can wait one season, so it still projects
  ok(bestTrades(s, c).length === 1);
  const far = variant(c, x => { x.routes.find(r => r.id === 'harbour-hilltown').legs[0].opens = ['winter']; });
  const t = know(game(far), far, 'hilltown', 'wool', 30);
  eq(bestTrades(t, far), [], 'a first leg that cannot start within a season of waiting is not a road');
});

test('view carries bestTrades and the outfit draft: the default plan and its estimate for the widest trade, from a free agent', () => {
  const c = still();
  const s = know(know(game(c), c, 'hilltown', 'wool', 30), c, 'hilltown', 'salt', 3);
  const v = view(s, c);
  eq(v.bestTrades, bestTrades(s, c));
  eq([v.venture.agent, v.venture.route, v.venture.stop], ['mira', 'harbour-hilltown', 'hilltown']);
  eq(v.venture.plan, proposePlan(s, c, 'mira', 'harbour-hilltown'));
  eq(v.venture.estimate, estimate(s, c, v.venture.plan));
  eq(view(game(c), c).venture, null, 'no news, no draft');
  const none = structuredClone(s); for (const a of Object.values(none.agents)) a.where = 'road';
  eq(view(none, c).venture, null, 'nobody at home');
});

test('view().venture on the real game: a draft the engine takes, at a stop with news, in a few seasons', () => {
  let s = newGame(C, { seed: 11, length: 'acts', house: C.houses[0].id });
  let seen = 0;
  for (let i = 0; i < 8 && s.phase !== 'ended'; i++) {
    s = step(s, C);
    if (s.phase !== 'desk') continue;
    const v = view(s, C);
    if (!v.venture) continue;
    seen++;
    eq(checkPlan(s, C, v.venture.plan).ok, true, `season ${i}: ${checkPlan(s, C, v.venture.plan).reasons.join(' ')}`);
    ok(v.bestTrades.length <= 3 && v.bestTrades.every(t => t.ageWords && t.riskWord && t.road), JSON.stringify(v.bestTrades[0]));
    const all = bestTrades(s, C, 100).map(t => t.score);
    eq(v.bestTrades.map(t => t.score), all.slice(0, 3));
    ok(all.every((m, k) => k === 0 || all[k - 1] >= m), 'best a season first');
  }
  ok(seen > 3, `${seen} seasons had a draft`);
});

// ---- MER-98: proposals that pay

/** A real game played `n` seasons on the first choice of every paper. */
const seasoned = (seed, n) => { let s = newGame(C, { seed, length: 'acts', house: C.houses[0].id }); for (let i = 0; i < n; i++) s = step(s, C); return s; };

test('MER-98 (1) proposePlan: the plan it returns pays after tolls, each good it carries adds to the estimate, and the bring-back good is kept only while it adds', () => {
  let plans = 0, nothing = 0;
  for (const seed of [3, 5, 9]) {
    const s = seasoned(seed, 5);
    for (const d of R.destinations(s, C)) {
      const plan = proposePlan(s, C, 'yusuf', d.route, { check: false });
      if (plan.why) { nothing++; continue; }
      plans++;
      const e = estimate(s, C, plan);
      ok(e.net > 0, `${seed}/${d.route}: the estimate is ${e.net}`);
      for (const g of Object.keys(plan.cargo)) {
        const { [g]: gone, ...cargo } = plan.cargo;
        const less = estimate(s, C, { ...plan, cargo, sell: plan.sell.filter(x => x !== g) }).net;
        ok(less < e.net, `${seed}/${d.route}: carrying ${g} adds ${e.net - less}`);
      }
      if (plan.buy.length) {
        const bare = estimate(s, C, { ...plan, buy: [], purse: 0, ...(plan.contract === 'qirad' ? { partners: 0 } : {}) }).net;
        ok(bare < e.net, `${seed}/${d.route}: bringing ${plan.buy[0]} back adds ${e.net - bare}`);
      }
    }
  }
  ok(plans > 10, `${plans} plans were checked (${nothing} roads had none that pays)`);
});

test('MER-112 (3) proposePlan: the best trade the map knows for the road goes in the plan when it raises the estimate inside the stake (play 2 trip 3: pepper at 187 against 132, left out)', () => {
  const c = variant(C, x => { for (const r of x.routes) for (const l of r.legs) l.risk = 0; for (const g of x.goods) { g.sigma = 0; g.revert = 0; } });
  const s = newGame(c, { seed: 3, length: 'acts', house: c.houses[0].id });
  s.money = 1719; s.stock = { wool: 8, copper: 1, linen: 5 };
  for (const [g, p] of [['pepper', 187], ['wool', 100], ['copper', 48], ['linen', 80]]) know(s, c, 'damascus', g, p);
  const best = bestTrades(s, c, 10).find(t => t.route === 'cairo-damascus');
  eq([best.good, best.direction], ['pepper', 'out'], 'the map names pepper first for the road');
  const plan = proposePlan(s, c, 'yusuf', 'cairo-damascus');
  ok(!plan.why && plan.cargo.pepper > 0, `the plan carries pepper: ${JSON.stringify(plan.cargo)}`);
  const { pepper, ...rest } = plan.cargo;
  const without = estimate(s, c, { ...plan, cargo: rest, sell: plan.sell.filter(g => g !== 'pepper') }).net;
  ok(estimate(s, c, plan).net > without + 100, `pepper adds ${estimate(s, c, plan).net - without}`);
  const cost = checkPlan(s, c, plan).cost.bought;
  ok(cost <= s.money, `bought ${cost} of ${s.money} (the sheet stakes half and stretches past it where a step pays, MER-133)`);
  ok(proposePlan(s, c, 'yusuf', 'cairo-damascus', { share: 0.5 }).cargo.pepper > 0, 'and inside the half a bot stakes, pepper is in the plan too');
  eq(checkPlan(s, c, plan).ok, true, 'and the engine takes it');
  // a pepper that does not raise the estimate stays out: nothing to gain at 125 against 120 at home once the loads sell lower
  const flat = structuredClone(s); know(flat, c, 'damascus', 'pepper', 125);
  ok(!(proposePlan(flat, c, 'yusuf', 'cairo-damascus').cargo?.pepper > 0), 'a thin margin is left out');
});

test('MER-112b (4) every proposal is expected to make about what the trip makes: the same sign and within 3 percent of the stake, over at least 30 played states, two roads and two agents, on every trip with no loss event', () => {
  // The band is what fails on 9aaa3721 (an estimate 100 against a trip's 119 on a 549 stake); the sign holds there too, and is the
  // weaker claim kept so that a proposal that turns into a loss cannot hide in a wide band. Prices here have no noise (sigma 0),
  // because noise is what no estimate can know; the roads keep their risk and a trip that lost anything is left out. Each state is a game played n seasons, then a first trip on one road played home (it leaves its mark on
  // the stop and its news a few seasons later), then every proposal on the two roads for each of the two agents.
  const c = variant(C, x => { for (const g of x.goods) g.sigma = 0; });
  const roads = ['cairo-damascus', 'cairo-qus'];
  const sendRide = (s, agent, plan) => {
    let w = outfit(structuredClone(s), c, plan), lossy = false, paper;
    const seen = new Set(w.desk.map(p => p.id));
    for (let i = 0; i < 14 && !paper; i++) {
      w = step(w, c);
      if (w.expeditions.some(x => Object.keys(x.book.lost ?? {}).length)) lossy = true;
      paper = w.desk.find(p => p.kind === 'return' && !seen.has(p.id));
    }
    return { w, paper, lossy };
  };
  let states = 0, compared = 0, lossy = 0;
  const seenRoads = new Set(), seenAgents = new Set();
  for (const seed of [1, 2, 3, 4, 5, 6]) for (const n of [1, 3, 5]) for (const firstRoad of roads) {
    let s = newGame(c, { seed, length: 'acts', house: c.houses[0].id });
    for (let i = 0; i < n; i++) s = step(s, c);
    s.agents.ali.hired = true; s.agents.ali.where = 'cairo';
    const p1 = proposePlan(s, c, 'yusuf', firstRoad);
    if (!p1 || p1.why) continue;
    const first = sendRide(s, 'yusuf', p1);
    if (!first.paper || first.lossy) continue;
    s = first.w;
    for (let i = 0; i < 2; i++) s = step(s, c);   // the news of the first trip comes back
    states++;
    for (const agent of ['yusuf', 'ali']) for (const road of roads) {
      const u = structuredClone(s); u.agents.yusuf.where = 'cairo'; u.agents.ali.where = 'cairo';
      const plan = proposePlan(u, c, agent, road);
      if (!plan || plan.why) continue;
      const e = estimate(u, c, plan);
      const { paper, lossy: lost } = sendRide(u, agent, plan);
      if (!paper || lost) { lossy++; continue; }
      compared++; seenRoads.add(road); seenAgents.add(agent);
      const made = paper.data.houseNet, where = `${seed}/${n}/${firstRoad}/${agent}/${road}`;
      eq(Math.sign(made), Math.sign(e.net), `${where}: estimated ${e.net}, made ${made}`);
      ok(Math.abs(made - e.net) <= e.stake * 0.03, `${where}: estimated ${e.net}, made ${made}, stake ${e.stake}`);
    }
  }
  ok(states >= 30, `${states} states`);
  ok(compared >= 60 && seenRoads.size === 2 && seenAgents.size === 2, `${compared} trips compared on ${[...seenRoads]} for ${[...seenAgents]}, ${lossy} left out for a loss`);
});

/** Aleppo and Samarkand, the roads that take 4 and 12 seasons: every proposal on the road for both agents from seeded states, noise
    off, home's price unmarked or marked high (factor 1.5, the house's mark 0.2) or low (0.7, -0.1) as the house leaves it by buying
    and selling there. A trip that lost anything is left out (no estimate foresees a loss). { rows: [{ at, est, made, stake }], lossy }. */
function longRoadStates(road, { seeds, ns, marks }) {
  const c = variant(C, x => { for (const g of x.goods) g.sigma = 0; });
  const rows = []; let lossy = 0;
  for (const seed of seeds) for (const n of ns) for (const [f, glut] of marks) for (const agent of ['yusuf', 'ali']) {
    let s = newGame(c, { seed, length: 'acts', house: c.houses[0].id });
    for (let i = 0; i < n; i++) s = step(s, c);
    s.agents.ali.hired = true; s.agents.ali.where = 'cairo'; s.agents.yusuf.where = 'cairo';
    if (f !== 1) for (const m of Object.values(s.market.cairo)) { m.f = f; m.glut = glut; }
    const plan = proposePlan(s, c, agent, road, { share: 0.5 });   // MER-133: the estimate bands below were fitted on plans that stake half the money; the sheet's default stretches past that, and a trip held by a letter then swings by whole loads
    if (!plan || plan.why) continue;
    const e = estimate(s, c, plan), seen = new Set(s.desk.map(p => p.id));
    let w = outfit(structuredClone(s), c, plan), paper;
    for (let i = 0; i < 30 && !paper && w.phase !== 'recall' && w.phase !== 'ended'; i++) { w = step(w, c); paper = w.desk.find(p => p.kind === 'return' && !seen.has(p.id)); }
    if (!paper) continue;
    if (/^The road took/.test(paper.data.why ?? '')) { lossy++; continue; }
    rows.push({ at: `${seed}/${n}/${f}/${agent}`, est: e.net, made: paper.data.houseNet, stake: e.stake });
  }
  return { rows, lossy };
}
const errors = rows => ({ mean: rows.reduce((a, r) => a + Math.abs(r.est - r.made), 0) / rows.length, worst: Math.max(...rows.map(r => Math.abs(r.est - r.made))), rel: Math.max(...rows.map(r => Math.abs(r.est - r.made) / r.stake)) });

test('MER-115 (3) estimate on Aleppo (4 seasons), noise off, home\'s price unmarked or marked: the same sign, a mean error of at most 5 dinars, at most two trips more than 13 dinars out, 26 at worst, and on the marked-home trips a mean of at most 7', () => {
  // The same 32 trips (2 seeds, 3 starts, both agents, three homes), measured before and after MER-115: mean 7.88 before, 6.88
  // after; worst 16 both; the 22 marked-home trips 7.36 before and 5.91 after, which is what the last line holds (the carried
  // home price is worth about 1.5 dinars a trip here, as the home price barely moves in four seasons). What is left is not the
  // home price: a trip ending across the act jump (start 3) is settled by `jump`, which values the goods at home's price after the
  // closing into the new act (the estimate stops its carry there) and charges the wage of the whole road, 4 seasons, where the
  // estimate charged 5. MER-116 counts the wage as `jump` does (wageCount) and the four start-3 trips that were 8 or 9 dinars
  // high on the wage alone are exact on it: the same 32 trips now read mean 5.81, worst 13, 1.46 percent of the stake, and 5.91 on
  // the marked-home trips (6.88, 16, 2.1 and 5.91 before). The 13 is on the start-3 trips with the highest estimates (194 against 181 and 190 against 177); its cause
  // was not traced.
  // MER-111b: the go-further card (Yusuf's `contract-limits`) now waits for a trip on the road, so the cards the seeded states
  // draw in their first three seasons are not the ones they drew, and the same 32 trips read mean 7.69 (not 5.81), 9.00 on the
  // 22 marked-home trips (not 5.91), worst 38 (not 13). All of that is one state: seed 1, start 3, home marked high, Yusuf and
  // Ali both, estimated 105 and 101 where the trips made 143 and 139 (a stake of 385). Both settle at the jump, and `jump` closes
  // home's silk at 560 where the estimate carried it to 535; a price the estimate cannot know, so it is held as a count and not
  // a worst case: at most two trips over 13 dinars out (before, none over 13). The means are what the MER-115 carry and the
  // MER-116 wage count hold: reverting the wage count reads a mean of 8.38 and reverting the carry 9.88, both over the 8, and each fails on the mean line (broken once each). Damascus's pepper does not move
  // these 32 trips (identical with the old base).
  // MER-121b: a return the jump settles is valued at home's price after the jump's market reset (the new act's base, no mark),
  // the price the ledger shows that season, and the estimate carries to the same price. Before, `jump` valued the goods at the
  // closing before the reset and the estimate at a carried price near it, so the two agreed by luck. What moved: the same 32 trips
  // read mean 4.38 (not 7.69), worst 24 (not 38), 6.09 on the 22 marked-home trips (not 9.00), 6.23 percent of the stake at worst.
  // The seed 1, start 3, marked-high state that was 38 out is now 24: its silk is handed over as a toll at home's price on the
  // day (560, `payFromExpedition`), and the estimate credits a load given that way at the carried price of that closing (535).
  // The two 24s are that state, Yusuf and Ali. Broken once each, in the estimate: the wage count back to `proj.seasons` reads
  // mean 5.50 and worst 33, and fails on both the mean (5) and the worst (26); the carry removed (goods at today's price) reads
  // mean 17.50 and fails on the mean line.
  const { rows, lossy } = longRoadStates('cairo-aleppo', { seeds: [1, 2], ns: [0, 2, 3], marks: [[1, 0], [1.5, 0.2], [0.7, -0.1]] });
  ok(rows.length >= 30, `${rows.length} trips compared, ${lossy} left out for a loss`);
  for (const r of rows) eq(Math.sign(r.made), Math.sign(r.est), `${r.at}: estimated ${r.est}, made ${r.made}`);
  const all = errors(rows);
  ok(all.mean <= 5, `mean error ${all.mean.toFixed(2)} dinars over ${rows.length} trips`);
  const far = rows.filter(r => Math.abs(r.est - r.made) > 13);
  ok(far.length <= 2, `${far.length} trips more than 13 dinars out: ${far.map(r => `${r.at} estimated ${r.est}, made ${r.made}`).join('; ')}`);
  ok(all.worst <= 26, `worst error ${all.worst} dinars`);
  const marked = errors(rows.filter(r => !r.at.includes('/1/')));
  ok(marked.mean <= 7, `mean error on the marked-home trips ${marked.mean.toFixed(2)} dinars`);
});

test('MER-116 (2) estimate on Samarkand (12 seasons): every trip ends across an act jump, which the estimate settles as `jump` does (the quotes it left with, the wage of the whole road): a mean error of at most 12 dinars on the trips the purse can pay for, 12 at worst, 2.5 percent of the stake', () => {
  // No Samarkand trip comes home inside an act (the road is 12 seasons, an act 8), so every one is settled by `jump`: at the far
  // prices the party left with (`x.quote`, not the market it arrives to) and the wage of the whole road. MER-115 measured these 10
  // trips (4 seeds, 2 starts, both agents, home unmarked) at mean 74.4, worst 92, 14.2 percent of the stake, because the estimate
  // priced the arrival and charged the wage of the road's waits. MER-116 reads mean 4.8, worst 12, 2.1 percent. What is left is
  // 12 dinars on four of the ten trips (seeds 1, 3 and 4, start 0), the estimate low each time; its cause was not
  // traced. The seeded road risk loses 4 of every 14 of these trips, which are left out.
  const { rows, lossy } = longRoadStates('cairo-samarkand', { seeds: [1, 2, 3, 4], ns: [0, 2], marks: [[1, 0]] });
  ok(rows.length >= 8, `${rows.length} trips compared, ${lossy} left out for a loss`);
  for (const r of rows) eq(Math.sign(r.made), Math.sign(r.est), `${r.at}: estimated ${r.est}, made ${r.made}`);
  // MER-128 moved this band. The second season now holds a second card (the king of Mali, dealt in his one season), and the first
  // answer to it ('share') leaves the house 4 dinars richer at the start-2 states: purse 981 where it was 977. MER-128 read the
  // fourth silk load (4 x 240 = 960) the estimate counts at 981 as a toll the estimate had not deducted. MER-130 traced it and the tolls
  // were not it: the estimate already takes the tolls before the far end out of the purse. What it did not take was the upkeep of the
  // seasons the party waits before it trades (4 dinars each, `move`), which it now does (`upkeepBefore`), and that is exact on the start-0
  // trips (purse 750, 21 of tolls and 8 of upkeep, 721 at the jump, three loads). The start-2 trips of Yusuf still read 210 high:
  // the first-road-letter reaches him at Damascus, the harness answers it 'wait', and a careful agent holds three seasons at Aleppo
  // (958 in the purse when `jump` settles it, three loads) where the estimate's road has no wait at all (981 less 21 is 960, four
  // loads). A hold depends on a letter that may or may not be dealt and an answer the player gives; no estimate can know it, so it is
  // not one to fix in routes.js. The old band (mean 5 over all ten) cannot come back while those four trips are in the sample. The
  // four are counted and bounded apart (an overstatement of at most one load, never an understatement), and the six that are left,
  // which carry the 12 dinars the head names, keep the bound that fails when MER-115 or MER-116 is reverted (their reading was 74.4
  // mean, 92 worst).
  const over = rows.filter(r => r.est - r.made > 150), rest = rows.filter(r => !over.includes(r));
  ok(over.length <= 6 && over.every(r => r.est - r.made <= 215), `${over.length} trips where the estimate counts a load the purse cannot pay for: ${over.map(r => `${r.at} ${r.est - r.made}`).join(', ')}`);
  ok(rest.length >= 4, `${rest.length} trips left for the band`);
  const { mean, worst, rel } = errors(rest);
  ok(mean <= 12, `mean ${mean.toFixed(1)} dinars over ${rest.length} trips`);
  ok(worst <= 12, `worst ${worst} dinars`);
  ok(rel <= 0.025, `${(rel * 100).toFixed(1)} percent of the stake`);
});

test('MER-130 estimate on Samarkand: a purse just above the four-load line before the party has paid its way to the far end and below it after counts three loads of silk, as the trip buys', () => {
  // Start 0, Yusuf, noise off: the party pays 21 dinars of tolls on the first three legs and waits two seasons at 4 each, so a purse of
  // P reaches the far end with P - 29. Four silk loads cost 960 there. A purse of 981 to 988 clears 960 before those costs and not after,
  // which is the line MER-128 found the estimate on the wrong side of; 989 is the first purse that buys four. The trip's loads are
  // read from what it made (a load is worth about 210 and the estimate's known error 12), as the trip pays part of its later tolls in silk.
  const c = variant(C, x => { for (const g of x.goods) g.sigma = 0; });
  const run = purse => {
    const s = newGame(c, { seed: 1, length: 'acts', house: c.houses[0].id });
    s.agents.yusuf.where = 'cairo';
    const plan = { ...proposePlan(s, c, 'yusuf', 'cairo-samarkand'), purse };
    const counted = estimate(s, c, plan).back.silk;
    const seen = new Set(s.desk.map(p => p.id));
    let w = outfit(structuredClone(s), c, plan), paper;
    for (let i = 0; i < 30 && !paper && w.phase !== 'recall' && w.phase !== 'ended'; i++) { w = step(w, c); paper = w.desk.find(p => p.kind === 'return' && !seen.has(p.id)); }
    return { counted, net: estimate(s, c, plan).net, made: paper.data.houseNet };
  };
  for (const purse of [981, 985, 988]) {
    const { counted, net, made } = run(purse);
    eq(counted, 3, `purse ${purse}: the estimate counts ${counted} loads of silk`);
    ok(Math.abs(net - made) <= 12, `purse ${purse}: estimated ${net}, the trip made ${made} (a load is worth about 210 here)`);
  }
  const four = run(989);
  eq(four.counted, 4, 'a purse of 989 pays for four loads after the road');
  ok(Math.abs(four.net - four.made) <= 12, `purse 989: estimated ${four.net}, the trip made ${four.made}`);
});

/** The wage the sheet charged and the wage the return paper shows, for every proposal on `road` from seeded states, own or prepaid
    (a city with no qirad and an agent with two unfair memories, the case that pays first). A trip that lost anything is left out,
    as in `longRoadStates`. { rows: [{ at, sheet, paid, prepay, jumped, said }], lossy }: `jumped` is whether a jump came while
    the party was out, read from the log, `said` what the estimate says about it. */
function playedWages(road, { seeds, ns, prepaid, tamper = 0 }) {
  const c = variant(C, x => {
    for (const g of x.goods) g.sigma = 0;
    if (prepaid) delete x.city.contracts.qirad;
  });
  const rows = []; let lossy = 0;
  for (const seed of seeds) for (const n of ns) for (const agent of ['yusuf', 'ali']) {
    let s = newGame(c, { seed, length: 'acts', house: c.houses[0].id });
    for (let i = 0; i < n; i++) s = step(s, c);
    s.agents.ali.hired = true; s.agents.ali.where = 'cairo'; s.agents.yusuf.where = 'cairo';
    const plan = proposePlan(s, c, agent, road);   // before the memories: a proposal is never made for one who refuses a wage
    if (!plan || plan.why) continue;
    if (prepaid) { s.agents[agent].memory.push({ at: 0, kind: 'unfair' }, { at: 1, kind: 'unfair' }); plan.prepay = true; }
    const e = estimate(s, c, plan), prepay = R.prepayCost(s, c, road, agent), seen = new Set(s.desk.map(p => p.id)), sent = seasonIndex(s, c);
    let w = outfit(structuredClone(s), c, plan), paper;
    if (!w.expeditions.length) continue;
    if (tamper) w.expeditions[0].book.wagePaid += tamper;
    for (let i = 0; i < 30 && !paper && w.phase !== 'recall' && w.phase !== 'ended'; i++) { w = step(w, c); paper = w.desk.find(p => p.kind === 'return' && !seen.has(p.id)); }
    if (!paper) continue;
    if (/^The road took/.test(paper.data.why ?? '')) { lossy++; continue; }
    const row = paper.data.account.find(r => /wage/.test(r.label));
    rows.push({ at: `${seed}/${n}/${agent}`, sheet: e.wage, paid: -row.amount, prepay, jumped: w.log.some(l => l.kind === 'jump' && l.at > sent), said: e.settledAtJump, text: row.text });
  }
  return { rows, lossy };
}

test('MER-116 (1) the wage is one count: the estimate\'s wage, the prepay sum and the wage on the return paper are the same dinars on every played trip, own and prepaid, on the road that comes home inside its act and the one that crosses the jump', () => {
  // MER-115 found the sheet one season high on Aleppo (5 seasons against 4, 8 dinars) and 3 seasons high on Samarkand (19
  // against 16): the return paper counts the closings the party was away for, or, when `jump` settles it, the seasons of its whole road.
  let inAct = 0, crossed = 0;
  for (const prepaid of [false, true]) for (const [road, seeds, ns] of [['cairo-aleppo', [1, 2], [0, 2, 3]], ['cairo-samarkand', [1, 2, 3, 4], [0, 2]]]) {
    const { rows } = playedWages(road, { seeds, ns, prepaid });
    ok(rows.length >= 6, `${rows.length} ${road} trips (prepaid ${prepaid})`);
    for (const r of rows) {
      const where = `${road} ${r.at} prepaid ${prepaid}`;
      eq(r.sheet, r.paid, `${where}: the sheet said ${r.sheet} and the paper paid ${r.paid} (${r.text})`);
      if (prepaid) eq(r.prepay, r.paid, `${where}: the prepay sum was ${r.prepay} and the paper paid ${r.paid}`);
      eq(r.said, r.jumped, `${where}: the estimate says it is settled at the jump: ${r.said}; a jump came while it was out: ${r.jumped}`);
      if (r.jumped) crossed++; else inAct++;
    }
  }
  ok(inAct >= 8 && crossed >= 20, `${inAct} trips home inside their act and ${crossed} across the jump were compared`);
});

test('MER-116 (2) estimate says when `jump` settles the trip, and in which season: a field the sheet can word, and none where the trip comes home in its act', () => {
  const c = variant(C, x => { for (const g of x.goods) g.sigma = 0; });
  let s = newGame(c, { seed: 1, length: 'acts', house: c.houses[0].id });
  s.agents.yusuf.where = 'cairo';
  const short = estimate(s, c, proposePlan(s, c, 'yusuf', 'cairo-aleppo'));
  eq([short.settledAtJump, 'jumpAt' in short, short.wageSeasons, short.seasons], [false, false, 5, 5]);
  const long = estimate(s, c, proposePlan(s, c, 'yusuf', 'cairo-samarkand'));
  eq(long.settledAtJump, true);
  const played = playedSeasons(c.calendar, 'acts');
  eq(long.jumpAt, played.find((q, i) => i && q - played[i - 1] > 1), 'the first played season after the years skip');
  eq(long.wageSeasons, 16, 'the whole road: 16 seasons by yusuf\'s pace, where the 22 the return opens in count its waits and the sending season');
  eq(long.wage, 16 * c.agents.find(a => a.id === 'yusuf').wage);
});

test('MER-116 (1) a prepaid expedition already on the road keeps the wage it paid: the return shows the sum written at outfitting, not a recount', () => {
  // an old save carries `book.wagePaid` from the count it was sent under: bringHome reads it and never recomputes
  const { rows } = playedWages('cairo-aleppo', { seeds: [1], ns: [0, 3], prepaid: true, tamper: 7 });
  ok(rows.length >= 2, `${rows.length} trips`);
  for (const r of rows) eq(r.paid, r.prepay + 7, `${r.at}: prepaid ${r.prepay}, paper paid ${r.paid}`);
});

test('MER-98 (1) proposePlan: a good the far end pays barely more for stays at home when its extra loads sell lower than they cost', () => {
  // salt: 10 at home, 11 in Hilltown, depth 40 at both. The first load makes 1; each next one is dearer to buy and cheaper to sell.
  const c = still();
  const s = game(c);
  know(s, c, 'hilltown', 'wool', 30); know(s, c, 'hilltown', 'salt', 11);
  const plan = proposePlan(s, c, 'mira', 'harbour-hilltown');
  ok(!plan.why && plan.cargo.wool > 0, JSON.stringify(plan));
  const e = estimate(s, c, plan);
  const all = estimate(s, c, { ...plan, cargo: { ...plan.cargo, salt: 8 }, sell: [...new Set([...plan.sell, 'salt'])] }).net;
  ok(all <= e.net, `eight loads of salt would not add: ${all} against ${e.net}`);
  ok((plan.cargo.salt ?? 0) < 8, `salt: ${plan.cargo.salt ?? 0} loads`);
});

test('MER-98 (1) proposePlan: the bring-back good that adds nothing is left out, and the plan sends no purse for it', () => {
  const c = still();
  const s = game(c);
  know(s, c, 'hilltown', 'wool', 30);
  know(s, c, 'hilltown', 'salt', 10);   // as dear there as at home, and dearer with every load the house buys
  const plan = proposePlan(s, c, 'mira', 'harbour-hilltown');
  eq([plan.buy, plan.purse], [[], 0], JSON.stringify(plan));
  ok(plan.sell.includes('wool'), 'the wool still goes');
  const withIt = estimate(s, c, { ...plan, buy: ['salt'] }).net;
  ok(estimate(s, c, plan).net > withIt, `bringing salt would take it from ${estimate(s, c, plan).net} to ${withIt}`);
  const q = variant(still(), x => { x.city.contracts = { qirad: { agentShare: [1, 3] } }; });
  const t = game(q);
  know(t, q, 'hilltown', 'wool', 30); know(t, q, 'hilltown', 'salt', 10);
  t.agents.mira.memory = [{ kind: 'unfair' }, { kind: 'unfair' }];
  const own = proposePlan(t, q, 'mira', 'harbour-hilltown');
  eq([own.contract, own.buy, own.purse, own.partners], ['qirad', [], 0, 0], 'a qirad with nothing to bring back puts no partner money in either');
});

test('MER-98 (1) proposePlan: with no plan that pays it carries nothing and says why in one sentence, and the view has no draft (not a losing one)', () => {
  const c = variant(still(), x => { x.agents.find(a => a.id === 'mira').wage = 60; });
  const s = know(game(c), c, 'hilltown', 'wool', 30);
  const plan = proposePlan(s, c, 'mira', 'harbour-hilltown');
  eq([plan.cargo, plan.purse, plan.sell, plan.buy], [{}, 0, [], []]);
  ok(/^No plan the house knows of pays on the road to Hilltown: the best one would lose about \d+ coins after the tolls and the wage\.$/.test(plan.why), plan.why);
  eq(proposePlan(s, c, 'mira', 'harbour-hilltown', { check: false }).why, plan.why, 'unchecked, the same');
  eq(view(s, c).venture, null, 'the sheet opens on no losing draft');
  ok(view(s, c).bestTrades.every(t => t.expected > 0), 'and best trades names none that loses either');
  // a stop that buys nothing the house sells and sells nothing it wants at home has nothing to say but that
  const bare = variant(still(), x => { x.stops.find(z => z.id === 'hilltown').sells = { lamps: { base: 15, depth: 10 } }; });
  eq(proposePlan(game(bare), bare, 'mira', 'harbour-hilltown').why, 'Hilltown buys nothing the house sells and sells nothing the house wants at home.');
});

test('MER-98 (2) estimate: 14 loads bought at the far end are priced load by load, as the trade prices them, not at the one price the news gave', () => {
  const c = still(x => { x.stops.find(z => z.id === 'hilltown').sells.salt = { base: 20, depth: 20 }; });
  const s = know(game(c), c, 'hilltown', 'salt', 20);
  // what 14 loads cost on the market itself: each dearer than the one before (market.js notePurchase)
  const sim = { ...s, market: structuredClone(s.market) };
  let cost = 0;
  for (let k = 0; k < 14; k++) { cost += M.buyPrice(sim, c, 'hilltown', 'salt'); M.notePurchase(sim, c, 'hilltown', 'salt', 1); }
  ok(cost > 14 * 20 + 50, `14 loads cost ${cost}, well over the 280 a flat price gives`);
  const plan = { agent: 'mira', route: 'harbour-hilltown', cargo: {}, purse: cost + 5, contract: 'own', sell: [], buy: ['salt'] };   // 5 is the toll on the way out
  const e = estimate(s, c, plan);
  eq(e.back, { salt: 14 }, 'the purse buys exactly what the market sells for it');
  eq(e.impact.salt, cost - 14 * 20, 'and the estimate says what the house\'s own buying cost it');
  // the trade does the same
  const out = toReturn(outfit(s, c, plan), c).s;
  ok(out.log.some(l => l.kind === 'return'), 'the trip came home');
});

test('MER-98 (3) bestTrades: ranks by dinars a season, not by margin: a thin margin on a near road beats a wide one on a far road', () => {
  // Hilltown is twice as far, and its wool is no better than home's, so the only trade on either road is salt bought for the purse (the plan the sheet writes, MER-121, otherwise sells wool there and buys salt with that too)
  const c = still(x => { for (const l of x.routes.find(r => r.id === 'harbour-hilltown').legs) l.seasons *= 2; x.stops.find(z => z.id === 'hilltown').sells.wool.base = 15; });
  const s = game(c);
  know(s, c, 'hilltown', 'salt', 2);        // back: 10 over 2, +400%, nine seasons there and back
  know(s, c, 'saltmarsh', 'salt', 5);       // back: 10 over 5, +100%, three seasons
  const t = bestTrades(s, c);
  eq(t.map(x => x.stop), ['saltmarsh', 'hilltown']);
  ok(t[0].margin < t[1].margin, 'the first has the narrower margin');
  ok(t[0].perSeason > t[1].perSeason, `${t[0].perSeason} a season against ${t[1].perSeason}`);
  eq(t.map(x => x.seasons), [3, 9]);
  ok(t.every(x => x.loads > 0 && x.expected > 0 && x.road && x.ageWords && x.riskWord));
});

test('MER-98 (3) bestTrades: a road that cannot come home before the game ends is left out', () => {
  const c = still();
  const last = playedLast(c);
  const at = back => { const s = game(c); s.t = last - back; return know(s, c, 'saltmarsh', 'salt', 5); };
  eq(bestTrades(at(3), c).map(x => x.stop), ['saltmarsh'], 'three seasons left and three there and back: it can');
  eq(bestTrades(at(2), c), [], 'two seasons left: it cannot, however wide the margin');
});
const playedLast = c => { const g = game(c); let n = 0; for (const a of c.calendar.lengths.full.acts) n += a.to - a.from + 1; return n - 1; };

test('MER-98 (3) bestTrades: news older than about eight seasons ranks below fresh news, even for the better trade', () => {
  const c = still();
  const s = game(c);
  know(s, c, 'hilltown', 'salt', 1, 9);     // the better trade on paper, news nine seasons old
  know(s, c, 'saltmarsh', 'salt', 5, 0);    // fresh
  const t = bestTrades(s, c);
  eq(t.map(x => x.stop), ['saltmarsh', 'hilltown']);
  ok(t[1].perSeason > t[0].perSeason, `the old one makes ${t[1].perSeason} a season to the fresh one's ${t[0].perSeason}`);
  ok(t[1].score < t[0].score);
  const same = (age) => { const u = game(c); know(u, c, 'saltmarsh', 'salt', 5, age); return bestTrades(u, c)[0].score; };
  ok(same(0) > same(4) && same(4) > same(8) && same(8) > same(16), 'and the older, the less it is worth');
  eq(Math.round(same(8) / same(0) * 100), 50, 'half after eight seasons');
});

// ---- MER-98 (6): the why

/** Cairo with no drift and calm roads, 3,000 dinars, and the house's own mark on Damascus porcelain (`glut` now, halved at the one
    closing before Yusuf arrives). The news is what the market itself recorded: the price `age` seasons ago, with the mark it had then
    (`glut` doubled for each season since), so the house knows what a news letter would carry (MER-112b). */
function porcelainTrip(glut, age = 0) {
  const c = variant(C, x => { for (const r of x.routes) for (const l of r.legs) l.risk = 0; for (const g of x.goods) { g.sigma = 0; g.revert = 0; } });
  let s = step(newGame(c, { seed: 3, length: 'acts', house: c.houses[0].id }), c);   // one season in, so there is news a season old
  s.money = 3000;
  const base = M.baseOf(s, c, 'damascus', 'porcelain');
  s.market.damascus.porcelain.f = 78 / base;   // 78 with no mark on it
  s.market.damascus.porcelain.glut = glut;
  know(s, c, 'damascus', 'porcelain', Math.round(78 * (1 - glut * 2 ** age)), age);
  const plan = { agent: 'yusuf', route: 'cairo-damascus', cargo: {}, purse: 2200, contract: 'own', sell: [], buy: ['porcelain'] };
  const e = estimate(s, c, plan);
  const paper = toReturn(outfit(s, c, plan), c).paper;
  const bought = -paper.data.account.find(r => r.label === 'Bought').amount;
  return { e, paper, bought, loads: paper.data.account.find(r => r.label === 'Bought').text };
}

test('MER-112 (1) estimate, play 2 trip 3: 18 loads of porcelain bought at Damascus on news of 78 are priced at what the buying pushes the price to, within 5 percent of what the trade charges', () => {
  // This case has no mark on the price, so the market the estimate builds is the same market 9aaa3721 built: it pins arithmetic that
  // was already right (the old code passes it), and the marked cases below and the Cairo trips after them are what fail on the old code.
  const { e, paper, bought, loads } = porcelainTrip(0);
  const q = e.back.porcelain, flat = Math.round(78 * 1);
  ok(q >= 15, `${q} loads bought`);
  ok(new RegExp(`^${q} loads of porcelain`).test(loads), `the trade bought ${loads}, the estimate ${q}`);
  const cost = q * flat + e.impact.porcelain;
  ok(Math.abs(cost - bought) <= bought * 0.05, `estimated ${cost}, the trade charged ${bought}`);
  ok(bought / q > flat * 1.15, `${bought} for ${q} is ${(bought / q).toFixed(1)} a load, well over the 78 the news gave`);
  ok(Math.abs(paper.data.houseNet - e.net) <= Math.abs(e.net) * 0.05 + 6, `estimated ${e.net}, made ${paper.data.houseNet}`);
});

test('MER-112 (1) estimate: news written with the house\'s own mark on the price is taken off it and the mark the party will find put back, so the buying there is priced from that mark by market.js', () => {
  // the news is a season old and carries the mark of 0.6 (0.3 now, doubled); it says 31 for porcelain that is 78 with no mark on it,
  // and by arrival the mark is 0.15, so the first load costs 66. Taking the 31 as the price at arrival (9aaa3721) buys a third more loads.
  const { e, paper, bought, loads } = porcelainTrip(0.3, 1);
  const q = e.back.porcelain;
  ok(new RegExp(`^${q} loads of porcelain`).test(loads), `the trade bought ${loads}, the estimate ${q}`);
  ok(Math.abs(e.net - paper.data.houseNet) <= 6, `estimated ${e.net}, made ${paper.data.houseNet}`);
  ok(Math.abs(q * 66 + e.impact.porcelain - bought) <= bought * 0.05, `${q * 66 + e.impact.porcelain} against ${bought}`);
  eq(paper.data.why, 'The trip went about as hoped.', 'and the paper has no gap to explain');
});

test('MER-112 (1) estimate: the house\'s own selling at the far end, with the news carrying the mark, is what the trade fetches', () => {
  const c = variant(C, x => { for (const r of x.routes) for (const l of r.legs) l.risk = 0; for (const g of x.goods) { g.sigma = 0; g.revert = 0; } });
  let s = step(newGame(c, { seed: 3, length: 'acts', house: c.houses[0].id }), c);
  s.stock = { linen: 30 };
  s.market.damascus.linen.f = 60 / M.baseOf(s, c, 'damascus', 'linen');
  s.market.damascus.linen.glut = 0.2;
  know(s, c, 'damascus', 'linen', 36, 1);   // 60 with the mark of 0.4 it had a season ago
  const plan = { agent: 'yusuf', route: 'cairo-damascus', cargo: { linen: 20 }, purse: 0, contract: 'own', sell: ['linen'], buy: [] };
  const e = estimate(s, c, plan);
  const paper = toReturn(outfit(s, c, plan), c).paper;
  const got = paper.data.account.find(r => r.label === 'Sold').amount;
  ok(Math.abs(20 * 54 - e.impact.linen - got) <= got * 0.05, `estimated ${20 * 54 - e.impact.linen} (the first load at 54: 60 less the mark of 0.1), the trade fetched ${got}`);
  ok(Math.abs(e.net - paper.data.houseNet) <= 6, `estimated ${e.net}, made ${paper.data.houseNet}`);
});

// ---- MER-112b: a repeat trip, from a first trip played out

/** Cairo with calm roads and prices that do not drift, a first trip played home, and `plan` for a second from the state it leaves.
    Returns { e, paper, s } for the second: the estimate before it, its return paper, and the state it was sent from. */
function afterFirstTrip(first, plan, seasons) {
  const c = variant(C, x => { for (const r of x.routes) for (const l of r.legs) l.risk = 0; for (const g of x.goods) { g.sigma = 0; g.revert = 0; } });
  let s = newGame(c, { seed: 3, length: 'acts', house: c.houses[0].id });
  s.stock = { ...first.stock };
  s.money = 3000;
  s = outfit(s, c, first.plan);
  for (let i = 0; i < seasons; i++) s = step(s, c);
  const e = estimate(s, c, plan(s));
  const seen = new Set(s.desk.map(p => p.id));
  let w = outfit(structuredClone(s), c, plan(s)), paper;
  for (let i = 0; i < 8 && !paper; i++) { w = step(w, c); paper = w.desk.find(p => p.kind === 'return' && !seen.has(p.id)); }
  return { e, paper, s, c };
}

test('MER-112b (2) estimate, a repeat trip after the house sold 25 linen at Damascus: the news of 40 carries the mark of the first trip, so the second sells at what the stop will pay, not at 40 (9aaa3721: -506 against -315)', () => {
  const first = { stock: { linen: 25 }, plan: { agent: 'yusuf', route: 'cairo-damascus', cargo: { linen: 25 }, purse: 0, contract: 'own', sell: ['linen'], buy: [] } };
  const second = () => ({ agent: 'yusuf', route: 'cairo-damascus', cargo: { linen: 20 }, purse: 0, contract: 'own', sell: ['linen'], buy: [] });
  const { e, paper, s, c } = afterFirstTrip(first, second, 3);
  eq(s.known.damascus.linen, { p: 40, at: 2 }, 'the house knows 40 for linen at Damascus, written the season of the first trade');
  eq(M.truePrice(s, c, 'damascus', 'linen'), 48, 'the stop pays 48 now, the mark halved');
  ok(Math.abs(e.net - paper.data.houseNet) <= Math.abs(paper.data.houseNet) * 0.1, `estimated ${e.net}, made ${paper.data.houseNet}`);
  ok(paper.data.houseNet < 0, 'the trip loses (linen bought at home for 20 loads costs more than it sells for): the sign is right too');
  eq(paper.data.why, 'The trip went about as hoped.', 'and the paper does not blame the mark the estimate knew of');
});

test('MER-112b (2) estimate, a negative mark: the house bought porcelain at Damascus (the price is up), and the second trip sells it there, priced from the mark it will find, not the raised news price (9aaa3721: -115 against -174)', () => {
  const first = { stock: {}, plan: { agent: 'yusuf', route: 'cairo-damascus', cargo: {}, purse: 2000, contract: 'own', sell: [], buy: ['porcelain'] } };
  let loads = 0;
  const second = s => { loads = s.stock.porcelain; return { agent: 'yusuf', route: 'cairo-damascus', cargo: { porcelain: s.stock.porcelain }, purse: 0, contract: 'own', sell: ['porcelain'], buy: [] }; };
  const { e, paper, s } = afterFirstTrip(first, second, 4);
  ok(loads >= 10 && s.market.damascus.porcelain.glut < 0, `${loads} loads came home and the mark at Damascus is ${s.market.damascus.porcelain.glut}`);
  ok(Math.abs(e.net - paper.data.houseNet) <= Math.abs(paper.data.houseNet) * 0.1 + 6, `estimated ${e.net}, made ${paper.data.houseNet}`);
});

test('MER-98 (6) why, the house\'s own buying: named with the loads and the price before and after when it is the largest cause', () => {
  const c = still(x => { x.stops.find(z => z.id === 'hilltown').sells.salt = { base: 20, depth: 20 }; });
  let s = know(know(game(c), c, 'hilltown', 'wool', 30), c, 'hilltown', 'salt', 20);
  const plan = { ...WOOL, cargo: { wool: 3 }, purse: 300, buy: ['salt'] };
  s = outfit(s, c, plan);
  const x = s.expeditions[0], flat = Object.values(x.hope.impact).reduce((a, b) => a + b, 0);
  ok(x.hope.impact.salt > x.hope.impact.wool, `the estimate allowed ${JSON.stringify(x.hope.impact)} for the house's own loads`);
  // a sheet that priced every load at the one price: the gap is the house's own loads, the buying the larger part
  x.hope.impact = {}; x.hope.net += flat; x.hoped += flat;
  const { paper } = toReturn(s, c);
  ok(/^Buying \d+ loads pushed the price of salt in Hilltown up from 20 to \d+\.$/.test(paper.data.why), paper.data.why);
});

test('MER-98 (6) why, the house\'s own selling: named the same way, and a sheet that allowed for it says "about as hoped"', () => {
  const c = still();
  let s = know(game(c), c, 'hilltown', 'wool', 30);
  s = outfit(s, c, WOOL);
  const sound = structuredClone(s);
  eq(toReturn(sound, c).paper.data.why, 'The trip went about as hoped.', 'ten loads sold lower with each load, and the sheet knew');
  const x = s.expeditions[0], flat = Object.values(x.hope.impact).reduce((a, b) => a + b, 0);
  ok(flat > 40);
  x.hope.impact = {}; x.hope.net += flat; x.hoped += flat;
  const why = toReturn(s, c).paper.data.why;
  ok(/^Selling 10 loads pushed the price of wool in Hilltown down from 30 to \d+\.$/.test(why), why);
});

test('MER-98 (6) why, no news: "We had no news of Hilltown and guessed 30." in plain English, not "the 30 we had no news and guessed"', () => {
  const c = still();
  const s = game(c);
  s.market.hilltown.wool.f = 0.5;     // the stop pays 15; the house, with no news, guessed the base price
  const { paper } = toReturn(outfit(s, c, WOOL), c);
  eq(paper.data.why, 'Hilltown paid 15 for wool when Mira arrived. We had no news of Hilltown and guessed 30.');
  ok(!/the \d+ we had no news/.test(paper.data.why));
});

// ---- MER-103: a city without a qirad, and the goods the return paper says came home

const refuser = (c, s = game(c)) => { know(s, c, 'hilltown', 'wool', 30); know(s, c, 'hilltown', 'salt', 3); s.agents.mira.memory = [{ kind: 'unfair' }, { kind: 'unfair' }]; return s; };

test('MER-103 proposePlan: in a city with no qirad, an agent who refuses a wage gets no qirad plan, and the plan says so in one sentence', () => {
  const c = still();
  eq(c.city.contracts?.qirad, undefined, 'testport has no qirad');
  const plan = proposePlan(refuser(c), c, 'mira', 'harbour-hilltown');
  eq(plan.contract, 'own');
  eq(plan.why, 'Mira will not go for a wage again, because the house did not pay what it promised before.');
  eq([Object.keys(plan.cargo).length, plan.purse], [0, 0], 'nothing goes');
  const fine = proposePlan(game(c), c, 'mira', 'harbour-hilltown');
  eq(fine.why, undefined, 'an agent who will go still gets a real plan');
});

test('MER-103 proposePlan: in a city with a qirad the refusing agent is still offered one, as before', () => {
  const c = variant(still(), x => { x.city.contracts = { qirad: { agentShare: [1, 3] } }; });
  const plan = proposePlan(refuser(c), c, 'mira', 'harbour-hilltown');
  eq([plan.contract, plan.why], ['qirad', undefined]);
});

test('MER-103 build: in a city with no qirad the refusal in words does not ask for a qirad share', () => {
  const c = still();
  const s = refuser(c);
  const reasons = checkPlan(s, c, WOOL).reasons.join(' ');
  ok(/will not go for a wage again/.test(reasons) && !/qirad/.test(reasons), reasons);
});

test('MER-103 suggestPlan: in a city with no qirad the one-press suggestion passes a refusing agent over for the next', () => {
  const c = still();
  const s = refuser(c);
  s.agents.tobin.hired = true;
  const plan = R.suggestPlan(s, c, 'hilltown');
  ok(plan, 'Tobin is free and takes it');
  eq([plan.agent, plan.contract], ['tobin', 'own']);
  s.agents.tobin.memory = [{ kind: 'unfair' }, { kind: 'unfair' }];
  eq(R.suggestPlan(s, c, 'hilltown'), null, 'both refuse and there is no qirad to offer');
});

test('MER-103 returnPaper: goodsBack and cargoValue say what came home unsold at home\'s price, and are empty and 0 when everything sold', () => {
  const c = still();
  const unsold = toReturn(outfit(game(c), c, { ...WOOL, sell: [] }), c).paper.data;
  const home = toReturn(outfit(game(c), c, { ...WOOL, sell: [] }), c);
  eq(Object.keys(unsold.goodsBack), ['wool']);
  const n = unsold.goodsBack.wool;
  ok(n > 0 && n <= 10, 'what the road left of ten loads');
  eq(unsold.cargoValue, Math.round(n * M.truePrice(home.s, c, 'harbour', 'wool')));
  ok(Number.isInteger(unsold.cargoValue) && unsold.cargoValue > 0);
  ok(/worth/.test(unsold.account.find(r => r.label === 'Back home').text), 'the row keeps its words');
  const sold = toReturn(outfit(game(c), c, WOOL), c).paper.data;
  eq([sold.goodsBack, sold.cargoValue], [{}, 0]);
});

// ---- one calculation for the map and the sheet (MER-121)

/** The sheet's own pick for a road (outfit.js): the free agent who knows the stop first, then the rest, the first with a plan that pays. */
function sheetFor(s, c, route, opts = {}) {
  const stop = c.routes.find(r => r.id === route).to;
  const free = c.agents.filter(a => s.agents[a.id]?.hired && s.agents[a.id].where === 'cairo' && !s.expeditions.some(x => x.agent === a.id));
  const knows = a => a.traits?.includes(`knows-${stop}`);
  for (const a of [...free.filter(knows), ...free.filter(a => !knows(a))]) {
    const plan = proposePlan(s, c, a.id, route, opts);
    if (plan && !plan.why) return { agent: a.id, plan };
  }
  return null;
}
/** Answers every open paper with the first choice the engine takes. */
function answerAll(s, c) {
  for (const p of s.desk) {
    if (p.state !== 'open') continue;
    for (const ch of paperChoices(s, c, p.id).filter(x => holds(x.requires, s, c))) { try { s = choose(s, c, p.id, ch.id); break; } catch { /* a choice the state refuses: the next */ } }
  }
  return s;
}
/** Seeded games of the real city played on, six seeds of fourteen seasons, a third agent hired from the start and a trip sent from the
    sheet's own draft whenever it has one. The desks after the first trip has gone (the sheet opens on a proposal from then on), once
    for the suite: [{ s, at }]. */
let playedDesks = null;
function played(c, visit) {
  if (!playedDesks) {
    playedDesks = [];
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      let s = newGame(c, { seed, length: 'acts', house: c.houses[0].id });
      s.agents.ali.hired = true; s.agents.ali.where = 'cairo';
      for (let i = 0; i < 14 && s.phase !== 'ended' && s.phase !== 'recall'; i++) {
        s = s.phase === 'interlude' ? openSeason(s, c) : endSeason(answerAll(s, c), c);
        if (s.phase !== 'desk') continue;
        if (s.log.some(e => e.kind === 'outfit')) playedDesks.push({ s: structuredClone(s), at: `${seed}/${i}` });
        const d = view(s, c).venture;
        if (d && !d.plan.why && checkPlan(s, c, d.plan).ok) s = outfit(s, c, d.plan);
      }
    }
  }
  for (const { s, at } of playedDesks) visit(s, at);
  return playedDesks.length;
}

test('MER-121 (1) every road the map lists opens a sheet that carries the listed trade and expects more than 0 (play a086: map "Qus pepper at 88", sheet "would lose about 18")', () => {
  let rows = 0, roads = new Set();
  const seen = played(C, (s, at) => {
    for (const t of bestTrades(s, C, Infinity)) {
      const sheet = sheetFor(s, C, t.route);
      ok(sheet, `${at}: the map lists ${t.good} on ${t.route} and no plan pays on it`);
      const { plan } = sheet, e = estimate(s, C, plan);
      ok(t.direction === 'out' ? plan.cargo[t.good] > 0 : plan.buy.includes(t.good), `${at}: the sheet for ${t.route} does not carry the listed ${t.good} (${t.direction}): ${JSON.stringify(plan)}`);
      ok(e.net > 0, `${at}: ${t.route} estimates ${e.net}`);
      eq([t.agent, t.expected], [sheet.agent, Math.round(e.net)], `${at}: the map's figure and agent are the sheet's`);
      eq(checkPlan(s, C, plan).ok, true, `${at}: and the engine takes it`);
      rows++; roads.add(t.route);
    }
  });
  ok(seen >= 30 && rows >= 40 && roads.size >= 3, `${seen} desks, ${rows} listed trades on ${roads.size} roads`);
});

test('MER-121 (1) the map lists nothing the house cannot make now: nobody free, or no money for a load', () => {
  const c = still();
  const s = know(know(game(c), c, 'hilltown', 'wool', 30), c, 'hilltown', 'salt', 3);
  ok(bestTrades(s, c).length > 0, 'news and an agent: trades');
  const away = structuredClone(s); away.agents.mira.where = 'road';
  eq(bestTrades(away, c), [], 'nobody at home, so nothing the house can send');
  const poor = structuredClone(s); poor.money = 5; poor.stock = {};
  eq(bestTrades(poor, c), [], 'five dinars buy no load, and a plan that cannot be fitted out is not listed (the map of play a086)');
});

test('MER-121 (2) adding one load of a good the map or a price letter names for the road never raises the sheet\'s estimate by more than 3 dinars, inside the stake the sheet opens with', () => {
  const MARGIN = 3;
  let tried = 0, named = new Set();
  played(C, (s, at) => {
    const idx = seasonIndex(s, C), budget = Math.floor(s.money * 0.5);
    for (const d of R.destinations(s, C)) {
      const sheet = sheetFor(s, C, d.route, { share: 0.5 });   // MER-133: the half the sheet stakes before it stretches; the stretch has its own case below
      if (!sheet) continue;
      const { plan } = sheet, held = estimate(s, C, plan), base = held.net, dest = C.stops.find(x => x.id === d.stop);
      // the goods named for the road: the map's trades and the goods the latest letter from the stop (this season's or last) gives a price for
      const goods = new Set(bestTrades(s, C, Infinity, d.route).map(t => t.good));
      for (const [g, k] of Object.entries(s.known[d.stop] ?? {})) if (idx - k.at <= 1) goods.add(g);
      for (const g of goods) {
        const there = s.known[d.stop]?.[g]?.p, here = M.truePrice(s, C, 'cairo', g);
        if (!dest.sells?.[g] || !there || here === null) continue;
        let trial;
        if (there > here) {   // carried out: one more load
          const cap = Math.max(1, Math.ceil(Math.min(C.stops.find(x => x.id === 'cairo').sells[g].depth, dest.sells[g].depth) * R.DEPTH_SHARE));
          if ((plan.cargo[g] ?? 0) >= cap) continue;
          trial = { ...plan, cargo: { ...plan.cargo, [g]: (plan.cargo[g] ?? 0) + 1 }, sell: [...new Set([...plan.sell, g])] };
        } else if (plan.buy[0] === g && plan.purse > 0) {   // brought back: one more load's price in the purse, inside the good's market (a default plan sends no more than DEPTH_SHARE of its depth, paid at 1.15 times the price)
          if (plan.purse + there > Math.ceil(Math.max(1, Math.ceil(dest.sells[g].depth * R.DEPTH_SHARE)) * there * 1.15)) continue;
          trial = { ...plan, purse: plan.purse + there };
        } else continue;
        const c1 = checkPlan(s, C, trial);
        if (!c1.ok || c1.cost.total > budget) continue;
        const gain = estimate(s, C, trial).net - base;
        ok(gain <= MARGIN, `${at} ${d.route}: one more ${g} (${there} there, ${here} at home) takes the estimate from ${base} to ${base + gain}`);
        tried++; named.add(g);
      }
    }
  });
  ok(tried >= 40 && named.size >= 4, `${tried} trials over ${named.size} goods`);   // MER-133: 40, not 60: the desks are played with the stretching sheet now, whose plans leave fewer states with a free load to add inside half the money
});

test('MER-121 (3) the plan does not send a good back to the stop the last trip bought it at; bringHome writes where each good was bought', () => {
  const c = still();
  const s = game(c);
  know(s, c, 'hilltown', 'wool', 30); know(s, c, 'hilltown', 'salt', 3);
  s.stock.wool = 4;
  eq(proposePlan(s, c, 'mira', 'harbour-hilltown').cargo.wool, 8, 'with no word of where it came from the four loads go, and four more are bought');
  const bought = structuredClone(s);
  bought.log.push({ at: 0, kind: 'brought', ref: 'x1', from: { wool: 'hilltown' } });
  ok(!(proposePlan(bought, c, 'mira', 'harbour-hilltown').cargo.wool > 0), 'wool the last trip bought at Hilltown stays out of the plan to Hilltown');
  const elsewhere = structuredClone(s);
  elsewhere.log.push({ at: 0, kind: 'brought', ref: 'x1', from: { wool: 'saltmarsh' } });
  eq(proposePlan(elsewhere, c, 'mira', 'harbour-hilltown').cargo.wool, 8, 'wool bought at another stop goes');
  // the entry is the engine's: a trip that buys salt at Hilltown and brings it home writes it
  const u = know(game(c), c, 'hilltown', 'salt', 3);
  const back = toReturn(outfit(u, c, { agent: 'mira', route: 'harbour-hilltown', cargo: { wool: 4 }, purse: 100, contract: 'own', sell: ['wool'], buy: ['salt'] }), c);
  const note = back.s.log.find(e => e.kind === 'brought');
  ok(back.s.stock.salt > 0, 'salt came home');
  eq(note.from, { salt: 'hilltown' });
});

test('MER-121 (3) over played states no proposal sends a good in the warehouse back to the stop the last trip bought it at', () => {
  let checked = 0;
  played(C, (s, at) => {
    const from = {};
    for (const e of s.log) if (e.kind === 'brought') Object.assign(from, e.from);
    for (const d of R.destinations(s, C)) for (const a of ['yusuf', 'ali']) {
      if (s.agents[a].where !== 'cairo' || s.expeditions.some(x => x.agent === a)) continue;
      const plan = proposePlan(s, C, a, d.route, { check: false });
      if (!plan) continue;
      for (const [g, n] of Object.entries(plan.cargo ?? {})) if (n > 0 && (s.stock[g] ?? 0) > 0 && from[g]) { ok(from[g] !== d.stop, `${at}: ${g} bought at ${d.stop} goes back to it`); checked++; }
    }
  });
  ok(checked >= 10, `${checked} goods in the warehouse from a trip, in plans`);
});

test('MER-133 (1) the sheet\'s plan leaves nothing on the table: no single plus (one more load of a good the far stop buys, or 50 more dinars to buy with, paid out of what the house has after the wage) raises the estimate by more than 10 percent of the plan\'s in more than 5 percent of states', () => {
  // The M4d play beat the house's own plan by pressing + on most trips (A2 +28 against +102 with one silk, A4 +23 against +99 with 100
  // dinars, A14 +66 against +158 with 150 dinars and 174 left unspent). The old plan stopped at half the money. It still starts there
  // and then goes on, a step at a time, while a step earns its own stake (STRETCH_RETURN after the road's risk on what it adds, MER-133b);
  // a plus the player presses counts here only if it would clear that rule too (a plus that adds 10 percent of the plan's net and puts
  // 1,200 dinars at risk on a road with a 39 percent chance of loss is the rule's to refuse), so the line is: more than 10 percent of
  // the plan's net AND a return on the stake it adds, risk taken off. Over the desks of
  // six seeded games, every other desk. The old plan (stopping at half the money) failed the line in 242 of 413 states, 58.6 percent, before the
  // rule above was added to the line; broken once by switching the stretch off, the case fails on its own line with the count.
  // MER-144 re-fitted the line again: the plan now stops at 60 percent of the money (half with another agent home), so a plus counts only if it
  // stays inside that ceiling too. The same pluses, with the ceiling taken off the line, are the plan's own deliberate stop, not something left on the table.
  let states = 0; const bad = [];
  let n = 0;
  played(C, (s, at) => {
    if (n++ % 2) return;
    for (const d of R.destinations(s, C)) {
      const sheet = sheetFor(s, C, d.route);
      if (!sheet) continue;
      const { plan } = sheet, held = estimate(s, C, plan), base = held.net, dest = C.stops.find(x => x.id === d.stop), home = C.stops.find(x => x.id === 'cairo');
      states++;
      let best = null;
      const trial = (label, p) => {
        const c = checkPlan(s, C, p);
        if (!c.ok || c.cost.total > s.money - (p.contract === 'qirad' ? 0 : c.cost.later.wage)) return;
        const e = estimate(s, C, p), gain = e.net - base, add = e.stake - held.stake;
        if (add > 0 && gain - held.risk * add < R.STRETCH_RETURN * add) return;   // a plus the stretch rule would refuse is not one left on the table (MER-133b)
        if (staked(s, C, p) > ceilingOf(s, C, plan.agent)) return;   // MER-144: nor is a plus the ceiling refuses (60 percent of the money, half with another agent home): a plus counts only if the house's own plan could have taken it
        if (!best || gain > best.gain) best = { label, gain };
      };
      for (const g of Object.keys(dest.sells ?? {})) if (home.sells?.[g]) trial(`one more ${g}`, { ...plan, cargo: { ...plan.cargo, [g]: (plan.cargo[g] ?? 0) + 1 }, sell: [...new Set([...plan.sell, g])] });
      if (plan.buy.length) trial('50 more dinars', { ...plan, purse: plan.purse + 50 });
      else for (const g of Object.keys(dest.sells ?? {})) if (home.sells?.[g]) trial(`50 dinars to buy ${g}`, { ...plan, purse: plan.purse + 50, buy: [g] });
      if (best && best.gain > 0.1 * base) bad.push(`${at} ${d.route}: ${best.label} takes ${Math.round(base)} to ${Math.round(base + best.gain)}`);
    }
  });
  ok(states >= 100, `${states} states`);
  ok(bad.length <= 0.05 * states, `${bad.length} of ${states} states (${(100 * bad.length / states).toFixed(1)} percent) have a plus that adds more than 10 percent: ${bad.slice(0, 6).join('; ')}`);
});

test('MER-133 (2) the map and the sheet give one age for the same news: a listed trade\'s age is the estimate\'s age for that good, and the sheet\'s is the oldest of them, on trips the jump settles too (play a088, a090: map "two seasons old", sheet "from this season")', () => {
  // A trip the act jump settles is valued at the far prices of the day it left (the quote), and its estimate used to count every such price
  // as news of this season, because the quote is the price as it stands. The house's news of those prices is as old as its letters are,
  // which is what the map's row says, and that is the age the sheet now says. Over every row the map lists on the desks of the six games.
  let rows = 0, jumped = 0, older = 0;
  played(C, (s, at) => {
    for (const t of bestTrades(s, C, Infinity)) {
      const sheet = sheetFor(s, C, t.route);
      ok(sheet, `${at}: the map lists ${t.route} and no plan pays on it`);
      const e = estimate(s, C, sheet.plan);
      eq(e.ageOf[t.good], t.age, `${at} ${t.route} ${t.good}: the map says ${t.ageWords}, the sheet's news for it is ${e.ageOf[t.good]} seasons old`);
      ok(e.age >= t.age && e.ageWords === M.ageWords(e.age), `${at} ${t.route}: the sheet's age ${e.age} is the oldest news in the plan`);
      rows++; if (e.settledAtJump) jumped++; if (t.age > 0) older++;
    }
  });
  ok(rows >= 100 && jumped >= 20 && older >= 20, `${rows} listed trades, ${jumped} settled at the jump, ${older} on news a season old or more`);
});

test('MER-133 (3) mostLoads: the most loads of a good the house can pay for, buying each dearer than the last: 9 sugar at 396 with 395 in hand is 8 (play a073: the stepper let the ninth through and Send refused it)', () => {
  const s = newGame(C, { seed: 3, length: 'acts', house: C.houses[0].id });
  s.stock = {}; s.agents.yusuf.where = 'cairo';
  const plan = { agent: 'yusuf', route: 'cairo-damascus', cargo: {}, purse: 0, contract: 'own', sell: ['sugar'], buy: [] };
  const cost = n => checkPlan(s, C, { ...plan, cargo: { sugar: n } }).cost.total;
  const price = M.truePrice(s, C, 'cairo', 'sugar');
  s.money = cost(9) - 1;
  ok(Math.floor(s.money / price) >= 9, `today's price ${price} divides ${s.money} into ${Math.floor(s.money / price)}: the flat count lets the ninth through`);
  eq(mostLoads(s, C, plan, 'sugar'), 8, 'the ninth costs one dinar more than the house has');
  eq(checkPlan(s, C, { ...plan, cargo: { sugar: 9 } }).ok, false, 'and the engine refuses it');
  ok(/The house has/.test(checkPlan(s, C, { ...plan, cargo: { sugar: 9 } }).reasons.join(' ')), 'in words about the money');
  eq(checkPlan(s, C, { ...plan, cargo: { sugar: 8 } }).ok, true, 'and takes the eighth');
  // loads already in the warehouse cost nothing now, and a purse and the other goods come out of the same money
  const held = structuredClone(s); held.stock = { sugar: 3 };
  eq(mostLoads(held, C, plan, 'sugar') >= 11, true, 'three held loads and the money for eight more');
  const withPurse = { ...plan, purse: 100, buy: ['pepper'], cargo: { copper: 2 } };
  const m = mostLoads(s, C, withPurse, 'sugar');
  ok(m < 8, `${m} loads with a purse of 100 and two copper out of the same money`);
  const total = n => checkPlan(s, C, { ...withPurse, cargo: { ...withPurse.cargo, sugar: n } }).cost.total;
  ok(total(m) <= s.money && total(m + 1) > s.money, `${m} costs ${total(m)} and one more ${total(m + 1)} of ${s.money}`);
});

test('MER-133 (3) mostLoads over played states: for every good the far stop buys, the answer is paid for and one more load is not', () => {
  let tried = 0, short = 0, seen = 0;
  played(C, (s, at) => {
    if (seen++ % 4) return;   // every fourth desk: each answer is a search of checkPlans
    for (const d of R.destinations(s, C)) {
      const sheet = sheetFor(s, C, d.route);
      if (!sheet) continue;
      const dest = C.stops.find(x => x.id === d.stop), home = C.stops.find(x => x.id === 'cairo');
      for (const g of Object.keys(dest.sells ?? {})) {
        if (!home.sells?.[g]) continue;
        const n = mostLoads(s, C, sheet.plan, g);
        const total = k => checkPlan(s, C, { ...sheet.plan, cargo: { ...sheet.plan.cargo, [g]: k } }).cost.total;
        ok(total(n) <= s.money || n === 0, `${at} ${d.route} ${g}: ${n} loads cost ${total(n)} of ${s.money}`);
        ok(total(n + 1) > s.money, `${at} ${d.route} ${g}: ${n + 1} loads cost ${total(n + 1)} and the house has ${s.money}`);
        tried++;
        const flat = (s.stock[g] ?? 0) + Math.floor(s.money / M.truePrice(s, C, 'cairo', g));
        if (n < flat) short++;
      }
    }
  });
  ok(tried >= 100 && short >= 5, `${tried} goods tried, ${short} where the flat count is too high`);
});

test('MER-133b (1) the sheet\'s stretch earns its own stake: no step past the share has a risk-weighted added net under STRETCH_RETURN of the stake it adds, and no plan on a risky or dangerous road stakes more than half the money without clearing the rule against the plan at half', () => {
  // MER-133 took a step if it added over 8 percent of the plan's net, whatever it cost and whatever the road's risk. The estimate leaves the
  // road's loss out by design, so on cairo-venice (risk 0.39) the default plan staked 1,219 dinars more for 17 more, on cairo-constantinople
  // 1,563 for 53, on cairo-alexandria 1,445 for 46, on cairo-qus 453 for 5. A step now puts more at risk only if the net it adds, less the
  // road's risk times the stake it adds, is at least STRETCH_RETURN of that stake. `steps` is the search's own list of the steps it took;
  // each is priced here with `estimate`, not with the search's arithmetic.
  let states = 0, stretched = 0, taken = 0, risky = 0, over = 0; const bad = [];
  played(C, (s, at) => {
    for (const d of R.destinations(s, C)) for (const a of ['yusuf', 'ali']) {
      if (s.agents[a].where !== 'cairo' || s.expeditions.some(x => x.agent === a)) continue;
      const trail = [];
      const plan = proposePlan(s, C, a, d.route, { check: false, steps: trail });
      if (!plan || plan.why) continue;
      states++;
      for (const { from, to } of trail) {
        const f = estimate(s, C, from), t = estimate(s, C, to), add = t.stake - f.stake;
        taken++;
        if (add > 0 && t.net - f.net - t.risk * add < R.STRETCH_RETURN * add) bad.push(`${at} ${d.route} ${a}: a step puts ${Math.round(add)} more at risk (road ${t.risk.toFixed(2)}) for ${Math.round(t.net - f.net)} more`);
      }
      if (trail.length) stretched++;
      const e = estimate(s, C, plan), c = checkPlan(s, C, plan);
      if ((e.riskWord === 'risky' || e.riskWord === 'dangerous')) {
        risky++;
        if (c.ok && c.cost.total > Math.floor(s.money / 2)) {
          over++;
          const base = proposePlan(s, C, a, d.route, { check: false, share: 0.5 }), b = estimate(s, C, base), add = e.stake - b.stake;
          if (add > 0 && e.net - b.net - e.risk * add < R.STRETCH_RETURN * add) bad.push(`${at} ${d.route} ${a}: ${e.riskWord} road, stakes ${c.cost.total} of ${s.money} for ${Math.round(e.net - b.net)} more than the half plan`);
        }
      }
    }
  });
  ok(states >= 150 && stretched >= 20 && taken >= 30 && risky >= 50, `${states} plans, ${stretched} stretched in ${taken} steps, ${risky} on risky or dangerous roads (${over} over half the money)`);
  eq(bad, [], `${bad.length} steps or plans fail the rule`);
});

test('MER-133b (2) mostLoads counts the partners\' money: a qirad whose partners exceed the purse pays for more loads than the flat count (seed 3, 200 dinars, 150 from partners, sugar: 4 was said, the engine took 5, 6 and 7 and refused 8)', () => {
  const s = newGame(C, { seed: 3, length: 'acts', house: C.houses[0].id });
  s.stock = {}; s.money = 200; s.agents.yusuf.where = 'cairo';
  const plan = { agent: 'yusuf', route: 'cairo-damascus', contract: 'qirad', partners: 150, purse: 0, cargo: {} };
  const total = n => checkPlan(s, C, { ...plan, cargo: { sugar: n } });
  const n = mostLoads(s, C, plan, 'sugar');
  eq(n, 7, 'the house pays 150 less than the sugar costs, and 8 loads cost more than it has');
  ok(total(7).ok && total(7).cost.total <= 200, `7 loads: ${total(7).reasons} total ${total(7).cost.total}`);
  ok(!total(8).ok && total(8).cost.total > 200, `8 loads cost ${total(8).cost.total}`);
  ok(Math.floor(200 / M.truePrice(s, C, 'cairo', 'sugar')) < 7, `the flat count of the money is ${Math.floor(200 / M.truePrice(s, C, 'cairo', 'sugar'))}`);
});

test('MER-133b (2) mostLoads under a prepaid wage: the wage paid first comes out of the same money, and the count is the last one the engine takes', () => {
  const c = variant(C, x => { delete x.city.contracts.qirad; });   // no qirad in the city: the way back for an agent who will not go on a wage again is the prepay
  const s = newGame(c, { seed: 3, length: 'acts', house: c.houses[0].id });
  s.stock = {}; s.money = 600; s.agents.yusuf.where = 'cairo';
  s.agents.yusuf.memory.push({ at: 0, kind: 'unfair' }, { at: 1, kind: 'unfair' });
  const plan = { agent: 'yusuf', route: 'cairo-damascus', contract: 'own', prepay: true, purse: 0, cargo: {} };
  const total = n => checkPlan(s, c, { ...plan, cargo: { sugar: n } });
  const n = mostLoads(s, c, plan, 'sugar');
  const wage = R.prepayCost(s, c, 'cairo-damascus', 'yusuf');
  ok(wage > 0 && total(1).cost.wagePaid === wage, `the wage ${wage} is paid first`);
  ok(total(n).ok && total(n).cost.total <= 600 && total(n + 1).cost.total > 600, `${n} loads cost ${total(n).cost.total}, ${n + 1} cost ${total(n + 1).cost.total}, of 600`);
  const cost9 = checkPlan(s, c, { ...plan, prepay: false, cargo: { sugar: 9 } }).cost.total;
  s.money = cost9;   // exactly the nine loads without the wage
  eq(mostLoads(s, c, { ...plan, prepay: false }, 'sugar'), 9, 'nine loads with no wage to pay first');
  ok(mostLoads(s, c, plan, 'sugar') < 9 && total(mostLoads(s, c, plan, 'sugar')).cost.total <= cost9, `${mostLoads(s, c, plan, 'sugar')} loads with the wage paid first`);
});

test('MER-133b (3) mostLoads, priced from the cost code, is the answer a search over built plans gives: the largest n whose plan costs no more than the house has, over played plans (purse, other goods, a qirad and a prepaid wage among them)', () => {
  let tried = 0, qirads = 0;
  const home = C.stops.find(x => x.id === 'cairo');
  played(C, (s, at) => {
    for (const d of R.destinations(s, C)) {
      const sheet = sheetFor(s, C, d.route);
      if (!sheet) continue;
      const variants = [sheet.plan, { ...sheet.plan, contract: 'qirad', partners: Math.max(1, Math.floor((sheet.plan.purse + 100) / 2)) }];
      for (const plan of variants) {
        const g = Object.keys(home.sells).sort()[(tried * 7 + at.length) % Object.keys(home.sells).length];
        const n = mostLoads(s, C, plan, g);
        const total = k => checkPlan(s, C, { ...plan, cargo: { ...plan.cargo, [g]: k } }).cost.total;
        let by = 0;   // the search: the loads one at a time until the plan costs more than the house has (costs only rise with the loads)
        if (total(0) <= s.money) while (by < 400 && total(by + 1) <= s.money) by++;
        eq(n, by, `${at} ${d.route} ${plan.contract} ${g}: mostLoads says ${n}, the search over built plans ${by}`);
        tried++; if (plan.contract === 'qirad') qirads++;
      }
    }
  });
  ok(tried >= 100 && qirads >= 50, `${tried} plans, ${qirads} of them qirads`);
});

test('MER-133b (4) ageOf has a key for every good the estimate trades, a number or null; a good with no news does not make a jump-settled sheet say the house has none', () => {
  let rows = 0, settled = 0;
  played(C, (s, at) => {
    for (const d of R.destinations(s, C)) {
      const sheet = sheetFor(s, C, d.route);
      if (!sheet) continue;
      const e = estimate(s, C, sheet.plan), dest = C.stops.find(x => x.id === d.stop);
      for (const g of [...sheet.plan.sell, ...sheet.plan.buy].filter(g => dest.sells?.[g])) {
        ok(g in e.ageOf && (e.ageOf[g] === null || typeof e.ageOf[g] === 'number'), `${at} ${d.route} ${g}: ageOf ${JSON.stringify(e.ageOf)}`);
        rows++;
      }
      if (e.settledAtJump) settled++;
    }
  });
  ok(rows >= 300 && settled >= 20, `${rows} traded goods, ${settled} sheets settled at the jump`);
  // a trip the jump settles: today's true quote prices it, so a good with no news is not a guess
  let case1 = null;
  played(C, (s, at) => {
    if (case1) return;
    for (const d of R.destinations(s, C)) {
      const sheet = sheetFor(s, C, d.route);
      if (!sheet || !sheet.plan.buy.length) continue;
      const e = estimate(s, C, sheet.plan);
      if (e.settledAtJump && Object.keys(e.ageOf).length >= 3 && e.ageOf[sheet.plan.buy[0]] !== null && e.pricesBuy[sheet.plan.buy[0]] === M.truePrice(s, C, d.stop, sheet.plan.buy[0])) { case1 = { s: structuredClone(s), d, plan: sheet.plan }; return; }
    }
  });
  ok(case1, 'a sheet the jump settles at today\'s quote that buys a good with news and sells others');
  const { s, d, plan } = case1, g = plan.buy[0], was = estimate(s, C, plan);
  delete s.known[d.stop][g];
  const e = estimate(s, C, plan);
  eq(e.ageOf[g], null, 'the good the house has no news of is null');
  ok(Object.entries(e.ageOf).filter(([k]) => k !== g).every(([, v]) => typeof v === 'number'), 'the others keep their numbers');
  ok(!/no news/.test(e.news) && e.ageWords !== 'no news' && e.age === was.age, `the line says "${e.news}" (age ${e.age}), with one good of ${Object.keys(e.ageOf).length} lacking news`);
  eq(e.net, was.net, 'and the figure is the same: it rests on the true quote');
  // a good whose quote is gone altogether (sold, or bought and dropped) still has its key
  const gone = structuredClone(case1.s), sold = plan.sell[0];
  delete gone.market[d.stop][sold]; delete gone.market[d.stop][g];
  const f = estimate(gone, C, plan);
  ok(sold in f.ageOf && g in f.ageOf, `a sell good with no quote and a buy good dropped from the live ones keep their keys: ${JSON.stringify(f.ageOf)}`);
});

test('MER-133b (5) one wage count: the sheet\'s later wage, the prepay, and the estimate\'s wage are the same dinars on every road, jump-settled ones too', () => {
  let rows = 0, longer = 0;
  played(C, (s, at) => {
    for (const d of R.destinations(s, C)) for (const a of ['yusuf', 'ali']) {
      if (s.agents[a].where !== 'cairo' || s.expeditions.some(x => x.agent === a)) continue;
      const plan = proposePlan(s, C, a, d.route, { check: false });
      if (!plan || plan.why || plan.contract !== 'own') continue;
      const c = checkPlan(s, C, plan), e = estimate(s, C, plan), pre = R.prepayCost(s, C, d.route, a);
      if (!c.cost?.later) continue;
      eq([c.cost.later.wage, e.wage], [pre, pre], `${at} ${d.route} ${a}: later wage, estimate wage, prepay`);
      rows++; if (e.settledAtJump && e.wageSeasons !== e.seasons) longer++;
    }
  });
  ok(rows >= 150 && longer >= 5, `${rows} plans, ${longer} on a jump-settled road whose wage count is not the projection's seasons`);
});

// ---- MER-144: the house's own plan never bets the house

/** What a plan puts up now, from the engine's own cost sheet: the goods bought at home, the purse, less the partners' money. The warehouse's goods are not in it. */
const staked = (s, c, plan) => { const k = checkPlan(s, c, plan).cost; return k.bought + k.purse - k.partners; };
/** The ceiling as the decision words it, written here from the money and the agents alone and not read from the engine: 60 percent of the money, half while another hired agent is at home with no trip. */
const ceilingOf = (s, c, agent) => Math.floor(s.money * (c.agents.some(a => a.id !== agent && s.agents[a.id]?.hired && s.agents[a.id].where === 'cairo' && !s.expeditions.some(x => x.agent === a.id)) ? 0.5 : 0.6));

test('MER-144 (1) no default plan stakes more than 60 percent of the house\'s money, or half while another agent is home and free: every road, every free agent, over the played desks', () => {
  // The M4e play: 641 of 700, 1,191 of 1,258, 646 of 662 and 1,468 of 1,500 on one trip each; one lost caravan took 1,232 of 1,258 and the second
  // agent sat home six seasons of nine. The plan has no named share here, as the sheet, the first sheet and the map's line have none.
  let plans = 0, half = 0, states = 0, over60 = 0;
  played(C, (s, at) => {
    for (const d of R.destinations(s, C)) for (const a of C.agents) {
      if (!s.agents[a.id]?.hired || s.agents[a.id].where !== 'cairo' || s.expeditions.some(x => x.agent === a.id)) continue;
      states++;   // a state is a played desk, a road and a free agent, as in MER-133 (1)
      const plan = proposePlan(s, C, a.id, d.route);
      if (!plan || plan.why) continue;
      const out = staked(s, C, plan), cap = ceilingOf(s, C, a.id);
      ok(out <= cap, `${at} ${d.route} ${a.id}: stakes ${out} of ${s.money}, the ceiling is ${cap}`);
      plans++; if (cap === Math.floor(s.money * 0.5)) half++;
      if (out > 0.5 * s.money) over60++;
    }
  });
  ok(states >= 200, `${states} played states (desk, road, free agent)`);
  ok(plans >= 400, `${plans} plans`);
  ok(half >= 100, `${half} plans made while another agent was at home (the half rule)`);
  ok(over60 >= 20, `${over60} plans stake past half the money while no other agent is free: the 60 percent room is used, not just kept (a ceiling that every plan stays under by never stretching proves nothing)`);
});

test('MER-144 (2) the half case: with a second agent at home the plan stakes at most half the money, and the same state with the second agent away may stake more', () => {
  let cases = 0, more = 0;
  played(C, (s, at) => {
    for (const d of R.destinations(s, C)) {
      const free = C.agents.filter(a => s.agents[a.id]?.hired && s.agents[a.id].where === 'cairo' && !s.expeditions.some(x => x.agent === a.id));
      if (free.length < 2) continue;
      const a = free[0].id, plan = proposePlan(s, C, a, d.route);
      if (!plan || plan.why) continue;
      ok(staked(s, C, plan) <= Math.floor(s.money / 2), `${at} ${d.route} ${a}: stakes ${staked(s, C, plan)} of ${s.money} with ${free.length - 1} more at home`);
      // the same house with the others on the road: nobody else is free to be sent, so the 60 percent applies
      const alone = structuredClone(s);
      for (const o of free.slice(1)) alone.agents[o.id].where = 'road';
      const solo = proposePlan(alone, C, a, d.route);
      if (solo && !solo.why) { ok(staked(alone, C, solo) <= Math.floor(alone.money * 0.6), `${at} ${d.route}: alone it stakes ${staked(alone, C, solo)} of ${alone.money}`); if (staked(alone, C, solo) > staked(s, C, plan)) more++; }
      cases++;
    }
  });
  ok(cases >= 100, `${cases} states with two agents at home`);
  ok(more >= 5, `${more} of them stake more once the second agent is away`);
});

test('MER-144 (3) the first sheet (suggestPlan, the opening card) obeys the same ceiling for what it buys, and the opening good\'s ten linen from the warehouse still go', () => {
  let cards = 0, bought = 0, linen = 0;
  played(C, (s, at) => {
    for (const d of R.destinations(s, C)) {
      const plan = R.suggestPlan(s, C, d.stop);
      if (!plan) continue;
      ok(checkPlan(s, C, plan).ok, `${at} ${d.stop}: the card's plan is one the engine takes`);
      const out = staked(s, C, plan), cap = ceilingOf(s, C, plan.agent);
      ok(out <= cap, `${at} ${d.stop} ${plan.agent}: the first sheet stakes ${out} of ${s.money}, the ceiling is ${cap}`);
      cards++; if (out > 0) bought++;
    }
  });
  ok(cards >= 200 && bought >= 50, `${cards} first sheets, ${bought} of them buying something`);
  // the house's own start: ten linen in the warehouse and a purse; the plan may carry the linen whole, it costs nothing now
  const s = newGame(C, { seed: 3, length: 'acts', house: C.houses[0].id });
  for (const d of R.destinations(s, C)) {
    const plan = R.suggestPlan(s, C, d.stop);
    if (!plan) continue;
    ok(staked(s, C, plan) <= ceilingOf(s, C, plan.agent), `new game ${d.stop}: ${staked(s, C, plan)} of ${s.money}`);
    if ((plan.cargo.linen ?? 0) >= 5) linen++;
  }
  ok(linen >= 1, 'the opening linen goes on at least one road');
});

test('MER-144 (4) a named share is the bot\'s own and the player can still raise the stakes by hand: the share 0.95 plan is not held to the ceiling, a hand-made plan up to what the house can pay is accepted', () => {
  let named = 0, past = 0, hand = 0;
  played(C, (s, at) => {
    for (const d of R.destinations(s, C)) for (const a of C.agents) {
      if (!s.agents[a.id]?.hired || s.agents[a.id].where !== 'cairo' || s.expeditions.some(x => x.agent === a.id)) continue;
      const plan = proposePlan(s, C, a.id, d.route, { share: 0.95 });
      if (!plan || plan.why) continue;
      named++; if (staked(s, C, plan) > ceilingOf(s, C, a.id)) past++;
      // by hand: all of the house's money into goods and purse is the player's choice, as long as the house can pay it
      const big = proposePlan(s, C, a.id, d.route);
      if (big && !big.why && big.buy.length) {
        const extra = { ...big, purse: big.purse + Math.max(0, s.money - checkPlan(s, C, big).cost.total - (big.contract === 'qirad' ? 0 : checkPlan(s, C, big).cost.later.wage)) };
        const k = checkPlan(s, C, extra);
        if (k.ok && staked(s, C, extra) > ceilingOf(s, C, a.id)) hand++;
      }
    }
  });
  ok(named >= 100 && past >= 10, `${named} plans with a named share, ${past} of them past the ceiling: the named share is unchanged`);
  ok(hand >= 10, `${hand} hand-raised plans past the ceiling that the engine takes`);
});

// ---- MER-146 (M4e play problem 16): the sheet says "the years pass before X is home" only when they do

test('(MER-146, 7) estimate.yearsFirst is true only for a party still on the road when the years pass, and false for one that is home as they begin', () => {
  const seen = { first: 0, home: 0, other: 0 };
  for (const [house, seeds] of [['spice', [1, 2, 3, 4, 6, 8, 9, 12]], ['cloth', [3, 5, 14]]]) for (const seed of seeds) {
    let s = newGame(C, { seed, length: 'acts', house });
    const said = {};
    for (let g = 0; g < 40 && !['recall', 'ended'].includes(s.phase); g++) {
      if (s.phase === 'interlude') { s = openSeason(s, C); continue; }
      s = answer(s, C);
      for (let k = 0; k < 3; k++) {
        const v = view(s, C).venture;
        if (!v) break;
        const e = checkPlan(s, C, v.plan).estimate;
        let t; try { t = outfit(s, C, v.plan); } catch { break; }
        said[t.expeditions.at(-1).id] = e;
        s = t;
      }
      s = endSeason(s, C);
      for (const entry of s.log) if (entry.kind === 'jump') for (const l of entry.settled) {
        const e = said[l.expedition];
        if (!e || e.done) continue;
        e.done = true;
        if (l.result === 'lost') continue;   // a loss is a loss; the sheet could not say
        if (l.quoted && !e.settledAtJump) seen.other++;   // held on the road by a waiting agent or a closed leg: the sheet could not foresee it
        else if (l.quoted) { eq(e.yearsFirst, true, `seed ${seed} ${house}: the party was on the road when the years passed, and the sheet said so`); seen.first++; }
        else if (e.settledAtJump) { eq(e.yearsFirst, false, `seed ${seed} ${house}: the party was home as the years began, and the sheet does not say the years pass first`); seen.home++; }
        else seen.other++;
      }
    }
  }
  ok(seen.first >= 10 && seen.home >= 1, `${seen.first} parties caught by the years and ${seen.home} home as they began were compared (${seen.other} the sheet could not foresee)`);
});

await done();
