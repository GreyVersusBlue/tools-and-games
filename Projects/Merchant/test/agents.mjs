// Agents with memory and what reputation does (ARCHITECTURE 4.11; DESIGN 4.9): node test/agents.mjs, from
// Projects/Merchant/. Plain Node, no browser, no clock. Each case is named for one rule, and each fails
// when that rule alone is taken out of js/engine/agents.js (the break is recorded in the MER-61 report).
// Testport carries it: Mira (careful) and Tobin (bold), the Hilltown road, and a wage of 10 and 8 a season.
import fs from 'node:fs/promises';
import { test, eq, ok, throws, done } from './lib.mjs';
import { loadContent } from '../js/data.js';
import * as R from '../js/engine/routes.js';
import { decide, WAIT, ON } from '../js/engine/letters.js';
import { SCALE, scaleWords, stepOf, leftHow, UNFAIR, BLAMED } from '../js/engine/agents.js';
import { apply } from '../js/engine/effects.js';
import { newGame, openSeason, endSeason, choose, paperChoices, outfit, suggestPlan, checkPlan, view } from '../js/engine/index.js';
import { holds } from '../js/engine/conditions.js';
import { seasonIndex } from '../js/engine/calendar.js';

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
  const ask = trust => { const s = outfit(game(), calm, { ...WOOL, agent: 'tobin' }); s.agents.tobin.trust = trust; const x = s.expeditions[0]; s.post.push({ id: 'rain-on-the-pass', kind: 'question', expedition: x.id }); return decide(s, calm, x, 3); };
  eq(ask(-1), WAIT);
  eq(ask(-3), WAIT);
  eq(ask(0), ON);
  eq(ask(2), ON);
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

// ---- rule 5: reputation with agents follows the season's net trust change among hired agents

test('rule 5 rep.agents moves one step only when the net change is 2 or more either way', () => {
  const after = edit => { let s = game(); edit(s); return step(s, calm).rep.agents; };
  eq(after(() => {}), 0, 'nothing changed');
  eq(after(s => { s.agents.mira.trust = 1; }), 0, 'one up is not enough');
  eq(after(s => { s.agents.mira.trust = -1; }), 0, 'one down is not enough');
  eq(after(s => { s.agents.mira.trust = 2; }), 1, 'two up');
  eq(after(s => { s.agents.mira.trust = 3; s.agents.tobin.trust = 2; }), 1, 'five up is still one step');
  eq(after(s => { s.agents.mira.trust = -1; s.agents.tobin.trust = -1; }), -1, 'two down, from two agents');
  eq(after(s => { s.agents.mira.trust = 2; s.agents.tobin.trust = -2; }), 0, 'the changes add: up two, down two');
});

test('rule 5 the change is counted once, and the season after it is a new count', () => {
  const quiet = variant(calm, x => { for (const c of x.cards) c.weight = 0; x.city.opening = {}; });     // no card moves anyone's trust in the second season
  let s = newGame(quiet, { seed: 7, length: 'full', house: 'rich' });
  s.agents.mira.trust = 2;
  s = step(s, quiet);
  eq(s.rep.agents, 1);
  s = step(s, quiet);
  eq(s.rep.agents, 1, 'no change in the second season, so no second step');
});

test('rule 5 only hired agents count: one who is not hired moves nothing', () => {
  let s = game();
  s.agents.tobin.hired = false;
  s.agents.tobin.trust = 3;
  s.agents.mira.trust = 1;
  eq(step(s, calm).rep.agents, 0, 'tobin\'s +3 is not the house\'s to count, and mira\'s +1 is too little');
});

test('rule 5 a card\'s direct rep.agents step is not counted again for the trust change beside it', () => {
  let s = game();
  s.agents.mira.trust = 2;
  s.rep.agents = 1;                                              // what a card that moves both does
  eq(step(s, calm).rep.agents, 1, 'one step, not two');
  let o = game();
  o.agents.mira.trust = 2;
  o.rep.agents = -1;                                             // a direct step the other way does not cancel the net change
  eq(step(o, calm).rep.agents, 0, 'down one by hand, up one by trust');
});

test('rule 5 a trust change in the season before an act jump, and in the last season, counts', () => {
  const quiet = variant(calm, x => { for (const c of x.cards) c.weight = 0; x.city.opening = {}; });
  let s = newGame(quiet, { seed: 7, length: 'acts', house: 'rich' });
  let jumped = false;
  for (let i = 0; i < 40 && !jumped; i++) {
    const at = seasonIndex(s, quiet);
    const plain = step(s, quiet);
    if (plain.phase === 'recall' || seasonIndex(plain, quiet) - at === 1) { s = plain; continue; }
    jumped = true;
    eq(plain.rep.agents, 0, 'nothing moved without a change');
    s.agents.mira.trust += 2;                                    // up two in the season before the jump
    eq(step(s, quiet).rep.agents, 1, 'the season before the jump moved it');
  }
  ok(jumped, 'the testport acts game has a jump');
  let l = newGame(quiet, { seed: 7, length: 'acts', house: 'rich' });
  while (!view(l, quiet).last) l = step(l, quiet);
  for (const a of Object.values(l.agents)) Object.assign(a, { hired: true, where: 'harbour' });   // the quiet game's agents retire at the jump
  const held = l.rep.agents;
  l.agents.mira.trust = -1; l.agents.tobin.trust = -1;
  l = step(l, quiet);
  eq([l.phase, l.rep.agents], ['recall', held - 1], 'the last season\'s change reaches rep.agents before the ending');
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

// ---- rule 2 again: an agent at -2 or lower takes no new trip

test('rule 2 an agent who comes home at -2 refuses every new trip in words, so the house cannot keep them out to dodge the leaving', () => {
  let s = homeWith('own', { purse: 0, money: 0 });
  s.agents.mira.trust = -1;                                       // the short wage on this return takes it to -2
  s = step(s, calm);
  eq([s.agents.mira.trust, s.agents.mira.hired, s.agents.mira.where], [-2, true, 'harbour'], 'home for this desk and still hired');
  s.money = 1000; s.stock = { wool: 20 };
  const own = checkPlan(s, calm, WOOL);
  eq(own.reasons, ['Mira has lost faith in the house and will not go out again.']);
  eq(checkPlan(s, calm, { ...WOOL, contract: 'qirad', partners: 100, purse: 100 }).reasons, own.reasons, 'a qirad does not change it');
  throws(() => outfit(s, calm, WOOL), /Mira has lost faith in the house/);
  eq(checkPlan(s, calm, { ...WOOL, agent: 'tobin' }).ok, true, 'the others go');
  eq(suggestPlan(s, calm, 'hilltown').agent, 'tobin', 'suggestPlan passes them over');
  s.agents.tobin.hired = false;
  eq(suggestPlan(s, calm, 'hilltown'), null, 'and offers nothing when they are the only one free');
  s.agents.tobin.hired = true;
  eq(step(s, calm).agents.mira.where, 'gone', 'and at the next opening they leave');
});

// ---- rule 4 again: no qirad in the city

const noQirad = variant(calm, x => { x.city.contracts = {}; });

test('rule 4 in a city with no qirad the refusal does not offer one', () => {
  const s = newGame(noQirad, { seed: 7, length: 'full', house: 'rich' });
  s.agents.mira.memory.push({ at: 0, kind: UNFAIR }, { at: 1, kind: UNFAIR });
  eq(checkPlan(s, noQirad, WOOL).reasons, ['Mira will not go for a wage again, because the house did not pay what it promised before.']);
});

test('rule 4 suggestPlan tries the next free agent when the first refuses', () => {
  const s = newGame(noQirad, { seed: 7, length: 'full', house: 'rich' });
  s.agents.mira.memory.push({ at: 0, kind: UNFAIR }, { at: 1, kind: UNFAIR });
  s.agents.mira.traits = undefined;
  const plan = suggestPlan(s, noQirad, 'hilltown');
  ok(plan, 'a plan is made');
  eq(plan.agent, 'tobin');
  eq(checkPlan(s, noQirad, plan).ok, true);
});

// ---- the leave notice survives the played season, and gone agents stay gone

test('hire of an agent who has gone is refused with a reason', () => {
  let s = game();
  s.agents.tobin.trust = -2;
  s = step(s, calm);
  eq(s.agents.tobin.where, 'gone');
  throws(() => apply(s, calm, { hire: 'tobin' }), /Tobin has gone to work for another house/);
  eq(s.agents.tobin.hired, false);
});

test('a queued trust or memory effect naming an agent who has gone is dropped and logged, whole', () => {
  let s = game();
  s.agents.tobin.trust = -2;
  s.agents.tobin.hired = false; s.agents.tobin.where = 'gone';     // gone at an earlier opening
  const idx = seasonIndex(s, calm);
  s.queue.push({ at: idx, from: 'test/later', do: [{ money: 5 }, { trust: 'tobin', by: 1 }, { memory: 'tobin', kind: 'blamed' }] });
  s = step(s, calm);
  eq(s.agents.tobin.trust, -2, 'no trust moved');
  eq(s.agents.tobin.memory, [], 'no memory written');
  const d = s.log.find(e => e.kind === 'dropped' && e.ref === 'test/later');
  ok(d && /Tobin has left the house/.test(d.reason), 'logged with the reason');
  eq(s.queue.some(q => q.from === 'test/later'), false, 'and it does not fire again');
});

// ---- MER-61c: gone agents and follow-up cards, played through endSeason

// A game with every drawn card off, so only the cards a test puts in play appear. `extra` cards are added to the book.
const only = extra => variant(calm, x => { for (const c of x.cards) c.weight = 0; x.city.opening = {}; x.cards.push(...extra); });
const FOLLOW = { id: 'follow-mira', group: 'followups', title: 'Mira writes', text: 'A note.', choices: [{ id: 'more', label: 'More', now: [{ trust: 'mira', by: 1 }] }, { id: 'less', label: 'Less', now: [] }] };
const FOLLOW_ME = { id: 'follow-me', group: 'followups', title: 'A note', text: 'A note.', choices: [{ id: 'more', label: 'More', now: [{ trust: '$agent', by: 1 }] }] };
const FOLLOW_WHEN = { id: 'follow-when', group: 'followups', title: 'Ask', text: 'A note.', when: { agent: 'mira', hired: true }, choices: [{ id: 'ok', label: 'Fine', now: [] }] };
const queued = (s, c, item) => { s.queue.push({ at: seasonIndex(s, c), from: 'test/queued', ...item }); return step(s, c); };
const goneMira = s => { s.agents.mira.hired = false; s.agents.mira.where = 'gone'; return s; };

test('gone 1a a queued follow-up whose choice names an agent who is gone is dropped and logged, not drawn', () => {
  const c = only([FOLLOW]);
  const s = queued(goneMira(newGame(c, { seed: 7, length: 'full', house: 'rich' })), c, { card: 'follow-mira' });
  eq(s.desk.some(p => p.ref === 'follow-mira'), false, 'not on the desk');
  const d = s.log.find(e => e.kind === 'dropped' && e.ref === 'test/queued');
  ok(d && /Mira has left the house/.test(d.reason), 'logged, with the reason');
  eq(s.queue.some(q => q.from === 'test/queued'), false, 'and gone from the queue');
  eq(s.agents.mira.trust, 0, 'nothing moved');
});

test('gone 1b the same follow-up is drawn when the agent is here (the case above is not an empty one)', () => {
  const c = only([FOLLOW]);
  const s = queued(newGame(c, { seed: 7, length: 'full', house: 'rich' }), c, { card: 'follow-mira' });
  ok(s.desk.some(p => p.ref === 'follow-mira'), 'on the desk');
});

test('gone 1c a follow-up that names "$agent" is dropped when the paper\'s agent has gone, and so is one whose `when` names a gone agent', () => {
  const c = only([FOLLOW_ME, FOLLOW_WHEN]);
  const base = () => goneMira(newGame(c, { seed: 7, length: 'full', house: 'rich' }));
  eq(queued(base(), c, { card: 'follow-me', agent: 'mira' }).desk.some(p => p.ref === 'follow-me'), false, '$agent');
  eq(queued(base(), c, { card: 'follow-when' }).desk.some(p => p.ref === 'follow-when'), false, 'when');
  const here = newGame(c, { seed: 7, length: 'full', house: 'rich' });
  ok(queued(here, c, { card: 'follow-me', agent: 'mira' }).desk.some(p => p.ref === 'follow-me'), '$agent with the agent here is drawn');
});

test('gone 2 no card that names an agent is drawn for one who has gone: an agent\'s where of gone fails every agent condition', () => {
  const HIRE = { id: 'offer', group: 'hiring', weight: 1, title: 'An offer', text: 'x', when: { agent: 'mira', hired: false }, choices: [{ id: 'yes', label: 'Yes', now: [{ hire: 'mira' }] }] };
  const c = only([HIRE]);
  const run = edit => { let s = newGame(c, { seed: 7, length: 'full', house: 'rich' }); edit(s); for (let i = 0; i < 6; i++) { s = step(s, c); edit(s, true); } return s.seen.offer ?? 0; };
  ok(run(s => { s.agents.mira.hired = false; }) > 0, 'drawn for an agent the house has not hired (not an empty case)');
  eq(run(goneMira), 0, 'never for one who has gone');
  const s = goneMira(game());
  for (const cond of [{ agent: 'mira', hired: false }, { agent: 'mira', hired: true }, { agent: 'mira' }, { agent: 'mira', where: 'gone' }]) eq(holds(cond, s, calm), false, JSON.stringify(cond));
});

// An acts game that retires everyone at its first jump, or lets trust -2 leave at it.
const jumpGame = (retires, edit) => {
  const c = variant(only([]), x => { x.city.jump = { ...(x.city.jump ?? {}), retires }; });
  let s = newGame(c, { seed: 7, length: 'acts', house: 'rich' });
  for (let i = 0; i < 40; i++) {
    const at = seasonIndex(s, c);
    const next = step(structuredClone(s), c);
    if (next.phase === 'interlude') { edit(s); return { c, s: step(s, c) }; }
    s = next;
    if (next.phase === 'recall' || seasonIndex(next, c) < at) break;
  }
  throw new Error('no jump reached');
};

test('gone 3a an agent retired at the jump is told apart from one who left for another house, and the words say which', () => {
  const { c, s } = jumpGame(1, x => { x.agents.mira.trust = 0; x.agents.tobin.trust = 0; });
  eq([s.agents.mira.where, s.agents.tobin.where], ['gone', 'gone']);
  eq([leftHow(s, 'mira'), leftHow(s, 'tobin')], ['retired', 'retired']);
  throws(() => apply(s, c, { hire: 'mira' }), /Mira has retired and cannot be hired again/);
  const left = jumpGame(0, x => { x.agents.mira.trust = -2; }).s;
  eq([left.agents.mira.where, leftHow(left, 'mira')], ['gone', 'house']);
  throws(() => apply(left, calm, { hire: 'mira' }), /Mira has gone to work for another house/);
  eq(leftHow(left, 'tobin'), null, 'someone still here has no way of leaving');
});

test('gone 3b a queued trust effect naming a retiree says they retired', () => {
  const { s } = jumpGame(1, x => { x.agents.mira.trust = 0; });
  const t = structuredClone(s);
  t.queue.push({ at: seasonIndex(t, calm), from: 'test/later', do: [{ trust: 'mira', by: 1 }] });
  const done_ = step(t.phase === 'interlude' ? openSeason(t, calm) : t, calm);
  ok(done_.log.some(e => e.kind === 'dropped' && /Mira has retired, so their trust cannot change/.test(e.reason)), 'logged as retired');
});

test('gone 3c trust at -2 reads the same on the page and in the refusal: one story', () => {
  let s = homeWith('own', { purse: 0, money: 0 });
  s.agents.mira.trust = -1;
  s = step(s, calm);                                              // home with -2, still hired (the rule 2 case)
  eq(s.agents.mira.trust, -2);
  s.money = 1000; s.stock = { wool: 20 };
  const words = view(s, calm).trust.mira;
  eq([words.step, words.words], [0, 'has lost faith in the house']);
  ok(checkPlan(s, calm, WOOL).reasons[0].includes(words.words), 'the refusal says the same words');
  s.agents.mira.trust = -1;
  eq(view(s, calm).trust.mira.words, 'is uneasy with the house', 'and -1 is still uneasy');
});

await done();
