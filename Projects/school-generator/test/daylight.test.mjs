// Glazing per room: which glass is exterior, which is borrowed from the room
// next door, and what the ratio comes to. Small buildings where the glass can
// be counted by hand, plus the sample school.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, CELL, WALL_H } from '../js/grid.js';
import { setTile, edgeHIdx, edgeVIdx, EDGE_WALL, EDGE_DOOR, EDGE_GLASS, EDGE_WINDOW } from '../js/lattice.js';
import { sheet } from './build.mjs';
import { addShape, addOpening, setSegWall, OP_WINDOW, SEG_GLASS } from '../js/shapes.js';
import { gridOpeningWidth, GRID_WINDOW_W } from '../js/lattice.js';
import { WINDOW_H } from '../js/shapes.js';
import { buildSampleSchool } from '../js/sample.js';
import { buildNav } from '../js/navgraph.js';
import {
  daylightOnFloor, daylightAnalysis, MIN_RATIO, GOOD_RATIO, NEEDS_LIGHT,
} from '../js/daylight.js';

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
