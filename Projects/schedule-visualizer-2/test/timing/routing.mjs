// Timing: full routing at the size the tool promises to stay responsive at
// (the fixture in test/fixtures/big.mjs: 4 floors of 60 by 40, 150 rooms,
// 80 groups, 10 periods, two own day types).
//
//   cold   every route for the whole schedule from nothing: budget 700 ms
//   warm   the same again with the cache filled: budget 50 ms
//
// A third case holds the cold budget with elevators in the building: two of
// the fixture's four stairwells made into cars of four stops (one stop on
// each floor), and ten groups that need step-free routes, so their journeys
// are searched under the step-free plan beside the plain one.
//
// The same two budgets hold for every run of the fixture grown as
// ARCHITECTURE 17.8 says (test/timing/big-runs.mjs: six day types, four of
// them own, and two bell schedules, so twelve runs), routed as the pipeline
// routes them (crowd.js routesByRun): a bell-schedule run takes the regular
// run's route objects, so it is the four own day types that cost.
//
// The suite fails at twice each budget, to leave room for a slow runner, and
// prints the measured numbers either way. The clock is read here, in the
// test, never in the engine.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../../engine/graph.js';
import { routesForSchedule, routingGraph, createRouteCache } from '../../engine/routing.js';
import { routesByRun } from '../../engine/crowd.js';
import { bigProject, BIG } from '../fixtures/big.mjs';
import { bigRunsProject, BIG_RUNS } from './big-runs.mjs';
import { validate } from '../../engine/validate.js';

const COLD_BUDGET = 700;
const WARM_BUDGET = 50;
const SLACK = 2;

function timed(run) {
  const started = performance.now();
  const value = run();
  return { ms: performance.now() - started, value };
}

test('full routing on the big fixture: cold under 700 ms, warm under 50 ms', () => {
  const project = bigProject({ seed: 1 });
  const cache = createRouteCache();
  // cold is the first run in this process, graph building included: nothing has been warmed up
  const cold = timed(() => routesForSchedule(project, routingGraph(project, buildGraph(project)), { cache, geometryVersion: 1 }));
  const graph = routingGraph(project);
  const warm = timed(() => routesForSchedule(project, graph, { cache, geometryVersion: 1 }));

  const result = cold.value;
  let ok = 0;
  for (const day of result.days) for (const group of day.groups) for (const found of group.routes) if (found.ok && !found.same) ok += 1;
  console.log('# routing, cold: ' + cold.ms.toFixed(1) + ' ms (budget ' + COLD_BUDGET + ', fails at ' + COLD_BUDGET * SLACK + '): ' + result.transitions + ' transitions, ' + result.pairs + ' journeys, ' + result.searches + ' searches over ' + graph.count + ' walkable cells');
  console.log('# routing, warm: ' + warm.ms.toFixed(1) + ' ms (budget ' + WARM_BUDGET + ', fails at ' + WARM_BUDGET * SLACK + ')');

  assert.equal(result.transitions, BIG.groups * (BIG.periods - 1) * BIG.dayTypes);
  assert.ok(ok > 1000, 'the fixture is really routed: ' + ok + ' journeys found a way');
  assert.ok(result.searches > 100, 'and cold really searched: ' + result.searches);
  assert.equal(warm.value.searches, 0, 'warm searched nothing');
  assert.deepEqual(warm.value.days, result.days);
  assert.ok(cold.ms < COLD_BUDGET * SLACK, 'cold routing took ' + cold.ms.toFixed(1) + ' ms, over ' + COLD_BUDGET * SLACK);
  assert.ok(warm.ms < WARM_BUDGET * SLACK, 'warm routing took ' + warm.ms.toFixed(1) + ' ms, over ' + WARM_BUDGET * SLACK);
});

test('full routing for the twelve runs of the grown fixture: cold under 700 ms, warm under 50 ms', () => {
  const project = bigRunsProject({ seed: 1 });
  const cache = createRouteCache();
  const cold = timed(() => routesByRun(project, routingGraph(project, buildGraph(project)), { cache, geometryVersion: 2 }));
  const graph = routingGraph(project);
  const warm = timed(() => routesByRun(project, graph, { cache, geometryVersion: 2 }));
  const result = cold.value;
  console.log('# routing, twelve runs, cold (after the case above in this process): ' + cold.ms.toFixed(1) + ' ms (budget ' + COLD_BUDGET + ', fails at ' + COLD_BUDGET * SLACK + '): ' + result.transitions + ' transitions, ' + result.pairs + ' journeys, ' + result.searches + ' searches');
  console.log('# routing, twelve runs, warm: ' + warm.ms.toFixed(1) + ' ms (budget ' + WARM_BUDGET + ', fails at ' + WARM_BUDGET * SLACK + ')');
  assert.equal(result.days.length + result.bells.length, BIG_RUNS.runs);
  assert.equal(result.transitions, BIG.groups * (BIG.periods - 1) * BIG_RUNS.runs);
  assert.equal(warm.value.searches, 0, 'warm searched nothing');
  assert.ok(cold.ms < COLD_BUDGET * SLACK, 'cold routing of twelve runs took ' + cold.ms.toFixed(1) + ' ms, over ' + COLD_BUDGET * SLACK);
  assert.ok(warm.ms < WARM_BUDGET * SLACK, 'warm routing of twelve runs took ' + warm.ms.toFixed(1) + ' ms, over ' + WARM_BUDGET * SLACK);
});

// Two of the fixture's four stairwells (the north-west and the south-east) become elevators:
// their stairs connections go, and each is replaced by a chain of connections joining its four stops.
function withElevators(project) {
  const building = project.building;
  const stairs = [building.connections.filter((connection) => connection.a.cell === 9 * BIG.width + 1), building.connections.filter((connection) => connection.a.cell === 29 * BIG.width + 58)];
  assert.deepEqual(stairs.map((list) => list.length), [3, 3]);
  building.connections = building.connections.filter((connection) => !stairs[0].includes(connection) && !stairs[1].includes(connection));
  stairs.forEach((list, index) => {
    const letter = index === 0 ? 'M' : 'N';
    for (const connection of list) {
      connection.kind = 'elevator';
      connection.staffOnly = true;
      connection.car = letter;
      connection.label = letter + connection.label;
      for (const end of [connection.a, connection.b]) {
        const floor = building.floors.find((candidate) => candidate.id === end.floorId);
        floor.lifts = Array.from(new Set([...(floor.lifts || []), end.cell])).sort((a, b) => a - b);
      }
      building.connections.push(connection);
    }
  });
  return project;
}

test('full routing with two elevators of four stops and ten step-free groups: cold under 700 ms', () => {
  const project = withElevators(bigProject({ seed: 1 }));
  project.groups.slice(0, 10).forEach((group) => {
    group.stepFree = true;
  });
  assert.deepEqual(validate(project), []);
  const cache = createRouteCache();
  const cold = timed(() => routesForSchedule(project, routingGraph(project, buildGraph(project)), { cache, geometryVersion: 3 }));
  const graph = routingGraph(project);
  const warm = timed(() => routesForSchedule(project, graph, { cache, geometryVersion: 3 }));
  const result = cold.value;
  assert.equal(graph.cars.length, 2);
  assert.deepEqual(graph.cars.map((car) => car.links.length), [6, 6], 'four stops, six pairs, each');
  let rides = 0;
  let stepFreeFound = 0;
  let plainShut = 0;
  for (const day of result.days) {
    day.groups.forEach((group, g) => {
      for (const found of group.routes) {
        if (!found.ok || found.same) continue;
        if (g < 10) stepFreeFound += 1;
        if (found.rides > 0) rides += 1;
        if (g >= 10 && found.rides > 0) plainShut += 1;
      }
    });
  }
  console.log('# routing with elevators, cold: ' + cold.ms.toFixed(1) + ' ms (budget ' + COLD_BUDGET + ', fails at ' + COLD_BUDGET * SLACK + '): ' + result.transitions + ' transitions, ' + result.pairs + ' journeys, ' + result.searches + ' searches; ' + rides + ' rides, warm ' + warm.ms.toFixed(1) + ' ms');
  assert.equal(result.transitions, BIG.groups * (BIG.periods - 1) * BIG.dayTypes);
  assert.ok(stepFreeFound > 50, 'the step-free groups are really routed: ' + stepFreeFound);
  assert.ok(rides > 50, 'and they ride: ' + rides);
  assert.equal(plainShut, 0, 'no ordinary group rides a staff-only car');
  assert.equal(warm.value.searches, 0, 'warm searched nothing');
  assert.ok(cold.ms < COLD_BUDGET * SLACK, 'cold routing with elevators took ' + cold.ms.toFixed(1) + ' ms, over ' + COLD_BUDGET * SLACK);
  assert.ok(warm.ms < WARM_BUDGET * SLACK, 'warm routing with elevators took ' + warm.ms.toFixed(1) + ' ms, over ' + WARM_BUDGET * SLACK);
});
