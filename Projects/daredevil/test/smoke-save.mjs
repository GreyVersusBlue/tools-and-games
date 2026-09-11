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
import { CAST, castFor, isLegalRel, setRel, meetsNeeds, routeByCast, statesOf, relLabel, wasMet, rosterFor } from '../js/cast.js';
import { findings, UNREACHABLE_BY_RELS, eveningCards } from './graph.mjs';
import {
  SCENES,
  M3_PRESTUNT_ROUTES, M3_PRESTUNT_FALLBACK,
  M4_PRESTUNT_ROUTES, M4_PRESTUNT_FALLBACK,
  M5_QUESTION_ROUTES, M5_QUESTION_FALLBACK,
  M4_STUNT_GATES, m4Gate,
} from '../js/scenes.js';
import {
  HUB_EVENINGS, EVENING_COST, HUB_TAKE, BUS_DEPOSIT,
  CAR_MONEY, CAR_RESALE, SMALL_SHOW, SELF_FUND_NET, SOLO_LOAN, monthlyOn,
  money, earn, spend, owePerMonth, payHubTake, spendEveningCost,
  eveningAffordable, costTag, canAffordBuses,
} from '../js/money.js';
// The stunt run's geometry (Phase 7). Like money.js it imports nothing, so
// the claim that three scales are three stunts is arithmetic and provable
// here rather than only in a fifteen-minute browser run.
import {
  SCALES, GEO, LAND_FRAC, TIER_FLOOR, TIER_SPAN, tierOf, lipTopY,
  contactXFor, speedForContact, stuntTuning, canRetry,
  RETRY_LIMIT, RETRY_CONDITION_COST,
} from '../js/stunt.js';
// The flag bag itself, for the two crash aftermaths: their Condition cost is a
// getter over GS.flags.recovery now, which is readable without a browser.
import { GS } from '../js/state.js';

const JS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js');

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass++; } else { fail++; console.error('  FAIL ' + what); } };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
/** Three decimals. The stunt tuning is float arithmetic; comparing it exactly
 *  would make the pin fail on a reordered multiply that changed nothing. */
const round3 = v => Math.round(v * 1000) / 1000;

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
  eq(s.flags.hubEvenings, HUB_EVENINGS.fr1, 'a missing flag is filled in');
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
  // Phase 4: the ending screen's roster. It used to be built inline from
  // `Object.entries(GS.rels)` filtered on the literal 'unknown', which is two
  // assumptions the cast table owns — that 'unknown' is what never-met means
  // for everybody, and that the save's key order is the table's.
  //
  // One honest limit first (#147). Every never-met state in the table today is
  // the string 'unknown', and Cal's is null, so `rels[id] !== 'unknown'` and
  // `rels[id] !== castFor(id).unmet` agree on every character the game has.
  // Replacing the table read with the literal leaves all of this green; it was
  // broken on purpose to check. What these three catch is a character dropped
  // from the roster or added to it, not which of the two tests was used. The
  // order assertion below is the one that fails on the old inline version.
  const fresh = freshState().rels;
  eq(rosterFor(fresh).map(r => r.id), ['cal', 'tommy'],
     'a run that has met nobody lists only the two characters who start in the story');
  ok(!wasMet('danny', fresh), 'Danny starts never-met');
  ok(wasMet('cal', fresh), 'Cal is on the list at a fresh start');
  ok(wasMet('tommy', fresh), 'and so is Tommy, who starts as a hanger-on rather than as nobody');

  const full = { ...fresh, ruthie: 'solid', pete: 'ally', earl: 'backer', danny: 'poached' };
  eq(rosterFor(full).map(r => r.id), ['cal', 'ruthie', 'pete', 'earl', 'tommy', 'danny'],
     'a full roster prints in the cast table\'s order');
  eq(rosterFor(full).map(r => r.label).join(' / '),
     'Neutral / Solid / Ally / Business Partner / Hanger-On / Poached',
     'and each row carries the table\'s label for the state');

  // The order a repaired save hands back is not the table's: repairState fills
  // a character the save was missing in at the end of the bag. A save written
  // before `pete` was seeded comes back with him last, and the old inline
  // version printed him there.
  const scrambled = repairState({ name: 'x', stats: {}, flags: {},
    rels: { danny: 'nemesis', cal: 'loyal', tommy: 'ally', earl: 'mentor', ruthie: 'solid' } });
  ok(Object.keys(scrambled.rels).indexOf('pete') > Object.keys(scrambled.rels).indexOf('danny'),
     'a repaired save really does carry Pete after Danny');
  eq(rosterFor(scrambled.rels).map(r => r.id), ['cal', 'ruthie', 'earl', 'tommy', 'danny'],
     'and the roster still prints in table order, with the never-met Pete left off');

  // A character who left is a character the run had: Absent is a row, not a gap.
  eq(rosterFor({ ...fresh, tommy: 'absent' }).map(r => `${r.name}: ${r.label}`),
     ['Cal: Neutral', 'Tommy: Absent'], 'somebody who left still has a row');
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

{
  // Phase 4: reachability, which is the other direction from the sweep above.
  // That one asks whether every state the game *names* is legal. This one asks
  // whether every state the cast table *declares* can ever be written, because
  // a state nothing writes is a state every gate, label and prose closure
  // keyed to it is dead against, and nothing throws.
  //
  // That was the whole of this phase's row. `rels.tommy` was 'hanger_on' at
  // the first line of the game and 'hanger_on' at the ending screen on every
  // run ever played, while two hub cards gated on him not being 'absent' and a
  // Free Roam 4 line read `=== 'ally'`. Danny could only be 'frenemy' or
  // 'nemesis', and the epilogue had labels for 'poached' and 'absent' that no
  // run could print.
  const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const both = ['engine.js', 'scenes.js']
    .map(f => strip(fs.readFileSync(path.join(JS, f), 'utf8'))).join('\n\n');

  // Every writer, from the story as data and from both files as text. The
  // data walk is what counts; the text scan is there so a `setRel` or a direct
  // assignment the engine makes on its own is not read as unreachable.
  const written = new Set();
  const where = {};
  const wrote = (k, v, at) => { written.add(`${k}:${v}`); (where[`${k}:${v}`] ||= []).push(at); };
  for (const [id, sc] of Object.entries(SCENES)) {
    if (sc.statUpdate && sc.statUpdate.rels)
      for (const [k, v] of Object.entries(sc.statUpdate.rels)) wrote(k, v, `${id}.statUpdate`);
    for (const ch of sc.choices || [])
      if (ch.effects && ch.effects.rels)
        for (const [k, v] of Object.entries(ch.effects.rels)) wrote(k, v, `${id} choice`);
  }
  for (const m of both.matchAll(/setRel\(\s*[^,]+,\s*'([^']+)'\s*,\s*'([^']+)'/g)) wrote(m[1], m[2], 'setRel call');
  for (const m of both.matchAll(/GS\.rels\.([A-Za-z_$][\w$]*)\s*=\s*'([^']+)'/g)) wrote(m[1], m[2], 'direct assignment');

  // The three that are still dead, frozen the way flags.mjs freezes its
  // write-only list (#264) so the list can shrink and not grow. Seven places
  // read them and nothing writes them: six `rels.ruthie` comparisons — an
  // ending verdict apiece, the Free Roam 4 card's subtitle, `fr4_eve_ruthie`'s
  // `_gateRoute` and two prose closures — and a written paragraph in the
  // ending screen's Earl narrative for `antagonist`. They are a prose row, not
  // this one's, and they are on Projects/daredevil/WISHLIST.md.
  const UNREACHABLE = ['earl:antagonist', 'ruthie:absent', 'ruthie:strained'];

  const dead = [];
  for (const c of CAST) {
    for (const st of c.states) {
      if (st === c.start || st === c.unmet) continue;
      if (!written.has(`${c.id}:${st}`)) dead.push(`${c.id}:${st}`);
    }
  }
  const newlyDead = dead.filter(d => !UNREACHABLE.includes(d)).sort();
  const nowReachable = UNREACHABLE.filter(d => !dead.includes(d)).sort();
  ok(newlyDead.length === 0,
     `every state in the cast table is written by something (unreachable: ${newlyDead.join(', ') || 'none'})`);
  ok(nowReachable.length === 0,
     `every name on the frozen-unreachable list is still unreachable (stale: ${nowReachable.join(', ') || 'none'})`);

  // The four this row was for, named rather than counted: a regression that
  // deletes one writer and leaves the state on no list has to say which.
  for (const pair of ['tommy:ally', 'tommy:absent', 'danny:poached', 'danny:absent']) {
    ok(written.has(pair), `${pair} is written by a scene (${(where[pair] || []).join(', ') || 'nothing'})`);
  }
  console.log(`\n  reachability: ${written.size} (character, state) writers, ${UNREACHABLE.length} states still dead`);
}

{
  // Phase 4, and the reason this row's six new scenes put their numbers on the
  // choice rather than on the scene. A scene named by a choice's `goto` and
  // carrying a `statUpdate` fires it TWICE: `handleChoice` triggers it before
  // the scene and `afterScene` triggers it again at the end. Both calls apply
  // `deltas`. Measured in a real browser on `fr2_danny_01` option B, which
  // grants +1 showmanship on the choice and +1 on the target's statUpdate:
  // showmanship 0 goes to 3, and the stat screen is shown twice.
  //
  // The standing backlog has carried this as "a doubled `> title — reason`
  // line in every transcript" without a number. Thirty-three scenes do it.
  // Fixing the engine moves every transcript and rebalances the game, so it
  // is a row of its own; this freezes the inventory the way flags.mjs freezes
  // its write-only list (#264), so the list can shrink and a thirty-fourth
  // fails here. New content routes around it: numbers through `effects`, which
  // `applyEffects` runs once, and relationship and flag writes on the
  // `statUpdate`, which are idempotent.
  const DOUBLE_APPLIES = [
    'fr1_org_wait', 'fr2_danny_01_pro', 'fr2_danny_01_watch', 'fr2_danny_event_narrow',
    'fr2_danny_headtohead_counter', 'fr2_danny_headtohead_silence', 'fr2_pete_measured',
    'fr2_pete_soft', 'fr2_pete_why', 'fr2_ruthie_q_a', 'fr2_ruthie_q_d', 'fr3_eve_earl_cal',
    'fr3_eve_earl_engage', 'fr3_eve_earl_read', 'fr3_press_sandra_accept',
    'fr3_press_sandra_check', 'fr3_press_sandra_control', 'fr3_ruthie_ask',
    'fr3_ruthie_honest', 'fr4_biographer_no', 'fr4_biographer_yes', 'fr4_california_close',
    'fr4_earl_direct', 'm1_r4', 'm1_ruthie_a', 'm1_ruthie_b', 'm2_sign', 'm5_disappear',
    'm5_keep_going', 'm5_mentor', 'm5_retire_clean', 'm5_symbolic_own', 'm5_walk_quiet',
  ];
  const reachedByChoice = new Set();
  for (const sc of Object.values(SCENES)) for (const ch of sc.choices || []) if (ch.goto) reachedByChoice.add(ch.goto);
  const doubling = [...reachedByChoice]
    .filter(id => SCENES[id] && SCENES[id].statUpdate
                  && Object.values(SCENES[id].statUpdate.deltas || {}).some(v => v))
    .sort();
  const added = doubling.filter(id => !DOUBLE_APPLIES.includes(id));
  const fixed = DOUBLE_APPLIES.filter(id => !doubling.includes(id));
  ok(added.length === 0,
     `no new scene applies its stat deltas twice (new: ${added.join(', ') || 'none'})`);
  ok(fixed.length === 0,
     `every name on the doubling list still doubles (stale: ${fixed.join(', ') || 'none'})`);
  console.log(`  double-apply: ${doubling.length} choice-reached scenes carry non-empty deltas`);
}

/* ------------------------------------------------- the hub economy (Phase 6) */
// The four hubs handed out seven evenings and built four cards, and the pips
// were decoration. Free Roam 2 was the only hub where the budget bound
// anything, which is why `hubExhausted()` fired on cards rather than evenings.
// Everything below is pure: money.js imports nothing, so the whole economy is
// testable without a browser and without a run.
{
  const eves = eveningCards();

  // 1. The budget binds, per hub, by construction. This is the row's first
  // bullet and the number the browser suite then proves a real run hits.
  for (const [hub, key] of [['_hub_fr1', 'fr1'], ['_hub_fr2', 'fr2'], ['_hub_fr3', 'fr3'], ['_hub_fr4', 'fr4']]) {
    const cards = eves.get(hub).length;
    ok(HUB_EVENINGS[key] < cards,
       `${hub} hands out fewer evenings than it has cards (${HUB_EVENINGS[key]} of ${cards})`);
  }
  // A Milestone 4 failure keeps the discount Free Roam 4 always had.
  ok(HUB_EVENINGS.fr4_failure === HUB_EVENINGS.fr4 - 1,
     `a failed Milestone 4 costs one evening (${HUB_EVENINGS.fr4_failure} against ${HUB_EVENINGS.fr4})`);
  eq(freshState().flags.hubEvenings, HUB_EVENINGS.fr1,
     "Free Roam 1's budget is the one the save seeds");

  // 2. The price list and the boards agree, from both ends (#264). A card with
  // no row would render "Costs 1 Evening" and charge nothing; a row naming no
  // card is a price nobody can be asked to pay.
  const onBoards = [...eves.values()].flat();
  const unpriced = onBoards.filter(id => !EVENING_COST[id]).sort();
  const unbuilt = Object.keys(EVENING_COST).filter(id => !onBoards.includes(id)).sort();
  ok(unpriced.length === 0, `every hub evening card has a price (unpriced: ${unpriced.join(', ') || 'none'})`);
  ok(unbuilt.length === 0, `every price names a card a hub builds (unbuilt: ${unbuilt.join(', ') || 'none'})`);
  // And every priced card is a real scene, or the click goes nowhere.
  const noScene = Object.keys(EVENING_COST).filter(id => !SCENES[id]).sort();
  ok(noScene.length === 0, `every priced evening is a scene (missing: ${noScene.join(', ') || 'none'})`);

  // 3. Every hub can give a point of Condition back. Without this the budget
  // is a one-way ratchet on the stat the stunt physics read.
  for (const [hub] of [...eves]) {
    const gives = eves.get(hub).filter(id => (EVENING_COST[id] || {}).condition < 0
      || (SCENES[id] && ((SCENES[id].statUpdate || {}).deltas || {}).condition > 0));
    ok(gives.length > 0, `${hub} has an evening that gives Condition back (${gives.join(', ') || 'none'})`);
  }

  // 4. The integer. `money()` never reads back negative or fractional, and
  // `spend` refuses what is not there rather than going under.
  {
    const g = { flags: { money: 0, monthlyOutgo: 0, hubTakePaid: [] }, stats: { condition: 3 }, rels: { earl: 'backer' } };
    eq(earn(g, 250), 250, 'earn adds');
    ok(!spend(g, 400), 'spend refuses what is not there');
    eq(money(g), 250, 'and takes nothing when it refuses');
    ok(spend(g, 250), 'spend takes what is there');
    eq(money(g), 0, 'down to nothing, not under it');
    eq(earn(g, -500), 0, 'a negative earn floors at zero');
    g.flags.money = 'twelve hundred';
    eq(money(g), 0, 'a non-numeric save reads as zero rather than NaN');
    g.flags.money = 17.6;
    eq(money(g), 18, 'and dollars are whole');
  }

  // 5. The take is credited once per hub, and the paper comes off it. Before
  // the `hubTakePaid` guard this was eight credits a hub, because
  // `showHubFRn()` runs again every time a card returns to the board.
  {
    const g = { flags: { money: 0, monthlyOutgo: 0, hubTakePaid: [] }, stats: { condition: 3 }, rels: { earl: 'backer' } };
    eq(payHubTake(g, 'fr2'), HUB_TAKE.fr2.backer, 'the backer arm takes the backer number');
    eq(payHubTake(g, 'fr2'), 0, 'and a second render credits nothing');
    eq(money(g), HUB_TAKE.fr2.backer, 'so the purse holds one take, not two');

    const solo = { flags: { money: 0, monthlyOutgo: 0, hubTakePaid: [] }, stats: { condition: 3 }, rels: { earl: 'absent' } };
    owePerMonth(solo, 37);
    owePerMonth(solo, 104);
    eq(solo.flags.monthlyOutgo, 141, 'two pieces of paper add up');
    eq(payHubTake(solo, 'fr3'), HUB_TAKE.fr3.solo - 141 * HUB_TAKE.fr3.months,
       'the solo take comes in net of four months of paper');
  }

  // 6. The Condition floor (#287). An evening out is not what puts a man in
  // the hospital; `createStuntRun`'s drift constant at zero Condition is 202
  // against 112 at three, and a hub that could take the last point would hand
  // the next stunt a run nothing can ride.
  {
    const g = { flags: { money: 500, monthlyOutgo: 0, hubTakePaid: [] }, stats: { condition: 1 }, rels: { earl: 'backer' } };
    spendEveningCost(g, 'fr3_eve_tommy');
    eq(g.stats.condition, 1, 'an evening never takes the last point of Condition');
    eq(money(g), 500 - EVENING_COST.fr3_eve_tommy.money, 'but it still costs its money');
    g.stats.condition = 4;
    spendEveningCost(g, 'fr3_eve_tommy');
    eq(g.stats.condition, 3, 'above the floor it costs what it says');
    spendEveningCost(g, 'fr3_eve_ruthie');
    eq(g.stats.condition, 4, 'and a negative cost gives a point back');
    g.stats.condition = 5;
    spendEveningCost(g, 'fr3_eve_ruthie');
    eq(g.stats.condition, 5, 'a point back at the ceiling stays at the ceiling');
  }

  // 7. The card says the trade, not just that there is one (the row's fifth
  // bullet). An evening the run cannot pay for names the shortfall, because
  // "unavailable" with no number is the thing this phase set out to fix.
  {
    const g = { flags: { money: 1000, monthlyOutgo: 0, hubTakePaid: [] }, stats: { condition: 3 }, rels: { earl: 'backer' } };
    ok(/\$55/.test(costTag(g, 'fr2_eve_practice')), `a priced evening names its price (${costTag(g, 'fr2_eve_practice')})`);
    ok(/Condition −1/.test(costTag(g, 'fr2_eve_practice')), 'and the Condition it takes');
    ok(/Condition \+1/.test(costTag(g, 'fr4_night_ride')), `and a restful one says it gives a point (${costTag(g, 'fr4_night_ride')})`);
    eq(costTag(g, 'fr3_eve_earl'), '1 Evening', 'an evening that costs only the evening says only that');
    g.flags.money = 20;
    ok(!eveningAffordable(g, 'fr2_eve_practice'), 'a $55 evening on $20 is not affordable');
    ok(/short \$35/.test(costTag(g, 'fr2_eve_practice')), `and the card says by how much (${costTag(g, 'fr2_eve_practice')})`);
    ok(eveningAffordable(g, 'fr3_eve_earl'), 'a free evening is always affordable');
  }

  // 8. The Milestone 4 gate (the row's fourth bullet). `m4_stunt_select` has
  // said "a school district that would rent him the buses against a deposit he
  // did not have yet" on the solo branch since Phase 1, and nothing read it.
  // On the backer branch Earl has the stadium booked, which the same paragraph
  // also says, so money is not a requirement there.
  {
    const rich = { flags: { money: BUS_DEPOSIT, monthlyOutgo: 0 }, stats: { showmanship: 4, precision: 3, nerve: 2 }, rels: { earl: 'absent' } };
    const broke = { flags: { money: BUS_DEPOSIT - 1, monthlyOutgo: 0 }, stats: { showmanship: 4, precision: 3, nerve: 2 }, rels: { earl: 'absent' } };
    ok(canAffordBuses(rich), 'the deposit exactly covers the buses');
    ok(!canAffordBuses(broke), 'a dollar short does not');
    ok(canAffordBuses({ ...broke, rels: { earl: 'backer' } }), "on the backer branch it is Earl's deposit, not Duke's");

    // The three choices read the one table rather than re-deriving it.
    const bus = SCENES.m4_stunt_select.choices.find(c => c.effects.flags.m4Choice === 'buses');
    const inf = SCENES.m4_stunt_select.choices.find(c => c.effects.flags.m4Choice === 'inferno');
    ok(bus._gateCheck === m4Gate('buses').check, 'the Bus Stack choice IS the table row');
    ok(inf._gateCheck === m4Gate('inferno').check, 'and so is the Inferno');
    eq(M4_STUNT_GATES.map(g => g.choice), ['buses', 'inferno', 'symbolic'], 'three stunts, in the order the screen offers them');
    ok(M4_STUNT_GATES.every(g => typeof g.check === 'function'), 'every row can be asked');
    ok(m4Gate('symbolic').check(), 'the symbolic stunt is always available');
  }

  // 9. And the hint the hub prints no longer re-derives the thresholds. It
  // promised a Bus Stack the choice screen then refused, and it knew nothing
  // at all about the deposit.
  {
    const engine = fs.readFileSync(path.join(JS, 'engine.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    ok(!/const\s+canBuses\s*=/.test(engine), 'renderHubFR3 no longer computes its own canBuses');
    ok(!/const\s+canInferno\s*=/.test(engine), 'nor its own canInferno');
    ok(/M4_STUNT_GATES\.filter/.test(engine), 'it filters the shared table instead');
  }

  // 10. The twelve hundred's four answers. Only one of them comes out of
  // Duke's pocket; the other three source the money somewhere else and what
  // they cost him is not money. And a month on a note is priced the way this
  // game has priced one since Phase 1 — `m2_solo_round2_collateral` printed
  // "The monthly number was thirty-seven dollars" against four hundred and ten
  // at eight percent over twelve months, and `monthlyOn` has to reproduce it
  // rather than invent a second arithmetic.
  {
    eq(monthlyOn(SOLO_LOAN), 37, "a month on the bike note is the thirty-seven the prose printed");
    eq(SELF_FUND_NET, SMALL_SHOW - (CAR_MONEY - CAR_RESALE), 'self-funding costs the resale gap less the extra show');
    ok(SELF_FUND_NET < 0, `and it is a cost, not a windfall (${SELF_FUND_NET})`);

    const arms = SCENES.fr2_debt_01.choices;
    eq(arms.length, 4, 'four answers to the twelve hundred');
    // Indexed off a filtered list, so read through `&&`: a break that empties
    // either list has to fail these by name rather than throw a TypeError out
    // of the suite three assertions early (#34 — read WHICH assertion fails).
    const pocket = arms.filter(c => c.effects.money);
    eq(pocket.length, 1, 'exactly one of them comes out of his pocket');
    eq(pocket[0] && pocket[0].effects.flags.debtSource, 'self', 'and it is the self-funded one');
    eq(pocket[0] && pocket[0].effects.money, SELF_FUND_NET, 'for what the resale arithmetic says');
    const paper = arms.filter(c => c.effects.owePerMonth);
    eq(paper.length, 1, 'exactly one of them signs paper with a monthly number');
    eq(paper[0] && paper[0].effects.flags.debtSource, 'bank', 'and it is the bank');
    eq(paper[0] && paper[0].effects.owePerMonth, monthlyOn(CAR_MONEY), 'priced off the twelve hundred');
    const free = arms.filter(c => !c.effects.money && !c.effects.owePerMonth).map(c => c.effects.flags.debtSource);
    eq(free.sort(), ['earl', 'tommy'], "Earl's advance and Tommy's loan cost no dollars — they cost him something else");
  }

  // 11. No accumulating number on a `statUpdate`, ever.
  //
  // A scene reached by a choice fires its statUpdate twice — the double-apply
  // frozen thirty-three scenes above — and the doubling is invisible for a
  // flag or a relationship write, which are idempotent, and is not for a
  // running total. This phase shipped its first version with the solo bank
  // note's monthly on `m2_solo_bank_collateral`'s update, and the solo
  // transcripts came out at $74 a month against a prose line that says
  // thirty-seven. `triggerStatUpdate` no longer looks at either key; this
  // fails on a scene that starts carrying one anyway, so the next author finds
  // out from the suite rather than from a transcript.
  {
    const carriers = Object.entries(SCENES)
      .filter(([, sc]) => sc.statUpdate && (sc.statUpdate.money || sc.statUpdate.owePerMonth))
      .map(([id]) => id).sort();
    ok(carriers.length === 0,
       `no statUpdate carries money or owePerMonth — those go on effects (carriers: ${carriers.join(', ') || 'none'})`);
    // And the ones that do carry them are on choices, which run once.
    const onEffects = [];
    for (const [id, sc] of Object.entries(SCENES))
      for (const ch of sc.choices || [])
        if (ch.effects && (ch.effects.money || ch.effects.owePerMonth)) onEffects.push(`${id}/${ch.label}`);
    ok(onEffects.length >= 4,
       `the dollars the story moves are on choices instead (${onEffects.length}: ${onEffects.join(', ')})`);
  }

  // 12. The save carries it, and `repair` coerces it back.
  {
    const r = repairState({ name: 'A', town: 'B', stats: {}, scene: 'fr3_eve_cal',
                            flags: { money: 'lots', monthlyOutgo: -12, hubTakePaid: 'fr2' } });
    eq(r.flags.money, 0, 'a string in the purse repairs to the default');
    eq(r.flags.monthlyOutgo, 0, 'and a negative monthly to zero');
    eq(r.flags.hubTakePaid, [], 'and the take list back to a list');
  }

  const priced = Object.keys(EVENING_COST).length;
  const dollars = Object.values(EVENING_COST).reduce((n, c) => n + c.money, 0);
  console.log(`\n  economy: ${priced} priced evenings, $${dollars} to read every one of them, ` +
              `${HUB_EVENINGS.fr1 + HUB_EVENINGS.fr2 + HUB_EVENINGS.fr3 + HUB_EVENINGS.fr4} evenings across the four hubs`);
}

/* ---------------------------------------------------------- the graph */
// Phase 5. test/graph.mjs builds the story's graph — scene `next`/`goto`,
// `_gateRoute` targets, goToScene()'s procedural blocks read as text, the
// hub renderers' cards and buttons — and walks it twice: plain, and over
// (scene, relationship bag) pairs with `_needs` and the route tables exact.
// The same findings its CLI prints are asserted here so they cost nothing.
{
  const f = findings();
  ok(f.unrouted.length === 0, `graph: every edge lands on a scene or a handled route (unrouted: ${f.unrouted.join(', ') || 'none'})`);
  ok(f.orphans.length === 0, `graph: every scene is reachable from the cold open (orphans: ${f.orphans.join(', ') || 'none'})`);
  ok(f.unnamedRoutes.length === 0, `graph: every route goToScene handles is named by something (dead routes: ${f.unnamedRoutes.join(', ') || 'none'})`);
  const newNoRels = f.noRels.filter(id => !UNREACHABLE_BY_RELS.includes(id));
  const staleNoRels = UNREACHABLE_BY_RELS.filter(id => !f.noRels.includes(id));
  ok(newNoRels.length === 0, `graph: every reachable scene is reachable under some relationship state, or is frozen (under none: ${newNoRels.join(', ') || 'none'})`);
  ok(staleNoRels.length === 0, `graph: every frozen scene is still reachable under no relationship state (stale: ${staleNoRels.join(', ') || 'none'})`);
  // The graph has to see what the story declares: every choice `_needs` and
  // every hub card `_needs` is a gate the relationship walk applied, and the
  // known gated cards are on it by name.
  const gated = [...f.g.cards.values()].flat().filter(c => c.needs).map(c => c.id).sort();
  ok(gated.includes('fr4_eve_california') && gated.includes('fr3_eve_tommy') && gated.includes('fr2_danny_02'),
     `graph: the hub cards' _needs are read as data (gated cards: ${gated.length})`);
  ok(f.g.tables.size === 3, `graph: the three route-table blocks are walked exactly (${[...f.g.tables.keys()].join(', ')})`);
  console.log(`\n  graph: ${f.g.known.size} scenes, ${f.g.routes.length} routes, ${[...f.plain].filter(id => f.g.known.has(id)).length} reached plain, ${[...f.withRels.scenes].filter(id => f.g.known.has(id)).length} reached by the relationship walk over ${f.withRels.states} states`);
}


/* --------------------------------------------- three stunts (Phase 7) */
// `SCALES` carried {n, unit, label} and nothing else: ramp angle, gravity,
// green speed band, landing tolerance and drift were identical at Milestone 1
// and Milestone 4, and thirteen buses was three cows with ten more silhouettes
// drawn between the ramps. Everything below is pure arithmetic over one number
// per scale, which is the whole reason stunt.js imports nothing.
{
  const SK = { nerve: 60, precision: 60, showmanship: 60, condition: 60 };
  const order = ['cows', 'cars', 'buses'];
  const tune = Object.fromEntries(order.map(k => [k, stuntTuning(k, SK)]));

  // 1. Milestone 1 did not move. Every number the game shipped with is what
  //    three cows still solves to, so the first stunt a player ever rides is
  //    the one the nine committed transcripts were taken against.
  const cows = tune.cows;
  eq(cows.GREEN_C, 485, 'three cows still want 485 at the lip');
  eq([cows.START, cows.VMAX], [80, 590], 'and the same run-up and top end');
  eq([cows.LAND_TOP, cows.LAND_END, cows.FINISH, cows.WORLD_END], [1600, 2000, 2300, 2480],
     'and the same ramps');
  eq(cows.WORLD_START, 0, "and the same camera stop, so Milestone 1's pan does not move");
  ok(tune.cars.WORLD_START < 0 && tune.buses.WORLD_START < tune.cars.WORLD_START,
     'while the longer run-ups move the world left of zero');
  eq(round3(cows.greenHalf), round3(30 + (SK.nerve / 100) * 0.45 * 100 * 0.45),
     "and the old green band's half-width");
  eq(round3(cows.TOL), round3(16 + (SK.precision / 100) * 22), 'and the old landing tolerance');
  eq(round3(cows.DRIFT_A), round3(52 + (1 - SK.condition / 100) * 150), 'and the old drift');

  // 2. Three scales are three stunts, in five directions at once. A fourth row
  //    that clamps onto an existing tier — n past thirteen — comes out
  //    identical to buses and fails here rather than shipping as more
  //    silhouettes.
  const rises = (f, what) => ok(f(tune.cows) < f(tune.cars) && f(tune.cars) < f(tune.buses),
    `${what} rises with the scale (${order.map(k => round3(f(tune[k]))).join(' < ')})`);
  const falls = (f, what) => ok(f(tune.cows) > f(tune.cars) && f(tune.cars) > f(tune.buses),
    `${what} falls with the scale (${order.map(k => round3(f(tune[k]))).join(' > ')})`);
  rises(t => t.LAND_TOP - GEO.LIP, 'the gap');
  rises(t => t.GREEN_C, 'the speed the approach has to find');
  rises(t => t.DRIFT_A, 'the drift');
  rises(t => t.VMAX, "the bike's top end");
  falls(t => t.LAND_END - t.LAND_TOP, 'the landing zone');
  falls(t => t.TOL, 'the body-angle tolerance');
  falls(t => t.greenHalf, 'the green band');
  falls(t => t.START, 'the start line moves back');

  // 3. The required speed is not a number somebody picked. It is solved out of
  //    the geometry, so it lands where it says it lands — 52.7% along the
  //    landing ramp — on every scale. A gap that grew without the speed
  //    growing with it would put the ideal approach in the dirt, silently.
  for (const k of order) {
    const t = tune[k];
    const x = contactXFor(t.GREEN_C, t.LAND_TOP);
    const frac = (x - t.LAND_TOP) / (t.LAND_END - t.LAND_TOP);
    ok(Math.abs(frac - LAND_FRAC) < 0.02,
       `${k}: the green centre lands ${(frac * 100).toFixed(1)}% along the ramp, not ${(LAND_FRAC * 100).toFixed(1)}%`);
  }

  // 4. And it is reachable. Full throttle from the start line to the lip, on
  //    the run's own numbers, has to find the green centre with ramp to spare
  //    — otherwise the tier is unwinnable and no amount of skill helps. This
  //    is the check a difficulty change has to survive without a browser; the
  //    autopilot is the same check with a real canvas under it.
  for (const k of order) {
    const t = tune[k];
    const D2R = Math.PI / 180, cos = d => Math.cos(d * D2R);
    let v = 0, x = t.START, dt = 1 / 240, hit = null;
    for (let i = 0; i < 40000 && x < GEO.LIP; i++) {
      v = Math.min(v + GEO.ACCEL * dt - GEO.FRICT * dt * 0.2, t.VMAX);
      x += v * cos(x >= GEO.RAMP_START && x < GEO.LIP ? GEO.RAMP_DEG : 0) * dt;
      if (hit === null && v >= t.GREEN_C) hit = x;
    }
    ok(hit !== null && GEO.LIP - hit >= 150,
       `${k}: full throttle finds ${t.GREEN_C} with ${hit === null ? 'never' : Math.round(GEO.LIP - hit) + 'px'} of run left`);
  }

  // 5. There is room to be wrong. The band of launch speeds that lands inside
  //    the zone at all has to sit around the green centre with real margin on
  //    both sides, or the stunt is a coin flip dressed as a skill check.
  for (const k of order) {
    const t = tune[k];
    const lo = speedForContact(t.LAND_TOP, t.LAND_TOP), hi = speedForContact(t.LAND_END, t.LAND_TOP);
    ok(t.GREEN_C - lo >= 20 && hi - t.GREEN_C >= 20,
       `${k}: the landing window is ${Math.round(lo)}..${Math.round(hi)} around ${t.GREEN_C}`);
  }

  // 6. The tier is clamped at both ends, and `tierOf` is the only place the
  //    count becomes a difficulty.
  eq([tierOf(1), tierOf(TIER_FLOOR), tierOf(TIER_FLOOR + TIER_SPAN), tierOf(99)], [0, 0, 1, 1],
     'the tier clamps to 0..1');
  eq(stuntTuning('nonsense', SK).scale, 'cows', 'an unknown scale falls back to three cows');
  // And a speed too slow to reach the landing ramp reports short rather than
  // NaN — the quadratic has no root there, and a NaN contact would compare
  // false against both ends of the zone and read as a clean landing.
  ok(contactXFor(120, tune.buses.LAND_TOP) < tune.buses.LAND_TOP,
     'a launch too slow to reach the ramp lands short, not NaN');
  eq(Math.round(lipTopY() * 10) / 10, 260.2, 'the lip is where the ramp puts it');
}

/* ------------------------------------------- the retry has a price (Phase 7) */
// "Try Again" restarted any run for free, so the outcome that decides
// `GS.flags.stuntOutcome` and three chapters of framing was re-rollable until
// the player liked it.
{
  eq([RETRY_LIMIT, RETRY_CONDITION_COST], [1, 1], 'one retry, one point of Condition');
  ok(canRetry('run', 0, 3), 'a first retry is on the table');
  ok(!canRetry('run', 1, 3), 'a second one is not');
  ok(!canRetry('run', 0, 0), 'and neither is the first with no Condition to spend');
  ok(canRetry('crowd', 0, 1), 'the crowd can be worked again');
  ok(!canRetry('recovery', 0, 5), 'the Recovery is never re-ridden');
  // The engine has to actually ask. A `rAgain` handler that restarts without
  // going through canRetry is the bug this row exists to close, and it reads
  // exactly like the old one-liner did.
  const eng = fs.readFileSync(path.join(JS, 'engine.js'), 'utf8');
  const again = eng.slice(eng.indexOf("getElementById('rAgain').onclick"));
  ok(/canRetry\(/.test(again.slice(0, 400)) && /RETRY_CONDITION_COST/.test(again.slice(0, 400)),
     'the Try Again handler asks canRetry and charges the Condition');
  ok(!/scale-row[\s\S]{0,400}pill/.test(eng), 'the Scale pill row is off the minigame screen');
}

/* ------------------------------- the Recovery's result is read (Phase 7) */
// `RecoveryCore.result()` has always returned SUCCESS/PARTIAL/FAIL and the
// rounds cleared, and both call sites took the ticket and dropped it: a player
// who cleared all four rounds and one who cleared none walked into the same
// scene and paid the same Condition.
{
  const eng = fs.readFileSync(path.join(JS, 'engine.js'), 'utf8');
  const sites = [...eng.matchAll(/launchMinigame\('recovery'[\s\S]{0,160}?\}\);/g)].map(m => m[0]);
  eq(sites.length, 2, 'there are two standalone Recovery call sites');
  ok(sites.every(t => /recordRecovery\(/.test(t)),
     'and both hand the ticket to recordRecovery instead of dropping it');

  const before = { ...GS.flags };
  const cost = (scene, rec) => {
    GS.flags.recovery = rec; GS.flags.recoveryRounds = 3; GS.flags.recoveryReps = 4;
    return SCENES[scene].statUpdate.deltas.condition;
  };
  eq([cost('m1_stunt_crash_bad', 'strong'), cost('m1_stunt_crash_bad', 'partial'), cost('m1_stunt_crash_bad', 'poor')],
     [-1, -2, -3], 'the Milestone 1 hard fall costs less Condition after a good recovery');
  eq([cost('m3_failure_bad_after', 'strong'), cost('m3_failure_bad_after', 'partial'), cost('m3_failure_bad_after', 'poor')],
     [-2, -3, -4], 'and so does the Milestone 3 one');
  // A run that somehow reaches either scene without the flag pays what the
  // scene always cost, rather than the good-recovery discount.
  GS.flags.recovery = null;
  eq([SCENES.m1_stunt_crash_bad.statUpdate.deltas.condition,
      SCENES.m3_failure_bad_after.statUpdate.deltas.condition], [-3, -4],
     'no recovery on the record reads as a poor one');

  // And the player is told. The tail paragraph names the rounds off the ticket.
  const tail = SCENES.m1_stunt_crash_bad.lines.at(-1);
  GS.flags.recovery = 'strong'; GS.flags.recoveryRounds = 4; GS.flags.recoveryReps = 4;
  const strongTail = typeof tail.text === 'function' ? tail.text() : '';
  GS.flags.recovery = 'poor'; GS.flags.recoveryRounds = 0;
  const poorTail = typeof tail.text === 'function' ? tail.text() : '';
  ok(/4 of 4/.test(strongTail), 'the Milestone 1 aftermath says how many rounds the body cleared');
  ok(/0 of 4/.test(poorTail), 'and says the real number when it cleared none');
  ok(strongTail !== poorTail, 'and the paragraph itself is not the same one either way');

  // Work the Crowd's three verdicts reach Earl's third line.
  const earl = SCENES.m1_earl_approach_perfect.lines.at(-1);
  GS.flags.crowdWork = 'read'; const read = earl.text();
  GS.flags.crowdWork = 'half'; const half = earl.text();
  GS.flags.crowdWork = 'lost'; const lost = earl.text();
  ok(new Set([read, half, lost]).size === 3,
     'Earl says a different third line for each of the crowd three verdicts');
  ok(/showmanship:\s*-1/.test(eng.slice(eng.indexOf('function handleCrowdM1Result'), eng.indexOf('function handleCrowdM1Result') + 1200)),
     'and a crowd that drifted costs the point rather than paying nothing');

  Object.assign(GS.flags, before);
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
