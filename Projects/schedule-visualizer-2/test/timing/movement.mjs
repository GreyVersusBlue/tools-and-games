// Timing: what the movement view does on the main thread once the engine
// has answered, at the size the tool promises to stay responsive at (the
// fixture in test/fixtures/big.mjs: 4 floors of 60 by 40, 150 rooms, 80
// groups, 10 periods, two own day types).
//
//   the picture of every group over the whole day, with its lanes
//   (pictureOf, which calls buildLanes): budget 300 ms, cold
//   the card of one corridor cell under the pointer (cellCard): budget 5 ms
//   a card, as a pointer moving along the corridors gets them
//   one tick of the hotspot pulse (createPulse's frame, drawn by
//   pulseFrame): budget 16 ms, a frame of the screen (SV2-47)
//
// The card's budget is held on the first card of the process, on the median
// of 200 corridor cells after it, and on the card of the busiest cell again.
// The first card used to cost 11 to 27 ms against 3 ms for every card after
// it, because contributors() in engine/load.js walked every route of the day
// for one cell; it now reads an index of routes by node that the picture
// works out as it is made (indexRoutes, inside pictureOf's own budget), so
// the first card is a card like any other.
//
// The pulse's tick is measured with a context that counts what it is asked
// to draw, since painting needs a browser. What that holds is the shape of
// the cost: a tick draws one arc for each ring, a handful on any building,
// and reads nothing of the map (test/browser/hotspots.mjs holds the other
// half in a page: the map's own canvas is not drawn again while the rings
// pulse). The ranking the rings come from is worked out once a picture and is
// printed, not part of a tick.
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
import { hotspotRows, createPulse, pulseFrame, PULSE_TOP, PULSE_MS, PULSE_TIMES } from '../../ui/movement/hotspots.js';
import { bigProject, BIG } from '../fixtures/big.mjs';

const PICTURE_BUDGET = 300;
const CARD_BUDGET = 5;
const TICK_BUDGET = 16;
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
  console.log('# movement picture, again: ' + warm.ms.toFixed(1) + ' ms; buildLanes timed by itself on the same routes: ' + lanes.ms.toFixed(1) + ' ms; four chosen groups (their load counted again): ' + some.ms.toFixed(1) + ' ms');

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

test('the card of one corridor cell of the big fixture: under 5 ms, the first card of the page among them', () => {
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
  console.log('# cell card, the busiest cell: ' + again.ms.toFixed(2) + ' ms; the first card of the process: ' + cold.ms.toFixed(2) + ' ms (budget ' + CARD_BUDGET + ', fails at ' + CARD_BUDGET * SLACK + '); ' + cold.value.groups.length + ' groups cross it, ' + cold.value.load + ' ' + cold.value.unit);

  assert.equal(cold.value.load, picture.load.max);
  assert.ok(cold.value.groups.length > 10, 'the cell is really crossed: ' + cold.value.groups.length + ' groups');
  assert.ok(cells.length >= 100);
  assert.deepEqual(again.value, cold.value, 'the second card of a cell says what the first did');
  assert.ok(median < CARD_BUDGET * SLACK, 'a card takes ' + median.toFixed(2) + ' ms at the median, over ' + CARD_BUDGET * SLACK);
  assert.ok(again.ms < CARD_BUDGET * SLACK, 'the card of the busiest cell took ' + again.ms.toFixed(2) + ' ms, over ' + CARD_BUDGET * SLACK);
  assert.ok(cold.ms < CARD_BUDGET * SLACK, 'the first card of the process took ' + cold.ms.toFixed(2) + ' ms, over ' + CARD_BUDGET * SLACK);
});

test('one tick of the hotspot pulse on the big fixture: under 16 ms, and it draws the rings alone', () => {
  const project = bigProject({ seed: 1 });
  const { graph, results } = answered(project);
  const picture = pictureOf(project, results, graph, defaultChoice(project));
  // the ranking: once a picture, kept, and never a tick's work
  const ranked = timed(() => hotspotRows(project, results, graph, picture));
  const rows = ranked.value;
  const again = timed(() => hotspotRows(project, results, graph, picture));
  assert.equal(again.value, rows, 'the ranking is kept for the picture');
  assert.ok(rows.length > 10, 'the fixture has places to rank: ' + rows.length);

  // the rings the map would carry: the busiest cell of each top place, both ends of a stairs connection
  const rings = [];
  for (const row of rows.slice(0, PULSE_TOP)) {
    const busiest = row.cells.find((cell) => !cell.excluded);
    for (const end of row.place.kind === 'connection' ? row.ends : busiest ? [busiest] : []) {
      const floor = project.building.floors.find((each) => each.id === end.floorId);
      rings.push({ rank: row.rank, x: (end.cell % floor.width) * 24 + 12, y: Math.floor(end.cell / floor.width) * 24 + 12, r: 22 });
    }
  }
  assert.ok(rings.length >= PULSE_TOP && rings.length <= PULSE_TOP * 2, rings.length + ' rings');

  // a context that counts what it is asked for
  let calls = 0;
  const g = new Proxy({}, { get: (target, name) => (name in target ? target[name] : () => { calls += 1; }), set: (target, name, value) => { target[name] = value; return true; } });
  let now = 0;
  let next = null;
  const each = [];
  const asked = [];
  const pulse = createPulse({
    now: () => now,
    later: (fn) => { next = fn; return 1; },
    cancel: () => { next = null; },
    still: () => false,
    frame(left) {
      const before = calls;
      each.push(timed(() => pulseFrame(g, rings, left, { accent: '#0f6e66' })).ms);
      asked.push(calls - before);
    },
    done() {},
  });
  pulse.start();
  while (next) {
    const tick = next;
    next = null;
    now += 60;
    tick();
  }
  each.sort((a, b) => a - b);
  const median = each[Math.floor(each.length / 2)];
  const worst = each[each.length - 1];
  console.log('# hotspot pulse, ' + each.length + ' ticks of ' + rings.length + ' rings: median ' + median.toFixed(3) + ' ms (budget ' + TICK_BUDGET + ', fails at ' + TICK_BUDGET * SLACK + '), worst ' + worst.toFixed(3) + ' ms; ' + asked[0] + ' drawing calls a tick; the ranking they come from, once a picture: ' + ranked.ms.toFixed(1) + ' ms, then ' + again.ms.toFixed(3) + ' ms');

  assert.equal(each.length, (PULSE_MS * PULSE_TIMES) / 60, 'a tick every 60 ms until the pulses are done');
  assert.ok(asked.every((count) => count === rings.length * 3), 'a tick asks for one arc a ring and nothing more: ' + asked[0] + ' calls for ' + rings.length + ' rings');
  assert.ok(median < TICK_BUDGET * SLACK, 'a tick takes ' + median.toFixed(3) + ' ms at the median, over ' + TICK_BUDGET * SLACK);
  assert.ok(worst < TICK_BUDGET * SLACK, 'the slowest tick took ' + worst.toFixed(3) + ' ms, over ' + TICK_BUDGET * SLACK);
});
