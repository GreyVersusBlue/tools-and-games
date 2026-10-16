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
import { writeProjectFile, readProjectFile } from '../../engine/project-file.js';
import { school, clone, clock, makeIds, assertValid } from './helpers.mjs';

const { newScenario, renameScenario, addScenarioChange, removeScenarioChange, discardScenario, setScenarioFromFile, applyScenario, setSlot, deleteGroup, revertToBase, ActionError, SCHEDULE, NEW_SCENARIO_NAME } = actions;

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
  assert.deepEqual(applyScenario.bumps, [SCHEDULE]);

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

test('addScenarioChange: "move 7C to 204 and back" leaves nothing, labelled as putting the change back; a change that changes nothing is no step', () => {
  const store = withChanges([move(G7C, 1, 'rsample204')]);
  store.apply(addScenarioChange, { change: move(G7C, 1, 'rsample203') });
  assert.deepEqual(store.project.scenario.changes, []);
  assert.equal(store.undoLabel, 'Put back in scenario Trial: 7C · A Day · Period 2: 203 → 204, taught by Mme. Dufrêne instead of Ms. Vandermeer');
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
