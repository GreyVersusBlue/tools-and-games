// Timing: suggestions for one finding at the size the tool promises to stay
// responsive at (the fixture in test/fixtures/big.mjs: 4 floors of 60 by 40,
// 150 rooms, 80 groups, 10 periods, two own day types). Budget 1000 ms for
// one finding, warm: the pipeline has already worked the project out, as the
// scenario lane's will have (SV2-64). The file fails when any finding here
// takes longer than that warm. It prints the cold time too (a pipeline of
// the call's own, from nothing), which the budget does not cover.
//
// The findings: the first of each kind the fixture has, and the four that
// took longest in SV2-63b's measurement of every finding on the fixture,
// each with other teachers' rooms off and on.
//
// Measured by SV2-63b on huginn (2026-10-16), ten runs of this file: the
// worst warm of each run 571 to 819 ms, the worst cold 645 to 1,059 ms, on a
// machine other jobs were using (load average 4 to 6). The clock is read here, in the
// test, never in the engine.
//
// The second case is the cap: stage 2 of suggest runs at most RUN_TRIES
// candidates a rank. SV2-63b ran every fixable finding on the fixture with
// the cap lifted (1,092 calls, other teachers' rooms off and on): the most
// runs any took was 29, and the lowest cap that gave the same list was at
// most 22, so at 32 no list differs. The case holds the six that needed a
// cap above 16, capped against uncapped, and shows that 16 would change them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createPipeline } from '../../engine/worker.js';
import { suggest, SUGGESTION_LIMIT, RUN_TRIES } from '../../engine/suggest.js';
import { bigProject } from '../fixtures/big.mjs';

const BUDGET = 1000;
const KINDS = ['room-double', 'group-walk', 'over-capacity', 'consecutive'];
const SLOWEST = [
  'room-double:dbig00000b:7:rbig200014',
  'consecutive:dbig00000a:0:tbig000046',
  'consecutive:dbig00000a:5:tbig000033',
  'group-walk:dbig00000b:1:gbig000018',
];
// the lowest cap that gives the uncapped list: 17 to 22
const CAP_NEEDS = [
  'room-double:dbig00000a:4:rbig200015',
  'room-double:dbig00000a:0:rbig200008',
  'room-double:dbig00000a:3:rbig400035',
  'group-walk:dbig00000a:0:gbig000077',
  'group-walk:dbig00000b:0:gbig000063',
  'group-walk:dbig00000b:1:gbig000018',
];
const VERSIONS = { geometry: 1, building: 1, schedule: 1 };

test('suggestions for one finding on the big fixture: under 1000 ms warm', () => {
  const project = bigProject({ seed: 1 });
  const pipeline = createPipeline();
  const findings = pipeline.run(project, VERSIONS).findings.findings;
  const chosen = KINDS.map((kind) => {
    const finding = findings.find((one) => one.kind === kind);
    assert.ok(finding, 'the fixture has a ' + kind + ' finding');
    return finding;
  });
  for (const id of SLOWEST) {
    const finding = findings.find((one) => one.id === id);
    assert.ok(finding, 'the fixture has ' + id);
    chosen.push(finding);
  }
  const lines = [];
  let worstWarm = 0;
  let worstCold = 0;
  for (const finding of chosen) {
    for (const otherTeachersRooms of [false, true]) {
      // the lane's pipeline has the project as it is
      pipeline.run(project, VERSIONS);
      let started = performance.now();
      const warm = suggest(project, finding, { pipeline, versions: VERSIONS, otherTeachersRooms });
      const warmMs = performance.now() - started;
      started = performance.now();
      const cold = suggest(project, finding, { otherTeachersRooms });
      const coldMs = performance.now() - started;
      worstWarm = Math.max(worstWarm, warmMs);
      worstCold = Math.max(worstCold, coldMs);
      lines.push(finding.id + (otherTeachersRooms ? ' (other rooms on)' : '') + ': warm ' + warmMs.toFixed(1) + ' ms, cold ' + coldMs.toFixed(1) + ' ms, ' + warm.suggestions.length + ' suggestions');
      assert.ok(warm.suggestions.length > 0 && warm.suggestions.length <= SUGGESTION_LIMIT, finding.id + ': something to offer on the fixture');
      assert.deepEqual(cold.suggestions.map((one) => one.text), warm.suggestions.map((one) => one.text), finding.id + ': the same answer either way');
      assert.ok(warmMs < BUDGET, finding.id + ' took ' + warmMs.toFixed(1) + ' ms warm, over ' + BUDGET);
    }
  }
  console.log('# suggestions (budget ' + BUDGET + ' ms warm): worst warm ' + worstWarm.toFixed(1) + ' ms, worst cold ' + worstCold.toFixed(1) + ' ms\n# ' + lines.join('\n# '));
});

test('the cap changes no answer on the big fixture: capped and uncapped give the same lists', () => {
  const project = bigProject({ seed: 1 });
  const pipeline = createPipeline();
  const findings = pipeline.run(project, VERSIONS).findings.findings;
  for (const id of CAP_NEEDS) {
    const finding = findings.find((one) => one.id === id);
    assert.ok(finding, 'the fixture has ' + id);
    const options = { pipeline, versions: VERSIONS, otherTeachersRooms: true };
    const texts = (runTries) => suggest(project, finding, { ...options, runTries }).suggestions.map((s) => s.text);
    const uncapped = texts(Infinity);
    assert.notDeepEqual(texts(16), uncapped, id + ': a cap of 16 changes the list, so this case can see a cap');
    assert.deepEqual(texts(undefined), uncapped, id + ': at RUN_TRIES ' + RUN_TRIES + ', the same list as uncapped');
  }
});
