// Wall thickness, derived rather than stored. Run `node --test` from
// Projects/school-generator.
//
// The whole point of walls.js is that nobody ever says how thick a wall is —
// so every test here is really the same test: build a plan, ask, and check the
// answer changed because the *plan* changed.

import test from 'node:test';
import assert from 'node:assert/strict';

import { CELL, WALL_T_INT, WALL_T_EXT, createState } from '../js/grid.js';
import { CELL as CELL_FT } from '../js/grid.js';
import { slabOn } from './build.mjs';
import { addShape, SEG_WALL } from '../js/shapes.js';
import {
  solidBeside, isExteriorSeg, segThickness, wallProbe, fixedProbe,
} from '../js/walls.js';

// A block of floor from (x0, y0) to (x1, y1) inclusive, painted and baked.
function tiles(state, x0, y0, x1, y1, floor = 0) {
  slabOn(state, floor, [x0, y0, x1, y1]);
  return state.floors[floor];
}

// A lattice edge as the segment the probe wants — the one thing the lattice
// still says about a boundary, kept here because these tests are *about*
// boundaries on the 4ft grid. `horizontal` runs along +X between two rows.
const gridEdgeSeg = (x, y, horizontal, cell = CELL_FT) => (horizontal
  ? { ax: x * cell, az: y * cell, bx: (x + 1) * cell, bz: y * cell }
  : { ax: x * cell, az: y * cell, bx: x * cell, bz: (y + 1) * cell });

test('a wall with rooms on both sides is a partition; one with air is not', () => {
  const s = createState(12, 12);
  // Two rows of cells with the lattice line at y = 2 between them.
  const f = tiles(s, 1, 1, 6, 2);
  const shared = gridEdgeSeg(3, 2, true);           // between the two rows
  const outer = gridEdgeSeg(3, 1, true);            // the north face of the block

  assert.equal(segThickness(f, shared.ax, shared.az, shared.bx, shared.bz), WALL_T_INT);
  assert.equal(segThickness(f, outer.ax, outer.az, outer.bx, outer.bz), WALL_T_EXT);
  assert.equal(isExteriorSeg(f, outer.ax, outer.az, outer.bx, outer.bz), true);
  assert.equal(isExteriorSeg(f, shared.ax, shared.az, shared.bx, shared.bz), false);
});

test('the same wall becomes interior when a room is built behind it', () => {
  const s = createState(12, 12);
  const f = tiles(s, 1, 1, 6, 1);
  const north = gridEdgeSeg(3, 1, true);
  const ask = () => segThickness(f, north.ax, north.az, north.bx, north.bz);

  assert.equal(ask(), WALL_T_EXT, 'nothing on the far side yet');
  tiles(s, 1, 0, 6, 0);
  assert.equal(ask(), WALL_T_INT, 'and now there is — with no field to update');
});

test('a free-drawn room counts as floor on either side, same as a painted one', () => {
  const s = createState(20, 20);
  const f = s.floors[0];
  addShape(s, 0, [
    { x: 20, z: 20 }, { x: 40, z: 20 }, { x: 40, z: 40 }, { x: 20, z: 40 },
  ], { wall: SEG_WALL });
  // The room's own west wall, x = 20, with nothing to the west of it.
  assert.equal(segThickness(f, 20, 24, 20, 36), WALL_T_EXT);
  assert.equal(solidBeside(f, 20, 24, 20, 36, -1), true, 'the room itself is on one side');
  assert.equal(solidBeside(f, 20, 24, 20, 36, 1), false, 'and the car park on the other');

  // Butt a second room up against it and the shared wall becomes a partition.
  addShape(s, 0, [
    { x: 4, z: 20 }, { x: 20, z: 20 }, { x: 20, z: 40 }, { x: 4, z: 40 },
  ], { wall: SEG_WALL });
  assert.equal(segThickness(f, 20, 24, 20, 36), WALL_T_INT);
});

test('a free-standing wall with nothing either side reads as exterior', () => {
  const s = createState(12, 12);
  const f = s.floors[0];
  // A garden wall out on the site, no floor anywhere near it.
  assert.equal(segThickness(f, 4, 40, 20, 40), WALL_T_EXT);
});

test('the probe caches per boundary and answers the same thing', () => {
  const s = createState(12, 12);
  const f = tiles(s, 1, 1, 6, 2);
  const probe = wallProbe(f);
  const seg = gridEdgeSeg(3, 2, true);
  const a = probe(seg.ax, seg.az, seg.bx, seg.bz);
  const b = probe(seg.ax, seg.az, seg.bx, seg.bz);
  assert.equal(a, b);
  assert.equal(a, WALL_T_INT);
  assert.equal(probe.cache.size, 1, 'asked twice, probed once');
  assert.equal(probe.exterior(seg.ax, seg.az, seg.bx, seg.bz), false);
  // Reading it backwards is the same boundary and must not be a second entry.
  probe(seg.bx, seg.bz, seg.ax, seg.az);
  assert.ok(probe.cache.size <= 2);
});

test('a fixed probe is a probe, for callers that want one thickness', () => {
  const p = fixedProbe(WALL_T_EXT);
  assert.equal(p(0, 0, 4, 0), WALL_T_EXT);
  assert.equal(p.exterior(0, 0, 4, 0), true);
});

test('an exterior wall is thicker than an interior one, and both are walls', () => {
  assert.ok(WALL_T_EXT > WALL_T_INT);
  assert.ok(WALL_T_INT > 0.25, 'thin enough to be a partition, thick enough to be built');
  assert.ok(WALL_T_EXT < CELL / 2, 'and never so thick it eats the room');
});
