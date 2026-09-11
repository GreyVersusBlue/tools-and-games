// smoke-save.mjs — the save format and the cast table, under plain Node.
//
//   node Projects/daredevil/test/smoke-save.mjs
//
// Exits non-zero on any failure (locked decision #13). Everything here is pure:
// save.js imports gvb-save.js, which runs in Node as long as a storage stub is
// injected instead of touching localStorage.
//
// Locked decision #34: several of these break the guard on purpose first and
// assert that it refuses, rather than only asserting the happy path.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDaredevilSlot, freshState, validateState, repairState, KEY, VERSION, STAT_MAX,
} from '../js/save.js';
import { CAST, castFor, isLegalRel, setRel, meetsNeeds, routeByCast, statesOf, relLabel } from '../js/cast.js';
import {
  SCENES,
  M3_PRESTUNT_ROUTES, M3_PRESTUNT_FALLBACK,
  M4_PRESTUNT_ROUTES, M4_PRESTUNT_FALLBACK,
  M5_QUESTION_ROUTES, M5_QUESTION_FALLBACK,
} from '../js/scenes.js';

const JS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js');

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

/* ------------------------------------------------------------ the cast */
// Phase 3. The six characters and their legal states are one table, cast.js,
// and everything that names a relationship — the save's defaults, a scene's
// effects, a choice's `_needs`, a route table, a hub card, a prose closure —
// has to agree with it. The first four blocks test the table's own contract;
// the sweep at the end reads the story and the engine and asserts every
// (character, state) pair either of them names is one the table allows and
// has a label. That sweep is what found `ruthie === 'warm'` in the Milestone 5
// ladder, a state she has never been able to hold.

{
  const ids = CAST.map(c => c.id);
  eq(ids.length, new Set(ids).size, 'every cast id is unique');
  eq(Object.keys(freshState().rels).sort(), [...ids].sort(), "a fresh run's rels are exactly the cast");
  for (const c of CAST) {
    ok(c.states.includes(c.start), `${c.id} starts in a legal state (${c.start})`);
    ok(c.unmet === null || c.states.includes(c.unmet), `${c.id}'s never-met state is legal`);
    const unlabelled = c.states.filter(st => typeof c.labels[st] !== 'string' || !c.labels[st]);
    ok(unlabelled.length === 0, `every state of ${c.id} has a label (missing: ${unlabelled.join(', ') || 'none'})`);
    const extra = Object.keys(c.labels).filter(st => !c.states.includes(st));
    ok(extra.length === 0, `${c.id} labels no state it cannot hold (extra: ${extra.join(', ') || 'none'})`);
  }
  ok(castFor('pete') && freshState().rels.pete === 'unknown', "pete is seeded, as never met");
}

{
  // The one door for writes refuses what the table does not know (#13).
  const rels = freshState().rels;
  let threw = null;
  try { setRel(rels, 'peet', 'ally'); } catch (e) { threw = e.message; }
  ok(/peet/.test(threw || ''), `an unknown character is refused by name (${threw})`);
  threw = null;
  try { setRel(rels, 'pete', 'aly'); } catch (e) { threw = e.message; }
  ok(/'pete' cannot be 'aly'/.test(threw || ''), `an illegal state is refused by name (${threw})`);
  eq(rels.pete, 'unknown', 'and neither refusal wrote anything');
  setRel(rels, 'pete', 'ally');
  eq(rels.pete, 'ally', 'a legal write goes through');
}

{
  // repair: an illegal state goes back to the start state, a key the cast does
  // not know is dropped, and an older save with no pete gets him filled in.
  const s = repairState({ name: 'A', town: 'B', stats: {}, flags: {}, scene: 'm3_entry', screen: 'panel',
                          rels: { cal: 'loyal', earl: 'boss', peet: 'ally', tommy: 42 } });
  eq(s.rels.cal, 'loyal', 'a legal relationship survives repair');
  eq(s.rels.earl, 'unknown', 'an illegal state repairs to the start state');
  eq(s.rels.tommy, 'hanger_on', 'a non-string state repairs to the start state');
  ok(!('peet' in s.rels), 'a key the cast does not know is dropped');
  eq(s.rels.pete, 'unknown', 'a save from before pete was seeded gets him as never met');
}

{
  // `_needs` and the route tables, as data.
  const rels = freshState().rels;
  ok(meetsNeeds(undefined, rels), 'no _needs is always met');
  ok(meetsNeeds({ earl: ['unknown', 'backer'] }, rels), 'a list holding the current state is met');
  ok(!meetsNeeds({ earl: ['backer'] }, rels), 'a list not holding it is not');
  let threw = false;
  try { meetsNeeds({ earl: 'backer' }, rels); } catch { threw = true; }
  ok(threw, 'a _needs value that is not a list throws rather than passing');
  eq(statesOf('earl', { not: ['absent'] }), ['unknown', 'backer', 'mentor', 'antagonist'], 'statesOf lists the legal states minus the excluded');
  threw = false;
  try { statesOf('earl', { not: ['gone'] }); } catch { threw = true; }
  ok(threw, 'excluding a state the character cannot hold throws');

  // A route table with a state its character cannot hold makes routeByCast
  // throw; here that has to read as a failure with the sweep still to come,
  // not as the suite dying.
  const route = (...a) => { try { return routeByCast(...a); } catch (e) { return `threw: ${e.message}`; } };
  eq(route(M4_PRESTUNT_ROUTES, rels, M4_PRESTUNT_FALLBACK), 'm4_prestunt_nobody_m4', 'a fresh run has nobody before the M4 stunt');
  eq(route(M4_PRESTUNT_ROUTES, { ...rels, cal: 'loyal', pete: 'ally' }, M4_PRESTUNT_FALLBACK), 'm4_prestunt_cal_m4', 'the first matching row wins');
  eq(route(M5_QUESTION_ROUTES, { ...rels, cal: 'loyal', ruthie: 'solid' }, M5_QUESTION_FALLBACK), 'm5_question_ruthie', 'Ruthie asks the question before Cal');
  threw = null;
  try { routeByCast([{ who: 'ruthie', states: ['warm'], scene: 'x' }], rels, 'y'); } catch (e) { threw = e.message; }
  ok(/'ruthie' has no state warm/.test(threw || ''), `a route on a state the character cannot hold throws (${threw})`);

  for (const [routes, fallback, what] of [
    [M3_PRESTUNT_ROUTES, M3_PRESTUNT_FALLBACK, 'M3 pre-stunt'],
    [M4_PRESTUNT_ROUTES, M4_PRESTUNT_FALLBACK, 'M4 pre-stunt'],
    [M5_QUESTION_ROUTES, M5_QUESTION_FALLBACK, 'M5 question'],
  ]) {
    const missing = [...routes.map(r => r.scene), fallback].filter(id => !SCENES[id]);
    ok(missing.length === 0, `every ${what} route names a scene (missing: ${missing.join(', ') || 'none'})`);
  }
}

{
  // The sweep. Every (character, state) the story or the engine names.
  const named = [];   // { who, state, where }
  const note = (who, state, where) => named.push({ who, state, where });

  // From the story, walked as data.
  for (const [id, sc] of Object.entries(SCENES)) {
    if (sc.statUpdate && sc.statUpdate.rels) for (const [k, v] of Object.entries(sc.statUpdate.rels)) note(k, v, `${id}.statUpdate`);
    for (const ch of sc.choices || []) {
      if (ch.effects && ch.effects.rels) for (const [k, v] of Object.entries(ch.effects.rels)) note(k, v, `${id} choice ${ch.label || ch.text}`);
      if (ch._needs) {
        for (const [k, list] of Object.entries(ch._needs)) {
          ok(Array.isArray(list) && list.length > 0, `${id}'s _needs.${k} is a non-empty list`);
          for (const v of list || []) note(k, v, `${id} _needs`);
        }
      }
    }
  }
  for (const [routes, what] of [[M3_PRESTUNT_ROUTES, 'M3'], [M4_PRESTUNT_ROUTES, 'M4'], [M5_QUESTION_ROUTES, 'M5']]) {
    for (const r of routes) for (const st of r.states) note(r.who, st, `${what} route`);
  }

  // From both source files as text: the comparisons prose closures and the
  // epilogue make, and the engine's own hub-card lists. Comments stripped, the
  // way flags.mjs does it, so a comment quoting an old bug is not a read.
  const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const files = { 'engine.js': strip(fs.readFileSync(path.join(JS, 'engine.js'), 'utf8')),
                  'scenes.js': strip(fs.readFileSync(path.join(JS, 'scenes.js'), 'utf8')) };
  let comparisons = 0;
  for (const [f, src] of Object.entries(files)) {
    for (const m of src.matchAll(/\brels\.([A-Za-z_$][\w$]*)\s*[!=]==?\s*'([^']*)'/g)) { note(m[1], m[2], `${f} comparison`); comparisons++; }
    for (const m of src.matchAll(/_needs\s*:\s*\{([^}]*)\}/g)) {
      for (const pair of m[1].matchAll(/([A-Za-z_$][\w$]*)\s*:\s*\[([^\]]*)\]/g)) {
        for (const q of pair[2].matchAll(/'([^']*)'/g)) note(pair[1], q[1], `${f} _needs literal`);
      }
    }
  }
  ok(comparisons > 20, `the sweep saw the prose closures' comparisons (${comparisons})`);

  const badWho = named.filter(n => !castFor(n.who));
  ok(badWho.length === 0, `every character named is in the cast (not: ${[...new Set(badWho.map(n => `${n.who} at ${n.where}`))].join('; ') || 'none'})`);
  const badState = named.filter(n => castFor(n.who) && !isLegalRel(n.who, n.state));
  ok(badState.length === 0, `every state named is one its character can hold (not: ${[...new Set(badState.map(n => `${n.who}='${n.state}' at ${n.where}`))].join('; ') || 'none'})`);
  const badLabel = named.filter(n => isLegalRel(n.who, n.state) && relLabel(n.who, n.state) === n.state);
  ok(badLabel.length === 0, `every state named has a label (not: ${[...new Set(badLabel.map(n => `${n.who}='${n.state}'`))].join('; ') || 'none'})`);
  console.log(`\n  cast sweep: ${named.length} (character, state) mentions across the story, the routes and both sources`);

  // The closure form is for what is computed, not for relationships: a
  // `_requires` that reads rels is a requirement the walker cannot see.
  const closures = [...files['scenes.js'].matchAll(/_requires\s*:[^\n]*/g)].map(m => m[0]);
  const relClosures = closures.filter(c => /\brels\b|\bsolo\(/.test(c));
  ok(relClosures.length === 0, `no _requires closure tests a relationship (${relClosures.join(' | ') || 'none'})`);
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
