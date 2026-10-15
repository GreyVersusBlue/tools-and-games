// A stair's top landing is drawn (#983). It is 4ft (`LANDING`), cut out of the
// floor above by `cutBox` and walked at the rise by `stairSurfaceAt`, and
// render.js drew the steps and stopped at the top one: the walker stepped off
// the stair onto 4ft of open hole, the gap #981 closed for a straight ramp.
// The deck is `topLandingBox`, the one box for both kinds of straight run,
// each at its own `topLanding` depth, drawn after either branch of
// `buildStairRun`.
//
// What Node can see is the box against the hole, the surface and the top step,
// and the line in render.js that draws it. Whether the deck is in the scene is
// test/tools/run.mjs's `ramp-deck`, which drops a ray on a stair's landing too.
//
// Run with: node --test test/stair-deck.test.mjs  (from the project folder)

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as stairs from '../js/stairs.js';

const { stairRun, cutBox, stairSurfaceAt, runMetrics, rampLandingBox, LANDING, RAMP_LANDING } = stairs;
const link = (type, data = {}) => ({ id: 1, type, from: 0, to: 1, x: 0, z: 0, rotationY: 0, data });
const WIDTHS = Array.from({ length: 19 }, (_, i) => 3 + i / 2);    // 3 to 12ft, a stair's range

test('a stair has a top landing box: 4ft past its top step, in the hole, walked at the rise', () => {
  assert.equal(typeof stairs.topLandingBox, 'function', 'stairs.js has no topLandingBox');
  for (const h of [10, 12, 14]) {
    const M = stairRun(h);
    for (const width of WIDTHS) {
      const st = link('stair', { width });
      const m = runMetrics(st, M);
      const land = stairs.topLandingBox(st, M);
      const cut = cutBox(st, M);
      const at = `${width}ft wide, ${h}ft storey`;
      assert.ok(land, `no landing box for ${at}`);
      assert.equal(land.z1 - land.z0, LANDING, at);
      assert.equal(land.x1 - land.x0, width, at);
      // The top step's tread ends at steps * tread, and the landing starts there.
      assert.ok(Math.abs(land.z0 - m.steps * m.tread) < 1e-9, `${at}: the landing does not start at the top step`);
      assert.ok(land.x0 >= cut.x0 && land.x1 <= cut.x1 && land.z0 >= cut.z0 && land.z1 <= cut.z1,
        `${at}: the landing is not inside the hole`);
      assert.equal(cut.z1, land.z1, `${at}: the hole runs past the landing`);
      for (const [fx, fz] of [[0.5, 0.05], [0.05, 0.5], [0.95, 0.95], [0.5, 0.5]]) {
        const x = land.x0 + (land.x1 - land.x0) * fx, z = land.z0 + (land.z1 - land.z0) * fz;
        assert.equal(stairSurfaceAt(st, M, x, z), M.rise, `${at}: (${x}, ${z}) is not walked at the rise`);
      }
    }
  }
});

test('a straight ramp\'s landing box is the same through either name; nothing else has one', () => {
  const M = stairRun(12);
  const r = link('ramp', { width: 6, slope: 16 });
  assert.deepEqual(stairs.topLandingBox(r, M), rampLandingBox(r, M));
  assert.equal(stairs.topLandingBox(r, M).z1 - stairs.topLandingBox(r, M).z0, RAMP_LANDING);
  // rampLandingBox stays the ramp's alone: clearance.js's `ramp-landing`
  // finding reads it, and a stair is not asked (#904).
  assert.equal(rampLandingBox(link('stair'), M), null);
  assert.equal(stairs.topLandingBox(link('ramp', { runs: 3 }), M), null, 'a folded ramp\'s landings are its layout\'s');
  assert.equal(stairs.topLandingBox(link('opening'), M), null);
  assert.equal(stairs.topLandingBox(link('elevator'), M), null);
  assert.equal(stairs.topLandingBox(null, M), null);
});

// render.js cannot be imported in Node (it opens with three), so the line is
// read: after the ramp and stair branches of `buildStairRun`, both draw
// `topLandingBox` as a level slab whose top is the rise, into the same list.
test('render.js draws a straight run\'s landing from topLandingBox at the rise, after both branches', () => {
  const src = readFileSync(fileURLToPath(new URL('../js/render.js', import.meta.url)), 'utf8');
  const start = src.indexOf('const buildStairRun = (link) =>');
  const stairBranch = src.indexOf('} else {', start);
  const rails = src.indexOf('// Handrails:', start);
  assert.ok(start > 0 && stairBranch > start && rails > stairBranch, 'buildStairRun not found');
  const tail = src.slice(stairBranch, rails);
  assert.match(tail, /topLandingBox\(link, metrics\)/, 'the landing is not asked for after the stair branch');
  assert.match(tail, /localBox\(link, land\.x1 - land\.x0, 0\.5, land\.z1 - land\.z0,[^;]*m\.rise - 0\.25[^;]*_tread, stairGeos\)/,
    'the landing is not drawn as a 0.5ft slab topped at the rise');
  assert.doesNotMatch(src.slice(start, stairBranch), /LandingBox\(/, 'the ramp branch still draws its own landing: it would be drawn twice');
});
