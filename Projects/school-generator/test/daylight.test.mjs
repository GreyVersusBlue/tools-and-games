// Glazing per room: which glass is exterior, which is borrowed from the room
// next door, and what the ratio comes to. Small buildings where the glass can
// be counted by hand, plus the sample school.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, addFloor, CELL, WALL_H } from '../js/grid.js';
import { setTile, edgeHIdx, edgeVIdx, EDGE_WALL, EDGE_DOOR, EDGE_GLASS, EDGE_WINDOW } from '../js/lattice.js';
import { sheet } from './build.mjs';
import { addShape, addOpening, setSegWall, OP_WINDOW, SEG_GLASS } from '../js/shapes.js';
import { gridOpeningWidth, GRID_WINDOW_W } from '../js/lattice.js';
import { WINDOW_H } from '../js/shapes.js';
import { buildSampleSchool } from '../js/sample.js';
import { buildNav } from '../js/navgraph.js';
import {
  daylightOnFloor, daylightAnalysis, MIN_RATIO, GOOD_RATIO, NEEDS_LIGHT,
  skyBand, bearingOf, compassOf,
} from '../js/daylight.js';
import { reportCSV, buildReport } from '../js/report.js';

const has = (findings, code) => findings.some((f) => f.code === code);

// One room, 4 cells wide by 4 deep, walled all round, with a door onto the
// world. Glass goes on its north wall by the caller.
function oneRoom(name = 'Room 101', extra = null) {
  const s = createState(12, 10);
  const f = sheet(s, 0);
  f.box(1, 1, 4, 4, { name });
  f.edgesV[edgeVIdx(f, 1, 2)] = EDGE_DOOR;
  if (extra) extra(f);
  f.bake();
  return s;
}

const roomRow = (rows, name) => rows.find((r) => r.name === name);

test('a room with no glass has none, and is reported as windowless', () => {
  const r = daylightAnalysis(oneRoom());
  const row = roomRow(r.rooms, 'Room 101');
  assert.equal(row.glazed, 0);
  assert.equal(row.ratio, 0);
  assert.ok(row.windowless);
  assert.ok(row.dark);
  assert.ok(has(r.findings, 'windowless'));
});

test('a window band on an exterior wall is width times height of glass', () => {
  const s = oneRoom('Room 101', (f) => { f.edgesH[edgeHIdx(f, 2, 1)] = EDGE_WINDOW; });
  const rows = daylightOnFloor(s, 0);
  const row = roomRow(rows, 'Room 101');
  assert.equal(gridOpeningWidth(EDGE_WINDOW), GRID_WINDOW_W);
  assert.ok(Math.abs(row.glazed - GRID_WINDOW_W * WINDOW_H) < 1e-9);
  assert.equal(row.openings, 1);
  assert.equal(row.borrowed, 0);
});

test('a glazed wall is glazed floor to ceiling', () => {
  const s = oneRoom('Room 101', (f) => { f.edgesH[edgeHIdx(f, 2, 1)] = EDGE_GLASS; });
  const row = roomRow(daylightOnFloor(s, 0), 'Room 101');
  assert.equal(row.glazed, CELL * WALL_H);
});

test('glass between two rooms is borrowed light, not daylight', () => {
  const s = createState(14, 10);
  const f = sheet(s, 0);
  f.box(1, 1, 9, 4);
  f.vrun(5, 1, 4, EDGE_WALL);
  f.edgesV[edgeVIdx(f, 5, 2)] = EDGE_GLASS;      // between the two rooms
  f.edgesV[edgeVIdx(f, 5, 3)] = EDGE_DOOR;
  f.label(1, 1, 4, 4, { name: 'Room 101' });
  f.label(6, 1, 9, 4, { name: 'Room 102' });
  f.bake();
  const rows = daylightOnFloor(s, 0);
  for (const name of ['Room 101', 'Room 102']) {
    const row = roomRow(rows, name);
    assert.equal(row.glazed, 0, `${name} gets no daylight from an interior wall`);
    assert.equal(row.borrowed, CELL * WALL_H);
  }
});

test("a window counts at its own size, and a curtain wall at the segment's", () => {
  const s = createState(20, 20);
  const shape = addShape(s, 0, [
    { x: 0, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 20 }, { x: 0, z: 20 },
  ], { name: 'Room 101' });
  addOpening(shape, 0, 0, 0.5, 6, { k: OP_WINDOW });
  const withWindow = roomRow(daylightOnFloor(s, 0), 'Room 101');
  assert.equal(withWindow.glazed, 6 * 4);          // 6ft wide, the 4ft band

  setSegWall(shape, 0, 2, SEG_GLASS);              // the far wall, 40ft of it
  const withWall = roomRow(daylightOnFloor(s, 0), 'Room 101');
  assert.equal(withWall.glazed, 6 * 4 + 40 * WALL_H);
});

test('the ratio is glass over floor, and 8% is the line', () => {
  const rowOf = (st) => roomRow(daylightAnalysis(st).rooms, 'Room 101');
  // 16 cells = 256 ft² of floor; one 3.5×4 window is 14 ft², about 5.5%.
  const one = rowOf(oneRoom('Room 101', (f) => { f.edgesH[edgeHIdx(f, 2, 1)] = EDGE_WINDOW; }));
  assert.ok(one.ratio < MIN_RATIO);
  assert.ok(one.dark);
  assert.ok(!one.windowless);
  // Three more windows clears it.
  const four = rowOf(oneRoom('Room 101', (f) => {
    for (const x of [1, 2, 3, 4]) f.edgesH[edgeHIdx(f, x, 1)] = EDGE_WINDOW;
  }));
  assert.ok(four.ratio > MIN_RATIO);
  assert.ok(!four.dark);
});

test('a corridor, a store and a restroom are allowed to be windowless', () => {
  for (const name of ['Corridor', 'Storeroom', 'Restroom']) {
    const r = daylightAnalysis(oneRoom(name));
    const row = roomRow(r.rooms, name);
    assert.ok(!row.wanted, `${name} is not held to the glazing rule`);
    assert.ok(!row.dark && !row.windowless);
  }
  // ...and every use that *is* held to it is a place people sit down in.
  assert.ok(NEEDS_LIGHT.has('classroom'));
  assert.ok(!NEEDS_LIGHT.has('circulation'));
});

test('a bright room reads as bright', () => {
  const s = createState(20, 20);
  const shape = addShape(s, 0, [
    { x: 0, z: 0 }, { x: 30, z: 0 }, { x: 30, z: 20 }, { x: 0, z: 20 },
  ], { name: 'Room 101' });
  setSegWall(shape, 0, 0, SEG_GLASS);
  const row = roomRow(daylightAnalysis(s).rooms, 'Room 101');
  assert.ok(row.ratio > GOOD_RATIO);
  assert.ok(row.bright);
});

test('the sample school lights every classroom it draws', () => {
  const r = daylightAnalysis(buildSampleSchool());
  assert.equal(r.summary.windowless, 0);
  assert.equal(r.summary.dark, 0);
  assert.ok(r.summary.rooms >= 10);
  assert.ok(r.summary.glazed > 1000);
  assert.ok(r.summary.borrowed > 0, 'the office fronts the hall in glass');
  assert.ok(has(r.findings, 'glazing-ratio'));
  assert.equal(r.findings.find((f) => f.code === 'glazing-ratio').level, 'ok');
});

test('rows are sorted darkest first, and a shared graph changes nothing', () => {
  const s = buildSampleSchool();
  const nav = buildNav(s);
  const a = daylightAnalysis(s, { nav });
  const b = daylightAnalysis(s);
  assert.equal(a.rooms.length, b.rooms.length);
  assert.equal(Math.round(a.summary.ratio * 1000), Math.round(b.summary.ratio * 1000));
  for (let i = 1; i < a.rooms.length; i++) assert.ok(a.rooms[i - 1].ratio <= a.rooms[i].ratio);
});

test('an empty design says there is nothing to grade', () => {
  const r = daylightAnalysis(createState(8, 8));
  assert.equal(r.rooms.length, 0);
  assert.equal(r.summary.rooms, 0);
  assert.ok(has(r.findings, 'daylight-none'));
});

// ---------- Phase 41: the rule comes off the edition, and the finding says which ----------

test('the glazing rule is read off the edition and cited', () => {
  const s = createState(12, 10);
  sheet(s, 0).box(1, 1, 6, 5, { name: 'Room 101' }).bake();
  const r = daylightAnalysis(s);
  assert.equal(r.summary.min, MIN_RATIO);
  assert.equal(r.summary.editionLabel, 'IBC 2021');
  for (const f of r.findings) assert.match(f.cite, /^IBC 2021 · §1205\.2$/);
  // A hypothetical edition asking for more glass moves the verdict.
  const strict = { key: 'test', label: 'Test', factors: { classroom: 20 }, glazing: 0.5, cites: { glazing: '§X' } };
  const held = daylightAnalysis(s, { edition: strict });
  assert.equal(held.summary.min, 0.5);
  assert.ok(held.findings.some((f) => f.cite === 'Test · §X'));
  assert.ok(held.rooms.every((r) => r.dark === (r.wanted && r.ratio < 0.5)));
});

// ---------- #822: the sky a pane sees, the room behind it, and the sun ----------

// One free-drawn room `w` wide and `d` deep with its north wall on z = 0. The
// plan's north is -Z, so that wall's outward normal is (0, -1).
function hall(w = 40, d = 20, name = 'Room 101') {
  const s = createState(30, 30);
  const shape = addShape(s, 0, [
    { x: 0, z: 0 }, { x: w, z: 0 }, { x: w, z: d }, { x: 0, z: d },
  ], { name });
  return { s, shape };
}
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} is not within ${tol} of ${b}`);

test('an open field is ninety degrees of sky, and the daylight factor is the BRE sum', () => {
  const { s, shape } = hall(30, 20);
  setSegWall(shape, 0, 0, SEG_GLASS);
  const row = roomRow(daylightOnFloor(s, 0), 'Room 101');
  assert.equal(row.sky, 90);
  // By hand: 300 ft² of glass, 90°, T = 0.68 × 0.9; surfaces are two 600 ft²
  // planes and 100 ft of wall 10 ft high; 1 − 0.5² = 0.75.
  // 0.612 × 300 × 90 / (2200 × 0.75) = 10.0145
  near(row.adf, 10.0145, 0.0005, 'adf');
});

test('a wing opposite takes the bottom of the sky', () => {
  const { s, shape } = hall();
  setSegWall(shape, 0, 0, SEG_GLASS);
  addShape(s, 0, [{ x: 0, z: -40 }, { x: 40, z: -40 }, { x: 40, z: -20 }, { x: 0, z: -20 }], { name: 'Wing' });
  const row = roomRow(daylightOnFloor(s, 0), 'Room 101');
  // The wing's roof is 5 ft above the middle of the glass and 20 ft away:
  // atan(5 / 20) is 14°, and the stride finds the wall within a quarter foot.
  near(row.sky, 76, 0.5, 'sky');
  const open = hall();
  setSegWall(open.shape, 0, 0, SEG_GLASS);
  assert.ok(row.adf < roomRow(daylightOnFloor(open.s, 0), 'Room 101').adf);
});

test('a storey jettied out above takes the top of the sky, and a flush one takes none', () => {
  const build = (z0) => {
    const { s, shape } = hall();
    addOpening(shape, 0, 0, 0.5, 6, { k: OP_WINDOW });     // sill 3, head 7
    addFloor(s, 1);
    addShape(s, 1, [{ x: 0, z: z0 }, { x: 40, z: z0 }, { x: 40, z: 20 }, { x: 0, z: 20 }], { name: 'Upstairs' });
    return roomRow(daylightOnFloor(s, 0), 'Room 101');
  };
  assert.equal(build(0).sky, 90);
  // Nine feet of jetty, sampled out to 8: its underside is 12 − 5 = 7 ft over
  // the middle of the window. atan(7 / 8) = 41.19°.
  near(build(-9).sky, 41.19, 0.05, 'sky');
});

test('a window is judged from where it is on its wall', () => {
  // The wing stands opposite the east half of the wall only.
  const at = (t) => {
    const { s, shape } = hall();
    addOpening(shape, 0, 0, t, 6, { k: OP_WINDOW });
    addShape(s, 0, [{ x: 20, z: -40 }, { x: 40, z: -40 }, { x: 40, z: -20 }, { x: 20, z: -20 }], { name: 'Wing' });
    return roomRow(daylightOnFloor(s, 0), 'Room 101').sky;
  };
  assert.equal(at(0.2), 90);
  near(at(0.8), 76, 0.5, 'sky');
});

test('a bridge that is not over the window is not an overhang', () => {
  const { s, shape } = hall();
  addOpening(shape, 0, 0, 0.5, 6, { k: OP_WINDOW });
  addFloor(s, 1);
  addShape(s, 1, [{ x: 0, z: -60 }, { x: 40, z: -60 }, { x: 40, z: -40 }, { x: 0, z: -40 }], { name: 'Bridge' });
  assert.equal(roomRow(daylightOnFloor(s, 0), 'Room 101').sky, 90);
});

test("a pitched roof's eave shades the top storey and no other", () => {
  const { s, shape } = hall();
  addOpening(shape, 0, 0, 0.5, 6, { k: OP_WINDOW });
  const nav = buildNav(s);
  assert.equal(skyBand(s, nav, 0, 20, 0, 0, -1, 5).hi, 90);
  s.roof = { style: 'gable', pitch: 4, facade: 'brick' };
  // The eave is 1.5 ft out and 5 ft over the middle of the window.
  near(skyBand(s, nav, 0, 20, 0, 0, -1, 5).hi, 73.30, 0.01, 'hi');
  addFloor(s, 1);
  assert.equal(skyBand(s, buildNav(s), 0, 20, 0, 0, -1, 5).hi, 90);
});

test('the compass is read against the design\'s own north', () => {
  assert.equal(compassOf(bearingOf(0, -1, 0)), 'north');
  assert.equal(compassOf(bearingOf(1, 0, 0)), 'east');
  assert.equal(compassOf(bearingOf(0, -1, 180)), 'south');
  assert.equal(compassOf(bearingOf(0, -1, 350)), 'north');
});

test('turning the building moves the sun and leaves the daylight factor alone', () => {
  const at = (north) => {
    const { s, shape } = hall();
    addOpening(shape, 0, 0, 0.5, 6, { k: OP_WINDOW });
    s.env = { ...s.env, month: 3, day: 21, lat: 39, north };
    return roomRow(daylightOnFloor(s, 0), 'Room 101');
  };
  const north = at(0), south = at(180), east = at(90);
  assert.equal(north.facing, 'north');
  assert.equal(south.facing, 'south');
  assert.equal(north.sunHours, 0, 'at the equinox the sun never stands north of an east-west wall');
  assert.equal(south.sunHours, 8, 'and it stands south of it all school day');
  assert.ok(east.sunHours > 2 && east.sunHours < 6, `an east wall gets the morning: ${east.sunHours}`);
  assert.equal(north.adf, south.adf);
  assert.equal(north.adf, east.adf);
});

test('an overhang keeps the high summer sun off south glass', () => {
  const at = (z0) => {
    const { s, shape } = hall();
    addOpening(shape, 0, 0, 0.5, 6, { k: OP_WINDOW });
    addFloor(s, 1);
    addShape(s, 1, [{ x: 0, z: z0 }, { x: 40, z: z0 }, { x: 40, z: 20 }, { x: 0, z: 20 }], { name: 'Upstairs' });
    s.env = { ...s.env, month: 6, day: 21, lat: 39, north: 180 };
    return roomRow(daylightOnFloor(s, 0), 'Room 101').sunHours;
  };
  assert.ok(at(0) > 0);
  assert.equal(at(-9), 0, 'in June the sun is never under 41° in the plane of a south wall at 39°N');
});

test('a room is deep when it runs past what one glazed wall lights', () => {
  const rowOf = (d, both = false) => {
    const { s, shape } = hall(40, d);
    addOpening(shape, 0, 0, 0.5, 6, { k: OP_WINDOW });     // head 7
    if (both) addOpening(shape, 0, 2, 0.5, 6, { k: OP_WINDOW });
    return roomRow(daylightAnalysis(s).rooms, 'Room 101');
  };
  // 4 / (1/40 + 1/7) = 23.83 ft.
  const shallow = rowOf(20), long = rowOf(30);
  near(shallow.reach, 23.83, 0.01, 'reach');
  assert.equal(shallow.depth, 20);
  assert.ok(!shallow.deep);
  assert.equal(long.depth, 30);
  assert.ok(long.deep);
  // Glass on the far wall too: no one facing, and the rule does not apply.
  const lit = rowOf(30, true);
  assert.equal(lit.facing, null);
  assert.ok(!lit.deep);
});

test('a corner room faces two ways, not the diagonal between them', () => {
  const { s, shape } = hall();
  addOpening(shape, 0, 0, 0.5, 6, { k: OP_WINDOW });
  addOpening(shape, 0, 1, 0.5, 6, { k: OP_WINDOW });
  const row = roomRow(daylightOnFloor(s, 0), 'Room 101');
  assert.equal(row.facing, null);
  assert.equal(row.depth, 0);
});

test('a dim room is one with enough glass and too little sky, and it is a note', () => {
  // 40 × 20 with 72 ft² of window is 9%: over the code's line. Open, it
  // averages 0.612 × 72 × 90 / (2800 × 0.75) = 1.888%; a wing ten feet off
  // makes it worse.
  const build = (wing) => {
    const { s, shape } = hall();
    for (const t of [0.2, 0.5, 0.8]) addOpening(shape, 0, 0, t, 6, { k: OP_WINDOW });
    if (wing) addShape(s, 0, [{ x: 0, z: -40 }, { x: 40, z: -40 }, { x: 40, z: -10 }, { x: 0, z: -10 }], { name: 'Storeroom' });
    return daylightAnalysis(s);
  };
  const r = build(true);
  const row = roomRow(r.rooms, 'Room 101');
  assert.ok(!row.dark && row.dim);
  const f = r.findings.find((x) => x.code === 'daylight-factor');
  assert.equal(f.level, 'note');
  assert.equal(f.cite, 'BS 8206-2 · average daylight factor');
  assert.equal(r.summary.dim, 1);
  near(roomRow(build(false).rooms, 'Room 101').adf, 1.8885, 0.0005, 'adf');
  assert.ok(row.adf < 1.5, `${row.adf}`);
  // A room short of glass has the code's finding and not this one as well.
  const short = hall();
  addOpening(short.shape, 0, 0, 0.5, 6, { k: OP_WINDOW });
  const dark = daylightAnalysis(short.s);
  assert.ok(roomRow(dark.rooms, 'Room 101').dark);
  assert.ok(!has(dark.findings, 'daylight-factor'));
});

test('the sample school: the middle room clears 2%, and the deep rooms are named', () => {
  const r = daylightAnalysis(buildSampleSchool());
  assert.ok(r.summary.adf > 2 && r.summary.adf < 3, `${r.summary.adf}`);
  assert.equal(r.summary.dim, 0);
  assert.ok(r.summary.deep > 0);
  const f = r.findings.find((x) => x.code === 'deep-room');
  assert.equal(f.level, 'note');
  assert.equal(f.cite, 'BS 8206-2 · limiting depth');
  for (const row of r.rooms) assert.ok(!('panes' in row), 'the working list does not leave the module');
});

test('the room sheet carries the four new columns under their own headings', () => {
  const lines = reportCSV(buildReport(buildSampleSchool())).split('\r\n').map((l) => l.split(','));
  const head = lines.find((l) => l[0] === 'Rooms');
  const at = head.indexOf('Daylight factor %');
  assert.ok(at > 0);
  assert.deepEqual(head.slice(at, at + 4), ['Daylight factor %', 'Sky seen °', 'Glass faces', 'Sun h 8 to 4']);
  const room = lines.find((l) => l[0] === 'Room 101');
  assert.equal(room.length, head.length);
  assert.equal(room[at + 1], '90');
  assert.equal(room[at + 2], 'north');
  assert.equal(room[at + 3], '0');
});
