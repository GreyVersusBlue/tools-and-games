// Engine units (ARCHITECTURE 7.1): node test/engine.mjs, from Projects/Merchant/.
// Plain Node, no browser, no clock. The game it plays is the invented city in data/testport/.
import fs from 'node:fs/promises';
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
  for (const k of ['loans', 'expeditions', 'desk', 'done', 'queue', 'notebook', 'log']) ok(Array.isArray(s[k]), k);
  for (const k of ['stock', 'market', 'known', 'agents', 'rep', 'flags', 'seen']) ok(s[k] && typeof s[k] === 'object' && !Array.isArray(s[k]), k);
  eq(s.score, null);
  eq(s.phase, 'desk');
  eq(Object.keys(s).sort(), ['agents', 'city', 'desk', 'done', 'expeditions', 'flags', 'house', 'known', 'length', 'loans', 'log', 'market',
    'money', 'notebook', 'phase', 'queue', 'rep', 'rng', 'score', 'seed', 'seen', 'stock', 't', 'v']);
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
});
test('turn: choose applies now-effects, queues later-effects with at, unlocks and logs', () => {
  const s = choose(game(), content, 'p0-1', 'buy');
  eq([s.money, s.stock.wool], [460, 14]);
  eq(s.queue, [{ at: 2, do: [], card: 'wool-due', from: 'wool-offer/buy' }]);
  eq(s.log, [{ at: 0, kind: 'card', ref: 'wool-offer', choice: 'buy' }]);
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
  eq(s.desk.map(p => p.ref), ['salt-dispute']);
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
  eq(s.desk.length, 1, 'the target of 3 cards is met by the follow-up and the one drawable card');
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
  eq(endSeason(answer(t, c), c).desk.length, 3);
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
    eq(calls, ['move', 'risk', 'tolls', 'drift', 'fireDue', 'advance', 'end', 'returns', 'letters', 'news', 'events', 'drawCards']);
    s = endSeason(answer(s, content), content); calls.length = 0;
    s = endSeason(answer(s, content), content);                 // season index 2 to 8: a gap
    eq(calls, ['move', 'risk', 'tolls', 'drift', 'fireDue', 'advance', 'jump', 'end']);
    eq(s.phase, 'interlude');
  } finally { Object.assign(steps, saved); }
});
test('turn: a gap between acts goes to the interlude and openSeason opens the next act', () => {
  let s = game();
  for (let t = 0; t < 3; t++) s = endSeason(answer(s, content), content);
  eq([s.phase, s.t, s.desk.length], ['interlude', 3, 0]);
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
  eq(s.money, 510, 'final money');
  eq(s.log.length, 9, 'log length');
  eq(JSON.stringify(s), JSON.stringify((() => {
    let t = game();
    while (t.phase !== 'recall') { t = t.phase === 'interlude' ? openSeason(t, content) : endSeason(answer(t, content), content); }
    return recall(t, content, {});
  })()), 'a second run is the same game');
});

// ---- data
test('data: loadContent reads a city by fs and by fetch to the same object, sources included', async () => {
  const fetcher = async href => {
    try { const text = await fs.readFile(new URL(href), 'utf8'); return { ok: true, text: async () => text }; }
    catch { return { ok: false, text: async () => '' }; }
  };
  const viaFetch = await loadContent('testport', { fetch: fetcher });
  eq(viaFetch, content);
  ok(content.sources.some(s => s.id === 'testport-fiction'), 'testport-fiction is among the sources, whatever data/sources.json adds');
  eq([content.cards.length, content.stops.length, content.goods.length, content.events.length], [4, 3, 3, 1]);
});
test('data: a missing file reads as empty and a file that will not parse throws', async () => {
  const empty = await loadContent('nowhere', { fs });
  eq([empty.cards, empty.houses, empty.letters, empty.city, empty.calendar], [[], [], [], {}, {}]);
  const bad = { readFile: async () => '{ nope' };
  let msg = ''; await loadContent('testport', { fs: bad }).catch(e => { msg = e.message; });
  ok(/city\.json/.test(msg), msg);
  await loadContent('testport', {}).then(() => ok(false), e => ok(/fetch|fs/.test(e.message)));
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

await done();
