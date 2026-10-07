// One height for a curtain wall (#897): the storey's wall height, read from
// `wallHeightOf` by the daylight, the takeoff, the estimate, the elevation and
// the section alike. Before this, `daylight.js` took a curtain wall as the 10 ft
// ceiling on every storey while the others took 12 ft on a storey with one
// above it. Rooms whose glass can be counted by hand, then the sample school.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, addFloor, WALL_H, wallHeightOf } from '../js/grid.js';
import {
  addShape, addOpening, setSegWall, openingSpec, OP_WINDOW, SEG_GLASS, WINDOW_H,
} from '../js/shapes.js';
import { daylightOnFloor, daylightAnalysis, DEPTH_LIMIT } from '../js/daylight.js';
import { floorTakeoff } from '../js/takeoff.js';
import { quantities } from '../js/cost.js';
import { computeElevation, computeSection } from '../js/elevation.js';
import { buildSampleSchool } from '../js/sample.js';

const near = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg || ''}: ${a} is not within ${tol} of ${b}`);
const rect = (x0, z0, x1, z1) =>
  [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
const named = (rows, name) => rows.find((r) => r.name === name);
const polyY = (poly) => [Math.min(...poly.map((p) => p.y)), Math.max(...poly.map((p) => p.y))];

// Two storeys, `floorHt` floor to floor, each one 40 by 20 room with its north
// wall on z = 0. `north` is called with each room to put glass on that wall.
function stack(floorHt, north = () => {}) {
  const s = createState(30, 30);
  s.floorHt = floorHt;
  assert.equal(addFloor(s, 1), 1);
  const rooms = [0, 1].map((i) => {
    const shape = addShape(s, i, rect(0, 0, 40, 20), { name: `Room ${i + 1}01` });
    north(shape, i);
    return shape;
  });
  return { s, rooms };
}

test('a curtain wall is as high as its storey in the daylight, the takeoff and the estimate', () => {
  for (const floorHt of [8, 10, 12, 14, 18]) {
    const { s } = stack(floorHt, (shape) => setSegWall(shape, 0, 0, SEG_GLASS));
    // The lower storey's wall runs floor to floor; the top one stops at the
    // ceiling plane. Stated here by hand, not read back from `wallHeightOf`.
    const high = [floorHt, WALL_H];
    for (const i of [0, 1]) {
      assert.equal(wallHeightOf(s, i), high[i], `storey ${i} at ${floorHt} ft`);
      const lit = named(daylightOnFloor(s, i), `Room ${i + 1}01`).glazed;
      assert.equal(lit, 40 * high[i], `daylight, storey ${i} at ${floorHt} ft`);
      assert.equal(floorTakeoff(s, i).glazing, lit, `takeoff, storey ${i} at ${floorHt} ft`);
    }
    // The estimate prices the two storeys' exterior glass as one line.
    assert.equal(quantities(s).all.get('glazing'), 40 * (floorHt + WALL_H), `estimate at ${floorHt} ft`);
  }
});

test('a window cut in a curtain wall leaves the rest at the storey height', () => {
  // 40 ft of glass on a 14 ft storey with one 6 by 4 window cut in it: 34 ft
  // of curtain wall at 14 ft and the window's own 24 ft².
  const { s, rooms } = stack(14, (shape, i) => {
    setSegWall(shape, 0, 0, SEG_GLASS);
    if (i === 0) assert.ok(addOpening(shape, 0, 0, 0.5, 6, { k: OP_WINDOW }));
  });
  const row = named(daylightOnFloor(s, 0), 'Room 101');
  assert.equal(row.glazed, 34 * 14 + 6 * WINDOW_H);
  assert.equal(floorTakeoff(s, 0).glazing, row.glazed);
  // A doorway comes off at the storey height too.
  assert.ok(addOpening(rooms[0], 0, 0, 0.2, 3));
  assert.equal(named(daylightOnFloor(s, 0), 'Room 101').glazed, 31 * 14 + 6 * WINDOW_H);
  assert.equal(floorTakeoff(s, 0).glazing, 31 * 14 + 6 * WINDOW_H);
});

test('the elevation and the section draw that window in a wall 14 ft high', () => {
  const { s, rooms } = stack(14, (shape, i) => {
    setSegWall(shape, 0, 0, SEG_GLASS);
    if (i === 0) assert.ok(addOpening(shape, 0, 0, 0.5, 6, { k: OP_WINDOW }));
  });
  const spec = openingSpec(rooms[0].rings[0].openings[0]);
  assert.deepEqual([spec.sill, spec.head], [3, 7]);

  const north = computeElevation(s, 'north');
  const face = north.paints.find((p) => p.kind === 'wall' && p.storey === 0);
  assert.deepEqual(polyY(face.poly), [0, 14], 'the face the glass stands in');
  const windows = north.paints.filter((p) => p.kind === 'window');
  assert.equal(windows.length, 1);
  assert.deepEqual(polyY(windows[0].poly), [3, 7], 'sill and head, off the ground');

  // A cut down the middle slices the window: wall under the sill and over the
  // head, up to the storey's 14 ft, and neither band is glass.
  const through = computeSection(s, { id: 1, name: 'A', ax: 20, az: -5, bx: 20, bz: 10 });
  const bands = through.cuts.map((c) => polyY(c.poly)).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(bands, [[0, 3], [7, 14], [14, 14 + WALL_H]]);
  assert.deepEqual(through.cuts.map((c) => c.glass).sort(), [false, false, true],
    'only the storey above, which has no window, is cut as glass');
  // Five feet along, the plane slices plain curtain wall on both storeys.
  const beside = computeSection(s, { id: 2, name: 'B', ax: 5, az: -5, bx: 5, bz: 10 });
  assert.deepEqual(beside.cuts.map((c) => polyY(c.poly)).sort((a, b) => a[0] - b[0]),
    [[0, 14], [14, 14 + WALL_H]]);
  assert.ok(beside.cuts.every((c) => c.glass));
  // A doorway is a hole in the glass: what is left over its head is glass.
  assert.ok(addOpening(rooms[0], 0, 0, 0.2, 3));
  const door = computeSection(s, { id: 3, name: 'C', ax: 8, az: -5, bx: 8, bz: 10 });
  const over = door.cuts.find((c) => polyY(c.poly)[0] === 7);
  assert.deepEqual(polyY(over.poly), [7, 14]);
  assert.equal(over.glass, true);
});

test('glass between two rooms is borrowed at the storey height, by both', () => {
  const { s } = stack(14);
  const next = addShape(s, 0, rect(0, -20, 40, 0), { name: 'Room 102' });
  assert.equal(next.name, 'Room 102');
  setSegWall(s.floors[0].shapes.find((sh) => sh.name === 'Room 101'), 0, 0, SEG_GLASS);
  const rows = daylightOnFloor(s, 0);
  assert.equal(named(rows, 'Room 101').borrowed, 40 * 14);
  assert.equal(named(rows, 'Room 102').borrowed, 40 * 14);
  assert.equal(named(rows, 'Room 101').glazed, 0);
  assert.equal(floorTakeoff(s, 0).glazing, 40 * 14, 'and bought once');
});

test('a curtain wall that runs past a neighbour is cut there at the storey height', () => {
  // The neighbour stands against x 10 to 30 of the 40 ft of glass: 20 ft is
  // open, in two stretches, and 20 ft is borrowed, all of it 14 ft high.
  const { s } = stack(14, (shape, i) => { if (i === 0) setSegWall(shape, 0, 0, SEG_GLASS); });
  addShape(s, 0, rect(10, -20, 30, 0), { name: 'Room 102' });
  const rows = daylightOnFloor(s, 0);
  assert.equal(named(rows, 'Room 101').glazed, 20 * 14);
  assert.equal(named(rows, 'Room 101').borrowed, 20 * 14);
  assert.equal(named(rows, 'Room 102').borrowed, 20 * 14);
  assert.equal(floorTakeoff(s, 0).glazing, 40 * 14);
});

test('the depth a curtain wall lights is reckoned from its head at the storey height', () => {
  // L/W + L/H <= 2/(1 - Rb): 40 ft wide under a 14 ft head carries
  // 4 / (1/40 + 1/14) = 41.48 ft, and under the top storey's 10 ft, 32 ft.
  const { s } = stack(14, (shape) => setSegWall(shape, 0, 0, SEG_GLASS));
  near(named(daylightOnFloor(s, 0), 'Room 101').reach, DEPTH_LIMIT / (1 / 40 + 1 / 14), 1e-9, 'lower');
  near(named(daylightOnFloor(s, 1), 'Room 201').reach, DEPTH_LIMIT / (1 / 40 + 1 / WALL_H), 1e-9, 'top');
});

test('a window in an ordinary wall is the same glass whatever the storey height', () => {
  // The cases that must not move: a punched window is its own size, and the
  // room's daylight row is the same row at 10 ft floor to floor and at 18.
  const build = (floorHt) => stack(floorHt, (shape) => {
    assert.ok(addOpening(shape, 0, 0, 0.3, 6, { k: OP_WINDOW }));
    assert.ok(addOpening(shape, 0, 0, 0.7, 8, { k: OP_WINDOW, h: 5, sill: 2 }));
  }).s;
  const low = build(10), high = build(18);
  for (const i of [0, 1]) {
    const a = daylightOnFloor(low, i)[0], b = daylightOnFloor(high, i)[0];
    assert.equal(a.glazed, 6 * WINDOW_H + 8 * 5);
    assert.deepEqual(b, a, `storey ${i}`);
  }
  // The takeoff's glass is the windows alone on both, and its walls are not:
  // the wall does get taller.
  assert.equal(floorTakeoff(low, 0).glazing, 6 * WINDOW_H + 8 * 5);
  assert.equal(floorTakeoff(high, 0).glazing, 6 * WINDOW_H + 8 * 5);
  assert.equal(floorTakeoff(high, 0).facadeArea, floorTakeoff(low, 0).facadeArea * 1.8);
});

test('the sample school: the Learning Commons moves, and nothing without a curtain wall does', () => {
  const s = buildSampleSchool();
  const r = daylightAnalysis(s);
  const row = (name, floor = 0) => r.rooms.find((x) => x.name === name && x.floor === floor);
  // Its 25.3 ft of curtain wall stands on Level 1, 12 ft floor to floor, and
  // was read at 10: 293.0 ft² and 52.2% before #897, an ADF of 9.25, 84.4° of sky.
  const lc = row('Learning Commons');
  near(lc.glazed, 343.58, 0.01, 'glass');
  near(lc.ratio, 0.6118, 0.0001, 'ratio');
  near(lc.adf, 10.96, 0.01, 'daylight factor');
  near(lc.sky, 85.25, 0.01, 'sky');
  // The office's 24 ft glazed front onto the Main Hall: 240 ft² before.
  assert.equal(row('Office').borrowed, 288);
  assert.equal(row('Main Hall').borrowed, 288);
  // Whole building: 1497.0 ft² glazed, 960 borrowed and 10.7% before.
  near(r.summary.glazed, 1547.58, 0.01, 'all glass');
  assert.equal(r.summary.borrowed, 1056);
  near(r.summary.ratio, 0.1105, 0.0001, 'building ratio');
  // What did not move: every room lit by windows alone, and the storey with
  // no storey over it, where the two heights were always the same 10 ft.
  const same = [
    ['Room 101', 0, 70, 0.1042, 2.16], ['Room 102', 0, 70, 0.1042, 2.16],
    ['Room 103', 0, 70, 0.1042, 2.16], ['Stair Hall', 0, 70, 0.1042, 2.16],
    ['Office', 0, 70, 0.1042, 2.16], ['Room 105', 0, 112, 0.1167, 2.57],
    ['Room 106', 0, 126, 0.1193, 2.67], ['Room 201', 1, 70, 0.1042, 2.16],
    ['Media Center', 1, 70, 0.1042, 2.16], ['Room 203', 1, 70, 0.1042, 2.16],
    ['Stair Hall', 1, 70, 0.1042, 2.16], ['Room 205', 1, 112, 0.1167, 2.57],
    ['Room 206', 1, 224, 0.1296, 3.06],
  ];
  for (const [name, floor, glazed, ratio, adf] of same) {
    const x = row(name, floor);
    assert.equal(x.glazed, glazed, `${name} glass`);
    near(x.ratio, ratio, 0.0001, `${name} ratio`);
    near(x.adf, adf, 0.01, `${name} daylight factor`);
  }
  assert.equal(row('Upper Hall', 1).borrowed, 240, 'the top storey borrows what it did');
  // And the daylight's glass is now the takeoff's, storey by storey: exterior
  // glass, plus each borrowed pane once (both rooms are credited with it).
  // Level 1 came to 1121.0 against the takeoff's 1219.6 before.
  for (const i of [0, 1]) {
    const rooms = r.rooms.filter((x) => x.floor === i);
    const lit = rooms.reduce((n, x) => n + x.glazed + x.borrowed / 2, 0);
    near(lit, floorTakeoff(s, i).glazing, 1e-6, `Level ${i + 1}`);
  }
  near(floorTakeoff(s, 0).glazing, 1219.58, 0.01, 'the takeoff did not move');
  assert.equal(floorTakeoff(s, 1).glazing, 856);
});
