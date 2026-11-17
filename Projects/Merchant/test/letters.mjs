// Letters from the road (ARCHITECTURE 4.2 step 2, 4.4, 5.7; DESIGN 4.5): node test/letters.mjs, from
// Projects/Merchant/. Plain Node, no browser, no clock. Testport carries it: Mira (careful) and Tobin
// (bold), the Saltmarsh road (one season each way) and the Hilltown road (two seasons a leg, by mules),
// and two invented letters, a question that rides the mules and a report from Saltmarsh.
import fs from 'node:fs/promises';
import { test, eq, ok, throws, done } from './lib.mjs';
import { loadContent } from '../js/data.js';
import { validateContent } from '../js/engine/content.js';
import { holds } from '../js/engine/conditions.js';
import { seasonIndex } from '../js/engine/calendar.js';
import { lagOf } from '../js/engine/market.js';
import { LETTER_CHANCE, WAIT, decide, letters } from '../js/engine/letters.js';
import { MAX_PAPERS } from '../js/engine/state.js';
import { newGame, openSeason, endSeason, choose, paperChoices, outfit, view } from '../js/engine/index.js';

const T = await loadContent('testport', { fs });
const variant = (c, edit) => { const x = structuredClone(c); edit(x); return x; };
const calm = variant(T, x => { for (const r of x.routes) for (const l of r.legs) l.risk = 0; });
const only = (c, ...ids) => variant(c, x => { x.letters = x.letters.filter(l => ids.includes(l.id)); });
const withTraits = (c, id, traits) => variant(c, x => { x.agents.find(a => a.id === id).traits = traits; });

const answer = (s, c) => { for (const p of s.desk) if (p.state === 'open') s = choose(s, c, p.id, paperChoices(s, c, p.id).find(ch => holds(ch.requires, s, c)).id); return s; };
const step = (s, c) => (s.phase === 'interlude' ? openSeason(s, c) : endSeason(answer(s, c), c));
const idx = (s, c) => seasonIndex(s, c);

const QUESTION = 'rain-on-the-pass', REPORT = 'salt-toll';
const WOOL = { agent: 'mira', route: 'harbour-hilltown', cargo: { wool: 10 }, purse: 0, contract: 'own', sell: ['wool'], buy: [] };

/** A game with one expedition sent and then put where a test wants it: `at` is set on the expedition. */
function sent(c, agent, route, at) {
  const s = outfit(newGame(c, { seed: 7, length: 'full', house: 'rich' }), c, { ...WOOL, agent, route, sell: route === WOOL.route ? ['wool'] : [] });
  Object.assign(s.expeditions[0], at);
  return s;
}
const riding = { leg: 0, status: 'out', left: 1, sent: -9 };                 // mid-road on the first leg of the Hilltown road
const standingAtSaltmarsh = { leg: 1, status: 'out', left: 1, sent: -9 };    // just left Saltmarsh on the way home
const x0 = s => s.expeditions[0];

/** The state after the letters step for the first value of state.rng, from `from` up, that makes the
    expedition write; null when none of `tries` values does. The draw is seeded, and this walks the seeds. */
function written(s, c, tries = 60, from = 1) {
  for (let r = from; r < from + tries; r++) {
    const t = structuredClone(s); t.rng = r;
    letters(t, c);
    if ((x0(t).post ?? []).length) return t;
  }
  return null;
}
const post = (id, over = {}) => ({ id, kind: id === QUESTION ? 'question' : 'report', stop: 'hilltown', leg: 0, written: 0, lag: 2, arrive: 0, def: 'wait', delivered: false, ...over });

// ---- the schema and the conditions

test('the letter leaves: leg reads the vessel it is riding, at the stop it stands at, trait its agent; a card cannot use them', () => {
  const s = sent(calm, 'mira', 'harbour-hilltown', riding);
  const h = (cond, st = s) => holds(cond, st, calm, x0(st));
  eq([h({ leg: { by: 'mules' } }), h({ leg: { by: 'dhow' } }), h({ at: 'hilltown' }), h({ trait: 'careful' }), h({ trait: 'bold' })], [true, false, false, true, false]);
  const there = sent(calm, 'tobin', 'harbour-saltmarsh', { leg: 1, status: 'out', left: 1, sent: -9 });
  eq([h({ at: 'saltmarsh' }, there), h({ leg: { by: 'nileboat' } }, there)], [true, false], 'standing, not riding, on the first season of a leg');
  eq(h({ leg: { by: 'nileboat' } }, { ...there, expeditions: [{ ...x0(there), left: 0 }] }), true);
  throws(() => holds({ trait: 'careful' }, s, calm), /expedition/);
  throws(() => holds({ at: 'saltmarsh', gte: 1 }, s, calm, x0(s)), /unknown key/);
});
test('the schema: a question\'s "default" must name one of its choices, a report has none', () => {
  validateContent(T, {});                       // the shipped letters pass
  const bad = edit => { try { validateContent(variant(T, edit), {}); } catch (e) { return e.problems.map(p => p.message).join(' | '); } return null; };
  ok(/no choice "ghost"/.test(bad(x => { x.letters[0].default = 'ghost'; })), 'a default that is no choice');
  ok(/only a question has a "default"/.test(bad(x => { x.letters[1].default = 'right'; })), 'a report with a default');
});

// ---- writing: the lag, one letter, never at home

test('lag: a letter written at Saltmarsh reaches the desk next season, one written riding to Hilltown two seasons on, and both use market.js lagOf', () => {
  eq([lagOf(calm, 'saltmarsh'), lagOf(calm, 'hilltown'), lagOf(calm, 'harbour')], [1, 2, 0]);
  const near = written(sent(only(calm, REPORT), 'tobin', 'harbour-saltmarsh', standingAtSaltmarsh), only(calm, REPORT));
  const far = written(sent(only(calm, QUESTION), 'mira', 'harbour-hilltown', riding), only(calm, QUESTION));
  const [n, f] = [x0(near).post[0], x0(far).post[0]];
  eq([n.id, n.stop, n.lag, n.arrive - n.written], [REPORT, 'saltmarsh', 1, 1]);
  eq([f.id, f.stop, f.lag, f.arrive - f.written, f.def], [QUESTION, 'hilltown', 2, 2, 'wait']);
  eq(near.desk.filter(p => p.kind === 'letter'), [], 'a letter is not on the desk the season it is written');
});
test('a letter reaches the desk when its season comes, with its expedition, agent, stop and season written as the paper\'s context', () => {
  const c = only(calm, REPORT);
  let s = written(sent(c, 'tobin', 'harbour-saltmarsh', standingAtSaltmarsh), c);
  const wrote = idx(s, c);
  s.desk = []; s.t += 1;
  letters(s, c);
  const p = s.desk[0];
  eq([p.kind, p.ref, p.agent, p.expedition, p.stop, p.written, p.lag, p.reached], ['letter', REPORT, 'tobin', 'x1', 'saltmarsh', wrote, 1, wrote + 1]);
});
test('one letter at most for an expedition in a season, whatever the pool holds', () => {
  const c = calm; // both letters match nothing at once, so make them: a Saltmarsh report and a mules question for one expedition
  const both = variant(c, y => { y.letters[1].when = { leg: { by: 'mules' } }; });
  let wrote = 0;
  for (let r = 1; r <= 200; r++) {
    const s = sent(both, 'mira', 'harbour-hilltown', riding); s.rng = r;
    letters(s, both);
    ok(x0(s).post.length <= 1, `rng ${r}: ${x0(s).post.length} letters from one expedition`);
    wrote += x0(s).post.length;
    letters(s, both); // the step called again in the same season writes nothing more
    ok(x0(s).post.length <= 1, `rng ${r}: the step run twice in one season`);
  }
  ok(wrote > 60 && wrote < 140, `about half of 200 draws write (${wrote}); the chance is ${LETTER_CHANCE}`);
});
test('never for an expedition at home (done, or still standing in Harbour), or one just sent, or when no letter is in the pool', () => {
  const home = sent(calm, 'mira', 'harbour-hilltown', { status: 'home', leg: 2 });
  const fresh = sent(calm, 'mira', 'harbour-hilltown', { leg: 0, status: 'out', left: 2, sent: 0 });
  const leaving = sent(calm, 'mira', 'harbour-hilltown', { leg: 0, status: 'waiting', left: 0, sent: -9 }); // the first leg is closed: still standing in Harbour
  const hereLetter = variant(calm, y => { y.letters[1].when = { at: 'harbour' }; y.letters[0].when = { at: 'harbour' }; }); // a letter that wants to be written at Harbour
  for (let r = 1; r <= 100; r++) {
    for (const s of [home, fresh, leaving]) { const t = structuredClone(s); t.rng = r; letters(t, hereLetter); eq(x0(t).post ?? [], [], `rng ${r}`); }
  }
  const spent = sent(calm, 'mira', 'harbour-hilltown', riding); spent.seen[QUESTION] = 1; // a once-only letter, already written
  const before = spent.rng;
  letters(spent, calm);
  eq([x0(spent).post ?? [], spent.rng], [[], before], 'no letter to write, so no draw is spent');
});
test('weight 0 is never drawn (the cairo letters wait for their text)', () => {
  const c = variant(calm, y => { y.letters.forEach(l => { l.weight = 0; }); });
  const s = sent(c, 'mira', 'harbour-hilltown', riding), before = s.rng;
  letters(s, c);
  eq([x0(s).post ?? [], s.rng], [[], before]);
});

// ---- the desk: five papers

test('the desk holds 5 papers: a letter that arrives on a full desk waits, and comes the season there is room', () => {
  const c = only(calm, REPORT);
  const s = sent(c, 'tobin', 'harbour-saltmarsh', standingAtSaltmarsh);
  x0(s).post = [post(REPORT, { stop: 'saltmarsh', lag: 1, arrive: idx(s, c) })];
  s.desk = Array.from({ length: MAX_PAPERS }, (_, i) => ({ id: `p${i}`, kind: 'notice', ref: 'n', state: 'open' }));
  const money = s.money;
  letters(s, c);
  eq([s.desk.length, x0(s).post[0].delivered, s.money], [MAX_PAPERS, false, money], 'no sixth paper, no happened effect either');
  s.desk.pop();
  letters(s, c);
  eq([s.desk.length, s.desk.at(-1).ref, x0(s).post[0].delivered, s.money], [MAX_PAPERS, REPORT, true, money - 4]);
});

// ---- a report's happened effects

test('a report\'s happened effects apply once, when it reaches the desk, and answering it does not apply them again', () => {
  const c = only(calm, REPORT);
  let s = sent(c, 'tobin', 'harbour-saltmarsh', standingAtSaltmarsh);
  x0(s).post = [post(REPORT, { stop: 'saltmarsh', lag: 1, arrive: idx(s, c) })];
  const money = s.money;
  letters(s, c); letters(s, c);
  eq(s.money, money - 4, 'once, though the step ran twice');
  eq(s.desk.filter(p => p.ref === REPORT).length, 1);
  s.desk.forEach((p, i) => { p.id = `p${i}`; });
  const id = s.desk.find(p => p.ref === REPORT).id;
  const after = choose(s, c, id, 'right');
  eq([after.money, after.agents.tobin.trust, after.expeditions[0].orders], [money - 4, 1, []], 'the response moves trust and not money, and is no order');
});

// ---- a question: the order, the default, the late order

test('view() gives a letter the line "From {agent}, at {stop}. Written in ... It reached you in ...", and a question how long the answer takes', () => {
  const c = only(calm, QUESTION);
  const s = sent(c, 'mira', 'harbour-hilltown', riding);
  x0(s).post = [post(QUESTION, { written: 0, lag: 2, arrive: idx(s, c) })];
  letters(s, c);
  s.desk.forEach((p, i) => { p.id = `p${i}`; });
  const v = view(s, c).letters[s.desk.find(p => p.ref === QUESTION).id];
  eq(v.line, `From Mira, at Hilltown. Written in Spring 1200. It reached you in Spring 1200.`);
  eq(v.answer, 'Your answer will reach Hilltown in two seasons.');
  x0(s).post[0].lag = 1; s.desk.find(p => p.ref === QUESTION).lag = 1;
  eq(view(s, c).letters[s.desk.find(p => p.ref === QUESTION).id].answer, 'Your answer will reach Hilltown next season.');
  const report = only(calm, REPORT), r = sent(report, 'tobin', 'harbour-saltmarsh', standingAtSaltmarsh);
  x0(r).post = [post(REPORT, { stop: 'saltmarsh', lag: 1, arrive: idx(r, report) })];
  letters(r, report); r.desk.forEach((p, i) => { p.id = `p${i}`; });
  eq(view(r, report).letters[r.desk.find(p => p.ref === REPORT).id].answer, null, 'a report asks nothing');
});
test('a question\'s choice pushes its order to the expedition with at = now + lag, for a near and a far lag', () => {
  for (const [lag, route, agent, at] of [[1, 'harbour-saltmarsh', 'tobin', standingAtSaltmarsh], [2, 'harbour-hilltown', 'mira', riding]]) {
    const c = variant(only(calm, QUESTION), y => { y.letters[0].when = { trait: y.agents.find(a => a.id === agent).traits[0] }; });
    const s = sent(c, agent, route, at);
    x0(s).post = [post(QUESTION, { stop: route.endsWith('saltmarsh') ? 'saltmarsh' : 'hilltown', lag, leg: at.leg, arrive: idx(s, c), written: idx(s, c) - lag })];
    letters(s, c);
    s.desk.forEach((p, i) => { p.id = `p${i}`; });
    const id = s.desk.find(p => p.ref === QUESTION).id;
    const after = choose(s, c, id, 'press');
    eq(x0(after).orders, [{ go: 'press', letter: QUESTION, leg: at.leg, at: idx(s, c) + lag }], `lag ${lag}`);
  }
});

/** Plays on until the expedition has arrived at the end of its leg `leg` (x.leg moves past it); returns that state. */
function toEndOfLeg(s, c, leg) {
  for (let n = 0; n < 12; n++) { s = step(s, c); const x = x0(s); if (!x || x.leg > leg) return s; }
  throw new Error('it never reached the end of the leg');
}
/** A question asked on the first leg of the Hilltown road, answered by nobody yet. */
function asked(agent, traits, def = 'wait') {
  const c = only(withTraits(calm, agent, traits), QUESTION);
  const s = sent(c, agent, 'harbour-hilltown', { leg: 0, status: 'waiting', left: 0, sent: 0 });
  x0(s).post = [post(QUESTION, { delivered: true, arrive: 0, def })];
  s.seen[QUESTION] = 1;
  return [s, c];
}
const statusAfterArrival = (s, c) => {
  // the closing step that ends leg 0 leaves the expedition `waiting` (held) or `out` (riding the next leg)
  const t = toEndOfLeg(s, c, 0);
  return x0(t).status;
};

test('until the order arrives the agent acts by its trait: careful waits, bold goes on, plain does the letter\'s default', () => {
  eq(statusAfterArrival(...asked('mira', ['careful'])), 'waiting', 'careful');
  eq(statusAfterArrival(...asked('tobin', ['bold'])), 'out', 'bold');
  eq(statusAfterArrival(...asked('mira', ['honest'], 'wait')), 'waiting', 'plain, and the default is to wait');
  eq(statusAfterArrival(...asked('mira', ['honest'], 'press')), 'out', 'plain, and the default is to press on');
  eq(statusAfterArrival(...asked('mira', ['honest'], null)), 'out', 'plain, and the letter names no default');
});
test('an expedition with no question asked acts as it always did, careful or not', () => {
  const [s, c] = asked('mira', ['careful']);
  x0(s).post = [];
  eq(statusAfterArrival(s, c), 'out');
});
test('after the order arrives the order rules: a due order beats the trait either way, and an order not yet due does not', () => {
  const when = (agent, traits, go, at) => { const [s, c] = asked(agent, traits); x0(s).orders = [{ go, letter: QUESTION, leg: 0, at }]; return statusAfterArrival(s, c); };
  eq(when('mira', ['careful'], 'press', 0), 'out', 'careful, ordered to press on');
  eq(when('tobin', ['bold'], WAIT, 0), 'waiting', 'bold, ordered to wait');
  eq(when('mira', ['careful'], 'press', 99), 'waiting', 'careful, the order is not due yet: the trait still rules');
});
test('a held expedition pays a season of upkeep and rides on the season after', () => {
  const [s, c] = asked('mira', ['careful']);
  const t = toEndOfLeg(s, c, 0), upkeep = x0(t).book.upkeep;
  const u = step(t, c);
  eq([x0(t).status, x0(u).status, x0(u).book.upkeep - upkeep, x0(u).waiting - x0(t).waiting], ['waiting', 'out', 4, 1]);
});
test('an order that reaches the expedition after it has passed the end of its leg is dropped, and the drop is logged', () => {
  const [s, c] = asked('tobin', ['bold']);
  const due = idx(s, c) + 5;                       // long after the expedition has gone through
  x0(s).orders = [{ go: WAIT, letter: QUESTION, leg: 0, at: due }];
  let t = toEndOfLeg(s, c, 0);
  eq(x0(t).status, 'out', 'it passed by its trait; the order was not there');
  eq(x0(t).orders.length, 1, 'the order is still on its way');
  while (idx(t, c) < due) t = step(t, c);
  ok(!x0(t) || x0(t).orders.length === 0, 'the late order is gone');
  const drops = t.log.filter(e => e.kind === 'dropped' && e.ref === `order:${QUESTION}`);
  eq(drops.length, 1, 'logged once');
  ok(/passed the end of leg 1/.test(drops[0].reason), drops[0].reason);
  eq(drops[0].at, due);
});
test('an answer to a letter whose expedition is gone still counts at the desk and reaches no one', () => {
  const c = only(calm, QUESTION);
  const s = sent(c, 'mira', 'harbour-hilltown', riding);
  x0(s).post = [post(QUESTION, { arrive: idx(s, c) })];
  letters(s, c);
  s.desk.forEach((p, i) => { p.id = `p${i}`; });
  s.expeditions = [];                                   // lost on the road in the meantime
  const after = choose(s, c, s.desk.find(p => p.ref === QUESTION).id, 'hold');
  eq([after.desk.find(p => p.ref === QUESTION).state, after.log.at(-1).ref], ['done', QUESTION]);
});
test('decide() takes the latest due order and uses it up', () => {
  const [s, c] = asked('mira', ['careful']);
  const x = x0(s);
  x.orders = [{ go: WAIT, letter: 'a', leg: 0, at: 1 }, { go: 'press', letter: 'b', leg: 0, at: 2 }, { go: WAIT, letter: 'c', leg: 0, at: 9 }];
  eq(decide(s, c, x, 0, 3), null, 'the order from season 2 is the latest due and says go on');
  eq(x.orders.map(o => o.letter), ['c'], 'both due orders are used up; the one not due stays');
});

// ---- a whole game

test('a game with testport\'s two letters plays to the end, writes letters, and no paper is ever a sixth', () => {
  const c = withTraits(calm, 'mira', ['honest']);
  let s = newGame(c, { seed: 11, length: 'full', house: 'rich' });
  let sentOut = 0, seen = new Set();
  while (s.phase !== 'recall') {
    if (s.phase === 'desk' && !s.expeditions.length && s.desk.every(p => p.id !== null)) {
      const route = sentOut % 2 ? 'harbour-hilltown' : 'harbour-saltmarsh';
      try { s = outfit(s, c, { ...WOOL, agent: sentOut % 2 ? 'mira' : 'tobin', route, cargo: { wool: 4 }, sell: sentOut % 2 ? ['wool'] : [] }); sentOut++; } catch { /* nothing to send this season */ }
    }
    s = step(s, c);
    ok(s.desk.length <= MAX_PAPERS);
    for (const p of s.desk) if (p.kind === 'letter') seen.add(p.ref);
  }
  ok(sentOut >= 2, `sent ${sentOut}`);
  ok(seen.size >= 1, 'at least one letter reached the desk in a 12 season game with seven expeditions');
  eq(s.phase, 'recall');
});

await done();
