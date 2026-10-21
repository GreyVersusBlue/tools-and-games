// The plan map's setView (SV2-31b, SV2-31c): presentation mode puts a
// reader's zoom and place back through it. Its rule is viewAt in
// ui/surface/plan-map.js, which setView calls: the zoom clamped to 25 % to
// 300 % as viewport.restore clamps a saved one, the place kept on the stage
// (keepOnStage), and a zoom or place that is not a finite number refused,
// with the view not touched. In plain Node, on a viewport and the sample
// school's floors laid out as the map lays them.
//
//   node test/ui/set-view.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { viewAt, keepOnStage, KEEP_ON_STAGE } from '../../ui/surface/plan-map.js';
import { layoutFloors } from '../../ui/surface/plan-layout.js';
import { createViewport, CELL, MIN_ZOOM, MAX_ZOOM } from '../../ui/surface/viewport.js';
import { sampleSchool } from '../../data/sample-school.js';

const world = layoutFloors(sampleSchool().building.floors, 'stacked');

function stage() {
  const view = createViewport();
  view.resize(900, 700);
  view.zoom = 1;
  view.x = 20;
  view.y = 30;
  return view;
}
const where = (view) => ({ zoom: view.zoom, x: view.x, y: view.y });

// How much of the floors' box is on a 900 by 700 stage, each way, in px.
function onStage(view) {
  const size = CELL * view.zoom;
  const across = Math.min(view.width, view.x + world.width * size) - Math.max(0, view.x);
  const down = Math.min(view.height, view.y + world.height * size) - Math.max(0, view.y);
  return { across, down };
}

test('a zoom and place inside the limits and on the stage are taken as given', () => {
  const view = stage();
  assert.equal(viewAt(view, world, { zoom: 1.5625, x: -120.25, y: 44 }), true);
  assert.deepEqual(where(view), { zoom: 1.5625, x: -120.25, y: 44 });
});

test('the zoom is clamped to 25 % to 300 %, as viewport.restore clamps a saved one', () => {
  for (const [asked, kept] of [[10, MAX_ZOOM], [3.0001, MAX_ZOOM], [0.01, MIN_ZOOM], [0.2499, MIN_ZOOM], [Number.MIN_VALUE, MIN_ZOOM]]) {
    const view = stage();
    assert.equal(viewAt(view, world, { zoom: asked, x: 20, y: 30 }), true, String(asked));
    assert.equal(view.zoom, kept, 'a zoom of ' + asked + ' is not clamped to ' + kept);
    // the same as the viewport's own restore
    const restored = stage();
    restored.restore({ zoom: asked, x: 20, y: 30 });
    assert.equal(view.zoom, restored.zoom);
  }
});

test('a zoom or place that is no number is refused, and the view is not touched', () => {
  const refused = [
    { zoom: Infinity, x: 0, y: 0 },
    { zoom: -Infinity, x: 0, y: 0 },
    { zoom: Number.NaN, x: 0, y: 0 },
    { zoom: 0, x: 0, y: 0 },
    { zoom: -1, x: 0, y: 0 },
    { zoom: 1, x: Infinity, y: 0 },
    { zoom: 1, x: 0, y: -Infinity },
    { zoom: 1, x: Number.NaN, y: 0 },
    { zoom: 1, x: 0, y: Number.NaN },
    { zoom: '1', x: 0, y: 0 },
    { zoom: 1, x: '0', y: 0 },
    { zoom: 1, x: 0 },
    { zoom: 1, y: 0 },
    { x: 0, y: 0 },
    {},
    null,
    undefined,
  ];
  for (const asked of refused) {
    const view = stage();
    assert.equal(viewAt(view, world, asked), false, JSON.stringify(asked) + ' was taken');
    assert.deepEqual(where(view), { zoom: 1, x: 20, y: 30 }, JSON.stringify(asked) + ' moved the view');
  }
});

test('with no floors laid out yet nothing is set', () => {
  const view = stage();
  assert.equal(viewAt(view, null, { zoom: 2, x: 0, y: 0 }), false);
  assert.deepEqual(where(view), { zoom: 1, x: 20, y: 30 });
});

test('a place off the stage is brought back as keepOnStage brings a pan: KEEP_ON_STAGE px of the floors stay on it each way', () => {
  for (const asked of [{ zoom: 1, x: -1e6, y: 30 }, { zoom: 1, x: 1e6, y: 30 }, { zoom: 2, x: 20, y: -1e6 }, { zoom: 0.5, x: 1e6, y: 1e6 }]) {
    const view = stage();
    assert.equal(viewAt(view, world, asked), true);
    const seen = onStage(view);
    assert.ok(seen.across >= KEEP_ON_STAGE - 1e-9 && seen.down >= KEEP_ON_STAGE - 1e-9, JSON.stringify(asked) + ' leaves ' + JSON.stringify(seen) + ' of the floors on the stage');
    // what keepOnStage itself makes of the same place, after the same clamp
    const kept = stage();
    kept.restore(asked);
    keepOnStage(kept, world);
    assert.deepEqual(where(view), where(kept));
  }
});
