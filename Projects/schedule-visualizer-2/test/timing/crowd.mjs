// Timing: the crowd model at the size the tool promises to stay responsive at
// (the fixture in test/fixtures/big.mjs: 4 floors of 60 by 40, 150 rooms,
// 80 groups, 10 periods, two own day types).
//
//   the whole day of both day types, every transition: budget 500 ms
//
// The routes are worked out first and are not in the measure (test/timing/
// routing.mjs has their budget). The suite fails at twice the budget, to
// leave room for a slow runner, and prints the measured number either way.
// The clock is read here, in the test, never in the engine.

import test from 'node:test';
import assert from 'node:assert/strict';
import { routesForSchedule, routingGraph } from '../../engine/routing.js';
import { simulateSchedule } from '../../engine/crowd.js';
import { loads } from '../../engine/load.js';
import { places } from '../../engine/places.js';
import { bigProject, BIG } from '../fixtures/big.mjs';

const BUDGET = 500;
const SLACK = 2;

function timed(run) {
  const started = performance.now();
  const value = run();
  return { ms: performance.now() - started, value };
}

test('the crowd model on the big fixture: the whole day of both day types under 500 ms', () => {
  const project = bigProject({ seed: 1 });
  const graph = routingGraph(project);
  const routes = routesForSchedule(project, graph);
  // the first run in this process: nothing has been warmed up
  const cold = timed(() => simulateSchedule(project, routes, graph));
  const warm = timed(() => simulateSchedule(project, routes, graph));

  let walks = 0;
  let waited = 0;
  let stopped = 0;
  let ticks = 0;
  for (const day of cold.value.days) {
    for (const transition of day.transitions) {
      ticks += transition.seconds;
      for (const group of transition.groups) {
        walks += 1;
        waited += group.waiting;
        if (!group.arrived) stopped += 1;
      }
    }
  }
  console.log('# crowd, cold: ' + cold.ms.toFixed(1) + ' ms (budget ' + BUDGET + ', fails at ' + BUDGET * SLACK + '): ' + walks + ' walks over ' + ticks + ' seconds of ' + (BIG.periods - 1) * BIG.dayTypes + ' transitions, ' + waited + ' s waited, ' + stopped + ' did not arrive');
  console.log('# crowd, again: ' + warm.ms.toFixed(1) + ' ms');

  assert.equal(cold.value.days.length, BIG.dayTypes);
  for (const day of cold.value.days) assert.equal(day.transitions.length, BIG.periods - 1);
  assert.ok(walks > 1000, 'the fixture really walks: ' + walks + ' walks');
  assert.ok(waited > 1000, 'and really crowds: ' + waited + ' s waited');
  assert.deepEqual(warm.value, cold.value, 'the second run gives the same figures');
  assert.ok(cold.ms < BUDGET * SLACK, 'the crowd model took ' + cold.ms.toFixed(1) + ' ms, over ' + BUDGET * SLACK);
});

test('loads and places on the big fixture are small beside it', () => {
  const project = bigProject({ seed: 1 });
  const graph = routingGraph(project);
  const routes = routesForSchedule(project, graph);
  const both = timed(() => project.dayTypes.map((dayType) => loads(project, routes, dayType.id, graph)));
  const cut = timed(() => places(project, graph));
  console.log('# loads, both day types: ' + both.ms.toFixed(1) + ' ms; places: ' + cut.ms.toFixed(1) + ' ms (' + cut.value.places.length + ' places)');
  assert.ok(both.value.every((load) => load && load.max.busiest > 0));
  assert.ok(both.ms + cut.ms < BUDGET * SLACK, 'loads and places took ' + (both.ms + cut.ms).toFixed(1) + ' ms');
});
