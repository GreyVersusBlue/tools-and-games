// The ramp's own outline in the edit view (#1044). "Show it on the plan" drew
// a ring at a ramp's foot (#1003) and nothing of the ramp. The outline is the
// footprint the walker, the hole and the findings already read: a straight
// run and its top landing, or a folded ramp's lanes and decks. This states
// that it is those boxes in world feet, that a finding's mark carries it only
// when the design is handed over (the map's marks are unchanged), and that it
// follows the ramp's rotation.
// Run with: node --test test/ramp-outline.test.mjs  (from the project folder)

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  stairRun, rampOutline, footprintBox, topLandingBox, rampLayout, rectCorners,
} from '../js/stairs.js';
import { findingMarks, markOnFloor } from '../js/minimap.js';

const M = stairRun(12);
const ramp = (data = {}, over = {}) => ({
  id: 7, type: 'ramp', from: 0, to: 1, x: 40, z: 60, rotationY: 0, data, ...over,
});
const area = (pts) => Math.abs(pts.reduce((a, p, i) => {
  const q = pts[(i + 1) % pts.length];
  return a + p.x * q.z - q.x * p.z;
}, 0)) / 2;

test('a straight ramp is its run and its top landing, and nothing else', () => {
  const link = ramp();
  const out = rampOutline(link, M);
  assert.deepEqual(out.map((p) => p.kind), ['run', 'landing']);
  assert.deepEqual(out[0].pts, rectCorners(link, footprintBox(link, M)));
  assert.deepEqual(out[1].pts, rectCorners(link, topLandingBox(link, M)));
  assert.ok(out.every((p) => p.pts.length === 4));
  // 4 ft wide, 12 ft of rise at 1:12 is 144 ft of run, and a 5 ft deck.
  assert.ok(Math.abs(area(out[0].pts) - 4 * M.rise * 12) < 1e-6);
  assert.ok(Math.abs(area(out[1].pts) - 4 * 5) < 1e-6);
});

test('a folded ramp is every lane and every landing the layout holds', () => {
  const link = ramp({ runs: 3 });
  const layout = rampLayout(link, M);
  assert.ok(layout && layout.n === 3);
  const out = rampOutline(link, M);
  assert.equal(out.filter((p) => p.kind === 'run').length, layout.runs.length);
  assert.equal(out.filter((p) => p.kind === 'landing').length, layout.landings.length);
  layout.runs.forEach((r, i) => assert.deepEqual(out[i].pts, rectCorners(link, r.box)));
});

test('the outline turns with the ramp: the same area, the corners rotated about its foot', () => {
  const a = rampOutline(ramp(), M)[0].pts;
  const b = rampOutline(ramp({}, { rotationY: Math.PI / 2 }), M)[0].pts;
  assert.ok(Math.abs(area(a) - area(b)) < 1e-6);
  assert.notDeepEqual(a, b);
  // Every corner is as far from the foot as before.
  const far = (pts) => pts.map((p) => Math.hypot(p.x - 40, p.z - 60)).sort((x, y) => x - y);
  far(a).forEach((d, i) => assert.ok(Math.abs(d - far(b)[i]) < 1e-9));
});

test('anything that is not a ramp has no outline', () => {
  assert.deepEqual(rampOutline(ramp({}, { type: 'stair' }), M), []);
  assert.deepEqual(rampOutline(null, M), []);
});

const finding = (link) => ({
  level: 'warn', code: 'ramp-rise', title: 'rises',
  doors: [{ id: link.id, floor: link.from, x: link.x, z: link.z, w: 0 }],
});

test('a ramp finding carries the outline only when the design is handed over', () => {
  const link = ramp();
  const design = { links: [link], floorHt: 12, floors: [{}, {}] };
  const bare = findingMarks({ findings: [finding(link)] })[0];
  assert.deepEqual(bare.ramps, []);
  const full = findingMarks({ findings: [finding(link)] }, design)[0];
  assert.equal(full.ramps.length, 1);
  assert.equal(full.ramps[0].floor, 0);
  assert.equal(full.ramps[0].parts.length, 2);
  // Only on the ramp's own storey.
  assert.equal(markOnFloor(full, 0).ramps.length, 1);
  assert.equal(markOnFloor(full, 1).ramps.length, 0);
});

test('a doorway whose id happens to equal a ramp\'s is not a ramp, and a stair is not outlined', () => {
  const link = ramp();
  const stair = ramp({}, { type: 'stair', id: 9 });
  const design = { links: [link, stair], floorHt: 12, floors: [{}, {}] };
  const onOtherFloor = { level: 'warn', code: 'x', title: 'x', doors: [{ id: 7, floor: 1, x: 1, z: 1, w: 3 }] };
  assert.deepEqual(findingMarks({ findings: [onOtherFloor] }, design)[0].ramps, []);
  const stairFinding = { level: 'warn', code: 'x', title: 'x', doors: [{ id: 9, floor: 0, x: 1, z: 1, w: 0 }] };
  assert.deepEqual(findingMarks({ findings: [stairFinding] }, design)[0].ramps, []);
});
