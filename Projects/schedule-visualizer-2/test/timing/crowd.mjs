// Timing: the crowd model at the size the tool promises to stay responsive at
// (the fixture in test/fixtures/big.mjs: 4 floors of 60 by 40, 150 rooms,
// 80 groups, 10 periods, two own day types).
//
//   the whole day of both day types, every transition: budget 500 ms
//   the twelve runs of the fixture grown as ARCHITECTURE 17.8 says
//   (test/timing/big-runs.mjs: four own day types, each with its regular
//   bells, Early Release and Assembly): budget 500 ms too, and a run may
//   cost no more than one of the two day types does. A bell-schedule run
//   retimes the regular run's transitions (crowd.js retimeTransition) where
//   no group reaches a cap, so the four own day types are what costs.
//
// The routes are worked out first and are not in the measure (test/timing/
// routing.mjs has their budget). The suite fails at twice the budget, to
// leave room for a slow runner, and prints the measured number either way.
// The clock is read here, in the test, never in the engine.
//
// The same run is where the fixture's figures are watched (SV2-37). With the
// crossing rule as first written two opposing left-turners stopped each other
// for good: 183 of the 1,313 walks did not arrive and 136,623 seconds were
// waited. With the amended rule every walk arrives and 29,007 seconds are
// waited. The suite fails on any walk that does not arrive and on waiting of
// a quarter of the old figure or more. It cannot ask for a tenth: with no
// crossing rule at all (CROSSING_WAIT_MAX set to 0) the fixture still waits
// 28,010 seconds, queueing behind columns and at shared doors, so the
// crossing rule's own share is 997 seconds.

import test from 'node:test';
import assert from 'node:assert/strict';
import { routesForSchedule, routingGraph } from '../../engine/routing.js';
import { simulateSchedule } from '../../engine/crowd.js';
import { loads } from '../../engine/load.js';
import { places } from '../../engine/places.js';
import { routesByRun } from '../../engine/crowd.js';
import { bigProject, BIG } from '../fixtures/big.mjs';
import { bigRunsProject, BIG_RUNS } from './big-runs.mjs';

const BUDGET = 500;
const SLACK = 2;
const WAITED_BEFORE = 136623; // SV2-15's measure, the crossing rule as first written

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
  console.log('# crowd, did not arrive: ' + stopped + ' of ' + walks + ' walks; waited ' + waited + ' s, ' + (100 * waited / WAITED_BEFORE).toFixed(1) + '% of the ' + WAITED_BEFORE + ' s before the crossing rule was amended (fails at 25%)');

  assert.equal(cold.value.days.length, BIG.dayTypes);
  for (const day of cold.value.days) assert.equal(day.transitions.length, BIG.periods - 1);
  assert.ok(walks > 1000, 'the fixture really walks: ' + walks + ' walks');
  assert.ok(waited > 1000, 'and really crowds: ' + waited + ' s waited');
  assert.equal(stopped, 0, stopped + ' walks did not arrive');
  assert.ok(waited < WAITED_BEFORE / 4, waited + ' s waited, a quarter or more of ' + WAITED_BEFORE);
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

test('the crowd model for the twelve runs of the grown fixture: under 500 ms, and a run costs no more than a day did', () => {
  const median = (list) => list.slice().sort((a, b) => a - b)[Math.floor(list.length / 2)];
  const today = bigProject({ seed: 1 });
  const todayGraph = routingGraph(today);
  const todayRoutes = routesForSchedule(today, todayGraph);
  const project = bigRunsProject({ seed: 1 });
  const graph = routingGraph(project);
  const routes = routesByRun(project, graph);
  const first = timed(() => simulateSchedule(project, routes, graph));
  // warm, both alike: the median of three runs each, in this one process
  const perDay = median([0, 1, 2].map(() => timed(() => simulateSchedule(today, todayRoutes, todayGraph)).ms)) / BIG.dayTypes;
  const perRun = median([0, 1, 2].map(() => timed(() => simulateSchedule(project, routes, graph)).ms)) / BIG_RUNS.runs;
  let walks = 0;
  let stopped = 0;
  let retimed = 0;
  for (const day of first.value.bells) {
    const regular = first.value.days.find((other) => other.dayTypeId === day.dayTypeId);
    day.transitions.forEach((transition, t) => {
      if (!transition.off && transition.groups.length > 0 && transition.groups[0].positions === regular.transitions[t].groups[0].positions) retimed += 1;
    });
  }
  for (const day of first.value.days.concat(first.value.bells)) {
    for (const transition of day.transitions) {
      for (const group of transition.groups) {
        walks += 1;
        if (!group.arrived) stopped += 1;
      }
    }
  }
  console.log('# crowd, twelve runs, first (after the cases above in this process): ' + first.ms.toFixed(1) + ' ms (budget ' + BUDGET + ', fails at ' + BUDGET * SLACK + '): ' + walks + ' walks, ' + retimed + ' bell-schedule transitions retimed rather than simulated, ' + stopped + ' did not arrive');
  console.log('# crowd, warm: ' + perRun.toFixed(2) + ' ms a run of the twelve, against ' + perDay.toFixed(2) + ' ms a day type of the two (a run may cost no more)');
  assert.equal(first.value.days.length, BIG_RUNS.ownDayTypes);
  assert.equal(first.value.bells.length, BIG_RUNS.runs - BIG_RUNS.ownDayTypes);
  assert.equal(stopped, 0);
  assert.ok(retimed >= BIG_RUNS.ownDayTypes * ((BIG.periods - 1) + (BIG.periods - 1 - BIG_RUNS.offPeriods)), 'every meeting transition of a bell-schedule run was retimed: ' + retimed);
  assert.ok(perRun <= perDay, 'a run cost ' + perRun.toFixed(2) + ' ms, more than a day type did (' + perDay.toFixed(2) + ' ms): stop and report (ARCHITECTURE 17.8)');
  assert.ok(first.ms < BUDGET * SLACK, 'the crowd model for twelve runs took ' + first.ms.toFixed(1) + ' ms, over ' + BUDGET * SLACK);
});
