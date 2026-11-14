// Several scenarios kept side by side (ARCHITECTURE 21.2 and 21.10, SV2-113):
// node test/engine/scenarios-kept.test.mjs
//
// The data (Scenario.id with prefix e, project.scenarios), validate and repair
// of it, an older planner's copy-through, the actions that keep, open,
// duplicate, rename and delete, mapScenarios at each site that rewrites the
// open scenario, scenarioProject against what the scenario lane runs, the
// helpers compare-buildings will use, and the clears. Every case runs on the
// sample school and the store's clock is pinned.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as actions from '../../engine/actions.js';
import { createStore } from '../../engine/store.js';
import { ID_PREFIXES, collectIds, isId } from '../../engine/ids.js';
import { validate } from '../../engine/validate.js';
import { repair } from '../../engine/repair.js';
import { sampleSchool } from '../../data/sample-school.js';
import {
  SCENARIOS_MOST, mapScenarios, keptScenarios, scenarioProject, reconcile, applyChanges, applyLevers, leverRouteOptions,
  walkFigures, busiestOf, findingsOf, roomKeys, matchRooms, compareResults,
} from '../../engine/scenario.js';
import { createPipeline, scenarioRun } from '../../engine/worker.js';
import { clearedSchedule, clearedBuilding, scheduleContents, scheduleWords, newProjectWords, freshProject } from '../../ui/project/clear.js';
import { school, clone, clock, makeIds, ctx, assertValid } from './helpers.mjs';

const { newScenario, openScenario, duplicateScenario, renameScenario, deleteScenario, discardScenario, addScenarioChange, addScenarioLever, setScenarioFromFile, applyScenario, ActionError } = actions;

const A = 'dsample00a';
const B = 'dsample00b';
const G6A = 'gsample06a';
const G7C = 'gsample07c';
const G8A = 'gsample08a';

const move = (groupId, period, roomId, dayTypeId) => ({ kind: 'move', dayTypeId: dayTypeId || A, groupId, period, roomId });
const releaseGroups = (groups, seconds) => ({ kind: 'release', who: { groups }, seconds: seconds || 60, after: null, dayTypeIds: null });
const refusedWith = (code) => (error) => error instanceof ActionError && error.code === code;

function storeOf(project) {
  return createStore({ project: project || school(), clock, ids: makeIds(5) });
}

// A scenario as a project holds it: named, with one change.
function scenarioNamed(name, id, extra) {
  return { ...(id ? { id } : {}), name, changes: [move(G7C, 1, 'rsample204')], compared: null, ...extra };
}

// The sample with an open scenario and `kept` kept ones, every one with an id.
function withKept(names, open) {
  const project = school();
  project.scenario = open === undefined ? scenarioNamed('Open', 'eopen00001') : open;
  project.scenarios = names.map((name, i) => scenarioNamed(name, 'ekept' + String(i).padStart(5, '0')));
  return project;
}

const names = (project) => [project.scenario ? project.scenario.name : null, ...keptScenarios(project).map((scenario) => scenario.name)];

// ---------------------------------------------------------------- ids

test('ids: scenarios have the prefix e, no other kind shares it, and collectIds walks scenario.id and scenarios[*].id', () => {
  assert.equal(ID_PREFIXES.scenario, 'e');
  assert.equal(new Set(Object.values(ID_PREFIXES)).size, Object.keys(ID_PREFIXES).length, 'no two kinds share a letter');
  const project = withKept(['One', 'Two']);
  const found = collectIds(project);
  for (const id of ['eopen00001', 'ekept00000', 'ekept00001']) assert.ok(found.includes(id), id);
  // an open scenario with no id, and no kept list, add nothing and throw nothing
  const plain = school();
  plain.scenario = { name: 'Old', changes: [], compared: null };
  assert.equal(collectIds(plain).filter((id) => id[0] === 'e').length, 0);
  plain.scenarios = 'x';
  assert.doesNotThrow(() => collectIds(plain));
});

// ---------------------------------------------------------------- validate

test('validate: kept scenarios are a list of at most 11, each a scenario with its own id of prefix e, unique across the project', () => {
  assertValid(withKept(['One', 'Two', 'Three']));
  assertValid({ ...withKept([]), scenarios: [] });
  const open = scenarioNamed('Open');
  assertValid({ ...school(), scenario: open }, 'an open scenario with no id is as it was');
  assertValid({ ...school(), scenario: { ...open, id: 'eopen00001' } });

  const paths = (project) => validate(project).map((finding) => finding.path);
  assert.deepEqual(paths({ ...withKept([]), scenarios: 'x' }), ['scenarios']);
  assert.deepEqual(paths({ ...withKept([]), scenarios: [7] }), ['scenarios[0]']);
  const twelve = withKept(Array.from({ length: 12 }, (_, i) => 'S' + i));
  assert.deepEqual(paths(twelve), ['scenarios'], '12 kept is one over: 11 and the open one make 12');
  assertValid(withKept(Array.from({ length: 11 }, (_, i) => 'S' + i)));

  const wrong = withKept(['One']);
  wrong.scenarios[0].id = 'rkept00000';
  assert.deepEqual(paths(wrong), ['scenarios[0].id'], 'a kept scenario with another kind\'s prefix');
  const missing = withKept(['One']);
  delete missing.scenarios[0].id;
  assert.deepEqual(paths(missing), ['scenarios[0].id'], 'a kept scenario has an id');
  const clash = withKept(['One']);
  clash.scenarios[0].id = clash.scenario.id;
  assert.deepEqual(paths(clash), ['scenarios[0].id'], 'ids are unique across scenario and scenarios');
  const open2 = { ...withKept(['One']), scenario: { ...scenarioNamed('Open'), id: 'xopen00001' } };
  assert.deepEqual(paths(open2), ['scenario.id'], 'the open scenario\'s id, when it has one, is an e');
  const shaped = withKept(['One']);
  shaped.scenarios[0].changes[0] = { kind: 'move' };
  assert.deepEqual(paths(shaped), ['scenarios[0].changes[0].dayTypeId', 'scenarios[0].changes[0]'], 'a kept scenario is checked as the open one is, at its own path');
});

test('validate: names are not validated, so a project an older planner saved with a blank or repeated name is not quarantined', () => {
  const project = withKept(['Same', 'same', '  ', '']);
  project.scenario.name = ' SAME ';
  assertValid(project);
});

// ---------------------------------------------------------------- repair

test('repair: the sample is the same object; a project with valid kept scenarios is too; absent stays absent', () => {
  const sample = sampleSchool();
  const result = repair(sample);
  assert.equal(result.project, sample);
  assert.deepEqual(result.notes, []);
  assert.equal('scenarios' in result.project, false);
  const kept = withKept(['One', 'Two']);
  const again = repair(kept);
  assert.equal(again.project, kept, 'a project that needs nothing comes back as it came');
  assert.deepEqual(again.notes, []);
  const noId = { ...school(), scenario: scenarioNamed('Old') };
  const fixed = repair(noId);
  assert.equal(fixed.project, noId);
  assert.equal('id' in fixed.project.scenario, false, 'the open scenario\'s id, absent, is left absent');
});

test('repair: a kept scenario that is not an object, or has no list of changes, is dropped with a note; a missing, wrong or repeated id is given a new one with a note', () => {
  const project = withKept(['One', 'Two', 'Three', 'Four', 'Five']);
  project.scenarios[0] = 'x';
  project.scenarios[1].changes = 'x';
  delete project.scenarios[2].id;
  project.scenarios[3].id = 'rwrongkind';
  project.scenarios[4].id = project.scenario.id;
  const { project: fixed, notes } = repair(project, { ids: makeIds(3) });
  assertValid(fixed);
  assert.deepEqual(fixed.scenarios.map((scenario) => scenario.name), ['Three', 'Four', 'Five']);
  const ids = fixed.scenarios.map((scenario) => scenario.id);
  assert.ok(ids.every((id) => isId(id, 'e')));
  assert.equal(new Set([...ids, fixed.scenario.id]).size, 4, 'the ids are four different ones');
  assert.equal(fixed.scenario.id, 'eopen00001', 'the open one keeps its id');
  assert.equal(notes.length, 5);
  assert.match(notes[0], /^Kept scenario 1 could not be read and was removed\.$/);
  assert.match(notes[1], /^Kept scenario 2 had no list of changes and was removed\.$/);
  assert.match(notes[2], /^Kept scenario 3 had no id and was given one\.$/);
  assert.match(notes[3], /^Kept scenario 4 had the id "rwrongkind", which is not the id of such a thing/);
  assert.match(notes[4], /^Kept scenario 5 shared the id "eopen00001" with something earlier and was given a new one\.$/);
});

test('repair: the open scenario\'s id is kept when it is one, replaced when it is not; kept scenarios not in a list are removed; more than 11 are cut', () => {
  const project = withKept(['One']);
  project.scenario.id = 'nopen00001';
  const fixed = repair(project, { ids: makeIds(3) });
  assert.ok(isId(fixed.project.scenario.id, 'e'));
  assert.notEqual(fixed.project.scenario.id, 'nopen00001');
  assert.match(fixed.notes[0], /^The open scenario had the id "nopen00001"/);

  const notList = repair({ ...withKept([]), scenarios: { a: 1 } });
  assert.equal('scenarios' in notList.project, false);
  assert.deepEqual(notList.notes, ['The kept scenarios could not be read and were removed.']);

  const many = withKept(Array.from({ length: 13 }, (_, i) => 'S' + i));
  const cut = repair(many);
  assert.equal(cut.project.scenarios.length, SCENARIOS_MOST - 1);
  assert.equal(cut.notes.length, 2);
  assert.match(cut.notes[0], /^Kept scenario 12 was over the 11 a project keeps besides the open one and was removed\.$/);
  assertValid(cut.project);
});

test('repair: a kept scenario is read as the open one is: a lever that cannot be read is dropped, with the scenario named in the note, and ids that were renamed are followed', () => {
  const project = withKept(['One']);
  project.scenarios[0].levers = [{ kind: 'headCount', groupId: G6A, headCount: 20 }, { kind: 'bell' }];
  const { project: fixed, notes } = repair(project);
  assert.deepEqual(fixed.scenarios[0].levers, [{ kind: 'headCount', groupId: G6A, headCount: 20 }]);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /^Kept scenario 1: 1 lever of the scenario could not be read and was removed: Lever 2 of the scenario was a bell/);
  // a group given a new id: a kept scenario's change and lever follow it
  const clashing = withKept(['One']);
  clashing.scenarios[0].changes = [move('gsample06a', 1, 'rsample204')];
  clashing.groups[1] = { ...clashing.groups[1], id: 'bad id' };
  clashing.scenarios[0].changes.push(move('bad id', 2, 'rsample204'));
  const renamed = repair(clashing, { ids: makeIds(9) }).project;
  const newId = renamed.groups[1].id;
  assert.ok(isId(newId, 'g'));
  assert.equal(renamed.scenarios[0].changes[1].groupId, newId, 'the kept scenario\'s change follows the renamed group');
});

// ---------------------------------------------------------------- an older planner

// An older planner has no rule for the new fields: its repair copies what it
// does not know and its validate does not look at it. The new rules are
// marked in the source with W6 comments, so this test takes them out of a copy
// of the engine and runs that copy, rather than writing a second version of
// what an older planner does.
function olderEngine() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const engine = path.join(here, '..', '..', 'engine');
  const dir = mkdtempSync(path.join(tmpdir(), 'sv2-older-'));
  mkdirSync(path.join(dir, 'engine'));
  let stripped = 0;
  for (const name of readdirSync(engine)) {
    if (!name.endsWith('.js')) continue;
    let text = readFileSync(path.join(engine, name), 'utf8');
    const before = text;
    text = text.replace(/^[ \t]*\/\/ W6:BEGIN[^\n]*\n[\s\S]*?^[ \t]*\/\/ W6:END[^\n]*\n/gm, '');
    text = text.replace(/^[^\n]*\/\/ W6:LINE[^\n]*\n/gm, '');
    if (text !== before) stripped += 1;
    writeFileSync(path.join(dir, 'engine', name), text);
  }
  return { dir, stripped, url: (name) => pathToFileURL(path.join(dir, 'engine', name)).href };
}

test('an older planner: a project with every new field goes through repair and validate with the new rules removed and comes out byte for byte', async () => {
  const older = olderEngine();
  try {
    assert.equal(older.stripped, 3, 'ids.js, validate.js and repair.js hold the new rules, and are the three that were changed');
    const oldRepair = (await import(older.url('repair.js'))).repair;
    const oldValidate = (await import(older.url('validate.js'))).validate;
    const oldIds = await import(older.url('ids.js'));
    assert.equal(oldIds.ID_PREFIXES.scenario, undefined, 'the copy knows no scenario prefix');
    const project = withKept(['One', 'Two'], scenarioNamed('Open', 'eopen00001', { levers: [releaseGroups([G6A])] }));
    project.label = 'Next year’s <b>proposal</b>';
    project.scenarios[1].levers = [{ kind: 'headCount', groupId: G6A, headCount: 20 }];
    // the new rules would refuse these; the older planner does not know them
    const text = JSON.stringify(project);
    const result = oldRepair(JSON.parse(text));
    assert.equal(JSON.stringify(result.project), text, 'repair leaves every new field as it found it');
    assert.deepEqual(result.notes, []);
    assert.deepEqual(oldValidate(JSON.parse(text)), []);
    // and what the new rules refuse, an older planner takes without a finding: that is the reason names are never validated
    const odd = { ...project, scenarios: [{ id: 'xx', name: '', changes: 'x' }], label: 5 };
    assert.deepEqual(oldValidate(odd), [], 'the copy has no rule for scenarios or label');
    assert.notDeepEqual(validate(odd), [], 'the real validate has');
  } finally {
    rmSync(older.dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- the actions

test('newScenario with keep: the open scenario moves to the front of the kept list with an id, the new one opens, one undo step', () => {
  const store = storeOf();
  store.apply(newScenario, { name: 'First' });
  const first = store.project.scenario;
  assert.ok(isId(first.id, 'e'), 'a scenario made now has an id');
  assert.equal('scenarios' in store.project, false, 'no kept list until one is kept');
  store.apply(newScenario, { name: 'Second', keep: true });
  assert.deepEqual(names(store.project), ['Second', 'First']);
  assert.equal(store.project.scenarios[0].id, first.id);
  assert.equal(store.project.scenarios[0].changes, first.changes, 'the kept scenario is the one that was open');
  assert.ok(isId(store.project.scenario.id, 'e') && store.project.scenario.id !== first.id);
  assert.equal(store.undoLabel, 'Start scenario Second');
  assert.deepEqual(store.project.groups, school().groups, 'the schedule is as it was');
  assertValid(store.project);
  store.apply(newScenario, { name: 'Third', keep: true });
  assert.deepEqual(names(store.project), ['Third', 'Second', 'First'], 'the newest kept goes first');
  store.undo();
  assert.deepEqual(names(store.project), ['Second', 'First']);
  store.undo();
  assert.deepEqual(names(store.project), ['First']);
  assert.equal(store.project.scenario.id, first.id);
  assert.equal(keptScenarios(store.project).length, 0);
});

test('newScenario: an open scenario with no id is given one when it is kept; keep with none open just opens; without keep or replace an open one is refused as before', () => {
  const project = { ...school(), scenario: scenarioNamed('Old') };
  const store = storeOf(project);
  assert.throws(() => store.apply(newScenario, { name: 'New' }), refusedWith('scenario-open'));
  store.apply(newScenario, { name: 'New', keep: true });
  assert.ok(isId(store.project.scenarios[0].id, 'e'), 'the kept scenario that had no id has one now');
  assert.equal(store.project.scenarios[0].name, 'Old');
  const bare = storeOf();
  bare.apply(newScenario, { name: 'Only', keep: true });
  assert.deepEqual(names(bare.project), ['Only']);
  assert.equal(keptScenarios(bare.project).length, 0, 'nothing was open, so nothing is kept');
});

test('newScenario: twelve in all, the 13th refused too-many with the sentence; replace makes no room it did not have; undo of the refusal changes nothing', () => {
  let store = storeOf(withKept(Array.from({ length: 10 }, (_, i) => 'S' + i)));
  assert.equal(1 + keptScenarios(store.project).length, 11);
  store.apply(newScenario, { name: 'Twelfth', keep: true });
  assert.equal(1 + keptScenarios(store.project).length, SCENARIOS_MOST);
  const full = store.project;
  assert.throws(() => store.apply(newScenario, { name: 'Thirteenth', keep: true }), (error) => refusedWith('too-many')(error) && error.message === 'This project keeps 12 scenarios, the most it can. Delete one first.');
  assert.equal(store.project, full, 'a refusal changes nothing');
  store.apply(newScenario, { name: 'Instead', replace: true });
  assert.equal(store.project.scenario.name, 'Instead', 'replacing the open one is still possible at twelve');
  assert.equal(keptScenarios(store.project).length, 11);
  assert.throws(() => store.apply(duplicateScenario, {}), refusedWith('too-many'));
  assert.throws(() => store.apply(setScenarioFromFile, { project: school(), fileName: 'x.json', keep: true }), refusedWith('too-many'));
  store = storeOf(withKept([]));
  store.apply(newScenario, { name: 'Two', keep: true });
  assert.equal(store.project.scenarios.length, 1);
});

test('newScenario: names are unique among all scenarios, without regard to case or spaces; the default name is numbered, a typed name that is taken is refused name-taken', () => {
  const store = storeOf();
  store.apply(newScenario, {});
  assert.equal(store.project.scenario.name, 'New scenario');
  store.apply(newScenario, { keep: true });
  assert.equal(store.project.scenario.name, 'New scenario 2');
  store.apply(newScenario, { name: '  ', keep: true });
  assert.equal(store.project.scenario.name, 'New scenario 3');
  store.apply(newScenario, { name: 'Stagger 8th grade', keep: true });
  for (const taken of ['stagger 8th grade', 'STAGGER8THGRADE', ' Stagger  8th\tgrade ', 'new scenario 2']) {
    assert.throws(() => store.apply(newScenario, { name: taken, keep: true }), (error) => refusedWith('name-taken')(error) && error.message === 'Another scenario is called ' + taken + '.', JSON.stringify(taken));
  }
  assert.throws(() => store.apply(newScenario, { name: 'new scenario 3', replace: true }), refusedWith('name-taken'), 'a kept scenario\'s name is taken when the open one is replaced');
  store.apply(newScenario, { name: 'STAGGER 8th grade', replace: true });
  assert.equal(store.project.scenario.name, 'STAGGER 8th grade', 'the scenario that is replaced does not hold its name');
});

test('openScenario: a kept scenario opens and the open one takes its place in the list; no step when it is open already; no-scenario for an id not kept; one undo step', () => {
  const store = storeOf(withKept(['One', 'Two', 'Three']));
  const before = store.project;
  const two = before.scenarios[1];
  store.apply(openScenario, { id: two.id });
  assert.equal(store.project.scenario.name, 'Two');
  assert.notEqual(store.project.scenario, two, 'a new object, so the lane sees a new scenario');
  assert.deepEqual(store.project.scenario, two);
  assert.deepEqual(names(store.project), ['Two', 'One', 'Open', 'Three'], 'the open one is in the place the opened one was');
  assert.equal(store.undoLabel, 'Open scenario Two');
  assertValid(store.project);
  const steps = store.undoDepth;
  store.apply(openScenario, { id: two.id });
  assert.equal(store.undoDepth, steps, 'opening the open scenario is no step');
  assert.throws(() => store.apply(openScenario, { id: 'egone000000' }), refusedWith('no-scenario'));
  assert.throws(() => store.apply(openScenario, {}), refusedWith('no-scenario'));
  assert.throws(() => store.apply(openScenario, null), refusedWith('no-scenario'));
  store.undo();
  assert.deepEqual(names(store.project), names(before), 'undo brings back the order');
  assert.deepEqual(store.project.scenarios, before.scenarios);
  assert.deepEqual(store.project.scenario, before.scenario);
});

test('openScenario with no scenario open: the kept one opens and leaves the list; the open one with no id is given one when it takes a place', () => {
  const project = withKept(['One', 'Two'], null);
  const store = storeOf(project);
  store.apply(openScenario, { id: project.scenarios[0].id });
  assert.deepEqual(names(store.project), ['One', 'Two']);
  assert.equal(store.project.scenarios.length, 1);
  const idless = withKept(['One'], scenarioNamed('Idless'));
  delete idless.scenario.id;
  const other = storeOf(idless);
  other.apply(openScenario, { id: idless.scenarios[0].id });
  assert.ok(isId(other.project.scenarios[0].id, 'e'));
  assert.equal(other.project.scenarios[0].name, 'Idless');
  assertValid(other.project);
});

test('duplicateScenario: a copy with a new id and "(copy)", "(copy 2)" while those are taken, put after its source; the open one stays open', () => {
  const store = storeOf(withKept(['One', 'Two']));
  store.apply(duplicateScenario, {});
  assert.deepEqual(names(store.project), ['Open', 'Open (copy)', 'One', 'Two'], 'a copy of the open one goes first');
  assert.equal(store.undoLabel, 'Duplicate scenario Open');
  const copy = store.project.scenarios[0];
  assert.ok(isId(copy.id, 'e') && copy.id !== store.project.scenario.id);
  assert.deepEqual(copy.changes, store.project.scenario.changes);
  assert.notEqual(copy.changes, store.project.scenario.changes, 'a copy of its own, not the same list');
  store.apply(duplicateScenario, {});
  assert.equal(store.project.scenarios[0].name, 'Open (copy 2)');
  store.apply(duplicateScenario, { id: store.project.scenarios[2].id });
  assert.deepEqual(names(store.project), ['Open', 'Open (copy 2)', 'Open (copy)', 'One', 'One (copy)', 'Two']);
  assert.equal(store.undoLabel, 'Duplicate scenario One');
  assert.equal(store.project.scenario.name, 'Open', 'the open scenario stays open');
  assertValid(store.project);
  // the open scenario named by its own id is the open one
  store.apply(duplicateScenario, { id: store.project.scenario.id });
  assert.equal(store.project.scenarios[0].name, 'Open (copy 3)');
  assert.throws(() => store.apply(duplicateScenario, { id: 'egone000000' }), refusedWith('no-scenario'));
  const none = storeOf(withKept(['One'], null));
  assert.throws(() => none.apply(duplicateScenario, {}), refusedWith('no-scenario'));
});

test('duplicateScenario: a copy shares nothing with its source, a name as typed is the base, and the copy is not a "copy of a copy" chain by default', () => {
  const project = withKept(['<b>"A" & B</b>'], scenarioNamed('Open', 'eopen00001', { levers: [releaseGroups([G6A])], compared: { fileName: 'x.json', addedGroups: ['9A'], removedGroups: [] } }));
  const store = storeOf(project);
  store.apply(duplicateScenario, { id: project.scenarios[0].id });
  assert.equal(store.project.scenarios[1].name, '<b>"A" & B</b> (copy)');
  store.apply(duplicateScenario, {});
  const copy = store.project.scenarios[0];
  assert.deepEqual(copy.levers, project.scenario.levers);
  assert.notEqual(copy.levers, store.project.scenario.levers);
  assert.notEqual(copy.compared, store.project.scenario.compared);
  assert.deepEqual(copy.compared, project.scenario.compared);
});

test('renameScenario by id: a kept scenario is renamed in place; name-taken is refused without regard to case or spaces; its own name in other case is allowed; the same name is no step; no-scenario for an id not kept', () => {
  const store = storeOf(withKept(['One', 'Two']));
  const before = store.project;
  const id = before.scenarios[1].id;
  store.apply(renameScenario, { id, name: 'Two <i>& more</i>' });
  assert.deepEqual(names(store.project), ['Open', 'One', 'Two <i>& more</i>']);
  assert.equal(store.undoLabel, 'Rename scenario Two to Two <i>& more</i>');
  assert.equal(store.project.scenario, before.scenario, 'the open scenario is untouched');
  assert.equal(store.project.scenarios[0], before.scenarios[0]);
  for (const taken of ['one', ' O n e ', 'OPEN']) assert.throws(() => store.apply(renameScenario, { id, name: taken }), refusedWith('name-taken'), JSON.stringify(taken));
  assert.throws(() => store.apply(renameScenario, { name: 'one' }), (error) => refusedWith('name-taken')(error) && error.message === 'Another scenario is called one.', 'the open one too');
  store.apply(renameScenario, { id, name: 'TWO <I>& MORE</I>' });
  assert.equal(store.project.scenarios[1].name, 'TWO <I>& MORE</I>');
  const steps = store.undoDepth;
  store.apply(renameScenario, { id, name: 'TWO <I>& MORE</I>' });
  assert.equal(store.undoDepth, steps);
  assert.throws(() => store.apply(renameScenario, { id: 'egone000000', name: 'X' }), refusedWith('no-scenario'));
  assert.throws(() => store.apply(renameScenario, { id, name: '​ ' }), refusedWith('no-name'));
  store.apply(renameScenario, { id: before.scenario.id, name: 'Renamed open' });
  assert.equal(store.project.scenario.name, 'Renamed open', 'the open one by its own id');
  assertValid(store.project);
});

test('deleteScenario: a kept scenario goes with its label and one undo step; the open one is not deleted by it; no-scenario for an id not kept', () => {
  const store = storeOf(withKept(['One', 'Two', 'Three']));
  const before = store.project;
  store.apply(deleteScenario, { id: before.scenarios[1].id });
  assert.deepEqual(names(store.project), ['Open', 'One', 'Three']);
  assert.equal(store.undoLabel, 'Delete scenario Two');
  assert.equal(store.project.scenarios[0], before.scenarios[0]);
  assert.throws(() => store.apply(deleteScenario, { id: before.scenarios[1].id }), refusedWith('no-scenario'), 'already gone');
  assert.throws(() => store.apply(deleteScenario, { id: before.scenario.id }), refusedWith('no-scenario'), 'Discard is the open one\'s');
  assert.throws(() => store.apply(deleteScenario, null), refusedWith('no-scenario'));
  store.undo();
  assert.deepEqual(store.project.scenarios, before.scenarios);
  store.apply(deleteScenario, { id: before.scenarios[0].id });
  store.apply(deleteScenario, { id: before.scenarios[1].id });
  store.apply(deleteScenario, { id: before.scenarios[2].id });
  assert.deepEqual(keptScenarios(store.project), []);
  assertValid(store.project);
});

test('discardScenario and applyScenario leave the kept scenarios kept; the kept ones are reconciled against the new schedule as a view', () => {
  const project = withKept(['One']);
  project.scenarios[0].changes = [move(G7C, 1, 'rsample204')];
  const store = storeOf(project);
  const kept = store.project.scenarios;
  store.apply(applyScenario, {});
  assert.equal(store.project.scenario, null);
  assert.equal(store.project.scenarios, kept, 'the very same list');
  const now = reconcile(store.project, store.project.scenarios[0]);
  assert.equal(now.changes.length, 0, 'the schedule already has what the kept scenario would do');
  assert.equal(now.dropped.length, 1);
  assert.match(now.dropped[0].sentence, /the schedule already has this\.$/);
  const other = storeOf(withKept(['One']));
  other.apply(discardScenario, {});
  assert.deepEqual(names(other.project), [null, 'One']);
});

test('setScenarioFromFile with keep: the open scenario is kept and the compared one opens; its default name is numbered when taken; twelve and name-taken as for newScenario', () => {
  const nextYear = school();
  nextYear.groups = nextYear.groups.filter((group) => group.id !== G8A);
  const store = storeOf(withKept(['Compared with next.json']));
  store.apply(setScenarioFromFile, { project: nextYear, fileName: 'next.json', keep: true });
  assert.equal(store.project.scenario.name, 'Compared with next.json 2', 'the name its file gives, numbered because one kept scenario has it');
  assert.ok(isId(store.project.scenario.id, 'e'));
  assert.deepEqual(names(store.project).slice(1), ['Open', 'Compared with next.json']);
  assert.equal(store.project.scenarios[0].id, 'eopen00001');
  assert.match(store.undoLabel, /^Compare with next\.json: /);
  assertValid(store.project);
  assert.throws(() => store.apply(setScenarioFromFile, { project: nextYear, fileName: 'next.json', name: 'open', keep: true }), refusedWith('name-taken'));
  assert.throws(() => store.apply(setScenarioFromFile, { project: nextYear, fileName: 'next.json' }), refusedWith('scenario-open'), 'without keep or replace an open one is refused as before');
  const bare = storeOf();
  bare.apply(setScenarioFromFile, { project: nextYear, fileName: 'next.json', keep: true });
  assert.equal(bare.project.scenario.name, 'Compared with next.json');
  assert.equal('scenarios' in bare.project, false, 'nothing was open, so nothing was kept');
  store.undo();
  assert.deepEqual(names(store.project), ['Open', 'Compared with next.json']);
});

test('the actions\' labels and refusals read a null or empty payload as {} and never throw a TypeError', () => {
  const store = storeOf(withKept(['One']));
  for (const act of [openScenario, duplicateScenario, renameScenario, deleteScenario]) {
    for (const payload of [null, undefined, {}]) {
      try {
        store.apply(act, payload);
        assert.ok(act === duplicateScenario, act.name + ' with nothing');
      } catch (error) {
        assert.ok(error instanceof ActionError, act.name + ': ' + error);
      }
    }
  }
});

// ---------------------------------------------------------------- mapScenarios

test('mapScenarios: the open scenario and each kept one, in that order; the same project when nothing changed; null removes a kept one; a project with no list gets none', () => {
  const project = withKept(['One', 'Two']);
  const seen = [];
  assert.equal(mapScenarios(project, (scenario) => { seen.push(scenario.name); return scenario; }), project);
  assert.deepEqual(seen, ['Open', 'One', 'Two']);
  const tagged = mapScenarios(project, (scenario) => ({ ...scenario, tag: scenario.name }));
  assert.deepEqual([tagged.scenario.tag, ...tagged.scenarios.map((scenario) => scenario.tag)], ['Open', 'One', 'Two']);
  assert.equal(project.scenario.tag, undefined, 'the project it was given is not changed');
  const dropped = mapScenarios(project, (scenario) => (scenario.name === 'One' ? null : scenario));
  assert.deepEqual(names(dropped), ['Open', 'Two']);
  const openOnly = { ...school(), scenario: scenarioNamed('Alone') };
  const mapped = mapScenarios(openOnly, (scenario) => ({ ...scenario, name: 'Renamed' }));
  assert.equal('scenarios' in mapped, false);
  assert.equal(mapped.scenario.name, 'Renamed');
  const none = school();
  none.scenario = null;
  assert.equal(mapScenarios(none, () => assert.fail('nothing to map')), none);
  assert.equal(mapScenarios({ ...none, scenarios: [] }, () => assert.fail('nothing to map')).scenarios.length, 0);
});

const corridorLever = (cells) => ({ kind: 'corridor', floorId: 'fsample001', cells, name: 'Main Corridor' });

test('mapScenarios site 1: a floor resize reindexes a kept scenario\'s corridor lever as it does the open one\'s, and the label counts the ones cut away in all of them', () => {
  const cells = [13, 14, 15, 16].map((x) => 7 * 40 + x);
  const project = withKept(['One'], scenarioNamed('Open', 'eopen00001', { levers: [corridorLever(cells)] }));
  project.scenarios[0].levers = [corridorLever(cells)];
  const store = storeOf(project);
  store.apply(actions.resizeFloor, { floorId: 'fsample001', left: 2, top: 1 });
  const moved = [13, 14, 15, 16].map((x) => 8 * 42 + x + 2);
  assert.deepEqual(store.project.scenario.levers[0].cells, moved);
  assert.deepEqual(store.project.scenarios[0].levers[0].cells, moved, 'a kept scenario moves with the building too');
  assertValid(store.project);
  store.undo();
  assert.deepEqual(store.project.scenarios[0].levers[0].cells, cells, 'one undo brings both back');
  // cut away in both: the label and the outcome count 2
  store.apply(actions.resizeFloor, { floorId: 'fsample001', left: -17 });
  assert.deepEqual(store.project.scenarios[0].levers, []);
  assert.deepEqual(store.project.scenario.levers, []);
  assert.match(store.undoLabel, /, and the scenario loses 2 closed corridors that are cut away$/);
  assert.equal(store.undoOutcome.leversLost, 2);
  // a kept scenario with no levers at all is the very same object after a resize
  const bare = storeOf(withKept(['One']));
  const noLevers = bare.project.scenarios[0];
  bare.apply(actions.resizeFloor, { floorId: 'fsample001', right: 1 });
  assert.equal(bare.project.scenarios[0], noLevers);
});

test('mapScenarios site 2: deleting a group takes it out of the kept scenarios\' release levers as out of the open one\'s, and their changes are left for reconcile as the open one\'s are', () => {
  const project = withKept(['One'], scenarioNamed('Open', 'eopen00001', { levers: [releaseGroups([G6A, G8A])] }));
  project.scenarios[0].levers = [releaseGroups([G8A]), releaseGroups([G6A, G8A], 90)];
  project.scenarios[0].changes = [move(G8A, 0, 'rsamplelib', B)];
  project.scenario.changes = [move(G8A, 1, 'rsamplelib', B)];
  const store = storeOf(project);
  store.apply(actions.deleteGroup, { id: G8A });
  assert.deepEqual(store.project.scenario.levers, [releaseGroups([G6A])]);
  assert.deepEqual(store.project.scenarios[0].levers, [releaseGroups([G6A], 90)], 'the lever that held only that group goes, the other loses it');
  assert.equal(store.project.scenarios[0].changes.length, 1, 'the changes stay, as the open one\'s do');
  assert.equal(store.project.scenario.changes.length, 1);
  assert.equal(reconcile(store.project, store.project.scenarios[0]).dropped.length, 1, 'reconcile says why it no longer applies');
  assertValid(store.project);
  store.undo();
  assert.equal(store.project.scenarios[0].levers.length, 2);
  // a kept scenario of another group is the very same object after the delete
  const other = storeOf(withKept(['One']));
  other.project.scenarios[0].levers = [releaseGroups([G6A])];
  const kept = other.project.scenarios[0];
  other.apply(actions.deleteGroup, { id: G8A });
  assert.equal(other.project.scenarios[0], kept, 'untouched stays the same object');
});

test('mapScenarios site 3: deleting a day type takes its changes and levers out of every scenario, and the sentence counts them all', () => {
  const project = withKept(['One'], scenarioNamed('Open', 'eopen00001', { levers: [{ kind: 'bell', dayTypeId: B, period: 1, start: '09:00', end: '09:40' }] }));
  project.scenario.changes = [move(G7C, 1, 'rsample204', B), move(G6A, 2, 'rsample204', A)];
  project.scenarios[0].changes = [move(G7C, 1, 'rsample204', B), move(G7C, 2, 'rsample204', B)];
  project.scenarios[0].levers = [{ kind: 'bell', dayTypeId: B, period: 1, start: '09:00', end: '09:40' }, { kind: 'bell', dayTypeId: A, period: 1, start: '09:00', end: '09:40' }];
  const described = actions.describeDayTypeDelete(project, B);
  assert.equal(described.scenarioChanges, 3, 'one in the open scenario, two in the kept one');
  assert.equal(described.scenarioLevers, 2);
  const store = storeOf(project);
  store.apply(actions.deleteDayType, { dayTypeId: B });
  assert.deepEqual(store.project.scenario.changes.map((change) => change.dayTypeId), [A]);
  assert.deepEqual(store.project.scenarios[0].changes, []);
  assert.deepEqual(store.project.scenario.levers, []);
  assert.deepEqual(store.project.scenarios[0].levers.map((lever) => lever.dayTypeId), [A]);
  assertValid(store.project);
  store.undo();
  assert.equal(store.project.scenarios[0].changes.length, 2);
  // making the day type "the same as" another takes them out too
  const same = storeOf(project);
  same.apply(actions.setDayTypeKind, { dayTypeId: B, own: false, sameAs: A });
  assert.deepEqual(same.project.scenarios[0].changes, []);
  assert.equal(actions.describeDayTypeKind(project, { dayTypeId: B, own: false, sameAs: A }).scenarioChanges, 3);
});

test('mapScenarios site 4: the periods-reduction preview counts the changes and levers of kept scenarios that use a period past the new end', () => {
  const project = withKept(['One'], scenarioNamed('Open', 'eopen00001', { levers: [] }));
  project.scenario.changes = [move(G7C, 1, 'rsample204')];
  project.scenarios[0].changes = [move(G7C, 6, 'rsample204'), { kind: 'swapPeriods', dayTypeId: A, groupId: G6A, periodA: 1, periodB: 7 }];
  project.scenarios[0].levers = [{ kind: 'bell', dayTypeId: A, period: 7, start: '14:00', end: '14:40' }, releaseGroups([G6A])];
  const preview = actions.describePeriodChange(project, 6);
  assert.equal(preview.scenarioChanges, 2, 'both in the kept scenario');
  assert.equal(preview.scenarioLevers, 1);
  assert.equal(preview.losesData, true);
  const quiet = actions.describePeriodChange({ ...project, scenarios: [] }, 8);
  assert.equal(quiet.scenarioChanges, 0);
});

// ---------------------------------------------------------------- scenarioProject

test('scenarioProject: the project a scenario makes is the one the scenario lane runs for the open one, on the sample with levers', () => {
  const store = storeOf();
  store.apply(newScenario, { name: 'Lab' });
  store.apply(addScenarioChange, { change: move(G7C, 1, 'rsample204') });
  store.apply(addScenarioLever, { lever: { kind: 'headCount', groupId: G6A, headCount: 30 } });
  store.apply(addScenarioLever, { lever: { kind: 'capacity', roomId: 'rsample203', capacity: 12 } });
  store.apply(addScenarioLever, { lever: { kind: 'bell', dayTypeId: A, period: 6, start: '13:20', end: '14:08' } });
  store.apply(addScenarioLever, { lever: releaseGroups([G6A]) });
  const project = store.project;
  const made = scenarioProject(project, project.scenario);
  assert.notEqual(made, project);
  assert.equal(project.scenario.levers.length, 4, 'the project handed in is not changed');
  // what the lane hands its pipeline, seen through a pipeline that records it
  const real = createPipeline();
  let seen = null;
  const spy = { run: (given, versions, options) => { seen = { project: given, options }; return real.run(given, versions, options); } };
  scenarioRun(spy, project, { geometry: 1, building: 1, schedule: 1 });
  assert.deepEqual(seen.project, made, 'the lane runs scenarioProject\'s project');
  assert.deepEqual(seen.options, leverRouteOptions(project, reconcile(project, project.scenario).levers));
  // the pieces it is made of
  const kept = reconcile(project, project.scenario);
  assert.deepEqual(made, applyLevers(applyChanges(project, kept.changes), kept.levers));
  assert.equal(made.groups.find((group) => group.id === G6A).headCount, 30);
  // a kept scenario is made into a project the same way
  store.apply(newScenario, { name: 'Next', keep: true });
  const lab = store.project.scenarios[0];
  const bare = (p) => ({ ...p, scenario: null, scenarios: undefined });
  assert.deepEqual(bare(scenarioProject(store.project, lab)), bare(made), 'a kept scenario is made into the same project the open one is');
  // no changes, no levers: the project itself
  assert.equal(scenarioProject(store.project, store.project.scenario), store.project);
});

// ---------------------------------------------------------------- what compare-buildings calls

test('walkFigures, busiestOf, findingsOf, roomKeys and matchRooms are exported; matchRooms also answers the numbers added and removed', () => {
  for (const fn of [walkFigures, busiestOf, findingsOf, roomKeys, matchRooms, compareResults]) assert.equal(typeof fn, 'function');
  assert.deepEqual(findingsOf(null), []);
  assert.deepEqual(findingsOf({ findings: { findings: [1, 2] } }), [1, 2]);
  const pipeline = createPipeline();
  const project = school();
  const result = scenarioRun(pipeline, project, { geometry: 1, building: 1, schedule: 1 });
  const figures = walkFigures(result, A, null);
  assert.ok(figures.all.walks > 0 && figures.all.total >= 0, 'the walk figures of a run');
  assert.ok(busiestOf(result, A, null).load > 0, 'the busiest place of a run');
  // rooms: the same building, a room only here, a room only there
  const mine = school();
  const theirs = school();
  const rooms = (p) => p.building.floors[0].spaces.filter((space) => space.kind === 'room');
  rooms(theirs)[0].number = 'Z9';
  rooms(theirs)[1].number = '  ';
  const same = matchRooms(roomKeys(mine), roomKeys(school()));
  assert.deepEqual([same.missing, same.added, same.missingNumbers, same.addedNumbers], [0, 0, [], []]);
  const other = matchRooms(roomKeys(mine), roomKeys(theirs));
  assert.equal(other.missing, 2, 'two rooms here have no room there (the renumbered one and the one with a blank number)');
  assert.equal(other.added, 1, 'a blank number is no room to match, so one is added');
  assert.deepEqual(other.addedNumbers, ['Z9']);
  assert.deepEqual(other.missingNumbers, [rooms(mine)[0].number, rooms(mine)[1].number]);
  // rooms that share a loose key: the surplus is the one past as many as the other file has
  const twin = school();
  rooms(twin)[1].number = rooms(twin)[0].number.toLowerCase() + ' ';
  const twins = matchRooms(roomKeys(mine), roomKeys(twin));
  assert.deepEqual([twins.missing, twins.added], [1, 1], 'one room has no match, and the second room of the pair is one more than the other file has');
  assert.deepEqual(twins.missingNumbers, [rooms(mine)[1].number]);
  assert.deepEqual(twins.addedNumbers, [rooms(twin)[1].number]);
  // numbers are text as typed, never interpreted
  const hostile = school();
  rooms(hostile)[0].number = '<b>"7"</b>';
  assert.deepEqual(matchRooms(roomKeys(mine), roomKeys(hostile)).addedNumbers, ['<b>"7"</b>']);
});

// ---------------------------------------------------------------- the clears

test('clearing the schedule clears the kept scenarios with the open one, and its words count them; the key goes when there were none', () => {
  const project = withKept(['One', 'Two']);
  assert.deepEqual(scheduleContents(project), { groups: 8, teachers: 12, accepted: 0, scenario: 'Open', kept: 2 });
  assert.equal(scheduleWords(project).removes, 'Removes 8 groups with their schedules, 12 teachers, the open scenario “⁨Open⁩” and 2 kept scenarios.');
  const cleared = clearedSchedule(project);
  assertValid(cleared);
  assert.equal(cleared.scenario, null);
  assert.equal('scenarios' in cleared, false);
  assert.equal(scheduleWords(cleared).empty, true, 'nothing is left to clear');
  assert.equal(scheduleWords(cleared).removes, 'There are no groups, teachers, accepted findings or scenario, so there is nothing to clear.');
  const oneKept = withKept(['Only'], null);
  assert.match(scheduleWords(oneKept).removes, /, 12 teachers and 1 kept scenario\.$/);
  // only kept scenarios left: that alone is something to clear
  const onlyKept = clearedSchedule(oneKept);
  onlyKept.scenarios = oneKept.scenarios;
  assert.equal(scheduleWords(onlyKept).empty, false);
  assert.equal(scheduleWords(onlyKept).removes, 'Removes 1 kept scenario.');
  // hostile names are isolated in the sentence, never markup
  const hostile = withKept(['x'], scenarioNamed('<b>"A"</b>‮', 'eopen00001'));
  assert.ok(scheduleWords(hostile).removes.includes('⁨<b>"A"</b>‮⁩'));
});

test('clearing the building leaves the scenarios as it leaves the open one (reconcile drops what no longer applies); a new project has none and its words count the kept ones', () => {
  const project = withKept(['One']);
  const cleared = clearedBuilding(project);
  assertValid(cleared);
  assert.equal(cleared.scenario, project.scenario);
  assert.equal(cleared.scenarios, project.scenarios);
  assert.equal(reconcile(cleared, cleared.scenarios[0]).changes.length, 0, 'the move to a room that is gone no longer applies');
  const fresh = freshProject(project, makeIds(4), clock);
  assertValid(fresh);
  assert.equal('scenarios' in fresh, false);
  assert.equal(fresh.scenario, null);
  assert.match(newProjectWords(project).removes, /, 2 day types and 1 kept scenario\.$/);
  assert.doesNotMatch(newProjectWords(school()).removes, /kept scenario/);
});

test('a project with kept scenarios survives a clear of the schedule and an undo: the kept ones are back', () => {
  const store = storeOf(withKept(['One', 'Two']));
  const before = store.project;
  store.apply(actions.replaceProject, { project: clearedSchedule(before), label: 'Clear the schedule' });
  assert.deepEqual(keptScenarios(store.project), []);
  store.undo();
  assert.equal(store.project.scenarios.length, 2);
  assert.equal(store.project.scenarios[1].id, 'ekept00001');
});
