// A venture, its estimate and its answer (DESIGN 2.2 rules 1 and 2, MER-92): node test/venture.mjs, from Projects/Merchant/.
// Plain Node, no browser, no clock. Testport carries the arithmetic (its prices do not drift: sigma 0), cairo carries the real
// roads and the real game.
import fs from 'node:fs/promises';
import { test, eq, ok, done } from './lib.mjs';
import { loadContent } from '../js/data.js';
import * as R from '../js/engine/routes.js';
/** Runs `fn` with the rule that refuses unspent money switched on (it ships off, routes.js RULES), and puts it back. */
const ruled = fn => () => { R.RULES.refuseUnspentMoney = true; try { return fn(); } finally { R.RULES.refuseUnspentMoney = false; } };
import { steps } from '../js/engine/turn.js';
import { WAIT } from '../js/engine/letters.js';
import * as M from '../js/engine/market.js';
import { seasonIndex } from '../js/engine/calendar.js';
import { newGame, openSeason, endSeason, choose, paperChoices, outfit, checkPlan, proposePlan, estimate, bestTrades, view } from '../js/engine/index.js';
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
  edit(x);
});
const game = (c, over = {}) => newGame(c, { seed: 7, length: 'full', house: 'plain', ...over });
const know = (s, c, stop, good, p, age = 0) => { (s.known[stop] ??= {})[good] = { p, at: seasonIndex(s, c) - age }; return s; };

function answer(s, c) {
  for (const p of s.desk) {
    if (p.state !== 'open') continue;
    const ch = paperChoices(s, c, p.id).find(x => holds(x.requires, s, c));
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

test('proposePlan: the bring-back good is the widest margin the house has news of, not one the plan sends out, and a stop with no news is guessed at its base price', () => {
  const c = still();
  const s = game(c);
  know(s, c, 'hilltown', 'wool', 30);
  know(s, c, 'hilltown', 'salt', 8);
  eq(proposePlan(s, c, 'mira', 'harbour-hilltown').buy, ['salt'], 'the only one cheaper there');
  const none = game(c);
  const guess = proposePlan(none, c, 'mira', 'harbour-hilltown');
  ok(guess && guess.buy.length === 1, `with no news the stop's base prices guide the default: ${JSON.stringify(guess)}`);
  eq(estimate(none, c, guess).ageWords, 'no news', 'and the estimate says it is a guess');
});

test('proposePlan: where the stop buys nothing the house can send, the trip goes as money, about half of it, to buy the good to bring back', () => {
  const c = still();
  const s = game(c);
  know(s, c, 'saltmarsh', 'salt', 5);
  s.stock = {};
  const plan = proposePlan(s, c, 'mira', 'harbour-saltmarsh');
  eq([plan.cargo, plan.buy, plan.sell], [{}, ['salt'], []]);
  ok(plan.purse > 0 && plan.purse <= s.money / 2, `${plan.purse} of ${s.money}`);
  eq(checkPlan(s, c, plan).ok, true);
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

test('the rule ships off: money sent with no good to bring back goes through until test/letters.mjs names one (routes.js RULES)', () => {
  const c = variant(C, x => { for (const r of x.routes) for (const l of r.legs) l.risk = 0; });
  const s = newGame(c, { seed: 3, length: 'acts', house: c.houses[0].id });
  s.stock = { linen: 20 };
  eq(R.RULES.refuseUnspentMoney, false);
  eq(checkPlan(s, c, { agent: 'yusuf', route: 'cairo-damascus', cargo: { linen: 5 }, purse: 100, contract: 'own', sell: ['linen'], buy: [] }).ok, true);
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
  ok(e.upkeep % R.UPKEEP === 0, `${e.upkeep}`);
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
  const s = know(know(game(c), c, 'hilltown', 'wool', 30), c, 'hilltown', 'salt', 2, 2);   // the news says salt is 2; it is 6
  const { paper } = toReturn(outfit(s, c, { ...WOOL, buy: ['salt'] }), c);
  ok(/^Salt cost 6 in Hilltown when Mira arrived, not the 2 the news, two seasons old, led us to expect\.$/.test(paper.data.why), paper.data.why);
});

test('why, glut: the house\'s own earlier sales at the stop had marked the price', () => {
  const c = still();
  const s = know(game(c), c, 'hilltown', 'wool', 30);
  s.market.hilltown.wool.glut = 0.6;     // halves at each closing: 0.15 when the party arrives
  const { paper } = toReturn(outfit(s, c, WOOL), c);
  eq(paper.data.why, 'Hilltown already had too much wool: the house\'s own earlier sales there had pushed the price down.');
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

// ---- the three widest trades, and the view

test('bestTrades: the three widest known margins, widest first, with the road, the news age and the risk word; unknown prices are left out', () => {
  const c = still();
  const s = game(c);
  know(s, c, 'hilltown', 'wool', 30, 0);      // out: 30 over 20, +50%
  know(s, c, 'hilltown', 'salt', 3, 3);       // back: 10 over 3, +233%
  know(s, c, 'saltmarsh', 'salt', 5, 1);      // back: 10 over 5, +100%
  know(s, c, 'saltmarsh', 'lamps', 1, 0);     // the house does not trade lamps at home: never a trade
  const t = bestTrades(s, c);
  eq(t.map(x => [x.stop, x.good, x.direction]), [['hilltown', 'salt', 'back'], ['saltmarsh', 'salt', 'back'], ['hilltown', 'wool', 'out']]);
  eq(t.map(x => Math.round(x.margin * 100)), [233, 100, 50]);
  eq([t[0].ageWords, t[1].ageWords, t[2].ageWords], ['three seasons old', 'one season old', 'this season']);
  eq([t[0].riskWord, t[0].road, t[0].route], ['safe', 'Harbour to Hilltown', 'harbour-hilltown']);
  eq(bestTrades(s, c, 2).length, 2);
  eq(bestTrades(game(c), c), [], 'no news, no trade to name');
  eq(t[2].text, 'Hilltown pays 30 for wool. Harbour pays 20.');
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
    const all = bestTrades(s, C, 100).map(t => t.margin);
    eq(v.bestTrades.map(t => t.margin), all.slice(0, 3));
    ok(all.every((m, k) => k === 0 || all[k - 1] >= m), 'widest first');
  }
  ok(seen > 3, `${seen} seasons had a draft`);
});

await done();
