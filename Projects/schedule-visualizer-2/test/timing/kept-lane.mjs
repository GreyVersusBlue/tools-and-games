// The kept-scenario lane and the other-building lane end to end:
//   node test/timing/kept-lane.mjs
//
// Timing, at the size the tool promises to stay responsive at (the fixture in
// test/fixtures/big.mjs: 4 floors of 60 by 40, 150 rooms, 80 groups, 10
// periods, two own day types), on the main thread, through the store and the
// engine client exactly as the scenario lab will ask: store.derived.kept(id)
// and store.derived.setOther / other.
//
//   kept first   the first asking for a kept scenario, its pipeline empty but
//                the route cache shared with the main lane's, whose result is
//                in hand: budget 500 ms. Nearly nothing is searched (the file
//                asserts at most a tenth of the main lane's searches: the
//                cache keeps 64 distance fields, FIELD_LIMIT in
//                engine/routing.js, and this fixture has 150 rooms).
//   kept warm    the lab flipping from one kept scenario to another, or the
//                real schedule changing under a kept one it has worked out:
//                the median of five, budget 150 ms. Transitions both runs
//                have alike are not run again (the pipeline keeps them by
//                what they are, not by which scenario they are in).
//   other first  the first asking for another building worked out from
//                nothing, on its own route cache, so every distance field is
//                searched: budget 2 s. This is the cold full run the main
//                lane has in the worker (test/timing/worker.mjs) plus the
//                trimming, and the file asserts that the other building's
//                searches are its own (the main lane's were not reused).
//   graph        buildGraph(other), the main thread's one cost per comparison
//                (the plan map is given the other project and its graph,
//                ARCHITECTURE 21.10): budget 150 ms.
//
// The suite fails at twice a budget (SLACK 2, as every timing file here: a
// CI runner is not this machine) and prints the measured numbers either way.
// The clock is read here, in the test, never in the engine.
//
// What makes the numbers honest (the lanes' answers are the engines' own, the
// main thread's answers are the worker's) is test/engine/kept-lane.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createStore } from '../../engine/store.js';
import { createIds, seededRandom } from '../../engine/ids.js';
import * as actions from '../../engine/actions.js';
import { allRooms } from '../../engine/schema.js';
import { effectiveSchedule } from '../../engine/day-types.js';
import { keptScenarios } from '../../engine/scenario.js';
import { buildGraph } from '../../engine/graph.js';
import { engineFor } from '../../ui/engine-client.js';
import { bigProject } from '../fixtures/big.mjs';

const KEPT_BUDGET = 150;
const KEPT_FIRST_BUDGET = 500;
const OTHER_BUDGET = 2000;
const GRAPH_BUDGET = 150;
// the first kept asking may search at most this fraction of what the main lane searched
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

const median = (list) => list.slice().sort((a, b) => a - b)[Math.floor(list.length / 2)];

// Six kept scenarios of two changes each, and one open.
function withKept(store) {
  for (let i = 0; i < 6; i += 1) {
    store.apply(actions.newScenario, i === 0 ? { name: 'Kept 0' } : { name: 'Kept ' + i, keep: true });
    store.apply(actions.addScenarioChange, { change: moveFor(store.project, 3 + i * 11, i % 2, 1 + (i % 7)) });
    store.apply(actions.addScenarioChange, { change: { kind: 'swapPeriods', dayTypeId: store.project.dayTypes[(i + 1) % 2].id, groupId: store.project.groups[40 + i * 5].id, periodA: 1, periodB: 4 } });
  }
  store.apply(actions.newScenario, { name: 'Open', keep: true });
  assert.equal(keptScenarios(store.project).length, 6);
  return keptScenarios(store.project).map((scenario) => scenario.id);
}

test('a kept scenario on the big fixture: the first asking under ' + KEPT_FIRST_BUDGET + ' ms, then ' + KEPT_BUDGET + ' ms warm', async () => {
  const store = storeOf(bigProject({ seed: 1 }));
  const client = engineFor(store, { worker: false });
  await store.derived.results();
  const ids = withKept(store);
  const searched = client.searches;
  assert.ok(searched > 0, 'the main lane searched the building first');

  const first = await timed(() => store.derived.kept(ids[0]));
  assert.ok(first.value.result.findings, 'answered');
  assert.equal(first.value.where, 'main');
  assert.equal(client.laneStats.kept.sent, 1);
  const firstSearches = client.searches - searched;
  assert.ok(firstSearches * FEW <= searched, 'the first asking searched ' + firstSearches + ' distance fields, more than a ' + FEW + 'th of the main lane\'s ' + searched + ': the route cache is not the main lane\'s');

  // flipping to another kept scenario, five times over
  const flips = [];
  for (let i = 1; i < 6; i += 1) {
    const step = await timed(() => store.derived.kept(ids[i]));
    assert.ok(step.value.result.walks, 'kept scenario ' + i + ' answered');
    flips.push(step.ms);
  }
  // the real schedule changing under a kept scenario already worked out
  const changes = [];
  for (let i = 0; i < 5; i += 1) {
    const g = store.project.groups[60 + i * 3];
    store.apply(actions.setSlot, { groupId: g.id, dayTypeId: store.project.dayTypes[0].id, period: 2 + i, slot: { room: moveFor(store.project, 60 + i * 3, 0, 2 + i).roomId } });
    await store.derived.results();
    const step = await timed(() => store.derived.kept(ids[5]));
    assert.ok(step.value.result.walks, 'kept scenario after schedule change ' + i + ' answered');
    changes.push(step.ms);
  }
  const flip = median(flips);
  const change = median(changes);
  console.log('# kept lane: first asking ' + first.ms.toFixed(1) + ' ms with ' + firstSearches + ' of ' + searched + ' distance fields searched (budget ' + KEPT_FIRST_BUDGET + ', fails at ' + KEPT_FIRST_BUDGET * SLACK + '); warm, flipping between kept scenarios: median ' + flip.toFixed(1) + ' ms of ' + flips.map((ms) => ms.toFixed(1)).join(', ') + '; warm, after a schedule change: median ' + change.toFixed(1) + ' ms of ' + changes.map((ms) => ms.toFixed(1)).join(', ') + ' (budget ' + KEPT_BUDGET + ', fails at ' + KEPT_BUDGET * SLACK + ')');
  assert.ok(first.ms < KEPT_FIRST_BUDGET * SLACK, 'the first kept scenario took ' + first.ms.toFixed(1) + ' ms, over ' + KEPT_FIRST_BUDGET * SLACK);
  assert.ok(flip < KEPT_BUDGET * SLACK, 'flipping between kept scenarios took ' + flip.toFixed(1) + ' ms warm, over ' + KEPT_BUDGET * SLACK);
  assert.ok(change < KEPT_BUDGET * SLACK, 'a kept scenario after a schedule change took ' + change.toFixed(1) + ' ms warm, over ' + KEPT_BUDGET * SLACK);
  assert.equal(client.laneStats.kept.failed, 0);
  client.close();
});

test('another building on the big fixture: the first asking under ' + OTHER_BUDGET + ' ms on a route cache of its own, and the graph for the map under ' + GRAPH_BUDGET + ' ms', async () => {
  const store = storeOf(bigProject({ seed: 1 }));
  const client = engineFor(store, { worker: false });
  const main = await store.derived.results();
  const searched = client.searches;
  const other = bigProject({ seed: 2 });
  store.derived.setOther(other, 'next-year.json');
  const first = await timed(() => store.derived.other());
  assert.ok(first.value.result.findings && first.value.result.loads, 'answered');
  assert.equal(client.laneStats.other.sent, 1);
  const otherSearches = client.searches - searched;
  assert.ok(otherSearches * 2 >= searched, 'the other building searched ' + otherSearches + ' distance fields, fewer than half of the main lane\'s ' + searched + ': it is using the main lane\'s route cache');

  const graph = await timed(() => buildGraph(other));
  assert.ok(graph.value, 'the graph is built');
  console.log('# other-building lane: first asking ' + first.ms.toFixed(1) + ' ms with ' + otherSearches + ' distance fields searched, the main lane\'s own ' + searched + ' (budget ' + OTHER_BUDGET + ', fails at ' + OTHER_BUDGET * SLACK + '); buildGraph ' + graph.ms.toFixed(1) + ' ms (budget ' + GRAPH_BUDGET + ', fails at ' + GRAPH_BUDGET * SLACK + ')');
  assert.ok(first.ms < OTHER_BUDGET * SLACK, 'the other building took ' + first.ms.toFixed(1) + ' ms, over ' + OTHER_BUDGET * SLACK);
  assert.ok(graph.ms < GRAPH_BUDGET * SLACK, 'buildGraph took ' + graph.ms.toFixed(1) + ' ms, over ' + GRAPH_BUDGET * SLACK);
  assert.equal(await store.derived.results(), main, 'the main lane\'s result is the very one it was');
  store.derived.closeOther();
  assert.equal(await store.derived.other(), null);
  assert.equal(client.laneStats.other.failed, 0);
  client.close();
});
