// Crowd-aware routes (SV2-149; ARCHITECTURE 23.4 as revised by 23.12) and what
// the unit changed in crowd.js: `slotDelay` beside `cellDelay`, and
// `teacherRoute` pulled out of `teacherWalks`.
//
// The two-halls fixture (test/fixtures/buildings/two-halls.mjs) is where the
// rule demonstrably moves groups: eight groups of 25 cross a hall in the same
// moment, four from adjacent rooms each way, so the ones behind wait 13, 26 and
// 39 seconds, and a second corridor runs beside the usual one, two cells
// longer to use. The sample school may honestly find nothing, and a case says so.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { routingGraph, route, routesForSchedule, runRoutes, createRouteCache } from '../../engine/routing.js';
import { simulateSchedule, simulateDayTransition, teacherWalks, teacherRoute, walkResults, walkingSeconds } from '../../engine/crowd.js';
import { crowdAwareRun, CROWD_ROUNDS, CROWD_GROUPS, WAIT_FROM, DETOUR } from '../../engine/crowd-routes.js';
import { createPipeline } from '../../engine/worker.js';
import { runsOf, meetingSlots } from '../../engine/runs.js';
import { emptyBells } from '../../engine/schema.js';
import { school, assertValid } from './helpers.mjs';
import { planProject, roomId } from '../fixtures/buildings/plans.mjs';
import { twoHalls, HALLS } from '../fixtures/buildings/two-halls.mjs';
import { bigProject } from '../fixtures/big.mjs';
import { bigRunsProject } from '../timing/big-runs.mjs';

const VERSIONS = { geometry: 1, building: 1, schedule: 1 };
const N = 0;
const E = 1;
const W = 3;

function mainResults(project) {
  return createPipeline().run(project, VERSIONS);
}

function awareOf(project, options) {
  const results = mainResults(project);
  const dayTypeId = options && options.dayTypeId ? options.dayTypeId : project.dayTypes[0].id;
  return { results, run: crowdAwareRun(project, results, null, { dayTypeId, ...(options || {}) }) };
}

function sum(transitions, field) {
  let total = 0;
  for (const transition of transitions) for (const group of transition.groups || []) total += group[field];
  return total;
}

// ---- slotDelay -----------------------------------------------------------

function everyTransition(crowd) {
  const list = [];
  for (const day of crowd.days.concat(crowd.bells || [])) for (const transition of day.transitions) list.push(transition);
  return list;
}

test('slotDelay sums to cellDelay per node, on the sample and on the big fixture, and nothing is charged to a lane no group was refused in', () => {
  for (const project of [school(), bigProject({ seed: 1 }), twoHalls()]) {
    const graph = routingGraph(project);
    const routes = routesForSchedule(project, graph, { runs: runsOf(project), meetingSlots });
    const crowd = simulateSchedule(project, routes, graph);
    let charged = 0;
    for (const transition of everyTransition(crowd)) {
      assert.ok(transition.slotDelay instanceof Int32Array);
      assert.equal(transition.slotDelay.length, graph.count * 4);
      for (let node = 0; node < graph.count; node += 1) {
        const slots = transition.slotDelay[node * 4] + transition.slotDelay[node * 4 + 1] + transition.slotDelay[node * 4 + 2] + transition.slotDelay[node * 4 + 3];
        assert.equal(slots, transition.cellDelay[node]);
      }
      for (const value of transition.slotDelay) charged += value;
    }
    assert.ok(charged > 0, 'there is a jam to charge');
  }
});

test('a jam is charged to the lane it was in: eastbound in the west hall, westbound in the east hall, never the opposite lane', () => {
  const project = twoHalls();
  const graph = routingGraph(project);
  const routes = routesForSchedule(project, graph);
  const first = simulateDayTransition(project, routes, project.dayTypes[0].id, 0, graph);
  const at = (x, y) => graph.floors[0].nodeOfCell[y * project.building.floors[0].width + x];
  for (const x of [3, 4]) {
    const node = at(x, 1);
    assert.ok(first.slotDelay[node * 4 + E] > 0, 'eastbound at x=' + x);
    assert.equal(first.slotDelay[node * 4 + W], 0, 'not westbound at x=' + x);
    assert.equal(first.cellDelay[node], first.slotDelay[node * 4 + E] + first.slotDelay[node * 4 + N] + first.slotDelay[node * 4 + 2] + first.slotDelay[node * 4 + W]);
  }
  for (const x of [14, 15]) {
    const node = at(x, 1);
    assert.ok(first.slotDelay[node * 4 + W] > 0, 'westbound at x=' + x);
    assert.equal(first.slotDelay[node * 4 + E], 0, 'not eastbound at x=' + x);
  }
});

// The digests are of the crowd figures and the walk results of the sample and
// of bigProject({ seed: 1 }) as simulateSchedule and walkResults gave them
// before this unit, with the new `slotDelay` left out: the unit adds a field
// and changes no figure. A change to the crowd rules on purpose re-records them.
const DIGESTS = {
  sample: 'd916dbe28cc35637fd191edb2ee1493172adffeee3555e207f145423283c95ee',
  big: '0e28223a1ebd21da382b94b9158fdd05932bfe959895d531b1fc7539577806fc',
};

function digestOf(project) {
  const graph = routingGraph(project);
  const routes = routesForSchedule(project, graph, { runs: runsOf(project), meetingSlots });
  const crowd = simulateSchedule(project, routes, graph);
  const walks = walkResults(project, crowd, graph);
  const replacer = (key, value) => (key === 'slotDelay' ? undefined : ArrayBuffer.isView(value) ? { t: value.constructor.name, d: Array.from(value) } : value);
  return createHash('sha256').update(JSON.stringify({ crowd, walks }, replacer)).digest('hex');
}

test('every existing crowd figure and every teacher walk is byte-identical to what it was before slotDelay and teacherRoute', () => {
  assert.equal(digestOf(school()), DIGESTS.sample);
  assert.equal(digestOf(bigProject({ seed: 1 })), DIGESTS.big);
});

// ---- teacherRoute --------------------------------------------------------

// The sample and the fixture have teachers with one room each and so no walks
// at all. Every second teacher here takes a second room (the next of a spread
// through the building), which gives them walks to route and to time.
function withTeacherWalks(project) {
  const rooms = project.building.floors.flatMap((floor) => floor.spaces.filter((space) => space.kind === 'room'));
  project.teachers.forEach((teacher, i) => {
    if (i % 2) return;
    const other = rooms[(i * 7 + 3) % rooms.length];
    if (!other || teacher.roomIds.includes(other.id)) return;
    teacher.roomIds.push(other.id);
    other.teacherIds = [...(other.teacherIds || []), teacher.id];
  });
  return project;
}

// teacherWalks over the regular runs and over the bell-schedule runs, as it
// gave them before teacherRoute was pulled out (the digests are of the walks
// of 7 teachers' walks on the sample, 159 on the fixture, and 349 regular and
// 554 bell-schedule walks on test/timing/big-runs.mjs's)
const WALK_DIGESTS = {
  sample: '8de0fe6d05ce577d59b0614edef774e4e11a20bb797d3899e27b0ed597416a85',
  big: 'a6df5d36d832a75aee2cfa07efef89883db93ff3ced33595c76cf20ce6fe8c0e',
  bigRuns: '971040bef14cd8529a8bc56a8bd97a35af304c197bd7f3ad3b90302135852195',
};

test('teacherWalks is byte-identical after teacherRoute is pulled out: the sample, the fixture, and the fixture with bell-schedule runs, with every walk there', () => {
  const cases = [['sample', school(), 7, 0], ['big', bigProject({ seed: 1 }), 159, 0], ['bigRuns', bigRunsProject({ seed: 1 }), 349, 554]];
  for (const [name, project, regular, bells] of cases) {
    withTeacherWalks(project);
    const graph = routingGraph(project);
    const a = teacherWalks(project, graph, { cache: createRouteCache() });
    const b = teacherWalks(project, graph, { bells: true });
    assert.equal(a.length, regular, name);
    assert.equal(b.length, bells, name);
    assert.equal(createHash('sha256').update(JSON.stringify([a, b])).digest('hex'), WALK_DIGESTS[name], name);
  }
});

test('teacherRoute is the one route call a teacher walk makes: each walk is timed on the route it gives, with and without a cache, and the scenario\'s levers reach it', () => {
  let checked = 0;
  for (const project of [withTeacherWalks(school()), withTeacherWalks(bigProject({ seed: 1 }))]) {
    const graph = routingGraph(project);
    const cache = createRouteCache();
    const walks = teacherWalks(project, graph, { cache });
    const without = teacherWalks(project, graph);
    assert.deepEqual(without, walks, 'a cache changes no figure');
    for (const walk of walks.slice(0, 40)) {
      checked += 1;
      const found = teacherRoute(graph, walk.fromRoomId, walk.toRoomId, { cache });
      assert.equal(found, teacherRoute(graph, walk.fromRoomId, walk.toRoomId, { cache }), 'the cache hands the same route object');
      assert.deepEqual(found, route(graph, walk.fromRoomId, walk.toRoomId, { cache: createRouteCache() }));
      if (walk.failed !== true) assert.equal(walkingSeconds(graph, found), walk.walking + (walk.riding || 0));
    }
  }
  assert.ok(checked > 20, 'walks to check: ' + checked);
  // a closed cell on the way changes the route and so the walk, as it does for a class
  const hall = twoHalls({ spare: false });
  const graph = routingGraph(hall);
  const usual = teacherRoute(graph, roomId('1A'), roomId('1E'), {});
  assert.equal(usual.ok, true);
  const shut = [{ floorId: hall.building.floors[0].id, cell: usual.cells[5].cell }];
  assert.equal(teacherRoute(graph, roomId('1A'), roomId('1E'), { shutCells: shut }).ok, false, 'a single corridor shut is a failed walk');
  assert.deepEqual(teacherRoute(graph, roomId('1A'), roomId('1E'), { shutCells: [] }), usual);
});

// ---- crowdAwareRun -------------------------------------------------------

test('the constants are the design\'s: 2 rounds, 16 groups, 10 seconds, 30 seconds or a quarter', () => {
  assert.equal(CROWD_ROUNDS, 2);
  assert.equal(CROWD_GROUPS, 16);
  assert.equal(WAIT_FROM, 10);
  assert.deepEqual(DETOUR, { seconds: 30, share: 0.25 });
});

test('two halls: groups take the second corridor and the waiting falls, as the transition re-simulated says', () => {
  const project = twoHalls();
  const { results, run } = awareOf(project);
  const usualRun = runRoutes(results.routes, project.dayTypes[0].id);
  const usualCrowd = results.crowd.days[0];
  assert.equal(run.dayTypeId, project.dayTypes[0].id);
  assert.equal(run.bellsId, undefined);
  assert.ok(run.changed.length > 0, 'some groups take another way');
  assert.ok(run.figures.aware.waiting < run.figures.usual.waiting, run.figures.aware.waiting + ' < ' + run.figures.usual.waiting);
  assert.ok(run.figures.aware.total < run.figures.usual.total);
  assert.equal(run.figures.usual.waiting, sum(usualCrowd.transitions, 'waiting'));
  assert.equal(run.figures.aware.waiting, sum(run.crowd.transitions, 'waiting'));
  assert.equal(run.figures.usual.walking, sum(usualCrowd.transitions, 'walking'));
  assert.equal(run.figures.aware.walking, sum(run.crowd.transitions, 'walking'));
  assert.ok(run.figures.aware.walking > run.figures.usual.walking, 'the second corridor is longer to walk');
  // every transition that changed has the figures of the routes it kept
  run.crowd.transitions.forEach((transition, t) => {
    const again = simulateDayTransition(project, { days: [run.routes] }, run.dayTypeId, t, null);
    assert.deepEqual(transition, again);
    assert.ok(sum([transition], 'total') <= sum([usualCrowd.transitions[t]], 'total'), 'a transition is only ever kept when its total falls');
  });
  // the walks are walkResults' group entries for this run, and the loads are loads()
  assert.deepEqual(run.walks.groups.map((walk) => walk.total), run.crowd.transitions.flatMap((transition) => transition.groups.map((group) => group.total)));
  assert.equal(run.loads.dayTypeId, run.dayTypeId);
  assert.notDeepEqual(Array.from(run.loads.cells.total), Array.from(results.loads[0].cells.total), 'the load moved onto the second corridor');
  // the changed list: figures of the usual and the aware walk, and where it goes
  for (const entry of run.changed) {
    assert.ok(entry.usual.total > 0 && entry.aware.total > 0);
    assert.ok(entry.cells > 0);
    assert.ok(entry.aware.seconds > entry.usual.seconds, 'a way that differs is a longer one');
    assert.ok(entry.aware.seconds - entry.usual.seconds <= Math.max(DETOUR.seconds, DETOUR.share * entry.usual.seconds));
  }
  // the usual objects are reused where nothing changed
  const moved = new Set(run.changed.map((entry) => entry.groupId));
  run.routes.groups.forEach((entry, g) => {
    if (!moved.has(entry.groupId)) assert.equal(entry, usualRun.groups[g]);
  });
  assert.equal(run.searches > 0, true);
  assert.ok(run.rounds.every((round) => round.round <= CROWD_ROUNDS && round.tried <= CROWD_GROUPS));
  assert.ok(run.rounds.some((round) => round.kept));
});

test('a plan with no spare corridor moves nothing: the usual routes, the main lane\'s crowd, and its own loads, by identity', () => {
  const project = twoHalls({ spare: false });
  const { results, run } = awareOf(project);
  assert.ok(sum(results.crowd.days[0].transitions, 'waiting') > 0);
  assert.deepEqual(run.changed, []);
  assert.equal(run.routes, runRoutes(results.routes, project.dayTypes[0].id));
  assert.equal(run.crowd, results.crowd.days[0]);
  assert.equal(run.loads, results.loads[0]);
  assert.deepEqual(run.figures.aware, run.figures.usual);
  assert.ok(run.searches > 0, 'it looked');
  assert.ok(run.rounds.length > 0 && run.rounds.every((round) => round.taken === 0 && round.kept === false));
});

test('a detour over the limit is refused: 2 cells is 6 seconds, and the limit is the larger of the seconds and the share', () => {
  const project = twoHalls();
  const results = mainResults(project);
  const dayTypeId = project.dayTypes[0].id;
  const refused = crowdAwareRun(project, results, null, { dayTypeId, detour: { seconds: 5, share: 0 } });
  assert.deepEqual(refused.changed, []);
  assert.equal(refused.crowd, results.crowd.days[0]);
  assert.ok(refused.rounds.some((round) => round.tried > 0 && round.taken === 0), 'tried, and none taken');
  const exact = crowdAwareRun(project, results, null, { dayTypeId, detour: { seconds: 6, share: 0 } });
  assert.ok(exact.changed.length > 0, '6 seconds more is allowed by 6 seconds');
  // the share: a quarter of a 42 second walk is 10.5 seconds, enough for 6
  const share = crowdAwareRun(project, results, null, { dayTypeId, detour: { seconds: 0, share: 0.25 } });
  assert.ok(share.changed.length > 0);
  const tight = crowdAwareRun(project, results, null, { dayTypeId, detour: { seconds: 0, share: 0.1 } });
  assert.deepEqual(tight.changed, []);
  for (const entry of exact.changed) assert.ok(entry.aware.seconds - entry.usual.seconds <= 6);
});

// Two halls on two floors: the only way round a jam is up a stair at each end,
// beside the rooms of West 1 and of the east hall's first room. Stairs cost
// 2 seconds so the way up is within the detour.
function stairsHalls() {
  const base = twoHalls({ spare: false });
  const stairs = (x) => Array.from({ length: 19 }, (unused, i) => (i === x || i === 14 ? 'S' : '.')).join('');
  const bare = '.'.repeat(19);
  const project = planProject([['.ABCD.........EFGH.', '#'.repeat(19), stairs(1)], [bare, '#'.repeat(19), stairs(1)]], { connections: [[1, 1, 2, 2, 1, 2], [1, 14, 2, 2, 14, 2]] });
  project.settings.periods = base.settings.periods;
  project.settings.secondsPerStair = 2;
  project.dayTypes = base.dayTypes;
  project.groups = base.groups;
  assertValid(project);
  return project;
}

test('a step-free group stays step-free: with the stairs the only spare way, the groups that need none take none and the others may', () => {
  const usedStairs = (entry) => entry.routes.some((found) => found.ok && found.connections.length > 0);
  const free = stairsHalls();
  const unrestricted = awareOf(free).run;
  assert.ok(unrestricted.rounds.some((round) => round.transition === 0 && round.taken > 0), 'with no step-free group the stairs are looked at (and taken, for a try)');

  const needing = stairsHalls();
  needing.groups[0].stepFree = true; // West 1, the one the stairs help most
  needing.groups[7].stepFree = true; // East 4
  assertValid(needing);
  const { results, run } = awareOf(needing);
  const usual = runRoutes(results.routes, needing.dayTypes[0].id);
  for (const index of [0, 7]) {
    assert.equal(usedStairs(run.routes.groups[index]), false);
    assert.equal(run.routes.groups[index], usual.groups[index], 'its entry is the usual one, by identity');
  }
  assert.equal(usedStairs(run.routes.groups[1]), true, 'West 2 still goes round by the stairs');
  for (const entry of run.changed) assert.ok(!['gplan00001', 'gplan00008'].includes(entry.groupId));

  // all of them step-free: nothing is left to try
  for (const group of needing.groups) group.stepFree = true;
  const none = awareOf(needing).run;
  assert.deepEqual(none.changed, []);
  assert.equal(none.routes.groups.some(usedStairs), false);
});

test('reversed groups give the same answer: the order is waiting, then id as text, never the project\'s order', () => {
  const project = twoHalls();
  const reversed = twoHalls();
  reversed.groups.reverse();
  const a = awareOf(project).run;
  const b = awareOf(reversed).run;
  assert.deepEqual(b.changed, a.changed);
  assert.deepEqual(b.figures, a.figures);
  assert.deepEqual(b.rounds, a.rounds);
  assert.equal(b.searches, a.searches);
  assert.deepEqual(b.crowd.transitions.map((t) => t.groups.map((g) => [g.groupId, g.total])), a.crowd.transitions.map((t) => t.groups.map((g) => [g.groupId, g.total])));
  const routesOf = (run) => Object.fromEntries(run.routes.groups.map((entry) => [entry.groupId, entry.routes.map((found) => found.cells && found.cells.map((cell) => cell.cell).join(','))]));
  assert.deepEqual(routesOf(b), routesOf(a));
  // a tie in waiting is where the order shows: West 1 and East 4 both waited 39 s in the first transition (West 4 and East 1 in
  // the second), and with room for one group in a round it is the lower id, whichever way the project lists them
  const one = awareOf(project, { groupsMost: 1, rounds: 1 }).run;
  const oneReversed = awareOf(reversed, { groupsMost: 1, rounds: 1 }).run;
  assert.deepEqual(oneReversed.changed, one.changed);
  assert.ok(one.changed.length > 0);
  assert.deepEqual(one.changed.map((entry) => [entry.period, entry.groupId]), [[0, 'gplan00001'], [1, 'gplan00004']], 'the lower id of the two that waited longest, in each transition');
});

test('a follower day type uses its base\'s run, and the answer names that run', () => {
  const project = twoHalls();
  const base = project.dayTypes[0];
  project.dayTypes.push({ id: 'dplan0000b', name: 'B Day', own: false, sameAs: base.id, short: '', bells: emptyBells(project.settings.periods) });
  assertValid(project);
  const results = mainResults(project);
  const own = crowdAwareRun(project, results, null, { dayTypeId: base.id });
  const follower = crowdAwareRun(project, results, null, { dayTypeId: 'dplan0000b' });
  assert.ok(own.changed.length > 0);
  assert.equal(follower.dayTypeId, base.id);
  assert.deepEqual(follower, own);
  assert.equal(crowdAwareRun(project, results, null, { dayTypeId: 'dnope' }), null, 'a day type that is not there');
});

function withBells(project, off) {
  const periods = project.settings.periods;
  const time = (minutes) => String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
  project.bellSchedules = [{ id: 'bplan0000a', name: 'Assembly', short: '', off, bells: Array.from({ length: periods }, (unused, p) => (off.includes(p) ? null : { start: time(480 + p * 45), end: time(480 + p * 45 + 40) })) }];
  assertValid(project);
  return project;
}

test('a bells run: the same rule on the bell schedule\'s own transitions, keyed by bellsId', () => {
  const project = withBells(twoHalls(), []);
  const results = mainResults(project);
  const dayTypeId = project.dayTypes[0].id;
  const run = crowdAwareRun(project, results, null, { dayTypeId, bellsId: 'bplan0000a' });
  assert.equal(run.bellsId, 'bplan0000a');
  assert.equal(run.routes.bellsId, 'bplan0000a');
  assert.equal(run.crowd.bellsId, 'bplan0000a');
  assert.equal(run.loads.bellsId, 'bplan0000a');
  assert.ok(run.changed.length > 0);
  assert.ok(run.figures.aware.waiting < run.figures.usual.waiting);
  assert.ok(run.walks.groups.every((walk) => walk.bellsId === 'bplan0000a'));
  run.crowd.transitions.forEach((transition, t) => assert.deepEqual(transition, simulateDayTransition(project, { days: [], bells: [run.routes] }, dayTypeId, t, null, 'bplan0000a')));
  // the regular run is untouched by asking for the bells one, and is a run of its own
  const regular = crowdAwareRun(project, results, null, { dayTypeId });
  assert.equal(regular.bellsId, undefined);
  assert.notEqual(regular.crowd, run.crowd);
});

test('a bells run with a period that does not meet: the walk across it is the one timed, under the period it leaves', () => {
  const project = withBells(twoHalls({ pattern: 'hhah' }), [1]);
  const results = mainResults(project);
  const dayTypeId = project.dayTypes[0].id;
  const run = crowdAwareRun(project, results, null, { dayTypeId, bellsId: 'bplan0000a' });
  assert.equal(run.crowd.transitions[0].toPeriod, 2, 'Period 1 to Period 3 across the one that does not meet');
  assert.equal(run.crowd.transitions[1].off, true);
  assert.equal(run.crowd.transitions[1], results.crowd.bells[0].transitions[1], 'a transition that moves nobody is the main lane\'s object');
  assert.ok(run.changed.length > 0);
  for (const entry of run.changed.filter((one) => one.period === 0)) assert.equal(entry.toPeriod, 2);
});

test('a transition with nobody waiting 10 seconds is the main lane\'s own object, and one run twice gives the same answer', () => {
  const project = twoHalls({ pattern: 'hhah' });
  const { results, run } = awareOf(project);
  const usual = results.crowd.days[0].transitions;
  assert.equal(sum([usual[0]], 'waiting'), 0, 'nobody walks in the first transition');
  assert.equal(run.crowd.transitions[0], usual[0]);
  assert.notEqual(run.crowd.transitions[1], usual[1]);
  assert.ok(!run.rounds.some((round) => round.transition === 0), 'no search for it');
  const sample = awareOf(school());
  sample.results.crowd.days.forEach((day, d) => day.transitions.forEach((transition, t) => {
    const waiting = transition.groups.some((group) => group.waiting >= WAIT_FROM);
    if (d === 0 && !waiting) assert.equal(sample.run.crowd.transitions[t], transition);
  }));
  assert.deepEqual(awareOf(project).run, run);
});

test('the sample school may find nothing, and says so: no group moves, and every part is the main lane\'s', () => {
  const project = school();
  const { results, run } = awareOf(project);
  assert.deepEqual(run.changed, []);
  assert.equal(run.crowd, results.crowd.days[0]);
  assert.equal(run.routes, runRoutes(results.routes, project.dayTypes[0].id));
  assert.deepEqual(run.figures.aware, run.figures.usual);
});

test('a round is kept only when the transition\'s total falls: on the big fixture some rounds take ways that do not help and are dropped, and no transition ends worse', () => {
  const project = bigProject({ seed: 1 });
  const { results, run } = awareOf(project);
  const usual = results.crowd.days[0].transitions;
  assert.ok(run.rounds.some((round) => round.taken > 0 && round.kept === false), 'a way taken that did not help');
  assert.ok(run.rounds.some((round) => round.kept));
  assert.ok(run.rounds.every((round) => round.round >= 1 && round.round <= CROWD_ROUNDS && round.tried <= CROWD_GROUPS));
  run.crowd.transitions.forEach((transition, t) => {
    assert.ok(sum([transition], 'total') <= sum([usual[t]], 'total'));
    const rounds = run.rounds.filter((round) => round.transition === t);
    if (rounds.length > 0 && !rounds.some((round) => round.kept)) assert.equal(transition, usual[t], 'nothing kept is the main lane\'s object');
  });
  assert.ok(run.figures.aware.waiting < run.figures.usual.waiting);
  // the levers: fewer groups, fewer rounds
  const one = crowdAwareRun(project, results, null, { dayTypeId: project.dayTypes[0].id, rounds: 1, groupsMost: 3 });
  assert.ok(one.rounds.every((round) => round.round === 1 && round.tried <= 3));
  assert.ok(one.searches <= 3 * usual.length);
  const none = crowdAwareRun(project, results, null, { dayTypeId: project.dayTypes[0].id, rounds: 0 });
  assert.deepEqual(none.changed, []);
  assert.equal(none.searches, 0);
});

test('a run that is not in the results is null, and nothing the run is handed is changed', () => {
  const project = twoHalls();
  const results = mainResults(project);
  assert.equal(crowdAwareRun(project, results, null, { dayTypeId: project.dayTypes[0].id, bellsId: 'bnone' }), null);
  assert.equal(crowdAwareRun(project, null, null, { dayTypeId: project.dayTypes[0].id }), null);
  const before = JSON.stringify(results.walks) + results.crowd.days[0].transitions.map((t) => Array.from(t.cellDelay).join()).join('|');
  crowdAwareRun(project, results, null, { dayTypeId: project.dayTypes[0].id });
  assert.equal(JSON.stringify(results.walks) + results.crowd.days[0].transitions.map((t) => Array.from(t.cellDelay).join()).join('|'), before);
  void HALLS;
});
