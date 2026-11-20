// Content schemas, lint and reading level (ARCHITECTURE 6, 5): node test/content.mjs, from
// Projects/Merchant/. Plain Node. Runs both tools as real processes on data/testport (must
// pass), on data/cairo (must pass) and on each fixture in test/fixtures/ (must fail, naming
// its rule), and pins the syllable counter on named words.
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test, eq, ok, throws, done } from './lib.mjs';
import { loadContent } from '../js/data.js';
import { holds } from '../js/engine/conditions.js';
import { freshState } from '../js/engine/state.js';
import { validateContent, CONDITION_LEAVES } from '../js/engine/content.js';
import { validateContent as exported } from '../js/engine/index.js';
import { readingLevel, syllables, fkGrade, sentences, longestSentence, CEILINGS } from '../tools/reading-level.mjs';
import { choiceVector, dominates, gradientFailures, lintContent, loadBanned, OPENING_LETTERS } from '../tools/lint-content.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(ROOT, 'test/fixtures');
const content = await loadContent('testport', { fs });
const cairo = await loadContent('cairo', { fs });
const entries = [{ id: 'testport', tab: 'terms', title: 'T', body: 'B' }, { id: 'harbour-town', tab: 'places', title: 'H', body: 'B' }];
const variant = edit => { const c = structuredClone(content); edit(c); return c; };
const problemsOf = (c, opts) => { try { validateContent(c, opts); return []; } catch (e) { return e.problems; } };
const banned = await loadBanned();

function run(tool, city, overlay) {
  const args = [path.join(ROOT, 'tools', tool), city, ...(overlay ? ['--overlay', path.join(FIX, overlay)] : [])];
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
}

// ---- the tools on the cities
test('lint: data/testport passes', () => { const r = run('lint-content.mjs', 'testport'); eq(r.code, 0, r.out); });
test('reading level: data/testport passes', () => { const r = run('reading-level.mjs', 'testport'); eq(r.code, 0, r.out); });
test('lint: data/cairo (every file empty or minimal) passes', () => { const r = run('lint-content.mjs', 'cairo'); eq(r.code, 0, r.out); });
test('reading level: data/cairo passes', () => { const r = run('reading-level.mjs', 'cairo'); eq(r.code, 0, r.out); });
test('validateContent is exported by the engine index', () => ok(exported === validateContent));

// ---- the fixtures: the named tool fails and names the rule, and only that rule
const lintFixtures = [
  ['no-later', 3, 'no choice has a later effect'],
  ['dominated', 4, 'choice "pay" is at least as good'],
  ['missing-source', 1, 'no source "nowhere-1999"'],
  ['banned-word', 5, 'banned stem "servitude"'],
  ['d5-unlocked', 5, 'unlocks the d5 entry "trade-in-people"'],
  ['unknown-key', 6, 'unknown key "wieght"'],
  ['duplicate-id', 6, 'is used twice'],
  ['web-address', 7, 'web address'],
  ['em-dash', 7, 'em or en dash'],
];
for (const [name, rule, text] of lintFixtures) {
  test(`fixture ${name}: lint fails on rule ${rule} and nothing else`, () => {
    const r = run('lint-content.mjs', 'testport', name);
    eq(r.code, 1, r.out);
    const fails = r.out.split('\n').filter(l => l.startsWith('FAIL'));
    ok(fails.length > 0, 'no FAIL line:\n' + r.out);
    ok(fails.every(l => l.startsWith(`FAIL rule ${rule} `)), `a FAIL line is not rule ${rule}:\n${r.out}`);
    ok(r.out.includes(text), `missing "${text}":\n${r.out}`);
  });
  test(`fixture ${name}: reading level still passes (the fault is the lint's)`, () => {
    const r = run('reading-level.mjs', 'testport', name);
    eq(r.code, 0, r.out);
  });
}
const levelFixtures = [
  ['over-grade', 'FAIL grade ceiling', 'cards[wool-offer].body'],
  ['long-sentence', 'FAIL sentence length', 'a sentence of '],
  ['term-without-entry', 'FAIL term rule', 'uses the term "qirad"'],
];
for (const [name, head, text] of levelFixtures) {
  test(`fixture ${name}: reading level fails with "${head}"`, () => {
    const r = run('reading-level.mjs', 'testport', name);
    eq(r.code, 1, r.out);
    ok(r.out.includes(head) && r.out.includes(text), `missing "${head}" or "${text}":\n${r.out}`);
    ok(r.out.includes('worst ten units'), 'no worst-ten list:\n' + r.out);
  });
  test(`fixture ${name}: lint still passes (the fault is the reading level's)`, () => {
    const r = run('lint-content.mjs', 'testport', name);
    eq(r.code, 0, r.out);
  });
}
for (const name of ['d5-entry-ok', 'term-with-entry']) {
  test(`fixture ${name}: both tools pass`, () => {
    for (const tool of ['lint-content.mjs', 'reading-level.mjs']) { const r = run(tool, 'testport', name); eq(r.code, 0, `${tool}: ${r.out}`); }
  });
}

// ---- rule 8: the direction of trade (MER-51b)
const gradeSrc = [{ src: content.sources[0].id }];
const gradeVariant = (grad, edit = () => {}) => variant(c => { c.city.gradients = [{ note: 'Wool went up the hill.', sources: gradeSrc, ...grad }]; edit(c); });
const rule8 = c => lintContent(c, { banned }).filter(f => f.rule === 8);
test('gradient: testport carries none and passes', () => eq(rule8(content), []));
test('gradient: wool dearer uphill passes', () => eq(rule8(gradeVariant({ good: 'wool', from: ['harbour', 'hilltown'] })), []));
test('gradient: wool dearer downhill fails, naming both stops and both prices', () => {
  const f = rule8(gradeVariant({ good: 'wool', from: ['hilltown', 'harbour'] }));
  eq(f.length, 1, JSON.stringify(f));
  ok(f[0].message.includes('wool at harbour costs 20') && f[0].message.includes('30 at hilltown'), f[0].message);
});
test('gradient: equal prices pass (a tie is allowed)', () => eq(rule8(gradeVariant({ good: 'wool', from: ['harbour', 'hilltown'] }, c => { c.stops.find(s => s.id === 'hilltown').sells.wool.base = 20; })), []));
test('gradient: one cent under fails (the edge is exact)', () => eq(rule8(gradeVariant({ good: 'wool', from: ['harbour', 'hilltown'] }, c => { c.stops.find(s => s.id === 'hilltown').sells.wool.base = 19; })).length, 1));
test('gradient: a tier ties inside itself and is held to the stops before it', () => {
  const salt = grad => rule8(gradeVariant({ good: 'salt', ...grad }, c => { c.stops.find(s => s.id === 'saltmarsh').sells.salt.base = 12; }));
  eq(salt({ from: [['harbour', 'saltmarsh'], 'hilltown'] }), [], 'harbour 10 and saltmarsh 12 tie in a tier; hilltown sells no salt');
  eq(salt({ from: ['harbour', ['saltmarsh', 'hilltown']] }), [], 'saltmarsh 12 above harbour 10');
  eq(salt({ from: ['saltmarsh', ['harbour', 'hilltown']] }).length, 1, 'harbour 10 under saltmarsh 12');
});
test('gradient: a stop that does not sell the good is skipped, not failed', () => eq(rule8(gradeVariant({ good: 'salt', from: ['saltmarsh', 'hilltown', 'harbour'] }, c => { c.stops.find(s => s.id === 'harbour').sells.salt.base = 99; })), []));
test('gradient: an act whose base breaks the order fails though the plain base holds', () => {
  const f = rule8(gradeVariant({ good: 'wool', from: ['harbour', 'hilltown'] }, c => { c.stops.find(s => s.id === 'hilltown').sells.wool.baseByAct = [30, 15, 30]; }));
  eq(f.length, 1, JSON.stringify(f));
  ok(f[0].message.includes('act 2'), f[0].message);
});
test('gradient: an unknown stop, an unknown good and a single stop are schema problems (rule 1)', () => {
  for (const grad of [{ good: 'wool', from: ['harbour', 'nowhere'] }, { good: 'gems', from: ['harbour', 'hilltown'] }, { good: 'wool', from: ['harbour'] }]) {
    ok(problemsOf(gradeVariant(grad)).length > 0, JSON.stringify(grad));
  }
});
test('gradient: a gradient with no note or no source is a schema problem', () => {
  ok(problemsOf(variant(c => { c.city.gradients = [{ good: 'wool', from: ['harbour', 'hilltown'], sources: gradeSrc }]; })).some(p => p.message === 'missing "note"'));
  ok(problemsOf(variant(c => { c.city.gradients = [{ good: 'wool', from: ['harbour', 'hilltown'], note: 'x' }]; })).some(p => p.message === 'missing "sources"'));
});
test('gradient: gradientFailures alone, on plain stops', () => eq(gradientFailures({ good: 'g', from: ['a', 'b'] }, [{ id: 'a', sells: { g: { base: 5 } } }, { id: 'b', sells: { g: { base: 4 } } }], 'x').length, 1));
test('gradient: cairo covers the directions the research records', () => {
  const have = new Set(cairo.city.gradients.map(g => g.good));
  for (const g of ['pepper', 'porcelain', 'incense', 'silk', 'gold', 'sugar', 'linen', 'glass', 'copper', 'wool', 'salt']) ok(have.has(g), `no gradient for ${g}`);
  for (const g of cairo.city.gradients) ok(g.note.length > 20 && g.sources.length > 0, `gradient ${g.good} lacks its note or source`);
});
test('gradient: cairo keeps the trade the right way round (Venice pepper above Alexandria, Calicut below Hormuz)', () => {
  const base = (s, g) => cairo.stops.find(x => x.id === s).sells[g].base;
  ok(base('venice', 'pepper') >= base('alexandria', 'pepper') && base('calicut', 'pepper') <= base('hormuz', 'pepper'));
  eq(rule8(cairo), []);
});

// ---- validateContent
test('validate: testport has no problems', () => eq(problemsOf(content), []));
test('validate: one error lists every problem', () => {
  const c = variant(c2 => { c2.cards[0].wieght = 1; c2.goods[0].sigma = 'high'; c2.stops[0].sells.nothing = { base: 1, depth: 1 }; });
  let err;
  try { validateContent(c); } catch (e) { err = e; }
  ok(err, 'did not throw');
  eq(err.problems.length, 3, err.message);
  for (const part of ['wieght', 'sigma', 'nothing']) ok(err.message.includes(part), `message lacks "${part}":\n${err.message}`);
});
test('validate: an unknown key is an error at any depth', () => {
  for (const edit of [
    c => { c.city.colour = 'red'; },
    c => { c.cards[0].choices[0].extra = 1; },
    c => { c.cards[0].from.rank = 1; },
    c => { c.stops[0].label = { dx: 1, dy: 1, anchor: 'start', z: 2 }; },
    c => { c.cards[0].when = { season: ['spring'], oops: 1 }; },
    c => { c.cards[0].choices[0].now = [{ money: 1, extra: 2 }]; },
  ]) {
    const p = problemsOf(variant(edit));
    ok(p.some(x => x.kind === 'unknown-key'), `no unknown-key problem for ${edit}: ${JSON.stringify(p)}`);
  }
});
test('validate: an agent may carry sources, and a source id that is not in sources.json fails (MER-50)', () => {
  ok(problemsOf(variant(c => { c.agents[0].sources = [{ src: 'testport-fiction', at: 'a note' }]; })).length === 0, 'a good agent source was refused');
  const bad = problemsOf(variant(c => { c.agents[0].sources = [{ src: 'lost-1900' }]; }));
  ok(bad.some(x => String(x.text ?? x.message ?? JSON.stringify(x)).includes('no source "lost-1900"') && JSON.stringify(x).includes('sources')), `no bad-source problem: ${JSON.stringify(bad)}`);
});
test('validate: city.json clusters is a map of ids to names, and anything else fails (MER-44b)', () => {
  ok(problemsOf(variant(c => { c.city.clusters = { 'red-sea': 'The Red Sea' }; })).length === 0, 'a good clusters map was refused');
  ok(problemsOf(variant(c => { c.city.clusters = { 'Red Sea': 'x' }; })).length > 0, 'a cluster id with a capital and a space passed');
  ok(problemsOf(variant(c => { c.city.clusters = { 'red-sea': 7 }; })).length > 0, 'a cluster name that is a number passed');
  ok(problemsOf(variant(c => { c.city.clusters = ['red-sea']; })).length > 0, 'a clusters list passed');
});
test('validate: a reference to nothing is an error (card, good, stop, agent, house, source, entry)', () => {
  for (const [edit, text] of [
    [c => { c.city.opening.plain = ['no-such-card']; }, 'no card "no-such-card"'],
    [c => { c.houses[0].stock = { gold: 1 }; }, 'no good "gold"'],
    [c => { c.routes[0].legs[0].to = 'atlantis'; }, 'no stop "atlantis"'],
    [c => { c.houses[0].agents = ['nobody']; }, 'no agent "nobody"'],
    [c => { c.city.opening.nowhere = ['welcome-note']; }, 'no house "nowhere"'],
    [c => { c.goods[0].sources = [{ src: 'lost-1900' }]; }, 'no source "lost-1900"'],
    [c => { c.cards[0].unlocks = ['ghost-entry']; c.notebook = [{ id: 'real', tab: 'terms', title: 'Real', body: 'Real.' }]; }, 'no notebook "ghost-entry"'],
    [c => { c.calendar.end.event = 'no-event'; }, 'no event "no-event"'],
  ]) {
    const p = problemsOf(variant(edit));
    ok(p.some(x => x.message.includes(text)), `expected "${text}", got ${JSON.stringify(p.map(x => x.message))}`);
  }
});
test('validate: a reference to a kind with an empty file is not checked (a skeleton city)', () => {
  const c = variant(c2 => { c2.notebook = []; });
  eq(problemsOf(c), []); // the testport welcome card unlocks entries its empty notebook does not list
});
test('validate: art, seal and still ids are checked when the art ids are given', () => {
  const p = problemsOf(content, { art: new Set(['desk-day']) });
  ok(p.some(x => x.message.includes('no picture "seal-1"')), JSON.stringify(p));
  eq(problemsOf(content, { art: new Set(['seal-1']) }), []);
});
test('validate: duplicate ids across a kind are errors', () => {
  const p = problemsOf(variant(c => { c.goods.push({ ...c.goods[0] }); }));
  ok(p.some(x => x.kind === 'duplicate-id' && x.path.startsWith('goods.json')), JSON.stringify(p));
});
test('validate: ids are lowercase with hyphens', () => {
  ok(problemsOf(variant(c => { c.goods[0].id = 'Wool_Bale'; })).some(x => /lowercase with hyphens/.test(x.message)));
});
test('validate: a card effect belongs only inside a later entry; an order only in a letter', () => {
  ok(problemsOf(variant(c => { c.cards[0].choices[0].now = [{ card: 'wool-due' }]; })).some(x => /only inside a later/.test(x.message)));
  ok(problemsOf(variant(c => { c.cards[0].choices[0].now = [{ order: { go: 'on' } }]; })).some(x => /order goes only in a letter/.test(x.message)));
});
test('validate: a later entry needs a whole number of seasons and do or card', () => {
  ok(problemsOf(variant(c => { c.cards[0].choices[0].later = [{ in: 0, do: [] }]; })).length > 0);
  ok(problemsOf(variant(c => { c.cards[0].choices[0].later = [{ in: 1 }]; })).some(x => /needs do or card/.test(x.message)));
});
test('validate: every condition leaf is accepted, and agrees with the engine\'s own', () => {
  const state = freshState(content, { seed: 1, length: 'acts', house: 'rich' });
  const samples = {
    season: { season: ['spring'] }, year: { year: [1200, 1202] }, act: { act: 1 }, length: { length: 'acts' },
    notebook: { notebook: 'testport' }, out: { out: { lte: 2 } }, money: { money: { lte: 900 } },
    stock: { stock: 'wool', gte: 1 }, flag: { flag: 'x', not: true }, rep: { rep: 'partners', gte: 1 }, agent: { agent: 'mira', hired: true },
    trip: { trip: { agent: 'mira', is: 'ready' } },
  };
  eq(Object.keys(samples).sort(), Object.keys(CONDITION_LEAVES).sort());
  const c2 = variant(c => { c.notebook = entries; });
  for (const [leaf, cond] of Object.entries(samples)) {
    holds(cond, state, content); // the engine accepts it (throws on an unknown key)
    c2.cards[0].when = cond;
    eq(problemsOf(c2), [], leaf);
  }
  c2.cards[0].when = { all: [samples.notebook, { any: [samples.out, samples.money] }] };
  eq(problemsOf(c2), []);
});
test('validate: the { notebook: id } leaf and lte on money and out (MER-02) are accepted', () => {
  for (const when of [{ notebook: 'testport' }, { money: { lte: 50 } }, { out: { lte: 1 } }, { money: { gte: 10, lte: 90 } }]) {
    eq(problemsOf(variant(c => { c.notebook = entries; c.cards[0].when = when; })), [], JSON.stringify(when));
  }
});
test('validate: a bad condition is an error', () => {
  for (const when of [{ money: 120 }, { season: ['monsoon'] }, { rep: 'partners' }, { flag: 'x', gte: 'two' }, { all: [] }, { bogus: 1 }, { leg: { by: 'dhow' } }]) {
    ok(problemsOf(variant(c => { c.cards[0].when = when; })).length > 0, JSON.stringify(when));
  }
});
test('validate: a letter\'s when may test the expedition, a card\'s may not', () => {
  const letter = { id: 'road-1', kind: 'question', title: 'A question from the road', body: 'Mira asks what to do.', when: { leg: { by: 'mules' } },
    choices: [{ id: 'go', label: 'Go on', now: [{ order: { go: 'on' } }] }, { id: 'wait', label: 'Wait', now: [{ order: { go: 'wait' } }] }],
    note: 'An invented letter.', sources: [{ src: 'testport-fiction' }] };
  eq(problemsOf(variant(c => { c.letters = [letter]; })), []);
  ok(problemsOf(variant(c => { c.letters = [{ ...letter, kind: 'report', choices: letter.choices }]; })).some(x => /not orders/.test(x.message)));
  ok(problemsOf(variant(c => { c.letters = [{ ...letter, kind: 'question', happened: [] }]; })).some(x => /only a report/.test(x.message)));
  ok(problemsOf(variant(c => { c.city.secondSeason.letter = 'road-1'; c.letters = [letter]; })).length === 0);
  ok(problemsOf(variant(c => { c.city.secondSeason.letter = 'no-letter'; c.letters = [letter]; })).some(x => /no letter/.test(x.message)));
});
test('validate: a calendar whose end is not the last season is an error', () => {
  ok(problemsOf(variant(c => { c.calendar.end.season = 9; })).some(x => /not the last season/.test(x.message)));
});
test('validate: a primary source needs a translator field, null for an edition in the original', () => {
  const prim = { id: 'old-1300', author: 'A. Writer', title: 'A Handbook', year: 1300, publisher: null, kind: 'primary', contested: false, period: '1300' };
  ok(problemsOf(variant(c => { c.sources = [...c.sources, prim]; })).some(x => /needs "translator"/.test(x.message)));
  eq(problemsOf(variant(c => { c.sources = [...c.sources, { ...prim, translator: null }]; })), []);
});

// ---- the sources list, data/sources.json (moved there by MER-07). It only grows: write units
// append works, never change an id, so the count is a floor, not a pin.
test('sources: at least the 28 checked works, each with author, title, year and publisher, and no web address', async () => {
  const s = JSON.parse(await fs.readFile(path.join(ROOT, 'data/sources.json'), 'utf8'));
  ok(s.length >= 28, `only ${s.length} works`);
  eq(new Set(s.map(x => x.id)).size, s.length, 'a source id appears twice');
  for (const x of s) for (const k of ['author', 'title', 'year', 'publisher']) ok(x[k], `${x.id} lacks ${k}`);
  ok(!/https?:|www\./i.test(JSON.stringify(s)), 'a web address in the sources');
  for (const id of ['ibn-battuta-1958', 'goitein-1967', 'pegolotti-1936', 'abu-lughod-1989']) ok(s.some(x => x.id === id), `no ${id}`);
  eq(s.find(x => x.id === 'pegolotti-1936').translator, null);
  eq(s.filter(x => x.kind === 'primary').every(x => 'translator' in x), true);
  eq(problemsOf({ ...cairo, sources: s }), [], 'the list validates, inside a city that has it');
  eq(lintContent({ ...cairo, sources: s }, { banned }), [], 'and lints');
});
test('a route leg may carry a when condition and a note; any other unknown key still fails', () => {
  const r = structuredClone(cairo.routes);
  ok(r.length > 0, 'cairo has routes');
  r[0].legs[0].when = { year: [1345, 1347] };
  r[0].legs[0].note = 'estimate';
  eq(problemsOf({ ...cairo, routes: r }), [], 'when and note accepted');
  const bad = structuredClone(r); bad[0].legs[0].when = { year: 'soon' };
  ok(problemsOf({ ...cairo, routes: bad }).length > 0, 'a malformed when is refused');
  const odd = structuredClone(r); odd[0].legs[0].colour = 'red';
  ok(problemsOf({ ...cairo, routes: odd }).length > 0, 'an unknown leg key is refused');
});
test('a choice may carry ui: "outfit-first" and nothing else in that key', () => {
  const c = structuredClone(cairo.cards);
  const first = c.find(x => x.id === 'first-expedition');
  ok(first && first.choices.some(ch => ch.ui === 'outfit-first'), 'the first expedition card opens the one-press outfitting');
  eq(problemsOf({ ...cairo, cards: c }), [], 'accepted');
  first.choices.find(ch => ch.ui).ui = 'open-the-map';
  ok(problemsOf({ ...cairo, cards: c }).length > 0, 'an unknown ui value is refused');
});
test('cairo has every file of ARCH 5, empty or minimal', async () => {
  for (const f of ['city', 'calendar', 'houses', 'goods', 'stops', 'routes', 'agents', 'events', 'notebook', 'terms', 'text', 'letters']) {
    await fs.access(path.join(ROOT, 'data/cairo', `${f}.json`));
  }
  for (const g of ['orders', 'disputes', 'loans', 'tolls', 'gifts', 'hiring', 'followups', 'court', 'faith', 'news']) {
    await fs.access(path.join(ROOT, 'data/cairo/cards', `${g}.json`));
  }
});

// ---- rule 4's arithmetic and the opening-letter exception
test('rule 4: a choice is summed over now and later', () => {
  eq(choiceVector({ now: [{ money: -15 }], later: [{ in: 1, do: [{ money: 10 }, { rep: 'agents', by: 1 }] }] }), { money: -5, 'rep:agents': 1 });
});
test('rule 4: a loan is money now and debt, never free money', () => {
  const v = choiceVector({ now: [{ loan: { from: 'bank', principal: 100, in: 3, rate: 0.1 } }] });
  eq(v, { money: 100, 'debt:bank': -100 });
  ok(!dominates(v, {}) && !dominates({}, v));
});
test('rule 4: dominates needs better somewhere and no worse anywhere', () => {
  ok(dominates({ money: 1 }, { money: 0 }));
  ok(dominates({ money: 1, 'rep:court': 1 }, { money: 1 }));
  ok(!dominates({ money: 1 }, { money: 1 }), 'equal is not better');
  ok(!dominates({ money: 5 }, { money: 0, 'stock:wool': 1 }), 'a trade-off is not domination');
});
test('rule 4: only the opening letters named in the lint\'s head are exempt', () => {
  eq(OPENING_LETTERS, { cairo: ['opening-letter', 'opening-letter-broker', 'first-expedition'], testport: ['welcome-note'] });
  const dominated = id => variant(c => {
    c.cards.find(x => x.id === 'welcome-note').id = id;
    c.city.opening = { plain: [id, 'wool-offer'], rich: [id, 'salt-dispute'] };
  });
  eq(lintContent(content, { banned }), []);
  eq(lintContent(dominated('some-other-card'), { banned }).map(f => f.rule), [4], 'welcome-note\'s choices are dominated; under another id the lint says so');
});
test('rule 3: a choice with no effect at all fails', () => {
  const f = lintContent(variant(c => { c.cards[0].choices[0].now = []; c.cards[0].choices[0].later = []; }), { banned });
  ok(f.some(x => x.rule === 3 && /has no effect/.test(x.message)), JSON.stringify(f));
});
test('rule 5: a banned stem is caught at a word start, in any case, and not inside another word', () => {
  const hit = t => lintContent(variant(c => { c.cards[0].body = t; }), { banned }).filter(f => f.rule === 5).length;
  eq(hit('A Servitude is owed.'), 1);
  eq(hit('He thinks of bondage.'), 1);
  eq(hit('The cart was empty.'), 0);
  eq(hit('A slaver at the quay.'), 1);
  eq(hit('Slavic traders came.'), 0, 'Slavic is not a stem match');
});
test('rule 5: a banned stem anywhere but a d5 entry fails, including a good name and an agent', () => {
  ok(lintContent(variant(c => { c.goods[0].name = 'Thrall'; }), { banned }).some(f => f.rule === 5));
  ok(lintContent(variant(c => { c.agents[0].name = 'Bondsman'; }), { banned }).some(f => f.rule === 5));
  ok(lintContent(variant(c => { c.text = { about: [{ id: 'a', body: 'About slaves.', sources: [{ src: 'testport-fiction' }] }] }; }), { banned }).some(f => f.rule === 5));
  eq(lintContent(variant(c => { c.text = { about: [{ id: 'a', body: 'About slaves.', context: 'd5', sources: [{ src: 'testport-fiction' }] }] }; }), { banned }), []);
});
test('rules 5 and 7 reach returns.json (MER-82): a banned stem, a dash or a web address in an entry fails', () => {
  const withRet = edit => variant(c => { c.returns = structuredClone(content.returns?.length ? content.returns : [{ id: 'x', paper: 'loss', title: 'T', body: 'B', choices: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], note: 'n', sources: [{ src: 'testport-fiction' }] }]); edit(c.returns[0]); });
  const rules = edit => lintContent(withRet(edit), { banned }).map(f => f.rule);
  ok(rules(e => { e.body = 'The slaver came.'; }).includes(5), 'banned stem in a body');
  ok(rules(e => { e.choices[0].label = 'Pay \u2014 now'; }).includes(7), 'a dash in a label');
  ok(rules(e => { e.note = 'See example.com for more.'; }).includes(7), 'a web address in a note');
  ok(!rules(e => { e.body = 'The cart was empty.'; }).includes(5) && !rules(e => { e.body = 'The cart was empty.'; }).includes(7), 'plain text passes');
});
test('the cause fact (MER-82): a loss entry may name sea, river, desert or robbers, and nothing else', () => {
  const bad = cause => { try { validateContent(variant(c => { c.returns = [{ id: 'x', paper: 'loss', facts: { cause }, title: 'T', body: 'B', choices: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], note: 'n', sources: [{ src: 'testport-fiction' }] }]; }), {}); } catch (e) { return e.problems.map(p => p.message).join(' | '); } return null; };
  eq(bad(['sea', 'river', 'desert', 'robbers']), null);
  ok(/needs one of sea, river, desert, robbers/.test(bad(['storm']) ?? ''), String(bad(['storm'])));
});
test('rule 2: a fact in text.json needs a source unless it says fact false', () => {
  const t = piece => lintContent(variant(c => { c.text = { about: [piece] }; }), { banned });
  ok(t({ id: 'a', body: 'Cairo was large.' }).some(f => f.rule === 2));
  eq(t({ id: 'a', body: 'Welcome.', fact: false }), []);
  eq(t({ id: 'a', body: 'Cairo was large.', sources: [{ src: 'testport-fiction' }] }), []);
});
test('rule 5: a d5 entry is unreachable by an unlock effect, in now or in a later entry', () => {
  const d5 = { id: 'hard-part', tab: 'terms', title: 'A hard part', body: 'Some words.', context: 'd5', sources: [{ src: 'testport-fiction' }] };
  const lint = edit => lintContent(variant(c => { c.notebook = [...entries, d5]; edit(c); }), { banned }).filter(f => f.rule === 5);
  eq(lint(() => {}), [], 'the entry alone is fine');
  eq(lint(c => { c.cards[0].choices[0].now = [{ unlock: 'hard-part' }]; }).length, 1, 'now');
  eq(lint(c => { c.cards[0].choices[0].later = [{ in: 1, do: [{ unlock: 'hard-part' }] }]; }).length, 1, 'later');
  eq(lint(c => { c.cards[0].unlocks = ['hard-part']; }).length, 1, 'unlocks list');
  eq(lint(c => { c.events[0].do = [{ unlock: 'hard-part' }]; }).length, 1, 'event');
});
test('rule 2: a card, letter, event with a note and notebook entry with no sources fails', () => {
  const r2 = edit => lintContent(variant(edit), { banned }).filter(f => f.rule === 2).map(f => f.path);
  eq(r2(c => { delete c.cards[0].sources; }), [`cards[${content.cards[0].id}]`]);
  eq(r2(c => { c.cards[0].sources = []; }), [`cards[${content.cards[0].id}]`]);
  eq(r2(c => { c.events[0].sources = []; }), ['events[fair-closes]']);
  eq(r2(c => { c.notebook = [{ id: 'e', tab: 'terms', title: 'E', body: 'Body.' }]; c.cards[0].unlocks = ['e']; c.cards[1].unlocks = ['e']; }).filter(p => p.startsWith('notebook')), ['notebook[e]']);
  eq(r2(c => { c.letters = [{ id: 'l', kind: 'question', title: 'T', body: 'B.', choices: [{ id: 'a', label: 'A', now: [{ money: 1 }] }, { id: 'b', label: 'B', now: [{ money: 2 }] }], note: 'N.' }]; }), ['letters[l]']);
});
test('reading level: the file mean fails on its own when every unit is under its own ceiling', () => {
  // Every body and note sits under its own ceiling (7.0 and 8.0) and the mean over them is above 6.5.
  const hard = 'Negotiate considerable administrative documentation';
  const c = variant(c2 => { for (const card of c2.cards) { card.body = hard + '.'; card.note = hard + '.'; } });
  const { failures, means } = readingLevel(c);
  ok(failures.every(f => f.rule === 'file mean' || f.rule === 'grade ceiling'), JSON.stringify(failures));
  ok(means['cards/orders.json'] > 6.5, `mean ${means['cards/orders.json']}`);
  ok(failures.some(f => f.rule === 'file mean'), 'no file mean failure');
  eq(readingLevel(content).failures, []);
});
test('reading level: titles, labels and hints stay out of the file mean (DECISIONS 2026-11-17)', () => {
  // Hard fragments only: the labels, hints and titles of every card grade far above 6.5, the
  // bodies and notes are untouched. Counted, they would push the mean over; left out, it passes.
  const hard = 'Negotiate considerable administrative documentation';
  const c = variant(c2 => {
    for (const card of c2.cards) { card.title = hard; for (const ch of card.choices) { ch.label = hard; ch.hint = hard; } }
  });
  const { failures, units } = readingLevel(c);
  eq(failures, [], JSON.stringify(failures));
  const frag = units.filter(u => u.fragment && u.file.startsWith('cards/')), rest = units.filter(u => !u.fragment && u.file.startsWith('cards/'));
  ok(frag.length > 0 && frag.every(u => u.grade > 6.5), 'the fragments should grade hard');
  ok(rest.every(u => ['card body', 'note'].includes(u.kind)), 'only bodies and notes are in the mean');
  const withFragments = [...frag, ...rest].filter(u => u.file === 'cards/orders.json');
  const mean = withFragments.reduce((a, u) => a + u.grade, 0) / withFragments.length;
  ok(mean > 6.5, `counting the fragments the mean would be ${mean.toFixed(2)}, so a regression to counting them would fail the suite`);
});
test('reading level: a fragment still has the sentence ceiling', () => {
  const long = Array(23).fill('word').join(' ');
  const c = variant(c2 => { c2.cards[0].choices[0].hint = long; });
  eq(readingLevel(c).failures.map(f => f.rule), ['sentence length']);
});
test('reading level: a term is allowed when the card unlocks it by an effect or requires it in when', () => {
  const termed = edit => variant(c => {
    c.notebook = [...entries, { id: 'qirad', tab: 'terms', title: 'Qirad', body: 'A deal.', sources: [{ src: 'testport-fiction' }] }];
    c.terms = [{ word: 'qirad', forms: ['qirads'], entry: 'qirad' }];
    c.cards[0].body = 'Nell offers a qirad. She wants an answer today.';
    edit(c);
  });
  const rules = c => readingLevel(c).failures.map(f => f.rule);
  eq(rules(termed(() => {})), ['term rule'], 'no unlock');
  eq(rules(termed(c => { c.cards[0].unlocks = ['qirad']; })), [], 'unlocks list');
  eq(rules(termed(c => { c.cards[0].choices[0].now = [{ unlock: 'qirad' }]; })), [], 'unlock effect');
  eq(rules(termed(c => { c.cards[0].when = { notebook: 'qirad' }; })), [], 'when leaf');
  eq(rules(termed(c => { c.cards[0].when = { all: [{ season: ['spring'] }, { notebook: 'qirad' }] }; })), [], 'when inside all');
  eq(rules(termed(c => { c.cards[0].when = { any: [{ season: ['spring'] }, { notebook: 'qirad' }] }; })), ['term rule'], 'inside any is not required');
  eq(rules(termed(c => { c.cards[0].body = 'Nell offers two QIRADS. She wants an answer today.'; })), ['term rule'], 'a form, any case');
  eq(rules(termed(c => { c.cards[0].body = 'Nell offers a deal. She wants an answer today.'; c.cards[0].note = 'A qirad is a deal.'; })), [], 'a note may use a term');
  eq(rules(termed(c => { c.notebook = entries; })), ['term rule'], 'a term whose entry is missing');
});
test('banned.json is a plain list of lowercase words and nothing else', async () => {
  const b = JSON.parse(await fs.readFile(path.join(ROOT, 'tools/banned.json'), 'utf8'));
  ok(Array.isArray(b) && b.length >= 10 && b.every(w => typeof w === 'string' && w === w.toLowerCase()));
});

// ---- the syllable counter: word, count
const SYLLABLES = [
  ['the', 1], ['cake', 1], ['table', 2], ['people', 2], ['little', 2], ['simple', 2], ['beautiful', 3], ['merchant', 2],
  ['caravan', 3], ['cairo', 2], ['silver', 2], ['yusuf', 2], ['money', 2], ['wanted', 2], ['asked', 1], ['called', 1],
  ['makes', 1], ['boxes', 2], ['places', 2], ['goes', 1], ['radio', 3], ['india', 3], ['area', 3], ['created', 2],
  ['quiet', 2], ['question', 2], ['nation', 2], ['region', 2], ['whale', 1], ['agree', 2], ['queue', 1], ['year', 1],
  ['every', 2], ['business', 2], ['damascus', 3], ['alexandria', 5], ['dinars', 2], ['notebook', 3], ['played', 1], ['needed', 2],
  ['Sultan\'s', 2], ['Qirad', 2],
];
for (const [w, n] of SYLLABLES) test(`syllables: ${w} is ${n}`, () => eq(syllables(w), n));
test('syllables: a word with no letters has none and every word has at least one', () => {
  eq(syllables('...'), 0);
  eq(syllables('rhythm'), 1);
});

test('grade: pinned values for plain text', () => {
  const g = fkGrade('The cat sat on the mat.');
  ok(Math.abs(g - (0.39 * 6 + 11.8 * 1 - 15.59)) < 1e-9, `got ${g}`);
  eq(fkGrade('...'), null);
});
test('grade: a hard sentence grades far above the ceiling and a plain one far below', () => {
  ok(fkGrade('The negotiation concerning transportation insurance necessitates considerable administrative documentation.') > CEILINGS.body + 10);
  ok(fkGrade('Nell has wool. She wants to sell it.') < CEILINGS.body - 4);
});
test('grade: a term, a place name, a good or a real person counts as at most two syllables', () => {
  const plain = fkGrade('Hasan went to Alexandria today.');
  const fixed = fkGrade('Hasan went to Alexandria today.', new Set(['alexandria']));
  ok(fixed < plain, `${fixed} should be under ${plain}`);
  // ...and a one-syllable name counts as one, not two (gold, salt: MER-31's goods pushed a note over)
  eq(fkGrade('Gold came to Cairo.', new Set(['gold', 'cairo'])), fkGrade('Gold came to Cairo.', new Set(['cairo'])));
});
test('grade: a {template} slot is one two-syllable word', () => {
  eq(fkGrade('{agent} paid {money} dinars.'), 0.39 * 4 + 11.8 * 7 / 4 - 15.59, 'four words, seven syllables');
});
test('sentences: split on . ! ? and a bare fragment is one sentence', () => {
  eq(sentences('One. Two! Three? Four').length, 4);
  eq(sentences('Agree, and buy silk in Damascus').length, 1);
  eq(longestSentence('Go now. Go to the market and buy four loads of wool for the house.'), 13);
});
test('the ceilings are the ones ARCH 6.3 names', () => eq(CEILINGS, { body: 7.0, note: 8.0, fileMean: 6.5, sentence: 22 }));

test('validate: kind is required of every card (MER-81), and a kind outside the four is refused', () => {
  const p = problemsOf(variant(c => { delete c.cards[0].kind; }));
  eq(p.map(x => [x.path.split(' ')[0], x.message]), [['cards[0]', 'missing "kind"']]);
  ok(problemsOf(variant(c => { c.cards[0].kind = 'gossip'; })).length === 1, 'an unknown kind is refused');
  eq(problemsOf(variant(c => {})), [], 'the untouched city is clean');
});
test('data.js: returns.json is loaded by the page\'s loader (fetch as well as fs), and a file a city lacks reads empty (MER-81)', async () => {
  const root = new URL('../data/', import.meta.url);
  const serve = skip => async href => {
    if (skip && skip.test(href)) return { ok: false, status: 404 };
    try { const text = fsSync.readFileSync(new URL(href), 'utf8'); return { ok: true, status: 200, text: async () => text }; }
    catch { return { ok: false, status: 404 }; }
  };
  const viaFetch = await loadContent('testport', { fetch: serve(null), base: root });
  eq(viaFetch.returns, JSON.parse(fsSync.readFileSync(new URL('testport/returns.json', root), 'utf8')));
  ok(viaFetch.returns.length > 0, 'testport has entries');
  eq((await loadContent('testport', { fetch: serve(/returns\.json$/), base: root })).returns, [], 'a city with no returns.json reads an empty list');
});

await done();
