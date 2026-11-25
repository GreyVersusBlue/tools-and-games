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
import { lagOf, writeSeason, truePrice } from '../js/engine/market.js';
import { LETTER_CHANCE, MAX_HOLD, letters, CLAIMS, repeatsRecent, claimsHold, BROKER_MIN, BROKER_MAX, BROKER_SHOWN } from '../js/engine/letters.js';
import { MAX_PAPERS, addPaper } from '../js/engine/state.js';
import { MAX_WAIT, pickEntry } from '../js/engine/routes.js';
import { next as dice } from '../js/engine/rng.js';
import { steps } from '../js/engine/turn.js';
import { repair } from '../js/save.js';
import { playGame } from '../tools/bots.mjs';
import { newGame, openSeason, endSeason, choose, paperChoices, outfit, checkPlan, suggestPlan, destinations, recall, view, sellHomeQuote } from '../js/engine/index.js';

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
  repeat: false, default: 'on', choices: choicesOf(), note: `An invented letter for testing: ${id}.`, sources: [{ src: 'testport-fiction', at: id }], ...over,
});
const report = (id, when, over = {}) => ({
  id, kind: 'report', from: { name: 'The road', role: 'The trek', seal: null }, title: id, body: 'A report from the road.', when, weight: 1, repeat: false,
  happened: [{ stock: 'salt', by: 3 }],
  choices: [{ id: 'right', label: 'You did right', hint: 'Trust.', now: [{ trust: '$agent', by: 1 }] }, { id: 'argue', label: 'You should have argued', hint: 'Less trust.', now: [{ trust: '$agent', by: -1 }] }],
  note: `An invented letter for testing: ${id}.`, sources: [{ src: 'testport-fiction', at: id }], ...over,
});
const writing = (c, ...ls) => variant(c, x => { x.letters = ls; });
const at = stop => ({ at: stop });
/** The same letters with a report's happened effects taken out: a control game, draw for draw. */
const noHappened = c => variant(c, x => { x.letters = x.letters.map(l => (l.kind === 'report' ? { ...l, happened: [] } : l)); });

// ---- playing

const PLAN = { agent: 'tobin', route: 'trek', cargo: { wool: 2 }, purse: 0, contract: 'own', sell: [], buy: [] };
/** A rich house with one expedition sent in season 0. `plan.length` picks the calendar's length. */
const start = (c, seed, { length = 'full', ...plan } = {}) => outfit(newGame(c, { seed, length, house: 'rich' }), c, { ...PLAN, ...plan });
/** The choices of `list` that `choose` takes now: one that costs more money than the house holds is refused (MER-141). */
const takeable = (s, c, p, list) => list.filter(ch => { try { choose(s, c, p.id, ch.id); return true; } catch { return false; } });
/** Answers every open paper: the choice named for its card or letter in `choices`, else the first that is open. */
function pick(s, c, choices = {}) {
  for (const p of s.desk) {
    if (p.state !== 'open') continue;
    const all = takeable(s, c, p, paperChoices(s, c, p.id).filter(ch => holds(ch.requires, s, c)));
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
  // MER-78: the seed must also be one where the third leg is lost (a risk of 1 is clamped to 0.95, and a draw moved by the new deal rode it safely)
  const seedR = seedFor(rep, st => everPosted(st, 'r1') && st[st.findIndex(s => posted(s, 'r1')) + 1]?.expeditions.length === 0, { n: 6 });
  const lost = play(rep, seedR, { n: 6 }), control = play(noHappened(rep), seedR, { n: 6 });
  const w = lost.findIndex(s => posted(s, 'r1'));
  eq(lost[w + 1].expeditions, [], 'the expedition is lost in the season the letter was written, before it arrives');
  ok(lost[w + 1].log.some(e => e.kind === 'lost'), 'logged as lost');
  ok(posted(lost[w + 1], 'r1'), 'the letter is still in the house\'s post');
  const got = lost.findIndex(s => s.desk.some(p => p.ref === 'r1'));
  ok(got > w + 1, 'it reaches the desk after the loss');
  eq(salt(lost[got]) - salt(control[got]), 3, 'the happened effect applies');
  const ask = writing(lossy(calm), question('q1', at('s2')));
  const seedQ = seedFor(ask, st => everPosted(st, 'q1') && st[st.findIndex(s => posted(s, 'q1')) + 1]?.expeditions.length === 0, { n: 7 });   // MER-78: and the third leg is lost, as above
  const q = play(ask, seedQ, { choices: { q1: 'home' }, n: 7 });
  const arrived = q.findIndex(s => s.desk.some(p => p.ref === 'q1'));
  ok(arrived > 0 && q[arrived].expeditions.length === 0, 'the question reaches the desk of a house whose expedition is gone');
  const d = drops(q[arrived + 1], 'order:q1');
  eq(d.length, 1, 'answering it logs the order as dropped');
  eq(d[0].at, arrived, 'in the season it was answered');
  eq(q[arrived + 1].log.filter(e => e.kind === 'card' && e.ref === 'q1').length, 1, 'the answer still counts at the desk');
});
test('(1, MER-123) a letter in the post when the act jump settles its expedition is dropped and logged, not delivered years late', () => {
  const c = writing(trek(calm, { end: 10 }), report('r1', at('s1')));
  const opts = { plan: { length: 'acts' }, n: 4 };
  // pool no longer writes such a letter, so one is put in the post by hand the way a save from an earlier build holds it
  const first = play(c, 1, { ...opts, n: 2 });
  const s2 = structuredClone(first[2]);
  s2.post.push({ id: 'r1', kind: 'report', expedition: x0(s2).id, agent: x0(s2).agent, stop: 's1', standing: true, written: 2, lag: 1, arrive: 3 });
  const control = structuredClone(first[2]);
  const run = s => { const out = [s]; for (let i = 0; i < 3 && ['desk', 'interlude'].includes(out.at(-1).phase); i++) out.push(step(out.at(-1), c, {})); return out; };
  const states = run(s2), ctl = run(control);
  const j = states.findIndex(s => s.phase === 'interlude');
  ok(j > 0, 'the jump came');
  ok(states.every(s => !s.desk.some(p => p.ref === 'r1')), 'never on the desk');
  eq(states.at(-1).post, [], 'and no longer in the post');
  const gone = drops(states.at(-1), 'r1');
  eq(gone.length, 1, 'the log says it was dropped, once');
  ok(/act that ended/.test(gone[0].reason), gone[0].reason);
  eq(salt(states.at(-1)), salt(ctl.at(-1)), 'its happened did not apply');
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
test('one letter at most for an expedition in a season, whatever the pool holds', () => {
  const c = writing(trek(calm), report('r1', at('s2'), { repeat: true }), report('r2', at('s2'), { repeat: true }), question('q1', at('s2'), { repeat: true }));
  for (let seed = 1; seed <= 200; seed++) {
    const states = play(c, seed, { n: 3 });          // season 3 is the one opening where the expedition stands at s2
    const byWritten = {};
    for (const s of states) for (const p of s.post) (byWritten[`${p.expedition}@${p.written}`] ??= new Set()).add(p.id);
    for (const ids of Object.values(byWritten)) ok(ids.size <= 1, `seed ${seed}: ${[...ids]}`);
  }
});
// MER-78 (DESIGN 2.1 rule 5): the plain chance is LETTER_CHANCE; a trip that has written nothing gains SILENT_RAMP for each
// opening it could have written at. On the trek a one-season leg means the expedition stands at s1 in season 2 (the first
// opening it can write at), at s2 in season 3, and so on, so every opening from 2 has a letter to write.
const everyStop = () => writing(trek(calm), ...[1, 2, 3, 4, 5].map(i => report(`r${i}`, at(`s${i}`), { repeat: true })));
const wroteAt = (states, season) => states.some(s => s.post.some(p => p.written === season));
const tripsOf = (c, seeds, n) => Array.from({ length: seeds }, (_, i) => play(c, i + 1, { n }));
test('the plain chance: about half of the first openings a trip can write at do', () => {
  const trips = tripsOf(everyStop(), 400, 2), wrote = trips.filter(st => wroteAt(st, 2)).length;
  ok(wrote > 160 && wrote < 240, `${wrote} of 400 first openings wrote; the chance is ${LETTER_CHANCE}`);
});
test('a trip that has written nothing is surer at each opening and is sure by its third', () => {
  const quiet = tripsOf(everyStop(), 600, 4).filter(st => !wroteAt(st, 2));
  const third = quiet.filter(st => wroteAt(st, 3)).length;
  ok(quiet.length > 240 && third / quiet.length > 0.65 && third / quiet.length < 0.85, `${third} of ${quiet.length} trips quiet at the first opening wrote at the second (three in four expected)`);
  const still = quiet.filter(st => !wroteAt(st, 3));
  ok(still.length > 20, `${still.length} trips were quiet twice`);
  eq(still.filter(st => !wroteAt(st, 4)).length, 0, 'every trip quiet at two openings writes at the third');
});
test('once a trip has written, its chance falls back to the plain one, however quiet it was before', () => {
  // quiet at the first opening, then wrote at the second: the ramp is spent, so the third opening is an ordinary draw
  const late = tripsOf(everyStop(), 800, 4).filter(st => !wroteAt(st, 2) && wroteAt(st, 3)), again = late.filter(st => wroteAt(st, 4)).length;
  ok(late.length > 200 && again / late.length > 0.38 && again / late.length < 0.62, `${again} of ${late.length} trips that wrote at their second opening wrote again at the third (half expected)`);
});
test('(MER-82) a trip with a single writing opening writes there for sure the first time, whatever the seed', () => {
  // one stop: the expedition stands at s1 in season 2, the only opening it has; a half chance would miss it about every other game
  const c = writing(trek(calm, { n: 1 }), report('r1', at('s1'), { repeat: true }));
  for (let seed = 1; seed <= 60; seed++) ok(wroteAt(play(c, seed, { n: 4 }), 2), `seed ${seed}: no letter at the only opening`);
});
test('(MER-82) the sure opening is the last one a trip has: with a later opening the first stays a draw', () => {
  const trips = tripsOf(everyStop(), 400, 2);
  const wrote = trips.filter(st => wroteAt(st, 2)).length;
  ok(wrote > 160 && wrote < 240, `${wrote} of 400 first openings of a five-stop trek wrote; only the last opening is sure`);
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
  eq([t.desk.length, t.post.length, salt(t)], [MAX_PAPERS - 1, 1, had], 'one place is not enough: a letter that moves goods needs one for its Accounts line too (MER-134)');
  t.desk.pop();
  letters(t, c);
  eq([t.desk.length, t.desk.at(-2).ref, t.desk.at(-1).kind, t.post.length, salt(t)], [MAX_PAPERS, 'r1', 'accounts', 0, had + 3]);
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
test('(1c, MER-123) a report that would arrive after the act it is written in is never written; the full length, which has no gap, writes it', () => {
  const c = writing(trek(calm, { end: 10 }), report('r2', at('s1')));
  const seeds = Array.from({ length: 60 }, (_, i) => i + 1);
  const drawn = length => seeds.filter(sd => everPosted(play(c, sd, { plan: { length }, n: 4 }), 'r2'));
  eq(drawn('acts').filter(sd => play(c, sd, { plan: { length: 'acts' }, n: 4 }).some(s => posted(s, 'r2')?.written === 2)), [], 'written in season 2 (the act\'s last), it would reach the desk in season 3 or later');
  ok(drawn('full').length > 10, 'the same letter, the same seeds, no gap: written');
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
// ---- MER-78: the first question is sure, and the return says what an order changed

test('(MER-78) the first question a house can be asked is written whatever the weights and the chance', () => {
  const c = writing(trek(calm), report('r1', at('s1'), { weight: 1000, repeat: true }), question('q1', at('s1'), { weight: 1 }));
  for (let seed = 1; seed <= 100; seed++) eq(play(c, seed, { n: 2 }).at(-1).post.map(p => p.id), ['q1'], `seed ${seed}: season 2 is the first opening the expedition stands at s1`);
});
test('(MER-78) city.json\'s secondSeason.letter is the sure question when it can be written', () => {
  const c = variant(writing(trek(calm), question('q1', at('s1')), question('q2', at('s1'))), x => { x.city.secondSeason = { letter: 'q2' }; });
  for (let seed = 1; seed <= 60; seed++) eq(play(c, seed, { n: 2 }).at(-1).post.map(p => p.id), ['q2'], `seed ${seed}`);
});
test('(MER-78) after the first question, a question is an ordinary draw again', () => {
  const c = writing(trek(calm), question('q1', at('s1')), report('r2', at('s2'), { weight: 1000, repeat: true }), question('q2', at('s2'), { weight: 1 }));
  let q2 = 0;
  for (let seed = 1; seed <= 200; seed++) q2 += play(c, seed, { n: 3 }).at(-1).post.filter(p => p.id === 'q2').length;   // season 3: at s2
  ok(q2 <= 5, `q2 weighs 1 against 1000 and was written ${q2} times in 200 games`);
});
const returnOf = states => states.flatMap(s => s.desk).find(p => p.kind === 'return');
test('(MER-78) a return whose order changed what the expedition did says so first: a turn-back', () => {
  const p = returnOf(play(one, seedQ, { choices: { q1: 'home' }, n: 12 }));
  ok(/^Because you told [A-Z][a-z]+ to turn back at Stop 4, the mule train came home from there\. [A-Z][a-z]+ came home from Stop 4\./.test(p.data.headline), p.data.headline);
  eq(p.data.orderLine, p.data.headline.slice(0, p.data.orderLine.length), 'the line is also kept apart');
  eq(p.data.trip.orders.map(o => [o.letter, o.go, o.stop, o.did, o.changed]), [['q1', 'home', 's4', 'home', true]]);
});
test('(MER-78) a return whose order changed what the expedition did says so first: a wait', () => {
  const p = returnOf(play(one, seedQ, { choices: { q1: 'wait' }, n: 16 }));
  ok(/^Because you told [A-Z][a-z]+ to wait at Stop 4, the mule train waited a season there before going on\. /.test(p.data.headline), p.data.headline);
});
test('(MER-78) an order that changed nothing leaves no line: a bold agent told to go on was going on', () => {
  const p = returnOf(play(one, seedQ, { choices: { q1: 'on' }, n: 12 }));
  eq([p.data.orderLine, p.data.trip.orders.map(o => [o.go, o.changed])], [null, [['on', false]]]);
  ok(/^[A-Z][a-z]+ came home from Stop 5\./.test(p.data.headline), p.data.headline);
});
test('(MER-78) a return with no order has none', () => {
  const p = returnOf(play(writing(trek(calm)), 3, { n: 12 }));
  eq([p.data.orderLine, p.data.trip.orders], [null, []]);
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
function cairoGame(seed, length, onOpen) {
  const c = CAIRO, rng = { rng: seed * 7919 + 17 }, roll = n => Math.floor(dice(rng) * n);
  const stops = c.stops.filter(st => st.id !== 'cairo').map(st => st.id);
  let s = newGame(c, { seed, length, house: ['spice', 'cloth', 'newcomer'][seed % 3] });
  const seen = new Set();
  let turn = seed, late = 0;
  const watch = () => { for (const p of s.post) seen.add(`${p.expedition}:${p.id}:${p.written}`); };
  while (['desk', 'interlude'].includes(s.phase)) {
    if (s.phase === 'interlude') { s = openSeason(s, c); continue; }
    for (const p of s.desk) {
      if (p.state !== 'open') continue;
      const all = takeable(s, c, p, paperChoices(s, c, p.id).filter(ch => holds(ch.requires, s, c)));
      if (all.length) s = choose(s, c, p.id, all[roll(all.length)].id);
    }
    for (const a of c.agents) {
      if (!s.agents[a.id]?.hired || s.agents[a.id].where !== 'cairo' || s.expeditions.some(x => x.agent === a.id)) continue;
      const reach = destinations(s, c, a);
      for (let k = 0; k < stops.length; k++) {
        const stop = stops[(turn + k) % stops.length], hit = reach.find(d => d.stop === stop);
        if (!hit) continue;
        // money only, as the bots send to a road with nothing the house sells, and one good to bring back with it
        // (DESIGN 2.2 rule 1: money with no good named is refused once routes.js RULES.refuseUnspentMoney is on)
        const back = Object.keys(s.market[stop] ?? {}).find(g => s.market.cairo?.[g]);
        const plan = { agent: a.id, route: hit.route, cargo: {}, purse: 40, contract: 'own', sell: [], buy: back ? [back] : [] };
        try { s = outfit(s, c, plan); turn += k + 1; } catch { continue; }
        break;
      }
    }
    s = endSeason(s, c);
    watch();
    for (const p of s.desk) if (p.kind === 'letter') late = Math.max(late, p.reached - p.written);
    if (onOpen?.(s)) return { s, c, written: seen, late };
  }
  if (s.phase === 'recall') s = recall(s, c, Object.fromEntries(s.expeditions.map(x => [x.id, roll(2) ? 'recall' : 'stay'])));
  return { s, c, written: seen, late };
}
/** Per letter over `n` games: written, on the desk, orders used, orders dropped; and the reports left in the post at the end. */
function cairoMeasure(n, length) {
  const by = {}, row = id => (by[id] ??= { kind: CAIRO.letters.find(l => l.id === id).kind, written: 0, desk: 0, used: 0, dropped: 0 });
  let answered = 0, took = 0, stranded = 0, late = 0;
  for (let seed = 1; seed <= n; seed++) {
    const { s, written, late: l } = cairoGame(seed, length);
    late = Math.max(late, l);
    for (const k of written) row(k.split(':')[1]).written++;
    for (const e of s.log) {
      if (e.kind === 'letter') row(e.ref).desk++;
      else if (e.kind === 'order') { row(e.ref).used++; took++; }
      else if (e.kind === 'dropped' && /^order:/.test(e.ref)) row(e.ref.slice(6)).dropped++;
      else if (e.kind === 'card' && by[e.ref]?.kind === 'question') answered++;
    }
    stranded += s.post.filter(p => p.kind === 'report').length;
  }
  return { by, answered, took, stranded, late };
}
test(`a cairo measure: ${GAMES} three-act games, at least 80 percent of answered questions take effect, no report written is left undelivered`, () => {
  const m = cairoMeasure(GAMES, 'acts');
  console.log(`  ${GAMES} cairo games: ${m.answered} questions answered, ${m.took} orders took effect, ${m.stranded} reports left in the post`);
  for (const [id, r] of Object.entries(m.by)) console.log(`    ${id.padEnd(24)} ${r.kind[0]} written ${String(r.written).padStart(5)} desk ${String(r.desk).padStart(5)} used ${String(r.used).padStart(4)} dropped ${String(r.dropped).padStart(4)}`);
  ok(m.answered >= GAMES / 4, `questions answered: ${m.answered}`);
  ok(m.took >= 0.8 * m.answered, `answers that took effect: ${m.took} of ${m.answered}`);
  eq(m.stranded, 0, 'no report left in the post at the game\'s end');
  ok(m.late <= 6, `the slowest letter took ${m.late} seasons from writing to the desk (a letter that crossed the act jump took ten years)`);
});

test('(MER-88) a later effect set by a letter\'s answer is named on the Accounts paper by the letter and the answer', () => {
  const c = writing(trek(calm), question('q1', at('s2'), { title: 'The wind at Stop 2', choices: choicesOf().map(ch => (ch.id === 'on' ? { ...ch, later: [{ in: 1, do: [{ money: 5 }] }] } : ch)) }));
  const seed = seedFor(c, st => st.some(s => s.desk.some(p => p.ref === 'q1')), { n: 8 });
  const states = play(c, seed, { choices: { q1: 'on' }, n: 10 });
  const items = states.flatMap(s => s.desk).filter(p => p.kind === 'accounts').flatMap(p => p.items);
  const item = items.find(i => i.from === 'q1/on');
  ok(item, 'the effect fired onto the Accounts paper');
  eq([item.card, item.choice], ['The wind at Stop 2', 'Go on']);
});

// ---- MER-88: a turn-back answer turns the agent back, or the paper says in one sentence why it did not
const lossy = (risk, stop) => writing(variant(trek(calm, { risk }), x => { x.city.jump = { wholeLoss: 1 }; }), question('q1', at(stop)));
const lostOf = states => states.flatMap(s => s.desk).find(p => p.kind === 'lost');
test('(MER-88) a loss that overtook a turn-back answer says the answer had not reached the agent, and where the loss struck', () => {
  const c = lossy({ 4: 1 }, 's2');
  const seed = seedFor(c, st => /had not reached/.test(lostOf(st)?.data.orderLine ?? ''), { choices: { q1: 'home' }, n: 10 });
  const p = lostOf(play(c, seed, { choices: { q1: 'home' }, n: 10 }));
  eq(p.data.orderLine, 'You told Tobin to turn back, but the answer had not reached Tobin when the mule train was lost on the way from Stop 4 to Stop 5.');
  ok(p.data.lines.some(l => l.label === 'Your order' && l.text === p.data.orderLine), 'the paper prints it as a line');
});
test('(MER-88) a loss on the leg after the answer reached the agent says where the answer found it', () => {
  const c = lossy({ 3: 1 }, 's1');
  const seed = seedFor(c, st => /before there was a stop to turn back at/.test(lostOf(st)?.data.orderLine ?? ''), { choices: { q1: 'home' }, n: 10 });
  const p = lostOf(play(c, seed, { choices: { q1: 'home' }, n: 10 }));
  eq(p.data.orderLine, 'You told Tobin to turn back, and the answer reached Tobin at Stop 3, but the mule train was lost on the way from Stop 3 to Stop 4 before there was a stop to turn back at.');
});
test('(MER-88) an answer that reached an agent already on the road home says there was nowhere to turn back to', () => {
  const c = lossy({ 3: 1 }, 's2');
  const seed = seedFor(c, st => /already on the road home/.test(lostOf(st)?.data.orderLine ?? ''), { choices: { q1: 'home' }, n: 10 });
  const p = lostOf(play(c, seed, { choices: { q1: 'home' }, n: 10 }));
  ok(/^You told Tobin to turn back at Stop \d, but the mule train was already on the road home, so there was nowhere to turn back to\.$|was already on the road home when the mule train was lost/.test(p.data.orderLine), p.data.orderLine);
});
test('(MER-88) over sixty games, every turn-back answer given to a living expedition ends in a turn or a sentence on its paper', () => {
  let checked = 0, turned = 0;
  for (const risk of [{}, { 3: 0.5 }]) for (const stop of ['s1', 's2', 's3']) {
    const c = lossy(risk, stop);
    for (let seed = 1; seed <= 10; seed++) {
      const states = play(c, seed, { choices: { q1: 'home' }, n: 14 });
      const answered = states.find(s => s.desk.some(p => p.ref === 'q1' && s.expeditions.some(x => x.id === p.expedition)));
      if (!answered) continue;
      const paper = states.flatMap(s => s.desk).find(p => (p.kind === 'return' || p.kind === 'lost') && p.expedition === answered.desk.find(q => q.ref === 'q1').expedition);
      if (!paper) continue;
      checked++;
      const line = paper.data.orderLine;
      ok(typeof line === 'string' && /turn back/.test(line), `seed ${seed}, ${JSON.stringify(risk)}, ${stop}: a ${paper.kind} paper with no word on the turn-back answer (${line})`);
      if (/came home from there/.test(line)) turned++;
    }
  }
  ok(checked >= 20, `only ${checked} games gave a turn-back answer to a living expedition`);
  ok(turned >= 1, 'some of them turned');
});

// ---- (MER-118) a letter about a trip never reaches the desk after that trip's return paper

/** For every opening in a played game: each letter on the desk must be ahead of its trip's return paper, and no letter may be
    on the desk in a season after the one the trip's return was written in. The return season is read from the log, the
    letter's from the opening it is on the desk at; nothing is read from the post. Returns the faults and how many letters and
    returns had a pair to compare. */
function afterReturn(states, c) {
  const faults = [], seen = { sameSeason: 0, later: 0, letters: 0 };
  const homeAt = {};
  for (const s of states) {
    for (const e of s.log) {
      if (e.kind === 'return') homeAt[e.ref] = e.at;
      if (e.kind === 'jump') for (const l of e.settled) if (l.result === 'home') homeAt[l.expedition] = e.at;
    }
    const i = idx(s, c);
    s.desk.forEach((p, k) => {
      if (p.kind !== 'letter') return;
      seen.letters++;
      const back = homeAt[p.expedition];
      if (back === undefined) return;
      if (back < i) faults.push(`${p.ref} (${p.expedition}) on the desk in season ${i}, its return paper in season ${back}`);
      else {
        const r = s.desk.findIndex(q => q.kind === 'return' && q.expedition === p.expedition);
        if (r >= 0) { seen.sameSeason++; if (r < k) faults.push(`${p.ref} (${p.expedition}) sits after its return paper in season ${i}`); }
      }
    });
  }
  return { faults, seen };
}

// reports at four stops, a question at the first, on a road of five stops where a leg is a season but the far ones are two
const longRoad = () => writing(trek(calm, { n: 5, end: 23, lens: { 3: 2, 5: 2 } }),
  question('q1', at('s1')), report('r1', at('s1')), report('r2', at('s2')), report('r3', at('s3')), report('r4', at('s4')), report('r5', at('s5')));
const GOES_BY_SEED = ['on', 'home', 'wait'];

test('(MER-118) over 240 seeded games, no letter about an expedition is on the desk after, or behind, that expedition\'s return paper', () => {
  const c = longRoad();
  const total = { sameSeason: 0, letters: 0 };
  const bad = [];
  for (let seed = 1; seed <= 240; seed++) {
    // the third of the games each answer the question with a different order, so a trip comes home early, late or on time;
    // a fourth of them are in the "acts" length, where the jump settles a trip and leaves its letters in the post
    const length = seed % 4 === 0 ? 'acts' : 'full';
    const states = play(c, seed, { plan: { length, route: 'trek' }, choices: { q1: GOES_BY_SEED[seed % 3] }, n: 16 });
    const { faults, seen } = afterReturn(states, c);
    total.sameSeason += seen.sameSeason; total.letters += seen.letters;
    for (const f of faults) bad.push(`seed ${seed}: ${f}`);
  }
  eq(bad.slice(0, 5), [], `${bad.length} letters out of place`);
  ok(total.letters >= 300, `only ${total.letters} letters reached a desk in 240 games`);
  ok(total.sameSeason >= 20, `only ${total.sameSeason} letters shared a desk with their return paper, so the same-season case is not tested`);
});

test('(MER-118) a letter that could only come after its trip\'s return paper is dropped and logged, not delivered', () => {
  // a trip told to turn back at once is home sooner than the road's plan: the letters written before the order that are
  // still on the way arrive behind the return, and the log names each one
  const c = longRoad();
  let dropped = 0, delivered = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const states = play(c, seed, { plan: { route: 'trek' }, choices: { q1: 'home' }, n: 16 });
    const last = states.at(-1);
    const gone = last.log.filter(e => e.kind === 'dropped' && /return paper/.test(e.reason ?? ''));
    dropped += gone.length;
    for (const e of gone) ok(!last.log.some(l => l.kind === 'letter' && l.ref === e.ref && l.at >= e.at), `seed ${seed}: ${e.ref} dropped and also delivered`);
    delivered += last.log.filter(e => e.kind === 'letter').length;
  }
  ok(dropped >= 1, `only ${dropped} letters were dropped in 120 games with a turn-back answer`);
  ok(delivered > dropped, 'most letters still arrive');
});

// ---- MER-123: letters and cards that tell the truth

test('(MER-123) a letter that says the agent sold is written only by an expedition that carries something to sell', () => {
  const c = writing(trek(calm), report('r1', at('s1')));
  const seeds = Array.from({ length: 40 }, (_, i) => i + 1);
  CLAIMS.r1 = { sells: true };
  try {
    const wrote = plan => seeds.filter(sd => everPosted(play(c, sd, { plan, n: 4 }), 'r1'));
    eq(wrote({ cargo: {}, purse: 40, buy: ['wool'] }), [], 'money only: nothing to sell, never written');
    ok(wrote({ cargo: { wool: 2 } }).length > 5, 'with wool: written (the same seeds)');
    CLAIMS.r1 = { sells: ['salt'] };
    eq(wrote({ cargo: { wool: 2 } }), [], 'a letter about salt from a party carrying wool: never written');
    ok(wrote({ cargo: { salt: 2 } }).length > 5, 'with salt: written');
  } finally { delete CLAIMS.r1; }
  ok(claimsHold({ id: 'no-claim' }, { cargo: {} }), 'a letter with no claim is not held back');
  eq(CLAIMS, {}, 'the table is empty until the routes and venture pins are moved: see the comment on CLAIMS');
});

test('(MER-123) a letter is not written when a card or letter with the same note reached the desk in the last two seasons', () => {
  const s = newGame(CAIRO, { seed: 3, length: 'full', house: 'spice' });
  // MER-128: the card and the letter tell different facts now, so the case gives the card the letter's note on a copy of the content
  const content = structuredClone(CAIRO), sacks = content.letters.find(l => l.id === 'constantinople-sacks'), idx = seasonIndex(s, CAIRO);
  content.cards.find(c => c.id === 'broker-linen-constantinople').note = sacks.note;
  eq(repeatsRecent(s, content, sacks, idx, 1), false, 'nothing told yet');
  s.log.push({ at: idx, kind: 'card', ref: 'broker-linen-constantinople' });   // the card that shares its note and its source line
  eq(repeatsRecent(s, content, sacks, idx, 1), true, 'the card told it this season');
  s.log.at(-1).at = idx - 1;
  eq(repeatsRecent(s, content, sacks, idx, 1), true, 'and last season');
  s.log.at(-1).at = idx - 2;
  eq(repeatsRecent(s, content, sacks, idx, 1), false, 'two seasons ago is far enough');
  s.log.at(-1).ref = 'opening-letter';
  s.log.at(-1).at = idx;
  eq(repeatsRecent(s, content, sacks, idx, 1), false, 'a card with another note does not count');
  s.post.push({ id: 'broker-linen-constantinople', arrive: idx + 1 });
  eq(repeatsRecent(s, content, sacks, idx, 1), true, 'a letter in the post for the season it would arrive in counts');
});

/** A cairo state with a return paper on the desk, and the paper. Searched over seeds; fails if none has one. */
function homeState() {
  for (let seed = 1; seed <= 60; seed++) {
    const { s } = cairoGame(seed, 'acts', st => st.desk.some(p => p.kind === 'return' && p.data?.account));
    const p = s.desk.find(q => q.kind === 'return' && q.data?.account);
    if (p) return { s: structuredClone(s), p: s.desk.indexOf(p) };
  }
  throw new Error('no cairo game in the search brought a trip home');
}
/** The facts the return paper at `k` of a state carries, set by hand: sold rows or none, the net and the hope. */
function facts(base, k, { sold = true, net, hoped = null, agent = 'ali', lost = false }) {
  const s = structuredClone(base), p = s.desk[k];
  p.agent = agent; p.data.houseNet = net; p.data.hoped = hoped;
  p.data.account = p.data.account.filter(r => r.label !== 'Sold');
  if (sold) p.data.account.push({ label: 'Sold', text: '1 load', amount: 80, detail: true });
  if (lost) p.data.account.push({ label: 'Lost', text: '2 loads of pepper' });
  s.agents[agent].hired = true;
  return s;
}
const reopen = (s, c) => { letters(s, c); return s; };

test('(MER-123) the facts a card\'s words rely on are written when a trip comes home: the net, "undersold" only after a sale that fell short of the hope', () => {
  const { s: base, p: k } = homeState();
  const flagsOf = (o, agent = 'ali') => { const s = reopen(facts(base, k, { agent, ...o }), CAIRO); return { profit: s.flags[`${agent}-profit`], undersold: !!s.flags[`${agent}-undersold`] }; };
  eq(flagsOf({ net: -12, hoped: 6 }), { profit: -12, undersold: true }, 'sold, and made less than hoped');
  eq(flagsOf({ net: 24, hoped: 6 }), { profit: 24, undersold: false }, 'beat its estimate: not undersold (the play\'s case)');
  eq(flagsOf({ net: -12, hoped: 6, sold: false }), { profit: -12, undersold: false }, 'sold nothing, only bought: not undersold (the play\'s other case)');
  eq(flagsOf({ net: -12, hoped: null }), { profit: -12, undersold: false }, 'no estimate to fall short of');
  const cleared = reopen(facts(base, k, { net: 5, hoped: 9 }), CAIRO);
  cleared.desk.splice(k, 1);
  eq([cleared.flags['ali-undersold'], cleared.flags['ali-profit']].map(Boolean), [true, true], 'set until the next opening');
  reopen(cleared, CAIRO);
  eq([cleared.flags['ali-undersold'], cleared.flags['ali-profit']], [undefined, undefined], 'and cleared at the next one, when no trip of his is home');
});

test('MER-139 (4) a trip the road robbed is not "undersold": the lost paper has already said where the shortfall went, and no second paper blames Ali\'s selling', () => {
  const { s: base, p: k } = homeState();
  const undersold = o => !!reopen(facts(base, k, { net: -12, hoped: 6, ...o }), CAIRO).flags['ali-undersold'];
  eq(undersold({}), true, 'the same trip with nothing lost is still undersold');
  eq(undersold({ lost: true }), false, 'robbers took part of the cargo: the road, not the selling');
});

test('(MER-123) "Ali and the price" is drawn only after a sale that fell short; its words no longer give a loss or a number', () => {
  const { s: base, p: k } = homeState(), card = CAIRO.cards.find(c => c.id === 'ali-beyond-the-paper');
  const when = o => holds(card.when, reopen(facts(base, k, o), CAIRO), CAIRO);
  eq(when({ net: -12, hoped: 6 }), true);
  eq(when({ net: 24, hoped: 6 }), false, 'a trip that beat its estimate');
  eq(when({ net: -12, hoped: 6, sold: false }), false, 'a trip that sold nothing');
  ok(!/lost about \d+|\d+ dinars/.test(card.body), card.body);
  ok(JSON.stringify(card.when).includes('ali-undersold'), 'the card requires the fact');
});

test('(MER-123) "Yusuf is home with news" says he was told he could go further, and only after that was told during this trip', () => {
  const { s: base, p: k } = homeState(), card = CAIRO.cards.find(c => c.id === 'yusuf-aleppo');
  const sent = base.log.find(e => e.kind === 'outfit' && e.ref === base.desk[k].expedition)?.at;
  ok(Number.isInteger(sent), 'the paper\'s trip has an outfit line');
  const widened = given => { const s = facts(base, k, { agent: 'yusuf', net: 10, hoped: 5 }); s.flags['yusuf-widened'] = given; reopen(s, CAIRO); return !!s.flags['yusuf-widened-trip']; };
  eq(widened(sent), true, 'told in the season he left');
  eq(widened(sent + 1), true, 'told while he was out');
  eq(widened(sent - 1), false, 'told before he left, on an earlier trip: not this one');
  eq(widened(undefined), false, 'never told');
  const drawn = given => { const s = facts(base, k, { agent: 'yusuf', net: 10, hoped: 5 }); s.flags['yusuf-widened'] = given; return holds(card.when, reopen(s, CAIRO), CAIRO); };
  eq([drawn(sent), drawn(sent - 1), drawn(undefined)], [true, false, false], 'the card itself is drawn only for a permission given during this trip');
  ok(/You told him he could go further/.test(card.body) && !/You let him go further/.test(card.body), card.body);
});

test('(MER-123) the loss paper blames bad luck only when goods were lost on the road; a loss from the price says something else', () => {
  const { s, p } = homeState(), k = p;
  const pick = lost => pickEntry(s, CAIRO, 'return', { outcome: 'loss', agent: 'yusuf', to: 'damascus', good: 'pepper', seasons: 3, orders: false, contract: 'own', lost, brought: true });
  eq(pick(true)?.id, 'return-loss-forgive');
  eq(pick(false)?.id, 'return-loss-price');
  ok(/bad luck/.test(pick(true).body), 'when the road took goods, bad luck is said');
  ok(!/bad luck|road was/.test(pick(false).body), pick(false).body);
  ok(k >= 0);
});

test('(MER-123) a return paper\'s bonus is never above the profit: cut to half of it, and left out under two dinars', () => {
  const { s: base, p: k } = homeState();
  const entry = CAIRO.returns.find(e => e.id === 'return-bonus');
  const offer = net => {
    const s = structuredClone(base), p = s.desk[k];
    p.data.houseNet = net; p.data.choices = structuredClone(entry.choices); delete p.data.fitted;
    reopen(s, CAIRO);
    const b = p.data.choices.find(c => c.id === 'bonus');
    return b && { label: b.label, cost: -b.now.find(e => e.money).money, requires: (b.requires.all ?? [b.requires]).find(r => r.money).money.gte };
  };
  eq(offer(13)?.cost, 6, 'the play\'s case: 13 dinars of profit, a bonus of 30 offered; now 6');
  eq(offer(13)?.label, 'Pay {agent} a bonus of 6 dinars');
  eq(offer(13)?.requires, 6, 'the requirement moves with it');
  eq(offer(100)?.cost, 30, 'a profit of 100 pays the bonus as written');
  eq(offer(30)?.cost, 30, 'a profit of 30 is the edge: as written');
  eq(offer(29)?.cost, 14);
  eq(offer(1), undefined, 'a profit of 1 offers none');
  ok(offer(13).cost <= 13);
});

test('(MER-123) the go-further fee is taken at the choosing and the choice needs the money, so the house never goes below 0', () => {
  const { s: base } = homeState();
  const widen = CAIRO.cards.find(c => c.id === 'contract-limits').choices.find(ch => ch.id === 'widen');
  eq([widen.now.find(e => e.money)?.money, widen.requires], [-4, { money: { gte: 4 } }]);
  eq((widen.later ?? []).flatMap(l => l.do ?? []).filter(e => e.money).length, 0, 'no fee left to take later');
  const answer = money => {
    const s = structuredClone(base); s.money = money; s.desk = [];
    addPaper(s, { kind: 'card', ref: 'contract-limits' }); s.desk[0].id = 'tp-0';
    return choose(s, CAIRO, 'tp-0', 'widen');
  };
  eq(answer(4).money, 0, 'with 4 dinars the fee leaves 0');
  throws(() => answer(3), /not available/);
  ok(answer(4).queue.every(q => !(q.do ?? []).some(e => typeof e.money === 'number' && e.money < 0)), 'and nothing queued takes money');
});

test('(MER-123) every card choice that costs money later is closed to a house that cannot pay it', () => {
  const { s: base } = homeState();
  let n = 0;
  for (const card of CAIRO.cards) for (const ch of card.choices) {
    const later = (ch.later ?? []).flatMap(l => l.do ?? []).filter(e => typeof e.money === 'number' && e.money < 0).reduce((a, e) => a - e.money, 0);
    if (!later) continue;
    n++;
    const now = (ch.now ?? []).filter(e => typeof e.money === 'number' && e.money < 0).reduce((a, e) => a - e.money, 0);
    const s = structuredClone(base); s.money = now + later - 1; s.desk = [];
    addPaper(s, { kind: 'card', ref: card.id }); s.desk[0].id = 'tp-0';
    ok(!paperChoices(s, CAIRO, 'tp-0').some(c => c.id === ch.id && holds(c.requires, s, CAIRO)), `${card.id}/${ch.id} is open with ${s.money} dinars and costs ${now + later}`);
  }
  ok(n >= 11, `${n} choices cost money later`);
});

// ---- MER-134: what the papers say matches what moved

/** The home state with its first return paper made into a broker's offer for `entryId`, the home market's price for the good at `f`
    times its base, and the paper's letters step run again. */
function brokerPaper(entryId, f, { shown = 0, stock = null } = {}) {
  const { s: base, p: k } = homeState();
  const s = structuredClone(base), p = s.desk[k], entry = CAIRO.returns.find(e => e.id === entryId), good = entry.facts.good[0];
  s.market.cairo[good].f = f;
  p.data.entry = entryId; p.data.ask = { title: entry.title, body: entry.body }; p.data.choices = structuredClone(entry.choices); delete p.data.fitted;
  if (shown) s.seen[`shown:${entryId}`] = shown;
  if (stock !== null) s.stock[good] = stock;
  reopen(s, CAIRO);
  return { s, p, good, price: truePrice(s, CAIRO, 'cairo', good, idx(s, CAIRO)) };
}
const brokerOf = ({ p, price }) => {
  const m = /take (\w+) loads? today for (\d+) dinars\. That is about (\d+) in every hundred less/.exec(p.data.ask.body ?? '');
  const sell = p.data.choices.find(c => c.id === 'sell');
  const out = sell.now.find(e => typeof e.stock === 'string'), pay = sell.now.find(e => typeof e.money === 'number');
  return { said: Number(m[3]), offer: Number(m[2]), pay: pay.money, loads: -out.by, hint: sell.hint, gap: Math.round((1 - Number(m[2]) / (-out.by * price)) * 100) };
};

test('(MER-134, 7) a broker\'s "about N in every hundred less" is the gap between his offer and the price the house would get now, in every state', () => {
  const said = new Set();
  for (const id of ['return-sell-pepper', 'return-sell-silk', 'return-sell-sugar', 'return-sell-linen']) for (const f of [0.55, 0.8, 0.95, 1, 1.1, 1.3, 1.7]) {
    const b = brokerPaper(id, f), o = brokerOf(b);
    eq(o.said, o.gap, `${id} at ${f}: the words say ${o.said}, the offer ${o.offer} for ${o.loads} against ${b.price} is ${o.gap}`);
    ok(o.said >= BROKER_MIN && o.said <= BROKER_MAX, `${id} at ${f}: ${o.said} in every hundred`);
    eq(o.pay, o.offer, `${id} at ${f}: the money the choice pays is the offer in the words`);
    ok(o.hint.includes(`${o.offer} dinars`), `${id} at ${f}: the hint says ${o.hint}`);
    said.add(`${id}:${o.said}`);
  }
  ok(new Set([...said].filter(k => k.startsWith('return-sell-pepper')).map(k => k.split(':')[1])).size >= 3, 'the number follows the price: pepper says at least three different figures over seven prices');
});

test('(MER-146, 11) a broker\'s offer for goods in the warehouse is never worse than Sell in Cairo for the same loads the same season', () => {
  let raised = 0;
  for (const id of ['return-sell-pepper', 'return-sell-silk', 'return-sell-sugar', 'return-sell-linen']) for (const f of [0.55, 0.8, 0.95, 1, 1.1, 1.3, 1.7, 2]) {
    const b = brokerPaper(id, f, { stock: 6 }), o = brokerOf(b);
    const q = sellHomeQuote(b.s, CAIRO, b.good, o.loads);
    ok(q.ok, `${id} at ${f}: the house holds the loads, so Sell can quote them`);
    ok(o.offer >= q.got, `${id} at ${f}: the broker offers ${o.offer} for ${o.loads} and Sell gives ${q.got}`);
    eq(o.pay, o.offer, `${id} at ${f}: the choice pays what the words offer`);
    ok(o.said >= 0 && o.said <= BROKER_MAX, `${id} at ${f}: still a broker's discount in the words (${o.said} in every hundred)`);
    if (o.offer > o.loads * 0 && q.got > Math.round(o.loads * b.price * (1 - 0.30))) raised++;
  }
  ok(raised > 0, 'at least one price had the broker\'s old sum under Sell, so the case could fail');
});

test('(MER-146, 4) an Accounts paper that takes a letter\'s money line sits behind that letter, even when the paper was on the desk first', () => {
  const base = newGame(CAIRO, { seed: 3, length: 'full', house: 'spice' });
  const s = structuredClone(base), i = idx(s, CAIRO);
  s.desk = []; s.t = 2;
  s.money = 90;
  s.post = [{ id: 'alexandria-twenty-in-a-hundred', kind: 'report', expedition: 'x1', agent: 'yusuf', stop: 'alexandria', standing: true, written: idx(s, CAIRO) - 1, lag: 1, arrive: idx(s, CAIRO) }];
  // the Accounts paper of the season's earlier closing, already on the desk and not yet read
  addPaper(s, { kind: 'accounts', ref: 'accounts', items: [{ from: 'x/y', card: 'A card', choice: 'A choice', changes: ['+5 dinars'], text: 'From A card: +5 dinars' }] });
  steps.letters(s, CAIRO);
  const kinds = s.desk.map(p => p.kind), at = kinds.indexOf('letter'), acc = kinds.indexOf('accounts');
  ok(at >= 0, `the customs letter reached the desk (${kinds})`);
  ok(s.money < 90, 'its forty dinars were taken on arrival, as the letter says');
  ok(s.desk[acc].items.some(it => it.from === 'alexandria-twenty-in-a-hundred'), 'the Accounts paper carries the letter\'s line');
  ok(at < acc, `the letter (desk place ${at}) comes before the Accounts paper that reports its money (desk place ${acc})`);
  ok(i >= 0);
});

test('(MER-146, 7) "Your carters wait at Alexandria" is dealt only while the house has a trip out', () => {
  const card = CAIRO.cards.find(c => c.id === 'harbour-count');
  ok(/carters wait at Alexandria/.test(card.body), 'the card is the one that says it');
  const s = newGame(CAIRO, { seed: 3, length: 'full', house: 'spice' });
  s.rep.court = 0;
  eq([s.expeditions.length, holds(card.when, s, CAIRO)], [0, false], 'nothing is coming: the card is closed');
  s.expeditions.push({ id: 'x1' });
  eq(holds(card.when, s, CAIRO), true, 'a trip is out: it may be dealt');
  // a house that never sends anyone is never told of carters waiting
  for (let seed = 1; seed <= 12; seed++) {
    let g = newGame(CAIRO, { seed, length: 'acts', house: ['spice', 'cloth', 'newcomer'][seed % 3] });
    g.rep.court = 0;
    for (let k = 0; k < 30 && ['desk', 'interlude'].includes(g.phase); k++) {
      if (g.phase === 'interlude') { g = openSeason(g, CAIRO); continue; }
      for (const p of g.desk.filter(q => q.state === 'open')) for (const c of paperChoices(g, CAIRO, p.id)) { try { g = choose(g, CAIRO, p.id, c.id); break; } catch { /* closed */ } }
      g = endSeason(g, CAIRO);
      eq(g.desk.some(p => p.ref === 'harbour-count') && g.expeditions.length === 0 && !g.desk.some(p => p.kind === 'return'), false, `seed ${seed}: no carters with nothing coming`);
    }
  }
});

test('(MER-134, 15) a broker\'s paper is shown twice in a game, and the third time the return carries no offer', () => {
  eq(BROKER_SHOWN, 2);
  const shown = n => brokerPaper('return-sell-pepper', 1, { shown: n }).p.data;
  eq([shown(0).entry, shown(1).entry], ['return-sell-pepper', 'return-sell-pepper']);
  const third = shown(2);
  eq([third.entry, third.ask, third.choices], [null, null, []], 'no offer, no choices');
  eq(brokerPaper('return-sell-pepper', 1, { shown: 0 }).s.seen['shown:return-sell-pepper'], 1, 'and each showing is counted');
});

test('(MER-134, 15) one bonus for one trip: the return paper\'s bonus closes a card\'s bonus, and the card\'s closes the paper\'s', () => {
  const { s: base, p: k } = homeState();
  const agent = base.desk[k].agent;
  const withBonus = () => { const s = structuredClone(base), p = s.desk[k], entry = CAIRO.returns.find(e => e.id === 'return-bonus'); p.data.houseNet = 100; p.data.choices = structuredClone(entry.choices); delete p.data.fitted; reopen(s, CAIRO); return s; };
  const s = withBonus(), p = s.desk[k], bonus = p.data.choices.find(c => c.id === 'bonus');
  ok(holds(bonus.requires, s, CAIRO), 'open before any bonus is paid');
  s.money = Math.max(s.money, 500); p.state = 'open'; if (p.id === null) p.id = 'tp-9';
  const paid = choose(s, CAIRO, p.id, 'bonus');
  ok(`${agent}-bonused` in paid.flags, 'paying it sets the trip\'s flag');
  ok(!holds(bonus.requires, paid, CAIRO), 'and closes the paper\'s own bonus');
  const card = CAIRO.cards.find(c => c.id === 'samir-asks-again' || c.choices.some(ch => ch.id === 'more' && /bonus of 5 dinars/.test(ch.label)));
  const more = card.choices.find(ch => ch.id === 'more');
  const free = structuredClone(paid); delete free.flags['samir-bonused']; free.flags['samir-profit'] = 40; free.money = 500;
  ok(holds(more.requires, free, CAIRO), 'the card\'s 5-dinar bonus is open with a profit and no bonus paid');
  free.flags['samir-bonused'] = 1;
  ok(!holds(more.requires, free, CAIRO), 'and closed once a bonus is paid for the trip');
  const opened = structuredClone(free); opened.flags = {}; reopen(opened, CAIRO);
  const gone = structuredClone(free); reopen(gone, CAIRO);
  ok(!('samir-bonused' in gone.flags), 'the flag is cleared at the next opening, so the next trip can be thanked');
});

test('(MER-134, 9 and 10) money a letter moves goes on an Accounts paper at once, with a true minus sign, and a letter needs room for both', () => {
  const { s: base, p: k } = homeState();
  const arrive = (id, over = {}) => {
    const s = structuredClone(base), ret = s.desk[k];
    s.desk = []; s.log = s.log.filter(e => !(e.kind === 'return' && e.ref === ret.expedition));
    s.post = [{ id, kind: 'report', expedition: 'gone', agent: ret.agent, stop: id === 'qus-sugar-press' ? 'qus' : 'damascus', standing: true, written: idx(s, CAIRO) - 1, lag: 1, arrive: idx(s, CAIRO), ...over }];
    const money = s.money;
    letters(s, CAIRO);
    return { s, gained: s.money - money };
  };
  const paid = arrive('qus-sugar-press'), early = arrive('damascus-early-caravan');
  eq(paid.gained, -30);
  eq(early.gained, 25);
  const acc = paid.s.desk.find(p => p.kind === 'accounts');
  ok(acc, 'an Accounts paper is on the desk');
  eq(acc.items.map(i => i.changes), [['\u221230 dinars']], 'the 30 that left the purse, with a true minus');
  ok(!/-\d/.test(acc.items[0].text), acc.items[0].text);
  ok(acc.items[0].text.includes('A place in the next pressing'), 'and names the letter');
  eq(early.s.desk.find(p => p.kind === 'accounts').items.map(i => i.changes), [['+25 dinars']]);
  ok(paid.s.desk.findIndex(p => p.kind === 'letter') < paid.s.desk.findIndex(p => p.kind === 'accounts'), 'the letter first');
  ok(!CAIRO.letters.find(l => l.id === 'qus-sugar-press').body.includes('claim'), 'the letter no longer says the house has a claim on sugar nothing brings');
  ok(CAIRO.letters.find(l => l.id === 'qus-sugar-press').body.includes('30 of your money'), 'it says what was paid');
  // a second letter in the same season goes on the same paper
  const two = structuredClone(paid.s); two.post = [{ id: 'damascus-early-caravan', kind: 'report', expedition: 'gone2', agent: 'yusuf', stop: 'damascus', standing: true, written: idx(two, CAIRO) - 1, lag: 1, arrive: idx(two, CAIRO) }];
  letters(two, CAIRO);
  eq(two.desk.filter(p => p.kind === 'accounts').length, 1, 'one Accounts paper');
  eq(two.desk.find(p => p.kind === 'accounts').items.length, 2, 'two lines on it');
});

test('(MER-135) one bonus for one trip holds across letters: a letter\'s bonus closes the return paper\'s and every other letter\'s, and it stays closed until the trip is answered', () => {
  const { s: base, p: k } = homeState();
  const ret = base.desk[k], agent = ret.agent;
  const s = structuredClone(base), now = idx(s, CAIRO);
  s.desk = [ret]; s.money = Math.max(s.money, 800);
  s.log = s.log.filter(e => !(e.kind === 'return' && e.ref === ret.expedition));
  const mail = (id, over = {}) => ({ id, kind: 'report', expedition: ret.expedition, agent, stop: 'damascus', standing: true, written: now - 1, lag: 1, arrive: now, ...over });
  s.post = [mail('damascus-early-caravan'), mail('walata-early-sale', { stop: 'walata' })];
  letters(s, CAIRO);
  const open = (st, ref) => { const p = st.desk.find(q => q.ref === ref); return { p, bonus: paperChoices(st, CAIRO, p.id).find(c => c.id === 'bonus') }; };
  const first = open(s, 'damascus-early-caravan'), other = open(s, 'walata-early-sale');
  ok(holds(first.bonus.requires, s, CAIRO) && holds(other.bonus.requires, s, CAIRO), 'both letters\' bonuses are open before one is paid');
  const paid = choose(s, CAIRO, first.p.id, 'bonus');
  ok(`${agent}-bonused` in paid.flags, 'paying a letter\'s bonus sets the trip\'s flag');
  ok(!holds(open(paid, 'walata-early-sale').bonus.requires, paid, CAIRO), 'and closes the other letter\'s bonus');
  const entry = CAIRO.returns.find(e => e.id === 'return-bonus'), paper = paid.desk.find(q => q.kind === 'return');
  paper.data.houseNet = 100; paper.data.choices = structuredClone(entry.choices); delete paper.data.fitted;
  letters(paid, CAIRO);   // the next opening: the flag is read again, with the trip still on the books
  ok(`${agent}-bonused` in paid.flags, 'the flag outlasts the opening while the trip is on the books');
  ok(!holds(paper.data.choices.find(c => c.id === 'bonus').requires, paid, CAIRO), 'so the return paper\'s bonus is closed');
  const done = structuredClone(paid); done.expeditions = done.expeditions.filter(x => x.id !== ret.expedition); done.desk = done.desk.filter(q => q.kind !== 'return'); letters(done, CAIRO);
  ok(!(`${agent}-bonused` in done.flags), 'and is cleared once the trip is answered and gone');
});

test('(MER-135) a second letter in the same opening cannot take the place kept for the Accounts paper of the first one\'s money', () => {
  const { s: base, p: k } = homeState();
  const run = fillers => {
    const s = structuredClone(base), ret = s.desk[k], now = idx(s, CAIRO);
    s.desk = []; s.log = s.log.filter(e => !(e.kind === 'return' && e.ref === ret.expedition));
    for (let i = 0; i < fillers; i++) addPaper(s, { kind: 'notice', ref: `fill${i}` });
    const mk = (id, stop, expedition) => ({ id, kind: id === 'first-road-letter' ? 'question' : 'report', expedition, agent: ret.agent, stop, standing: true, written: now - 1, lag: 1, arrive: now });
    s.post = [mk('damascus-early-caravan', 'damascus', 'gone1'), mk('first-road-letter', 'damascus', 'gone2')];
    letters(s, CAIRO);
    return s;
  };
  const s = run(3);
  eq(s.desk.length, 5, 'three papers, the money letter and its Accounts paper fill the desk');
  eq(s.desk.filter(p => p.kind === 'accounts').length, 1, 'the Accounts paper is on the desk');
  ok(!s.log.some(e => e.kind === 'dropped' && e.ref === 'accounts'), 'and was not dropped for a full desk');
  eq(s.post.map(p => p.id), ['first-road-letter'], 'the second letter waits a season');
  ok(s.desk.every(p => p.ref !== 'first-road-letter'), 'it is not on the desk');
  const roomy = run(2);
  eq(roomy.desk.filter(p => p.ref === 'first-road-letter').length, 1, 'with a place to spare the second letter comes too');
  ok(roomy.desk.some(p => p.kind === 'accounts'), 'and the Accounts paper stays');
});

test('(MER-134, 9) a letter that waited for room does not arrive with the agent who wrote it; one on time still comes ahead of the return paper', () => {
  const { s: base, p: k } = homeState();
  const run = (arrive, written) => {
    const s = structuredClone(base), ret = s.desk[k], now = idx(s, CAIRO);
    s.desk = [ret];   // room for the letter and its Accounts paper
    s.post = [{ id: 'damascus-early-caravan', kind: 'report', expedition: ret.expedition, agent: ret.agent, stop: 'damascus', standing: true, written: written(now), lag: 1, arrive: arrive(now) }];
    letters(s, CAIRO);
    return s;
  };
  const late = run(n => n - 1, n => n - 2);
  ok(!late.desk.some(p => p.ref === 'damascus-early-caravan'), 'a letter that arrived a season ago and waited is not put on the desk beside the return');
  ok(late.log.some(e => e.kind === 'dropped' && e.ref === 'damascus-early-caravan' && /return paper/.test(e.reason)), 'and the log says it was left out');
  eq(late.post, [], 'and it is out of the post');
  const onTime = run(n => n, n => n - 1);
  const names = onTime.desk.map(p => p.ref ?? p.kind);
  ok(names.indexOf('damascus-early-caravan') >= 0 && names.indexOf('damascus-early-caravan') < names.indexOf('return'), `an on-time letter comes before the return: ${names}`);
});


test('(MER-140) a letter that arrived in an earlier season and waited is never put on the desk with its agent\'s return paper, whatever its lag and whenever it was written; one that arrives on the return day still comes ahead', () => {
  const { s: base, p: k } = homeState();
  let dropped = 0, kept = 0;
  for (const lag of [1, 2, 3]) for (const late of [0, 1, 2, 3]) for (const room of [1, 3]) {
    const s = structuredClone(base), ret = s.desk[k], now = idx(s, CAIRO);
    s.desk = [ret];
    while (s.desk.length < MAX_PAPERS - room) s.desk.push({ id: `pad${s.desk.length}`, kind: 'notice', ref: 'pad', state: 'open' });   // `room` places left for the letter and its Accounts paper
    s.post = [{ id: 'damascus-early-caravan', kind: 'report', expedition: ret.expedition, agent: ret.agent, stop: 'damascus', standing: true, written: now - late - lag, lag, arrive: now - late }];
    letters(s, CAIRO);
    const names = s.desk.map(p => p.ref ?? p.kind), where = `lag ${lag}, ${late} seasons late, ${room} places`;
    if (late > 0) { ok(!names.includes('damascus-early-caravan'), `${where}: a letter that waited came with its agent: ${names}`); dropped++; }
    else if (room > 1) { ok(names.indexOf('damascus-early-caravan') >= 0 && names.indexOf('damascus-early-caravan') < names.indexOf('return'), `${where}: ${names}`); kept++; }
  }
  ok(dropped === 18 && kept === 3, `${dropped} late and ${kept} on-time cases were read`);
});

// ---- MER-136: the share of long trips that bring a letter holds its floor, in a check CI runs
// test/mix.mjs measures the same share over 1,000 games and is run by hand. For a week it read 22 percent while the engine gave about 72:
// `deliver` puts a letter ahead of its own trip's return paper (MER-118), and mix.mjs looked for new letters at the end of the desk,
// where the return paper had taken their place. So the papers are compared, not the length of the desk, and this case plays enough
// seeded bot games (36: careful, greedy and qirad in turn, every house) to tell 25 percent from 50: about 110 trips of three seasons or more.
const SHARE_GAMES = 36, SHARE_FLOOR = 0.4;
function letterShare(games) {
  const { letters: orig, returns: ret } = steps;
  let game = null, trips = 0, lettered = 0;
  steps.returns = (s, c, ...a) => {
    const was = new Set(s.desk);
    ret(s, c, ...a);
    for (const p of s.desk) if (!was.has(p) && p.kind === 'return' && p.data?.trip?.seasons >= 3) game.home.push(p.expedition);
  };
  steps.letters = (s, c, ...a) => {
    const was = new Set(s.desk);       // not the desk's length: a letter is put ahead of its trip's return paper
    orig(s, c, ...a);
    for (const p of s.desk) if (!was.has(p) && p.kind === 'letter') game.wrote.add(p.expedition);
  };
  try {
    for (let i = 0; i < games; i++) {
      game = { home: [], wrote: new Set() };
      playGame(CAIRO, { bot: ['careful', 'greedy', 'qirad'][i % 3], seed: 1000 + i, house: CAIRO.houses[i % CAIRO.houses.length].id });
      trips += game.home.length;
      lettered += game.home.filter(id => game.wrote.has(id)).length;
    }
  } finally { Object.assign(steps, { letters: orig, returns: ret }); }
  return { trips, lettered, share: trips ? lettered / trips : 0 };
}
test(`(MER-136) at least ${SHARE_FLOOR * 100} percent of trips of three seasons or more that come home brought a letter, over ${SHARE_GAMES} seeded bot games`, () => {
  const m = letterShare(SHARE_GAMES);
  console.log(`  ${SHARE_GAMES} bot games: ${m.trips} trips of three seasons or more came home, ${m.lettered} with a letter (${(m.share * 100).toFixed(1)} percent)`);
  ok(m.trips >= 80, `only ${m.trips} long trips came home, too few to tell 25 percent from 50`);
  ok(m.share >= SHARE_FLOOR, `${(m.share * 100).toFixed(1)} percent of long trips brought a letter, under ${SHARE_FLOOR * 100} (the design's floor is 50, test/mix.mjs; the engine gave about 72 on 2026-11-24)`);
});


await done();
