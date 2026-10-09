// Routing: the quickest route, the tie-breaks, the options, the named
// failures, the schedule's routes and the cache of distance fields.
//
// Each plan is drawn in the test that uses it, so a route can be read
// against its building. Cells are written "x,y", with the floor number in
// front ("2:0,2") where a route changes floor.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../../engine/graph.js';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../../engine/validate.js';
import { route, routeToExit, routesForSchedule, routingGraph, createRouteCache, FIELD_LIMIT, ROUTE_FAILURES } from '../../engine/routing.js';
import { school, clone } from './helpers.mjs';
import { planProject, twoRooms, disconnectedWing, threeFloors, splitLevel, cellAt, floorId, roomId } from '../fixtures/buildings/plans.mjs';
import { bigProject, BIG } from '../fixtures/big.mjs';

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
