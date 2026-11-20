// Engine units (ARCHITECTURE 7.1): node test/engine.mjs, from Projects/Merchant/.
// Plain Node, no browser, no clock. The game it plays is the invented city in data/testport/.
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, eq, ok, throws, done } from './lib.mjs';
import { loadContent } from '../js/data.js';
import * as rng from '../js/engine/rng.js';
import * as cal from '../js/engine/calendar.js';
import { freshState } from '../js/engine/state.js';
import { apply } from '../js/engine/effects.js';
import { holds } from '../js/engine/conditions.js';
import { steps } from '../js/engine/turn.js';
import { newGame, openSeason, choose, canEndSeason, endSeason, recall, view, paperChoices } from '../js/engine/index.js';

const content = await loadContent('testport', { fs });
const fresh = (over = {}) => freshState(content, { seed: 1, length: 'acts', house: 'rich', ...over });
const game = (over = {}) => newGame(content, { seed: 7, length: 'acts', house: 'plain', ...over });
const variant = edit => { const c = structuredClone(content); edit(c); return c; };
const answer = (s, c, i = 0) => { for (const p of s.desk) if (p.state === 'open') s = choose(s, c, p.id, paperChoices(s, c, p.id)[i].id); return s; };

// ---- rng
test('rng: the first ten draws of seed 1324 are pinned', () => {
  const s = { rng: 1324 };
  eq(Array.from({ length: 10 }, () => rng.next(s)), [
    0.12039321381598711, 0.6755068902857602, 0.5701429201290011, 0.6081436912063509, 0.4051177480723709,
    0.8395986075047404, 0.17617343529127538, 0.33910694625228643, 0.21992967906408012, 0.7951265242882073,
  ]);
});
test('rng: the same seed gives the same draws and state.rng is an integer', () => {
  const a = { rng: 99 }, b = { rng: 99 };
  eq([rng.next(a), rng.next(a)], [rng.next(b), rng.next(b)]);
  ok(Number.isInteger(a.rng) && a.rng >= 0 && a.rng < 2 ** 32);
});
test('rng: int covers both ends and nothing outside', () => {
  const s = { rng: 5 }, seen = new Set();
  for (let i = 0; i < 300; i++) seen.add(rng.int(s, 3, 6));
  eq([...seen].sort(), [3, 4, 5, 6]);
});
test('rng: pick takes one draw and throws on an empty list', () => {
  const s = { rng: 5 }, t = { rng: 5 };
  rng.pick(s, ['a', 'b', 'c']); rng.next(t);
  eq(s.rng, t.rng);
  throws(() => rng.pick(s, []), /empty/);
});
test('rng: weighted never picks a zero weight and follows the weights', () => {
  const s = { rng: 11 }, n = { a: 0, b: 0 };
  for (let i = 0; i < 2000; i++) n[rng.weighted(s, [{ id: 'a', w: 1 }, { id: 'z', w: 0 }, { id: 'b', w: 3 }], x => x.w).id === 'b' ? 'b' : 'a']++;
  ok(n.b > n.a * 2 && n.b < n.a * 4, `a ${n.a}, b ${n.b}`);
  throws(() => rng.weighted(s, [{ weight: 0 }]), /weight/);
});
test('rng: chance(0) is never and chance(1) is always', () => {
  const s = { rng: 3 };
  for (let i = 0; i < 100; i++) { ok(!rng.chance(s, 0)); ok(rng.chance(s, 1)); }
});
test('rng: normal takes two draws and is centred', () => {
  const s = { rng: 8 }, t = { rng: 8 };
  rng.normal(s); rng.next(t); rng.next(t);
  eq(s.rng, t.rng);
  let sum = 0; for (let i = 0; i < 4000; i++) sum += rng.normal(s);
  ok(Math.abs(sum / 4000) < 0.06, `mean ${sum / 4000}`);
});

// ---- calendar
const C = content.calendar;
test('calendar: the acts length plays 6 seasons in two acts of 3', () => {
  eq(cal.playedSeasons(C, 'acts'), [0, 1, 2, 8, 9, 10]);
});
test('calendar: the full length plays 11 seasons with no gap', () => {
  eq(cal.playedSeasons(C, 'full'), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});
test('calendar: every season of the acts calendar is in the full calendar (one rule)', () => {
  const full = new Set(cal.playedSeasons(C, 'full'));
  for (const i of cal.playedSeasons(C, 'acts')) ok(full.has(i), `season ${i}`);
});
test('calendar: season names and years come from the base', () => {
  eq([0, 1, 2, 3, 4, 10].map(cal.seasonName), ['spring', 'summer', 'autumn', 'winter', 'spring', 'autumn']);
  eq([0, 3, 4, 10].map(i => cal.year(C, i)), [1200, 1200, 1201, 1202]);
});
test('calendar: seasonIndex reads the played list, not t (a gap shows)', () => {
  const s = fresh();
  eq([0, 1, 2, 3, 4].map(t => cal.seasonIndex({ ...s, t }, content)), [0, 1, 2, 8, 9]);
  eq(cal.seasonIndex({ ...s, length: 'full', t: 3 }, content), 3);
});
test('calendar: actOf for both lengths, and a gap season belongs to the next act', () => {
  const s = fresh();
  eq([0, 2, 3, 5].map(t => cal.actOf({ ...s, t }, content)), [1, 1, 2, 2]);
  eq([0, 2, 3, 5, 8, 10].map(t => cal.actOf({ ...s, length: 'full', t }, content)), [1, 1, 2, 2, 2, 2]);
});
test('calendar: isLastSeason is true only on the final played season of that length', () => {
  const s = fresh();
  eq([4, 5].map(t => cal.isLastSeason({ ...s, t }, content)), [false, true]);
  eq([5, 10].map(t => cal.isLastSeason({ ...s, length: 'full', t }, content)), [false, true]);
});
test('calendar: a length the calendar lacks throws', () => {
  throws(() => cal.playedSeasons(C, 'weeks'), /length/);
});

// ---- state
test('state: freshState has every field of ARCHITECTURE 3 with the right type', () => {
  const s = fresh();
  const want = { v: 'number', city: 'string', length: 'string', house: 'string', seed: 'number', rng: 'number', t: 'number', phase: 'string', money: 'number' };
  for (const [k, t] of Object.entries(want)) eq(typeof s[k], t, k);
  for (const k of ['loans', 'expeditions', 'post', 'desk', 'done', 'queue', 'notebook', 'log']) ok(Array.isArray(s[k]), k);
  for (const k of ['stock', 'market', 'known', 'agents', 'rep', 'flags', 'seen']) ok(s[k] && typeof s[k] === 'object' && !Array.isArray(s[k]), k);
  eq(s.score, null);
  eq(s.phase, 'desk');
  eq(Object.keys(s).sort(), ['agents', 'city', 'desk', 'done', 'expeditions', 'flags', 'house', 'known', 'length', 'loans', 'log', 'market',
    'money', 'notebook', 'phase', 'post', 'queue', 'rep', 'rng', 'score', 'seed', 'seen', 'stock', 't', 'v']);
});
test('state: the house sets money, stock, hired agents and reputation; the market starts level', () => {
  const s = fresh();
  eq([s.money, s.stock, s.rep.partners], [900, { wool: 10, salt: 6 }, 1]);
  eq([s.agents.mira.hired, s.agents.tobin.hired, fresh({ house: 'plain' }).agents.tobin.hired], [true, true, false]);
  eq(s.market.saltmarsh.lamps, { f: 1, glut: 0 });
  eq(s.rng, 1);
});
test('state: a bad seed, house or length throws', () => {
  throws(() => fresh({ seed: 1.5 }), /seed/);
  throws(() => fresh({ house: 'nobody' }), /house/);
  throws(() => fresh({ length: 'weeks' }), /length/);
});

// ---- effects: one named case each
const fx = (eff, ctx, s = game()) => { const t = structuredClone(s); apply(t, content, eff, ctx); return t; };
test('effect money: adds and takes dinars, whole numbers only', () => {
  eq(fx({ money: 30 }).money, 530);
  eq(fx({ money: -30 }).money, 470);
  throws(() => fx({ money: 1.5 }), /whole/);
});
test('effect stock: adds loads, removes them, never below zero', () => {
  eq(fx({ stock: 'salt', by: 3 }).stock, { wool: 10, salt: 3 });
  eq(fx({ stock: 'wool', by: -4 }).stock.wool, 6);
  eq(fx({ stock: 'wool', by: -40 }).stock, {});
  throws(() => fx({ stock: 'gold', by: 1 }), /good/);
});
test('effect rep: moves a group and clamps to -3..3', () => {
  eq(fx({ rep: 'court', by: 2 }).rep.court, 2);
  eq(fx({ rep: 'court', by: 9 }).rep.court, 3);
  eq(fx({ rep: 'court', by: -9 }).rep.court, -3);
  throws(() => fx({ rep: 'moon', by: 1 }), /group/);
});
test('effect trust: moves an agent by id or by $agent and clamps', () => {
  eq(fx({ trust: 'mira', by: 2 }).agents.mira.trust, 2);
  eq(fx({ trust: '$agent', by: -1 }, { agent: 'mira' }).agents.mira.trust, -1);
  eq(fx({ trust: 'mira', by: 9 }).agents.mira.trust, 3);
  throws(() => fx({ trust: '$agent', by: 1 }), /agent/);
});
test('effect memory: records what the house did, with the season index', () => {
  eq(fx({ memory: 'mira', kind: 'unfair' }).agents.mira.memory, [{ at: 0, kind: 'unfair' }]);
});
test('effect flag: sets a value, "now" stores the season index, clear removes it', () => {
  eq(fx({ flag: 'a', set: 5 }).flags, { a: 5 });
  eq(fx({ flag: 'b', set: 'now' }, undefined, { ...game(), t: 3 }).flags, { b: 8 });
  eq(fx({ flag: 'a', clear: true }, undefined, { ...game(), flags: { a: 1 } }).flags, {});
  throws(() => fx({ flag: 'a' }), /set or clear/);
});
test('effect price: multiplies a true price factor', () => {
  eq(fx({ price: 'harbour', good: 'wool', by: 0.75 }).market.harbour.wool.f, 0.75);
  throws(() => fx({ price: 'harbour', good: 'lamps', by: 2 }), /does not trade/);
  throws(() => fx({ price: 'nowhere', good: 'wool', by: 2 }), /stop/);
});
test('effect loan: adds the principal, a due season and the loan record', () => {
  const s = fx({ loan: { from: 'nell', principal: 100, in: 4, rate: 0.1 } });
  eq(s.money, 600);
  eq(s.loans, [{ id: 'nell-1', from: 'nell', principal: 100, due: 4, rate: 0.1 }]);
  throws(() => fx({ loan: { from: 'nell', principal: 100 } }), /needs/);
});
test('effect hire and dismiss: switch an agent', () => {
  eq(fx({ hire: 'tobin' }).agents.tobin.hired, true);
  eq(fx({ dismiss: 'mira' }).agents.mira.hired, false);
  throws(() => fx({ hire: 'ghost' }), /agent/);
});
test('effect hire (MER-82, Matteo): an agent whose own home is elsewhere, hired, is at the house\'s home and can be sent from there', () => {
  const far = structuredClone(game());
  far.agents.tobin = { ...far.agents.tobin, hired: false, where: 'saltmarsh' };   // Matteo's case: a home that is not the house's
  const t = structuredClone(far); apply(t, content, { hire: 'tobin' });
  eq([t.agents.tobin.hired, t.agents.tobin.where], [true, content.city.home]);
  apply(t, content, { outfit: 'tobin', contract: 'own' });                       // would throw "is not free to be sent out"
  const road = structuredClone(far); road.agents.tobin.where = 'road'; road.expeditions.push({ id: 'x1', agent: 'tobin' });
  apply(road, content, { hire: 'tobin' });
  eq(road.agents.tobin.where, 'road', 'an agent on the road is not moved');
  const dead = structuredClone(far); dead.agents.tobin.where = 'dead';
  apply(dead, content, { hire: 'tobin' });
  eq(dead.agents.tobin.where, 'dead', 'the dead stay where they are');
  const gone = structuredClone(far); gone.agents.tobin.where = 'gone';
  throws(() => apply(gone, content, { hire: 'tobin' }), /cannot be hired again/);
});
test('effect card: only inside a later effect, and only a card that exists', () => {
  throws(() => fx({ card: 'wool-due' }), /later/);
  throws(() => fx({ card: 'nope' }, { later: true }), /card/);
  eq(fx({ card: 'wool-due' }, { later: true }).desk[0].ref, 'wool-due');
});
test('effect unlock: adds a notebook entry once', () => {
  eq(fx({ unlock: 'x' }, undefined, fx({ unlock: 'x' })).notebook.filter(e => e === 'x').length, 1);
});
test('effect order: only for a letter from an expedition on the road', () => {
  throws(() => fx({ order: { go: 'home' } }), /expedition/);
  const s = { ...game(), expeditions: [{ id: 'x1', orders: [] }] };
  eq(fx({ order: { go: 'home' } }, { expedition: 'x1' }, s).expeditions[0].orders, [{ go: 'home' }]);
});
test('effect: an unknown key, a stray argument or two heads all throw', () => {
  throws(() => fx({ gold: 5 }), /exactly one/);
  throws(() => fx({ money: 5, bonus: 1 }), /unknown key/);
  throws(() => fx({ money: 5, rep: 'court' }), /exactly one|unknown key/);
});

// ---- conditions: one named case each
const cond = (c, s = game()) => holds(c, s, content);
test('condition season: matches the name of the season index', () => {
  eq([cond({ season: ['spring'] }), cond({ season: ['winter', 'autumn'] })], [true, false]);
});
test('condition year: inclusive range from the calendar base', () => {
  eq([cond({ year: [1200, 1200] }), cond({ year: [1201, 1210] })], [true, false]);
});
test('condition act: the act of the played season', () => {
  eq([cond({ act: 1 }), cond({ act: 2 }), cond({ act: 2 }, { ...game(), t: 3 })], [true, false, true]);
});
test('condition flag: set, not, and gte on a number', () => {
  const s = { ...game(), flags: { a: 5, b: 'x' } };
  eq([cond({ flag: 'a' }, s), cond({ flag: 'z' }, s), cond({ flag: 'z', not: true }, s), cond({ flag: 'a', not: true }, s)], [true, false, true, false]);
  eq([cond({ flag: 'a', gte: 5 }, s), cond({ flag: 'a', gte: 6 }, s), cond({ flag: 'b', gte: 1 }, s)], [true, false, false]);
});
test('condition rep: gte and lte on a group', () => {
  const s = { ...game(), rep: { partners: 2, agents: 0, court: -1, foreign: 0 } };
  eq([cond({ rep: 'partners', gte: 2 }, s), cond({ rep: 'partners', gte: 3 }, s), cond({ rep: 'court', lte: -1 }, s), cond({ rep: 'court', gte: 0 }, s)], [true, false, true, false]);
});
test('condition money: gte and lte', () => {
  eq([cond({ money: { gte: 500 } }), cond({ money: { gte: 501 } }), cond({ money: { lte: 500 } })], [true, false, true]);
  throws(() => cond({ money: 5 }), /gte/);
});
test('condition agent: hired and where', () => {
  eq([cond({ agent: 'mira', hired: true }), cond({ agent: 'tobin', hired: true }), cond({ agent: 'mira', where: 'harbour' }), cond({ agent: 'mira', where: 'road' })], [true, false, true, false]);
});
test('condition out: counts expeditions on the road', () => {
  const s = { ...game(), expeditions: [{}, {}] };
  eq([cond({ out: { gte: 2 } }, s), cond({ out: { gte: 3 } }, s), cond({ out: { gte: 1 } })], [true, false, false]);
});
test('condition length: the chosen length', () => {
  eq([cond({ length: 'acts' }), cond({ length: 'full' })], [true, false]);
});
test('condition all and any: combine, and an empty all holds', () => {
  eq([cond({ all: [{ act: 1 }, { length: 'acts' }] }), cond({ all: [{ act: 1 }, { length: 'full' }] }), cond({ any: [{ act: 2 }, { length: 'acts' }] }), cond({ any: [] }), cond({ all: [] })], [true, false, true, false, true]);
});
test('condition notebook: an entry unlocked (used by ARCHITECTURE 6.3)', () => {
  eq([cond({ notebook: 'harbour-town' }), cond({ notebook: 'harbour-town' }, { ...game(), notebook: ['harbour-town'] })], [false, true]);
});
test('condition leaves check their value types and throw on a wrong one', () => {
  const wrong = [
    [{ season: 'spring' }, /season.*list of season names/], [{ season: ['spring', 'moon'] }, /season.*list of season names/], [{ season: [] }, /season/],
    [{ year: 1200 }, /year.*pair of numbers/], [{ year: ['1200', '1201'] }, /year/], [{ year: [1200] }, /year/],
    [{ act: '1' }, /act.*whole number/], [{ act: 1.5 }, /act/], [{ act: [1] }, /act/],
    [{ length: 5 }, /length.*name/], [{ notebook: 7 }, /notebook/], [{ flag: 7 }, /flag/], [{ flag: 'a', gte: '5' }, /gte.*number/], [{ flag: 'a', not: 'yes' }, /not.*true or false/],
    [{ rep: 'court', gte: '1' }, /gte/], [{ agent: 'mira', hired: 'yes' }, /hired/], [{ agent: 'mira', where: 5 }, /where/],
    [{ money: { gte: '5' } }, /gte.*number/], [{ out: { lte: [1] } }, /lte.*number/],
  ];
  for (const [c, re] of wrong) throws(() => cond(c), re);
  eq([cond({ season: ['spring', 'summer'] }), cond({ year: [1200, 1200] }), cond({ act: 1 })], [true, true, true], 'the right types still hold');
});
test('condition: no condition holds, and an unknown key or leaf throws', () => {
  ok(cond(undefined));
  throws(() => cond({ moon: 1 }), /needs exactly one/);
  throws(() => cond({ flag: 'a', maybe: true }), /unknown key/);
  throws(() => cond({ all: [{ moon: 1 }] }), /needs exactly one/);
});

// ---- turn
test('turn: a new game puts the house\'s opening papers on the desk, numbered, open', () => {
  const s = game();
  eq(s.desk.map(p => [p.id, p.ref, p.state]), [['p0-0', 'welcome-note', 'open'], ['p0-1', 'wool-offer', 'open']]);
  eq(game({ house: 'rich' }).desk.map(p => p.ref), ['welcome-note', 'salt-dispute']);
  eq([s.t, s.phase], [0, 'desk']);
});
test('turn: no function changes the state it is given', () => {
  const s = game(), before = JSON.stringify(s);
  const t = choose(s, content, 'p0-0', 'begin'); endSeason(answer(s, content), content); openSeason({ ...s, desk: [], phase: 'interlude' }, content);
  eq(JSON.stringify(s), before);
  ok(t !== s);
  paperChoices(s, content, 'p0-1'); view(s, content); canEndSeason(s);
  eq(JSON.stringify(s), before, 'paperChoices, view and canEndSeason leave the state alone');
});
test('turn: recall changes neither the state it is given nor the content', () => {
  let s = game();
  while (s.phase !== 'recall') s = s.phase === 'interlude' ? openSeason(s, content) : endSeason(answer(s, content), content);
  const before = JSON.stringify(s), cBefore = JSON.stringify(content);
  const ended = recall(s, content, {});
  eq(JSON.stringify(s), before, 'recall mutated its input');
  ok(ended !== s && ended.phase === 'ended' && s.phase === 'recall');
  eq(JSON.stringify(content), cBefore);
});
test('turn: newGame changes neither the content nor a second game made from it', () => {
  const before = JSON.stringify(content);
  const a = game(); a.desk[0].state = 'done'; a.flags.x = 1;
  eq(JSON.stringify(content), before, 'newGame mutated the content');
  eq(game().desk[0].state, 'open');
  eq(game().flags, {});
});
test('turn: choose applies now-effects, queues later-effects with at, unlocks and logs', () => {
  const s = choose(game(), content, 'p0-1', 'buy');
  eq([s.money, s.stock.wool], [460, 14]);
  eq(s.queue, [{ at: 2, do: [], card: 'wool-due', from: 'wool-offer/buy' }]);
  // MER-61: the opening writes one `trust` entry (the agents' trust, for the season's change to reputation).
  eq(s.log.filter(e => e.kind !== 'trust'), [{ at: 0, kind: 'card', ref: 'wool-offer', choice: 'buy' }]);
  eq(s.desk[1].state, 'done');
  const w = choose(game(), content, 'p0-0', 'begin');
  eq([w.notebook, w.queue[0].at], [['testport', 'harbour-town'], 1]);
});
test('turn: choose refuses a choice whose requires fails, a repeat answer and a wrong id', () => {
  const poor = { ...game(), money: 10 };
  throws(() => choose(poor, content, 'p0-1', 'buy'), /not available/);
  const s = choose(game(), content, 'p0-0', 'begin');
  throws(() => choose(s, content, 'p0-0', 'begin'), /already answered/);
  throws(() => choose(game(), content, 'p0-0', 'nope'), /no choice/);
  throws(() => choose(game(), content, 'p9-9', 'begin'), /no paper/);
});
test('turn: canEndSeason is false until every paper is answered', () => {
  const s = game();
  eq(canEndSeason(s), { ok: false, reason: '2 papers still need an answer.' });
  const one = choose(s, content, 'p0-0', 'begin');
  eq(canEndSeason(one).reason, 'One paper still needs an answer.');
  eq(canEndSeason(answer(s, content)), { ok: true, reason: null });
  throws(() => endSeason(s, content), /still need/);
});
test('turn: endSeason advances t and opens the next season with cards drawn by weight', () => {
  const s = endSeason(answer(game(), content), content);
  eq([s.t, s.phase, view(s, content).season], [1, 'desk', 'summer']);
  eq(s.desk.filter(p => p.kind === 'card').map(p => p.ref), ['lamp-order'], 'the second season holds the one card secondSeason asks for, drawn by weight');
  eq(s.desk.filter(p => p.kind !== 'card').map(p => p.kind), ['accounts'], 'and one folded Accounts paper for the opening cards\' later effects (MER-41)');
});
test('turn: a later effect fires on its season and not before', () => {
  let s = choose(game(), content, 'p0-1', 'buy');   // wool-due at season 2
  s = answer(choose(s, content, 'p0-0', 'later'), content); // 'later' costs 5 now, returns 5 at season 1
  const m0 = s.money;
  s = endSeason(s, content);                        // season 1 opens: the 5 came back, wool-due has not
  eq(s.money, m0 + 5);
  ok(!s.desk.some(p => p.ref === 'wool-due'));
  eq(s.queue.length, 1);
  s = endSeason(answer(s, content), content);       // season 2 opens
  ok(s.queue.every(q => q.card !== 'wool-due'), 'wool-due has fired');
});
test('turn: a follow-up card is placed first and counts against the card total', () => {
  let s = answer(choose(game(), content, 'p0-1', 'buy'), content, 0);
  s = answer(endSeason(s, content), content);
  s = endSeason(s, content);
  eq(s.desk[0].ref, 'wool-due');
  eq(s.flags['from:wool-due'], 'wool-offer/buy');
  eq(s.desk.map(p => p.ref), ['wool-due', 'salt-order', 'court-summons'], 'the follow-up first, then two drawn cards to the target of 3');
});
test('turn: the desk is never over 5 papers however many follow-ups are due', () => {
  const c = variant(x => {
    x.cards.push(...Array.from({ length: 8 }, (_, i) => ({ id: `f${i}`, group: 'followups', title: 't', body: 'b', choices: [{ id: 'ok', label: 'ok', now: [{ money: 1 }], later: [{ in: 1, do: [{ money: 1 }] }] }] })));
  });
  let s = newGame(c, { seed: 7, length: 'acts', house: 'plain' });
  s.queue = Array.from({ length: 8 }, (_, i) => ({ at: 1, do: [], card: `f${i}`, from: 'x/y' }));
  s = endSeason(answer(s, c), c);
  eq(s.desk.length, 5);
  eq(s.queue.filter(q => q.card?.startsWith('f')).length, 3, 'the three that did not fit wait');
  const t = newGame(c, { seed: 7, length: 'acts', house: 'plain' });
  t.queue = Array.from({ length: 3 }, (_, i) => ({ at: 1, do: [], card: `f${i}`, from: 'x/y' }));
  eq(endSeason(answer(t, c), c).desk.filter(p => p.kind === 'card').length, 3, 'three follow-ups; the Accounts paper is a fourth paper, not a card');
});
test('turn: drawing never repeats a card within 6 seasons or two of one group', () => {
  let s = game({ length: 'full', seed: 3 });
  const drawn = [];
  while (s.phase === 'desk') {
    const groups = s.desk.filter(p => p.kind === 'card').map(p => content.cards.find(c => c.id === p.ref).group);
    eq(new Set(groups).size, groups.length, `season ${s.t} repeats a group`);
    for (const p of s.desk) if (p.kind === 'card') drawn.push([s.t, p.ref]);
    s = endSeason(answer(s, content), content);
  }
  for (const [t, ref] of drawn) ok(!drawn.some(([t2, r2]) => r2 === ref && t2 > t && t2 - t < 6), `${ref} at ${t}`);
});
test('turn: a card with repeat false is drawn once, and a card with weight 0 never', () => {
  const c = variant(x => { x.cards.find(k => k.id === 'salt-dispute').repeat = false; });
  let s = newGame(c, { seed: 4, length: 'full', house: 'plain' });
  const refs = [];
  while (s.phase === 'desk') { refs.push(...s.desk.map(p => p.ref)); s = endSeason(answer(s, c), c); }
  ok(refs.filter(r => r === 'salt-dispute').length <= 1);
  eq(refs.filter(r => r === 'welcome-note').length, 1);
});
test('turn: an event fires on its season index, applies its effects and puts a notice on the desk', () => {
  let s = game({ length: 'full' });
  for (let t = 0; t < 10; t++) s = endSeason(answer(s, content), content);
  eq(s.flags['fair-closed'], 10);
  eq(s.desk.find(p => p.kind === 'notice').ref, 'fair-closes');
  eq(paperChoices(s, content, s.desk.find(p => p.kind === 'notice').id)[0].id, 'ok');
  s = answer(s, content);
  eq(s.desk.every(p => p.state === 'done'), true);
});
test('turn: season order is pinned (ARCHITECTURE 4.1), with the jump between advance and end', () => {
  const calls = [], saved = { ...steps };
  for (const k of Object.keys(steps)) steps[k] = (...a) => { calls.push(k); return saved[k](...a); };
  try {
    let s = game(); calls.length = 0;
    s = endSeason(answer(s, content), content);
    eq(calls, ['move', 'risk', 'tolls', 'drift', 'fireDue', 'settle', 'advance', 'end', 'agents', 'returns', 'letters', 'news', 'events', 'drawCards']);
    s = endSeason(answer(s, content), content); calls.length = 0;
    s = endSeason(answer(s, content), content);                 // season index 2 to 8: a gap
    eq(calls, ['move', 'risk', 'tolls', 'drift', 'fireDue', 'settle', 'advance', 'jump', 'end']);
    eq(s.phase, 'interlude');
  } finally { Object.assign(steps, saved); }
});
test('turn: a gap between acts goes to the interlude and openSeason opens the next act', () => {
  let s = game();
  for (let t = 0; t < 3; t++) s = endSeason(answer(s, content), content);
  eq([s.phase, s.t, s.desk.map(p => p.kind)], ['interlude', 3, ['accounts']], 'the Accounts paper of the last season waits on the desk through the interlude');
  throws(() => choose(s, content, 'p3-0', 'begin'), /nothing to answer/);
  s = openSeason(s, content);
  eq([s.phase, view(s, content).season, view(s, content).year, view(s, content).act], ['desk', 'spring', 1202, 2]);
  throws(() => openSeason(s, content), /already open/);
});
test('turn: the full length has no interlude and plays all 11 seasons', () => {
  let s = game({ length: 'full' }), seen = new Set();
  while (s.phase === 'desk') { seen.add(s.phase); s = endSeason(answer(s, content), content); }
  eq([s.phase, s.t], ['recall', 10]);
  eq([...seen], ['desk']);
});
test('turn: the game goes to recall at the calendar\'s end and recall ends it', () => {
  let s = game();
  while (s.phase !== 'recall') { s = s.phase === 'interlude' ? openSeason(s, content) : endSeason(answer(s, content), content); }
  eq([s.t, view(s, content).last, s.desk.length], [5, true, 0]);
  throws(() => endSeason(s, content), /not open/);
  eq(recall(s, content, {}).phase, 'ended');
  throws(() => recall(game(), content, {}), /not at its end/);
});
test('turn: seed 7, the first choice of every paper, plays testport to the end; money and log length are pinned', () => {
  let s = game();
  while (s.phase !== 'recall') { s = s.phase === 'interlude' ? openSeason(s, content) : endSeason(answer(s, content), content); }
  s = recall(s, content, {});
  eq(s.phase, 'ended');
  // MER-41: 406 and 16 became 416 and 24. The jump rolls each hired agent's retirement from state.rng, which moves the
  // second act's draws, and the log gains one entry for the jump and one for each Accounts paper.
  // MER-78: 416 became 403. The draw takes at most one favour a season and no two cards of one kind, which deals other cards from season 3 on.
  eq(s.money, 403, 'final money');
  // MER-60: 24 became 30. The closing step writes one `season` entry for each of the six seasons played.
  // MER-61: 30 became 31. The opening keeps one `trust` entry, replaced each season, not one a season.
  eq(s.log.length, 31, 'log length');
  eq(JSON.stringify(s), JSON.stringify((() => {
    let t = game();
    while (t.phase !== 'recall') { t = t.phase === 'interlude' ? openSeason(t, content) : endSeason(answer(t, content), content); }
    return recall(t, content, {});
  })()), 'a second run is the same game');
});

// ---- MER-07: the fixes from the MER-02 review
const onDesk = (s, paper) => ({ ...s, desk: [...s.desk, { id: `p${s.t}-9`, state: 'open', kind: 'card', ...paper }] });
const card = (id, choices, over = {}) => ({ id, group: 'orders', title: 't', body: 'b', weight: 0, choices, ...over });
const choice = (now, later, id = 'go') => ({ id, label: 'Go', now, ...(later ? { later } : {}) });
const must = (what, fn) => { try { return fn(); } catch (e) { throw new Error(`${what}: ${e.message}`); } };
const play = (c, opts, pick = 0) => {
  let s = newGame(c, { house: 'plain', length: 'full', ...opts }); const seq = [];
  while (s.phase !== 'recall') { seq.push(s.desk.map(p => p.ref)); s = s.phase === 'interlude' ? openSeason(s, c) : endSeason(answer(s, c, pick), c); }
  return { s, seq };
};

test('queue context: a later effect fires with the agent of the paper that queued it', () => {
  const c = variant(x => x.cards.push(card('agent-card', [choice([], [{ in: 1, do: [{ trust: '$agent', by: 1 }, { memory: '$agent', kind: 'kept-word' }] }])])));
  let s = onDesk(game(), { ref: 'agent-card', agent: 'mira' });
  s = choose(s, c, 'p0-9', 'go');
  eq([s.queue[0].agent, s.queue[0].expedition], ['mira', undefined], 'the queue item keeps the paper\'s agent');
  s = endSeason(answer(s, c), c);
  eq([s.agents.mira.trust, s.agents.mira.memory.map(m => m.kind), s.log.filter(e => e.kind === 'dropped')], [1, ['kept-word'], []]);
});
test('queue context: a later order reaches the expedition of the letter that queued it', () => {
  const c = variant(x => x.cards.push(card('road-card', [choice([], [{ in: 1, do: [{ order: { go: 'home' } }] }])])));
  let s = { ...game(), expeditions: [{ id: 'x1', orders: [] }] };
  s = choose(onDesk(s, { ref: 'road-card', expedition: 'x1' }), c, 'p0-9', 'go');
  eq(s.queue[0].expedition, 'x1');
  s = endSeason(answer(s, c), c);
  eq(s.expeditions[0].orders, [{ go: 'home' }]);
});
test('queue context: a follow-up card keeps the agent of the paper that queued it', () => {
  const c = variant(x => x.cards.push(card('first', [choice([], [{ in: 1, card: 'then' }])]), card('then', [choice([{ trust: '$agent', by: 1 }])], { group: 'followups' })));
  let s = choose(onDesk(game(), { ref: 'first', agent: 'mira' }), c, 'p0-9', 'go');
  s = endSeason(answer(s, c), c);
  const then = s.desk.find(p => p.ref === 'then');
  eq(then.agent, 'mira');
  eq(choose(s, c, then.id, 'go').agents.mira.trust, 1);
});
test('choose refuses a choice whose now or later names a card, good, stop or agent the content lacks, with a reason', () => {
  const bad = {
    'a card in later.card': { now: [], later: [{ in: 1, card: 'ghost' }] }, 'a card in a later do': { now: [], later: [{ in: 1, do: [{ card: 'ghost' }] }] },
    'a good in a later do': { now: [], later: [{ in: 1, do: [{ stock: 'gold', by: 1 }] }] },
    'a stop in a later do': { now: [], later: [{ in: 1, do: [{ price: 'nowhere', good: 'wool', by: 2 }] }] },
    'a good a stop does not trade': { now: [], later: [{ in: 1, do: [{ price: 'harbour', good: 'lamps', by: 2 }] }] },
    'an agent in a later do': { now: [], later: [{ in: 1, do: [{ hire: 'ghost' }] }] },
    '$agent on a paper with no agent': { now: [], later: [{ in: 1, do: [{ trust: '$agent', by: 1 }] }] },
    'an order with no expedition': { now: [], later: [{ in: 1, do: [{ order: { go: 'home' } }] }] },
    'a good in now': { now: [{ stock: 'gold', by: 1 }], later: [{ in: 1, do: [] }] },
    'a card effect in now': { now: [{ card: 'wool-due' }], later: [{ in: 1, do: [] }] },
    'an effect with a stray key': { now: [], later: [{ in: 1, do: [{ money: 1, bonus: 2 }] }] },
    'a later.in of 0': { now: [], later: [{ in: 0, do: [] }] },
  };
  for (const [what, ch] of Object.entries(bad)) {
    const c = variant(x => x.cards.push(card('bad-card', [{ id: 'go', label: 'Go', ...ch }])));
    const s = onDesk(game(), { ref: 'bad-card' }), before = JSON.stringify(s);
    let msg = ''; try { choose(s, c, 'p0-9', 'go'); } catch (e) { msg = e.message; }
    ok(/is refused: /.test(msg), `${what} must refuse the choice at choose time with a reason, got "${msg}"`);
    eq(JSON.stringify(s), before, `${what} left the state changed`);
  }
  const reason = variant(x => x.cards.push(card('bad-card', [{ id: 'go', label: 'Go', now: [], later: [{ in: 1, do: [{ stock: 'gold', by: 1 }] }] }])));
  throws(() => choose(onDesk(game(), { ref: 'bad-card' }), reason, 'p0-9', 'go'), /bad-card.*unknown good "gold"/);
});
test('queue: an item that still throws when it fires is logged and dropped, with no half-applied effects, and never throws again', () => {
  let s = answer(game(), content);
  const m0 = s.money;
  s.queue = [{ at: 1, do: [{ money: 100 }, { stock: 'gold', by: 1 }], from: 'x/y' }, { at: 1, do: [{ money: 7 }], from: 'x/ok' }];
  s = endSeason(s, content);
  eq(s.queue, [], 'the broken item is not left in the queue');
  const dropped = s.log.filter(e => e.kind === 'dropped');
  eq(dropped.length, 1);
  ok(dropped[0].ref === 'x/y' && /unknown good "gold"/.test(dropped[0].reason), JSON.stringify(dropped));
  eq(s.money, m0 + 7, 'only the working item\'s money landed: the 100 from the broken item was undone');
  s = endSeason(answer(s, content), content);
  eq(s.log.filter(e => e.kind === 'dropped').length, 1, 'a later endSeason does not meet it again');
});

test('desk cap, notices: six notices in one season leave five papers and the log says one was not shown', () => {
  const c = variant(x => { x.events.push(...Array.from({ length: 6 }, (_, i) => ({ id: `e${i}`, at: 1, do: [], notice: { title: 't', body: 'b' } }))); });
  const s0 = newGame(c, { seed: 7, length: 'acts', house: 'plain' });
  const answered = answer(s0, c);
  const s = endSeason({ ...answered, queue: [] }, c);   // no later effect is due, so no Accounts paper takes a place
  eq(s.desk.length, 5, 'a sixth notice does not go on the desk');
  eq(s.desk.every(p => p.kind === 'notice'), true);
  eq(s.log.filter(e => e.dropped === 'notice').map(e => e.ref), ['e5']);
  eq(s.seen['event:e5'], 1, 'its effects were applied once and the event does not fire again');
});
test('desk cap, drawn cards: drawing stops at five papers when notices already fill the desk', () => {
  const c = variant(x => { x.events.push(...Array.from({ length: 3 }, (_, i) => ({ id: `n${i}`, at: 2, do: [], notice: { title: 't', body: 'b' } }))); });
  let s = newGame(c, { seed: 7, length: 'acts', house: 'plain' });
  s = endSeason(answer(s, c), c);
  s = endSeason(answer(s, c), c);
  ok(s.desk.filter(p => p.kind === 'notice').length === 3 && s.desk.length === 5, `the third act-one season targets 3 cards but only 2 fit: ${s.desk.map(p => p.ref)}`);
  eq(s.desk.length <= 5, true, 'the drawn-card cap: at most 5 papers');
});
test('desk cap, a {card} effect inside a later do: same cap, the rest wait and keep their from', () => {
  const c = variant(x => x.cards.push(...Array.from({ length: 8 }, (_, i) => card(`g${i}`, [choice([{ money: 1 }], [{ in: 1, do: [{ money: 1 }] }])], { group: 'followups' }))));
  let s = answer(newGame(c, { seed: 7, length: 'acts', house: 'plain' }), c);
  s.queue = Array.from({ length: 8 }, (_, i) => ({ at: 1, do: [{ card: `g${i}` }], from: `src/${i}` }));
  s = endSeason(s, c);
  eq(s.desk.map(p => p.ref), ['g0', 'g1', 'g2', 'g3', 'g4'], 'the cap lives in the one place that adds a paper');
  eq(s.queue.map(q => q.from), ['src/5', 'src/6', 'src/7'], 'the three that did not fit wait with their from');
  eq(Object.keys(s.flags).filter(k => k.startsWith('from:')).length, 5, 'the flag is set when the follow-up is placed, not before');
  s = endSeason(answer(s, c), c);
  eq([s.desk.map(p => p.ref).slice(0, 3), s.flags['from:g5'], s.flags['from:g7']], [['g5', 'g6', 'g7'], 'src/5', 'src/7'], 'a held follow-up keeps its from flag');
});
test('desk cap, q.card follow-ups: the ones held keep their from flag when they fire next season', () => {
  const c = variant(x => x.cards.push(...Array.from({ length: 7 }, (_, i) => card(`f${i}`, [choice([{ money: 1 }], [{ in: 1, do: [{ money: 1 }] }])], { group: 'followups' }))));
  let s = answer(newGame(c, { seed: 7, length: 'acts', house: 'plain' }), c);
  s.queue = Array.from({ length: 7 }, (_, i) => ({ at: 1, do: [], card: `f${i}`, from: `src/${i}` }));
  s = endSeason(s, c);
  eq(s.queue.map(q => [q.card, q.from]), [['f5', 'src/5'], ['f6', 'src/6']]);
  s = endSeason(answer(s, c), c);
  eq([s.flags['from:f5'], s.flags['from:f6']], ['src/5', 'src/6']);
});
test('desk cap: no seed of the full game ever shows more than five papers, with follow-ups piled on', () => {
  for (let seed = 1; seed <= 12; seed++) {
    let s = newGame(content, { seed, length: 'full', house: 'plain' });
    while (s.phase === 'desk') {
      ok(s.desk.length <= 5, `seed ${seed} season ${s.t}: ${s.desk.length} papers`);
      for (const p of s.desk) if (p.state === 'open') s = choose(s, content, p.id, paperChoices(s, content, p.id)[0].id);
      s.queue.push(...[0, 1, 2, 3].map(i => ({ at: s.t + 1, do: [], card: 'wool-due', from: `pile/${i}` })));
      s = endSeason(s, content);
    }
  }
});

test('later effects: "now" is the effect\'s own season (at), so flag, memory and loan record the season they fired in', () => {
  const c = variant(x => x.cards.push(card('late', [choice([], [{ in: 2, do: [{ flag: 'when', set: 'now' }, { memory: 'mira', kind: 'late' }, { loan: { from: 'nell', principal: 50, in: 3, rate: 0.1 } }] }])])));
  let s = choose(onDesk(game(), { ref: 'late' }), c, 'p0-9', 'go');
  eq(s.queue[0].at, 2);
  s = endSeason(answer(s, c), c);             // closes season 0
  s = endSeason(answer(s, c), c);             // closes season 1; the item (at 2) fires as season 2 opens
  eq(s.flags.when, 2, 'flag set "now" records the season of its own at');
  eq(s.agents.mira.memory, [{ at: 2, kind: 'late' }]);
  eq(s.loans[0].due, 5, 'a loan\'s due counts from the season it fired in');
});
test('later effects: an item due in a gap fires at the end of the last season before it, with its own at; the jump does not settle it', () => {
  const c = variant(x => x.cards.push(card('late', [choice([], [])])));
  let s = game();
  s = endSeason(answer(s, c), c); s = endSeason(answer(s, c), c);    // season 2 is open, index 2
  s.queue = [{ at: 5, do: [{ flag: 'gap', set: 'now' }, { memory: 'mira', kind: 'g' }], from: 'x/y' }, { at: 8, do: [{ flag: 'next', set: 'now' }], from: 'x/z' }, { at: 9, do: [], from: 'x/w' }];
  s = endSeason(answer(s, c), c);
  eq([s.phase, s.flags.gap, s.flags.next, s.agents.mira.memory[0].at], ['interlude', 5, 8, 5]);
  eq(s.queue.map(q => q.at), [9], 'what is due after the first season of the next act stays queued');
});

test('copies: paperChoices and a queue item\'s do are copies of the content, not its arrays', () => {
  const before = JSON.stringify(content);
  const list = paperChoices(game(), content, 'p0-1');
  list[0].now.push({ money: 9999 }); list.length = 0;
  eq(JSON.stringify(content), before, 'paperChoices handed out the content\'s own array');
  const s = choose(game(), content, 'p0-0', 'later');
  s.queue[0].do.push({ money: 9999 });
  eq(JSON.stringify(content), before, 'a queue item\'s do is the content\'s array');
  eq(paperChoices(game(), content, 'p0-1').length, 2);
});

test('content.city missing: freshState, newGame and drawing fail with a message that says so', () => {
  const none = variant(c => { delete c.city; });
  throws(() => freshState(none, { seed: 1, length: 'acts', house: 'plain' }), /freshState: content\.city is missing/);
  throws(() => newGame(none, { seed: 1, length: 'acts', house: 'plain' }), /content\.city is missing/);
  const empty = variant(c => { c.city = {}; });
  throws(() => freshState(empty, { seed: 1, length: 'acts', house: 'plain' }), /content\.city is missing/);
  throws(() => openSeason({ ...game(), desk: [], phase: 'interlude' }, none), /market: content\.city is missing/);
  throws(() => endSeason(answer(game(), content), none), /content\.city is missing/);
});

test('acts numbering: "past the act\'s first half" reads the same position in both lengths', () => {
  const s = fresh();
  for (const t of [0, 1, 2, 3, 4, 5]) {
    const idx = cal.playedSeasons(C, 'acts')[t];
    eq(cal.actPosition({ ...s, t }, content), cal.actPosition({ ...s, length: 'full', t: idx }, content), `season index ${idx}`);
  }
  eq(cal.actPosition({ ...fresh({ length: 'full' }), t: 2 }, content), { i: 2, of: 3 }, 'the full game is not one 11-season act');
  eq(cal.actPosition({ ...fresh({ length: 'full' }), t: 5 }, content), { i: 0, of: 3 }, 'a gap season belongs to the next act, before its first season');
});

test('pinned game: the papers of each season of seed 7 (full) are pinned, and a different seed deals different ones', () => {
  const { seq, s } = play(content, { seed: 7 });
  // MER-41: the papers other than the Accounts paper are exactly what they were; the money is too. The log grew by the
  // accounts entries (23 to 39). MER-60: 39 became 50, one `season` entry for each of the eleven seasons closed.
  eq(seq.map(x => x.filter(r => r !== 'accounts').join('+')), [
    'welcome-note+wool-offer', 'lamp-order', 'wool-due+salt-order+court-summons', 'quay-toll+salt-dispute', 'rope-dispute',
    'lamp-quarrel+bridge-toll', 'wool-offer+harvest-gift', 'lamp-order', 'wool-due+salt-order', 'quay-toll+salt-dispute+court-summons', 'fair-closes+rope-dispute',
  ]);   // MER-78: seasons 4 to 7, 10 and 11 changed (one favour a season, no two of one kind; testport has few cards, so season 5 is one card); seasons 1 to 3, 8 and 9 deal what they dealt
  eq(seq.map(x => x.includes('accounts')), [false, true, false, true, true, true, true, true, true, true, true], 'the seasons that open with an Accounts paper');
  eq([s.money, s.log.length], [404, 52]);   // MER-78: 396 and 51 became 404 and 52 (other cards, so another delayed line and one more Accounts paper)   // MER-61: 50 became 51, the one `trust` entry
  ok(JSON.stringify(play(content, { seed: 8 }).seq) !== JSON.stringify(seq), 'the draws decide the papers');
  ok(JSON.stringify(play(content, { seed: 7, length: 'acts' }).seq).length > 0);
});
test('season log: one { at, kind: season, change } entry for each closed season, change the net dinars of that season (MER-60, for the ledger)', () => {
  const { s } = play(content, { seed: 7 });
  const seasons = s.log.filter(e => e.kind === 'season');
  eq(seasons.map(e => [e.at, e.change]), [[0, -40], [1, -30], [2, 59], [3, -15], [4, -12], [5, -20], [6, -40], [7, -30], [8, 84], [9, -40], [10, -12]]);
  eq(seasons.map(e => Object.keys(e).sort().join()).every(k => k === 'at,change,kind,money'), true, 'the ledger reads at and change; money is where the next change starts');
  eq(500 + seasons.reduce((n, e) => n + e.change, 0), s.money, 'the plain house starts with 500 and the changes add up to what it ends with');
});
test('pinned game: one extra state.rng step in openSeason changes the papers, so the pin above is a guard', () => {
  const saved = steps.news, pinned = JSON.stringify(play(content, { seed: 7 }).seq);
  steps.news = (s, ...a) => { rng.next(s); return saved(s, ...a); };      // one extra draw each time a season opens
  try { ok(JSON.stringify(play(content, { seed: 7 }).seq) !== pinned, 'an extra draw in openSeason must change the pinned papers'); }
  finally { steps.news = saved; }
  const once = steps.letters; let first = true;
  steps.letters = (s, ...a) => { if (first) { first = false; rng.next(s); } return once(s, ...a); }; // one extra draw, once, at the very start
  try { ok(JSON.stringify(play(content, { seed: 7 }).seq) !== pinned, 'a single extra draw at the first openSeason must change the pinned papers'); }
  finally { steps.letters = once; }
});

test('group rule: no season ever holds two cards of one group', () => {
  for (let seed = 1; seed <= 25; seed++) for (const { length } of [{ length: 'full' }]) {
    for (const papers of play(content, { seed, length }).seq) {
      const groups = papers.filter(r => content.cards.some(c => c.id === r)).map(r => content.cards.find(c => c.id === r).group);
      eq(new Set(groups).size, groups.length, `group rule: seed ${seed} has two cards of one group on the desk: ${papers}`);
    }
  }
});
test('weight-0 filter: a card of weight 0 is never drawn, and a pool of only such cards leaves the desk short instead of throwing', () => {
  const c = variant(x => { for (const k of x.cards) if (k.group !== 'followups') k.weight = 0; });
  const { seq } = must('weight-0 filter: a pool holding only weight-0 cards must give an empty draw, not an error', () => play(c, { seed: 3 }));
  for (const papers of seq.slice(1)) for (const r of papers) ok(!c.cards.find(k => k.id === r && k.group !== 'followups' && k.weight === 0), `weight-0 card ${r} was drawn`);
  eq(seq.slice(1).flat().filter(r => r !== 'wool-due' && r !== 'fair-closes' && r !== 'accounts' && !r.startsWith('f')), [], 'the desk held only follow-ups and notices once every drawable card weighed 0');
});
test('follow-ups count against the card total: a season with a follow-up holds exactly the target of cards', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const { seq } = play(content, { seed });
    const papers = seq[2];                                  // the third season targets 3 cards in both lengths
    if (papers.includes('wool-due')) eq(papers.filter(r => content.cards.some(c => c.id === r)).length, 3, `follow-ups count against the card total: seed ${seed} season 2 holds ${papers}`);
  }
  ok(play(content, { seed: 7 }).seq[2].includes('wool-due'), 'the case under test happens');
});

// ---- data
const fetchOver = (root = new URL('../data/', import.meta.url), override = () => undefined) => async href => {
  const o = override(href); if (o) return o;
  try { const text = await fs.readFile(new URL(href), 'utf8'); return { ok: true, status: 200, text: async () => text }; }
  catch { return { ok: false, status: 404, text: async () => '' }; }
};
test('data: loadContent reads a city by fs and by fetch to the same object, sources included', async () => {
  const viaFetch = await loadContent('testport', { fetch: fetchOver() });
  eq(viaFetch, content);
  ok(content.sources.some(s => s.id === 'testport-fiction'), 'testport-fiction is among the sources, whatever data/sources.json adds');
  eq([content.cards.length, content.stops.length, content.goods.length, content.events.length], [12, 3, 3, 1]);
});
test('data: a file missing from a city reads as empty, but a missing city.json throws and names it', async () => {
  const bare = { readFile: async u => { if (String(u).endsWith('/city.json')) return '{"id":"bare"}'; const e = new Error('no'); e.code = 'ENOENT'; throw e; } };
  const empty = await loadContent('bare', { fs: bare });
  eq([empty.cards, empty.houses, empty.letters, empty.calendar, empty.sources], [[], [], [], {}, []]);
  let msg = ''; await loadContent('nowhere', { fs }).catch(e => { msg = e.message; });
  ok(/nowhere\/city\.json/.test(msg) && /required/.test(msg), `a missing city.json must throw and name the file: ${msg}`);
});
test('data: a file that will not parse throws and names the file', async () => {
  const bad = { readFile: async () => '{ nope' };
  let msg = ''; await loadContent('testport', { fs: bad }).catch(e => { msg = e.message; });
  ok(/city\.json/.test(msg), msg);
  await loadContent('testport', {}).then(() => ok(false), e => ok(/fetch|fs/.test(e.message)));
});
test('data: a content file holding null or the wrong top-level type throws an error naming the file', async () => {
  const serve = (name, body) => ({ readFile: async u => (String(u).endsWith(name) ? body : fs.readFile(u, 'utf8')) });
  const msg = async (name, body) => { let m = ''; await loadContent('testport', { fs: serve(name, body) }).catch(e => { m = e.message; }); return m; };
  for (const [name, body, want] of [
    ['/city.json', 'null', /city\.json.*null/], ['/calendar.json', '[]', /calendar\.json.*list/],
    ['/goods.json', '{}', /goods\.json.*object/], ['/stops.json', 'null', /stops\.json.*null/],
    ['/orders.json', '3', /orders\.json.*number/], ['/sources.json', '{"id":"x"}', /sources\.json.*object/],
  ]) { const m = await msg(name, body); ok(want.test(m), `${name}: "${m}" should match ${want}`); }
  ok(/orders\.json.*object/.test(await msg('/orders.json', '[7]')), 'a card that is not an object names its file');
});
test('data: over fetch only a 404 reads as missing; a 500 or 403 throws and names the file', async () => {
  const status = (suffix, code) => fetchOver(undefined, href => (href.endsWith(suffix) ? { ok: false, status: code, text: async () => '' } : undefined));
  const withText = await loadContent('testport', { fetch: status('/text.json', 404) });
  eq(withText.text, {});
  for (const code of [500, 403]) {
    let msg = ''; await loadContent('testport', { fetch: status('/goods.json', code) }).catch(e => { msg = e.message; });
    ok(/goods\.json/.test(msg) && msg.includes(String(code)), `a ${code} must throw naming the file: "${msg}"`);
  }
  let msg = ''; await loadContent('nowhere', { fetch: status('/never', 404) }).catch(e => { msg = e.message; });
  ok(/city\.json/.test(msg), 'a 404 on city.json still throws');
});
test('data: a string base that is a file path works, with or without a trailing slash and as a URL', async () => {
  const here = fileURLToPath(new URL('../data', import.meta.url));
  for (const base of [here, here + '/', pathToFileURL(here).href, pathToFileURL(here).href + '/']) {
    const c = await loadContent('testport', { fs, base });
    eq(c.city.id, 'testport', `base ${base}`);
  }
  // Windows form: a drive path is a path, not the URL scheme "c:". pathToFileURL on this machine
  // cannot parse it, so the check is that the loader asks fs for a file: URL and never throws "c:".
  const asked = [];
  const spy = { readFile: async u => { asked.push(String(u)); const e = new Error('no'); e.code = 'ENOENT'; throw e; } };
  const err = await loadContent('x', { fs: spy, base: 'C:\\games\\data' }).catch(e => e);
  ok(asked.every(u => u.startsWith('file:///')) && asked.length > 0 && /x\/city\.json/.test(err.message), `asked ${asked[0]}, error ${err.message}`);
});
test('data: every source id testport uses is testport-fiction and is defined', () => {
  const used = new Set(JSON.stringify(content).match(/"src":"[^"]+"/g).map(x => x.slice(7, -1)));
  eq([...used], ['testport-fiction']);
  ok(content.sources.some(s => s.id === 'testport-fiction'));
});

// ---- the engine stays pure
test('engine files name no city, no page, no Math.random and no Date', async () => {
  const dir = new URL('../js/engine/', import.meta.url);
  const files = (await fs.readdir(dir)).filter(f => f.endsWith('.js'));
  ok(files.length >= 7, `${files.length} engine files`);
  for (const f of files) {
    const text = await fs.readFile(new URL(f, dir), 'utf8');
    for (const re of [/cairo/i, /document/, /window/, /Math\.random/, /Date/]) ok(!re.test(text), `${f} matches ${re}`);
  }
});

// ---- MER-78: the draw (DESIGN 2.1 rules 1 and 2). Each case builds the pool from cards of its own, at the opening of season 2 of a
// full game (the third of its act, so the season wants three cards), and calls the draw step alone.
const pooled = (id, group, kind, over = {}) => ({ id, group, kind, from: { name: 'A', role: 'B', seal: null }, title: 't', body: 'b', weight: 100, repeat: true, choices: [choice([{ money: 1 }])], note: 'n', sources: [], ...over });
const NOTICE = { id: null, state: 'open', kind: 'notice', ref: 'welcome' };
const MIRA_OUT = { id: 'x1', agent: 'mira', route: 'harbour-hilltown', leg: 0, left: 1, status: 'out', cargo: { wool: 2 }, purse: 0, sent: 0, contract: { kind: 'own' }, staked: { house: 0, partners: 0 }, orders: [] };
/** The cards the draw adds: from `cards` only, with `desk` already on the desk, an expedition out or not. */
function dealt(cards, { out = false, desk = [], seed = 3 } = {}) {
  const c = variant(x => { x.cards = cards; });
  const s = fresh({ seed, length: 'full' });
  s.t = 2; s.desk = structuredClone(desk);
  if (out) s.expeditions.push(structuredClone(MIRA_OUT));
  steps.drawCards(s, c);
  return s.desk.slice(desk.length).map(p => p.ref);
}
const FOUR = [pooled('fav', 'gifts', 'favour'), pooled('tra', 'orders', 'trade'), pooled('peo', 'hiring', 'people'), pooled('wor', 'court', 'world')];
test('draw: a card that tells of a trip is dealt before any other pool card, whatever the weights', () => {
  const trip = pooled('trip', 'orders', 'trade', { weight: 1, when: { trip: { agent: 'mira', is: 'out' } } });
  const heavy = pooled('heavy', 'disputes', 'world', { weight: 1000 });
  eq(dealt([trip, heavy], { out: true, desk: [NOTICE, NOTICE, NOTICE, NOTICE] }), ['trip'], 'one slot left, and the trip card takes it');
  eq(dealt([trip, heavy], { desk: [NOTICE, NOTICE, NOTICE, NOTICE] }), ['heavy'], 'with no trip out there is no trip card to deal');
});
test('draw: at most two pool cards while a trip is out, three otherwise', () => {
  eq(dealt(FOUR, { out: true }).length, 2, 'a trip is out');
  eq(dealt(FOUR).length, 3, 'none is');
  const home = [{ id: null, state: 'open', kind: 'return', ref: 'return', agent: 'mira', expedition: 'x1', data: {} }];
  eq(dealt(FOUR, { desk: home }).length, 2, 'a trip came home this season: its return paper is on the desk');
});
test('draw: a favour already on the desk, a follow-up\'s too, keeps a pool favour off it', () => {
  const follow = pooled('follow', 'followups', 'favour', { weight: 0 });
  const cards = [follow, pooled('fav', 'gifts', 'favour', { weight: 1000 }), pooled('tra', 'orders', 'trade', { weight: 1 })];
  eq(dealt(cards, { desk: [{ id: null, state: 'open', kind: 'card', ref: 'follow' }] }), ['tra'], 'only the trade card is drawn');
  eq(dealt(cards), ['fav', 'tra'], 'with no favour on the desk the favour is a card like another');
});
test('draw: no two pool cards of one kind in a season', () => {
  const cards = [pooled('peo1', 'hiring', 'people', { weight: 1000 }), pooled('peo2', 'disputes', 'people', { weight: 1000 }), pooled('wor', 'court', 'world', { weight: 1 })];
  const drawn = dealt(cards);
  eq(drawn.length, 2, 'one people card and the world card');
  eq(new Set(drawn.map(r => cards.find(c => c.id === r).kind)).size, 2, `${drawn}`);
});
test('draw: a card that tells of an agent\'s trip is not dealt beside a card that can dismiss that agent, nor the other way round', () => {
  // bots seed 1061 (random, cloth): "Let him go" on a follow-up dismissed Samir, and the trip card dealt beside it refused both its choices
  const follow = pooled('follow', 'followups', 'people', { weight: 0, choices: [choice([{ dismiss: 'mira' }])] });
  const trip = pooled('trip', 'loans', 'people', { weight: 1000, when: { trip: { agent: 'mira', is: 'out' } } });
  const plain = pooled('plain', 'orders', 'trade', { weight: 1 });
  const onDesk = [{ id: null, state: 'open', kind: 'card', ref: 'follow' }];
  eq(dealt([follow, trip, plain], { out: true, desk: onDesk }), ['plain'], 'the trip card waits');
  const sacks = pooled('sacks', 'gifts', 'world', { weight: 1000, choices: [choice([{ dismiss: 'mira' }])] });
  eq(dealt([trip, sacks, plain], { out: true }), ['trip', 'plain'], 'the card that dismisses Mira is not dealt after the trip card either');
  eq(dealt([trip, plain], { out: true }), ['trip', 'plain'], 'with no dismissing card the trip card is dealt');
});
test('draw: every card of both cities has a kind, and the kinds are the four of DESIGN 2.1', async () => {
  const cairo = await loadContent('cairo', { fs });
  for (const c of [...content.cards, ...cairo.cards]) ok(['favour', 'trade', 'people', 'world'].includes(c.kind), `${c.id}: ${c.kind}`);
});

// ---- MER-81: a return or loss paper's choices, and a card that can always be left
/** A state at the desk with exactly `papers` on it (each gets the next id), over `c`. */
function deskOf(c, papers, over = {}) {
  const s = newGame(c, { seed: 7, length: 'acts', house: 'plain' });
  s.desk = papers.map((p, i) => ({ id: `p0-${i}`, state: 'open', ...p }));
  Object.assign(s, over);
  return s;
}
const TRAP = pooled('trap', 'orders', 'trade', { choices: [choice([{ outfit: 'mira', contract: 'own' }])] });
const RETURN = (choices, data = {}) => ({ kind: 'return', ref: 'return', agent: 'mira', expedition: 'x1', data: { entry: 'e', choices, ...data } });
const BONUS = { id: 'bonus', label: 'Pay a bonus', requires: { money: { gte: 30 } }, now: [{ money: -30 }, { trust: '$agent', by: 1 }] };
const NONE = { id: 'none', label: 'Pay nothing more', now: [] };
test('data.js loads returns.json of a real game, and kind is required of a card', async () => {
  ok(content.returns.length >= 2 && content.returns.every(e => e.paper === 'return' || e.paper === 'loss'), 'the entries of testport/returns.json');
  const { validateContent } = await import('../js/engine/content.js');
  const noKind = variant(c => { delete c.cards[0].kind; });
  throws(() => validateContent(noKind, {}), /cards\[0\] \(wool-offer\): missing "kind"/);
});
test('return choices: paperChoices offers the entry\'s choices and choose applies the one picked, its effects as a card\'s are', () => {
  const s = deskOf(content, [RETURN([BONUS, NONE])], { money: 100 });
  eq(paperChoices(s, content, 'p0-0').map(c => c.id), ['bonus', 'none']);
  const t = choose(s, content, 'p0-0', 'bonus');
  eq([t.money, t.agents.mira.trust], [70, 1], 'the cost and the trust rise are applied, $agent is the paper\'s agent');
  eq(t.log.at(-1), { at: 0, kind: 'event', ref: 'return', choice: 'bonus' });
  eq(choose(s, content, 'p0-0', 'none').money, 100);
  throws(() => choose(deskOf(content, [RETURN([BONUS, NONE])], { money: 10 }), content, 'p0-0', 'bonus'), /not available/);
  throws(() => choose(s, content, 'p0-0', 'nope'), /no choice "nope"/);
});
test('return choices: a return paper still answers "ok" (a screen that does not show the choices yet), and one with no choices offers only that', () => {
  const s = deskOf(content, [RETURN([BONUS, NONE])], { money: 100 });
  eq(choose(s, content, 'p0-0', 'ok').money, 100, '"ok" applies nothing');
  const bare = deskOf(content, [RETURN([])]);
  eq(paperChoices(bare, content, 'p0-0'), [{ id: 'ok', label: 'Into the ledger' }]);
  eq(paperChoices(deskOf(content, [RETURN([BONUS], {})], { money: 5 }), content, 'p0-0').map(c => c.id), ['bonus', 'ok'], 'every choice closed: "ok" is offered beside them');
});
test('loss choices: a loss paper offers its entry\'s choices and applies the one picked', () => {
  const rest = { id: 'rest', label: 'Say a word for the family', now: [{ money: -10 }, { rep: 'partners', by: 1 }] };
  const s = deskOf(content, [{ kind: 'lost', ref: 'lost', agent: 'mira', expedition: 'x1', data: { entry: 'l', choices: [rest, NONE] } }], { money: 50 });
  eq(paperChoices(s, content, 'p0-0').map(c => c.id), ['rest', 'none']);
  const t = choose(s, content, 'p0-0', 'rest');
  eq([t.money, t.rep.partners], [40, s.rep.partners + 1]);
  eq(choose(s, content, 'p0-0', 'ok').money, 50);
});
test('a paper\'s choices are read from a copy: paperChoices of a return paper hands out nothing the state owns', () => {
  const s = deskOf(content, [RETURN([BONUS, NONE])], { money: 100 });
  paperChoices(s, content, 'p0-0')[0].label = 'changed';
  eq(s.desk[0].data.choices[0].label, 'Pay a bonus');
});
test('deal: a card is never dealt when none of its choices is open at deal time (an outfit for an agent who is out)', () => {
  const plain = pooled('plain', 'gifts', 'world', { weight: 1 });
  eq(dealt([TRAP, plain], { out: true }), ['plain'], 'Mira is on the road, so "send her out" is shut and the heavy card is passed over');
  eq(dealt([TRAP], { out: true }), [], 'a pool of only such cards leaves the desk short instead of dealing it');
  eq(dealt([TRAP, plain]).includes('trap'), true, 'with Mira home the same card is dealt');
  const money = pooled('rich-only', 'gifts', 'world', { choices: [{ ...choice([{ money: -9999 }]), requires: { money: { gte: 9999 } } }] });
  eq(dealt([money]), [], 'a choice whose requires fails is closed too');
});
test('deal: a card with one open choice among closed ones is dealt, and the draw keeps its stream when nothing is closed', () => {
  const mixed = pooled('mixed', 'gifts', 'world', { choices: [choice([{ outfit: 'mira', contract: 'own' }], null, 'send'), choice([{ money: 1 }], null, 'keep')] });
  eq(dealt([mixed], { out: true }), ['mixed']);
  eq(dealt(FOUR, { seed: 5 }), dealt(FOUR.map(c => ({ ...c })), { seed: 5 }), 'same cards, same seed, same deal');
});
test('leave it: bots seed 1061 (random, cloth): a dealt card whose choices all close in the season gets "Leave it" with no effect, and the season ends', () => {
  // the card was open when dealt; Mira was sent out by another paper in the season, so "send her out" closed
  const s = deskOf(variant(x => { x.cards.push(TRAP); }), [{ kind: 'card', ref: 'trap' }], { money: 77 });
  const c = variant(x => { x.cards.push(TRAP); });
  eq(paperChoices(s, c, 'p0-0').map(x => x.id), ['go'], 'open while Mira is home');
  throws(() => choose(s, c, 'p0-0', 'leave'), /still has a choice that is open/);
  s.expeditions.push(structuredClone(MIRA_OUT));
  eq(paperChoices(s, c, 'p0-0'), [{ ...choice([{ outfit: 'mira', contract: 'own' }]) }, { id: 'leave', label: 'Leave it' }], 'every choice shut: the engine adds its own');
  eq(canEndSeason(s).ok, false);
  const t = choose(s, c, 'p0-0', 'leave');
  eq([t.money, t.queue, t.desk[0].choice], [77, s.queue, 'leave'], 'nothing applied, nothing queued');
  eq(canEndSeason(t).ok, true, 'the season can end');
  eq(t.log.at(-1), { at: 0, kind: 'card', ref: 'trap', choice: 'leave' });
  throws(() => choose(s, c, 'p0-0', 'go'), /is refused/);
});

await done();
