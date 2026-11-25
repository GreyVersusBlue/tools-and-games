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
import { destinations, risk, accountItem, repSentence, estimate } from '../js/engine/routes.js';
import { moneyTrail, jumpWords } from '../js/ui/screens/ledger.js';
import { newGame, openSeason, endSeason, choose, paperChoices, outfit, view, sellHomeQuote } from '../js/engine/index.js';
import { seasonIndex } from '../js/engine/calendar.js';
import { cityOf } from '../js/engine/state.js';
import * as M from '../js/engine/market.js';
import { writeSeason } from '../js/engine/market.js';

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
  id, group: 'orders', kind: 'trade', from: { name: 'Nell the broker', role: 'Testport', seal: null },
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
    const ch = paperChoices(s, c, p.id).find(x => { try { choose(s, c, p.id, x.id); return true; } catch { return false; } });   // the first choice the house can take (MER-141: one that costs more than it holds is refused)
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
test('trip home: an agent who retires with a return paper on the desk, or is gone, has no homecoming', () => {
  const back = homeState();
  ok(holds(leaf('home'), back, calm), 'baseline: hired and home');
  const retired = variant(back, x => { x.agents.mira.hired = false; });
  ok(retired.desk.some(p => p.kind === 'return' && p.agent === 'mira'), 'the return paper is still on the desk');
  eq(tripOf(retired, calm, 'mira', 'home'), null, 'a retired agent: the leaf does not hold');
  const gone = variant(back, x => { x.agents.mira.where = 'gone'; });
  eq(tripOf(gone, calm, 'mira', 'home'), null, 'a gone agent: the leaf does not hold');
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
    p.data.trip.to = 'saltmarsh';
    p.data.headline = 'Words that name no stop at all.';   // the facts are read, never the sentence
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

// ---- MER-119: the account adds up, the return inside the years-pass page, the rest line
/** Hilltown also sells salt, so a plan may send money and name a good to bring back (as test/routes.mjs does). */
const salty = variant(calm, x => { x.stops.find(s => s.id === 'hilltown').sells.salt = { base: 6, depth: 40 }; });
const SALTED = { ...WOOL, buy: ['salt'] };
const noToll = c => variant(c, x => { for (const l of x.routes.find(r => r.id === 'harbour-hilltown').legs) l.toll = 0; });
/** Plays a plan to its return paper. A trip that never comes home as a return (lost whole) gives null. */
function returnOf(c, plan, seed = 7) {
  let s = outfit(game(c, { seed }), c, plan);
  const seen = new Set(s.desk.map(p => p.id));
  for (let i = 0; i < 20 && s.phase !== 'recall' && s.phase !== 'ended'; i++) {
    s = step(s, c);
    const paper = s.desk.find(p => p.kind === 'return' && !seen.has(p.id));
    if (paper) return paper.data;
  }
  return null;
}
/** The rows a child adds up: every row with an amount and no detail, but the Profit (or Loss) row they come to. */
const sums = d => d.account.filter(r => Number.isFinite(r.amount) && !r.detail && r.label !== 'Profit' && r.label !== 'Loss');
const total = d => sums(d).reduce((n, r) => n + r.amount, 0);
const casesOfTrips = () => {
  const qirad = noToll(variant(salty, x => { x.city.contracts = { qirad: { agentShare: [1, 3] } }; }));
  const prepaid = variant(salty, x => { x.agents.find(a => a.id === 'mira').traits = ['honest']; });
  const lossy = variant(salty, x => { for (const r of x.routes) for (const l of r.legs) l.risk = 0.5; });
  return [
    { name: 'own, goods only', c: salty, plan: WOOL },
    { name: 'own, goods and money bought back', c: salty, plan: { ...SALTED, purse: 60 } },
    { name: 'qirad', c: qirad, plan: { ...SALTED, contract: 'qirad', partners: 100, purse: 100 } },
    { name: 'prepaid wage', c: prepaid, plan: { ...WOOL, prepay: true }, ready: s => { s.agents.mira.memory.push({ at: 0, kind: 'unfair' }, { at: 1, kind: 'unfair' }); } },
    { name: 'a trip that lost goods', c: lossy, plan: SALTED, many: true },
  ];
};
function playedAccounts() {
  const rows = [];
  for (const k of casesOfTrips()) {
    for (const seed of k.many ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20] : [7]) {
      let s = game(k.c, { seed });
      if (k.ready) k.ready(s);
      s = outfit(s, k.c, k.plan);
      if (!s.expeditions.length) continue;
      const seen = new Set(s.desk.map(p => p.id));
      let d = null;
      for (let i = 0; i < 20 && !d && s.phase !== 'recall' && s.phase !== 'ended'; i++) { s = step(s, k.c); d = s.desk.find(p => p.kind === 'return' && !seen.has(p.id))?.data ?? null; }
      if (d) rows.push({ at: `${k.name}/${seed}`, d, lost: d.account.some(r => r.label === 'Lost') });
    }
  }
  return rows;
}
test('MER-119 (1) the account adds up: the rows that carry an amount come to the Profit row to the dinar, on own, prepaid, qirad and a loss', () => {
  const rows = playedAccounts();
  const kinds = new Set(rows.map(r => r.at.split('/')[0]));
  eq([...kinds].sort(), ['a trip that lost goods', 'own, goods and money bought back', 'own, goods only', 'prepaid wage', 'qirad']);
  ok(rows.some(r => r.lost), 'no played trip lost goods and came home');
  for (const { at, d } of rows) {
    const last = d.account.at(-1);
    eq(total(d), last.amount, `${at}: the rows add up to the ${last.label} row`);
    eq(last.amount, d.houseNet, `${at}: and the Profit row is the headline's number`);
  }
});
test('MER-119 (1) the first row is what the house paid for what it sent: the warehouse goods at the price the sheet used, goods bought and the money', () => {
  const d = returnOf(salty, WOOL);
  const s = outfit(game(salty), salty, WOOL);
  const x = s.expeditions[0];
  eq(d.account[0].label, 'Sent out');
  eq(d.account[0].amount, -(x.staked.house + x.staked.partners), 'the stake the house and its partners put out');
  ok(d.account[0].amount < 0, 'ten loads of wool cost something');
  ok(d.account.some(r => r.label === 'Back home') && d.account.some(r => /wage$/.test(r.label)), 'the other sums are there');
});

/** Testport's acts are three seasons long, so every road is settled by quotes at the jump. These calendars end act one at season
    `end` and open the next six seasons later, so a trip sent at the start is either still on the road when the years pass
    (`quoted`) or home at the closing into them. Found by condition, as layout.mjs's playUntil does, so a change of road or
    calendar moves nothing here. */
const withActEnd = (c, end) => variant(c, x => { x.calendar.lengths.acts.acts = [{ from: 0, to: end }, { from: end + 6, to: end + 8 }]; });
const SALT_BACK = { ...SALTED };
/** Plays SALT_BACK from the first season to the page between acts and opens the house: { line, paper, s } for the first calendar and
    seed `want` accepts, or null. */
function jumpedTrip(want, { seeds = [7, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12], hopedHigh = false, plan = SALT_BACK } = {}) {
  for (const end of [1, 2, 3, 4, 5, 6, 7, 8]) for (const seed of seeds) {
    const c = withActEnd(salty, end);
    let s = outfit(game(c, { length: 'acts', seed }), c, plan);
    // `hopedHigh`: the sheet hoped for a home price 40 percent over the one the estimate carries (a hope written when home's price
    // stood higher). Since MER-121b the estimate and `jump` read the same price, so a jump return's home price is no longer a gap
    // cause of its own and its why never names one; the sentences below are about the cases where the hope was off.
    if (hopedHigh) for (const x of s.expeditions) {
      x.hope.home.salt = Math.round(x.hope.home.salt * 1.4);
      const was = x.hope.homeValue.salt; x.hope.homeValue.salt = Math.round(was * 1.4);   // the dinars the sheet hoped the loads would count for (MER-148), which the gap is read from
      x.hope.net += x.hope.homeValue.salt - was; x.hoped = x.hope.net;   // and the net it hoped is that much higher
    }
    let before = s;
    for (let i = 0; i < 20 && s.phase !== 'interlude' && s.phase !== 'recall'; i++) { before = s; s = step(s, c); }
    if (s.phase !== 'interlude') continue;
    const line = view(s, c).interlude.settled[0];
    if (line?.result !== 'home' || !want(line, s, c, before)) continue;
    const paper = openSeason(s, c).desk.find(p => p.kind === 'return');
    if (paper) return { c, line, paper, s, end, before };
  }
  return null;
}
test('MER-119 (2) a trip settled in the years-pass page carries its hoped line there, the number and the sentence its paper gives', () => {
  for (const quoted of [true, false]) {
    const j = jumpedTrip(l => l.quoted === quoted && l.why);
    ok(j, `no calendar settled a trip with quoted ${quoted}`);
    eq([j.line.hoped, j.line.why], [j.paper.data.hoped, j.paper.data.why], `quoted ${quoted}: the page and the paper say the same`);
    ok(Number.isFinite(j.line.hoped) && typeof j.line.why === 'string', 'the line carries both');
  }
});
test('MER-119 (2) a party home before the years passed: its why names the price in the season it came home, not the one after the jump', () => {
  // the price the house read in the season it came home differs from the one after the closing into the next act
  const j = jumpedTrip((l, s, c, before) => {
    if (l.quoted) return false;
    const home = cityOf(c, 'market').home;
    return M.truePrice(before, c, home, 'salt') !== M.truePrice(s, c, home, 'salt') && / at home in /.test(l.why ?? '');
  }, { hopedHigh: true });
  ok(j, 'no seed had a home price that moved across the jump with a home price in its why');
  const from = j.s.log.findLast(e => e.kind === 'jump').from, home = cityOf(j.c, 'market').home;
  // the price of the closing season, read from the state before that closing; the market is reset to the next act's by the jump
  const then = M.truePrice(j.before, j.c, home, 'salt'), after = M.truePrice(j.s, j.c, home, 'salt');
  const d = j.paper.data;
  ok(then !== after, 'the two prices differ');
  ok(new RegExp(`^Salt fetched ${then} at home in ${writeSeason(j.c, from)}, when Mira was back, `).test(d.why), `${d.why} (it was ${then} then and ${after} after the jump)`);
  ok(!/by the time/.test(d.why), d.why);
});
test('MER-121b a return the jump settles is worth what Sell pays for it on the market the jump\'s reset leaves, the one the ledger shows that season, quoted or not', () => {
  // `jump` settles a party before it resets the markets (step 4), so a return valued at the market as it stood read the price of the
  // closing before: 33 of 33 jump returns were off from the ledger, 29 of 29 ordinary ones right (MER-121b). The paper's "worth" and
  // its cargo value are the goods at the price the new act opens with, which is the price the ledger writes for that season.
  let compared = 0;
  for (const quoted of [true, false]) for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    const j = jumpedTrip(l => l.quoted === quoted, { seeds: [seed] });
    if (!j || !Object.keys(j.paper.data.goodsBack).length) continue;
    const home = cityOf(j.c, 'market').home, to = j.s.log.findLast(e => e.kind === 'jump').to;
    const worth = j.paper.data.cargoValue;
    // the season the act opens in: the house opened on the desk the reset market gives, and Sell in the warehouse quotes the loads there. What the paper counts them at
    // is what Sell would pay for them (MER-148, M4f play problem 1): the run, each load behind the one before and the broker's cut off, behind what the warehouse held of the good.
    const opened = openSeason(j.s, j.c);
    let ledger = 0;
    for (const [g, n] of Object.entries(j.paper.data.goodsBack)) {
      const held = opened.stock[g] ?? 0;
      ok(held >= n, `${g}: the warehouse holds the ${n} loads that came home (${held})`);
      ledger += sellHomeQuote(opened, j.c, g, held).got - (held > n ? sellHomeQuote(opened, j.c, g, held - n).got : 0);
    }
    eq(worth, ledger, `seed ${seed}, calendar ending ${j.end}, quoted ${quoted}: the paper says worth ${worth}, what Sell pays for them that season is ${ledger}`);
    compared++;
  }
  ok(compared >= 3, `${compared} jump returns with goods were compared`);
});
test('MER-119 (2) a trip settled by quotes says so, and does not say the party was back when the price was read', () => {
  const j = jumpedTrip((l, s, c) => l.quoted && / at home, /.test(l.why ?? ''), { hopedHigh: true });
  ok(j, 'no calendar had a quoted trip whose why names a home price');
  const d = j.paper.data;
  ok(/^The years passed before Mira was home, so salt was counted at \d+ at home, (not|more than|less than) the \d+ we hoped for\.$/.test(d.why), d.why);
  ok(!/by the time|was back/.test(d.why), d.why);
  eq(j.line.why, d.why);
});

// the words the engine writes on a paper; a card's choice "Let {agent} rest a season" is the player's to pick, not a claim about the agent
const engineWords = d => [d.headline, d.route, d.account, d.why, d.orderLine, d.agentLine];
const REST = /wants to rest|rest a season/i;   // the line MER-119 took out
test('MER-119 (3) the paper does not say the agent wants to rest, because nothing makes her: the sheet sends her the season she is home', () => {
  const c = salty;
  let s = outfit(game(c), c, WOOL);
  s = playTo(s, c, q => q.desk.some(p => p.kind === 'return'));
  const paper = s.desk.find(p => p.kind === 'return');
  eq('agentLine' in paper.data, false, 'the return paper carries no line about resting');
  ok(!REST.test(JSON.stringify(engineWords(paper.data))), 'no word about resting anywhere on the paper');
  const again = outfit(s, c, WOOL);
  eq(again.expeditions.length, 1, 'the engine sends her at once, so a line that said she would rest would be false');
  // and the page between acts does not say it either
  const j = jumpedTrip(l => !!l.why);
  ok(j && !REST.test(JSON.stringify(view(j.s, j.c).interlude)) && !REST.test(JSON.stringify(engineWords(j.paper.data))));
});

// ---- MER-125: years pass names what came back; the opening cost; the ledger across the jump; the lost galley's loss; plain good-name words
const COUNT_WORD = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

test('MER-125 (1) a settled line names what came back, goods and money, the seasons the account counts, for a trip settled by quotes and one home before the years passed', () => {
  // the salt plan brings goods home and the wool plan sells for money, so both halves of "what came back" are read
  for (const [quoted, plan] of [[true, SALT_BACK], [false, SALT_BACK], [true, WOOL], [false, WOOL]]) {
    const j = jumpedTrip(l => l.quoted === quoted, { plan });
    ok(j, `no calendar settled a trip with quoted ${quoted}`);
    const { line, paper } = j;
    // the goods that came back are the paper's own goods, and the money is the "Back home" row's money part
    ok(plan === SALT_BACK ? Object.keys(line.back.goods).length > 0 : line.back.money > 0, `quoted ${quoted}: the plan brought something home`);
    eq(line.back.goods, paper.data.goodsBack, `quoted ${quoted}: the goods on the line are the goods on the paper`);
    const row = paper.data.account.find(r => r.label === 'Back home');
    const goodsWorth = paper.data.cargoValue;
    eq(line.back.money, row.amount - goodsWorth, `quoted ${quoted}: the money on the line is what the paper's Back home row holds beyond the goods`);
    // the seasons the line counts are the seasons the paper's account counts
    ok(paper.data.route.includes(`${COUNT_WORD[line.seasons]} seasons`), `quoted ${quoted}: the line says ${line.seasons}, the paper says "${paper.data.route}"`);
  }
  // a trip home before the years passed came back in the season it names: sent in season 0, away `seasons` counting the season it left in (MER-140), back by the closing of `from`
  const j = jumpedTrip(l => l.quoted === false);
  eq(j.line.seasons - 1, j.s.log.findLast(e => e.kind === 'jump').from, 'the season the line counts to is the one the why sentence names');
});

test('MER-140 (1) the years-pass page and the paper give a settled trip\'s length as the sheet counted it, "about N seasons", whether it was home before the years passed or settled by quotes', () => {
  // the line used to say `out` (the closings away) and so one season short of the sheet's five or six; seven calendars, three seeds each
  let quoted = 0, home = 0;
  for (let end = 1; end <= 7; end++) for (const seed of [7, 1, 2]) {
    const c = withActEnd(salty, end);
    const s0 = game(c, { length: 'acts', seed });
    const sheet = estimate(s0, c, SALT_BACK).seasons;
    let s = outfit(s0, c, SALT_BACK);
    for (let i = 0; i < 20 && s.phase !== 'interlude' && s.phase !== 'recall'; i++) s = step(s, c);
    const line = s.phase === 'interlude' ? view(s, c).interlude.settled[0] : null;
    if (line?.result !== 'home') continue;
    eq(line.seasons, sheet, `end ${end}, seed ${seed}, quoted ${line.quoted}: the page counts the sheet's seasons`);
    const paper = openSeason(s, c).desk.find(p => p.kind === 'return');
    if (paper) ok(paper.data.route.includes(`${COUNT_WORD[sheet]} seasons`), `the paper's road line agrees: ${paper.data.route}`);
    line.quoted ? quoted++ : home++;
  }
  ok(quoted >= 6 && home >= 1, `${quoted} settled by quotes and ${home} home before the years passed were compared`);
});

test('MER-140 (3) the Accounts paper says "+1 coin" and "\u22121 coin" for one, and "coins" for the rest', () => {
  const says = n => accountItem(game(), calm, { do: [{ money: n }], from: 'x/y' }).changes;
  eq([says(1), says(-1), says(2), says(-12)], [['+1 coin'], ['\u22121 coin'], ['+2 coins'], ['\u221212 coins']]);
});

test('MER-125 (3) the money the house carries into the next years is the money on the first desk after the jump, over every calendar and seed that settles a trip', () => {
  let seen = 0;
  for (const end of [1, 2, 3, 4, 5, 6, 7, 8]) for (const seed of [7, 1, 2, 3, 4, 5, 6, 8]) {
    const c = withActEnd(salty, end);
    let s = outfit(game(c, { length: 'acts', seed }), c, SALT_BACK);
    for (let i = 0; i < 20 && s.phase !== 'interlude' && s.phase !== 'recall'; i++) s = step(s, c);
    if (s.phase !== 'interlude') continue;
    const carried = view(s, c).interlude.money;
    eq(carried, s.money, `end ${end} seed ${seed}: the page's figure is the state's`);
    eq(openSeason(s, c).money, carried, `end ${end} seed ${seed}: opening the house changed the money with no paper to say why`);
    seen++;
  }
  ok(seen >= 6, `${seen} jumps were compared`);
});

test('MER-125 (4) the ledger shows the jump as one line after the season it followed, with its years and the cash the trips brought in, and the season keeps its own figure', () => {
  const j = jumpedTrip(l => l.result === 'home');
  ok(j, 'no jump with a trip home');
  const jump = j.s.log.findLast(e => e.kind === 'jump'), at = j.s.log.findLast(e => e.kind === 'season');
  const trail = moneyTrail(j.c, j.s.log), last = trail.at(-1);
  eq([last.at, last.after.years, last.after.net, last.after.trips, last.after.change], [jump.from, jump.years, jump.net, jump.trips, jump.change], 'right after the jump the last row carries it');
  eq(jump.net, jump.settled.reduce((n, l) => n + l.houseNet, 0), 'the figure is what the page between the acts adds up');
  eq(last.change + last.after.change, at.change, 'the season and the jump add up to what the book wrote');
  ok(jump.net !== 0 && last.change === at.change - jump.change, 'the trips made or cost the house something and the jump\'s change is out of the season');   // goods count at what Sell would pay (MER-148), which can leave this small trip a loss
  ok(jumpWords(last.after).startsWith(`${jump.years === 1 ? 'A year' : `${jump.years} years`} passed. ${jump.net > 0 ? `The trips made ${jump.net} dinars for the house.` : `The trips cost the house ${-jump.net} dinars.`}`), jumpWords(last.after));
  // the new act's seasons arrive as they close, and the jump line stays between the old season and the new
  const next = step(step(j.s, j.c), j.c);
  const t2 = moneyTrail(j.c, next.log);
  eq(t2.length, Math.min(4, next.log.filter(e => e.kind === 'season').length));
  const k = t2.findIndex(r => r.after);
  ok(k >= 0 && k < t2.length - 1 && t2[k].at === jump.from && t2.at(-1).at >= jump.to, `the new season closes after the jump line: ${JSON.stringify(t2.map(r => [r.at, !!r.after]))}`);
  eq(t2.reduce((n, r) => n + r.change + (r.after?.change ?? 0), 0), next.log.filter(e => e.kind === 'season').slice(-4).reduce((n, e) => n + e.change, 0), 'no coin is counted twice or lost across the jump');
});

test('MER-125 (5) a lost paper says in one sentence what the house lost in coins, goods at home\'s price and the money aboard, against what it hoped', () => {
  const c = variant(calm, x => { for (const r of x.routes) for (const l of r.legs) l.risk = 0.95; });
  const home = cityOf(c, 'market').home;
  const base = outfit(game(c), c, { ...WOOL, purse: 30 });
  let whole = 0, part = 0;
  for (let seed = 1; seed <= 60 && (whole < 2 || part < 2); seed++) {
    const s = structuredClone(base); s.rng = seed;
    s.expeditions[0].rode = { leg: 0, start: 1 };
    risk(s, c);
    const paper = s.desk.at(-1);
    if (paper.kind !== 'lost') continue;
    const d = paper.data, x = s.expeditions[0] ?? base.expeditions[0];
    paper.data.whole ? whole++ : part++;
    // the figure, from the goods the road took at home's price now and the money that was aboard
    const lostGoods = d.whole ? { wool: 10 } : s.expeditions[0].book.lost;
    const expected = Object.entries(lostGoods).reduce((v, [g, n]) => v + n * M.truePrice(s, c, home, g), d.whole ? 30 : 0);
    eq(d.worth, expected, `seed ${seed}: the figure`);
    ok(expected > 0 && d.lossLine.includes(`about ${expected} coins`), `seed ${seed}: the sentence says ${expected}: ${d.lossLine}`);
    const hoped = base.expeditions[0].hoped;
    ok(Number.isFinite(hoped) && d.lossLine.includes(`${Math.abs(hoped)} coins`), `seed ${seed}: the sentence says what was hoped (${hoped}): ${d.lossLine}`);
    ok(hoped > 0 ? /hoped to make/.test(d.lossLine) : /lose about/.test(d.lossLine), `seed ${seed}: the sentence says which way: ${d.lossLine}`);
    ok(d.lines.some(l => l.text === d.lossLine), 'the sentence is on the paper\'s lines');
  }
  ok(whole >= 2 && part >= 2, `${whole} whole and ${part} partial losses were read`);
});

test('MER-125 (6) good name is said as a sentence a child reads, one per group with the verb agreeing, moves of one group added up', () => {
  const says = (...by) => accountItem(game(), calm, { do: by.map(([rep, n]) => ({ rep, by: n })), from: 'x/y' })?.changes ?? null;
  eq(says(['foreign', 1]), ['Foreign merchants think better of the house.']);
  eq(says(['court', 1]), ['The court thinks better of the house.'], 'the court is one body: thinks');
  eq(says(['partners', -1]), ['The partners think less of the house.']);
  eq(says(['agents', 1]), ['The agents think better of the house.']);
  eq(says(['court', 1], ['court', 1]), ['The court thinks much better of the house.'], 'two moves of one group are one sentence');
  eq(says(['court', 1], ['partners', -1], ['court', -1]), ['The partners think less of the house.'], 'a group that nets to nothing says nothing');
  eq(says(['court', 1], ['foreign', 1]).length, 2, 'one sentence per group');
  eq(says(['court', 1], ['court', -1]), null, 'a net of nothing is no item at all');
  eq(repSentence('court', 0), null);
  const item = accountItem(game(), calm, { do: [{ money: 40 }, { rep: 'court', by: 1 }], from: 'x/y' });
  eq(item.text, 'From x/y: +40 coins. The court thinks better of the house.', 'the money runs on, the sentence follows whole');
});

await done();
