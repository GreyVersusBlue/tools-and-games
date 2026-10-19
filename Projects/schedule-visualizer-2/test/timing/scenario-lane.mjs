// The scenario lane end to end: node test/timing/scenario-lane.mjs
//
// Timing, at the size the tool promises to stay responsive at (the fixture in
// test/fixtures/big.mjs: 4 floors of 60 by 40, 150 rooms, 80 groups, 10
// periods, two own day types), on the main thread, through the store and the
// engine client exactly as the scenario lab asks: store.derived.scenario(),
// which works out the project with the scenario applied on the scenario
// pipeline and compares it with the main lane's result.
//
//   warm    one change added to an open scenario the lane has already
//           worked out, the main lane's result in hand: the median of five
//           changes, budget 100 ms
//   first   the first asking after the scenario is opened, the scenario
//           pipeline empty but the route cache shared with the main lane's:
//           budget 400 ms. Nearly nothing is searched, and the file asserts
//           it (client.searches, at most a tenth of the main lane's), but
//           not nothing: the cache keeps 64 distance fields (FIELD_LIMIT in
//           engine/routing.js) and this fixture has 150 rooms, so a scenario
//           whose walks start from a room evicted since is searched again.
//           SV2-64b measured 3 of 150 (the move 2, the swap 1). On a school
//           of 64 rooms or fewer it is nothing, which
//           test/ui/scenario-lane.test.mjs asserts on the sample school.
//
// The suite fails at twice the budget (SLACK 2, as every timing file here: a
// CI runner is not this machine) and prints the measured numbers either way.
// The clock is read here, in the test, never in the engine.
//
// Measured by SV2-64 on huginn (2026-10-18), ten runs of this file with other
// sessions' jobs on the machine (load average 1.5 to 2.6): warm median 20.6
// to 28.6 ms, first 104.9 to 134.2 ms. The budgets are about four and three
// times the worst of those; spec 3.13 asks for a full movement render under a
// second, and the lab redraws on each change.
//
// What makes the numbers honest (the lane's answer is the engines' own, the
// main thread's answers are the worker's) is test/ui/scenario-lane.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createStore } from '../../engine/store.js';
import { createIds, seededRandom } from '../../engine/ids.js';
import * as actions from '../../engine/actions.js';
import { allRooms } from '../../engine/schema.js';
import { effectiveSchedule } from '../../engine/day-types.js';
import { engineFor } from '../../ui/engine-client.js';
import { bigProject } from '../fixtures/big.mjs';

const BUDGET = 100;
const FIRST_BUDGET = 400;
// the first asking may search at most this fraction of what the main lane
// searched (1/FEW); measured 3 of 150, see the header
const FEW = 10;
const SLACK = 2; // as every timing file here: a CI runner is not this machine
const clock = () => new Date('2026-09-01T12:00:00Z');

function storeOf(project) {
  return createStore({ project, clock, ids: createIds(seededRandom(16)) });
}

// A move for group `g` into a room nobody is in at that period.
function moveFor(project, g, dayIndex, period) {
  const dayTypeId = project.dayTypes[dayIndex].id;
  const used = new Set(project.groups.map((group) => effectiveSchedule(project, group.id, dayTypeId)[period].room));
  const rooms = allRooms(project).filter((room) => !used.has(room.id));
  const room = rooms[(g * 7 + period * 3) % rooms.length];
  return { kind: 'move', dayTypeId, groupId: project.groups[g].id, period, roomId: room.id };
}

async function timed(run) {
  const started = performance.now();
  const value = await run();
  return { ms: performance.now() - started, value };
}

test('the scenario lane on the big fixture: one change added, warm, under ' + BUDGET + ' ms; the first asking under ' + FIRST_BUDGET + ' ms', async () => {
  const store = storeOf(bigProject({ seed: 1 }));
  const client = engineFor(store, { worker: false });
  await store.derived.results();

  store.apply(actions.newScenario, { name: 'Trial' });
  store.apply(actions.addScenarioChange, { change: moveFor(store.project, 3, 0, 2) });
  store.apply(actions.addScenarioChange, { change: { kind: 'swapPeriods', dayTypeId: store.project.dayTypes[1].id, groupId: store.project.groups[40].id, periodA: 1, periodB: 4 } });
  const searched = client.searches;
  assert.ok(searched > 0, 'the main lane searched the building first');
  const first = await timed(() => store.derived.scenario());
  assert.equal(first.value.changes.length, 2);
  assert.equal(client.laneStats.scenario.sent, 1);
  const firstSearches = client.searches - searched;
  assert.ok(firstSearches * FEW <= searched, 'the first asking searched ' + firstSearches + ' distance fields, more than a ' + FEW + 'th of the main lane\'s ' + searched + ': the route cache is not the main lane\'s');

  const warm = [];
  for (let i = 0; i < 5; i += 1) {
    store.apply(actions.addScenarioChange, { change: moveFor(store.project, 10 + i * 13, i % 2, 1 + i) });
    const step = await timed(() => store.derived.scenario());
    assert.equal(step.value.changes.length, 3 + i, 'change ' + i + ' was applied');
    assert.ok(step.value.compare.groups.some((row) => row.edited), 'the comparison marks the edited groups');
    warm.push(step.ms);
  }
  const median = warm.slice().sort((a, b) => a - b)[2];
  console.log('# scenario lane, warm: median ' + median.toFixed(1) + ' ms of ' + warm.map((ms) => ms.toFixed(1)).join(', ') + ' (budget ' + BUDGET + ', fails at ' + BUDGET * SLACK + '); first asking ' + first.ms.toFixed(1) + ' ms (budget ' + FIRST_BUDGET + ', fails at ' + FIRST_BUDGET * SLACK + ')');
  assert.ok(median < BUDGET * SLACK, 'the scenario lane took ' + median.toFixed(1) + ' ms warm, over ' + BUDGET * SLACK);
  assert.ok(first.ms < FIRST_BUDGET * SLACK, 'the first scenario took ' + first.ms.toFixed(1) + ' ms, over ' + FIRST_BUDGET * SLACK);
  assert.equal(client.laneStats.scenario.failed, 0);
  client.close();
});
