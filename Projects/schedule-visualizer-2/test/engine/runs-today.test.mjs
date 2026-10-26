// A project with none of the new fields (no bell schedules, no `sameAs`, no
// calendar, no marks) gives exactly the results it gave before the engines
// worked by run (SV2-76): node test/engine/runs-today.test.mjs
//
// The hashes below were recorded from `sv2` at 6c872439, the commit before
// SV2-76 changed any engine, by running this file with SV2_RUNS_PRINT=1
// inside that commit's tool folder (`git archive 6c872439
// Projects/schedule-visualizer-2` unpacked elsewhere, this file copied in). Each
// is the sha-256 of one result written out in full: every typed array
// element by element, every Map and Set as its entries, keys in the order
// the engine made them. So a renamed field, a field added to a regular run,
// a reordered key or one second of difference anywhere fails the case that
// names it. Only the pipeline's `work` (how much it had to compute, which a
// transition cache keyed on content is meant to lower) is left out, and the
// counts it would hold are checked separately where they matter.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { createStore } from '../../engine/store.js';
import { createIds, seededRandom } from '../../engine/ids.js';
import * as actions from '../../engine/actions.js';
import { routesForSchedule, routingGraph } from '../../engine/routing.js';
import { simulateSchedule, simulateDay, simulateDayTransition, walkResults, teacherWalks } from '../../engine/crowd.js';
import { loads, contributors } from '../../engine/load.js';
import { checkSchedule } from '../../engine/checks.js';
import { ownDayTypes } from '../../engine/day-types.js';
import { createPipeline, pack, scenarioRun, suggestRun } from '../../engine/worker.js';
import { trimResult, compareResults, loadDifference, applyChanges } from '../../engine/scenario.js';
import { sampleSchool } from '../../data/sample-school.js';
import { bigProject } from '../fixtures/big.mjs';

const PRINT = process.env.SV2_RUNS_PRINT === '1';
const clock = () => new Date('2026-09-01T12:00:00Z');

function canonical(value) {
  return JSON.stringify(value, function replace(key, item) {
    if (ArrayBuffer.isView(item)) return { [item.constructor.name]: Array.from(item) };
    if (item instanceof Map) return { Map: Array.from(item.entries()) };
    if (item instanceof Set) return { Set: Array.from(item.values()) };
    if (item === undefined) return { undefined: true };
    return item;
  });
}

function hash(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function withoutWork(result) {
  const { work, ...rest } = result;
  return rest;
}

// The sample school with B Day made "same as A Day" the way a file from
// before `sameAs` says it: own false, nothing else.
function followerSchool() {
  const project = sampleSchool();
  const b = project.dayTypes[1];
  b.own = false;
  for (const group of project.groups) delete group.days[b.id];
  return project;
}

// The sample school with one teacher following 7A from room to room, so
// that there are teachers' walks (the sample has none), one of them late
// against a passing time of 40 seconds.
function walkingTeacherSchool() {
  const project = sampleSchool();
  const teacher = project.teachers[0];
  const group = project.groups.find((one) => one.name === '7A');
  for (const dayType of project.dayTypes) {
    const day = group.days[dayType.id];
    if (!day) continue;
    for (let p = 0; p < day.length; p += 1) day[p] = { ...day[p], teacherIds: [teacher.id] };
  }
  project.dayTypes[0].bells = project.dayTypes[0].bells.map(() => null);
  project.settings.defaultPassingSeconds = 40;
  return project;
}

function scenarioSchool() {
  const project = sampleSchool();
  project.scenario = {
    name: 'Trial',
    changes: [
      { kind: 'move', dayTypeId: 'dsample00a', groupId: 'gsample07c', period: 1, roomId: 'rsample301' },
      { kind: 'swapPeriods', dayTypeId: 'dsample00a', groupId: 'gsample08a', periodA: 5, periodB: 6 },
    ],
    compared: null,
  };
  return project;
}

const RECORDED = {
  'sample school: pipeline': '0291d33e5c9a98b099a513809f9fa5d959dc1c5732ce86b3b32afe7b861137c3',
  'sample school: engines one by one': '5404d2ec5d5165cf592f6c095b9377bbe3d946c28917c114fff3fc349899a658',
  'sample school: one transition and one day': '16099535543cb3c911be672a5e9365a46549db860e883e94b1d1163855a27138',
  'sample school: a one-slot edit kept and packed': '334979613d2e7ae0191af3ab41e1984245ae63f8f7b7d1aab7c060843c728e11',
  'sample school: scenario lane and comparison': 'e205ecbb5d5caf96ae0d43e17f6ce08d0f32e5d2e3331c2f2afc69b6bbb5b9aa',
  'sample school: suggestions for the double booking and the long walk': 'ad893b0e9a33abf9fc109dce9cc3761bb88714df3aba3bebcd2a3aeaa5033f1d',
  'B Day same as A Day, as an older file says it: pipeline': 'da4ea50e951422160fdeb06f144a2999d7e4ee56d19749dc3a5a6809aa7ef9f4',
  'one teacher walking with 7A: pipeline': '7411307f41d50093fd1d644f94b5df3e24530d5ad8b8f52eb262a8588e4a55af',
  'the 3.13 fixture: pipeline': 'dd0294ebe4d807667da8d004b6ad9b3194ab390121226ceb8a26a3642ef843e5',
};

const seen = {};

function agree(name, value) {
  const got = hash(value);
  seen[name] = got;
  if (PRINT) return;
  assert.equal(got, RECORDED[name], name + ': the result is not byte for byte what it was before SV2-76');
}

// The nodes of the first walked route of the first group on A Day.
function crossed(graph, routes) {
  const found = routes.days[0].groups[0].routes.find((one) => one.ok && !one.same);
  return found.cells.map((place) => graph.floors[graph.floorIndex.get(place.floorId)].nodeOfCell[place.cell]);
}

function engines(project) {
  const graph = routingGraph(project);
  const routes = routesForSchedule(project, graph);
  const crowd = simulateSchedule(project, routes, graph);
  const walks = walkResults(project, crowd, graph);
  return {
    routes,
    crowd,
    walks,
    teachers: teacherWalks(project, graph),
    loads: ownDayTypes(project).map((dayType) => loads(project, routes, dayType.id, graph)),
    findings: checkSchedule(project, walks),
    contributors: contributors(project, routes, 'dsample00a', { nodes: crossed(graph, routes) }, graph),
  };
}

test('sample school: pipeline', () => {
  agree('sample school: pipeline', withoutWork(createPipeline().run(sampleSchool())));
});

test('sample school: engines one by one', () => {
  agree('sample school: engines one by one', engines(sampleSchool()));
});

test('sample school: one transition and one day', () => {
  const project = sampleSchool();
  const graph = routingGraph(project);
  const routes = routesForSchedule(project, graph);
  agree('sample school: one transition and one day', {
    transition: simulateDayTransition(project, routes, 'dsample00a', 5, graph),
    followed: simulateDayTransition(project, routes, 'dsample00b', 2, graph),
    day: simulateDay(project, routes, 'dsample00b', graph),
    nothing: [simulateDayTransition(project, routes, 'dnowhere00', 1, graph), simulateDayTransition(project, routes, 'dsample00a', 7, graph), simulateDay(project, routes, 'dnowhere00', graph)],
  });
});

test('sample school: a one-slot edit kept and packed', () => {
  const store = createStore({ project: sampleSchool(), clock, ids: createIds(seededRandom(16)) });
  const pipeline = createPipeline();
  const versions = () => ({ geometry: store.geometryVersion, building: store.buildingVersion, schedule: store.scheduleVersion });
  const first = pipeline.run(store.project, versions());
  store.apply(actions.setSlot, { groupId: 'gsample07c', dayTypeId: 'dsample00a', period: 1, slot: { room: 'rsample301' } });
  const second = pipeline.run(store.project, versions());
  const answer = pack(second, first);
  agree('sample school: a one-slot edit kept and packed', {
    second: withoutWork(second),
    answer: { ...answer, work: null },
    keptCrowd: second.crowd.days.map((day, d) => day.transitions.map((transition, t) => transition === first.crowd.days[d].transitions[t])),
    keptLoads: second.loads.map((load, d) => load === first.loads[d]),
  });
});

test('sample school: scenario lane and comparison', () => {
  const project = scenarioSchool();
  const before = trimResult(createPipeline().run(project));
  const after = scenarioRun(createPipeline(), project, null);
  agree('sample school: scenario lane and comparison', {
    after,
    compare: compareResults(before, after, { changes: project.scenario.changes }),
    oneTransition: compareResults(before, after, { dayTypeId: 'dsample00a', transition: 5, changes: project.scenario.changes }),
    difference: loadDifference(before.loads[0], after.loads[0], { measure: 'busiest' }),
    applied: applyChanges(project).groups.map((group) => group.days),
  });
});

test('sample school: suggestions for the double booking and the long walk', () => {
  const project = sampleSchool();
  const result = createPipeline().run(project);
  const pick = (id) => result.findings.findings.find((finding) => finding.id === id);
  agree('sample school: suggestions for the double booking and the long walk', {
    double: suggestRun(createPipeline(), project, null, pick('room-double:dsample00a:1:rsample203'), {}),
    walk: suggestRun(createPipeline(), project, null, pick('group-walk:dsample00a:5:gsample08a'), { otherTeachersRooms: true }),
  });
});

test('B Day same as A Day, as an older file says it: pipeline', () => {
  agree('B Day same as A Day, as an older file says it: pipeline', withoutWork(createPipeline().run(followerSchool())));
});

test('one teacher walking with 7A: pipeline', () => {
  const result = createPipeline().run(walkingTeacherSchool());
  assert.ok(result.walks.teachers.length > 0 && result.walks.teachers.some((walk) => walk.late), 'the case has teachers\' walks, and a late one');
  agree('one teacher walking with 7A: pipeline', { ...withoutWork(result), engines: engines(walkingTeacherSchool()) });
});

test('the 3.13 fixture: pipeline', () => {
  agree('the 3.13 fixture: pipeline', withoutWork(createPipeline().run(bigProject({ seed: 2 }))));
});

test.after(() => {
  if (PRINT) console.log(JSON.stringify(seen, null, 2));
});
