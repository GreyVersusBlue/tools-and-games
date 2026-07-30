// smoke-save.mjs — the save format, under plain Node.
//
//   node Projects/daredevil/test/smoke-save.mjs
//
// Exits non-zero on any failure (locked decision #13). Everything here is pure:
// save.js imports gvb-save.js, which runs in Node as long as a storage stub is
// injected instead of touching localStorage.
//
// Locked decision #34: several of these break the guard on purpose first and
// assert that it refuses, rather than only asserting the happy path.

import {
  createDaredevilSlot, freshState, validateState, repairState, KEY, VERSION, STAT_MAX,
} from '../js/save.js';

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass++; } else { fail++; console.error('  FAIL ' + what); } };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

/** Minimal in-memory Storage. */
function stubStore() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    _raw: m,
  };
}

/* --------------------------------------------------------------- the key */

eq(KEY, 'daredevil-save-v1', 'storage key is the one it keeps forever (locked decision #36)');
eq(VERSION, 1, 'schema version');

/* ------------------------------------------------------------- freshState */

{
  const a = freshState(), b = freshState();
  ok(a !== b, 'freshState returns a new object each call');
  ok(a.flags.hubDayScenesDone !== b.flags.hubDayScenesDone, 'freshState does not share its arrays');
  a.flags.hubDayScenesDone.push('x');
  eq(b.flags.hubDayScenesDone, [], 'mutating one fresh state does not touch the next');
  eq(a.stats.nerve, 3, 'starting nerve');
  eq(a.rels.ruthie, 'unknown', 'Ruthie starts unestablished');
}

/* --------------------------------------------------------------- validate */

ok(validateState(freshState()), 'a fresh state validates');
ok(!validateState(null), 'null is refused');
ok(!validateState('{}'), 'a string is refused');
ok(!validateState([]), 'an array is refused');
ok(!validateState({}), 'an empty object is refused');
ok(!validateState({ name: 'x' }), 'no stats is refused');
ok(!validateState({ name: 'x', stats: {}, flags: [] }), 'flags-as-array is refused');
ok(!validateState({ name: 'x', stats: {}, flags: {}, scene: 42 }), 'a numeric scene id is refused');
ok(validateState({ name: 'x', stats: {}, flags: {}, scene: null }), 'a null scene is allowed (hub save)');

/* ----------------------------------------------------------------- repair */

{
  // Break it on purpose, then check repair puts it back.
  const s = repairState({ name: '  ', town: '', stats: { nerve: 99, precision: -4, showmanship: 'x' },
                          rels: null, flags: { hubEveningsDone: 'not-a-list' }, screen: 'nonsense', scene: null });
  eq(s.name, 'Duke Harlan', 'a blank name falls back to the default');
  eq(s.town, 'Buford County', 'a blank town falls back to the default');
  eq(s.stats.nerve, STAT_MAX, 'a stat over the max is clamped down');
  eq(s.stats.precision, 0, 'a negative stat is clamped up');
  eq(s.stats.showmanship, 3, 'a non-numeric stat falls back to the default');
  eq(s.stats.hustle, 2, 'a missing stat is filled in');
  eq(s.rels.cal, 'neutral', 'a null rels object is rebuilt');
  eq(s.flags.hubEveningsDone, [], 'a list flag that is not a list is forced back to a list');
  eq(s.flags.hubEvenings, 5, 'a missing flag is filled in');
  eq(s.screen, 'hub', 'an unknown screen with no scene resolves to the hub');
}
{
  const s = repairState({ name: 'A', town: 'B', stats: {}, flags: {}, scene: 'm3_entry', screen: 'nonsense' });
  eq(s.screen, 'panel', 'an unknown screen with a scene resolves to the panel');
}
{
  const s = repairState({ name: 'A', town: 'B', stats: {}, flags: {}, scene: null, screen: 'panel' });
  eq(s.screen, 'hub', 'a panel save with no scene has nowhere to land, so it lands on the hub');
}
{
  // Idempotent: repair(repair(x)) === repair(x).
  const once = repairState(freshState());
  const twice = repairState(JSON.parse(JSON.stringify(once)));
  eq(twice, once, 'repair is idempotent');
}

/* ------------------------------------------------------------ round trips */

{
  const store = stubStore();
  const slot = createDaredevilSlot({ storage: store });

  const s = slot.fresh();
  s.stats.nerve = 5;
  s.rels.ruthie = 'solid';
  s.flags.m2Complete = true;
  s.scene = 'fr3_eve_cal';
  s.screen = 'panel';
  ok(slot.save(s), 'save reports success');
  ok(store._raw.has(KEY), 'it wrote to the key it said it would');

  const back = slot.load();
  eq(back.stats.nerve, 5, 'a stat survives the round trip');
  eq(back.rels.ruthie, 'solid', 'a relationship survives the round trip');
  eq(back.flags.m2Complete, true, 'a flag survives the round trip');
  eq(back.scene, 'fr3_eve_cal', 'the scene id survives the round trip');
  ok(back.__v === undefined, 'the version stamp is stripped before the game sees it');
}

/* ---------------------------------------------------- export / import file */

{
  const slot = createDaredevilSlot({ storage: stubStore() });
  const s = slot.fresh();
  s.scene = 'm4_stunt_select';
  s.stats.showmanship = 4;
  const text = slot.serialize(s);
  const env = JSON.parse(text);
  eq(env.format, 'gvb-save', 'the exported envelope is the shared format');
  eq(env.game, 'daredevil', 'the envelope names this game');
  eq(env.version, VERSION, 'the envelope carries the schema version');

  const back = slot.deserialize(text);
  eq(back.scene, 'm4_stunt_select', 'a scene id survives export and import');
  eq(back.stats.showmanship, 4, 'a stat survives export and import');
}

/* ------------------------------------------------- refusing bad save files */

{
  const slot = createDaredevilSlot({ storage: stubStore() });
  ok(slot.deserialize('not json at all') === null, 'a non-JSON file is refused');
  ok(slot.deserialize('[1,2,3]') === null, 'a JSON array is refused');
  ok(slot.deserialize('{"name":123}') === null, 'a blob with the wrong shape is refused');
  ok(slot.deserialize(JSON.stringify({ format: 'gvb-save', game: 'fourth-quarter', version: 2, state: { day: 3 } })) === null,
     "another game's export is refused");

  // Truncation: the most likely way a real file goes bad.
  const good = slot.serialize(slot.fresh());
  ok(slot.deserialize(good.slice(0, good.length - 40)) === null, 'a truncated export is refused');

  // And the guard is not just refusing everything.
  ok(slot.deserialize(good) !== null, 'a good export is still accepted');
}

/* --------------------------------------------- a corrupt localStorage blob */

{
  const store = stubStore();
  const slot = createDaredevilSlot({ storage: store });
  store.setItem(KEY, '{"name":"x","stats":');
  ok(slot.load() === null, 'a half-written localStorage value loads as null, not a crash');
  store.setItem(KEY, JSON.stringify({ nope: true }));
  ok(slot.load() === null, 'a well-formed but foreign localStorage value is refused');
}

/* ------------------------------------------------------------------ reset */

{
  const store = stubStore();
  const slot = createDaredevilSlot({ storage: store });
  slot.save({ ...slot.fresh(), scene: 'm5_decision' });
  const after = slot.reset();
  ok(!store._raw.has(KEY), 'reset clears the key');
  ok(after !== null, 'reset hands back a usable fresh state, not null');
  eq(after.scene, null, 'the fresh state from reset is at the beginning');
  eq(after.stats.nerve, 3, 'the fresh state from reset has starting stats');
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
