// Evacuation: every room's way out through routeToExit, the exits' share of
// rooms and people, the rooms with no way out, and the door card's data.
//
// Each plan is drawn in the test that uses it (through planProject from the
// building fixtures), so a route can be read against its building. Cells are
// written "x,y", with the floor's level in front ("2:0,2") where a route
// changes floor.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../../engine/graph.js';
import { route, routeToExit, routingGraph, routesForSchedule, createRouteCache } from '../../engine/routing.js';
import { directions, describeFailure } from '../../engine/directions.js';
import { evacuationRoutes, stepFreeWaysOut, reachableExits, byExit, noRoute, doorCard, cardSteps, elevatorConnections, ELEVATOR_KIND, CROP_MARGIN } from '../../engine/evacuation.js';
import { school, clone } from './helpers.mjs';
import { withElevator } from '../fixtures/step-free.mjs';
import { validate } from '../../engine/validate.js';
import { repair } from '../../engine/repair.js';
import * as schema from '../../engine/schema.js';
import { planProject, threeFloors, disconnectedWing, floorId, roomId } from '../fixtures/buildings/plans.mjs';

const F1 = floorId(1);
const F2 = floorId(2);
const F3 = floorId(3);

// A route's cells as "x,y", or "level:x,y" when `floors` is true.
function path(project, found, floors) {
  return found.cells.map((place) => {
    const floor = project.building.floors.find((candidate) => candidate.id === place.floorId);
    const at = (place.cell % floor.width) + ',' + Math.floor(place.cell / floor.width);
    return floors ? floor.level + ':' + at : at;
  });
}

function xy(project, floorIdOf, cell) {
  const floor = project.building.floors.find((candidate) => candidate.id === floorIdOf);
  return (cell % floor.width) + ',' + Math.floor(cell / floor.width);
}

function entryOf(evacuation, id) {
  return evacuation.rooms.find((entry) => entry.roomId === id);
}

// Two floors with stairs at both ends of one corridor: A at the west end,
// B at the east end, each joining floor 1 to floor 2. Room 2A's door is two
// cells from stairs A and seven from stairs B; the exit is on floor 1 beside
// stairs A. So A is the quick way out, and B the long way round.
function twoStairs() {
  const floor = ['..AA......', '..AA......', 'S########S', '..........', '..........'];
  return planProject([floor, floor], {
    doors: { '1A': [[2, 1, 's']], '2A': [[2, 1, 's']] },
    connections: [[1, 0, 2, 2, 0, 2], [1, 9, 2, 2, 9, 2]],
    exits: [[1, 1, 2, 'West Door']],
  });
}

// One corridor with an exit at each end and one room whose door is in the
// middle: four cells and one turn to either exit.
function middleRoom(exits) {
  return planProject([['....A....', '....A....', '#########', '.........', '.........']], { doors: { '1A': [[4, 1, 's']] }, exits });
}

test('the sample school: every room has a way out, rooms in building order, and nothing is avoided', () => {
  const project = school();
  const evacuation = evacuationRoutes(project);
  const rooms = project.building.floors.flatMap((floor) => floor.spaces.filter((space) => space.kind === 'room').map((room) => [room.id, floor.id]));
  assert.deepEqual(evacuation.rooms.map((entry) => [entry.roomId, entry.floorId]), rooms);
  assert.deepEqual(evacuation.avoided, []);
  assert.ok(evacuation.rooms.every((entry) => entry.route.ok === true && typeof entry.route.exitId === 'string'));
  assert.deepEqual(noRoute(project, evacuation), []);
});

test('each route is routeToExit\'s own answer: no second router, and the elevator guard is a no-op with no elevator', () => {
  const project = school();
  const graph = routingGraph(project);
  const evacuation = evacuationRoutes(project, graph);
  for (const entry of evacuation.rooms) assert.deepEqual(entry.route, routeToExit(graph, entry.roomId), entry.roomId);
  // a bare buildGraph graph is made into a routing graph, with the same answers
  assert.deepEqual(evacuationRoutes(project, buildGraph(project)).rooms, evacuation.rooms);
});

test('with no elevator the search is the plain one: a cache the schedule\'s routes filled is used, not searched again', () => {
  const project = school();
  const graph = routingGraph(project);
  const cache = createRouteCache();
  routesForSchedule(project, graph, { cache, geometryVersion: 4 });
  const starts = new Set(project.building.floors.flatMap((floor) => floor.spaces.filter((space) => space.kind === 'room').map((room) => room.id)));
  const before = cache.searches;
  evacuationRoutes(project, graph, { cache, geometryVersion: 4 });
  // every room the schedule starts a walk from already has its field
  const searched = cache.searches - before;
  const fresh = createRouteCache();
  evacuationRoutes(project, graph, { cache: fresh, geometryVersion: 4 });
  assert.equal(fresh.searches, starts.size, 'one search per room from nothing');
  assert.ok(searched < starts.size, 'searched ' + searched + ' of ' + starts.size + ' rooms again');
});

test('byExit: every exit with the rooms it serves and their people by capacity, and the rooms with no capacity counted apart', () => {
  const project = school();
  const gym = project.building.floors.flatMap((floor) => floor.spaces).find((space) => space.id === 'rsamplegym');
  const evacuation = evacuationRoutes(project);
  const rows = byExit(project, evacuation);
  assert.deepEqual(rows.map((row) => [row.exitId, row.doorName, row.assembly, row.rooms]), [
    ['xsample00a', 'Door A', 'Front lawn by the flagpole', 12],
    ['xsample00b', 'Door B', 'East field by the backstop', 1],
  ]);
  assert.deepEqual(rows[1].roomIds, ['rsamplegym']);
  assert.equal(rows[1].people, gym.capacity);
  const capacities = (ids) => ids.map((id) => project.building.floors.flatMap((floor) => floor.spaces).find((space) => space.id === id).capacity);
  assert.equal(rows[0].people, capacities(rows[0].roomIds).reduce((sum, value) => sum + value, 0));
  assert.deepEqual(rows.map((row) => row.uncounted), [0, 0]);
  // every room with a way out is under exactly one exit, in evacuation.rooms order
  assert.deepEqual(rows.flatMap((row) => row.roomIds).sort(), evacuation.rooms.map((entry) => entry.roomId).sort());
  assert.deepEqual(rows[0].roomIds, evacuation.rooms.filter((entry) => entry.route.exitId === 'xsample00a').map((entry) => entry.roomId));

  // a room with no capacity adds nothing to people and is counted as uncounted
  const changed = clone(project);
  changed.building.floors.flatMap((floor) => floor.spaces).find((space) => space.id === 'rsamplegym').capacity = null;
  const after = byExit(changed, evacuationRoutes(changed));
  assert.deepEqual([after[1].rooms, after[1].people, after[1].uncounted], [1, 0, 1]);
});

test('byExit lists an exit no room uses, and an exit is closed by avoidExits ("what if this exit is blocked?")', () => {
  const project = school();
  const blocked = evacuationRoutes(project, null, { avoidExits: ['xsample00b'] });
  const rows = byExit(project, blocked);
  assert.deepEqual(rows.map((row) => [row.exitId, row.rooms, row.people]), [['xsample00a', 13, rows[0].people], ['xsample00b', 0, 0]]);
  assert.deepEqual(rows[1].roomIds, []);
  assert.equal(entryOf(blocked, 'rsamplegym').route.exitId, 'xsample00a');
});

test('a three-floor stairwell: the room on floor 3 goes down the chain, and the card has floors 3, 2 and 1 in walking order, each cropped', () => {
  const project = threeFloors();
  const evacuation = evacuationRoutes(project);
  const found = entryOf(evacuation, roomId('3A')).route;
  assert.deepEqual(path(project, found, true), ['3:1,2', '3:0,2', '2:0,2', '1:0,2', '1:1,2', '1:2,2', '1:3,2', '1:4,2', '1:5,2', '1:6,2']);
  assert.deepEqual(found.connections, ['cplan00002', 'cplan00001']);

  const card = doorCard(project, null, found);
  assert.equal(card.ok, true);
  assert.deepEqual([card.roomId, card.number, card.name], [roomId('3A'), '3A', 'Room 3A']);
  assert.deepEqual(card.floor, { id: F3, name: 'Floor 3', level: 3 });
  assert.deepEqual(card.floors.map((floor) => [floor.floorId, floor.name, floor.level]), [[F3, 'Floor 3', 3], [F2, 'Floor 2', 2], [F1, 'Floor 1', 1]]);
  const [top, middle, bottom] = card.floors;
  assert.deepEqual(top.cells.map((cell) => xy(project, F3, cell)), ['1,2', '0,2']);
  assert.deepEqual(middle.cells.map((cell) => xy(project, F2, cell)), ['0,2']);
  assert.deepEqual(bottom.cells.map((cell) => xy(project, F1, cell)), ['0,2', '1,2', '2,2', '3,2', '4,2', '5,2', '6,2']);
  // the start is the room cell left by, on the room's floor; the exit on the exit's floor
  assert.equal(xy(project, F3, top.start), '1,1');
  assert.deepEqual([top.exit, middle.start, middle.exit, bottom.start], [null, null, null, null]);
  assert.equal(xy(project, F1, bottom.exit), '6,2');
  assert.deepEqual(top.stairs.map((stair) => [xy(project, F3, stair.cell), stair.label, stair.way]), [['0,2', 'B', 'leave']]);
  assert.deepEqual(middle.stairs.map((stair) => [xy(project, F2, stair.cell), stair.connectionId, stair.label, stair.way]), [['0,2', 'cplan00002', 'B', 'arrive'], ['0,2', 'cplan00001', 'A', 'leave']]);
  assert.deepEqual(bottom.stairs.map((stair) => [xy(project, F1, stair.cell), stair.label, stair.way]), [['0,2', 'A', 'arrive']]);
  // the room's own cells are on its floor's entry, to shade it, and nowhere else
  assert.deepEqual(top.roomCells.map((cell) => xy(project, F3, cell)), ['1,0', '2,0', '1,1', '2,1']);
  assert.deepEqual([middle.roomCells, bottom.roomCells], [null, null]);
  // the floors are 7 by 5; three cells round the route's cells (and on floor
  // 3 the room's, which reach x 2), clamped at every edge
  assert.equal(CROP_MARGIN, 3);
  assert.deepEqual(top.box, { x: 0, y: 0, width: 6, height: 5 });
  assert.deepEqual(middle.box, { x: 0, y: 0, width: 4, height: 5 });
  assert.deepEqual(bottom.box, { x: 0, y: 0, width: 7, height: 5 });

  assert.deepEqual(card.steps.map((step) => step.kind), ['leave', 'walk', 'stairs', 'walk', 'exit']);
  assert.equal(card.text, '1. Turn right out of the room.\n2. Walk to stairs B.\n3. Take stairs B, then stairs A down to Floor 1.\n4. Walk to the end of the corridor.\n5. Exit at Main Door.');
  assert.deepEqual(card.exit, { id: 'xplan00001', floorId: F1, floorName: 'Floor 1', doorName: 'Main Door', assembly: '' });
  assert.equal(card.seconds, found.seconds);
  assert.equal(card.sentence, null);
});

test('the crop box is the route\'s cells and the room\'s own cells plus three, and is not clamped where the floor goes on', () => {
  // a 20 by 13 floor: a room four cells wide whose door is at its west end,
  // and the route running west from it to an exit at the floor's edge
  const blank = '....................';
  const rows = [blank, blank, blank, blank, blank, blank, '.......AAAA.........', '.......AAAA.........', '########............', blank, blank, blank, blank];
  const project = planProject([rows], { doors: { '1A': [[7, 7, 's']] }, exits: [[1, 0, 8, 'West Door']] });
  const card = doorCard(project, null, evacuationRoutes(project).rooms[0].route);
  const [floor] = card.floors;
  assert.deepEqual(floor.cells.map((cell) => xy(project, F1, cell)), ['7,8', '6,8', '5,8', '4,8', '3,8', '2,8', '1,8', '0,8']);
  assert.deepEqual(floor.roomCells.map((cell) => xy(project, F1, cell)).sort(), ['10,6', '10,7', '7,6', '7,7', '8,6', '8,7', '9,6', '9,7']);
  // x 0..10 (the room reaches 10, the route only 7) → 0 (clamped) to 13;
  // y 6..8 (the room's top row is 6) → 3 to 11, short of the floor's last row
  assert.deepEqual(floor.box, { x: 0, y: 3, width: 14, height: 9 });
});

test('the sample school: every room\'s whole footprint is inside the crop of its own floor', () => {
  const project = school();
  const floors = new Map(project.building.floors.map((floor) => [floor.id, floor]));
  const inside = (floor, box, cell) => {
    const x = cell % floor.width;
    const y = (cell - x) / floor.width;
    return x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
  };
  const clipped = [];
  for (const entry of evacuationRoutes(project).rooms) {
    const card = doorCard(project, null, entry.route);
    const room = floors.get(entry.floorId).spaces.find((space) => space.id === entry.roomId);
    const home = card.floors.find((floor) => floor.floorId === entry.floorId);
    assert.deepEqual(home.roomCells, room.cells, entry.roomId);
    for (const floor of card.floors) assert.ok(floor.cells.every((cell) => inside(floors.get(floor.floorId), floor.box, cell)), entry.roomId + ' route cells');
    if (!room.cells.every((cell) => inside(floors.get(entry.floorId), home.box, cell))) clipped.push(card.number);
  }
  assert.deepEqual(clipped, [], 'rooms whose footprint the crop cuts');
});

test('a disconnected wing: its rooms have no way out and say so in the routing engine\'s sentence, and their cards say it too', () => {
  const project = disconnectedWing();
  // a room that touches nothing walkable, and a non-Latin number in the wing
  project.building.floors[0].spaces.find((space) => space.id === roomId('1C')).number = '三〇一';
  const evacuation = evacuationRoutes(project);
  assert.deepEqual(evacuation.rooms.map((entry) => [entry.roomId, entry.route.ok]), [[roomId('1A'), true], [roomId('1B'), true], [roomId('1C'), false], [roomId('1D'), false]]);
  const missing = noRoute(project, evacuation);
  assert.deepEqual(missing, [
    { roomId: roomId('1C'), floorId: F1, reason: 'unreachable', sentence: 'There is no way through from 三〇一 on Floor 1 to an exit.', onlyByElevator: false },
    { roomId: roomId('1D'), floorId: F1, reason: 'unreachable', sentence: 'There is no way through from Room 1D on Floor 1 to an exit.', onlyByElevator: false },
  ]);
  // the sentence is describeFailure's, word for word
  assert.equal(missing[1].sentence, describeFailure(project, entryOf(evacuation, roomId('1D')).route));
  assert.deepEqual(byExit(project, evacuation).map((row) => row.roomIds), [[roomId('1A'), roomId('1B')]]);

  const card = doorCard(project, null, entryOf(evacuation, roomId('1C')).route);
  assert.deepEqual(card, {
    ok: false, stale: false, roomId: roomId('1C'), number: '三〇一', name: '三〇一', floor: { id: F1, name: 'Floor 1', level: 1 },
    floors: [], steps: [], text: '', exit: null, seconds: null,
    sentence: 'There is no way through from 三〇一 on Floor 1 to an exit.',
  });
});

test('a room that opens onto no corridor is listed with the no-entry sentence', () => {
  const project = planProject([['.AA.....', '.AA.....', '########', '........', '......B.']], { exits: [[1, 0, 2, 'West Door']] });
  const evacuation = evacuationRoutes(project);
  assert.deepEqual(noRoute(project, evacuation), [{ roomId: roomId('1B'), floorId: F1, reason: 'no-entry', sentence: 'Room 1B on Floor 1 does not open onto a corridor.', onlyByElevator: false }]);
  assert.equal(doorCard(project, null, entryOf(evacuation, roomId('1B')).route).sentence, 'Room 1B on Floor 1 does not open onto a corridor.');
});

test('a building with no exit: every room is listed, and byExit is empty', () => {
  const project = planProject([['.AA.BB.', '.AA.BB.', '#######', '.......', '.......']]);
  const evacuation = evacuationRoutes(project);
  assert.deepEqual(noRoute(project, evacuation).map((row) => [row.roomId, row.reason]), [[roomId('1A'), 'unreachable'], [roomId('1B'), 'unreachable']]);
  assert.deepEqual(byExit(project, evacuation), []);
});

test('two exits tied: the one with the lower id is taken, whatever order the floor lists them in', () => {
  // listed east first, so the east exit is xplan00001
  const eastFirst = middleRoom([[1, 8, 2, 'East Door'], [1, 0, 2, 'West Door']]);
  const graph = routingGraph(eastFirst);
  const east = routeToExit(graph, roomId('1A'), { avoidExits: ['xplan00002'] });
  const west = routeToExit(graph, roomId('1A'), { avoidExits: ['xplan00001'] });
  assert.deepEqual([east.seconds, east.turns], [west.seconds, west.turns], 'the two ways really tie');
  assert.equal(evacuationRoutes(eastFirst).rooms[0].route.exitId, 'xplan00001');
  assert.equal(doorCard(eastFirst, null, evacuationRoutes(eastFirst).rooms[0].route).exit.doorName, 'East Door');

  // the same floor with its exits listed the other way round: the same exit
  const reversed = clone(eastFirst);
  reversed.building.floors[0].exits.reverse();
  assert.equal(evacuationRoutes(reversed).rooms[0].route.exitId, 'xplan00001');
  assert.deepEqual(byExit(reversed, evacuationRoutes(reversed)).map((row) => [row.doorName, row.rooms]), [['West Door', 0], ['East Door', 1]]);

  // the ids traded: the west exit now has the lower id, and is taken
  const traded = clone(eastFirst);
  const [a, b] = traded.building.floors[0].exits;
  [a.id, b.id] = [b.id, a.id];
  const route = evacuationRoutes(traded).rooms[0].route;
  assert.equal(route.exitId, 'xplan00001');
  assert.equal(doorCard(traded, null, route).exit.doorName, 'West Door');
});

test('one-way stairs: evacuation takes an up-only stair down, as it would any stair (ARCHITECTURE 18.4)', () => {
  const project = twoStairs();
  const both = entryOf(evacuationRoutes(project), roomId('2A')).route;
  assert.deepEqual(both.connections, ['cplan00001'], 'both ways open: the near stairs');

  const upOnly = clone(project);
  upOnly.building.connections[0].direction = 'ab'; // floor 1 to floor 2 only
  // passing time still keeps to the rule: the near stairs are not taken down
  const walking = route(routingGraph(upOnly), roomId('2A'), roomId('1A'));
  assert.deepEqual(walking.connections, ['cplan00002'], 'a walk between classes goes round to the far stairs');
  const out = entryOf(evacuationRoutes(upOnly), roomId('2A')).route;
  assert.deepEqual(out.connections, ['cplan00001'], 'a door card sends the room down the up-only stairs');
  assert.equal(out.seconds, both.seconds);
  assert.deepEqual(path(upOnly, out, true), path(project, both, true));
  const card = doorCard(upOnly, null, out);
  assert.ok(card.steps.some((step) => /stairs/i.test(step.text) && /down/i.test(step.text)), card.text);

  const downOnly = clone(project);
  downOnly.building.connections[0].direction = 'ba'; // floor 2 to floor 1 only
  assert.deepEqual(entryOf(evacuationRoutes(downOnly), roomId('2A')).route.connections, ['cplan00001']);

  // both stairs up only: the passing-time walk has no way down, evacuation does
  const noWayDown = clone(upOnly);
  noWayDown.building.connections[1].direction = 'ab';
  assert.equal(route(routingGraph(noWayDown), roomId('2A'), roomId('1A')).reason, 'unreachable');
  const evacuation = evacuationRoutes(noWayDown);
  assert.deepEqual(noRoute(noWayDown, evacuation), [], 'every room has a way out');
  assert.equal(entryOf(evacuation, roomId('2A')).route.ok, true);
  assert.equal(entryOf(evacuation, roomId('1A')).route.ok, true);
});

test('evacuation shares no distance field with the movement view where a stair is one-way, and all of them where none is', () => {
  const project = twoStairs();
  const graph = routingGraph(project);
  const cache = createRouteCache();
  const rooms = project.building.floors.flatMap((floor) => floor.spaces.filter((space) => space.kind === 'room')).length;
  const other = (id) => (id === roomId('1A') ? roomId('2A') : roomId('1A'));
  for (const room of project.building.floors.flatMap((floor) => floor.spaces.filter((space) => space.kind === 'room'))) route(graph, room.id, other(room.id), { cache, geometryVersion: 1 });
  const before = cache.searches;
  evacuationRoutes(project, graph, { cache, geometryVersion: 1 });
  assert.equal(cache.searches, before, 'no one-way stair: every field is the movement view\'s');

  const upOnly = clone(project);
  upOnly.building.connections[0].direction = 'ab';
  const oneWay = routingGraph(upOnly);
  const shared = createRouteCache();
  for (const floor of upOnly.building.floors) for (const space of floor.spaces) if (space.kind === 'room') route(oneWay, space.id, other(space.id), { cache: shared, geometryVersion: 1 });
  const had = shared.searches;
  evacuationRoutes(upOnly, oneWay, { cache: shared, geometryVersion: 1 });
  assert.equal(shared.searches - had, rooms, 'one extra search per room with an up-only stair: the undirected fields');
});

test('elevators are never used: a connection of the elevator kind built by hand is avoided, though the graph keeps it as a link', () => {
  const project = twoStairs();
  project.building.connections[0].kind = ELEVATOR_KIND;
  assert.equal(ELEVATOR_KIND, 'elevator');
  assert.deepEqual(elevatorConnections(project), ['cplan00001']);
  // the graph takes no notice of the kind: a plain search goes by the elevator
  const graph = routingGraph(project);
  assert.ok(graph.links.some((link) => link.id === 'cplan00001'));
  assert.deepEqual(routeToExit(graph, roomId('2A')).connections, ['cplan00001']);

  const evacuation = evacuationRoutes(project, graph);
  assert.deepEqual(evacuation.avoided, ['cplan00001']);
  const found = entryOf(evacuation, roomId('2A')).route;
  assert.deepEqual(found.connections, ['cplan00002']);
  assert.deepEqual(doorCard(project, graph, found).steps.filter((step) => step.kind === 'stairs').map((step) => step.labels), [['B']]);

  // with the elevator the only way down, the room has no way out, said plainly
  const only = clone(project);
  only.building.connections[1].kind = ELEVATOR_KIND;
  const none = evacuationRoutes(only);
  assert.deepEqual(none.avoided, ['cplan00001', 'cplan00002']);
  assert.deepEqual(noRoute(only, none), [{ roomId: roomId('2A'), floorId: F2, reason: 'unreachable', sentence: 'There is no way through from Room 2A on Floor 2 to an exit.', onlyByElevator: true }]);
  assert.equal(doorCard(only, null, entryOf(none, roomId('2A')).route).sentence, 'There is no way through from Room 2A on Floor 2 to an exit.');
  // stairs, or a connection with no kind, are not elevators
  const stairs = twoStairs();
  stairs.building.connections[0].kind = 'stairs';
  assert.deepEqual(elevatorConnections(stairs), []);
  assert.deepEqual(elevatorConnections(twoStairs()), []);
});

test('a non-Latin room number, door name and assembly point are on the card exactly as typed, and only typed pieces are marked as names', () => {
  const project = planProject([['.AAAA....', '.AAAA....', '#########', '.BBB.....', '.BBB.....']], {
    doors: { '1A': [[1, 1, 's']] },
    numbers: { '1A': '٢٠٤', '1B': '理科室 <b>' },
    exits: [[1, 6, 2, 'Πόρτα Β & "Δ"']],
  });
  project.building.floors[0].exits[0].assembly = 'מגרש הכדורגל <script>';
  const evacuation = evacuationRoutes(project);
  const card = doorCard(project, null, entryOf(evacuation, roomId('1A')).route);
  assert.deepEqual([card.number, card.name], ['٢٠٤', 'Room ٢٠٤']);
  assert.deepEqual(card.exit, { id: 'xplan00001', floorId: F1, floorName: 'Floor 1', doorName: 'Πόρτα Β & "Δ"', assembly: 'מגרש הכדורגל <script>' });
  assert.equal(card.text, '1. Turn left out of the door.\n2. Walk past 理科室 <b>.\n3. Exit at Πόρτα Β & "Δ".');
  const named = card.steps.flatMap((step) => step.parts.filter((part) => part.name).map((part) => part.text));
  assert.deepEqual(named, ['理科室 <b>', 'Πόρτα Β & "Δ"']);

  const other = doorCard(project, null, entryOf(evacuation, roomId('1B')).route);
  assert.deepEqual([other.number, other.name], ['理科室 <b>', '理科室 <b>']);
  assert.ok(other.steps.every((step) => step.parts.map((part) => part.text).join('') === step.text));
});

// directions()'s walk as a card says it with no scale set, by the wording's
// own rules (not by the module's code): "Walk 12 cells" loses its distance,
// a comma straight after it goes, and a bare "Walk." is "Walk on.".
function spoken(was) {
  return was.text.replace('Walk ' + was.distance, 'Walk').replace('Walk, ', 'Walk ').replace(/^Walk\.$/, 'Walk on.');
}

test('the card\'s steps are directions()\'s with every distance taken out, a bare or one-cell walk said with the turn after it, and nothing else changed', () => {
  const project = school();
  const evacuation = evacuationRoutes(project);
  let folds = 0;
  for (const entry of evacuation.rooms) {
    const card = doorCard(project, null, entry.route);
    const full = directions(project, entry.route).steps;
    // the card numbers its own steps, from 1, whatever directions() numbered
    assert.deepEqual(card.steps.map((step) => step.n), card.steps.map((step, index) => index + 1), entry.roomId);
    let j = 0;
    for (const step of card.steps) {
      const was = full[j];
      assert.equal(step.text, step.parts.map((part) => part.text).join(''));
      assert.ok(!('distance' in step) && !('cells' in step), entry.roomId + ' step ' + step.n + ' keeps a distance field');
      assert.doesNotMatch(step.text, /\bcells?\b/, entry.roomId + ': ' + step.text);
      if (was.kind !== 'walk') {
        assert.deepEqual(step, { ...was, n: step.n });
        j += 1;
        continue;
      }
      assert.equal(step.kind, 'walk');
      // the typed pieces are the same ones, in the same order
      assert.deepEqual(step.parts.filter((part) => part.name), was.parts.filter((part) => part.name));
      const next = full[j + 1];
      if (next.kind === 'turn' && (spoken(was) === 'Walk on.' || was.cells === 1)) {
        assert.equal(step.text, spoken(was).slice(0, -1) + ', then t' + next.text.slice(1), entry.roomId);
        assert.equal(step.turn, next.turn);
        folds += 1;
        j += 2;
      } else {
        assert.equal(step.text, spoken(was), entry.roomId);
        j += 1;
      }
    }
    assert.equal(j, full.length, entry.roomId + ': every step of directions() is on the card');
    assert.equal(card.text, card.steps.map((step) => step.n + '. ' + step.text).join('\n'));
    // "Walk on." is never left alone before a turn
    card.steps.forEach((step, index) => assert.ok(!(step.text === 'Walk on.' && card.steps[index + 1] && card.steps[index + 1].kind === 'turn'), entry.roomId + ' step ' + step.n));
  }
  assert.equal(folds, 12, 'the sample\'s stairs landings: one fold for each of eleven, and the cafeteria\'s doorway');
});

test('the three ways a walk loses its distance, and a bare walk off the stairs said with its turn', () => {
  const project = school();
  const card = doorCard(project, null, entryOf(evacuationRoutes(project), 'rsample303').route);
  assert.equal(card.text, [
    '1. Turn left out of the door.',
    '2. Walk past Room 301.',
    '3. Turn right.',
    '4. Walk to stairs B.',
    '5. Take stairs B down to Floor 2.',
    '6. Walk on, then turn left.',
    '7. Walk along Upper Corridor, past Room 202.',
    '8. Turn left.',
    '9. Walk to stairs A.',
    '10. Take stairs A down to Floor 1.',
    '11. Walk on, then turn right.',
    '12. Walk along Main Corridor, past Cafeteria.',
    '13. Turn right.',
    '14. Walk along Front Hall to the end of the corridor.',
    '15. Exit at Door A.',
  ].join('\n'));
  // directions() has 17 steps; the card's numbering is its own
  assert.equal(directions(project, entryOf(evacuationRoutes(project), 'rsample303').route).steps.length, 17);
  assert.deepEqual(card.steps[5].parts, [{ text: 'Walk', name: false }, { text: ' on', name: false }, { text: ', then turn left.', name: false }]);
  assert.deepEqual([card.steps[5].kind, card.steps[5].turn, card.steps[10].turn], ['walk', 'left', 'right']);
  assert.deepEqual(card.exit, { id: 'xsample00a', floorId: 'fsample001', floorName: 'Floor 1', doorName: 'Door A', assembly: 'Front lawn by the flagpole' });
});

// directions()-shaped steps written by hand, for wordings no plan gives today.
const say = (text) => ({ text, name: false });
const typedPart = (text) => ({ text, name: true });
function walkStep(n, cells, parts) {
  return { n, kind: 'walk', text: parts.map((part) => part.text).join(''), parts, cells, distance: cells + (cells === 1 ? ' cell' : ' cells'), to: null, corridorId: null, landmarkId: null };
}
const leaveStep = (n) => ({ n, kind: 'leave', text: 'Turn left out of the door.', parts: [say('Turn left out of the door.')], turn: 'left' });
const turnStep = (n, turn) => ({ n, kind: 'turn', text: 'Turn ' + turn + '.', parts: [say('Turn ' + turn + '.')], turn });
const exitStep = (n) => ({ n, kind: 'exit', text: 'Exit at Door A.', parts: [say('Exit at '), typedPart('Door A'), say('.')], exitId: 'x1' });

test('a walk worded other than "Walk <distance>…" is kept as directions() wrote it, distance and all, and the card is still made', () => {
  const odd = walkStep(2, 4, [say('Stroll 4 cells along '), typedPart('North Hall'), say('.')]);
  const unended = walkStep(3, 3, [say('Walk 3 cells')]);
  const plain = walkStep(5, 6, [say('Walk 6 cells'), say(' along '), typedPart('South Hall'), say('.')]);
  const steps = [leaveStep(1), odd, unended, turnStep(4, 'right'), plain, exitStep(6)];
  const before = structuredClone(steps);
  const card = cardSteps(steps);
  assert.deepEqual(card.map((step) => step.text), ['Turn left out of the door.', 'Stroll 4 cells along North Hall.', 'Walk 3 cells', 'Turn right.', 'Walk along South Hall.', 'Exit at Door A.']);
  // the odd ones keep their distance fields, since their text still says it
  assert.deepEqual([card[1].distance, card[1].cells, card[2].distance], ['4 cells', 4, '3 cells']);
  assert.ok(!('distance' in card[4]));
  assert.deepEqual(steps, before, 'the steps handed in are not changed');
});

test('a one-cell walk before a turn is said with the turn, and the card numbers its own steps', () => {
  const steps = [
    leaveStep(1),
    walkStep(2, 1, [say('Walk 1 cell'), say(', past '), say('Room '), typedPart('9'), say('.')]),
    turnStep(3, 'left'),
    walkStep(4, 1, [say('Walk 1 cell'), say('.')]),
    turnStep(5, 'around'),
    walkStep(6, 5, [say('Walk 5 cells'), say('.')]),
    turnStep(7, 'right'),
    walkStep(8, 2, [say('Walk 2 cells'), say(' to the end of the corridor'), say('.')]),
    exitStep(9),
  ];
  const card = cardSteps(steps);
  assert.deepEqual(card.map((step) => step.n + '. ' + step.text), [
    '1. Turn left out of the door.',
    '2. Walk past Room 9, then turn left.',
    '3. Walk on, then turn around.',
    '4. Walk on, then turn right.',
    '5. Walk to the end of the corridor.',
    '6. Exit at Door A.',
  ]);
  assert.deepEqual(card[1].parts.filter((part) => part.name), [typedPart('9')]);
  assert.deepEqual(card.slice(1, 4).map((step) => step.turn), ['left', 'around', 'right']);
  // a walk before anything but a turn is not folded
  assert.deepEqual(cardSteps([leaveStep(1), walkStep(2, 1, [say('Walk 1 cell'), say('.')]), exitStep(3)]).map((step) => step.text), ['Turn left out of the door.', 'Walk on.', 'Exit at Door A.']);
  // with a scale the distance stays, and a one-cell walk still folds
  const metres = cardSteps([leaveStep(1), walkStep(2, 1, [say('Walk 2 metres'), say('.')]), turnStep(3, 'left'), exitStep(4)], { perCell: 2, one: 'metre', many: 'metres' });
  assert.deepEqual(metres.map((step) => step.text), ['Turn left out of the door.', 'Walk 2 metres, then turn left.', 'Exit at Door A.']);
});

test('with units the card keeps real distances; with none it takes them out', () => {
  const project = school();
  const route = entryOf(evacuationRoutes(project), 'rsample303').route;
  const units = { perCell: 2, one: 'metre', many: 'metres' };
  const card = doorCard(project, null, route, { units });
  assert.deepEqual(card.steps.filter((step) => step.kind === 'walk').map((step) => step.text), [
    'Walk 58 metres, past Room 301.',
    'Walk 2 metres to stairs B.',
    'Walk 2 metres, then turn left.',
    'Walk 42 metres along Upper Corridor, past Room 202.',
    'Walk 2 metres to stairs A.',
    'Walk 2 metres, then turn right.',
    'Walk 16 metres along Main Corridor, past Cafeteria.',
    'Walk 12 metres along Front Hall to the end of the corridor.',
  ]);
  assert.deepEqual(card.steps[1].distance, '58 metres');
  assert.equal(card.steps.length, 15);
  assert.doesNotMatch(doorCard(project, null, route).text, /\d+ (metres?|cells?)/);
  assert.doesNotMatch(doorCard(project, null, route, {}).text, /\d+ (metres?|cells?)/);
});

test('a stale route gives a card that says to work it out again, and never throws', () => {
  const project = twoStairs();
  const route = entryOf(evacuationRoutes(project), roomId('2A')).route;
  assert.deepEqual(route.connections, ['cplan00001']);
  assert.equal(doorCard(project, null, route).ok, true, 'the route fits the building it was worked out on');
  const again = 'The way out from Room 2A has changed since it was worked out; work it out again.';
  const changes = {
    'the exit removed': (p) => { p.building.floors[0].exits = []; },
    'the exit moved along the corridor': (p) => { p.building.floors[0].exits[0].cell += 1; },
    'the exit\'s floor given another id': (p) => { p.building.floors[0].id = 'fother'; },
    'the stairs taken out': (p) => { p.building.connections.shift(); },
    'a cell of the route painted empty': (p) => { const floor = p.building.floors[1]; floor.cells = floor.cells.slice(0, route.cells[1].cell) + '.' + floor.cells.slice(route.cells[1].cell + 1); },
    'the room redrawn without the cell it is left by': (p) => { const room = p.building.floors[1].spaces.find((space) => space.id === roomId('2A')); room.cells = room.cells.filter((cell) => cell !== route.from.cell); },
    'the floor made smaller': (p) => { const floor = p.building.floors[1]; floor.height = 2; floor.cells = floor.cells.slice(0, floor.width * 2); },
  };
  for (const [what, change] of Object.entries(changes)) {
    const changed = clone(project);
    change(changed);
    let card;
    assert.doesNotThrow(() => { card = doorCard(changed, null, route); }, what);
    assert.deepEqual([card.ok, card.stale, card.sentence, card.steps, card.floors, card.exit, card.seconds], [false, true, again, [], [], null, null], what);
  }
  // the room itself gone: the card cannot name it
  const gone = clone(project);
  gone.building.floors[1].spaces = gone.building.floors[1].spaces.filter((space) => space.id !== roomId('2A'));
  const card = doorCard(gone, null, route);
  assert.deepEqual([card.ok, card.stale, card.number, card.floor, card.sentence], [false, true, '', null, 'The way out from this room has changed since it was worked out; work it out again.']);
  // no route at all
  assert.equal(doorCard(project, null, null).sentence, 'The way out from this room has changed since it was worked out; work it out again.');
  assert.equal(doorCard(project, null, undefined).stale, true);
  // a route that never got out is not stale: its own sentence stands
  const wing = disconnectedWing();
  const failed = doorCard(wing, null, entryOf(evacuationRoutes(wing), roomId('1D')).route);
  assert.deepEqual([failed.stale, failed.sentence], [false, 'There is no way through from Room 1D on Floor 1 to an exit.']);
});

test('the caller\'s avoidConnections and avoidStairs pass through to routeToExit, merged with the elevators, never replaced by them', () => {
  // the caller closes the near stairs: the far ones
  const project = twoStairs();
  const far = evacuationRoutes(project, null, { avoidConnections: ['cplan00001'] });
  assert.deepEqual(entryOf(far, roomId('2A')).route.connections, ['cplan00002']);
  assert.deepEqual([far.avoided, far.asked], [[], { avoidConnections: ['cplan00001'], avoidStairs: false, avoidExits: [] }]);
  // a Set is read the same way
  assert.deepEqual(entryOf(evacuationRoutes(project, null, { avoidConnections: new Set(['cplan00001']) }), roomId('2A')).route.connections, ['cplan00002']);

  // the near stairs an elevator, the far ones closed by the caller: both are avoided
  const lift = twoStairs();
  lift.building.connections[0].kind = ELEVATOR_KIND;
  const both = evacuationRoutes(lift, null, { avoidConnections: ['cplan00002'] });
  assert.deepEqual(both.avoided, ['cplan00001']);
  assert.equal(entryOf(both, roomId('2A')).route.ok, false, 'neither the elevator nor the closed stairs is used');
  // the caller asked to avoid a connection, so the sentence says so
  assert.deepEqual(noRoute(lift, both), [{ roomId: roomId('2A'), floorId: F2, reason: 'unreachable', sentence: 'There is no way through that keeps to what you asked to avoid from Room 2A on Floor 2 to an exit.', onlyByElevator: true }]);
  assert.equal(doorCard(lift, null, entryOf(both, roomId('2A')).route, { avoidConnections: both.asked.avoidConnections }).sentence, noRoute(lift, both)[0].sentence);

  // a step-free way out: no stairs at all, said as the routing engine says it
  const stepFree = evacuationRoutes(project, null, { avoidStairs: true });
  assert.equal(stepFree.asked.avoidStairs, true);
  assert.deepEqual(noRoute(project, stepFree).map((row) => [row.roomId, row.sentence, row.onlyByElevator]), [[roomId('2A'), 'There is no step-free way through from Room 2A on Floor 2 to an exit.', false]]);
  assert.equal(entryOf(stepFree, roomId('1A')).route.ok, true);
});

test('onlyByElevator: a room with no way out is routed once more with the elevators let in, and no other room is', () => {
  const project = twoStairs();
  project.building.connections[0].kind = ELEVATOR_KIND;
  project.building.connections[1].kind = ELEVATOR_KIND;
  const cache = createRouteCache();
  const evacuation = evacuationRoutes(project, null, { cache, geometryVersion: 1 });
  assert.deepEqual(evacuation.rooms.map((entry) => [entry.roomId, entry.route.ok, entry.onlyByElevator]), [[roomId('1A'), true, false], [roomId('2A'), false, true]]);
  // one search per room, and one more for the room with no way out
  assert.equal(cache.searches, 3);
  assert.deepEqual(noRoute(project, evacuation).map((row) => [row.sentence, row.onlyByElevator]), [['There is no way through from Room 2A on Floor 2 to an exit.', true]]);
  // with no elevator nothing is routed twice, and a room with no way at all is not onlyByElevator
  const wing = disconnectedWing();
  const fresh = createRouteCache();
  const plain = evacuationRoutes(wing, null, { cache: fresh, geometryVersion: 1 });
  assert.equal(fresh.searches, plain.rooms.length);
  assert.ok(plain.rooms.every((entry) => entry.onlyByElevator === false));
});

test('exits that tie on seconds: fewer turns win before id order', () => {
  // the room's door is at x 4; the exit at x 2 (the lower id) is two cells
  // west then a turn south, the one at x 4 is four cells straight south
  const project = planProject([['....A....', '....A....', '..#####..', '....#....', '....#....']], { doors: { '1A': [[4, 1, 's']] }, exits: [[1, 2, 2, 'Turn Door'], [1, 4, 4, 'Straight Door']] });
  const graph = routingGraph(project);
  const turning = routeToExit(graph, roomId('1A'), { avoidExits: ['xplan00002'] });
  const straight = routeToExit(graph, roomId('1A'), { avoidExits: ['xplan00001'] });
  assert.equal(turning.seconds, straight.seconds, 'the two ways take the same time');
  assert.ok(turning.turns > straight.turns);
  const card = doorCard(project, graph, evacuationRoutes(project, graph).rooms[0].route);
  assert.deepEqual([card.exit.id, card.exit.doorName], ['xplan00002', 'Straight Door']);
});

test('step-free: ELEVATOR_KIND is schema.js\'s, re-exported here', () => {
  assert.equal(ELEVATOR_KIND, schema.ELEVATOR_KIND);
  assert.equal(ELEVATOR_KIND, 'elevator');
});

test('step-free: connections of the elevator kind with no lifts list stay valid, and repair leaves them elevators', () => {
  for (const make of [twoStairs, () => school()]) {
    const project = make();
    for (const connection of project.building.connections) connection.kind = ELEVATOR_KIND;
    assert.deepEqual(validate(project), [], 'valid with no lifts at all (ARCHITECTURE 19.2)');
    const repaired = repair(project).project;
    assert.deepEqual(validate(repaired), []);
    assert.deepEqual(repaired.building.connections.map((connection) => connection.kind), project.building.connections.map(() => ELEVATOR_KIND));
    assert.deepEqual(elevatorConnections(repaired), elevatorConnections(project), 'evacuation avoids the same connections');
  }
});

// ---------------------------------------------------------------- SV2-100: step-free ways out, and a staff-only elevator

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

test('onlyByElevator fires for a staff-only elevator too: a plain route, which a teacher or evacuation\'s own check may use, opens it', () => {
  for (const staffOnly of [false, true]) {
    const project = withCars(planProject([HALL, HALL], { exits: [[1, 6, 2, 'Main Door']] }), [{ stops: [[1, 0, 2], [2, 0, 2]], letter: 'D', staffOnly }]);
    const evacuation = evacuationRoutes(project);
    assert.deepEqual(evacuation.rooms.map((entry) => [entry.roomId, entry.route.ok, entry.onlyByElevator]), [[roomId('1A'), true, false], [roomId('1B'), true, false], [roomId('2A'), false, true], [roomId('2B'), false, true]], 'staffOnly ' + staffOnly);
    assert.deepEqual(evacuation.avoided, [project.building.connections[0].id]);
    assert.equal(noRoute(project, evacuation)[0].sentence, 'There is no way through from Room 2A on Floor 2 to an exit.', 'the car is not named as something the reader asked to avoid');
  }
  // the car's id is its first connection's: a three-stop chain avoids both of its connections, and the second names the same car
  const chain = withCars(planProject([HALL, HALL, HALL], { exits: [[1, 6, 2, 'Main Door']] }), [{ stops: [[1, 0, 2], [2, 0, 2], [3, 0, 2]], letter: 'D', staffOnly: true }]);
  assert.equal(evacuationRoutes(chain).rooms.filter((entry) => entry.onlyByElevator).length, 4);
});

// A floor with two exits (one with a step), a refuge in the middle of the corridor, and rooms at both ends.
const ROW = ['AA..BB..', 'AA..BB..', '########', '........', '........'];

function wide(options) {
  const project = planProject([ROW], { exits: [[1, 0, 2, 'West Door'], [1, 7, 2, 'East Door']] });
  const floor = project.building.floors[0];
  floor.exits[0].stepFree = (options && options.west) === undefined ? false : options.west;
  floor.exits[1].stepFree = (options && options.east) === undefined ? true : options.east;
  floor.refuges = [{ id: 'aplan00001', cell: 2 * floor.width + 3, name: 'Refuge by the stairs' }];
  floor.corridors = [{ id: 'kplan00001', name: 'North Corridor', cells: Array.from({ length: 8 }, (unused, x) => 2 * floor.width + x) }];
  return project;
}

test('stepFreeWaysOut: an exit is preferred to an area of refuge however far, and an exit with a step is avoided', () => {
  const project = wide();
  const waysOut = stepFreeWaysOut(project);
  const a = waysOut.rooms.find((entry) => entry.roomId === roomId('1A'));
  assert.deepEqual([a.way, a.exitId, a.refugeId, a.reason], ['exit', 'xplan00002', null, null], 'West Door has a step; the refuge is nearer but leaving beats waiting');
  assert.equal(a.route.exit.id, 'xplan00002');
  assert.equal(a.route.stairs + a.route.rides, 0);
  // the plain evacuation takes the nearer exit, the step one
  assert.equal(entryOf(evacuationRoutes(project), roomId('1A')).route.exitId, 'xplan00001');
  assert.deepEqual(waysOut.refuges, [{ refugeId: 'aplan00001', floorId: F1, name: 'Refuge by the stairs', roomIds: [] }], 'a refuge nobody waits at has no rooms');
  assert.deepEqual(waysOut.rooms.map((entry) => entry.way), ['exit', 'exit']);
  // with both exits stepped, the refuge is the way, and its rooms are counted
  const refuge = stepFreeWaysOut(wide({ east: false }));
  assert.deepEqual(refuge.rooms.map((entry) => [entry.way, entry.refugeId, entry.exitId]), [['refuge', 'aplan00001', null], ['refuge', 'aplan00001', null]]);
  assert.deepEqual(refuge.rooms[0].route.target, { id: 'aplan00001', floorId: F1, cell: 2 * project.building.floors[0].width + 3 });
  assert.deepEqual(refuge.refuges[0].roomIds, [roomId('1A'), roomId('1B')]);
  // with neither an exit nor a refuge: none, and why
  const bare = wide({ east: false });
  bare.building.floors[0].refuges = [];
  const none = stepFreeWaysOut(bare);
  assert.deepEqual(none.rooms.map((entry) => [entry.way, entry.reason, entry.exitId, entry.refugeId]), [['none', 'step-exits', null, null], ['none', 'step-exits', null, null]], 'both exits have a step: SV2-100b says so, it was \'no-way\'');
  assert.equal(none.rooms[0].route.ok, false);
  assert.equal(none.rooms[0].why, 'every exit has a step');
  // an exit with no mark is as step-free as the building says (absent = true)
  const plain = wide();
  delete plain.building.floors[0].exits[0].stepFree;
  assert.equal(stepFreeWaysOut(plain).rooms[0].exitId, 'xplan00001');
});

test('stepFreeWaysOut: elevators are never used, and a room that could leave only by one says so', () => {
  const project = withCars(planProject([HALL, HALL], { exits: [[1, 6, 2, 'Main Door']] }), [{ stops: [[1, 0, 2], [2, 0, 2]], letter: 'D', staffOnly: false }]);
  const floor = project.building.floors[1];
  floor.refuges = [{ id: 'aplan00001', cell: 2 * floor.width + 4, name: 'Area of refuge' }];
  const waysOut = stepFreeWaysOut(project);
  assert.deepEqual(waysOut.rooms.map((entry) => entry.way), ['exit', 'exit', 'refuge', 'refuge'], 'upstairs the car is shut, so the refuge on the floor is the way');
  assert.deepEqual(waysOut.rooms.slice(0, 2).map((entry) => entry.route.rides), [0, 0]);
  assert.deepEqual(waysOut.avoided, [project.building.connections[0].id]);
  // no refuge upstairs: none, only by elevator, whether the car is staff-only or not
  for (const staffOnly of [false, true]) {
    const bare = withCars(planProject([HALL, HALL], { exits: [[1, 6, 2, 'Main Door']] }), [{ stops: [[1, 0, 2], [2, 0, 2]], letter: 'D', staffOnly }]);
    const found = stepFreeWaysOut(bare).rooms.filter((entry) => entry.way === 'none');
    assert.deepEqual(found.map((entry) => [entry.roomId, entry.reason, entry.why]), [[roomId('2A'), 'only-by-elevator', 'only by elevator'], [roomId('2B'), 'only-by-elevator', 'only by elevator']], 'staffOnly ' + staffOnly);
  }
  // stairs and no elevator: no way, not "by elevator"
  const stairsOnly = stepFreeWaysOut(planProject([['.AA.BB.', '.AA.BB.', 'S######', '.......', '.......'], ['.AA.BB.', '.AA.BB.', 'S######', '.......', '.......']], { exits: [[1, 6, 2, 'Main Door']], connections: [[1, 0, 2, 2, 0, 2]] }));
  assert.deepEqual(stairsOnly.rooms.filter((entry) => entry.way === 'none').map((entry) => entry.reason), ['no-way', 'no-way']);
});

test('stepFreeWaysOut: a room whose every door has a step, and a step across the way out, say so', () => {
  const doors = planProject([['.AAAA.', '.AAAA.', '######', '.BBBB.', '.BBBB.']], { doors: { '1A': [[1, 1, 's'], [4, 1, 's']], '1B': [[2, 3, 'n']] }, exits: [[1, 5, 2, 'East Door']] });
  doors.building.floors[0].spaces.find((space) => space.number === '1A').doors.forEach((door) => { door.stepFree = false; });
  const byDoor = stepFreeWaysOut(doors).rooms.find((entry) => entry.roomId === roomId('1A'));
  assert.deepEqual([byDoor.way, byDoor.reason, byDoor.why, byDoor.sentence], ['none', 'step-doors', 'every door has a step', 'Room 1A on Floor 1 has no step-free door.']);
  assert.equal(stepFreeWaysOut(doors).rooms.find((entry) => entry.roomId === roomId('1B')).way, 'exit', 'a room with a level door is not held by the other');
  // a step in the corridor between the room and the only exit
  const step = wide({ west: true, east: false });
  const floor = step.building.floors[0];
  floor.refuges = [];
  floor.notStepFree = [2 * floor.width + 1];
  const across = stepFreeWaysOut(step).rooms.find((entry) => entry.roomId === roomId('1B'));
  assert.deepEqual([across.way, across.reason, across.why], ['none', 'steps', 'a step on North Corridor']);
  assert.equal(across.sentence, 'There is no step-free way through from Room 1B on Floor 1 to an exit: a step on North Corridor.');
  assert.equal(stepFreeWaysOut(step).rooms.find((entry) => entry.roomId === roomId('1A')).way, 'exit', 'the exit in the same part is reached');
});

// ---------------------------------------------------------------- SV2-100b

test('stepFreeWaysOut: a room whose only exits all have a step is "step-exits", "every exit has a step", from routeToExit\'s own failure', () => {
  const project = wide({ west: false, east: false });
  project.building.floors[0].refuges = [];
  const rooms = stepFreeWaysOut(project).rooms;
  assert.deepEqual(rooms.map((entry) => [entry.way, entry.reason, entry.why]), [['none', 'step-exits', 'every exit has a step'], ['none', 'step-exits', 'every exit has a step']]);
  assert.equal(rooms[0].sentence, 'There is no step-free way through from Room 1A on Floor 1 to an exit: every exit has a step.');
  assert.deepEqual(rooms[0].route.avoiding.filter((what) => what === 'step-exits'), ['step-exits'], 'routing produced it');
  // a step cell in the way as well as the exits: opening the step cell alone gives no way, so the exits are the reason
  const both = wide({ west: false, east: false });
  both.building.floors[0].refuges = [];
  both.building.floors[0].notStepFree = [2 * both.building.floors[0].width + 3, 2 * both.building.floors[0].width + 4];
  assert.equal(stepFreeWaysOut(both).rooms[0].reason, 'step-exits');
});

test('stepFreeWaysOut: a refuge on a step cell is not a way; a building with no exit and a refuge uses the refuge', () => {
  const stepped = wide({ west: false, east: false });
  const floor = stepped.building.floors[0];
  floor.notStepFree = [floor.refuges[0].cell];
  const rooms = stepFreeWaysOut(stepped);
  assert.deepEqual(rooms.rooms.map((entry) => [entry.way, entry.reason]), [['none', 'step-exits'], ['none', 'step-exits']], 'nobody can stand on a step');
  assert.deepEqual(rooms.refuges[0].roomIds, [], 'the refuge is used by nobody');
  // no exit drawn at all, and a refuge: the refuge is the way, and the failure to an exit is the plain one
  const none = planProject([ROW]);
  none.building.floors[0].refuges = [{ id: 'aplan00001', cell: 2 * none.building.floors[0].width + 3, name: 'Refuge by the stairs' }];
  const found = stepFreeWaysOut(none);
  assert.deepEqual(found.rooms.map((entry) => [entry.way, entry.refugeId]), [['refuge', 'aplan00001'], ['refuge', 'aplan00001']]);
  assert.deepEqual(found.refuges[0].roomIds, [roomId('1A'), roomId('1B')]);
  // and with neither: no way, said plainly
  const bare = planProject([ROW]);
  assert.deepEqual(stepFreeWaysOut(bare).rooms.map((entry) => [entry.way, entry.reason, entry.why]), [['none', 'no-way', 'no step-free way through'], ['none', 'no-way', 'no step-free way through']]);
});

// ---- W5 (SV2-107): shutCells in both functions, exits and cells in the lifted plan, nothing new when absent

const TWO_FLOORS = ['..AA......', '..AA......', 'S########S', '..........', '..........'];

function twoStairsBuilding() {
  return planProject([TWO_FLOORS, TWO_FLOORS], {
    doors: { '1A': [[2, 1, 's']], '2A': [[2, 1, 's']] },
    connections: [[1, 0, 2, 2, 0, 2], [1, 9, 2, 2, 9, 2]],
    exits: [[1, 1, 2, 'West Door']],
  });
}

test('evacuationRoutes passes shutCells to routing: a shut corridor cell sends the room the long way round', () => {
  const project = twoStairsBuilding();
  const plain = evacuationRoutes(project);
  const upper = (result) => result.rooms.find((entry) => entry.roomId === roomId('2A'));
  assert.deepEqual(upper(plain).route.connections, ['cplan00001']);
  const shut = [{ floorId: F2, cell: 21 }];
  const detour = evacuationRoutes(project, undefined, { shutCells: shut });
  assert.deepEqual(upper(detour).route.connections, ['cplan00002'], 'floor 2\'s cell beside stairs A is shut: the way is stairs B');
  assert.ok(upper(detour).route.seconds > upper(plain).route.seconds);
  assert.deepEqual(detour.asked.shutCells, shut, 'what was asked, for the one who words a failure');
  // both ways shut: no way out, in the avoided words
  const none = evacuationRoutes(project, undefined, { shutCells: [{ floorId: F2, cell: 21 }, { floorId: F2, cell: 28 }] });
  assert.equal(upper(none).route.ok, false);
  assert.match(noRoute(project, none)[0].sentence, /no way through that keeps to what you asked to avoid/);
});

test('evacuationRoutes: with no shutCells, an empty list or junk the results are exactly what they were', () => {
  const project = twoStairsBuilding();
  const alone = JSON.stringify(evacuationRoutes(project));
  for (const shutCells of [undefined, [], null, [null, { floorId: 1 }, { cell: 4 }]]) {
    assert.equal(JSON.stringify(evacuationRoutes(project, undefined, { shutCells })), alone, JSON.stringify(shutCells));
  }
  assert.ok(!('shutCells' in evacuationRoutes(project).asked), 'asked has no new field when nothing was asked');
});

test('stepFreeWaysOut passes shutCells too, and judges "only by elevator" with them shut', () => {
  const lift = (staffOnly) => withCars(planProject([HALL, HALL], { exits: [[1, 6, 2, 'Main Door']] }), [{ stops: [[1, 0, 2], [2, 0, 2]], letter: 'D', staffOnly }]);
  const project = lift(false);
  const upper = (waysOut) => waysOut.rooms.filter((entry) => entry.floorId === F2).map((entry) => [entry.way, entry.reason]);
  assert.deepEqual(upper(stepFreeWaysOut(project)), [['none', 'only-by-elevator'], ['none', 'only-by-elevator']]);
  // floor 1's corridor shut between the car and the exit: a car would not help either
  const shut = [{ floorId: F1, cell: 2 * project.building.floors[0].width + 3 }];
  assert.deepEqual(upper(stepFreeWaysOut(project, undefined, { shutCells: shut })), [['none', 'no-way'], ['none', 'no-way']], 'the lifted search has the cells shut: no elevator is blamed');
  // and a floor 1 room is cut off by the same cells on the ground
  const ground = stepFreeWaysOut(project, undefined, { shutCells: shut }).rooms.filter((entry) => entry.floorId === F1);
  assert.ok(ground.some((entry) => entry.way === 'exit'), 'rooms on the near side of the cells still leave');
  // a shut exit is shut in the lifted plan as well: leaving by the only exit blocked is no way, not "only by elevator"
  const noExit = stepFreeWaysOut(project, undefined, { avoidExits: [project.building.floors[0].exits[0].id] });
  assert.deepEqual(upper(noExit), [['none', 'no-way'], ['none', 'no-way']]);
});

test('stepFreeWaysOut reads no avoidConnections: a step-free way uses no stairs, so a blocked stairs changes nothing', () => {
  const project = twoStairsBuilding();
  assert.equal(JSON.stringify(stepFreeWaysOut(project, undefined, { avoidConnections: ['cplan00001'] })), JSON.stringify(stepFreeWaysOut(project)));
});

test('stepFreeWaysOut with none of the new options is what it was, on a drawn building and on the step-free fixture', () => {
  const alone = (project) => JSON.stringify(stepFreeWaysOut(project));
  const drawn = twoStairsBuilding();
  const sample = withElevator();
  for (const project of [drawn, sample]) {
    const expected = alone(project);
    for (const options of [undefined, {}, { shutCells: [] }, { avoidExits: [] }, { shutCells: [], avoidExits: [], avoidConnections: [] }]) {
      assert.equal(JSON.stringify(stepFreeWaysOut(project, undefined, options)), expected, JSON.stringify(options));
    }
  }
});

test('evacuationRoutes with none of the new options is what it was, on the sample and on the step-free fixture', () => {
  for (const project of [school(), withElevator()]) {
    const expected = JSON.stringify(evacuationRoutes(project));
    for (const options of [undefined, {}, { shutCells: [] }, { avoidExits: [], avoidConnections: [], shutCells: [] }]) {
      assert.equal(JSON.stringify(evacuationRoutes(project, undefined, options)), expected, JSON.stringify(options));
    }
    // the same graph handed in, and a cache: the same routes
    const graph = routingGraph(project, buildGraph(project));
    assert.equal(JSON.stringify(evacuationRoutes(project, graph, { cache: createRouteCache(200), geometryVersion: 1 })), expected);
  }
});

test('reachableExits: the exits a room can reach, under the options a trial uses, in building order', () => {
  const project = twoStairsBuilding();
  project.building.floors[0].exits.push({ id: 'xplan00002', cell: 8 + 2 * project.building.floors[0].width, doorName: 'East Door', assembly: '' });
  assert.deepEqual(reachableExits(project, undefined, roomId('2A')), ['xplan00001', 'xplan00002']);
  assert.deepEqual(reachableExits(project, undefined, roomId('2A'), { avoidConnections: ['cplan00001', 'cplan00002'] }), [], 'no stairs, no exit from floor 2');
  const w = project.building.floors[0].width;
  assert.deepEqual(reachableExits(project, undefined, roomId('1A'), { shutCells: [{ floorId: F1, cell: 2 * w + 5 }] }), ['xplan00001', 'xplan00002'], 'one floor shut: up the stairs and over is a way to the east exit');
  assert.deepEqual(reachableExits(project, undefined, roomId('1A'), { shutCells: [{ floorId: F1, cell: 2 * w + 5 }, { floorId: F2, cell: 2 * w + 5 }] }), ['xplan00001'], 'both floors shut: the east exit is cut off');
  assert.deepEqual(reachableExits(project, undefined, 'rgone'), []);
});

test('a step-free way on a short way round: a one-cell walk before a turn folds into it, as on the ordinary card, and is never the whole block (W4 leftover)', () => {
  // the room's door gives onto the corridor's corner: one cell east, then south to an area of refuge
  const project = planProject([['.A....', '.A....', '###...', '..#...', '..#...', '..#...']], { doors: { '1A': [[1, 1, 's']] } });
  const floor = project.building.floors[0];
  floor.refuges = [{ id: 'aplan00001', cell: 5 * floor.width + 2, name: 'Area of refuge' }];
  const way = stepFreeWaysOut(project).rooms[0];
  assert.equal(way.way, 'refuge');
  const raw = directions(project, way.route).steps.filter((step) => step.kind !== 'arrive');
  assert.deepEqual(raw.map((step) => step.text), ['Turn left out of the door.', 'Walk 1 cell.', 'Turn right.', 'Walk 3 cells to the end of the corridor.']);
  const steps = cardSteps(raw);
  assert.deepEqual(steps.map((step) => step.n + '. ' + step.text), ['1. Turn left out of the door.', '2. Walk on, then turn right.', '3. Walk to the end of the corridor.'], 'the fold says the one cell and the turn together, once');
  assert.equal(steps[1].turn, 'right', 'the folded step keeps the turn it carries');
  // a block always has its first step out of the door and its last at the exit or the refuge, so the fold is never alone
  assert.ok(steps.length >= 3 && steps[0].kind === 'leave' && steps[steps.length - 1].kind === 'walk');
});
