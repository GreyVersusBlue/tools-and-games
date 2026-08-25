// The structural shadow: what an upper storey stands on, and what it doesn't.
// Everything here is at 4ft lattice resolution on purpose (see shadow.js), so
// the fixtures are built in whole cells.

import test from 'node:test';
import assert from 'node:assert/strict';

import { CELL, createState, setTile, addFloor } from '../js/grid.js';
import { addShape } from '../js/shapes.js';
import { buildSampleSchool } from '../js/sample.js';
import {
  CELL_AREA, OVERHANG_WARN,
  floorBounds, unionBounds, footprintMask, cellSupported, pointSupported,
  areaSupported, floorOverhang, buildingOverhang,
} from '../js/shadow.js';

function twoStorey(lower, upper) {
  const s = createState(20, 20);
  for (const [x, y] of lower) setTile(s.floors[0], x, y, true);
  addFloor(s);
  for (const [x, y] of upper) setTile(s.floors[1], x, y, true);
  return s;
}

const rect = (x0, y0, x1, y1) => {
  const out = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y]);
  return out;
};

test('an empty floor has no bounds and an empty mask', () => {
  const s = createState(10, 10);
  assert.equal(floorBounds(s.floors[0]), null);
  assert.equal(footprintMask(s.floors[0]).count, 0);
});

test('bounds cover the cells that are on, and nothing else', () => {
  const s = twoStorey(rect(3, 4, 6, 8), []);
  const b = floorBounds(s.floors[0]);
  assert.deepEqual({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 }, { x0: 3, y0: 4, x1: 6, y1: 8 });
  assert.equal(b.w, 4);
  assert.equal(b.h, 5);
});

test('a polygon room outside the lattice still counts as footprint', () => {
  // Polygon rooms are unbounded by the grid on purpose, and a mask that
  // stopped at the lattice would call a whole wing unsupported.
  const s = createState(10, 10);
  addShape(s, 0, [
    { x: 200, z: 200 }, { x: 240, z: 200 }, { x: 240, z: 240 }, { x: 200, z: 240 },
  ], { name: 'Far Wing' });
  const b = floorBounds(s.floors[0]);
  assert.ok(b.x1 >= 200 / CELL - 1, 'bounds should reach the polygon');
  const mask = footprintMask(s.floors[0], b);
  assert.ok(mask.at(52, 52), 'a cell in the middle of the polygon should be set');
  assert.ok(!mask.at(70, 70), 'a cell well outside it should not be');
});

test('unionBounds tolerates a missing side', () => {
  const a = { x0: 0, y0: 0, x1: 3, y1: 3, w: 4, h: 4 };
  const b = { x0: 2, y0: -1, x1: 5, y1: 2, w: 4, h: 4 };
  assert.equal(unionBounds(a, null), a);
  assert.equal(unionBounds(null, b), b);
  const u = unionBounds(a, b);
  assert.deepEqual({ x0: u.x0, y0: u.y0, x1: u.x1, y1: u.y1 }, { x0: 0, y0: -1, x1: 5, y1: 3 });
});

test('the ground floor is always supported — it stands on the ground', () => {
  const s = twoStorey(rect(2, 2, 4, 4), []);
  assert.equal(cellSupported(s, 0, 99, 99), true);
  assert.equal(pointSupported(s, 0, -500, -500), true);
  assert.equal(areaSupported(s, 0, 900, 900, 40, 40), true);
});

test('a cell over a cell is supported; a cell over nothing is not', () => {
  const s = twoStorey(rect(2, 2, 5, 5), rect(2, 2, 7, 5));
  assert.equal(cellSupported(s, 1, 3, 3), true);
  assert.equal(cellSupported(s, 1, 6, 3), false);
  assert.equal(pointSupported(s, 1, 3.5 * CELL, 3.5 * CELL), true);
  assert.equal(pointSupported(s, 1, 6.5 * CELL, 3.5 * CELL), false);
});

test('a polygon on the storey below supports the storey above', () => {
  const s = createState(20, 20);
  addShape(s, 0, [
    { x: 40, z: 40 }, { x: 80, z: 40 }, { x: 80, z: 80 }, { x: 40, z: 80 },
  ], { name: 'Wing' });
  addFloor(s);
  setTile(s.floors[1], 12, 12, true);   // inside the polygon
  setTile(s.floors[1], 3, 3, true);     // outside it
  assert.equal(cellSupported(s, 1, 12, 12), true);
  assert.equal(cellSupported(s, 1, 3, 3), false);
  const r = floorOverhang(s, 1);
  assert.equal(r.count, 1);
  assert.equal(r.area, CELL_AREA);
});

test('areaSupported wants every corner, not just the middle', () => {
  const s = twoStorey(rect(2, 2, 5, 5), []);
  const mid = 4 * CELL;   // the middle of the supported patch
  assert.equal(areaSupported(s, 1, mid, mid, 4, 4), true);
  // A room wide enough to reach past the edge of what is underneath.
  assert.equal(areaSupported(s, 1, mid, mid, 40, 40), false);
});

test('an overhang is counted in cells and in square feet', () => {
  const s = twoStorey(rect(2, 2, 5, 5), rect(2, 2, 7, 5));
  const r = floorOverhang(s, 1);
  assert.equal(r.count, 8);                 // two columns of four
  assert.equal(r.area, 8 * CELL_AREA);
  assert.equal(r.footprint, 24 * CELL_AREA);
  assert.ok(Math.abs(r.ratio - 8 / 24) < 1e-9);
  assert.equal(r.cells.length, 8);
  assert.ok(r.cells.every((c) => c.x >= 6));
});

test('the cell list truncates rather than growing without bound', () => {
  const s = twoStorey(rect(0, 0, 1, 1), rect(0, 0, 19, 19));
  const r = floorOverhang(s, 1, { limit: 5 });
  assert.equal(r.cells.length, 5);
  assert.equal(r.truncated, true);
  assert.ok(r.count > 5, 'the count is the real number, not the capped one');
});

test('a storey inside the one below reports nothing at all', () => {
  const s = twoStorey(rect(2, 2, 9, 9), rect(3, 3, 8, 8));
  const r = floorOverhang(s, 1);
  assert.equal(r.count, 0);
  assert.equal(r.ratio, 0);
});

test('the sample school stacks cleanly, and one stray cell says so', () => {
  const s = buildSampleSchool();
  const clean = buildingOverhang(s);
  assert.equal(clean.cells, 0);
  assert.equal(clean.findings[0].level, 'ok');

  setTile(s.floors[1], 2, 2, true);
  setTile(s.floors[1], 3, 2, true);
  setTile(s.floors[1], 2, 3, true);
  const dirty = buildingOverhang(s);
  assert.equal(dirty.cells, 3);
  assert.equal(dirty.area, 3 * CELL_AREA);
  assert.equal(dirty.findings[0].level, 'note', 'a small cantilever is a note, not a warning');
  assert.match(dirty.findings[0].title, /stands on nothing/);
});

test('a large share of unsupported storey escalates to a warning', () => {
  const s = twoStorey(rect(2, 2, 3, 3), rect(2, 2, 15, 15));
  const r = buildingOverhang(s);
  assert.equal(r.findings[0].level, 'warn');
  assert.ok(r.worst.ratio > OVERHANG_WARN);
  assert.match(r.findings[0].detail, /second building/);
});

test('a single-storey building has nothing to say either way', () => {
  const s = createState(10, 10);
  setTile(s.floors[0], 2, 2, true);
  const r = buildingOverhang(s);
  assert.equal(r.floors.length, 0);
  assert.equal(r.findings.length, 0);
});

test('a floor with no storey under it at all is entirely unsupported', () => {
  const s = createState(10, 10);
  addFloor(s);
  setTile(s.floors[1], 4, 4, true);
  const r = floorOverhang(s, 1);
  assert.equal(r.count, 1);
  assert.equal(r.ratio, 1);
});
