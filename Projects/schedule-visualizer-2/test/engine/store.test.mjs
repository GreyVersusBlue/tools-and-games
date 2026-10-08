import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../engine/store.js';
import * as actions from '../../engine/actions.js';
import { validate } from '../../engine/validate.js';
import { emptyProject, school, clock, tickingClock, makeIds, group, PINNED } from './helpers.mjs';

function sampleStore(options) {
  return createStore({ project: school(), clock: tickingClock(), ids: makeIds(3), ...options });
}

const SLOT = { groupId: 'gsample06a', dayTypeId: 'dsample00a', period: 0, slot: { room: 'rsample302' } };

test('createStore needs a project, a clock and an id source', () => {
  assert.throws(() => createStore({ project: school(), clock }), TypeError);
  assert.throws(() => createStore({ clock, ids: makeIds() }), TypeError);
});

test('a new store holds the project it was given, untouched, with nothing to undo', () => {
  const project = school();
  const store = createStore({ project, clock, ids: makeIds() });
  assert.equal(store.project, project);
  assert.deepEqual([store.canUndo, store.canRedo, store.undoLabel, store.redoLabel], [false, false, null, null]);
  assert.deepEqual([store.geometryVersion, store.buildingVersion, store.scheduleVersion, store.version], [0, 0, 0, 0]);
  assert.equal(store.undo(), null);
  assert.equal(store.redo(), null);
});

test('apply runs the action, makes one undo entry and sets modified from the clock', () => {
  const store = sampleStore();
  const before = store.project;
  const after = store.apply(actions.setSlot, SLOT);
  assert.equal(store.project, after);
  assert.equal(group(after, '6A').days.dsample00a[0].room, 'rsample302');
  assert.equal(after.modified, '2026-09-01T12:00:01.000Z');
  assert.equal(before.modified, PINNED, 'the old state is not touched');
  assert.equal(after.created, PINNED);
  assert.equal(store.history.past.length, 1);
  assert.equal(store.undoLabel, 'Change 6A in Period 1 on A Day');
  assert.deepEqual(validate(after), []);
});

test('an entry is { label, before, after, focus, bumps, outcome }', () => {
  const store = sampleStore();
  const before = store.project;
  store.apply(actions.setSlot, SLOT);
  const entry = store.history.past[0];
  assert.deepEqual(Object.keys(entry), ['label', 'before', 'after', 'focus', 'bumps', 'outcome']);
  assert.equal(entry.outcome, null, 'a slot edit reports nothing');
  assert.equal(entry.before, before);
  assert.equal(entry.after, store.project);
  assert.deepEqual(entry.focus, { section: 'schedule', tab: 'groups', groupId: 'gsample06a', dayTypeId: 'dsample00a', period: 0 });
  assert.deepEqual(entry.bumps, ['schedule']);
});

test('undo and redo return { label, focus } and move the project back and forth', () => {
  const store = sampleStore();
  store.apply(actions.setSlot, SLOT);
  const undone = store.undo();
  assert.deepEqual(undone, { label: 'Change 6A in Period 1 on A Day', focus: { section: 'schedule', tab: 'groups', groupId: 'gsample06a', dayTypeId: 'dsample00a', period: 0 } });
  assert.equal(group(store.project, '6A').days.dsample00a[0].room, 'rsample201');
  assert.deepEqual([store.canUndo, store.canRedo, store.redoLabel], [false, true, 'Change 6A in Period 1 on A Day']);
  const redone = store.redo();
  assert.deepEqual(redone, undone);
  assert.equal(group(store.project, '6A').days.dsample00a[0].room, 'rsample302');
  assert.deepEqual([store.canUndo, store.canRedo], [true, false]);
});

test('undo and redo set modified from the clock too, so a save follows', () => {
  const store = sampleStore();
  store.apply(actions.setSlot, SLOT);
  store.undo();
  assert.equal(store.project.modified, '2026-09-01T12:00:02.000Z');
  store.redo();
  assert.equal(store.project.modified, '2026-09-01T12:00:03.000Z');
});

test('undo gives back the same branches, not copies', () => {
  const store = sampleStore();
  const before = store.project;
  store.apply(actions.setSlot, SLOT);
  store.undo();
  assert.equal(store.project.groups, before.groups);
  assert.equal(store.project.building, before.building);
});

test('an action that changes nothing makes no entry and moves no counter', () => {
  const store = sampleStore();
  let calls = 0;
  store.subscribe(() => { calls += 1; });
  const same = store.apply(actions.setSetting, { key: 'secondsPerCell', value: 3 });
  assert.equal(same, store.project);
  assert.equal(store.history.past.length, 0);
  assert.equal(store.version, 0);
  assert.equal(store.project.modified, PINNED);
  assert.equal(calls, 0);
});

test('a refused action throws its ActionError and changes nothing', () => {
  const store = sampleStore();
  const before = store.project;
  assert.throws(() => store.apply(actions.addGroup, { name: '6a' }), { name: 'ActionError', code: 'duplicate-name' });
  assert.equal(store.project, before);
  assert.equal(store.canUndo, false);
  assert.equal(store.version, 0);
});

test('a new action after an undo clears redo', () => {
  const store = sampleStore();
  store.apply(actions.setSlot, SLOT);
  store.undo();
  store.apply(actions.addGroup, { name: '8C' });
  assert.equal(store.canRedo, false);
  assert.equal(store.redo(), null);
});

test('the counters: a group action moves scheduleVersion only', () => {
  const store = sampleStore();
  store.apply(actions.setSlot, SLOT);
  assert.deepEqual([store.geometryVersion, store.buildingVersion, store.scheduleVersion], [0, 0, 1]);
});

test('the counters: renaming a floor moves buildingVersion only, so no route is thrown away', () => {
  const store = sampleStore();
  store.apply(actions.renameFloor, { id: 'fsample001', name: 'Ground' });
  store.apply(actions.reorderFloor, { id: 'fsample003', toIndex: 0 });
  assert.deepEqual([store.geometryVersion, store.buildingVersion, store.scheduleVersion], [0, 2, 0]);
});

test('the counters: a geometry change moves geometryVersion and buildingVersion together', () => {
  const store = sampleStore();
  store.apply(actions.setFloorLevel, { id: 'fsample001', level: 0 });
  assert.deepEqual([store.geometryVersion, store.buildingVersion, store.scheduleVersion], [1, 1, 0]);
  store.apply(actions.deleteFloor, { id: 'fsample003' });
  assert.deepEqual([store.geometryVersion, store.buildingVersion, store.scheduleVersion], [2, 2, 1]);
});

test('the counters: a display setting moves none of the three, and still counts as a change', () => {
  const store = sampleStore();
  store.apply(actions.setSetting, { key: 'theme', value: 'dark' });
  assert.deepEqual([store.geometryVersion, store.buildingVersion, store.scheduleVersion, store.version], [0, 0, 0, 1]);
  assert.equal(store.undoLabel, 'Change the theme', 'settings changes are undo entries too');
});

test('the counters: undo and redo move the same counters the action did', () => {
  const store = sampleStore();
  store.apply(actions.setFloorLevel, { id: 'fsample001', level: 0 });
  store.undo();
  assert.deepEqual([store.geometryVersion, store.buildingVersion, store.scheduleVersion, store.version], [2, 2, 0, 2]);
  store.redo();
  assert.deepEqual([store.geometryVersion, store.buildingVersion, store.scheduleVersion, store.version], [3, 3, 0, 3]);
});

test('subscribe is told of every change, with what kind it was, and can unsubscribe', () => {
  const store = sampleStore();
  const seen = [];
  const stop = store.subscribe((project, change) => seen.push([change.kind, change.label, change.bumps, project === store.project]));
  store.apply(actions.addGroup, { name: '8C' });
  store.undo();
  store.redo();
  stop();
  store.undo();
  assert.deepEqual(seen, [['apply', 'Add group 8C', ['schedule'], true], ['undo', 'Add group 8C', ['schedule'], true], ['redo', 'Add group 8C', ['schedule'], true]]);
});

test('the history is capped at 200 entries: 205 changes leave 200 undos', () => {
  const store = createStore({ project: emptyProject(), clock, ids: makeIds() });
  for (let n = 1; n <= 205; n += 1) store.apply(actions.setSetting, { key: 'schoolName', value: 'School ' + n });
  assert.equal(store.history.past.length, 200);
  let undone = 0;
  while (store.undo()) undone += 1;
  assert.equal(undone, 200);
  assert.equal(store.project.settings.schoolName, 'School 5', 'the first five changes can no longer be undone');
});

test('periods from 8 to 6: the removed periods stay in the undo entry and undo brings them back', () => {
  const store = sampleStore();
  const before = store.project;
  const report = actions.describePeriodChange(store.project, 6);
  assert.equal(report.slots, 32);
  store.apply(actions.setPeriods, { periods: 6 });
  assert.equal(group(store.project, '8A').days.dsample00a.length, 6);
  const entry = store.history.past[0];
  assert.equal(entry.label, 'Change periods per day to 6');
  assert.equal(entry.before, before, 'the entry holds the project as it was');
  assert.equal(entry.before.settings.periods, 8);
  assert.equal(group(entry.before, '8A').days.dsample00a.length, 8);
  assert.equal(group(entry.before, '8A').days.dsample00a[6].room, 'rsample303', 'Period 7, with its room');
  assert.deepEqual(entry.before.dayTypes[0].bells[7], { start: '14:04', end: '14:52' });
  assert.equal(group(entry.after, '8A').days.dsample00a.length, 6);
  store.undo();
  assert.equal(store.project.settings.periods, 8);
  assert.equal(group(store.project, '8A').days.dsample00a[6].room, 'rsample303');
  assert.equal(store.project.groups, before.groups);
  assert.equal(store.project.dayTypes, before.dayTypes);
  assert.deepEqual(validate(store.project), []);
});

test('a state costs only the branch that changed: 200 slot edits share the building throughout', () => {
  const store = sampleStore();
  const building = store.project.building;
  for (let n = 0; n < 200; n += 1) store.apply(actions.setSlot, { ...SLOT, slot: { label: 'Take ' + n } });
  assert.ok(store.history.past.every((entry) => entry.before.building === building && entry.after.building === building));
});

test('ids the project already uses are never handed out by the store\'s actions', () => {
  const ids = makeIds(11);
  const first = makeIds(11)('g');
  const project = school();
  project.groups[0].id = first;
  const store = createStore({ project, clock, ids });
  store.apply(actions.addGroup, { name: '8C' });
  assert.notEqual(store.project.groups[8].id, first);
  assert.deepEqual(validate(store.project), []);
});

test('replace loads another project: history starts again, every counter moves, modified is left alone', () => {
  const store = sampleStore();
  store.apply(actions.addGroup, { name: '8C' });
  const loaded = emptyProject();
  const kinds = [];
  store.subscribe((project, change) => kinds.push(change.kind));
  store.replace(loaded);
  assert.equal(store.project, loaded);
  assert.equal(store.project.modified, PINNED);
  assert.deepEqual([store.canUndo, store.canRedo], [false, false]);
  assert.deepEqual([store.geometryVersion, store.buildingVersion, store.scheduleVersion], [1, 1, 2]);
  assert.deepEqual(kinds, ['replace']);
});

test('replaceProject as an action is one undo step: load the sample school, undo, and the empty project is back', () => {
  const empty = emptyProject();
  const store = createStore({ project: empty, clock, ids: makeIds() });
  store.apply(actions.replaceProject, { project: school(), label: 'Load the sample school' });
  assert.equal(store.project.groups.length, 8);
  assert.deepEqual(store.undo().label, 'Load the sample school');
  assert.equal(store.project.groups.length, 0);
  assert.equal(store.project.building, empty.building);
});

test('derived values are recomputed only when a counter they name has moved', () => {
  const store = sampleStore();
  let runs = 0;
  const rooms = () => store.derived.get('room-count', ['geometry'], (project) => {
    runs += 1;
    return project.building.floors.reduce((sum, floor) => sum + floor.spaces.length, 0);
  });
  assert.equal(rooms(), 23);
  assert.equal(rooms(), 23);
  assert.equal(runs, 1);
  store.apply(actions.setSlot, SLOT);
  store.apply(actions.renameFloor, { id: 'fsample001', name: 'Ground' });
  rooms();
  assert.equal(runs, 1, 'a schedule change and a rename leave a geometry-keyed value alone');
  store.apply(actions.deleteFloor, { id: 'fsample003' });
  assert.equal(rooms(), 17);
  assert.equal(runs, 2);
  store.undo();
  assert.equal(rooms(), 23);
  assert.equal(runs, 3);
});

// ---------------------------------------------------------------- SV2-35

test('replaceProject as an action reserves the loaded project\'s ids, as replace does', () => {
  const next = makeIds(11)('g'); // the id the store's source would hand out for the next group
  const loaded = school();
  loaded.groups[0].id = next;
  const store = createStore({ project: emptyProject(), clock, ids: makeIds(11) });
  store.apply(actions.replaceProject, { project: loaded, label: 'Load the sample school' });
  store.apply(actions.addGroup, { name: '8C' });
  assert.notEqual(store.project.groups[8].id, next, 'the new group was handed an id a loaded group already has');
  assert.deepEqual(validate(store.project), []);
});

test('a quiet action changes the project, makes no undo entry and leaves modified alone', () => {
  const store = sampleStore();
  const changes = [];
  store.subscribe((project, change) => changes.push(change));
  const before = store.project;
  store.apply(actions.setOnboarding, { dismissed: true });
  assert.equal(store.project.onboarding.dismissed, true);
  assert.equal(store.history.past.length, 0, 'no undo entry');
  assert.deepEqual([store.canUndo, store.undoLabel], [false, null]);
  assert.equal(store.project.modified, before.modified, 'modified is not stamped');
  assert.deepEqual(changes, [{ kind: 'apply', label: 'Change getting started', focus: null, bumps: [], quiet: true }], 'subscribers still hear of it, so it is saved');
  assert.equal(store.version, 1);
  assert.equal(store.apply(actions.setOnboarding, { dismissed: true }), store.project, 'and the same again changes nothing');
  assert.equal(changes.length, 1);
});

test('a quiet action is not taken back by undo or redo: the states in the history get it too', () => {
  const store = sampleStore();
  store.apply(actions.setSlot, SLOT);
  store.apply(actions.addGroup, { name: '8C' });
  store.undo();
  // one entry to undo, one to redo; now the card is dismissed
  store.apply(actions.setOnboarding, { dismissed: true });
  assert.deepEqual([store.canUndo, store.canRedo], [true, true], 'a quiet action does not clear redo');
  store.redo();
  assert.equal(store.project.groups.length, 9);
  assert.equal(store.project.onboarding.dismissed, true, 'redo did not bring the card back');
  store.undo();
  store.undo();
  assert.equal(group(store.project, '6A').days.dsample00a[0].room, 'rsample201', 'the slot edit is undone');
  assert.equal(store.project.onboarding.dismissed, true, 'undo did not bring the card back');
  assert.equal(store.history.future[1].before.building, store.history.future[1].after.building, 'and the states still share what they shared');
});

test('the history entry keeps what a building action reported, so nobody runs the action twice to ask', () => {
  const store = sampleStore();
  assert.equal(store.undoOutcome, null);
  store.apply(actions.placeRoom, { floorId: 'fsample003', rect: { x: 1, y: 9, w: 3, h: 3 } });
  const outcome = store.undoOutcome;
  assert.equal(outcome, store.history.past[0].outcome);
  const placed = store.project.building.floors[2].spaces.find((space) => space.id === outcome.spaceId);
  assert.ok(placed, 'the outcome names the room that is in the store');
  assert.equal(outcome.cells.length, 9);
  store.apply(actions.renameFloor, { id: 'fsample001', name: 'Ground' });
  assert.equal(store.undoOutcome, null, 'an action that reports nothing has none');
});
