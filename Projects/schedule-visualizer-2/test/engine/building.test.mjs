// The building engine: engine/building.js through the actions that wrap it.
// Every action runs on a deep-frozen project and its result goes through
// validate(), so no case here can pass by producing a project the rest of the
// tool would reject.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as actions from '../../engine/actions.js';
import * as building from '../../engine/building.js';
import { createStore } from '../../engine/store.js';
import { findRoom, nextConnectionLabel } from '../../engine/schema.js';
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
  refused(actions.setRoomFields, before, { roomId: 'rsample101', number: ' gym ' }, 'duplicate-number', /already a Room Gym, on Floor 1/);
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
  assert.deepEqual({ ...total, byFloor: undefined }, { floors: 3, rooms: 13, numberedRooms: 13, otherSpaces: 10, corridorCells: 121, stairsCells: 4, unconnectedStairs: 0, connections: 2, exits: 2, zones: 1, byFloor: undefined });
  assert.deepEqual(total.byFloor.fsample003, { rooms: 3, numberedRooms: 3, otherSpaces: 3, corridorCells: 38, stairsCells: 1, unconnectedStairs: 0, exits: 0 });
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
