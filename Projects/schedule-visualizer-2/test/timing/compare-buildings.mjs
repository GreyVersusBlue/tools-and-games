// The first building comparison, end to end: node test/timing/compare-buildings.mjs
//
// At the size the tool promises to stay responsive at (the fixture in
// test/fixtures/big.mjs: 4 floors of 60 by 40, 150 rooms, 80 groups, 10
// periods, two own day types), on the main thread, through the store and the
// engine client exactly as the scenario lab asks when "Compare the two
// buildings" is pressed (ui/scenarios/buildings.js): the other building held
// and worked out on its own route cache (store.derived.setOther, other()),
// the open project's result already in hand, buildGraph(other) for the map,
// then the comparison and the bands of each side on one shared scale
// (shapeOf), the same function the lab calls.
//
//   first   the whole of that, from setOther to the shape: budget 1.5 s. The
//           parts are printed as well (the other building's cold run, the
//           graph, the comparison and the bands) so a slow one is seen.
//   again   the day type chosen again (shapeOf alone, both results held):
//           median of five, budget 150 ms.
//
// The suite fails at twice a budget (SLACK 2, as every timing file here: a
// CI runner is not this machine) and prints the measured numbers either way.
// The clock is read here, in the test, never in the engine or the lab.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createStore } from '../../engine/store.js';
import { createIds, seededRandom } from '../../engine/ids.js';
import { buildGraph } from '../../engine/graph.js';
import { engineFor } from '../../ui/engine-client.js';
import { shapeOf } from '../../ui/scenarios/buildings.js';
import { bigProject } from '../fixtures/big.mjs';

const FIRST_BUDGET = 1500;
const AGAIN_BUDGET = 150;
const SLACK = 2; // as every timing file here: a CI runner is not this machine
const clock = () => new Date('2026-09-01T12:00:00Z');

async function timed(run) {
  const started = performance.now();
  const value = await run();
  return { ms: performance.now() - started, value };
}

const median = (list) => list.slice().sort((a, b) => a - b)[Math.floor(list.length / 2)];

test('the first comparison of two buildings on the big fixture: under ' + FIRST_BUDGET + ' ms, and the day type chosen again under ' + AGAIN_BUDGET + ' ms', async () => {
  const store = createStore({ project: bigProject({ seed: 1 }), clock, ids: createIds(seededRandom(16)) });
  const client = engineFor(store, { worker: false });
  const main = await store.derived.results();
  const other = bigProject({ seed: 2 });
  const graphA = buildGraph(store.project);

  const started = performance.now();
  store.derived.setOther(other, 'next-year.json');
  const lane = await timed(() => Promise.all([store.derived.other(), store.derived.results()]));
  const [theirs, ours] = lane.value;
  assert.ok(theirs && theirs.result.loads, 'the other building answered');
  assert.equal(ours, main, 'the open project\'s result is the one in hand');
  const graph = await timed(() => buildGraph(other));
  const shape = await timed(() => shapeOf({ project: store.project, graph: graphA, result: ours }, { project: other, graph: graph.value, result: theirs.result }, null));
  const total = performance.now() - started;
  assert.ok(!shape.value.answer.refused, 'the two big projects have a day type in common: ' + (shape.value.answer.sentence || ''));
  assert.ok(shape.value.bands.this.size > 0 && shape.value.bands.other.size > 0, 'both sides have bands');
  assert.equal(client.laneStats.other.sent, 1);

  const again = [];
  for (let i = 0; i < 5; i += 1) {
    const step = await timed(() => shapeOf({ project: store.project, graph: graphA, result: ours }, { project: other, graph: graph.value, result: theirs.result }, shape.value.answer.matched.dayTypeName));
    again.push(step.ms);
  }
  const rerun = median(again);
  console.log('# first comparison: ' + total.toFixed(1) + ' ms (budget ' + FIRST_BUDGET + ', fails at ' + FIRST_BUDGET * SLACK + '): the other building ' + lane.ms.toFixed(1) + ' ms, buildGraph ' + graph.ms.toFixed(1) + ' ms, the comparison and the bands ' + shape.ms.toFixed(1) + ' ms; the day type again: median ' + rerun.toFixed(1) + ' ms of ' + again.map((ms) => ms.toFixed(1)).join(', ') + ' (budget ' + AGAIN_BUDGET + ', fails at ' + AGAIN_BUDGET * SLACK + ')');
  assert.ok(total < FIRST_BUDGET * SLACK, 'the first comparison took ' + total.toFixed(1) + ' ms, over ' + FIRST_BUDGET * SLACK);
  assert.ok(rerun < AGAIN_BUDGET * SLACK, 'choosing the day type again took ' + rerun.toFixed(1) + ' ms, over ' + AGAIN_BUDGET * SLACK);
  store.derived.closeOther();
  assert.equal(await store.derived.other(), null);
  assert.equal(client.laneStats.other.failed, 0);
  client.close();
});
