// Written directions: numbered steps relative to the walker, with rooms
// passed, stairs by letter and floor, and every typed name exactly as typed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { route, routeToExit, routingGraph } from '../../engine/routing.js';
import { directions, describeFailure, CELL_UNITS } from '../../engine/directions.js';
import { school } from './helpers.mjs';
import { planProject, twoRooms, threeFloors, disconnectedWing, roomId, cellAt } from '../fixtures/buildings/plans.mjs';

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
