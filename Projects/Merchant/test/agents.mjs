// Agents with memory and what reputation does (ARCHITECTURE 4.11; DESIGN 4.9): node test/agents.mjs, from
// Projects/Merchant/. Plain Node, no browser, no clock. Each case is named for one rule, and each fails
// when that rule alone is taken out of js/engine/agents.js (the break is recorded in the MER-61 report).
// Testport carries it: Mira (careful) and Tobin (bold), the Hilltown road, and a wage of 10 and 8 a season.
import fs from 'node:fs/promises';
import { test, eq, ok, throws, done } from './lib.mjs';
import { loadContent } from '../js/data.js';
import * as R from '../js/engine/routes.js';
import { decide, WAIT } from '../js/engine/letters.js';
import { SCALE, scaleWords, stepOf, UNFAIR, BLAMED } from '../js/engine/agents.js';
import { newGame, openSeason, endSeason, choose, paperChoices, outfit, checkPlan, view } from '../js/engine/index.js';
import { holds } from '../js/engine/conditions.js';

const T = await loadContent('testport', { fs });
const variant = (c, edit) => { const x = structuredClone(c); edit(x); return x; };
const calm = variant(T, x => {
  for (const r of x.routes) for (const l of r.legs) { l.risk = 0; l.toll = 0; }
  x.city.contracts = { qirad: { agentShare: [1, 3] } };
});
const game = (over = {}) => newGame(calm, { seed: 7, length: 'full', house: 'rich', ...over });
const WOOL = { agent: 'mira', route: 'harbour-hilltown', cargo: { wool: 10 }, purse: 0, contract: 'own', sell: [], buy: [] };

const answer = (s, c) => { for (const p of s.desk) if (p.state === 'open') s = choose(s, c, p.id, paperChoices(s, c, p.id).find(ch => holds(ch.requires, s, c)).id); return s; };
const step = (s, c) => (s.phase === 'interlude' ? openSeason(s, c) : endSeason(answer(s, c), c));

/** An expedition for `agent` put at home and finished, with `purse` money to bring back, as the opening finds it. */
function homeWith(contract, { agent = 'mira', purse = 0, money, staked } = {}) {
  let s = outfit(game(), calm, { ...WOOL, agent, contract: contract === 'qirad' ? 'qirad' : 'own', ...(contract === 'qirad' ? { partners: 100, purse: 100 } : { purse: 100 }) });
  const x = s.expeditions[0];
  Object.assign(x, { status: 'home', leg: 2, out: 4, cargo: {}, purse, ...(staked ? { staked } : {}) });
  if (money !== undefined) { s.money = money; s.stock = {}; }
  return s;
}
const back = (s, c = calm) => { const t = structuredClone(s); R.returns(t, c); return t; };

// ---- rule 1: a return moves trust

test('rule 1a a qirad share paid in full is +1 for the agent', () => {
  const s = back(homeWith('qirad', { purse: 500 }));            // 200 in, 500 back: a profit, a share of it paid
  eq(s.agents.mira.trust, 1);
});

test('rule 1a a qirad that made nothing for the agent moves no trust', () => {
  const s = back(homeWith('qirad', { purse: 150 }));            // a loss: the agent has no share, nobody paid short
  eq(s.agents.mira.trust, 0);
});

test('rule 1b an own-contract agent paid short of the wage is -1, remembers it as unfair, and the partners lose faith too', () => {
  const s = homeWith('own', { purse: 0, money: 0 });
  const t = back(s);
  eq(t.agents.mira.trust, -1);
  eq(t.agents.mira.memory.map(m => m.kind), [UNFAIR]);
  eq(t.rep.partners, s.rep.partners - 1, 'rep.partners moves on a short payout, as in M2');
});

test('rule 1b an own-contract agent paid the wage in full moves no trust and leaves no memory', () => {
  const t = back(homeWith('own', { purse: 0 }));
  eq([t.agents.mira.trust, t.agents.mira.memory], [0, []]);
});

test('rule 1c a loss on the road the house blamed on the agent is -1', () => {
  const s = homeWith('own', { purse: 0 });
  s.expeditions[0].book.lost = { wool: 4 };
  s.agents.mira.memory.push({ at: 0, kind: BLAMED });           // a report answered "You should have waited" writes this
  eq(back(s).agents.mira.trust, -1);
});

test('rule 1c a loss nobody blamed, and a blame with no loss, move no trust', () => {
  const lost = homeWith('own', { purse: 0 });
  lost.expeditions[0].book.lost = { wool: 4 };
  eq(back(lost).agents.mira.trust, 0, 'a loss alone');
  const blamed = homeWith('own', { purse: 0 });
  blamed.agents.mira.memory.push({ at: 0, kind: BLAMED });
  eq(back(blamed).agents.mira.trust, 0, 'blame for something that did not happen on this road');
});

// ---- rule 2: an agent at -2 or lower leaves at the next opening

test('rule 2 an agent home with trust -2 leaves at the next opening: gone, not hired, and a notice names them and why', () => {
  let s = game();
  s.agents.tobin.trust = -2;
  s.agents.tobin.memory.push({ at: 0, kind: UNFAIR });
  s = step(s, calm);
  eq([s.agents.tobin.hired, s.agents.tobin.where], [false, 'gone']);
  const n = s.desk.find(p => p.kind === 'notice' && p.ref === 'agent-left');
  ok(n, 'a notice paper is on the desk');
  ok(/^Tobin has gone to work for the \w+ house\. Tobin says the house did not pay what it promised\.$/.test(n.data.headline), n.data.headline);
  eq(n.agent, 'tobin');
  eq(paperChoices(s, calm, n.id), [{ id: 'ok', label: 'Noted' }], 'it is answered with Noted');
  eq(s.agents.mira.hired, true, 'the others stay');
});

test('rule 2 an agent at -1, and an agent at -2 who is out on the road, stay', () => {
  let s = game();
  s.agents.tobin.trust = -1;
  s = step(s, calm);
  eq([s.agents.tobin.hired, s.agents.tobin.where], [true, 'harbour']);
  let r = outfit(game(), calm, WOOL);
  r.agents.mira.trust = -2;
  r = step(r, calm);
  eq([r.agents.mira.hired, r.agents.mira.where], [true, 'road']);
});

// ---- rule 3: an agent at -1 or lower acts as careful

test('rule 3 a bold agent at trust -1 holds the expedition where it stands, as a careful one does; at 0 it goes on', () => {
  const asked = { kind: 'question', leg: 0, def: null };
  const ask = trust => { const s = outfit(game(), calm, { ...WOOL, agent: 'tobin' }); s.agents.tobin.trust = trust; const x = s.expeditions[0]; x.post = [{ ...asked }]; return decide(s, calm, x, 0, 3); };
  eq(ask(-1), WAIT);
  eq(ask(-3), WAIT);
  eq(ask(0), null);
  eq(ask(2), null);
});

// ---- rule 4: two unfair memories, a share and no wage

test('rule 4 an agent with two unfair memories refuses an own contract in words and asks for a qirad share', () => {
  const s = game();
  s.agents.mira.memory.push({ at: 0, kind: UNFAIR });
  eq(checkPlan(s, calm, WOOL).ok, true, 'one is not enough');
  s.agents.mira.memory.push({ at: 1, kind: UNFAIR });
  const own = checkPlan(s, calm, WOOL);
  eq(own.ok, false);
  eq(own.reasons, ['Mira will not go for a wage again, because the house did not pay what it promised before. Mira asks for a qirad share.']);
  throws(() => outfit(s, calm, WOOL), /Mira will not go for a wage again/);
  eq(checkPlan(s, calm, { ...WOOL, contract: 'qirad', partners: 100, purse: 100 }).ok, true, 'a qirad share is what they ask for');
});

// ---- rule 5: reputation with agents follows the season's trust

test('rule 5 rep.agents moves by the season\'s trust changes, one step at most', () => {
  const after = edit => { let s = game(); edit(s); return step(s, calm).rep.agents; };
  eq(after(() => {}), 0, 'nothing changed');
  eq(after(s => { s.agents.mira.trust = 1; }), 1, 'one up');
  eq(after(s => { s.agents.mira.trust = 3; s.agents.tobin.trust = 2; }), 1, 'five up is still one step');
  eq(after(s => { s.agents.mira.trust = -1; }), -1, 'one down');
  eq(after(s => { s.agents.mira.trust = -2; s.agents.tobin.trust = -2; }), -1, 'four down is still one step');
  eq(after(s => { s.agents.mira.trust = 2; s.agents.tobin.trust = -2; }), 0, 'the changes add: up two, down two');
});

test('rule 5 the change is counted once, and the season after it is a new count', () => {
  const quiet = variant(calm, x => { for (const c of x.cards) c.weight = 0; x.city.opening = {}; });     // no card moves anyone's trust in the second season
  let s = newGame(quiet, { seed: 7, length: 'full', house: 'rich' });
  s.agents.mira.trust = 1;
  s = step(s, quiet);
  eq(s.rep.agents, 1);
  s = step(s, quiet);
  eq(s.rep.agents, 1, 'no change in the second season, so no second step');
});

// ---- rule 6: one table of words for trust and reputation

test('rule 6 view() gives each agent\'s trust and each group\'s standing as words from the one table', () => {
  const s = game();
  s.agents.mira.trust = -3; s.agents.tobin.trust = 3;
  s.rep = { partners: -3, agents: -1, court: 0, foreign: 3 };
  const v = view(s, calm);
  eq(v.trust.mira, { n: -3, step: 0, words: SCALE.agent[0] });
  eq(v.trust.tobin, { n: 3, step: 4, words: SCALE.agent[4] });
  eq(v.rep.partners, { n: -3, step: 0, words: 'They will not deal with you' });
  eq(v.rep.agents.words, SCALE.group[1]);
  eq(v.rep.court.words, SCALE.group[2]);
  eq(v.rep.foreign.words, 'They come to you first');
});

test('rule 6 seven numbers fall in five steps, each step is reached, and no two steps share words', () => {
  eq([-3, -2, -1, 0, 1, 2, 3].map(stepOf), [0, 1, 1, 2, 3, 3, 4]);
  eq(new Set(SCALE.group).size, 5);
  eq(new Set(SCALE.agent).size, 5);
  eq(scaleWords(0, 'agent'), SCALE.agent[2]);
});

await done();
