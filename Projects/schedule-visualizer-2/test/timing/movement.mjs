// Timing: what the movement view does on the main thread once the engine
// has answered, at the size the tool promises to stay responsive at (the
// fixture in test/fixtures/big.mjs: 4 floors of 60 by 40, 150 rooms, 80
// groups, 10 periods, two own day types).
//
//   the picture of every group over the whole day, with its lanes
//   (pictureOf, which calls buildLanes): budget 300 ms, cold
//   the card of one corridor cell under the pointer (cellCard): budget 5 ms
//   a card, as a pointer moving along the corridors gets them
//
// The card's budget is held on the median of 200 corridor cells, not on the
// first card of the process. The first one is printed and not asserted: it
// measures 11 to 12 ms here against 3 ms for every card after it, because
// contributors() in engine/load.js has not run before on this thread (in the
// page the loads come from the worker, so the first hover is as cold as
// this). A page pays that once. The card of the busiest cell, once warm, is
// asserted too, since it is the cell most groups cross.
//
// The routes, the crowd model, the loads and the places are worked out first
// and are not in the measure (routing.mjs, crowd.mjs and pipeline.mjs have
// their budgets). Nothing here needs a page: pictureOf, buildLanes and
// cellCard touch no DOM. Painting the canvas is not in the measure either;
// it needs a browser. The suite fails at twice the budget, to leave room for
// a slow runner, and prints the measured number either way. The clock is
// read here, in the test.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../../engine/graph.js';
import { routesForSchedule, routingGraph } from '../../engine/routing.js';
import { simulateSchedule, walkResults } from '../../engine/crowd.js';
import { loads } from '../../engine/load.js';
import { places } from '../../engine/places.js';
import { ownDayTypes } from '../../engine/day-types.js';
import { buildLanes } from '../../ui/surface/overlays/lanes.js';
import { defaultChoice, pictureOf, cellCard } from '../../ui/movement/model.js';
import { bigProject, BIG } from '../fixtures/big.mjs';

const PICTURE_BUDGET = 300;
const CARD_BUDGET = 5;
const SLACK = 2;

function timed(run) {
  const started = performance.now();
  const value = run();
  return { ms: performance.now() - started, value };
}

// What store.derived.results() gives the view, from the engines themselves.
function answered(project) {
  const graph = buildGraph(project);
  const routing = routingGraph(project, graph);
  const routes = routesForSchedule(project, routing);
  const crowd = simulateSchedule(project, routes, routing);
  const results = {
    routes,
    crowd,
    loads: ownDayTypes(project).map((dayType) => loads(project, routes, dayType.id, routing)),
    places: places(project, routing),
    walks: walkResults(project, crowd, routing),
  };
  return { graph, results };
}

test('the movement picture of the big fixture, every group over the whole day: under 300 ms cold', () => {
  const project = bigProject({ seed: 1 });
  const { graph, results } = answered(project);
  // the first picture in this process: nothing has been warmed up
  const cold = timed(() => pictureOf(project, results, graph, defaultChoice(project)));
  const picture = cold.value;
  const entries = [];
  const rank = new Map(project.groups.map((group, index) => [group.id, index]));
  for (const entry of results.routes.days[0].groups) {
    for (const route of entry.routes) if (route && route.ok === true && route.same !== true) entries.push({ groupId: entry.groupId, rank: rank.get(entry.groupId), route });
  }
  const lanes = timed(() => buildLanes(project, entries));
  const warm = timed(() => pictureOf(project, results, graph, defaultChoice(project)));
  const some = timed(() => pictureOf(project, results, graph, { ...defaultChoice(project), who: 'groups', groupIds: project.groups.slice(0, 4).map((group) => group.id) }));
  let points = 0;
  for (const list of picture.lanes.floors.values()) for (const lane of list) points += lane.points.length / 2;
  console.log('# movement picture, cold: ' + cold.ms.toFixed(1) + ' ms (budget ' + PICTURE_BUDGET + ', fails at ' + PICTURE_BUDGET * SLACK + '): ' + picture.drawn + ' routes of ' + picture.groups.length + ' groups on ' + picture.floors.length + ' floors, ' + points + ' lane points, the fullest stretch ' + picture.lanes.most + ' lanes');
  console.log('# movement picture, again: ' + warm.ms.toFixed(1) + ' ms; of that buildLanes alone: ' + lanes.ms.toFixed(1) + ' ms; four chosen groups (their load counted again): ' + some.ms.toFixed(1) + ' ms');

  assert.equal(picture.groups.length, BIG.groups);
  assert.equal(picture.floors.length, BIG.floors);
  assert.equal(picture.mode, 'load');
  assert.ok(picture.drawn > 500, 'the fixture really walks: ' + picture.drawn + ' routes drawn');
  assert.equal(entries.length, picture.drawn, 'the lanes timed alone are the picture\'s');
  assert.equal(picture.bands.size, BIG.floors);
  assert.ok(picture.load.max > 0 && picture.busiest !== null);
  assert.equal(lanes.value.most, picture.lanes.most);
  assert.equal(some.value.groups.length, 4);
  assert.ok(cold.ms < PICTURE_BUDGET * SLACK, 'the picture took ' + cold.ms.toFixed(1) + ' ms, over ' + PICTURE_BUDGET * SLACK);
  assert.ok(some.ms < PICTURE_BUDGET * SLACK, 'the picture of four groups took ' + some.ms.toFixed(1) + ' ms, over ' + PICTURE_BUDGET * SLACK);
});

test('the card of one corridor cell of the big fixture: under 5 ms once the first has been shown', () => {
  const project = bigProject({ seed: 1 });
  const { graph, results } = answered(project);
  const picture = pictureOf(project, results, graph, defaultChoice(project));
  const { floorId, cell } = picture.busiest;
  assert.ok(floorId && Number.isInteger(cell), 'the busiest place of the fixture is a cell');
  // the first card in this process, of the cell most groups cross
  const cold = timed(() => cellCard(project, results, graph, picture, floorId, cell));
  // then cards along that floor's corridors, as a pointer moving gives them
  const floor = project.building.floors.find((each) => each.id === floorId);
  const cells = [];
  for (let at = 0; at < floor.cells.length && cells.length < 200; at += 1) if (floor.cells[at] === '#') cells.push(at);
  const each = cells.map((at) => timed(() => cellCard(project, results, graph, picture, floorId, at)).ms).sort((a, b) => a - b);
  const median = each[Math.floor(each.length / 2)];
  const worst = each[each.length - 1];
  const again = timed(() => cellCard(project, results, graph, picture, floorId, cell));
  console.log('# cell card, ' + cells.length + ' corridor cells: median ' + median.toFixed(2) + ' ms (budget ' + CARD_BUDGET + ', fails at ' + CARD_BUDGET * SLACK + '), worst ' + worst.toFixed(2) + ' ms');
  console.log('# cell card, the busiest cell: ' + again.ms.toFixed(2) + ' ms; the first card of the process, not asserted: ' + cold.ms.toFixed(2) + ' ms; ' + cold.value.groups.length + ' groups cross it, ' + cold.value.load + ' ' + cold.value.unit);

  assert.equal(cold.value.load, picture.load.max);
  assert.ok(cold.value.groups.length > 10, 'the cell is really crossed: ' + cold.value.groups.length + ' groups');
  assert.ok(cells.length >= 100);
  assert.deepEqual(again.value, cold.value, 'the second card of a cell says what the first did');
  assert.ok(median < CARD_BUDGET * SLACK, 'a card takes ' + median.toFixed(2) + ' ms at the median, over ' + CARD_BUDGET * SLACK);
  assert.ok(again.ms < CARD_BUDGET * SLACK, 'the card of the busiest cell took ' + again.ms.toFixed(2) + ' ms, over ' + CARD_BUDGET * SLACK);
});
