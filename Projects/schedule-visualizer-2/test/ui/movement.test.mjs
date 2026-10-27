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
import * as model from '../../ui/movement/model.js';
import { layoutFloors, bestLayout, slotAt, placeOf, stageLeast, keepShift, FLOOR_GAP, TITLE_ROWS, STAGE_LEAST, ZOOM_ROOM, FIT_MARGIN } from '../../ui/movement/layout.js';
import { bandText } from '../../ui/movement/legend.js';
import { fixFor } from '../../ui/movement/summary.js';
import { heldScale, canvasHolds, isBlank, LOWEST_SCALE } from '../../ui/movement/export.js';
import { hotspotRows, hotspotsCsv, groupHeadings, placeRanks, RANK_RADIUS } from '../../ui/movement/hotspots.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPipeline } from '../../engine/worker.js';
import { buildGraph } from '../../engine/graph.js';
import { routingGraph, route } from '../../engine/routing.js';
import { loads } from '../../engine/load.js';
import { planProject, roomId, floorId, threeFloors, disconnectedWing } from '../fixtures/buildings/plans.mjs';
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
  assert.deepEqual(choice, { who: 'all', grade: '', groupIds: [], dayTypeId: DAY_A, bellsId: null, transition: null, measure: 'busiest', floors: 'auto', labels: true, constantWidth: false });
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
  assert.equal(words(sentence), 'Showing 8 groups on A Day, all transitions. 2 routes failed. The first: 7A, Period 3, no room is set for this period.');
  assert.equal(sentence.showMe, true);
  // one failure reads as DESIGN 5.3 has it
  const one = picture(world, { transition: 1 });
  assert.equal(words(sentenceOf(world.project, one, health)), 'Showing 8 groups on A Day, Period 2 to Period 3 (9:40 to 9:44). 1 route failed: 7A, Period 3, no room is set for this period.');
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
  assert.equal(words(sentence), 'Showing ' + hostile + ' on <b>A</b> Day, all transitions. 2 routes failed. The first: ' + hostile + ', Period 3, no room is set for this period.');
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

// ---------------------------------------------------------------- SV2-39: the review of SV2-17

const failureWords = (project, failure, withDay) => model.failureParts(project, failure, withDay).map((part) => part.text).join('');

// A plan project with one group that is in `first` for Period 1 and `second`
// for Period 2, on a two-period day.
function twoPeriods(project, first, second) {
  project.settings.periods = 2;
  const slot = (number) => ({ room: number ? roomId(number) : null, roomText: '', label: '', teacherIds: [] });
  project.groups = [{ id: 'gplan00001', name: 'P1', grade: '5', headCount: null, colour: '#d1495b', days: { [project.dayTypes[0].id]: [slot(first), slot(second)] } }];
  return project;
}

// A room no corridor touches, across the floor from one that opens onto one.
function shutRoom() {
  return planProject([[
    'AA...BB',
    'AA...BB',
    '####...',
  ]]);
}

test('SV2-39 item 1: a failure at the end walked into names that period, and the reason is spliced in without a capital of its own', () => {
  const world = broken();
  const health = routeHealth(world.project, world.results);
  // the walk out of Period 2 fails because Period 3 has no room: Period 3 is what is wrong
  assert.equal(health[0].route.end, 'to');
  assert.equal(failureWords(world.project, health[0], false), '7A, Period 3, no room is set for this period');
  assert.equal(failureWords(world.project, health[0], true), '7A, Period 3 on A Day, no room is set for this period');
  // the walk out of Period 3 fails at the end it starts from: still Period 3
  assert.equal(health[1].route.end, 'from');
  assert.equal(failureWords(world.project, health[1], false), '7A, Period 3, no room is set for this period');
  // a room is named as typed: what was typed keeps its capital, whatever it begins with
  assert.equal(failureWords(world.project, health[2], true), '6B, Period 1 on B Day, Annex 9 is not in the building');
  for (const typed of ['The Annex', 'No way', 'There']) {
    const project = clone(sample.project);
    group(project, '6B').days[DAY_B][0] = { room: null, roomText: typed, label: '', teacherIds: [] };
    const other = derive(project);
    assert.equal(failureWords(project, routeHealth(project, other.results)[0], false), '6B, Period 1, ' + typed + ' is not in the building');
  }
});

test('SV2-39 items 1 and 9: route health from real routing, a room nothing reaches and a room that opens onto nothing', () => {
  const apart = derive(twoPeriods(disconnectedWing(), '1A', '1C'));
  const lost = routeHealth(apart.project, apart.results);
  assert.deepEqual(lost.map((failure) => [failure.groupId, failure.period, failure.fixPeriod, failure.route.reason, failure.route.end, failure.reason]), [
    ['gplan00001', 0, 1, 'unreachable', 'to', 'There is no way through from Room 1A to Room 1C on Floor 1.'],
  ]);
  assert.equal(failureWords(apart.project, lost[0], false), 'P1, Period 2, there is no way through from Room 1A to Room 1C on Floor 1');
  assert.deepEqual(fixFor(apart.project, lost[0]), { label: 'Show the room', hash: '#building/' + floorId(1) + '?room=' + roomId('1C'), slot: null });

  const shut = derive(twoPeriods(shutRoom(), '1A', '1B'));
  const closed = routeHealth(shut.project, shut.results);
  assert.deepEqual(closed.map((failure) => [failure.period, failure.fixPeriod, failure.route.reason, failure.route.roomId]), [[0, 1, 'no-entry', roomId('1B')]]);
  assert.equal(failureWords(shut.project, closed[0], false), 'P1, Period 2, Room 1B on Floor 1 does not open onto a corridor', 'a room\'s name keeps its capital');
  const shown = picture(shut);
  assert.equal(words(sentenceOf(shut.project, shown, closed)), 'Showing P1 on A Day, Period 1 to Period 2. 1 route failed: P1, Period 2, Room 1B on Floor 1 does not open onto a corridor.'.replace('Period 1 to Period 2', 'all transitions'));
});

test('SV2-39 item 9: route health drops a deleted group\'s routes and passes over a day type that follows another', () => {
  const world = broken();
  assert.equal(routeHealth(world.project, world.results).length, 3);
  // 7A is deleted and the answer for that has not come: its failed routes are nobody's
  const fewer = clone(world.project);
  fewer.groups = fewer.groups.filter((each) => each.name !== '7A');
  assert.deepEqual(routeHealth(fewer, world.results).map((failure) => failure.groupId), ['gsample06b']);
  // B Day becomes "same as A Day": its routes in the old answer are no day of its own
  const copy = clone(world.project);
  copy.dayTypes[1].own = false;
  assert.deepEqual(routeHealth(copy, world.results).map((failure) => [failure.groupId, failure.dayTypeId]), [['gsample07a', DAY_A], ['gsample07a', DAY_A]]);
  assert.deepEqual(routeHealth(world.project, null), []);
});

test('SV2-39 items 2 and 9: after a derive that fails the last good answer stands, marked as from before the change, and the first line says what went wrong', () => {
  assert.equal(typeof model.standingOf, 'function', 'model.js has no standingOf');
  const before = sample.project;
  const after = clone(before);
  group(after, '7A').name = '7A East';
  // nothing yet: the project as it is, no results, nothing stale
  assert.deepEqual(model.standingOf(after, { project: null, results: null, failed: null }), { project: after, results: null, failed: null, stale: false });
  // the first derive of all fails: nothing to keep
  const never = model.standingOf(after, { project: null, results: null, failed: 'The engine stopped.' });
  assert.deepEqual(never, { project: after, results: null, failed: 'The engine stopped.', stale: false });
  assert.equal(words(model.failedSentence(never)), 'The routes could not be worked out: The engine stopped.');
  // a good answer, then a change whose derive fails
  const good = model.standingOf(before, { project: before, results: sample.results, failed: null });
  assert.deepEqual([good.project, good.results, good.failed, good.stale], [before, sample.results, null, false]);
  const standing = model.standingOf(after, { project: before, results: sample.results, failed: 'The engine stopped' });
  assert.equal(standing.project, before, 'the picture is drawn against the project it was worked out for');
  assert.equal(standing.results, sample.results);
  assert.equal(standing.stale, true);
  const sentence = model.failedSentence(standing);
  assert.equal(words(sentence), 'The routes could not be worked out: The engine stopped. The map and the figures are from before your last change.');
  assert.equal(sentence.showMe, false);
  assert.ok(sentence.parts.some((part) => part.text === 'The engine stopped' && part.name === true), 'the message is handed on as text, never as markup');
  // the picture and route health of what stands are the old ones, whole
  const shown = pictureOf(standing.project, standing.results, sample.graph, defaultChoice(after));
  assert.equal(shown.drawn, 56);
  assert.equal(shown.groups.find((each) => each.id === 'gsample07a').name, '7A');
  assert.deepEqual(routeHealth(standing.project, standing.results), []);
});

test('SV2-39 item 4: the exclusion zones counted are those on the floors on screen that cover a cell someone can walk on', () => {
  assert.equal(picture(sample).load.zones, 1);
  assert.equal(picture(sample, { floors: 'fsample001' }).load.zones, 1);
  assert.equal(picture(sample, { floors: 'fsample003' }).load.zones, 0, 'the one zone is on Floor 1, which is not on screen');
  // a zone drawn over rooms and empty cells leaves nothing out of the scale
  const project = clone(sample.project);
  const room = project.building.floors[1].spaces.find((space) => space.kind === 'room');
  project.building.zones.push({ id: 'zsample002', floorId: 'fsample002', label: 'Over a room', x: room.cells[0] % 40, y: Math.floor(room.cells[0] / 40), w: 1, h: 1 });
  project.building.zones.push({ id: 'zsample003', floorId: 'fsample003', label: 'A corridor', x: 0, y: 0, w: 40, h: 30 });
  const world = derive(project);
  assert.equal(world.results.loads[0].zones, 3, 'the engine counts the building\'s zones');
  assert.equal(picture(world).load.zones, 2, 'two of the three cover a walkable cell');
  assert.equal(picture(world, { floors: 'fsample002' }).load.zones, 0);
  assert.equal(picture(world, { floors: 'fsample003' }).load.zones, 1);
});

test('SV2-39 item 5: a group chosen twice is compared once, and the words of the limit come from the limit', () => {
  const ids = sample.project.groups.map((each) => each.id);
  const settled = settleChoice(sample.project, { who: 'groups', groupIds: [ids[0], ids[0], ids[1], ids[0], ids[2], ids[3], ids[4]] });
  assert.deepEqual(settled.groupIds, ids.slice(0, 4), 'four different groups, not one group in three of the four places');
  assert.equal(shownGroups(sample.project, settleChoice(sample.project, { who: 'groups', groupIds: [ids[0], ids[0], ids[1]] })).length, 2);
  assert.deepEqual(settleChoice(sample.project, { who: 'groups', groupIds: [ids[0], ids[0], ids[1]] }).groupIds, [ids[0], ids[1]]);
  assert.equal(typeof model.compareReason, 'function', 'model.js has no compareReason');
  assert.equal(COMPARE_REASON, model.compareReason(COMPARE_LIMIT));
  assert.match(model.compareReason(3), /^Three groups at most are compared at once: /);
  assert.match(model.compareReason(6), /^Six groups at most are compared at once: /);
  assert.match(model.compareReason(1), /^One group at most is compared at once: /);
  assert.match(model.compareReason(40), /^40 groups at most are compared at once: /);
  assert.equal(model.compareFull(COMPARE_LIMIT), 'Four groups are shown');
  assert.equal(model.compareFull(5), 'Five groups are shown');
  assert.equal(model.compareFull(1), 'One group is shown');
  // the controls say it in model.js's words: neither file spells the number out
  for (const file of ['controls.js', 'model.js']) {
    const source = readFileSync(fileURLToPath(new URL('../../ui/movement/' + file, import.meta.url)), 'utf8');
    const lines = source.split('\n').filter((line) => /\bFour\b/.test(line) && !/^\s*\/\//.test(line) && !/NUMBER_WORDS/.test(line));
    assert.deepEqual(lines, [], file + ' spells the limit out');
  }
});

test('SV2-39 items 8 and 9: the relative maximum is of what is drawn: a connection joins it only when its link is on the map', () => {
  // one floor on screen, and a stairs connection with one end on it: the
  // link is drawn (it leaves the floor), and the maximum is still the floor's
  const first = picture(sample, { floors: 'fsample001' });
  assert.deepEqual(first.links.map((link) => [link.id, link.a.floorId, link.b.floorId]), [['csample00a', 'fsample001', 'fsample002'], ['csample00b', 'fsample002', 'fsample003']], 'every connection in use is listed; the map draws those with an end on screen');
  const floor = sample.graph.floors[0];
  const whole = sample.results.loads[0];
  let max = 0;
  for (let node = floor.offset; node < floor.offset + floor.count; node += 1) if (!whole.excluded[node]) max = Math.max(max, whole.cells.busiest[node]);
  assert.equal(first.load.max, max);
  assert.equal(first.busiest.cell !== null, true, 'the busiest is a cell');
  // By the load rule a connection never carries more than the stairs cell at
  // either end (whoever takes it crosses both), so real loads cannot tell
  // the rule below from its absence. That is checked here, and the rule is
  // then shown on an answer made up for it.
  for (const load of sample.results.loads) {
    sample.graph.links.forEach((link, index) => {
      for (const measure of ['busiest', 'total']) {
        assert.ok(load.connections[measure][index] <= load.cells[measure][link.a] && load.connections[measure][index] <= load.cells[measure][link.b], link.id + ' carries more than its stairs');
      }
    });
  }
  const linkOf = (id) => sample.graph.links.findIndex((link) => link.id === id);
  const made = (id, value) => {
    const kept = sample.results.loads[0];
    const busiest = Int32Array.from(kept.connections.busiest);
    busiest[linkOf(id)] = value;
    return { ...sample.results, loads: [{ ...kept, connections: { ...kept.connections, busiest } }, sample.results.loads[1]] };
  };
  // Floor 3 alone: connection A (Floor 1 to Floor 2) has no end on screen and is not drawn
  const third = picture(sample, { floors: 'fsample003' }).load.max;
  assert.equal(pictureOf(sample.project, made('csample00a', 9000), sample.graph, { ...defaultChoice(sample.project), floors: 'fsample003' }).load.max, third);
  // a walk along one floor of three: both stairs connections have ends on
  // screen and nobody takes either, so neither link is drawn, whatever
  // figure the answer holds for one
  const quiet = derive(twoPeriods(threeFloors(), '1A', '1B'));
  const still = picture(quiet);
  assert.deepEqual(still.links, []);
  assert.equal(still.load.max, 1, 'one group, counted as one');
  const held = quiet.results.loads[0];
  const loud = Int32Array.from(held.connections.busiest);
  loud[0] = 9000;
  const answer = { ...quiet.results, loads: [{ ...held, connections: { ...held.connections, busiest: loud } }] };
  const after = pictureOf(quiet.project, answer, quiet.graph, defaultChoice(quiet.project));
  assert.equal(after.load.source, answer.loads[0], 'the made-up answer is the one read');
  assert.equal(after.load.max, 1, 'a connection that is not on the map set the scale');
  assert.equal(after.busiest.cell !== null, true);
  // a connection that is drawn does join: it is on the map, with its load
  const joined = pictureOf(sample.project, made('csample00b', 9000), sample.graph, { ...defaultChoice(sample.project), floors: 'fsample003' });
  assert.equal(joined.load.max, 9000);
  assert.equal(joined.busiest.cell, null, 'the busiest is the connection');
});

test('SV2-39 item 9: some of the groups on a day type that is "same as" another, and a grade that holds every group', () => {
  const project = clone(sample.project);
  project.dayTypes[1].own = false;
  for (const each of project.groups) delete each.days[DAY_B];
  const world = derive(project);
  assert.equal(world.results.loads.length, 1, 'one own day type, one load');
  const ids = ['gsample06a', 'gsample07a'];
  const two = picture(world, { dayTypeId: DAY_B, who: 'groups', groupIds: ids });
  assert.equal(two.dayTypeId, DAY_A, 'the routes and loads are A Day\'s');
  assert.equal(two.dayTypeName, 'B Day', 'under the name that was chosen');
  assert.equal(two.drawn, 14);
  const onA = picture(world, { dayTypeId: DAY_A, who: 'groups', groupIds: ids });
  assert.equal(two.load.max, 51);
  assert.deepEqual(Array.from(two.load.cells), Array.from(onA.load.cells));
  assert.deepEqual(Array.from(two.lanes.at.entries()), Array.from(onA.lanes.at.entries()));
  assert.equal(words(sentenceOf(project, two, [])), 'Showing 2 groups on B Day, all transitions. No route failed.');
  // every group in one grade: the grade's picture is the whole school's, from the answer's own loads
  const one = clone(sample.project);
  for (const each of one.groups) each.grade = '7';
  const school7 = derive(one);
  const grade = picture(school7, { who: 'grade', grade: '7' });
  const all = picture(school7);
  assert.equal(grade.groups.length, 8);
  assert.equal(grade.load.source, school7.results.loads[0], 'not counted a second time');
  assert.equal(grade.load.max, all.load.max);
  assert.equal(grade.drawn, all.drawn);
  assert.equal(words(sentenceOf(one, grade, [])), 'Showing 8 groups of grade 7 on A Day, all transitions. No route failed.');
});

// A walk made by hand, for the shapes a found route does not take.
function byHand(project, id, from, cells, to) {
  const place = (cell) => ({ floorId: floorId(1), cell });
  return { ok: true, fromRoomId: 'r' + id + 'from', toRoomId: 'r' + id + 'to', from: place(from), to: place(to), cells: cells.map(place), connections: [], connectionAt: [] };
}

test('SV2-39 item 9: where a bundle grows or thins on a straight, a lane moves over inside the one cell; a walk that doubles back returns on the other side', () => {
  const project = hall();
  const at = (x, y) => y * 11 + x;
  const row = (from, to) => Array.from({ length: Math.abs(to - from) + 1 }, (unused, i) => at(from + (to > from ? i : -i), 1));
  // g0 walks the first half of the corridor east and leaves it; g1 walks all of it
  const lanes = buildLanes(project, [
    { groupId: 'g1', rank: 1, route: byHand(project, 'b', at(0, 0), row(0, 10), at(10, 0)) },
    { groupId: 'g0', rank: 0, route: byHand(project, 'a', at(0, 0), row(0, 5), at(5, 0)) },
  ]);
  assert.equal(lanes.most, 2);
  const inner = laneOffset(lanes, 0);
  const outer = laneOffset(lanes, 1);
  const round = (n) => Number(n.toFixed(6));
  const line = lanes.floors.get(floorId(1)).find((lane) => lane.groupId === 'g1').points;
  const pairs = [];
  for (let i = 0; i < line.length; i += 2) pairs.push([round(line[i]), round(line[i + 1])]);
  // beside g0 as far as cell 4, the outer lane; from cell 6 on, alone, the inner one
  assert.deepEqual(lanePoint(lanes, 'g1', floorId(1), at(4, 1)).map(round), [4.5, round(1.5 + outer)]);
  assert.deepEqual(lanePoint(lanes, 'g1', floorId(1), at(6, 1)).map(round), [6.5, round(1.5 + inner)]);
  // the move is inside cell 5: two points, a quarter of a cell either side of its middle
  const inFive = pairs.filter(([x]) => x > 5 && x < 6);
  assert.deepEqual(inFive, [[5.25, round(1.5 + outer)], [5.75, round(1.5 + inner)]]);
  assert.deepEqual(lanePoint(lanes, 'g1', floorId(1), at(5, 1)).map(round), [5.25, round(1.5 + outer)], 'the cell\'s lane point is where the lane comes in');
  // and the other way about: the bundle grows where a second group joins
  const grows = buildLanes(project, [
    { groupId: 'g0', rank: 0, route: byHand(project, 'c', at(5, 0), row(5, 10), at(10, 0)) },
    { groupId: 'g1', rank: 1, route: byHand(project, 'b', at(0, 0), row(0, 10), at(10, 0)) },
  ]);
  const wider = grows.floors.get(floorId(1)).find((lane) => lane.groupId === 'g1').points;
  const joins = [];
  for (let i = 0; i < wider.length; i += 2) if (wider[i] > 5 && wider[i] < 6) joins.push([round(wider[i]), round(wider[i + 1])]);
  assert.deepEqual(joins, [[5.25, round(1.5 + laneOffset(grows, 0))], [5.75, round(1.5 + laneOffset(grows, 1))]], 'g1 moves out in cell 5, where g0 steps in and turns east');
  assert.ok(pairs.every(([, y]) => y > 1.5 || y < 1), 'walking east it never crosses to the north side: ' + JSON.stringify(pairs));

  // out along the corridor to cell 6 and straight back to cell 2
  const back = buildLanes(project, [{ groupId: 'g', rank: 0, route: byHand(project, 'u', at(0, 0), row(0, 6).concat(row(5, 2)), at(2, 0)) }]);
  const off = laneOffset(back, 0);
  const turn = [];
  const path = back.floors.get(floorId(1))[0].points;
  for (let i = 0; i < path.length; i += 2) if (path[i] > 6 && path[i] < 7) turn.push([round(path[i]), round(path[i + 1])]);
  assert.deepEqual(turn, [[6.5, round(1.5 + off)], [6.5, round(1.5 - off)]], 'in the cell it turns in, the line crosses from the south side to the north');
  assert.deepEqual(lanePoint(back, 'g', floorId(1), at(6, 1)).map(round), [6.5, round(1.5 + off)]);
  for (let i = 2; i < path.length; i += 2) {
    assert.ok(Math.abs(path[i] - path[i - 2]) < 1e-9 || Math.abs(path[i + 1] - path[i - 1]) < 1e-9, 'piece ' + i / 2 + ' of the walk back is not straight');
  }
});

test('SV2-39 item 9: the lanes are the same whatever order the routes come in, and after a transition is taken off and put back', () => {
  const day = sample.results.routes.days.find((each) => each.dayTypeId === DAY_A);
  const rank = new Map(sample.project.groups.map((each, index) => [each.id, index]));
  const entries = [];
  for (const entry of day.groups) entry.routes.forEach((found, t) => entries.push({ t, groupId: entry.groupId, rank: rank.get(entry.groupId), route: found }));
  const flat = (lanes) => ({
    pitch: lanes.pitch,
    most: lanes.most,
    at: Array.from(lanes.at.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    floors: Array.from(lanes.floors.entries()).map(([id, list]) => [id, list.map((lane) => [lane.groupId, lane.points])]),
    links: Array.from(lanes.links.entries()).map(([id, list]) => [id, list.slice().sort()]).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
  });
  const first = flat(buildLanes(sample.project, entries));
  assert.ok(first.at.length > 100);
  assert.deepEqual(flat(buildLanes(sample.project, entries.slice().reverse())), first, 'the routes given last to first');
  // Period 4 to Period 5 taken off the picture and put back: its routes now come last
  const toggled = entries.filter((entry) => entry.t !== 3).concat(entries.filter((entry) => entry.t === 3));
  assert.deepEqual(flat(buildLanes(sample.project, toggled)), first, 'a transition taken off and put back');
  // by group last to first, as a project listed the other way round would give them
  const regrouped = entries.slice().sort((a, b) => b.rank - a.rank || b.t - a.t);
  assert.deepEqual(flat(buildLanes(sample.project, regrouped)), first);
});

// ---------------------------------------------------------------- SV2-43: the cases the review of SV2-39 named

test('SV2-43 item 3: a reason that opens with a word of the tool’s own loses its capital after the comma, in every branch; what was typed keeps its own', () => {
  const project = twoPeriods(shutRoom(), '1A', '1B');
  const day = project.dayTypes[0].id;
  const floor = floorId(1);
  const failure = (route, period) => ({ groupId: 'gplan00001', dayTypeId: day, period: period || 0, route });
  // a room that is not in the building, with nothing typed for it
  for (const text of ['', '   ', undefined, null]) {
    assert.equal(failureWords(project, failure({ ok: false, reason: 'room-missing', roomId: null, floorId: null, end: 'to', text }), false), 'P1, Period 2, the room is not in the building', JSON.stringify(text));
  }
  // a room with no way in, deleted since the answer was worked out
  assert.equal(failureWords(project, failure({ ok: false, reason: 'no-entry', roomId: 'rgone00001', floorId: floor, end: 'to' }), false), 'P1, Period 2, the room on Floor 1 does not open onto a corridor');
  assert.equal(failureWords(project, failure({ ok: false, reason: 'no-entry', roomId: 'rgone00001', floorId: null, end: 'from' }), false), 'P1, Period 1, the room does not open onto a corridor');
  // no way through, from the end walked out of
  assert.equal(failureWords(project, failure({ ok: false, reason: 'unreachable', roomId: roomId('1A'), floorId: floor, end: 'from' }), true), 'P1, Period 1 on A Day, there is no way through from Room 1A on Floor 1 to an exit');
  // a room whose number is blank is named in the tool's words, and they lose their capital like the rest
  const blank = clone(project);
  blank.building.floors[0].spaces.find((space) => space.id === roomId('1B')).number = '  ';
  assert.equal(failureWords(blank, failure({ ok: false, reason: 'no-entry', roomId: roomId('1B'), floorId: floor, end: 'to' }), false), 'P1, Period 2, a room with no number on Floor 1 does not open onto a corridor');
  // the same words typed as a room's number are the room's name: as typed
  for (const typed of ['A room with no number', 'The room', 'There', 'No room']) {
    const named = clone(project);
    named.building.floors[0].spaces.find((space) => space.id === roomId('1B')).number = typed;
    assert.equal(failureWords(named, failure({ ok: false, reason: 'no-entry', roomId: roomId('1B'), floorId: floor, end: 'to' }), false), 'P1, Period 2, ' + typed + ' on Floor 1 does not open onto a corridor');
    assert.equal(failureWords(named, failure({ ok: false, reason: 'room-missing', roomId: null, floorId: null, end: 'to', text: typed }), false), 'P1, Period 2, ' + typed + ' is not in the building');
  }
  // the piece is marked as typed either way, so a name in it is never read as markup
  const parts = model.failureParts(project, failure({ ok: false, reason: 'room-missing', roomId: null, floorId: null, end: 'to', text: '<b>9</b>' }), false);
  assert.deepEqual(parts[parts.length - 1], { text: '<b>9</b> is not in the building', name: true });
});

test('SV2-43 item 3: the first line of a derive that failed ends in one stop, whether the message brought one or not', () => {
  const before = sample.project;
  for (const [message, said] of [['The engine stopped', 'The engine stopped.'], ['The engine stopped.', 'The engine stopped.'], ['Stopped!', 'Stopped!'], ['Why?', 'Why?']]) {
    const fresh = model.failedSentence(model.standingOf(before, { project: null, results: null, failed: message }));
    assert.equal(words(fresh), 'The routes could not be worked out: ' + said, 'nothing drawn, ' + message);
    const stale = model.failedSentence(model.standingOf(before, { project: before, results: sample.results, failed: message }));
    assert.equal(words(stale), 'The routes could not be worked out: ' + said + ' The map and the figures are from before your last change.', 'an older answer drawn, ' + message);
    // the message itself is one piece, exactly as it came
    assert.ok(fresh.parts.some((part) => part.text === message && part.name === true));
    assert.ok(stale.parts.some((part) => part.text === message && part.name === true));
  }
});

test('SV2-43 item 3: a zone partly off its floor counts for the cells it does cover; one wholly off it, or on a floor the building does not have, counts for nothing', () => {
  const project = clone(sample.project);
  const third = project.building.floors[2];
  const corridor = third.cells.indexOf('#');
  const cx = corridor % third.width;
  const cy = Math.floor(corridor / third.width);
  project.building.zones.push({ id: 'zsample004', floorId: third.id, label: 'Over the west edge', x: -3, y: cy - 2, w: cx + 4, h: 3 });
  project.building.zones.push({ id: 'zsample005', floorId: third.id, label: 'Off the floor', x: third.width + 5, y: third.height + 5, w: 4, h: 4 });
  project.building.zones.push({ id: 'zsample006', floorId: third.id, label: 'Above the floor', x: cx, y: -9, w: 1, h: 4 });
  project.building.zones.push({ id: 'zsample007', floorId: 'fnowhere00', label: 'No such floor', x: 0, y: 0, w: 40, h: 30 });
  const world = derive(project);
  assert.equal(picture(world, { floors: third.id }).load.zones, 1, 'the zone over the edge covers the corridor cell at column ' + (cx + 1));
  assert.equal(picture(world).load.zones, 2, 'with the sample’s own zone on Floor 1');
  assert.equal(picture(world, { floors: 'fsample002' }).load.zones, 0);
});

// ---------------------------------------------------------------- SV2-43: the review of SV2-47

test('SV2-43 47c: the size a picture is drawn at is asked of the browser first as it was asked for, whatever it is, and then a step at a time down to a quarter', () => {
  const tried = (asked, holdsFrom) => {
    const seen = [];
    const answer = heldScale(1000, 1000, asked, (width) => {
      seen.push(width / 1000);
      return width / 1000 <= holdsFrom;
    });
    return { seen, ...answer };
  };
  // under a half already: the size asked for is tried, then the quarter
  assert.deepEqual(tried(0.45, 0.25), { seen: [0.45, 0.25], scale: 0.25, fell: 1 });
  assert.deepEqual(tried(0.3, 0.3), { seen: [0.3], scale: 0.3, fell: 0 });
  assert.deepEqual(tried(0.3, 0.25), { seen: [0.3, 0.25], scale: 0.25, fell: 1 });
  // at the quarter, and under it: tried once, and nothing smaller is drawn
  assert.deepEqual(tried(LOWEST_SCALE, 1), { seen: [0.25], scale: 0.25, fell: 0 });
  assert.deepEqual(tried(LOWEST_SCALE, 0), { seen: [0.25], scale: 0, fell: 1 });
  assert.deepEqual(tried(0.2, 1), { seen: [0.2], scale: 0.2, fell: 0 }, 'a map so large that the tool’s own limits ask for less than a quarter is drawn at that');
  assert.deepEqual(tried(0.2, 0), { seen: [0.2], scale: 0, fell: 1 });
  assert.deepEqual(tried(4, 0), { seen: [4, 2, 1, 0.5, 0.25], scale: 0, fell: 5 });
});

test('SV2-43 47c: a size the browser did not hold is asked about again; one it held is not', () => {
  const had = globalThis.document;
  let alpha = 0;
  let made = 0;
  globalThis.document = {
    createElement: () => {
      made += 1;
      return { width: 0, height: 0, getContext: () => ({ fillStyle: '', fillRect() {}, getImageData: () => ({ data: [0, 0, 0, alpha] }) }) };
    },
  };
  try {
    // a size no other case asks about
    assert.equal(canvasHolds(3217, 2113), false, 'the canvas took no pixel');
    assert.equal(made, 1);
    // the browser has the memory now: the same size is held, because it was asked again
    alpha = 255;
    assert.equal(canvasHolds(3217, 2113), true, 'a no from earlier in the visit was kept');
    assert.equal(made, 2);
    // and a yes is kept: no third canvas
    alpha = 0;
    assert.equal(canvasHolds(3217, 2113), true);
    assert.equal(made, 2);
  } finally {
    if (had === undefined) delete globalThis.document;
    else globalThis.document = had;
  }
});

test('SV2-43 47c: a drawn picture is blank when its far corner reads back nothing', () => {
  const drawnWith = (alpha) => {
    const asked = [];
    return { asked, pixels: { width: 640, height: 480 }, canvas: { getContext: () => ({ getImageData: (...at) => { asked.push(at); return { data: [255, 255, 255, alpha] }; } }) } };
  };
  const blank = drawnWith(0);
  assert.equal(isBlank(blank), true);
  assert.deepEqual(blank.asked, [[639, 479, 1, 1]], 'the far corner, one pixel');
  assert.equal(isBlank(drawnWith(255)), false);
  assert.equal(isBlank(drawnWith(1)), false);
});

test('SV2-43 47d: the hotspots file tells its group columns apart: no name, a name that is a fixed heading, a name two groups have', () => {
  const fixed = ['Rank', 'Place', 'Floor', 'Kind', 'Load (students)', 'When', 'Delay (seconds)', 'Delay over the day (seconds)', 'Cells', 'Groups'];
  const named = (...names) => names.map((name, index) => ({ id: 'g' + index, name }));
  // names of their own are the headings, exactly as typed
  assert.deepEqual(groupHeadings(named('6A', '=6B', '7A, "the early lot"', ' 7B '), fixed), ['6A', '=6B', '7A, "the early lot"', ' 7B ']);
  assert.deepEqual(groupHeadings(named('', '   ', '7A'), fixed), ['(group with no name)', '(group with no name) (2nd of that name)', '7A']);
  // a fixed heading, or another group's name, without case or outer spaces is the same heading to a spreadsheet (SV2-52 item 12)
  assert.deepEqual(groupHeadings(named('Rank', 'Groups', 'Load (students)', 'rank', 'Cells'), fixed), ['Rank (group)', 'Groups (group)', 'Load (students) (group)', 'rank (group) (2nd of that name)', 'Cells (group)']);
  assert.deepEqual(groupHeadings(named('7A', '7A', '8B', '7A', '7a'), fixed), ['7A', '7A (2nd of that name)', '8B', '7A (3rd of that name)', '7a (4th of that name)']);
  // a name typed as another heading reads is still a column of its own
  const awkward = groupHeadings(named('7A', '7A', '7A (2nd of that name)', 'Rank (group)', 'Rank'), fixed);
  assert.equal(new Set([...fixed, ...awkward]).size, fixed.length + awkward.length, 'two headings are the same: ' + awkward);
  for (let n = 1; n <= 24; n += 1) assert.equal(groupHeadings(named(...new Array(n).fill('X')), fixed).length, n);
  // SV2-52 item 12: a group really named "7A (2nd of that name)" beside two 7As keeps its name as typed, before them or after
  assert.deepEqual(groupHeadings(named('7A', '7A', '7A (2nd of that name)'), fixed), ['7A', '7A (2nd of that name) (again)', '7A (2nd of that name)']);
  assert.deepEqual(groupHeadings(named('7A (2nd of that name)', '7A', '7A'), fixed), ['7A (2nd of that name)', '7A', '7A (2nd of that name) (again)']);
  assert.deepEqual(groupHeadings(named('Rank', 'Rank (group)'), fixed), ['Rank (group) (again)', 'Rank (group)']);
  // headings that differ only by case or outer spaces are told apart, the names kept as typed in front
  const spaced = groupHeadings(named('7B', ' 7B', '7b ', '7B'), fixed);
  assert.deepEqual(spaced, ['7B', ' 7B (2nd of that name)', '7b  (3rd of that name)', '7B (4th of that name)']);
  const norm = (text) => text.trim().toLowerCase();
  for (const list of [spaced, awkward, groupHeadings(named('rank', ' Groups ', 'x', 'X', ' x '), fixed)]) {
    assert.equal(new Set([...fixed, ...list].map(norm)).size, fixed.length + list.length, 'two headings are the same to a spreadsheet: ' + list);
  }
  assert.deepEqual(groupHeadings(named(...new Array(13).fill('X')), fixed).slice(10), ['X (11th of that name)', 'X (12th of that name)', 'X (13th of that name)']);

  // through the file: the sample with 6B and 6C renamed to 6A, 7A to nothing and 7B to "Groups"
  const project = clone(sample.project);
  group(project, '6B').name = '6A';
  group(project, '6C').name = '6A';
  group(project, '7A').name = '';
  group(project, '7B').name = 'Groups';
  const world = derive(project);
  const view = picture(world);
  const table = hotspotsCsv(project, hotspotRows(project, world.results, world.graph, view), view);
  assert.deepEqual(table[0], [...fixed, '6A', '6A (2nd of that name)', '6A (3rd of that name)', '(group with no name)', 'Groups (group)', '7C', '8A', '8B']);
  assert.equal(new Set(table[0]).size, table[0].length);
  assert.ok(table[0].every((heading) => heading !== ''));
  // the counts are still each group's own, under its own heading: the sample's first place is crossed by all eight
  assert.deepEqual(table[1].slice(10), [1, 1, 1, 1, 1, 1, 1, 1]);
});

test('SV2-43 47g: the card’s "and N more" line has a weight to fall back on, and the marks’ canvas has its rules in the sheet', () => {
  const sheet = readFileSync(fileURLToPath(new URL('../../ui/movement/movement.css', import.meta.url)), 'utf8');
  const rule = sheet.slice(sheet.indexOf('.mov-card__floor,'), sheet.indexOf('}', sheet.indexOf('.mov-card__floor,')));
  assert.ok(rule.includes('.mov-card__more'), 'the rule that sets the card’s quiet lines no longer names .mov-card__more');
  assert.ok(/font-weight:\s*var\(--w-regular,\s*400\)/.test(rule), 'no weight to fall back on: ' + rule);
  const marks = sheet.slice(sheet.indexOf('.mov-marks {'), sheet.indexOf('}', sheet.indexOf('.mov-marks {')));
  for (const declaration of ['position: absolute', 'inset: 0', 'width: 100%', 'height: 100%', 'pointer-events: none']) assert.ok(marks.includes(declaration), '.mov-marks has no "' + declaration + '"');
  // and no canvas is styled from a script any more
  for (const file of ['hotspots.js', 'playback.js', 'index.js']) {
    const source = readFileSync(fileURLToPath(new URL('../../ui/movement/' + file, import.meta.url)), 'utf8');
    assert.equal(/h\('canvas'[^)]*style:/.test(source), false, file + ' gives a canvas an inline style');
    assert.equal(/h\('style'/.test(source), false, file + ' adds a stylesheet of its own');
  }
});

// ---------------------------------------------------------------- SV2-43 item 2: route health, folded

test('SV2-43 item 2: two failures that one change puts right are one line of route health; failures of another slot, day or reason are lines of their own', () => {
  const world = broken();
  const health = routeHealth(world.project, world.results);
  // 7A's Period 3 has no room on A Day (the walk in and the walk out), and 6B's Period 1 names a room that is not in the building on B Day
  assert.deepEqual(health.map((failure) => [failure.groupId, failure.dayTypeId, failure.period, failure.fixPeriod]), [['gsample07a', DAY_A, 1, 2], ['gsample07a', DAY_A, 2, 2], ['gsample06b', DAY_B, 0, 0]]);
  const folded = model.foldHealth(health);
  assert.deepEqual(folded.map((failure) => [failure.groupId, failure.dayTypeId, failure.fixPeriod, failure.periods, failure.count]), [['gsample07a', DAY_A, 2, [1, 2], 2], ['gsample06b', DAY_B, 0, [0], 1]]);
  // the line is the first failure's, whole: its words and its fix are what they were
  assert.equal(failureWords(world.project, folded[0], true), failureWords(world.project, health[0], true));
  assert.deepEqual(fixFor(world.project, folded[0]), fixFor(world.project, health[0]));
  assert.equal(health.length, 3, 'the list handed in is left as it was');
  // the same slot failing for two reasons is two things to put right
  const two = [{ ...health[0] }, { ...health[1], reason: 'Room 9 is not in the building.' }];
  assert.equal(model.foldHealth(two).length, 2);
  // the same period of another day type, and of another group: not folded
  assert.equal(model.foldHealth([health[0], { ...health[1], dayTypeId: DAY_B }]).length, 2);
  assert.equal(model.foldHealth([health[0], { ...health[1], groupId: 'gsample08a' }]).length, 2);
  // two slots side by side with no room: the walk between them fails once and is named for the slot walked into
  const project = clone(sample.project);
  for (const period of [2, 3]) group(project, '7A').days[DAY_A][period] = { room: null, roomText: '', label: '', teacherIds: [] };
  const both = derive(project);
  const list = routeHealth(project, both.results);
  assert.equal(list.length, 3);
  // the router names the end it could not start from: the walk between the two is the first slot's
  assert.deepEqual(list.map((failure) => [failure.period, failure.fixPeriod, failure.route.end]), [[1, 2, 'to'], [2, 2, 'from'], [3, 3, 'from']]);
  assert.deepEqual(model.foldHealth(list).map((failure) => [failure.fixPeriod, failure.periods]), [[2, [1, 2]], [3, [3]]]);
  assert.equal(model.foldHealth(list).reduce((sum, failure) => sum + failure.count, 0), list.length, 'every failed route is in one line or another');
  assert.deepEqual(model.foldHealth([]), []);
});

// ---------------------------------------------------------------- SV2-43 W8: the ranks of rings that lie over one another

test('SV2-43 W8: a ring’s rank stands on its upper right unless another rank is there already; then on the next place round its ring that is free, so no two lie on one another', () => {
  const apart = (rings) => rings.every((a, i) => rings.every((b, j) => j <= i || Math.hypot(a.bx - b.bx, a.by - b.by) >= RANK_RADIUS * 2 + 1));
  const onRing = (rings) => rings.every((ring) => Math.abs(Math.hypot(ring.bx - ring.x, ring.by - ring.y) - ring.r) < 0.01);
  const upperRight = (ring) => Math.abs(ring.bx - ring.x - ring.r * Math.SQRT1_2) < 0.01 && Math.abs(ring.by - ring.y + ring.r * Math.SQRT1_2) < 0.01;
  // rings well apart: each rank on its own ring's upper right
  const far = placeRanks([{ rank: 1, x: 100, y: 100, r: 10 }, { rank: 2, x: 200, y: 100, r: 10 }, { rank: 3, x: 100, y: 200, r: 10 }]);
  assert.ok(far.every(upperRight), JSON.stringify(far));
  // two places a few pixels apart, a ring's width apart, and one on the other: the busiest keeps the upper right, the second stands clear
  for (const [dx, dy] of [[4, 2], [12, 0], [0, 0], [-9, 9], [16, 0]]) {
    const two = placeRanks([{ rank: 1, x: 100, y: 100, r: 10 }, { rank: 2, x: 100 + dx, y: 100 + dy, r: 10 }]);
    assert.ok(upperRight(two[0]), 'the busiest place’s rank moved for the second: ' + JSON.stringify(two));
    assert.ok(apart(two) && onRing(two), dx + ', ' + dy + ': ' + JSON.stringify(two));
    assert.equal(upperRight(two[1]), false, dx + ', ' + dy + ': the second rank lies on the first');
  }
  // 17 px apart, the two ranks clear one another where they are: nothing moves
  assert.ok(placeRanks([{ rank: 1, x: 100, y: 100, r: 10 }, { rank: 2, x: 117, y: 100, r: 10 }]).every(upperRight));
  // three on one spot, the smallest rings there are: three places a third of the way round from one another
  const stacked = placeRanks([{ rank: 1, x: 50, y: 50, r: 10 }, { rank: 2, x: 50, y: 50, r: 10 }, { rank: 3, x: 50, y: 50, r: 10 }]);
  assert.ok(upperRight(stacked[0]) && apart(stacked) && onRing(stacked), JSON.stringify(stacked));
  // the sample school's three at 25 %: 19 px between the first and the third
  const sample25 = placeRanks([{ rank: 1, x: 425, y: 137, r: 10 }, { rank: 2, x: 437, y: 239, r: 10 }, { rank: 3, x: 407, y: 143, r: 10 }]);
  assert.ok(apart(sample25) && onRing(sample25));
  // six rings of 10 px on one spot have no six free places: every rank is still on its ring, and the first three stand clear
  const crowd = placeRanks(Array.from({ length: 6 }, (unused, index) => ({ rank: index + 1, x: 30, y: 30, r: 10 })));
  assert.ok(onRing(crowd) && apart(crowd.slice(0, 3)), JSON.stringify(crowd));
  // a ring is left where it was, and the list is the one given
  const given = [{ rank: 1, x: 7, y: 9, r: 12 }];
  assert.equal(placeRanks(given), given);
  assert.deepEqual([given[0].x, given[0].y, given[0].r], [7, 9, 12]);
  assert.deepEqual(placeRanks([]), []);
});

// SV2-43 item 3's two browser cases, as the rules the view follows (SV2-52 item 11)
test('SV2-52 item 11 (SV2-43 item 3): an answer that comes after the view has gone, or for a project the store has left, is not for the screen', () => {
  const before = { id: 'p1' };
  const after = { id: 'p1' };
  assert.equal(model.answerCounts({ gone: false, asked: before, answered: before, now: before }), true);
  assert.equal(model.answerCounts({ gone: true, asked: before, answered: before, now: before }), false, 'the view has gone');
  assert.equal(model.answerCounts({ gone: false, asked: after, answered: before, now: after }), false, 'a later project was asked about since');
  assert.equal(model.answerCounts({ gone: false, asked: before, answered: before, now: after }), false, 'the store moved on before the answer came');
});

test('SV2-52 item 11 (SV2-43 item 3): with no engine attached the first line says the routes cannot be worked out, and nothing older is drawn to be stale', () => {
  const project = clone(sample.project);
  const standing = model.standingOf(project, { project: null, results: null, failed: model.NO_ENGINE });
  assert.deepEqual(standing, { project, results: null, failed: 'Nothing is attached to work out the routes.', stale: false });
  assert.equal(model.failedSentence(standing).parts.map((part) => part.text).join(''), 'The routes could not be worked out: Nothing is attached to work out the routes.');
  assert.equal(model.failedSentence(standing).showMe, false);
});

// SV2-55 item 0: the stage's least, whatever the section has
test('SV2-55 item 0: the stage’s least is 120 px, or the floors’ box fitted across the stage when that is shorter, at the zoom’s own floor of 25 %', () => {
  assert.equal(STAGE_LEAST, 120);
  assert.equal(FIT_MARGIN, 20);
  // nothing laid out yet, or no width: the least itself
  assert.equal(stageLeast(null, 844), 120);
  assert.equal(stageLeast({ width: 40, height: 30 }, 0), 120);
  // a building as tall as it is wide: fitted across 844 px it is far taller than 120
  assert.equal(stageLeast({ width: 40, height: 40 }, 844), 120);
  // a long low building: fitted across 844 px (804 / (200 x 24) is under 25 %, so 25 %) it is 4 x 24 x 0.25 + 40 = 64 px,
  // under what the zoom needs, so 70 (SV2-57 item 3)
  assert.equal(stageLeast({ width: 200, height: 4 }, 844), 70);
  // 2 cells high at the full width's zoom: 804 / (40 x 24) = 0.8375, so 2 x 24 x 0.8375 + 40 = 80.2, rounded up
  assert.equal(stageLeast({ width: 40, height: 2 }, 844), 81);
  // the sample's three floors side by side at 844 px (the browser case's own figure)
  const floors = sample.project.building.floors;
  assert.equal(stageLeast(layoutFloors(floors, 'side'), 844), 120);
});

// SV2-57 item 3 (the review of SV2-55, probe.mjs): for a building one or a
// few rows high the floors' box at Fit was 46 to 64 px, under the zoom box
// with its margins, so the zoom lay over the whole map. The least is never
// under what the zoom needs: ZOOM_ROOM, or the need the view measured.
test('SV2-57 item 3: the stage’s least is never under what the zoom box needs, for a building one row high or four, at 844 and at 390 px', () => {
  assert.equal(ZOOM_ROOM, 70, 'the zoom’s need is its 44 px buttons, 2 px of border and 12 px of margin above and below');
  for (const [width, height] of [[200, 1], [200, 2], [200, 4], [60, 1], [3, 1], [1, 1]]) {
    // a floor that many rows high, with its name's rows over it
    const layout = { width, height: height + TITLE_ROWS };
    for (const across of [844, 390]) {
      assert.ok(stageLeast(layout, across) >= ZOOM_ROOM, width + ' by ' + height + ' at ' + across + ' px: ' + stageLeast(layout, across));
      // the need the view measures: under a mouse the buttons are 36 px, 62 in all
      assert.ok(stageLeast(layout, across, 62) >= 62, width + ' by ' + height + ' at ' + across + ' px under a mouse: ' + stageLeast(layout, across, 62));
    }
  }
  // the box fitted is enough where it is taller than the zoom and shorter than 120
  assert.equal(stageLeast({ width: 40, height: 2 }, 844, 62), 81);
  assert.equal(stageLeast({ width: 200, height: 3 }, 844, 62), 62, 'a measured need under ZOOM_ROOM is the floor, not ZOOM_ROOM');
  assert.equal(stageLeast({ width: 200, height: 3 }, 844, 76.4), 77, 'a measured need is rounded up');
  // and never more than the least itself, whatever is measured
  assert.equal(stageLeast({ width: 200, height: 3 }, 844, 500), STAGE_LEAST);
});

// SV2-55 item 6: the view's own asking (model.js's createAsker, which
// index.js makes once per visit), run with a store and a clock of the case's
// own, so a break in the code the view runs fails here and not only in a
// browser.
function askerRig(options) {
  const opts = options || {};
  const calls = { pending: 0, settled: [] };
  const timers = [];
  let gone = false;
  const store = { project: { id: 'p1' }, derived: opts.engine === false ? {} : null };
  let answer = null;
  const attach = () => {
    store.derived = {
      engine: {},
      results: () => new Promise((resolve, reject) => {
        answer = { resolve, reject };
      }),
    };
  };
  if (opts.engine !== false) attach();
  const asker = model.createAsker({
    store,
    graph: () => 'graph of ' + store.project.id,
    gone: () => gone,
    timers: {
      set(fn, ms) {
        timers.push({ fn, ms, cleared: false });
        return timers.length - 1;
      },
      clear(id) {
        timers[id].cleared = true;
      },
    },
    pending() {
      calls.pending += 1;
    },
    settled(failed, answered) {
      calls.settled.push([failed, answered]);
    },
  });
  // the timers set and not yet run or cleared
  const due = () => timers.filter((each) => !each.cleared && !each.ran);
  const tick = () => {
    const next = due()[0];
    next.ran = true;
    next.fn();
  };
  return { asker, store, calls, due, tick, attach, leave: () => { gone = true; }, answer: () => answer };
}
const turn = () => new Promise((resolve) => setImmediate(resolve));

test('SV2-55 item 6: the view asks once per state of the project, says it waits, and draws the answer for that state', async () => {
  const rig = askerRig();
  rig.asker.ask();
  rig.asker.ask();
  assert.equal(rig.calls.pending, 1, 'the same project was asked about twice');
  rig.answer().resolve('results 1');
  await turn();
  assert.deepEqual(rig.calls.settled, [[null, true]]);
  assert.equal(rig.asker.derived.results, 'results 1');
  assert.equal(rig.asker.derived.project, rig.store.project);
  assert.equal(rig.asker.derived.graph, 'graph of p1', 'the graph is not kept beside the answer it belongs to');
  // a failure keeps the last answer and says why
  rig.store.project = { id: 'p2' };
  rig.asker.ask();
  rig.answer().reject(new Error('the worker stopped'));
  await turn();
  assert.deepEqual(rig.calls.settled[1], ['the worker stopped', true]);
  assert.equal(rig.asker.derived.results, 'results 1', 'a failure threw the last answer away');
});

test('SV2-55 item 6: an answer that comes after the view has gone, or for a project the store has left, changes nothing', async () => {
  const gone = askerRig();
  gone.asker.ask();
  gone.leave();
  gone.answer().resolve('late results');
  await turn();
  assert.deepEqual(gone.calls.settled, [], 'an answer after the view had gone was drawn');
  assert.equal(gone.asker.derived.results, null);

  const left = askerRig();
  left.asker.ask();
  const first = left.answer();
  left.store.project = { id: 'p2' };
  first.resolve('results for p1');
  await turn();
  assert.deepEqual(left.calls.settled, [], 'an answer for a project the store has left was drawn');
  left.asker.ask();
  left.answer().resolve('results for p2');
  await turn();
  assert.deepEqual(left.calls.settled, [[null, true]]);
  assert.equal(left.asker.derived.results, 'results for p2');
});

test('SV2-55 item 6: with no engine the view says so and looks again every ENGINE_LOOK_MS; an engine attached later is asked about the project as it is then; leaving stops the looking', async () => {
  assert.equal(model.ENGINE_LOOK_MS, 1000);
  const rig = askerRig({ engine: false });
  rig.asker.ask();
  assert.equal(rig.asker.derived.failed, model.NO_ENGINE, 'the first line is not told that nothing is attached');
  assert.equal(rig.calls.pending, 0, 'something is awaited with nothing to ask');
  assert.deepEqual(rig.due().map((each) => each.ms), [1000], 'the view does not look again in a second');
  rig.asker.ask();
  assert.equal(rig.due().length, 1, 'asking again set a second look');
  // still nothing: another look is set
  rig.tick();
  assert.deepEqual(rig.due().map((each) => each.ms), [1000], 'the view stopped looking while nothing was attached');
  assert.deepEqual(rig.calls.settled, []);
  // attached, and the project has moved on meanwhile: the next look asks about the project now
  rig.attach();
  rig.store.project = { id: 'p3' };
  rig.tick();
  assert.equal(rig.calls.pending, 1, 'the engine attached later was not asked');
  assert.deepEqual(rig.calls.settled, [[null, false]], 'the view did not draw again when the engine came');
  assert.equal(rig.asker.derived.failed, null, 'the first line still says nothing is attached');
  assert.equal(rig.due().length, 0, 'the view goes on looking with an engine attached');
  rig.answer().resolve('results for p3');
  await turn();
  assert.equal(rig.asker.derived.project.id, 'p3');

  // leaving while it looks: the look is cleared, and a look that runs anyway does nothing
  const left = askerRig({ engine: false });
  left.asker.ask();
  assert.equal(left.asker.waiting, true);
  left.asker.stop();
  left.leave();
  assert.equal(left.asker.waiting, false);
  assert.equal(left.due().length, 0, 'the look was not cleared when the view left');
});

// What index.js hands createAsker (that the view has gone, what waiting
// and an answer do to the screen, that a change asks, that a failure is
// said) is held by behaviour in the real view: test/browser/movement.mjs,
// "SV2-57 item 2". A regex over index.js's source held it before, and five
// breaks of that wiring left it green (SV2-57 item 2).

// SV2-55 item 3 (reproduced by the Foreman in Node, keep.mjs): a stage under
// about 96 px could not hold 48 px of the floors at its top and its bottom at
// once, so the clamp sent the map one way and back on every event.
test('SV2-55 item 3: the keep is capped by the stage: a 30 px stage over a 60 px box settles at once and stays, with the box over the whole stage', () => {
  const view = { x: 0, y: -20, width: 400, height: 30, size: 6 };
  const box = { width: 40, height: 10 };
  const ys = [];
  for (let event = 0; event < 4; event += 1) {
    const { dx, dy } = keepShift(view, box, 48);
    view.x += dx;
    view.y += dy;
    ys.push(view.y);
  }
  assert.deepEqual(ys, [-20, -20, -20, -20], 'the pan went one way and back: ' + ys.join(', '));
  // a box pulled further off settles at the stage's own height and stays
  view.y = -200;
  const after = [];
  for (let event = 0; event < 3; event += 1) {
    const { dy } = keepShift(view, box, 48);
    view.y += dy;
    after.push(view.y);
  }
  assert.deepEqual(after, [-30, -30, -30]);
  // the box's foot is at the stage's foot: 30 px of it, the whole stage, on screen
  assert.equal(view.y + box.height * view.size, 30);
});

test('SV2-55 item 3: on a stage taller than the keep the keep is 48 px each way, or the whole box when it is smaller', () => {
  const view = { x: -1000, y: 900, width: 400, height: 300, size: 6 };
  const shift = keepShift(view, { width: 40, height: 10 }, 48);
  // 240 px across: its right edge comes to 48 px in; 60 px down: its top comes to 48 px from the foot
  assert.deepEqual(shift, { dx: 48 - (-1000 + 240), dy: 300 - 48 - 900 });
  const small = keepShift({ x: -100, y: 0, width: 400, height: 300, size: 1 }, { width: 20, height: 20 }, 48);
  assert.deepEqual(small, { dx: 100, dy: 0 }, 'a box under 48 px is not brought all onto the stage (to x 0)');
  assert.deepEqual(keepShift({ x: 0, y: 0, width: 0, height: 0, size: 1 }, { width: 20, height: 20 }, 48), { dx: 0, dy: 0 }, 'a stage not yet measured is moved');
});

// ---------------------------------------------------------------- bell schedules (SV2-79)

const ER = 'bsample0er';

// Early Release: half-hour periods with 3 minutes between, periods 5 to 8
// (indexes 4 to 7) not meeting.
function withEarlyRelease(off) {
  const project = school();
  const at = (minutes) => String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
  const bells = [];
  for (let p = 0; p < 8; p += 1) bells.push(off.includes(p) ? null : { start: at(480 + 33 * p), end: at(510 + 33 * p) });
  project.bellSchedules = [{ id: ER, name: 'Early Release', short: '', bells, off }];
  return project;
}

const early = derive(withEarlyRelease([4, 5, 6, 7]));

test('SV2-79: the strip under a bell schedule leaves out every transition into or out of a period that does not meet', () => {
  assert.deepEqual(transitionsOf(early.project, DAY_A, null).map((each) => each.period), [0, 1, 2, 3, 4, 5, 6], 'regular bells: all seven');
  assert.deepEqual(transitionsOf(early.project, DAY_A, ER).map((each) => each.period), [0, 1, 2], 'periods 5 to 8 do not meet: the walk out of period 4 is not one');
  const first = transitionsOf(early.project, DAY_A, ER)[0];
  assert.equal(first.times, '8:30 to 8:33', 'the schedule\'s own times');
  assert.equal(first.seconds, 180);
  assert.equal(transitionsOf(early.project, DAY_B, ER).length, 3, 'B Day has the same classes\' bells');
});

test('SV2-79: the strip says which periods do not meet, in the school\'s word', () => {
  const words = (off, word) => {
    const project = withEarlyRelease(off);
    if (word) project.settings.periodWord = word;
    return model.offWords(project, ER);
  };
  assert.equal(words([4, 5, 6, 7]), 'Periods 5 to 8 do not meet');
  assert.equal(words([7]), 'Period 8 does not meet');
  assert.equal(words([4, 5]), 'Periods 5 and 6 do not meet');
  assert.equal(words([1, 4, 5]), 'Periods 2, 5 and 6 do not meet');
  assert.equal(words([5, 6, 7], 'Block'), 'Blocks F to H do not meet');
  assert.equal(words([]), '', 'every period meets: nothing to say');
  assert.equal(model.offWords(early.project, null), '', 'regular bells: nothing to say');
});

test('SV2-79: a choice keeps a bell schedule that exists, drops one that does not, and drops a transition that no longer meets', () => {
  assert.equal(defaultChoice(early.project).bellsId, null);
  assert.equal(settleChoice(early.project, { bellsId: ER }).bellsId, ER);
  assert.equal(settleChoice(early.project, { bellsId: 'bgone' }).bellsId, null);
  assert.equal(settleChoice(sample.project, { bellsId: ER }).bellsId, null, 'a project with no bell schedules has only the regular bells');
  assert.equal(settleChoice(early.project, { bellsId: null, transition: 5 }).transition, 5);
  assert.equal(settleChoice(early.project, { bellsId: ER, transition: 5 }).transition, null, 'period 6 into 7 does not exist under Early Release');
  assert.equal(settleChoice(early.project, { bellsId: ER, transition: 2 }).transition, 2);
});

test('SV2-79: the picture under a bell schedule draws only the walks that happen, and no route that "failed" into a period that does not meet', () => {
  const regular = pictureOf(early.project, early.results, early.graph, defaultChoice(early.project));
  const shown = pictureOf(early.project, early.results, early.graph, { ...defaultChoice(early.project), bellsId: ER });
  assert.equal(regular.drawn, 56, 'the regular picture is what it was');
  assert.equal(regular.failed.length, 0);
  assert.equal(shown.bellsId, ER);
  assert.equal(shown.drawn + shown.same, 8 * 3, 'eight groups, three transitions that happen');
  assert.equal(shown.failed.length, 0, 'the walks out of an empty period are not failed routes');
  assert.deepEqual(shown.late.filter((walk) => walk.bellsId !== ER || walk.period > 2), [], 'the late walks are the bell run\'s own, none from a period that does not meet');
  assert.deepEqual(regular.late.map((walk) => walk.period), [5], 'while the regular run has its late walk');
  assert.equal(shown.transitions.length, 3);
  assert.equal(shown.offWords, 'Periods 5 to 8 do not meet');
  assert.equal(shown.dayTypeName, 'A Day with Early Release bells', 'every caption says the bells');
  assert.equal(words(sentenceOf(early.project, shown, routeHealth(early.project, early.results))), 'Showing 8 groups on A Day with Early Release bells, all transitions. No route failed.');
  const one = pictureOf(early.project, early.results, early.graph, { ...defaultChoice(early.project), bellsId: ER, transition: 1 });
  assert.equal(words(sentenceOf(early.project, one, [])), 'Showing 8 groups on A Day with Early Release bells, Period 2 to Period 3 (8:33 to 8:36). No route failed.'.replace('8:33 to 8:36', one.transition.times));
  assert.equal(one.transition.times, '9:03 to 9:06', 'the clock range is the schedule\'s');
});

test('SV2-79: markers under a bell schedule are the periods that meet', () => {
  const shown = pictureOf(early.project, early.results, early.graph, { ...defaultChoice(early.project), bellsId: ER });
  const periods = new Set();
  for (const list of shown.markers.values()) for (const marker of list) for (const pill of marker.pills) for (const p of pill.periods) periods.add(p);
  assert.deepEqual(Array.from(periods).sort(), [0, 1, 2, 3], 'nobody is in a room in a period that does not meet');
});

test('SV2-79: the legend\'s figures and the load under a bell schedule are that run\'s, and the regular run is unchanged by having one', () => {
  const plain = derive(school());
  const regularWith = pictureOf(early.project, early.results, early.graph, defaultChoice(early.project));
  const regularWithout = pictureOf(plain.project, plain.results, plain.graph, defaultChoice(plain.project));
  assert.equal(regularWith.load.max, regularWithout.load.max, 'the busiest load');
  assert.deepEqual(groupRows(early.project, early.results, regularWith).map((row) => [row.walking, row.waiting, row.late]), groupRows(plain.project, plain.results, regularWithout).map((row) => [row.walking, row.waiting, row.late]));
  const shown = pictureOf(early.project, early.results, early.graph, { ...defaultChoice(early.project), bellsId: ER });
  const rows = groupRows(early.project, early.results, shown);
  const crowd = early.results.crowd.bells.find((day) => day.dayTypeId === DAY_A && day.bellsId === ER);
  const expected = crowd.transitions.filter((transition) => transition.off !== true).flatMap((transition) => transition.groups).reduce((sum, walker) => sum + walker.walking, 0);
  assert.equal(rows.reduce((sum, row) => sum + row.walking, 0), expected, 'the walking is the bell run\'s, not the regular run\'s');
  assert.ok(rows.every((row) => row.walks === 3), 'three walks a group');
  assert.ok(shown.load.max > 0 && shown.load.source.bellsId === ER, 'the load is the bell run\'s');
});

test('SV2-79: a cell\'s card under a bell schedule counts only that run\'s walks', () => {
  const shown = pictureOf(early.project, early.results, early.graph, { ...defaultChoice(early.project), bellsId: ER });
  const floor = early.project.building.floors[0];
  let found = null;
  for (let cell = 0; cell < floor.width * floor.height && !found; cell += 1) {
    const card = cellCard(early.project, early.results, early.graph, shown, floor.id, cell);
    if (card && card.load > 0) found = card;
  }
  assert.ok(found, 'a busy cell has a card');
  assert.ok(found.groups.length > 0 && found.groups.every((each) => each.times <= 3), 'at most the three transitions that happen');
});

test('SV2-79: the travel tables, their heading and the CSV files are by run', async () => {
  const { travelDay, transitionRows, dayRows, transitionsCsv, dayCsv } = await import('../../ui/movement/tables.js');
  const follower = withEarlyRelease([4, 5, 6, 7]);
  follower.dayTypes[1].own = false;
  for (const each of follower.groups) delete each.days[DAY_B];
  assert.deepEqual(travelDay(follower, DAY_B), { id: DAY_A, name: 'B Day', heading: 'B Day (same as A Day)' }, 'regular bells: the shape is what it was');
  assert.deepEqual(travelDay(follower, DAY_B, ER), { id: DAY_A, bellsId: ER, name: 'B Day', heading: 'B Day (same as A Day) with Early Release bells' });
  assert.ok(transitionRows(early.project, early.results, DAY_A, 1, ER).rows.length > 0);
  assert.equal(transitionRows(early.project, early.results, DAY_A, 5, ER).rows.length, 0, 'no walk where a period does not meet');
  assert.ok(dayRows(early.project, early.results, DAY_A, ER).every((row) => row.walks === 3));
  const csv = transitionsCsv(early.project, early.results, DAY_A, ER);
  assert.equal(csv.length, 1 + 8 * 3, 'a header and every walk that happens');
  assert.equal(csv[1][0], 'A Day with Early Release bells');
  assert.equal(dayCsv(early.project, early.results, DAY_A, ER)[1][0], 'A Day with Early Release bells');
  assert.equal(transitionsCsv(early.project, early.results, DAY_A).length, 1 + 8 * 7, 'regular bells: all seven');
});
