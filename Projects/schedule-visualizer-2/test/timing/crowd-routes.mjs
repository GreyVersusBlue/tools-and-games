// Timing: crowd-aware routes (ARCHITECTURE 23.4, 23.12) on the grown fixture
// (test/timing/big-runs.mjs: 80 groups of 25, 10 periods, four own day types,
// each with its regular bells, Early Release and Assembly, so twelve runs)
// plus one step-free group, which the fixture has none of: a step-free group
// has its own plan, so its searches are the slower kind.
//
//   crowdAwareRun, each of the twelve runs: budget 300 ms a run, failing at
//   600 (SLACK 2). The main lane's results are worked out first and are not in
//   the measure: the lane asks only once it holds them (23.12). The run
//   prints how many searches it made, how many groups it moved and what that
//   saved, so a budget that slips can be told from a rule that changed. Each
//   run is timed twice, and the budget is judged on the faster of the two
//   (the answer is the same both times): one garbage-collection pause on a
//   busy machine took a single run from 130 ms to 500 ms while the work was
//   the same. Both figures are printed, the first as "first".
//
// The clock is read here, in the test, never in the engine. If a case fails,
// run it again alone before judging it: the lane is shared with other
// suites on a busy machine.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createPipeline } from '../../engine/worker.js';
import { crowdAwareRun, CROWD_GROUPS, CROWD_ROUNDS } from '../../engine/crowd-routes.js';
import { runsOf } from '../../engine/runs.js';
import { validate } from '../../engine/validate.js';
import { bigRunsProject, BIG_RUNS } from './big-runs.mjs';

const BUDGET = 300;
const SLACK = 2;

function timed(run) {
  const started = performance.now();
  const value = run();
  return { ms: performance.now() - started, value };
}

test('crowd-aware routes on the grown fixture and a step-free group: every run under 300 ms, failing at 600, searches printed', () => {
  const project = bigRunsProject({ seed: 1 });
  project.groups[0].stepFree = true;
  assert.deepEqual(validate(project), []);
  const results = createPipeline().run(project, { geometry: 1, building: 1, schedule: 1 });
  const runs = runsOf(project);
  assert.equal(runs.length, BIG_RUNS.runs);
  let slowest = 0;
  let moved = 0;
  let searches = 0;
  for (const run of runs) {
    const label = run.dayTypeId + (run.bellsId ? ' · ' + run.bellsId : '');
    const first = timed(() => crowdAwareRun(project, results, null, { dayTypeId: run.dayTypeId, bellsId: run.bellsId }));
    const again = timed(() => crowdAwareRun(project, results, null, { dayTypeId: run.dayTypeId, bellsId: run.bellsId }));
    assert.deepEqual(again.value, first.value, label + ': the same answer twice');
    const answer = { ms: Math.min(first.ms, again.ms) };
    const value = first.value;
    assert.ok(value, label + ' has an answer');
    console.log('# crowd-aware, ' + label + ': ' + answer.ms.toFixed(1) + ' ms, first ' + first.ms.toFixed(1) + ' (budget ' + BUDGET + ', fails at ' + BUDGET * SLACK + '): ' + value.searches + ' searches, ' + value.changed.length + ' ways changed, waiting ' + value.figures.usual.waiting + ' to ' + value.figures.aware.waiting + ' s, groups late ' + value.figures.usual.late + ' to ' + value.figures.aware.late);
    assert.ok(value.rounds.every((round) => round.round <= CROWD_ROUNDS && round.tried <= CROWD_GROUPS));
    assert.ok(value.figures.aware.total <= value.figures.usual.total, 'a run never ends with more total time');
    slowest = Math.max(slowest, answer.ms);
    moved += value.changed.length;
    searches += value.searches;
    assert.ok(answer.ms < BUDGET * SLACK, label + ' took ' + answer.ms.toFixed(1) + ' ms, over ' + BUDGET * SLACK);
  }
  console.log('# crowd-aware, ' + runs.length + ' runs: slowest ' + slowest.toFixed(1) + ' ms, ' + searches + ' searches in all, ' + moved + ' ways changed');
  assert.ok(moved > 0, 'the fixture really jams, and the rule really moves groups');
  assert.ok(searches > 0);
});
