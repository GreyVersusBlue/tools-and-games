// The scenario lab's actions (engine/actions.js, the SV2-61 block;
// ARCHITECTURE 6.6 and 9): node test/engine/scenario-actions.test.mjs
//
// Start, rename, add a change, remove one, discard, compare with another
// project file, apply. Every case runs on the sample school, whose A Day has
// 6C and 7C both in Room 203 in Period 2. The store's clock is pinned.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as actions from '../../engine/actions.js';
import { createStore } from '../../engine/store.js';
import { applyChanges, reconcile, changeWords } from '../../engine/scenario.js';
import { releaseOf } from '../../engine/schema.js';
import { validate } from '../../engine/validate.js';
import { writeProjectFile, readProjectFile } from '../../engine/project-file.js';
import { school, clone, clock, makeIds, assertValid } from './helpers.mjs';

const { addScenarioLever, removeScenarioLever, deleteDayType, setDayTypeKind, describeDayTypeDelete, describeDayTypeKind, describePeriodChange, setPeriods, newScenario, renameScenario, addScenarioChange, removeScenarioChange, removeScenarioChanges, discardScenario, setScenarioFromFile, applyScenario, setSlot, deleteGroup, revertToBase, ActionError, SCHEDULE, NEW_SCENARIO_NAME } = actions;

const A = 'dsample00a';
const B = 'dsample00b';
const G6C = 'gsample06c';
const G7C = 'gsample07c';
const G8A = 'gsample08a';
const G8B = 'gsample08b';

const move = (groupId, period, roomId, dayTypeId) => ({ kind: 'move', dayTypeId: dayTypeId || A, groupId, period, roomId });
const swapPeriods = (groupId, periodA, periodB) => ({ kind: 'swapPeriods', dayTypeId: A, groupId, periodA, periodB });
const swapRooms = (groupA, groupB, period) => ({ kind: 'swapRooms', dayTypeId: A, groupA, groupB, period });

const SIX = [newScenario, renameScenario, addScenarioChange, removeScenarioChange, discardScenario, setScenarioFromFile];

function storeOf(project) {
  return createStore({ project: project || school(), clock, ids: makeIds(5) });
}

function slot(project, groupId, dayTypeId, period) {
  return project.groups.find((candidate) => candidate.id === groupId).days[dayTypeId][period];
}

function counters(store) {
  return { geometry: store.geometryVersion, building: store.buildingVersion, schedule: store.scheduleVersion };
}

function refusedWith(code) {
  return (error) => error instanceof ActionError && error.code === code;
}

// A store with a scenario open and the given changes added one by one.
function withChanges(changes, name) {
  const store = storeOf();
  store.apply(newScenario, { name: name || 'Trial' });
  for (const change of changes) store.apply(addScenarioChange, { change });
  return store;
}

// ---------------------------------------------------------------- what each action is

test('the six scenario-only actions carry a label and bumps [] and move no counter; applyScenario bumps SCHEDULE', () => {
  for (const act of SIX) {
    assert.deepEqual(act.bumps, [], 'bumps of ' + act.name);
    assert.ok(typeof act.label === 'function' || typeof act.label === 'string', 'a label on every action');
    assert.notEqual(act.quiet, true, 'each is an undo step');
  }
  assert.equal(typeof applyScenario.bumps, 'function', 'applyScenario\'s bumps are worked out from what it writes (SV2-89)');
  assert.deepEqual(applyScenario.bumps(withChanges([]).project), [SCHEDULE]);
  assert.deepEqual(applyScenario.bumps(withChanges([move(G7C, 1, 'rsample204')]).project), [SCHEDULE]);

  const other = school();
  slot(other, G7C, A, 1).room = 'rsample204';
  const store = storeOf();
  const start = counters(store);
  store.apply(newScenario, { name: 'Trial' });
  store.apply(renameScenario, { name: 'Trial 2' });
  store.apply(addScenarioChange, { change: move(G7C, 1, 'rsample204') });
  store.apply(addScenarioChange, { change: move(G6C, 1, 'rsamplelib') });
  store.apply(removeScenarioChange, { index: 0 });
  store.apply(discardScenario, {});
  store.apply(setScenarioFromFile, { project: other, fileName: 'next-year.json' });
  assert.deepEqual(counters(store), start, 'no scenario-only action moved the geometry, building or schedule counter');
  assert.equal(store.history.past.length, 7, 'each was one undo entry');
  store.undo();
  store.redo();
  assert.deepEqual(counters(store), start, 'nor did their undo and redo');
  store.apply(applyScenario, {});
  assert.deepEqual(counters(store), { ...start, schedule: start.schedule + 1 }, 'apply moves the schedule counter alone');
});

// ---------------------------------------------------------------- newScenario

test('newScenario: an empty scenario with the name as typed, or "New scenario" when none is given', () => {
  const store = storeOf();
  const before = store.project;
  store.apply(newScenario, { name: '<b>Move "7th" grade</b>' });
  assert.deepEqual(store.project.scenario, { name: '<b>Move "7th" grade</b>', changes: [], compared: null });
  assert.equal(store.undoLabel, 'Start scenario <b>Move "7th" grade</b>');
  assert.equal(store.project.groups, before.groups, 'the schedule is the very same object');
  assert.equal(store.project.building, before.building);
  assertValid(store.project);

  assert.equal(newScenario(school(), {}).scenario.name, NEW_SCENARIO_NAME);
  assert.equal(newScenario(school(), { name: '   ' }).scenario.name, 'New scenario');
  assert.throws(() => newScenario(school(), { name: 7 }), refusedWith('bad-value'));
});

test('newScenario: an open scenario is not replaced unless the payload says replace', () => {
  const store = withChanges([move(G7C, 1, 'rsample204')]);
  const open = store.project;
  assert.throws(() => store.apply(newScenario, { name: 'Other' }), (error) => refusedWith('scenario-open')(error) && error.message === 'A scenario is already open: Trial. Apply it or discard it first.');
  assert.equal(store.project, open, 'a refusal changes nothing');
  store.apply(newScenario, { name: 'Other', replace: true });
  assert.deepEqual(store.project.scenario, { name: 'Other', changes: [], compared: null });
  store.undo();
  assert.equal(store.project.scenario, open.scenario, 'undo brings back the scenario it replaced');
});

// ---------------------------------------------------------------- renameScenario

test('renameScenario: the new name as typed; the same name is no step; a blank name and no scenario are refused', () => {
  const store = withChanges([move(G7C, 1, 'rsample204')]);
  const changes = store.project.scenario.changes;
  store.apply(renameScenario, { name: 'Gym on Fridays & <i>' });
  assert.equal(store.project.scenario.name, 'Gym on Fridays & <i>');
  assert.equal(store.project.scenario.changes, changes, 'the changes are the same list');
  assert.equal(store.undoLabel, 'Rename scenario Trial to Gym on Fridays & <i>');
  const entries = store.history.past.length;
  assert.equal(store.apply(renameScenario, { name: 'Gym on Fridays & <i>' }), store.project);
  assert.equal(store.history.past.length, entries, 'no entry for a name that does not change');
  assert.throws(() => store.apply(renameScenario, { name: '  ' }), refusedWith('no-name'));
  assert.throws(() => renameScenario(school(), { name: 'X' }), (error) => refusedWith('no-scenario')(error) && error.message === 'There is no scenario open. Start one first.');
});

// ---------------------------------------------------------------- addScenarioChange

test('addScenarioChange: the change is kept with its own fields only, and labelled with the chip words', () => {
  const store = withChanges([]);
  store.apply(addScenarioChange, { change: { ...move(G7C, 1, 'rsample204'), note: 'from the form', extra: [1] } });
  assert.deepEqual(store.project.scenario.changes, [move(G7C, 1, 'rsample204')]);
  assert.equal(store.undoLabel, 'Add to scenario Trial: 7C · A Day · Period 2: 203 → 204, taught by Mme. Dufrêne instead of Ms. Vandermeer');
  store.apply(addScenarioChange, { change: swapPeriods(G8A, 5, 6) });
  assert.equal(store.undoLabel, 'Add to scenario Trial: ' + changeWords(store.project, swapPeriods(G8A, 5, 6)).text);
  assert.equal(slot(store.project, G7C, A, 1).room, 'rsample203', 'the real schedule is not touched');
  assertValid(store.project);
});

test('addScenarioChange: refused in the schedule editor\'s words when it could not apply now, and for a malformed change', () => {
  const store = withChanges([]);
  const open = store.project;
  assert.throws(() => store.apply(addScenarioChange, { change: move(G7C, 1, 'rnosuchroom') }), (error) => refusedWith('missing')(error) && error.message === 'That room is no longer in the building. Pick another room.');
  assert.throws(() => store.apply(addScenarioChange, { change: move('gnosuchgrp', 1, 'rsample204') }), refusedWith('missing'));
  assert.throws(() => store.apply(addScenarioChange, { change: move(G7C, 8, 'rsample204') }), (error) => refusedWith('bad-value')(error) && /The day has 8/.test(error.message));
  for (const change of [null, { kind: 'teleport', dayTypeId: A }, { kind: 'move', dayTypeId: A, groupId: G7C, period: 1, roomId: null }, { kind: 'swapPeriods', dayTypeId: A, groupId: G7C, periodA: 1.5, periodB: 2 }, { kind: 'swapRooms', groupA: G7C, groupB: G6C, period: 1 }]) {
    assert.throws(() => store.apply(addScenarioChange, { change }), refusedWith('bad-value'), JSON.stringify(change));
  }
  assert.throws(() => addScenarioChange(school(), { change: move(G7C, 1, 'rsample204') }), refusedWith('no-scenario'));
  assert.equal(store.project, open, 'no refusal changed anything');

  // B Day made "the same as A Day": a change on it is refused as setSlot refuses it
  store.apply(revertToBase, { dayTypeId: B });
  assert.throws(() => store.apply(addScenarioChange, { change: move(G7C, 1, 'rsample204', B) }), (error) => refusedWith('same-as-base')(error) && error.message === 'B Day is the same as A Day. Make it its own copy to change it.');
});

test('addScenarioChange: a later change on a slot replaces the earlier one whole; one on another slot of a swap frees the swap\'s other slot', () => {
  const store = withChanges([move(G7C, 1, 'rsample204'), move(G6C, 2, 'rsample201')]);
  store.apply(addScenarioChange, { change: move(G7C, 1, 'rsamplelib') });
  assert.deepEqual(store.project.scenario.changes, [move(G6C, 2, 'rsample201'), move(G7C, 1, 'rsamplelib')]);
  store.apply(addScenarioChange, { change: swapPeriods(G6C, 1, 2) });
  assert.deepEqual(store.project.scenario.changes, [move(G7C, 1, 'rsamplelib'), swapPeriods(G6C, 1, 2)], 'the swap replaced the move on 6C\'s Period 3');
  store.apply(addScenarioChange, { change: swapRooms(G7C, G8B, 1) });
  assert.deepEqual(store.project.scenario.changes, [swapPeriods(G6C, 1, 2), swapRooms(G7C, G8B, 1)]);
});

test('addScenarioChange: "move 7C to 204 and back" leaves nothing, labelled as putting the schedule back; a change that changes nothing is no step', () => {
  const store = withChanges([move(G7C, 1, 'rsample204')]);
  store.apply(addScenarioChange, { change: move(G7C, 1, 'rsample203') });
  assert.deepEqual(store.project.scenario.changes, []);
  assert.equal(store.undoLabel, 'Add to scenario Trial: 7C · A Day · Period 2: 203 → 203, which puts back the schedule there and takes 1 change out of the scenario');
  store.undo();
  assert.deepEqual(store.project.scenario.changes, [move(G7C, 1, 'rsample204')], 'undo brings the change back');

  const entries = store.history.past.length;
  const now = store.project;
  for (const change of [move(G6C, 1, 'rsample203'), swapPeriods(G7C, 3, 3), swapRooms(G6C, G6C, 1)]) {
    assert.equal(store.apply(addScenarioChange, { change }), now, JSON.stringify(change));
  }
  assert.equal(store.history.past.length, entries, 'no entry for a change that changes nothing');
});

test('addScenarioChange: an older change the schedule has caught up with is kept; reconcile hides it, and undoing the real edit brings it back', () => {
  const store = withChanges([move(G7C, 1, 'rsample204')]);
  const older = store.project.scenario.changes[0];
  store.apply(setSlot, { groupId: G7C, dayTypeId: A, period: 1, slot: { room: 'rsample204' } });
  store.apply(addScenarioChange, { change: move(G6C, 2, 'rsample201') });
  assert.deepEqual(store.project.scenario.changes, [move(G7C, 1, 'rsample204'), move(G6C, 2, 'rsample201')], 'the caught-up change is still in the scenario');
  assert.equal(store.project.scenario.changes[0], older);
  const view = reconcile(store.project, store.project.scenario);
  assert.deepEqual(view.changes, [move(G6C, 2, 'rsample201')]);
  assert.equal(view.dropped[0].change, older, 'reconcile names the scenario\'s own object, so a chip finds its index');
  assert.match(view.dropped[0].sentence, /the schedule already has this\.$/);

  // the real edit is undone (the add above it first, then the edit): the change applies again
  store.undo();
  store.undo();
  assert.equal(slot(store.project, G7C, A, 1).room, 'rsample203');
  assert.deepEqual(reconcile(store.project, store.project.scenario).changes, [older]);
  // and the edit made again by hand and then taken back, with the newer change kept
  store.redo();
  store.redo();
  store.apply(setSlot, { groupId: G7C, dayTypeId: A, period: 1, slot: { room: 'rsample203' } });
  assert.deepEqual(reconcile(store.project, store.project.scenario).changes, [older, move(G6C, 2, 'rsample201')], 'the schedule moved on: the kept change applies again');
});

test('addScenarioChange: a change that puts the schedule back and takes two changes with it says it took two out, not that it put them back', () => {
  // 6C and 7C are both in Room 203 in Period 2: swapping their rooms there changes nothing
  const store = withChanges([move(G7C, 1, 'rsample204'), move(G6C, 1, 'rsamplelib')]);
  store.apply(addScenarioChange, { change: swapRooms(G6C, G7C, 1) });
  assert.deepEqual(store.project.scenario.changes, []);
  assert.equal(store.undoLabel, 'Add to scenario Trial: 6C ↔ 7C · A Day · Period 2: 203 ↔ 203, which puts back the schedule there and takes 2 changes out of the scenario');
  assert.doesNotMatch(store.undoLabel, /Put back in scenario/);
});

test('addScenarioChange: adding a change the scenario already holds, as a fresh object with the same fields, is no step', () => {
  const store = withChanges([move(G6C, 2, 'rsample201'), move(G7C, 1, 'rsample204')]);
  const now = store.project;
  const entries = store.history.past.length;
  assert.equal(store.apply(addScenarioChange, { change: { ...move(G7C, 1, 'rsample204'), note: 'again' } }), now, 'the project is the very same object');
  assert.equal(store.history.past.length, entries, 'no entry for a change the scenario already holds');
  assert.equal(store.project.scenario.changes, now.scenario.changes);
});

// ---------------------------------------------------------------- names and payloads

test('a blank stored name reads "New scenario" in every label; a name blank of white space and zero-width characters is blank', () => {
  const blank = school();
  blank.scenario = { name: ' \u200B ', changes: [move(G7C, 1, 'rsample204')], compared: null };
  const labels = [
    [renameScenario, { name: 'Trial' }, 'Rename scenario New scenario to Trial'],
    [addScenarioChange, { change: swapPeriods(G8A, 5, 6) }, 'Add to scenario New scenario: ' + changeWords(blank, swapPeriods(G8A, 5, 6)).text],
    [removeScenarioChange, { index: 0 }, 'Remove from scenario New scenario: 7C · A Day · Period 2: 203 → 204, taught by Mme. Dufrêne instead of Ms. Vandermeer'],
    [discardScenario, {}, 'Discard scenario New scenario'],
    [applyScenario, {}, 'Apply scenario New scenario: 1 change'],
  ];
  for (const name of ['', ' \u200B ']) {
    for (const [act, payload, label] of labels) {
      const store = storeOf(clone({ ...blank, scenario: { ...blank.scenario, name } }));
      store.apply(act, payload);
      assert.equal(store.undoLabel, label, act.name + ' with the name ' + JSON.stringify(name));
    }
  }
  const replaced = storeOf(clone({ ...blank, scenario: { ...blank.scenario, name: '' } }));
  replaced.apply(newScenario, { name: '\u200B\u200C\u200D\u2060\uFEFF \t', replace: true });
  assert.equal(replaced.project.scenario.name, NEW_SCENARIO_NAME, 'zero-width characters alone are the default name');
  assert.equal(replaced.undoLabel, 'Start scenario New scenario');

  assert.throws(() => replaced.apply(renameScenario, { name: '\u200B\u2060\uFEFF' }), refusedWith('no-name'));
  replaced.apply(renameScenario, { name: ' Trial\u200B ' });
  assert.equal(replaced.project.scenario.name, ' Trial\u200B ', 'a name that is not blank is stored exactly as typed');
  assert.equal(newScenario(school(), { name: '\u200BX' }).scenario.name, '\u200BX');
});

test('every scenario action reads a null payload as {}, so its own refusal applies and never a TypeError', () => {
  const none = storeOf();
  none.apply(newScenario, null);
  assert.equal(none.project.scenario.name, NEW_SCENARIO_NAME);
  none.apply(discardScenario, null);
  assert.throws(() => none.apply(setScenarioFromFile, null), (error) => refusedWith('bad-value')(error) && error.message === 'There is no project file to compare with.');

  const store = withChanges([move(G7C, 1, 'rsample204')]);
  const open = store.project;
  assert.throws(() => store.apply(renameScenario, null), refusedWith('no-name'));
  assert.throws(() => store.apply(addScenarioChange, null), refusedWith('bad-value'));
  assert.throws(() => store.apply(removeScenarioChange, null), refusedWith('missing'));
  assert.throws(() => store.apply(newScenario, null), refusedWith('scenario-open'));
  assert.throws(() => store.apply(setScenarioFromFile, null), refusedWith('scenario-open'));
  assert.equal(store.project, open, 'no refusal changed anything');
  store.apply(applyScenario, null);
  assert.equal(store.undoLabel, 'Apply scenario Trial: 1 change');
});

// ---------------------------------------------------------------- removeScenarioChange

test('removeScenarioChange: by index into the scenario\'s changes, labelled with its words; a stale index is refused', () => {
  const store = withChanges([move(G7C, 1, 'rsample204'), swapPeriods(G8A, 5, 6)]);
  const list = store.project.scenario.changes;
  const index = list.indexOf(reconcile(store.project, store.project.scenario).changes[1]);
  assert.equal(index, 1);
  store.apply(removeScenarioChange, { index });
  assert.deepEqual(store.project.scenario.changes, [move(G7C, 1, 'rsample204')]);
  assert.equal(store.project.scenario.changes[0], list[0], 'the change left is the same object');
  assert.equal(store.undoLabel, 'Remove from scenario Trial: 8A · A Day · Period 6 ↔ Period 7: Gym ↔ 303');
  for (const bad of [1, -1, 0.5, '0', undefined]) {
    assert.throws(() => store.apply(removeScenarioChange, { index: bad }), (error) => refusedWith('missing')(error) && error.message === 'That change is no longer in the scenario.', String(bad));
  }
  store.undo();
  assert.equal(store.project.scenario.changes, list);
});

// ---------------------------------------------------------------- removeScenarioChanges (SV2-72d)

test('SV2-72d removeScenarioChanges: several changes out as one undo entry, in any order; one Undo brings every one back', () => {
  const store = withChanges([move(G7C, 1, 'rsample204'), swapPeriods(G8A, 5, 6), move(G6C, 2, 'rsample201')]);
  const list = store.project.scenario.changes;
  const start = counters(store);
  const entries = store.history.past.length;
  store.apply(removeScenarioChanges, { indexes: [2, 0] });
  assert.deepEqual(store.project.scenario.changes, [swapPeriods(G8A, 5, 6)]);
  assert.equal(store.project.scenario.changes[0], list[1], 'the change left is the same object');
  assert.equal(store.history.past.length, entries + 1, 'one undo entry for both');
  assert.equal(store.undoLabel, 'Remove from scenario Trial: 2 changes');
  assert.deepEqual(counters(store), start, 'no counter moved');
  assert.deepEqual(removeScenarioChanges.bumps, []);
  store.undo();
  assert.equal(store.project.scenario.changes, list, 'one Undo brings both back, the same objects in their places');
  store.redo();
  assert.deepEqual(store.project.scenario.changes, [swapPeriods(G8A, 5, 6)]);
});

test('SV2-72d removeScenarioChanges: one index is labelled with its words; an empty list is no step; a bad or repeated index refuses the whole step', () => {
  const store = withChanges([move(G7C, 1, 'rsample204'), swapPeriods(G8A, 5, 6)]);
  const list = store.project.scenario.changes;
  const entries = store.history.past.length;
  store.apply(removeScenarioChanges, { indexes: [] });
  assert.equal(store.history.past.length, entries, 'no index, no entry');
  for (const bad of [[2], [-1], [0.5], ['0'], [0, 2], [undefined]]) {
    assert.throws(() => store.apply(removeScenarioChanges, { indexes: bad }), (error) => refusedWith('missing')(error) && error.message === 'That change is no longer in the scenario.', JSON.stringify(bad));
  }
  assert.throws(() => store.apply(removeScenarioChanges, { indexes: [1, 1] }), refusedWith('bad-value'));
  assert.throws(() => store.apply(removeScenarioChanges, { indexes: 1 }), refusedWith('bad-value'));
  assert.throws(() => store.apply(removeScenarioChanges, null), refusedWith('bad-value'));
  assert.equal(store.project.scenario.changes, list, 'a refusal changed nothing');
  assert.equal(store.history.past.length, entries);
  store.apply(removeScenarioChanges, { indexes: [1] });
  assert.equal(store.undoLabel, 'Remove from scenario Trial: 8A · A Day · Period 6 ↔ Period 7: Gym ↔ 303');
  store.apply(discardScenario, {});
  assert.throws(() => store.apply(removeScenarioChanges, { indexes: [0] }), refusedWith('no-scenario'));
});

test('SV2-72d removeScenarioChanges: the changes that no longer apply go in one step, and undoing it then the real edit makes them apply again', () => {
  const store = withChanges([move(G7C, 1, 'rsample204'), move(G6C, 2, 'rsample201')]);
  // the real schedule catches up with both: reconcile drops them as already there
  store.apply(setSlot, { groupId: G7C, dayTypeId: A, period: 1, slot: { room: 'rsample204' } });
  store.apply(setSlot, { groupId: G6C, dayTypeId: A, period: 2, slot: { room: 'rsample201' } });
  const scenario = store.project.scenario;
  const dropped = reconcile(store.project, scenario).dropped;
  assert.equal(dropped.length, 2);
  store.apply(removeScenarioChanges, { indexes: dropped.map((each) => scenario.changes.indexOf(each.change)) });
  assert.deepEqual(store.project.scenario.changes, []);
  store.undo();
  assert.equal(store.project.scenario, scenario, 'one Undo, the scenario as it was');
});

// ---------------------------------------------------------------- discardScenario

test('discardScenario: the scenario goes and undo brings the same one back; with none open it is no step', () => {
  const store = withChanges([move(G7C, 1, 'rsample204')]);
  const scenario = store.project.scenario;
  store.apply(discardScenario, {});
  assert.equal(store.project.scenario, null);
  assert.equal(store.undoLabel, 'Discard scenario Trial');
  assertValid(store.project);
  const entries = store.history.past.length;
  assert.equal(store.apply(discardScenario, {}), store.project);
  assert.equal(store.history.past.length, entries);
  store.undo();
  assert.equal(store.project.scenario, scenario);
});

// ---------------------------------------------------------------- setScenarioFromFile

function nextYear() {
  const other = clone(school());
  slot(other, G7C, A, 1).room = 'rsample204';
  slot(other, G8A, B, 0).room = 'rsamplelib';
  other.groups.find((candidate) => candidate.id === G8B).name = '9A';
  return other;
}

test('setScenarioFromFile: the file\'s schedule as moves, with the file and the groups only one side has in compared, and nothing of skipped kept', () => {
  const store = storeOf();
  store.apply(setScenarioFromFile, { project: nextYear(), fileName: 'next-year.json' });
  const scenario = store.project.scenario;
  assert.deepEqual(Object.keys(scenario).sort(), ['changes', 'compared', 'name'], 'the scenario gains no field');
  assert.equal(scenario.name, 'Compared with next-year.json');
  assert.deepEqual(scenario.changes, [move(G7C, 1, 'rsample204'), move(G8A, 0, 'rsamplelib', B)]);
  assert.deepEqual(scenario.compared, { fileName: 'next-year.json', addedGroups: ['9A'], removedGroups: ['8B'] });
  assert.equal(store.undoLabel, 'Compare with next-year.json: 2 changes');
  assertValid(store.project);

  const named = setScenarioFromFile(school(), { project: nextYear(), fileName: '', name: 'Proposal' });
  assert.equal(named.scenario.name, 'Proposal');
  assert.equal(setScenarioFromFile.label(school(), {}, named), 'Compare with another file: 2 changes');
});

test('setScenarioFromFile: another building is refused with the count of rooms, an open scenario is not replaced unless asked, and no project is refused', () => {
  const store = withChanges([move(G7C, 1, 'rsample204')]);
  const open = store.project;
  const other = nextYear();
  other.building.floors[0].spaces.find((space) => space.id === 'rsample101').number = '101A';
  assert.throws(() => store.apply(setScenarioFromFile, { project: other, fileName: 'x.json', replace: true }), (error) => refusedWith('different-building')(error) && error.message === 'This file describes a different building: 1 room is missing and 1 is added.');
  assert.throws(() => store.apply(setScenarioFromFile, { project: nextYear(), fileName: 'x.json' }), refusedWith('scenario-open'));
  assert.throws(() => store.apply(setScenarioFromFile, { fileName: 'x.json', replace: true }), refusedWith('bad-value'));
  assert.equal(store.project, open, 'no refusal changed anything');
  store.apply(setScenarioFromFile, { project: nextYear(), fileName: 'x.json', replace: true });
  assert.equal(store.project.scenario.compared.fileName, 'x.json');
  store.undo();
  assert.equal(store.project.scenario, open.scenario);
});

test('setScenarioFromFile: a file that is not a project this tool can read is refused in words, never a TypeError', () => {
  const good = school();
  const malformed = {
    'an empty object': {},
    'a list': [],
    'groups that are text': { ...good, groups: 'x' },
    'no building': { ...good, building: undefined },
    'a building with no floors': { ...good, building: {} },
    'floors with no spaces': { ...good, building: { ...good.building, floors: [{ id: 'f' }] } },
    'no settings': { ...good, settings: undefined },
    'no day types': { ...good, dayTypes: undefined },
    'a day type that is null': { ...good, dayTypes: [null] },
    'a group that is null': { ...good, groups: [null] },
  };
  const store = storeOf();
  const project = store.project;
  for (const [what, other] of Object.entries(malformed)) {
    assert.throws(() => store.apply(setScenarioFromFile, { project: other, fileName: 'odd.json' }), (error) => refusedWith('bad-value')(error) && error.message === 'This file is not a project file this tool can read, so there is nothing to compare with.', what);
  }
  assert.equal(store.project, project, 'no refusal changed anything');
  assert.equal(store.history.past.length, 0);
});

// ---------------------------------------------------------------- applyScenario

test('applyScenario: the reconciled changes go into the schedule as one entry, the scenario is closed, and one undo brings back both', () => {
  const store = withChanges([move(G7C, 1, 'rsample204'), swapPeriods(G8A, 5, 6), move(G6C, 2, 'rsample201'), swapRooms(G7C, G8B, 3)], 'Move 7th grade');
  store.apply(deleteGroup, { id: G6C });
  const before = store.project;
  const scenario = before.scenario;
  const kept = reconcile(before, scenario);
  assert.equal(kept.changes.length, 3, '6C\'s move no longer applies');
  const expected = applyChanges(before, kept.changes);
  const entries = store.history.past.length;
  const schedule = store.scheduleVersion;

  store.apply(applyScenario, {});
  assert.equal(store.history.past.length, entries + 1, 'one entry');
  assert.equal(store.undoLabel, 'Apply scenario Move 7th grade: 3 changes');
  assert.equal(store.project.scenario, null, 'the scenario is closed');
  assert.deepEqual(store.project.groups, expected.groups, 'the schedule is what the kept changes make it');
  assert.equal(slot(store.project, G7C, A, 1).room, 'rsample204');
  assert.equal(slot(store.project, G8A, A, 5).room, 'rsample303');
  assert.equal(slot(store.project, G8A, A, 6).room, 'rsamplegym');
  assert.equal(slot(store.project, G7C, A, 3).room, 'rsample203');
  assert.equal(slot(store.project, G8B, A, 3).room, 'rsample201');
  assert.equal(store.project.building, before.building, 'the building is the very same object');
  assert.equal(store.scheduleVersion, schedule + 1);
  assertValid(store.project);

  const undone = store.undo();
  assert.equal(undone.label, 'Apply scenario Move 7th grade: 3 changes');
  assert.equal(store.project.groups, before.groups, 'one undo brings back the schedule');
  assert.equal(store.project.scenario, scenario, 'and the scenario, changes and all');
  assert.equal(store.scheduleVersion, schedule + 2, 'undo moves the schedule counter again');
  store.redo();
  assert.equal(store.project.scenario, null);
  assert.deepEqual(store.project.groups, expected.groups);
});

test('applyScenario: one change is "1 change"; a scenario none of whose changes still apply is closed with "0 changes" and the schedule as it was', () => {
  const one = withChanges([move(G7C, 1, 'rsample204')], 'One');
  one.apply(applyScenario, {});
  assert.equal(one.undoLabel, 'Apply scenario One: 1 change');

  const none = withChanges([move(G6C, 2, 'rsample201')], 'None');
  none.apply(deleteGroup, { id: G6C });
  const groups = none.project.groups;
  none.apply(applyScenario, {});
  assert.equal(none.undoLabel, 'Apply scenario None: 0 changes');
  assert.equal(none.project.groups, groups);
  assert.equal(none.project.scenario, null);
});

test('applyScenario: a refusal changes nothing, and the project handed in is never written to', () => {
  // On a project repair gives, 'no-scenario' is the one refusal applyScenario
  // can reach: reconcile drops every change setSlot or moveSlot would refuse
  // there. The next case reaches one half way through the changes, on a
  // hand-built project repair would not give.
  const store = storeOf();
  const project = store.project;
  const state = { history: store.history, counters: counters(store), version: store.version };
  assert.throws(() => store.apply(applyScenario, {}), (error) => refusedWith('no-scenario')(error) && error.message === 'There is no scenario open. Start one first.');
  assert.equal(store.project, project);
  assert.deepEqual({ history: store.history, counters: counters(store), version: store.version }, state);

  // applied to a frozen project: any write in place would throw here
  const open = withChanges([move(G7C, 1, 'rsample204'), swapRooms(G7C, G8B, 3)]).project;
  const frozen = JSON.parse(JSON.stringify(open));
  const deepFreeze = (value) => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const key of Object.keys(value)) deepFreeze(value[key]);
    }
    return value;
  };
  deepFreeze(frozen);
  const copy = clone(frozen);
  const after = applyScenario(frozen, {});
  assert.deepEqual(frozen, copy, 'the project handed in is as it was');
  assert.equal(after.scenario, null);
});

test('applyScenario: a refusal half way through the changes leaves the store, its history and its counters as they were', () => {
  // Hand-built: 6C's Period 2 names a room that is gone and keeps the number
  // 7, not text. Reconcile keeps both changes (whyGone reads nothing of the
  // slot), the move on 8A applies, and then the swap of rooms hands setSlot
  // { room: null, roomText: 7 } for 7C, which it refuses. Repair would have
  // made the 7 text, so a project read from a file cannot get here.
  const project = school();
  const days = project.groups.find((candidate) => candidate.id === G6C).days;
  days[A][1] = { ...days[A][1], room: 'rnosuchrm1', roomText: 7 };
  project.scenario = { name: 'Half', changes: [move(G8A, 0, 'rsample204'), swapRooms(G6C, G7C, 1)], compared: null };
  const store = storeOf(project);
  assert.equal(reconcile(store.project, store.project.scenario).changes.length, 2, 'reconcile keeps both, so the refusal comes from setSlot');
  const before = store.project;
  const state = { history: store.history, past: store.history.past.slice(), counters: counters(store), version: store.version };
  assert.throws(() => store.apply(applyScenario, {}), (error) => refusedWith('bad-value')(error) && error.message === 'The room text is text.');
  assert.equal(store.project, before, 'the project is the very same object');
  assert.equal(store.project.scenario, before.scenario, 'the scenario is still open');
  assert.equal(slot(store.project, G8A, A, 0).room, slot(school(), G8A, A, 0).room, 'the first change is not half applied');
  assert.deepEqual({ history: store.history, past: store.history.past, counters: counters(store), version: store.version }, state);
});

// ---------------------------------------------------------------- the project file

test('a project file round-trips with an open scenario and with compared set', () => {
  const store = withChanges([move(G7C, 1, 'rsample204'), swapPeriods(G8A, 5, 6), swapRooms(G7C, G8B, 3)], 'Trial <"&">');
  const open = store.project;
  const read = readProjectFile(writeProjectFile(open, { images: {} }), { ids: makeIds(9), clock });
  assert.deepEqual(read.project, open, 'the open scenario comes back as it was');
  assert.deepEqual(read.notes, []);

  store.apply(setScenarioFromFile, { project: nextYear(), fileName: 'next "year".json', replace: true });
  const compared = store.project;
  const again = readProjectFile(writeProjectFile(compared, { images: {} }), { ids: makeIds(9), clock });
  assert.deepEqual(again.project, compared, 'compared comes back as it was');
  assert.deepEqual(again.project.scenario.compared, { fileName: 'next "year".json', addedGroups: ['9A'], removedGroups: ['8B'] });
});

// ================================================================ SV2-89: the schedule levers

const L_BELL = { kind: 'bell', dayTypeId: A, period: 6, start: '13:20', end: '14:08' };
const L_HEAD = { kind: 'headCount', groupId: 'gsample06a', headCount: 40 };
const L_SEATS = { kind: 'capacity', roomId: 'rsample203', capacity: 12 };
const L_GRADE = { kind: 'release', who: { grade: '7' }, seconds: 120, after: null, dayTypeIds: null };

function withLevers(levers, changes) {
  const store = withChanges(changes || [], 'Trial');
  for (const lever of levers) store.apply(addScenarioLever, { lever });
  return store;
}

test('levers: the two actions are undo steps that move no counter, and a scenario with none keeps no `levers` key', () => {
  for (const act of [addScenarioLever, removeScenarioLever]) {
    assert.deepEqual(act.bumps, [], 'bumps of ' + act.name);
    assert.ok(typeof act.label === 'function');
    assert.notEqual(act.quiet, true);
  }
  const store = withChanges([move(G7C, 1, 'rsample204')]);
  assert.equal('levers' in store.project.scenario, false, 'absent until the first lever is added');
  const start = counters(store);
  store.apply(addScenarioLever, { lever: L_HEAD });
  store.apply(addScenarioLever, { lever: L_BELL });
  store.apply(removeScenarioLever, { index: 0 });
  assert.deepEqual(counters(store), start);
  assert.deepEqual(store.project.scenario.levers, [L_BELL]);
  store.undo();
  assert.deepEqual(store.project.scenario.levers, [L_HEAD, L_BELL]);
  assert.deepEqual(store.project.scenario.changes.length, 1, 'the changes were not touched');
  assertValid(store.project);
});

test('addScenarioLever: each kind is stored with its own fields and no others, in words that name what was added', () => {
  const store = withLevers([{ ...L_HEAD, extra: 1 }, { ...L_SEATS, extra: 1 }, { ...L_BELL, extra: 1 }, { ...L_GRADE, extra: 1 }]);
  assert.deepEqual(store.project.scenario.levers, [L_HEAD, L_SEATS, L_BELL, L_GRADE]);
  assert.equal(store.undoLabel, 'Add to scenario Trial: Grade 7 leaves 2 min after the bell');
  store.undo();
  assert.equal(store.undoLabel, 'Add to scenario Trial: A Day, Period 7: 1:20 PM to 2:08 PM (was 1:12 PM to 2:00 PM)');
  store.undo();
  assert.equal(store.undoLabel, 'Add to scenario Trial: Room 203 seats 12 (was 30)');
  store.undo();
  assert.equal(store.undoLabel, 'Add to scenario Trial: 6A: 40 students (was 24)');
});

test('addScenarioLever: a lever is refused in words, and nothing changes: no scenario, a bad kind, a bad value, a group or room that is not there, a "same as" day', () => {
  const store = withChanges([]);
  const before = store.project;
  const refused = (lever, code, text) => assert.throws(() => store.apply(addScenarioLever, { lever }), (error) => refusedWith(code)(error) && (text === undefined || text.test(error.message)), JSON.stringify(lever));
  refused(undefined, 'bad-value', /staggered dismissal, a bell time/);
  refused({ kind: 'move' }, 'bad-value');
  refused({ kind: 'way', connectionId: 'c', way: 'closed' }, 'bad-value', /staggered dismissal/);
  refused({ ...L_HEAD, headCount: 0 }, 'bad-value', /head count is a whole number from 1 to 999/);
  refused({ ...L_HEAD, headCount: undefined }, 'bad-value');
  refused({ ...L_HEAD, groupId: 'ggone00000' }, 'missing', /no longer in the project/);
  refused({ ...L_SEATS, capacity: 1000 }, 'bad-value', /capacity is a whole number from 1 to 999/);
  refused({ ...L_SEATS, roomId: 'rgone00000' }, 'missing', /room is no longer in the building/);
  refused({ ...L_BELL, start: '9:50' }, 'bad-value', /bell time/);
  refused({ ...L_BELL, period: 9 }, 'bad-value', /not in the school day/);
  refused({ ...L_BELL, dayTypeId: 'dgone00000' }, 'missing');
  refused({ ...L_BELL, bellsId: 'bgone00000' }, 'bad-value', /one day type or one bell schedule/);
  refused({ kind: 'bell', bellsId: 'bgone00000', period: 1, start: '09:00', end: '09:40' }, 'missing', /bell schedule is no longer/);
  refused({ ...L_GRADE, seconds: 10 }, 'bad-value', /whole number of seconds from 15 to 300/);
  refused({ ...L_GRADE, who: { grade: '7', wing: 'N' } }, 'bad-value', /one of some groups, a grade or a wing/);
  refused({ ...L_GRADE, after: [] }, 'bad-value');
  refused({ ...L_GRADE, after: [9] }, 'bad-value');
  refused({ ...L_GRADE, dayTypeIds: ['dgone00000'] }, 'missing');
  assert.equal(store.project, before, 'nothing changed');
  const same = withChanges([]);
  same.apply(revertToBase, { dayTypeId: B });
  assert.throws(() => same.apply(addScenarioLever, { lever: { ...L_BELL, dayTypeId: B } }), refusedWith('same-as-base'));
  const none = storeOf();
  assert.throws(() => none.apply(addScenarioLever, { lever: L_HEAD }), (error) => refusedWith('no-scenario')(error) && error.message === 'There is no scenario open. Start one first.');
  assert.throws(() => none.apply(removeScenarioLever, { index: 0 }), refusedWith('no-scenario'));
});

test('addScenarioLever: a lever that puts things back as they are removes itself, with no undo step; one of the same key replaces the earlier', () => {
  const store = withLevers([L_SEATS]);
  const entries = store.history.past.length;
  store.apply(addScenarioLever, { lever: { kind: 'headCount', groupId: 'gsample06a', headCount: 24 } });
  store.apply(addScenarioLever, { lever: { kind: 'bell', dayTypeId: A, period: 6, start: '13:12', end: '14:00' } });
  store.apply(addScenarioLever, { lever: { kind: 'release', who: { groups: [G7C] }, seconds: 0, after: null, dayTypeIds: null } });
  assert.equal(store.history.past.length, entries, 'changing nothing makes no step');
  store.apply(addScenarioLever, { lever: L_SEATS });
  assert.equal(store.history.past.length, entries, 'nor does adding what is already there');
  store.apply(addScenarioLever, { lever: { ...L_SEATS, capacity: 20 } });
  assert.deepEqual(store.project.scenario.levers, [{ ...L_SEATS, capacity: 20 }], 'a later lever of the key replaces');
  assert.match(store.undoLabel, /^Add to scenario Trial: Room 203 seats 20 \(was 30\)$/);
  store.apply(addScenarioLever, { lever: { kind: 'capacity', roomId: 'rsample203', capacity: 30 } });
  assert.deepEqual(store.project.scenario.levers, [], 'putting the capacity back takes the earlier lever out as well');
  assert.equal(store.undoLabel, 'Add to scenario Trial: Room 203 seats 30 (was 30), which puts back the schedule there and takes 1 lever out of the scenario');
});

test('removeScenarioLever: takes one lever out by place; a place that is not there is refused', () => {
  const store = withLevers([L_HEAD, L_SEATS]);
  assert.throws(() => store.apply(removeScenarioLever, { index: 2 }), (error) => refusedWith('missing')(error) && error.message === 'That lever is no longer in the scenario.');
  assert.throws(() => store.apply(removeScenarioLever, { index: -1 }), refusedWith('missing'));
  assert.throws(() => store.apply(removeScenarioLever, {}), refusedWith('missing'));
  store.apply(removeScenarioLever, { index: 0 });
  assert.equal(store.undoLabel, 'Remove from scenario Trial: 6A: 40 students (was 24)');
  assert.deepEqual(store.project.scenario.levers, [L_SEATS]);
  store.apply(removeScenarioLever, { index: 0 });
  assert.deepEqual(store.project.scenario.levers, [], 'an empty list stays a list');
});

test('every lever action reads a null payload as {}, so its own refusal applies and never a TypeError', () => {
  const store = withLevers([L_HEAD]);
  for (const act of [addScenarioLever, removeScenarioLever]) assert.throws(() => store.apply(act, null), (error) => error instanceof ActionError, act.name);
});

test('applyScenario: levers go in after the changes in the same one undo step; capacity bumps the building too; a release becomes a real entry', () => {
  const store = withLevers([L_HEAD, L_SEATS, L_BELL, L_GRADE], [move(G7C, 1, 'rsample204')]);
  const before = store.project;
  const counts = { ...counters(store) };
  const entries = store.history.past.length;
  assert.deepEqual(applyScenario.bumps(before), [SCHEDULE, actions.BUILDING]);
  assert.equal(applyScenario.label(before), 'Apply scenario Trial: 1 change and 4 levers');

  store.apply(applyScenario, {});
  const after = store.project;
  assert.equal(store.history.past.length, entries + 1, 'one undo step');
  assert.equal(store.undoLabel, 'Apply scenario Trial: 1 change and 4 levers');
  assert.equal(after.scenario, null);
  assert.equal(slot(after, G7C, A, 1).room, 'rsample204', 'the change');
  assert.equal(after.groups.find((g) => g.id === 'gsample06a').headCount, 40);
  assert.equal(after.building.floors.flatMap((f) => f.spaces).find((sp) => sp.id === 'rsample203').capacity, 12);
  assert.deepEqual(after.dayTypes[0].bells[6], { start: '13:20', end: '14:08' });
  assert.equal(releaseOf(after).length, 1);
  assert.match(releaseOf(after)[0].id, /^l[a-z0-9]{9}$/, 'a real id');
  assert.deepEqual({ who: releaseOf(after)[0].who, seconds: releaseOf(after)[0].seconds, after: releaseOf(after)[0].after, dayTypeIds: releaseOf(after)[0].dayTypeIds }, { who: { grade: '7' }, seconds: 120, after: null, dayTypeIds: null });
  assert.equal(store.scheduleVersion, counts.schedule + 1);
  assert.equal(store.buildingVersion, counts.building + 1, 'a capacity moves the building counter');
  assert.equal(store.geometryVersion, counts.geometry, 'and not the geometry');
  assert.deepEqual(validate(after), []);
  assertValid(after);
  assert.deepEqual(store.undoOutcome, { text: 'Applied scenario Trial: 1 change, 1 staggered dismissal, 1 bell, 1 room capacity and 1 head count', changes: 1, levers: 4, byKind: { headCount: 1, capacity: 1, bell: 1, release: 1 } });

  store.undo();
  assert.equal(store.project.scenario, before.scenario, 'undo brings the scenario back whole, levers and all');
  assert.equal(store.project.groups, before.groups);
  assert.equal(store.project.building, before.building);
  assert.deepEqual(store.project.dayTypes, before.dayTypes);
});

test('applyScenario: a release lever replaces the real entry of its key; a head-count lever alone bumps only the schedule', () => {
  const project = school();
  project.release = [{ id: 'lsample001', who: { grade: '7' }, seconds: 60, after: null, dayTypeIds: null }, { id: 'lsample002', who: { wing: 'North' }, seconds: 45, after: [1], dayTypeIds: null }];
  const store = storeOf(project);
  store.apply(newScenario, { name: 'Trial' });
  store.apply(addScenarioLever, { lever: L_GRADE });
  store.apply(addScenarioLever, { lever: L_HEAD });
  assert.deepEqual(applyScenario.bumps(store.project), [SCHEDULE]);
  store.apply(applyScenario, {});
  assert.deepEqual(store.project.release.map((entry) => [entry.who, entry.seconds]), [[{ wing: 'North' }, 45], [{ grade: '7' }, 120]], 'the grade-7 entry was replaced, the wing entry stays');
  assert.equal(store.project.release[0], project.release[1], 'an untouched entry is the very same object');
  assert.equal(store.undoOutcome.byKind.release, 1);
  assert.equal(store.undoLabel, 'Apply scenario Trial: 0 changes and 2 levers');
});

test('applyScenario: a lever that no longer applies is left out, and the outcome counts what went in by kind', () => {
  const store = withLevers([L_HEAD, L_SEATS, L_GRADE]);
  store.apply(deleteGroup, { id: 'gsample06a' });
  store.apply(actions.deleteSpaces, { spaceIds: ['rsample203'] });
  const kept = reconcile(store.project, store.project.scenario);
  assert.equal(kept.levers.length, 1);
  assert.equal(kept.droppedLevers.length, 2);
  store.apply(applyScenario, {});
  assert.deepEqual(store.undoOutcome, { text: 'Applied scenario Trial: 0 changes and 1 staggered dismissal', changes: 0, levers: 1, byKind: { release: 1 } });
});

test('applyScenario: the project\'s limit on staggered dismissals refuses the whole step and changes nothing', () => {
  const project = school();
  project.release = Array.from({ length: 50 }, (unused, i) => ({ id: 'l' + String(i).padStart(9, '0'), who: { wing: 'W' + i }, seconds: 30, after: null, dayTypeIds: null }));
  const store = storeOf(project);
  store.apply(newScenario, { name: 'Trial' });
  store.apply(addScenarioLever, { lever: L_GRADE });
  const before = store.project;
  const entries = store.history.past.length;
  assert.throws(() => store.apply(applyScenario, {}), refusedWith('limit'));
  assert.equal(store.project, before);
  assert.equal(store.history.past.length, entries);
});

test('applyScenario: a scenario with no levers writes exactly what it wrote before, the building the very same object', () => {
  const store = withChanges([move(G7C, 1, 'rsample204')]);
  const before = store.project;
  store.apply(applyScenario, {});
  assert.equal(store.project.building, before.building);
  assert.equal(store.project.release, before.release);
  assert.equal(store.undoLabel, 'Apply scenario Trial: 1 change');
  assert.equal(store.undoOutcome.levers, 0);
});

test('deleteDayType, setDayTypeKind and setPeriods follow the levers: bell levers on a day type go with it, release levers that list it too', () => {
  const lever = { kind: 'release', who: { grade: '7' }, seconds: 90, after: [1, 7], dayTypeIds: [B] };
  const base = withLevers([{ ...L_BELL, dayTypeId: B }, lever, L_HEAD, { ...L_GRADE, who: { grade: '8' } }]).project;
  assert.equal(base.scenario.levers.length, 4);

  const info = describeDayTypeDelete(base, B);
  assert.equal(info.scenarioLevers, 2);
  assert.match(info.text, /2 levers in the scenario/);
  const store = storeOf(base);
  store.apply(deleteDayType, { dayTypeId: B });
  assert.deepEqual(store.project.scenario.levers, [L_HEAD, { ...L_GRADE, who: { grade: '8' } }]);
  assert.equal(store.undoOutcome.scenarioLevers, 2);
  store.undo();
  assert.equal(store.project.scenario.levers.length, 4, 'undo brings them back');

  const kind = describeDayTypeKind(base, { dayTypeId: B, own: false, sameAs: A });
  assert.equal(kind.scenarioLevers, 2);
  assert.equal(kind.losesData, true);
  const same = storeOf(base);
  same.apply(setDayTypeKind, { dayTypeId: B, own: false, sameAs: A });
  assert.deepEqual(same.project.scenario.levers, [L_HEAD, { ...L_GRADE, who: { grade: '8' } }]);

  const periods = describePeriodChange(base, 5);
  assert.equal(periods.scenarioLevers, 1, 'a bell on Period 7; the release that follows Periods 1 and 7 keeps Period 1 and is only trimmed (SV2-89b)');
  assert.equal(periods.losesData, true);
  assert.equal(describePeriodChange(base, 8).scenarioLevers, undefined, 'nothing lost, nothing said');
});

test('deleteDayType and setDayTypeKind leave a scenario with no levers exactly as before: no `levers` key, the same outcome keys', () => {
  const base = withChanges([move(G8A, 2, 'rsample201', B)]).project;
  const info = describeDayTypeDelete(base, B);
  assert.equal('scenarioLevers' in info, false);
  assert.equal(info.scenarioChanges, 1);
  const store = storeOf(base);
  store.apply(deleteDayType, { dayTypeId: B });
  assert.equal('levers' in store.project.scenario, false);
  assert.equal(store.project.scenario.changes.length, 0);
  assert.equal('scenarioLevers' in describeDayTypeKind(base, { dayTypeId: B, own: false, sameAs: A }), false);
  assert.equal('scenarioLevers' in describePeriodChange(base, 5), false);
});

test('setScenarioFromFile: replaces the scenario whole, levers included, and its outcome counts the levers it dropped', () => {
  const store = withLevers([L_HEAD, L_SEATS]);
  const other = school();
  slot(other, G7C, A, 1).room = 'rsample204';
  assert.throws(() => store.apply(setScenarioFromFile, { project: other }), refusedWith('scenario-open'));
  store.apply(setScenarioFromFile, { project: other, fileName: 'next.json', replace: true });
  assert.equal('levers' in store.project.scenario, false, 'the file\'s scenario has none');
  assert.deepEqual(store.undoOutcome, { text: 'The scenario it replaced held 2 levers, which went with it. Undo brings them back.', leversDropped: 2 });
  store.undo();
  assert.deepEqual(store.project.scenario.levers, [L_HEAD, L_SEATS]);
  const quiet = withChanges([]);
  quiet.apply(setScenarioFromFile, { project: other, replace: true });
  assert.equal(quiet.undoOutcome, null, 'no levers dropped, nothing to say');
});

test('a scenario with levers survives the project file: written, read and validated again', () => {
  const store = withLevers([L_HEAD, L_SEATS, L_BELL, L_GRADE], [move(G7C, 1, 'rsample204')]);
  const read = readProjectFile(writeProjectFile(store.project, { images: {} }), { ids: makeIds(9), clock });
  assert.deepEqual(read.project.scenario.levers, store.project.scenario.levers);
  assert.deepEqual(validate(read.project), []);
});

// ---------------------------------------------------------------- SV2-89b: levers follow deletions as real release entries do

const L_PAIR = { kind: 'release', who: { groups: [G6C, G7C] }, seconds: 60, after: [1], dayTypeIds: null };
const L_TWO_DAYS = { kind: 'release', who: { grade: '7' }, seconds: 90, after: [1, 2], dayTypeIds: [A, B] };

test('SV2-89b item 1: a release lever on two groups loses a deleted group, and Apply then writes a valid project', () => {
  const store = withLevers([L_PAIR]);
  store.apply(deleteGroup, { id: G6C });
  assert.deepEqual(store.project.scenario.levers[0].who, { groups: [G7C] }, 'deleteGroup trims the lever as it trims a real entry');
  store.apply(applyScenario, {});
  assert.deepEqual(validate(store.project), [], 'validate holds after Apply');
  assert.deepEqual(releaseOf(store.project).map((entry) => entry.who), [{ groups: [G7C] }]);
});

test('SV2-89b item 1: a release lever on one group goes with the group; a lever Apply meets with a stale id is trimmed the same way as reconcile shows it', () => {
  const store = withLevers([{ ...L_PAIR, who: { groups: [G6C] } }]);
  store.apply(deleteGroup, { id: G6C });
  assert.deepEqual(store.project.scenario.levers, [], 'nothing left, so the lever is dropped');
  // a lever left stale some other way (a file, an older tool): reconcile trims it, so the lane and Apply see one lever
  const stale = clone(withLevers([L_PAIR]).project);
  stale.groups = stale.groups.filter((group) => group.id !== G6C);
  const kept = reconcile(stale, stale.scenario);
  assert.deepEqual(kept.levers[0].who, { groups: [G7C] });
  assert.equal(kept.droppedLevers.length, 0);
  const applied = storeOf(stale);
  applied.apply(applyScenario, {});
  assert.deepEqual(validate(applied.project), []);
});

test('SV2-89b item 1: deleteDayType and setDayTypeKind trim a lever\'s day types, dropping it only when none is left; validate holds after Apply', () => {
  for (const act of ['delete', 'same']) {
    const store = withLevers([L_TWO_DAYS]);
    if (act === 'delete') store.apply(deleteDayType, { dayTypeId: B });
    else store.apply(setDayTypeKind, { dayTypeId: B, own: false, sameAs: A });
    assert.deepEqual(store.project.scenario.levers[0].dayTypeIds, [A], act);
    store.apply(applyScenario, {});
    assert.deepEqual(validate(store.project), [], act);
  }
  const only = withLevers([{ ...L_TWO_DAYS, dayTypeIds: [B] }]);
  only.apply(deleteDayType, { dayTypeId: B });
  assert.deepEqual(only.project.scenario.levers, []);
});

test('SV2-89b item 2: a multi-day release lever loses only the deleted day type, and the outcome counts it as changed, not removed', () => {
  const base = withLevers([L_TWO_DAYS, { ...L_BELL, dayTypeId: B }]).project;
  const info = describeDayTypeDelete(base, B);
  assert.equal(info.scenarioLevers, 2);
  assert.equal(info.scenarioLeversRemoved, 1, 'only the bell lever goes whole');
  assert.match(info.text, /1 lever in the scenario and 1 lever in the scenario changed/);
  const store = storeOf(base);
  store.apply(deleteDayType, { dayTypeId: B });
  assert.deepEqual(store.project.scenario.levers, [{ ...L_TWO_DAYS, dayTypeIds: [A] }]);
  assert.equal(store.undoOutcome.scenarioLevers, 2);
  assert.equal(store.undoOutcome.scenarioLeversRemoved, 1);
  const kind = describeDayTypeKind(base, { dayTypeId: B, own: false, sameAs: A });
  assert.equal(kind.scenarioLevers, 2);
  assert.equal(kind.scenarioLeversRemoved, 1);
});

test('SV2-89b item 3: describePeriodChange counts a release lever lost only when every period it follows is past the new end, and Apply writes none past the end', () => {
  const lever = { kind: 'release', who: { grade: '7' }, seconds: 90, after: [1, 6], dayTypeIds: null };
  const base = withLevers([lever]).project;
  assert.equal(describePeriodChange(base, 5).scenarioLevers, undefined, 'Period 1 is still there, so the lever is kept (trimmed)');
  assert.equal(describePeriodChange(withLevers([{ ...lever, after: [6, 7] }]).project, 5).scenarioLevers, 1, 'every period it follows is gone');
  const store = storeOf(base);
  store.apply(setPeriods, { periods: 5 });
  assert.deepEqual(reconcile(store.project, store.project.scenario).levers[0].after, [1], 'reconcile trims what is past the end');
  store.apply(applyScenario, {});
  assert.deepEqual(releaseOf(store.project).map((entry) => entry.after), [[1]], 'Apply never writes an after past the day\'s end');
  assert.deepEqual(validate(store.project), []);
  const lost = storeOf(withLevers([{ ...lever, after: [6, 7] }]).project);
  lost.apply(setPeriods, { periods: 5 });
  assert.equal(reconcile(lost.project, lost.project.scenario).droppedLevers.length, 1, 'reconcile drops it, as the count says');
});

// ================================================================ SV2-90: the building levers in Apply

const STAIRS_A = 'csample00a';
const STAIRS_B = 'csample00b';
const way = (connectionId, how) => ({ kind: 'way', connectionId, way: how });

// A store whose scenario already holds building levers: addScenarioLever takes
// the four schedule kinds only, so these arrive as a project file brings them.
function withBuildingLevers(levers, changes) {
  const project = school();
  const corridor = project.building.floors[0].corridors.find((entry) => entry.id === 'ksample001');
  const given = levers.map((lever) => (lever === 'corridor' ? { kind: 'corridor', floorId: 'fsample001', cells: corridor.cells.slice(0, 3), name: 'Main Corridor' } : lever));
  return storeOf({ ...project, scenario: { name: 'Trial', changes: changes || [], levers: given, compared: null } });
}

test('applyScenario: a way of ab, ba or both is written to the connection\'s direction, in the one step, and bumps GEOMETRY', () => {
  const store = withBuildingLevers([way(STAIRS_A, 'ab'), way(STAIRS_B, 'ba')]);
  const before = store.project;
  const counts = { ...counters(store) };
  assert.deepEqual(applyScenario.bumps(before), [SCHEDULE, actions.GEOMETRY]);
  assert.equal(applyScenario.label(before), 'Apply scenario Trial: 0 changes and 2 levers');
  const entries = store.history.past.length;

  store.apply(applyScenario, {});
  const after = store.project;
  assert.equal(store.history.past.length, entries + 1, 'one undo step');
  assert.equal(after.scenario, null);
  assert.deepEqual(after.building.connections.map((connection) => [connection.id, connection.direction]), [[STAIRS_A, 'ab'], [STAIRS_B, 'ba']]);
  assert.equal(store.geometryVersion, counts.geometry + 1, 'the routes move');
  assert.equal(store.scheduleVersion, counts.schedule + 1);
  assert.equal(validate(after).length, 0);
  assert.deepEqual(store.undoOutcome, { text: 'Applied scenario Trial: 0 changes and 2 stairs directions', changes: 0, levers: 2, byKind: { way: 2 } });

  store.undo();
  assert.equal(store.project.scenario, before.scenario, 'undo brings the scenario back whole');
  assert.equal(store.project.building, before.building, 'and the building as it was');
  assert.deepEqual(store.project.building.connections.map((connection) => connection.direction), ['both', 'both']);
  store.redo();
  assert.equal(store.project.building.connections[0].direction, 'ab');
});

test('applyScenario: a way back to both is written too, where the connection is one-way', () => {
  const project = school();
  project.building.connections[0].direction = 'ab';
  const store = storeOf({ ...project, scenario: { name: 'Trial', changes: [], levers: [way(STAIRS_A, 'both')], compared: null } });
  assert.deepEqual(applyScenario.bumps(store.project), [SCHEDULE, actions.GEOMETRY]);
  store.apply(applyScenario, {});
  assert.equal(store.project.building.connections[0].direction, 'both');
});

test('applyScenario: a closed stairs and a closed corridor are a trial only: left out, the outcome says which, and no counter of the building moves', () => {
  const store = withBuildingLevers([way(STAIRS_B, 'closed'), 'corridor'], [move(G7C, 1, 'rsample204')]);
  const before = store.project;
  const counts = { ...counters(store) };
  assert.deepEqual(applyScenario.bumps(before), [SCHEDULE], 'nothing of the building is written');
  assert.equal(applyScenario.label(before), 'Apply scenario Trial: 1 change');
  store.apply(applyScenario, {});
  const after = store.project;
  assert.equal(after.building, before.building, 'the building is the very same object');
  assert.equal(after.scenario, null, 'the scenario closes as it always does, and the closures go with it');
  assert.equal(slot(after, G7C, A, 1).room, 'rsample204', 'the change went in');
  assert.equal(store.geometryVersion, counts.geometry);
  assert.equal(store.buildingVersion, counts.building);
  const outcome = store.undoOutcome;
  assert.equal(outcome.leftOut, 2);
  assert.equal(outcome.leftOutText, 'Closing Stairs B and Main Corridor is a trial: Apply leaves the building as it is.');
  assert.equal(outcome.text, 'Applied scenario Trial: 1 change. Closing Stairs B and Main Corridor is a trial: Apply leaves the building as it is.');
  assert.equal(outcome.levers, 0);
  store.undo();
  assert.equal(store.project.scenario, before.scenario, 'Undo brings the scenario back whole, closures and all');
});

test('applyScenario: ways and closures together — the ways go in, the closures stay out and are named', () => {
  const store = withBuildingLevers([way(STAIRS_A, 'ba'), way(STAIRS_B, 'closed')], []);
  const counts = { ...counters(store) };
  store.apply(applyScenario, {});
  assert.deepEqual(store.project.building.connections.map((connection) => connection.direction), ['ba', 'both'], 'Stairs B is not closed, and not made anything');
  assert.equal(store.geometryVersion, counts.geometry + 1);
  assert.match(store.undoOutcome.text, /1 stairs direction\. Closing Stairs B is a trial/);
  assert.deepEqual(store.undoOutcome.byKind, { way: 1 });
  assert.equal(store.undoOutcome.leftOut, 1);
});

test('applyScenario: a way the building already has, or one whose stairs are gone, is not written (reconcile drops it first)', () => {
  const store = withBuildingLevers([way(STAIRS_A, 'both'), way('cgone00000', 'ab')]);
  assert.deepEqual(applyScenario.bumps(store.project), [SCHEDULE], 'nothing to write, so no geometry bump');
  const counts = { ...counters(store) };
  store.apply(applyScenario, {});
  assert.equal(store.geometryVersion, counts.geometry);
  assert.deepEqual(store.undoOutcome, { text: 'Applied scenario Trial: 0 changes', changes: 0, levers: 0, byKind: {} });
});

test('applyScenario: a stairs name that is markup is named exactly as typed in what was left out', () => {
  const project = school();
  project.building.connections[1].label = '<b>B & "C"</b>';
  const store = storeOf({ ...project, scenario: { name: 'Trial', changes: [], levers: [way(STAIRS_B, 'closed')], compared: null } });
  store.apply(applyScenario, {});
  assert.equal(store.undoOutcome.leftOutText, 'Closing Stairs <b>B & "C"</b> is a trial: Apply leaves the building as it is.');
});
