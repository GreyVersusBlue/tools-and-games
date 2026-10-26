// The engines by run (ARCHITECTURE 17.8): routes, the crowd model, loads,
// the walk checks, the pipeline and its transition cache, the scenario
// comparison and suggestions, for a day type's classes under a bell
// schedule: node test/engine/bell-runs.test.mjs
//
// The school is the invented sample with two bell schedules: Early Release
// (half-hour periods, 3 minutes between them, the last two periods not
// meeting) and Testing (the regular times of A Day, so its figures are the
// regular run's). That a project with no bell schedules is computed exactly
// as before is test/engine/runs-today.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createStore } from '../../engine/store.js';
import { createIds, seededRandom } from '../../engine/ids.js';
import * as actions from '../../engine/actions.js';
import { routingGraph, routesForSchedule } from '../../engine/routing.js';
import { routesByRun, simulateSchedule, simulateDayTransition, simulateTransition, retimeTransition, transitionAs, walkResults, teacherWalks, crowdCap } from '../../engine/crowd.js';
import { loads, contributors } from '../../engine/load.js';
import { places } from '../../engine/places.js';
import { checkSchedule } from '../../engine/checks.js';
import { buildingChecks } from '../../engine/building-checks.js';
import { ownDayTypes } from '../../engine/day-types.js';
import { runsOf } from '../../engine/runs.js';
import { createPipeline, pack, unpack, runResults, scenarioRun } from '../../engine/worker.js';
import { trimResult, compareResults, loadDifference } from '../../engine/scenario.js';
import { suggest } from '../../engine/suggest.js';
import { newAcceptedFinding } from '../../engine/schema.js';
import { splitAccepted } from '../../engine/findings.js';
import { followAcceptedWalks } from '../../engine/checks.js';
import { sampleSchool } from '../../data/sample-school.js';

const A = 'dsample00a';
const B = 'dsample00b';
const ER = 'bsample0er';
const TS = 'bsample0ts';
const G7B = 'gsample07b';
const G8A = 'gsample08a';
const clock = () => new Date('2026-09-01T12:00:00Z');

function time(minutes) {
  return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
}

// Early Release: 08:00 to 08:30, 08:33 to 09:03 … six periods of 30 minutes
// with 3 between, periods 7 and 8 (indexes 6 and 7) not meeting.
function earlyRelease() {
  const bells = [];
  for (let p = 0; p < 8; p += 1) bells.push(p < 6 ? { start: time(480 + 33 * p), end: time(510 + 33 * p) } : null);
  return { id: ER, name: 'Early Release', short: '', bells, off: [6, 7] };
}

function withBells(project) {
  const school = project || sampleSchool();
  school.bellSchedules = [earlyRelease(), { id: TS, name: 'Testing', short: '', bells: school.dayTypes[0].bells.map((bell) => ({ ...bell })), off: [] }];
  return school;
}

// Everything straight from the engines, nothing kept: what a pipeline must
// agree with.
function fresh(project) {
  const graph = routingGraph(project);
  const routes = routesByRun(project, graph);
  const crowd = simulateSchedule(project, routes, graph);
  const walks = walkResults(project, crowd, graph);
  const runs = runsOf(project);
  const bellRuns = runs.filter((run) => run.bellsId !== null);
  return {
    routes: { days: routes.days, bells: routes.bells },
    crowd,
    loads: runs.filter((run) => run.bellsId === null).map((run) => loads(project, routes, run.dayTypeId, graph)),
    bellLoads: bellRuns.length === 0 ? undefined : bellRuns.map((run) => loads(project, routes, run.dayTypeId, graph, run.bellsId)),
    places: places(project, graph),
    walks,
    findings: checkSchedule(project, walks),
    buildingFindings: buildingChecks(project, graph),
  };
}

function parts(result) {
  return {
    routes: { days: result.routes.days, bells: result.routes.bells },
    crowd: result.crowd,
    loads: result.loads,
    bellLoads: result.bellLoads,
    places: result.places,
    walks: result.walks,
    findings: result.findings,
    buildingFindings: result.buildingFindings,
  };
}

function walkOf(list, dayTypeId, groupId, period, bellsId) {
  return list.find((walk) => walk.dayTypeId === dayTypeId && walk.groupId === groupId && walk.period === period && (walk.bellsId || null) === (bellsId || null));
}

// ---------------------------------------------------------------- routes

test('routes by run: the regular runs are routesForSchedule\'s own, the bell-schedule runs reuse their route objects', () => {
  const project = withBells();
  const graph = routingGraph(project);
  const routes = routesByRun(project, graph);
  assert.deepEqual(routes.days, routesForSchedule(project, graph).days);
  assert.deepEqual(routes.bells.map((day) => [day.dayTypeId, day.bellsId]), [[A, ER], [A, TS], [B, ER], [B, TS]]);
  for (const day of routes.bells) {
    const regular = routes.days.find((other) => other.dayTypeId === day.dayTypeId);
    day.groups.forEach((group, g) => {
      group.routes.forEach((found, t) => {
        if (day.bellsId === ER && t >= 5) return;
        assert.equal(found, regular.groups[g].routes[t], 'the very route object: ' + day.dayTypeId + ' ' + day.bellsId + ' ' + group.groupId + ' ' + t);
      });
    });
  }
  assert.equal(routes.transitions, 6 * 8 * 7);
});

test('routes by run: a walk into or out of a period that does not meet is no-room, so nobody walks it', () => {
  const project = withBells();
  const routes = routesByRun(project);
  const day = routes.bells.find((entry) => entry.dayTypeId === A && entry.bellsId === ER);
  for (const group of day.groups) {
    assert.equal(group.routes[5].ok, false);
    assert.equal(group.routes[5].reason, 'no-room');
    assert.equal(group.routes[6].reason, 'no-room');
  }
});

test('routes by run: no bell schedules is no bells field at all', () => {
  const routes = routesByRun(sampleSchool());
  assert.equal('bells' in routes, false);
  assert.deepEqual(Object.keys(routes), ['days', 'transitions', 'pairs', 'searches']);
});

// ---------------------------------------------------------------- crowd

test('retimeTransition: the same walks under another passing time are a simulation under it, with only late changed', () => {
  const project = withBells();
  const graph = routingGraph(project);
  const routes = routesByRun(project, graph);
  const crowd = simulateSchedule(project, routes, graph);
  let compared = 0;
  for (const day of crowd.bells) {
    for (const transition of day.transitions) {
      if (transition.off) continue;
      // simulateDayTransition is handed no regular result, so it simulates
      const simulated = simulateDayTransition(project, routes, day.dayTypeId, transition.period, graph, day.bellsId);
      assert.deepEqual(transition, simulated, day.dayTypeId + ' ' + day.bellsId + ' ' + transition.period);
      compared += 1;
    }
  }
  assert.equal(compared, 2 * 5 + 2 * 7);
  // Early Release's 3 minutes make 7B late after Period 5 on A Day, which it is not with 4
  const regular = crowd.days[0].transitions[4];
  const early = crowd.bells[0].transitions[4];
  assert.equal(walkOf(regular.groups.map((group) => ({ ...group, dayTypeId: A, period: 4 })), A, G7B, 4).late, false);
  assert.equal(early.groups.find((group) => group.groupId === G7B).late, true);
  assert.equal(early.groups.find((group) => group.groupId === G7B).positions, regular.groups.find((group) => group.groupId === G7B).positions, 'shared, not copied');
  assert.equal(early.passingSeconds, 180);
  assert.equal(early.cap, crowdCap(180));
});

test('retimeTransition: a transition in which a group reaches the cap is not retimed, since the cap moves with the passing time', () => {
  const project = sampleSchool();
  project.settings.secondsPerCell = 10; // 8A's walk from the Gym is over 600 seconds now
  const graph = routingGraph(project);
  const routes = routesForSchedule(project, graph);
  const transition = simulateDayTransition(project, routes, A, 5, graph);
  const walker = transition.groups.find((group) => group.groupId === G8A);
  assert.equal(walker.arrived, false, 'stopped at the cap');
  assert.equal(retimeTransition(transition, 300, 0), null);
  const day = routes.days[0];
  const walkers = day.groups.map((group) => ({ id: group.groupId, headCount: project.groups.find((one) => one.id === group.groupId).headCount, route: group.routes[5] }));
  const longer = simulateTransition(graph, walkers, { passingSeconds: 300, marginSeconds: 0 });
  assert.equal(longer.groups.find((group) => group.groupId === G8A).arrived, true, 'with a cap of 900 it arrives: retiming would have said otherwise');
  // the other way: simulated with 400 s (a cap of 1200) every group arrives, and with 200 s (600) 8A is stopped
  const roomy = simulateTransition(graph, walkers, { passingSeconds: 400, marginSeconds: 0 });
  assert.equal(roomy.groups.find((group) => group.groupId === G8A).arrived, true);
  assert.equal(retimeTransition(roomy, 200, 0), null, 'a cap the transition runs past is not retimed');
  assert.equal(simulateTransition(graph, walkers, { passingSeconds: 200, marginSeconds: 0 }).groups.find((group) => group.groupId === G8A).arrived, false);
  assert.deepEqual(retimeTransition(roomy, 350, 0), simulateTransition(graph, walkers, { passingSeconds: 350, marginSeconds: 0 }), 'one it does not is');
  // and a short transition with no walkers at all retimes to anything
  const empty = simulateTransition(graph, [], { passingSeconds: 240 });
  assert.equal(retimeTransition(empty, 100, 0).passingSeconds, 100);
  assert.equal(retimeTransition({ ...empty, off: true }, 100, 0), null);
});

test('transitionAs: the same figures under another run\'s name, the very object when the name is the same', () => {
  const project = withBells();
  const graph = routingGraph(project);
  const routes = routesByRun(project, graph);
  const one = simulateDayTransition(project, routes, A, 2, graph);
  assert.equal(transitionAs(one, A, 2), one);
  assert.equal(transitionAs(one, A, 2, null), one);
  const moved = transitionAs(one, B, 3, ER);
  assert.deepEqual(Object.keys(moved).slice(0, 4), ['dayTypeId', 'bellsId', 'period', 'passingSeconds']);
  assert.equal(moved.groups, one.groups);
  assert.deepEqual({ ...moved, dayTypeId: A, bellsId: undefined, period: 2 }, { ...one, bellsId: undefined });
});

test('simulateSchedule: every bell-schedule run, with the periods that do not meet off, no passing time and nobody walking', () => {
  const project = withBells();
  const crowd = simulateSchedule(project, routesByRun(project));
  assert.deepEqual(crowd.days.map((day) => day.dayTypeId), [A, B]);
  assert.deepEqual(crowd.bells.map((day) => [day.dayTypeId, day.bellsId]), [[A, ER], [A, TS], [B, ER], [B, TS]]);
  const early = crowd.bells[0];
  assert.deepEqual(early.transitions.map((transition) => (transition.off ? 'off' : transition.passingSeconds)), [180, 180, 180, 180, 180, 'off', 'off']);
  for (const transition of early.transitions.slice(5)) {
    assert.equal(transition.passingSeconds, null);
    assert.deepEqual(transition.groups, []);
    assert.equal(transition.bellsId, ER);
  }
  // Testing rings A Day's regular times, so its runs are the regular figures
  const testing = crowd.bells[1];
  testing.transitions.forEach((transition, t) => assert.deepEqual({ ...transition, bellsId: undefined }, { ...crowd.days[0].transitions[t], bellsId: undefined }));
  assert.equal('bells' in simulateSchedule(sampleSchool(), routesByRun(sampleSchool())), false);
});

// ARCHITECTURE 17.3: an off period moves nobody, and that holds in the
// middle of the day too. The walk from Period 2's room to Period 4's room,
// around an off Period 3, is not simulated: both transitions are off.
test('a middle off period moves nobody: the walk from Period 2\'s room to Period 4\'s room is not simulated', () => {
  const project = sampleSchool();
  project.bellSchedules = [{ id: ER, name: 'Assembly', short: '', bells: project.dayTypes[0].bells.map((bell) => (bell ? { ...bell } : null)), off: [2] }];
  const result = createPipeline().run(project);
  assert.deepEqual(result.crowd, fresh(project).crowd);
  for (const day of result.crowd.bells) {
    assert.deepEqual(day.transitions.map((transition) => transition.off === true), [false, true, true, false, false, false, false], day.dayTypeId);
    for (const transition of day.transitions.slice(1, 3)) {
      assert.deepEqual(transition.groups, []);
      assert.equal(transition.passingSeconds, null);
    }
  }
  // no walk figure into or out of Period 3, nor one from Period 2 to Period 4
  const early = result.walks.bells.groups.filter((walk) => walk.bellsId === ER);
  assert.ok(early.length > 0);
  assert.deepEqual(early.filter((walk) => walk.period === 1 || walk.period === 2), []);
  // and a group whose Period 2 and Period 4 rooms differ has no late walk between them under Assembly
  assert.equal(result.findings.findings.some((finding) => finding.kind === 'group-walk' && Array.isArray(finding.where.bellsIds) && finding.where.bellsIds.includes(ER) && (finding.where.period === 1 || finding.where.period === 2)), false);
});

test('walkResults: the bell-schedule runs\' walks are in bells, each with its bellsId; the regular lists are as without them', () => {
  const project = withBells();
  const graph = routingGraph(project);
  const crowd = simulateSchedule(project, routesByRun(project, graph), graph);
  const walks = walkResults(project, crowd, graph);
  const plain = walkResults(sampleSchool(), simulateSchedule(sampleSchool(), routesByRun(sampleSchool(), graph), graph), graph);
  assert.deepEqual(walks.groups, plain.groups);
  assert.deepEqual(walks.teachers, plain.teachers);
  assert.ok(walks.bells.groups.every((walk) => walk.bellsId === ER || walk.bellsId === TS));
  assert.deepEqual(Object.keys(walks.bells.groups[0]).slice(0, 3), ['dayTypeId', 'bellsId', 'groupId']);
  assert.equal(walks.bells.groups.some((walk) => walk.bellsId === ER && walk.period >= 5), false, 'nobody walks into or out of a period that does not meet');
  assert.equal(walkOf(walks.bells.groups, A, G7B, 4, ER).late, true);
  assert.equal(walkOf(walks.groups, A, G7B, 4).late, false);
});

// A teacher follows 7A from room to room all day, on both day types.
function walkingTeacher(project) {
  const teacher = project.teachers[0];
  const group = project.groups.find((one) => one.name === '7A');
  for (const dayType of project.dayTypes) {
    const day = group.days[dayType.id];
    for (let p = 0; p < day.length; p += 1) day[p] = { ...day[p], teacherIds: [teacher.id] };
  }
  return teacher;
}

test('teacherWalks with bells: each bell-schedule run, timed against its passing time, with no walk into a period that does not meet', () => {
  const project = withBells();
  const teacher = walkingTeacher(project);
  const graph = routingGraph(project);
  const regular = teacherWalks(project, graph);
  const bells = teacherWalks(project, graph, { bells: true });
  assert.ok(regular.length > 0);
  assert.ok(bells.every((walk) => walk.teacherId === teacher.id && typeof walk.bellsId === 'string'));
  for (const walk of regular) {
    const testing = bells.find((other) => other.bellsId === TS && other.dayTypeId === walk.dayTypeId && other.period === walk.period);
    assert.equal(testing.walking, walk.walking);
    const early = bells.find((other) => other.bellsId === ER && other.dayTypeId === walk.dayTypeId && other.period === walk.period);
    if (walk.period >= 5) assert.equal(early, undefined, 'period ' + walk.period);
    else assert.equal(early.passingSeconds, 180);
  }
});

// ---------------------------------------------------------------- loads

test('loads of a bell-schedule run: the regular run\'s in the transitions that meet, nothing in those that do not', () => {
  const project = withBells();
  const graph = routingGraph(project);
  const routes = routesByRun(project, graph);
  const regular = loads(project, routes, A, graph);
  const early = loads(project, routes, A, graph, ER);
  assert.equal(early.bellsId, ER);
  assert.equal('bellsId' in regular, false);
  for (let t = 0; t < 7; t += 1) {
    if (t < 5) assert.deepEqual(early.cells.byTransition[t], regular.cells.byTransition[t], 'transition ' + t);
    else assert.ok(early.cells.byTransition[t].every((value) => value === 0), 'transition ' + t);
  }
  assert.ok(early.max.total < regular.max.total);
  // B Day the same as A Day: answered from A Day's run under the same bells
  const followed = withBells();
  followed.dayTypes[1] = { ...followed.dayTypes[1], own: false, sameAs: A };
  const followedRoutes = routesByRun(followed, graph);
  assert.deepEqual(loads(followed, followedRoutes, B, graph, ER), loads(followed, followedRoutes, A, graph, ER));
  assert.equal(loads(project, routes, A, graph, 'bnowhere00'), null);
  // who crosses a cell in a transition that does not meet: nobody
  const cell = routes.days[0].groups.find((group) => group.groupId === G8A).routes[5].cells[3];
  const node = graph.floors[graph.floorIndex.get(cell.floorId)].nodeOfCell[cell.cell];
  assert.ok(contributors(project, routes, A, { nodes: [node] }, graph, { period: 5 }).length > 0);
  assert.deepEqual(contributors(project, routes, A, { nodes: [node] }, graph, { period: 5, bellsId: ER }), []);
});

// ---------------------------------------------------------------- checks

function findingsOf(project) {
  return createPipeline().run(project).findings;
}

test('walk-late under a bell schedule with a shorter passing time names the run, and its id gains the schedule', () => {
  const checked = findingsOf(withBells());
  const finding = checked.findings.find((one) => one.id === 'group-walk:' + A + ':4:' + G7B + ':' + ER);
  assert.ok(finding, 'the finding is there');
  assert.equal(finding.text, '7B needs 3 min 8 s to get from Cafeteria to Room 302 after Period 5 on A Day with Early Release bells, 23 s of it waiting in crowded corridors, and the passing time is 3 min.');
  assert.deepEqual(finding.where, { dayTypeId: A, period: 4, groupIds: [G7B], roomId: 'rsample302', teacherId: null, bellsIds: [ER] });
  // not late with the regular 4 minutes: no finding without the schedule
  assert.equal(findingsOf(sampleSchool()).findings.some((one) => one.id.startsWith('group-walk:' + A + ':4:' + G7B)), false);
});

test('late under the regular bells and a schedule alike: one finding naming both, with the regular run\'s id, so an acceptance stands', () => {
  const project = withBells();
  const checked = findingsOf(project);
  const walks = checked.findings.filter((one) => one.kind === 'group-walk' && one.where.groupIds[0] === G8A);
  assert.equal(walks.length, 1);
  assert.equal(walks[0].id, 'group-walk:' + A + ':5:' + G8A);
  assert.equal(walks[0].text, '8A needs 4 min 21 s to get from Gym to Room 303 after Period 6 on A Day, regular and Testing bells, and the passing time is 4 min.');
  assert.deepEqual(walks[0].where.bellsIds, [null, TS]);
  // accepted before there were bell schedules, it is still accepted
  const accepted = withBells();
  accepted.accepted = [newAcceptedFinding('group-walk:' + A + ':5:' + G8A, 'The gym is far', '2026-09-01T12:00:00.000Z', [G8A])];
  const after = findingsOf(accepted);
  assert.equal(after.findings.some((one) => one.id === 'group-walk:' + A + ':5:' + G8A), false);
  assert.equal(after.accepted.some((one) => one.id === 'group-walk:' + A + ':5:' + G8A), true);
});

// Accepting a walk late only under bell schedules (ARCHITECTURE 17.8, the
// Foreman's rule after SV2-76's review): the id keeps naming the first
// schedule in the project's order, and a record naming schedule X stays
// accepted while the walk is late under X and not under the regular bells,
// whatever the id is today; the finding is listed under the record's id.
const YL = 'bsample0yy';
function twoAlike(order) {
  const project = sampleSchool();
  const yellow = { ...earlyRelease(), id: YL, name: 'Yellow' };
  project.bellSchedules = order === 'yellow first' ? [yellow, earlyRelease()] : [earlyRelease(), yellow];
  return project;
}
const LATE_7B = 'group-walk:' + A + ':4:' + G7B;
const accept = (project, id) => {
  project.accepted = [newAcceptedFinding(id, 'Early Release only', '2026-09-01T12:00:00.000Z', [G7B])];
  return project;
};
const walksOf7B = (checked) => checked.findings.concat(checked.accepted).filter((one) => one.id.startsWith(LATE_7B));

test('an accepted walk late only under bell schedules stays accepted when the schedules are reordered', () => {
  const before = findingsOf(accept(twoAlike('early first'), LATE_7B + ':' + ER));
  assert.deepEqual(walksOf7B(before).map((one) => [one.id, Boolean(one.accepted)]), [[LATE_7B + ':' + ER, true]]);
  const after = findingsOf(accept(twoAlike('yellow first'), LATE_7B + ':' + ER));
  // the id today would name Yellow; it is listed under the record's
  assert.deepEqual(walksOf7B(after).map((one) => [one.id, Boolean(one.accepted)]), [[LATE_7B + ':' + ER, true]]);
  assert.deepEqual(after.accepted.find((one) => one.id.startsWith(LATE_7B)).where.bellsIds, [YL, ER]);
  assert.deepEqual(after.gone, []);
  assert.deepEqual(after.changed, []);
});

test('an accepted walk naming the second schedule stays accepted while the first is there and after it is deleted', () => {
  // accepted as Yellow's (Yellow was first, or alone), Early Release now first
  const project = accept(twoAlike('early first'), LATE_7B + ':' + YL);
  const both = findingsOf(project);
  assert.deepEqual(walksOf7B(both).map((one) => [one.id, Boolean(one.accepted)]), [[LATE_7B + ':' + YL, true]]);
  project.bellSchedules = project.bellSchedules.filter((schedule) => schedule.id !== ER);
  const deleted = findingsOf(project);
  assert.deepEqual(walksOf7B(deleted).map((one) => [one.id, Boolean(one.accepted)]), [[LATE_7B + ':' + YL, true]]);
  assert.deepEqual(deleted.gone, []);
});

test('an accepted walk naming a schedule that is deleted is gone, though the walk is late under another', () => {
  const project = accept(twoAlike('early first'), LATE_7B + ':' + ER);
  project.bellSchedules = project.bellSchedules.filter((schedule) => schedule.id !== ER);
  const checked = findingsOf(project);
  assert.deepEqual(walksOf7B(checked).map((one) => [one.id, Boolean(one.accepted)]), [[LATE_7B + ':' + YL, false]]);
  assert.deepEqual(checked.gone.map((record) => record.findingId), [LATE_7B + ':' + ER]);
});

test('an accepted walk late only under a schedule counts again once it is late under the regular bells too (acceptance lost by design)', () => {
  const project = accept(twoAlike('early first'), LATE_7B + ':' + ER);
  // A Day's regular bells as Early Release's for the first six periods: 3 minutes between them
  const a = project.dayTypes.find((dayType) => dayType.id === A);
  a.bells = a.bells.map((bell, p) => (p < 6 ? { ...earlyRelease().bells[p] } : { start: time(480 + 33 * p), end: time(510 + 33 * p) }));
  const checked = findingsOf(project);
  const found = walksOf7B(checked);
  assert.deepEqual(found.map((one) => [one.id, Boolean(one.accepted)]), [[LATE_7B, false]]);
  assert.deepEqual(found[0].where.bellsIds, [null, ER, YL]);
  assert.deepEqual(checked.gone.map((record) => record.findingId), [LATE_7B + ':' + ER]);
});

test('followAcceptedWalks and splitAccepted: a teacher-walk record follows the walk the same way, one record for one finding', () => {
  const finding = (id, bellsIds) => ({ id, kind: 'teacher-walk', severity: 'warning', where: { dayTypeId: A, period: 2, groupIds: [], roomId: null, teacherId: 'tsample001', bellsIds }, about: ['tsample001'] });
  const record = (id) => ({ findingId: id, reason: 'ok', at: '2026-09-01T12:00:00.000Z', about: ['tsample001'] });
  const base = 'teacher-walk:' + A + ':2:tsample001';
  const split = (findings, records) => splitAccepted(followAcceptedWalks(findings, records), records, {});
  const one = split([finding(base + ':' + YL, [YL, ER])], [record(base + ':' + ER)]);
  assert.deepEqual(one.accepted.map((f) => f.id), [base + ':' + ER]);
  assert.deepEqual(one.findings, []);
  // not when the record's schedule is not among the runs
  const other = split([finding(base + ':' + YL, [YL])], [record(base + ':' + ER)]);
  assert.deepEqual(other.findings.map((f) => f.id), [base + ':' + YL]);
  assert.deepEqual(other.gone.map((r) => r.findingId), [base + ':' + ER]);
  // a finding already accepted under its own id is not taken by a second record
  const two = split([finding(base + ':' + YL, [YL, ER])], [record(base + ':' + YL), record(base + ':' + ER)]);
  assert.deepEqual(two.accepted.map((f) => f.id), [base + ':' + YL]);
  assert.deepEqual(two.gone.map((r) => r.findingId), [base + ':' + ER]);
  // nothing to follow: the very list
  const list = [finding(base + ':' + YL, [YL])];
  assert.equal(followAcceptedWalks(list, []), list);
});

test('late under two runs with different figures: the first run\'s sentence, then the other\'s figures in one of their own', () => {
  const project = withBells();
  // Testing with 3 minutes before Period 7: 8A is later against it than against the regular 4
  const testing = project.bellSchedules[1];
  testing.bells = testing.bells.map((bell, p) => (p === 6 ? { start: '13:11', end: '14:00' } : bell));
  const walk = findingsOf(project).findings.find((one) => one.kind === 'group-walk' && one.where.groupIds[0] === G8A);
  assert.equal(walk.id, 'group-walk:' + A + ':5:' + G8A);
  assert.equal(walk.text, '8A needs 4 min 21 s to get from Gym to Room 303 after Period 6 on A Day, and the passing time is 4 min. With Testing bells it needs 4 min 21 s, and the passing time is 3 min.');
  assert.deepEqual(walk.where.bellsIds, [null, TS]);
});

test('a walk figure for a schedule the project no longer has, or against another passing time, is passed over', () => {
  const project = withBells();
  const graph = routingGraph(project);
  const walks = walkResults(project, simulateSchedule(project, routesByRun(project, graph), graph), graph);
  const late = walkOf(walks.bells.groups, A, G7B, 4, ER);
  const only = (entries) => checkSchedule(project, { groups: [], teachers: [], bells: { groups: entries, teachers: [] } }).findings.filter((one) => one.kind === 'group-walk');
  assert.equal(only([late]).length, 1);
  assert.equal(only([{ ...late, bellsId: 'bnowhere00' }]).length, 0);
  assert.equal(only([{ ...late, passingSeconds: 240 }]).length, 0);
  assert.equal(only([{ ...late, bellsId: undefined }]).length, 0);
  // a figure for a period that does not meet under the schedule says nothing
  assert.equal(only([{ ...walkOf(walks.groups, A, G8A, 5), bellsId: ER, passingSeconds: null }]).length, 0);
});

test('teacher-walk under bell schedules: one finding for the runs it is late in, the regular id, alike runs in one sentence', () => {
  const project = sampleSchool();
  walkingTeacher(project);
  // no times on the day types: the regular runs use the default passing time, 40 s
  for (const dayType of project.dayTypes) dayType.bells = dayType.bells.map(() => null);
  project.settings.defaultPassingSeconds = 40;
  // Early Release: 1 minute between periods, the last two not meeting; Testing: no times, so 40 s too
  const bells = [];
  for (let p = 0; p < 8; p += 1) bells.push(p < 6 ? { start: time(480 + 31 * p), end: time(510 + 31 * p) } : null);
  project.bellSchedules = [{ id: ER, name: 'Early Release', short: '', bells, off: [6, 7] }, { id: TS, name: 'Testing', short: '', bells: bells.map(() => null), off: [] }];
  const walks = findingsOf(project).findings.filter((one) => one.kind === 'teacher-walk' && one.where.dayTypeId === A);
  assert.deepEqual(walks.map((walk) => [walk.id, walk.where.bellsIds]), [
    ['teacher-walk:' + A + ':4:tsample001', [null, ER, TS]],
    ['teacher-walk:' + A + ':5:tsample001', [null, TS]],
    ['teacher-walk:' + A + ':6:tsample001', [null, TS]],
  ]);
  assert.equal(walks[0].text, 'Ms. Halloran needs 1 min 15 s to walk from Cafeteria to Room 201 after Period 5 on A Day, regular and Testing bells, before any crowding, and the passing time is 40 s. With Early Release bells it needs 1 min 15 s, and the passing time is 1 min.');
  // Period 6 into 7 does not meet under Early Release: not named there
  assert.equal(walks[1].text, 'Ms. Halloran needs 45 s to walk from Room 201 to Room 203 after Period 6 on A Day, regular and Testing bells, before any crowding, and the passing time is 40 s.');
  // late only under Early Release (the regular runs and Testing have 2 minutes now): the id gains the schedule
  project.settings.defaultPassingSeconds = 120;
  const gained = findingsOf(project).findings.filter((one) => one.kind === 'teacher-walk');
  assert.deepEqual(gained.map((walk) => walk.id), [A + ':4', B + ':2', B + ':4'].map((at) => 'teacher-walk:' + at + ':tsample001:' + ER));
  for (const walk of gained) {
    assert.deepEqual(walk.where.bellsIds, [ER]);
    assert.match(walk.text, / with Early Release bells, before any crowding, and the passing time is 1 min\.$/);
  }
});

test('findings name the day types the same as a day type that is not the base: C Day the same as B Day is named with B Day', () => {
  const project = sampleSchool();
  project.dayTypes.push({ id: 'dsample00c', name: 'C Day', own: false, sameAs: B, short: '', bells: project.dayTypes[0].bells.map(() => null) });
  project.dayTypes.push({ id: 'dsample00d', name: 'D Day', own: false, sameAs: null, short: '', bells: project.dayTypes[0].bells.map(() => null) });
  // 6B in 6A's room in Period 1 on B Day, for a finding on B Day
  const six = (name) => project.groups.find((one) => one.name === name);
  six('6B').days[B][0] = { ...six('6B').days[B][0], room: six('6A').days[B][0].room };
  const findings = findingsOf(project).findings;
  const onB = findings.filter((one) => one.where.dayTypeId === B);
  const onA = findings.filter((one) => one.where.dayTypeId === A);
  assert.ok(onB.length > 0 && onA.length > 0);
  for (const finding of onB) assert.match(finding.text, /on B Day and C Day/, finding.id);
  for (const finding of onA) {
    if (/ on A Day/.test(finding.text)) assert.match(finding.text, /on A Day and D Day/, finding.id);
    assert.doesNotMatch(finding.text, /C Day/, finding.id);
  }
  assert.equal(findings.some((one) => one.where.dayTypeId === 'dsample00c' || one.where.dayTypeId === 'dsample00d'), false, 'a follower has no findings of its own');
});

// ---------------------------------------------------------------- the pipeline

function storeOf(project) {
  return createStore({ project, clock, ids: createIds(seededRandom(16)) });
}

function versionsOf(store) {
  return { geometry: store.geometryVersion, building: store.buildingVersion, schedule: store.scheduleVersion };
}

test('with bell schedules, what the pipeline keeps is what a fresh run works out, after every kind of change', () => {
  const store = storeOf(withBells());
  const pipeline = createPipeline();
  const check = (label) => {
    const result = pipeline.run(store.project, versionsOf(store));
    assert.deepEqual(parts(result), fresh(store.project), label);
    return result;
  };
  check('cold');
  store.apply(actions.setSlot, { groupId: G7B, dayTypeId: A, period: 4, slot: { room: 'rsample301' } });
  check('one slot');
  store.apply(actions.setSetting, { key: 'checks.passingMarginSeconds', value: 30 });
  check('the margin');
  store.apply(actions.setSetting, { key: 'secondsPerCell', value: 4 });
  check('the walking speed, which moves the cap past some walks');
  store.apply(actions.editGroup, { id: G8A, headCount: 61 });
  check('a head count');
  store.apply(actions.setBellSchedule, { bellScheduleId: ER, off: [5, 6, 7] });
  check('another period that does not meet');
  store.apply(actions.deleteBellSchedule, { bellScheduleId: TS });
  check('a schedule deleted');
  store.apply(actions.deleteBellSchedule, { bellScheduleId: ER });
  const last = check('the last schedule deleted');
  assert.equal('bells' in last.crowd, false);
  assert.equal('bellLoads' in last, false);
});

test('the transition cache keys on content: a schedule ringing the regular times adds no simulation, one with other times only retimes', () => {
  const plain = createPipeline().run(sampleSchool());
  const project = sampleSchool();
  project.bellSchedules = [{ id: TS, name: 'Testing', short: '', bells: project.dayTypes[0].bells.map((bell) => ({ ...bell })), off: [] }];
  const testing = createPipeline().run(project);
  assert.equal(testing.work.transitions, plain.work.transitions * 2);
  assert.equal(testing.work.transitionsRun, plain.work.transitionsRun, 'every Testing transition is a regular one');
  const both = createPipeline().run(withBells());
  // Early Release meets in five transitions a day, retimed; its two that do not meet are one empty result
  assert.equal(both.work.transitions, plain.work.transitions * 3);
  assert.equal(both.work.transitionsRun, plain.work.transitionsRun + 1);
  // the off transition is computed once and named for each run and period
  const offs = both.crowd.bells.flatMap((day) => day.transitions.filter((transition) => transition.off));
  assert.equal(offs.length, 4);
  assert.equal(new Set(offs.map((transition) => transition.groups)).size, 1);
});

// A school where nobody moves from Period 6 to Period 7 under the regular
// bells (every group's Period 7 is its Period 6), with Early Release, whose
// Periods 7 and 8 do not meet: the regular transition and Early Release's
// off one both have nobody walking, and the off one is still off.
function stillAfterSix() {
  const project = withBells();
  for (const group of project.groups) {
    for (const day of Object.values(group.days)) if (Array.isArray(day) && day[5]) day[6] = { ...day[5] };
  }
  return project;
}

test('an off transition is never a met one retimed, even when the met one moves nobody', () => {
  const project = stillAfterSix();
  const graph = routingGraph(project);
  const routes = routesByRun(project, graph);
  const crowd = simulateSchedule(project, routes, graph);
  assert.deepEqual(crowd.days[0].transitions[5].groups.filter((group) => group.walking > 0), [], 'nobody walks after Period 6 with the regular bells');
  const result = createPipeline().run(project);
  assert.deepEqual(result.crowd, crowd);
  const early = result.crowd.bells.find((day) => day.dayTypeId === A && day.bellsId === ER);
  for (const transition of early.transitions.slice(5)) {
    assert.equal(transition.off, true, 'period ' + transition.period);
    assert.equal(transition.passingSeconds, null);
  }
  // and retimeTransition takes no passing time that is not a number
  const empty = simulateTransition(graph, [], { passingSeconds: 240 });
  assert.equal(retimeTransition(empty, 'off', 0), null);
  assert.equal(retimeTransition(empty, null, 0), null);
  assert.equal(retimeTransition(empty, undefined, 0), null);
});

// The pipeline against a simulation from nothing that does not retime
// (simulateDayTransition is handed no regular result), transition by
// transition: not simulateSchedule, which retimes as the pipeline does.
test('every bell-run transition the pipeline gives is what simulating it from nothing gives', () => {
  const slow = withBells();
  slow.settings.secondsPerCell = 10; // some groups reach the cap
  for (const [label, project] of [['two schedules', withBells()], ['nobody moving after Period 6', stillAfterSix()], ['walks reaching the cap', slow]]) {
    const graph = routingGraph(project);
    const routes = routesByRun(project, graph);
    const result = createPipeline().run(project);
    let compared = 0;
    for (const day of result.crowd.bells) {
      for (const transition of day.transitions) {
        assert.deepEqual(transition, simulateDayTransition(project, routes, day.dayTypeId, transition.period, graph, day.bellsId), label + ': ' + day.dayTypeId + ' ' + day.bellsId + ' ' + transition.period);
        compared += 1;
      }
    }
    assert.equal(compared, 4 * 7, label);
  }
});

test('the transition cache: one changed slot runs the regular transitions into and out of it, and the bell runs only retime', () => {
  const store = storeOf(withBells());
  const pipeline = createPipeline();
  const first = pipeline.run(store.project, versionsOf(store));
  store.apply(actions.setSlot, { groupId: G7B, dayTypeId: A, period: 2, slot: { room: 'rsample301' } });
  const second = pipeline.run(store.project, versionsOf(store));
  assert.equal(second.work.transitionsRun, 2);
  // what did not change is the very object it was
  const kept = (a, b) => a.transitions.filter((transition, t) => transition === b.transitions[t]).length;
  assert.equal(kept(second.crowd.days[1], first.crowd.days[1]), 7);
  assert.equal(kept(second.crowd.days[0], first.crowd.days[0]), 5);
  assert.equal(kept(second.crowd.bells[0], first.crowd.bells[0]), 5);
  assert.equal(second.crowd.bells[2], first.crowd.bells[2], 'B Day with Early Release is untouched');
  assert.equal(second.bellLoads[2], first.bellLoads[2]);
  // and a change of passing time alone, under a schedule, simulates nothing
  store.apply(actions.setBellSchedule, { bellScheduleId: ER, period: 2, bell: { start: '09:07', end: '09:36' } });
  const third = pipeline.run(store.project, versionsOf(store));
  assert.equal(third.work.transitionsRun, 0);
  assert.equal(third.crowd.bells[0].transitions[1].passingSeconds, 240);
  assert.deepEqual(parts(third), fresh(store.project));
});

test('a packed answer carries the bell-schedule runs, leaves out what was sent, and unpacks to the whole result', () => {
  const store = storeOf(withBells());
  const pipeline = createPipeline();
  const first = pipeline.run(store.project, versionsOf(store));
  const firstAnswer = unpack(structuredClone(pack(first, null)), null);
  assert.deepEqual(parts(firstAnswer), parts(first));
  store.apply(actions.setSlot, { groupId: G7B, dayTypeId: B, period: 3, slot: { room: 'rsample301' } });
  const second = pipeline.run(store.project, versionsOf(store));
  const answer = pack(second, first);
  assert.deepEqual(answer.crowdBells.map((day) => day.transitions.filter((transition) => transition !== null).length), [0, 0, 2, 2]);
  assert.deepEqual(answer.bellLoads.map((load) => load.kept === true), [true, true, false, false]);
  const sent = unpack(structuredClone(answer), firstAnswer);
  assert.deepEqual(parts(sent), parts(second));
  assert.equal(sent.crowd.bells[0], firstAnswer.crowd.bells[0], 'a run with nothing new is the run this side already has');
  assert.throws(() => unpack(structuredClone(answer), null), /never had/);
});

test('pack and unpack across adding the first bell schedule and deleting the last one', () => {
  const store = storeOf(sampleSchool());
  const pipeline = createPipeline();
  const first = pipeline.run(store.project, versionsOf(store));
  let had = unpack(structuredClone(pack(first, null)), null);
  assert.deepEqual(parts(had), parts(first));
  let previous = first;
  const next = (label) => {
    const result = pipeline.run(store.project, versionsOf(store));
    const answer = pack(result, previous);
    const sent = unpack(structuredClone(answer), had);
    assert.deepEqual(parts(sent), parts(result), label);
    assert.deepEqual(parts(result), fresh(store.project), label + ': as a fresh run');
    had = sent;
    previous = result;
    return { result, answer, sent };
  };
  store.apply(actions.addBellSchedule, { name: 'Early Release' });
  const added = next('the first schedule added');
  assert.equal(added.sent.crowd.bells.length, 2);
  assert.equal(added.sent.bellLoads.length, 2);
  assert.equal(added.answer.crowdBells.length, 2, 'the new runs are sent');
  const id = store.project.bellSchedules[0].id;
  store.apply(actions.setBellSchedule, { bellScheduleId: id, off: [6, 7] });
  next('periods that do not meet');
  store.apply(actions.deleteBellSchedule, { bellScheduleId: id });
  const removed = next('the last schedule deleted');
  assert.equal('bells' in removed.sent.crowd, false);
  assert.equal('bellLoads' in removed.sent, false);
  assert.equal('bells' in removed.sent.routes, false);
  assert.equal('crowdBells' in removed.answer, false);
  // and added again, against an answer that had none
  store.apply(actions.addBellSchedule, { name: 'Testing' });
  const again = next('a schedule added again');
  assert.equal(again.sent.crowd.bells.length, 2);
});

test('runResults picks one run\'s parts out of a result', () => {
  const result = createPipeline().run(withBells());
  const regular = runResults(result, A);
  assert.equal(regular.routes, result.routes.days[0]);
  assert.equal(regular.crowd, result.crowd.days[0]);
  assert.equal(regular.loads, result.loads[0]);
  assert.ok(regular.walks.groups.length > 0 && regular.walks.groups.every((walk) => walk.dayTypeId === A && !('bellsId' in walk)));
  const early = runResults(result, B, ER);
  assert.equal(early.crowd, result.crowd.bells[2]);
  assert.equal(early.loads, result.bellLoads[2]);
  assert.ok(early.walks.groups.every((walk) => walk.dayTypeId === B && walk.bellsId === ER));
  assert.deepEqual(runResults(result, B, 'bnowhere00'), { routes: null, crowd: null, loads: null, walks: { groups: [], teachers: [] } });
  assert.equal(runResults(trimResult(result), A, ER).loads, result.bellLoads[0]);
});

// ---------------------------------------------------------------- scenario and suggestions

test('compareResults per run: bellsId compares that schedule\'s runs; the regular comparison is as without schedules', () => {
  const project = withBells();
  project.scenario = { name: 'Trial', changes: [{ kind: 'move', dayTypeId: A, groupId: G7B, period: 5, roomId: 'rsample301' }], compared: null };
  const before = trimResult(createPipeline().run(project));
  const after = scenarioRun(createPipeline(), project, null);
  assert.ok(Array.isArray(after.bellLoads) && after.bellLoads.length === 4);
  const regular = compareResults(before, after, { dayTypeId: A, changes: project.scenario.changes });
  const plainProject = sampleSchool();
  plainProject.scenario = project.scenario;
  const plain = compareResults(trimResult(createPipeline().run(plainProject)), scenarioRun(createPipeline(), plainProject, null), { dayTypeId: A, changes: project.scenario.changes });
  assert.deepEqual(regular.figures.walking, plain.figures.walking);
  assert.deepEqual(regular.groups, plain.groups);
  assert.equal('bellsId' in regular, false);
  const early = compareResults(before, after, { dayTypeId: A, bellsId: ER, changes: project.scenario.changes });
  assert.equal(early.bellsId, ER);
  // 7B moved in Period 6: under Early Release its walk out of 6 does not happen, so less changes
  const row = (compared) => compared.groups.find((one) => one.groupId === G7B);
  assert.ok(row(early).before.walks < row(regular).before.walks);
  assert.notDeepEqual(early.figures.walking, regular.figures.walking);
  assert.throws(() => loadDifference(before.loads[0], after.bellLoads[0]), /same bells/);
  assert.equal(loadDifference(before.bellLoads[0], after.bellLoads[0]).cells.length, before.loads[0].cells.busiest.length);
});

test('a walk late only under Early Release gets suggestions that clear it, timed in its own run', () => {
  const project = withBells();
  const result = createPipeline().run(project);
  const finding = result.findings.findings.find((one) => one.id === 'group-walk:' + A + ':4:' + G7B + ':' + ER);
  const answer = suggest(project, finding, { limit: 3 });
  assert.ok(answer.suggestions.length > 0, answer.none);
  for (const suggestion of answer.suggestions) {
    const after = createPipeline().run(applyChange(project, suggestion.change));
    assert.equal(after.findings.findings.some((one) => one.id === finding.id), false, suggestion.text);
    const walking = (run) => run.walks.bells.groups.filter((walk) => walk.groupId === G7B && walk.dayTypeId === A && walk.bellsId === ER).reduce((sum, walk) => sum + walk.walking, 0);
    assert.equal(suggestion.effects.walking.before, walking(result), 'timed in the Early Release run');
    assert.equal(suggestion.effects.walking.after, walking(after));
  }
});

// The project with one change applied, as Try it and Apply would.
function applyChange(project, change) {
  const store = storeOf(project);
  store.apply(actions.newScenario, { name: 'Try' });
  store.apply(actions.addScenarioChange, { change });
  store.apply(actions.applyScenario, {});
  return store.project;
}

test('every run is one the project has: runsOf with ownDayTypes and the schedules, regular first', () => {
  const project = withBells();
  assert.deepEqual(runsOf(project).filter((run) => run.bellsId === null).map((run) => run.dayTypeId), ownDayTypes(project).map((dayType) => dayType.id));
});
