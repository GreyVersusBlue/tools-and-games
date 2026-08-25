// Roofs and facades. Run `node --test test/*.mjs` from
// Projects/school-generator.
//
// A roof is arithmetic over a footprint, so it's checked as arithmetic: a
// rectangle's outline has four corners and the perimeter it should, a hip's
// ridge is exactly half the short span in from each end, a 4:12 pitch rises
// one foot for every three of half-span, the rectangles a mask decomposes into
// cover it exactly once, and an eave hangs only where the building actually
// stops. Those are the things a transposed axis or an off-by-one in the mask
// breaks first.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, setTile, CELL, WALL_H, addFloor } from '../js/grid.js';
import { addShape } from '../js/shapes.js';
import { FACADE_MATERIALS, FACADE_KEYS, DEFAULT_FACADE, facadeEntry, readFacade } from '../js/finish.js';
import {
  PARAPET_H, EAVE, MIN_PITCH, MAX_PITCH, DEFAULT_PITCH, DEFAULT_ROOF,
  ROOF_STYLES, ROOF_STYLE_KEYS, roofStyleEntry, isPitched,
  normalizeRoof, defaultRoof, isDefaultRoof,
  roofMask, maskAt, maskCount, maskOutlines, largestRect, maskRects,
  sideIsOuter, blockRoof, roofPlan, roofTop,
} from '../js/roof.js';

const near = (a, b, eps, msg) =>
  assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b} (±${eps})`);

// A rectangular building `wc` x `hc` cells at the grid origin.
function box(wc, hc, grid = 30) {
  const s = createState(grid, grid);
  for (let y = 0; y < hc; y++) for (let x = 0; x < wc; x++) setTile(s.floors[0], x, y, true);
  return s;
}

const perimeter = (loop) => {
  let p = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    p += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return p;
};

// ---------- the record ----------

test('a roof survives anything a file can hand it', () => {
  assert.deepEqual(normalizeRoof(null), DEFAULT_ROOF);
  assert.deepEqual(normalizeRoof('nonsense'), DEFAULT_ROOF);
  const r = normalizeRoof({ style: 'thatch', pitch: 900, facade: 'x'.repeat(99) });
  assert.equal(r.style, DEFAULT_ROOF.style, 'an unknown style falls back');
  assert.equal(r.pitch, MAX_PITCH, 'and a mad pitch is clamped');
  assert.equal(r.facade.length, 24);
  assert.equal(normalizeRoof({ pitch: 1 }).pitch, MIN_PITCH);
});

test('the default roof is not written to the save file', () => {
  assert.equal(isDefaultRoof(defaultRoof()), true);
  assert.equal(isDefaultRoof(null), true, 'no roof record is the default roof');
  assert.equal(isDefaultRoof({ ...DEFAULT_ROOF, style: 'gable' }), false);
});

test('every style is either pitched or it is not, and every facade is real', () => {
  for (const s of ROOF_STYLES) assert.equal(typeof s.pitched, 'boolean');
  assert.equal(isPitched('gable'), true);
  assert.equal(isPitched('parapet'), false);
  assert.equal(roofStyleEntry('nope').key, 'parapet');
  assert.equal(new Set(FACADE_KEYS).size, FACADE_MATERIALS.length);
  for (const f of FACADE_MATERIALS) assert.match(f.color, /^#[0-9a-f]{6}$/i);
  assert.equal(readFacade('brick'), 'brick');
  assert.equal(readFacade('gold'), null);
  assert.equal(facadeEntry('gold').key, DEFAULT_FACADE);
});

// ---------- the mask ----------

test('a rectangular building masks a rectangle', () => {
  const s = box(10, 6);
  const m = roofMask(s.floors[0], s.w, s.h);
  assert.equal(maskCount(m), 60);
  assert.equal(maskAt(m, 0, 0), 1);
  assert.equal(maskAt(m, 9, 5), 1);
  assert.equal(maskAt(m, 10, 0), 0);
  assert.equal(maskAt(m, -1, 0), 0, 'and off the edge is off');
});

test('a polygon wing outside the grid is still under the roof', () => {
  const s = createState(10, 10);
  addShape(s, 0, [
    { x: -60, z: -60 }, { x: -20, z: -60 }, { x: -20, z: -20 }, { x: -60, z: -20 },
  ]);
  const m = roofMask(s.floors[0], s.w, s.h);
  assert.ok(m.cx0 <= -15, 'the mask starts west of the grid');
  assert.ok(maskCount(m) >= 90, 'and covers the wing');
  // The wing's own middle is masked.
  const c = Math.floor(-40 / CELL) - m.cx0, r = Math.floor(-40 / CELL) - m.cy0;
  assert.equal(maskAt(m, c, r), 1);
});

// ---------- the outline ----------

test('a rectangular footprint outlines as one loop of four corners', () => {
  const s = box(10, 6);
  const loops = maskOutlines(roofMask(s.floors[0], s.w, s.h));
  assert.equal(loops.length, 1);
  assert.equal(loops[0].length, 4, 'collinear runs are merged');
  near(perimeter(loops[0]), 2 * (40 + 24), 1e-9, 'and it is the building\'s perimeter');
});

test('an L-shaped footprint outlines as one loop of six corners', () => {
  const s = createState(20, 20);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 10; x++) setTile(s.floors[0], x, y, true);
  for (let y = 8; y < 14; y++) for (let x = 0; x < 4; x++) setTile(s.floors[0], x, y, true);
  const loops = maskOutlines(roofMask(s.floors[0], s.w, s.h));
  assert.equal(loops.length, 1);
  assert.equal(loops[0].length, 6);
});

test('a courtyard is a second loop', () => {
  const s = createState(20, 20);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) setTile(s.floors[0], x, y, true);
  for (let y = 3; y < 7; y++) for (let x = 3; x < 7; x++) setTile(s.floors[0], x, y, false);
  const loops = maskOutlines(roofMask(s.floors[0], s.w, s.h));
  assert.equal(loops.length, 2, 'the outside and the hole');
  const perims = loops.map(perimeter).sort((a, b) => a - b);
  near(perims[0], 4 * 16, 1e-9, 'the courtyard');
  near(perims[1], 4 * 40, 1e-9, 'and the building around it');
});

test('two detached wings outline as two loops', () => {
  const s = createState(30, 20);
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) setTile(s.floors[0], x, y, true);
  for (let y = 0; y < 5; y++) for (let x = 15; x < 20; x++) setTile(s.floors[0], x, y, true);
  assert.equal(maskOutlines(roofMask(s.floors[0], s.w, s.h)).length, 2);
});

test('an empty storey has no outline at all', () => {
  const s = createState(10, 10);
  assert.deepEqual(maskOutlines(roofMask(s.floors[0], s.w, s.h)), []);
});

// ---------- rectangles ----------

test('the largest rectangle in a solid mask is the whole thing', () => {
  const s = box(10, 6);
  const m = roofMask(s.floors[0], s.w, s.h);
  const r = largestRect(m.on, m.w, m.h);
  assert.equal(r.area, 60);
  assert.deepEqual([r.c0, r.r0, r.c1, r.r1], [0, 0, 10, 6]);
});

test('the rectangles cover every masked cell exactly once', () => {
  const s = createState(20, 20);
  // A plus sign: the hardest small shape for a greedy decomposition.
  for (let y = 4; y < 12; y++) for (let x = 0; x < 16; x++) setTile(s.floors[0], x, y, true);
  for (let y = 0; y < 16; y++) for (let x = 5; x < 11; x++) setTile(s.floors[0], x, y, true);
  const m = roofMask(s.floors[0], s.w, s.h);
  const seen = new Uint8Array(m.w * m.h);
  for (const rect of maskRects(m)) {
    for (let r = rect.r0; r < rect.r1; r++) {
      for (let c = rect.c0; c < rect.c1; c++) {
        assert.equal(maskAt(m, c, r), 1, `rect covers an unmasked cell at ${c},${r}`);
        assert.equal(seen[r * m.w + c], 0, `rect overlaps another at ${c},${r}`);
        seen[r * m.w + c] = 1;
      }
    }
  }
  let count = 0;
  for (let i = 0; i < seen.length; i++) count += seen[i];
  assert.equal(count, maskCount(m), 'and nothing is left uncovered');
});

test('rectangles come out biggest first', () => {
  const s = createState(20, 20);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) setTile(s.floors[0], x, y, true);
  for (let y = 10; y < 12; y++) for (let x = 0; x < 3; x++) setTile(s.floors[0], x, y, true);
  const rects = maskRects(roofMask(s.floors[0], s.w, s.h));
  const area = (r) => (r.c1 - r.c0) * (r.r1 - r.r0);
  for (let i = 1; i < rects.length; i++) {
    assert.ok(area(rects[i]) <= area(rects[i - 1]), 'descending');
  }
});

test('an eave hangs where the building ends and nowhere else', () => {
  const s = createState(20, 20);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 10; x++) setTile(s.floors[0], x, y, true);
  for (let y = 8; y < 14; y++) for (let x = 0; x < 4; x++) setTile(s.floors[0], x, y, true);
  const m = roofMask(s.floors[0], s.w, s.h);
  const big = { c0: 0, r0: 0, c1: 10, r1: 8 };
  assert.equal(sideIsOuter(m, big, 'n'), true, 'the north side is outside');
  assert.equal(sideIsOuter(m, big, 'e'), true);
  assert.equal(sideIsOuter(m, big, 's'), false, 'the south side meets the other wing');
});

// ---------- one block's roof ----------

test('a hip ridge is half the short span in from each end', () => {
  // 60 x 30, so the ridge is 15ft in at both ends and 30ft long.
  const b = blockRoof(0, 0, 60, 30, 10, DEFAULT_PITCH, 'hip');
  assert.equal(b.alongX, true);
  near(b.ridge.a.x, 15, 1e-9, 'ridge starts');
  near(b.ridge.b.x, 45, 1e-9, 'ridge ends');
  near(b.ridge.a.z, 15, 1e-9, 'and runs down the middle');
  assert.equal(b.faces.length, 4, 'two slopes and two hips');
});

test('a gable ridge runs the whole length and closes its ends with wall', () => {
  const b = blockRoof(0, 0, 60, 30, 10, DEFAULT_PITCH, 'gable');
  near(b.ridge.a.x, 0, 1e-9);
  near(b.ridge.b.x, 60, 1e-9);
  assert.equal(b.faces.length, 2, 'just the two slopes');
  assert.equal(b.gables.length, 2, 'plus two gable walls');
  for (const g of b.gables) assert.equal(g.pts.length, 3, 'each a triangle');
});

test('the ridge runs along the longer side, whichever that is', () => {
  assert.equal(blockRoof(0, 0, 60, 30, 10, 4, 'hip').alongX, true);
  const tall = blockRoof(0, 0, 30, 60, 10, 4, 'hip');
  assert.equal(tall.alongX, false);
  near(tall.ridge.a.x, 15, 1e-9, 'and the ridge runs down z');
  near(tall.ridge.a.z, 15, 1e-9);
  near(tall.ridge.b.z, 45, 1e-9);
});

test('a 4:12 pitch rises a third of the half-span', () => {
  const b = blockRoof(0, 0, 60, 30, 10, 4, 'gable');
  near(b.rise, (4 / 12) * 15, 1e-9);
  near(b.topY, 10 + 5, 1e-9);
  const steep = blockRoof(0, 0, 60, 30, 10, 12, 'gable');
  near(steep.rise, 15, 1e-9, 'and 12:12 rises the whole half-span');
});

test('a square block hips to a pyramid rather than to nothing', () => {
  const b = blockRoof(0, 0, 40, 40, 10, 6, 'hip');
  near(b.ridge.a.x, b.ridge.b.x, 1e-9, 'the ridge is a point');
  near(b.ridge.a.z, b.ridge.b.z, 1e-9);
  near(b.rise, 10, 1e-9);
  assert.equal(b.faces.length, 4, 'four planes meeting at an apex');
});

test('every roof face keeps its feet on the eave line', () => {
  for (const style of ['hip', 'gable']) {
    const b = blockRoof(0, 0, 80, 44, 22, 5, style);
    for (const f of b.faces.concat(b.gables)) {
      const low = Math.min(...f.pts.map((p) => p.y));
      near(low, 22, 1e-9, `${style} face sits on the eave`);
      assert.ok(Math.max(...f.pts.map((p) => p.y)) <= b.topY + 1e-9, 'and none of it is above the ridge');
    }
  }
});

// ---------- the plan ----------

test('a flat roof is what every earlier version drew: nothing', () => {
  const s = box(10, 6);
  const plan = roofPlan(s, { style: 'flat' });
  assert.deepEqual(plan.outlines, []);
  assert.deepEqual(plan.blocks, []);
  assert.equal(plan.rise, 0);
  near(plan.eaveY, WALL_H, 1e-9);
  near(roofTop(plan), WALL_H, 1e-9);
});

test('a parapet is the outline and three feet', () => {
  const s = box(10, 6);
  const plan = roofPlan(s, { style: 'parapet' });
  assert.equal(plan.outlines.length, 1);
  assert.equal(plan.blocks.length, 0, 'a parapet has no pitched mass');
  assert.ok(plan.rise >= PARAPET_H);
  assert.equal(plan.parapetH, PARAPET_H);
});

test('a pitched roof over a rectangle is one block, overhanging on all four sides', () => {
  const s = box(10, 6);
  const plan = roofPlan(s, { style: 'hip', pitch: 4 });
  assert.equal(plan.blocks.length, 1);
  const xs = plan.blocks[0].faces.flatMap((f) => f.pts.map((p) => p.x));
  near(Math.min(...xs), -EAVE, 1e-9, 'hangs past the west wall');
  near(Math.max(...xs), 40 + EAVE, 1e-9, 'and past the east one');
});

test('the roof sits on the top storey, not on the ground one', () => {
  const s = box(10, 6);
  addFloor(s, 1);
  for (let y = 0; y < 6; y++) for (let x = 0; x < 10; x++) setTile(s.floors[1], x, y, true);
  const plan = roofPlan(s, { style: 'gable' });
  near(plan.eaveY, s.floorHt + WALL_H, 1e-9);
  assert.ok(roofTop(plan) > plan.eaveY, 'and stands above it');
});

test('an L-shaped school is roofed as two masses that meet', () => {
  const s = createState(20, 20);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 12; x++) setTile(s.floors[0], x, y, true);
  for (let y = 8; y < 16; y++) for (let x = 0; x < 5; x++) setTile(s.floors[0], x, y, true);
  const plan = roofPlan(s, { style: 'hip', pitch: 5 });
  assert.equal(plan.blocks.length, 2);
  // The joint between them gets no eave — it is inside the building.
  const wing = plan.blocks.find((b) => b.rect.r0 >= 8);
  const zs = wing.faces.flatMap((f) => f.pts.map((p) => p.z));
  near(Math.min(...zs), 8 * CELL, 1e-9, 'the wing starts flush at the joint');
  near(Math.max(...zs), 16 * CELL + EAVE, 1e-9, 'and overhangs at the far end');
});

test('an empty building has a roof plan and nothing in it', () => {
  const s = createState(10, 10);
  const plan = roofPlan(s, { style: 'gable' });
  assert.deepEqual(plan.blocks, []);
  assert.deepEqual(plan.outlines, []);
});

test('roofPlan reads the state\'s own roof when none is passed', () => {
  const s = box(8, 8);
  s.roof = { style: 'gable', pitch: 9, facade: 'panel' };
  const plan = roofPlan(s);
  assert.equal(plan.style, 'gable');
  assert.equal(plan.pitch, 9);
  assert.equal(plan.facade, 'panel');
  assert.equal(roofPlan(box(8, 8)).style, DEFAULT_ROOF.style, 'and the default otherwise');
});
