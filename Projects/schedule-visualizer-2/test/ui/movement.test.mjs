// The parts of the movement view that are plain functions: where the lanes
// run (ui/surface/overlays/lanes.js), what the view shows for a choice
// (ui/movement/model.js), and where each floor sits on the map
// (ui/movement/layout.js).
//
//   node test/ui/movement.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLanes, lanePoint, laneOffset, lineWidth, LANE_GAP, LANE_REACH, MAX_PITCH, CONSTANT_WIDTH, BAND_EXCLUDED } from '../../ui/surface/overlays/lanes.js';
import {
  COMPARE_LIMIT, COMPARE_REASON, defaultChoice, settleChoice, shownGroups, addGroup, gradesOf, transitionsOf,
  pictureOf, sentenceOf, groupRows, routeHealth, cellCard, failurePeriod,
} from '../../ui/movement/model.js';
import { layoutFloors, bestLayout, slotAt, placeOf, FLOOR_GAP, TITLE_ROWS } from '../../ui/movement/layout.js';
import { bandText } from '../../ui/movement/legend.js';
import { fixFor } from '../../ui/movement/summary.js';
import { createPipeline } from '../../engine/worker.js';
import { buildGraph } from '../../engine/graph.js';
import { routingGraph, route } from '../../engine/routing.js';
import { loads } from '../../engine/load.js';
import { planProject, roomId, floorId, threeFloors } from '../fixtures/buildings/plans.mjs';
import { school, group, clone } from './../engine/helpers.mjs';

const DAY_A = 'dsample00a';
const DAY_B = 'dsample00b';

// A corridor eleven cells long with a room at each corner.
function hall() {
  return planProject([[
    'AA.......BB',
    '###########',
    'CC.......DD',
  ]]);
}

function walk(project, from, to) {
  return route(routingGraph(project), roomId(from), roomId(to));
}

function derive(project) {
  return { project, results: createPipeline().run(project), graph: buildGraph(project) };
}

function picture(world, patch) {
  return pictureOf(world.project, world.results, world.graph, { ...defaultChoice(world.project), ...patch });
}

function words(sentence) {
  return sentence.parts.map((part) => part.text).join('');
}

const sample = derive(school());

// ---------------------------------------------------------------- the lanes

test('a line keeps to the right of the way it is going, so opposite flows are on opposite sides of the corridor', () => {
  const project = hall();
  const lanes = buildLanes(project, [
    { groupId: 'east', rank: 0, route: walk(project, '1A', '1B') },
    { groupId: 'west', rank: 1, route: walk(project, '1B', '1A') },
  ]);
  const middle = 1 * 11 + 5;
  const east = lanePoint(lanes, 'east', floorId(1), middle);
  const west = lanePoint(lanes, 'west', floorId(1), middle);
  assert.ok(east && west, 'both walk the corridor');
  // the corridor is row 1, so its middle line is y = 1.5; south is larger
  assert.ok(east[1] > 1.5, 'walking east, the right hand side is the south one: ' + east[1]);
  assert.ok(west[1] < 1.5, 'walking west, the right hand side is the north one: ' + west[1]);
  assert.equal(Number((east[1] - 1.5).toFixed(6)), Number((1.5 - west[1]).toFixed(6)), 'each alone on its side, the same way out from the middle');
  assert.equal(lanes.most, 1, 'no two share a directed stretch');
});

test('groups sharing a stretch are parallel lanes in the project\'s order, and taking one off does not reorder the rest', () => {
  const project = hall();
  const found = walk(project, '1A', '1B');
  const all = buildLanes(project, [2, 0, 1].map((rank) => ({ groupId: 'g' + rank, rank, route: found })));
  const middle = 1 * 11 + 5;
  const y = (lanes, id) => lanePoint(lanes, id, floorId(1), middle)[1];
  assert.equal(all.most, 3);
  assert.ok(y(all, 'g0') < y(all, 'g1') && y(all, 'g1') < y(all, 'g2'), 'the first group in the project is nearest the middle');
  assert.equal(Number((y(all, 'g1') - y(all, 'g0')).toFixed(6)), Number(all.pitch.toFixed(6)), 'one pitch apart');
  assert.equal(Number((y(all, 'g0') - 1.5).toFixed(6)), Number(laneOffset(all, 0).toFixed(6)));
  const fewer = buildLanes(project, [0, 2].map((rank) => ({ groupId: 'g' + rank, rank, route: found })));
  assert.ok(y(fewer, 'g0') < y(fewer, 'g2'), 'g0 is still inside g2');
  assert.equal(Number((y(fewer, 'g0') - 1.5).toFixed(6)), Number(laneOffset(fewer, 0).toFixed(6)), 'and g0 is still the innermost lane');
  assert.equal(Number((y(fewer, 'g2') - 1.5).toFixed(6)), Number(laneOffset(fewer, 1).toFixed(6)), 'with g2 beside it: no gap is left where g1 was');
  // drawn in the project's order whatever order they were given in
  assert.deepEqual(all.floors.get(floorId(1)).map((lane) => lane.groupId), ['g0', 'g1', 'g2']);
});

test('the lanes thin as the fullest stretch fills, so the bundle stays in its half of the cell', () => {
  const project = hall();
  const found = walk(project, '1A', '1B');
  const two = buildLanes(project, [0, 1].map((rank) => ({ groupId: 'g' + rank, rank, route: found })));
  assert.equal(two.pitch, MAX_PITCH, 'a thin bundle is drawn at the widest a lane goes');
  const many = buildLanes(project, Array.from({ length: 40 }, (unused, rank) => ({ groupId: 'g' + rank, rank, route: found })));
  assert.equal(many.most, 40);
  assert.ok(many.pitch < two.pitch);
  const outer = laneOffset(many, 39) + many.pitch / 2;
  assert.ok(outer <= LANE_REACH + 1e-9, 'the outermost lane ends ' + outer + ' cells from the middle');
  assert.ok(laneOffset(many, 0) > LANE_GAP, 'and the innermost is clear of the middle line');
  // the width of a line follows the pitch and the zoom, unless it is kept constant
  assert.ok(lineWidth(two, 48, false) > lineWidth(two, 24, false));
  assert.equal(lineWidth(two, 48, true), CONSTANT_WIDTH);
  assert.equal(lineWidth(two, 6, true), CONSTANT_WIDTH);
  assert.equal(lineWidth(many, 6, false), 1, 'never thinner than a pixel');
});

test('a turn is drawn where the lane coming in meets the lane going out', () => {
  const project = hall();
  const found = walk(project, '1A', '1D');
  const lanes = buildLanes(project, [{ groupId: 'g', rank: 0, route: found }]);
  const off = laneOffset(lanes, 0);
  const firstCell = found.cells[0].cell;
  const lastCell = found.cells[found.cells.length - 1].cell;
  const first = lanePoint(lanes, 'g', floorId(1), firstCell);
  const last = lanePoint(lanes, 'g', floorId(1), lastCell);
  // out of 1A going south (right is west), then east (right is south): a left turn, taken wide
  assert.deepEqual(first.map((n) => Number(n.toFixed(6))), [Number(((firstCell % 11) + 0.5 - off).toFixed(6)), Number((1.5 + off).toFixed(6))]);
  // east (right is south), then south into 1D (right is west): a right turn, taken tight
  assert.deepEqual(last.map((n) => Number(n.toFixed(6))), [Number(((lastCell % 11) + 0.5 - off).toFixed(6)), Number((1.5 + off).toFixed(6))]);
  const points = lanes.floors.get(floorId(1))[0].points;
  assert.equal(points.length % 2, 0);
  // every piece of the line runs along a row or a column: no corner is cut
  for (let i = 2; i < points.length; i += 2) {
    assert.ok(Math.abs(points[i] - points[i - 2]) < 1e-9 || Math.abs(points[i + 1] - points[i - 1]) < 1e-9, 'piece ' + i / 2 + ' is straight');
  }
});

test('a walk over the stairs is one line a floor, and the connection it takes is named', () => {
  const project = threeFloors();
  const found = route(routingGraph(project), roomId('1A'), roomId('3B'));
  assert.equal(found.ok, true);
  assert.equal(found.connections.length, 2);
  const lanes = buildLanes(project, [{ groupId: 'g', rank: 0, route: found }]);
  assert.deepEqual(Array.from(lanes.floors.keys()).sort(), [floorId(1), floorId(3)], 'the middle landing is one cell: nothing to draw there');
  assert.deepEqual(Array.from(lanes.links.entries()), found.connections.map((id) => [id, ['g']]));
});

test('the same walk in two transitions is one line, and a route that failed or stays put is none', () => {
  const project = hall();
  const found = walk(project, '1A', '1B');
  const lanes = buildLanes(project, [
    { groupId: 'g', rank: 0, route: found },
    { groupId: 'g', rank: 0, route: found },
    { groupId: 'g', rank: 0, route: { ok: true, same: true } },
    { groupId: 'g', rank: 0, route: { ok: false, reason: 'no-room' } },
    { groupId: 'g', rank: 0, route: null },
  ]);
  assert.equal(lanes.floors.get(floorId(1)).length, 1);
  assert.equal(lanes.most, 1);
});

// ---------------------------------------------------------------- the choice

test('the view opens on every group, the first day type and all transitions', () => {
  const choice = defaultChoice(sample.project);
  assert.deepEqual(choice, { who: 'all', grade: '', groupIds: [], dayTypeId: DAY_A, transition: null, measure: 'busiest', floors: 'auto', labels: true, constantWidth: false });
  const shown = picture(sample);
  assert.equal(shown.groups.length, 8);
  assert.equal(shown.mode, 'load');
  assert.equal(shown.drawn, 56, 'eight groups, seven transitions, none of them a stay');
  // of the 56 walks the crowd model timed, one is too long for its passing time, and only that one is listed
  assert.deepEqual(shown.late.map((entry) => [entry.groupId, entry.period]), [['gsample08a', 5]]);
  assert.equal(words(sentenceOf(sample.project, shown, routeHealth(sample.project, sample.results))), 'Showing 8 groups on A Day, all transitions. No route failed.');
});

test('four groups at most are compared, and the fifth is refused with the reason', () => {
  assert.equal(COMPARE_LIMIT, 4);
  let choice = { ...defaultChoice(sample.project), who: 'groups' };
  for (const each of sample.project.groups.slice(0, 4)) {
    const answer = addGroup(choice, each.id);
    assert.equal(answer.refused, null);
    choice = answer.choice;
  }
  assert.equal(choice.groupIds.length, 4);
  const fifth = addGroup(choice, sample.project.groups[4].id);
  assert.equal(fifth.refused, COMPARE_REASON);
  assert.match(COMPARE_REASON, /^Four groups at most/);
  assert.equal(fifth.choice.groupIds.length, 4, 'nothing was added');
  assert.equal(addGroup(choice, choice.groupIds[0]).choice, choice, 'a group already there is not added twice');
  // a choice from somewhere else is cut to the limit, and loses what the project has not got
  const settled = settleChoice(sample.project, { who: 'groups', groupIds: ['gnobody000', ...sample.project.groups.map((each) => each.id)], dayTypeId: 'dnowhere00', transition: 99, floors: 'fnowhere00', measure: 'most' });
  assert.equal(settled.groupIds.length, 4);
  assert.equal(settled.dayTypeId, DAY_A);
  assert.equal(settled.transition, null);
  assert.equal(settled.floors, 'auto');
  assert.equal(settled.measure, 'busiest');
});

test('who is shown: every group, one grade, or the chosen groups in the project\'s order; Clear is no group at all', () => {
  const project = sample.project;
  assert.deepEqual(gradesOf(project), ['6', '7', '8']);
  assert.deepEqual(shownGroups(project, settleChoice(project, { who: 'grade', grade: '7' })).map((each) => each.name), ['7A', '7B', '7C']);
  assert.equal(settleChoice(project, { who: 'grade', grade: '11' }).grade, '6', 'a grade nobody is in falls to the first there is');
  assert.deepEqual(shownGroups(project, settleChoice(project, { who: 'groups', groupIds: ['gsample08a', 'gsample06b'] })).map((each) => each.name), ['6B', '8A']);
  const cleared = picture(sample, { who: 'groups', groupIds: [] });
  assert.equal(cleared.mode, 'empty');
  assert.equal(cleared.drawn, 0);
  assert.equal(cleared.bands, null);
  assert.match(words(sentenceOf(project, cleared, [])), /^Nothing is shown\./);
});

test('one transition shows its passing time, and only its routes', () => {
  const transitions = transitionsOf(sample.project, DAY_A);
  assert.equal(transitions.length, 7);
  assert.deepEqual(transitions[5], { period: 5, name: 'Period 6 to Period 7', short: '6 to 7', from: '13:08', to: '13:12', times: '1:08 to 1:12', seconds: 240 });
  const shown = picture(sample, { who: 'groups', groupIds: ['gsample08a'], transition: 5 });
  assert.equal(shown.drawn, 1);
  assert.equal(shown.mode, 'single');
  assert.deepEqual(shown.late.map((entry) => [entry.groupId, entry.period]), [['gsample08a', 5]], 'the sample\'s long walk');
  assert.equal(words(sentenceOf(sample.project, shown, [])), 'Showing 8A on A Day, Period 6 to Period 7 (1:08 to 1:12). No route failed.');
  // with no bell times entered the strip has the default passing time and no clock
  const bare = clone(sample.project);
  for (const dayType of bare.dayTypes) dayType.bells = dayType.bells.map(() => null);
  assert.deepEqual(transitionsOf(bare, DAY_A)[0], { period: 0, name: 'Period 1 to Period 2', short: '1 to 2', from: null, to: null, times: '', seconds: bare.settings.defaultPassingSeconds });
  // the school's own word for a period is used
  const blocks = clone(sample.project);
  blocks.settings.periodWord = 'Block';
  assert.equal(transitionsOf(blocks, DAY_A)[0].name, 'Block A to Block B');
  assert.equal(transitionsOf(blocks, DAY_A)[0].short, 'A to B');
});

// ---------------------------------------------------------------- load and colour

test('one group alone is drawn in its own colour with no load colouring; two or more are coloured by load', () => {
  const one = picture(sample, { who: 'groups', groupIds: ['gsample06a'] });
  assert.equal(one.mode, 'single');
  assert.equal(one.bands, null, 'no band for any cell');
  assert.ok(one.load && one.load.max > 0, 'the numbers are still there for the card and the summary');
  const two = picture(sample, { who: 'groups', groupIds: ['gsample06a', 'gsample07a'] });
  assert.equal(two.mode, 'load');
  assert.ok(two.bands instanceof Map && two.bands.size === 3);
  assert.ok(Array.from(two.bands.get('fsample001')).some((band) => band >= 1 && band <= 5));
});

test('relative bands are fifths of the busiest cell on screen, and the load of some groups is the engine\'s rule for those groups', () => {
  const all = picture(sample);
  assert.equal(all.load.mode, 'relative');
  assert.equal(all.load.unit, 'students');
  assert.equal(all.load.max, 177);
  assert.equal(all.load.source, sample.results.loads[0], 'every group: the pipeline\'s own answer, not a second count');
  assert.deepEqual(all.load.edges, [{ band: 1, from: 1, to: 35 }, { band: 2, from: 36, to: 70 }, { band: 3, from: 71, to: 106 }, { band: 4, from: 107, to: 141 }, { band: 5, from: 142, to: 177 }]);
  assert.deepEqual(all.load.edges.map((edge) => bandText(edge)), ['1–35', '36–70', '71–106', '107–141', '142–177']);
  assert.equal(all.busiest.load, 177);
  assert.equal(all.busiest.place.name, 'Main Corridor, by Door B');
  assert.equal(all.busiest.floorName, 'Floor 1');
  assert.equal(all.busiest.period, 3);
  assert.equal(all.bands.get('fsample001')[all.busiest.cell], 5, 'the busiest cell is in the top band');

  const ids = ['gsample06a', 'gsample07a'];
  const two = picture(sample, { who: 'groups', groupIds: ids });
  const day = sample.results.routes.days.find((each) => each.dayTypeId === DAY_A);
  const expected = loads(sample.project, { days: [{ dayTypeId: DAY_A, groups: day.groups.filter((entry) => ids.includes(entry.groupId)) }] }, DAY_A, sample.graph);
  assert.equal(two.load.max, expected.max.busiest);
  assert.equal(two.load.max, 51, '24 and 27 students together');
  assert.deepEqual(Array.from(two.load.cells), Array.from(expected.cells.busiest));
  assert.equal(two.load.edges[4].to, 51, 'the scale is of what is on screen');
});

test('absolute bands are the loads the school set, whatever is on screen', () => {
  const project = clone(sample.project);
  project.settings.colourScale = { mode: 'absolute', bands: [10, 25, 50, 100] };
  const world = { ...sample, project };
  const edges = [{ band: 1, from: 1, to: 9 }, { band: 2, from: 10, to: 24 }, { band: 3, from: 25, to: 49 }, { band: 4, from: 50, to: 99 }, { band: 5, from: 100, to: null }];
  const all = picture(world);
  assert.equal(all.load.mode, 'absolute');
  assert.deepEqual(all.load.edges, edges);
  assert.deepEqual(all.load.edges.map((edge) => bandText(edge)), ['1–9', '10–24', '25–49', '50–99', '100+']);
  assert.equal(bandText(edges[4], true), '100 or more');
  const two = picture(world, { who: 'groups', groupIds: ['gsample06a', 'gsample07a'] });
  assert.deepEqual(two.load.edges, edges, 'the same numbers for two groups as for eight');
  assert.equal(two.bands.get('fsample001')[two.busiest.cell], 4, '51 students is band 4 of the school\'s scale, not the top band');
  assert.equal(bandText({ band: 2, from: 3, to: 2 }), '—', 'a band no whole load can fall in');
  assert.equal(bandText({ band: 2, from: 3, to: 3 }), '3');
});

test('cells in an exclusion zone are left out of the scale, and the legend has the count', () => {
  const all = picture(sample);
  assert.equal(all.load.zones, 1);
  const zone = sample.project.building.zones[0];
  const floor = sample.project.building.floors[0];
  const bands = all.bands.get(floor.id);
  let excluded = 0;
  for (let x = zone.x; x < zone.x + zone.w; x += 1) {
    const cell = zone.y * floor.width + x;
    if (bands[cell] === BAND_EXCLUDED) excluded += 1;
    else assert.equal(bands[cell], 0, 'a zone cell is either crossed and left out, or not crossed');
  }
  assert.ok(excluded > 0, 'the cafeteria doors are walked past');
  // without the zone the busiest cell is a busier one, which the zone was hiding
  const open = clone(sample.project);
  open.building.zones = [];
  const without = derive(open);
  const shown = picture(without);
  assert.equal(shown.load.zones, 0);
  assert.ok(shown.load.max >= all.load.max);
  assert.ok(!Array.from(shown.bands.get(floor.id)).includes(BAND_EXCLUDED));
});

test('busiest moment and total over the day are different numbers, each named', () => {
  const busiest = picture(sample);
  const total = picture(sample, { measure: 'total' });
  assert.equal(busiest.load.measure, 'busiest');
  assert.equal(total.load.measure, 'total');
  assert.equal(total.load.max, 800);
  assert.ok(total.load.max > busiest.load.max);
  // one transition is neither: it is that transition's own load
  const one = picture(sample, { transition: 3, measure: 'total' });
  assert.equal(one.load.measure, 'transition');
  assert.equal(one.load.max, 177, 'the busiest moment of the day is in this transition');
});

test('one floor on screen: the scale is of that floor', () => {
  const third = picture(sample, { floors: 'fsample003' });
  assert.deepEqual(third.floors.map((floor) => floor.name), ['Floor 3']);
  assert.deepEqual(Array.from(third.bands.keys()), ['fsample003']);
  const whole = sample.results.loads[0];
  const floor = sample.graph.floors[2];
  let max = 0;
  for (let node = floor.offset; node < floor.offset + floor.count; node += 1) if (!whole.excluded[node]) max = Math.max(max, whole.cells.busiest[node]);
  assert.equal(third.load.max, max);
  assert.ok(third.load.max < 177);
});

// ---------------------------------------------------------------- markers, legend rows, the card

test('a room marker says which periods each group is there, runs of periods written short', () => {
  const shown = picture(sample);
  const markers = shown.markers.get('fsample001');
  const room = markers.find((marker) => marker.roomId === 'rsample101');
  assert.deepEqual(room.pills.map((pill) => [pill.groupId, pill.text, pill.colour]), [['gsample06a', '3', '#d1495b'], ['gsample08b', '2', '#7b4ea3']]);
  assert.deepEqual(room.box, { x0: 1, y0: 3, x1: 6, y1: 7 });
  // a group in one room for periods 1 to 3 and again in 5
  const project = clone(sample.project);
  const day = group(project, '6A').days[DAY_A];
  for (const period of [0, 1, 2, 4]) day[period] = { ...day[period], room: 'rsample301', roomText: '' };
  const world = derive(project);
  const pills = picture(world, { who: 'groups', groupIds: ['gsample06a'] }).markers.get('fsample003').find((marker) => marker.roomId === 'rsample301').pills;
  assert.deepEqual(pills.map((pill) => pill.text), ['1–3, 5']);
  // one transition marks the two rooms it runs between and no other
  const one = picture(world, { who: 'groups', groupIds: ['gsample06a'], transition: 3 });
  const marked = Array.from(one.markers.values()).flat();
  assert.deepEqual(marked.map((marker) => marker.pills[0].text).sort(), ['4', '5']);
});

test('the legend of groups has each group\'s day: walking, time lost to crowding, stairs, late and failed', () => {
  const shown = picture(sample);
  const rows = groupRows(sample.project, sample.results, shown);
  assert.equal(rows.length, 8);
  const day = sample.results.crowd.days.find((each) => each.dayTypeId === DAY_A);
  for (const row of rows) {
    let walking = 0;
    let waiting = 0;
    for (const transition of day.transitions) {
      const walker = transition.groups.find((each) => each.groupId === row.group.id);
      if (walker) {
        walking += walker.walking;
        waiting += walker.waiting;
      }
    }
    assert.equal(row.walking, walking, row.group.name + ' walking is the crowd model\'s figure');
    assert.equal(row.waiting, waiting, row.group.name + ' waiting');
    assert.equal(row.failed, 0);
    assert.equal(row.stairs, true, 'every group of the sample changes floor');
  }
  assert.deepEqual(rows.filter((row) => row.late > 0).map((row) => [row.group.name, row.late]), [['8A', 1]]);
});

test('a corridor cell\'s card has the place, the load and who crosses it; a room has none', () => {
  const shown = picture(sample);
  const card = cellCard(sample.project, sample.results, sample.graph, shown, 'fsample001', shown.busiest.cell);
  assert.equal(card.place.name, 'Main Corridor, by Door B');
  assert.equal(card.floorName, 'Floor 1');
  assert.equal(card.load, 177);
  assert.equal(card.unit, 'students');
  assert.equal(card.peak, 3);
  assert.equal(card.measure, 'busiest');
  assert.equal(card.excluded, false);
  assert.ok(card.groups.length >= 2);
  assert.ok(card.groups.every((each) => each.times >= 1 && each.group.name));
  const room = sample.project.building.floors[0].spaces[0];
  assert.equal(cellCard(sample.project, sample.results, sample.graph, shown, 'fsample001', room.cells[0]), null);
  assert.equal(cellCard(sample.project, sample.results, sample.graph, shown, 'fsample001', 0), null, 'an empty cell');
  // only the groups on screen are counted
  const two = picture(sample, { who: 'groups', groupIds: ['gsample06a', 'gsample07a'] });
  const fewer = cellCard(sample.project, sample.results, sample.graph, two, 'fsample001', two.busiest.cell);
  assert.equal(fewer.load, 51);
  assert.deepEqual(fewer.groups.map((each) => each.group.name).sort(), ['6A', '7A']);
  // a zone cell says so
  const zone = sample.project.building.zones[0];
  const zoned = cellCard(sample.project, sample.results, sample.graph, shown, 'fsample001', zone.y * 40 + zone.x + 1);
  assert.equal(zoned.excluded, true);
});

// ---------------------------------------------------------------- failed routes

function broken() {
  const project = clone(sample.project);
  // 7A has no room in Period 3 on A Day: the walk into it and the walk out of it both fail
  group(project, '7A').days[DAY_A][2] = { room: null, roomText: '', label: '', teacherIds: [] };
  // 6B's Period 1 room on B Day is not in the building
  group(project, '6B').days[DAY_B][0] = { room: null, roomText: 'Annex 9', label: '', teacherIds: [] };
  return derive(project);
}

test('the first line counts the failed routes on screen and names the first', () => {
  const world = broken();
  const health = routeHealth(world.project, world.results);
  const shown = picture(world);
  assert.equal(shown.failed.length, 2);
  assert.equal(shown.drawn, 54);
  const sentence = sentenceOf(world.project, shown, health);
  assert.equal(words(sentence), 'Showing 8 groups on A Day, all transitions. 2 routes failed. The first: 7A, Period 2, No room is set for this period.');
  assert.equal(sentence.showMe, true);
  // one failure reads as DESIGN 5.3 has it
  const one = picture(world, { transition: 1 });
  assert.equal(words(sentenceOf(world.project, one, health)), 'Showing 8 groups on A Day, Period 2 to Period 3 (9:40 to 9:44). 1 route failed: 7A, Period 2, No room is set for this period.');
  // nothing failed among what is shown, but something did elsewhere
  const others = picture(world, { who: 'grade', grade: '8' });
  const quiet = sentenceOf(world.project, others, health);
  assert.equal(words(quiet), 'Showing 2 groups of grade 8 on A Day, all transitions. No route failed here; 3 routes failed elsewhere.');
  assert.equal(quiet.showMe, true);
  // until the first answer comes the line says so and claims nothing
  const waiting = pictureOf(world.project, null, null, defaultChoice(world.project));
  assert.equal(words(sentenceOf(world.project, waiting, [])), 'Showing 8 groups on A Day, all transitions. Working out the routes.');
});

test('route health names every failed route of every group on every day type, why, and where to put it right', () => {
  assert.deepEqual(routeHealth(sample.project, sample.results), [], 'the sample school has none');
  const world = broken();
  const health = routeHealth(world.project, world.results);
  assert.deepEqual(health.map((failure) => [failure.groupId, failure.dayTypeId, failure.period, failure.fixPeriod, failure.route.reason, failure.reason]), [
    ['gsample07a', DAY_A, 1, 2, 'no-room', 'No room is set for this period.'],
    ['gsample07a', DAY_A, 2, 2, 'no-room', 'No room is set for this period.'],
    ['gsample06b', DAY_B, 0, 0, 'room-missing', 'Annex 9 is not in the building.'],
  ]);
  assert.equal(failurePeriod({ period: 4, route: { end: 'to' } }), 5, 'the end the router named is the slot to open');
  assert.equal(failurePeriod({ period: 4, route: { end: 'from' } }), 4);
  // an empty period and a room that is not there are put right in the schedule
  assert.deepEqual(fixFor(world.project, health[0]), { label: 'Fix it in the schedule', hash: '#schedule/groups', slot: { groupId: 'gsample07a', dayTypeId: DAY_A, period: 2 } });
  // a room that opens onto nothing is put right in the building
  const shut = { groupId: 'gsample07a', dayTypeId: DAY_A, period: 0, fixPeriod: 0, route: { ok: false, reason: 'no-entry', roomId: 'rsample203', floorId: 'fsample002', end: 'from' } };
  assert.deepEqual(fixFor(world.project, shut), { label: 'Show the room', hash: '#building/fsample002?room=rsample203', slot: null });
  // the failed group's row in the legend counts them
  const rows = groupRows(world.project, world.results, picture(world));
  assert.deepEqual(rows.filter((row) => row.failed > 0).map((row) => [row.group.name, row.failed]), [['7A', 2]]);
});

test('a name is handed on exactly as typed, marked as a name, never as markup', () => {
  const project = clone(sample.project);
  const hostile = '<img src=x onerror=alert(1)> & "7A"';
  group(project, '7A').name = hostile;
  project.dayTypes[0].name = '<b>A</b> Day';
  group(project, hostile).days[DAY_A][2] = { room: null, roomText: '', label: '', teacherIds: [] };
  const world = derive(project);
  const one = picture(world, { who: 'groups', groupIds: ['gsample07a'] });
  const sentence = sentenceOf(project, one, routeHealth(project, world.results));
  assert.ok(sentence.parts.some((part) => part.text === hostile && part.name === true));
  assert.ok(sentence.parts.some((part) => part.text === '<b>A</b> Day' && part.name === true));
  assert.equal(words(sentence), 'Showing ' + hostile + ' on <b>A</b> Day, all transitions. 2 routes failed. The first: ' + hostile + ', Period 2, No room is set for this period.');
});

// ---------------------------------------------------------------- where the floors sit

test('floors sit side by side or stacked, each on the box of what is drawn, with a row for its name', () => {
  const floors = sample.project.building.floors;
  const side = layoutFloors(floors, 'side');
  assert.equal(side.how, 'side');
  assert.deepEqual(side.slots.map((slot) => [slot.floor.name, slot.x, slot.y]), [['Floor 1', 0, TITLE_ROWS], ['Floor 2', side.slots[0].w + FLOOR_GAP, TITLE_ROWS], ['Floor 3', side.slots[0].w + side.slots[1].w + 2 * FLOOR_GAP, TITLE_ROWS]]);
  assert.equal(side.width, side.slots.reduce((sum, slot) => sum + slot.w, 0) + 2 * FLOOR_GAP);
  const stacked = layoutFloors(floors, 'stacked');
  assert.equal(stacked.how, 'stacked');
  assert.ok(stacked.slots.every((slot) => slot.x === 0));
  assert.equal(stacked.slots[1].y, TITLE_ROWS + stacked.slots[0].h + FLOOR_GAP + TITLE_ROWS);
  assert.equal(stacked.height, stacked.slots.reduce((sum, slot) => sum + slot.h + TITLE_ROWS, 0) + 2 * FLOOR_GAP);
  // the sample's floors are wide and low: stacked fits a square window larger, side by side a very wide one
  assert.equal(bestLayout(floors, 900, 700), 'stacked');
  assert.equal(bestLayout(floors, 3000, 300), 'side');
  assert.equal(bestLayout(floors.slice(0, 1), 900, 700), 'side', 'one floor has nothing to arrange');
});

test('a place on the map is a cell of a floor, and back again; between floors there is nothing', () => {
  const floors = sample.project.building.floors;
  const layout = layoutFloors(floors, 'side');
  const second = layout.slots[1];
  const cell = 7 * 40 + 12;
  const place = placeOf(layout, 'fsample002', cell);
  assert.deepEqual(place, { x: second.x + 12 - second.box.x, y: second.y + 7 - second.box.y });
  const back = slotAt(layout, place.x, place.y);
  assert.equal(back.slot.floor.id, 'fsample002');
  assert.equal(back.cell, cell);
  assert.equal(slotAt(layout, second.x - 1, second.y), null, 'the gap between two floors');
  assert.equal(slotAt(layout, 0, 0), null, 'the row of the floors\' names');
  assert.equal(placeOf(layout, 'fnowhere00', 0), null);
  assert.equal(placeOf(layoutFloors(floors.slice(0, 1), 'side'), 'fsample002', cell), null, 'a floor that is not on screen');
});
