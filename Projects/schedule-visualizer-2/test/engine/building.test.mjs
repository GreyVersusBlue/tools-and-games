// The building engine: engine/building.js through the actions that wrap it.
// Every action runs on a deep-frozen project and its result goes through
// validate(), so no case here can pass by producing a project the rest of the
// tool would reject.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as actions from '../../engine/actions.js';
import * as building from '../../engine/building.js';
import { createStore } from '../../engine/store.js';
import { validate } from '../../engine/validate.js';
import { findRoom, nextConnectionLabel, elevatorCars as schemaCars } from '../../engine/schema.js';
import { emptyProject, school, ctx, clock, makeIds, room, group, teacher, assertValid } from './helpers.mjs';
import { planProject, twoRooms, threeFloors, cellAt, floorId, roomId } from '../fixtures/buildings/plans.mjs';

const { ActionError, GEOMETRY, BUILDING, SCHEDULE } = actions;

function freeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

const shared = ctx();

function run(action, project, payload) {
  const before = freeze(project);
  const after = action(before, payload === undefined ? {} : payload, shared);
  assertValid(after, 'the project is still valid after the action');
  return after;
}

function refused(action, project, payload, code, pattern) {
  assert.throws(() => action(freeze(project), payload, ctx()), (error) => {
    assert.ok(error instanceof ActionError, 'an ActionError, not ' + error);
    assert.equal(error.code, code);
    assert.match(error.message, /\.$/, 'the message is a sentence');
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

function info(action, before, payload, after) {
  return actions.describeAction(action, before, payload, after);
}

function floor(project, number) {
  return project.building.floors[number - 1];
}

function rect(project, number, x, y, w, h) {
  return building.rectCells(floor(project, number), x, y, w, h);
}

const F1 = floorId(1);

// Counted here the long way, apart from the engine's own count.
function slotsNaming(project, id) {
  let slots = 0;
  const groups = new Set();
  for (const candidate of project.groups) {
    for (const day of Object.values(candidate.days)) {
      for (const slot of day) {
        if (slot.room === id) {
          slots += 1;
          groups.add(candidate.id);
        }
      }
    }
  }
  return { slots, groups: groups.size };
}

// ---------------------------------------------------------------- place

test('a room placed with one click is one cell, unnumbered, and is what the outcome names', () => {
  const before = emptyProject();
  const id = before.building.floors[0].id;
  const after = run(actions.placeRoom, before, { floorId: id, cells: [45] });
  const outcome = actions.buildingOutcome(after);
  const placed = findRoom(after, outcome.spaceId);
  assert.deepEqual(placed.cells, [45]);
  assert.equal(placed.number, '');
  assert.deepEqual(placed.doors, []);
  assert.equal(info(actions.placeRoom, before, { floorId: id, cells: [45] }, after).label, 'Place a room on Floor 1');
  assert.deepEqual(info(actions.placeRoom, before, {}, after).bumps, [GEOMETRY]);
  assert.deepEqual(info(actions.placeRoom, before, { floorId: id }, after).focus, { section: 'building', floorId: id, roomId: placed.id });
});

test('a room dragged as a rectangle owns every cell of it, in order', () => {
  const before = emptyProject();
  const id = before.building.floors[0].id;
  const after = run(actions.placeRoom, before, { floorId: id, rect: { x: 2, y: 1, w: 3, h: 2 }, id: 'rtest00001', number: '204' });
  assert.deepEqual(findRoom(after, 'rtest00001').cells, [42, 43, 44, 82, 83, 84]);
  assert.equal(findRoom(after, 'rtest00001').number, '204');
});

test('placing a room over a room and a corridor replaces them and the label says what it replaced', () => {
  const before = twoRooms();
  // columns 3 to 5, rows 1 to 2: two cells of room 1A (one with a door), three corridor cells
  const payload = { floorId: F1, rect: { x: 3, y: 1, w: 3, h: 2 }, id: 'rtest00002' };
  const after = run(actions.placeRoom, before, payload);
  const outcome = actions.buildingOutcome(after);
  assert.deepEqual(outcome.loss.spaces, [{ id: roomId('1A'), kind: 'room', name: 'Room 1A', cells: 2, of: 8, removed: false }]);
  assert.equal(outcome.loss.corridorCells, 3);
  assert.deepEqual(outcome.loss.doors, [{ roomId: roomId('1A'), name: 'Room 1A', cell: cellAt(before, 1, 4, 1), side: 's' }], 'the door on a taken cell goes; the other still faces the corridor and stays');
  assert.deepEqual(room(after, '1A').doors, [{ cell: cellAt(before, 1, 1, 1), side: 's' }]);
  assert.equal(room(after, '1A').cells.length, 6);
  assert.equal(floor(after, 1).cells.slice(18, 27), '###...###');
  assert.equal(info(actions.placeRoom, before, payload, after).label, 'Place a room on Floor 1, replacing 2 cells of Room 1A, 3 corridor cells and 1 door');
});

test('a room placed over the whole of a scheduled room takes it out, and its slots keep the number as text', () => {
  const before = school();
  const old = room(before, '101');
  const payload = { floorId: 'fsample001', cells: old.cells.slice(), id: 'rtest00003' };
  const after = run(actions.placeRoom, before, payload);
  assert.equal(findRoom(after, 'rsample101'), null);
  const slot = group(after, '6A').days.dsample00a[2];
  assert.deepEqual({ room: slot.room, roomText: slot.roomText }, { room: null, roomText: '101' });
  assert.deepEqual(teacher(after, 'Ms. Halloran').roomIds, []);
  const told = info(actions.placeRoom, before, payload, after);
  assert.equal(told.label, 'Place a room on Floor 1, replacing Room 101');
  assert.deepEqual(told.bumps, [GEOMETRY, SCHEDULE]);
  assert.equal(actions.describePlace(before, payload).slots, slotsNaming(before, 'rsample101').slots);
  assert.ok(slotsNaming(before, 'rsample101').slots > 0);
});

test('over: "skip" places on the empty cells only, and over: "refuse" refuses and says what is in the way', () => {
  const before = twoRooms();
  const payload = { floorId: F1, rect: { x: 3, y: 1, w: 3, h: 2 }, id: 'rtest00004' };
  const skipped = run(actions.placeRoom, before, { ...payload, over: 'skip' });
  assert.deepEqual(findRoom(skipped, 'rtest00004').cells, [cellAt(before, 1, 5, 1)]);
  assert.equal(room(skipped, '1A').cells.length, 8);
  refused(actions.placeRoom, before, { ...payload, over: 'refuse' }, 'occupied', /2 cells of Room 1A, 3 corridor cells and 1 door on Floor 1/);
  refused(actions.placeRoom, before, { floorId: F1, cells: [cellAt(before, 1, 1, 0)], over: 'skip' }, 'occupied');
  refused(actions.placeRoom, before, { floorId: F1, cells: [], over: 'skip' }, 'no-cells');
  refused(actions.placeRoom, before, { floorId: F1, cells: [9999] }, 'off-floor');
  refused(actions.placeRoom, before, { floorId: 'fnowhere00', cells: [1] }, 'missing');
  refused(actions.placeRoom, before, { floorId: F1, cells: [0], number: ' 1a ' }, 'duplicate-number', /Room 1A, on Floor 1/);
});

test('an other space is placed with its label, kind and colour as given', () => {
  const before = twoRooms();
  const after = run(actions.placeOtherSpace, before, { floorId: F1, rect: { x: 6, y: 3, w: 2, h: 2 }, id: 'otest00001', label: '<b>Boiler</b>', otherKind: 'utility', colour: '#AABBCC' });
  const placed = floor(after, 1).spaces.find((space) => space.id === 'otest00001');
  assert.deepEqual({ label: placed.label, otherKind: placed.otherKind, colour: placed.colour, cells: placed.cells.length }, { label: '<b>Boiler</b>', otherKind: 'utility', colour: '#aabbcc', cells: 4 });
  assert.equal(info(actions.placeOtherSpace, before, { floorId: F1 }, after).label, 'Place other space on Floor 1');
  refused(actions.placeOtherSpace, before, { floorId: F1, cells: [0], otherKind: 'lounge' }, 'bad-value');
});

test('painting corridor changes only cells that were not corridor, and painting it again changes nothing', () => {
  const before = twoRooms();
  const cells = [cellAt(before, 1, 6, 2), cellAt(before, 1, 6, 3), cellAt(before, 1, 6, 4)];
  const after = run(actions.paintCorridor, before, { floorId: F1, cells });
  assert.deepEqual(actions.buildingOutcome(after).cells, cells.slice(1));
  assert.equal(info(actions.paintCorridor, before, { floorId: F1, cells }, after).label, 'Paint corridor on Floor 1');
  assert.equal(actions.paintCorridor(after, { floorId: F1, cells }, shared), after, 'no change, so the same project and no undo entry');
});

test('a straight line of corridor from one cell to another is walkable cell to cell', () => {
  const before = emptyProject();
  const first = before.building.floors[0];
  assert.deepEqual(building.lineCells(first, 41, 45), [41, 42, 43, 44, 45]);
  assert.deepEqual(building.lineCells(first, 45, 41), [45, 44, 43, 42, 41]);
  assert.deepEqual(building.lineCells(first, 1, 81), [1, 41, 81]);
  const diagonal = building.lineCells(first, 0, 3 * 40 + 5);
  assert.equal(diagonal.length, 9, 'five across and three down is nine cells with the start');
  for (let i = 1; i < diagonal.length; i += 1) assert.ok([1, 40].includes(Math.abs(diagonal[i] - diagonal[i - 1])), 'each step crosses one edge');
  const after = run(actions.paintCorridor, before, { floorId: first.id, from: 41, to: 45 });
  assert.equal(after.building.floors[0].cells.slice(40, 47), '.#####.');
});

test('corridor painted through a room takes those cells from the room and says so', () => {
  const before = twoRooms();
  const payload = { floorId: F1, cells: [cellAt(before, 1, 2, 3), cellAt(before, 1, 2, 4)] };
  const after = run(actions.paintCorridor, before, payload);
  assert.equal(room(after, '1B').cells.length, 4);
  assert.equal(info(actions.paintCorridor, before, payload, after).label, 'Paint corridor on Floor 1, replacing 2 cells of Room 1B');
  assert.equal(actions.paintCorridor(freeze(before), { ...payload, over: 'skip' }, shared), before, 'skip leaves the room alone, and there was nothing else to paint');
});

test('stairs are placed on cells, and stairs over an exit cell remove the exit and say so', () => {
  const before = twoRooms();
  const payload = { floorId: F1, cells: [cellAt(before, 1, 8, 2)] };
  const after = run(actions.placeStairs, before, payload);
  assert.equal(floor(after, 1).cells[cellAt(before, 1, 8, 2)], 'S');
  assert.deepEqual(floor(after, 1).exits, []);
  assert.equal(info(actions.placeStairs, before, payload, after).label, 'Place stairs on Floor 1, replacing 1 corridor cell and the exit East Door');
});

// ---------------------------------------------------------------- erase

test('erasing one cell of a room is ambiguous, and describeErase gives both answers before anything changes', () => {
  const before = school();
  const target = room(before, '101');
  const payload = { floorId: 'fsample001', cells: [target.cells[0]] };
  const described = actions.describeErase(freeze(before), payload);
  assert.equal(described.ambiguous, true);
  assert.deepEqual(described.spaces, [{ id: 'rsample101', kind: 'room', name: 'Room 101', cells: 1, of: 20 }]);
  assert.equal(described.whole.loss.spaces[0].removed, true);
  assert.deepEqual({ slots: described.whole.slots, groups: described.whole.groups }, slotsNaming(before, 'rsample101'));
  assert.deepEqual(slotsNaming(before, 'rsample101'), { slots: 5, groups: 5 });
  assert.equal(described.cellsOnly.loss.spaces[0].removed, false);
  assert.equal(described.cellsOnly.slots, 0);
});

test('the eraser takes the whole room by default, and only the cell with whole: false', () => {
  const before = school();
  const target = room(before, '101');
  const payload = { floorId: 'fsample001', cells: [target.cells[0]] };
  const whole = run(actions.eraseCells, before, payload);
  assert.equal(findRoom(whole, 'rsample101'), null);
  assert.equal(group(whole, '6A').days.dsample00a[2].roomText, '101');
  assert.equal(info(actions.eraseCells, before, payload, whole).label, 'Erase Room 101 on Floor 1');
  const one = run(actions.eraseCells, before, { ...payload, whole: false });
  assert.equal(findRoom(one, 'rsample101').cells.length, 19);
  assert.equal(group(one, '6A').days.dsample00a[2].room, 'rsample101');
  assert.equal(info(actions.eraseCells, before, payload, one).label, 'Erase 1 cell of Room 101 on Floor 1');
  assert.deepEqual(info(actions.eraseCells, before, payload, one).bumps, [GEOMETRY]);
});

test('erasing a one-cell room is not ambiguous, and erasing an empty cell changes nothing', () => {
  const before = run(actions.placeRoom, twoRooms(), { floorId: F1, cells: [0], id: 'rtest00005' });
  assert.equal(actions.describeErase(before, { floorId: F1, cells: [0] }).ambiguous, false);
  assert.equal(actions.eraseCells(before, { floorId: F1, cells: [8] }, shared), before);
});

test('erasing a stairs cell removes its connection in the same action, and one undo brings both back', () => {
  const project = school();
  const store = createStore({ project, clock, ids: makeIds(3) });
  const stairs = 8 * 40 + 12;
  assert.equal(store.project.building.connections.length, 2);
  store.apply(actions.eraseCells, { floorId: 'fsample001', cells: [stairs] });
  assert.equal(store.project.building.floors[0].cells[stairs], '.');
  assert.deepEqual(store.project.building.connections.map((connection) => connection.label), ['B']);
  assert.equal(store.history.past.length, 1, 'one action, one undo entry');
  assert.equal(store.undoLabel, 'Erase 1 stairs cell and stairs connection A on Floor 1');
  assertValid(store.project);
  store.undo();
  assert.equal(store.project.building.floors[0].cells[stairs], 'S');
  assert.deepEqual(store.project.building.connections.map((connection) => connection.label), ['A', 'B']);
});

test('erasing the corridor cell a door opens onto removes the door and says so', () => {
  const before = twoRooms();
  const payload = { floorId: F1, cells: [cellAt(before, 1, 1, 2)] };
  const after = run(actions.eraseCells, before, payload);
  assert.deepEqual(room(after, '1A').doors, [{ cell: cellAt(before, 1, 4, 1), side: 's' }]);
  assert.equal(info(actions.eraseCells, before, payload, after).label, 'Erase 1 corridor cell and 1 door on Floor 1');
});

test('deleting a room rewrites its slots to the room text, drops it from its teacher, and is told with the count first', () => {
  const before = school();
  const described = actions.describeSpaceDelete(freeze(before), { spaceIds: ['rsample203'] });
  assert.deepEqual({ slots: described.slots, groups: described.groups }, slotsNaming(before, 'rsample203'));
  assert.equal(described.slots, 12);
  const after = run(actions.deleteSpaces, before, { spaceIds: ['rsample203'] });
  assert.equal(findRoom(after, 'rsample203'), null);
  for (const candidate of after.groups) {
    for (const day of Object.values(candidate.days)) for (const slot of day) assert.notEqual(slot.room, 'rsample203');
  }
  assert.deepEqual(group(after, '6C').days.dsample00a[1], { room: null, roomText: '203', label: '', teacherIds: [] });
  assert.deepEqual(teacher(after, 'Ms. Vandermeer').roomIds, []);
  const told = info(actions.deleteSpaces, before, { spaceIds: ['rsample203'] }, after);
  assert.equal(told.label, 'Delete Room 203');
  assert.deepEqual(told.bumps, [GEOMETRY, SCHEDULE]);
  refused(actions.deleteSpaces, before, { spaceIds: ['rnowhere00'] }, 'missing');
});

// ---------------------------------------------------------------- move, copy, paste

test('moving a room keeps its slots, its number, its teacher, its subject and a door that still faces the corridor', () => {
  const before = school();
  const original = room(before, '302');
  const payload = { spaceIds: ['rsample302'], dx: -2, dy: 0 };
  const after = run(actions.moveSpaces, before, payload);
  const moved = findRoom(after, 'rsample302');
  assert.deepEqual(moved.cells, original.cells.map((cell) => cell - 2));
  assert.deepEqual(moved.doors, [{ cell: original.doors[0].cell - 2, side: 's' }]);
  assert.deepEqual({ number: moved.number, teacherIds: moved.teacherIds, subjectId: moved.subjectId, capacity: moved.capacity, wing: moved.wing }, { number: '302', teacherIds: ['tsample011'], subjectId: 'ssample006', capacity: 30, wing: 'East' });
  assert.equal(after.groups, before.groups, 'no slot was touched: the groups are the very same array');
  assert.equal(after.teachers, before.teachers);
  assert.equal(group(after, '6A').days.dsample00a[4].room, 'rsample302');
  assert.equal(after.building.floors[0], before.building.floors[0], 'a floor that was not touched is the same object');
  const told = info(actions.moveSpaces, before, payload, after);
  assert.equal(told.label, 'Move Room 302');
  assert.deepEqual(told.bumps, [GEOMETRY]);
});

test('moving a room away from its corridor keeps the room and every slot, removes the door, and says so', () => {
  const before = school();
  const payload = { spaceIds: ['rsample302'], dx: 0, dy: -1 };
  const after = run(actions.moveSpaces, before, payload);
  assert.deepEqual(findRoom(after, 'rsample302').doors, []);
  assert.equal(group(after, '6A').days.dsample00a[4].room, 'rsample302');
  assert.equal(info(actions.moveSpaces, before, payload, after).label, 'Move Room 302, removing 1 door');
});

test('a move onto another space or a corridor is refused by name, and off the floor is refused', () => {
  const before = school();
  refused(actions.moveSpaces, before, { spaceIds: ['rsample302'], dx: 4, dy: 0 }, 'occupied', /Room 302 on top of 18 cells of Room 301 on Floor 3|Room 302 on top of 12 cells of Room 301 on Floor 3/);
  refused(actions.moveSpaces, before, { spaceIds: ['rsample302'], dx: 0, dy: 1 }, 'occupied', /7 corridor cells/);
  refused(actions.moveSpaces, before, { spaceIds: ['rsample302'], dx: 0, dy: -4 }, 'off-floor', /off the edge of Floor 3/);
  refused(actions.moveSpaces, before, { spaceIds: ['rsample302', 'rsample101'], dx: 1, dy: 0 }, 'bad-value');
  assert.equal(actions.moveSpaces(before, { spaceIds: ['rsample302'], dx: 0, dy: 0 }, shared), before);
});

test('a move with over: "replace" goes over what is there and the label names it', () => {
  const before = school();
  const payload = { spaceIds: ['rsample302'], dx: 4, dy: 0, over: 'replace' };
  const after = run(actions.moveSpaces, before, payload);
  assert.equal(findRoom(after, 'rsample302').cells.length, 28);
  assert.equal(findRoom(after, 'rsample301').cells.length, 12);
  assert.match(info(actions.moveSpaces, before, payload, after).label, /^Move Room 302, removing 12 cells of Room 301/);
});

test('several spaces move together and keep their places relative to each other', () => {
  const before = twoRooms();
  const after = run(actions.moveSpaces, before, { spaceIds: [roomId('1A'), roomId('1B')], dx: 4, dy: 0 });
  assert.deepEqual(room(after, '1A').cells, room(before, '1A').cells.map((cell) => cell + 4));
  assert.deepEqual(room(after, '1B').cells, room(before, '1B').cells.map((cell) => cell + 4));
  assert.equal(room(after, '1A').doors.length, 2);
  assert.equal(info(actions.moveSpaces, before, { spaceIds: [roomId('1A'), roomId('1B')], dx: 4 }, after).label, 'Move 2 spaces');
});

test('a room moved to another floor keeps its id and so every slot that names it', () => {
  const before = school();
  // Floor 3 has columns 13 to 17 of rows 3 to 6 empty; Room 101 is 5 by 4 at column 1
  const payload = { spaceIds: ['rsample101'], dx: 12, dy: 0, toFloorId: 'fsample003' };
  const after = run(actions.moveSpaces, before, payload);
  assert.equal(after.building.floors[0].spaces.some((space) => space.id === 'rsample101'), false);
  const moved = after.building.floors[2].spaces.find((space) => space.id === 'rsample101');
  assert.equal(moved.cells.length, 20);
  assert.deepEqual(moved.doors, [{ cell: 6 * 40 + 15, side: 's' }], 'its door faces Floor 3\'s corridor');
  assert.equal(group(after, '6A').days.dsample00a[2].room, 'rsample101');
  assert.deepEqual(teacher(after, 'Ms. Halloran').roomIds, ['rsample101']);
  assert.equal(info(actions.moveSpaces, before, payload, after).label, 'Move Room 101 to Floor 3');
});

test('copy and paste to another floor makes new spaces: new ids, no teachers, the number only when it is free', () => {
  const before = school();
  const clip = building.copySpaces(freeze(before).building, { spaceIds: ['rsample101', 'osample001'] });
  assert.equal(clip.format, 'sv2-spaces');
  assert.deepEqual([clip.width, clip.height], [6, 9]);
  assert.equal(JSON.parse(JSON.stringify(clip)).spaces.length, 2, 'a clip is plain data');
  const payload = { floorId: 'fsample003', clip, x: 12, y: 3, over: 'replace' };
  const after = run(actions.pasteSpaces, before, payload);
  const outcome = actions.buildingOutcome(after);
  assert.equal(outcome.spaceIds.length, 2);
  const pasted = findRoom(after, outcome.spaceIds[0]);
  assert.notEqual(pasted.id, 'rsample101');
  assert.equal(pasted.number, '', 'Room 101 is still in the building, so the copy has no number');
  assert.deepEqual({ teacherIds: pasted.teacherIds, subjectId: pasted.subjectId, capacity: pasted.capacity, wing: pasted.wing }, { teacherIds: [], subjectId: 'ssample001', capacity: 30, wing: 'West' });
  assert.equal(pasted.cells.length, 20);
  assert.equal(findRoom(after, 'rsample101').cells.length, 20, 'the original is untouched');
  assert.equal(after.groups, before.groups);
  assert.match(info(actions.pasteSpaces, before, payload, after).label, /^Paste 2 spaces on Floor 3, replacing /);
  refused(actions.pasteSpaces, before, { floorId: 'fsample003', clip, x: 12, y: 3 }, 'occupied');
  refused(actions.pasteSpaces, before, { floorId: 'fsample003', clip, x: 38, y: 3 }, 'off-floor');
  refused(actions.pasteSpaces, before, { floorId: 'fsample003', clip: null, x: 0, y: 0 }, 'bad-value');
});

test('a pasted room keeps its number when the original is gone, and loses a subject that is no longer on the list', () => {
  const start = twoRooms();
  const clip = building.copySpaces(start.building, { spaceIds: [roomId('1B')] });
  clip.spaces[0].subjectId = 'sgone00000';
  const without = run(actions.deleteSpaces, start, { spaceIds: [roomId('1B')] });
  const after = run(actions.pasteSpaces, without, { floorId: F1, clip, x: 5, y: 3 });
  const pasted = findRoom(after, actions.buildingOutcome(after).spaceIds[0]);
  assert.equal(pasted.number, '1B');
  assert.equal(pasted.subjectId, null);
});

// ---------------------------------------------------------------- fields

test('a room\'s fields are set one or several at a time, and the number is stored exactly as typed', () => {
  const before = school();
  const after = run(actions.setRoomFields, before, { roomId: 'rsample101', number: ' <101> "أ" ', wing: 'North', capacity: null, shared: true, subjectId: null });
  const changed = findRoom(after, 'rsample101');
  assert.deepEqual({ number: changed.number, wing: changed.wing, capacity: changed.capacity, shared: changed.shared, subjectId: changed.subjectId }, { number: ' <101> "أ" ', wing: 'North', capacity: null, shared: true, subjectId: null });
  const told = info(actions.setRoomFields, before, { roomId: 'rsample101' }, after);
  assert.equal(told.label, 'Edit Room 101');
  assert.deepEqual(told.bumps, [BUILDING, SCHEDULE]);
  assert.equal(actions.setRoomFields(before, { roomId: 'rsample101', number: '101' }, shared), before);
});

test('a room number already in the building is refused whatever the capitals or spaces, and its own number is not a clash', () => {
  const before = school();
  refused(actions.setRoomFields, before, { roomId: 'rsample101', number: ' gym ' }, 'duplicate-number', /already a room called Gym, on Floor 1/);
  run(actions.setRoomFields, before, { roomId: 'rsample101', number: ' 101 ' });
  refused(actions.setRoomFields, before, { roomId: 'rsample101', capacity: 1000 }, 'bad-value');
  refused(actions.setRoomFields, before, { roomId: 'rsample101', subjectId: 'snothing00' }, 'missing');
  refused(actions.setRoomFields, before, { roomId: 'osample001', number: '9' }, 'missing');
});

test('clearing a room\'s details keeps the room, its cells, its doors and its slots', () => {
  const before = school();
  const after = run(actions.clearRoomDetails, before, { roomId: 'rsample101' });
  const cleared = findRoom(after, 'rsample101');
  assert.deepEqual({ number: cleared.number, teacherIds: cleared.teacherIds, subjectId: cleared.subjectId, wing: cleared.wing, capacity: cleared.capacity, shared: cleared.shared }, { number: '', teacherIds: [], subjectId: null, wing: '', capacity: null, shared: false });
  assert.equal(cleared.cells.length, 20);
  assert.equal(cleared.doors.length, 1);
  assert.equal(group(after, '6A').days.dsample00a[2].room, 'rsample101');
  assert.deepEqual(teacher(after, 'Ms. Halloran').roomIds, []);
});

test('an other space\'s label, kind and colour are set', () => {
  const before = school();
  const after = run(actions.setOtherSpaceFields, before, { spaceId: 'osample001', label: 'Front Office', otherKind: 'office', colour: '#112233' });
  assert.equal(after.building.floors[0].spaces.find((space) => space.id === 'osample001').label, 'Front Office');
  refused(actions.setOtherSpaceFields, before, { spaceId: 'osample001', colour: 'red' }, 'bad-value');
});

// ---------------------------------------------------------------- doors

test('a door is added on an edge that faces the corridor, and removed the same way', () => {
  const before = twoRooms();
  const cell = cellAt(before, 1, 2, 3);
  const after = run(actions.addDoor, before, { roomId: roomId('1B'), cell, side: 'n' });
  assert.deepEqual(room(after, '1B').doors, [{ cell, side: 'n' }]);
  assert.deepEqual(info(actions.addDoor, before, { roomId: roomId('1B') }, after).bumps, [GEOMETRY]);
  assert.equal(info(actions.addDoor, before, { roomId: roomId('1B') }, after).label, 'Add a door to Room 1B');
  assert.equal(actions.addDoor(after, { roomId: roomId('1B'), cell, side: 'n' }, shared), after, 'adding it again changes nothing');
  const removed = run(actions.removeDoor, after, { roomId: roomId('1B'), cell, side: 'n' });
  assert.deepEqual(room(removed, '1B').doors, []);
});

test('a door into a wall is refused with the side named', () => {
  const before = twoRooms();
  refused(actions.addDoor, before, { roomId: roomId('1B'), cell: cellAt(before, 1, 1, 3), side: 'w' }, 'leads-nowhere', /The west side of that cell faces a wall/);
  refused(actions.addDoor, before, { roomId: roomId('1B'), cell: cellAt(before, 1, 1, 4), side: 's' }, 'leads-nowhere', /The south side of that cell is the edge of the floor/);
  refused(actions.addDoor, before, { roomId: roomId('1B'), cell: cellAt(before, 1, 1, 3), side: 'e' }, 'inner-edge', /The east side of that cell is inside Room 1B/);
  refused(actions.addDoor, before, { roomId: roomId('1B'), cell: cellAt(before, 1, 1, 1), side: 's' }, 'not-own-cell');
  refused(actions.addDoor, before, { roomId: roomId('1B'), cell: cellAt(before, 1, 1, 3), side: 'up' }, 'bad-value');
});

test('a door facing another room is refused and names the room', () => {
  const before = planProject([['AABB.', 'AABB.', '#####', '.....', '.....']]);
  refused(actions.addDoor, before, { roomId: roomId('1A'), cell: 1, side: 'e' }, 'leads-nowhere', /The east side of that cell faces Room 1B/);
  assert.deepEqual(building.describeDoor(before.building, { roomId: roomId('1A'), cell: 6, side: 's' }), { ok: true, exists: false, reason: '', code: '', leadsTo: 'corridor' });
});

// ---------------------------------------------------------------- stairs

test('two stairs on different floors are connected, lettered, and the label names both floors', () => {
  const before = planProject([['S####', '.....', '.....', '.....', '.....'], ['S####', '.....', '.....', '.....', '.....']]);
  const payload = { a: { floorId: floorId(1), cell: 0 }, b: { floorId: floorId(2), cell: 0 }, id: 'ctest00001' };
  assert.deepEqual(actions.describeConnect(before, payload), { sameFloor: false, fromFloor: 'Floor 1', toFloor: 'Floor 2', label: 'A' });
  const after = run(actions.connectStairs, before, payload);
  assert.deepEqual(after.building.connections, [{ id: 'ctest00001', label: 'A', a: { floorId: floorId(1), cell: 0 }, b: { floorId: floorId(2), cell: 0 }, direction: 'both' }]);
  assert.equal(info(actions.connectStairs, before, payload, after).label, 'Connect stairs A: Floor 1 to Floor 2');
  refused(actions.connectStairs, after, { a: payload.b, b: payload.a }, 'already-connected', /already connected, as A/);
  refused(actions.connectStairs, before, { a: payload.a, b: payload.a }, 'same-cell');
  refused(actions.connectStairs, before, { a: payload.a, b: { floorId: floorId(2), cell: 1 } }, 'not-stairs', /Floor 2 is not stairs/);
});

test('a same-floor connection is allowed and flagged, so the interface can ask first', () => {
  const before = planProject([['##S.S##', '.......', '.......', '.......', '.......']]);
  const payload = { a: { floorId: F1, cell: 2 }, b: { floorId: F1, cell: 4 } };
  assert.equal(actions.describeConnect(before, payload).sameFloor, true);
  const after = run(actions.connectStairs, before, payload);
  assert.equal(actions.buildingOutcome(after).sameFloor, true);
  assert.equal(after.building.connections.length, 1);
  assert.equal(info(actions.connectStairs, before, payload, after).label, 'Connect stairs A: two places on Floor 1');
});

test('connection labels continue past Z, and a letter never changes when another connection is removed', () => {
  // two floors of 30 stairs cells in a row; connect each to the one above
  let project = planProject([['S'.repeat(30), '', '', '', ''], ['S'.repeat(30), '', '', '', '']]);
  for (let i = 0; i < 28; i += 1) project = run(actions.connectStairs, project, { a: { floorId: floorId(1), cell: i }, b: { floorId: floorId(2), cell: i } });
  const labels = project.building.connections.map((connection) => connection.label);
  assert.deepEqual(labels.slice(24), ['Y', 'Z', 'AA', 'AB']);
  const third = project.building.connections[2];
  const fewer = run(actions.disconnectStairs, project, { connectionId: project.building.connections[1].id });
  assert.equal(info(actions.disconnectStairs, project, { connectionId: project.building.connections[1].id }, fewer).label, 'Disconnect stairs B');
  assert.equal(fewer.building.connections.find((connection) => connection.id === third.id).label, 'C', 'C is still C');
  assert.deepEqual(fewer.building.connections.slice(-2).map((connection) => connection.label), ['AA', 'AB']);
  assert.equal(nextConnectionLabel(fewer.building.connections), 'B', 'the freed letter is the next one handed out');
});

test('one stairs cell can be in two connections, which is how a stairwell of three floors is a chain', () => {
  const before = threeFloors();
  assert.equal(before.building.connections.filter((connection) => connection.a.floorId === floorId(2) || connection.b.floorId === floorId(2)).length, 2);
  assertValid(before);
});

test('a connection can be named and made one-way, and a blank name is refused', () => {
  const before = threeFloors();
  const id = before.building.connections[0].id;
  const after = run(actions.setConnection, before, { connectionId: id, label: 'North Stairwell', direction: 'ab' });
  assert.deepEqual({ label: after.building.connections[0].label, direction: after.building.connections[0].direction }, { label: 'North Stairwell', direction: 'ab' });
  refused(actions.setConnection, before, { connectionId: id, label: '  ' }, 'no-name');
  refused(actions.setConnection, before, { connectionId: id, direction: 'up' }, 'bad-value');
});

test('painting corridor over a connected stairs cell removes the connection in the same step', () => {
  const before = threeFloors();
  const payload = { floorId: floorId(2), cells: [cellAt(before, 2, 0, 2)] };
  const after = run(actions.paintCorridor, before, payload);
  assert.deepEqual(after.building.connections, []);
  assert.equal(info(actions.paintCorridor, before, payload, after).label, 'Paint corridor on Floor 2, replacing 1 stairs cell, stairs connection A and stairs connection B');
});

// ---------------------------------------------------------------- corridor names, exits, zones

test('a run of corridor cells is named in one action, and a cell has one name at a time', () => {
  const before = twoRooms();
  const west = [18, 19, 20, 21];
  const named = run(actions.nameCorridor, before, { floorId: F1, cells: west.concat([0]), name: 'West "Hall"', id: 'ktest00001' });
  assert.deepEqual(floor(named, 1).corridors, [{ id: 'ktest00001', name: 'West "Hall"', cells: west }], 'the cell that is not corridor is left out');
  const split = run(actions.nameCorridor, named, { floorId: F1, cells: [21, 22, 23], name: 'East Hall', id: 'ktest00002' });
  assert.deepEqual(floor(split, 1).corridors.map((corridor) => corridor.cells), [[18, 19, 20], [21, 22, 23]]);
  const more = run(actions.nameCorridor, split, { floorId: F1, cells: [24], name: 'East Hall' });
  assert.deepEqual(floor(more, 1).corridors[1].cells, [21, 22, 23, 24], 'the same name again adds to that corridor');
  const cleared = run(actions.nameCorridor, more, { floorId: F1, cells: [18, 19, 20], name: '' });
  assert.deepEqual(floor(cleared, 1).corridors.map((corridor) => corridor.name), ['East Hall']);
  const renamed = run(actions.renameCorridor, cleared, { floorId: F1, corridorId: 'ktest00002', name: 'Long Hall' });
  assert.equal(info(actions.renameCorridor, cleared, { floorId: F1, corridorId: 'ktest00002', name: 'Long Hall' }, renamed).label, 'Rename the corridor East Hall to Long Hall');
  assert.deepEqual(floor(run(actions.removeCorridorName, renamed, { floorId: F1, corridorId: 'ktest00002' }), 1).corridors, []);
  refused(actions.nameCorridor, before, { floorId: F1, cells: [0, 1], name: 'Nowhere' }, 'not-corridor');
});

test('erasing named corridor cells trims the name, and erasing all of them removes it', () => {
  const named = run(actions.nameCorridor, twoRooms(), { floorId: F1, cells: [18, 19], name: 'Stub', id: 'ktest00003' });
  const trimmed = run(actions.eraseCells, named, { floorId: F1, cells: [18] });
  assert.deepEqual(floor(trimmed, 1).corridors[0].cells, [19]);
  const gone = run(actions.eraseCells, trimmed, { floorId: F1, cells: [19] });
  assert.deepEqual(floor(gone, 1).corridors, []);
  assert.match(info(actions.eraseCells, trimmed, { floorId: F1, cells: [19] }, gone).label, /the corridor name Stub/);
});

test('an exit is marked on an edge corridor cell only, with its door name and assembly point', () => {
  const before = twoRooms();
  const after = run(actions.markExit, before, { floorId: F1, cell: 18, doorName: 'Door <W>', assembly: 'By the oak', id: 'xtest00001' });
  assert.deepEqual(floor(after, 1).exits[1], { id: 'xtest00001', cell: 18, doorName: 'Door <W>', assembly: 'By the oak' });
  assert.equal(info(actions.markExit, before, { floorId: F1, cell: 18, doorName: 'Door <W>' }, after).label, 'Mark an exit, Door <W>, on Floor 1');
  assert.equal(actions.markExit(after, { floorId: F1, cell: 18 }, shared), after, 'a cell that is already an exit is left as it is');
  const edited = run(actions.setExit, after, { floorId: F1, exitId: 'xtest00001', assembly: 'By the gate' });
  assert.equal(floor(edited, 1).exits[1].assembly, 'By the gate');
  const unmarked = run(actions.unmarkExit, edited, { floorId: F1, cell: 18 });
  assert.equal(floor(unmarked, 1).exits.length, 1);
  assert.equal(info(actions.unmarkExit, edited, { floorId: F1, cell: 18 }, unmarked).label, 'Remove the exit Door <W>');
});

test('an exit in the middle of the building, or off the corridor, is refused with the reason', () => {
  const before = twoRooms();
  refused(actions.markExit, before, { floorId: F1, cell: cellAt(before, 1, 2, 2) }, 'not-edge', /in the middle of the building/);
  refused(actions.markExit, before, { floorId: F1, cell: cellAt(before, 1, 1, 1) }, 'not-corridor', /part of a room/);
  refused(actions.markExit, before, { floorId: F1, cell: 0 }, 'not-corridor', /that cell is empty/);
});

test('a room placed beside an exit so that it is no longer on the edge removes the exit and says so', () => {
  // a corridor stub whose end cell has one empty side, which a new room then fills
  const before = planProject([['.....', '.AA..', '.###.', '.BB..', '.....']], {});
  const marked = run(actions.markExit, before, { floorId: F1, cell: 13, doorName: 'Side Door' });
  const walled = run(actions.placeRoom, marked, { floorId: F1, cells: [8, 14, 18] });
  assert.deepEqual(floor(walled, 1).exits, []);
  assert.equal(info(actions.placeRoom, marked, { floorId: F1 }, walled).label, 'Place a room on Floor 1, replacing the exit Side Door');
});

test('an exclusion zone is added inside its floor, edited and removed', () => {
  const before = twoRooms();
  const after = run(actions.addZone, before, { floorId: F1, x: 2, y: 2, w: 3, h: 1, label: 'Canteen doors', id: 'ztest00001' });
  assert.deepEqual(after.building.zones, [{ id: 'ztest00001', floorId: F1, label: 'Canteen doors', x: 2, y: 2, w: 3, h: 1 }]);
  assert.deepEqual(info(actions.addZone, before, { floorId: F1 }, after).bumps, [BUILDING]);
  const edited = run(actions.setZone, after, { zoneId: 'ztest00001', w: 5, label: 'Doors' });
  assert.deepEqual([edited.building.zones[0].w, edited.building.zones[0].label], [5, 'Doors']);
  assert.deepEqual(run(actions.removeZone, edited, { zoneId: 'ztest00001' }).building.zones, []);
  refused(actions.addZone, before, { floorId: F1, x: 7, y: 2, w: 3, h: 1 }, 'bad-value');
  refused(actions.setZone, after, { zoneId: 'ztest00001', w: 50 }, 'bad-value');
});

// ---------------------------------------------------------------- resize

test('a resize that cuts a room is described before it happens, with the room, its cells and its slots', () => {
  const before = freeze(school());
  // take 3 columns off the west edge of Floor 1: Room 101 is columns 1 to 5
  const described = actions.describeResize(before, { floorId: 'fsample001', left: -3 });
  assert.deepEqual([described.width, described.height, described.losesData], [37, 14, true]);
  assert.deepEqual(described.loss.spaces, [
    { id: 'rsample101', kind: 'room', name: 'Room 101', cells: 8, of: 20, removed: false },
    { id: 'osample001', kind: 'other', name: 'Office', cells: 8, of: 24, removed: false },
  ]);
  assert.equal(described.loss.corridorCells, 2);
  assert.equal(described.slots, 0, 'the room is cut, not removed, so no slot loses its room');
  assert.equal(before.building.floors[0].width, 40, 'nothing changed');
  // six columns take the whole of Room 101 and its five slots
  const more = actions.describeResize(before, { floorId: 'fsample001', left: -6 });
  assert.equal(more.loss.spaces[0].removed, true);
  assert.equal(more.slots, 5);
  assert.equal(more.loss.doors.length, 0, 'a door of a room that is removed is not listed apart from the room');
});

test('a resize from the west edge keeps everything in place relative to the building and loses nothing when growing', () => {
  const before = school();
  const payload = { floorId: 'fsample001', left: 2, top: 1, right: 3, bottom: 0 };
  assert.equal(actions.describeResize(before, payload).losesData, false);
  const after = run(actions.resizeFloor, before, payload);
  const first = after.building.floors[0];
  assert.deepEqual([first.width, first.height], [45, 15]);
  const was = room(before, '101');
  const now = room(after, '101');
  const moved = (cell) => (Math.floor(cell / 40) + 1) * 45 + (cell % 40) + 2;
  assert.deepEqual(now.cells, was.cells.map(moved));
  assert.deepEqual(now.doors, [{ cell: moved(was.doors[0].cell), side: 's' }]);
  assert.equal(after.building.connections[0].a.cell, moved(8 * 40 + 12), 'the connection follows its stairs cell');
  assert.equal(first.cells[moved(8 * 40 + 12)], 'S');
  assert.deepEqual(first.exits.map((exit) => exit.cell), before.building.floors[0].exits.map((exit) => moved(exit.cell)));
  assert.deepEqual(first.corridors[1].cells, before.building.floors[0].corridors[1].cells.map(moved));
  const zone = after.building.zones[0];
  const old = before.building.zones[0];
  assert.deepEqual([zone.x, zone.y, zone.w, zone.h], [old.x + 2, old.y + 1, old.w, old.h]);
  assert.equal(after.groups, before.groups);
  assert.equal(info(actions.resizeFloor, before, payload, after).label, 'Resize Floor 1 to 45 by 15');
});

test('a resize that cuts removes what falls outside in one step, and the label says what went', () => {
  const before = school();
  const payload = { floorId: 'fsample001', left: -13 };
  const after = run(actions.resizeFloor, before, payload);
  assert.equal(findRoom(after, 'rsample101'), null);
  assert.equal(findRoom(after, 'rsample102'), null);
  assert.equal(group(after, '6A').days.dsample00a[2].roomText, '101');
  assert.deepEqual(after.building.connections.map((connection) => connection.label), ['B'], 'the stairs at column 12 went, and connection A with them');
  const told = info(actions.resizeFloor, before, payload, after);
  assert.match(told.label, /^Resize Floor 1 to 27 by 14, removing Room 101, Room 102, Office, /);
  assert.match(told.label, /stairs connection A/);
  assert.deepEqual(told.bumps, [GEOMETRY, SCHEDULE]);
});

test('a resize outside 5 to 200 cells is refused with the size it would make, and no change is no entry', () => {
  const before = school();
  refused(actions.resizeFloor, before, { floorId: 'fsample001', bottom: -10 }, 'bad-size', /Floor 1 40 by 4/);
  refused(actions.resizeFloor, before, { floorId: 'fsample001', right: 161 }, 'bad-size');
  refused(actions.resizeFloor, before, { floorId: 'fsample001', right: 1.5 }, 'bad-value');
  assert.equal(actions.resizeFloor(before, { floorId: 'fsample001' }, shared), before);
  const big = run(actions.resizeFloor, before, { floorId: 'fsample001', right: 160, bottom: 186 });
  assert.deepEqual([big.building.floors[0].width, big.building.floors[0].height], [200, 200]);
});

test('a zone partly outside the new size is clipped, and one wholly outside is removed and listed', () => {
  const zoned = run(actions.addZone, twoRooms(), { floorId: F1, x: 6, y: 0, w: 3, h: 2, id: 'ztest00002' });
  const clipped = run(actions.resizeFloor, zoned, { floorId: F1, right: -2 });
  assert.deepEqual([clipped.building.zones[0].x, clipped.building.zones[0].w], [6, 1]);
  const wide = run(actions.resizeFloor, zoned, { floorId: F1, right: 3 });
  const gone = actions.describeResize(wide, { floorId: F1, right: -7 });
  assert.deepEqual(gone.loss.zones, [{ id: 'ztest00002', label: '' }]);
});

// ---------------------------------------------------------------- counts

test('counts gives the figures of the status line for the whole building and for each floor', () => {
  const sample = school();
  const total = building.counts(sample.building);
  assert.deepEqual({ ...total, byFloor: undefined }, { floors: 3, rooms: 13, numberedRooms: 13, otherSpaces: 10, corridorCells: 121, stairsCells: 4, unconnectedStairs: 0, liftCells: 0, unconnectedLifts: 0, steps: 0, refuges: 0, connections: 2, elevatorConnections: 0, elevators: 0, exits: 2, zones: 1, byFloor: undefined });
  assert.deepEqual(total.byFloor.fsample003, { rooms: 3, numberedRooms: 3, otherSpaces: 3, corridorCells: 38, stairsCells: 1, unconnectedStairs: 0, liftCells: 0, unconnectedLifts: 0, steps: 0, refuges: 0, exits: 0 });
  const edited = run(actions.placeStairs, run(actions.setRoomFields, sample, { roomId: 'rsample101', number: ' ' }), { floorId: 'fsample002', cells: [0] });
  const after = building.counts(edited.building);
  assert.deepEqual([after.rooms, after.numberedRooms, after.stairsCells, after.unconnectedStairs], [13, 12, 5, 1]);
});

test('describeCell says what is under the pointer', () => {
  const sample = school();
  const stairs = building.describeCell(sample.building, 'fsample001', 8 * 40 + 12);
  assert.deepEqual([stairs.x, stairs.y, stairs.kind, stairs.connections.map((connection) => connection.label)], [12, 8, 'stairs', ['A']]);
  const exit = building.describeCell(sample.building, 'fsample001', 7 * 40 + 39);
  assert.deepEqual([exit.kind, exit.corridorName, exit.exit.doorName], ['corridor', 'Main Corridor', 'Door B']);
  assert.equal(building.describeCell(sample.building, 'fsample001', 3 * 40 + 1).space.id, 'rsample101');
  assert.equal(building.describeCell(sample.building, 'fsample001', 0).kind, 'empty');
  assert.equal(building.describeCell(sample.building, 'fsample001', -1), null);
});

// ---------------------------------------------------------------- the line with actions.js

test('building.js works on the building alone and refuses with a BuildingError the actions turn into an ActionError', () => {
  const sample = freeze(school());
  const result = building.erase(sample.building, { floorId: 'fsample001', cells: [3 * 40 + 1] });
  assert.deepEqual(result.removedRooms.map((gone) => gone.id), ['rsample101'], 'it reports the room; rewriting the slots is the action\'s job');
  assert.throws(() => building.addDoor(sample.building, { roomId: 'rsample101', cell: 3 * 40 + 1, side: 'n' }), (error) => error instanceof building.BuildingError && error.code === 'leads-nowhere');
  assert.equal(actions.buildingOutcome(sample), null);
});

test('a building action leaves every floor it did not touch, and the schedule, as the very same objects', () => {
  const before = school();
  const after = run(actions.paintCorridor, before, { floorId: 'fsample002', cells: [0] });
  assert.equal(after.building.floors[0], before.building.floors[0]);
  assert.equal(after.building.floors[2], before.building.floors[2]);
  assert.equal(after.building.floors[1].spaces, before.building.floors[1].spaces);
  assert.equal(after.building.connections, before.building.connections);
  assert.equal(after.groups, before.groups);
  assert.equal(after.teachers, before.teachers);
});

// ================================================================ SV2-97: elevators, steps and areas of refuge

// Three floors of 7 by 5: two rooms over a corridor on row 2, empty cells below.
const SHAFT = ['.AA.BB.', '.AA.BB.', '#######', '.......', '.......'];
const F2 = floorId(2);
const F3 = floorId(3);

function shaft(floors, options) {
  return planProject(Array.from({ length: floors }, () => SHAFT), options);
}

const at = (x, y) => y * 7 + x;

// The project as the store holds it, without the stamp every change sets.
function bare(project) {
  const { modified, ...rest } = project;
  return JSON.stringify(rest);
}

// One action through a store: it is one undo entry, the project is valid,
// and Undo gives the project back byte for byte (and Redo the result).
function viaStore(project, action, payload) {
  const store = createStore({ project: freeze(structuredClone(project)), clock, ids: makeIds(5) });
  const before = bare(store.project);
  store.apply(action, payload);
  assert.equal(store.history.past.length, 1, 'one action, one undo entry');
  assertValid(store.project, 'valid after the action');
  const after = bare(store.project);
  const label = store.undoLabel;
  store.undo();
  assert.equal(bare(store.project), before, 'undo gives the project back byte for byte');
  store.redo();
  assert.equal(bare(store.project), after, 'redo gives the result back');
  return { project: store.project, label };
}

test('an elevator stop is placed on its own path: the cell is "S", listed in lifts, one undo step', () => {
  const before = shaft(2);
  const payload = { floorId: F1, cells: [at(0, 3)] };
  const { project, label } = viaStore(before, actions.placeLift, payload);
  assert.equal(floor(project, 1).cells[at(0, 3)], 'S');
  assert.deepEqual(floor(project, 1).lifts, [at(0, 3)]);
  assert.equal(floor(project, 2).lifts, undefined, 'another floor is untouched');
  assert.equal(label, 'Place an elevator stop on Floor 1');
  const direct = actions.placeLift(freeze(before), payload, shared);
  assert.deepEqual(actions.placeLift.bumps(before, payload, direct), [GEOMETRY], 'geometry, and the schedule only when a room went');
  assert.equal(building.describeCell(project.building, F1, at(0, 3)).kind, 'elevator');
});

test('placing a stop over a stop is no change, and a drag lists every cell once', () => {
  const placed = run(actions.placeLift, shaft(2), { floorId: F1, cells: [at(0, 3), at(1, 3)] });
  assert.deepEqual(floor(placed, 1).lifts, [at(0, 3), at(1, 3)]);
  assert.equal(actions.placeLift(freeze(placed), { floorId: F1, cells: [at(0, 3)] }, shared), placed, 'the very same project');
  const more = run(actions.placeLift, placed, { floorId: F1, cells: [at(1, 3), at(2, 3)] });
  assert.deepEqual(floor(more, 1).lifts, [at(0, 3), at(1, 3), at(2, 3)]);
});

test('a stop over a corridor cell replaces it and says what went: its name, step, refuge, and the door facing it', () => {
  let project = shaft(2, { doors: { '1A': [[1, 1, 's']] } });
  project = run(actions.nameCorridor, project, { floorId: F1, cells: [at(1, 2)], name: 'Main' });
  project = run(actions.setStepCells, project, { floorId: F1, cells: [at(1, 2)], stepFree: false });
  project = run(actions.addRefuge, project, { floorId: F1, cell: at(1, 2) });
  assert.equal(room(project, '1A').doors.length, 1);
  const payload = { floorId: F1, cells: [at(1, 2)] };
  const { project: after, label } = viaStore(project, actions.placeLift, payload);
  assert.equal(floor(after, 1).cells[at(1, 2)], 'S');
  assert.deepEqual(floor(after, 1).lifts, [at(1, 2)]);
  assert.equal(room(after, '1A').doors.length, 0, 'the door that faced the cell is gone');
  assert.deepEqual([floor(after, 1).corridors, floor(after, 1).notStepFree, floor(after, 1).refuges], [[], undefined, undefined]);
  assert.equal(label, 'Place an elevator stop on Floor 1, replacing 1 corridor cell, 1 door, the corridor name Main, 1 step mark and the area of refuge Area of refuge');
});

test('a stop over stairs takes the stairs\' connection with it, said; over a room it cuts the room', () => {
  const before = planProject([['S####', 'AA...', 'AA...', '.....', '.....'], ['S####', '.....', '.....', '.....', '.....']], { connections: [[1, 0, 0, 2, 0, 0]] });
  const over = { floorId: F1, cells: [0, 5] };
  const { project, label } = viaStore(before, actions.placeLift, over);
  assert.deepEqual(project.building.connections, []);
  assert.deepEqual(floor(project, 1).lifts, [0, 5]);
  assert.deepEqual(room(project, '1A').cells, [6, 10, 11]);
  assert.equal(label, 'Place an elevator stop on Floor 1, replacing 1 cell of Room 1A, 1 stairs cell and stairs connection A');
});

test('a stop placed with over: refuse leaves what is there alone and says why; skip takes only empty cells', () => {
  const before = shaft(1);
  refused(actions.placeLift, before, { floorId: F1, cells: [at(0, 2)], over: 'refuse' }, 'occupied', /replace 1 corridor cell/);
  const skipped = run(actions.placeLift, before, { floorId: F1, cells: [at(0, 2), at(0, 3)], over: 'skip' });
  assert.deepEqual(floor(skipped, 1).lifts, [at(0, 3)]);
  assert.equal(floor(skipped, 1).cells[at(0, 2)], '#');
});

test('stairs over a stop: the cell leaves lifts and loses its elevator connection, said', () => {
  let project = run(actions.placeLift, shaft(2), { floorId: F1, cells: [at(0, 3)] });
  project = run(actions.placeLift, project, { floorId: F2, cells: [at(0, 3)] });
  project = run(actions.connectStairs, project, { a: { floorId: F1, cell: at(0, 3) }, b: { floorId: F2, cell: at(0, 3) } });
  const payload = { floorId: F1, cells: [at(0, 3)] };
  const { project: after, label } = viaStore(project, actions.placeStairs, payload);
  assert.equal(floor(after, 1).cells[at(0, 3)], 'S');
  assert.equal(floor(after, 1).lifts, undefined);
  assert.deepEqual(after.building.connections, []);
  assert.deepEqual(floor(after, 2).lifts, [at(0, 3)], 'the other stop stays a stop, not connected');
  assert.equal(building.describeCell(after.building, F1, at(0, 3)).kind, 'stairs');
  assert.equal(label, 'Place stairs on Floor 1, replacing 1 elevator stop and a connection of elevator A');
});

// three floors, a stop on each at (0, 3)
function stops3() {
  let project = shaft(3);
  for (const floorIdent of [F1, F2, F3]) project = run(actions.placeLift, project, { floorId: floorIdent, cells: [at(0, 3)] });
  return project;
}
const stop = (floorIdent) => ({ floorId: floorIdent, cell: at(0, 3) });

test('two stops join as an elevator: kind, both ways, the car\'s letter, staff only for a new car', () => {
  const before = stops3();
  const payload = { a: stop(F1), b: stop(F2), id: 'cshaft0001' };
  const described = actions.describeConnect(before, payload);
  assert.deepEqual({ elevator: described.elevator, car: described.car, staffOnly: described.staffOnly, newCar: described.newCar, merges: described.merges }, { elevator: true, car: 'A', staffOnly: true, newCar: true, merges: [] });
  const { project, label } = viaStore(before, actions.connectStairs, payload);
  assert.deepEqual(project.building.connections, [{ id: 'cshaft0001', label: 'A', a: stop(F1), b: stop(F2), direction: 'both', kind: 'elevator', car: 'A', staffOnly: true }]);
  assert.equal(label, 'Connect elevator A: Floor 1 to Floor 2');
  assert.equal(building.counts(project.building).elevators, 1);
});

test('a stop joined to a car is merged into it, with its letter and its access; each connection keeps its own label', () => {
  let project = run(actions.connectStairs, stops3(), { a: stop(F1), b: stop(F2) });
  project = run(actions.setElevator, project, { carId: project.building.connections[0].id, staffOnly: false });
  const { project: chain, label } = viaStore(project, actions.connectStairs, { a: stop(F2), b: stop(F3) });
  assert.deepEqual(chain.building.connections.map((c) => [c.label, c.car, c.staffOnly, c.kind, c.direction]), [['A', 'A', undefined, 'elevator', 'both'], ['B', 'A', undefined, 'elevator', 'both']]);
  assert.equal(label, 'Connect elevator A: Floor 2 to Floor 3');
  const cars = elevatorCarsOf(chain);
  assert.equal(cars.length, 1);
  assert.deepEqual(cars[0].stops.map((s) => s.floorId), [F1, F2, F3]);
  // a star from the lobby: the third stop joins the first
  const star = run(actions.connectStairs, project, { a: stop(F1), b: stop(F3) });
  assert.deepEqual(star.building.connections.map((c) => c.car), ['A', 'A']);
});

function elevatorCarsOf(project) {
  return schemaCars(project.building);
}

test('the three refusals of connecting stops: kind mixed, one floor, a floor the car already serves', () => {
  const base = stops3();
  const withStairs = run(actions.placeStairs, base, { floorId: F2, cells: [at(1, 3)] });
  refused(actions.connectStairs, withStairs, { a: stop(F1), b: { floorId: F2, cell: at(1, 3) } }, 'elevator-stairs', /An elevator stop joins only another elevator stop/);
  refused(actions.connectStairs, withStairs, { a: { floorId: F2, cell: at(1, 3) }, b: stop(F1) }, 'elevator-stairs', /An elevator stop joins only another elevator stop/);
  const twoOnOne = run(actions.placeLift, base, { floorId: F1, cells: [at(2, 3)] });
  refused(actions.connectStairs, twoOnOne, { a: stop(F1), b: { floorId: F1, cell: at(2, 3) } }, 'elevator-same-floor', /An elevator joins different floors/);
  const joined = run(actions.connectStairs, twoOnOne, { a: stop(F1), b: stop(F2) });
  const elsewhere = run(actions.placeLift, joined, { floorId: F2, cells: [at(3, 3)] });
  refused(actions.connectStairs, elsewhere, { a: { floorId: F2, cell: at(3, 3) }, b: stop(F1) }, 'elevator-floor-taken', /Elevator A already stops on Floor 2/);
  refused(actions.connectStairs, elsewhere, { a: stop(F1), b: { floorId: F2, cell: at(3, 3) } }, 'elevator-floor-taken', /Elevator A already stops on Floor 2/);
  refused(actions.connectStairs, joined, { a: { floorId: F1, cell: at(2, 3) }, b: stop(F2) }, 'elevator-floor-taken', /Elevator A already stops on Floor 1/);
  const chain = run(actions.connectStairs, joined, { a: stop(F2), b: stop(F3) });
  refused(actions.connectStairs, chain, { a: stop(F1), b: stop(F3) }, 'already-connected', /already part of Elevator A/);
});

test('two cars that meet become one: the first stop\'s letter, access true wins, every connection says so', () => {
  let project = shaft(4);
  const ends = [[F1, 0], [F2, 0], [F3, 1], [floorId(4), 1]];
  for (const [floorIdent, x] of ends) project = run(actions.placeLift, project, { floorId: floorIdent, cells: [at(x, 3)] });
  const end = (n) => ({ floorId: ends[n][0], cell: at(ends[n][1], 3) });
  let merged = run(actions.connectStairs, project, { a: end(0), b: end(1) });
  merged = run(actions.setElevator, merged, { carId: merged.building.connections[0].id, staffOnly: false });
  merged = run(actions.connectStairs, merged, { a: end(2), b: end(3) });
  assert.deepEqual(merged.building.connections.map((c) => [c.car, c.staffOnly]), [['A', undefined], ['B', true]]);
  const { project: one, label } = viaStore(merged, actions.connectStairs, { a: end(1), b: end(2) });
  assert.deepEqual(one.building.connections.map((c) => [c.car, c.staffOnly]), [['A', true], ['A', true], ['A', true]]);
  assert.equal(label, 'Connect elevator A: Floor 2 to Floor 3, joining elevator B to it');
  assert.equal(schemaCars(one.building).length, 1);
  // the other way round, the first stop is B's and B's letter wins
  const back = run(actions.connectStairs, merged, { a: end(2), b: end(1) });
  assert.deepEqual(back.building.connections.map((c) => c.car), ['B', 'B', 'B']);
  // a join that would give the merged car two stops on one floor is refused, naming the car
  const crowded = run(actions.placeLift, merged, { floorId: F2, cells: [at(4, 3)] });
  refused(actions.connectStairs, crowded, { a: { floorId: F2, cell: at(4, 3) }, b: end(0) }, 'elevator-floor-taken', /Elevator A already stops on Floor 2/);
  // two joined cars that both serve one floor cannot meet: car A has Floor 2, and so would the car of a stop beside it
  const rival = run(actions.placeLift, crowded, { floorId: F3, cells: [at(4, 3)] });
  const rivals = run(actions.connectStairs, rival, { a: { floorId: F2, cell: at(4, 3) }, b: { floorId: F3, cell: at(4, 3) } });
  refused(actions.connectStairs, rivals, { a: end(1), b: { floorId: F3, cell: at(4, 3) } }, 'elevator-floor-taken', /Elevator [AC] already stops on Floor [23]/);
});

test('disconnecting an elevator leaves its stops standing, not connected', () => {
  const joined = run(actions.connectStairs, stops3(), { a: stop(F1), b: stop(F2) });
  const { project, label } = viaStore(joined, actions.disconnectStairs, { connectionId: joined.building.connections[0].id });
  assert.deepEqual(project.building.connections, []);
  assert.deepEqual([floor(project, 1).lifts, floor(project, 2).lifts], [[at(0, 3)], [at(0, 3)]]);
  assert.equal(label, 'Disconnect elevator A');
  const counted = building.counts(project.building);
  assert.deepEqual([counted.liftCells, counted.unconnectedLifts, counted.elevators, counted.connections], [3, 3, 0, 0]);
});

test('an elevator takes no direction but both; stairs still take one', () => {
  const joined = run(actions.connectStairs, stops3(), { a: stop(F1), b: stop(F2) });
  const id = joined.building.connections[0].id;
  refused(actions.setConnection, joined, { connectionId: id, direction: 'ab' }, 'elevator-direction', /runs both ways/);
  refused(actions.setConnection, joined, { connectionId: id, direction: 'ba' }, 'elevator-direction');
  assert.equal(actions.setConnection(freeze(joined), { connectionId: id, direction: 'both' }, shared), joined, 'both is no change');
  const stairs = planProject([['S####', '.....', '.....', '.....', '.....'], ['S####', '.....', '.....', '.....', '.....']], { connections: [[1, 0, 0, 2, 0, 0]] });
  assert.equal(run(actions.setConnection, stairs, { connectionId: stairs.building.connections[0].id, direction: 'ab' }).building.connections[0].direction, 'ab');
});

test('setElevator writes staff only on every connection of the car and says how many stops it reached', () => {
  let project = run(actions.connectStairs, stops3(), { a: stop(F1), b: stop(F2) });
  project = run(actions.connectStairs, project, { a: stop(F2), b: stop(F3) });
  const carId = project.building.connections[0].id;
  const open = { carId, staffOnly: false };
  const { project: after, label } = viaStore(project, actions.setElevator, open);
  assert.deepEqual(after.building.connections.map((c) => Object.keys(c).includes('staffOnly')), [false, false]);
  assert.equal(label, 'Open elevator A to everyone');
  const result = run(actions.setElevator, after, { carId, staffOnly: true });
  assert.deepEqual(result.building.connections.map((c) => c.staffOnly), [true, true]);
  assert.equal(info(actions.setElevator, after, { carId, staffOnly: true }, result).label, 'Make elevator A staff and authorised only');
  assert.equal(info(actions.setElevator, after, { carId, staffOnly: true }, result).outcome.stops, 3);
  assert.equal(actions.setElevator(freeze(project), { carId, staffOnly: true }, shared), project, 'already staff only: no change');
  assert.deepEqual(actions.setElevator.bumps, [GEOMETRY]);
  refused(actions.setElevator, project, { carId: 'cnothing00', staffOnly: true }, 'missing');
  refused(actions.setElevator, project, { carId, staffOnly: 'yes' }, 'bad-value');
  refused(actions.setElevator, stops3(), { carId: 'stop:' + F1 + ':' + at(0, 3), staffOnly: true }, 'not-connected', /Connect it first/);
});

test('a door with a step, an exit with a step: the flag is written false and taken off when true, one undo step each', () => {
  const before = planProject([['.AA.BB.', '.AA.BB.', '#######', '.......', '.......']], { doors: { '1A': [[1, 1, 's'], [2, 1, 's']] }, exits: [[1, 0, 2, 'West Door']] });
  const door = { cell: at(1, 1), side: 's' };
  const { project: stepped, label } = viaStore(before, actions.setDoorStepFree, { roomId: roomId('1A'), door, stepFree: false });
  assert.deepEqual(room(stepped, '1A').doors, [{ cell: at(1, 1), side: 's', stepFree: false }, { cell: at(2, 1), side: 's' }]);
  assert.equal(label, 'Mark a door of Room 1A as having a step');
  const free = run(actions.setDoorStepFree, stepped, { roomId: roomId('1A'), door, stepFree: true });
  assert.deepEqual(room(free, '1A').doors, room(before, '1A').doors, 'the flag is gone, not set to true');
  assert.equal(info(actions.setDoorStepFree, stepped, { roomId: roomId('1A'), door, stepFree: true }, free).label, 'Mark a door of Room 1A as step-free');
  assert.equal(actions.setDoorStepFree(freeze(before), { roomId: roomId('1A'), door, stepFree: true }, shared), before, 'already step-free: no change');
  refused(actions.setDoorStepFree, before, { roomId: roomId('1A'), door: { cell: at(3, 1), side: 's' }, stepFree: false }, 'missing', /no longer on Room 1A/);
  refused(actions.setDoorStepFree, before, { roomId: roomId('1A'), door, stepFree: 'no' }, 'bad-value');
  assert.deepEqual(actions.setDoorStepFree.bumps, [GEOMETRY]);

  const exitId = floor(before, 1).exits[0].id;
  const { project: kerb, label: exitLabel } = viaStore(before, actions.setExitStepFree, { exitId, stepFree: false });
  assert.equal(floor(kerb, 1).exits[0].stepFree, false);
  assert.equal(exitLabel, 'Mark the exit West Door as having a step');
  assert.deepEqual(floor(run(actions.setExitStepFree, kerb, { exitId, stepFree: true }), 1).exits, floor(before, 1).exits);
  refused(actions.setExitStepFree, before, { exitId: 'xnothing00', stepFree: false }, 'missing');
});

test('steps are marked on corridor cells; the rest are skipped and counted, and a selection with no corridor is refused', () => {
  const before = shaft(1);
  const cells = [at(0, 2), at(1, 2), at(2, 2), at(1, 0), at(0, 4)];
  const payload = { floorId: F1, cells, stepFree: false };
  const { project, label } = viaStore(before, actions.setStepCells, payload);
  assert.deepEqual(floor(project, 1).notStepFree, [at(0, 2), at(1, 2), at(2, 2)]);
  assert.equal(label, 'Mark 3 cells as a step on Floor 1, 2 skipped, not corridor');
  const after = actions.setStepCells(freeze(before), payload, shared);
  assert.equal(info(actions.setStepCells, before, payload, after).outcome.skipped, 2);
  const cleared = run(actions.setStepCells, project, { floorId: F1, cells: [at(1, 2)], stepFree: true });
  assert.deepEqual(floor(cleared, 1).notStepFree, [at(0, 2), at(2, 2)]);
  assert.equal(floor(run(actions.setStepCells, cleared, { floorId: F1, rect: { x: 0, y: 2, w: 3, h: 1 }, stepFree: true }), 1).notStepFree, undefined, 'no marks left: the key is gone');
  assert.equal(actions.setStepCells(freeze(project), payload, shared), project, 'nothing changed: the same project');
  refused(actions.setStepCells, before, { floorId: F1, cells: [at(1, 0), at(0, 4)], stepFree: false }, 'not-corridor', /None of those cells is a corridor cell/);
  refused(actions.setStepCells, before, { floorId: F1, cells: [at(0, 2)] }, 'bad-value');
  assert.deepEqual(actions.setStepCells.bumps, [GEOMETRY]);
});

test('areas of refuge: a corridor or stairs cell, named by default then numbered, names unique on a floor ignoring case', () => {
  let project = run(actions.placeStairs, shaft(2), { floorId: F1, cells: [at(0, 3)] });
  const first = run(actions.addRefuge, project, { floorId: F1, cell: at(0, 2) });
  assert.deepEqual(floor(first, 1).refuges.map((r) => [r.name, r.cell]), [['Area of refuge', at(0, 2)]]);
  assert.match(floor(first, 1).refuges[0].id, /^a[0-9a-z]{9}$/);
  const { project: second, label } = viaStore(first, actions.addRefuge, { floorId: F1, cell: at(0, 3) });
  assert.deepEqual(floor(second, 1).refuges.map((r) => r.name), ['Area of refuge', 'Area of refuge 2'], 'a refuge on a stairs cell is allowed');
  assert.equal(label, 'Add the area of refuge Area of refuge 2 on Floor 1');
  const third = run(actions.addRefuge, second, { floorId: F1, cell: at(1, 2), name: '  North LOBBY ' });
  assert.equal(floor(third, 1).refuges[2].name, 'North LOBBY', 'a name is trimmed (SV2-97b)');
  assert.equal(floor(run(actions.addRefuge, third, { floorId: F2, cell: at(0, 2), name: 'north lobby' }), 2).refuges[0].name, 'north lobby', 'another floor may reuse a name');
  refused(actions.addRefuge, third, { floorId: F1, cell: at(2, 2), name: 'north lobby' }, 'duplicate-name', /already an area of refuge called North LOBBY on Floor 1/);
  refused(actions.addRefuge, third, { floorId: F1, cell: at(0, 2) }, 'duplicate-cell');
  refused(actions.addRefuge, third, { floorId: F1, cell: at(1, 0) }, 'not-corridor', /part of a room/);
  refused(actions.addRefuge, third, { floorId: F1, cell: at(4, 4) }, 'not-corridor', /that cell is empty/);
  refused(actions.addRefuge, third, { floorId: F1, cell: at(2, 2), id: 'bnotarefug' }, 'bad-id');
  const withLift = run(actions.placeLift, project, { floorId: F1, cells: [at(1, 3)] });
  refused(actions.addRefuge, withLift, { floorId: F1, cell: at(1, 3) }, 'not-corridor', /an elevator stop/);
  assert.deepEqual(actions.addRefuge.bumps, [GEOMETRY]);
});

test('an area of refuge is renamed, moved and removed, each one undo step', () => {
  let project = run(actions.addRefuge, shaft(1), { floorId: F1, cell: at(0, 2) });
  project = run(actions.addRefuge, project, { floorId: F1, cell: at(3, 2), name: 'Gym lobby' });
  const [a, b] = floor(project, 1).refuges.map((r) => r.id);
  const { project: renamed, label } = viaStore(project, actions.setRefuge, { refugeId: a, name: 'West stair' });
  assert.deepEqual(floor(renamed, 1).refuges.map((r) => r.name), ['West stair', 'Gym lobby']);
  assert.equal(label, 'Edit the area of refuge Area of refuge');
  refused(actions.setRefuge, project, { refugeId: a, name: 'GYM LOBBY' }, 'duplicate-name');
  refused(actions.setRefuge, project, { refugeId: a, name: '  ' }, 'no-name');
  assert.equal(actions.setRefuge(freeze(project), { refugeId: a, name: 'Area of refuge' }, shared), project, 'same name: no change');
  const moved = run(actions.setRefuge, project, { refugeId: b, cell: at(5, 2) });
  assert.equal(floor(moved, 1).refuges[1].cell, at(5, 2));
  refused(actions.setRefuge, project, { refugeId: b, cell: at(0, 2) }, 'duplicate-cell');
  refused(actions.setRefuge, project, { refugeId: b, cell: at(1, 1) }, 'not-corridor');
  const { project: gone, label: removed } = viaStore(project, actions.removeRefuge, { refugeId: a });
  assert.deepEqual(floor(gone, 1).refuges.map((r) => r.id), [b]);
  assert.equal(removed, 'Remove the area of refuge Area of refuge');
  assert.equal(floor(run(actions.removeRefuge, gone, { refugeId: b }), 1).refuges, undefined);
  refused(actions.removeRefuge, project, { refugeId: 'anothing00' }, 'missing');
});

test('erasing or painting over a marked cell takes its step mark, area of refuge and stop with it, and says so', () => {
  let project = shaft(2);
  project = run(actions.setStepCells, project, { floorId: F1, cells: [at(0, 2), at(1, 2), at(2, 2)], stepFree: false });
  project = run(actions.addRefuge, project, { floorId: F1, cell: at(0, 2), name: 'West' });
  project = run(actions.addRefuge, project, { floorId: F1, cell: at(1, 2), name: 'East' });
  const erased = viaStore(project, actions.eraseCells, { floorId: F1, cells: [at(0, 2), at(1, 2)] });
  assert.deepEqual(floor(erased.project, 1).notStepFree, [at(2, 2)]);
  assert.equal(floor(erased.project, 1).refuges, undefined);
  assert.equal(erased.label, 'Erase 2 corridor cells, 2 step marks and the areas of refuge West and East on Floor 1');
  // stairs over a corridor cell: the step goes, the refuge stays (a refuge may be on stairs)
  const stairs = viaStore(project, actions.placeStairs, { floorId: F1, cells: [at(0, 2)] });
  assert.deepEqual(floor(stairs.project, 1).notStepFree, [at(1, 2), at(2, 2)]);
  assert.deepEqual(floor(stairs.project, 1).refuges.map((r) => r.name), ['West', 'East']);
  assert.equal(stairs.label, 'Place stairs on Floor 1, replacing 1 corridor cell and 1 step mark');
  // a stop over stairs that hold a refuge: the refuge goes (nobody waits in a car)
  const lifted = viaStore(stairs.project, actions.placeLift, { floorId: F1, cells: [at(0, 2)] });
  assert.deepEqual(floor(lifted.project, 1).refuges.map((r) => r.name), ['East']);
  assert.equal(lifted.label, 'Place an elevator stop on Floor 1, replacing 1 stairs cell and the area of refuge West');
  // a room over a corridor cell with a refuge
  const room1 = viaStore(project, actions.placeRoom, { floorId: F1, cells: [at(1, 2)] });
  assert.deepEqual(floor(room1.project, 1).refuges.map((r) => r.name), ['West']);
  assert.deepEqual(floor(room1.project, 1).notStepFree, [at(0, 2), at(2, 2)]);
  // a stop erased takes its elevator connection, and the other stop stays a stop
  let cars = run(actions.placeLift, shaft(2), { floorId: F1, cells: [at(0, 3)] });
  cars = run(actions.placeLift, cars, { floorId: F2, cells: [at(0, 3)] });
  cars = run(actions.connectStairs, cars, { a: stop(F1), b: stop(F2) });
  const gone = viaStore(cars, actions.eraseCells, { floorId: F1, cells: [at(0, 3)] });
  assert.deepEqual(gone.project.building.connections, []);
  assert.equal(floor(gone.project, 1).lifts, undefined);
  assert.deepEqual(floor(gone.project, 2).lifts, [at(0, 3)]);
  assert.equal(gone.label, 'Erase 1 elevator stop and a connection of elevator A on Floor 1');
});

test('a door is refused on a side that faces an elevator stop, and a door the stop lands on goes with a said loss', () => {
  const lifted = run(actions.placeLift, shaft(1), { floorId: F1, cells: [at(1, 2)] });
  refused(actions.addDoor, lifted, { roomId: roomId('1A'), cell: at(1, 1), side: 's' }, 'faces-elevator', /An elevator is not a corridor/);
  const ok = run(actions.addDoor, lifted, { roomId: roomId('1A'), cell: at(2, 1), side: 's' });
  assert.equal(room(ok, '1A').doors.length, 1);
  assert.equal(building.describeDoor(lifted.building, { roomId: roomId('1A'), cell: at(2, 1), side: 's' }).leadsTo, 'corridor');
  // a room moved so that a door faces a stop loses that door, said
  const wide = planProject([['.AA....', '.AA....', '#######', '.......', '.......']], { doors: { '1A': [[1, 1, 's'], [2, 1, 's']] } });
  const stopped = run(actions.placeLift, wide, { floorId: F1, cells: [at(3, 2)] });
  const moved = viaStore(stopped, actions.moveSpaces, { spaceIds: [roomId('1A')], dx: 1, dy: 0 });
  assert.deepEqual(room(moved.project, '1A').doors, [{ cell: at(2, 1), side: 's' }], 'the door that moved to column 3 now faces the stop and is gone; the other moved to column 2');
  assert.equal(room(moved.project, '1A').doors.length, 1, 'the door that now faces the stop is gone');
  assert.match(moved.label, /^Move Room 1A, removing 1 door$/);
});

test('doors keep their step flag when a room is moved, copied and pasted, and the clip carries it', () => {
  const before = planProject([['.AA....', '.AA....', '#######', '.......', '.......'], ['.......', '.......', '#######', '.......', '.......']], { doors: { '1A': [[1, 1, 's'], [2, 1, 's']] } });
  const stepped = run(actions.setDoorStepFree, before, { roomId: roomId('1A'), door: { cell: at(2, 1), side: 's' }, stepFree: false });
  const expected = [{ cell: at(1, 1), side: 's' }, { cell: at(2, 1), side: 's', stepFree: false }];
  assert.deepEqual(room(stepped, '1A').doors, expected);
  const moved = run(actions.moveSpaces, stepped, { spaceIds: [roomId('1A')], dx: 2, dy: 0 });
  assert.deepEqual(room(moved, '1A').doors, [{ cell: at(3, 1), side: 's' }, { cell: at(4, 1), side: 's', stepFree: false }]);
  const elsewhere = run(actions.moveSpaces, stepped, { spaceIds: [roomId('1A')], dx: 0, dy: 0, toFloorId: F2 });
  assert.deepEqual(room(elsewhere, '1A').doors, [{ cell: at(1, 1), side: 's' }, { cell: at(2, 1), side: 's', stepFree: false }]);
  const clip = building.copySpaces(stepped.building, { spaceIds: [roomId('1A')] });
  assert.deepEqual(clip.spaces[0].doors, [{ at: [0, 1], side: 's' }, { at: [1, 1], side: 's', stepFree: false }]);
  const pasted = run(actions.pasteSpaces, stepped, { floorId: F2, clip, x: 1, y: 0 });
  const copy = floor(pasted, 2).spaces[0];
  assert.deepEqual(copy.doors, [{ cell: at(1, 1), side: 's' }, { cell: at(2, 1), side: 's', stepFree: false }]);
  const resized = run(actions.resizeFloor, stepped, { floorId: F1, left: 2, top: 1 });
  assert.deepEqual(room(resized, '1A').doors, [{ cell: 2 * 9 + 3, side: 's' }, { cell: 2 * 9 + 4, side: 's', stepFree: false }]);
});

test('resizing a floor moves its stops, steps and areas of refuge, cuts what falls off, and says what it cut', () => {
  let project = shaft(2);
  project = run(actions.placeLift, project, { floorId: F1, cells: [at(0, 3), at(6, 3)] });
  project = run(actions.placeLift, project, { floorId: F2, cells: [at(0, 3)] });
  project = run(actions.connectStairs, project, { a: stop(F1), b: stop(F2) });
  project = run(actions.setStepCells, project, { floorId: F1, cells: [at(1, 2), at(6, 2)], stepFree: false });
  project = run(actions.addRefuge, project, { floorId: F1, cell: at(2, 2), name: 'Mid' });
  project = run(actions.addRefuge, project, { floorId: F1, cell: at(6, 2), name: 'Far' });
  const grown = viaStore(project, actions.resizeFloor, { floorId: F1, left: 2, top: 1 });
  assert.deepEqual(floor(grown.project, 1).lifts, [4 * 9 + 2, 4 * 9 + 8]);
  assert.deepEqual(floor(grown.project, 1).notStepFree, [3 * 9 + 3, 3 * 9 + 8]);
  assert.deepEqual(floor(grown.project, 1).refuges.map((r) => [r.name, r.cell]), [['Mid', 3 * 9 + 4], ['Far', 3 * 9 + 8]]);
  assert.deepEqual(grown.project.building.connections[0].a, { floorId: F1, cell: 4 * 9 + 2 });
  const described = actions.describeResize(freeze(project), { floorId: F1, right: -2 });
  assert.equal(described.losesData, true);
  assert.deepEqual([described.loss.liftCells, described.loss.stepCells, described.loss.refuges.map((r) => r.name)], [1, 1, ['Far']]);
  const cut = viaStore(project, actions.resizeFloor, { floorId: F1, right: -2 });
  assert.equal(cut.label, 'Resize Floor 1 to 5 by 5, removing 2 cells of Room 1B, 2 corridor cells, 1 elevator stop, 1 step mark and the area of refuge Far');
  assert.deepEqual(floor(cut.project, 1).lifts, [3 * 5]);
  // cutting the connected stop's cell takes the connection and leaves the other stop standing
  const cutStop = viaStore(project, actions.resizeFloor, { floorId: F1, left: -1 });
  assert.deepEqual(cutStop.project.building.connections, []);
  assert.deepEqual(floor(cutStop.project, 2).lifts, [at(0, 3)]);
  assert.match(cutStop.label, /a connection of elevator A/);
});

test('deleting a floor drops its stops, steps and areas of refuge; the car\'s other stops stay, not connected', () => {
  let project = stops3();
  project = run(actions.connectStairs, project, { a: stop(F1), b: stop(F2) });
  project = run(actions.connectStairs, project, { a: stop(F2), b: stop(F3) });
  project = run(actions.addRefuge, project, { floorId: F2, cell: at(0, 2) });
  const described = actions.describeFloorDelete(freeze(project), F2);
  assert.deepEqual([described.connections, described.lifts, described.refuges], [2, 1, 1]);
  const { project: after, label } = viaStore(project, actions.deleteFloor, { id: F2 });
  assert.deepEqual(after.building.floors.map((f) => f.id), [F1, F3]);
  assert.deepEqual(after.building.connections, []);
  assert.deepEqual([floor(after, 1).lifts, floor(after, 2).lifts], [[at(0, 3)], [at(0, 3)]]);
  assert.equal(building.counts(after.building).unconnectedLifts, 2);
  assert.equal(label, 'Delete Floor 2');
});

test('describeCell and describeFloor name elevators, steps and areas of refuge, and counts keeps stairs and stops apart', () => {
  let project = stops3();
  project = run(actions.connectStairs, project, { a: stop(F1), b: stop(F2) });
  project = run(actions.connectStairs, project, { a: stop(F2), b: stop(F3) });
  project = run(actions.placeLift, project, { floorId: F1, cells: [at(5, 3)] });
  project = run(actions.placeStairs, project, { floorId: F1, cells: [at(6, 3)] });
  project = run(actions.nameCorridor, project, { floorId: F1, cells: [at(0, 2), at(1, 2), at(2, 2)], name: 'North Corridor' });
  project = run(actions.setStepCells, project, { floorId: F1, cells: [at(1, 2), at(2, 2), at(5, 2)], stepFree: false });
  project = run(actions.addRefuge, project, { floorId: F1, cell: at(6, 2), name: 'Lobby' });
  project = run(actions.addRefuge, project, { floorId: F1, cell: at(0, 2) });
  const there = building.describeCell(project.building, F1, at(0, 3));
  assert.equal(there.kind, 'elevator');
  assert.deepEqual(there.elevator, { carId: project.building.connections[0].id, label: 'A', staffOnly: true, connected: true, floors: ['Floor 1', 'Floor 2', 'Floor 3'] });
  assert.equal(building.describeCell(project.building, F1, at(5, 3)).elevator.connected, false);
  assert.equal(building.describeCell(project.building, F1, at(6, 3)).elevator, null);
  assert.equal(building.describeCell(project.building, F1, at(1, 2)).step, true);
  assert.equal(building.describeCell(project.building, F1, at(3, 2)).step, false);
  assert.equal(building.describeCell(project.building, F1, at(6, 2)).refuge.name, 'Lobby');
  assert.equal(building.describeCell(project.building, F1, at(6, 2)).corridorName, '');
  const words = building.describeFloor(project.building, F1);
  assert.deepEqual(words.elevators.map((e) => e.text), ['Elevator A: Floor 1, Floor 2 and Floor 3, staff and authorised only', 'Elevator stop on Floor 1: not connected']);
  assert.deepEqual(words.steps.map((s) => s.text), ['A step on North Corridor, 2 cells', 'A step in the corridor, 1 cell']);
  assert.deepEqual(words.refuges.map((r) => r.text), ['Area of refuge, Lobby', 'Area of refuge']);
  const counted = building.counts(project.building);
  assert.deepEqual([counted.stairsCells, counted.unconnectedStairs, counted.liftCells, counted.unconnectedLifts, counted.connections, counted.elevatorConnections, counted.elevators, counted.steps, counted.refuges], [1, 1, 4, 1, 0, 2, 1, 3, 2]);
  assert.deepEqual([counted.byFloor[F1].liftCells, counted.byFloor[F1].stairsCells, counted.byFloor[F2].liftCells], [2, 1, 1]);
});

test('a file whose elevator has connections and no lifts list (an older writer) keeps its stops standing when a connection goes', () => {
  const drawn = shaft(3);
  const handBuilt = (project) => {
    for (const [i, floorIdent] of [F1, F2, F3].entries()) {
      const target = project.building.floors[i];
      target.cells = target.cells.slice(0, at(0, 3)) + 'S' + target.cells.slice(at(0, 3) + 1);
      assert.equal(target.id, floorIdent);
    }
    project.building.connections = [
      { id: 'chand00001', label: 'A', a: stop(F1), b: stop(F2), direction: 'both', kind: 'elevator', car: 'A', staffOnly: true },
      { id: 'chand00002', label: 'B', a: stop(F2), b: stop(F3), direction: 'both', kind: 'elevator', car: 'A', staffOnly: true },
    ];
    return project;
  };
  const before = handBuilt(structuredClone(drawn));
  assertValid(before, 'valid with no lifts list');
  assert.equal(building.describeCell(before.building, F2, at(0, 3)).kind, 'elevator', 'the connection makes the cell a stop');
  const disconnected = viaStore(before, actions.disconnectStairs, { connectionId: 'chand00001' }).project;
  assert.deepEqual(floor(disconnected, 1).lifts, [at(0, 3)], 'the cut-off stop is listed, still a stop');
  assert.equal(floor(disconnected, 2).lifts, undefined, 'a stop another connection still reaches needs no list');
  assert.equal(building.describeCell(disconnected.building, F1, at(0, 3)).kind, 'elevator');
  const noFloor = viaStore(before, actions.deleteFloor, { id: F2 }).project;
  assert.deepEqual([floor(noFloor, 1).lifts, floor(noFloor, 2).lifts], [[at(0, 3)], [at(0, 3)]], 'deleting the middle floor leaves the stops on the floors either side, not connected');
  assert.equal(building.describeCell(noFloor.building, F1, at(0, 3)).kind, 'elevator');
  const endFloor = viaStore(before, actions.deleteFloor, { id: F3 }).project;
  assert.equal(floor(endFloor, 2).lifts, undefined, 'deleting an end floor leaves a stop that connection A still reaches unlisted');
  const erased = viaStore(before, actions.eraseCells, { floorId: F3, cells: [at(0, 3)] }).project;
  assert.deepEqual(floor(erased, 2).lifts, undefined, 'the middle stop is still on connection A');
  assert.deepEqual(erased.building.connections.map((c) => c.id), ['chand00001']);
});

test('an exit on an elevator stop is refused in words (not "undefined"), and an unlisted stop is not read as one', () => {
  const lifted = run(actions.placeLift, shaft(1), { floorId: F1, cells: [at(0, 3)] });
  refused(actions.markExit, lifted, { floorId: F1, cell: at(0, 3) }, 'not-corridor', /that cell is an elevator stop\./);
  // a stale `lifts` entry on a stairs connection (an older tool's resize or repaint) is stairs, not a stop
  const stale = structuredClone(planProject([['S####', '.....', '.....', '.....', '.....'], ['S####', '.....', '.....', '.....', '.....']], { connections: [[1, 0, 0, 2, 0, 0]] }));
  stale.building.floors[0].lifts = [0];
  assert.equal(building.describeCell(stale.building, F1, 0).kind, 'stairs');
  assert.equal(building.counts(stale.building).liftCells, 0);
  refused(actions.markExit, stale, { floorId: F1, cell: 0 }, 'not-corridor', /that cell is stairs\./);
});

test('a new elevator never takes the letter of one that is already there, though that letter is free as a connection label', () => {
  let project = shaft(4);
  const ends = [F1, F2, F3, floorId(4)];
  for (const floorIdent of ends) project = run(actions.placeLift, project, { floorId: floorIdent, cells: [at(0, 3), at(1, 3)] });
  project = run(actions.connectStairs, project, { a: stop(F1), b: stop(F2) });
  project = run(actions.connectStairs, project, { a: stop(F2), b: stop(F3) });
  assert.deepEqual(project.building.connections.map((c) => [c.label, c.car]), [['A', 'A'], ['B', 'A']]);
  // the connection that gave the car its letter goes; the letter stays on the car
  project = run(actions.disconnectStairs, project, { connectionId: project.building.connections[0].id });
  assert.deepEqual(project.building.connections.map((c) => [c.label, c.car]), [['B', 'A']]);
  const second = run(actions.connectStairs, project, { a: { floorId: F1, cell: at(1, 3) }, b: { floorId: floorId(4), cell: at(1, 3) } });
  const added = second.building.connections[1];
  assert.deepEqual([added.label, added.car], ['C', 'C'], 'not A: Elevator A is still there');
  assert.deepEqual(schemaCars(second.building).map((car) => car.label).filter((label) => label !== '').sort(), ['A', 'C'], 'two elevators, two letters (the stops no connection reaches are cars of no letter)');
});

// ================================================================ SV2-97b: splitting a car, a stop beside an exit, words, no-ops, refuge names

// n floors of 7 by 5 with a stop at (0, 3) on each, joined in a chain by the
// pairs given, one connection per pair, in that order.
function chain(floors, pairs) {
  let project = shaft(floors);
  for (let n = 1; n <= floors; n += 1) project = run(actions.placeLift, project, { floorId: floorId(n), cells: [at(0, 3)] });
  for (const [a, b] of pairs) project = run(actions.connectStairs, project, { a: { floorId: floorId(a), cell: at(0, 3) }, b: { floorId: floorId(b), cell: at(0, 3) } });
  return project;
}
const links = (n) => Array.from({ length: n - 1 }, (_, i) => [i + 1, i + 2]);
const letters = (project) => project.building.connections.map((connection) => connection.car);
const carLabels = (project) => schemaCars(project.building).filter((car) => car.connectionIds.length > 0).map((car) => car.label);

test('disconnecting the middle of a three-connection chain splits the car: the first keeps its letter, the other takes the next free one, said', () => {
  const before = chain(4, links(4));
  assert.deepEqual(letters(before), ['A', 'A', 'A']);
  const middle = before.building.connections[1].id;
  const { project, label } = viaStore(before, actions.disconnectStairs, { connectionId: middle });
  assert.deepEqual(letters(project), ['A', 'B'], 'floors 1-2 stay A, floors 3-4 are B on every connection they have');
  assert.deepEqual(carLabels(project), ['A', 'B']);
  assert.equal(label, 'Disconnect elevator A. Floors 3 and 4 are now Elevator B');
  const direct = actions.disconnectStairs(freeze(before), { connectionId: middle }, shared);
  assert.equal(building.renamedText(actions.buildingOutcome(direct).loss), 'Floors 3 and 4 are now Elevator B');
});

test('a split with a letter taken as a connection label goes past it, and the car holding the first connection in building order keeps the letter', () => {
  // joined 2-3 first, then 1-2: the connections run [2-3, 1-2, 3-4], and 2-3 is the first
  let project = chain(4, [[2, 3], [1, 2], [3, 4]]);
  assert.deepEqual(project.building.connections.map((c) => [c.label, c.car]), [['A', 'A'], ['B', 'A'], ['C', 'A']]);
  project = run(actions.disconnectStairs, project, { connectionId: project.building.connections[0].id });
  assert.deepEqual(project.building.connections.map((c) => [c.label, c.car]), [['B', 'A'], ['C', 'D']], '1-2 holds the first connection left and keeps A; 3-4 takes D, the first letter no label and no car uses (B and C are labels)');
});

test('erasing the middle stop of a five-stop chain splits the car and says which floors are the new elevator', () => {
  const before = chain(5, links(5));
  const { project, label } = viaStore(before, actions.eraseCells, { floorId: floorId(3), cells: [at(0, 3)] });
  assert.deepEqual(letters(project), ['A', 'B'], 'the two connections that touched floor 3 went; 1-2 is A, 4-5 is B');
  assert.match(label, /\. Floors 4 and 5 are now Elevator B$/);
});

test('resizing a stop away splits the car too', () => {
  const before = chain(5, links(5));
  const { project, label } = viaStore(before, actions.resizeFloor, { floorId: floorId(3), left: -1 });
  assert.deepEqual(carLabels(project), ['A', 'B']);
  assert.match(label, /Floors 4 and 5 are now Elevator B/);
  const described = actions.describeResize(freeze(before), { floorId: floorId(3), left: -1 });
  assert.equal(building.renamedText(described.loss), 'Floors 4 and 5 are now Elevator B', 'the question before the resize says it');
});

test('deleting a middle floor of a car with five stops splits it; four stops do not', () => {
  const five = chain(5, links(5));
  const { project, label } = viaStore(five, actions.deleteFloor, { id: floorId(3) });
  assert.deepEqual(carLabels(project), ['A', 'B']);
  assert.match(label, /Delete Floor 3\. Floors 4 and 5 are now Elevator B$/);
  const four = viaStore(chain(4, links(4)), actions.deleteFloor, { id: floorId(2) });
  assert.deepEqual(carLabels(four.project), ['A'], 'what is left is one car, and it keeps its letter');
  assert.doesNotMatch(four.label, /now Elevator/);
});

test('a star split into three keeps the first letter once and gives each other car its own', () => {
  let project = chain(4, [[1, 2], [1, 3], [1, 4]]);
  project = run(actions.deleteFloor, project, { id: floorId(1) });
  assert.deepEqual(carLabels(project), [], 'every connection touched floor 1');
  const star = chain(5, [[3, 1], [3, 2], [3, 4], [3, 5]]);
  const { project: after } = viaStore(star, actions.deleteFloor, { id: floorId(3) });
  assert.deepEqual(carLabels(after), [], 'a star loses all its connections with its hub');
});

test('placing a stop beside an exit that is then no longer on the edge removes the exit and says so', () => {
  let project = shaft(1);
  project = run(actions.markExit, project, { floorId: F1, cell: 15, doorName: 'North' });
  assert.equal(floor(project, 1).exits.length, 1);
  const { project: after, label } = viaStore(project, actions.placeLift, { floorId: F1, cells: [22] });
  assert.deepEqual(floor(after, 1).exits, []);
  assert.match(label, /the exit North/);
  assert.deepEqual(floor(after, 1).lifts, [22]);
});

// ---- a short deterministic fuzz of the building actions

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('a sequence of lifts, connections, erases, resizes, exits and floor deletes stays valid after every step and undoes and redoes byte for byte (fixed seeds)', () => {
  const done = {};
  for (const seed of [1, 2, 3, 5, 8, 13, 21, 34]) {
    const random = seeded(seed);
    const pick = (list) => list[Math.floor(random() * list.length)];
    const store = createStore({ project: freeze(structuredClone(chain(5, links(5)))), clock, ids: makeIds(seed) });
    const states = [bare(store.project)];
    const names = [];
    for (let step = 0; step < 60; step += 1) {
      const floors = store.project.building.floors;
      const f = pick(floors);
      // half the cells are picked where things happen: the stop column and the corridor row with the row under it
      const hot = [at(0, 3), at(1, 3), at(0, 2), at(1, 2), at(2, 3), at(5, 2), at(6, 2), at(3, 3)];
      const cell = random() < 0.5 ? pick(hot) : Math.floor(random() * f.width * f.height);
      const kind = pick(['placeLift', 'placeLift', 'connect', 'connect', 'connect', 'disconnect', 'erase', 'resize', 'markExit', 'deleteFloor', 'corridor']);
      let act;
      let payload;
      if (kind === 'placeLift') [act, payload] = [actions.placeLift, { floorId: f.id, cells: [cell] }];
      else if (kind === 'corridor') [act, payload] = [actions.paintCorridor, { floorId: f.id, from: cell, to: Math.floor(random() * f.width * f.height) }];
      else if (kind === 'erase') [act, payload] = [actions.eraseCells, { floorId: f.id, cells: [cell] }];
      else if (kind === 'markExit') [act, payload] = [actions.markExit, { floorId: f.id, cell }];
      else if (kind === 'deleteFloor') [act, payload] = [actions.deleteFloor, { id: f.id }];
      else if (kind === 'resize') [act, payload] = [actions.resizeFloor, { floorId: f.id, [pick(['left', 'right', 'top', 'bottom'])]: pick([-1, 1]) }];
      else if (kind === 'disconnect') {
        const connections = store.project.building.connections;
        if (connections.length === 0) continue;
        [act, payload] = [actions.disconnectStairs, { connectionId: pick(connections).id }];
      } else {
        const stops = floors.flatMap((each) => (each.lifts || []).map((c) => ({ floorId: each.id, cell: c })));
        if (stops.length < 2) continue;
        [act, payload] = [actions.connectStairs, { a: pick(stops), b: pick(stops) }];
      }
      const entries = store.history.past.length;
      try {
        store.apply(act, payload);
      } catch (error) {
        assert.ok(error instanceof ActionError, kind + ' refuses with an ActionError, not ' + error);
        assert.equal(store.history.past.length, entries, 'a refusal makes no step');
        continue;
      }
      if (store.history.past.length === entries) continue;
      assert.deepEqual(validate(store.project), [], 'seed ' + seed + ' step ' + step + ' (' + kind + ' ' + JSON.stringify(payload) + ') leaves a valid project');
      states.push(bare(store.project));
      names.push(act === actions.connectStairs ? 'connectStairs' : act === actions.disconnectStairs ? 'disconnectStairs' : act === actions.eraseCells ? 'eraseCells' : kind === 'resize' ? 'resizeFloor' : kind);
    }
    assert.ok(states.length > 10, 'seed ' + seed + ' did enough: ' + states.length);
    for (const name of names) done[name] = (done[name] || 0) + 1;
    for (let n = states.length - 2; n >= 0; n -= 1) {
      store.undo();
      assert.equal(bare(store.project), states[n], 'seed ' + seed + ': undoing ' + names[n] + ' gives the project before it');
    }
    for (let n = 1; n < states.length; n += 1) {
      store.redo();
      assert.equal(bare(store.project), states[n], 'seed ' + seed + ': redoing ' + names[n - 1] + ' gives its result back');
    }
  }  for (const name of ['placeLift', 'connectStairs', 'disconnectStairs', 'eraseCells', 'resizeFloor', 'markExit', 'deleteFloor']) assert.ok(done[name] > 0, name + ' ran in at least one sequence: ' + JSON.stringify(done));
});

// ---- words

test('lossText says a car\'s connections once: "2 connections of Elevator A"', () => {
  const conn = (id, label, car) => ({ id, label, kind: 'elevator', car });
  const loss = { ...building.emptyLoss(), connections: [conn('c1', 'A', 'A'), { id: 'c2', label: 'B' }, conn('c3', 'B', 'A'), conn('c4', 'C', 'C')] };
  assert.equal(building.lossText(loss), '2 connections of Elevator A, stairs connection B and a connection of elevator C');
  assert.equal(building.lossText({ ...building.emptyLoss(), connections: [conn('c1', 'A', 'A')] }), 'a connection of elevator A');
});

test('the elevator refusals say elevator, not stairs', () => {
  const joined = chain(3, [[1, 2]]);
  refused(actions.connectStairs, joined, { a: stop(F1), b: stop(F2) }, 'already-connected', /^Those two stops are already joined: Elevator A\.$/);
  refused(actions.connectStairs, joined, { a: stop(F2), b: stop(F1) }, 'already-connected', /Elevator A/);
  refused(actions.connectStairs, joined, { a: stop(F3), b: stop(F3) }, 'same-cell', /^An elevator joins two different stops\. Click a stop on another floor\.$/);
  refused(actions.describeConnect, joined, { a: stop(F3), b: stop(F3) }, 'same-cell', /elevator/i);
  // a plain stairs pair keeps its stairs words
  let stairs = shaft(2);
  for (const id of [F1, F2]) stairs = run(actions.placeStairs, stairs, { floorId: id, cells: [at(0, 3)] });
  stairs = run(actions.connectStairs, stairs, { a: stop(F1), b: stop(F2) });
  refused(actions.connectStairs, stairs, { a: stop(F1), b: stop(F2) }, 'already-connected', /^Those two stairs are already connected, as A\.$/);
  refused(actions.connectStairs, stairs, { a: stop(F1), b: stop(F1) }, 'same-cell', /different stairs cells/);
});

test('renaming a stairs connection to an elevator\'s letter says the elevator uses it', () => {
  let project = chain(2, [[1, 2]]);
  for (const id of [F1, F2]) project = run(actions.placeStairs, project, { floorId: id, cells: [at(2, 3)] });
  project = run(actions.connectStairs, project, { a: { floorId: F1, cell: at(2, 3) }, b: { floorId: F2, cell: at(2, 3) } });
  const stairsId = project.building.connections[1].id;
  assert.equal(project.building.connections[1].label, 'B');
  refused(actions.setConnection, project, { connectionId: stairsId, label: 'A' }, 'duplicate-label', /^Elevator A already uses that letter\./);
  const other = run(actions.setConnection, project, { connectionId: project.building.connections[0].id, label: 'Z' });
  refused(actions.setConnection, other, { connectionId: other.building.connections[0].id, label: 'B' }, 'duplicate-label', /^There is already a stairs connection B\./);
  refused(actions.setConnection, other, { connectionId: stairsId, label: 'Z' }, 'duplicate-label', /^Elevator Z already uses that letter|A connection of Elevator A is already called Z/);
});

// ---- an action that would change nothing

test('an action that would change nothing returns the very same project and makes no undo step, as every other no-op action does', () => {
  let project = chain(3, [[1, 2], [2, 3]]);
  project = run(actions.paintCorridor, project, { floorId: F1, cells: [at(3, 3), at(4, 3)] });
  project = run(actions.setStepCells, project, { floorId: F1, cells: [at(3, 3)], stepFree: false });
  const roomWithDoor = run(actions.addDoor, project, { roomId: roomId('1A'), cell: at(1, 1), side: 's' });
  const exitProject = run(actions.markExit, run(actions.paintCorridor, roomWithDoor, { floorId: F1, cells: [at(6, 2)] }), { floorId: F1, cell: at(6, 2) });
  const exitId = floor(exitProject, 1).exits[0].id;
  const carId = exitProject.building.connections[0].id;
  const cases = [
    ['setStepCells marking cells that are marked', actions.setStepCells, { floorId: F1, cells: [at(3, 3)], stepFree: false }],
    ['setStepCells clearing cells that are not marked', actions.setStepCells, { floorId: F1, cells: [at(4, 3)], stepFree: true }],
    ['setElevator to the value it has', actions.setElevator, { carId, staffOnly: true }],
    ['setDoorStepFree to the value it has', actions.setDoorStepFree, { roomId: roomId('1A'), door: { cell: at(1, 1), side: 's' }, stepFree: true }],
    ['setExitStepFree to the value it has', actions.setExitStepFree, { exitId, stepFree: true }],
    ['placeLift on cells that are stops', actions.placeLift, { floorId: F1, cells: [at(0, 3)] }],
  ];
  for (const [what, action, payload] of cases) {
    assert.equal(action(freeze(exitProject), payload, shared), exitProject, what + ': the very same project');
    const store = createStore({ project: freeze(structuredClone(exitProject)), clock, ids: makeIds(5) });
    store.apply(action, payload);
    assert.equal(store.history.past.length, 0, what + ': no undo step');
  }
});

// ---- the names of areas of refuge

test('an area of refuge name is trimmed and at most as long as other names; a default name reads as the default it is', () => {
  let project = shaft(1);
  project = run(actions.addRefuge, project, { floorId: F1, cell: at(1, 2), name: '  North stair  ' });
  assert.equal(floor(project, 1).refuges[0].name, 'North stair', 'trimmed');
  const long = 'x'.repeat(41);
  refused(actions.addRefuge, project, { floorId: F1, cell: at(2, 2), name: long }, 'too-long', /at most 40 characters; this one has 41/);
  refused(actions.setRefuge, project, { refugeId: floor(project, 1).refuges[0].id, name: long }, 'too-long', /at most 40/);
  refused(actions.addRefuge, project, { floorId: F1, cell: at(2, 2), name: ' north STAIR ' }, 'duplicate-name', /already an area of refuge called North stair/);
  const forty = run(actions.addRefuge, project, { floorId: F1, cell: at(2, 2), name: ' ' + 'y'.repeat(40) + ' ' });
  assert.equal(floor(forty, 1).refuges[1].name, 'y'.repeat(40), 'forty characters after trimming is allowed');
  const renamed = run(actions.setRefuge, project, { refugeId: floor(project, 1).refuges[0].id, name: ' Gym door ' });
  assert.equal(floor(renamed, 1).refuges[0].name, 'Gym door');
  assert.equal(actions.setRefuge(freeze(renamed), { refugeId: floor(renamed, 1).refuges[0].id, name: ' Gym door' }, shared), renamed, 'the same name with spaces is no change');
  let defaults = shaft(1);
  for (const cell of [at(1, 2), at(2, 2), at(3, 2)]) defaults = run(actions.addRefuge, defaults, { floorId: F1, cell });
  assert.deepEqual(building.describeFloor(defaults.building, F1).refuges.map((r) => r.text), ['Area of refuge', 'Area of refuge 2', 'Area of refuge 3']);
  defaults = run(actions.addRefuge, defaults, { floorId: F1, cell: at(4, 2), name: 'Area of refuge 2b' });
  defaults = run(actions.addRefuge, defaults, { floorId: F1, cell: at(5, 2), name: 'Area of refuge, east' });
  assert.deepEqual(building.describeFloor(defaults.building, F1).refuges.slice(3).map((r) => r.text), ['Area of refuge, Area of refuge 2b', 'Area of refuge, Area of refuge, east']);
});
