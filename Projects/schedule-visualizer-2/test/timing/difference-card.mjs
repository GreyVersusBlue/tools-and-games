// The difference map's card: node test/timing/difference-card.mjs
//
// Timing, at the size the tool promises to stay responsive at (the fixture in
// test/fixtures/big.mjs: 4 floors of 60 by 40, 150 rooms, 80 groups, 10
// periods, two own day types), three moves on two day types, through
// ui/scenarios/difference.js as the scenario lab's card calls it.
//
//   first   the first card after an answer: cardWalks routes the edited
//           groups for both sides (an empty route cache here, the most it
//           can cost) and indexes their cells, then one groupsAt: budget
//           FIRST_CARD ms
//   later   a later card only looks its cell up (groupsAt): the median of
//           RUNS batches of BATCH lookups, each batch's time divided by
//           BATCH, budget LATER_CARD microseconds a lookup
//
// The suite fails at twice the budget (SLACK 2, as every timing file here: a
// CI runner is not this machine) and prints the measured numbers either way.
// The clock is read here, in the test, never in the tool.
//
// Measured by SV2-69c on huginn (2026-10-19), five runs of this file:
// load average 1.6 to 5.3: the first card 45.3 to 65.6 ms, a later card
// 0.70 to 0.82 microseconds a lookup. The budgets are the worst of those,
// rounded up. That a later
// card does no routing and indexes nothing again, without the clock, is
// test/ui/difference.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';

import { cardWalks, groupsAt } from '../../ui/scenarios/difference.js';
import { buildGraph } from '../../engine/graph.js';
import { createRouteCache } from '../../engine/routing.js';
import { allRooms } from '../../engine/schema.js';
import { effectiveSchedule } from '../../engine/day-types.js';
import { bigProject } from '../fixtures/big.mjs';

const FIRST_CARD = 66; // ms
const LATER_CARD = 1; // microseconds a lookup
const SLACK = 2; // as every timing file here: a CI runner is not this machine
const BATCH = 2000;
const RUNS = 21;

// A move for group `g` into a room nobody is in at that period.
function bigMove(project, g, dayIndex, period) {
  const dayTypeId = project.dayTypes[dayIndex].id;
  const used = new Set(project.groups.map((group) => effectiveSchedule(project, group.id, dayTypeId)[period].room));
  const rooms = allRooms(project).filter((room) => !used.has(room.id));
  const room = rooms[(g * 7 + period * 3) % rooms.length];
  return { kind: 'move', dayTypeId, groupId: project.groups[g].id, period, roomId: room.id };
}

test('the difference card on the big fixture: the first under ' + FIRST_CARD + ' ms, a later one under ' + LATER_CARD + ' microseconds', () => {
  const project = bigProject({ seed: 1 });
  const graph = buildGraph(project);
  const changes = [bigMove(project, 3, 0, 4), bigMove(project, 11, 1, 2), bigMove(project, 40, 0, 7)];
  const day = project.dayTypes[0].id;
  let started = performance.now();
  const walks = cardWalks(project, changes, graph, { cache: createRouteCache(16), geometryVersion: 1 });
  const nodes = Array.from(walks.after.get(day).keys());
  groupsAt(walks, nodes[0], day, null);
  const first = performance.now() - started;
  assert.ok(nodes.length > 100, 'the moves walk ' + nodes.length + ' cells');

  let seen = 0; // read, so the lookups are not thrown away
  const batches = [];
  for (let run = 0; run < RUNS; run += 1) {
    started = performance.now();
    for (let i = 0; i < BATCH; i += 1) {
      const apart = groupsAt(walks, nodes[(run * BATCH + i) % nodes.length], day, i % 2 === 0 ? null : 4);
      seen += apart.onlyBefore.length + apart.onlyAfter.length;
    }
    batches.push(((performance.now() - started) * 1000) / BATCH);
  }
  batches.sort((a, b) => a - b);
  const later = batches[(RUNS - 1) / 2];
  assert.ok(seen > 0, 'the lookups found groups apart');
  console.log('# difference card: first ' + first.toFixed(1) + ' ms (budget ' + FIRST_CARD + ', fails at ' + FIRST_CARD * SLACK + '); later ' + later.toFixed(2) + ' microseconds a lookup, median of ' + RUNS + ' batches of ' + BATCH + ' (budget ' + LATER_CARD + ', fails at ' + LATER_CARD * SLACK + ')');
  assert.ok(first <= FIRST_CARD * SLACK, 'the first card took ' + first.toFixed(1) + ' ms, over ' + FIRST_CARD * SLACK);
  assert.ok(later <= LATER_CARD * SLACK, 'a later card took ' + later.toFixed(2) + ' microseconds, over ' + LATER_CARD * SLACK);
});
