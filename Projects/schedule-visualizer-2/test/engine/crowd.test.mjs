// The crowd model, rule by rule (ARCHITECTURE 6.3). Each plan is drawn in the
// test that uses it. Unless a test says otherwise a cell takes 3 seconds, a
// stairs connection 8, the passing time is 240 seconds, and a group of 6 is
// one slot long, a group of 25 five.
//
// The figures asserted here are worked out by hand from the rules in the
// comment beside them, not read back from a run.
//
// Rule 4, the left turn across the oncoming lane, was amended on 2026-10-08
// (SV2-37). Its clauses each have a test of their own below: steady traffic
// is waited for, 6 seconds at most; a standing group is walked around; two
// groups in each other's way go lower id first.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, nodeAt } from '../../engine/graph.js';
import { route, routesForSchedule, routingGraph } from '../../engine/routing.js';
import { emptySlot, emptyBells, GROUP_COLOUR_PRESETS, defaultSettings } from '../../engine/schema.js';
import { checkSchedule } from '../../engine/checks.js';
import { validate } from '../../engine/validate.js';
import { isLate, crowdCap, columnLength, routePath, walkingSeconds, simulateTransition, simulateDayTransition, simulateDay, simulateSchedule, teacherWalks, walkResults, rideFor, headCountOf, CAP_MINIMUM_SECONDS, CROSSING_WAIT_MAX } from '../../engine/crowd.js';
import { SAMPLE_PROBLEMS } from '../../data/sample-school.js';
import { meetingSlots, runsOf } from '../../engine/runs.js';
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

test('a left turn across steady oncoming traffic waits, 6 seconds at most, and a right turn does not wait', () => {
  assert.equal(CROSSING_WAIT_MAX, 6);
  const project = planProject([CROSS]);
  // The traffic walks west: its column of 5 takes the middle cell on tick 6 and its tail leaves it on tick 21,
  // never refused a step. The turner walks east, is on the middle cell from tick 6, and wants to turn on tick 9.
  // It is refused on ticks 9 to 14, has then waited its 6 seconds, and crosses on tick 15 with the column still passing.
  const left = run(project, [['g1', '1B', '1A', 25], ['g2', '1A', '1C', 6]]);
  assert.deepEqual(figures(left.byId.g1), { walking: 15, waiting: 0, total: 15, late: false, arrived: true }, 'the traffic is not held up');
  assert.deepEqual(figures(left.byId.g2), { walking: 12, waiting: 6, total: 18, late: false, arrived: true }, 'refused on ticks 9 to 14, turns on tick 15');
  assert.equal(left.byId.g2.positions[14], 2, 'still on the middle cell after 6 seconds of asking');
  assert.equal(left.byId.g2.positions[15], 3);
  const north = nodeAt(left.graph, F1, cellAt(project, 1, 3, 1));
  assert.equal(left.result.cellDelay[north], 6, 'the wait is charged to the cell it was turning into');
  assert.equal(left.result.cellDelay.reduce((sum, value) => sum + value, 0), 6);

  // a group of 6 coming the other way is one slot: it leaves the middle cell on tick 9, and the turner reads the lane clear on tick 10
  const brief = run(project, [['g1', '1B', '1A', 6], ['g2', '1A', '1C', 6]]);
  assert.deepEqual(figures(brief.byId.g2), { walking: 12, waiting: 1, total: 13, late: false, arrived: true }, 'a gap that comes sooner is taken sooner');

  const right = run(project, [['g1', '1B', '1A', 25], ['g2', '1A', '1D', 6]]);
  assert.deepEqual(figures(right.byId.g2), { walking: 12, waiting: 0, total: 12, late: false, arrived: true });

  const alone = run(project, [['g2', '1A', '1C', 6]]);
  assert.equal(alone.byId.g2.waiting, 0, 'a left turn with nobody coming does not wait');
});

test('the 6 seconds are counted afresh at each crossing', () => {
  // The turner walks east from A, turns left at (4,3) across g1 walking west, walks north, and turns left
  // again at (4,1) across g2 walking south out of E.
  const project = planProject([[
    '....E...',
    'D####...',
    '....#...',
    'A######B',
  ]]);
  // g1, 5 slots, holds the westward lane of (4,3) from tick 6 to tick 21: the turner wants its turn on tick 12,
  // is refused on ticks 12 to 17 and turns on tick 18. It takes (4,1) on tick 21 and wants the second turn on
  // tick 24. g2, 60 students and 10 slots, holds the southward lane of (4,1) from tick 0 to tick 30: refused on
  // ticks 24 to 29, the turner turns on tick 30.
  const { byId } = run(project, [['g1', '1B', '1A', 25], ['g2', '1E', '1B', 60], ['g3', '1A', '1D', 6]]);
  assert.equal(byId.g2.length, 10);
  assert.deepEqual([byId.g1.waiting, byId.g2.waiting], [0, 0], 'both flows walk on unhindered');
  assert.deepEqual(figures(byId.g3), { walking: 27, waiting: 12, total: 39, late: false, arrived: true });
});

test('seconds refused because the cell ahead is taken are not seconds waited for the crossing', () => {
  const project = planProject([CROSS]);
  // g1 walks north from D to C, 5 slots: it holds the northward lane of (3,1), the cell the turner wants, from
  // tick 6 to tick 21. g2, 10 slots, walks west and holds the oncoming lane of the middle cell from tick 6 to
  // tick 36. The turner asks on tick 9: the cell ahead is taken until tick 21 (13 seconds), and only from tick 22
  // is it the crossing that refuses it, on ticks 22 to 27. It turns on tick 28.
  const { byId } = run(project, [['g1', '1D', '1C', 25], ['g2', '1B', '1A', 60], ['g3', '1A', '1C', 6]]);
  assert.deepEqual([byId.g1.waiting, byId.g2.waiting], [0, 0]);
  assert.deepEqual(figures(byId.g3), { walking: 12, waiting: 19, total: 31, late: false, arrived: true });
});

test('a standing group in the oncoming lane is walked around, and the same group walking is waited for', () => {
  const project = planProject([[
    '.....C...',
    '.....#...',
    'A#######B',
  ]]);
  // g1, 5 slots, comes south out of C and turns west: it takes (4,2) on tick 6 and its tail leaves it on tick 21.
  // g2 walks west from B, takes (5,2) on tick 6 and wants (4,2) on tick 9: refused on ticks 9 to 21, it stands
  // on (5,2) in the westward lane. g3 walks east from A, takes (5,2) on tick 12 and wants to turn left, north,
  // on tick 15. The lane it has to cross is held by g2, which was refused on tick 14: it is standing, and g3
  // walks around it without waiting.
  const standing = run(project, [['g1', '1C', '1A', 25], ['g2', '1B', '1A', 6], ['g3', '1A', '1C', 6]]);
  assert.deepEqual(figures(standing.byId.g2), { walking: 21, waiting: 13, total: 34, late: false, arrived: true }, 'g2 does stand: 13 seconds behind g1');
  assert.deepEqual(figures(standing.byId.g3), { walking: 18, waiting: 0, total: 18, late: false, arrived: true });
  assert.equal(standing.byId.g3.positions[15], 5, 'it turns on the tick it asks');

  // Without g1 nothing stops the westward group. As 10 slots it holds the westward lane of (5,2) from tick 6 to
  // tick 36, stepping every 3 seconds: g3 is refused on ticks 15 to 20 and crosses on tick 21.
  const walking = run(project, [['g2', '1B', '1A', 60], ['g3', '1A', '1C', 6]]);
  assert.equal(walking.byId.g2.waiting, 0);
  assert.deepEqual(figures(walking.byId.g3), { walking: 18, waiting: 6, total: 24, late: false, arrived: true }, 'a group between two steps is walking, not standing');
});

test('two left-turners in each other\'s way: the lower id goes first, and both arrive', () => {
  // Both groups reach the middle cell on tick 6, one walking east and one west, and both want to turn left
  // there on tick 9: each stands in the lane the other has to cross. As the rule was first written this was a
  // wait with no end, stopped at 720 seconds. Now g1 turns on tick 9; g2, refused that once, reads the lane
  // clear on tick 10.
  const project = planProject([CROSS]);
  const { byId, result } = run(project, [['g1', '1A', '1C', 6], ['g2', '1B', '1D', 6]]);
  assert.deepEqual(figures(byId.g1), { walking: 12, waiting: 0, total: 12, late: false, arrived: true });
  assert.deepEqual(figures(byId.g2), { walking: 12, waiting: 1, total: 13, late: false, arrived: true });
  assert.deepEqual([byId.g1.positions[9], byId.g2.positions[9], byId.g2.positions[10]], [3, 2, 3]);
  assert.equal(result.seconds, 13, 'the transition is over when g2 is in its room');

  const swapped = run(project, [['g2', '1A', '1C', 6], ['g1', '1B', '1D', 6]]);
  assert.deepEqual([swapped.byId.g1.waiting, swapped.byId.g2.waiting], [0, 1], 'the id decides, not the room');
  assert.equal(swapped.byId.g1.fromRoomId, roomId('1B'));
  const given = run(project, [['g2', '1B', '1D', 6], ['g1', '1A', '1C', 6]]);
  assert.deepEqual([given.byId.g1.waiting, given.byId.g2.waiting], [0, 1], 'the order of the list changes nothing');

  // As columns of 5: g1 turns on tick 9 and its body is on the middle cell until tick 21, stepping all the
  // while, so to g2 it is steady traffic: refused on ticks 9 to 14, g2 turns on tick 15.
  const columns = run(project, [['g1', '1A', '1C', 25], ['g2', '1B', '1D', 25]]);
  assert.deepEqual(figures(columns.byId.g1), { walking: 12, waiting: 0, total: 12, late: false, arrived: true });
  assert.deepEqual(figures(columns.byId.g2), { walking: 12, waiting: 6, total: 18, late: false, arrived: true });
});

test('the lower id goes first only when both became ready on the same tick', () => {
  const project = planProject([[
    '...C....',
    '...#....',
    'A######B',
    '...#....',
    '...D....',
  ]]);
  // g1 leaves A first and walks straight on to B, so g3 behind it waits 4 seconds at the door: g3 takes the
  // middle cell (3,2) on tick 10 and is ready to turn left, north, on tick 13. g2 walks west from B, takes the
  // middle cell on tick 9 and is ready to turn left, south, on tick 12. Each is in the lane the other crosses.
  // Tick 12: g2 asks alone; g3 is between two steps, so g2 is refused. Tick 13: g3 asks, g2 was refused the
  // tick before and is standing, so g3 walks around it; g2 asks again and g3 was not refused on tick 12, so g2
  // is refused though its id is the lower. Tick 14: g3 has left the cell and g2 turns.
  const { byId } = run(project, [['g1', '1A', '1B', 6], ['g2', '1B', '1D', 6], ['g3', '1A', '1C', 6]]);
  assert.equal(byId.g1.waiting, 0);
  assert.deepEqual(figures(byId.g2), { walking: 15, waiting: 2, total: 17, late: false, arrived: true }, 'refused on ticks 12 and 13');
  assert.deepEqual(figures(byId.g3), { walking: 12, waiting: 4, total: 16, late: false, arrived: true }, 'only the 4 seconds at the door');
});

test('a group that is waiting holds up the group behind it', () => {
  const project = planProject([CROSS]);
  // g2 turns left and waits for the traffic as above, standing on the middle cell until tick 15.
  // g3 follows it out of the same room, going straight on east: 4 seconds at the door (g2 has it first),
  // then it reaches the cell behind g2 on tick 7, wants the middle cell on tick 10 and is refused until g2 has left: 6 more.
  const { byId, result } = run(project, [['g1', '1B', '1A', 25], ['g2', '1A', '1C', 6], ['g3', '1A', '1B', 6]]);
  assert.deepEqual(figures(byId.g2), { walking: 12, waiting: 6, total: 18, late: false, arrived: true });
  assert.deepEqual(figures(byId.g3), { walking: 15, waiting: 10, total: 25, late: false, arrived: true });
  const middle = nodeAt(routingGraph(project), F1, cellAt(project, 1, 3, 2));
  assert.equal(result.cellDelay[middle], 6, 'g3 was refused the middle cell 6 times');

  const free = run(project, [['g2', '1A', '1C', 6], ['g3', '1A', '1B', 6]]);
  assert.equal(free.byId.g3.waiting, 4, 'without the traffic it only waits at the door');
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

test('"did not arrive" reaches the checks as a group-walk finding that says so', () => {
  // 73 cells at 10 seconds is 730 seconds of walking against a cap of 3 × 240 = 720
  const project = planProject([['A' + '#'.repeat(73) + 'B']]);
  project.settings.secondsPerCell = 10;
  withSchedule(project, { North: ['1A', '1B'] }, { North: 6 });
  const { graph, crowd } = everything(project);
  const walks = walkResults(project, crowd, graph);
  assert.deepEqual(walks.groups.map((walk) => [walk.arrived, walk.late, walk.total, walk.waiting]), [[false, true, 720, 0]]);
  const findings = checkSchedule(project, walks).findings.filter((finding) => finding.kind === 'group-walk');
  assert.equal(findings.length, 1);
  assert.match(findings[0].text, /did not arrive/);
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

  // the cap is three times the passing time: 73 cells at 10 seconds against 3 × 240
  const long = planProject([['A' + '#'.repeat(73) + 'B']]);
  long.settings.secondsPerCell = 10;
  const stopped = run(long, [['g1', '1A', '1B', 6]]);
  assert.deepEqual(figures(stopped.byId.g1), { walking: 730, waiting: 0, total: 720, late: true, arrived: false });
  assert.deepEqual([stopped.result.cap, stopped.result.seconds], [720, 720]);
  assert.equal(stopped.byId.g1.positions[720], 72, 'stopped on the last cell, one step from the door');

  // a stopped group is late whatever the margin: here 600 is not more than 100 + 600
  const forgiving = run(sixtyOne, [['g1', '1A', '1B', 6]], { passingSeconds: 100, marginSeconds: 600 });
  assert.deepEqual([forgiving.byId.g1.total, forgiving.byId.g1.arrived, forgiving.byId.g1.late], [600, false, true]);
  const inTime = run(sixty, [['g1', '1A', '1B', 6]], { passingSeconds: 100, marginSeconds: 600 });
  assert.deepEqual([inTime.byId.g1.arrived, inTime.byId.g1.late], [true, false], 'and one that arrived is judged by the margin');
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

test('a teacher walk to a room that opens onto no corridor is failed and late, as one with no way through is (SV2-94b)', () => {
  const project = withSchedule(planProject([[
    'A#####B',
    '.......',
    '..C....',
  ]]), { One: ['1A', '1C', '1C'] });
  project.teachers = [{ id: 'tplan00001', name: 'Mx. Tarn', subjectId: null, roomIds: [roomId('1A'), roomId('1C')], notes: '' }];
  for (const space of project.building.floors[0].spaces) if (space.kind === 'room') space.teacherIds = space.id === roomId('1B') ? [] : ['tplan00001'];
  assertValid(project);
  const graph = routingGraph(project);
  assert.equal(route(graph, roomId('1A'), roomId('1C')).reason, 'no-entry', 'the room has no corridor edge');
  const walks = teacherWalks(project, graph);
  assert.equal(walks.length, 1, 'the walk is there, not dropped');
  assert.deepEqual(walks[0], { dayTypeId: project.dayTypes[0].id, teacherId: 'tplan00001', period: 0, fromRoomId: roomId('1A'), toRoomId: roomId('1C'), passingSeconds: walks[0].passingSeconds, failed: true, late: true });
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

// ---- SV2-83b: a follower that has its own run is simulated with its own slots

function followerSchool(kind) {
  const project = school();
  project.dayTypes.push({ id: 'dsample00c', name: 'C Day', own: false, sameAs: 'dsample00a', short: '', bells: Array(project.settings.periods).fill(null) });
  project.marks = [{ id: 'maaaaaaaa1', kind, label: '', period: 2, dayTypeIds: ['dsample00c'], scope: 'school', grades: [], groupIds: [] }];
  return project;
}

function simulate(project) {
  const graph = routingGraph(project);
  const routes = routesForSchedule(project, graph, { runs: runsOf(project), meetingSlots });
  const crowd = simulateSchedule(project, routes, graph);
  return { crowd, walks: walkResults(project, crowd, graph) };
}

test('a No class mark naming a follower: the follower is simulated on its own slots, once, and A Day is untouched', () => {
  const marked = simulate(followerSchool('noclass'));
  const plain = simulate(school());
  const ids = marked.crowd.days.map((day) => day.dayTypeId);
  assert.deepEqual(ids, ['dsample00a', 'dsample00b', 'dsample00c']);
  assert.equal(new Set(ids).size, ids.length);
  const [a, , c] = marked.crowd.days;
  // A Day's transitions are what they were without the mark
  assert.deepEqual(a, plain.crowd.days[0]);
  // C Day's transition out of period 1 (into the unmet period 2) differs from A Day's
  assert.notDeepEqual(c.transitions[1].groups, a.transitions[1].groups);
  const keys = marked.walks.groups.map((w) => [w.dayTypeId, w.bellsId || '', w.period, w.groupId, w.toPeriod === undefined ? '' : w.toPeriod].join('|'));
  assert.equal(new Set(keys).size, keys.length, 'walkResults holds no duplicate key');
  assert.ok(marked.walks.groups.some((w) => w.dayTypeId === 'dsample00c'));
});

test('an advisory mark naming a follower adds no run: the follower is answered from its base, as it was', () => {
  const marked = simulate(followerSchool('advisory'));
  assert.deepEqual(marked.crowd.days.map((day) => day.dayTypeId), ['dsample00a', 'dsample00b']);
  assert.deepEqual(marked.crowd.days, simulate(school()).crowd.days);
  assert.deepEqual(simulateDay(followerSchool('advisory'), routesForSchedule(followerSchool('advisory'), routingGraph(followerSchool('advisory')), { runs: runsOf(followerSchool('advisory')), meetingSlots }), 'dsample00c').dayTypeId, 'dsample00a');
});

// ---------------------------------------------------------------- staggered dismissal (SV2-88, ARCHITECTURE 18.2)
//
// A delayed group's first readyAt is its delay and nothing else changes in the
// rules. Arrival is counted from the bell, so total = released + walking +
// waiting. `released` is on a group's figures only when it was held.

// run() with a fifth entry per walk: the group's delay in seconds.
function runHeld(project, walks, options) {
  const graph = routingGraph(project);
  const walkers = walks.map(([id, from, to, headCount, delay]) => ({ id, headCount, delay, route: route(graph, roomId(from), roomId(to)) }));
  const result = simulateTransition(graph, walkers, { passingSeconds: 240, marginSeconds: 0, ...options });
  return { graph, result, byId: Object.fromEntries(result.groups.map((group) => [group.groupId, group])) };
}

test('a delayed group starts at its delay: released is its own figure, and total = released + walking + waiting', () => {
  const project = planProject([['A#####B']]);
  const { byId } = runHeld(project, [['g1', '1A', '1B', 25, 40]]);
  const group = byId.g1;
  assert.deepEqual({ released: group.released, walking: group.walking, waiting: group.waiting, total: group.total, arrived: group.arrived }, { released: 40, walking: 15, waiting: 0, total: 55, arrived: true });
  assert.equal(group.total, group.released + group.walking + group.waiting);
  assert.equal(group.positions[39], -1, 'still in the room on the tick before its delay is up');
  assert.equal(group.positions[40], 0, 'and takes its first slot on the tick it is released');
  assert.equal(group.positions[43], 1);
  // the cap is counted from the bell and the passing time is the same one: late is judged against 240
  assert.equal(runHeld(project, [['g1', '1A', '1B', 25, 40]], { passingSeconds: 54 }).byId.g1.late, true);
  assert.equal(runHeld(project, [['g1', '1A', '1B', 25, 40]], { passingSeconds: 55 }).byId.g1.late, false);
});

test('a group with no delay, or a delay of 0, has no `released` and the figures it always had', () => {
  const project = planProject([['A#####B']]);
  const plain = runHeld(project, [['g1', '1A', '1B', 25], ['g2', '1A', '1B', 25, 0]]);
  assert.equal('released' in plain.byId.g1, false);
  assert.equal('released' in plain.byId.g2, false);
  const unheld = run(project, [['g1', '1A', '1B', 25], ['g2', '1A', '1B', 25]]);
  assert.deepEqual(plain.result.groups, unheld.result.groups, 'every figure and every position');
  assert.deepEqual(Object.keys(plain.byId.g1), Object.keys(unheld.byId.g1));
});

test('a delayed group frees a jammed corridor, so the group behind it arrives earlier', () => {
  const project = planProject([['A#####B']]);
  const jam = runHeld(project, [['g1', '1A', '1B', 25], ['g2', '1A', '1B', 25]]);
  assert.deepEqual([jam.byId.g2.waiting, jam.byId.g2.total], [16, 31], 'with no delay g2 waits for g1\'s column of 5');
  const held = runHeld(project, [['g1', '1A', '1B', 25, 30], ['g2', '1A', '1B', 25]]);
  assert.deepEqual(figures(held.byId.g2), { walking: 15, waiting: 0, total: 15, late: false, arrived: true }, 'g2 goes first and arrives 16 seconds earlier');
  assert.deepEqual([held.byId.g1.released, held.byId.g1.waiting, held.byId.g1.total], [30, 0, 45], 'g1 finds the corridor clear when it is released');
  assert.equal(held.result.cellDelay.reduce((sum, value) => sum + value, 0), 0, 'nobody was refused a step');
});

test('a delay shorter than the jam only shortens it: the delayed group waits the rest', () => {
  const project = planProject([['A#####B']]);
  // g2 leaves at 0 (id order does not matter once g1 is held); g1 is released at 8 and meets g2's column still in the door
  const { byId } = runHeld(project, [['g1', '1A', '1B', 25, 8], ['g2', '1A', '1B', 25]]);
  assert.equal(byId.g2.waiting, 0);
  assert.deepEqual([byId.g1.released, byId.g1.waiting, byId.g1.total], [8, 8, 31], '8 + 15 walking + 8 waiting: g2 clears the first slot on tick 15, g1 reads it free on 16');
  assert.equal(byId.g1.total, byId.g1.released + byId.g1.walking + byId.g1.waiting);
});

test('the release order does not depend on the order the walkers are given in', () => {
  const project = planProject([['A#####B']]);
  const walks = [['g3', '1A', '1B', 25, 20], ['g1', '1A', '1B', 25, 20], ['g2', '1A', '1B', 25]];
  const first = runHeld(project, walks);
  const second = runHeld(project, walks.slice().reverse());
  assert.deepEqual(second.result.groups, first.result.groups);
  assert.deepEqual(first.result.groups.map((group) => group.groupId), ['g1', 'g2', 'g3']);
});

test('a held group still reaches its room: the delay is at most 300 and the cap at least 600, counted from the bell', () => {
  const project = planProject([['A' + '#'.repeat(73) + 'B']]);
  project.settings.secondsPerCell = 5;
  // 73 slots at 5 seconds is 365 s of walking: released at 300 it is 665, past the cap of 600 under a passing time of 100
  const { byId } = runHeld(project, [['g1', '1A', '1B', 6, 300]], { passingSeconds: 100 });
  assert.equal(byId.g1.arrived, false);
  assert.equal(byId.g1.total, 600, 'stopped at the cap, which counts from the bell');
  const roomy = runHeld(project, [['g1', '1A', '1B', 6, 200]], { passingSeconds: 100 });
  assert.deepEqual([roomy.byId.g1.arrived, roomy.byId.g1.total], [true, 565]);
});

test('a day: the crowd looks the delay up with the day type, the period and the room the group leaves', () => {
  const project = withSchedule(planProject([['A#####B', '.......']]), { North: ['1A', '1B', '1A'], South: ['1A', '1B', '1A'] }, { North: 6, South: 6 });
  project.groups[0].grade = '7';
  project.groups[1].grade = '8';
  const dayId = project.dayTypes[0].id;
  project.release = [{ id: 'lcrowd0001', who: { grade: '7' }, seconds: 60, after: [1], dayTypeIds: [dayId] }];
  const { crowd } = everything(project);
  const [first, second] = crowd.days[0].transitions;
  const north = (transition) => transition.groups.find((group) => group.groupId === project.groups[0].id);
  const south = (transition) => transition.groups.find((group) => group.groupId === project.groups[1].id);
  assert.equal('released' in north(first), false, 'after period 1 only');
  assert.equal(north(second).released, 60);
  assert.equal(north(second).total, 60 + north(second).walking + north(second).waiting);
  assert.equal('released' in south(second), false, 'grade 8 is not held');
  assert.equal(south(second).waiting, 0, 'and the held group is out of its way when it leaves');
});

test('a group is late only because of its delay: the walks carry released, and the walk-late finding says why', () => {
  const project = withSchedule(planProject([['A#####B']]), { North: ['1A', '1B'] }, { North: 6 });
  project.settings.defaultPassingSeconds = 20;
  const dayId = project.dayTypes[0].id;
  const without = everything(project);
  const walkedWithout = walkResults(project, without.crowd, without.graph);
  assert.deepEqual(walkedWithout.groups.map((walk) => [walk.total, walk.late]), [[15, false]], '15 seconds of walking against 20: in time');
  assert.equal(checkSchedule(project, walkedWithout).findings.filter((finding) => finding.kind === 'group-walk').length, 0);

  project.release = [{ id: 'lcrowd0001', who: { groups: [project.groups[0].id] }, seconds: 15, after: null, dayTypeIds: null }];
  assert.ok(dayId);
  const held = everything(project);
  const walked = walkResults(project, held.crowd, held.graph);
  assert.deepEqual(walked.groups.map((walk) => [walk.released, walk.walking, walk.waiting, walk.total, walk.late]), [[15, 15, 0, 30, true]], 'late, with the 15 seconds counted in');
  const keys = Object.keys(walked.groups[0]);
  assert.deepEqual(keys, ['dayTypeId', 'groupId', 'period', 'fromRoomId', 'toRoomId', 'passingSeconds', 'total', 'walking', 'waiting', 'released', 'late', 'arrived']);
  const findings = checkSchedule(project, walked).findings.filter((finding) => finding.kind === 'group-walk');
  assert.equal(findings.length, 1, 'still late, so still a finding');
  assert.match(findings[0].text, /needs 30 s to get from Room 1A to Room 1B after Period 1 on A Day and B Day, including leaving 15 s after the bell, and the passing time is 20 s\./);
});

test('deterministic: the sample school with staggered dismissals gives identical figures with the groups reversed', () => {
  const project = school();
  project.release = [
    { id: 'lcrowd0001', who: { grade: '7' }, seconds: 90, after: null, dayTypeIds: null },
    { id: 'lcrowd0002', who: { groups: ['gsample07a'] }, seconds: 0, after: null, dayTypeIds: null },
    { id: 'lcrowd0003', who: { wing: 'East' }, seconds: 30, after: [1, 2, 3], dayTypeIds: null },
  ];
  const first = everything(project);
  const reversed = clone(project);
  reversed.groups.reverse();
  const third = everything(reversed);
  assert.deepEqual(third.crowd, first.crowd, 'every figure, every position, every second of delay');
  let held = 0;
  for (const day of first.crowd.days) for (const transition of day.transitions) for (const group of transition.groups) if (group.released > 0) held += 1;
  assert.ok(held > 20, 'the release is not trivially quiet: ' + held + ' held walks');
  const unheld = everything(school());
  assert.notDeepEqual(first.crowd, unheld.crowd);
});

test('teachers\' walks are not delayed: a teacher leaves with the class or not at all', () => {
  const plain = school();
  const held = { ...school(), release: [{ id: 'lcrowd0001', who: { grade: '6' }, seconds: 120, after: null, dayTypeIds: null }, { id: 'lcrowd0002', who: { wing: 'West' }, seconds: 120, after: null, dayTypeIds: null }] };
  const graph = routingGraph(plain);
  assert.deepEqual(teacherWalks(held, graph), teacherWalks(plain, graph));
});

// ---- SV2-89b: DECISIONS 2026-11-03. A staggered dismissal names own day
// types; one naming a follower applies only to that follower's own run (one a
// No class mark gives it), so it delays nobody on its base's run.

function heldFollowerSchool(withRun) {
  const project = withRun ? followerSchool('noclass') : followerSchool('advisory');
  project.release = [{ id: 'lfollow001', who: { grade: '7' }, seconds: 90, after: null, dayTypeIds: ['dsample00c'] }];
  return project;
}

function releasedIn(day) {
  return day.transitions.flatMap((transition) => transition.groups).filter((group) => 'released' in group).length;
}

test('an entry naming only a follower day type delays nobody on its base\'s run, whether or not the follower has a run of its own', () => {
  for (const withRun of [false, true]) {
    const held = simulate(heldFollowerSchool(withRun));
    const without = simulate({ ...heldFollowerSchool(withRun), release: undefined });
    const [aHeld] = held.crowd.days;
    assert.deepEqual(aHeld, without.crowd.days[0], 'A Day is exactly what it is without the entry (own run: ' + withRun + ')');
    assert.equal(releasedIn(aHeld), 0, 'nobody on A Day is held');
    assert.equal(held.walks.groups.filter((walk) => walk.dayTypeId === 'dsample00a' && 'released' in walk).length, 0, 'and no walk of A Day says it was');
  }
});

test('an entry naming a follower delays the follower\'s own run, the one a No class mark gives it', () => {
  const held = simulate(heldFollowerSchool(true));
  const c = held.crowd.days.find((day) => day.dayTypeId === 'dsample00c');
  assert.ok(releasedIn(c) > 0, 'C Day\'s own run holds grade 7');
  assert.ok(held.walks.groups.some((walk) => walk.dayTypeId === 'dsample00c' && walk.released === 90));
  const none = simulate(heldFollowerSchool(false));
  assert.equal(none.crowd.days.length, 2, 'with no run of its own the follower adds none, and so holds nobody');
});


// ---- elevators (SV2-99, ARCHITECTURE 19.5)
//
// Three floors of one hall, the lift at the west end of each corridor. A cell
// takes 3 seconds, the wait for a car 30 and a floor 6, so a group of 6 (one
// slot long, one trip) going from 1A to 2A walks 4 cells = 12 s and holds the
// car for 30 + 6 = 36 s.

function withCars(project, cars) {
  const at = (number, x, y) => {
    const floor = project.building.floors[number - 1];
    return { floorId: floor.id, cell: y * floor.width + x };
  };
  let n = project.building.connections.length;
  cars.forEach((car, index) => {
    const letter = car.letter || String.fromCharCode(68 + index);
    for (const [number, x, y] of car.stops) {
      const floor = project.building.floors[number - 1];
      const cell = y * floor.width + x;
      floor.cells = floor.cells.slice(0, cell) + 'S' + floor.cells.slice(cell + 1);
      floor.lifts = Array.from(new Set([...(floor.lifts || []), cell])).sort((a, b) => a - b);
    }
    const pairs = car.mode === 'star' ? car.stops.slice(1).map((stop) => [car.stops[0], stop]) : car.stops.slice(1).map((stop, i) => [car.stops[i], stop]);
    for (const [a, b] of pairs) {
      n += 1;
      project.building.connections.push({ id: 'celev' + String(n).padStart(5, '0'), label: letter + n, a: at(...a), b: at(...b), direction: 'both', kind: 'elevator', staffOnly: car.staffOnly === true, car: letter });
    }
  });
  assert.deepEqual(validate(project), []);
  return project;
}

const HALL = ['.AA.BB.', '.AA.BB.', '#######', '.......', '.......'];

function liftHall(mode, settings) {
  const project = planProject([HALL, HALL, HALL], { exits: [[1, 6, 2, 'Main Door']] });
  Object.assign(project.settings, settings || {});
  return withCars(project, [{ stops: [[1, 0, 2], [2, 0, 2], [3, 0, 2]], mode: mode || 'chain' }]);
}

// Same as run(), with each walker's own options ([id, from, to, headCount, routeOptions]).
function ride(project, walks, options) {
  const graph = routingGraph(project);
  const walkers = walks.map(([id, from, to, headCount, routeOptions]) => ({ id, headCount, route: route(graph, roomId(from), roomId(to), routeOptions) }));
  const result = simulateTransition(graph, walkers, { passingSeconds: 240, marginSeconds: 0, ...options });
  return { graph, walkers, result, byId: Object.fromEntries(result.groups.map((group) => [group.groupId, group])) };
}

test('a ride is one slot of its own: walking leaves it out, riding is what the car held the group, and the total is the sum', () => {
  const { graph, walkers, byId } = ride(liftHall(), [['g1', '1A', '2A', 6]]);
  const path = routePath(graph, walkers[0].route);
  assert.equal(path.length, 5, 'cell, cell, the car, cell, cell');
  assert.deepEqual(Array.from(path.rides), [0, 0, 1, 0, 0], 'the car slot is the one that changes a floor');
  const g = byId.g1;
  assert.equal(g.walking, 12, 'four cells at 3 s: no car slot');
  assert.equal(g.riding, 36, 'the 30 s wait and 6 s for one floor');
  assert.equal(g.waiting, 0);
  assert.equal(g.total, 48);
  assert.equal(g.total, (g.released || 0) + g.walking + g.riding + g.waiting, 'total = released + walking + riding + waiting');
  assert.equal(g.arrived, true);
  assert.equal(g.slots, 5);
  assert.equal(walkingSeconds(graph, walkers[0].route), 48, 'a walk timed by itself counts the ride as wait + ride');
  assert.equal(walkers[0].route.seconds, 48, 'and agrees with the router');
});

test('riding is absent from a group that takes no car, and so are its walks', () => {
  const project = liftHall();
  const { byId } = ride(project, [['g1', '1A', '1B', 6]]);
  assert.equal('riding' in byId.g1, false, 'no ride, no `riding` key');
  assert.equal(byId.g1.walking, byId.g1.total);
});

test('a ride changing two floors is wait + 2 floors, and the figure is the car\'s whichever stops it joins', () => {
  for (const mode of ['chain', 'star']) {
    const { byId } = ride(liftHall(mode), [['g1', '1A', '3B', 6]]);
    assert.equal(byId.g1.riding, 30 + 12, mode + ': one ride, 30 s wait and 6 s for each of two floors');
    assert.equal(byId.g1.walking, 7 * 3, mode + ': seven cells, the lift cells included, and no car slot');
    assert.equal(byId.g1.total, 63, mode);
    assert.equal(byId.g1.total, byId.g1.walking + byId.g1.riding, mode);
  }
});

test('rideFor: one trip is wait + ride; more people need more trips, less the column\'s own walk out; never under wait + ride', () => {
  const graph = routingGraph(liftHall());
  // 25 students: 4 trips of 8, a column of 5 cells. 30 + 6 + 3 × (2 × 6 + 2 × 10) − 4 × 3 = 36 + 96 − 12
  assert.equal(rideFor(graph, 1, 25), 120);
  assert.equal(rideFor(graph, 1, 6), 36, 'one trip');
  assert.equal(rideFor(graph, 1, 8), 36, 'a column of 2 takes 3 s back, but the hold is never under wait + ride');
  assert.equal(rideFor(graph, 1, 9), 36 + (12 + 20) - 3, 'two trips, a column of 2');
  assert.equal(rideFor(graph, 2, 9), 30 + 12 + (24 + 20) - 3, 'a ride of two floors: the ride is 12 s each way');
  const { byId } = ride(liftHall(), [['g1', '1A', '2A', 25]]);
  assert.equal(byId.g1.riding, 120);
  assert.equal(byId.g1.walking, 12);
  assert.equal(byId.g1.total, 132);
  const small = routingGraph(liftHall('chain', { elevatorPeoplePerTrip: 25 }));
  assert.equal(rideFor(small, 1, 25), 36, 'a car that holds the whole class takes one trip');
  const slow = routingGraph(liftHall('chain', { elevatorWaitSeconds: 0, elevatorSecondsPerFloor: 2 }));
  assert.equal(rideFor(slow, 1, 6), 2, 'a wait of 0 stays 0');
});

test('two groups wanting one car queue for it, the second waits for the car, and the waiting is charged to the car', () => {
  const { graph, result, byId } = ride(liftHall(), [['g1', '1A', '2A', 6], ['g2', '1A', '2A', 6]]);
  // g1 takes the car at tick 6 and holds it 36 s; g2, a slot behind, asks for it
  // at tick 10, is refused from then until tick 42 (33 s) and takes it at tick 43,
  // after waiting 4 s for the first slot. It then rides 36 s and walks 6 more.
  assert.deepEqual(figures(byId.g1), { walking: 12, waiting: 0, total: 48, late: false, arrived: true });
  assert.deepEqual(figures(byId.g2), { walking: 12, waiting: 37, total: 85, late: false, arrived: true });
  assert.equal(byId.g2.riding, 36);
  assert.equal(byId.g2.total, byId.g2.walking + byId.g2.riding + byId.g2.waiting);
  const car = graph.cars[0].link;
  assert.equal(result.connectionDelay[car], 33, 'the 33 s at the car are the car\'s delay');
  assert.equal(result.connectionDelay.reduce((a, b) => a + b, 0), 33, 'and no other link of the car is charged');
  const first = routePath(graph, graph && ride(liftHall(), [['g1', '1A', '2A', 6]]).walkers[0].route);
  assert.equal(result.cellDelay[first.nodes[0]], 4, 'the 4 s at the door are the cell\'s');
});

test('the car is shared by both directions: a group going up and one coming down queue for the one car', () => {
  const { graph, result, byId } = ride(liftHall(), [['g1', '1A', '2A', 6], ['g2', '2A', '1A', 6]]);
  // both reach the lift cell on their own floor at tick 6; the car is one slot, so the lower id takes it
  assert.equal(byId.g1.waiting, 0);
  assert.ok(byId.g2.waiting >= 36, 'the other waits out the first\'s ride: ' + byId.g2.waiting);
  assert.ok(result.connectionDelay[graph.cars[0].link] >= 36);
});

test('a car\'s whole column holds the car until its tail is through: a longer group makes the next wait longer', () => {
  const short = ride(liftHall(), [['g1', '1A', '2A', 6], ['g2', '1A', '2A', 6]]).byId.g2;
  const long = ride(liftHall(), [['g1', '1A', '2A', 25], ['g2', '1A', '2A', 6]]).byId.g2;
  assert.ok(long.waiting > short.waiting, 'the second group waits longer for a class of 25: ' + long.waiting + ' against ' + short.waiting);
});

test('the elevator figures are the same with the groups in either order', () => {
  const walks = [['g1', '1A', '2A', 25], ['g2', '1A', '3B', 6], ['g3', '2B', '1A', 12], ['g4', '1B', '2A', 6], ['g5', '3A', '1B', 20]];
  const forwards = ride(liftHall(), walks).result;
  const backwards = ride(liftHall(), walks.slice().reverse()).result;
  assert.deepEqual(backwards.groups, forwards.groups);
  assert.deepEqual(backwards.connectionDelay, forwards.connectionDelay);
  assert.deepEqual(backwards.cellDelay, forwards.cellDelay);
  assert.ok(forwards.groups.some((group) => group.riding > 0));
});

test('a school with an elevator and its groups reversed gives every figure of every walk the same', () => {
  const rows = { 'Group 1': ['1A', '2A', '1B'], 'Group 2': ['2B', '1A', '3A'], 'Group 3': ['1A', '3B', '2A'] };
  const build = (reverse) => {
    const project = withSchedule(liftHall(), rows, { 'Group 1': 25 });
    if (reverse) project.groups.reverse();
    return project;
  };
  const outcome = (project) => {
    const graph = routingGraph(project);
    const crowd = simulateSchedule(project, routesForSchedule(project, graph), graph);
    return { crowd, walks: walkResults(project, crowd, graph) };
  };
  const a = outcome(build(false));
  const b = outcome(build(true));
  assert.deepEqual(b.crowd, a.crowd);
  const byGroup = (list) => list.slice().sort((x, y) => (x.groupId + x.period < y.groupId + y.period ? -1 : 1));
  assert.deepEqual(byGroup(b.walks.groups), byGroup(a.walks.groups));
  assert.ok(a.walks.groups.some((walk) => walk.riding > 0), 'some walk rides');
});

test('groupWalks and walkResults carry riding, absent when 0', () => {
  const project = withSchedule(liftHall(), { 'Group 1': ['1A', '2A', '2A'], 'Group 2': ['1B', '1A', '1A'] }, {});
  project.groups[0].stepFree = true;
  const graph = routingGraph(project);
  const crowd = simulateSchedule(project, routesForSchedule(project, graph), graph);
  const walks = walkResults(project, crowd, graph).groups;
  const first = walks.find((walk) => walk.groupId === project.groups[0].id && walk.period === 0);
  const second = walks.find((walk) => walk.groupId === project.groups[1].id && walk.period === 0);
  assert.ok(first.riding > 0 && first.total === first.walking + first.riding + first.waiting, JSON.stringify(first));
  assert.equal('riding' in second, false, 'a walk that takes no car has no riding');
});

test('a teacher\'s walk counts wait + ride and walks without the car slot, and agrees with the router', () => {
  const project = liftHall();
  const graph = routingGraph(project);
  const up = route(graph, roomId('1A'), roomId('2A'));
  assert.equal(walkingSeconds(graph, up), 4 * 3 + 30 + 6, 'four cells at 3 s, the 30 s wait and 6 s a floor');
  assert.equal(walkingSeconds(graph, up), up.seconds);
  const along = route(graph, roomId('1A'), roomId('1B'));
  assert.equal(walkingSeconds(graph, along), along.seconds, 'a walk with no car is its cells');
  const slow = routingGraph(liftHall('chain', { elevatorWaitSeconds: 60, elevatorSecondsPerFloor: 10 }));
  assert.equal(walkingSeconds(slow, route(slow, roomId('1A'), roomId('3B'))), 7 * 3 + 60 + 20, 'the settings are the ride\'s');
});

test('a project with no elevator: no walker has a car slot, no figure has riding, and the slot numbering is as it was', () => {
  const STAIRHALL = ['.AA.BB.', '.AA.BB.', 'S######', '.......', '.......'];
  const project = planProject([STAIRHALL, STAIRHALL], { connections: [[1, 0, 2, 2, 0, 2]], exits: [[1, 6, 2, 'Main Door']] });
  const graph = routingGraph(project);
  assert.deepEqual(graph.cars, []);
  const found = route(graph, roomId('1A'), roomId('2A'));
  const path = routePath(graph, found);
  assert.equal(path.rides.every((levels) => levels === 0), true);
  assert.equal(path.length, 4 + 3, 'four cells and the 8 s stairs as 3 slots');
  assert.equal(found.stairs, 1);
  assert.equal(walkingSeconds(graph, found), path.length * 3);
  const { byId } = ride(project, [['g1', '1A', '2A', 6]]);
  assert.equal(Object.keys(byId.g1).includes('riding'), false);
  assert.equal(byId.g1.total, byId.g1.walking);
});

// ---- SV2-99b

// the one teacher teaches in every room
function teaches(project) {
  const rooms = [];
  for (const floor of project.building.floors) for (const space of floor.spaces) if (space.kind === 'room') { space.teacherIds = ['tplan00001']; rooms.push(space.id); }
  project.teachers[0].roomIds = rooms;
}

test('rideFor at levels 2 and 3: the ride is 6 s a floor each way, the wait is paid once', () => {
  const graph = routingGraph(liftHall());
  // wait 30, 6 s a floor, 8 a trip, doors 10 s each way
  assert.equal(rideFor(graph, 2, 6), 30 + 12, 'level 2, one trip');
  assert.equal(rideFor(graph, 3, 6), 30 + 18, 'level 3, one trip');
  // 25 students: 4 trips of 8, a column of 5 cells (4 × 3 s walked out by the column itself)
  assert.equal(rideFor(graph, 2, 25), 30 + 12 + 3 * (24 + 20) - 4 * 3, 'level 2, four trips');
  assert.equal(rideFor(graph, 3, 25), 30 + 18 + 3 * (36 + 20) - 4 * 3, 'level 3, four trips');
  assert.equal(rideFor(graph, 3, 9), 30 + 18 + (36 + 20) - 3, 'level 3, two trips, a column of 2');
});

test('a group riding two cars in one transition: walking, riding and total against the router\'s seconds', () => {
  // car D joins floors 1 and 2 at the west end, car E floors 2 and 3 at the east end: no one car does the whole way
  const project = withCars(planProject([HALL, HALL, HALL], { exits: [[1, 6, 2, 'Main Door']] }), [{ stops: [[1, 0, 2], [2, 0, 2]] }, { stops: [[2, 6, 2], [3, 6, 2]] }]);
  const { graph, walkers, byId } = ride(project, [['g1', '1A', '3B', 6]]);
  const found = walkers[0].route;
  assert.equal(found.rides, 2, 'the router rides both cars');
  assert.equal(routePath(graph, found).rides.filter((levels) => levels > 0).length, 2);
  const g = byId.g1;
  assert.equal(g.riding, 2 * (30 + 6), 'a wait and a floor for each car');
  assert.equal(g.walking, (g.slots - 2) * 3, 'every slot but the two car slots');
  assert.equal(g.total, g.walking + g.riding, 'nobody in the way');
  assert.equal(g.total, found.seconds, 'the router\'s seconds');
  assert.equal(walkingSeconds(graph, found), found.seconds);
});

test('a teacher\'s walk carries riding and walks without the car slot: walking + riding is the route\'s seconds', () => {
  const project = withSchedule(liftHall(), { One: ['1A', '3B', '3B'] }, {});
  project.teachers = [{ id: 'tplan00001', name: 'Mx. Tarn', subjectId: null, roomIds: [roomId('1A'), roomId('3B')], notes: '' }];
  teaches(project);
  assertValid(project);
  const graph = routingGraph(project);
  const found = route(graph, roomId('1A'), roomId('3B'));
  project.settings.defaultPassingSeconds = 600;
  const [walk] = teacherWalks(project, graph);
  assert.equal(walk.riding, 30 + 12, 'the wait and two floors');
  assert.equal(walk.walking, 7 * 3, 'seven cells and no car slot');
  assert.equal(walk.walking + walk.riding, found.seconds);
  assert.equal(walk.late, false);
  // the late rule judges the sum
  project.settings.defaultPassingSeconds = found.seconds - 1;
  assert.equal(teacherWalks(project, graph)[0].late, true, 'late by the ride: the walk alone would fit');
  assert.ok(teacherWalks(project, graph)[0].walking < found.seconds - 1);
  // a walk with no car has no riding
  const flat = withSchedule(liftHall(), { One: ['1A', '1B', '1B'] }, {});
  flat.teachers = [{ ...project.teachers[0] }];
  teaches(flat);
  assert.equal('riding' in teacherWalks(flat, routingGraph(flat))[0], false);
});

test('a teacher\'s walk through a staff-only car: the teacher rides it, and the figures are the same', () => {
  const build = (staffOnly) => {
    const project = withCars(planProject([HALL, HALL], { exits: [[1, 6, 2, 'Main Door']] }), [{ stops: [[1, 0, 2], [2, 0, 2]], staffOnly }]);
    return withSchedule(project, { One: ['1A', '2A', '2A'] }, {});
  };
  const project = build(true);
  project.teachers = [{ id: 'tplan00001', name: 'Mx. Tarn', subjectId: null, roomIds: [roomId('1A'), roomId('2A')], notes: '' }];
  teaches(project);
  assertValid(project);
  const graph = routingGraph(project);
  const walks = teacherWalks(project, graph);
  assert.equal(walks.length, 1);
  assert.equal(walks[0].failed, undefined, 'a teacher has a way through');
  assert.equal(walks[0].riding, 36);
  assert.equal(walks[0].walking, 12);
  // a class cannot take it: a step-free group has no way
  const walker = route(graph, roomId('1A'), roomId('2A'), { studentsOnly: true });
  assert.equal(walker.ok, false, 'students are kept out of a staff-only car');
});

test('SV2-102b: headCountOf is the crowd model\'s head-count rule: a count in range, else the school\'s default, else the shipped default', () => {
  assert.equal(headCountOf({ headCount: 25 }, { defaultHeadCount: 30 }), 25);
  for (const odd of [null, undefined, 0, -3, 2.5, 100000, '12']) assert.equal(headCountOf({ headCount: odd }, { defaultHeadCount: 30 }), 30, String(odd));
  assert.equal(headCountOf({ headCount: null }, null), defaultSettings().defaultHeadCount, 'no settings: the shipped default');
  assert.equal(headCountOf(null, { defaultHeadCount: 0 }), defaultSettings().defaultHeadCount, 'a default that is no head count is not used');
});
