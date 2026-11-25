// Routing's extra-cost options: extraSeconds (seconds added on entering a node,
// by the heading of the step that enters it) and extraLinkSeconds (seconds added
// on taking a connection). ARCHITECTURE 23.3 and 23.12.
//
// Each plan is drawn in the test that uses it. Slots are node × 4 + heading, the
// heading being the index into DOOR_SIDES ('n', 'e', 's', 'w').

import test from 'node:test';
import assert from 'node:assert/strict';
import { nodeAt } from '../../engine/graph.js';
import { DOOR_SIDES } from '../../engine/schema.js';
import { route, routeToExit, routeToCells, routingGraph, createRouteCache } from '../../engine/routing.js';
import { planProject, disconnectedWing, threeFloors, cellAt, floorId, roomId } from '../fixtures/buildings/plans.mjs';
import { bigProject } from '../fixtures/big.mjs';
import { sampleSchool } from '../../data/sample-school.js';

// Two ways from room A to room B: the short one along the bottom corridor
// (five cells) and the long one along the top (seven cells, two more). A and B
// are each two cells tall, so each touches both corridors.
function plan() {
  const project = planProject([[
    '#######',
    'A.....B',
    'A#####B',
  ]]);
  return project;
}

const EAST = DOOR_SIDES.indexOf('e');
const WEST = DOOR_SIDES.indexOf('w');

function slot(graph, project, x, y, heading) {
  const node = nodeAt(graph, floorId(1), cellAt(project, 1, x, y));
  assert.notEqual(node, -1, 'cell ' + x + ',' + y + ' is walkable');
  return node * 4 + heading;
}

function cellsOf(project, found) {
  return found.cells.map((place) => {
    const floor = project.building.floors.find((candidate) => candidate.id === place.floorId);
    return (place.cell % floor.width) + ',' + Math.floor(place.cell / floor.width);
  });
}

function withZero(found) {
  return found && found.ok && !found.same ? { ...found, extraSeconds: 0 } : found;
}

test('a jam on one lane of a two-corridor plan is avoided, and the opposite lane\'s penalty changes nothing', () => {
  const project = plan();
  const graph = routingGraph(project);
  const a = roomId('1A');
  const b = roomId('1B');

  const usual = route(graph, a, b);
  assert.equal(usual.ok, true);
  assert.deepEqual(cellsOf(project, usual), ['1,2', '2,2', '3,2', '4,2', '5,2'], 'the short corridor is the usual way east');
  assert.equal(usual.seconds, 15);
  assert.equal(Object.hasOwn(usual, 'extraSeconds'), false, 'no extra option, no extraSeconds field');

  // eastbound at the middle of the short corridor: a small jam is put up with,
  // a big one is walked round (two more cells is six seconds)
  const eastJam = new Int32Array(graph.count * 4);
  eastJam[slot(graph, project, 3, 2, EAST)] = 4;
  const small = route(graph, a, b, { extraSeconds: eastJam });
  assert.deepEqual(cellsOf(project, small), cellsOf(project, usual), 'a four-second jam is cheaper than the detour');
  assert.equal(small.extraSeconds, 4);
  assert.equal(small.seconds, 15, 'seconds stays the plain walking time');

  eastJam[slot(graph, project, 3, 2, EAST)] = 10;
  const avoided = route(graph, a, b, { extraSeconds: eastJam });
  assert.equal(avoided.ok, true);
  assert.deepEqual(cellsOf(project, avoided), ['0,0', '1,0', '2,0', '3,0', '4,0', '5,0', '6,0'], 'a ten-second jam sends the group along the top');
  assert.equal(avoided.seconds, 21, 'seven cells at three seconds, none of the jam');
  assert.equal(avoided.extraSeconds, 0, 'the detour pays no extra');

  // the same penalty on the lane going the other way is not on this walk
  const westJam = new Int32Array(graph.count * 4);
  westJam[slot(graph, project, 3, 2, WEST)] = 100;
  const opposite = route(graph, a, b, { extraSeconds: westJam });
  assert.deepEqual(opposite, withZero(usual), 'the opposite lane never meets this walk');
  // and it is the walk the other way that feels it
  const back = route(graph, b, a, { extraSeconds: westJam });
  assert.deepEqual(cellsOf(project, back), ['6,0', '5,0', '4,0', '3,0', '2,0', '1,0', '0,0'], 'B to A goes round the jam on its own lane');
});

test('a penalty on a connection is avoided by the other stairs, and a car is charged by its link', () => {
  const project = planProject([
    ['AA.....', 'AA.....', 'S#####S', '.......', '.......'],
    ['AA.....', 'AA.....', 'S#####S', '.......', '.......'],
  ], { connections: [[1, 0, 2, 2, 0, 2], [1, 6, 2, 2, 6, 2]] });
  const graph = routingGraph(project);
  const usual = route(graph, roomId('1A'), roomId('2A'));
  assert.equal(usual.ok, true);
  assert.equal(usual.stairs, 1);
  const first = graph.links.findIndex((link) => link.id === usual.connections[0]);
  assert.notEqual(first, -1);

  const extraLink = new Int32Array(graph.links.length);
  extraLink[first] = 5;
  const mild = route(graph, roomId('1A'), roomId('2A'), { extraLinkSeconds: extraLink });
  assert.deepEqual(mild.connections, usual.connections, 'five seconds is cheaper than walking to the far stairs');
  assert.equal(mild.extraSeconds, 5);
  assert.equal(mild.seconds, usual.seconds);

  extraLink[first] = 60;
  const other = route(graph, roomId('1A'), roomId('2A'), { extraLinkSeconds: extraLink });
  assert.equal(other.ok, true);
  assert.notDeepEqual(other.connections, usual.connections, 'sixty seconds sends the walk to the other stairs');
  assert.equal(other.connections.length, 1);
  assert.equal(other.extraSeconds, 0);
  assert.ok(other.seconds > usual.seconds, 'the far stairs are a longer walk');

  // both options together are summed
  const slots = new Int32Array(graph.count * 4).fill(1);
  const both = route(graph, roomId('1A'), roomId('2A'), { extraLinkSeconds: extraLink, extraSeconds: slots });
  assert.equal(both.extraSeconds, both.cells.length - 1 - both.connections.length, 'a second on every step on foot (a room is left, not stepped out of, and a stairs landing is arrived at by the stairs)');
});

test('a lift is charged by its car\'s link, never by the other links of the car', () => {
  const project = sampleSchool();
  const graph = routingGraph(project);
  const ids = Array.from(graph.rooms.keys()).sort();
  let found = null;
  for (const from of ids) {
    for (const to of ids) {
      const r = route(graph, from, to, { avoidStairs: true });
      if (r.ok && r.rides > 0) {
        found = { from, to, route: r };
        break;
      }
    }
    if (found) break;
  }
  assert.ok(found, 'the sample school has a step-free walk that rides a car');
  const extraLink = new Int32Array(graph.links.length);
  const ridden = graph.links.find((link) => link.id === found.route.connections.find((id) => graph.links.some((l) => l.id === id && l.elevator)));
  assert.ok(ridden && ridden.elevator, 'the walk rides a car');
  extraLink[graph.cars[ridden.car].link] = 7;
  const penalised = route(graph, found.from, found.to, { avoidStairs: true, extraLinkSeconds: extraLink });
  assert.equal(penalised.ok, true);
  assert.equal(penalised.extraSeconds, 7 * penalised.rides, 'seven seconds a ride');
  assert.equal(penalised.seconds, found.route.seconds, 'the only step-free way still rides the car, and seconds stays plain');
});

for (const [name, make] of [['the sample school', () => sampleSchool()], ['bigProject({ seed: 1 })', () => bigProject({ seed: 1 })]]) {
  test('absent and all-zero extra arrays give equal routes on ' + name, () => {
    const project = make();
    const graph = routingGraph(project);
    const zero = { extraSeconds: new Int32Array(graph.count * 4), extraLinkSeconds: new Int32Array(graph.links.length) };
    const ids = Array.from(graph.rooms.keys()).sort();
    // every room on the sample; every fifth on the big fixture (900 searches)
    const stride = ids.length > 40 ? 5 : 1;
    const chosen = ids.filter((_, index) => index % stride === 0);
    let routes = 0;
    for (const options of [{}, { avoidStairs: true }, { undirected: true }]) {
      for (const from of chosen) {
        for (const to of chosen) {
          const plain = route(graph, from, to, options);
          const extra = route(graph, from, to, { ...options, ...zero });
          assert.deepEqual(extra, withZero(plain), from + ' to ' + to + ' under ' + JSON.stringify(options));
          routes += 1;
        }
        const plainExit = routeToExit(graph, from, options);
        assert.deepEqual(routeToExit(graph, from, { ...options, ...zero }), withZero(plainExit), from + ' to an exit');
      }
    }
    const targets = graph.exits.map((exit) => ({ floorId: exit.floorId, cell: exit.cell, id: exit.id }));
    for (const from of chosen) {
      assert.deepEqual(routeToCells(graph, from, targets, zero), withZero(routeToCells(graph, from, targets)), from + ' to a cell');
    }
    assert.ok(routes > 100);
  });
}

test('a plan with extras is never read from or written to the cache, and still counts its searches', () => {
  const project = plan();
  const graph = routingGraph(project);
  const cache = createRouteCache();
  const a = roomId('1A');
  const b = roomId('1B');
  const options = { cache, geometryVersion: 1 };

  const usual = route(graph, a, b, options);
  const before = { routes: cache.routes.size, fields: cache.fields.size, searches: cache.searches, held: cache.routes.get(Array.from(cache.routes.keys())[0]) };
  assert.equal(before.routes, 1);
  assert.equal(before.fields, 1);
  assert.equal(before.searches, 1);

  const jam = new Int32Array(graph.count * 4);
  jam[slot(graph, project, 3, 2, EAST)] = 10;
  const avoided = route(graph, a, b, { ...options, extraSeconds: jam });
  assert.notDeepEqual(cellsOf(project, avoided), cellsOf(project, usual), 'the cached usual route was not handed back');
  assert.equal(cache.routes.size, before.routes, 'no route entry written');
  assert.equal(cache.fields.size, before.fields, 'no field written');
  assert.equal(cache.searches, before.searches + 1, 'the search is counted');
  assert.equal(cache.routes.get(Array.from(cache.routes.keys())[0]), before.held, 'the usual route is the entry it was');

  const again = route(graph, a, b, options);
  assert.equal(again, usual, 'the usual route is still served from the cache');
  assert.equal(cache.searches, before.searches + 1, 'and it searches nothing');

  // a route to an exit and to cells counts too, and writes nothing
  route(graph, a, b, { ...options, extraSeconds: jam });
  assert.equal(cache.searches, before.searches + 2, 'every extra search is counted, none is remembered');
  const exits = graph.exits.map((exit) => ({ floorId: exit.floorId, cell: exit.cell, id: exit.id }));
  const searchesThen = cache.searches;
  routeToCells(graph, a, exits, { ...options, extraSeconds: jam });
  assert.equal(cache.searches, searchesThen + 1);
  assert.equal(cache.fields.size, before.fields);
  assert.equal(cache.routes.size, before.routes);
});

test('a plan with extras has its own key suffix, so no cached field can answer for it', () => {
  // the observable half of the key: an extra route and a plain one over the
  // same cache leave exactly the plain entries, whatever order they come in
  const project = plan();
  const graph = routingGraph(project);
  const cache = createRouteCache();
  const jam = new Int32Array(graph.count * 4);
  jam[slot(graph, project, 3, 2, EAST)] = 10;
  route(graph, roomId('1A'), roomId('1B'), { cache, geometryVersion: 1, extraSeconds: jam });
  assert.equal(cache.fields.size, 0);
  assert.equal(cache.routes.size, 0);
  const plain = route(graph, roomId('1A'), roomId('1B'), { cache, geometryVersion: 1 });
  assert.deepEqual(cellsOf(project, plain), ['1,2', '2,2', '3,2', '4,2', '5,2']);
  assert.equal([...cache.fields.keys()].some((key) => key.endsWith('|x')), false);
  assert.equal([...cache.routes.keys()].some((key) => key.endsWith('|x')), false);
});

test('a failure is explained as it is without extras', () => {
  for (const [project, from, to, options] of [
    [disconnectedWing(), '1A', '1C', {}],
    [threeFloors(), '1A', '2A', { avoidStairs: true }],
  ]) {
    const graph = routingGraph(project);
    const jam = new Int32Array(graph.count * 4).fill(3);
    const link = new Int32Array(graph.links.length).fill(2);
    const plain = route(graph, roomId(from), roomId(to), options);
    assert.equal(plain.ok, false);
    assert.deepEqual(route(graph, roomId(from), roomId(to), { ...options, extraSeconds: jam, extraLinkSeconds: link }), plain);
  }
  // a step across the only corridor is the cause of a step-free failure, and
  // routing says so (stepBlocked) by searching again; with extras in force it
  // searches again without them and says the same
  const steps = planProject([['A...B', '#####', '.....']]);
  steps.building.floors[0].notStepFree = [cellAt(steps, 1, 2, 1)];
  const graph = routingGraph(steps);
  const blocked = route(graph, roomId('1A'), roomId('1B'), { avoidStairs: true });
  assert.equal(blocked.stepBlocked, true);
  const jam = new Int32Array(graph.count * 4).fill(1);
  const withExtra = route(graph, roomId('1A'), roomId('1B'), { avoidStairs: true, extraSeconds: jam });
  assert.deepEqual(withExtra, blocked);
  assert.equal(withExtra.stepBlocked, true);
});

test('extras of the wrong kind or size are refused in words', () => {
  const project = plan();
  const graph = routingGraph(project);
  assert.throws(() => route(graph, roomId('1A'), roomId('1B'), { extraSeconds: new Int32Array(3) }), /extraSeconds must be an Int32Array of \d+ slots/);
  assert.throws(() => route(graph, roomId('1A'), roomId('1B'), { extraLinkSeconds: [0] }), /extraLinkSeconds must be an Int32Array/);
});
