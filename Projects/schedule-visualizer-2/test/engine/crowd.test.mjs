// The crowd model, rule by rule (ARCHITECTURE 6.3). Each plan is drawn in the
// test that uses it. Unless a test says otherwise a cell takes 3 seconds, a
// stairs connection 8, the passing time is 240 seconds, and a group of 6 is
// one slot long, a group of 25 five.
//
// The figures asserted here are worked out by hand from the rules in the
// comment beside them, not read back from a run.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, nodeAt } from '../../engine/graph.js';
import { route, routesForSchedule, routingGraph } from '../../engine/routing.js';
import { emptySlot, emptyBells, GROUP_COLOUR_PRESETS } from '../../engine/schema.js';
import { checkSchedule } from '../../engine/checks.js';
import { isLate, crowdCap, columnLength, routePath, walkingSeconds, simulateTransition, simulateDayTransition, simulateDay, simulateSchedule, teacherWalks, walkResults, CAP_MINIMUM_SECONDS } from '../../engine/crowd.js';
import { SAMPLE_PROBLEMS } from '../../data/sample-school.js';
import { school, clone, assertValid } from './helpers.mjs';
import { planProject, threeFloors, splitLevel, twoRooms, cellAt, floorId, roomId } from '../fixtures/buildings/plans.mjs';
import { bigProject } from '../fixtures/big.mjs';

const F1 = floorId(1);

// Runs one transition on a plan. `walks` is [[id, from, to, headCount]].
function run(project, walks, options) {
  const graph = routingGraph(project);
  const walkers = walks.map(([id, from, to, headCount]) => ({ id, headCount, route: route(graph, roomId(from), roomId(to)) }));
  const result = simulateTransition(graph, walkers, { passingSeconds: 240, marginSeconds: 0, ...options });
  const byId = Object.fromEntries(result.groups.map((group) => [group.groupId, group]));
  return { graph, result, byId };
}

function figures(group) {
  return { walking: group.walking, waiting: group.waiting, total: group.total, late: group.late, arrived: group.arrived };
}

// Groups on a plan's A Day: { name: [room number or null, one per period] }.
function withSchedule(project, rows, headCounts) {
  const names = Object.keys(rows);
  const periods = rows[names[0]].length;
  project.settings.periods = periods;
  for (const dayType of project.dayTypes) dayType.bells = emptyBells(periods);
  project.groups = names.map((name, index) => ({
    id: 'gplan' + String(index + 1).padStart(5, '0'),
    name,
    grade: '',
    headCount: headCounts && headCounts[name] !== undefined ? headCounts[name] : null,
    colour: GROUP_COLOUR_PRESETS[index],
    days: { [project.dayTypes[0].id]: rows[name].map((number) => ({ ...emptySlot(), room: number ? roomId(number) : null })) },
  }));
  assertValid(project);
  return project;
}

function everything(project) {
  const graph = routingGraph(project);
  const routes = routesForSchedule(project, graph);
  const crowd = simulateSchedule(project, routes, graph);
  return { graph, routes, crowd };
}

const CROSS = [
  '...C...',
  '...#...',
  'A#####B',
  '...#...',
  '...D...',
];

test('the late rule: late is more than the passing time plus the margin', () => {
  assert.equal(isLate(240, 240, 0), false, 'exactly the passing time is in time');
  assert.equal(isLate(241, 240, 0), true);
  assert.equal(isLate(250, 240, 10), false, 'exactly the passing time plus the margin is in time');
  assert.equal(isLate(251, 240, 10), true);
  assert.equal(isLate(241, 240, undefined), true, 'no margin is a margin of nothing');
});

test('a group is stopped at three times the passing time, and never before 600 seconds', () => {
  assert.equal(crowdCap(240), 720);
  assert.equal(crowdCap(200), 600);
  assert.equal(crowdCap(100), 600);
  assert.equal(crowdCap(0), 600);
  assert.equal(crowdCap(300), 900);
  assert.equal(CAP_MINIMUM_SECONDS, 600);
});

test('a group of 25 is 5 slots long and a group of 6 is 1', () => {
  assert.equal(columnLength(25), 5);
  assert.equal(columnLength(6), 1);
  assert.equal(columnLength(7), 2);
  assert.equal(columnLength(1), 1);
  assert.equal(columnLength(999), 167);
});

test('a group nobody hinders takes its walking time: slots at secondsPerCell, no waiting', () => {
  const project = planProject([[
    'A......',
    '######.',
    '....#..',
    '....#B.',
    '.......',
  ]]);
  const { result, byId } = run(project, [['g1', '1A', '1B', 25]]);
  const group = byId.g1;
  assert.equal(group.slots, 7, 'the seven cells of the route');
  assert.equal(group.length, 5);
  assert.equal(group.headCount, 25);
  assert.deepEqual(figures(group), { walking: 21, waiting: 0, total: 21, late: false, arrived: true });
  assert.deepEqual([group.fromRoomId, group.toRoomId], [roomId('1A'), roomId('1B')]);
  // the head takes slot 0 on tick 0 and a slot every 3 ticks; on tick 21 it steps into the room (index 7);
  // the column of 5 follows it in, the tail on tick 21 + 4 × 3
  assert.equal(group.positions[0], 0);
  assert.equal(group.positions[2], 0);
  assert.equal(group.positions[3], 1);
  assert.equal(group.positions[18], 6);
  assert.equal(group.positions[20], 6);
  assert.equal(group.positions[21], 7);
  assert.equal(result.seconds, 33, 'the transition ends when the tail is in the room');
  assert.equal(group.positions.length, 34);
  assert.equal(group.positions[33], 11);
  assert.ok(group.positions instanceof Int16Array);
  assert.equal(result.cap, 720);
  assert.equal(result.cellDelay.reduce((sum, value) => sum + value, 0), 0);
});

test('a group of 25 holds the door for 5 slots and a group of 6 for 1: the group behind waits that long', () => {
  const project = planProject([['A#####B']]);
  // the leader's column of L slots clears the first slot on tick L × 3; the follower reads it free on the next tick
  const long = run(project, [['g1', '1A', '1B', 25], ['g2', '1A', '1B', 6]]);
  assert.equal(long.byId.g1.waiting, 0);
  assert.equal(long.byId.g2.waiting, 16, '5 slots at 3 seconds, and one tick to see the slot free');
  const short = run(project, [['g1', '1A', '1B', 6], ['g2', '1A', '1B', 6]]);
  assert.equal(short.byId.g2.waiting, 4, '1 slot at 3 seconds, and one tick');
  const seven = run(project, [['g1', '1A', '1B', 7], ['g2', '1A', '1B', 6]]);
  assert.equal(seven.byId.g2.waiting, 7, 'a group of 7 is 2 slots');
});

test('three groups leaving one room at t = 0 go one after another, in id order', () => {
  const project = planProject([['A#####B']]);
  const { result, byId } = run(project, [['g3', '1A', '1B', 25], ['g1', '1A', '1B', 25], ['g2', '1A', '1B', 25]]);
  assert.deepEqual(result.groups.map((group) => group.groupId), ['g1', 'g2', 'g3']);
  assert.deepEqual(figures(byId.g1), { walking: 15, waiting: 0, total: 15, late: false, arrived: true });
  assert.deepEqual(figures(byId.g2), { walking: 15, waiting: 16, total: 31, late: false, arrived: true });
  assert.deepEqual(figures(byId.g3), { walking: 15, waiting: 32, total: 47, late: false, arrived: true });
  assert.equal(byId.g2.positions[15], -1, 'still in the room while the first column passes the door');
  assert.equal(byId.g2.positions[16], 0);
  // every second of it was spent refused at the first cell outside the door
  const door = nodeAt(routingGraph(project), F1, cellAt(project, 1, 1, 0));
  assert.equal(result.cellDelay[door], 48);
  assert.equal(result.cellDelay.reduce((sum, value) => sum + value, 0), 48);
});

test('two groups wanting one slot in one tick: the lower id wins, whatever order they are given in', () => {
  // both reach (1,1) on tick 0 in different lanes, one walking south and one east; on tick 3 both want (2,1) eastward
  const project = planProject([[
    '.A.....',
    'B#####C',
  ]]);
  const first = run(project, [['g1', '1A', '1C', 6], ['g2', '1B', '1C', 6]]);
  assert.deepEqual([first.byId.g1.waiting, first.byId.g2.waiting], [0, 4], 'g2 waits for the slot to clear on tick 6 and reads it free on tick 7');
  const given = run(project, [['g2', '1B', '1C', 6], ['g1', '1A', '1C', 6]]);
  assert.deepEqual([given.byId.g1.waiting, given.byId.g2.waiting], [0, 4], 'the order of the list changes nothing');
  const swapped = run(project, [['g2', '1A', '1C', 6], ['g1', '1B', '1C', 6]]);
  assert.deepEqual([swapped.byId.g1.waiting, swapped.byId.g2.waiting], [0, 4], 'the id decides, not the room');
  assert.equal(swapped.byId.g2.fromRoomId, roomId('1A'));
});

test('opposing flows in a corridor do not block each other', () => {
  const project = planProject([['A#####B']]);
  const { byId } = run(project, [['g1', '1A', '1B', 25], ['g2', '1B', '1A', 25]]);
  assert.deepEqual(figures(byId.g1), { walking: 15, waiting: 0, total: 15, late: false, arrived: true });
  assert.deepEqual(figures(byId.g2), { walking: 15, waiting: 0, total: 15, late: false, arrived: true });
});

test('perpendicular flows at a crossing do not block each other', () => {
  const project = planProject([CROSS]);
  // g2's column of 5 is on the middle cell from tick 3 to tick 18; g1 walks through it on tick 6
  const { byId } = run(project, [['g1', '1A', '1B', 25], ['g2', '1C', '1D', 25]]);
  assert.deepEqual(figures(byId.g1), { walking: 15, waiting: 0, total: 15, late: false, arrived: true });
  assert.deepEqual(figures(byId.g2), { walking: 9, waiting: 0, total: 9, late: false, arrived: true });
});

test('a left turn across a flow waits, and a right turn does not', () => {
  const project = planProject([CROSS]);
  // The flow walks west: its column of 5 takes the middle cell on tick 6 and its tail leaves it on tick 21.
  // The turner walks east, is on the middle cell from tick 6, and wants to turn on tick 9.
  const left = run(project, [['g1', '1B', '1A', 25], ['g2', '1A', '1C', 6]]);
  assert.deepEqual(figures(left.byId.g1), { walking: 15, waiting: 0, total: 15, late: false, arrived: true }, 'the flow is not held up');
  assert.deepEqual(figures(left.byId.g2), { walking: 12, waiting: 13, total: 25, late: false, arrived: true }, 'refused on ticks 9 to 21, turns on tick 22');
  const north = nodeAt(left.graph, F1, cellAt(project, 1, 3, 1));
  assert.equal(left.result.cellDelay[north], 13, 'the wait is charged to the cell it was turning into');
  assert.equal(left.result.cellDelay.reduce((sum, value) => sum + value, 0), 13);

  const right = run(project, [['g1', '1B', '1A', 25], ['g2', '1A', '1D', 6]]);
  assert.deepEqual(figures(right.byId.g2), { walking: 12, waiting: 0, total: 12, late: false, arrived: true });

  const alone = run(project, [['g2', '1A', '1C', 6]]);
  assert.equal(alone.byId.g2.waiting, 0, 'a left turn with nobody coming does not wait');
});

test('a group that is waiting holds up the group behind it', () => {
  const project = planProject([CROSS]);
  // g2 turns left and waits for the flow as above, standing on the middle cell until tick 22.
  // g3 follows it out of the same room, going straight on east: 4 seconds at the door (g2 has it first),
  // then it reaches the cell behind g2 on tick 7, wants the middle cell on tick 10 and is refused until g2 has left: 13 more.
  const { byId, result } = run(project, [['g1', '1B', '1A', 25], ['g2', '1A', '1C', 6], ['g3', '1A', '1B', 6]]);
  assert.deepEqual(figures(byId.g2), { walking: 12, waiting: 13, total: 25, late: false, arrived: true });
  assert.deepEqual(figures(byId.g3), { walking: 15, waiting: 17, total: 32, late: false, arrived: true });
  const middle = nodeAt(routingGraph(project), F1, cellAt(project, 1, 3, 2));
  assert.equal(result.cellDelay[middle], 13, 'g3 was refused the middle cell 13 times');

  const free = run(project, [['g2', '1A', '1C', 6], ['g3', '1A', '1B', 6]]);
  assert.equal(free.byId.g3.waiting, 4, 'without the flow it only waits at the door');
});

test('stairs take k slots, k = round(stairs seconds × floors ÷ seconds per cell), at least 1', () => {
  const project = threeFloors();
  const graph = routingGraph(project);
  const up = route(graph, roomId('1A'), roomId('2A'));
  assert.equal(up.cells.length, 4);
  assert.equal(up.seconds, 20, 'the search cost: 4 cells at 3 and one connection at 8');
  const path = routePath(graph, up);
  assert.equal(path.length, 7, '4 cells and round(8 / 3) = 3 stairs slots');
  assert.deepEqual(Array.from(path.links), [-1, -1, 0, 0, 0, -1, -1]);
  assert.deepEqual(Array.from(path.part), [0, 0, 0, 1, 2, 0, 0]);
  assert.deepEqual(Array.from(path.nodes).map((node) => node === -1), [false, false, true, true, true, false, false]);
  assert.equal(new Set(path.slots).size, 7, 'every slot is its own');
  assert.equal(walkingSeconds(graph, up), 21);
  const { byId } = run(project, [['g1', '1A', '2A', 25]]);
  assert.deepEqual(figures(byId.g1), { walking: 21, waiting: 0, total: 21, late: false, arrived: true });

  const two = run(project, [['g1', '1A', '3A', 25]]);
  assert.equal(two.byId.g1.slots, 11, '5 cells and two connections of 3 slots');
  assert.equal(two.byId.g1.total, 33);

  const exact = threeFloors();
  exact.settings.secondsPerCell = 4;
  assert.equal(walkingSeconds(routingGraph(exact), route(routingGraph(exact), roomId('1A'), roomId('2A'))), 24, '4 cells and 8 / 4 = 2 slots, at 4 seconds');
  const half = threeFloors();
  half.settings.secondsPerCell = 4;
  half.settings.secondsPerStair = 10;
  assert.equal(routePath(routingGraph(half), route(routingGraph(half), roomId('1A'), roomId('2A'))).length, 4 + 3, '10 / 4 = 2.5 rounds up to 3');
  const quick = threeFloors();
  quick.settings.secondsPerCell = 10;
  quick.settings.secondsPerStair = 2;
  assert.equal(routePath(routingGraph(quick), route(routingGraph(quick), roomId('1A'), roomId('2A'))).length, 4 + 1, 'never fewer than one slot');
  const tall = threeFloors();
  tall.building.floors[1].level = 3;
  tall.building.floors[2].level = 4;
  assert.equal(routePath(routingGraph(tall), route(routingGraph(tall), roomId('1A'), roomId('2A'))).length, 4 + 5, 'two levels: round(16 / 3) = 5');
});

test('a same-floor connection takes the stairs time of one floor', () => {
  const project = splitLevel();
  const graph = routingGraph(project);
  const found = route(graph, roomId('1A'), roomId('1B'));
  assert.equal(found.cells.length, 4);
  assert.equal(routePath(graph, found).length, 7);
  const { byId } = run(project, [['g1', '1A', '1B', 25]]);
  assert.deepEqual(figures(byId.g1), { walking: 21, waiting: 0, total: 21, late: false, arrived: true });
});

test('groups going up and down one connection do not block, and two going the same way queue', () => {
  const project = threeFloors();
  const both = run(project, [['g1', '1A', '2A', 25], ['g2', '2A', '1A', 25]]);
  assert.deepEqual([both.byId.g1.waiting, both.byId.g2.waiting], [0, 0]);
  // 1B's first cell is 4 east of 1A's on the same corridor, so 1B's group reaches 1A's door behind 1A's column
  const queue = run(project, [['g1', '1A', '2A', 25], ['g2', '1B', '2A', 25]]);
  assert.equal(queue.byId.g1.waiting, 0);
  assert.ok(queue.byId.g2.waiting > 0, 'g2 comes up behind g1 and waits: ' + queue.byId.g2.waiting);
  assert.equal(queue.byId.g2.total, queue.byId.g2.walking + queue.byId.g2.waiting);
});

test('groups going up and down through the middle landing of a chain do not stop each other', () => {
  const project = threeFloors();
  const { byId } = run(project, [['g1', '1A', '3A', 25], ['g2', '3A', '1A', 25]]);
  assert.deepEqual(figures(byId.g1), { walking: 33, waiting: 0, total: 33, late: false, arrived: true });
  assert.deepEqual(figures(byId.g2), { walking: 33, waiting: 0, total: 33, late: false, arrived: true });
});

test('a circular wait ends with "did not arrive" at the cap', () => {
  // Both groups reach the middle cell on tick 6, one walking east and one west, and both want to turn left
  // there on tick 9: each stands in the lane the other has to cross.
  const project = planProject([CROSS]);
  const { byId, result } = run(project, [['g1', '1A', '1C', 6], ['g2', '1B', '1D', 6]]);
  for (const group of [byId.g1, byId.g2]) {
    assert.deepEqual(figures(group), { walking: 12, waiting: 712, total: 720, late: true, arrived: false }, 'refused on every tick from 9 to 720');
    assert.equal(group.positions[720], 2, 'still on the middle cell');
  }
  assert.equal(result.cap, 720);
  assert.equal(result.seconds, 720);

  const short = run(project, [['g1', '1A', '1C', 6], ['g2', '1B', '1D', 6]], { passingSeconds: 100 });
  assert.equal(short.byId.g1.total, 600, 'never before 600 seconds');
  assert.equal(short.byId.g1.arrived, false);
});

test('"did not arrive" reaches the checks as a group-walk finding that says so', () => {
  const project = withSchedule(planProject([CROSS]), { North: ['1A', '1C'], South: ['1B', '1D'] }, { North: 6, South: 6 });
  const { graph, crowd } = everything(project);
  const walks = walkResults(project, crowd, graph);
  assert.equal(walks.groups.length, 2);
  assert.deepEqual(walks.groups.map((walk) => [walk.arrived, walk.late, walk.total]), [[false, true, 720], [false, true, 720]]);
  const findings = checkSchedule(project, walks).findings.filter((finding) => finding.kind === 'group-walk');
  assert.equal(findings.length, 2);
  for (const finding of findings) assert.match(finding.text, /did not arrive/);
});

test('a walk longer than the cap is stopped without having waited; one that steps in on the cap tick arrived', () => {
  const sixtyOne = planProject([['A' + '#'.repeat(61) + 'B']]);
  sixtyOne.settings.secondsPerCell = 10;
  const over = run(sixtyOne, [['g1', '1A', '1B', 6]], { passingSeconds: 100 });
  assert.deepEqual(figures(over.byId.g1), { walking: 610, waiting: 0, total: 600, late: true, arrived: false });
  const sixty = planProject([['A' + '#'.repeat(60) + 'B']]);
  sixty.settings.secondsPerCell = 10;
  const just = run(sixty, [['g1', '1A', '1B', 6]], { passingSeconds: 100 });
  assert.deepEqual(figures(just.byId.g1), { walking: 600, waiting: 0, total: 600, late: true, arrived: true });
});

test('a route that is the same room, or failed, takes no part and has no figures', () => {
  const project = planProject([[
    'A#####B',
    '.......',
    '..C....',
  ]]);
  const graph = routingGraph(project);
  const same = route(graph, roomId('1A'), roomId('1A'));
  const failed = route(graph, roomId('1A'), roomId('1C'));
  assert.equal(same.same, true);
  assert.equal(failed.ok, false);
  assert.equal(routePath(graph, same), null);
  assert.equal(routePath(graph, failed), null);
  assert.equal(walkingSeconds(graph, failed), null);
  const result = simulateTransition(graph, [{ id: 'g1', headCount: 25, route: same }, { id: 'g2', headCount: 25, route: failed }, { id: 'g3', headCount: 25, route: route(graph, roomId('1A'), roomId('1B')) }], { passingSeconds: 240 });
  assert.deepEqual(result.groups.map((group) => group.groupId), ['g3']);
  assert.equal(result.groups[0].waiting, 0, 'and they are in nobody\'s way');
  const nobody = simulateTransition(graph, [], { passingSeconds: 240 });
  assert.deepEqual([nobody.groups.length, nobody.seconds], [0, 0]);
});

test('the crowd model refuses a graph that does not carry the walking speeds', () => {
  const project = twoRooms();
  assert.throws(() => simulateTransition(buildGraph(project), [], {}), /routingGraph/);
});

test('a day: each transition uses its own passing time and the school\'s margin, and a blank head count the default', () => {
  const project = withSchedule(planProject([['A#####B']]), { One: ['1A', '1B', '1A'], Two: ['1A', '1B', '1B'], Three: ['1B', '1B', null] }, { One: 6 });
  project.dayTypes[0].bells = [{ start: '08:00', end: '08:45' }, { start: '08:50', end: '09:35' }, null];
  const { graph, routes, crowd } = everything(project);
  assert.equal(crowd.days.length, 1, 'B Day is the same as A Day and has no run of its own');
  const day = crowd.days[0];
  assert.deepEqual(day.transitions.map((transition) => [transition.period, transition.passingSeconds, transition.cap]), [[0, 300, 900], [1, 240, 720]]);
  assert.deepEqual(day.transitions[0].groups.map((group) => [group.groupId, group.headCount, group.length]), [['gplan00001', 6, 1], ['gplan00002', 25, 5]], 'Three stays where it is');
  assert.deepEqual(day.transitions[1].groups.map((group) => group.groupId), ['gplan00001'], 'Two stays, and Three has nowhere to go');
  assert.deepEqual(simulateDay(project, routes, project.dayTypes[1].id, graph), day, 'asked for B Day, A Day answers');
  assert.deepEqual(simulateDayTransition(project, routes, project.dayTypes[0].id, 1, graph), day.transitions[1], 'one transition on its own gives the same figures');
  assert.equal(simulateDayTransition(project, routes, project.dayTypes[0].id, 2, graph), null, 'there is no transition out of the last period');
  assert.equal(simulateDay(project, routes, 'dnowhere00', graph), null);

  // 15 seconds of walking against a passing time of 12, then with a margin of 3 and of 2
  project.dayTypes[0].bells = [null, null, null];
  project.settings.defaultPassingSeconds = 12;
  const lateOf = () => simulateDay(project, routes, project.dayTypes[0].id, graph).transitions[1].groups[0].late;
  assert.equal(lateOf(), true);
  project.settings.checks.passingMarginSeconds = 3;
  assert.equal(lateOf(), false, 'the margin is added to the passing time');
  project.settings.checks.passingMarginSeconds = 2;
  assert.equal(lateOf(), true);
});

test('the sample school: 8A\'s walk from the Gym to 303 is the one late walk, at 261 seconds', () => {
  const project = school();
  const { graph, crowd } = everything(project);
  const late = [];
  for (const day of crowd.days) for (const transition of day.transitions) for (const group of transition.groups) if (group.late) late.push([day.dayTypeId, transition.period, group.groupId]);
  const wanted = SAMPLE_PROBLEMS.longWalk;
  assert.deepEqual(late, [[wanted.dayTypeId, wanted.fromPeriod, wanted.groupId]]);
  const walk = crowd.days[0].transitions[wanted.fromPeriod].groups.find((group) => group.groupId === wanted.groupId);
  // 81 cells and two connections of round(8 / 3) = 3 slots: 87 slots at 3 seconds
  assert.deepEqual(figures(walk), { walking: 261, waiting: 0, total: 261, late: true, arrived: true });
  assert.deepEqual([walk.fromRoomId, walk.toRoomId], [wanted.fromRoomId, wanted.toRoomId]);

  const walks = walkResults(project, crowd, graph);
  assert.deepEqual(Object.keys(walks.groups[0]), ['dayTypeId', 'groupId', 'period', 'fromRoomId', 'toRoomId', 'passingSeconds', 'total', 'walking', 'waiting', 'late', 'arrived']);
  assert.equal(walks.groups.length, 8 * 7 * 2, 'every walk is listed, late or not');
  assert.deepEqual(walks.teachers, [], 'no teacher in the sample changes room between two periods');
  const findings = checkSchedule(project, walks).findings.filter((finding) => finding.kind === 'group-walk' || finding.kind === 'teacher-walk');
  assert.deepEqual(findings.map((finding) => finding.id), ['group-walk:' + wanted.dayTypeId + ':' + wanted.fromPeriod + ':' + wanted.groupId]);
  assert.match(findings[0].text, /4 min 21 s/);

  project.settings.checks.passingMarginSeconds = 21;
  assert.equal(checkSchedule(project, walkResults(project, everything(project).crowd, graph)).findings.filter((finding) => finding.kind === 'group-walk').length, 0, '261 is not more than 240 + 21');
});

test('deterministic: two runs, and a run with the groups array reversed, give identical figures', () => {
  const project = school();
  const first = everything(project);
  const second = everything(school());
  assert.deepEqual(second.crowd, first.crowd);

  const reversed = clone(project);
  reversed.groups.reverse();
  const third = everything(reversed);
  assert.deepEqual(third.crowd, first.crowd, 'every figure, every position, every second of delay');
  const sorted = (walks) => walks.groups.slice().sort((a, b) => (a.dayTypeId + a.period + a.groupId < b.dayTypeId + b.period + b.groupId ? -1 : 1));
  assert.deepEqual(sorted(walkResults(reversed, third.crowd, third.graph)), sorted(walkResults(project, first.crowd, first.graph)));
  // and the run is not trivially quiet: groups do wait on each other in the sample
  let waiting = 0;
  for (const day of first.crowd.days) for (const transition of day.transitions) for (const group of transition.groups) waiting += group.waiting;
  assert.ok(waiting > 100, 'the sample school has crowding to agree about: ' + waiting + ' s');
});

test('waiting is total − walking for a group that arrived, and every second of it is charged to a cell or a connection', () => {
  for (const project of [school(), bigProject({ seed: 1 })]) {
    const { crowd } = everything(project);
    let groups = 0;
    for (const day of crowd.days) {
      for (const transition of day.transitions) {
        let waited = 0;
        for (const group of transition.groups) {
          groups += 1;
          waited += group.waiting;
          if (group.arrived) assert.equal(group.waiting, group.total - group.walking);
          else assert.equal(group.total, transition.cap);
          assert.equal(group.late, group.arrived ? isLate(group.total, transition.passingSeconds, transition.marginSeconds) : true);
          assert.equal(group.positions.length, transition.seconds + 1);
        }
        const charged = transition.cellDelay.reduce((sum, value) => sum + value, 0) + transition.connectionDelay.reduce((sum, value) => sum + value, 0);
        assert.equal(charged, waited);
      }
    }
    assert.ok(groups > 100);
  }
});

test('a teacher\'s walk is timed by walking alone and judged by the same late rule', () => {
  const project = withSchedule(twoRooms(), { One: ['1A', '1B', '1B'] });
  project.teachers = [{ id: 'tplan00001', name: 'Mx. Tarn', subjectId: null, roomIds: [roomId('1A'), roomId('1B')], notes: '' }];
  for (const space of project.building.floors[0].spaces) if (space.kind === 'room') space.teacherIds = ['tplan00001'];
  assertValid(project);
  const graph = routingGraph(project);
  const found = route(graph, roomId('1A'), roomId('1B'));
  const walking = walkingSeconds(graph, found);
  assert.equal(walking, found.cells.length * 3);

  project.settings.defaultPassingSeconds = walking;
  assert.deepEqual(teacherWalks(project, graph), [{ dayTypeId: project.dayTypes[0].id, teacherId: 'tplan00001', period: 0, fromRoomId: roomId('1A'), toRoomId: roomId('1B'), passingSeconds: walking, walking, late: false }]);
  project.settings.defaultPassingSeconds = walking - 1;
  const walks = walkResults(project, everything(project).crowd, graph);
  assert.equal(walks.teachers.length, 1);
  assert.equal(walks.teachers[0].late, true);
  const findings = checkSchedule(project, walks).findings.filter((finding) => finding.kind === 'teacher-walk');
  assert.equal(findings.length, 1);
  assert.match(findings[0].text, /Mx\. Tarn/);
});
