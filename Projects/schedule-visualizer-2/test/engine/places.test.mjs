// Places: how the walkable cells are cut into stretches, what each is
// called, and the hotspot ranking built on them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, nodeAt } from '../../engine/graph.js';
import { routesForSchedule, routingGraph } from '../../engine/routing.js';
import { emptySlot, emptyBells, GROUP_COLOUR_PRESETS } from '../../engine/schema.js';
import { loads } from '../../engine/load.js';
import { simulateDay } from '../../engine/crowd.js';
import { places, placeName, placeAt, hotspots, PLACE_KINDS, EXIT_NEAR } from '../../engine/places.js';
import { school, assertValid } from './helpers.mjs';
import { planProject, threeFloors, splitLevel, cellAt, floorId, roomId } from '../fixtures/buildings/plans.mjs';
import { bigProject } from '../fixtures/big.mjs';

const F1 = floorId(1);

// A corridor with a branch going south from its middle.
const TEE = [
  'A#####B',
  '...#...',
  '...#...',
  '...C...',
];

function room(project, number) {
  for (const floor of project.building.floors) for (const space of floor.spaces) if (space.id === roomId(number)) return space;
  throw new Error('no room ' + number);
}

function xy(project, place) {
  const width = project.building.floors.find((floor) => floor.id === place.floorId).width;
  return place.cells.map((cell) => (cell % width) + ',' + Math.floor(cell / width));
}

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

test('unnamed corridor is split at junctions: the runs between them, and the junction itself', () => {
  const project = planProject([TEE]);
  const cut = places(project);
  assert.deepEqual(cut.places.map((place) => [place.kind, xy(project, place)]), [
    ['stretch', ['1,0', '2,0']],
    ['junction', ['3,0']],
    ['stretch', ['4,0', '5,0']],
    ['stretch', ['3,1', '3,2']],
  ]);
  assert.deepEqual(cut.places.map((place) => place.id), [F1 + ':1', F1 + ':3', F1 + ':4', F1 + ':10']);
  for (const place of cut.places) assert.ok(PLACE_KINDS.includes(place.kind));
});

test('a corner is not a junction: a bend stays one stretch', () => {
  const project = planProject([[
    'A###...',
    '...#...',
    '...##B.',
  ]]);
  const cut = places(project);
  assert.deepEqual(cut.places.map((place) => [place.kind, place.cells.length]), [['stretch', 6]]);
});

test('junction cells that touch are one place: the middle of a hall drawn two cells wide', () => {
  const project = planProject([[
    'A####B',
    '.####.',
    '..#...',
    '..C...',
  ]]);
  const cut = places(project);
  // the four corner cells of the 4 by 2 hall have two walkable neighbours each; the four between them have three or four
  assert.deepEqual(cut.places.map((place) => [place.kind, xy(project, place)]), [
    ['stretch', ['1,0', '1,1']],
    ['junction', ['2,0', '3,0', '2,1', '3,1']],
    ['stretch', ['4,0', '4,1']],
    ['stretch', ['2,2']],
  ]);
});

test('a named corridor is one place, whatever its shape, and takes its cells out of the runs', () => {
  const project = planProject([TEE]);
  const at = (x, y) => cellAt(project, 1, x, y);
  project.building.floors[0].corridors = [{ id: 'kplan00001', name: 'Long Hall', cells: [at(1, 0), at(2, 0), at(3, 0), at(4, 0), at(5, 0)] }];
  assertValid(project);
  const cut = places(project);
  assert.deepEqual(cut.places.map((place) => [place.kind, place.id, xy(project, place)]), [
    ['corridor', 'kplan00001', ['1,0', '2,0', '3,0', '4,0', '5,0']],
    ['stretch', F1 + ':10', ['3,1', '3,2']],
  ]);
  assert.equal(cut.places[0].corridorId, 'kplan00001');
  assert.equal(cut.places[0].name, 'Long Hall');
});

test('a cell under two names belongs to the first listed', () => {
  const project = planProject([TEE]);
  const at = (x, y) => cellAt(project, 1, x, y);
  project.building.floors[0].corridors = [
    { id: 'kplan00001', name: 'West Hall', cells: [at(1, 0), at(2, 0), at(3, 0)] },
    { id: 'kplan00002', name: 'East Hall', cells: [at(3, 0), at(4, 0), at(5, 0)] },
  ];
  const cut = places(project);
  assert.deepEqual(cut.places.slice(0, 2).map((place) => [place.name, xy(project, place)]), [['West Hall', ['1,0', '2,0', '3,0']], ['East Hall', ['4,0', '5,0']]]);
});

test('every walkable cell is in exactly one place and every connection is one', () => {
  for (const project of [school(), bigProject({ seed: 1 }), threeFloors(), splitLevel()]) {
    const graph = buildGraph(project);
    const cut = places(project, graph);
    const seen = new Uint8Array(graph.count);
    cut.places.forEach((place, index) => {
      assert.equal(place.kind === 'connection', place.nodes.length === 0);
      for (const node of place.nodes) {
        assert.equal(seen[node], 0);
        seen[node] = 1;
        assert.equal(cut.placeOfNode[node], index);
      }
      if (place.kind === 'connection') assert.equal(cut.placeOfLink[place.link], index);
    });
    assert.equal(seen.reduce((sum, value) => sum + value, 0), graph.count);
    assert.equal(cut.places.filter((place) => place.kind === 'connection').length, graph.links.length);
    assert.equal(new Set(cut.places.map((place) => place.id)).size, cut.places.length, 'ids are unique');
  }
});

test('names come from, in order: the corridor name, the nearest room\'s wing, "by Room 204", the floor', () => {
  const project = planProject([TEE], { numbers: { '1B': '204', '1C': '' } });
  room(project, '1A').wing = 'West Wing';
  const at = (x, y) => cellAt(project, 1, x, y);
  project.building.floors[0].corridors = [{ id: 'kplan00001', name: 'Science Hall', cells: [at(1, 0)] }];
  assertValid(project);
  const cut = places(project);
  const named = Object.fromEntries(cut.places.map((place) => [xy(project, place)[0], place]));
  assert.equal(named['1,0'].name, 'Science Hall', '1: the corridor name, though 1A next to it has a wing');
  assert.equal(named['2,0'].name, 'West Wing', '2: the wing of the nearest room');
  assert.equal(named['2,0'].roomId, roomId('1A'));
  assert.equal(named['4,0'].name, 'by Room 204', '3: the nearest room has a number and no wing');
  assert.equal(named['4,0'].roomId, roomId('1B'));
  assert.equal(named['3,1'].name, 'Floor 1', '4: the nearest room has neither');
  assert.equal(named['3,1'].roomId, null);
  // the junction is three cells from all three rooms: the room the floor lists first is taken
  assert.equal(named['3,0'].name, 'West Wing');
  assert.equal(placeName(named['4,0']), 'by Room 204');
  assert.equal(placeName(null), '');

  room(project, '1B').wing = 'East Wing';
  assert.equal(places(project).places.find((place) => xy(project, place)[0] === '4,0').name, 'East Wing', 'a wing comes before the number');
  project.building.floors[0].corridors[0].name = '  ';
  assert.equal(places(project).places[0].name, 'West Wing', 'a corridor name that is only spaces is no name');
  assert.equal(places(project).places[0].kind, 'corridor');
});

test('a room whose number is a name reads "by Gym"; a floor with no room at all gives the floor\'s name', () => {
  const project = planProject([TEE], { numbers: { '1A': 'Gym', '1B': 'Gym 2', '1C': '' } });
  const cut = places(project);
  assert.equal(cut.places[0].name, 'by Gym');
  assert.deepEqual(cut.places[0].parts, [{ text: 'by ', name: false }, { text: 'Gym', name: true }]);
  assert.equal(cut.places[2].name, 'by Room Gym 2');
  assert.deepEqual(cut.places[2].parts, [{ text: 'by ', name: false }, { text: 'Room ', name: false }, { text: 'Gym 2', name: true }]);

  const empty = planProject([['.#####.']]);
  empty.building.floors[0].name = 'Annexe';
  assert.deepEqual(places(empty).places.map((place) => place.name), ['Annexe']);
});

test('names are data: whatever was typed comes through unchanged, as a typed part', () => {
  const hostile = '<b>"Hall" & مدرسة</b>';
  const project = planProject([TEE], { numbers: { '1B': '<i>9</i>', '1C': '' } });
  const at = (x, y) => cellAt(project, 1, x, y);
  project.building.floors[0].corridors = [{ id: 'kplan00001', name: hostile, cells: [at(1, 0), at(2, 0)] }];
  project.building.floors[0].name = '1 <Floor>';
  room(project, '1A').wing = ' Wing & Co ';
  const cut = places(project);
  assert.equal(cut.places[0].name, hostile);
  assert.deepEqual(cut.places[0].parts, [{ text: hostile, name: true }]);
  assert.equal(cut.places[1].name, ' Wing & Co ', 'the junction: the wing as typed, spaces and all');
  assert.equal(cut.places[2].name, 'by Room <i>9</i>');
  assert.equal(cut.places[3].name, '1 <Floor>');
  for (const place of cut.places) assert.equal(place.parts.map((part) => part.text).join(''), place.name);
});

test('exits within reach of a place are appended to its name', () => {
  assert.equal(EXIT_NEAR, 3);
  const plan = ['A' + '#'.repeat(12) + 'B', '.'.repeat(14), '.'.repeat(14)];
  const project = planProject([plan], { exits: [[1, 12, 0, 'East Door']] });
  const at = (x) => cellAt(project, 1, x, 0);
  const cells = (from, to) => Array.from({ length: to - from + 1 }, (unused, i) => at(from + i));
  project.building.floors[0].corridors = [
    { id: 'kplan00001', name: 'Far Hall', cells: cells(1, 8) },
    { id: 'kplan00002', name: 'Mid Hall', cells: cells(9, 9) },
    { id: 'kplan00003', name: 'Near Hall', cells: cells(10, 12) },
  ];
  assertValid(project);
  let cut = places(project);
  assert.deepEqual(cut.places.map((place) => place.name), ['Far Hall', 'Mid Hall, by East Door', 'Near Hall, by East Door'], 'cell 9 is three cells from the exit, cell 8 is four');
  assert.deepEqual(cut.places.map((place) => place.exitIds), [[], ['xplan00001'], ['xplan00001']]);
  assert.deepEqual(cut.places[2].parts, [{ text: 'Near Hall', name: true }, { text: ', by ', name: false }, { text: 'East Door', name: true }]);

  project.building.floors[0].exits[0].doorName = '';
  cut = places(project);
  assert.equal(cut.places[2].name, 'Near Hall, by an exit');

  const three = planProject([['#####', '.....', '.....', '.....', '.....']], { exits: [[1, 0, 0, 'Door A'], [1, 4, 0, 'Door B'], [1, 2, 0, '']] });
  three.building.floors[0].exits.push({ id: 'xplan00004', cell: 1, doorName: 'Door C', assembly: '' });
  assert.equal(places(three).places[0].name, 'Floor 1, by Door A, Door B, Door C and another exit');
  three.building.floors[0].exits.length = 2;
  assert.equal(places(three).places[0].name, 'Floor 1, by Door A and Door B');
});

test('a connection is named by its letter and the floors it joins, the lower first', () => {
  const chain = places(threeFloors()).places.filter((place) => place.kind === 'connection');
  assert.deepEqual(chain.map((place) => place.name), ['Stairs A, Floor 1 to Floor 2', 'Stairs B, Floor 2 to Floor 3']);
  assert.deepEqual(chain[0].floorIds, [floorId(1), floorId(2)]);
  assert.equal(chain[0].connectionId, 'cplan00001');
  assert.equal(chain[0].id, 'cplan00001');
  assert.deepEqual(chain[0].parts.filter((part) => part.name).map((part) => part.text), ['A', 'Floor 1', 'Floor 2']);

  const upsideDown = threeFloors();
  upsideDown.building.floors[0].level = 5;
  assert.equal(places(upsideDown).places.find((place) => place.kind === 'connection').name, 'Stairs A, Floor 2 to Floor 1', 'by level, not by the order of the floors');

  const split = places(splitLevel()).places.filter((place) => place.kind === 'connection');
  assert.deepEqual(split.map((place) => place.name), ['Stairs A on Floor 1']);
});

test('placeAt gives the place a cell is in, and null for a cell that cannot be walked on', () => {
  const project = planProject([TEE]);
  const graph = buildGraph(project);
  const cut = places(project, graph);
  assert.equal(placeAt(cut, graph, F1, cellAt(project, 1, 3, 0)).kind, 'junction');
  assert.equal(placeAt(cut, graph, F1, cellAt(project, 1, 5, 0)), cut.places[2]);
  assert.equal(placeAt(cut, graph, F1, cellAt(project, 1, 0, 0)), null, 'a room cell');
  assert.equal(placeAt(cut, graph, 'fnowhere00', 0), null);
  assert.equal(placeAt(cut, graph, F1, -1), null);
});

test('the sample school\'s places', () => {
  const project = school();
  assert.deepEqual(places(project).places.map((place) => place.kind + ': ' + place.name + ' (' + place.cells.length + ')'), [
    'corridor: Main Corridor, by Door B (39)',
    'corridor: Front Hall, by Door A (6)',
    'stretch: West (1)',
    'corridor: Upper Corridor (38)',
    'stretch: West (1)',
    'stretch: East (1)',
    'corridor: Music Wing (16)',
    'corridor: Top Corridor (22)',
    'stretch: East (1)',
    'connection: Stairs A, Floor 1 to Floor 2 (0)',
    'connection: Stairs B, Floor 2 to Floor 3 (0)',
  ]);
});

// Hotspots, on a corridor with a branch: Ten and Twenty walk the whole
// corridor in transition 0; Ten walks back in 1; Twenty walks the east half
// and the branch in 2.
function busy() {
  const project = withSchedule(planProject([TEE], { numbers: { '1A': '101', '1B': '102', '1C': '103' } }), {
    Ten: ['1A', '1B', '1A', '1A'],
    Twenty: ['1A', '1B', '1B', '1C'],
  }, { Ten: 10, Twenty: 20 });
  const graph = routingGraph(project);
  const routes = routesForSchedule(project, graph);
  return { project, graph, routes, day: project.dayTypes[0].id };
}

test('hotspots rank places by their busiest transition, with who was there', () => {
  const { project, graph, routes, day } = busy();
  const rows = hotspots(project, routes, day, { graph });
  assert.deepEqual(rows.map((row) => [xy(project, row.place)[0], row.load, row.peak, row.unit]), [
    ['1,0', 30, 0, 'students'],
    ['3,0', 30, 0, 'students'],
    ['4,0', 30, 0, 'students'],
    ['3,1', 20, 2, 'students'],
  ], 'equal loads stay in the order of the building');
  const [ten, twenty] = project.groups.map((group) => group.id);
  assert.deepEqual(rows[0].groups, [{ groupId: twenty, count: 20, times: 1, transitions: [0] }, { groupId: ten, count: 10, times: 1, transitions: [0] }]);
  assert.deepEqual(rows[3].groups.map((entry) => entry.groupId), [twenty]);
  assert.deepEqual(rows[0].cells.map((cell) => [cell.cell, cell.load, cell.excluded]), [[1, 30, false], [2, 30, false]], 'expanding a place shows its cells');
  assert.equal(rows[0].delay, null, 'no crowd results handed in, no delay');
  assert.deepEqual(hotspots(project, routes, day, { graph, limit: 2 }).map((row) => row.load), [30, 30]);
  assert.deepEqual(hotspots(project, routes, 'dnowhere00', { graph }), []);
});

test('hotspots by total over the day', () => {
  const { project, graph, routes, day } = busy();
  const rows = hotspots(project, routes, day, { graph, measure: 'total' });
  assert.deepEqual(rows.map((row) => [xy(project, row.place)[0], row.load, row.peak]), [
    ['3,0', 60, null],
    ['4,0', 60, null],
    ['1,0', 40, null],
    ['3,1', 20, null],
  ]);
  assert.deepEqual(rows[0].groups.map((entry) => [entry.groupId, entry.times]), [[project.groups[1].id, 2], [project.groups[0].id, 2]]);
});

test('a place inside an exclusion zone is left out of the hotspot table; one partly inside counts its other cells', () => {
  const { project, graph, routes, day } = busy();
  project.building.zones = [{ id: 'zplan00001', floorId: F1, label: '', x: 1, y: 0, w: 3, h: 1 }];
  assertValid(project);
  const rows = hotspots(project, routes, day, { graph });
  assert.deepEqual(rows.map((row) => xy(project, row.place)[0]), ['4,0', '3,1'], 'the west run and the junction are wholly inside');

  project.building.zones[0].w = 1;
  const partly = hotspots(project, routes, day, { graph });
  assert.deepEqual(partly.map((row) => xy(project, row.place)[0]), ['1,0', '3,0', '4,0', '3,1']);
  assert.deepEqual(partly[0].cells.map((cell) => [cell.cell, cell.excluded]), [[1, true], [2, false]]);
});

test('the delay of a hotspot is the waiting the crowd model charged to its cells', () => {
  const { project, graph, routes, day } = busy();
  const crowd = simulateDay(project, routes, day, graph);
  const load = loads(project, routes, day, graph);
  const cut = places(project, graph);
  const rows = hotspots(project, routes, day, { graph, places: cut, load, crowd });
  // transition 0: Twenty leaves 1A behind Ten (2 slots): 2 × 3 + 1 = 7 seconds at the first cell, the west run
  const west = rows.find((row) => xy(project, row.place)[0] === '1,0');
  assert.equal(west.delay, 7);
  assert.equal(west.dayDelay, 7);
  assert.equal(crowd.transitions[0].cellDelay[nodeAt(graph, F1, cellAt(project, 1, 1, 0))], 7);
  const branch = rows.find((row) => xy(project, row.place)[0] === '3,1');
  assert.deepEqual([branch.delay, branch.dayDelay], [0, 0]);
  assert.deepEqual(rows.map((row) => xy(project, row.place)[0]), ['1,0', '3,0', '4,0', '3,1'], 'at equal load the place with more delay comes first');

  // every second of waiting in the day lands in exactly one place
  const sample = school();
  const sampleGraph = routingGraph(sample);
  const sampleRoutes = routesForSchedule(sample, sampleGraph);
  const sampleCrowd = simulateDay(sample, sampleRoutes, sample.dayTypes[0].id, sampleGraph);
  const all = hotspots(sample, sampleRoutes, sample.dayTypes[0].id, { graph: sampleGraph, crowd: sampleCrowd });
  let waited = 0;
  for (const transition of sampleCrowd.transitions) for (const group of transition.groups) waited += group.waiting;
  assert.ok(waited > 0);
  assert.equal(all.reduce((sum, row) => sum + row.dayDelay, 0), waited, 'every place of the sample carries load, so every place is listed');
  assert.equal(all[0].place.name, 'Main Corridor, by Door B');
  assert.ok(all[0].load >= all[1].load);
});

test('a connection is a hotspot row with its own load and no cells', () => {
  const project = withSchedule(threeFloors(), { Up: ['1A', '3A', '1A'], Level: ['1A', '1B', '2A'] }, { Up: 12, Level: 9 });
  const graph = routingGraph(project);
  const routes = routesForSchedule(project, graph);
  const rows = hotspots(project, routes, project.dayTypes[0].id, { graph }).filter((row) => row.place.kind === 'connection');
  assert.deepEqual(rows.map((row) => [row.place.name, row.load, row.peak, row.cells.length]), [['Stairs A, Floor 1 to Floor 2', 21, 1, 0], ['Stairs B, Floor 2 to Floor 3', 12, 0, 0]]);
  assert.deepEqual(rows[0].groups.map((entry) => entry.count), [12, 9]);
});
