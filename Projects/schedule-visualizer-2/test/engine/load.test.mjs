// Load: what each group adds to the cells and connections it crosses, the
// busiest moment against the total over the day, the unit, exclusion zones,
// who the contributors are, and the five colour bands.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, nodeAt } from '../../engine/graph.js';
import { routesForSchedule, routingGraph } from '../../engine/routing.js';
import { emptySlot, emptyBells, GROUP_COLOUR_PRESETS } from '../../engine/schema.js';
import { loads, contributors, bandOf, bandEdges, LOAD_BANDS } from '../../engine/load.js';
import { school, assertValid } from './helpers.mjs';
import { planProject, threeFloors, cellAt, floorId, roomId } from '../fixtures/buildings/plans.mjs';

const F1 = floorId(1);

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

function loaded(project, graph) {
  const base = graph || buildGraph(project);
  const routes = routesForSchedule(project, routingGraph(project, base));
  return { graph: base, routes, load: loads(project, routes, project.dayTypes[0].id, base) };
}

// A corridor with a side branch: 1A and 1B at the ends, 1C down the branch.
const BRANCH = [
  'A#####B',
  '...#...',
  '...C...',
];

function corridor() {
  return withSchedule(planProject([BRANCH]), {
    Ten: ['1A', '1B', '1A', '1A'],
    Twenty: ['1A', '1B', '1B', '1C'],
    Blank: ['1C', '1C', '1C', null],
  }, { Ten: 10, Twenty: 20 });
}

test('each group adds its head count to every cell on its route, once a transition', () => {
  const project = corridor();
  const { graph, load } = loaded(project);
  const at = (x, y) => nodeAt(graph, F1, cellAt(project, 1, x, y));
  assert.equal(load.transitions, 3);
  assert.equal(load.dayTypeId, project.dayTypes[0].id);
  // transition 0: Ten and Twenty walk 1A to 1B along the whole corridor; Blank stays in 1C
  assert.deepEqual([1, 2, 3, 4, 5].map((x) => load.cells.byTransition[0][at(x, 0)]), [30, 30, 30, 30, 30]);
  assert.equal(load.cells.byTransition[0][at(3, 1)], 0, 'nobody walks the branch');
  // transition 1: Ten walks back; Twenty stays in 1B and adds nothing
  assert.deepEqual([1, 2, 3, 4, 5].map((x) => load.cells.byTransition[1][at(x, 0)]), [10, 10, 10, 10, 10]);
  // transition 2: Twenty walks 1B to 1C: east half of the corridor, then the branch; Blank has no room to go to
  assert.deepEqual([1, 2, 3, 4, 5].map((x) => load.cells.byTransition[2][at(x, 0)]), [0, 0, 20, 20, 20]);
  assert.equal(load.cells.byTransition[2][at(3, 1)], 20);
});

test('busiest is the highest load in any one transition, total the sum over the day', () => {
  const project = corridor();
  const { graph, load } = loaded(project);
  const at = (x, y) => nodeAt(graph, F1, cellAt(project, 1, x, y));
  assert.equal(load.cells.busiest[at(1, 0)], 30);
  assert.equal(load.cells.total[at(1, 0)], 40);
  assert.equal(load.cells.busiest[at(4, 0)], 30);
  assert.equal(load.cells.total[at(4, 0)], 60, '30, then 10, then 20');
  assert.equal(load.cells.peak[at(4, 0)], 0, 'the transition the busiest load is reached in');
  assert.equal(load.cells.busiest[at(3, 1)], 20);
  assert.equal(load.cells.total[at(3, 1)], 20);
  assert.equal(load.cells.peak[at(3, 1)], 2);
  assert.deepEqual(load.max, { busiest: 30, total: 60 });
  assert.notDeepEqual(Array.from(load.cells.busiest), Array.from(load.cells.total), 'the two pictures differ');
});

test('the unit is students when any group has a head count, and a blank one then uses the default', () => {
  const project = corridor();
  project.groups[2].days[project.dayTypes[0].id][1].room = roomId('1A'); // Blank walks 1C to 1A in transition 0
  const { graph, load } = loaded(project);
  assert.equal(load.unit, 'students');
  const branch = nodeAt(graph, F1, cellAt(project, 1, 3, 1));
  assert.equal(load.cells.byTransition[0][branch], 25, 'the school default');
  project.settings.defaultHeadCount = 31;
  assert.equal(loaded(project).load.cells.byTransition[0][branch], 31);
});

test('with no head count anywhere the unit is groups, and each group counts 1', () => {
  const project = corridor();
  for (const group of project.groups) group.headCount = null;
  const { graph, load } = loaded(project);
  assert.equal(load.unit, 'groups');
  const cell = nodeAt(graph, F1, cellAt(project, 1, 4, 0));
  assert.deepEqual(load.cells.byTransition.map((counts) => counts[cell]), [2, 1, 1]);
  assert.equal(load.cells.busiest[cell], 2);
  assert.equal(load.cells.total[cell], 4);
});

test('a group that stays in the same room, has no room, or has no way through adds nothing', () => {
  const project = withSchedule(planProject([[
    'A#####B',
    '.......',
    '..C....',
  ]]), { Stays: ['1A', '1A'], Cut: ['1A', '1C'], Free: ['1A', null], Walks: ['1A', '1B'] }, { Walks: 7 });
  const { load } = loaded(project);
  assert.deepEqual(Array.from(load.cells.byTransition[0]), [7, 7, 7, 7, 7]);
});

test('a stairs connection carries the load of the groups that use it', () => {
  const project = withSchedule(threeFloors(), { Up: ['1A', '3A', '1A'], Level: ['1A', '1B', '2A'] }, { Up: 12, Level: 9 });
  const { graph, load } = loaded(project);
  assert.deepEqual(graph.links.map((link) => link.label), ['A', 'B']);
  assert.deepEqual(load.connections.byTransition.map((counts) => Array.from(counts)), [[12, 12], [21, 12]]);
  assert.deepEqual(Array.from(load.connections.busiest), [21, 12]);
  assert.deepEqual(Array.from(load.connections.total), [33, 24]);
  assert.deepEqual(Array.from(load.connections.peak), [1, 0]);
  assert.equal(load.max.busiest, 21, 'both stairs cells on Floor 1 carry what the connection carries');
});

test('cells in an exclusion zone are counted, flagged, and left out of the scale', () => {
  const project = corridor();
  project.building.zones = [{ id: 'zplan00001', floorId: F1, label: 'By the doors', x: 1, y: 0, w: 2, h: 3 }];
  assertValid(project);
  const { graph, load } = loaded(project);
  const at = (x, y) => nodeAt(graph, F1, cellAt(project, 1, x, y));
  assert.equal(load.zones, 1);
  assert.deepEqual([1, 2, 3, 4, 5].map((x) => load.excluded[at(x, 0)]), [1, 1, 0, 0, 0]);
  assert.equal(load.cells.busiest[at(1, 0)], 30, 'still counted');
  assert.equal(load.cells.total[at(1, 0)], 40);
  assert.deepEqual(load.max, { busiest: 30, total: 60 });

  // cover the whole corridor: only the branch is left to set the scale
  project.building.zones[0].w = 5;
  project.building.zones[0].h = 1;
  const covered = loaded(project).load;
  assert.deepEqual(covered.max, { busiest: 20, total: 20 });
  assert.equal(covered.cells.busiest[at(4, 0)], 30);
});

test('a connection is excluded when either of its ends is in a zone', () => {
  const project = withSchedule(threeFloors(), { Up: ['1A', '3A'] }, { Up: 12 });
  project.building.zones = [{ id: 'zplan00001', floorId: floorId(2), label: '', x: 0, y: 2, w: 1, h: 1 }];
  assertValid(project);
  const { load } = loaded(project);
  assert.deepEqual(Array.from(load.excludedConnections), [1, 1], 'both connections end on that stairs cell');
  project.building.zones[0].floorId = floorId(3);
  assert.deepEqual(Array.from(loaded(project).load.excludedConnections), [0, 1]);
});

test('a day type that is the same as A Day is answered from A Day; one that is not there gives null', () => {
  const project = corridor();
  const { graph, routes, load } = loaded(project);
  assert.deepEqual(loads(project, routes, project.dayTypes[1].id, graph), load);
  assert.equal(loads(project, routes, 'dnowhere00', graph), null);
  assert.deepEqual(loads(project, routes, project.dayTypes[0].id), load, 'without a graph it builds its own');
  assert.deepEqual(loads(project, routes, project.dayTypes[0].id, routingGraph(project)), load, 'a routing graph does as well');
});

test('contributors: who crosses a cell, how many times, and in which transitions', () => {
  const project = corridor();
  const { graph, routes } = loaded(project);
  const day = project.dayTypes[0].id;
  const [ten, twenty] = project.groups.map((group) => group.id);
  const east = nodeAt(graph, F1, cellAt(project, 1, 4, 0));
  const west = nodeAt(graph, F1, cellAt(project, 1, 1, 0));
  assert.deepEqual(contributors(project, routes, day, { nodes: [east] }, graph), [
    { groupId: twenty, count: 20, times: 2, transitions: [0, 2] },
    { groupId: ten, count: 10, times: 2, transitions: [0, 1] },
  ]);
  assert.deepEqual(contributors(project, routes, day, { nodes: [west] }, graph), [
    { groupId: ten, count: 10, times: 2, transitions: [0, 1] },
    { groupId: twenty, count: 20, times: 1, transitions: [0] },
  ], 'both add 20 over the day; the one that crosses more often is first');
  // a group walking several of the cells asked about still crosses once
  assert.deepEqual(contributors(project, routes, day, { nodes: new Set([east, west]) }, graph, { period: 0 }), [
    { groupId: twenty, count: 20, times: 1, transitions: [0] },
    { groupId: ten, count: 10, times: 1, transitions: [0] },
  ]);
  assert.deepEqual(contributors(project, routes, day, { nodes: [east] }, graph, { period: 1 }).map((entry) => entry.groupId), [ten]);
  assert.deepEqual(contributors(project, routes, day, {}, graph), []);

  const stairs = withSchedule(threeFloors(), { Up: ['1A', '3A', '1A'], Level: ['1A', '1B', '2A'] }, { Up: 12, Level: 9 });
  const built = loaded(stairs);
  assert.deepEqual(contributors(stairs, built.routes, stairs.dayTypes[0].id, { links: [0] }, built.graph).map((entry) => [entry.groupId, entry.times]), [[stairs.groups[0].id, 2], [stairs.groups[1].id, 1]]);
});

test('the sum of what the contributors add in a transition is the cell\'s load', () => {
  const project = school();
  const { graph, routes, load } = loaded(project);
  let checked = 0;
  for (let node = 0; node < graph.count; node += 7) {
    for (let t = 0; t < load.transitions; t += 1) {
      const sum = contributors(project, routes, project.dayTypes[0].id, { nodes: [node] }, graph, { period: t }).reduce((total, entry) => total + entry.count, 0);
      assert.equal(sum, load.cells.byTransition[t][node]);
      checked += 1;
    }
  }
  assert.ok(checked > 100);
});

test('the sample school: loads are in students, and the cells by the cafeteria doors are excluded', () => {
  const project = school();
  const { graph, load } = loaded(project);
  assert.equal(load.unit, 'students');
  assert.equal(load.zones, 1);
  const zone = project.building.zones[0];
  const inside = nodeAt(graph, zone.floorId, zone.y * project.building.floors[0].width + zone.x);
  assert.equal(load.excluded[inside], 1);
  assert.equal(load.excluded.reduce((sum, value) => sum + value, 0), zone.w * zone.h, 'the zone lies along the corridor');
  assert.ok(load.cells.busiest[inside] > 0, 'and its cells are busy');
  assert.ok(load.max.busiest > 0 && load.max.total > load.max.busiest);
  for (let node = 0; node < graph.count; node += 1) {
    assert.ok(load.cells.busiest[node] <= load.cells.total[node]);
    assert.equal(load.cells.peak[node] === -1, load.cells.busiest[node] === 0);
  }
});

test('relative bands are fifths of the busiest load on screen', () => {
  const scale = { mode: 'relative', bands: [10, 25, 50, 100] };
  assert.equal(LOAD_BANDS, 5);
  assert.equal(bandOf(0, scale, 100), 0, 'no load, no band');
  assert.deepEqual([1, 20, 21, 40, 41, 60, 61, 80, 81, 100].map((load) => bandOf(load, scale, 100)), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  assert.equal(bandOf(150, scale, 100), 5, 'a load above what is on screen is still the top band');
  assert.equal(bandOf(3, scale, 0), 1);
  assert.deepEqual(bandEdges(scale, 100), [
    { band: 1, from: 1, to: 20 },
    { band: 2, from: 21, to: 40 },
    { band: 3, from: 41, to: 60 },
    { band: 4, from: 61, to: 80 },
    { band: 5, from: 81, to: 100 },
  ]);
  // the legend and the colouring agree for every load, whatever the top is
  for (const max of [1, 2, 3, 4, 5, 7, 33, 177]) {
    const edges = bandEdges(scale, max);
    for (let load = 1; load <= max; load += 1) {
      const edge = edges[bandOf(load, scale, max) - 1];
      assert.ok(load >= edge.from && load <= edge.to, 'load ' + load + ' of ' + max);
    }
  }
});

test('absolute bands begin at the loads the school set, whatever is on screen', () => {
  const scale = { mode: 'absolute', bands: [10, 25, 50, 100] };
  assert.deepEqual([0, 1, 9, 10, 24, 25, 49, 50, 99, 100, 5000].map((load) => bandOf(load, scale, 7)), [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  assert.deepEqual(bandEdges(scale, 7), [
    { band: 1, from: 1, to: 9 },
    { band: 2, from: 10, to: 24 },
    { band: 3, from: 25, to: 49 },
    { band: 4, from: 50, to: 99 },
    { band: 5, from: 100, to: null },
  ]);
  assert.equal(bandOf(30, { mode: 'absolute', bands: [5, 10, 20, 40] }, 7), 4, 'the school\'s own numbers');
});
