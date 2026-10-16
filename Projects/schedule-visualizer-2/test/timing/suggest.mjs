// Timing: suggestions for one finding at the size the tool promises to stay
// responsive at (the fixture in test/fixtures/big.mjs: 4 floors of 60 by 40,
// 150 rooms, 80 groups, 10 periods, two own day types). Budget 1000 ms for
// one finding, the two ways a page can ask:
//
//   warm   the pipeline has already worked the project out, as the scenario
//          lane's has (SV2-64): the candidates share its route cache
//   cold   a pipeline of the call's own, from nothing
//
// for a double-booked room, a long walk, a room over capacity and a run of
// consecutive periods, with other teachers' rooms off and on.
//
// Measured by SV2-63 on huginn (2026-10-16), three runs: warm 104 to 439 ms,
// cold 160 to 563 ms; the slowest is the double-booked room, the first one
// measured. The suite fails at twice the
// budget, to leave room for a slow runner, and prints the measured number
// either way. The clock is read here, in the test, never in the engine.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createPipeline } from '../../engine/worker.js';
import { suggest, SUGGESTION_LIMIT } from '../../engine/suggest.js';
import { bigProject } from '../fixtures/big.mjs';

const BUDGET = 1000;
const SLACK = 2;
const KINDS = ['room-double', 'group-walk', 'over-capacity', 'consecutive'];
const VERSIONS = { geometry: 1, building: 1, schedule: 1 };

test('suggestions for one finding on the big fixture: under 1000 ms', () => {
  const project = bigProject({ seed: 1 });
  const pipeline = createPipeline();
  const findings = pipeline.run(project, VERSIONS).findings.findings;
  const lines = [];
  for (const kind of KINDS) {
    const finding = findings.find((one) => one.kind === kind);
    assert.ok(finding, 'the fixture has a ' + kind + ' finding');
    for (const otherTeachersRooms of [false, true]) {
      let started = performance.now();
      const warm = suggest(project, finding, { pipeline, versions: VERSIONS, otherTeachersRooms });
      const warmMs = performance.now() - started;
      started = performance.now();
      const cold = suggest(project, finding, { otherTeachersRooms });
      const coldMs = performance.now() - started;
      lines.push(kind + (otherTeachersRooms ? ' (other rooms on)' : '') + ': warm ' + warmMs.toFixed(1) + ' ms, cold ' + coldMs.toFixed(1) + ' ms, ' + warm.suggestions.length + ' suggestions');
      assert.ok(warm.suggestions.length > 0 && warm.suggestions.length <= SUGGESTION_LIMIT, kind + ': something to offer on the fixture');
      assert.deepEqual(cold.suggestions.map((one) => one.text), warm.suggestions.map((one) => one.text), kind + ': the same answer either way');
      assert.ok(warmMs < BUDGET * SLACK, kind + ' took ' + warmMs.toFixed(1) + ' ms warm, over ' + BUDGET * SLACK);
      assert.ok(coldMs < BUDGET * SLACK, kind + ' took ' + coldMs.toFixed(1) + ' ms cold, over ' + BUDGET * SLACK);
    }
  }
  console.log('# suggestions (budget ' + BUDGET + ', fails at ' + BUDGET * SLACK + '):\n# ' + lines.join('\n# '));
});
