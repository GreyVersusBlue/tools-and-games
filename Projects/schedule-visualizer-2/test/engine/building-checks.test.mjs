// Building checks (spec 4.9): each kind found where it is, with a stable id,
// a sentence, and enough in `where` for "Show me".

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingChecks, BUILDING_CHECK_KINDS } from '../../engine/building-checks.js';
import { buildGraph } from '../../engine/graph.js';
import * as actions from '../../engine/actions.js';
import { school, emptyProject, ctx, clone, assertValid } from './helpers.mjs';
import { planProject, twoRooms, disconnectedWing, threeFloors, unjoinedFloors, splitLevel, cellAt, floorId, roomId } from '../fixtures/buildings/plans.mjs';

const F1 = floorId(1);
const shared = ctx();

function kinds(findings) {
  return findings.map((finding) => finding.kind);
}

function only(findings, kind) {
  return findings.filter((finding) => finding.kind === kind);
}

test('the sample school passes every building check: its two deliberate problems are in the schedule', () => {
  assert.deepEqual(buildingChecks(school()), []);
});

test('a building that is sound has no findings: two rooms, a three-floor stairwell, a split level', () => {
  for (const make of [twoRooms, threeFloors, splitLevel]) assert.deepEqual(buildingChecks(make()), [], make.name);
});

test('a new, empty project has no findings, not even "no exit"', () => {
  assert.deepEqual(buildingChecks(emptyProject()), []);
});

test('every finding has the shape the findings panel reads', () => {
  const findings = buildingChecks(unjoinedFloors());
  assert.ok(findings.length > 0);
  for (const finding of findings) {
    assert.deepEqual(Object.keys(finding), ['id', 'kind', 'severity', 'text', 'where', 'fixable']);
    assert.ok(BUILDING_CHECK_KINDS.includes(finding.kind));
    assert.ok(finding.id.startsWith(finding.kind + ':'));
    assert.ok(['problem', 'warning', 'note'].includes(finding.severity));
    assert.match(finding.text, /^[A-Z].*\.$/, 'a full sentence');
    assert.equal(typeof finding.where.floorId, 'string');
    assert.ok(Array.isArray(finding.where.cells));
    assert.equal(finding.fixable, false);
  }
  assert.equal(new Set(findings.map((finding) => finding.id)).size, findings.length, 'ids are unique');
});

test('a room with no number is a warning that names its floor and points at the room', () => {
  const project = planProject([['.AA..', '.AA..', '#####', '.....', '.....']], { numbers: { '1A': '  ' }, exits: [[1, 0, 2, 'Door']] });
  const findings = buildingChecks(project);
  assert.deepEqual(findings, [{
    id: 'room-no-number:' + roomId('1A'),
    kind: 'room-no-number',
    severity: 'warning',
    text: 'A room on Floor 1 has no number. Give it one so that groups can be scheduled into it.',
    where: { floorId: F1, roomId: roomId('1A'), cells: [1, 2, 6, 7] },
    fixable: false,
  }]);
});

test('duplicate room numbers, which only an import can bring in, are one problem naming every floor', () => {
  const project = clone(threeFloors());
  project.building.floors[1].spaces[0].number = ' 1a ';
  project.building.floors[2].spaces[1].number = '1A';
  const [finding, ...rest] = buildingChecks(project);
  assert.deepEqual(rest, []);
  assert.equal(finding.kind, 'room-duplicate-number');
  assert.equal(finding.severity, 'problem');
  assert.equal(finding.text, '3 rooms are numbered 1A: on Floor 1, Floor 2 and Floor 3. Room numbers are unique across the building; change all but one.');
  assert.deepEqual(finding.where.roomIds, [roomId('1A'), roomId('2A'), roomId('3B')]);
  assert.equal(finding.id, 'room-duplicate-number:' + [roomId('1A'), roomId('2A'), roomId('3B')].join(':'));
});

test('a room that touches no corridor is a problem', () => {
  const project = planProject([['AA...', 'AA...', '.....', '..###', '.....']], { exits: [[1, 4, 3, 'Door']] });
  const findings = buildingChecks(project);
  assert.deepEqual(kinds(findings), ['room-no-corridor']);
  assert.equal(findings[0].text, 'Room 1A on Floor 1 touches no corridor or stairs, so nobody can walk to it or from it. Paint a corridor up to one of its sides.');
  assert.deepEqual(findings[0].where, { floorId: F1, roomId: roomId('1A'), cells: [0, 1, 5, 6] });
});

test('a room whose only door leads nowhere is a problem; one dead door among good ones is a warning naming the side', () => {
  const project = clone(twoRooms());
  const room = project.building.floors[0].spaces[0];
  const dead = { cell: cellAt(project, 1, 2, 0), side: 'n' };
  room.doors = [dead];
  let findings = only(buildingChecks(project), 'door-nowhere');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'problem');
  assert.equal(findings[0].text, 'The door of Room 1A on Floor 1 leads nowhere, so nobody can walk to it or from it. Put a door on a side that faces a corridor or stairs.');
  assert.deepEqual(findings[0].where.cells, [dead.cell]);
  assert.deepEqual(only(buildingChecks(project), 'room-no-corridor'), [], 'it is told once, as its door, not also as touching no corridor');
  room.doors = [dead, { cell: cellAt(project, 1, 1, 1), side: 's' }];
  findings = only(buildingChecks(project), 'door-nowhere');
  assert.equal(findings[0].severity, 'warning');
  assert.equal(findings[0].text, 'Room 1A on Floor 1 has a door on its north side that leads nowhere. Remove it, or paint a corridor there.');
});

test('stairs with no connection are a warning, one for each run of stairs cells', () => {
  const project = planProject([['SS#.S', '..#..', '..###', '.....', '.....']], { exits: [[1, 4, 2, 'Door']] });
  const findings = buildingChecks(project);
  assert.deepEqual(findings.map((finding) => [finding.kind, finding.id, finding.where.cells]), [
    ['stairs-unconnected', 'stairs-unconnected:' + F1 + ':0', [0, 1]],
    ['stairs-unconnected', 'stairs-unconnected:' + F1 + ':4', [4]],
    ['part-unreachable', 'part-unreachable:' + F1 + ':4', [4]],
  ]);
  assert.equal(findings[0].text, 'The stairs on Floor 1 at column 1, row 1 are not connected to other stairs, so nobody can use them. Connect them to the stairs they lead to.');
});

test('a run of stairs cells with one of them connected is not reported', () => {
  const two = ['SS###', '.....', '.....', '.....', '.....'];
  const project = planProject([two, two], { connections: [[1, 1, 0, 2, 1, 0]], exits: [[1, 4, 0, 'Door']] });
  assert.deepEqual(buildingChecks(project), []);
});

test('a disconnected wing is found: its cells, the rooms on it, and their lack of a route to the exit', () => {
  const project = disconnectedWing();
  const findings = buildingChecks(project);
  assert.deepEqual(kinds(findings), ['part-unreachable', 'room-no-exit-route', 'room-no-exit-route']);
  const [part, c, d] = findings;
  assert.equal(part.severity, 'problem');
  assert.equal(part.text, 'Part of Floor 1 cannot be reached from the rest of the building: 6 corridor and stairs cells with Room 1C and Room 1D. Join it with a corridor or a stairs connection.');
  assert.deepEqual(part.where, { floorId: F1, cells: [39, 40, 41, 42, 43, 44], roomIds: [roomId('1C'), roomId('1D')] });
  assert.equal(c.text, 'Room 1C on Floor 1 has no route to any exit. Join its corridor to one that leads to an exit, or mark an exit it can reach.');
  assert.equal(d.where.roomId, roomId('1D'));
});

test('joining the wing with one corridor cell clears every one of those findings', () => {
  const project = disconnectedWing();
  const joined = actions.paintCorridor(project, { floorId: F1, cells: [36, 37, 38] }, shared);
  assertValid(joined);
  assert.deepEqual(buildingChecks(joined), []);
});

test('a floor with nothing connecting it to the rest is found, and is told as the floor, not as a part', () => {
  const findings = buildingChecks(unjoinedFloors());
  assert.deepEqual(kinds(findings), ['stairs-unconnected', 'stairs-unconnected', 'floor-unconnected', 'room-no-exit-route', 'room-no-exit-route']);
  const floor = only(findings, 'floor-unconnected')[0];
  assert.equal(floor.id, 'floor-unconnected:' + floorId(2));
  assert.equal(floor.text, 'Nothing connects Floor 2 to the rest of the building. Connect stairs on it to stairs on another floor.');
  assert.equal(floor.where.floorId, floorId(2));
  assert.equal(floor.where.cells.length, 7);
});

test('connecting the two floors\' stairs clears the floor finding and both stairs warnings', () => {
  const project = unjoinedFloors();
  const joined = actions.connectStairs(project, { a: { floorId: floorId(1), cell: cellAt(project, 1, 0, 2) }, b: { floorId: floorId(2), cell: cellAt(project, 2, 0, 2) } }, shared);
  assert.deepEqual(buildingChecks(joined), []);
});

test('the main part is the one most rooms open onto, so the odd one out is what gets reported', () => {
  // Floor 1 has one room, Floor 2 has two: Floor 1 is the floor that is cut off
  const project = planProject([['.AA....', '.AA....', 'S######', '.......', '.......'], ['.AA.BB.', '.AA.BB.', 'S######', '.......', '.......']]);
  assert.equal(only(buildingChecks(project), 'floor-unconnected')[0].where.floorId, floorId(1));
});

test('no exit marked is one warning, and then no room is told it has no route to one', () => {
  const project = planProject([['.AA..', '.AA..', '#####', '.....', '.....']]);
  const findings = buildingChecks(project);
  assert.deepEqual(kinds(findings), ['no-exit']);
  assert.equal(findings[0].severity, 'warning');
  assert.equal(findings[0].id, 'no-exit:building');
});

test('a one-way connection that only leads up leaves the upper rooms with no route to an exit', () => {
  const project = clone(threeFloors());
  project.building.connections[1].direction = 'ab'; // Floor 2 up to Floor 3 only
  const findings = buildingChecks(project);
  assert.deepEqual(findings.map((finding) => [finding.kind, finding.where.roomId]), [['room-no-exit-route', roomId('3A')], ['room-no-exit-route', roomId('3B')]]);
});

test('a name with markup or another script goes into the sentence exactly as typed', () => {
  const number = '<img src=x> "ج" & co';
  const project = planProject([['AA...', 'AA...', '.....', '..###', '.....']], { numbers: { '1A': number }, exits: [[1, 4, 3, 'Door']] });
  project.building.floors[0].name = 'Étage <1>';
  const [finding] = buildingChecks(project);
  assert.equal(finding.text, 'Room ' + number + ' on Étage <1> touches no corridor or stairs, so nobody can walk to it or from it. Paint a corridor up to one of its sides.');
});

test('the checks are the same run twice, and the same with a graph passed in', () => {
  const project = unjoinedFloors();
  const first = buildingChecks(project);
  assert.deepEqual(buildingChecks(project), first);
  assert.deepEqual(buildingChecks(project, buildGraph(project)), first);
  assert.deepEqual(buildingChecks(clone(project)), first, 'ids come from the data, not from object identity');
});

test('findings come out in the order of the kinds list', () => {
  const project = clone(unjoinedFloors());
  project.building.floors[1].spaces[1].number = '';
  const order = kinds(buildingChecks(project)).map((kind) => BUILDING_CHECK_KINDS.indexOf(kind));
  assert.deepEqual(order, order.slice().sort((a, b) => a - b));
  assert.equal(order[0], 0);
});
