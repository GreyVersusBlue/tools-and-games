// Save (ARCHITECTURE 7.2): node test/save.mjs, from Projects/Merchant/.
// Plain Node. Content is the invented city in data/testport/; storage is memoryStorage().
import fs from 'node:fs/promises';
import { test, eq, ok, throws, done } from './lib.mjs';
import { loadContent } from '../js/data.js';
import { memoryStorage } from '../../../assets/js/gvb-save.js';
import { newGame, choose, paperChoices, endSeason } from '../js/engine/index.js';
import { freshState } from '../js/engine/state.js';
import { validate, migrate, repair, makeSlots, SAVE_KEY, SETTINGS_KEY, settingsDefaults } from '../js/save.js';

const content = await loadContent('testport', { fs });
const game = (over = {}) => newGame(content, { seed: 7, length: 'acts', house: 'rich', ...over });
const fresh = () => freshState(content, { seed: 1, length: 'acts', house: 'rich' });
const copy = x => structuredClone(x);
const slotsOnMemory = () => { const store = memoryStorage(); return { store, ...makeSlots(content, store) }; };
const variant = edit => { const c = structuredClone(content); edit(c); return c; };

// a game some way in, with the later fields (agent and expedition keys, dropped log entries) present
function played() {
  let s = game();
  for (const p of copy(s.desk)) s = choose(s, content, p.id, paperChoices(s, content, p.id)[0].id);
  return endSeason(s, content);
}

// ---- keys
test('keys: the two storage keys are spelled once, as the document says', () => {
  eq(SAVE_KEY, 'merchant-save');
  eq(SETTINGS_KEY, 'merchant-settings');
});

// ---- ARCH 7.2: fresh state saves and loads equal
test('slot: a fresh state saves and loads equal', () => {
  const { game: g } = slotsOnMemory();
  const s = fresh();
  ok(g.save(s), 'save');
  eq(g.load(), s);
});
test('slot: a game in play saves and loads equal, writing the key merchant-save', () => {
  const { store, game: g } = slotsOnMemory();
  const s = played();
  g.save(s);
  ok(store.getItem('merchant-save'), 'the key holds the save');
  eq(g.load(), s);
});
test('slot: an exported file imports back equal', () => {
  const { game: g } = slotsOnMemory();
  const s = played();
  eq(g.deserialize(g.serialize(s)), s);
});

// ---- version 0
test('migrate: a version-0 blob (no v field) gets v 1 and does not change its input', () => {
  const old = copy(fresh()); delete old.v;
  const before = copy(old);
  eq(migrate(old, 0).v, 1);
  eq(old, before);
});
test('migrate: a version-0 blob in storage comes through migrate and repair and loads', () => {
  const { store, game: g } = slotsOnMemory();
  const old = copy(fresh()); delete old.v; delete old.known; delete old.notebook;
  store.setItem('merchant-save', JSON.stringify(old)); // no __v: read as version 0
  const s = g.load();
  ok(s, 'loaded');
  eq(s.v, 1);
  eq(s.known, {});
  eq(s.notebook, []);
});
test('migrate: a save from a newer version is refused, not guessed at', () => {
  throws(() => migrate(fresh(), 2), /newer/);
  const { store, game: g } = slotsOnMemory();
  store.setItem('merchant-save', JSON.stringify({ ...fresh(), __v: 2 }));
  eq(g.load(), null);
});

// ---- validate, garbage
test('validate: accepts a fresh state, refuses every shape ARCH 8.2 names', () => {
  ok(validate(fresh()));
  for (const bad of [null, 5, 'x', [], {}, { ...fresh(), t: '3' }, { ...fresh(), t: NaN }, { ...fresh(), city: 4 }]) {
    ok(!validate(bad), `accepted ${JSON.stringify(bad)?.slice(0, 40)}`);
  }
});
test('slot: a garbage blob is refused and a fresh game can start', () => {
  const { store, game: g } = slotsOnMemory();
  for (const raw of ['not json', '[]', '"hello"', '{"t":"x"}', 'null', '{"format":"gvb-save","game":"merchant","version":1,"state":7}']) {
    store.setItem('merchant-save', raw);
    eq(g.load(), null, raw);
  }
  eq(g.fresh({ seed: 3, length: 'acts', house: 'plain' }).seed, 3);
});
test('slot: another game\'s export and a settings export are refused by the game slot', () => {
  const { game: g, settings } = slotsOnMemory();
  eq(g.deserialize(JSON.stringify({ format: 'gvb-save', game: 'hearth', version: 1, state: fresh() })), null);
  eq(g.deserialize(settings.serialize(settingsDefaults())), null);
});
test('repair: a save for another city is refused, so a swapped content never plays a stranger\'s house', () => {
  throws(() => repair({ ...fresh(), city: 'cairo' }, content), /cairo/);
  const { store, game: g } = slotsOnMemory();
  store.setItem('merchant-save', JSON.stringify({ ...fresh(), city: 'cairo', __v: 1 }));
  eq(g.load(), null);
});

// ---- repair
test('repair: a repaired fresh state is the fresh state', () => {
  eq(repair(fresh(), content), fresh());
});
test('repair: missing fields come back from a fresh state', () => {
  const s = copy(fresh());
  for (const k of ['loans', 'stock', 'market', 'known', 'expeditions', 'post', 'agents', 'rep', 'desk', 'done', 'queue', 'flags', 'seen', 'notebook', 'log', 'score', 'money', 'rng']) delete s[k];
  eq(repair(s, content), fresh());
});
// a game with one expedition on the road and one letter in the house's post, as the engine writes them
const withPost = () => {
  const s = fresh();
  s.expeditions.push({ id: 'x1', agent: 'tobin', route: 'harbour-hilltown', leg: 0, left: 1, waiting: 0, status: 'out', cargo: {}, purse: 0, sent: 0, orders: [] });
  s.agents.tobin.where = 'road';
  s.post.push({ id: 'rain-on-the-pass', kind: 'question', expedition: 'x1', agent: 'tobin', stop: 'hilltown', standing: false, written: 1, lag: 2, arrive: 3 });
  return s;
};
test('repair: the house\'s post keeps a sound entry and drops every malformed one (MER-60b rule 9)', () => {
  const good = withPost().post[0];
  const bad = copy(withPost());
  bad.post = [null, 7, 'x', [], {}, { id: 'rain-on-the-pass' }, { ...good, id: 'no-such-letter' }, { ...good, kind: 'rumour' }, { ...good, stop: 'atlantis' }, { ...good, agent: 'nobody' },
    { ...good, expedition: '' }, { ...good, lag: 0 }, { ...good, lag: 1.5 }, { ...good, arrive: 'soon' }, { ...good, written: -1 }, good];
  eq(repair(bad, content).post, [good]);
  bad.post = 'junk';
  eq(repair(bad, content).post, []);
  delete bad.post;
  eq(repair(bad, content).post, [], 'a save from before the post has none');
  const s = withPost();
  eq(repair(s, content).post, s.post, 'a sound post comes through unchanged');
});
test('repair: an expedition keeps only orders with a go of wait, on or home, a letter and a season (MER-60b rule 9)', () => {
  const s = withPost();
  s.expeditions[0].orders = [null, 'wait', { go: 'press', letter: 'a', at: 4 }, { go: 'wait', letter: 'a' }, { go: 'wait', letter: 'a', at: -2 }, { go: 'on', letter: 7, at: 4 }, { go: 'on', letter: 'a', at: 4.5 },
    { go: 'wait', letter: 'a', at: 4 }, { go: 'on', letter: 'b', at: 5, used: true }, { go: 'home', letter: 'c', at: 6, used: 'yes', extra: 1 }];
  eq(repair(s, content).expeditions[0].orders, [{ go: 'wait', letter: 'a', at: 4 }, { go: 'on', letter: 'b', at: 5, used: true }, { go: 'home', letter: 'c', at: 6 }]);
  delete s.expeditions[0].orders;
  eq(repair(s, content).expeditions[0].orders, [], 'an expedition from before orders has none');
});
test('repair: letters an earlier build kept on the expedition move into the post, delivered ones are dropped', () => {
  const s = withPost(), entry = s.post.pop();
  s.expeditions[0].post = [{ id: entry.id, kind: entry.kind, stop: entry.stop, leg: 0, written: 1, lag: 2, arrive: 3, def: 'hold', delivered: false },
    { id: 'salt-toll', kind: 'report', stop: 'saltmarsh', leg: 1, written: 0, lag: 1, arrive: 1, delivered: true }];
  const r = repair(s, content);
  eq(r.post, [{ ...entry, standing: true }]);
  eq('post' in r.expeditions[0], false);
});
test('repair: a missing agent record or market entry is rebuilt', () => {
  const s = copy(fresh());
  delete s.agents.mira; delete s.market.harbour.wool;
  eq(repair(s, content), fresh());
});
test('repair: numbers become integers and are clamped', () => {
  const s = { ...copy(fresh()), money: 99.6, t: 99, rng: -5.5, rep: { partners: 9, agents: -9, court: 1.4, foreign: 'x' } };
  s.agents.mira.trust = 7; s.agents.tobin.trust = -2.6;
  s.stock = { wool: 3.4, salt: 0, lamps: -2 };
  s.known = { harbour: { wool: { p: 20.7, at: 2.2 } } };
  const r = repair(s, content);
  eq(r.money, 100); eq(r.t, 5); eq(r.rng, (-5) >>> 0);
  eq(r.rep, { partners: 3, agents: -3, court: 1, foreign: 0 });
  eq([r.agents.mira.trust, r.agents.tobin.trust], [3, -3]);
  eq(r.stock, { wool: 3 });
  eq(r.known, { harbour: { wool: { p: 21, at: 2 } } });
});
test('repair: t is held inside the calendar of the chosen length', () => {
  eq(repair({ ...fresh(), t: 99 }, content).t, 5); // acts: two acts of three seasons, indices 0..5
  eq(repair({ ...fresh(), length: 'full', t: 99 }, content).t, 10);
  eq(repair({ ...fresh(), t: -4 }, content).t, 0);
});
test('repair: a length the calendar lacks is refused', () => {
  throws(() => repair({ ...fresh(), length: 'epic' }, content), /epic/);
});
test('repair: unknown agents, goods, stops and notebook entries are dropped', () => {
  const s = copy(fresh());
  s.agents.ghost = { hired: true, where: 'harbour', trust: 0, memory: [] };
  s.stock.gold = 5; s.market.atlantis = { wool: { f: 1, glut: 0 } }; s.market.harbour.gold = { f: 1, glut: 0 };
  s.known = { atlantis: { wool: { p: 1, at: 0 } }, harbour: { gold: { p: 1, at: 0 }, salt: { p: 9, at: 1 } } };
  s.notebook = ['harbour', 'nope'];
  const c = variant(c2 => { c2.notebook = [{ id: 'harbour' }]; });
  const r = repair(s, c);
  eq(Object.keys(r.agents).sort(), ['mira', 'tobin']);
  eq(r.stock, { wool: 10, salt: 6 });
  eq(Object.keys(r.market).sort(), ['harbour', 'hilltown', 'saltmarsh']);
  ok(!r.market.harbour.gold);
  eq(r.known, { harbour: { salt: { p: 9, at: 1 } } });
  eq(r.notebook, ['harbour']);
});
test('repair: papers for a card or event the content lacks leave the desk; the log keeps its history', () => {
  const s = game();
  s.desk.push({ id: null, kind: 'card', ref: 'removed-card', state: 'open' });
  s.desk.push({ id: null, kind: 'notice', ref: 'removed-event', state: 'open' });
  s.log.push({ at: 0, kind: 'card', ref: 'removed-card', choice: 'x' });
  const r = repair(s, content);
  eq(r.desk, game().desk);
  eq(r.log.length, s.log.length);
});
test('repair: the agent-left notice, whose words are in its own data, stays; a notice with neither an event nor words goes', () => {
  const s = game();
  const left = { id: null, kind: 'notice', ref: 'agent-left', agent: 'tobin', state: 'open', data: { headline: 'Tobin has gone to work for the Karimi house.', title: 'Tobin has left', body: 'Tobin has gone to work for the Karimi house.' } };
  s.desk.push(copy(left));
  s.desk.push({ id: null, kind: 'notice', ref: 'agent-left', state: 'open' });
  s.desk.push({ id: null, kind: 'notice', ref: 'agent-left', state: 'open', data: { headline: '  ', body: 7 } });
  const r = repair(s, content);
  eq(r.desk.filter(p => p.ref === 'agent-left'), [left]);
  eq(r.desk.length, game().desk.length + 1);
});
test('repair: the leave notice an opening really puts on the desk survives a reload', () => {
  let s = game();
  s.agents.tobin.trust = -2;
  for (const p of copy(s.desk)) s = choose(s, content, p.id, paperChoices(s, content, p.id)[0].id);
  s = endSeason(s, content);
  ok(s.desk.some(p => p.ref === 'agent-left'), 'the notice is on the desk');
  const r = repair(JSON.parse(JSON.stringify(s)), content);
  eq(r.desk.map(p => p.ref), s.desk.map(p => p.ref), 'the same papers after repair');
  const t = repair(JSON.parse(JSON.stringify(s)), content);
  ok(t.log.some(e => e.kind === 'trust'), 'and the trust note, whole, stays');
});
test('repair: a trust log entry with a string or null value, or no table, is dropped; a good one stays', () => {
  const entry = (trust, extra = {}) => ({ at: 2, kind: 'trust', trust, ...extra });
  const logOf = e => { const s = game(); s.log = [e, { at: 2, kind: 'season', change: 0, money: 100 }]; return repair(s, content).log; };
  eq(logOf(entry({ mira: 'high', tobin: 0 })).map(e => e.kind), ['season'], 'a string');
  eq(logOf(entry({ mira: null })).map(e => e.kind), ['season'], 'null');
  eq(logOf(entry(null)).map(e => e.kind), ['season'], 'no table');
  eq(logOf(entry('x')).map(e => e.kind), ['season'], 'a string for the table');
  eq(logOf(entry({ mira: 1, tobin: -1 }, { rep: 1 })).map(e => e.kind), ['trust', 'season'], 'a good one stays');
  eq(logOf(entry({ mira: 1 }, { rep: 'two' }))[0].rep, 0, 'a malformed rep is replaced by the rep the save holds, and the entry stays');
  eq(logOf(entry({ mira: 1 }))[0].rep, 0, 'so is a missing one (a save from before the note carried rep)');
});
test('repair: an old trust note with no rep does not let a card\'s direct rep.agents move count twice (MER-61c)', () => {
  const direct = () => {
    let s = game();
    for (const e of s.log) if (e.kind === 'trust') delete e.rep;                // a note from before it carried rep
    s = repair(JSON.parse(JSON.stringify(s)), content);
    s.agents.mira.trust = 2;                                                     // up two over the season, and
    s.rep.agents = 1;                                                            // the card that did it moved rep.agents by hand
    for (const p of copy(s.desk)) s = choose(s, content, p.id, paperChoices(s, content, p.id)[0].id);
    return endSeason(s, content).rep.agents;
  };
  eq(direct(), 1, 'one step, not two');
});
test('repair: a desk over five papers is cut to five', () => {
  const s = game();
  for (let i = 0; i < 4; i++) s.desk.push({ id: null, kind: 'card', ref: 'lamp-order', state: 'open' });
  eq(repair(s, content).desk.length, 5);
});
test('repair: queue items naming a missing card go, wherever they name it', () => {
  const s = copy(fresh());
  s.queue = [
    { at: 3, do: [], card: 'wool-due', from: 'a/1' },
    { at: 3, do: [], card: 'removed', from: 'a/2' },
    { at: 4, do: [{ card: 'removed' }], from: 'a/3' },
    { at: 4, do: [{ money: 5 }], from: 'a/4' },
  ];
  eq(repair(s, content).queue.map(q => q.from), ['a/1', 'a/4']);
});
test('repair: the keys MER-07 added (agent, expedition on queue items and papers, dropped log entries, a string choice) pass through', () => {
  const s = copy(fresh());
  s.queue = [{ at: 3, do: [], card: 'wool-due', from: 'a/1', agent: 'mira', expedition: 'x1' }];
  s.desk = [{ id: 'p0-0', kind: 'card', ref: 'wool-due', state: 'open', agent: 'mira', expedition: 'x1' }];
  s.log = [{ at: 0, kind: 'dropped', ref: 'a/1', reason: 'x' }, { at: 0, kind: 'dropped', ref: null, reason: 'y' },
    { at: 1, kind: 'event', ref: 'fair-closes', dropped: 'notice' }, { at: 1, kind: 'card', ref: 'wool-offer', choice: 'buy' }];
  eq(repair(s, content), { ...fresh(), queue: s.queue, desk: s.desk, log: s.log });
});
test('repair: a choice id logged as a number is made a string, an unknown agent key is stripped', () => {
  const s = copy(fresh());
  s.log = [{ at: 0, kind: 'card', ref: 'wool-offer', choice: 2 }];
  s.queue = [{ at: 3, do: [], card: 'wool-due', from: 'a/1', agent: 'ghost' }];
  const r = repair(s, content);
  eq(r.log[0].choice, '2');
  ok(!('agent' in r.queue[0]));
});
test('repair: an expedition whose route is gone comes home at once with its cargo and purse', () => {
  const s = copy(fresh());
  s.agents.mira.where = 'road';
  s.expeditions = [{ id: 'x1', agent: 'mira', route: 'harbour-atlantis', leg: 0, left: 1, waiting: 0,
    cargo: { wool: 4, gold: 9 }, purse: 50, contract: { kind: 'own' }, staked: { house: 80, partners: 0 }, orders: [], sent: 0 }];
  const r = repair(s, content);
  eq(r.expeditions, []);
  eq(r.stock.wool, 14); ok(!r.stock.gold);
  eq(r.money, 950);
  eq(r.agents.mira.where, 'harbour');
});
test('repair: an expedition on a route that exists stays, with its counters made whole numbers', () => {
  const s = copy(fresh());
  s.agents.mira.where = 'road';
  s.expeditions = [{ id: 'x1', agent: 'mira', route: 'harbour-hilltown', leg: 9, left: 1.6, waiting: -1, cargo: { wool: 4 }, purse: 50, contract: { kind: 'own' }, staked: { house: 80, partners: 0 }, orders: [], sent: 0 }];
  const r = repair(s, content);
  eq(r.expeditions.length, 1);
  eq([r.expeditions[0].leg, r.expeditions[0].left, r.expeditions[0].waiting], [1, 2, 0]);
  eq(r.agents.mira.where, 'road');
  eq(r.money, 900);
});
test('repair: an agent shown on the road with no expedition is at home', () => {
  const s = copy(fresh());
  s.agents.tobin.where = 'road';
  eq(repair(s, content).agents.tobin.where, 'harbour');
});
test('validate: an unknown phase is not a reason to refuse a save, repair makes it desk', () => {
  for (const phase of ['lunch', undefined, 4, null]) {
    const blob = { ...fresh(), phase };
    ok(validate(blob), `validate refused phase ${String(phase)}`);
    eq(repair(blob, content).phase, 'desk');
  }
  const slots = slotsOnMemory();
  slots.store.setItem(SAVE_KEY, JSON.stringify({ ...fresh(), phase: 'lunch', money: 77 }));
  eq([slots.game.load().phase, slots.game.load().money], ['desk', 77], 'the slot loads it');
});
test('repair: a phase outside the list becomes desk', () => {
  eq(repair({ ...fresh(), phase: 'lunch' }, content).phase, 'desk');
  eq(repair({ ...fresh(), phase: 'recall' }, content).phase, 'recall');
});
test('repair: is idempotent, on a damaged state and on a played one', () => {
  const dirty = copy(played());
  dirty.money = 12.5; dirty.t = 400; dirty.stock.gold = 3; dirty.agents.ghost = {}; dirty.phase = 'x';
  dirty.queue.push({ at: 5, do: [], card: 'removed', from: 'z' });
  dirty.expeditions = [{ id: 'x9', agent: 'mira', route: 'nowhere', cargo: { wool: 2 }, purse: 7.4 }];
  const once = repair(dirty, content);
  eq(repair(once, content), once);
  const p = played();
  eq(repair(repair(p, content), content), repair(p, content));
});
test('repair: does not change the state it is given', () => {
  const s = copy(played());
  s.money = 3.7; s.stock.gold = 1;
  const before = copy(s);
  repair(s, content);
  eq(s, before);
});

// ---- the slot end to end
test('slot: a hand-damaged save in storage loads repaired', () => {
  const { store, game: g } = slotsOnMemory();
  const s = copy(played());
  s.stock.gold = 2; s.money = 10.4;
  store.setItem('merchant-save', JSON.stringify({ ...s, __v: 1 }));
  const r = g.load();
  ok(!r.stock.gold);
  eq(r.money, 10);
});
test('slot: the loaded state plays on, ending the season after a repair round trip', () => {
  const { game: g } = slotsOnMemory();
  let s = game();
  for (const p of copy(s.desk)) s = choose(s, content, p.id, paperChoices(s, content, p.id)[0].id);
  g.save(s);
  const back = g.load();
  eq(endSeason(back, content), endSeason(s, content));
});

// ---- settings
test('settings: defaults, a round trip, and the key merchant-settings', () => {
  const { store, settings } = slotsOnMemory();
  eq(settings.load(), null);
  const mine = { sound: true, largeText: true, reduceMotion: 'on', shortcuts: false };
  ok(settings.save(mine));
  ok(store.getItem('merchant-settings'));
  eq(settings.load(), mine);
  eq(settings.fresh(), settingsDefaults());
});
test('settings: wrong types come back as defaults, unknown keys are dropped', () => {
  const { store, settings } = slotsOnMemory();
  store.setItem('merchant-settings', JSON.stringify({ sound: 'yes', largeText: 1, reduceMotion: 'sometimes', shortcuts: false, extra: 5, __v: 1 }));
  eq(settings.load(), { ...settingsDefaults(), shortcuts: false });
});
test('settings: the two slots share a store without touching each other', () => {
  const { game: g, settings } = slotsOnMemory();
  g.save(fresh()); settings.save({ sound: true, largeText: false, reduceMotion: 'off', shortcuts: true });
  g.clear();
  eq(g.load(), null);
  eq(settings.load().sound, true);
});

await done();
