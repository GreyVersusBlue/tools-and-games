// Timing: the schedule checks at the size the tool promises to stay
// responsive at (the fixture in test/fixtures/big.mjs: 4 floors of 60 by 40,
// 150 rooms, 80 groups, 10 periods, two own day types). Spec 3.13 has the
// checks rerun on each keystroke.
//
//   checkSchedule(project, walks) over both day types, the engine call
//   alone: budget 100 ms (ARCHITECTURE 14). The same budget holds for the
//   fixture grown as ARCHITECTURE 17.8 says (test/timing/big-runs.mjs: four
//   own day types and two bell schedules, twelve runs of walk figures). Held on the median of RUNS
//   batches of BATCH calls (each batch's time divided by BATCH), and on the
//   first call of the process, which is the one a person waits for when the
//   page has just loaded.
//
// The routes, the crowd model and the walk results are worked out first and
// are not in the measure (routing.mjs, crowd.mjs and pipeline.mjs have their
// budgets); handing the walk results in is what makes the walk-time kinds
// run, as they do on the page. The suite fails at twice the budget (SLACK 2,
// as every timing file here: a CI runner is not this machine) and prints the
// measured numbers either way. The clock is read here, in the test.

import test from 'node:test';
import assert from 'node:assert/strict';
import { routesForSchedule, routingGraph } from '../../engine/routing.js';
import { simulateSchedule, walkResults } from '../../engine/crowd.js';
import { checkSchedule } from '../../engine/checks.js';
import { validate } from '../../engine/validate.js';
import { ownDayTypes } from '../../engine/day-types.js';
import { routesByRun } from '../../engine/crowd.js';
import { bigProject, BIG } from '../fixtures/big.mjs';
import { bigRunsProject, BIG_RUNS } from './big-runs.mjs';

const BUDGET = 100;
const SLACK = 2;
const BATCH = 3;
const RUNS = 15;

function timed(run) {
  const started = performance.now();
  const value = run();
  return { ms: performance.now() - started, value };
}

test('the schedule checks on the big fixture, both day types: under ' + BUDGET + ' ms', () => {
  const project = bigProject({ seed: 1 });
  const graph = routingGraph(project);
  const routes = routesForSchedule(project, graph);
  const crowd = simulateSchedule(project, routes, graph);
  const walks = walkResults(project, crowd, graph);

  // the first call in this process: nothing has been warmed up
  const cold = timed(() => checkSchedule(project, walks));
  const batches = [];
  for (let run = 0; run < RUNS; run += 1) {
    const started = performance.now();
    for (let i = 0; i < BATCH; i += 1) checkSchedule(project, walks);
    batches.push((performance.now() - started) / BATCH);
  }
  batches.sort((a, b) => a - b);
  const median = batches[Math.floor(batches.length / 2)];
  const again = checkSchedule(project, walks);

  const found = cold.value.findings;
  const kinds = new Map();
  for (const finding of found) kinds.set(finding.kind, (kinds.get(finding.kind) || 0) + 1);
  const days = new Set(found.map((finding) => finding.where && finding.where.dayTypeId).filter(Boolean));
  console.log('# checks, both day types, first call: ' + cold.ms.toFixed(1) + ' ms (budget ' + BUDGET + ', fails at ' + BUDGET * SLACK + ')');
  console.log('# checks, both day types: median ' + median.toFixed(1) + ' ms of ' + RUNS + ' batches of ' + BATCH + ' (budget ' + BUDGET + ', fails at ' + BUDGET * SLACK + '), fastest ' + batches[0].toFixed(1) + ', slowest ' + batches[batches.length - 1].toFixed(1) + '; ' + found.length + ' findings: ' + Array.from(kinds, ([kind, n]) => kind + ' ' + n).join(', '));

  assert.equal(ownDayTypes(project).length, BIG.dayTypes, 'the fixture has two own day types');
  assert.equal(days.size, BIG.dayTypes, 'findings on both day types: ' + Array.from(days).join(', '));
  assert.ok(found.length > 50, 'the fixture really has findings: ' + found.length);
  assert.ok(kinds.has('room-double'), 'the double-booking check found something (the fixture gives each room one teacher, so a teacher is double-booked only through a room)');
  assert.ok(kinds.has('group-walk'), 'the walk-time checks ran on the walk results');
  assert.deepEqual(again, cold.value, 'a second run says what the first did');
  assert.ok(median < BUDGET * SLACK, 'the checks took ' + median.toFixed(1) + ' ms at the median, over ' + BUDGET * SLACK);
  assert.ok(cold.ms < BUDGET * SLACK, 'the first run of the checks took ' + cold.ms.toFixed(1) + ' ms, over ' + BUDGET * SLACK);
});

test('the schedule checks over the twelve runs of the grown fixture: under ' + BUDGET + ' ms', () => {
  const project = bigRunsProject({ seed: 1 });
  const graph = routingGraph(project);
  const crowd = simulateSchedule(project, routesByRun(project, graph), graph);
  const walks = walkResults(project, crowd, graph);
  const first = timed(() => checkSchedule(project, walks));
  const batches = [];
  for (let run = 0; run < RUNS; run += 1) {
    const started = performance.now();
    for (let i = 0; i < BATCH; i += 1) checkSchedule(project, walks);
    batches.push((performance.now() - started) / BATCH);
  }
  batches.sort((a, b) => a - b);
  const median = batches[Math.floor(batches.length / 2)];
  const found = first.value.findings;
  const named = found.filter((finding) => Array.isArray(finding.where.bellsIds));
  console.log('# checks, twelve runs, first (after the case above in this process): ' + first.ms.toFixed(1) + ' ms; median ' + median.toFixed(1) + ' ms of ' + RUNS + ' batches of ' + BATCH + ' (budget ' + BUDGET + ', fails at ' + BUDGET * SLACK + '); ' + found.length + ' findings, ' + named.length + ' of them walks that name a bell schedule; ' + walks.groups.length + ' + ' + walks.bells.groups.length + ' group walks');
  assert.equal(ownDayTypes(project).length, BIG_RUNS.ownDayTypes);
  assert.ok(named.length > 0, 'walks late under a bell schedule are found');
  assert.ok(named.some((finding) => finding.where.bellsIds.length > 1), 'and some are one finding for several runs');
  assert.ok(median < BUDGET * SLACK, 'the checks over twelve runs took ' + median.toFixed(1) + ' ms at the median, over ' + BUDGET * SLACK);
  assert.ok(first.ms < BUDGET * SLACK, 'the first run of them took ' + first.ms.toFixed(1) + ' ms, over ' + BUDGET * SLACK);
});

test('the schedule checks on the big fixture with 90 marks and 60 duties, cold and warm: under ' + BUDGET + ' ms', () => {
  const project = bigProject({ seed: 1 });
  const graph = routingGraph(project);
  const routes = routesForSchedule(project, graph);
  const crowd = simulateSchedule(project, routes, graph);
  const walks = walkResults(project, crowd, graph);
  const own = ownDayTypes(project);
  const periods = project.settings.periods;
  // 90 marks: school lunches and advisories, grade and group marks, a few on one day type
  const kinds = ['lunch', 'advisory', 'activity', 'noclass'];
  project.marks = Array.from({ length: 90 }, (unused, i) => {
    const scope = i % 3 === 0 ? 'school' : i % 3 === 1 ? 'grades' : 'groups';
    return {
      id: 'mbig' + String(i + 1).padStart(6, '0'), kind: kinds[i % 4], label: '', period: i % periods,
      dayTypeIds: i % 2 === 0 ? [] : [own[i % own.length].id], scope,
      grades: scope === 'grades' ? [project.groups[i % project.groups.length].grade] : [],
      groupIds: scope === 'groups' ? [project.groups[i % project.groups.length].id] : [],
    };
  });
  // 60 duties: period, before and after school, for named teachers, a subject, or everyone
  const when = ['period', 'before', 'after'];
  project.duties = Array.from({ length: 60 }, (unused, i) => ({
    id: 'ubig' + String(i + 1).padStart(6, '0'), kind: ['duty', 'meeting', 'lunch'][i % 3], label: '', when: when[i % 3], period: when[i % 3] === 'period' ? (i * 7) % periods : 0,
    start: '', end: '', dayTypeIds: i % 4 === 0 ? [own[i % own.length].id] : [], weekdays: i % 5 === 0 ? [1 + (i % 4)] : [], from: '', to: '', roomId: null, place: '',
    teacherIds: i % 6 === 5 ? [] : [project.teachers[(i * 11) % project.teachers.length].id, project.teachers[(i * 13 + 1) % project.teachers.length].id], subjectIds: [], everyone: false,
  }));
  assert.deepEqual(validate(project), [], 'the marks and duties are valid');

  const cold = timed(() => checkSchedule(project, walks));
  const batches = [];
  for (let run = 0; run < RUNS; run += 1) {
    const started = performance.now();
    for (let i = 0; i < BATCH; i += 1) checkSchedule(project, walks);
    batches.push((performance.now() - started) / BATCH);
  }
  batches.sort((a, b) => a - b);
  const median = batches[Math.floor(batches.length / 2)];
  const found = cold.value.findings;
  const counts = new Map();
  for (const finding of found) counts.set(finding.kind, (counts.get(finding.kind) || 0) + 1);
  console.log('# checks, 90 marks and 60 duties, first call: ' + cold.ms.toFixed(1) + ' ms; median ' + median.toFixed(1) + ' ms of ' + RUNS + ' batches of ' + BATCH + ' (budget ' + BUDGET + ', fails at ' + BUDGET * SLACK + '); ' + found.length + ' findings: ' + Array.from(counts, ([kind, n]) => kind + ' ' + n).join(', '));

  assert.ok(counts.has('duty-nobody'), 'the duty checks ran: a duty with nobody on it is found');
  assert.ok(counts.has('duty-clash') || counts.has('consecutive') || counts.has('no-planning'), 'and the teacher checks that read duties and marks');
  assert.deepEqual(checkSchedule(project, walks), cold.value, 'a second run says what the first did');
  assert.ok(median < BUDGET * SLACK, 'the checks with marks and duties took ' + median.toFixed(1) + ' ms at the median, over ' + BUDGET * SLACK);
  assert.ok(cold.ms < BUDGET * SLACK, 'the first run of them took ' + cold.ms.toFixed(1) + ' ms, over ' + BUDGET * SLACK);
});
