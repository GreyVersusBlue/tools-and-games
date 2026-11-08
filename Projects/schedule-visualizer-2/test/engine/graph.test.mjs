// The walkable graph: nodes, neighbours, stairs links, room entries, and
// reachability by breadth-first search.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, nodeAt, placeOfNode, roomNodes, entryCells, reachable, components, HEADINGS } from '../../engine/graph.js';
import * as actions from '../../engine/actions.js';
import { school, ctx, clone } from './helpers.mjs';
import { validate } from '../../engine/validate.js';
import { planProject, twoRooms, disconnectedWing, threeFloors, splitLevel, cellAt, floorId, roomId } from '../fixtures/buildings/plans.mjs';

const F1 = floorId(1);

function count(marks) {
  return marks.reduce((sum, mark) => sum + mark, 0);
}

test('every corridor and stairs cell is one node, numbered floor by floor in cell order', () => {
  const project = threeFloors();
  const graph = buildGraph(project);
  assert.equal(graph.count, 21, 'seven walkable cells on each of three floors');
  assert.deepEqual(graph.floors.map((floor) => [floor.id, floor.offset, floor.count, floor.level]), [[floorId(1), 0, 7, 1], [floorId(2), 7, 7, 2], [floorId(3), 14, 7, 3]]);
  assert.equal(nodeAt(graph, floorId(2), cellAt(project, 2, 0, 2)), 7);
  assert.deepEqual(placeOfNode(graph, 8), { floorId: floorId(2), cell: cellAt(project, 2, 1, 2) });
  assert.equal(nodeAt(graph, floorId(2), 0), -1, 'an empty cell is no node');
  assert.equal(nodeAt(graph, 'fnowhere00', 0), -1);
  assert.deepEqual(Array.from(graph.stairs.slice(0, 7)), [1, 0, 0, 0, 0, 0, 0]);
});

test('neighbours are listed north, east, south, west, with -1 where there is nothing to walk on', () => {
  const project = planProject([['.#...', '###..', '.#...', '.....', '.....']]);
  const graph = buildGraph(project);
  assert.deepEqual(HEADINGS, ['n', 'e', 's', 'w']);
  const centre = nodeAt(graph, F1, cellAt(project, 1, 1, 1));
  const around = Array.from(graph.neighbours.slice(centre * 4, centre * 4 + 4)).map((node) => (node === -1 ? null : graph.nodeCell[node]));
  assert.deepEqual(around, [cellAt(project, 1, 1, 0), cellAt(project, 1, 2, 1), cellAt(project, 1, 1, 2), cellAt(project, 1, 0, 1)]);
  const top = nodeAt(graph, F1, cellAt(project, 1, 1, 0));
  assert.deepEqual(Array.from(graph.neighbours.slice(top * 4, top * 4 + 4)), [-1, -1, centre, -1]);
});

test('a room with two doors has two entry cells: the corridor cells across its doors, and no others', () => {
  const project = twoRooms();
  const graph = buildGraph(project);
  assert.deepEqual(entryCells(graph, roomId('1A')), [{ floorId: F1, cell: cellAt(project, 1, 1, 2) }, { floorId: F1, cell: cellAt(project, 1, 4, 2) }]);
  const entries = graph.rooms.get(roomId('1A')).entries;
  assert.deepEqual(entries.map((entry) => [entry.from, entry.side, entry.door]), [[cellAt(project, 1, 1, 1), 's', true], [cellAt(project, 1, 4, 1), 's', true]]);
  assert.equal(graph.rooms.get(roomId('1A')).doors, 2);
});

test('a room with no doors drawn is entered from every walkable cell that touches it', () => {
  const project = twoRooms();
  const graph = buildGraph(project);
  assert.deepEqual(entryCells(graph, roomId('1B')).map((place) => place.cell), [cellAt(project, 1, 1, 2), cellAt(project, 1, 2, 2), cellAt(project, 1, 3, 2)]);
  assert.deepEqual(graph.rooms.get(roomId('1B')).entries.map((entry) => entry.side), ['n', 'n', 'n']);
  assert.deepEqual(roomNodes(graph, 'rnowhere00'), []);
});

test('one corridor cell that touches a room on two sides is one entry cell with two ways in', () => {
  // the corridor turns the corner of room A: the cell at (2,2) touches nothing, (2,1) and (1,2) each touch one side
  const project = planProject([['.....', '.A#..', '.##..', '.....', '.....']]);
  const graph = buildGraph(project);
  const entries = graph.rooms.get(roomId('1A')).entries;
  assert.deepEqual(entries.map((entry) => [entry.cell, entry.side]), [[cellAt(project, 1, 2, 1), 'e'], [cellAt(project, 1, 1, 2), 's']]);
  const inside = planProject([['.....', '.AA..', '.A#..', '.....', '.....']]);
  const corner = buildGraph(inside);
  assert.deepEqual(entryCells(corner, roomId('1A')), [{ floorId: F1, cell: cellAt(inside, 1, 2, 2) }]);
  assert.equal(corner.rooms.get(roomId('1A')).entries.length, 2, 'entered from the cell above and from the cell to the left');
});

test('a door that faces nothing walkable is a dead door, and a room with only dead doors has no entry', () => {
  const project = clone(twoRooms());
  const space = project.building.floors[0].spaces[0];
  space.doors = [{ cell: cellAt(project, 1, 1, 0), side: 'n' }];
  const graph = buildGraph(project);
  assert.deepEqual(graph.rooms.get(space.id).deadDoors, [{ cell: cellAt(project, 1, 1, 0), side: 'n' }]);
  assert.deepEqual(graph.rooms.get(space.id).entries, [], 'once a door is drawn the room is entered only through its doors');
});

test('a door can open onto a stairs cell', () => {
  const project = planProject([['.....', '.AS#.', '.....', '.....', '.....']], { doors: { '1A': [[1, 1, 'e']] } });
  const graph = buildGraph(project);
  const [entry] = graph.rooms.get(roomId('1A')).entries;
  assert.equal(graph.stairs[entry.node], 1);
});

test('reachable finds every cell that can be walked to, across stairs, and stops at a gap', () => {
  const joined = buildGraph(threeFloors());
  assert.equal(count(reachable(joined, 0)), 21, 'the chain of two connections joins all three floors');
  const wing = disconnectedWing();
  const graph = buildGraph(wing);
  const west = reachable(graph, nodeAt(graph, F1, cellAt(wing, 1, 0, 2)));
  assert.equal(count(west), 6);
  assert.equal(west[nodeAt(graph, F1, cellAt(wing, 1, 9, 2))], 0, 'the east wing is not reached');
  assert.equal(count(reachable(graph, roomNodes(graph, roomId('1C')))), 6, 'a list of start nodes works too');
  assert.equal(count(reachable(graph, [])), 0);
});

test('a same-floor connection is a link between two stairs on one floor, counted as one level', () => {
  const project = splitLevel();
  const graph = buildGraph(project);
  assert.equal(graph.links.length, 1);
  assert.deepEqual({ label: graph.links[0].label, sameFloor: graph.links[0].sameFloor, levels: graph.links[0].levels }, { label: 'A', sameFloor: true, levels: 1 });
  assert.equal(count(reachable(graph, 0)), graph.count, 'the two halves are joined by it');
  const without = buildGraph({ ...project, building: { ...project.building, connections: [] } });
  assert.equal(count(reachable(without, 0)), 4);
});

test('a link counts the levels between its floors, not their order in the list', () => {
  const project = clone(threeFloors());
  project.building.floors[2].level = 5;
  project.building.floors.reverse();
  const graph = buildGraph(project);
  assert.deepEqual(graph.links.map((link) => [link.label, link.levels]), [['A', 1], ['B', 3]]);
});

test('a one-way connection is followed only its own way, and reverse asks who can get here', () => {
  const project = clone(threeFloors());
  project.building.connections[0].direction = 'ab'; // Floor 1 up to Floor 2 only
  const graph = buildGraph(project);
  const ground = nodeAt(graph, floorId(1), cellAt(project, 1, 6, 2));
  const upper = nodeAt(graph, floorId(2), cellAt(project, 2, 6, 2));
  assert.equal(reachable(graph, ground)[upper], 1, 'up is allowed');
  assert.equal(reachable(graph, upper)[ground], 0, 'down is not');
  assert.equal(reachable(graph, ground, { reverse: true })[upper], 0, 'nobody upstairs can get to the ground floor');
  assert.equal(count(reachable(graph, upper, { reverse: true })), 21, 'everybody can get upstairs');
  assert.equal(components(graph).count, 1, 'the parts of the building ignore the direction');
});

test('components numbers the parts of the building in node order', () => {
  const wing = disconnectedWing();
  const graph = buildGraph(wing);
  const parts = components(graph);
  assert.equal(parts.count, 2);
  assert.equal(parts.of[nodeAt(graph, F1, cellAt(wing, 1, 0, 2))], 0);
  assert.equal(parts.of[nodeAt(graph, F1, cellAt(wing, 1, 14, 2))], 1);
  assert.equal(components(buildGraph(planProject([['.....', '.....', '.....', '.....', '.....']]))).count, 0);
});

test('a connection whose end is not a stairs cell is left out rather than trusted', () => {
  const project = clone(threeFloors());
  project.building.connections[0].a.cell += 1;
  project.building.connections[1].b.floorId = 'fnowhere00';
  assert.deepEqual(buildGraph(project).links, []);
});

test('the sample school: 125 nodes, two links, every room with one entry cell per door, both exits on nodes', () => {
  const project = school();
  const graph = buildGraph(project);
  assert.equal(graph.count, 125);
  assert.deepEqual(graph.links.map((link) => [link.label, link.levels, link.sameFloor]), [['A', 1, false], ['B', 1, false]]);
  assert.equal(graph.rooms.size, 13);
  for (const floor of project.building.floors) {
    for (const space of floor.spaces) {
      if (space.kind === 'room') assert.equal(entryCells(graph, space.id).length, space.doors.length, 'Room ' + space.number);
    }
  }
  assert.equal(entryCells(graph, 'rsamplecaf').length, 2);
  assert.deepEqual(graph.exits.map((exit) => exit.id), ['xsample00a', 'xsample00b']);
  assert.equal(count(reachable(graph, 0)), 125);
});

test('the graph takes a published model and a bare building as well as a project, and gives the same answer', () => {
  const project = school();
  const published = { format: 'sv2-published', version: 1, building: { floors: project.building.floors.map((floor) => ({ id: floor.id, name: floor.name, level: floor.level, width: floor.width, height: floor.height, cells: floor.cells, spaces: floor.spaces, corridors: floor.corridors, exits: floor.exits })), connections: project.building.connections } };
  const a = buildGraph(project);
  for (const other of [buildGraph(published), buildGraph(project.building)]) {
    assert.deepEqual(other.neighbours, a.neighbours);
    assert.deepEqual(other.links, a.links);
    assert.deepEqual(Array.from(other.rooms.values()), Array.from(a.rooms.values()));
  }
});

test('the graph follows the building: a door added through its action changes the entries', () => {
  const before = twoRooms();
  const after = actions.addDoor(before, { roomId: roomId('1B'), cell: cellAt(before, 1, 3, 3), side: 'n' }, ctx());
  assert.deepEqual(entryCells(buildGraph(after), roomId('1B')), [{ floorId: F1, cell: cellAt(before, 1, 3, 2) }]);
});

test('a full 200 by 200 floor of corridor builds and is searched', () => {
  const project = planProject([Array.from({ length: 200 }, () => '#'.repeat(200))]);
  const graph = buildGraph(project);
  assert.equal(graph.count, 40000);
  assert.equal(count(reachable(graph, 0)), 40000);
  assert.equal(components(graph).count, 1);
});

// ---- elevators and step-free marks (SV2-98)

// Joins stops with elevator connections by hand: cars is [{ stops: [[floor, x, y], …], mode: 'chain' | 'star', staffOnly, letter }].
// Each stop is a stairs cell the drawing already has, listed in the floor's `lifts`; the connections carry the kind, the car letter and staffOnly.
function withCars(project, cars) {
  const at = (number, x, y) => {
    const floor = project.building.floors[number - 1];
    return { floorId: floor.id, cell: y * floor.width + x };
  };
  let n = project.building.connections.length;
  cars.forEach((car, index) => {
    const letter = car.letter || String.fromCharCode(68 + index);
    for (const [number, x, y] of car.stops) {
      const floor = project.building.floors[number - 1];
      const cell = y * floor.width + x;
      floor.cells = floor.cells.slice(0, cell) + 'S' + floor.cells.slice(cell + 1);
      floor.lifts = Array.from(new Set([...(floor.lifts || []), cell])).sort((a, b) => a - b);
    }
    const pairs = car.stops.length === 1 ? [] : car.mode === 'star' ? car.stops.slice(1).map((stop) => [car.stops[0], stop]) : car.stops.slice(1).map((stop, i) => [car.stops[i], stop]);
    for (const [a, b] of pairs) {
      n += 1;
      project.building.connections.push({ id: 'celev' + String(n).padStart(5, '0'), label: letter + n, a: at(...a), b: at(...b), direction: 'both', kind: 'elevator', staffOnly: car.staffOnly === true, car: letter });
    }
  });
  return project;
}

const STOPS = [[1, 0, 2], [2, 0, 2], [3, 0, 2]];

function lifted(mode, staffOnly) {
  const project = planProject([['.AA.BB.', '.AA.BB.', '#######', '.......', '.......']].concat([0, 1].map(() => ['.AA.BB.', '.AA.BB.', '#######', '.......', '.......'])), { exits: [[1, 6, 2, 'Main Door']] });
  return withCars(project, [{ stops: STOPS, mode, staffOnly }]);
}

test('a car makes one link for every pair of its stops, with its own id, whichever way the stops were joined', () => {
  for (const mode of ['chain', 'star']) {
    const project = lifted(mode, true);
    assert.deepEqual(validate(project), [], mode);
    const graph = buildGraph(project);
    const id = project.building.connections[0].id;
    assert.equal(graph.links.length, 3, mode + ': three stops, three pairs');
    for (const link of graph.links) {
      assert.deepEqual([link.id, link.elevator, link.staffOnly, link.direction, link.car], [id, true, true, 'both', 0], mode);
      assert.equal(link.label, 'D', mode + ': the car letter, on every link');
    }
    assert.deepEqual(graph.links.map((link) => [graph.nodeFloor[link.a], graph.nodeFloor[link.b], link.levels]), [[0, 1, 1], [0, 2, 2], [1, 2, 1]], mode + ': levels = max(1, |difference|), stops in floor order');
    assert.deepEqual(graph.cars.map((car) => [car.id, car.label, car.link, car.links, car.stops.map((stop) => stop.floorId)]), [[id, 'D', 0, [0, 1, 2], [floorId(1), floorId(2), floorId(3)]]]);
  }
});

test('a lift cell is in lifts and out of stairs; a stairs connection still makes one link; an unconnected stop makes none', () => {
  const project = lifted('chain', false);
  const floor = project.building.floors[0];
  // a stairs cell and a stairs connection on floors 1 and 2, next to the car
  for (const f of [0, 1]) {
    const target = project.building.floors[f];
    target.cells = target.cells.slice(0, 6 * 1 + 2 * target.width) + 'S' + target.cells.slice(6 + 2 * target.width + 1);
  }
  project.building.connections.push({ id: 'cstairs001', label: 'A', a: { floorId: floor.id, cell: 6 + 2 * floor.width }, b: { floorId: project.building.floors[1].id, cell: 6 + 2 * floor.width }, direction: 'both' });
  // one more stop with no connection, on floor 3
  const top = project.building.floors[2];
  top.cells = top.cells.slice(0, 3 + 3 * top.width) + 'S' + top.cells.slice(3 + 3 * top.width + 1);
  top.lifts.push(3 + 3 * top.width);
  const graph = buildGraph(project);
  const nodeOf = (number, x, y) => nodeAt(graph, floorId(number), cellAt(project, number, x, y));
  assert.deepEqual([graph.lifts[nodeOf(1, 0, 2)], graph.stairs[nodeOf(1, 0, 2)]], [1, 0], 'a car stop is a lift cell, not stairs');
  assert.deepEqual([graph.lifts[nodeOf(1, 6, 2)], graph.stairs[nodeOf(1, 6, 2)]], [0, 1], 'stairs stay stairs');
  assert.deepEqual([graph.lifts[nodeOf(3, 3, 3)], graph.stairs[nodeOf(3, 3, 3)]], [1, 0], 'a stop with no connection is a lift cell too');
  assert.equal(graph.links.length, 4, 'one stairs link and the car\'s three');
  assert.deepEqual(graph.links.map((link) => Boolean(link.elevator)), [false, true, true, true], 'stairs links come first, and carry no elevator field');
  assert.equal(graph.cars.length, 1, 'the unconnected stop is no car with links');
  assert.equal(Array.from(graph.lifts).reduce((sum, mark) => sum + mark, 0), 4);
});

test('a room is never entered through a lift cell: a door cannot face one and a doorless room does not use one', () => {
  const project = planProject([['AAA', '#S#'], ['...', '#S#']].map((rows) => rows.concat(['...', '...', '...'])), { connections: [] });
  const [one, two] = project.building.floors;
  withCars(project, [{ stops: [[1, 1, 1], [2, 1, 1]] }]);
  const graph = buildGraph(project);
  const room = graph.rooms.get(roomId('1A'));
  assert.deepEqual(room.entries.map((entry) => graph.nodeCell[entry.node] % one.width), [0, 2], 'the corridor cells either side of the lift cell, never the lift cell');
  assert.ok(two);
  project.building.floors[0].spaces[0].doors.push({ cell: 1, side: 's' });
  const withDoor = buildGraph(project).rooms.get(roomId('1A'));
  assert.equal(withDoor.entries.length, 0, 'a door on the lift cell leads nowhere');
  assert.equal(withDoor.deadDoors.length, 1);
});

test('door and exit stepFree are copied onto the entries and the exits, true when absent', () => {
  const project = planProject([['AAA..', '#####', '.....']], { doors: { '1A': [[0, 0, 's'], [2, 0, 's']] }, exits: [[1, 0, 1, 'West'], [1, 4, 1, 'East']] });
  const floor = project.building.floors[0];
  floor.spaces[0].doors[1].stepFree = false;
  floor.exits[1].stepFree = false;
  const graph = buildGraph(project);
  assert.deepEqual(graph.rooms.get(roomId('1A')).entries.map((entry) => entry.stepFree), [true, false]);
  assert.deepEqual(graph.exits.map((exit) => exit.stepFree), [true, false]);
  const bare = buildGraph(planProject([['AAA..', '#####']]));
  assert.deepEqual(bare.rooms.get(roomId('1A')).entries.map((entry) => entry.stepFree), [true, true, true], 'a doorless room: every entry');
});

// Two floors, each a corridor of four cells with a lift cell at the second, joined by one car.
function cutCorridors() {
  const floor = ['A..B', '####', '....', '....', '....'];
  return withCars(planProject([floor, floor]), [{ stops: [[1, 1, 1], [2, 1, 1]] }]);
}

test('reachable never walks through a lift cell: with no ride the corridor beyond it is out of reach, with one it is in', () => {
  const project = cutCorridors();
  const graph = buildGraph(project);
  const at = (number, x) => nodeAt(graph, floorId(number), cellAt(project, number, x, 1));
  const marks = (seen, number) => [0, 1, 2, 3].map((x) => seen[at(number, x)]);
  const walking = reachable(graph, at(1, 0), { noElevators: true });
  assert.deepEqual(marks(walking, 1), [1, 1, 0, 0], 'the lift cell is stepped onto and leads nowhere');
  assert.deepEqual(marks(walking, 2), [0, 0, 0, 0]);
  const riding = reachable(graph, at(1, 0));
  assert.deepEqual([marks(riding, 1), marks(riding, 2)], [[1, 1, 1, 1], [1, 1, 1, 1]], 'a ride up, a step back onto the floor 2 lift cell, a ride down: out the east side');
  // the same drawing with the stop joined to nothing: an unconnected stop is no way through either
  const alone = cutCorridors();
  alone.building.connections = [];
  assert.deepEqual(marks(reachable(buildGraph(alone), at(1, 0)), 1), [1, 1, 0, 0]);
});

test('components take noElevators, and two corridors that meet only at a lift cell are one part only when the car carries them', () => {
  const project = cutCorridors();
  const graph = buildGraph(project);
  const at = (number, x) => nodeAt(graph, floorId(number), cellAt(project, number, x, 1));
  const joined = components(graph);
  assert.equal(joined.count, 1);
  const walking = components(graph, { noElevators: true });
  assert.equal(walking.of[at(1, 0)], walking.of[at(1, 1)], 'the lift cell belongs to the part of the corridor that reaches it first');
  assert.notEqual(walking.of[at(1, 0)], walking.of[at(1, 2)], 'the corridor west and east of a lift cell are two parts: nobody walks through it');
  assert.notEqual(walking.of[at(1, 0)], walking.of[at(2, 0)], 'and each floor is its own');
  assert.equal(walking.count, 4);
  const none = cutCorridors();
  none.building.connections = [];
  assert.equal(components(buildGraph(none)).count, 4, 'an unconnected stop leaves four parts, with or without the option');
});
