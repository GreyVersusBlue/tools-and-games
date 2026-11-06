// The step-free report (engine/step-free.js): the rooms a person who cannot use stairs cannot
// reach from outside, each with its reason, the line for a building with no step-free exit, and
// the step-free groups scheduled into those rooms. Each building is drawn in the test that uses it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { stepFreeReport } from '../../engine/step-free.js';
import { routingGraph, routeToExit } from '../../engine/routing.js';
import { validate } from '../../engine/validate.js';
import { school, group } from './helpers.mjs';
import { planProject, floorId, roomId } from '../fixtures/buildings/plans.mjs';

const F1 = floorId(1);

// Elevator stops by hand: cars is [{ stops: [[floor, x, y], …], letter, staffOnly }], a chain.
function withCars(project, cars) {
  const at = (number, x, y) => {
    const floor = project.building.floors[number - 1];
    return { floorId: floor.id, cell: y * floor.width + x };
  };
  let n = project.building.connections.length;
  for (const car of cars) {
    for (const [number, x, y] of car.stops) {
      const floor = project.building.floors[number - 1];
      const cell = y * floor.width + x;
      floor.cells = floor.cells.slice(0, cell) + 'S' + floor.cells.slice(cell + 1);
      floor.lifts = Array.from(new Set([...(floor.lifts || []), cell])).sort((a, b) => a - b);
    }
    car.stops.slice(1).forEach((stop, i) => {
      n += 1;
      project.building.connections.push({ id: 'celev' + String(n).padStart(5, '0'), label: car.letter + n, a: at(...car.stops[i]), b: at(...stop), direction: 'both', kind: 'elevator', staffOnly: car.staffOnly === true, car: car.letter });
    });
  }
  assert.deepEqual(validate(project), []);
  return project;
}

const HALL = ['.AA.BB.', '.AA.BB.', '#######', '.......', '.......'];
const STAIRS_HALL = ['.AA.BB.', '.AA.BB.', 'S######', '.......', '.......'];

const ids = (report) => report.rooms.map((entry) => entry.roomId);

test('a building with no marks and a ground-floor exit has nothing to report, and says nothing is marked', () => {
  const project = planProject([HALL], { exits: [[1, 6, 2, 'Main Door']] });
  const report = stepFreeReport(project);
  assert.deepEqual([report.marked, report.noStepFreeExit, report.line, report.rooms, report.groups], [false, false, null, [], []]);
});

test('reason "floor": a floor no elevator reaches has no elevator stop; one with a stop no step-free way reaches says so', () => {
  const stairs = planProject([STAIRS_HALL, STAIRS_HALL], { exits: [[1, 6, 2, 'Main Door']], connections: [[1, 0, 2, 2, 0, 2]] });
  const none = stepFreeReport(stairs);
  assert.deepEqual(none.rooms.map((entry) => [entry.roomId, entry.floorId, entry.reason, entry.why]), [[roomId('2A'), floorId(2), 'floor', 'Floor 2 has no elevator stop'], [roomId('2B'), floorId(2), 'floor', 'Floor 2 has no elevator stop']]);
  // an elevator joins the floors: both rooms are reached, and it is a staff-only one, which is open to anyone who needs it
  for (const staffOnly of [false, true]) {
    const lifted = withCars(planProject([HALL, HALL], { exits: [[1, 6, 2, 'Main Door']] }), [{ stops: [[1, 0, 2], [2, 0, 2]], letter: 'D', staffOnly }]);
    assert.deepEqual(stepFreeReport(lifted).rooms, [], 'staffOnly ' + staffOnly);
  }
  // Floor 3 has a stop, but its car joins only Floors 2 and 3, and nothing joins Floor 2 to the exit but stairs
  const cut = withCars(planProject([STAIRS_HALL, STAIRS_HALL, STAIRS_HALL], { exits: [[1, 6, 2, 'Main Door']], connections: [[1, 0, 2, 2, 0, 2]] }), [{ stops: [[2, 4, 2], [3, 4, 2]], letter: 'D' }]);
  const lost = stepFreeReport(cut);
  assert.deepEqual(lost.rooms.filter((entry) => entry.floorId === floorId(3)).map((entry) => [entry.reason, entry.why]), [['floor', 'no step-free way reaches Floor 3'], ['floor', 'no step-free way reaches Floor 3']]);
  assert.equal(lost.rooms.filter((entry) => entry.floorId === floorId(2)).every((entry) => entry.reason === 'floor' && entry.why === 'no step-free way reaches Floor 2'), true, 'Floor 2 has a stop too');
});

test('reason "doors": the corridor is reached but every door of the room has a step', () => {
  const project = planProject([['.AAAA.', '.AAAA.', '######', '.BBBB.', '.BBBB.']], { doors: { '1A': [[1, 1, 's'], [4, 1, 's']], '1B': [[2, 3, 'n']] }, exits: [[1, 5, 2, 'East Door']] });
  project.building.floors[0].spaces.find((space) => space.number === '1A').doors.forEach((door) => { door.stepFree = false; });
  const report = stepFreeReport(project);
  assert.deepEqual(report.rooms, [{ roomId: roomId('1A'), floorId: F1, reason: 'doors', why: 'every door of Room 1A has a step' }]);
  assert.equal(report.marked, true);
  // one level door is enough
  project.building.floors[0].spaces.find((space) => space.number === '1A').doors[1].stepFree = true;
  assert.deepEqual(stepFreeReport(project).rooms, []);
});

test('reason "steps": a step on the way, named by the corridor nearest to the room, or by the floor', () => {
  const project = planProject([['A...B', '#####', '.....']], { exits: [[1, 0, 1, 'West Door']] });
  const floor = project.building.floors[0];
  floor.notStepFree = [floor.width + 2];
  floor.corridors = [{ id: 'kplan00001', name: 'North Corridor', cells: [floor.width, floor.width + 1, floor.width + 2, floor.width + 3, floor.width + 4] }];
  const report = stepFreeReport(project);
  assert.deepEqual(report.rooms, [{ roomId: roomId('1B'), floorId: F1, reason: 'steps', why: 'a step on the way, North Corridor' }]);
  floor.corridors = [];
  assert.equal(stepFreeReport(project).rooms[0].why, 'a step on the way, Floor 1');
  // a step off the way changes nothing
  const off = planProject([['A...B', '#####', '#####']], { exits: [[1, 0, 1, 'West Door']] });
  off.building.floors[0].notStepFree = [2 * off.building.floors[0].width + 2];
  assert.deepEqual(stepFreeReport(off).rooms, []);
});

test('reason "no-way": cut off by neither a step nor a stair nor a floor', () => {
  // two corridors on one floor that do not meet, the exit on the first
  const project = planProject([['.AA.BB...CC.DD.', '.AA.BB...CC.DD.', '######...######', '...............', '...............']], { exits: [[1, 0, 2, 'West Door']] });
  const report = stepFreeReport(project);
  assert.deepEqual(report.rooms.map((entry) => [entry.roomId, entry.reason, entry.why]), [[roomId('1C'), 'no-way', 'no step-free way through'], [roomId('1D'), 'no-way', 'no step-free way through']]);
});

test('no step-free exit: one line says so and every room is listed under it', () => {
  const project = planProject([HALL], { exits: [[1, 6, 2, 'Main Door']] });
  project.building.floors[0].exits[0].stepFree = false;
  const report = stepFreeReport(project);
  assert.equal(report.noStepFreeExit, true);
  assert.equal(report.line, 'No exit is step-free, so no room can be reached without stairs.');
  assert.deepEqual(report.rooms.map((entry) => [entry.roomId, entry.reason, entry.why]), [[roomId('1A'), 'no-exit', 'no step-free exit'], [roomId('1B'), 'no-exit', 'no step-free exit']]);
  // no exit at all is the same line
  const bare = planProject([HALL]);
  assert.equal(stepFreeReport(bare).line, report.line);
  assert.equal(stepFreeReport(bare).rooms.length, 2);
  // a building with a second exit that is step-free is no longer the case
  const two = planProject([HALL], { exits: [[1, 6, 2, 'Main Door'], [1, 0, 2, 'Side Door']] });
  two.building.floors[0].exits[0].stepFree = false;
  assert.deepEqual([stepFreeReport(two).noStepFreeExit, stepFreeReport(two).line, stepFreeReport(two).rooms], [false, null, []]);
});

test('the step-free groups in those rooms, by day type and period', () => {
  const project = school();
  const first = project.building.floors[0];
  for (const floor of project.building.floors) floor.exits = floor.exits.map((exit) => ({ ...exit }));
  // no elevator: Floors 2 and 3 cannot be reached without stairs
  group(project, '8A').stepFree = true;
  group(project, '7B').stepFree = true;
  const report = stepFreeReport(project);
  assert.equal(report.rooms.length > 0, true);
  assert.ok(report.rooms.every((entry) => entry.reason === 'floor' && /has no elevator stop$/.test(entry.why)));
  const unreached = new Set(ids(report));
  assert.ok(report.groups.length > 0);
  // every entry is a step-free group in an unreached room; periods ascend within a day type
  let last = null;
  for (const row of report.groups) {
    for (const entry of row.entries) {
      assert.ok(unreached.has(entry.roomId));
      assert.ok(['gsample08a', group(project, '7B').id].includes(entry.groupId));
    }
    if (last && last.dayTypeId === row.dayTypeId) assert.ok(row.period > last.period);
    last = row;
  }
  // the seventh period on A Days (index 6): 8A is in Room 303, and 7B is upstairs in another period
  assert.deepEqual(report.groups.find((row) => row.dayTypeId === 'dsample00a' && row.period === 6).entries.filter((entry) => entry.groupId === 'gsample08a'), [{ groupId: 'gsample08a', roomId: 'rsample303' }]);
  // no step-free group, no rows; the rooms are still listed
  const plain = school();
  assert.deepEqual(stepFreeReport(plain).groups, []);
  assert.equal(stepFreeReport(plain).rooms.length, report.rooms.length);
  assert.equal(first.exits.length > 0, true);
});

test('the report agrees with the router: a room is listed exactly when no step-free route leads from it to a step-free exit with the elevators open', () => {
  const buildings = [
    planProject([STAIRS_HALL, STAIRS_HALL], { exits: [[1, 6, 2, 'Main Door']], connections: [[1, 0, 2, 2, 0, 2]] }),
    withCars(planProject([HALL, HALL, HALL], { exits: [[1, 6, 2, 'Main Door']] }), [{ stops: [[1, 0, 2], [2, 0, 2]], letter: 'D' }]),
    (() => {
      const p = planProject([['A...B', '#####', '.....']], { exits: [[1, 0, 1, 'West Door']] });
      p.building.floors[0].notStepFree = [p.building.floors[0].width + 2];
      return p;
    })(),
    school(),
  ];
  for (const project of buildings) {
    const graph = routingGraph(project);
    const listed = new Set(ids(stepFreeReport(project, graph)));
    for (const floor of project.building.floors) {
      for (const space of floor.spaces) {
        if (space.kind !== 'room') continue;
        const found = routeToExit(graph, space.id, { avoidStairs: true, undirected: true });
        assert.equal(listed.has(space.id), !found.ok, space.number + ': ' + (found.ok ? 'reached' : found.reason));
      }
    }
  }
});
