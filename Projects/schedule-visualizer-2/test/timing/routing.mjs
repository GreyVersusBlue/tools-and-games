// Timing: full routing at the size the tool promises to stay responsive at
// (the fixture in test/fixtures/big.mjs: 4 floors of 60 by 40, 150 rooms,
// 80 groups, 10 periods, two own day types).
//
//   cold   every route for the whole schedule from nothing: budget 700 ms
//   warm   the same again with the cache filled: budget 50 ms
//
// The suite fails at twice each budget, to leave room for a slow runner, and
// prints the measured numbers either way. The clock is read here, in the
// test, never in the engine.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../../engine/graph.js';
import { routesForSchedule, routingGraph, createRouteCache } from '../../engine/routing.js';
import { bigProject, BIG } from '../fixtures/big.mjs';

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
