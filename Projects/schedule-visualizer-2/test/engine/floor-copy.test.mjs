// Duplicate a floor (SV2-134; ARCHITECTURE 22.8 and 22.17): describeFloorDuplicate
// and duplicateFloor. The copy on top with its name; every thing copied and not
// copied; new ids of every kind; renumbering room by room, a room that cannot
// follow the floor taking its own number with " 2" (Devon, 2026-11-21); joins that make a stairwell, extend one, leave two plain flights
// apart or give an elevator car a stop, naming no letter change; ways
// translated per flight; the three counters; one undo step. Plain Node: seeded
// ids, a pinned clock, every project deep-frozen while the action runs on it.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as actions from '../../engine/actions.js';
import { createStore } from '../../engine/store.js';
import { duplicateFloor, describeFloorDuplicate } from '../../engine/floor-copy.js';
import { collectIds, isId } from '../../engine/ids.js';
import { checkSchedule } from '../../engine/checks.js';
import { newFloor, newRoom, newOtherSpace, stairwells, stairsLetter, elevatorCars, isLiftCell, ELEVATOR_KIND } from '../../engine/schema.js';
import { school, emptyProject, ctx, clock, makeIds, assertValid, clone } from './helpers.mjs';
import { sampleSchool } from '../../data/sample-school.js';

const { ActionError, GEOMETRY, BUILDING, SCHEDULE, scheduleOutcome } = actions;
const CELL = 332;

function freeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function run(project, payload, seed) {
  const after = duplicateFloor(freeze(project), payload, ctx(seed || 21));
  assertValid(after, 'the project is still valid after duplicating');
  return after;
}

function refused(project, payload, code, pattern) {
  assert.throws(() => duplicateFloor(freeze(project), payload, ctx(3)), (error) => {
    assert.ok(error instanceof ActionError, 'an ActionError, not ' + error);
    assert.equal(error.code, code);
    assert.match(error.message, /\.$/, 'the message is a sentence');
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

// The sample's floor 2 has rooms whose "number" is a word (Library); this makes every
// number a 20x, which is the case renumbering is for.
function tidy(project) {
  const floor = project.building.floors[1];
  roomsOf(floor).forEach((room, n) => { room.number = '20' + (n + 1); });
  return project;
}

const newest = (project) => project.building.floors[project.building.floors.length - 1];
const floorOf = (project, name) => project.building.floors.find((floor) => floor.name === name);
const roomsOf = (floor) => floor.spaces.filter((space) => space.kind === 'room');

// n floors in a row, a stairs cell at CELL on each, flights A, B… between
// them from the lower end; options.well names one stairwell for all of them.
function chain(n, options) {
  const opts = options || {};
  // three floors or more start from the sample school; fewer, from an empty project of n floors
  const project = n >= 3 ? clone(school()) : clone(emptyProject());
  if (n < 3) project.building.floors = [];
  const floors = project.building.floors;
  for (let i = floors.length; i < n; i += 1) floors.push(newFloor('fsample00' + (i + 1), 'Floor ' + (i + 1), i + 1, 40, 14));
  for (const floor of floors) floor.cells = floor.cells.slice(0, CELL) + 'S' + floor.cells.slice(CELL + 1);
  project.building.connections = [];
  for (let i = 0; i + 1 < n; i += 1) {
    const connection = { id: 'cwell' + String(i + 1).padStart(5, '0'), label: String.fromCharCode(65 + i), a: { floorId: floors[i].id, cell: CELL }, b: { floorId: floors[i + 1].id, cell: CELL }, direction: opts.direction || 'both' };
    if (opts.well) connection.well = opts.well;
    project.building.connections.push(connection);
  }
  return project;
}

// the same, as an elevator of car D with a stop at CELL on every floor
function lift(n, staffOnly) {
  const project = chain(n);
  project.building.connections = project.building.connections.map((connection, i) => {
    const next = { ...connection, label: 'D' + (i ? i : ''), kind: ELEVATOR_KIND, car: 'D', direction: 'both' };
    if (staffOnly) next.staffOnly = true;
    return next;
  });
  return project;
}

// ---------------------------------------------------------------- on top

test('the copy goes on top: level one above the highest, its tab last, the same size', () => {
  const project = school();
  const after = run(project, { floorId: 'fsample002' });
  assert.equal(after.building.floors.length, project.building.floors.length + 1);
  const copy = newest(after);
  assert.equal(copy.level, 4, 'the highest level was 3');
  assert.equal(copy.name, 'Floor 4');
  const source = floorOf(project, 'Floor 2');
  assert.equal(copy.width, source.width);
  assert.equal(copy.height, source.height);
  assert.deepEqual(after.building.floors.slice(0, 3), project.building.floors, 'the floors before it are the very same objects');
});

test('the copy goes on top even when the source is the lowest floor, and after a gap in the levels', () => {
  const project = clone(school());
  project.building.floors[2].level = 7;
  const after = run(project, { floorId: 'fsample001' });
  assert.equal(newest(after).level, 8);
  assert.equal(newest(after).name, 'Floor 8', 'named for the source\'s own level pattern: Floor 1 is "Floor <level>", so the copy is "Floor <its level>"');
  assert.equal(describeFloorDuplicate(project, 'fsample001').newLevel, 8);
});

test('the name: "Floor <level>" for a floor named by its level, else "<name> (copy)", made unique', () => {
  const project = clone(school());
  project.building.floors[1].name = 'Lower Gym';
  assert.equal(describeFloorDuplicate(project, 'fsample002').newName, 'Lower Gym (copy)');
  const taken = run(project, { floorId: 'fsample002' });
  assert.equal(newest(taken).name, 'Lower Gym (copy)');
  assert.equal(describeFloorDuplicate(taken, 'fsample002').newName, 'Lower Gym (copy) (2)', 'a second copy does not clash with the first');
  const again = run(taken, { floorId: 'fsample002' });
  assert.equal(newest(again).name, 'Lower Gym (copy) (2)');
  // "Floor 4" already exists out of order: the new floor is not given its name twice
  const clash = clone(school());
  clash.building.floors[0].name = 'Floor 4';
  assert.equal(describeFloorDuplicate(clash, 'fsample002').newName, 'Floor 4 (2)');
});

test('the name may be typed: trimmed, not blank, and a sensible length; as typed otherwise', () => {
  const after = run(school(), { floorId: 'fsample002', name: '  <b>Annex</b> "North" 日本  ' });
  assert.equal(newest(after).name, '<b>Annex</b> "North" 日本', 'a name is data: kept as typed');
  refused(school(), { floorId: 'fsample002', name: '   ' }, 'no-name', /needs a name/);
  refused(school(), { floorId: 'fsample002', name: 'x'.repeat(61) }, 'too-long', /at most 60/);
  refused(school(), { floorId: 'fsample002', name: 4 }, 'no-name');
});

test('a floor that is not there is refused, and so is a payload with nonsense in it', () => {
  refused(school(), { floorId: 'fgone000000' }, 'missing', /no longer in the building/);
  refused(school(), { floorId: 'fsample002', numbers: 'all' }, 'bad-value');
  refused(school(), { floorId: 'fsample002', join: 'yes' }, 'bad-value');
  refused(school(), { floorId: 'fsample002', id: 'rbadprefix' }, 'bad-id');
  refused(school(), { floorId: 'fsample002', id: 'fsample001' }, 'duplicate-id');
  assert.equal(newest(run(school(), { floorId: 'fsample002', id: 'fmine00001' })).id, 'fmine00001', 'a free f id is taken as given');
});

// ---------------------------------------------------------------- what is copied

function detailed() {
  const project = clone(school());
  const floor = project.building.floors[1];
  // one of everything the copy has to carry
  floor.notStepFree = [floor.cells.indexOf('#')];
  const corridorCell = floor.cells.indexOf('#', floor.notStepFree[0] + 1);
  floor.refuges = [{ id: 'arefuge001', cell: corridorCell, name: 'By the stairs' }];
  project.building.zones.push({ id: 'zfloor2zon', floorId: floor.id, label: 'Lobby', x: 1, y: 1, w: 3, h: 2 });
  project.building.features = [{ id: 'hlab000001', name: 'Lab' }];
  const room = roomsOf(floor)[0];
  room.featureIds = ['hlab000001'];
  room.capacity = 28;
  room.shared = true;
  room.wing = 'North';
  room.subjectId = project.subjects[0].id;
  return { project, floor, room };
}

test('copied: rooms with doors, wing, capacity, shared, features and subject; other spaces; corridor names; zones; refuges; steps', () => {
  const { project, floor, room } = detailed();
  const after = run(project, { floorId: floor.id });
  const copy = newest(after);
  assert.equal(copy.cells, floor.cells, 'corridor and stairs cells');
  assert.equal(roomsOf(copy).length, roomsOf(floor).length);
  assert.equal(copy.spaces.length, floor.spaces.length);
  const twin = copy.spaces[floor.spaces.indexOf(room)];
  assert.deepEqual({ ...twin, id: '', number: '' }, { ...room, id: '', number: '', teacherIds: [] }, 'every field of the room but its id, its number and its teachers');
  assert.deepEqual(twin.featureIds, ['hlab000001']);
  assert.notEqual(twin.cells, room.cells, 'cells are a copy, not the same list');
  assert.notEqual(twin.doors, room.doors);
  for (const other of floor.spaces.filter((space) => space.kind === 'other')) {
    const same = copy.spaces[floor.spaces.indexOf(other)];
    assert.deepEqual({ ...same, id: '' }, { ...other, id: '' }, 'an other space: label, kind, colour and cells');
  }
  assert.equal(copy.corridors.length, floor.corridors.length);
  assert.deepEqual(copy.corridors.map((corridor) => [corridor.name, corridor.cells]), floor.corridors.map((corridor) => [corridor.name, corridor.cells]));
  const zones = after.building.zones.filter((zone) => zone.floorId === copy.id);
  assert.deepEqual(zones.map((zone) => ({ ...zone, id: '', floorId: '' })), [{ id: '', floorId: '', label: 'Lobby', x: 1, y: 1, w: 3, h: 2 }]);
  assert.deepEqual(copy.refuges.map((refuge) => [refuge.cell, refuge.name]), [[floor.refuges[0].cell, 'By the stairs']]);
  assert.deepEqual(copy.notStepFree, floor.notStepFree);
  // the source is as it was
  assert.deepEqual(after.building.floors[1], project.building.floors[1]);
});

test('copied: a door\'s step-free mark rides with the door', () => {
  const { project, floor } = detailed();
  const room = roomsOf(floor).find((candidate) => candidate.doors.length > 0);
  room.doors[0] = { ...room.doors[0], stepFree: false };
  const copy = newest(run(project, { floorId: floor.id }));
  assert.equal(copy.spaces[floor.spaces.indexOf(room)].doors[0].stepFree, false);
});

test('copied: every elevator stop of the source, connected or not, is a stop of the copy', () => {
  const project = clone(school());
  const floor = project.building.floors[1];
  floor.cells = floor.cells.slice(0, 60) + 'S' + floor.cells.slice(61);
  floor.lifts = [60];
  const loose = newest(run(project, { floorId: floor.id }));
  assert.deepEqual(loose.lifts, [60], 'a stop with no connection is copied unconnected');
  assert.equal(loose.cells[60], 'S');
  const fitted = lift(3);
  const after = run(fitted, { floorId: 'fsample002', join: false });
  assert.deepEqual(newest(after).lifts, [CELL], 'a stop that is only the end of an elevator connection is a stop of the copy too');
});

// ---------------------------------------------------------------- not copied

test('not copied: teachers in rooms, exits, the traced image, schedule references, scenario levers', () => {
  const { project, floor } = detailed();
  floor.image = { imageId: 'iimage0001', opacity: 0.4, scale: 1, rotation: 0, x: 0, y: 0, visible: true, locked: false, missing: false, width: 100, height: 60 };
  assert.ok(floor.exits.length > 0 || (floor.exits = [{ id: 'xexit00001', cell: floor.cells.indexOf('#'), doorName: '', assembly: '' }]).length);
  assert.ok(roomsOf(floor).some((room) => room.teacherIds.length > 0), 'the sample has teachers in these rooms');
  const after = run(project, { floorId: floor.id });
  const copy = newest(after);
  assert.deepEqual(copy.exits, [], 'exits are not copied');
  assert.equal(copy.image, null, 'the traced image is not copied');
  assert.ok(roomsOf(copy).every((room) => room.teacherIds.length === 0), 'a copied room has no teacher');
  assert.deepEqual(after.teachers, project.teachers, 'no teacher changes: nobody is based in the new rooms and no teacher lists them');
  const copied = new Set(copy.spaces.map((space) => space.id));
  const named = JSON.stringify([after.groups, after.teachers, after.duties || [], after.marks || []]);
  for (const id of copied) assert.ok(!named.includes(id), 'nothing in the schedule names ' + id);
  assert.deepEqual(after.groups, project.groups, 'no slot names a copied room');
  assert.equal(after.scenarios === undefined ? 0 : JSON.stringify(after.scenarios).includes(copy.id) ? 1 : 0, 0, 'no scenario knows the new floor');
});

// ---------------------------------------------------------------- ids

test('new ids of every kind, in the kind\'s own form, and none repeated anywhere in the project', () => {
  const { project, floor } = detailed();
  const before = new Set(collectIds(project));
  const after = run(project, { floorId: floor.id });
  const copy = newest(after);
  assert.ok(isId(copy.id, 'f'));
  for (const space of copy.spaces) assert.ok(isId(space.id, space.kind === 'room' ? 'r' : 'o'), 'a space id: ' + space.id);
  for (const corridor of copy.corridors) assert.ok(isId(corridor.id, 'k'));
  for (const refuge of copy.refuges) assert.ok(isId(refuge.id, 'a'));
  for (const zone of after.building.zones.filter((candidate) => candidate.floorId === copy.id)) assert.ok(isId(zone.id, 'z'));
  const ids = collectIds(after);
  assert.equal(new Set(ids).size, ids.length, 'every id in the project is used once');
  const fresh = ids.filter((id) => !before.has(id));
  const expected = 1 + copy.spaces.length + copy.corridors.length + copy.refuges.length + 1 + 1;
  assert.equal(fresh.length, expected, 'the floor, its spaces, corridor names, refuges, one zone and the one flight that joins it are new, and nothing else is');
});

test('an id the id maker would draw twice is not used twice', () => {
  const project = school();
  const taken = collectIds(project);
  let calls = 0;
  const maker = (prefix) => (calls++ < 3 ? taken.find((id) => id.startsWith(prefix)) : prefix + 'fresh' + String(calls).padStart(4, '0'));
  const after = duplicateFloor(freeze(project), { floorId: 'fsample002' }, { ids: maker, clock });
  const ids = collectIds(after);
  assert.equal(new Set(ids).size, ids.length);
});

// ---------------------------------------------------------------- numbers

function numbered(level, numbers) {
  const project = clone(school());
  const floor = project.building.floors[level - 1];
  floor.spaces.filter((space) => space.kind === 'room').forEach((room, n) => { room.number = numbers[n % numbers.length] + (n >= numbers.length ? String.fromCharCode(65 + n) : ''); });
  return { project, floor };
}

test('numbers: renumbered for the new level when every one starts with the source level and has a common length', () => {
  const project = tidy(clone(school()));
  const info = describeFloorDuplicate(project, 'fsample002');
  assert.equal(info.renumber.possible, true);
  assert.deepEqual(info.renumber.examples[0], { from: '201', to: '401' });
  assert.equal(info.renumber.count, roomsOf(project.building.floors[1]).length);
  const after = run(project, { floorId: 'fsample002' });
  const source = project.building.floors[1];
  const copy = newest(after);
  for (const room of roomsOf(source)) {
    const twin = copy.spaces[source.spaces.indexOf(room)];
    assert.equal(twin.number, '4' + room.number.slice(1), room.number + ' becomes ' + twin.number);
  }
});

// the sample's own day types cut to n, or grown to n with own copies of the last
// (each group's days going and coming with them)
function withDayTypes(project, n) {
  while (project.dayTypes.length > n) {
    const gone = project.dayTypes.pop();
    for (const group of project.groups) delete group.days[gone.id];
  }
  while (project.dayTypes.length < n) {
    const last = project.dayTypes[project.dayTypes.length - 1];
    const id = 'dsample00' + String.fromCharCode(97 + project.dayTypes.length);
    project.dayTypes.push({ ...clone(last), id, name: String.fromCharCode(65 + project.dayTypes.length) + ' Day', own: true });
    for (const group of project.groups) if (group.days[last.id]) group.days[id] = clone(group.days[last.id]);
  }
  return project;
}

test('notes: counted by the checks themselves, one "room no group uses" a numbered copy for each day type (1, 2 and 3), and none for a teacher', () => {
  for (const days of [1, 2, 3]) {
    const project = withDayTypes(tidy(clone(school())), days);
    const rooms = roomsOf(project.building.floors[1]).length;
    const info = describeFloorDuplicate(project, 'fsample002');
    assert.equal(info.notes, rooms * days, days + ' day types: ' + rooms + ' copies, each a room no group uses on each day type');
    assert.deepEqual(info.noteCounts, { 'room-unused': rooms * days }, 'no room-no-teacher: a copy has no group in it');
    // the count is the checks' own: the copy made and checked says the same
    const after = run(project, { floorId: 'fsample002', join: false });
    const copied = new Set(newest(after).spaces.map((space) => space.id));
    const raised = checkSchedule(after).findings.filter((finding) => copied.has(finding.where.roomId));
    assert.equal(raised.length, info.notes, days + ' day types: the Checks tab gets the notes the dialog counts');
    assert.equal(info.notesText, 'The ' + rooms + ' numbered copies will add ' + rooms * days + ' notes to the Checks tab: ' + rooms * days + ' for a room no group uses' + (days > 1 ? ' (one for each of the ' + days + ' day types)' : '') + '.');
  }
});

test('notes: a copy of a room with no subject adds "a room with no subject"; a day type the same as another, or a check turned off, adds none', () => {
  const project = withDayTypes(tidy(clone(school())), 1);
  const rooms = roomsOf(project.building.floors[1]);
  delete rooms[0].subjectId;
  project.dayTypes.push({ id: 'dsample00z', name: 'Z Day', sameAs: 'dsample00a' });
  const info = describeFloorDuplicate(project, 'fsample002');
  assert.deepEqual(info.noteCounts, { 'room-unused': rooms.length, 'room-no-subject': 1 });
  assert.equal(info.notesText, 'The ' + rooms.length + ' numbered copies will add ' + (rooms.length + 1) + ' notes to the Checks tab: ' + rooms.length + ' for a room no group uses and 1 for a room with no subject.');
  // a project is never changed in place, and the dialog's count is kept per project: a new one
  const quiet = clone(project);
  quiet.settings.checks = { ...quiet.settings.checks, off: ['room-unused', 'room-no-subject'] };
  const off = describeFloorDuplicate(quiet, 'fsample002');
  assert.equal(off.notes, 0);
  assert.equal(off.notesText, '');
});

test('notes: a floor with no numbered rooms raises none', () => {
  const project = clone(school());
  for (const room of roomsOf(project.building.floors[1])) room.number = '';
  const info = describeFloorDuplicate(project, 'fsample002');
  assert.equal(info.renumber.possible, false);
  assert.equal(info.notes, 0);
  assert.equal(info.notesText, '');
});

test('numbers: a letter after the digits stays ("214B" becomes "414B"), and a room with no number stays without one', () => {
  const project = tidy(clone(school()));
  const floor = project.building.floors[1];
  const rooms = roomsOf(floor);
  rooms[0].number = '214B';
  rooms[1].number = '';
  const copy = newest(run(project, { floorId: floor.id }));
  assert.equal(copy.spaces[floor.spaces.indexOf(rooms[0])].number, '414B');
  assert.equal(copy.spaces[floor.spaces.indexOf(rooms[1])].number, '');
});

// Devon, 2026-11-21 (QUESTIONS 19): "Duplicates should be 'library 2'".
test('the sample\'s Floor 2, room by room: 201 to 204 become 401 to 404 and Library becomes Library 2, by default', () => {
  const project = school();
  const info = describeFloorDuplicate(project, 'fsample002');
  assert.equal(info.renumber.possible, true);
  assert.equal(info.renumber.count, 4);
  assert.equal(info.renumber.counted, 1);
  assert.equal(info.renumber.text, 'Rooms 201 to 204 become 401 to 404; Library becomes Library 2.');
  const after = run(project, { floorId: 'fsample002' });
  assert.deepEqual(roomsOf(newest(after)).map((room) => room.number), ['401', '402', '403', '404', 'Library 2']);
  assert.deepEqual(roomsOf(after.building.floors[1]).map((room) => room.number), ['201', '202', '203', '204', 'Library'], 'the source keeps its numbers');
  const outcome = scheduleOutcome(after);
  assert.equal(outcome.renumbered, 4);
  assert.equal(outcome.counted, 1);
  assert.equal(outcome.blanked, 0);
});

test('numbers: "Library 2" taken anywhere in the school (any case) makes it "Library 3"; a copy\'s copy goes on counting', () => {
  const project = clone(school());
  roomsOf(project.building.floors[0])[3].number = 'library 2';
  const info = describeFloorDuplicate(project, 'fsample002');
  assert.equal(info.renumber.text, 'Rooms 201 to 204 become 401 to 404; Library becomes Library 3.');
  assert.equal(roomsOf(newest(run(project, { floorId: 'fsample002' })))[4].number, 'Library 3');
  // the copy, Floor 4, copied again: Floor 5's numbers take level 5, and Library 3 is Library 4 (not "Library 3 2")
  let twice = run(project, { floorId: 'fsample002' });
  twice = run(twice, { floorId: newest(twice).id });
  assert.deepEqual(roomsOf(newest(twice)).map((room) => room.number), ['501', '502', '503', '504', 'Library 4']);
});

test('numbers: the sample\'s Floor 1, two rooms with words: "Cafeteria 2" and "Gym 2" in one sentence', () => {
  const info = describeFloorDuplicate(school(), 'fsample001');
  assert.equal(info.renumber.text, 'Rooms 101 to 103 become 401 to 403; Cafeteria becomes Cafeteria 2 and Gym becomes Gym 2.');
});

test('numbers: "blank", the user\'s choice, leaves every copy without one, and the dialog count says how many', () => {
  const project = school();
  const after = run(project, { floorId: 'fsample002', numbers: 'blank' });
  assert.ok(roomsOf(newest(after)).every((room) => room.number === ''));
  assert.equal(scheduleOutcome(after).blanked, roomsOf(project.building.floors[1]).length);
  assert.equal(scheduleOutcome(after).renumbered, 0);
  assert.equal(scheduleOutcome(after).counted, 0);
});

test('numbers: a room that cannot follow the floor rule keeps its own number with " 2", never a blank, whatever the reason', () => {
  const numbers = (level, list) => {
    const { project, floor } = numbered(level, list);
    return roomsOf(newest(run(project, { floorId: floor.id }))).map((room) => room.number);
  };
  // not the level, a letter first, too few digits ("21" on level 2), 1 digit on level 1
  assert.deepEqual(numbers(2, ['501', 'B-201', '21', '201', '202']), ['501 2', 'B-201 2', '21 2', '401', '402']);
  assert.deepEqual(numbers(1, ['1-01', '10', '0101', '1001', '101']), ['1-01 2', '10 2', '0101 2', '4001', '401']);
  // lengths apart no longer spoil it for all: each room by itself
  assert.deepEqual(numbers(2, ['201', '2014', 'Pool', '202', '203']), ['401', '4014', 'Pool 2', '402', '403']);
});

test('numbers: the dialog\'s sentence for one room, two, a run with a gap, and more than three with a count', () => {
  const text = (list) => describeFloorDuplicate(numbered(2, list).project, 'fsample002').renumber.text;
  const sample = roomsOf(school().building.floors[1]).length;
  assert.equal(sample, 5);
  assert.equal(text(['201', 'A', 'B', 'C', 'D']), 'Room 201 becomes 401; A becomes A 2, B becomes B 2 and 2 more rooms keep their own numbers with a count after them.');
  assert.equal(text(['201', '203', 'Hall', 'Pool', 'Art']), 'Rooms 201 and 203 become 401 and 403; Hall becomes Hall 2, Pool becomes Pool 2 and Art becomes Art 2.');
  assert.equal(text(['201', '202', '214B', '205', 'Pool']), 'The 4 rooms from 201 to 214B become 401 to 414B; Pool becomes Pool 2.');
  assert.equal(text(['501', '502', '503', '504', '505']), '501 becomes 501 2, 502 becomes 502 2 and 3 more rooms keep their own numbers with a count after them.');
});

test('numbers: "1001" on level 1 carries over as 22.17 says, the level\'s one digit replaced: "4001" on level 4', () => {
  const { project } = numbered(1, ['1001', '1002', '1003', '1004', '1005']);
  const info = describeFloorDuplicate(project, 'fsample001');
  assert.equal(info.newLevel, 4);
  assert.equal(info.renumber.possible, true);
  assert.deepEqual(info.renumber.examples, [{ from: '1001', to: '4001' }, { from: '1002', to: '4002' }]);
});

test('numbers: the new level with another number of digits (level 9 to 10), or a source at level 0, keeps each own number with " 2"', () => {
  const project = clone(school());
  project.building.floors[2].level = 9;
  const floor = project.building.floors[2];
  roomsOf(floor).forEach((room, n) => { room.number = '90' + (n + 1); });
  const info = describeFloorDuplicate(project, floor.id);
  assert.equal(info.newLevel, 10);
  assert.equal(info.renumber.count, 0);
  assert.equal(info.renumber.text, '901 becomes 901 2, 902 becomes 902 2 and 903 becomes 903 2.');
  const ground = clone(school());
  ground.building.floors[0].level = 0;
  assert.deepEqual(roomsOf(newest(run(ground, { floorId: 'fsample001' }))).map((room) => room.number), ['101 2', '102 2', '103 2', 'Cafeteria 2', 'Gym 2']);
});

test('numbers: a renumbered number already in the school keeps that room\'s own number with " 2"; the others are renumbered', () => {
  const project = tidy(clone(school()));
  const floor = project.building.floors[1];
  roomsOf(project.building.floors[0])[0].number = '401';
  const after = run(project, { floorId: floor.id });
  assert.deepEqual(roomsOf(newest(after)).map((room) => room.number), ['201 2', '402', '403', '404', '405']);
  assert.equal(describeFloorDuplicate(project, floor.id).renumber.text, 'Rooms 202 to 205 become 402 to 405; 201 becomes 201 2.');
});

test('numbers: a floor with no numbered rooms has nothing to renumber: no rows, and "level" does nothing and is not refused', () => {
  const project = chain(3);
  for (const room of roomsOf(project.building.floors[1])) room.number = '';
  const info = describeFloorDuplicate(project, 'fsample002');
  assert.equal(info.numbered, 0);
  assert.equal(info.renumber.possible, false);
  assert.equal(info.renumber.reason, 'none');
  for (const numbers of [undefined, 'level', 'blank']) {
    const after = run(project, { floorId: 'fsample002', numbers });
    assert.ok(roomsOf(newest(after)).every((room) => room.number === ''));
    assert.equal(scheduleOutcome(after).renumbered + scheduleOutcome(after).counted + scheduleOutcome(after).blanked, 0);
  }
});

// ---------------------------------------------------------------- joins

function connectionsTouching(project, floorId) {
  return project.building.connections.filter((connection) => connection.a.floorId === floorId || connection.b.floorId === floorId);
}

test('join: the new flight runs from the old top floor\'s cell to the same cell of the new floor, both ways by default', () => {
  const project = chain(3);
  const info = describeFloorDuplicate(project, 'fsample003');
  assert.equal(info.joins.length, 1);
  const after = run(project, { floorId: 'fsample003' });
  const copy = newest(after);
  const flights = connectionsTouching(after, copy.id);
  assert.equal(flights.length, 1);
  assert.equal(flights[0].a.floorId, 'fsample003', 'from the old top floor');
  assert.equal(flights[0].b.floorId, copy.id);
  assert.equal(flights[0].a.cell, CELL);
  assert.equal(flights[0].b.cell, CELL, 'the same cell');
  assert.equal(flights[0].direction, 'both');
});

test('join: a single flight with nothing else in its run: the two become Stairwell <that flight\'s label>', () => {
  const project = chain(2);
  const after = run(project, { floorId: 'fsample002' });
  const [old, fresh] = after.building.connections;
  assert.equal(old.well, 'A', 'the flight that was there is lettered with its own label');
  assert.equal(old.label, 'A', 'and its own label does not change');
  assert.equal(fresh.well, 'A');
  assert.equal(fresh.label, 'B', 'the new flight keeps a label no other flight has');
  assert.deepEqual(stairwells(after.building).map((well) => [well.letter, well.parts, well.stops.length]), [['A', 1, 3]]);
  assert.equal(stairsLetter(old), 'A');
  assert.equal(stairsLetter(fresh), 'A');
  const info = describeFloorDuplicate(project, 'fsample002');
  assert.equal(info.joinText, 'Stairs A will run from Floor 1 to Floor 3 as one stairwell.');
  assert.doesNotMatch(info.joinText, /called|renam|become/i, 'it names no letter change, because none is made');
});

test('join: a stairwell the old top floor belongs to is joined, with its letter', () => {
  const project = chain(3, { well: 'A' });
  const info = describeFloorDuplicate(project, 'fsample003');
  assert.equal(info.joins[0].type, 'well-extend');
  assert.equal(info.joinText, 'Stairwell A will run on to Floor 4.');
  const after = run(project, { floorId: 'fsample003' });
  const wells = stairwells(after.building);
  assert.deepEqual(wells.map((well) => [well.letter, well.parts, well.stops.length]), [['A', 1, 4]]);
  const fresh = connectionsTouching(after, newest(after).id)[0];
  assert.equal(fresh.well, 'A');
  assert.equal(fresh.label, 'C', 'a label the two flights of the well do not have');
  assert.ok(after.building.connections.slice(0, 2).every((connection, n) => connection.label === 'AB'[n] && connection.well === 'A'), 'no flight already there changes');
});

test('join: two or more plain flights in the run leave a plain flight, and the dialog says they stay separate', () => {
  const project = chain(3);
  const info = describeFloorDuplicate(project, 'fsample003');
  assert.equal(info.joins[0].type, 'plain');
  assert.match(info.separateText, /^Stairs A and B stay separate stairs; Make one stairwell is in the stair's properties\.$/);
  assert.equal(info.joinText, 'Stairs C, a new flight, will join Floor 3 to Floor 4 (Stairs A and B stay separate stairs; Make one stairwell is in the stair\'s properties).', 'a capital first, and the new flight named by its letter');
  const after = run(project, { floorId: 'fsample003' });
  assert.equal(scheduleOutcome(after).text, 'Duplicated Floor 3 as Floor 4: ' + info.joinText);
  assert.deepEqual(after.building.connections.slice(0, 2), project.building.connections, 'flights A and B are untouched');
  const fresh = connectionsTouching(after, newest(after).id)[0];
  assert.equal(fresh.well, undefined, 'a plain flight');
  assert.equal(fresh.label, 'C');
  assert.equal(info.joins[0].newLetter, fresh.label, 'the letter the dialog named is the one it got');
  assert.deepEqual(stairwells(after.building), []);
  assert.deepEqual(after.building.connections.map(stairsLetter), ['A', 'B', 'C']);
});

test('join: a floor below the copy of another size joins nothing, and the dialog says why', () => {
  const project = chain(2);
  const top = newFloor('fsample002', 'Floor 2', 2, 40, 15);
  top.cells = top.cells.slice(0, CELL) + 'S' + top.cells.slice(CELL + 1);
  project.building.floors[1] = top;
  const info = describeFloorDuplicate(project, 'fsample001');
  assert.deepEqual(info.joins, []);
  assert.equal(info.notJoinedText, 'Nothing is joined: Floor 2 is 40 × 15 cells and Floor 1 is 40 × 14, so the copy\'s stairs and elevator stops do not line up with Floor 2\'s.');
  const after = run(project, { floorId: 'fsample001' });
  assert.deepEqual(connectionsTouching(after, newest(after).id), []);
  assert.equal(describeFloorDuplicate(chain(2), 'fsample001').notJoinedText, '', 'the same size: nothing to say');
});

test('not copied: stairs with both ends on the source floor are named', () => {
  const project = chain(2);
  const floor = project.building.floors[0];
  floor.cells = floor.cells.slice(0, CELL + 5) + 'S' + floor.cells.slice(CELL + 6);
  project.building.connections.push({ id: 'cwithin001', label: 'E', a: { floorId: floor.id, cell: CELL }, b: { floorId: floor.id, cell: CELL + 5 }, direction: 'both' });
  const info = describeFloorDuplicate(project, floor.id);
  assert.equal(info.notCopied, 'teachers in rooms, exits, the traced image, Stairs E, which joins two cells of Floor 1');
  const after = run(project, { floorId: floor.id });
  assert.ok(after.building.connections.every((connection) => !(connection.a.floorId === newest(after).id && connection.b.floorId === newest(after).id)), 'not copied indeed');
});

test('join: Join off leaves the copy\'s stairs unconnected', () => {
  const project = chain(2);
  const after = run(project, { floorId: 'fsample002', join: false });
  assert.deepEqual(after.building.connections, project.building.connections);
  assert.equal(newest(after).cells[CELL], 'S', 'the stairs cell is still drawn');
});

test('join: a stairs cell of the source with no flight at the old top floor is copied unconnected', () => {
  const project = chain(3);
  const copy = newest(run(project, { floorId: 'fsample001' }));
  assert.equal(copy.cells[CELL], 'S');
  const info = describeFloorDuplicate(project, 'fsample001');
  assert.equal(info.joins.length, 1, 'the old top floor has flight B there, so the stairs at that cell join');
  const loose = clone(project);
  loose.building.connections = [];
  assert.equal(describeFloorDuplicate(loose, 'fsample002').joins.length, 0);
  assert.equal(describeFloorDuplicate(loose, 'fsample002').joinText, '');
  assert.deepEqual(run(loose, { floorId: 'fsample002' }).building.connections, []);
});

test('join: a cell that is stairs on the source but corridor on the old top floor does not join', () => {
  const project = chain(3);
  const top = project.building.floors[2];
  top.cells = top.cells.slice(0, CELL) + '#' + top.cells.slice(CELL + 1);
  project.building.connections.pop();
  const info = describeFloorDuplicate(project, 'fsample002');
  assert.equal(info.joins.length, 0);
});

test('join: the full sample\'s Floor 2: B and D join, and the dialog names Stairs A and C, copied but not joined, and why (SV2-139)', () => {
  const info = describeFloorDuplicate(sampleSchool(), 'fsample002');
  assert.deepEqual(info.joins.map((join) => join.type), ['well-new', 'elevator']);
  assert.equal(info.unjoinedText, 'Stairs A and C are copied but not joined: Floor 3 has no stairs in the same row and column. The building checks will list their copies on Floor 4 as not connected until you connect them.');
  const typed = describeFloorDuplicate(sampleSchool(), 'fsample002', { name: 'Annex' });
  assert.match(typed.unjoinedText, /their copies on Annex as not connected/, 'the name typed is the name it uses');
  // and it is so: the copies of A and C have no flight
  const after = run(sampleSchool(), { floorId: 'fsample002' });
  const copy = newest(after);
  for (const cell of [328, 332]) {
    assert.equal(copy.cells[cell], 'S');
    assert.ok(after.building.connections.every((connection) => !(connection.a.floorId === copy.id && connection.a.cell === cell) && !(connection.b.floorId === copy.id && connection.b.cell === cell)), 'cell ' + cell + ' is unconnected');
  }
});

test('join: every connected stair or stop that is not joined is named with its own reason; all joined, or the sizes apart, say nothing here', () => {
  assert.equal(describeFloorDuplicate(chain(3), 'fsample003').unjoinedText, '', 'the top floor\'s stairs join');
  assert.equal(describeFloorDuplicate(chain(3), 'fsample001').unjoinedText, '', 'flight A is not joined, but B at the same cell is: that cell joins');
  const corridor = chain(3);
  corridor.building.floors[2].cells = corridor.building.floors[2].cells.slice(0, CELL) + '#' + corridor.building.floors[2].cells.slice(CELL + 1);
  corridor.building.connections.pop();
  assert.equal(describeFloorDuplicate(corridor, 'fsample002').unjoinedText, 'Stairs A is copied but not joined: Floor 3 has no stairs in the same row and column. The building checks will list its copy on Floor 4 as not connected until you connect it.');
  const loose = chain(3);
  loose.building.connections.pop();
  assert.match(describeFloorDuplicate(loose, 'fsample002').unjoinedText, /^Stairs A is copied but not joined: Floor 3's stairs there are not connected to any floor\./);
  const liftAbove = chain(3);
  liftAbove.building.floors[2].lifts = [CELL];
  liftAbove.building.connections.pop();
  assert.match(describeFloorDuplicate(liftAbove, 'fsample002').unjoinedText, /^Stairs A is copied but not joined: Floor 3 has an elevator stop there, not stairs\./);
  const car = lift(3);
  car.building.connections.pop();
  car.building.floors[2].cells = car.building.floors[2].cells.slice(0, CELL) + '#' + car.building.floors[2].cells.slice(CELL + 1);
  assert.match(describeFloorDuplicate(car, 'fsample002').unjoinedText, /^Elevator D is copied but not joined: Floor 3 has no elevator stop in the same row and column\./);
  const apart = chain(2);
  const top = newFloor('fsample002', 'Floor 2', 2, 40, 15);
  top.cells = top.cells.slice(0, CELL) + 'S' + top.cells.slice(CELL + 1);
  apart.building.floors[1] = top;
  assert.equal(describeFloorDuplicate(apart, 'fsample001').unjoinedText, '', 'notJoinedText says it for all of them');
  const bare = chain(3);
  bare.building.connections = [];
  assert.equal(describeFloorDuplicate(bare, 'fsample002').unjoinedText, '', 'a stair with no connection on the source is not named');
});

test('join: stairs at the source and an elevator stop at the top floor do not join, nor the other way round', () => {
  const project = chain(3);
  project.building.floors[2].lifts = [CELL];
  project.building.connections.pop();
  assert.equal(describeFloorDuplicate(project, 'fsample002').joins.length, 0);
  const other = lift(3);
  other.building.connections.pop();
  other.building.floors[2].cells = other.building.floors[2].cells.slice(0, CELL) + '#' + other.building.floors[2].cells.slice(CELL + 1);
  assert.equal(describeFloorDuplicate(other, 'fsample002').joins.length, 0);
});

test('join: the way of the flight or the well, translated for the new flight, which runs from below to above', () => {
  const up = chain(2, { direction: 'ab' });
  let copy = connectionsTouching(run(up, { floorId: 'fsample002' }), newest(run(up, { floorId: 'fsample002' })).id)[0];
  assert.equal(copy.direction, 'ab', 'up only: from the old top floor to the new one');
  const down = chain(2, { direction: 'ba' });
  copy = connectionsTouching(run(down, { floorId: 'fsample002' }), newest(run(down, { floorId: 'fsample002' })).id)[0];
  assert.equal(down.building.connections[0].direction, 'ba');
  assert.equal(copy.direction, 'ba', 'down only: from the new floor to the old top one');
  // the lower end first or second makes no difference: a flight drawn from its upper end
  const swapped = chain(2, { direction: 'ba' });
  const flight = swapped.building.connections[0];
  [flight.a, flight.b] = [flight.b, flight.a];
  flight.direction = 'ab';
  const flipped = run(swapped, { floorId: 'fsample002' });
  assert.equal(connectionsTouching(flipped, newest(flipped).id)[0].direction, 'ba', 'a at the upper end running ab is down only, so the new flight runs down');
});

test('join: a well whose flights all run up gives up the new flight; flights that differ give both ways', () => {
  const same = chain(3, { well: 'A', direction: 'ab' });
  const joined = run(same, { floorId: 'fsample003' });
  assert.equal(connectionsTouching(joined, newest(joined).id)[0].direction, 'ab');
  const mixed = chain(3, { well: 'A' });
  mixed.building.connections[0].direction = 'ab';
  const both = run(mixed, { floorId: 'fsample003' });
  assert.equal(connectionsTouching(both, newest(both).id)[0].direction, 'both');
});

test('elevator cars: the new floor\'s stop joins the car, with its letter and its access', () => {
  const project = lift(3);
  const info = describeFloorDuplicate(project, 'fsample003');
  assert.equal(info.joins.length, 1);
  assert.equal(info.joins[0].type, 'elevator');
  assert.equal(info.joinText, 'Elevator D gets a stop on Floor 4.');
  const after = run(project, { floorId: 'fsample003' });
  const copy = newest(after);
  const cars = elevatorCars(after.building);
  assert.equal(cars.length, 1, 'still one car');
  assert.equal(cars[0].label, 'D');
  assert.deepEqual(cars[0].stops.map((stop) => stop.floorId), ['fsample001', 'fsample002', 'fsample003', copy.id]);
  const fresh = connectionsTouching(after, copy.id)[0];
  assert.equal(fresh.kind, ELEVATOR_KIND);
  assert.equal(fresh.car, 'D');
  assert.equal(fresh.direction, 'both');
  assert.equal(fresh.staffOnly, undefined);
  assert.ok(isLiftCell(after.building, copy.id, CELL));
});

test('elevator cars: staff only is the car\'s', () => {
  const project = lift(3, true);
  const after = run(project, { floorId: 'fsample003' });
  assert.ok(connectionsTouching(after, newest(after).id).every((connection) => connection.staffOnly === true));
  assert.equal(elevatorCars(after.building)[0].staffOnly, true);
});

test('a stairs cell and an elevator stop on one floor are each joined by their own rule', () => {
  const project = chain(2);
  const base = lift(2);
  for (const floor of project.building.floors) floor.cells = floor.cells.slice(0, 60) + 'S' + floor.cells.slice(61);
  project.building.connections.push({ id: 'cliftcar01', label: 'D', kind: ELEVATOR_KIND, car: 'D', a: { floorId: 'fsample001', cell: 60 }, b: { floorId: 'fsample002', cell: 60 }, direction: 'both' });
  const info = describeFloorDuplicate(project, 'fsample002');
  assert.deepEqual(info.joins.map((join) => join.type).sort(), ['elevator', 'well-new']);
  assert.equal(info.joinText, 'Stairs A will run from Floor 1 to Floor 3 as one stairwell; Elevator D gets a stop on Floor 3.');
  const after = run(project, { floorId: 'fsample002' });
  assert.equal(stairwells(after.building).length, 1);
  assert.equal(elevatorCars(after.building)[0].stops.length, 3);
  assert.ok(base);
});

// ---------------------------------------------------------------- the dialog's words

test('describe: the sentence, what is copied, what is not, and the numbers', () => {
  const project = school();
  const info = describeFloorDuplicate(project, 'fsample002');
  const source = project.building.floors[1];
  const rooms = roomsOf(source).length;
  const others = source.spaces.length - rooms;
  assert.equal(info.name, 'Floor 2');
  assert.equal(info.newName, 'Floor 4');
  assert.equal(info.newLevel, 4);
  assert.equal(info.rooms, rooms);
  assert.equal(info.otherSpaces, others);
  assert.equal(info.namedCorridors, source.corridors.length);
  assert.equal(info.sentence, 'The copy goes on top of the building, as Floor 4, with Floor 2\'s corridors, stairs, rooms and other spaces: ' + rooms + ' rooms, ' + others + ' other spaces, ' + source.corridors.length + ' named corridor' + (source.corridors.length === 1 ? '' : 's') + '.');
  assert.equal(info.notCopied, 'teachers in rooms, exits, the traced image');
  assert.equal(describeFloorDuplicate(project, 'fgone000000'), null);
});

test('describe: a floor with nothing but an empty grid, and singular counts', () => {
  const project = chain(2);
  project.building.floors[1] = newFloor('fsample002', 'Floor 2', 2, 40, 14);
  project.building.connections = [];
  assert.equal(describeFloorDuplicate(project, 'fsample002').sentence, 'The copy goes on top of the building, as Floor 3, with Floor 2\'s corridors, stairs, rooms and other spaces: an empty grid of the same size.');
  const one = clone(project);
  one.building.floors[1].spaces = [newRoom('rsolo000001', [0]), newOtherSpace('osolo000001', [1])];
  one.building.floors[1].corridors = [{ id: 'ksolo000001', name: 'Hall', cells: [] }];
  assert.match(describeFloorDuplicate(one, 'fsample002').sentence, /: 1 room, 1 other space, 1 named corridor\.$/);
});

test('describe: changes nothing, and the same answer twice', () => {
  const project = freeze(school());
  assert.deepEqual(describeFloorDuplicate(project, 'fsample002'), describeFloorDuplicate(project, 'fsample002'));
});

// ---------------------------------------------------------------- the action in the store

test('one undo step: its label, the three counters, the outcome, undo gives back the very project, focus on the new floor', () => {
  const start = freeze(school());
  const store = createStore({ project: start, clock, ids: makeIds(11) });
  const [geometry, building, schedule] = [store.geometryVersion, store.buildingVersion, store.scheduleVersion];
  store.apply(duplicateFloor, { floorId: 'fsample002' });
  assert.equal(store.history.past.length, 1, 'one undo step');
  assert.equal(store.undoLabel, 'Duplicate Floor 2 as Floor 4');
  assert.ok(store.geometryVersion > geometry, 'GEOMETRY moved');
  assert.ok(store.buildingVersion > building, 'BUILDING moved');
  assert.ok(store.scheduleVersion > schedule, 'SCHEDULE moved');
  assert.deepEqual(duplicateFloor.bumps, [GEOMETRY, BUILDING, SCHEDULE]);
  const outcome = store.undoOutcome;
  assert.equal(outcome.newName, 'Floor 4');
  assert.match(outcome.text, /^Duplicated Floor 2 as Floor 4/);
  assertValid(store.project, 'valid after');
  const done = store.project;
  const focus = actions.describeAction(duplicateFloor, start, { floorId: 'fsample002' }, done).focus;
  assert.deepEqual(focus, { section: 'building', floorId: newest(done).id });
  store.undo();
  assert.deepEqual(store.project, start, 'undo gives back the project as it was');
  store.redo();
  assert.equal(newest(store.project).name, 'Floor 4', 'redo duplicates it again');
});

test('the project after is valid for every floor of the sample, with and without joining and numbering', () => {
  for (const floor of school().building.floors) {
    for (const join of [true, false]) {
      for (const numbers of [undefined, 'blank']) {
        const after = run(school(), { floorId: floor.id, join, numbers });
        assert.equal(after.building.floors.length, 4);
      }
    }
  }
});

test('a copy of a copy goes on top again, and the second copy joins the first\'s well', () => {
  let project = chain(2);
  project = run(project, { floorId: 'fsample002' });
  project = run(project, { floorId: newest(project).id });
  assert.deepEqual(project.building.floors.map((floor) => floor.name), ['Floor 1', 'Floor 2', 'Floor 3', 'Floor 4']);
  assert.deepEqual(stairwells(project.building).map((well) => [well.letter, well.stops.length]), [['A', 4]]);
});

test('describe: a name typed in the dialog is the name the sentences use, as typed', () => {
  const project = chain(2);
  const info = describeFloorDuplicate(project, 'fsample002', { name: '  <b>Annex</b>  ' });
  assert.equal(info.newName, '<b>Annex</b>');
  assert.match(info.sentence, /as <b>Annex<\/b>,/);
  assert.match(info.joinText, /to <b>Annex<\/b> as one stairwell/);
  assert.equal(describeFloorDuplicate(project, 'fsample002', { name: '   ' }).newName, 'Floor 3', 'a blank name is no name: the default stands');
});
