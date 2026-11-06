import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory, record, undo, redo, canUndo, canRedo, peekUndo, peekRedo, HISTORY_LIMIT } from '../../engine/history.js';
import * as actions from '../../engine/actions.js';
import { createStore } from '../../engine/store.js';
import { validate } from '../../engine/validate.js';
import { school, clock, makeIds } from './helpers.mjs';

const entry = (n) => ({ label: 'Step ' + n, before: { n: n - 1 }, after: { n }, focus: null, bumps: [] });

test('the limit is 200 entries', () => {
  assert.equal(HISTORY_LIMIT, 200);
});

test('a new history has nothing to undo or redo', () => {
  const history = createHistory();
  assert.deepEqual(history, { past: [], future: [] });
  assert.equal(canUndo(history), false);
  assert.equal(canRedo(history), false);
  assert.equal(undo(history), null);
  assert.equal(redo(history), null);
  assert.equal(peekUndo(history), null);
  assert.equal(peekRedo(history), null);
});

test('undo gives back the newest entry and moves it to the redo side', () => {
  let history = record(record(createHistory(), entry(1)), entry(2));
  const step = undo(history);
  assert.equal(step.entry.label, 'Step 2');
  assert.deepEqual(step.entry.before, { n: 1 });
  history = step.history;
  assert.deepEqual(history.past.map((e) => e.label), ['Step 1']);
  assert.deepEqual(history.future.map((e) => e.label), ['Step 2']);
  assert.equal(peekUndo(history).label, 'Step 1');
  assert.equal(peekRedo(history).label, 'Step 2');
});

test('redo brings the entries back in the order they were undone', () => {
  let history = createHistory();
  for (let n = 1; n <= 3; n += 1) history = record(history, entry(n));
  history = undo(undo(history).history).history;
  const first = redo(history);
  assert.equal(first.entry.label, 'Step 2');
  const second = redo(first.history);
  assert.equal(second.entry.label, 'Step 3');
  assert.equal(redo(second.history), null);
  assert.deepEqual(second.history.past.map((e) => e.label), ['Step 1', 'Step 2', 'Step 3']);
});

test('a new entry after an undo clears what could have been redone', () => {
  let history = record(record(createHistory(), entry(1)), entry(2));
  history = undo(history).history;
  history = record(history, entry(9));
  assert.equal(canRedo(history), false);
  assert.deepEqual(history.past.map((e) => e.label), ['Step 1', 'Step 9']);
});

test('the cap: after 250 entries the newest 200 are kept and the oldest 50 are gone', () => {
  let history = createHistory();
  for (let n = 1; n <= 250; n += 1) history = record(history, entry(n));
  assert.equal(history.past.length, 200);
  assert.equal(history.past[0].label, 'Step 51');
  assert.equal(history.past[199].label, 'Step 250');
  let undone = 0;
  while (canUndo(history)) {
    history = undo(history).history;
    undone += 1;
  }
  assert.equal(undone, 200);
});

test('exactly 200 entries are all kept; the 201st pushes out the first', () => {
  let history = createHistory();
  for (let n = 1; n <= 200; n += 1) history = record(history, entry(n));
  assert.equal(history.past[0].label, 'Step 1');
  history = record(history, entry(201));
  assert.equal(history.past.length, 200);
  assert.equal(history.past[0].label, 'Step 2');
});

test('a smaller limit can be asked for', () => {
  let history = createHistory();
  for (let n = 1; n <= 5; n += 1) history = record(history, entry(n), 3);
  assert.deepEqual(history.past.map((e) => e.label), ['Step 3', 'Step 4', 'Step 5']);
});

test('no function changes the history it is given', () => {
  const history = record(record(createHistory(), entry(1)), entry(2));
  const frozen = Object.freeze({ past: Object.freeze(history.past.slice()), future: Object.freeze([]) });
  const afterUndo = undo(frozen);
  record(frozen, entry(3));
  redo(afterUndo.history);
  assert.equal(frozen.past.length, 2);
  assert.equal(frozen.future.length, 0);
});

// ---------------------------------------------------------------- the step-free actions through the store (SV2-97)

test('every step-free action is one undo step, the project stays valid after each, and undoing them all gives the first project back byte for byte', () => {
  const store = createStore({ project: school(), clock, ids: makeIds(9) });
  const bare = (project) => JSON.stringify({ ...project, modified: null });
  const first = bare(store.project);
  const [one, two, three] = store.project.building.floors.map((floor) => floor.id);
  const stop = (floorId, cell) => ({ floorId, cell });
  const corridorCell = store.project.building.floors[0].corridors[0].cells[0];
  const roomWithDoor = store.project.building.floors[0].spaces.find((space) => space.kind === 'room' && space.doors.length > 0);
  const exit = store.project.building.floors[0].exits[0];
  const steps = [
    ['placeLift', { floorId: one, cells: [0] }],
    ['placeLift', { floorId: two, cells: [0] }],
    ['placeLift', { floorId: three, cells: [0] }],
    ['connectStairs', { a: stop(one, 0), b: stop(two, 0), id: 'celevator1' }],
    ['connectStairs', { a: stop(two, 0), b: stop(three, 0), id: 'celevator2' }],
    ['setElevator', { carId: 'celevator1', staffOnly: false }],
    ['setDoorStepFree', { roomId: roomWithDoor.id, door: { cell: roomWithDoor.doors[0].cell, side: roomWithDoor.doors[0].side }, stepFree: false }],
    ['setExitStepFree', { exitId: exit.id, stepFree: false }],
    ['setStepCells', { floorId: one, cells: [corridorCell], stepFree: false }],
    ['addRefuge', { floorId: one, cell: corridorCell, name: 'North stair' }],
    ['setRefuge', { refugeId: null, name: 'North landing' }],
    ['setSetting', { key: 'elevatorWaitSeconds', value: 20 }],
    ['setSetting', { key: 'elevatorSecondsPerFloor', value: 5 }],
    ['setSetting', { key: 'elevatorPeoplePerTrip', value: 10 }],
    ['addGroup', { name: 'Step-free group', stepFree: true }],
    ['editGroup', { id: null, stepFree: false }],
    ['resizeFloor', { floorId: one, left: 1 }],
    ['removeRefuge', { refugeId: null }],
    ['disconnectStairs', { connectionId: 'celevator2' }],
    ['placeStairs', { floorId: two, cells: [1 + 0] }],
    ['deleteFloor', { id: three }],
  ];
  const states = [first];
  for (const [name, payload] of steps) {
    if (name === 'setRefuge' || name === 'removeRefuge') payload.refugeId = store.project.building.floors[0].refuges[0].id;
    if (name === 'editGroup') payload.id = store.project.groups[store.project.groups.length - 1].id;
    const before = store.history.past.length;
    store.apply(actions[name], payload);
    assert.equal(store.history.past.length, before + 1, name + ' is one undo step');
    const problems = validate(store.project);
    assert.deepEqual(problems, [], name + ' leaves a valid project: ' + JSON.stringify(problems));
    states.push(bare(store.project));
  }
  assert.equal(new Set(states).size, states.length, 'every step changed the project');
  for (let n = steps.length - 1; n >= 0; n -= 1) {
    store.undo();
    assert.equal(bare(store.project), states[n], 'undoing ' + steps[n][0] + ' gives back the project before it');
  }
  for (let n = 1; n <= steps.length; n += 1) {
    store.redo();
    assert.equal(bare(store.project), states[n], 'redoing ' + steps[n - 1][0] + ' gives its result back');
  }
});
