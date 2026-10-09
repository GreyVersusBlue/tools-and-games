// The derived pipeline end to end: node test/timing/pipeline.mjs
//
// Timing, at the size the tool promises to stay responsive at (the fixture in
// test/fixtures/big.mjs: 4 floors of 60 by 40, 150 rooms, 80 groups, 10
// periods, two own day types), on the main thread, through the store and the
// engine client exactly as a screen asks:
//
//   cold       routes, crowd, loads, places, walk results and both lists of
//              findings from nothing: budget 1 s
//   one slot   the same after one group's room in one period has changed:
//              budget 150 ms (the median of five different edits)
//
// The suite fails at twice each budget, to leave room for a slow runner, and
// prints the measured numbers either way. The clock is read here, in the
// test, never in the engine.
//
// What makes those numbers honest (what the pipeline keeps is what a fresh
// run would have worked out, a one-slot change runs two transitions and no
// more, the short answers, the client and the worker's own handler) is
// test/engine/worker.test.mjs, which runs with the plain-Node suites.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createStore } from '../../engine/store.js';
import { createIds, seededRandom } from '../../engine/ids.js';
import * as actions from '../../engine/actions.js';
import { allRooms } from '../../engine/schema.js';
import { engineFor } from '../../ui/engine-client.js';
import { bigProject, BIG } from '../fixtures/big.mjs';

const COLD_BUDGET = 1000;
const EDIT_BUDGET = 150;
const SLACK = 2;
const TRANSITIONS = (BIG.periods - 1) * BIG.dayTypes;
const clock = () => new Date('2026-09-01T12:00:00Z');

function storeOf(project) {
  return createStore({ project, clock, ids: createIds(seededRandom(16)) });
}

// Put group `g` of the big fixture in another room for one period.
function moveGroup(store, g, dayIndex, period, step) {
  const project = store.project;
  const rooms = allRooms(project);
  const group = project.groups[g];
  const dayTypeId = project.dayTypes[dayIndex].id;
  const now = group.days[dayTypeId][period].room;
  let at = (g * 7 + period * 3 + step) % rooms.length;
  if (rooms[at].id === now) at = (at + 1) % rooms.length;
  store.apply(actions.setSlot, { groupId: group.id, dayTypeId, period, slot: { room: rooms[at].id } });
  return { groupId: group.id, dayTypeId, period };
}

async function timed(run) {
  const started = performance.now();
  const value = await run();
  return { ms: performance.now() - started, value };
}

// ---------------------------------------------------------------- timing

test('the big fixture end to end on the main thread: cold under 1 s, a one-slot change under 150 ms', async () => {
  const store = storeOf(bigProject({ seed: 1 }));
  const client = engineFor(store, { worker: false });
  // the first run in this process: nothing has been warmed up
  const cold = await timed(() => store.derived.results());
  const result = cold.value;

  const edits = [];
  for (let i = 0; i < 5; i += 1) {
    moveGroup(store, 5 + i * 13, i % 2, 1 + i, i);
    const edit = await timed(() => store.derived.results());
    assert.equal(edit.value.work.transitionsRun, 2, 'edit ' + i + ' ran ' + edit.value.work.transitionsRun + ' transitions');
    edits.push(edit.ms);
  }
  const sorted = edits.slice().sort((a, b) => a - b);
  const median = sorted[2];

  console.log('# pipeline, cold: ' + cold.ms.toFixed(1) + ' ms (budget ' + COLD_BUDGET + ', fails at ' + COLD_BUDGET * SLACK + '): ' + result.routes.transitions + ' walks routed in ' + result.work.searches + ' searches, ' + result.work.transitionsRun + ' transitions, ' + result.walks.groups.length + ' group walks and ' + result.walks.teachers.length + ' teacher walks timed, ' + result.findings.findings.length + ' findings');
  console.log('# pipeline, one slot changed: median ' + median.toFixed(1) + ' ms of ' + edits.map((ms) => ms.toFixed(1)).join(', ') + ' (budget ' + EDIT_BUDGET + ', fails at ' + EDIT_BUDGET * SLACK + ')');

  assert.equal(result.where, 'main');
  assert.equal(client.where, 'main');
  assert.equal(result.routes.transitions, BIG.groups * TRANSITIONS);
  assert.equal(result.work.transitionsRun, TRANSITIONS);
  assert.ok(result.work.searches > 100, 'cold really searched: ' + result.work.searches);
  assert.ok(result.walks.groups.length > 1000, 'the fixture really walks: ' + result.walks.groups.length);
  assert.ok(result.findings.findings.some((finding) => finding.kind === 'group-walk'), 'and somebody is late');
  assert.ok(cold.ms < COLD_BUDGET * SLACK, 'cold took ' + cold.ms.toFixed(1) + ' ms, over ' + COLD_BUDGET * SLACK);
  assert.ok(median < EDIT_BUDGET * SLACK, 'a one-slot change took ' + median.toFixed(1) + ' ms, over ' + EDIT_BUDGET * SLACK);
  client.close();
});
