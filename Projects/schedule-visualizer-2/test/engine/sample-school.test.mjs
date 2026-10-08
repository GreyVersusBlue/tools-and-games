// The sample school's file comment makes claims. Each one is checked here
// from the data alone, with a plain breadth-first walk over the cells: this
// file does not use the routing or checks engines (they come later, and a
// sample that only passed their tests would prove nothing about the sample).

import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleSchool, SAMPLE_PROBLEMS, SAMPLE_PROJECT_ID, SAMPLE_SCHOOL_NAME } from '../../data/sample-school.js';
import { validate } from '../../engine/validate.js';
import { repair } from '../../engine/repair.js';
import { migrate } from '../../engine/migrate.js';
import { allRooms, findRoom, neighbourCell, isHexColour, GROUP_COLOUR_PRESETS } from '../../engine/schema.js';
import { bellsFor, bellFindings } from '../../engine/bells.js';
import { isOwnCopy, effectiveSchedule } from '../../engine/day-types.js';
import { isId } from '../../engine/ids.js';

const project = sampleSchool();
const DAYS = ['dsample00a', 'dsample00b'];

// Walking between two rooms, counted two ways so the claims hold however the
// router ends up counting the first and last step: `low` charges one step
// fewer and 8 seconds a stair connection, `high` charges every cell and 9.
function walkTable() {
  const floors = project.building.floors;
  const offset = new Map();
  let total = 0;
  for (const floor of floors) {
    offset.set(floor.id, total);
    total += floor.width * floor.height;
  }
  const where = (node) => {
    const floor = floors.find((f) => node >= offset.get(f.id) && node < offset.get(f.id) + f.width * f.height);
    return { floor, cell: node - offset.get(floor.id) };
  };
  const walkable = (floor, cell) => floor.cells[cell] === '#' || floor.cells[cell] === 'S';
  const next = (node) => {
    const { floor, cell } = where(node);
    const out = [];
    for (const side of ['n', 'e', 's', 'w']) {
      const to = neighbourCell(floor, cell, side);
      if (to !== -1 && walkable(floor, to)) out.push([offset.get(floor.id) + to, 0]);
    }
    for (const connection of project.building.connections) {
      const a = offset.get(connection.a.floorId) + connection.a.cell;
      const b = offset.get(connection.b.floorId) + connection.b.cell;
      if (a === node) out.push([b, 1]);
      if (b === node) out.push([a, 1]);
    }
    return out;
  };
  const entries = (room) => {
    const floor = floors.find((f) => f.spaces.includes(room));
    return room.doors.map((door) => offset.get(floor.id) + neighbourCell(floor, door.cell, door.side));
  };
  const table = new Map();
  for (const from of allRooms(project)) {
    // a stair connection costs under three cells, so order by cells*3 + stairs*8
    const best = new Map();
    let frontier = entries(from).map((node) => ({ node, cells: 1, stairs: 0 }));
    for (const state of frontier) best.set(state.node, state);
    const cost = (state) => state.cells * 3 + state.stairs * 8;
    while (frontier.length > 0) {
      frontier.sort((a, b) => cost(a) - cost(b));
      const state = frontier.shift();
      if (best.get(state.node) !== state) continue;
      for (const [node, stair] of next(state.node)) {
        const reached = { node, cells: state.cells + 1, stairs: state.stairs + stair };
        if (!best.has(node) || cost(reached) < cost(best.get(node))) {
          best.set(node, reached);
          frontier.push(reached);
        }
      }
    }
    for (const to of allRooms(project)) {
      if (to === from) {
        table.set(from.id + '>' + to.id, { cells: 0, stairs: 0, low: 0, high: 0 });
        continue;
      }
      let found = null;
      for (const node of entries(to)) {
        const state = best.get(node);
        if (state && (!found || cost(state) < cost(found))) found = state;
      }
      assert.ok(found, 'there is a way from ' + from.number + ' to ' + to.number);
      table.set(from.id + '>' + to.id, { cells: found.cells, stairs: found.stairs, low: (found.cells - 1) * 3 + found.stairs * 8, high: found.cells * 3 + found.stairs * 9 });
    }
  }
  return table;
}

const WALKS = walkTable();

function occupancy(dayTypeId) {
  const periods = [];
  for (let p = 0; p < project.settings.periods; p += 1) {
    const byRoom = new Map();
    for (const group of project.groups) {
      const slot = effectiveSchedule(project, group.id, dayTypeId)[p];
      if (!byRoom.has(slot.room)) byRoom.set(slot.room, []);
      byRoom.get(slot.room).push(group.id);
    }
    periods.push(byRoom);
  }
  return periods;
}

test('the sample school validates clean, and repair has nothing to do', () => {
  assert.deepEqual(validate(project), []);
  const result = repair(migrate(project));
  assert.equal(result.project, project);
  assert.deepEqual(result.notes, []);
});

test('every call gives a fresh, equal project, with fixed dates', () => {
  const a = sampleSchool();
  const b = sampleSchool();
  assert.deepEqual(a, b);
  assert.notEqual(a.groups, b.groups);
  assert.notEqual(a.building.floors[0].spaces[0].cells, b.building.floors[0].spaces[0].cells);
  assert.equal(a.created, '2026-09-01T12:00:00.000Z');
  assert.equal(a.modified, '2026-09-01T12:00:00.000Z');
});

test('it is labelled as a sample and has an id of its own', () => {
  assert.equal(project.id, SAMPLE_PROJECT_ID);
  assert.equal(project.settings.schoolName, SAMPLE_SCHOOL_NAME);
  assert.match(project.settings.schoolName, /sample/i);
});

test('every id has the shape and the prefix of what it names', () => {
  assert.ok(isId(project.id, 'p'));
  for (const floor of project.building.floors) {
    assert.ok(isId(floor.id, 'f'), floor.id);
    for (const space of floor.spaces) assert.ok(isId(space.id, space.kind === 'room' ? 'r' : 'o'), space.id);
    for (const corridor of floor.corridors) assert.ok(isId(corridor.id, 'k'), corridor.id);
    for (const exit of floor.exits) assert.ok(isId(exit.id, 'x'), exit.id);
  }
  for (const connection of project.building.connections) assert.ok(isId(connection.id, 'c'));
  for (const zone of project.building.zones) assert.ok(isId(zone.id, 'z'));
  for (const subject of project.subjects) assert.ok(isId(subject.id, 's'));
  for (const teacher of project.teachers) assert.ok(isId(teacher.id, 't'));
  for (const group of project.groups) assert.ok(isId(group.id, 'g'));
  for (const dayType of project.dayTypes) assert.ok(isId(dayType.id, 'd'));
});

test('three floors on levels 1, 2 and 3', () => {
  assert.deepEqual(project.building.floors.map((f) => [f.name, f.level, f.width, f.height]), [['Floor 1', 1, 40, 14], ['Floor 2', 2, 40, 14], ['Floor 3', 3, 40, 14]]);
});

test('about twelve rooms plus other spaces: thirteen rooms, ten other spaces', () => {
  const rooms = allRooms(project);
  assert.equal(rooms.length, 13);
  assert.deepEqual(rooms.map((r) => r.number), ['101', '102', '103', 'Cafeteria', 'Gym', '201', '202', '203', '204', 'Library', '303', '302', '301']);
  assert.deepEqual(rooms.filter((r) => r.shared).map((r) => r.number), ['Cafeteria', 'Gym', 'Library']);
  const others = project.building.floors.flatMap((f) => f.spaces.filter((s) => s.kind === 'other'));
  assert.equal(others.length, 10);
  assert.ok(new Set(others.map((o) => o.otherKind)).size >= 5, 'several kinds of other space');
  assert.ok(rooms.every((r) => r.doors.length >= 1 && r.capacity >= 30));
  assert.equal(findRoom(project, 'rsamplecaf').doors.length, 2, 'one room has two doors');
});

test('a dozen teachers, one based in every room but the Cafeteria', () => {
  assert.equal(project.teachers.length, 12);
  assert.equal(new Set(project.teachers.map((t) => t.name)).size, 12);
  for (const room of allRooms(project)) assert.equal(room.teacherIds.length, room.number === 'Cafeteria' ? 0 : 1, room.number);
  assert.ok(project.teachers.every((t) => t.subjectId !== null && t.roomIds.length === 1));
});

test('eight groups over three grades, each with a different preset colour', () => {
  assert.deepEqual(project.groups.map((g) => g.name), ['6A', '6B', '6C', '7A', '7B', '7C', '8A', '8B']);
  assert.deepEqual([...new Set(project.groups.map((g) => g.grade))], ['6', '7', '8']);
  assert.deepEqual(project.groups.map((g) => g.colour), GROUP_COLOUR_PRESETS.slice(0, 8));
  assert.ok(project.groups.every((g) => isHexColour(g.colour)));
  assert.equal(project.groups.filter((g) => g.headCount === null).length, 1, 'one group leaves its head count to the school default');
});

test('A and B days, both their own copy, with bells and four minutes of passing time', () => {
  assert.deepEqual(project.dayTypes.map((d) => d.name), ['A Day', 'B Day']);
  for (const dayTypeId of DAYS) {
    assert.equal(isOwnCopy(project, dayTypeId), true);
    const bells = bellsFor(project, dayTypeId);
    assert.ok(bells.every((bell) => bell.start !== null && bell.end !== null));
    assert.deepEqual(bells.slice(0, 7).map((bell) => [bell.passingAfter, bell.passingFromBells]), new Array(7).fill([240, true]));
    assert.deepEqual(bellFindings(project, dayTypeId), []);
  }
  assert.notDeepEqual(project.dayTypes[0].bells, project.dayTypes[1].bells);
});

test('every group is somewhere every period on both day types, and has lunch in the Cafeteria once a day', () => {
  for (const group of project.groups) {
    for (const dayTypeId of DAYS) {
      const day = group.days[dayTypeId];
      assert.equal(day.length, 8);
      assert.ok(day.every((slot) => findRoom(project, slot.room)), group.name);
      assert.equal(day.filter((slot) => slot.room === 'rsamplecaf').length, 1, group.name + ' lunch');
      assert.equal(new Set(day.map((slot) => slot.room)).size, 8, group.name + ' is in eight different rooms');
    }
  }
});

test('two exits, both on Floor 1', () => {
  assert.deepEqual(project.building.floors.map((f) => f.exits.map((x) => x.doorName)), [['Door A', 'Door B'], [], []]);
  assert.ok(project.building.floors[0].exits.every((x) => x.assembly !== ''));
});

test('two stair connections: A joins Floors 1 and 2, B joins Floors 2 and 3', () => {
  assert.deepEqual(project.building.connections.map((c) => [c.label, c.a.floorId, c.b.floorId, c.direction]), [['A', 'fsample001', 'fsample002', 'both'], ['B', 'fsample002', 'fsample003', 'both']]);
});

test('every room can be walked to from every other room', () => {
  assert.equal(WALKS.size, 13 * 13);
});

test('deliberate problem 1: exactly one room double-booking, 6C and 7C in Room 203 in Period 2 on A Days', () => {
  const doubles = [];
  for (const dayTypeId of DAYS) {
    occupancy(dayTypeId).forEach((byRoom, period) => {
      for (const [roomId, groupIds] of byRoom) {
        if (groupIds.length > 1 && !findRoom(project, roomId).shared) doubles.push({ dayTypeId, period, roomId, groupIds });
      }
    });
  }
  assert.deepEqual(doubles, [SAMPLE_PROBLEMS.roomDouble]);
  assert.deepEqual(doubles, [{ dayTypeId: 'dsample00a', period: 1, roomId: 'rsample203', groupIds: ['gsample06c', 'gsample07c'] }]);
  assert.equal(findRoom(project, 'rsample203').shared, false);
});

test('deliberate problem 2: exactly one walk that does not fit the passing time, 8A from the Gym to Room 303', () => {
  const long = [];
  let worstOther = 0;
  for (const dayTypeId of DAYS) {
    const bells = bellsFor(project, dayTypeId);
    for (const group of project.groups) {
      const day = group.days[dayTypeId];
      for (let p = 0; p < 7; p += 1) {
        const walk = WALKS.get(day[p].room + '>' + day[p + 1].room);
        if (walk.low > bells[p].passingAfter) long.push({ dayTypeId, groupId: group.id, fromPeriod: p, toPeriod: p + 1, fromRoomId: day[p].room, toRoomId: day[p + 1].room });
        else worstOther = Math.max(worstOther, walk.high);
      }
    }
  }
  assert.deepEqual(long, [SAMPLE_PROBLEMS.longWalk]);
  assert.deepEqual(long, [{ dayTypeId: 'dsample00a', groupId: 'gsample08a', fromPeriod: 5, toPeriod: 6, fromRoomId: 'rsamplegym', toRoomId: 'rsample303' }]);
  const walk = WALKS.get('rsamplegym>rsample303');
  assert.deepEqual([walk.cells, walk.stairs], [81, 2], 'as the file comment says');
  assert.ok(walk.low > 240, 'too long however the first and last step are counted: ' + walk.low);
  assert.ok(worstOther <= 180, 'every other walk leaves a minute to spare before crowding: worst is ' + worstOther);
});

test('no teacher is in two rooms at once', () => {
  // each teacher is based in one room and no slot names a teacher, so a
  // teacher's day is their room's day
  assert.ok(project.teachers.every((t) => t.roomIds.length === 1));
  assert.ok(project.groups.every((g) => DAYS.every((d) => g.days[d].every((slot) => slot.teacherIds.length === 0))));
});

test('no teacher teaches more than four periods in a row, and every teacher has a planning period', () => {
  for (const dayTypeId of DAYS) {
    const periods = occupancy(dayTypeId);
    for (const teacher of project.teachers) {
      const taught = periods.map((byRoom) => byRoom.has(teacher.roomIds[0]));
      let run = 0;
      let longest = 0;
      for (const busy of taught) {
        run = busy ? run + 1 : 0;
        longest = Math.max(longest, run);
      }
      assert.ok(longest <= project.settings.checks.consecutiveLimit, teacher.name + ' teaches ' + longest + ' in a row');
      assert.ok(taught.includes(false), teacher.name + ' has no planning period');
      assert.ok(taught.includes(true), teacher.name + ' teaches nobody');
    }
  }
});

test('no group is larger than the room it is in', () => {
  for (const group of project.groups) {
    const size = group.headCount === null ? project.settings.defaultHeadCount : group.headCount;
    for (const dayTypeId of DAYS) for (const slot of group.days[dayTypeId]) assert.ok(size <= findRoom(project, slot.room).capacity);
  }
});

test('the names are invented and include the characters that catch a careless renderer', () => {
  const names = project.teachers.map((t) => t.name).join(' ');
  assert.match(names, /'/, 'an apostrophe');
  assert.match(names, /ê/, 'a letter outside ASCII');
});
