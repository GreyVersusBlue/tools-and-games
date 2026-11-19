// Letters from the road (ARCHITECTURE 4.2 step 2, 4.4, 5.7; DESIGN 4.5; DECISIONS 2026-11-17 12:10):
// node test/letters.mjs, from Projects/Merchant/. Plain Node, no browser, no clock.
//
// Testport carries it. Its own roads are too short for a question to ever be drawn (a question needs
// its answer to reach the agent before the trip's last decision point), so most cases build `trek` in
// memory: a road of five stops out and back, one season a leg, that the tests play from end to end.
// The cases that matter play through the real endSeason loop: a letter is written by the opening step,
// travels in `state.post`, is answered at the desk with choose(), and its order is read by the closing
// steps. Nothing here places a letter, an order or a status by hand; where a case needs a particular
// draw it searches the seeds for the first game that makes it, and fails if none does.
//
// A state in `states` is the one a season opens in: states[k] is the state at the opening of season k,
// after the closing steps of season k-1 and before the player answers anything.
import fs from 'node:fs/promises';
import { test, eq, ok, throws, done } from './lib.mjs';
import { loadContent } from '../js/data.js';
import { validateContent } from '../js/engine/content.js';
import { holds } from '../js/engine/conditions.js';
import { seasonIndex } from '../js/engine/calendar.js';
import { lagOf, writeSeason } from '../js/engine/market.js';
import { LETTER_CHANCE, MAX_HOLD, letters } from '../js/engine/letters.js';
import { MAX_PAPERS } from '../js/engine/state.js';
import { MAX_WAIT } from '../js/engine/routes.js';
import { next as dice } from '../js/engine/rng.js';
import { steps } from '../js/engine/turn.js';
import { repair } from '../js/save.js';
import { newGame, openSeason, endSeason, choose, paperChoices, outfit, checkPlan, suggestPlan, destinations, recall, view } from '../js/engine/index.js';

const T = await loadContent('testport', { fs });
const variant = (c, edit) => { const x = structuredClone(c); edit(x); return x; };
const calm = variant(T, x => { for (const r of x.routes) for (const l of r.legs) l.risk = 0; });
const withTraits = (c, id, traits) => variant(c, x => { x.agents.find(a => a.id === id).traits = traits; });
const idx = (s, c) => seasonIndex(s, c);
const x0 = s => s.expeditions[0];

// ---- the road and the letters the cases write

const HILL = T.stops.find(s => s.id === 'hilltown');
const ALL_SEASONS = ['spring', 'summer', 'autumn', 'winter'];
/** `trek`: Harbour, then stops s1 to s`n`, and back. A leg is one season unless `lens` says `{ leg: seasons }`
    (the same length on the way back). `end` is the last season of the "full" length. Risk 0 unless `risk` says
    `{ leg: chance }`; toll 0. */
function trek(base, { n = 5, end = 23, lens = {}, risk = {} } = {}) {
  return variant(base, x => {
    x.calendar = { base: 1200, lengths: { full: { acts: [{ from: 0, to: end }] }, acts: x.calendar.lengths.acts }, end: { season: end, event: x.calendar.end.event } };
    const ids = Array.from({ length: n }, (_, i) => `s${i + 1}`);
    ids.forEach((id, i) => x.stops.push({ ...structuredClone(HILL), id, name: `Stop ${i + 1}`, lat: i, lon: 2 }));
    const leg = (from, to, i) => ({ from, to, by: 'mules', seasons: lens[i] ?? 1, opens: ALL_SEASONS, risk: risk[i] ?? 0, toll: 0, sources: [{ src: 'testport-fiction' }] });
    const out = ids.map((id, i) => leg(i ? ids[i - 1] : 'harbour', id, i));
    const back = [...ids].reverse().map((id, i, a) => leg(id, i + 1 < a.length ? a[i + 1] : 'harbour', n - 1 - i));
    x.routes.push({ id: 'trek', to: ids.at(-1), legs: [...out, ...back] });
  });
}
const choicesOf = () => [
  { id: 'wait', label: 'Wait', hint: 'It costs a season.', now: [{ order: { go: 'wait' } }] },
  { id: 'on', label: 'Go on', hint: 'It is faster.', now: [{ order: { go: 'on' } }] },
  { id: 'home', label: 'Turn back', hint: 'It is safer.', now: [{ order: { go: 'home' } }] },
];
const question = (id, when, over = {}) => ({
  id, kind: 'question', from: { name: 'The road', role: 'The trek', seal: null }, title: id, body: 'A question from the road.', when, weight: 1,
  repeat: false, default: 'on', choices: choicesOf(), note: 'An invented letter for testing.', sources: [{ src: 'testport-fiction' }], ...over,
});
const report = (id, when, over = {}) => ({
  id, kind: 'report', from: { name: 'The road', role: 'The trek', seal: null }, title: id, body: 'A report from the road.', when, weight: 1, repeat: false,
  happened: [{ stock: 'salt', by: 3 }],
  choices: [{ id: 'right', label: 'You did right', hint: 'Trust.', now: [{ trust: '$agent', by: 1 }] }, { id: 'argue', label: 'You should have argued', hint: 'Less trust.', now: [{ trust: '$agent', by: -1 }] }],
  note: 'An invented letter for testing.', sources: [{ src: 'testport-fiction' }], ...over,
});
const writing = (c, ...ls) => variant(c, x => { x.letters = ls; });
const at = stop => ({ at: stop });
/** The same letters with a report's happened effects taken out: a control game, draw for draw. */
const noHappened = c => variant(c, x => { x.letters = x.letters.map(l => (l.kind === 'report' ? { ...l, happened: [] } : l)); });

// ---- playing

const PLAN = { agent: 'tobin', route: 'trek', cargo: { wool: 2 }, purse: 0, contract: 'own', sell: [], buy: [] };
/** A rich house with one expedition sent in season 0. `plan.length` picks the calendar's length. */
const start = (c, seed, { length = 'full', ...plan } = {}) => outfit(newGame(c, { seed, length, house: 'rich' }), c, { ...PLAN, ...plan });
/** Answers every open paper: the choice named for its card or letter in `choices`, else the first that is open. */
function pick(s, c, choices = {}) {
  for (const p of s.desk) {
    if (p.state !== 'open') continue;
    const all = paperChoices(s, c, p.id).filter(ch => holds(ch.requires, s, c));
    s = choose(s, c, p.id, (all.find(ch => ch.id === choices[p.ref]) ?? all[0]).id);
  }
  return s;
}
const step = (s, c, choices) => (s.phase === 'interlude' ? openSeason(s, c) : endSeason(pick(s, c, choices), c));
/** Plays `n` seasons (or until the game leaves the desk); returns every state, the first being the start. */
function play(c, seed, { plan, choices, n = 14 } = {}) {
  const states = [start(c, seed, plan)];
  for (let i = 0; i < n && ['desk', 'interlude'].includes(states.at(-1).phase); i++) states.push(step(states.at(-1), c, choices));
  return states;
}
/** The first seed from 1 up whose game (played with `opts`) satisfies `hit(states)`. Fails if none of `tries` does. */
function seedFor(c, hit, opts = {}) {
  for (let seed = 1; seed <= (opts.tries ?? 120); seed++) if (hit(play(c, seed, opts))) return seed;
  throw new Error('no seed in the search made the draw this case needs');
}
const posted = (s, id) => s?.post.find(p => p.id === id);
const everPosted = (states, id) => states.some(s => posted(s, id));
/** The expedition at each opening: `${leg}${o|w|h}` for the leg it rides next and whether it is out, waiting or home; `.` once gone. */
const trail = states => states.map(s => (x0(s) ? `${x0(s).leg}${x0(s).status[0]}` : '.'));
const drops = (s, ref) => s.log.filter(e => e.kind === 'dropped' && e.ref === ref);
const salt = s => s.stock.salt ?? 0;

// ---- the schema and the conditions

test('the letter leaves: leg reads the vessel it is riding, at the stop it stands at, trait its agent; a card cannot use them', () => {
  const sentAt = (agent, route, where) => { const s = outfit(newGame(calm, { seed: 7, length: 'full', house: 'rich' }), calm, { agent, route, cargo: { wool: 10 }, purse: 0, contract: 'own', sell: [], buy: [] }); Object.assign(s.expeditions[0], where); return s; };
  const s = sentAt('mira', 'harbour-hilltown', { leg: 0, status: 'out', left: 1, sent: -9 });
  const h = (cond, st = s) => holds(cond, st, calm, x0(st));
  eq([h({ leg: { by: 'mules' } }), h({ leg: { by: 'dhow' } }), h({ at: 'hilltown' }), h({ trait: 'careful' }), h({ trait: 'bold' })], [true, false, false, true, false]);
  const there = sentAt('tobin', 'harbour-saltmarsh', { leg: 1, status: 'out', left: 1, sent: -9 });
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
test('(3) the order schema: go is one of wait, on or home, and nothing else is accepted', () => {
  const orderOf = order => variant(T, x => { x.letters[0].choices[0].now = [{ order }]; });
  const bad = order => { try { validateContent(orderOf(order), {}); } catch (e) { return e.problems.map(p => p.message).join(' | '); } return null; };
  for (const go of ['wait', 'on', 'home']) eq(bad({ go }), null, go);
  for (const go of ['press', 'india', 'quick-road', 'back', '']) ok(/needs one of wait, on, home/.test(bad({ go }) ?? ''), `go "${go}" is refused`);
  ok(bad({ do: 'go' }) !== null, 'an order with no go');
  ok(bad({}) !== null, 'an empty order');
});

// ---- (1) the post: a letter reaches the desk whatever becomes of its expedition

const saltRoad = writing(calm, report('salt-report', at('saltmarsh')));
test('(1) a report written on the way home reaches the desk after the expedition is home, and its happened applies once', () => {
  const opts = { plan: { route: 'harbour-saltmarsh' }, n: 8 };
  const seed = seedFor(saltRoad, st => everPosted(st, 'salt-report'), { ...opts, n: 3 });
  const states = play(saltRoad, seed, opts), control = play(noHappened(saltRoad), seed, opts);
  const entry = posted(states[states.findIndex(s => posted(s, 'salt-report'))], 'salt-report');
  eq([entry.kind, entry.expedition, entry.agent, entry.stop, entry.standing, entry.lag, entry.arrive - entry.written], ['report', 'x1', 'tobin', 'saltmarsh', true, 1, 1]);
  const home = states.findIndex(s => s.log.some(e => e.kind === 'return'));
  const got = states.findIndex(s => s.desk.some(p => p.ref === 'salt-report'));
  ok(home > 0 && got >= home, `home in season ${home}, the report on the desk in season ${got}`);
  eq(states[got].expeditions, [], 'the expedition is gone from the road when its letter reaches the desk');
  eq(states[got].log.filter(e => e.kind === 'return').length, 1);
  eq(salt(states[got]) - salt(control[got]), 3, 'the happened effect applies as the report arrives');
  eq(states.at(-1).log.filter(e => e.kind === 'letter' && e.ref === 'salt-report').length, 1, 'delivered once');
  eq(salt(states.at(-1)) - salt(control.at(-1)), 3, 'answering it and the seasons after do not apply it again');
});
test('(1) a letter in the post when its expedition is lost is delivered, a report\'s happened applies, and a question\'s answer is logged as dropped', () => {
  const lossy = c => variant(trek(c, { risk: { 2: 1 } }), x => { x.city.jump = { wholeLoss: 1 }; });   // the third leg is lost; a letter written at s2 takes two seasons
  const rep = writing(lossy(calm), report('r1', at('s2')));
  const seedR = seedFor(rep, st => everPosted(st, 'r1'), { n: 3 });
  const lost = play(rep, seedR, { n: 6 }), control = play(noHappened(rep), seedR, { n: 6 });
  const w = lost.findIndex(s => posted(s, 'r1'));
  eq(lost[w + 1].expeditions, [], 'the expedition is lost in the season the letter was written, before it arrives');
  ok(lost[w + 1].log.some(e => e.kind === 'lost'), 'logged as lost');
  ok(posted(lost[w + 1], 'r1'), 'the letter is still in the house\'s post');
  const got = lost.findIndex(s => s.desk.some(p => p.ref === 'r1'));
  ok(got > w + 1, 'it reaches the desk after the loss');
  eq(salt(lost[got]) - salt(control[got]), 3, 'the happened effect applies');
  const ask = writing(lossy(calm), question('q1', at('s2')));
  const seedQ = seedFor(ask, st => everPosted(st, 'q1'), { n: 3 });
  const q = play(ask, seedQ, { choices: { q1: 'home' }, n: 7 });
  const arrived = q.findIndex(s => s.desk.some(p => p.ref === 'q1'));
  ok(arrived > 0 && q[arrived].expeditions.length === 0, 'the question reaches the desk of a house whose expedition is gone');
  const d = drops(q[arrived + 1], 'order:q1');
  eq(d.length, 1, 'answering it logs the order as dropped');
  eq(d[0].at, arrived, 'in the season it was answered');
  eq(q[arrived + 1].log.filter(e => e.kind === 'card' && e.ref === 'q1').length, 1, 'the answer still counts at the desk');
});
test('(1) a letter in the post when the act jump settles its expedition is delivered at the opening after the jump', () => {
  const c = writing(trek(calm, { end: 10 }), report('r1', at('s1')));
  const opts = { plan: { length: 'acts' }, n: 4 };
  const seed = seedFor(c, st => everPosted(st, 'r1'), { ...opts, n: 2 });
  const states = play(c, seed, opts), control = play(noHappened(c), seed, opts);
  const j = states.findIndex(s => s.phase === 'interlude');
  ok(j > 0, 'the jump came');
  eq([states[j].expeditions, states[j].log.some(e => e.kind === 'jump')], [[], true], 'the jump settled the expedition');
  ok(posted(states[j], 'r1'), 'the letter is still in the post across the jump');
  ok(states[j + 1].desk.some(p => p.ref === 'r1'), 'on the desk when the next act opens');
  eq(salt(states[j + 1]) - salt(control[j + 1]), 3, 'its happened applied');
  eq(states[j + 1].post, [], 'and it left the post');
});
test('(1) a report is not written if it would arrive after the expedition is due home', () => {
  // Hilltown is two seasons from home on the way out; a road that comes back in one season gets its report home too late
  const wr = writing(calm, report('r1', at('hilltown')));
  const open = variant(wr, x => { for (const l of x.routes.find(r => r.id === 'harbour-hilltown').legs) l.opens = ALL_SEASONS; });
  const quick = variant(open, x => { x.routes.find(r => r.id === 'harbour-hilltown').legs[1].seasons = 1; });
  const wrote = (c, seed) => everPosted(play(c, seed, { plan: { route: 'harbour-hilltown' }, n: 5 }), 'r1');
  const seeds = Array.from({ length: 40 }, (_, i) => i + 1);
  eq(seeds.filter(sd => wrote(quick, sd)), [], 'never written when it would arrive after the return is due');
  ok(seeds.filter(sd => wrote(open, sd)).length > 5, 'written on a road that comes back as slowly as it went (the same seeds)');
});

// ---- writing: the lag, one letter, never at home, no draw for an empty pool

test('lag: a letter written at s1 reaches the desk the next season, one written at s2 two seasons on, both by market.js lagOf', () => {
  const c = writing(trek(calm), report('r1', at('s1')), report('r2', at('s2')));
  eq([lagOf(c, 's1'), lagOf(c, 's2'), lagOf(c, 'harbour')], [1, 2, 0]);
  const seen = {};
  for (let seed = 1; seed <= 40; seed++) for (const s of play(c, seed, { n: 5 })) for (const p of s.post) seen[p.id] ??= { ...p };
  for (const [id, lag] of [['r1', 1], ['r2', 2]]) eq([seen[id].lag, seen[id].arrive - seen[id].written], [lag, lag], id);
});
test('one letter at most for an expedition in a season, whatever the pool holds, and about half the draws write', () => {
  const c = writing(trek(calm), report('r1', at('s2'), { repeat: true }), report('r2', at('s2'), { repeat: true }), question('q1', at('s2'), { repeat: true }));
  let wrote = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const states = play(c, seed, { n: 3 });          // season 3 is the one opening where the expedition stands at s2
    const byWritten = {};
    for (const s of states) for (const p of s.post) (byWritten[`${p.expedition}@${p.written}`] ??= new Set()).add(p.id);
    for (const ids of Object.values(byWritten)) ok(ids.size <= 1, `seed ${seed}: ${[...ids]}`);
    wrote += Object.keys(byWritten).length;
  }
  ok(wrote > 60 && wrote < 140, `about half of 200 eligible openings write (${wrote}); the chance is ${LETTER_CHANCE}`);
});
test('never at home: a letter that wants Harbour is never written, however many seeds', () => {
  const c = writing(trek(calm), report('r1', at('harbour'), { repeat: true }));
  for (let seed = 1; seed <= 40; seed++) for (const s of play(c, seed, { n: 12 })) eq(s.post, [], `seed ${seed}`);
});
test('weight 0 is never drawn and spends no draw: the stream is the one a game with no letters has', () => {
  const heavy = writing(trek(calm), report('r1', at('s2'), { weight: 0 }), question('q1', at('s2'), { weight: 0 }));
  const none = writing(trek(calm));
  const a = play(heavy, 5, { n: 8 }), b = play(none, 5, { n: 8 });
  eq(a.map(s => s.rng), b.map(s => s.rng));
  eq(a.map(s => s.post), a.map(() => []));
});

// ---- the desk: five papers

test('the desk holds 5 papers: a letter that arrives on a full desk waits in the post, and comes the season there is room', () => {
  const c = writing(trek(calm), report('r1', at('s1')));
  const seed = seedFor(c, st => everPosted(st, 'r1'), { n: 2 });
  const t = structuredClone(play(c, seed, { n: 2 }).at(-1));  // the season it was written: it is in the post
  t.t += 1;                                                    // the season it is due, with a desk already full of notices
  t.desk = Array.from({ length: MAX_PAPERS }, (_, i) => ({ id: `p${i}`, kind: 'notice', ref: 'n', state: 'open' }));
  const had = salt(t);
  letters(t, c);
  eq([t.desk.length, t.post.length, salt(t)], [MAX_PAPERS, 1, had], 'no sixth paper, the letter waits, no happened effect either');
  t.desk.pop();
  letters(t, c);
  eq([t.desk.length, t.desk.at(-1).ref, t.post.length, salt(t)], [MAX_PAPERS, 'r1', 0, had + 3]);
});

// ---- (7) the paper says where the agent was

test('(7) the paper says "at {stop}" for a letter written standing and "on the road to {stop}" for one written riding, and the answer line names the agent', () => {
  const slow = trek(calm, { lens: { 1: 2 } });                // the road from s1 to s2 takes two seasons: a rider is on it in its second
  const standing = writing(slow, question('q-stand', at('s1')));
  const a = seedFor(standing, st => everPosted(st, 'q-stand'), { n: 2 });
  const sa = play(standing, a, { n: 4 }).find(t => t.desk.some(p => p.ref === 'q-stand'));
  const ida = sa.desk.find(p => p.ref === 'q-stand').id;
  eq(view(sa, standing).letters[ida].line, `From Tobin, at Stop 1. Written in ${writeSeason(standing, 2)}. It reached you in ${writeSeason(standing, 3)}.`);
  eq(view(sa, standing).letters[ida].answer, 'Your answer will reach Tobin next season.');
  const riding = writing(slow, question('q-ride', { leg: { by: 'mules' } }));
  const b = seedFor(riding, st => st.some(t => posted(t, 'q-ride')?.standing === false), { n: 4, tries: 200 });
  const sb = play(riding, b, { n: 8 }).find(t => t.desk.some(p => p.ref === 'q-ride'));
  const pb = sb.desk.find(p => p.ref === 'q-ride');
  eq([pb.standing, pb.stop, pb.lag], [false, 's2', 3]);
  eq(view(sb, riding).letters[pb.id].line, `From Tobin, on the road to Stop 2. Written in ${writeSeason(riding, pb.written)}. It reached you in ${writeSeason(riding, pb.reached)}.`);
  eq(view(sb, riding).letters[pb.id].answer, 'Your answer will reach Tobin in three seasons.');
  const rep = writing(slow, report('r-stand', at('s1')));
  const c = seedFor(rep, st => everPosted(st, 'r-stand'), { n: 2 });
  const sc = play(rep, c, { n: 4 }).find(t => t.desk.some(p => p.ref === 'r-stand'));
  eq(view(sc, rep).letters[sc.desk.find(p => p.ref === 'r-stand').id].answer, null, 'a report asks nothing');
});

// ---- (4) a question is written only if its answer can arrive

test('(4) a question is written only if its answer reaches the agent before the trip\'s last decision point', () => {
  // at s3 (lag 3) a question needs six seasons for its answer; on a five-stop road the last decision is too near
  const ask = writing(trek(calm), question('q3', at('s3')));
  const longer = writing(trek(calm, { n: 7 }), question('q3', at('s3')));
  const seeds = Array.from({ length: 60 }, (_, i) => i + 1);
  eq(seeds.filter(sd => everPosted(play(ask, sd, { n: 6 }), 'q3')), [], 'never drawn where its answer cannot arrive');
  ok(seeds.filter(sd => everPosted(play(longer, sd, { n: 6 }), 'q3')).length > 10, 'drawn on a road with room for the answer (the same letter)');
});

test('(4b) a question is written only if its answer arrives before the act\'s last season: act 1 here ends in season 2, so the answer to a question written at s1 (season 1, lag 1) would come in season 3', () => {
  const c = writing(trek(calm, { end: 10 }), question('q1', at('s1')));
  const seeds = Array.from({ length: 60 }, (_, i) => i + 1);
  const drawn = (length) => seeds.filter(sd => everPosted(play(c, sd, { plan: { length }, n: 3 }), 'q1'));
  eq(drawn('acts'), [], 'never drawn where the jump would settle the trip first');
  ok(drawn('full').length > 10, 'drawn in the full length, which has no jump (the same letter, the same seeds)');
});
// 4b and 4c guard one clause (the act's end is the game's end when the calendar has no gap), so removing it fails both; 4b alone fails when the clause reads the game's end only.
test('(4c) a question is written only if its answer arrives before the game\'s last season', () => {
  const ask = n => writing(trek(calm, { end: n }), question('q1', at('s1')));
  const seeds = Array.from({ length: 60 }, (_, i) => i + 1);
  const drawn = c => seeds.filter(sd => everPosted(play(c, sd, { n: 3 }), 'q1'));
  eq(drawn(ask(4)), [], 'written in season 2 at s1 (lag 1) the answer would come in season 4, the last');
  ok(drawn(ask(5)).length > 10, 'one season more and it is written');
});
test('(1b) a report is written only if it arrives before the game\'s last season', () => {
  const ask = n => writing(trek(calm, { end: n }), report('r2', at('s2')));
  const seeds = Array.from({ length: 60 }, (_, i) => i + 1);
  const drawn = c => seeds.filter(sd => everPosted(play(c, sd, { n: 5 }), 'r2'));
  eq(drawn(ask(5)), [], 'written in season 3 at s2 (lag 2) it would arrive in season 5, the last');
  ok(drawn(ask(6)).length > 10, 'one season more and it is written');
});
test('(1c) a report that would arrive in the gap between acts is written, and delivered when the next act opens (the game\'s rule, not the act\'s)', () => {
  const c = writing(trek(calm, { end: 10 }), report('r2', at('s1')));
  const opts = { plan: { length: 'acts' }, n: 4 };
  const seed = seedFor(c, st => everPosted(st, 'r2'), { ...opts, n: 3 });
  const states = play(c, seed, opts), j = states.findIndex(s => s.phase === 'interlude');
  ok(j > 0 && posted(states[j], 'r2')?.arrive > 2 && posted(states[j], 'r2').written === 2, 'in the post across the jump, due after the act\'s last season');
  ok(states[j + 1].desk.some(p => p.ref === 'r2'), 'on the desk when act 2 opens');
});

// ---- (2) the agent acts by trait at once, then the answer is a standing order for the rest of the trip

const one = writing(trek(calm), question('q1', at('s1')));
const seedQ = seedFor(one, st => posted(st[2], 'q1'), { n: 2 });   // written in season 2, at s1: lag 1, answered in 3, due in 4
const timeline = (c, choices, plan, n = 15) => trail(play(c, seedQ, { choices, plan, n }));

test('(2) until an order arrives the agent acts by trait at once: careful holds, bold goes on, a plain agent does the question\'s default', () => {
  // the question was written in season 2 and is on its way: the decision at the end of leg 1 (closing of season 2) is made with it unanswered
  const afterSeason2 = (c, agent) => { const s = play(c, seedQ, { choices: { q1: 'on' }, plan: { agent }, n: 3 })[3]; return `${x0(s).leg}${x0(s).status[0]}`; };
  eq(afterSeason2(one, 'mira'), '2w', 'careful holds');
  eq(afterSeason2(one, 'tobin'), '2o', 'bold goes on');
  const plain = def => writing(withTraits(one, 'mira', ['honest']), question('q1', at('s1'), { default: def }));
  eq(afterSeason2(plain('wait'), 'mira'), '2w', 'plain, default wait');
  eq(afterSeason2(plain('on'), 'mira'), '2o', 'plain, default on');
  eq(afterSeason2(plain('home'), 'mira'), '8o', 'plain, default home: turned back at once, onto the leg home from Stop 2');
});
test('(2) a bold agent at trust -1 holds as a careful one does; at 0 it goes on', () => {
  const after = trust => {
    let s = start(one, seedQ); s.agents.tobin.trust = trust;
    for (let i = 0; i < 3; i++) s = step(s, one, { q1: 'on' });
    return x0(s).status;
  };
  eq([after(-1), after(-3), after(0), after(2)], ['waiting', 'waiting', 'out', 'out']);
});
test('(2) with no question asked an expedition goes on whatever its traits', () => {
  const none = writing(trek(calm));
  for (const agent of ['mira', 'tobin']) eq(trail(play(none, 3, { plan: { agent }, n: 4 })), ['0o', '0o', '1o', '2o', '3o']);
});
test('(2) the answer becomes a standing order: a wait order holds the expedition at every later decision point, to MAX_WAIT seasons in all', () => {
  const states = play(one, seedQ, { choices: { q1: 'wait' }, n: 15 });
  // tobin (bold) goes on at the end of leg 2 unanswered; the order is due in 4, so he holds at the ends of legs 3, 4, 5 and 6
  const held = states.map((s, i) => (x0(s)?.status === 'waiting' ? i : null)).filter(i => i !== null);
  eq(held, [5, 7, 9, 11], 'one season held at each decision point after the answer arrived, four in all');
  eq(MAX_WAIT, MAX_HOLD);
  eq(x0(states[12]).held, MAX_HOLD, 'the fifth decision point is past the limit');
  eq(trail(states).slice(0, 16), ['0o', '0o', '1o', '2o', '3o', '4w', '4o', '5w', '5o', '6w', '6o', '7w', '7o', '8o', '9o', '.']);
});
test('(3) wait, on and home each change what the expedition does at a later leg\'s end, with the seasons and the road asserted', () => {
  const wait = timeline(one, { q1: 'wait' }), on = timeline(one, { q1: 'on' }), home = timeline(one, { q1: 'home' });
  eq(on.slice(0, 12), ['0o', '0o', '1o', '2o', '3o', '4o', '5o', '6o', '7o', '8o', '9o', '.'], 'on: ten legs, one a season, home after season 10');
  eq(wait.findIndex(v => v === '.') - on.findIndex(v => v === '.'), 4, 'wait: the same road, home four held seasons later');
  eq(wait.slice(0, 7), ['0o', '0o', '1o', '2o', '3o', '4w', '4o']);
  // home: turned back at the stop it had reached when the order was due (the end of leg 3, Stop 4), riding the legs home from there only
  eq(home.slice(0, 10), ['0o', '0o', '1o', '2o', '3o', '6o', '7o', '8o', '9o', '.']);
  const states = play(one, seedQ, { choices: { q1: 'home' }, n: 12 });
  eq(x0(states[5]).book.turned, 's4', 'it turned back at Stop 4');
  eq(states[9].log.filter(e => e.kind === 'return').length, 1, 'and came home once, in season 9');
  eq(states[9].expeditions, [], 'four seasons before the full road');
});
test('(3) a turn-back sells the cargo the stop buys and carries the rest home', () => {
  const run = cargo => play(one, seedQ, { choices: { q1: 'home' }, plan: { cargo }, n: 10 });
  const sold = run({ wool: 2 });
  eq([x0(sold[4]).cargo, x0(sold[5]).cargo], [{ wool: 2 }, {}], 'wool is sold at Stop 4, which sells and so buys it');
  ok(x0(sold[5]).purse > 0 && x0(sold[5]).book.sold.some(e => e.stop === 's4'), 'for coin, in the book');
  const kept = run({ salt: 2 });
  eq([x0(kept[4]).cargo, x0(kept[5]).cargo], [{ salt: 2 }, { salt: 2 }], 'salt is not bought there, so it is carried home');
  const back = kept[9].desk.find(p => p.kind === 'return').data.account.find(r => r.label === 'Back home').text;
  ok(/2 loads of salt/.test(back), back);
});
test('(2) an order answered long before it is due acts at the next decision point whatever leg the question was asked on', () => {
  // the question was asked on leg 1; the order is due in 4 and acts at the end of leg 3, two decision points later
  const t = timeline(one, { q1: 'wait' });
  eq([t[3], t[4], t[5]], ['2o', '3o', '4w'], 'not yet at the end of legs 1 and 2, held at the end of leg 3');
});

// ---- (5) a careful agent holds until the answer arrives, then obeys it

test('(5) a careful agent holds at the decision point until the answer arrives, then obeys it: on, wait and home each', () => {
  const careful = { agent: 'mira' };
  const on = timeline(one, { q1: 'on' }, careful), home = timeline(one, { q1: 'home' }, careful), wait = timeline(one, { q1: 'wait' }, careful);
  eq(on.slice(0, 7), ['0o', '0o', '1o', '2w', '2w', '2o', '3o'], 'held at the end of leg 1 in seasons 2 and 3, the answer arrives in 4, goes on');
  eq(home.slice(0, 8), ['0o', '0o', '1o', '2w', '2w', '8o', '9o', '.'], 'held, then turned back at Stop 2 and rode only the legs home from there');
  eq(wait.slice(0, 7), ['0o', '0o', '1o', '2w', '2w', '2o', '3w'], 'held until it arrives, and then the standing wait order holds it again at the next decision point');
  const s = play(one, seedQ, { choices: { q1: 'on' }, plan: careful, n: 6 });
  eq(s.at(-1).log.filter(e => e.kind === 'dropped'), [], 'the answer that arrived while it was held is not dropped as passed');
  eq(s.at(-1).log.filter(e => e.kind === 'order').map(e => e.ref), ['q1'], 'and it took effect');
  eq(x0(s[5]).book.upkeep, 8, 'two seasons of upkeep for the two held');
});
test('(5) a careful agent holds season after season while the answer is far off, and the limit is MAX_WAIT seasons', () => {
  // a question written at s2 (lag 2) is answered in 5 and arrives in 7; held at the end of leg 2 and woken each season until then
  const far = writing(trek(calm), question('qf', at('s2')));
  const seed = seedFor(far, st => posted(st[3], 'qf'), { n: 3, plan: { agent: 'mira' } });
  const states = play(far, seed, { choices: { qf: 'home' }, plan: { agent: 'mira' }, n: 10 });
  eq(trail(states).slice(0, 10), ['0o', '0o', '1o', '2o', '3w', '3w', '3w', '3w', '7o', '8o'], 'held in 3, 4, 5 and 6 (four seasons), the order arrives in 7 and sends it back');
  eq(x0(states[8]).held, MAX_HOLD);
  const slowAnswer = writing(trek(calm), question('qf', at('s2'), { default: 'on' }));
  const t = play(slowAnswer, seed, { choices: { qf: 'wait' }, plan: { agent: 'mira' }, n: 10 });
  eq(trail(t).slice(0, 9), ['0o', '0o', '1o', '2o', '3w', '3w', '3w', '3w', '3o'], 'a wait order that arrives after four held seasons is kept by them: it goes on');
});

// ---- (6) an order that cannot act is logged as dropped

test('(6) an order to an expedition that came home is logged as dropped, once, in the season it came home', () => {
  // seven stops: the first answer sends the expedition home at Stop 4; the second question's answer takes longer than what is left of the trip
  const c = writing(trek(calm, { n: 7 }), question('q1', at('s1')), question('q2', at('s3')));
  const seed = seedFor(c, st => posted(st[2], 'q1') && posted(st[4], 'q2'), { n: 4 });
  const states = play(c, seed, { choices: { q1: 'home', q2: 'on' }, n: 12 });
  const gone = states.findIndex(s => s.log.some(e => e.kind === 'return'));
  eq(states[gone].log.filter(e => e.kind === 'return').length, 1);
  const d = drops(states[gone], 'order:q2');
  eq(d.length, 1, 'q2\'s answer reached the road after the trip was over');
  eq(d[0].at, gone);
  ok(/had not acted before Tobin's trip was over/.test(d[0].reason), d[0].reason);
  eq(drops(states[gone], 'order:q1'), [], 'q1\'s order acted and is not a drop');
  eq(states.at(-1).log.filter(e => e.kind === 'dropped').length, 1, 'nothing else was dropped');
});

// ---- (8) the season entry around a jump

test('(8) the season log entry is written after the jump, so the jump\'s money is in the season it happened', () => {
  const c = trek(calm, { end: 10 });
  const orig = steps.jump;
  let delta = 0;
  steps.jump = (s, content) => { const m = s.money; orig(s, content); delta = s.money - m; };
  let states;
  try { states = play(c, 4, { plan: { length: 'acts', purse: 200 }, n: 5 }); } finally { steps.jump = orig; }
  const j = states.findIndex(s => s.phase === 'interlude');
  ok(j > 0, 'the jump came');
  ok(delta !== 0, 'the jump moved the house\'s money');
  const entry = states[j].log.filter(e => e.kind === 'season').at(-1);
  eq([entry.at, entry.money, states[j].log.at(-1).kind, states[j].log.at(-2).kind], [2, states[j].money, 'season', 'jump'], 'written for the season that closed, after the jump entry');
  const before = states[j - 1].log.filter(e => e.kind === 'season').at(-1);
  eq(entry.change, states[j].money - before.money, 'the change runs from the season before to the money after the jump');
  const seasons = st => st.log.filter(e => e.kind === 'season').length;
  eq(seasons(step(states[j], c)), seasons(states[j]), 'no entry is written by opening the next act');
  const next = step(step(states[j], c), c).log.filter(e => e.kind === 'season').at(-1);
  eq([next.at, next.change], [8, next.money - entry.money], 'the next season starts from the money the jump left');
});

// ---- (9) repair

test('(9) repair drops a malformed post and malformed orders from a save mid-trip, and the game plays on', () => {
  const mid = structuredClone(play(one, seedQ, { choices: { q1: 'wait' }, n: 3 })[2]);   // written in 2: in the post
  ok(mid.post.length === 1 && x0(mid).orders.length === 0);
  const good = mid.post[0];
  const junk = [null, 7, 'x', [], {}, { id: 'q1' }, { ...good, arrive: 'soon' }, { ...good, lag: 0 }, { ...good, kind: 'rumour' }, { ...good, id: 'no-such-letter' }, { ...good, stop: 'atlantis' }, { ...good, agent: 'nobody' }, { ...good, expedition: 7 }, { ...good, written: -1 }];
  const bad = structuredClone(mid);
  bad.post = [...junk, good];
  x0(bad).orders = [null, 'wait', { go: 'press', letter: 'q1', at: 4 }, { go: 'wait', letter: 'q1' }, { go: 'wait', letter: 'q1', at: -2 }, { go: 'on', letter: 7, at: 4 }, { go: 'on', letter: 'q1', at: 4.5 },
    { go: 'wait', letter: 'q1', at: 4 }, { go: 'on', letter: 'q1', at: 5, used: true }, { go: 'wait', letter: 'q1', at: 6, used: 'yes', extra: 1 }];
  const fixed = repair(bad, one);
  eq(fixed.post, mid.post, 'only the sound post entry is left');
  eq(x0(fixed).orders, [{ go: 'wait', letter: 'q1', at: 4 }, { go: 'on', letter: 'q1', at: 5, used: true }, { go: 'wait', letter: 'q1', at: 6 }], 'only the sound orders are left, `used` only as true');
  let s = fixed;
  for (let i = 0; i < 10 && s.phase === 'desk'; i++) s = step(s, one, { q1: 'wait' });   // no throw
  ok(s.t > 5, 'played on');
  eq(repair({ ...structuredClone(mid), post: 'junk' }, one).post, [], 'a post that is not a list');
  const old = structuredClone(mid); delete old.post;
  eq(repair(old, one).post, [], 'a save from before the post has none');
});
test('(9) repair moves the letters an earlier build kept on the expedition into the post', () => {
  const mid = structuredClone(play(one, seedQ, { n: 2 })[2]);
  const entry = mid.post[0];
  const old = structuredClone(mid);
  delete old.post;
  x0(old).post = [{ id: entry.id, kind: entry.kind, stop: entry.stop, leg: 1, written: entry.written, lag: entry.lag, arrive: entry.arrive, def: 'on', delivered: false },
    { id: 'q1', kind: 'question', stop: 's1', leg: 0, written: 0, lag: 1, arrive: 1, def: null, delivered: true }];
  const fixed = repair(old, one);
  eq(fixed.post, mid.post);
  eq('post' in x0(fixed), false);
});

// ---- MER-61: an agent who refuses a wage is offered a share

test('suggestPlan for an agent who refuses an own contract (two unfair memories) suggests a qirad instead of nothing', () => {
  const c = variant(calm, x => { x.city.contracts = { qirad: { agentShare: [1, 3] } }; });
  const s = newGame(c, { seed: 7, length: 'full', house: 'rich' });
  eq(suggestPlan(s, c, 'saltmarsh').contract, 'own', 'with no memory of being wronged it is the house\'s own contract');
  for (const agent of ['mira', 'tobin']) s.agents[agent].memory.push({ at: 0, kind: 'unfair' }, { at: 1, kind: 'unfair' });
  const plan = suggestPlan(s, c, 'saltmarsh');
  ok(plan !== null, 'a plan, not null');
  eq(plan.contract, 'qirad');
  ok(plan.partners >= 1 && plan.partners <= plan.purse, `partners ${plan.partners} put in a purse of ${plan.purse}`);
  eq(checkPlan(s, c, plan).ok, true, 'and it is a plan outfit accepts');
  ok(checkPlan(s, c, { ...plan, contract: 'own' }).reasons.some(r => /qirad share/.test(r)), 'where its own contract is refused in words');
  const none = variant(c, x => { delete x.city.contracts; });
  eq(suggestPlan(s, none, 'saltmarsh'), null, 'a city with no qirad has nothing to suggest');
});

// ---- the whole game

/** One whole game on the trek: an expedition is sent whenever the house has none out, and the questions are answered by turns. */
function wholeGame(c, seed) {
  const way = ['wait', 'on', 'home'];
  const choices = { 'q-road': way[seed % 3], 'q-far': way[(seed + 1) % 3] };
  let s = newGame(c, { seed, length: 'full', house: 'rich' });
  const written = new Set(), asked = new Set();
  let trips = 0;
  while (['desk', 'interlude'].includes(s.phase)) {
    if (s.phase === 'desk' && !s.expeditions.length && s.desk.every(p => p.id !== null)) {
      try { s = outfit(s, c, { ...PLAN, agent: trips % 2 ? 'mira' : 'tobin' }); trips++; } catch { /* nothing to send this season */ }
    }
    s = step(s, c, choices);
    ok(s.desk.length <= MAX_PAPERS);
    for (const p of s.post) (p.kind === 'report' ? written : asked).add(`${p.expedition}:${p.id}:${p.written}`);
  }
  return { s, written, asked, trips };
}
test('a whole-game measure: 100 seeded testport games on the trek draw questions, their answers take effect, and no report is lost', () => {
  const c = writing(trek(calm), question('q-road', at('s1'), { repeat: true }), question('q-far', at('s2'), { repeat: true }), report('r-one', at('s1'), { repeat: true }), report('r-two', at('s2'), { repeat: true, weight: 2 }));
  const t = { trips: 0, asked: 0, answered: 0, took: 0, dropped: 0, written: 0, delivered: 0, lost: 0 };
  for (let seed = 1; seed <= 100; seed++) {
    const { s, written, asked, trips } = wholeGame(c, seed);
    const log = s.log;
    t.trips += trips; t.asked += asked.size; t.written += written.size;
    t.answered += log.filter(e => e.kind === 'card' && /^q-/.test(e.ref)).length;
    t.took += log.filter(e => e.kind === 'order').length;
    t.dropped += log.filter(e => e.kind === 'dropped' && /^order:/.test(e.ref)).length;
    const delivered = log.filter(e => e.kind === 'letter' && /^r-/.test(e.ref)).length;
    t.delivered += delivered;
    t.lost += written.size - delivered - s.post.filter(p => p.kind === 'report').length - log.filter(e => e.kind === 'dropped' && /^r-/.test(e.ref)).length;
  }
  console.log(`  100 games: ${t.trips} expeditions, ${t.asked} questions drawn, ${t.answered} answered, ${t.took} orders took effect, ${t.dropped} dropped; ${t.written} reports written, ${t.delivered} delivered, ${t.lost} lost`);
  ok(t.asked >= 50, `questions drawn: ${t.asked}`);
  ok(t.written >= 100, `reports written: ${t.written}`);
  eq(t.lost, 0, 'no report is lost');
  ok(t.delivered > 0, 'reports are delivered');
  ok(t.took * 2 >= t.answered, `answers that took effect: ${t.took} of ${t.answered}`);
});

// ---- the whole game on cairo

const CAIRO = await loadContent('cairo', { fs });
const GAMES = Number(process.env.LETTER_GAMES ?? 100);
/** One cairo game of `length`: every free agent is sent each season to the next stop in a rotation that starts
    at the seed, every paper is answered by a dice of the test's own, every expedition still out at the end is
    recalled or left by the same dice. Returns the end state and what the post held, by letter. */
function cairoGame(seed, length) {
  const c = CAIRO, rng = { rng: seed * 7919 + 17 }, roll = n => Math.floor(dice(rng) * n);
  const stops = c.stops.filter(st => st.id !== 'cairo').map(st => st.id);
  let s = newGame(c, { seed, length, house: ['spice', 'cloth', 'newcomer'][seed % 3] });
  const seen = new Set();
  let turn = seed;
  const watch = () => { for (const p of s.post) seen.add(`${p.expedition}:${p.id}:${p.written}`); };
  while (['desk', 'interlude'].includes(s.phase)) {
    if (s.phase === 'interlude') { s = openSeason(s, c); continue; }
    for (const p of s.desk) {
      if (p.state !== 'open') continue;
      const all = paperChoices(s, c, p.id).filter(ch => holds(ch.requires, s, c));
      if (all.length) s = choose(s, c, p.id, all[roll(all.length)].id);
    }
    for (const a of c.agents) {
      if (!s.agents[a.id]?.hired || s.agents[a.id].where !== 'cairo' || s.expeditions.some(x => x.agent === a.id)) continue;
      const reach = destinations(s, c, a);
      for (let k = 0; k < stops.length; k++) {
        const stop = stops[(turn + k) % stops.length], hit = reach.find(d => d.stop === stop);
        if (!hit) continue;
        // money only, as the bots send to a road with nothing the house sells
        const plan = { agent: a.id, route: hit.route, cargo: {}, purse: 40, contract: 'own', sell: [], buy: [] };
        try { s = outfit(s, c, plan); turn += k + 1; } catch { continue; }
        break;
      }
    }
    s = endSeason(s, c);
    watch();
  }
  if (s.phase === 'recall') s = recall(s, c, Object.fromEntries(s.expeditions.map(x => [x.id, roll(2) ? 'recall' : 'stay'])));
  return { s, c, written: seen };
}
/** Per letter over `n` games: written, on the desk, orders used, orders dropped; and the reports left in the post at the end. */
function cairoMeasure(n, length) {
  const by = {}, row = id => (by[id] ??= { kind: CAIRO.letters.find(l => l.id === id).kind, written: 0, desk: 0, used: 0, dropped: 0 });
  let answered = 0, took = 0, stranded = 0;
  for (let seed = 1; seed <= n; seed++) {
    const { s, written } = cairoGame(seed, length);
    for (const k of written) row(k.split(':')[1]).written++;
    for (const e of s.log) {
      if (e.kind === 'letter') row(e.ref).desk++;
      else if (e.kind === 'order') { row(e.ref).used++; took++; }
      else if (e.kind === 'dropped' && /^order:/.test(e.ref)) row(e.ref.slice(6)).dropped++;
      else if (e.kind === 'card' && by[e.ref]?.kind === 'question') answered++;
    }
    stranded += s.post.filter(p => p.kind === 'report').length;
  }
  return { by, answered, took, stranded };
}
test(`a cairo measure: ${GAMES} three-act games, at least 80 percent of answered questions take effect, no report written is left undelivered`, () => {
  const m = cairoMeasure(GAMES, 'acts');
  console.log(`  ${GAMES} cairo games: ${m.answered} questions answered, ${m.took} orders took effect, ${m.stranded} reports left in the post`);
  for (const [id, r] of Object.entries(m.by)) console.log(`    ${id.padEnd(24)} ${r.kind[0]} written ${String(r.written).padStart(5)} desk ${String(r.desk).padStart(5)} used ${String(r.used).padStart(4)} dropped ${String(r.dropped).padStart(4)}`);
  ok(m.answered >= GAMES / 4, `questions answered: ${m.answered}`);
  ok(m.took >= 0.8 * m.answered, `answers that took effect: ${m.took} of ${m.answered}`);
  eq(m.stranded, 0, 'no report left in the post at the game\'s end');
});

await done();
