// Safety's figures: exit numbers and names, the load warning's thresholds and
// words, and the rooms on each named corridor (ARCHITECTURE 20.2, 20.9).
//
// exitLoad is fed rows by hand wherever the case is about a threshold, so the
// figure under test is the figure written in the case; the building is only
// there for the exits' names and order.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../../engine/graph.js';
import { routingGraph } from '../../engine/routing.js';
import { evacuationRoutes, byExit } from '../../engine/evacuation.js';
import { EXIT_UNNAMED, HEAVY_SHARE, HEAVY_MARGIN, exitNumbers, exitName, exitLoad, corridorRooms, roomsOnNoNamedCorridor } from '../../engine/exit-load.js';
import { sampleSchool } from '../../data/sample-school.js';
import { planProject, floorId, roomId } from '../fixtures/buildings/plans.mjs';

// A corridor with `names.length` exits along it and no rooms.
function exitsOnly(names) {
  const exits = names.map((name, i) => [1, i, 2, name]);
  return planProject([['.........', '.........', '#########', '.........', '.........']], { exits });
}

// byExit-shaped rows from [rooms, people, uncounted] per exit, in exit order.
function rowsOf(project, figures) {
  const ids = [];
  for (const floor of project.building.floors) for (const exit of floor.exits) ids.push([exit.id, floor.id]);
  return ids.map(([exitId, floorIdOf], i) => ({ exitId, floorId: floorIdOf, doorName: '', assembly: '', roomIds: [], rooms: figures[i][0], people: figures[i][1], uncounted: figures[i][2] || 0 }));
}

// The people of each exit, every room counted.
function peopleLoad(project, people, options) {
  return exitLoad(project, rowsOf(project, people.map((n) => [Math.max(1, Math.round(n / 25)), n, 0])), options);
}

test('the constants: 1.6 times an even share, and 50 people or 4 rooms more', () => {
  assert.equal(HEAVY_SHARE, 1.6);
  assert.deepEqual({ ...HEAVY_MARGIN }, { people: 50, rooms: 4 });
});

test('exitNumbers: byExit\'s order from 1, floors in display order, then each floor\'s own exits', () => {
  const project = planProject([['.........', '.........', '#########', '.........', '.........'], ['.........', '.........', '#########', '.........', '.........']], { exits: [[2, 0, 2, 'Roof Door'], [1, 4, 2, 'West'], [1, 1, 2, 'East']] });
  const numbers = exitNumbers(project);
  // plan exits are numbered by the order given, not by floor: the ids say which is which
  const order = [];
  for (const floor of project.building.floors) for (const exit of floor.exits) order.push(exit.doorName);
  assert.deepEqual(order, ['West', 'East', 'Roof Door']);
  assert.deepEqual(Array.from(numbers.values()), [1, 2, 3]);
  assert.deepEqual(Array.from(numbers.keys()).map((id) => exitName(project, id)), ['West', 'East', 'Roof Door']);
});

test('exitNumbers on the sample equal the numbers Safety counts through byExit', () => {
  const project = sampleSchool();
  const rows = byExit(project, evacuationRoutes(project, buildGraph(project)));
  const numbers = exitNumbers(project);
  assert.equal(numbers.size, rows.length);
  rows.forEach((row, i) => assert.equal(numbers.get(row.exitId), i + 1));
});

test('exitName: the door name as typed, in any script; the unnamed exit has its floor\'s words; a gone exit is empty', () => {
  const project = exitsOnly(['<b>"Door" & Tür</b>', '', '   ', '日本語の扉']);
  const [a, b, c, d] = project.building.floors[0].exits.map((exit) => exit.id);
  assert.equal(exitName(project, a), '<b>"Door" & Tür</b>');
  assert.equal(exitName(project, b), 'The exit on Floor 1');
  assert.equal(exitName(project, c), 'The exit on Floor 1', 'a door name of spaces is no name');
  assert.equal(exitName(project, d), '日本語の扉');
  assert.equal(exitName(project, 'xgone'), '');
  assert.equal(EXIT_UNNAMED('Floor 1'), 'The exit on Floor 1', 'ui/safety/model.js has these words today; they must not move');
  project.building.floors[0].name = '<i>Ground</i>';
  assert.equal(exitName(project, b), 'The exit on <i>Ground</i>', 'the floor\'s name as typed too');
});

test('exitLoad, two exits: heavy at 1.6 times an even share and at least 50 people more, not a person below', () => {
  const project = exitsOnly(['A', 'B']);
  // total 200, fair 100: 160 is exactly 1.6 times and 60 more
  assert.deepEqual(peopleLoad(project, [160, 40]).heavy, [project.building.floors[0].exits[0].id]);
  assert.deepEqual(peopleLoad(project, [159, 41]).heavy, [], '159 of 200 is under 1.6 times');
  // total 100: 80 is 1.6 times fair 50 but only 30 more
  assert.deepEqual(peopleLoad(project, [80, 20]).heavy, [], 'a share without the margin is not heavy');
  assert.deepEqual(peopleLoad(project, [90, 10]).heavy, [], '90 of 100 is 40 more, under the margin');
  assert.deepEqual(peopleLoad(project, [100, 0]).heavy.length, 1, 'with 100 of 100 the margin is met: 50 more');
  assert.deepEqual(peopleLoad(project, [100, 100]).heavy, [], 'an even split');
});

test('exitLoad, three and four exits: the same two tests at their own even shares', () => {
  const three = exitsOnly(['A', 'B', 'C']);
  assert.equal(peopleLoad(three, [160, 70, 70]).heavy.length, 1, 'total 300, fair 100: 160 is the line');
  assert.equal(peopleLoad(three, [159, 71, 70]).heavy.length, 0);
  assert.equal(peopleLoad(three, [100, 25, 25]).heavy.length, 1, 'total 150, fair 50: 100 is 1.6 times and exactly 50 more');
  assert.equal(peopleLoad(three, [99, 26, 25]).heavy.length, 0, 'a person under the margin');
});

test('exitLoad, four exits: 160 of 400 is the share line and 159 is under it', () => {
  const four = exitsOnly(['A', 'B', 'C', 'D']);
  // total 400, fair 100: 1.6 x 100 = 160, margin 150
  const at = exitLoad(four, rowsOf(four, [[10, 160], [10, 80], [10, 80], [10, 80]]));
  assert.equal(at.total, 400);
  assert.equal(at.fair, 100);
  assert.deepEqual(at.heavy, [four.building.floors[0].exits[0].id]);
  const under = exitLoad(four, rowsOf(four, [[10, 159], [10, 81], [10, 80], [10, 80]]));
  assert.deepEqual(under.heavy, []);
});

test('exitLoad on the rooms basis: 4 rooms more than an even share', () => {
  const project = exitsOnly(['A', 'B', 'C']);
  const rooms = (figures) => exitLoad(project, rowsOf(project, figures.map((n) => [n, 0, n])));
  // every room uncounted: the basis is rooms. total 12, fair 4: 6.4 and 8 are the lines
  assert.equal(rooms([8, 2, 2]).basis, 'rooms');
  assert.equal(rooms([8, 2, 2]).heavy.length, 1, '8 of 12 is over 6.4 and exactly 4 more');
  assert.equal(rooms([7, 3, 2]).heavy.length, 0, '7 is 3 more');
});

test('exitLoad: the basis is rooms only when more than half the rooms with a way out have no capacity', () => {
  const project = exitsOnly(['A', 'B']);
  const half = exitLoad(project, rowsOf(project, [[3, 300, 3], [3, 300, 0]]));
  assert.equal(half.basis, 'people', '3 of 6 is half, not more than half');
  assert.equal(half.uncounted, 3);
  const past = exitLoad(project, rowsOf(project, [[4, 100, 4], [2, 100, 0]]));
  assert.equal(past.basis, 'rooms', '4 of 6 is more than half');
  assert.equal(past.total, 6, 'the figure under the rooms basis is rooms');
  assert.equal(past.exits[0].share, 4 / 6);
  const none = exitLoad(project, rowsOf(project, [[0, 0, 0], [0, 0, 0]]));
  assert.equal(none.basis, 'people', 'no room with a way out: nothing to compare');
  assert.equal(none.total, 0);
  assert.equal(none.sentence, null);
  assert.deepEqual(none.exits.map((exit) => exit.share), [0, 0], 'share is 0 when the total is');
});

test('exitLoad: an exit no room uses is open and sets the even share', () => {
  const project = exitsOnly(['A', 'B', 'C']);
  const load = exitLoad(project, rowsOf(project, [[8, 200], [4, 100], [0, 0]]));
  assert.equal(load.open, 3);
  assert.equal(load.fair, 100);
  assert.deepEqual(load.heavy, [project.building.floors[0].exits[0].id], '200 is 2 times fair and 100 more: heavy');
  // the same people through two exits only: 200 of 300 is under 1.6 times 150
  const two = exitsOnly(['A', 'B']);
  assert.deepEqual(exitLoad(two, rowsOf(two, [[8, 200], [4, 100]])).heavy, [], 'without the unused exit the same rows are not heavy');
  const heavy = exitLoad(project, rowsOf(project, [[12, 300], [0, 0], [0, 0]]));
  assert.equal(heavy.heavy.length, 1, 'all of 300 through one of three exits: heavy');
  assert.equal(heavy.exits[1].share, 0);
});

test('exitLoad: a blocked exit is not open, never heavy, and left out of the even share', () => {
  const project = exitsOnly(['A', 'B', 'C']);
  const [a, b, c] = project.building.floors[0].exits.map((exit) => exit.id);
  const rows = rowsOf(project, [[8, 200], [8, 200], [0, 0]]);
  const free = exitLoad(project, rows);
  assert.equal(free.open, 3);
  assert.equal(free.fair, 400 / 3);
  const trial = exitLoad(project, rows, { blockedExits: [c] });
  assert.equal(trial.open, 2);
  assert.equal(trial.fair, 200);
  assert.deepEqual(trial.heavy, []);
  assert.deepEqual(trial.exits.map((exit) => exit.blocked), [false, false, true]);
  // the blocked exit itself, loaded as before the block, is still not heavy
  const loaded = exitLoad(project, rowsOf(project, [[2, 50], [2, 50], [12, 400]]), { blockedExits: [c] });
  assert.equal(loaded.exits[2].heavy, false, 'blocked, so never heavy');
  assert.deepEqual(loaded.heavy, []);
  // numbers do not move when one is blocked
  assert.deepEqual(trial.exits.map((exit) => exit.number), free.exits.map((exit) => exit.number));
  assert.deepEqual(free.exits.map((exit) => exit.exitId), [a, b, c]);
});

test('exitLoad, one exit: nothing is heavy and the sentence says it is the only exit', () => {
  const project = exitsOnly(['Door A']);
  const load = exitLoad(project, rowsOf(project, [[12, 600]]));
  assert.deepEqual(load.heavy, []);
  assert.equal(load.open, 1);
  assert.equal(load.sentence, 'Every room leaves by Door A: it is the only exit.');
  const unnamed = exitsOnly(['']);
  assert.equal(exitLoad(unnamed, rowsOf(unnamed, [[1, 30]])).sentence, 'Every room leaves by The exit on Floor 1: it is the only exit.');
});

test('exitLoad, one exit left open by a trial: says it is the only one not blocked', () => {
  const project = exitsOnly(['Door A', 'Door B']);
  const [, b] = project.building.floors[0].exits.map((exit) => exit.id);
  const load = exitLoad(project, rowsOf(project, [[0, 0], [12, 600]]), { blockedExits: [project.building.floors[0].exits[0].id] });
  assert.deepEqual(load.heavy, []);
  assert.equal(load.sentence, 'Every room leaves by Door B: it is the only exit not blocked.');
  assert.equal(b, load.exits[1].exitId);
});

test('exitLoad, no exit and every exit blocked: no sentence of its own, nothing heavy, nothing thrown', () => {
  const none = planProject([['.....', '.....', '#####', '.....', '.....']]);
  const load = exitLoad(none, []);
  assert.deepEqual({ exits: load.exits, open: load.open, total: load.total, heavy: load.heavy, sentence: load.sentence }, { exits: [], open: 0, total: 0, heavy: [], sentence: null });
  assert.equal(load.fair, 0);
  const project = exitsOnly(['A', 'B']);
  const ids = project.building.floors[0].exits.map((exit) => exit.id);
  const all = exitLoad(project, rowsOf(project, [[5, 100], [5, 100]]), { blockedExits: ids });
  assert.equal(all.open, 0);
  assert.equal(all.sentence, null);
  assert.deepEqual(all.heavy, []);
  assert.equal(all.fair, 0);
});

test('exitLoad: DESIGN 14.7 item 2\'s sentence, at full capacity, share and even share', () => {
  const project = exitsOnly(['Door A', 'Door B', 'Door C']);
  const load = exitLoad(project, rowsOf(project, [[14, 420], [6, 90], [4, 90]]));
  assert.equal(load.sentence, 'Door A (1) is the way out for rooms holding 420 of 600 people at full capacity, 70 %, where an even share of the 3 exits would be 200.');
  assert.deepEqual(load.exits.map((exit) => exit.heavy), [true, false, false]);
  assert.equal(load.exits[0].share, 0.7);
});

test('exitLoad: one sentence for each heavy exit, in the key\'s order, names as typed, an unnamed exit by its floor', () => {
  const project = exitsOnly(['', '<b>Tür</b> "2" & 日本', 'Small', 'Smaller', 'Smallest', 'Tiny']);
  // total 1200 over 6, fair 200: heavy needs 320 and 250
  const load = exitLoad(project, rowsOf(project, [[20, 400], [20, 400], [10, 100], [10, 100], [10, 100], [10, 100]]));
  assert.equal(load.heavy.length, 2);
  assert.equal(
    load.sentence,
    'The exit on Floor 1 (1) is the way out for rooms holding 400 of 1200 people at full capacity, 33 %, where an even share of the 6 exits would be 200. ' +
      '<b>Tür</b> "2" & 日本 (2) is the way out for rooms holding 400 of 1200 people at full capacity, 33 %, where an even share of the 6 exits would be 200.',
  );
});

test('exitLoad on the rooms basis words the figure as rooms, not people', () => {
  const project = exitsOnly(['Door A', 'Door B']);
  const load = exitLoad(project, rowsOf(project, [[16, 0, 16], [2, 0, 2]]));
  assert.equal(load.basis, 'rooms');
  assert.equal(load.sentence, 'Door A (1) is the way out for 16 of 18 rooms, 89 %, where an even share of the 2 exits would be 9.');
  assert.ok(!load.sentence.includes('capacity'));
});

test('exitLoad skips a row whose exit has gone and never throws on odd input', () => {
  const project = exitsOnly(['Door A', 'Door B']);
  const rows = rowsOf(project, [[2, 50], [2, 50]]);
  rows.push({ exitId: 'xgone', floorId: floorId(1), rooms: 99, people: 999, uncounted: 0 });
  const load = exitLoad(project, rows);
  assert.equal(load.exits.length, 2);
  assert.equal(load.total, 100, 'the gone exit adds nothing');
  assert.doesNotThrow(() => exitLoad(project, undefined));
  assert.doesNotThrow(() => exitLoad(project, [null, undefined, {}]));
  assert.equal(exitLoad(project, [null]).exits.length, 0);
});

test('exitLoad is deterministic: the same rows give the same object', () => {
  const project = exitsOnly(['A', 'B', 'C']);
  const rows = rowsOf(project, [[14, 420], [6, 90], [4, 90]]);
  assert.deepEqual(exitLoad(project, rows), exitLoad(project, rows));
  assert.equal(JSON.stringify(exitLoad(project, rows)), JSON.stringify(exitLoad(project, rows)));
});

test('exitLoad on the sample: its real rows work through byExit', () => {
  const project = sampleSchool();
  const rows = byExit(project, evacuationRoutes(project, buildGraph(project)));
  const load = exitLoad(project, rows);
  assert.equal(load.exits.length, 2);
  assert.equal(load.total + 0, rows.reduce((sum, row) => sum + (load.basis === 'rooms' ? row.rooms : row.people), 0));
  assert.equal(load.open, 2);
});

// Two named corridors that overlap one room, a room on neither, a floor with an unnamed corridor.
function corridorsProject() {
  const first = ['AACCCCBB', 'AACCCCBB', '########', '........', '........'];
  const second = ['DD......', 'DD......', '########', '........', '.EE.....'];
  const project = planProject([first, second], { doors: { '1A': [[1, 1, 's']], '1C': [[3, 1, 's'], [4, 1, 's']], '1B': [[7, 1, 's']], '2D': [[0, 1, 's']] }, exits: [[1, 0, 2, 'Door']] });
  const one = project.building.floors[0];
  one.corridors.push({ id: 'kwest', name: 'West Corridor', cells: [16, 17, 18, 19] });
  one.corridors.push({ id: 'keast', name: 'East Corridor', cells: [20, 21, 22, 23] });
  const two = project.building.floors[1];
  two.corridors.push({ id: 'kloose', name: '', cells: [16, 17, 18, 19, 20, 21, 22, 23] });
  return project;
}

test('corridorRooms: a room belongs to a corridor by its door entries, a room opening onto two belongs to both', () => {
  const project = corridorsProject();
  const graph = buildGraph(project);
  assert.deepEqual(corridorRooms(project, graph, 'kwest'), [roomId('1A'), roomId('1C')]);
  assert.deepEqual(corridorRooms(project, graph, 'keast'), [roomId('1B'), roomId('1C')], 'room 1C is across both corridors: it has a door onto each');
  // an unnamed corridor still has its rooms: the name is a matter for roomsOnNoNamedCorridor
  assert.deepEqual(corridorRooms(project, graph, 'kloose'), [roomId('2D')]);
  assert.deepEqual(corridorRooms(project, graph, 'kgone'), []);
  // the same graph as a routing graph gives the same answer
  assert.deepEqual(corridorRooms(project, routingGraph(project, graph), 'kwest'), [roomId('1A'), roomId('1C')]);
});

test('corridorRooms: a corridor of another floor does not count a room by its cell number', () => {
  const project = corridorsProject();
  // floor 2's corridor cells are the same indexes as floor 1's: rooms 1A and 1C must not be on it
  assert.ok(!corridorRooms(project, buildGraph(project), 'kloose').includes(roomId('1A')));
});

test('roomsOnNoNamedCorridor: rooms on no corridor with a name, in building order', () => {
  const project = corridorsProject();
  const graph = buildGraph(project);
  // 2D is on an unnamed corridor, 2E is two rows below the corridor, with no door
  assert.deepEqual(roomsOnNoNamedCorridor(project, graph), [roomId('2D'), roomId('2E')]);
  project.building.floors[1].corridors[0].name = 'Upper Corridor';
  assert.deepEqual(roomsOnNoNamedCorridor(project, graph), [roomId('2E')], 'naming the corridor moves its rooms off the list');
});

test('roomsOnNoNamedCorridor: every room when no corridor has a name, none for a building without rooms', () => {
  const project = corridorsProject();
  for (const floor of project.building.floors) for (const corridor of floor.corridors) corridor.name = '';
  assert.equal(roomsOnNoNamedCorridor(project, buildGraph(project)).length, 5);
  const empty = exitsOnly(['A']);
  assert.deepEqual(roomsOnNoNamedCorridor(empty, buildGraph(empty)), []);
});
