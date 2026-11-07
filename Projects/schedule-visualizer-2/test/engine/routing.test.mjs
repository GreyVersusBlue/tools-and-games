// Routing: the quickest route, the tie-breaks, the options, the named
// failures, the schedule's routes and the cache of distance fields.
//
// Each plan is drawn in the test that uses it, so a route can be read
// against its building. Cells are written "x,y", with the floor number in
// front ("2:0,2") where a route changes floor.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../../engine/graph.js';
import * as routingEngine from '../../engine/routing.js';
import { digestRoutes } from '../fixtures/route-digests.mjs';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../../engine/validate.js';
import { route, routeToExit, routeToCells, routesForSchedule, routingGraph, createRouteCache, FIELD_LIMIT, ROUTE_FAILURES } from '../../engine/routing.js';
import { school, clone } from './helpers.mjs';
import { planProject, twoRooms, disconnectedWing, threeFloors, splitLevel, cellAt, floorId, roomId } from '../fixtures/buildings/plans.mjs';
import { bigProject, BIG } from '../fixtures/big.mjs';
import { sampleSchool } from '../../data/sample-school.js';

const F1 = floorId(1);
const F2 = floorId(2);

// A route's cells as "x,y", or "floor:x,y" when `floors` is true.
function path(project, found, floors) {
  return found.cells.map((place) => {
    const index = project.building.floors.findIndex((floor) => floor.id === place.floorId);
    const floor = project.building.floors[index];
    const at = (place.cell % floor.width) + ',' + Math.floor(place.cell / floor.width);
    return floors ? (floor.level + ':' + at) : at;
  });
}

function between(project, from, to, options) {
  return route(routingGraph(project), roomId(from), roomId(to), options);
}

test('a route is the walkable cells between two rooms, with its time, its turns and the room cells at each end', () => {
  const project = planProject([[
    'A......',
    '######.',
    '....#..',
    '....#B.',
    '.......',
  ]]);
  const found = between(project, '1A', '1B');
  assert.equal(found.ok, true);
  assert.deepEqual(path(project, found), ['0,1', '1,1', '2,1', '3,1', '4,1', '4,2', '4,3']);
  assert.equal(found.seconds, 21, 'seven cells at three seconds each');
  assert.equal(found.turns, 3, 'left out of the door, right at the corner, left into the room');
  assert.equal(found.stairs, 0);
  assert.deepEqual(found.connections, []);
  assert.deepEqual(found.from, { floorId: F1, cell: cellAt(project, 1, 0, 0), side: 's', door: false });
  assert.deepEqual(found.to, { floorId: F1, cell: cellAt(project, 1, 5, 3), side: 'w', door: false });
  assert.deepEqual([found.fromRoomId, found.toRoomId], [roomId('1A'), roomId('1B')]);
});

test('seconds are the cells at secondsPerCell plus each connection at secondsPerStair, from the settings', () => {
  const project = threeFloors();
  project.settings.secondsPerCell = 5;
  project.settings.secondsPerStair = 20;
  const found = between(project, '1A', '2A');
  assert.equal(found.cells.length, 4);
  assert.equal(found.seconds, 4 * 5 + 20);
});

test('route refuses a graph that does not carry the walking speeds', () => {
  const project = twoRooms();
  assert.throws(() => route(buildGraph(project), roomId('1A'), roomId('1B')), /routingGraph/);
  const graph = routingGraph(project, buildGraph(project));
  assert.equal(route(graph, roomId('1A'), roomId('1B')).ok, true, 'a graph already built is wrapped, not rebuilt');
  assert.equal(routingGraph(project, graph), graph);
});

test('the same room is no travel', () => {
  assert.deepEqual(between(twoRooms(), '1A', '1A'), { ok: true, same: true, fromRoomId: roomId('1A'), toRoomId: roomId('1A') });
});

// ---- the cases the product description lists

test('a room with two doors uses the shorter one for each journey', () => {
  const project = planProject([[
    '.AAAAAA..',
    '.AAAAAA..',
    '#########',
    'B.......C',
  ]], { doors: { '1A': [[1, 1, 's'], [6, 1, 's']] } });
  const west = between(project, '1A', '1B');
  assert.deepEqual(path(project, west), ['1,2', '0,2']);
  assert.equal(west.from.cell, cellAt(project, 1, 1, 1), 'out of the west door');
  assert.equal(west.from.door, true);
  assert.equal(west.seconds, 6);
  const east = between(project, '1A', '1C');
  assert.deepEqual(path(project, east), ['6,2', '7,2', '8,2']);
  assert.equal(east.from.cell, cellAt(project, 1, 6, 1), 'out of the east door');
  assert.equal(between(project, '1B', '1A').to.cell, cellAt(project, 1, 1, 1), 'in at the west door');
  assert.equal(between(project, '1C', '1A').to.cell, cellAt(project, 1, 6, 1), 'in at the east door');
});

test('a three-floor stairwell is walked as a chain of two connections', () => {
  const project = threeFloors();
  const found = between(project, '1A', '3B');
  assert.deepEqual(path(project, found, true), ['1:1,2', '1:0,2', '2:0,2', '3:0,2', '3:1,2', '3:2,2', '3:3,2', '3:4,2']);
  assert.deepEqual(found.connections, ['cplan00001', 'cplan00002']);
  assert.deepEqual(found.connectionAt, [1, 2], 'each is taken from the cell at that place in the list');
  assert.equal(found.seconds, 8 * 3 + 2 * 8);
  assert.equal(found.turns, 2, 'towards the stairs, and into the room; none on the landings');
  assert.equal(found.stairs, 2);
});

test('a stairs connection costs secondsPerStair for each level between its floors, whatever order the floors are listed in', () => {
  const project = threeFloors();
  project.building.floors[2].level = 5;
  assert.equal(between(project, '1A', '3B').seconds, 8 * 3 + 8 + 3 * 8);
  project.building.floors.reverse();
  assert.equal(between(project, '1A', '3B').seconds, 8 * 3 + 8 + 3 * 8);
});

test('the levels a connection climbs are counted when the route is chosen, not only when it is timed', () => {
  // from A to B: 13 cells round by the corridor (39 s), or 5 cells by way of the landing upstairs and two connections
  const project = planProject([
    ['.A...B.', 'S#...#S', '.#...#.', '.#...#.', '.#...#.', '.#####.'],
    ['S....'],
  ], { connections: [[1, 0, 1, 2, 0, 0], [2, 0, 0, 1, 6, 1]] });
  project.building.floors[1].level = 3; // two levels up and two down: 15 + 32 = 47 s
  const round = between(project, '1A', '1B');
  assert.deepEqual([round.cells.length, round.connections.length, round.seconds], [13, 0, 39]);
  project.building.floors[1].level = 2; // one level each way: 15 + 16 = 31 s
  const over = between(project, '1A', '1B');
  assert.deepEqual([over.cells.length, over.connections, over.seconds], [5, ['cplan00001', 'cplan00002'], 31]);
});

// The quickest time between two rooms by a plain search over cells: no
// headings, no heap, no packed cost. It knows only the price of a cell and
// of a connection, so it can say what the quickest time is and nothing about
// which of two equally quick routes is taken.
function quickest(graph, fromRoomId) {
  const time = new Float64Array(graph.count).fill(Infinity);
  const done = new Uint8Array(graph.count);
  for (const entry of graph.rooms.get(fromRoomId).entries) time[entry.node] = graph.secondsPerCell;
  for (;;) {
    let node = -1;
    for (let i = 0; i < graph.count; i += 1) if (!done[i] && time[i] < Infinity && (node === -1 || time[i] < time[node])) node = i;
    if (node === -1) return time;
    done[node] = 1;
    for (let h = 0; h < 4; h += 1) {
      const next = graph.neighbours[node * 4 + h];
      if (next !== -1) time[next] = Math.min(time[next], time[node] + graph.secondsPerCell);
    }
    for (const link of graph.links) {
      if (link.a !== node && link.b !== node) continue;
      const next = link.a === node ? link.b : link.a;
      time[next] = Math.min(time[next], time[node] + graph.secondsPerStair * link.levels + graph.secondsPerCell);
    }
  }
}

test('no route takes longer than the quickest time a plain search over the cells finds', () => {
  const project = bigProject({ seed: 3 });
  project.building.floors[2].level = 5; // so some stairs climb two levels and some one
  project.building.floors[3].level = 6;
  const graph = routingGraph(project);
  const rooms = Array.from(graph.rooms.keys());
  let compared = 0;
  for (const from of [rooms[0], rooms[40], rooms[77], rooms[149]]) {
    const time = quickest(graph, from);
    for (const to of rooms) {
      if (to === from) continue;
      const found = route(graph, from, to);
      const best = Math.min(...graph.rooms.get(to).entries.map((entry) => time[entry.node]));
      assert.equal(found.seconds, best, from + ' to ' + to);
      assert.equal(found.seconds, found.cells.length * 3 + found.connections.reduce((sum, id) => sum + 8 * graph.links.find((link) => link.id === id).levels, 0));
      compared += 1;
    }
  }
  assert.equal(compared, 4 * 149);
});

test('a connection between two stairs on one floor costs one floor', () => {
  const project = splitLevel();
  const found = between(project, '1A', '1B');
  assert.deepEqual(path(project, found), ['2,2', '3,2', '6,2', '7,2']);
  assert.deepEqual(found.connections, ['cplan00001']);
  assert.equal(found.seconds, 4 * 3 + 8);
  assert.equal(found.turns, 2);
});

test('a disconnected wing fails as unreachable, naming the room and its floor', () => {
  const project = disconnectedWing();
  assert.deepEqual(between(project, '1A', '1C'), { ok: false, reason: 'unreachable', roomId: roomId('1C'), floorId: F1, end: 'to', fromRoomId: roomId('1A'), toRoomId: roomId('1C'), avoiding: [] });
  assert.equal(between(project, '1A', '1B').ok, true, 'two rooms in the same wing are joined');
  const floors = clone(threeFloors());
  floors.building.connections = [];
  const upstairs = between(floors, '1A', '2B');
  assert.deepEqual([upstairs.reason, upstairs.roomId, upstairs.floorId], ['unreachable', roomId('2B'), F2]);
});

test('a route never takes stairs it does not need: the corridor wins when the stairs would be fewer cells and more seconds', () => {
  // stairs at both ends are joined to each other, so the stairs way is 4 cells and 8 seconds of stairs (20 s) against 5 cells (15 s)
  const project = planProject([[
    '.A...B.',
    '.A...B.',
    'S#####S',
  ]], { connections: [[1, 0, 2, 1, 6, 2]] });
  const found = between(project, '1A', '1B');
  assert.deepEqual(path(project, found), ['1,2', '2,2', '3,2', '4,2', '5,2']);
  assert.deepEqual(found.connections, []);
  assert.equal(found.seconds, 15);
  // and it does take them once they are the quicker way
  project.settings.secondsPerStair = 2;
  const quick = between(project, '1A', '1B');
  assert.deepEqual(path(project, quick), ['1,2', '0,2', '6,2', '5,2']);
  assert.equal(quick.seconds, 14);
});

test('time comes before turns: the quicker route is taken though a slower one turns less', () => {
  // into room B from the north is 3 cells and two turns; straight down the west side and in from the west is 5 cells and one
  const project = planProject([[
    '.A....',
    '.###..',
    '.#.B..',
    '.#.B..',
    '.#.B..',
    '.#BB..',
  ]]);
  const found = between(project, '1A', '1B');
  assert.deepEqual(path(project, found), ['1,1', '2,1', '3,1']);
  assert.deepEqual([found.seconds, found.turns], [9, 2]);
  // the slower, straighter way is really there: shut the top corridor's far end
  const floor = project.building.floors[0];
  const end = cellAt(project, 1, 3, 1);
  floor.cells = floor.cells.slice(0, end) + '.' + floor.cells.slice(end + 1);
  const straighter = between(project, '1A', '1B');
  assert.deepEqual([straighter.cells.length, straighter.seconds, straighter.turns], [5, 15, 1]);
});

// ---- ties, one rule at a time

test('tie-break 1, fewest turns: of ways that take the same time the straightest is taken, though the search looks the other way first', () => {
  // every way is 8 cells. Down the west side and along the bottom is one turn.
  // East first, which is the way the search looks first, is three turns or five.
  const project = planProject([[
    'A......',
    '###....',
    '#.#....',
    '#.###..',
    '#####B.',
  ]]);
  const found = between(project, '1A', '1B');
  assert.deepEqual(path(project, found), ['0,1', '0,2', '0,3', '0,4', '1,4', '2,4', '3,4', '4,4']);
  assert.equal(found.turns, 1);
  assert.equal(found.seconds, 24);
});

test('tie-break 2, fewest stairs: of two ways with the same time and turns the one with fewer connections is taken', () => {
  // West: stairs A then B, one floor each, by way of Floor 2. East: stairs C, two floors in one.
  // Both are 5 cells, 16 seconds of stairs and 2 turns.
  const project = planProject([
    ['.....', '.A...', 'S#S..'],
    ['.....', '.....', 'S....'],
    ['.....', '.B...', 'S##S.'],
  ], { connections: [[1, 0, 2, 2, 0, 2], [2, 0, 2, 3, 0, 2], [1, 2, 2, 3, 3, 2]] });
  const found = between(project, '1A', '3B');
  assert.deepEqual(found.connections, ['cplan00003']);
  assert.deepEqual(path(project, found, true), ['1:1,2', '1:2,2', '3:3,2', '3:2,2', '3:1,2']);
  assert.deepEqual([found.seconds, found.turns, found.stairs], [31, 2, 1]);
  // the other way really is its equal in time and turns: shut C and compare
  const chain = between(project, '1A', '3B', { avoidConnections: new Set(['cplan00003']) });
  assert.deepEqual([chain.seconds, chain.turns, chain.stairs], [31, 2, 2]);
});

test('tie-break 3, the fixed direction order: equal in time, turns and stairs, the way found first is taken (north, east, south, west)', () => {
  // a ring: east about and west about are mirror images
  const ring = planProject([[
    '..A..',
    '#####',
    '#...#',
    '#####',
    '..B..',
  ]]);
  const eastAbout = between(ring, '1A', '1B');
  assert.deepEqual(path(ring, eastAbout), ['2,1', '3,1', '4,1', '4,2', '4,3', '3,3', '2,3'], 'east is looked at before west');
  assert.equal(eastAbout.turns, 4);

  // the same ring on its side: north about and south about
  const side = planProject([[
    '.###.',
    '.#.#.',
    'A#.#B',
    '.#.#.',
    '.###.',
  ]]);
  assert.deepEqual(path(side, between(side, '1A', '1B')), ['1,2', '1,1', '1,0', '2,0', '3,0', '3,1', '3,2'], 'north is looked at before south');

  // two ways that end on the same cell facing different ways, level once the step into the room is
  // counted: the one that reached the cell first is taken. Here that is south then east (one turn on
  // the way, one into the room) over east then south (two on the way, none into the room).
  const square = planProject([[
    'A....',
    '###..',
    '#.#..',
    '###..',
    '..B..',
  ]]);
  const first = between(square, '1A', '1B');
  assert.deepEqual(path(square, first), ['0,1', '0,2', '0,3', '1,3', '2,3']);
  assert.equal(first.turns, 2);

  // and when the two ways meet again before the end, on the same cell with the same heading
  const spur = planProject([[
    '..A..',
    '#####',
    '#...#',
    '#####',
    '..#..',
    '..B..',
  ]]);
  assert.deepEqual(path(spur, between(spur, '1A', '1B')), ['2,1', '3,1', '4,1', '4,2', '4,3', '3,3', '2,3', '2,4']);
});

test('two runs agree, and reordering the floors array changes no route', () => {
  const project = school();
  const turned = clone(project);
  turned.building.floors.reverse();
  const rooms = Array.from(routingGraph(project).rooms.keys());
  const graphs = [routingGraph(project), routingGraph(project), routingGraph(turned)];
  let compared = 0;
  for (const from of rooms) {
    for (const to of rooms) {
      const [first, second, reordered] = graphs.map((graph) => route(graph, from, to));
      assert.deepEqual(second, first);
      assert.deepEqual(reordered, first, from + ' to ' + to + ' with the floors listed the other way');
      compared += 1;
    }
  }
  assert.equal(compared, 13 * 13);
  const floors = threeFloors();
  const reversed = clone(floors);
  reversed.building.floors.reverse();
  assert.deepEqual(between(reversed, '3B', '1A'), between(floors, '3B', '1A'));
});

// ---- options

test('avoid stairs: a step-free route uses no connection, and with no step-free way the failure says so', () => {
  const project = planProject([[
    '.A...B.',
    '.A...B.',
    'S#####S',
  ]], { connections: [[1, 0, 2, 1, 6, 2]] });
  project.settings.secondsPerStair = 2;
  assert.deepEqual(between(project, '1A', '1B').connections, ['cplan00001'], 'the stairs are the quicker way here');
  const stepFree = between(project, '1A', '1B', { avoidStairs: true });
  assert.deepEqual(stepFree.connections, []);
  assert.equal(stepFree.seconds, 15);

  const floors = threeFloors();
  assert.deepEqual(between(floors, '1A', '2A', { avoidStairs: true }), { ok: false, reason: 'unreachable', roomId: roomId('2A'), floorId: F2, end: 'to', fromRoomId: roomId('1A'), toRoomId: roomId('2A'), avoiding: ['stairs'] });
});

test('avoid a connection: the route goes another way, or fails when there is none', () => {
  const project = planProject([
    ['.A...', '.A...', 'S###S'],
    ['.B...', '.B...', 'S###S'],
  ], { connections: [[1, 0, 2, 2, 0, 2], [1, 4, 2, 2, 4, 2]] });
  assert.deepEqual(between(project, '1A', '2B').connections, ['cplan00001']);
  const other = between(project, '1A', '2B', { avoidConnections: ['cplan00001'] });
  assert.deepEqual(other.connections, ['cplan00002']);
  const none = between(project, '1A', '2B', { avoidConnections: new Set(['cplan00001', 'cplan00002']) });
  assert.deepEqual([none.reason, none.avoiding], ['unreachable', ['connections']]);
});

test('avoid a named corridor: its cells are not walked on', () => {
  const project = planProject([[
    'A...B',
    '#####',
    '#...#',
    '#####',
  ]]);
  const floor = project.building.floors[0];
  floor.corridors.push({ id: 'kplan00001', name: 'North Hall', cells: [cellAt(project, 1, 1, 1), cellAt(project, 1, 2, 1), cellAt(project, 1, 3, 1)] });
  assert.deepEqual(validate(project), []);
  assert.deepEqual(path(project, between(project, '1A', '1B')), ['0,1', '1,1', '2,1', '3,1', '4,1']);
  const around = between(project, '1A', '1B', { avoidCorridorNames: new Set(['kplan00001']) });
  assert.deepEqual(path(project, around), ['0,1', '0,2', '0,3', '1,3', '2,3', '3,3', '4,3', '4,2', '4,1']);
  assert.equal(around.seconds, 27);
  assert.deepEqual(path(project, between(project, '1A', '1B', { avoidCorridorNames: ['knowhere00'] })), ['0,1', '1,1', '2,1', '3,1', '4,1'], 'a name the building does not have shuts nothing');

  // a corridor that covers a room's only way out leaves no way through
  floor.corridors[0].cells = [cellAt(project, 1, 0, 1)];
  const shut = between(project, '1A', '1B', { avoidCorridorNames: ['kplan00001'] });
  assert.deepEqual([shut.reason, shut.avoiding], ['unreachable', ['corridors']]);
});

test('a one-way connection is taken only its own way', () => {
  const project = threeFloors();
  project.building.connections[0].direction = 'ab'; // Floor 1 up to Floor 2 only
  assert.equal(between(project, '1A', '2A').ok, true);
  assert.equal(between(project, '2A', '1A').reason, 'unreachable');
  project.building.connections[0].direction = 'ba';
  assert.equal(between(project, '1A', '2A').reason, 'unreachable');
  assert.equal(between(project, '2A', '1A').ok, true);
});

// ---- the building levers: ways, shutCells, undirected (ARCHITECTURE 18.3, 18.4)

const WAYS_PLAN = [[
  'A...B',
  '#####',
  '#...#',
  '#####',
]];

function fieldKeys(cache) {
  return Array.from(cache.fields.keys());
}

test('routing key with neither ways nor shutCells is byte-identical to the key before they existed', () => {
  const project = planProject(WAYS_PLAN);
  const graph = routingGraph(project);
  const cache = createRouteCache();
  route(graph, roomId('1A'), roomId('1B'), { cache, geometryVersion: 1 });
  const today = roomId('1A') + '|3|8|0||';
  assert.deepEqual(fieldKeys(cache), [today], 'secondsPerCell|secondsPerStair|avoidStairs|shut links|shut nodes, nothing after');
  // options that say nothing leave the key as it was
  for (const options of [{ ways: {} }, { shutCells: [] }, { undirected: false }, { ways: { cnowhere: 'ab' } }, { shutCells: [{ floorId: 'fnowhere', cell: 3 }] }]) {
    const beside = createRouteCache();
    route(graph, roomId('1A'), roomId('1B'), { cache: beside, geometryVersion: 1, ...options });
    assert.deepEqual(fieldKeys(beside).map((key) => key.replace(/\|[^|]*$/, '')), [today.replace(/\|[^|]*$/, '')], JSON.stringify(options));
  }
  const stepFree = createRouteCache();
  route(graph, roomId('1A'), roomId('1B'), { cache: stepFree, geometryVersion: 1, avoidStairs: true });
  assert.deepEqual(fieldKeys(stepFree), [roomId('1A') + '|3|8|1||'], 'the other options keep their keys too');
});

test('a ways entry runs a connection one way for that call only, and joins the key', () => {
  const project = threeFloors();
  const id = project.building.connections[0].id;
  const graph = routingGraph(project);
  assert.equal(project.building.connections[0].direction, 'both');
  assert.equal(route(graph, roomId('2A'), roomId('1A'), { ways: { [id]: 'ab' } }).reason, 'unreachable', 'up only: nothing comes down');
  assert.equal(route(graph, roomId('1A'), roomId('2A'), { ways: { [id]: 'ab' } }).ok, true);
  assert.equal(route(graph, roomId('1A'), roomId('2A'), { ways: { [id]: 'ba' } }).reason, 'unreachable', 'down only: nothing goes up');
  assert.equal(route(graph, roomId('2A'), roomId('1A'), { ways: { [id]: 'ba' } }).ok, true);
  assert.equal(route(graph, roomId('2A'), roomId('1A')).ok, true, 'the building itself is as it was');
  assert.equal(project.building.connections[0].direction, 'both');

  // one-way in the building, both ways for the call
  project.building.connections[0].direction = 'ab';
  const oneWay = routingGraph(project);
  assert.equal(route(oneWay, roomId('2A'), roomId('1A')).reason, 'unreachable');
  assert.equal(route(oneWay, roomId('2A'), roomId('1A'), { ways: { [id]: 'both' } }).ok, true, 'a way overrides the connection\'s direction');

  const cache = createRouteCache();
  route(graph, roomId('1A'), roomId('2A'), { cache, geometryVersion: 1 });
  route(graph, roomId('1A'), roomId('2A'), { cache, geometryVersion: 1, ways: { [id]: 'ab' } });
  route(graph, roomId('1A'), roomId('2A'), { cache, geometryVersion: 1, ways: { [id]: 'both' } });
  assert.equal(cache.searches, 2, 'a way equal to the connection\'s own is the plan it already was');
  assert.deepEqual(fieldKeys(cache), [roomId('1A') + '|3|8|0||', roomId('1A') + '|3|8|0|||w:' + id + '=ab']);
});

test('a connection in avoidConnections is closed whatever its way, and a closed cell is not walked on', () => {
  const project = planProject(WAYS_PLAN);
  const graph = routingGraph(project);
  const open = between(project, '1A', '1B');
  assert.deepEqual(path(project, open), ['0,1', '1,1', '2,1', '3,1', '4,1']);
  const shut = [{ floorId: F1, cell: cellAt(project, 1, 2, 1) }];
  const around = route(graph, roomId('1A'), roomId('1B'), { shutCells: shut });
  assert.deepEqual(path(project, around), ['0,1', '0,2', '0,3', '1,3', '2,3', '3,3', '4,3', '4,2', '4,1'], 'the same detour a closed named corridor gives');
  assert.deepEqual(around.cells, route(graph, roomId('1A'), roomId('1B'), { shutCells: shut }).cells);
  // the same cells shut by name and by cell are one plan
  const floor = project.building.floors[0];
  floor.corridors.push({ id: 'kplan00001', name: 'North Hall', cells: [cellAt(project, 1, 2, 1)] });
  const named = createRouteCache();
  const bare = createRouteCache();
  const byName = route(routingGraph(project), roomId('1A'), roomId('1B'), { cache: named, geometryVersion: 1, avoidCorridorNames: ['kplan00001'] });
  const byCell = route(routingGraph(project), roomId('1A'), roomId('1B'), { cache: bare, geometryVersion: 1, shutCells: shut });
  assert.deepEqual(fieldKeys(named), fieldKeys(bare));
  assert.deepEqual(byName.cells, byCell.cells);
  // a closure that cuts the only way through says so
  const cut = route(routingGraph(project), roomId('1A'), roomId('1B'), { shutCells: [{ floorId: F1, cell: cellAt(project, 1, 0, 1) }] });
  assert.deepEqual([cut.reason, cut.avoiding], ['unreachable', ['corridors']]);
});

test('plan.avoiding names corridors only when a shut cell resolves to a node (SV2-90b)', () => {
  const project = threeFloors();
  const id = project.building.connections[0].id;
  const graph = routingGraph(project);
  const up = { ways: { [id]: 'ab' } };
  const nowhere = [{ floorId: 'fnowhere', cell: 3 }, null, { floorId: project.building.floors[0].id, cell: -5 }];
  const said = route(graph, roomId('2A'), roomId('1A'), { ...up, shutCells: nowhere });
  assert.deepEqual([said.reason, said.avoiding], ['unreachable', []], 'cells that are on no node shut nothing, so nothing was avoided');
  assert.deepEqual(route(graph, roomId('2A'), roomId('1A'), { ...up, shutCells: [] }).avoiding, []);
  // one cell on a node among the rest: it is named
  const here = project.building.floors[0].cells.indexOf('#');
  const real = route(graph, roomId('2A'), roomId('1A'), { ...up, shutCells: nowhere.concat([{ floorId: project.building.floors[0].id, cell: here }]) });
  assert.deepEqual(real.avoiding, ['corridors']);
});

test('a cached distance field is never served across a closure, a way or undirected', () => {
  const project = planProject(WAYS_PLAN);
  const graph = routingGraph(project);
  const cache = createRouteCache();
  const options = { cache, geometryVersion: 1 };
  assert.equal(route(graph, roomId('1A'), roomId('1B'), options).seconds, 15);
  const shut = [{ floorId: F1, cell: cellAt(project, 1, 2, 1) }];
  assert.equal(route(graph, roomId('1A'), roomId('1B'), { ...options, shutCells: shut }).seconds, 27, 'warm without the closure, yet the closure is worked out');
  assert.equal(route(graph, roomId('1A'), roomId('1B'), options).seconds, 15, 'and the open plan is still held');
  assert.equal(cache.searches, 2);

  const stairs = threeFloors();
  const id = stairs.building.connections[0].id;
  const g = routingGraph(stairs);
  const c = createRouteCache();
  assert.equal(route(g, roomId('2A'), roomId('1A'), { cache: c, geometryVersion: 1 }).ok, true);
  assert.equal(route(g, roomId('2A'), roomId('1A'), { cache: c, geometryVersion: 1, ways: { [id]: 'ab' } }).ok, false, 'the stairs are up only for this plan');
  assert.equal(route(g, roomId('2A'), roomId('1A'), { cache: c, geometryVersion: 1 }).ok, true);
});

test('undirected uses every stairs connection both ways and is in the key only when true', () => {
  const project = threeFloors();
  project.building.connections[0].direction = 'ab';
  const id = project.building.connections[0].id;
  const graph = routingGraph(project);
  assert.equal(route(graph, roomId('2A'), roomId('1A')).reason, 'unreachable');
  const down = route(graph, roomId('2A'), roomId('1A'), { undirected: true });
  assert.equal(down.ok, true);
  assert.deepEqual(down.connections, [id]);
  assert.equal(route(graph, roomId('2A'), roomId('1A'), { undirected: true, ways: { [id]: 'ab' } }).ok, true, 'undirected beats a way');

  const cache = createRouteCache();
  route(graph, roomId('1A'), roomId('2A'), { cache, geometryVersion: 1 });
  route(graph, roomId('1A'), roomId('2A'), { cache, geometryVersion: 1, undirected: true });
  assert.equal(cache.searches, 2, 'the up-only plan and the undirected plan are two fields');
  assert.deepEqual(fieldKeys(cache), [roomId('1A') + '|3|8|0||', roomId('1A') + '|3|8|0|||u']);
  // a building with no one-way connection: undirected is the plain plan
  const plain = threeFloors();
  const alike = createRouteCache();
  route(routingGraph(plain), roomId('1A'), roomId('2A'), { cache: alike, geometryVersion: 1 });
  route(routingGraph(plain), roomId('1A'), roomId('2A'), { cache: alike, geometryVersion: 1, undirected: true });
  assert.equal(alike.searches, 1, 'with every connection both ways there is nothing to ignore, so one field serves both');
  // routeToExit takes it too
  const exit = routeToExit(graph, roomId('2A'), { undirected: true });
  assert.equal(exit.ok, true, 'the exit is on Floor 1 and the way there is down an up-only stair');
  assert.equal(routeToExit(graph, roomId('2A')).ok, false);
});

test('routesForSchedule passes ways and shutCells through to every journey', () => {
  const project = school();
  const graph = routingGraph(project);
  const open = routesForSchedule(project, graph, { cache: createRouteCache(), geometryVersion: 1 });
  const connection = project.building.connections[0];
  const cache = createRouteCache();
  const shut = routesForSchedule(project, graph, { cache, geometryVersion: 1, avoidConnections: [connection.id] });
  const down = routesForSchedule(project, graph, { cache, geometryVersion: 1, ways: { [connection.id]: connection.direction === 'ab' ? 'ba' : 'ab' } });
  assert.equal(shut.transitions, open.transitions);
  assert.ok(shut.searches > 0 && down.searches > 0, 'each plan searched afresh in one cache');
});

// ---- entries

test('adjacent rooms that share an entry cell: the route is that one cell', () => {
  const project = twoRooms();
  const found = between(project, '1A', '1B');
  assert.deepEqual(path(project, found), ['1,2']);
  assert.deepEqual([found.seconds, found.turns], [3, 0]);
  assert.equal(found.from.cell, cellAt(project, 1, 1, 1));
  assert.deepEqual(found.to, { floorId: F1, cell: cellAt(project, 1, 1, 3), side: 'n', door: false });
});

test('a door that opens onto a stairs cell: the route starts on the stairs and can take them at once', () => {
  const project = planProject([
    ['.....', 'A....', 'S###.'],
    ['.....', '..B..', 'S###.'],
  ], { doors: { '1A': [[0, 1, 's']] }, connections: [[1, 0, 2, 2, 0, 2]] });
  const found = between(project, '1A', '2B');
  assert.deepEqual(path(project, found, true), ['1:0,2', '2:0,2', '2:1,2', '2:2,2']);
  assert.deepEqual(found.connectionAt, [0]);
  assert.deepEqual([found.seconds, found.turns], [4 * 3 + 8, 1]);
});

// ---- the named failures

test('the named failures: no room, a room not in the building, a room with no way in', () => {
  assert.deepEqual(ROUTE_FAILURES, ['no-room', 'room-missing', 'no-entry', 'unreachable']);
  const project = planProject([[
    '.A.....',
    '####...',
    '.....C.',
  ]]);
  const graph = routingGraph(project);
  const A = roomId('1A');
  const C = roomId('1C');
  assert.deepEqual(route(graph, null, A), { ok: false, reason: 'no-room', roomId: null, floorId: null, end: 'from', fromRoomId: null, toRoomId: A, avoiding: [] });
  assert.deepEqual([route(graph, A, null).reason, route(graph, A, null).end], ['no-room', 'to']);
  assert.deepEqual(route(graph, A, 'rnowhere00'), { ok: false, reason: 'room-missing', roomId: 'rnowhere00', floorId: null, end: 'to', fromRoomId: A, toRoomId: 'rnowhere00', avoiding: [] });
  assert.equal(route(graph, 'rnowhere00', 'rnowhere00').reason, 'room-missing', 'a missing room is not "the same room"');
  assert.deepEqual(route(graph, A, C), { ok: false, reason: 'no-entry', roomId: C, floorId: F1, end: 'to', fromRoomId: A, toRoomId: C, avoiding: [] });
  assert.deepEqual([route(graph, C, A).reason, route(graph, C, A).end], ['no-entry', 'from']);

  // every door leads nowhere
  const dead = twoRooms();
  dead.building.floors[0].spaces[0].doors = [{ cell: cellAt(dead, 1, 1, 0), side: 'n' }];
  assert.equal(between(dead, '1B', '1A').reason, 'no-entry');
});

// ---- to an exit

test('routeToExit goes to the exit that is quickest to walk to', () => {
  const project = threeFloors();
  const graph = routingGraph(project);
  const found = routeToExit(graph, roomId('3A'));
  assert.equal(found.ok, true);
  assert.equal(found.exitId, 'xplan00001');
  assert.deepEqual(found.exit, { id: 'xplan00001', floorId: F1, cell: cellAt(project, 1, 6, 2) });
  assert.deepEqual(path(project, found, true), ['3:1,2', '3:0,2', '2:0,2', '1:0,2', '1:1,2', '1:2,2', '1:3,2', '1:4,2', '1:5,2', '1:6,2']);
  assert.equal(found.seconds, 10 * 3 + 16);
  assert.equal(routeToExit(graph, roomId('3A'), { avoidExits: ['xplan00001'] }).reason, 'unreachable');
  assert.equal(routeToExit(graph, roomId('3A'), { avoidStairs: true }).reason, 'unreachable');
  assert.equal(routeToExit(graph, 'rnowhere00').reason, 'room-missing');

  const two = planProject([['A.....B', '#######']], { exits: [[1, 0, 1, 'West Door'], [1, 6, 1, 'East Door']] });
  const twoGraph = routingGraph(two);
  assert.equal(routeToExit(twoGraph, roomId('1A')).exitId, 'xplan00001');
  assert.equal(routeToExit(twoGraph, roomId('1B')).exitId, 'xplan00002');
});

// ---- the whole schedule

test('routesForSchedule gives every transition of every group on every own day type', () => {
  const project = school();
  const result = routesForSchedule(project);
  assert.deepEqual(result.days.map((day) => day.dayTypeId), ['dsample00a', 'dsample00b']);
  assert.equal(result.transitions, 2 * 8 * 7);
  for (const day of result.days) {
    assert.deepEqual(day.groups.map((group) => group.groupId), project.groups.map((group) => group.id));
    for (const group of day.groups) {
      assert.equal(group.routes.length, 7);
      group.routes.forEach((found, t) => {
        assert.equal(found.ok, true);
        assert.equal(found.fromRoomId, project.groups.find((candidate) => candidate.id === group.groupId).days[day.dayTypeId][t].room);
      });
    }
  }
  // the sample school's long walk, as its own file describes it
  const long = result.days[0].groups.find((group) => group.groupId === 'gsample08a').routes[5];
  assert.deepEqual([long.fromRoomId, long.toRoomId], ['rsamplegym', 'rsample303']);
  assert.deepEqual([long.cells.length, long.connections, long.seconds], [81, ['csample00a', 'csample00b'], 259]);
  assert.deepEqual(routesForSchedule(project), result, 'a second run from nothing agrees');
});

test('routesForSchedule names an empty slot and a slot whose room has gone, and a day type that follows A Day has no routes of its own', () => {
  const project = school();
  const group = project.groups[0];
  group.days.dsample00a[1] = { room: null, roomText: '', label: '', teacherIds: [] };
  group.days.dsample00a[4] = { room: null, roomText: '999', label: '', teacherIds: [] };
  const routes = routesForSchedule(project).days[0].groups[0].routes;
  assert.deepEqual([routes[0].reason, routes[0].end, routes[0].fromRoomId, routes[0].toRoomId], ['no-room', 'to', group.days.dsample00a[0].room, null]);
  assert.deepEqual([routes[1].reason, routes[1].end], ['no-room', 'from']);
  assert.deepEqual([routes[3].reason, routes[3].end, routes[3].text], ['room-missing', 'to', '999']);
  assert.deepEqual([routes[4].reason, routes[4].end, routes[4].text], ['room-missing', 'from', '999']);
  assert.equal(routes[5].ok, true);

  project.dayTypes[1].own = false;
  assert.deepEqual(routesForSchedule(project).days.map((day) => day.dayTypeId), ['dsample00a']);
});

test('routesForSchedule works on a graph already built, and with the options', () => {
  const project = threeFloors();
  project.groups.push({ id: 'gplan00001', name: 'One', grade: '', headCount: null, colour: '#d1495b', days: { [project.dayTypes[0].id]: project.dayTypes[0].bells.map((unused, p) => ({ room: roomId(['1A', '3B', '1B', '1B', '2A', '1A', '3A', '3B'][p]), roomText: '', label: '', teacherIds: [] })) } });
  assert.deepEqual(validate(project), []);
  const plain = routesForSchedule(project, buildGraph(project));
  assert.deepEqual(plain.days[0].groups[0].routes.map((found) => (found.same ? 'same' : found.seconds)), [40, 49, 'same', 29, 20, 31, 9]);
  assert.equal(plain.pairs, 6);
  const stepFree = routesForSchedule(project, undefined, { avoidStairs: true });
  assert.deepEqual(stepFree.days[0].groups[0].routes.map((found) => (found.ok ? (found.same ? 'same' : found.seconds) : found.reason)), ['unreachable', 'unreachable', 'same', 'unreachable', 'unreachable', 'unreachable', 9]);
});

// ---- the cache

test('the big fixture is the promised size, valid, and the same for the same seed', () => {
  const project = bigProject({ seed: 1 });
  assert.deepEqual(validate(project), []);
  const rooms = project.building.floors.reduce((sum, floor) => sum + floor.spaces.filter((space) => space.kind === 'room').length, 0);
  assert.deepEqual(
    [project.building.floors.length, project.building.floors[0].width, project.building.floors[0].height, rooms, project.teachers.length, project.groups.length, project.settings.periods, project.dayTypes.filter((dayType) => dayType.own).length, project.building.connections.length],
    [BIG.floors, BIG.width, BIG.height, BIG.rooms, BIG.teachers, BIG.groups, BIG.periods, BIG.dayTypes, BIG.connections],
  );
  assert.deepEqual([BIG.floors, BIG.width, BIG.height, BIG.rooms, BIG.groups, BIG.periods, BIG.dayTypes], [4, 60, 40, 150, 80, 10, 2]);
  assert.deepEqual(bigProject({ seed: 1 }), project);
  assert.deepEqual(bigProject(), project, 'the seed defaults to 1');
  assert.notDeepEqual(bigProject({ seed: 2 }).groups, project.groups);
  const graph = buildGraph(project);
  assert.equal(Array.from(graph.rooms.values()).filter((room) => room.entries.length === 0).length, 0, 'every room opens onto a corridor');
});

test('the cache keeps one distance field for each start room, at most 64, the least recently used going first', () => {
  const project = bigProject({ seed: 1 });
  const graph = routingGraph(project);
  const rooms = Array.from(graph.rooms.keys());
  const cache = createRouteCache();
  const options = { cache, geometryVersion: 1 };
  assert.equal(FIELD_LIMIT, 64);
  assert.equal(cache.limit, 64);

  for (let i = 0; i < 64; i += 1) route(graph, rooms[i], rooms[100], options);
  assert.equal(cache.searches, 64);
  assert.equal(cache.fields.size, 64);
  route(graph, rooms[5], rooms[101], options);
  assert.equal(cache.searches, 64, 'another journey from a room already searched from searches nothing');
  route(graph, rooms[5], rooms[100], options);
  assert.equal(cache.searches, 64, 'and the same journey again is not even read back out of the field');

  route(graph, rooms[0], rooms[102], options); // room 0 is now the most recently used
  route(graph, rooms[64], rooms[100], options); // a 65th field: the least recently used goes, which is room 1's
  assert.equal(cache.searches, 65);
  assert.equal(cache.fields.size, 64);
  route(graph, rooms[0], rooms[103], options);
  assert.equal(cache.searches, 65, 'room 0 was kept');
  route(graph, rooms[1], rooms[103], options);
  assert.equal(cache.searches, 66, 'room 1 was not');

  const small = createRouteCache(2);
  for (let i = 0; i < 5; i += 1) route(graph, rooms[i], rooms[100], { cache: small });
  assert.equal(small.fields.size, 2);
});

test('the cache is emptied when the geometry version moves, and options have fields of their own', () => {
  const project = bigProject({ seed: 1 });
  const graph = routingGraph(project);
  const rooms = Array.from(graph.rooms.keys());
  const cache = createRouteCache();
  const first = route(graph, rooms[0], rooms[1], { cache, geometryVersion: 4 });
  assert.equal(route(graph, rooms[0], rooms[1], { cache, geometryVersion: 4 }), first, 'the very same object');
  assert.equal(cache.searches, 1);
  route(graph, rooms[0], rooms[1], { cache, geometryVersion: 4, avoidStairs: true });
  assert.equal(cache.searches, 2, 'a step-free search is its own field');
  assert.equal(cache.fields.size, 2);
  route(graph, rooms[0], rooms[1], { cache, geometryVersion: 5 });
  assert.equal(cache.searches, 3);
  assert.equal(cache.fields.size, 1, 'everything from version 4 is gone');

  // with no version given, a different graph empties it
  const loose = createRouteCache();
  route(graph, rooms[0], rooms[1], { cache: loose });
  route(graph, rooms[0], rooms[2], { cache: loose });
  assert.equal(loose.searches, 1);
  route(routingGraph(project), rooms[0], rooms[1], { cache: loose });
  assert.equal(loose.searches, 2);
});

test('a cached route does not outlive a change to the building: the same journey after a wall goes up', () => {
  const project = planProject([[
    'A...B',
    '#####',
    '#...#',
    '#####',
  ]]);
  const cache = createRouteCache();
  assert.equal(route(routingGraph(project), roomId('1A'), roomId('1B'), { cache, geometryVersion: 1 }).seconds, 15);
  const floor = project.building.floors[0];
  const gap = cellAt(project, 1, 2, 1);
  floor.cells = floor.cells.slice(0, gap) + '.' + floor.cells.slice(gap + 1);
  assert.equal(route(routingGraph(project), roomId('1A'), roomId('1B'), { cache, geometryVersion: 2 }).seconds, 27);
});

test('routesForSchedule searches once for each start room however small the cache, and not at all the second time', () => {
  const project = bigProject({ seed: 1 });
  const graph = routingGraph(project);
  const cache = createRouteCache();
  const cold = routesForSchedule(project, graph, { cache, geometryVersion: 1 });
  assert.equal(cold.transitions, BIG.groups * (BIG.periods - 1) * BIG.dayTypes);
  const starts = new Set();
  for (const day of cold.days) for (const group of day.groups) for (const found of group.routes) if (found.ok && !found.same) starts.add(found.fromRoomId);
  assert.ok(starts.size > FIELD_LIMIT, 'more start rooms than the cache holds: ' + starts.size);
  assert.equal(cold.searches, starts.size);
  const warm = routesForSchedule(project, graph, { cache, geometryVersion: 1 });
  assert.equal(warm.searches, 0);
  assert.deepEqual(warm.days, cold.days);
  assert.equal(routesForSchedule(project, graph, { cache, geometryVersion: 2 }).searches, starts.size);
});

test('full routing on one floor of 200 by 200 completes', () => {
  // one open hall of 40,000 cells with 25 rooms standing in it
  const letters = 'ABCDEFGHIJKLMNOPQRTUVWXYZ';
  const rows = Array.from({ length: 200 }, () => new Array(200).fill('#'));
  Array.from(letters).forEach((letter, index) => {
    const x = 18 + (index % 5) * 40;
    const y = 18 + Math.floor(index / 5) * 40;
    for (let dy = 0; dy < 3; dy += 1) for (let dx = 0; dx < 3; dx += 1) rows[y + dy][x + dx] = letter;
  });
  const project = planProject([rows.map((row) => row.join(''))]);
  const day = project.dayTypes[0];
  for (let g = 0; g < 10; g += 1) {
    project.groups.push({
      id: 'gplan' + String(g + 1).padStart(5, '0'),
      name: 'Group ' + (g + 1),
      grade: '',
      headCount: null,
      colour: '#0072b2',
      days: { [day.id]: day.bells.map((unused, p) => ({ room: roomId('1' + letters[(g * 7 + p * 3) % letters.length]), roomText: '', label: '', teacherIds: [] })) },
    });
  }
  assert.deepEqual(validate(project), []);
  const graph = routingGraph(project);
  assert.equal(graph.count, 200 * 200 - 25 * 9);
  const result = routesForSchedule(project, graph);
  assert.equal(result.transitions, 70);
  for (const group of result.days[0].groups) {
    for (const found of group.routes) {
      assert.equal(found.ok, true);
      assert.equal(found.seconds, found.cells.length * 3);
      assert.ok(found.turns <= 3, 'across an open hall there is never a reason to turn more than three times: ' + found.turns);
    }
  }
  // a known journey: room A to room B, 40 cells to the east
  const across = route(graph, roomId('1A'), roomId('1B'));
  assert.equal(across.cells.length, 37, 'the 37 cells between them, in one straight line');
  assert.equal(across.turns, 0);
});

// ---- elevators and step-free plans (SV2-98)

// Joins stops with elevator connections by hand (the actions that draw them are another unit's):
// cars is [{ stops: [[floor, x, y], …], mode: 'chain' | 'star', staffOnly, letter }]. Each stop becomes a
// stairs cell listed in its floor's `lifts`; the connections carry the kind, the car letter and staffOnly.
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
    const pairs = car.mode === 'star' ? car.stops.slice(1).map((stop) => [car.stops[0], stop]) : car.stops.slice(1).map((stop, i) => [car.stops[i], stop]);
    for (const [a, b] of pairs) {
      n += 1;
      project.building.connections.push({ id: 'celev' + String(n).padStart(5, '0'), label: letter + n, a: at(...a), b: at(...b), direction: 'both', kind: 'elevator', staffOnly: car.staffOnly === true, car: letter });
    }
  });
  assert.deepEqual(validate(project), []);
  return project;
}

const HALL = ['.AA.BB.', '.AA.BB.', '#######', '.......', '.......'];

// Three floors of the same hall, the lift at the west end of each corridor.
function threeLifted(mode, staffOnly, settings) {
  const project = planProject([HALL, HALL, HALL], { exits: [[1, 6, 2, 'Main Door']] });
  Object.assign(project.settings, settings || {});
  return withCars(project, [{ stops: [[1, 0, 2], [2, 0, 2], [3, 0, 2]], mode, staffOnly }]);
}

test('a ride costs the wait plus the seconds a floor, and a route over one is the elevator car\'s id, once', () => {
  const project = threeLifted('chain', false);
  const found = between(project, '1A', '2A');
  assert.equal(found.ok, true);
  assert.deepEqual(path(project, found, true), ['1:1,2', '1:0,2', '2:0,2', '2:1,2']);
  assert.equal(found.seconds, 4 * 3 + 30 + 6, 'four cells, the 30 s wait and 6 s for the floor');
  assert.deepEqual([found.stairs, found.rides], [0, 1]);
  assert.deepEqual(found.connections, [project.building.connections[0].id]);
  assert.deepEqual(found.connectionAt, [1], 'taken from the lift cell, cells[1]');
  assert.equal(found.turns, 2, 'out of the door and onto the car (west), and off it (east), and into the room');
});

test('the wait is paid once on a three-stop chain and on a star, whatever the floors between', () => {
  for (const mode of ['chain', 'star']) {
    const project = threeLifted(mode, false);
    const up = between(project, '1A', '3B');
    assert.equal(up.rides, 1, mode + ': one ride from floor 1 to floor 3, not two');
    assert.equal(up.seconds, (2 + 1 + 4) * 3 + 30 + 6 * 2, mode + ': 7 cells, one wait, two floors');
    assert.equal(up.connections.length, 1, mode);
    const between23 = between(project, '2A', '3A');
    assert.equal(between23.seconds, 4 * 3 + 30 + 6, mode + ': a ride between two stops of the car is one link');
  }
  const chain = between(threeLifted('chain', false), '1A', '3B');
  const star = between(threeLifted('star', false), '1A', '3B');
  assert.deepEqual([star.seconds, star.rides, star.cells], [chain.seconds, chain.rides, chain.cells], 'a chain and a star give the same route');
});

test('a ride\'s cost moves with the elevator settings, a wait of 0 stays 0, and the key moves with them', () => {
  const base = between(threeLifted('chain', false), '1A', '2A').seconds;
  assert.equal(base, 48);
  assert.equal(between(threeLifted('chain', false, { elevatorWaitSeconds: 0 }), '1A', '2A').seconds, 12 + 0 + 6, 'a wait of 0 is 0, not the default');
  assert.equal(between(threeLifted('chain', false, { elevatorWaitSeconds: 10, elevatorSecondsPerFloor: 2 }), '1A', '2A').seconds, 12 + 10 + 2);
  assert.equal(between(threeLifted('chain', false, { elevatorWaitSeconds: 300, elevatorSecondsPerFloor: 60 }), '1A', '3B').seconds, 7 * 3 + 300 + 120);
  const keys = [{}, { elevatorWaitSeconds: 0 }, { elevatorSecondsPerFloor: 2 }].map((settings) => {
    const project = threeLifted('chain', false, settings);
    const cache = createRouteCache();
    route(routingGraph(project), roomId('1A'), roomId('2A'), { cache, geometryVersion: 1 });
    return Array.from(cache.fields.keys())[0];
  });
  assert.deepEqual(keys, [roomId('1A') + '|3|8|0|||e30,6', roomId('1A') + '|3|8|0|||e0,6', roomId('1A') + '|3|8|0|||e30,2'], 'one more part, only where there is a car');
  assert.equal(new Set(keys).size, 3);
});

test('the key is byte for byte today\'s with no lift and no marks: the sample school\'s whole route set', () => {
  const project = sampleSchool({ level: true });
  const graph = routingGraph(project);
  assert.equal(graph.links.some((link) => link.elevator), false, 'the level sample has no elevator');
  const cache = createRouteCache();
  const result = routesForSchedule(project, graph, { cache, geometryVersion: 1 });
  assert.ok(result.searches > 5);
  const keys = Array.from(cache.fields.keys());
  assert.ok(keys.length > 5);
  for (const key of keys) assert.match(key, /^[a-z0-9]+\|3\|8\|0\|\|$/, 'room|secondsPerCell|secondsPerStair|0|shut links|shut nodes, nothing after: ' + key);
  for (const key of cache.routes.keys()) assert.match(key, /^[a-z0-9]+>[a-z0-9]+\|3\|8\|0\|\|$/, key);
  // and the same with marks that mean nothing to a plain plan: a step on a corridor, a step door, a step exit
  const floor = project.building.floors[0];
  floor.notStepFree = [floor.cells.indexOf('#')];
  const marked = routingGraph(project);
  const beside = createRouteCache();
  routesForSchedule(project, marked, { cache: beside, geometryVersion: 1 });
  assert.deepEqual(Array.from(beside.fields.keys()), keys, 'step marks are in no plain key');
});

test('a lift cell is never walked through: a corridor cut by one is cut for a walker, and a ride cannot be used to step round it (SV2-98b: the 2-ride bypass is gone)', () => {
  const floor = ['A...B', '#####'];
  const project = withCars(planProject([floor, floor]), [{ stops: [[1, 2, 1], [2, 2, 1]] }]);
  const graph = routingGraph(project);
  // west to east is a straight corridor on floor 1 with the lift cell in the middle. SV2-98 let a walker ride up,
  // step off, step back onto the same car's cell and ride down (two rides, 9 cells); that crossed a wall, so it fails now
  const found = route(graph, roomId('1A'), roomId('1B'));
  assert.equal(found.ok, false, 'up, off, back on, down is not a way across');
  assert.equal(found.reason, 'unreachable');
  // and no walker crosses: stairs-free, car-free, the same corridor is cut
  const cut = routingGraph(withCars(planProject([floor]), [{ stops: [[1, 2, 1]] }]));
  assert.equal(route(cut, roomId('1A'), roomId('1B')).reason, 'unreachable', 'an unconnected stop is a wall');
});

test('a walker who has ridden a car may not board it again by walking, however far they walk first; another car\'s cell beside it stays allowed (SV2-98b)', () => {
  const floor = ['A...B', '#####'];
  // a corridor three cells wide of room to loop in: ride up, walk away two cells and back, ride down is the same crossing
  const wide = ['A.....B', '#######'];
  const project = withCars(planProject([wide, wide]), [{ stops: [[1, 3, 1], [2, 3, 1]] }]);
  assert.equal(route(routingGraph(project), roomId('1A'), roomId('1B')).reason, 'unreachable', 'a longer walk before stepping back changes nothing');
  assert.equal(route(routingGraph(project), roomId('1A'), roomId('2A')).rides, 1, 'a plain ride is still one ride');
  // a ride-arrived walker steps onto the cell beside it when that is another car (the pinned adjacent-lift case below)
  const upper = ['A.....B', '###SS##'];
  const two = withCars(planProject([upper, upper]), [{ stops: [[1, 3, 1], [2, 3, 1]], letter: 'D' }, { stops: [[1, 4, 1], [2, 4, 1]], letter: 'E' }]);
  assert.equal(route(routingGraph(two), roomId('1A'), roomId('1B')).rides, 2);
  assert.ok(floor);
});

test('adjacent lift cells: a ride lands on one, steps onto its neighbour and rides again, two cars crossing a corridor', () => {
  const upper = ['A.....B', '###SS##'];
  const project = withCars(planProject([upper, upper]), [{ stops: [[1, 3, 1], [2, 3, 1]], letter: 'D' }, { stops: [[1, 4, 1], [2, 4, 1]], letter: 'E' }]);
  const graph = routingGraph(project);
  const found = route(graph, roomId('1A'), roomId('1B'));
  assert.equal(found.ok, true);
  assert.deepEqual(found.rides, 2);
  assert.deepEqual(path(project, found, true), ['1:0,1', '1:1,1', '1:2,1', '1:3,1', '2:3,1', '2:4,1', '1:4,1', '1:5,1', '1:6,1']);
  assert.deepEqual(found.connections, [project.building.connections[0].id, project.building.connections[1].id]);
  assert.deepEqual(found.connectionAt, [3, 5]);
  assert.equal(found.seconds, 9 * 3 + 2 * 36);
  // two lift cells side by side are two walls to a walker: with no car joined, nobody crosses
  const walled = routingGraph(withCars(planProject([upper]), [{ stops: [[1, 3, 1]] }, { stops: [[1, 4, 1]] }]));
  assert.equal(route(walled, roomId('1A'), roomId('1B')).reason, 'unreachable');
});

test('staff-only: a plain route and a staff walk use the car; studentsOnly shuts it; a step-free plan opens it, staffOnly or not', () => {
  const shut = threeLifted('chain', true);
  const open = threeLifted('chain', false);
  assert.equal(between(shut, '1A', '2A').ok, true, 'a plain plan opens every elevator, staff-only included (a teacher\'s walk)');
  assert.equal(between(shut, '1A', '2A', { studentsOnly: true }).reason, 'unreachable', 'a group\'s ordinary route: the staff-only car is shut');
  assert.equal(between(open, '1A', '2A', { studentsOnly: true }).ok, true, 'a car that is not staff-only stays open');
  const stepFree = between(shut, '1A', '2A', { studentsOnly: true, avoidStairs: true });
  assert.equal(stepFree.ok, true, 'step-free ignores studentsOnly: anyone who needs it is authorised');
  assert.equal(stepFree.seconds, 48);
  // the key: studentsOnly only where it means something
  const keyOf = (project, options) => {
    const cache = createRouteCache();
    route(routingGraph(project), roomId('1A'), roomId('2A'), { cache, geometryVersion: 1, ...options });
    return Array.from(cache.fields.keys())[0];
  };
  assert.equal(keyOf(shut, {}), roomId('1A') + '|3|8|0|||e30,6');
  assert.equal(keyOf(shut, { studentsOnly: true }), roomId('1A') + '|3|8|0|||e30,6|s');
  assert.equal(keyOf(open, { studentsOnly: true }), keyOf(open, {}), 'no staff-only car: the option is no key part');
  assert.equal(keyOf(shut, { studentsOnly: true, avoidStairs: true }), keyOf(shut, { avoidStairs: true }), 'step-free ignores it');
});

test('a step-free plan shuts the stairs and opens every elevator; the plain plan with both takes the quicker', () => {
  const floor = ['.AA.BB.', '.AA.BB.', 'S#####S', '.......', '.......'];
  const project = withCars(planProject([floor, floor], { connections: [[1, 6, 2, 2, 6, 2]] }), [{ stops: [[1, 0, 2], [2, 0, 2]] }]);
  const graph = routingGraph(project);
  const plain = route(graph, roomId('1B'), roomId('2B'));
  assert.deepEqual([plain.stairs, plain.rides], [1, 0], 'the stairs at the east end: a stair costs 8 s, a ride 36 s');
  const stepFree = route(graph, roomId('1B'), roomId('2B'), { avoidStairs: true });
  assert.deepEqual([stepFree.stairs, stepFree.rides], [0, 1]);
  assert.ok(stepFree.seconds > plain.seconds);
  assert.equal(stepFree.stairs, stepFree.connections.filter((id) => id === 'cplan00001').length);
});

test('a step cell: a step-free route will not cross it and says so; any other route does', () => {
  const project = planProject([['A...B', '#####', '.....']]);
  const floor = project.building.floors[0];
  floor.notStepFree = [cellAt(project, 1, 2, 1)];
  const graph = routingGraph(project);
  assert.equal(route(graph, roomId('1A'), roomId('1B')).ok, true, 'a plain route walks over a kerb');
  const blocked = route(graph, roomId('1A'), roomId('1B'), { avoidStairs: true });
  assert.deepEqual([blocked.ok, blocked.reason, blocked.avoiding], [false, 'unreachable', ['stairs', 'steps']]);
  // no marks: the failure of a step-free route says only stairs
  const bare = routingGraph(planProject([['A...B', '#####', '.....']]));
  assert.deepEqual(route(bare, roomId('1A'), roomId('1B'), { avoidStairs: true }).ok, true);
  // a step cell not on the way changes nothing, but a stair-free route round it takes the long way
  const round = planProject([['A...B', '#####', '#####']]);
  round.building.floors[0].notStepFree = [cellAt(round, 1, 2, 1)];
  const long = route(routingGraph(round), roomId('1A'), roomId('1B'), { avoidStairs: true });
  assert.deepEqual(path(round, long), ['0,1', '0,2', '1,2', '2,2', '3,2', '4,2', '4,1'], 'down and round the step');
});

test('a step door: a step-free route does not leave or enter by it, a room with no other door fails no-entry after the plan', () => {
  const project = planProject([['.AAAA.', '.AAAA.', '######', '.BBBB.', '.BBBB.']], { doors: { '1A': [[1, 1, 's'], [4, 1, 's']], '1B': [[2, 3, 'n']] } });
  const floor = project.building.floors[0];
  const roomA = floor.spaces.find((space) => space.number === '1A');
  roomA.doors[0].stepFree = false; // the west door has a step
  const graph = routingGraph(project);
  const plain = route(graph, roomId('1A'), roomId('1B'));
  assert.equal(plain.from.cell, cellAt(project, 1, 1, 1), 'the west door is the shorter');
  const stepFree = route(graph, roomId('1A'), roomId('1B'), { avoidStairs: true });
  assert.equal(stepFree.from.cell, cellAt(project, 1, 4, 1), 'the step-free route leaves by the east door');
  assert.equal(route(graph, roomId('1B'), roomId('1A'), { avoidStairs: true }).to.cell, cellAt(project, 1, 4, 1), 'and enters by it');
  roomA.doors[1].stepFree = false; // now both doors have a step
  const shutIn = routingGraph(project);
  const failed = route(shutIn, roomId('1A'), roomId('1B'), { avoidStairs: true });
  assert.deepEqual([failed.ok, failed.reason, failed.end, failed.roomId, failed.avoiding], [false, 'no-entry', 'from', roomId('1A'), ['stairs', 'step-doors']]);
  const into = route(shutIn, roomId('1B'), roomId('1A'), { avoidStairs: true });
  assert.deepEqual([into.reason, into.end], ['no-entry', 'to']);
  assert.equal(route(shutIn, roomId('1A'), roomId('1B')).ok, true, 'a plain route uses the doors with steps');
  assert.equal(routeToExit(shutIn, roomId('1A'), { avoidStairs: true }).reason, 'no-entry');
});

test('ways and undirected never touch an elevator link, and an avoided connection shuts the whole car', () => {
  const project = threeLifted('chain', false);
  const graph = routingGraph(project);
  const [first, second] = project.building.connections.map((connection) => connection.id);
  const rode = between(project, '1A', '3B');
  const ways = { [first]: 'ab', [second]: 'ba' };
  assert.deepEqual(route(graph, roomId('3B'), roomId('1A'), { ways }).connections, route(graph, roomId('3B'), roomId('1A')).connections, 'a way on an elevator connection means nothing');
  const cache = createRouteCache();
  route(graph, roomId('1A'), roomId('2A'), { cache, geometryVersion: 1, ways });
  route(graph, roomId('1A'), roomId('2A'), { cache, geometryVersion: 1, undirected: true });
  assert.deepEqual(Array.from(cache.fields.keys()), [roomId('1A') + '|3|8|0|||e30,6'], 'the same plan: neither option is in the key');
  assert.equal(route(graph, roomId('1A'), roomId('3B'), { avoidConnections: [rode.connections[0]] }).reason, 'unreachable', 'the car\'s id shuts every link of the car');
});

test('rides are counted in results, routeToExit and routesForSchedule, and stairs count stairs only', () => {
  const project = threeLifted('chain', false);
  const graph = routingGraph(project);
  const out = routeToExit(graph, roomId('3A'));
  assert.deepEqual([out.ok, out.rides, out.stairs, out.connections.length], [true, 1, 0, 1]);
  assert.equal(route(graph, roomId('1A'), roomId('1B')).rides, 0);
  assert.equal(route(routingGraph(threeFloors()), roomId('1A'), roomId('3B')).rides, 0, 'a stairs-only building: rides 0, stairs 2');
});

test('routeToCells goes to the nearest of a list of cells, ties by id, and never ends in a car', () => {
  const project = threeLifted('chain', false);
  const graph = routingGraph(project);
  const target = (number, x, y, id) => ({ floorId: floorId(number), cell: cellAt(project, number, x, y), id });
  const found = routeToCells(graph, roomId('1A'), [target(3, 6, 2, 'far'), target(2, 3, 2, 'near')]);
  assert.deepEqual([found.ok, found.targetId, found.target], [true, 'near', { id: 'near', floorId: floorId(2), cell: cellAt(project, 2, 3, 2) }]);
  assert.deepEqual([found.rides, found.stairs], [1, 0]);
  assert.deepEqual(path(project, found, true).slice(-1), ['2:3,2']);
  const tied = routeToCells(graph, roomId('1A'), [target(1, 4, 2, 'b'), target(1, 4, 2, 'a')]);
  assert.equal(tied.targetId, 'a');
  assert.equal(routeToCells(graph, roomId('1A'), [target(1, 0, 2, 'lift'), { floorId: 'fnowhere', cell: 0, id: 'x' }]).reason, 'unreachable', 'a lift cell and a cell off the map are no target');
  assert.equal(routeToCells(graph, roomId('1A'), []).reason, 'unreachable');
  assert.deepEqual([routeToCells(graph, null, []).reason, routeToCells(graph, 'rnowhere', []).reason], ['no-room', 'room-missing']);
  assert.equal(routeToCells(graph, roomId('1A'), [target(2, 3, 2, 'near')], { avoidStairs: true, avoidConnections: [project.building.connections[0].id] }).reason, 'unreachable');
});

test('routesForSchedule gives each group its own plan: a step-free group rides the staff-only car, the others are shut out of it', () => {
  const project = threeLifted('chain', true);
  const day = project.dayTypes[0];
  const periods = day.bells.length;
  const rooms = ['1A', '2A', '1B', '3B', '1A', '2A', '1B', '3B'];
  for (const [id, stepFree] of [['gplan00001', false], ['gplan00002', true]]) {
    const group = { id, name: id, grade: '', headCount: null, colour: '#d1495b', days: { [day.id]: day.bells.map((unused, p) => ({ room: roomId(rooms[p % rooms.length]), roomText: '', label: '', teacherIds: [] })) } };
    if (stepFree) group.stepFree = true;
    project.groups.push(group);
  }
  assert.equal(periods, 8);
  assert.deepEqual(validate(project), []);
  const cache = createRouteCache();
  const result = routesForSchedule(project, undefined, { cache, geometryVersion: 1 });
  const [plain, free] = result.days[0].groups;
  assert.ok(plain.routes.every((found) => found.ok === false && found.reason === 'unreachable'), 'every transition changes floor: a group with no step-free flag cannot use a staff-only car');
  assert.ok(free.routes.every((found) => found.ok === true && found.rides === 1), 'the step-free group rides');
  assert.deepEqual(plain.routes[0].avoiding, ['staff-only'], 'SV2-98b: the failure says the staff-only car was shut');
  const keys = Array.from(cache.fields.keys());
  assert.ok(keys.some((key) => key.endsWith('|e30,6|s')) && keys.some((key) => key.endsWith('|1|||e30,6')), keys.join(' '));
  // a car anyone may use: the two groups' routes are the same
  const openProject = threeLifted('chain', false);
  openProject.groups = project.groups;
  const same = routesForSchedule(openProject);
  assert.deepEqual(same.days[0].groups[0].routes.map((found) => found.seconds), same.days[0].groups[1].routes.map((found) => found.seconds));
});

test('wanted is by plan and start room: both plans of a start room are searched in turn, one field each, however small the cache', () => {
  const project = threeLifted('chain', false);
  const day = project.dayTypes[0];
  const rooms = ['1A', '2A', '1B', '3B', '1A', '2A', '1B', '3B'];
  for (const [id, stepFree] of [['gplan00001', false], ['gplan00002', true]]) {
    const group = { id, name: id, grade: '', headCount: null, colour: '#d1495b', days: { [day.id]: day.bells.map((unused, p) => ({ room: roomId(rooms[p]), roomText: '', label: '', teacherIds: [] })) } };
    if (stepFree) group.stepFree = true;
    project.groups.push(group);
  }
  const cache = createRouteCache(2);
  const result = routesForSchedule(project, undefined, { cache, geometryVersion: 1 });
  assert.equal(result.searches, 8, 'four start rooms (1A, 2A, 1B, 3B), a field for each plan');
  assert.equal(routesForSchedule(project, undefined, { cache: createRouteCache(2), geometryVersion: 1 }).searches, 8);
  assert.equal(result.pairs, 8, 'each plan\'s journeys are counted');
});

// ---- SV2-98b: five fixes and the plain-plan pin

test('step-free routeToExit never ends at a step exit; with every exit a step exit it fails; plain plans are unchanged (SV2-98b)', () => {
  const project = planProject([['A.....B', '#######']], { exits: [[1, 0, 1, 'West Door'], [1, 6, 1, 'East Door']] });
  const [west, east] = project.building.floors[0].exits;
  west.stepFree = false;
  const graph = routingGraph(project);
  assert.equal(routeToExit(graph, roomId('1A')).exitId, west.id, 'a plain plan takes the nearer West step exit');
  const free = routeToExit(graph, roomId('1A'), { avoidStairs: true });
  assert.equal(free.ok, true);
  assert.equal(free.exitId, east.id, 'step-free goes the long way to the East exit');
  assert.equal(free.exit.id, east.id);
  east.stepFree = false;
  const none = routeToExit(routingGraph(project), roomId('1A'), { avoidStairs: true });
  assert.equal(none.ok, false);
  assert.equal(none.reason, 'unreachable');
  assert.ok(none.avoiding.includes('step-exits'), none.avoiding.join());
  assert.equal(routeToExit(routingGraph(project), roomId('1A')).ok, true, 'a plain plan still leaves');
  assert.deepEqual(routeToExit(routingGraph(project), roomId('1A'), { avoidStairs: true, avoidExits: [west.id] }).avoiding.includes('step-exits'), true);
  // a failure that is not about exits does not say so
  const open = planProject([['A.....B', '#######']], { exits: [[1, 0, 1, 'West Door']] });
  assert.equal(routeToExit(routingGraph(open), roomId('1A'), { avoidStairs: true, avoidExits: [open.building.floors[0].exits[0].id] }).avoiding.includes('step-exits'), false);
});

test('routingGraph tests step-cell membership in linear time: 39,600 marked cells on 200 by 200 build in under 200 ms (SV2-98b)', () => {
  const rows = Array.from({ length: 200 }, () => new Array(200).fill('#'));
  for (let i = 0; i < 25; i += 1) {
    const x = 18 + (i % 5) * 40;
    const y = 18 + Math.floor(i / 5) * 40;
    for (let dy = 0; dy < 3; dy += 1) for (let dx = 0; dx < 3; dx += 1) rows[y + dy][x + dx] = 'ABCDEFGHIJKLMNOPQRTUVWXYZ'[i];
  }
  const project = planProject([rows.map((row) => row.join(''))]);
  const floor = project.building.floors[0];
  const marked = [];
  for (let cell = 0; cell < floor.cells.length && marked.length < 39600; cell += 1) if (floor.cells[cell] === '#') marked.push(cell);
  assert.equal(marked.length, 39600);
  floor.notStepFree = marked;
  const base = buildGraph(project);
  const started = performance.now();
  const graph = routingGraph(project, base);
  const took = performance.now() - started;
  assert.equal(graph.stepNodes.length, 39600);
  assert.ok(graph.stepNodes.every((node, i) => i === 0 || graph.stepNodes[i - 1] < node), 'sorted, no repeats');
  assert.ok(took < 200, 'routingGraph took ' + Math.round(took) + ' ms');
  // a repeated mark counts once
  floor.notStepFree = [marked[0], marked[0], marked[1]];
  assert.equal(routingGraph(project, buildGraph(project)).stepNodes.length, 2);
});

test('naming any connection of an elevator shuts the whole car, and the key lists the car once (SV2-98b)', () => {
  const project = threeLifted('chain', false);
  const graph = routingGraph(project);
  const [first, second, third] = project.building.connections.map((connection) => connection.id);
  assert.equal(third, undefined, 'a chain of three stops is two connections');
  assert.equal(route(graph, roomId('1A'), roomId('2A')).ok, true);
  for (const named of [first, second]) {
    assert.equal(route(graph, roomId('1A'), roomId('2A'), { avoidConnections: [named] }).reason, 'unreachable', 'naming ' + named);
    assert.equal(route(graph, roomId('2A'), roomId('3A'), { avoidConnections: [named] }).reason, 'unreachable', 'naming ' + named);
  }
  const keyOf = (avoidConnections) => {
    const cache = createRouteCache();
    route(graph, roomId('1A'), roomId('2A'), { cache, geometryVersion: 1, avoidConnections });
    return Array.from(cache.fields.keys())[0];
  };
  assert.equal(keyOf([first]), roomId('1A') + '|3|8|0|' + first + '||e30,6', 'the car id once, though the car has three links');
  assert.equal(keyOf([second]), keyOf([first]), 'either connection is the same plan');
  assert.equal(keyOf([first, second]), keyOf([first]));
  // a stairs connection beside it is untouched
  const mixed = withCars(threeFloors(), [{ stops: [[1, 1, 3], [2, 1, 3]] }]);
  const mixedGraph = routingGraph(mixed);
  assert.equal(route(mixedGraph, roomId('1A'), roomId('2A'), { avoidConnections: ['cplan00001'] }).ok, true, 'the car still runs when only a stairs connection is named');
});

test('a failed plain route under studentsOnly says staff-only when the graph has a staff-only car, and nothing when it has none (SV2-98b)', () => {
  const shut = routingGraph(threeLifted('chain', true));
  const failed = route(shut, roomId('1A'), roomId('2A'), { studentsOnly: true });
  assert.equal(failed.reason, 'unreachable');
  assert.deepEqual(failed.avoiding, ['staff-only']);
  assert.equal(route(shut, roomId('1A'), roomId('2A')).ok, true, 'without the option nothing is shut');
  assert.deepEqual(route(shut, roomId('1A'), roomId('2A'), { studentsOnly: true, avoidConnections: [shut.cars[0].id] }).avoiding, ['staff-only', 'connections']);
  const open = routingGraph(threeLifted('chain', false));
  assert.deepEqual(route(open, roomId('1A'), roomId('2A'), { studentsOnly: true, avoidConnections: [open.cars[0].id] }).avoiding, ['connections'], 'no staff-only car: nothing added');
  // under a step-free plan the option is ignored and so is the word
  assert.equal(route(shut, roomId('1A'), roomId('2A'), { studentsOnly: true, avoidStairs: true }).ok, true);
});

// The routes of the engine at commit 6f84f965, before elevators: the sample school and the big fixture have none,
// so every route they give must be the same now, apart from the new `rides: 0`. The old engine's code is not kept;
// route-digests-6f84f965.json holds a sha-256 of its routes for each plan (see test/fixtures/route-digests.mjs).
const OLD_DIGESTS = JSON.parse(readFileSync(nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'route-digests-6f84f965.json'), 'utf8'));
// the level sample (SV2-106): the full sample has Elevator D now, and these digests are of a school with none
for (const [name, make] of [['the sample school', () => sampleSchool({ level: true })], ['the big fixture', bigProject]]) {
  test('plain, step-free, undirected and routeToExit routes on ' + name + ' are the old engine\'s apart from rides: 0 (SV2-98b)', () => {
    const project = make();
    assert.equal(routingGraph(project).links.some((link) => link.elevator), false, 'no elevator');
    const now = digestRoutes(routingEngine, project);
    assert.deepEqual(now, OLD_DIGESTS[name === 'the sample school' ? 'sample' : 'big']);
    const graph = routingGraph(project);
    const first = Array.from(graph.rooms.keys()).sort()[0];
    const second = Array.from(graph.rooms.keys()).sort()[1];
    const found = route(graph, first, second);
    if (found.ok && !found.same) assert.equal(found.rides, 0);
  });
}

// ---- the published file carries these modules

for (const file of ['routing.js', 'directions.js', 'findings.js']) {
  test(file + ' keeps to the linker rule a published file needs: one-line named imports, export only before a declaration', () => {
    const source = readFileSync(nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)), '..', '..', 'engine', file), 'utf8');
    let imports = 0;
    for (const line of source.split('\n')) {
      if (/^\s*import\b/.test(line)) {
        assert.match(line, /^import \{ [A-Za-z0-9_$, ]+ \} from '\.\/[a-z0-9-]+\.js';$/, file + ': ' + line);
        imports += 1;
      }
      if (/^\s*export\b/.test(line)) assert.match(line, /^export (async function|function|const|let|class) /, file + ': ' + line);
    }
    assert.ok(imports > 0);
    assert.doesNotMatch(source, /\bimport\s*\(/);
    assert.doesNotMatch(source, /import\.meta/);
    assert.doesNotMatch(source, /<\/script/i);
  });
}
