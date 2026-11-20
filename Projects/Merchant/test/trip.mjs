// The `trip` leaf, the `outfit` effect and the cargo on the jump's settled line (ARCHITECTURE 4.12,
// MER-74): node test/trip.mjs, from Projects/Merchant/. Plain Node, no browser, no clock.
// Testport is the city; Mira is its one traveller, made plain so the road times are the table's.
import fs from 'node:fs/promises';
import { test, eq, ok, throws, done } from './lib.mjs';
import { loadContent } from '../js/data.js';
import { validateContent } from '../js/engine/content.js';
import { holds, tripOf, tripLeaf } from '../js/engine/conditions.js';
import { apply } from '../js/engine/effects.js';
import { lintContent, tripFailures } from '../tools/lint-content.mjs';
import { destinations } from '../js/engine/routes.js';
import { newGame, openSeason, endSeason, choose, paperChoices, outfit, view } from '../js/engine/index.js';
import { seasonIndex } from '../js/engine/calendar.js';

const T = await loadContent('testport', { fs });
const variant = (c, edit) => { const x = structuredClone(c); edit(x); return x; };
const calm = variant(T, x => {
  for (const r of x.routes) for (const l of r.legs) l.risk = 0;
  x.agents.find(a => a.id === 'mira').traits = ['honest'];
});

const leaf = is => ({ trip: { agent: 'mira', is } });
const BODY = '{agent} took {good} to {to} by way of {route}. {seasons}.';
/** A card that tells of Mira's trip in state `is`, so heavy a draw always picks it when it holds. */
const tripCard = (id, is, over = {}) => ({
  id, group: 'orders', from: { name: 'Nell the broker', role: 'Testport', seal: null },
  title: 'News of {agent}', body: BODY, when: leaf(is), weight: 1000, repeat: true,
  choices: [
    { id: 'ok', label: 'Hear it, {agent}', hint: 'About {good}.', now: [{ rep: 'partners', by: 1 }], later: [{ in: 1, do: [{ rep: 'partners', by: 0 }] }] },
    { id: 'no', label: 'Say nothing', now: [{ rep: 'partners', by: -1 }] },
  ],
  note: 'An invented card for testing.', sources: [{ src: 'testport-fiction' }], ...over,
});
const withCards = (...cards) => variant(calm, x => { x.cards.push(...cards); });
const WOOL = { agent: 'mira', route: 'harbour-hilltown', cargo: { wool: 10 }, purse: 0, contract: 'own', sell: ['wool'], buy: [] };

function answer(s, c) {
  for (const p of s.desk) {
    if (p.state !== 'open') continue;
    const ch = paperChoices(s, c, p.id).find(x => holds(x.requires, s, c));
    s = choose(s, c, p.id, ch.id);
  }
  return s;
}
const step = (s, c) => (s.phase === 'interlude' ? openSeason(s, c) : endSeason(answer(s, c), c));
const game = (c = calm, over = {}) => newGame(c, { seed: 7, length: 'full', house: 'plain', ...over });
/** Plays on until `until(state)` holds, at most `max` seasons. */
function playTo(s, c, until, max = 20) { for (let i = 0; i < max && !until(s); i++) s = step(s, c); ok(until(s), 'never reached the state'); return s; }
const deskRefs = s => s.desk.map(p => p.ref);
const onDesk = (s, id) => s.desk.find(p => p.ref === id);
/** A state at the opening of the season Mira's return is on the desk, and the trip it came from. */
const homeState = () => {
  let s = outfit(game(), calm, WOOL);
  s = playTo(s, calm, q => q.desk.some(p => p.kind === 'return'));
  return s;
};

// ---- the leaf, one named case for each state
test('trip home: holds only on the opening the agent came back, and not before or after', () => {
  let s = outfit(game(), calm, WOOL);
  ok(!holds(leaf('home'), s, calm), 'on the road');
  const back = playTo(s, calm, q => q.desk.some(p => p.kind === 'return'));
  ok(holds(leaf('home'), back, calm), 'the return paper is on the desk');
  eq(holds({ trip: { agent: 'tobin', is: 'home' } }, back, calm), false, 'another agent did not come home');
  const later = step(back, calm);
  ok(!later.desk.some(p => p.kind === 'return') && !holds(leaf('home'), later, calm), 'the season after');
});
test('trip out: holds while an expedition of that agent is on the road, and not at home', () => {
  const s = game();
  ok(!holds(leaf('out'), s, calm), 'nothing sent');
  const sent = outfit(s, calm, WOOL);
  ok(holds(leaf('out'), sent, calm));
  eq(holds({ trip: { agent: 'tobin', is: 'out' } }, sent, calm), false, 'tobin is not on the road');
  ok(!holds(leaf('out'), homeState(), calm), 'home is not out');
});
test('trip ready: hired, at home, on no expedition, with something to carry', () => {
  const s = game();
  ok(holds(leaf('ready'), s, calm));
  ok(!holds(leaf('ready'), outfit(s, calm, WOOL), calm), 'on the road');
  ok(!holds(leaf('ready'), variant(s, x => { x.agents.mira.hired = false; }), calm), 'not hired');
  // `where` says 'road' for an agent who is out, so the expedition list is checked on its own too: a state
  // that says the agent is home while an expedition of theirs is out (a hand-edited save) is not 'ready'
  ok(!holds(leaf('ready'), variant(outfit(s, calm, WOOL), x => { x.agents.mira.where = 'harbour'; x.stock.wool = 5; }), calm), 'out, whatever `where` says');
  ok(!holds(leaf('ready'), variant(s, x => { x.stock = {}; }), calm), 'nothing to carry, so no plan');
  ok(!holds(leaf('ready'), variant(s, x => { x.agents.mira.trust = -2; }), calm), 'a person about to leave takes no trip');
});
test('trip: a malformed leaf throws, and a leaf in a letter is a schema error', () => {
  const s = game();
  throws(() => holds({ trip: { agent: 'mira' } }, s, calm), /trip is/);
  throws(() => holds({ trip: { agent: 'mira', is: 'gone' } }, s, calm), /trip is/);
  throws(() => holds({ trip: { agent: 'mira', is: 'out', by: 1 } }, s, calm), /unknown key/);
  const bad = variant(calm, x => { x.letters[0].when = leaf('out'); });
  ok(problems(bad).some(m => /reads its own expedition/.test(m)), problems(bad).join('\n'));
});

// ---- the words
test('{to} {good} {route} {seasons} {agent} are filled from the expedition on the road', () => {
  const c = withCards(tripCard('trip-out', 'out'));
  let s = outfit(game(c), c, WOOL);
  s = playTo(s, c, q => onDesk(q, 'trip-out'));
  const p = onDesk(s, 'trip-out'), v = view(s, c).cards[p.id];
  const out = seasonIndex(s, c) - s.expeditions[0].sent;
  eq(v.body, `Mira took wool to Hilltown by way of Harbour to Hilltown. ${out === 1 ? 'one season' : `${['no', 'one', 'two', 'three', 'four'][out]} seasons`}.`);
  eq([v.title, v.choices.ok.label, v.choices.ok.hint], ['News of Mira', 'Hear it, Mira', 'About wool.']);
  ok(![v.title, v.body, v.choices.ok.label, v.choices.ok.hint].some(t => /\{(agent|to|good|route|seasons)\}/.test(t)), 'no slot is left');
});
test('{to} and {good} on a homecoming are read back from the return, and {seasons} is how long it took', () => {
  const c = withCards(tripCard('trip-home', 'home'));
  let s = outfit(game(c), c, WOOL);
  const sent = seasonIndex(s, c);
  s = playTo(s, c, q => onDesk(q, 'trip-home'));
  const took = seasonIndex(s, c) - sent;
  const v = view(s, c).cards[onDesk(s, 'trip-home').id];
  ok(took >= 4, `hilltown is two legs each way (took ${took})`);
  eq(v.body, `Mira took wool to Hilltown by way of Harbour to Hilltown. ${['no', 'one', 'two', 'three', 'four', 'five', 'six'][took]} seasons.`);
});
test('a trip that turned back is told as the place it turned at, not the place it was bound for', () => {
  const c = withCards(tripCard('trip-home', 'home'));
  const s = homeState();
  const back = variant(s, x => {
    const p = x.desk.find(q => q.kind === 'return');
    p.data.headline = p.data.headline.replace('Hilltown', 'Saltmarsh');
  });
  eq(tripOf(back, calm, 'mira', 'home').to, 'saltmarsh');
  ok(c);
});
test('{to} and {seasons} on a ready card are the nearest stop the house has goods for and the way there and back', () => {
  const c = withCards(tripCard('trip-ready', 'ready'));
  const s = playTo(game(c), c, q => onDesk(q, 'trip-ready'));
  const t = tripOf(s, c, 'mira', 'ready');
  const hit = destinations(s, c, c.agents[0]).find(d => d.stop === 'hilltown');
  eq([t.to, t.good, t.seasons], ['hilltown', 'wool', hit.seasons]);
  const v = view(s, c).cards[onDesk(s, 'trip-ready').id];
  ok(v.body.startsWith('Mira took wool to Hilltown'), v.body);
});
test('a card sent out while it lay on the desk is filled from the trip the agent is on now', () => {
  const c = withCards(tripCard('trip-ready', 'ready'));
  let s = playTo(game(c), c, q => onDesk(q, 'trip-ready'));
  s = outfit(s, c, WOOL);
  eq(tripOf(s, c, 'mira', 'ready'), null);
  ok(view(s, c).cards[onDesk(s, 'trip-ready').id].body.startsWith('Mira took wool to Hilltown'));
});

// ---- never drawn when no expedition matches
test('a card with a trip leaf is never drawn while no expedition matches, however heavy it is', () => {
  const c = withCards(tripCard('trip-out', 'out'), tripCard('trip-home', 'home', { group: 'gifts' }));
  let s = game(c);
  for (let i = 0; i < 10 && s.phase !== 'recall'; i++) {
    eq(deskRefs(s).filter(r => r.startsWith('trip-')), [], `season ${i}`);
    s = step(s, c);
  }
});
test('the same cards are drawn once an expedition matches', () => {
  const c = withCards(tripCard('trip-out', 'out'), tripCard('trip-home', 'home', { group: 'gifts' }));
  const out = playTo(outfit(game(c), c, WOOL), c, q => onDesk(q, 'trip-out'));
  ok(out.expeditions.length === 1);
  const home = playTo(outfit(game(c), c, WOOL), c, q => onDesk(q, 'trip-home'));
  ok(home.desk.some(p => p.kind === 'return'), 'the homecoming card comes with the return');
});

// ---- the outfit effect
test('outfit moves no money and changes nothing in the state', () => {
  const s = game();
  const before = structuredClone(s);
  apply(s, calm, { outfit: 'mira', contract: 'qirad' });
  eq(s, before);
});
test('outfit through a choice: the choice is taken, the money stays, and nothing is on the road yet', () => {
  const card = tripCard('trip-ready', 'ready', { choices: [
    { id: 'send', label: 'Send {agent}', now: [{ outfit: 'mira', contract: 'own' }], later: [{ in: 1, do: [{ rep: 'partners', by: 0 }] }] },
    { id: 'wait', label: 'Not yet', now: [{ rep: 'partners', by: -1 }] },
  ] });
  const c = withCards(card);
  let s = playTo(game(c), c, q => onDesk(q, 'trip-ready'));
  const money = s.money, id = onDesk(s, 'trip-ready').id;
  s = choose(s, c, id, 'send');
  eq([s.money, s.expeditions.length], [money, 0]);
});
test('outfit is refused for an agent who is on the road, not hired, or given a contract that does not exist', () => {
  const sent = outfit(game(), calm, WOOL);
  throws(() => apply(sent, calm, { outfit: 'mira', contract: 'own' }), /not free to be sent out/);
  throws(() => apply(variant(game(), x => { x.agents.mira.hired = false; }), calm, { outfit: 'mira', contract: 'own' }), /not free/);
  throws(() => apply(game(), calm, { outfit: 'mira', contract: 'loan' }), /no contract called "loan"/);
  throws(() => apply(game(), calm, { outfit: 'nobody', contract: 'own' }), /unknown agent/);
});
test('outfit in a later entry is a schema error: the sheet opens when the choice is made', () => {
  const c = withCards(tripCard('trip-ready', 'ready', { choices: [
    { id: 'send', label: 'Send', now: [{ rep: 'partners', by: 1 }], later: [{ in: 1, do: [{ outfit: 'mira', contract: 'own' }] }] },
    { id: 'wait', label: 'Not yet', now: [{ rep: 'partners', by: -1 }] },
  ] }));
  ok(problems(c).some(m => /only in a card choice's now list/.test(m)), problems(c).join('\n'));
});

// ---- the schema
const problems = c => { try { validateContent(c); return []; } catch (e) { return (e.problems ?? [{ message: e.message }]).map(p => `${p.path}: ${p.message}`); } };
test('schema: a card with a trip leaf and slots is valid', () => eq(problems(withCards(tripCard('trip-out', 'out'))), []));
test('schema: slots with no trip leaf have nothing to fill them', () => {
  const c = withCards(tripCard('trip-out', 'out', { when: { season: ['spring'] } }));
  ok(problems(c).some(m => /no trip leaf to fill them/.test(m)), problems(c).join('\n'));
});
test('schema: the trip leaf stands alone or inside the top-level all, never inside any', () => {
  eq(problems(withCards(tripCard('a', 'out', { when: { all: [{ season: ['spring', 'summer'] }, leaf('out')] } }))), []);
  const c = withCards(tripCard('a', 'out', { when: { any: [leaf('out'), { season: ['spring'] }] } }));
  ok(problems(c).some(m => /stand alone in "when"/.test(m)), problems(c).join('\n'));
  eq(tripLeaf({ all: [leaf('home')] }), { agent: 'mira', is: 'home' });
});
test('schema: a trip leaf names a real agent and one of home, out, ready', () => {
  ok(problems(withCards(tripCard('a', 'out', { when: { trip: { agent: 'nobody', is: 'out' } } }))).some(m => /nobody/.test(m)));
  ok(problems(withCards(tripCard('a', 'out', { when: { trip: { agent: 'mira', is: 'gone' } } }))).length > 0);
});

// ---- the lint rule (9)
const plainCard = (body, when) => tripCard('plain', 'out', { title: 'A note', body, when: when ?? { season: ['spring'] }, choices: [{ id: 'ok', label: 'Fine', now: [{ rep: 'partners', by: 1 }], later: [{ in: 1, do: [{ rep: 'partners', by: 0 }] }] }, { id: 'no', label: 'No', now: [{ rep: 'partners', by: -1 }] }] });
const rule9 = (card, c = calm) => tripFailures(c, card);
test('rule 9: a card naming an agent and a stop with no trip leaf fails, and says who and where', () => {
  const f = rule9(plainCard('Mira has been to Hilltown and says the road is bad.'));
  eq(f.length, 1);
  ok(/names Mira and "Hilltown" but has no trip leaf/.test(f[0].message), f[0].message);
});
test('rule 9: an agent and a road word fail too; an agent alone, or a stop alone, does not', () => {
  eq(rule9(plainCard('Mira says the caravan is late.')).length, 1);
  eq(rule9(plainCard('Mira would like a raise.')), []);
  eq(rule9(plainCard('Wool is dear in Hilltown this spring.')), []);
});
test('rule 9: the home city is not a place of a trip', () => eq(rule9(plainCard('Mira is at home in Harbour.')), []));
test('rule 9: a card with the leaf may not write a stop, only use {to} and {route}', () => {
  eq(rule9(plainCard('{agent} went to {to}.', leaf('out'))), []);
  const f = rule9(plainCard('{agent} went to Hilltown.', leaf('out')));
  ok(/writes the place "Hilltown"/.test(f[0].message), JSON.stringify(f));
});
test('rule 9 fails the run (MER-75): lintContent reports it with no flag, and the CLI exits 1 on a card that breaks it', async () => {
  const c = withCards(plainCard('Mira has been to Hilltown.'));
  eq(lintContent(c, { banned: [] }).filter(f => f.rule === 9 && f.path === 'cards[plain]').length, 1);
  eq(lintContent({ ...c, cityId: 'cairo' }, { banned: [] }).filter(f => f.rule === 9 && f.path === 'cards[plain]').length, 1, 'no exemption for a card that is not on the list');
  const { spawnSync } = await import('node:child_process');
  const url = new URL('../tools/lint-content.mjs', import.meta.url);
  const run = (...a) => spawnSync(process.execPath, [url.pathname.replace(/^\/([A-Za-z]:)/, '$1'), ...a], { encoding: 'utf8' });
  const r = run('cairo');
  eq(r.status, 0, r.stdout + r.stderr);
  ok(!/rule 9/.test(r.stdout), 'cairo has no rule 9 failure');
  eq(run('cairo', '--trip-warn').status, 1, 'the old flag is gone, and an unknown option fails');
});
test('rule 9: only the two named cards are exempt, and by city', () => {
  const card = plainCard('Mira has been to Hilltown.');
  eq(rule9({ ...card, id: 'first-expedition' }, { ...calm, cityId: 'cairo' }), []);
  eq(rule9({ ...card, id: 'first-expedition' }, { ...calm, cityId: 'testport' }).length, 1);
  eq(rule9({ ...card, id: 'bridge-toll' }, { ...calm, cityId: 'testport' }), []);
  eq(rule9({ ...card, id: 'bridge-toll' }, { ...calm, cityId: 'cairo' }).length, 1);
});

// ---- the cargo on the jump's settled line
test('the jump\'s settled line carries the cargo the expedition was sent with, for a trip that came home and one that was lost', () => {
  const lineFor = (c, seed) => {
    let s = game(c, { length: 'acts', seed });
    s = step(s, c);
    s = outfit(s, c, WOOL);
    s = playTo(s, c, q => q.phase === 'interlude' || q.phase === 'recall', 6);
    return view(s, c).interlude?.settled[0];
  };
  const home = lineFor(calm, 7);
  eq([home.result, home.cargo], ['home', { wool: 10 }]);
  // every roll of the jump is a loss, and the first seed whose trip is still on the road at the jump is the one we read
  const doomed = variant(calm, x => { for (const r of x.routes) for (const l of r.legs) l.risk = 0.95; x.city.jump = { wholeLoss: 1, survivesWhole: 1 }; });
  const lost = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(seed => lineFor(doomed, seed)).find(l => l?.result === 'lost');
  ok(lost, 'no seed lost it at the jump');
  eq(lost.cargo, { wool: 10 });
});

await done();
