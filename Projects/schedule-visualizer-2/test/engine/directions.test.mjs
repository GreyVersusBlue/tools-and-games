// Written directions: numbered steps relative to the walker, with rooms
// passed, stairs by letter and floor, and every typed name exactly as typed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { route, routeToExit, routingGraph } from '../../engine/routing.js';
import * as directionsModule from '../../engine/directions.js';
import { directions, describeFailure, CELL_UNITS } from '../../engine/directions.js';
import { school } from './helpers.mjs';
import { planProject, twoRooms, threeFloors, disconnectedWing, roomId, cellAt } from '../fixtures/buildings/plans.mjs';
import { publishedModel } from '../../engine/publish-data.js';
import { openSchool } from '../../staff/model.js';
import { directionsRefusal } from '../../staff/views/directions.js';

// An L-shaped walk with a floor change. From room 1A: left out of the room
// and east along the corridor past room 1C, right at the corner, south to
// the stairs, up, then west to room 2B, which is on the north side.
function lShape(options) {
  return planProject([
    ['A......', '######.', '..C.#..', '....#..', '....S..'],
    ['.......', '.......', '.......', '..B....', '..##S..'],
  ], { connections: [[1, 4, 4, 2, 4, 4]], ...options });
}

function walk(project, from, to, units) {
  return directions(project, route(routingGraph(project), roomId(from), roomId(to)), units);
}

function lines(result) {
  return result.steps.map((step) => step.text);
}

test('an L-shaped walk with a floor change: left and right as the walker faces, the room passed, the stairs by letter and floor', () => {
  const result = walk(lShape(), '1A', '2B');
  assert.equal(result.ok, true);
  assert.deepEqual(lines(result), [
    'Turn left out of the room.',
    'Walk 4 cells, past Room 1C.',
    'Turn right.',
    'Walk 3 cells to stairs A.',
    'Take stairs A up to Floor 2.',
    'Walk 2 cells to the end of the corridor.',
    'Room 2B is on your right.',
  ]);
  assert.deepEqual(result.steps.map((step) => step.n), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(result.steps.map((step) => step.kind), ['leave', 'walk', 'turn', 'walk', 'stairs', 'walk', 'arrive']);
  assert.equal(result.text, lines(result).map((line, index) => (index + 1) + '. ' + line).join('\n'));
});

test('the same walk the other way turns the other way and goes down', () => {
  assert.deepEqual(lines(walk(lShape(), '2B', '1A')), [
    'Turn left out of the room.',
    'Walk 2 cells to stairs A.',
    'Take stairs A down to Floor 1.',
    'Walk 3 cells to the end of the corridor.',
    'Turn left.',
    'Walk 4 cells to the end of the corridor.',
    'Room 1A is on your right.',
  ]);
});

test('each step says what it is in data as well as in words', () => {
  const project = lShape();
  const [leave, along, turn, toStairs, stairs, , arrive] = walk(project, '1A', '2B').steps;
  assert.equal(leave.turn, 'left');
  assert.deepEqual([along.cells, along.distance, along.to, along.landmarkId], [4, '4 cells', null, roomId('1C')]);
  assert.equal(turn.turn, 'right');
  assert.deepEqual([toStairs.cells, toStairs.to], [3, 'stairs']);
  assert.deepEqual([stairs.connections, stairs.labels, stairs.way, stairs.floorId], [['cplan00001'], ['A'], 'up', project.building.floors[1].id]);
  assert.deepEqual([arrive.side, arrive.roomId], ['right', roomId('2B')]);
});

test('a right-to-left room number is in the step exactly as typed, with nothing added around it', () => {
  const hebrew = 'חדר מוזיקה'; // a room named in words, right to left
  const digits = '١٠٤'; // a room number in Arabic-Indic digits
  const project = lShape({ numbers: { '2B': hebrew, '1C': digits } });
  const result = walk(project, '1A', '2B');
  const arrive = result.steps[result.steps.length - 1];
  assert.equal(arrive.text, hebrew + ' is on your right.');
  assert.deepEqual(arrive.parts, [{ text: hebrew, name: true }, { text: ' is on your right.', name: false }]);
  assert.equal(result.steps[1].text, 'Walk 4 cells, past Room ' + digits + '.');
  assert.deepEqual(result.steps[1].parts, [{ text: 'Walk 4 cells', name: false }, { text: ', past ', name: false }, { text: 'Room ', name: false }, { text: digits, name: true }, { text: '.', name: false }]);
  for (const step of result.steps) {
    assert.equal(step.text, step.parts.map((part) => part.text).join(''), 'the text is the parts and nothing else');
    assert.doesNotMatch(step.text, /[‎‏‪-‮⁦-⁩]/, 'no direction marks are slipped in');
  }
  assert.equal(describeFailure(project, { ok: false, reason: 'no-entry', roomId: roomId('2B'), floorId: project.building.floors[1].id, end: 'to' }), hebrew + ' on Floor 2 does not open onto a corridor.');
});

test('a name that looks like markup is words, as typed: a room, a corridor, a floor, a stairs letter and a door', () => {
  const tag = '<img src=x onerror="alert(1)">';
  const project = lShape({ numbers: { '2B': tag + ' 7', '1C': '</script>' }, exits: [[1, 5, 1, tag]] });
  const ground = project.building.floors[0];
  ground.corridors.push({ id: 'kplan00001', name: '"Hall" & <b>', cells: [0, 1, 2, 3, 4, 5].map((x) => cellAt(project, 1, x, 1)) });
  project.building.floors[1].name = '<Floor & "2">';
  project.building.connections[0].label = '<A>';
  assert.deepEqual(lines(walk(project, '1A', '2B')), [
    'Turn left out of the room.',
    'Walk 4 cells along "Hall" & <b>, past </script>.',
    'Turn right.',
    'Walk 3 cells to stairs <A>.',
    'Take stairs <A> up to <Floor & "2">.',
    'Walk 2 cells to the end of the corridor.',
    tag + ' 7 is on your right.',
  ]);
  const out = directions(project, routeToExit(routingGraph(project), roomId('1A')));
  assert.equal(out.steps[out.steps.length - 1].text, 'Exit at ' + tag + '.');
  assert.deepEqual(out.steps[out.steps.length - 1].parts[1], { text: tag, name: true });
});

test('units: distances are in cells unless a scale is passed', () => {
  assert.deepEqual(CELL_UNITS, { perCell: 1, one: 'cell', many: 'cells' });
  const project = lShape();
  const metres = walk(project, '1A', '2B', { perCell: 2, one: 'metre', many: 'metres' });
  assert.deepEqual(lines(metres).filter((line) => line.startsWith('Walk')), ['Walk 8 metres, past Room 1C.', 'Walk 6 metres to stairs A.', 'Walk 4 metres to the end of the corridor.']);
  assert.deepEqual([metres.steps[1].cells, metres.steps[1].distance], [4, '8 metres']);
  const paces = walk(threeFloors(), '1A', '2A', { perCell: 0.5, one: 'pace', many: 'paces' });
  assert.equal(paces.steps[1].text, 'Walk 1 pace to stairs A.', 'a distance is never less than one');
  assert.deepEqual(lines(walk(project, '1A', '2B', { perCell: 0 })), lines(walk(project, '1A', '2B')), 'a scale that is no scale falls back to cells');
});

test('for a reader a distance is in cells, spec 2\'s one word for a square of the grid: "Walk 4 cells", "Walk 1 cell" (SV2-32f)', () => {
  assert.equal(directionsModule.SQUARE_UNITS, undefined, 'a second word for a cell is offered again');
  const cells = walk(lShape(), '1A', '2B', CELL_UNITS);
  assert.deepEqual(lines(cells).filter((line) => line.startsWith('Walk')), ['Walk 4 cells, past Room 1C.', 'Walk 3 cells to stairs A.', 'Walk 2 cells to the end of the corridor.']);
  assert.deepEqual([cells.steps[1].cells, cells.steps[1].distance], [4, '4 cells'], 'the count of cells is the step\'s own figure');
  assert.equal(walk(threeFloors(), '1A', '2A', CELL_UNITS).steps[1].text, 'Walk 1 cell to stairs A.');
  for (const line of lines(cells)) assert.doesNotMatch(line, /square/, line);
});

test('a way with no stairs that does not exist between two rooms is said plainly, and every other failure keeps its own sentence', () => {
  const floors = threeFloors();
  const graph = routingGraph(floors);
  const refused = route(graph, roomId('1A'), roomId('2B'), { avoidStairs: true });
  assert.deepEqual(directions(floors, refused), { ok: false, steps: [], text: 'There is no way from Room 1A to Room 2B without stairs.' });
  assert.deepEqual(directions(floors, refused, CELL_UNITS).text, 'There is no way from Room 1A to Room 2B without stairs.');
  // with stairs allowed there is a way, so nothing is refused
  assert.equal(directions(floors, route(graph, roomId('1A'), roomId('2B'))).ok, true);
  // no way at all, stairs or not: the engine's sentence, with the floor
  const wing = disconnectedWing();
  assert.equal(directions(wing, route(routingGraph(wing), roomId('1A'), roomId('1C'))).text, 'There is no way through from Room 1A to Room 1C on Floor 1.');
  // something else was avoided as well: not this sentence
  assert.equal(directions(floors, { ...refused, avoiding: ['stairs', 'corridor'] }).text, describeFailure(floors, { ...refused, avoiding: ['stairs', 'corridor'] }));
  // a way out of the building is not between two rooms
  assert.equal(directions(floors, { ...refused, end: 'from' }).text, describeFailure(floors, { ...refused, end: 'from' }));
  // a room that has gone
  assert.equal(directions(floors, { ...refused, fromRoomId: 'rgone000001' }).text, describeFailure(floors, { ...refused, fromRoomId: 'rgone000001' }));
});

test('a three-floor stairwell is one step naming both connections', () => {
  const project = threeFloors();
  assert.deepEqual(lines(walk(project, '1A', '3B')), [
    'Turn right out of the room.',
    'Walk 1 cell to stairs A.',
    'Take stairs A, then stairs B up to Floor 3.',
    'Walk 4 cells.',
    'Room 3B is on your left.',
  ]);
  const stairs = walk(project, '3B', '1A').steps.find((step) => step.kind === 'stairs');
  assert.equal(stairs.text, 'Take stairs B, then stairs A down to Floor 1.');
  assert.deepEqual(stairs.labels, ['B', 'A']);
});

test('stairs between two parts of one floor are named without a floor', () => {
  const project = planProject([['.AA....BB.', '.AA....BB.', '###S..S###']], { connections: [[1, 3, 2, 1, 6, 2]] });
  const stairs = walk(project, '1A', '1B').steps.find((step) => step.kind === 'stairs');
  assert.equal(stairs.text, 'Take stairs A.');
  assert.equal(stairs.way, null);
});

test('one cell between two rooms: out of the door and straight across', () => {
  const project = twoRooms();
  assert.deepEqual(lines(walk(project, '1A', '1B')), ['Go out of the door.', 'Room 1B is straight across the corridor.']);
  assert.deepEqual(lines(walk(project, '1B', '1A')), ['Go out of the room.', 'Room 1A is straight across the corridor.'], 'room 1B has no door drawn, so no door is claimed');
});

test('a room straight ahead, a room by the stairs, and a walk straight out of the door', () => {
  const ahead = planProject([['A###B']]);
  assert.deepEqual(lines(walk(ahead, '1A', '1B')), ['Go straight out of the room.', 'Walk 2 cells to the end of the corridor.', 'Room 1B is straight ahead.']);
  const landing = planProject([
    ['.....', 'A....', 'S....'],
    ['.....', 'B....', 'S....'],
  ], { doors: { '1A': [[0, 1, 's']], '2B': [[0, 1, 's']] }, connections: [[1, 0, 2, 2, 0, 2]] });
  assert.deepEqual(lines(walk(landing, '1A', '2B')), ['Go out of the door.', 'Take stairs A up to Floor 2.', 'Room 2B is by the stairs.']);
});

test('off a landing that leads more than one way, the walk is given a room to head towards', () => {
  const project = planProject([
    ['.....', 'A....', 'S....'],
    ['.C.B.', '.C.B.', '##S##'],
  ], { doors: { '1A': [[0, 1, 's']] }, connections: [[1, 0, 2, 2, 2, 2]] });
  const east = walk(project, '1A', '2B');
  assert.deepEqual(lines(east), ['Go out of the door.', 'Take stairs A up to Floor 2.', 'Walk 1 cell.', 'Room 2B is on your left.']);
  // two cells east of the landing, past room B's near edge: now there is something to head towards
  const wider = planProject([
    ['.....', 'A....', 'S....'],
    ['C.D.B', 'C.D.B', '##S##'],
  ], { doors: { '1A': [[0, 1, 's']] }, connections: [[1, 0, 2, 2, 2, 2]] });
  assert.deepEqual(lines(walk(wider, '1A', '2B')), ['Go out of the door.', 'Take stairs A up to Floor 2.', 'Walk 2 cells to the end of the corridor, towards Room 2D.', 'Room 2B is on your left.']);
});

test('a walk along a named corridor says so, and other spaces with a label are landmarks too', () => {
  const project = school();
  const graph = routingGraph(project);
  assert.deepEqual(lines(directions(project, route(graph, 'rsamplegym', 'rsample303'))), [
    'Turn right out of the door.',
    'Walk 24 cells along Main Corridor, past Room 103.',
    'Turn left.',
    'Walk 1 cell to stairs A.',
    'Take stairs A up to Floor 2.',
    'Walk 1 cell.',
    'Turn right.',
    'Walk 21 cells along Upper Corridor, past Library.',
    'Turn right.',
    'Walk 1 cell to stairs B.',
    'Take stairs B up to Floor 3.',
    'Walk 1 cell.',
    'Turn left.',
    'Walk 29 cells, past Instrument Store.',
    'Room 303 is on your right.',
  ]);
});

test('to an exit: the last step is the door by name, or the exit when it has none', () => {
  const project = school();
  const graph = routingGraph(project);
  const out = directions(project, routeToExit(graph, 'rsample101'));
  assert.deepEqual(lines(out), [
    'Turn left out of the door.',
    'Walk 17 cells along Main Corridor, past Cafeteria.',
    'Turn right.',
    'Walk 6 cells along Front Hall to the end of the corridor.',
    'Exit at Door A.',
  ]);
  assert.deepEqual([out.steps[4].kind, out.steps[4].exitId], ['exit', 'xsample00a']);
  project.building.floors[0].exits[0].doorName = '';
  assert.equal(directions(project, routeToExit(graph, 'rsample101')).steps[4].text, 'Leave the building by the exit here.');
});

test('the same room, and each named failure, as a sentence that names the room and the floor', () => {
  const project = disconnectedWing();
  const graph = routingGraph(project);
  const same = directions(project, route(graph, roomId('1A'), roomId('1A')));
  assert.deepEqual([same.ok, same.steps.length, same.steps[0].kind, same.text], [true, 1, 'same', 'This is the same room. There is no travel.']);

  const unreachable = directions(project, route(graph, roomId('1A'), roomId('1C')));
  assert.deepEqual(unreachable, { ok: false, steps: [], text: 'There is no way through from Room 1A to Room 1C on Floor 1.' });
  assert.equal(describeFailure(project, route(graph, null, roomId('1A'))), 'No room is set for this period.');
  assert.equal(describeFailure(project, route(graph, roomId('1A'), 'rnowhere00')), 'The room is not in the building.');
  assert.equal(describeFailure(project, { ok: false, reason: 'room-missing', roomId: null, floorId: null, end: 'to', text: '999' }), 'Room 999 is not in the building.');

  const shut = planProject([['.A.....', '####...', '.....C.']]);
  assert.equal(describeFailure(shut, route(routingGraph(shut), roomId('1A'), roomId('1C'))), 'Room 1C on Floor 1 does not open onto a corridor.');

  const floors = threeFloors();
  assert.equal(describeFailure(floors, route(routingGraph(floors), roomId('1A'), roomId('2B'), { avoidStairs: true })), 'There is no step-free way through from Room 1A to Room 2B on Floor 2.');
  assert.equal(describeFailure(floors, routeToExit(routingGraph(floors), roomId('3A'), { avoidExits: ['xplan00001'] })), 'There is no way through from Room 3A on Floor 3 to an exit.');
  assert.equal(directions(floors, null).ok, false);
});

// SV2-49 item 5. The engine words a step-free refusal as "no way ... without
// stairs" whenever stairs were being avoided, which on a wing no corridor
// reaches promises a way that does not exist. The staff browser's page looks
// once more with stairs allowed before it says so or offers that way.
test('step-free with no way at all: the reader is told there is no way, and the way with stairs is offered only where there is one', () => {
  const clock = () => new Date('2026-09-01T12:00:00Z');
  const wing = disconnectedWing();
  const opened = openSchool(publishedModel(wing, { clock }));
  // what the engine says for the route as asked, and why the page cannot stop there
  assert.equal(opened.directions(opened.route(roomId('1A'), roomId('1C'), { avoidStairs: true })).text, 'There is no way from Room 1A to Room 1C without stairs.');
  assert.equal(opened.route(roomId('1A'), roomId('1C')).ok, false, 'and there is none with stairs either: one floor, two corridors that do not meet');

  assert.deepEqual(directionsRefusal(opened, roomId('1A'), roomId('1C'), true), { text: 'There is no way through from Room 1A to Room 1C on Floor 1.', stairs: false });
  assert.deepEqual(directionsRefusal(opened, roomId('1A'), roomId('1C'), false), { text: 'There is no way through from Room 1A to Room 1C on Floor 1.', stairs: false });
  assert.equal(directionsRefusal(opened, roomId('1A'), roomId('1B'), true), null, 'a way that exists is no refusal');

  // where stairs are the only way, the plain sentence stands and the way with stairs is offered
  const floors = openSchool(publishedModel(threeFloors(), { clock }));
  assert.deepEqual(directionsRefusal(floors, roomId('1A'), roomId('2B'), true), { text: 'There is no way from Room 1A to Room 2B without stairs.', stairs: true });
  assert.equal(directionsRefusal(floors, roomId('1A'), roomId('2B'), false), null);
});

test('every route of the sample school can be written out: numbered from 1, a way out first and the room last', () => {
  const project = school();
  const graph = routingGraph(project);
  const rooms = Array.from(graph.rooms.keys());
  let written = 0;
  for (const from of rooms) {
    for (const to of rooms) {
      if (from === to) continue;
      const found = route(graph, from, to);
      const result = directions(project, found);
      assert.equal(result.ok, true);
      assert.equal(result.steps[0].kind, 'leave');
      assert.equal(result.steps[result.steps.length - 1].kind, 'arrive');
      result.steps.forEach((step, index) => {
        assert.equal(step.n, index + 1);
        assert.equal(step.text, step.parts.map((part) => part.text).join(''));
        assert.match(step.text, /\.$/);
      });
      const walked = result.steps.filter((step) => step.kind === 'walk').reduce((sum, step) => sum + step.cells, 0);
      assert.equal(walked, found.cells.length - 1 - found.connections.length, from + ' to ' + to + ': the walks add up to the steps between the cells');
      assert.equal(result.steps.filter((step) => step.kind === 'stairs').reduce((sum, step) => sum + step.connections.length, 0), found.connections.length);
      written += 1;
    }
  }
  assert.equal(written, 13 * 12);
});

// ---------------------------------------------------------------- SV2-43: does a failure's sentence open with what was typed?
// (The import stands here so that the lines above are left as they were for
// the unit changing two of the sentences beside this one.)
import { startsAsTyped } from '../../engine/directions.js';

test('startsAsTyped: true where describeFailure’s sentence opens with a room as it was typed, false where it opens with a word of the tool’s own', () => {
  const project = planProject([['.A.....', '####...', '.....C.']]);
  const floor = project.building.floors[0].id;
  const cases = [
    [{ ok: false, reason: 'no-room', roomId: null, floorId: null, end: 'to' }, false, 'No room'],
    [{ ok: false, reason: 'room-missing', roomId: null, floorId: null, end: 'to', text: '' }, false, 'The room'],
    [{ ok: false, reason: 'room-missing', roomId: null, floorId: null, end: 'to', text: '   ' }, false, 'The room'],
    [{ ok: false, reason: 'room-missing', roomId: null, floorId: null, end: 'to' }, false, 'The room'],
    [{ ok: false, reason: 'room-missing', roomId: null, floorId: null, end: 'to', text: '999' }, true, 'Room 999'],
    [{ ok: false, reason: 'room-missing', roomId: null, floorId: null, end: 'to', text: 'the annex' }, true, 'the annex'],
    [{ ok: false, reason: 'no-entry', roomId: roomId('1C'), floorId: floor, end: 'to' }, true, 'Room 1C'],
    [{ ok: false, reason: 'no-entry', roomId: 'rgone00001', floorId: floor, end: 'to' }, false, 'The room'],
    [{ ok: false, reason: 'unreachable', roomId: roomId('1C'), floorId: floor, end: 'to', fromRoomId: roomId('1A') }, false, 'There is'],
    [{ ok: false, reason: 'unreachable', roomId: roomId('1A'), floorId: floor, end: 'from' }, false, 'There is'],
  ];
  for (const [failed, typed, opens] of cases) {
    const sentence = describeFailure(project, failed);
    assert.ok(sentence.startsWith(opens), JSON.stringify(failed) + ' reads ' + sentence);
    assert.equal(startsAsTyped(project, failed), typed, sentence);
  }
  // a room whose number is blank is named in the tool's words; the same words typed as its number are its name
  const room = project.building.floors[0].spaces.find((space) => space.id === roomId('1C'));
  room.number = ' ';
  assert.equal(describeFailure(project, cases[6][0]), 'A room with no number on Floor 1 does not open onto a corridor.');
  assert.equal(startsAsTyped(project, cases[6][0]), false);
  room.number = 'A room with no number';
  assert.equal(describeFailure(project, cases[6][0]), 'A room with no number on Floor 1 does not open onto a corridor.');
  assert.equal(startsAsTyped(project, cases[6][0]), true);
  // nothing to describe
  assert.equal(startsAsTyped(project, null), false);
});

// ---------------------------------------------------------------- SV2-100: rides and the step-free failure words

// Joins stops with elevator connections by hand: cars is [{ stops: [[floor, x, y], …], letter, staffOnly }], a chain.
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
  return project;
}

const HALL = ['.AA.BB.', '.AA.BB.', '#######', '.......', '.......'];

test('a ride is a step of its own, read from the route\'s cells: "Take Elevator D up to Floor 3", with the car\'s letter, never a connection\'s label', () => {
  // a chain 1-2, 2-3: the car's id is the first connection's, whose ends are floors 1 and 2, yet the ride is to floor 3
  const project = withCars(planProject([HALL, HALL, HALL]), [{ stops: [[1, 0, 2], [2, 0, 2], [3, 0, 2]], letter: 'D' }]);
  const graph = routingGraph(project);
  const up = directions(project, route(graph, roomId('1A'), roomId('3B'), { avoidStairs: true }));
  assert.equal(up.ok, true);
  assert.deepEqual(lines(up), ['Turn right out of the room.', 'Walk 1 cell to Elevator D.', 'Take Elevator D up to Floor 3.', 'Walk 4 cells.', 'Room 3B is on your left.']);
  const ride = up.steps.find((step) => step.kind === 'ride');
  assert.deepEqual([ride.car, ride.way, ride.floorId, ride.connections], ['D', 'up', project.building.floors[2].id, [project.building.connections[0].id]]);
  assert.deepEqual(up.steps.find((step) => step.kind === 'walk').to, 'elevator');
  const down = directions(project, route(graph, roomId('3B'), roomId('2A'), { avoidStairs: true }));
  assert.ok(lines(down).includes('Take Elevator D down to Floor 2.'), lines(down).join(' | '));
  // the letter is typed text, shown as typed and never as markup
  project.building.connections.forEach((connection) => { connection.car = '<D&>'; });
  const typedCar = directions(project, route(routingGraph(project), roomId('1A'), roomId('2B'), { avoidStairs: true }));
  assert.ok(lines(typedCar).includes('Take Elevator <D&> up to Floor 2.'));
  assert.deepEqual(typedCar.steps.find((step) => step.kind === 'ride').parts.filter((part) => part.name).map((part) => part.text), ['<D&>', 'Floor 2']);
});

test('a room by the elevator, and stairs then a ride, are steps of their own', () => {
  const floor = ['.AA.BB.', '.AA.BB.', 'S######', '.......', '.......'];
  const project = withCars(planProject([floor, floor, floor], { connections: [[1, 0, 2, 2, 0, 2]] }), [{ stops: [[2, 6, 2], [3, 6, 2]], letter: 'E' }]);
  const stairsThenRide = directions(project, route(routingGraph(project), roomId('1A'), roomId('3B')));
  assert.deepEqual(stairsThenRide.steps.map((step) => step.kind), ['leave', 'walk', 'stairs', 'walk', 'ride', 'walk', 'arrive']);
  assert.ok(lines(stairsThenRide).includes('Take stairs A up to Floor 2.'));
  assert.ok(lines(stairsThenRide).includes('Take Elevator E up to Floor 3.'));
  const landing = planProject([['A.B..', '#S###'], ['A.B..', '#S###']]);
  withCars(landing, [{ stops: [[1, 1, 1], [2, 1, 1]], letter: 'D' }]);
  const by = directions(landing, route(routingGraph(landing), roomId('1A'), roomId('2B')));
  assert.equal(by.ok, true);
  assert.ok(lines(by).includes('Take Elevator D up to Floor 2.'), lines(by).join(' | '));
});

test('the step-free failure words: a room with no step-free door, a step on a named corridor, a step on a floor', () => {
  // every door of 1A has a step
  const doors = planProject([['.AAAA.', '.AAAA.', '######', '.BBBB.', '.BBBB.']], { doors: { '1A': [[1, 1, 's'], [4, 1, 's']], '1B': [[2, 3, 'n']] } });
  const roomA = doors.building.floors[0].spaces.find((space) => space.number === '1A');
  roomA.doors.forEach((door) => { door.stepFree = false; });
  const doorFailure = route(routingGraph(doors), roomId('1A'), roomId('1B'), { avoidStairs: true });
  assert.deepEqual([doorFailure.reason, doorFailure.avoiding], ['no-entry', ['stairs', 'step-doors']]);
  assert.equal(describeFailure(doors, doorFailure), 'Room 1A on Floor 1 has no step-free door.');
  assert.equal(directions(doors, doorFailure).text, 'Room 1A on Floor 1 has no step-free door.');
  assert.equal(startsAsTypedFor(doors, doorFailure), true, 'it opens with the room as typed');
  // the same words are not said of a room that has no door onto a corridor at all
  const shut = planProject([['.A.....', '####...', '.....C.']]);
  shut.building.floors[0].notStepFree = [cellAt(shut, 1, 0, 1)];
  assert.equal(describeFailure(shut, route(routingGraph(shut), roomId('1A'), roomId('1C'), { avoidStairs: true })), 'Room 1C on Floor 1 does not open onto a corridor.');

  // a step across the only corridor, named
  const steps = planProject([['A...B', '#####', '.....']]);
  const floor = steps.building.floors[0];
  floor.notStepFree = [cellAt(steps, 1, 2, 1)];
  floor.corridors = [{ id: 'kplan00001', name: 'North Corridor', cells: [5, 6, 7, 8, 9] }];
  const blocked = route(routingGraph(steps), roomId('1A'), roomId('1B'), { avoidStairs: true });
  assert.deepEqual([blocked.reason, blocked.avoiding], ['unreachable', ['stairs', 'steps']]);
  assert.equal(describeFailure(steps, blocked), 'There is no step-free way through from Room 1A to Room 1B on Floor 1: a step on North Corridor.');
  assert.equal(directions(steps, blocked).text, describeFailure(steps, blocked), 'with steps in the way the plain "without stairs" sentence is not used');
  // an unnamed corridor: the floor
  floor.corridors = [];
  assert.equal(describeFailure(steps, blocked), 'There is no step-free way through from Room 1A to Room 1B on Floor 1: a step on Floor 1.');
  // a route to an exit
  const exitFailure = { ...blocked, end: 'from', roomId: roomId('1A'), fromRoomId: roomId('1A'), toRoomId: null };
  assert.equal(describeFailure(steps, exitFailure), 'There is no step-free way through from Room 1A on Floor 1 to an exit: a step on Floor 1.');
  // a step-free failure with no step marked in the building keeps today's sentence
  const bare = threeFloors();
  assert.equal(directions(bare, route(routingGraph(bare), roomId('1A'), roomId('2B'), { avoidStairs: true })).text, 'There is no way from Room 1A to Room 2B without stairs.');
});

function startsAsTypedFor(project, failed) {
  return directionsModule.startsAsTyped(project, failed);
}

test('a failure that says why: a staff-only car is the only way, every exit has a step; neither is worded as something the reader asked to avoid', () => {
  const project = withCars(planProject([HALL, HALL, HALL]), [{ stops: [[1, 0, 2], [2, 0, 2]], letter: 'D', staffOnly: true }, { stops: [[2, 6, 2], [3, 6, 2]], letter: 'E', staffOnly: true }]);
  const failed = { ok: false, reason: 'unreachable', roomId: roomId('2B'), floorId: project.building.floors[1].id, end: 'to', fromRoomId: roomId('1A'), toRoomId: roomId('2B'), avoiding: ['staff-only'] };
  // routing names the cars the way is by (staffOnlyCars); a failure without them names none (SV2-100b)
  failed.staffOnlyCars = project.building.connections.map((connection) => connection.id);
  assert.equal(describeFailure(project, failed), 'There is no way through from Room 1A to Room 2B on Floor 2: the only way is by Elevator D and Elevator E, which are staff and authorised only.');
  project.building.connections.splice(1, 1); // Elevator E is gone
  assert.equal(describeFailure(project, failed), 'There is no way through from Room 1A to Room 2B on Floor 2: the only way is by Elevator D, which is staff and authorised only.');
  assert.equal(directions(project, failed).text, describeFailure(project, failed));
  // step-free keeps its own word beside it
  assert.match(describeFailure(project, { ...failed, avoiding: ['stairs', 'staff-only'] }), /^There is no step-free way through from Room 1A to Room 2B on Floor 2: the only way/);
  // a route to an exit with every exit stepped
  const exit = { ok: false, reason: 'unreachable', roomId: roomId('1A'), floorId: project.building.floors[0].id, end: 'from', fromRoomId: roomId('1A'), avoiding: ['stairs', 'step-exits'] };
  assert.equal(describeFailure(project, exit), 'There is no step-free way through from Room 1A on Floor 1 to an exit: every exit has a step.');
  assert.equal(describeFailure(project, { ...exit, avoiding: ['connections'] }), 'There is no way through that keeps to what you asked to avoid from Room 1A on Floor 1 to an exit.', 'what the reader asked for is still said');
});

// ---------------------------------------------------------------- SV2-100b: a step is named only when it is the cause

const STAIRS_ONLY = ['.AA.BB.', '.AA.BB.', 'S######', '......#', '.......'];

test('a step on a dead-end cell is not blamed where the cause is no elevator; a step that blocks is, and routing says which (stepBlocked)', () => {
  // two floors joined by stairs only; one step on a corner of Floor 1 that nobody needs
  const project = planProject([STAIRS_ONLY, STAIRS_ONLY], { exits: [[1, 6, 2, 'Main Door']], connections: [[1, 0, 2, 2, 0, 2]] });
  project.building.floors[0].notStepFree = [cellAt(project, 1, 6, 3)];
  const failed = route(routingGraph(project), roomId('1A'), roomId('2B'), { avoidStairs: true });
  assert.deepEqual([failed.reason, failed.avoiding, failed.stepBlocked], ['unreachable', ['stairs', 'steps'], undefined]);
  assert.equal(describeFailure(project, failed), 'There is no step-free way through from Room 1A to Room 2B on Floor 2.');
  // a step across the only corridor on one floor is the cause
  const steps = planProject([['A...B', '#####', '.....']]);
  steps.building.floors[0].notStepFree = [cellAt(steps, 1, 2, 1)];
  const blocked = route(routingGraph(steps), roomId('1A'), roomId('1B'), { avoidStairs: true });
  assert.equal(blocked.stepBlocked, true);
  assert.match(describeFailure(steps, blocked), /: a step on Floor 1\.$/);
  // and the same failure from routing without the mark names no step
  const { stepBlocked, ...unmarked } = blocked;
  assert.doesNotMatch(describeFailure(steps, unmarked), /step on/);
  // a success carries nothing extra
  assert.equal(route(routingGraph(project), roomId('1A'), roomId('1B'), { avoidStairs: true }).stepBlocked, undefined);
  // a room whose only door has a step: the "no step-free door" words need the step to be the cause
  const doors = planProject([['.AAAA.', '.AAAA.', '######', '.BBBB.', '.BBBB.']], { doors: { '1A': [[1, 1, 's']], '1B': [[2, 3, 'n']] } });
  doors.building.floors[0].spaces.find((space) => space.number === '1A').doors.forEach((door) => { door.stepFree = false; });
  const noDoor = route(routingGraph(doors), roomId('1A'), roomId('1B'), { avoidStairs: true });
  assert.deepEqual([noDoor.reason, noDoor.stepBlocked], ['no-entry', true]);
  assert.equal(describeFailure(doors, noDoor), 'Room 1A on Floor 1 has no step-free door.');
  assert.equal(describeFailure(doors, { ...noDoor, stepBlocked: undefined }), 'Room 1A on Floor 1 does not open onto a corridor.');
});

test('a staff-only failure names the staff-only elevators the way is by, from real routing, and none of the others', () => {
  // D joins Floors 1-2, E joins Floors 2-3: both staff-only
  const project = withCars(planProject([HALL, HALL, HALL], { exits: [[1, 6, 2, 'Main Door']] }), [
    { stops: [[1, 0, 2], [2, 0, 2]], letter: 'D', staffOnly: true },
    { stops: [[2, 6, 2], [3, 6, 2]], letter: 'E', staffOnly: true },
  ]);
  const graph = routingGraph(project);
  const up = route(graph, roomId('1A'), roomId('2B'), { studentsOnly: true });
  assert.deepEqual([up.reason, up.avoiding], ['unreachable', ['staff-only']]);
  assert.equal(describeFailure(project, up), 'There is no way through from Room 1A to Room 2B on Floor 2: the only way is by Elevator D, which is staff and authorised only.', 'E is not on the way');
  const top = route(graph, roomId('1A'), roomId('3B'), { studentsOnly: true });
  assert.match(describeFailure(project, top), /: the only way is by Elevator D and Elevator E, which are staff and authorised only\.$/);
  // with no way at all, a staff-only car is not the reason and none is named
  const cut = route(graph, roomId('1A'), roomId('2B'), { studentsOnly: true, avoidConnections: [project.building.connections[0].id] });
  assert.equal(cut.staffOnlyCars, undefined);
  assert.doesNotMatch(describeFailure(project, cut), /staff/);
});

test('every exit has a step: a real routeToExit failure under avoidStairs is worded so, and only when an exit with a step would have given a way', () => {
  const project = planProject([['.AA.BB.', '.AA.BB.', '#######']], { exits: [[1, 6, 2, 'Main Door']] });
  project.building.floors[0].exits[0].stepFree = false;
  const failed = routeToExit(routingGraph(project), roomId('1A'), { avoidStairs: true });
  assert.deepEqual([failed.reason, failed.end, failed.avoiding], ['unreachable', 'from', ['stairs', 'step-exits']]);
  assert.equal(describeFailure(project, failed), 'There is no step-free way through from Room 1A on Floor 1 to an exit: every exit has a step.');
  // a room cut off from the exit anyway is not blamed on its step
  const cut = planProject([['.AA.BB.', '.AA.BB.', '###.###']], { exits: [[1, 6, 2, 'Far Door']] });
  cut.building.floors[0].exits[0].stepFree = false;
  const stuck = routeToExit(routingGraph(cut), roomId('1A'), { avoidStairs: true });
  assert.equal(stuck.avoiding.includes('step-exits'), false);
});
