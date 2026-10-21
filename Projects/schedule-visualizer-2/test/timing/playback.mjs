// Timing: one frame of playback at the size the tool promises to stay
// responsive at (the fixture in test/fixtures/big.mjs: 4 floors of 60 by 40,
// 150 rooms, 80 groups, 10 periods).
//
//   one frame: the markers of every group that walks in a transition, put on
//   their layer at one second (markersMark's entry: where each head is, its
//   trail, its marker): budget 16 ms, a frame at 60 a second
//
// A frame of playback draws the markers' own layer and nothing else
// (ui/movement/playback.js): the map under it is not painted again, which
// test/browser/playback.mjs holds in a page. So what a frame costs is the
// work measured here, with every group on screen, in the style that draws
// most (the whole route behind each marker) and in the other. The canvas is
// a stand-in that takes every call and draws nothing: filling pixels needs a
// browser and is not in the measure, as in movement.mjs.
//
// The budget is held on the median of the frames of one transition played
// through at a frame a second, and on the worst of them, the first frame of
// the process among them (it is printed by itself too: nothing has been
// warmed up before it). The
// routes and the crowd model are worked out first and are not in the measure
// (routing.mjs and crowd.mjs have their budgets). The suite fails at twice
// the budget, to leave room for a slow runner, and prints the measured
// numbers either way. The clock is read here, in the test.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../../engine/graph.js';
import { routesForSchedule, routingGraph } from '../../engine/routing.js';
import { simulateSchedule, routePath } from '../../engine/crowd.js';
import { markersMark, trackOf } from '../../ui/surface/overlays/markers.js';
import { bigProject, BIG } from '../fixtures/big.mjs';

const FRAME_BUDGET = 16;
const SLACK = 2;
const CELL = 12;

function timed(run) {
  const started = performance.now();
  const value = run();
  return { ms: performance.now() - started, value };
}

// A canvas context that takes every call and every setting, and counts the calls.
function standIn() {
  const kept = { calls: 0 };
  return new Proxy(kept, {
    get(target, name) {
      if (name in target) return target[name];
      return () => {
        target.calls += 1;
      };
    },
    set(target, name, value) {
      target[name] = value;
      return true;
    },
  });
}

test('one frame of playback on the big fixture, every group’s marker: under 16 ms', () => {
  const project = bigProject({ seed: 1 });
  const routing = routingGraph(project, buildGraph(project));
  const routes = routesForSchedule(project, routing);
  const crowd = simulateSchedule(project, routes, routing);
  const day = crowd.days[0];
  const routesDay = routes.days.find((each) => each.dayTypeId === day.dayTypeId);

  // the transition in which most groups walk
  let period = 0;
  day.transitions.forEach((transition, at) => {
    if (transition.groups.length > day.transitions[period].groups.length) period = at;
  });
  const transition = day.transitions[period];
  const walkers = [];
  for (const group of project.groups) {
    const walker = transition.groups.find((each) => each.groupId === group.id);
    const entry = routesDay.groups.find((each) => each.groupId === group.id);
    const route = entry ? entry.routes[period] : null;
    const track = walker ? trackOf(routing, route, routePath(routing, route)) : null;
    if (!track) continue;
    walkers.push({ groupId: group.id, colour: group.colour, track, positions: walker.positions, late: walker.late });
  }
  assert.ok(walkers.length >= BIG.groups / 2, 'the fixture really walks: ' + walkers.length + ' of ' + BIG.groups + ' groups in the transition');

  // every floor on the map, side by side, a cell 12 pixels
  const column = new Map(project.building.floors.map((floor, index) => [floor.id, index]));
  const width = project.building.floors[0].width;
  const map = {
    view: { size: CELL },
    theme: { card: '#ffffff', ink: '#111111', ink2: '#444444', problem: '#aa0000', corridor: '#ffffff' },
    point: (floorId, cell) => ({ x: (column.get(floorId) * (width + 2) + (cell % width) + 0.5) * CELL, y: (Math.floor(cell / width) + 0.5) * CELL }),
  };

  const measures = {};
  let first = null;
  for (const style of ['route', 'tail']) {
    let seconds = 0;
    const mark = markersMark(() => ({ step: routing.secondsPerCell, style, size: 'large', walkers: walkers.map((walker) => ({ ...walker, seconds })) }));
    const g = standIn();
    const each = [];
    let most = 0;
    let walking = 0;
    for (seconds = 0; seconds <= transition.seconds; seconds += 1) {
      const frame = timed(() => mark(g, map));
      if (first === null) first = frame.ms;
      each.push(frame.ms);
      most = Math.max(most, mark.drawn.size);
      walking = Math.max(walking, Array.from(mark.drawn.values()).filter((marker) => marker.state === 'walking' || marker.state === 'stairs').length);
    }
    assert.equal(most, walkers.length, 'every group that walks has a marker');
    assert.ok(walking >= walkers.length / 2, 'and most are on their way at once: ' + walking);
    assert.ok(g.calls > each.length * walkers.length, 'the markers were drawn: ' + g.calls + ' calls on the canvas');
    each.sort((a, b) => a - b);
    measures[style] = { median: each[Math.floor(each.length / 2)], worst: each[each.length - 1], frames: each.length };
  }
  for (const [style, measure] of Object.entries(measures)) {
    console.log('# playback frame, ' + walkers.length + ' markers, ' + (style === 'route' ? 'the whole route behind' : 'a fading tail') + ': median ' + measure.median.toFixed(2) + ' ms, worst ' + measure.worst.toFixed(2) + ' ms over ' + measure.frames + ' frames (budget ' + FRAME_BUDGET + ', fails at ' + FRAME_BUDGET * SLACK + ')');
  }
  console.log('# playback frame, the first of the process: ' + first.toFixed(2) + ' ms');
  for (const [style, measure] of Object.entries(measures)) {
    assert.ok(measure.median < FRAME_BUDGET * SLACK, 'a frame (' + style + ') takes ' + measure.median.toFixed(2) + ' ms at the median, over ' + FRAME_BUDGET * SLACK);
    assert.ok(measure.worst < FRAME_BUDGET * SLACK, 'the slowest frame (' + style + ') took ' + measure.worst.toFixed(2) + ' ms, over ' + FRAME_BUDGET * SLACK);
  }
});
