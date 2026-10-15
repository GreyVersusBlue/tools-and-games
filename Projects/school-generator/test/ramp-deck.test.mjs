// A straight ramp's top landing is drawn (#981). Since #904 it is ADA's 5ft,
// walked on at the upper floor's height and cut out of that floor, and
// render.js drew nothing there: the walker crossed 5ft of open hole. The
// deck is `rampLandingBox` at the rise, the same box the walker, the hole and
// the `ramp-landing` finding read, so what is drawn is what is walked on.
//
// What Node can see of it is the box against the hole and the surface, for
// every width and slope the Stairs panel allows (#907), and the one line in
// render.js that draws it. Whether the deck is there in the scene is
// test/tools/run.mjs's `ramp-deck`, which drops a ray on it.
//
// Run with: node --test test/ramp-deck.test.mjs  (from the project folder)

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  stairRun, cutBox, stairSurfaceAt, rampLandingBox, runMetrics, rampLayout,
  RAMP_LANDING,
} from '../js/stairs.js';

const M = stairRun(12);
const ramp = (data = {}) => ({ id: 1, type: 'ramp', from: 0, to: 1, x: 0, z: 0, rotationY: 0, data });
const WIDTHS = Array.from({ length: 17 }, (_, i) => 4 + i / 2);   // 4 to 12ft in 6in
const SLOPES = [12, 13, 14, 15, 16, 17, 18, 19, 20];               // 1:12 to 1:20

test('the landing sits in the hole, at the run\'s top, walked at the rise, at every width and slope', () => {
  for (const width of WIDTHS) {
    for (const slope of SLOPES) {
      const link = ramp({ width, slope });
      const m = runMetrics(link, M);
      const land = rampLandingBox(link, M);
      const cut = cutBox(link, M);
      const at = `${width}ft at 1:${slope}`;
      assert.ok(land, `no landing box for ${at}`);
      assert.equal(land.z1 - land.z0, RAMP_LANDING, at);
      assert.equal(land.x1 - land.x0, width, at);
      assert.ok(Math.abs(land.z0 - m.run) < 1e-9, `${at}: the landing does not start at the run's top`);
      assert.ok(land.x0 >= cut.x0 && land.x1 <= cut.x1 && land.z0 >= cut.z0 && land.z1 <= cut.z1,
        `${at}: the landing is not inside the hole`);
      assert.equal(cut.z1, land.z1, `${at}: the hole runs past the landing`);
      for (const [fx, fz] of [[0.5, 0.05], [0.05, 0.5], [0.95, 0.95], [0.5, 0.5]]) {
        const x = land.x0 + (land.x1 - land.x0) * fx, z = land.z0 + (land.z1 - land.z0) * fz;
        assert.equal(stairSurfaceAt(link, M, x, z), M.rise, `${at}: (${x}, ${z}) is not walked at the rise`);
      }
      assert.ok(Math.abs(m.rise - M.rise) < 1e-9, at);
    }
  }
});

test('a folded ramp and a stair have no straight landing box', () => {
  assert.ok(rampLayout(ramp({ runs: 3 }), M));
  assert.equal(rampLandingBox(ramp({ runs: 3 }), M), null);
  assert.equal(rampLandingBox({ ...ramp(), type: 'stair' }, M), null);
});

// render.js cannot be imported in Node (it opens with three), so the line is
// read: the straight ramp's branch draws `rampLandingBox` as a level slab whose
// top is the rise, in the ramp's own colour, into the same geometry list.
test('render.js draws the straight ramp\'s landing from rampLandingBox at the rise', () => {
  const src = readFileSync(fileURLToPath(new URL('../js/render.js', import.meta.url)), 'utf8');
  const start = src.indexOf('const buildStairRun = (link) =>');
  const end = src.indexOf('} else {', start);
  assert.ok(start > 0 && end > start, 'buildStairRun\'s ramp branch not found');
  const branch = src.slice(start, end);
  assert.match(branch, /rampLandingBox\(link, metrics\)/, 'the ramp branch does not ask for its landing');
  assert.match(branch, /localBox\(link, land\.x1 - land\.x0, 0\.5, land\.z1 - land\.z0,[^;]*m\.rise - 0\.25[^;]*_tread, stairGeos\)/,
    'the landing is not drawn as a 0.5ft slab topped at the rise');
});
