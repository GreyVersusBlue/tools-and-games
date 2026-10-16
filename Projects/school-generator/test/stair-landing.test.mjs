// A stair's 4ft top landing asked the two questions that make sense for a
// stair (#987): a floor-standing prop whose turned footprint overlaps it, and
// a door leaf whose swing sweeps into it. The same lines `rampLandingFit`
// asks a ramp's with (#984), a `stair-landing` warning, nothing moved.
//
// The fixture, by hand: a 12ft storey's stair is 19.25ft of run and lands on
// 4ft more. Turned to climb toward +X along z 22 with its foot at 60.75, the
// run tops out at x 80 and the landing is x 80 to 84, z 20 to 24. Cells are
// 4ft, so the wall between the hall (cells 1 to 20) and the far room stands
// on x 84, at the landing's far end, and door(21, 5) is the doorway there.
//
// Run with: node --test test/stair-landing.test.mjs  (from the project folder)

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, addFloor } from '../js/grid.js';
import { sheet } from './build.mjs';
import { addStair, stairMetrics, topLandingBox, localToWorld } from '../js/stairs.js';
import { stairLandingFit, rampLandingFit } from '../js/clearance.js';
import { accessibleAnalysis } from '../js/egress.js';
import { buildReport, reportCSV } from '../js/report.js';
import { findingMarks } from '../js/minimap.js';
import { addProp } from '../js/props.js';
import { catalogEntry } from '../js/catalog.js';
import { shapesOf } from '../js/shapes.js';

const find = (list, code) => list.find((f) => f.code === code);
const round = (v) => Math.round(v * 100) / 100;

function school(upper) {
  const s = createState(60, 20);
  addFloor(s);
  const g = sheet(s, 0);
  g.box(1, 1, 40, 8, { name: 'Ground Hall' }).door(1, 4, false);
  g.bake();
  const u = sheet(s, 1);
  upper(u);
  u.bake();
  const { link } = addStair(s, 0, { type: 'stair', x: 60.75, z: 22, rotationY: Math.PI / 2 });
  return { s, stair: link };
}
const oneHall = (u) => u.box(1, 1, 40, 8, { name: 'Upper Hall' });
const doorAhead = (u) => {
  u.box(1, 1, 20, 8, { name: 'Upper Hall' });
  u.box(21, 1, 40, 8, { name: 'Far Room' });
  u.door(21, 5, false);
};
const swingBack = (s) => {
  for (const sh of shapesOf(s.floors[1])) {
    for (const ring of sh.rings) for (const o of ring.openings) o.sw = o.sw === -1 ? 1 : -1;
  }
};
const desk = (s, x, z, extra = {}) => addProp(s, 'student-desk', { floor: 1, x, z, rotationY: 0, ...extra });

test('the fixture: the landing is where the comment says', () => {
  const { s, stair } = school(oneHall);
  const box = topLandingBox(stair, stairMetrics(s));
  const a = localToWorld(stair, box.x0, box.z0), b = localToWorld(stair, box.x1, box.z1);
  assert.deepEqual([a.x, b.x].map(round).sort((p, q) => p - q), [80, 84]);
  assert.deepEqual([a.z, b.z].map(round).sort((p, q) => p - q), [20, 24]);
});

test('a clear stair raises nothing new', () => {
  const { s, stair } = school(oneHall);
  assert.equal(stairLandingFit(s, stair, undefined, catalogEntry), null);
  assert.equal(find(buildReport(s).findings, 'stair-landing'), undefined);
});

test('a desk on the landing: named, ringed where the landing is, and moved nowhere', () => {
  const { s, stair } = school(oneHall);
  const d = desk(s, 82, 22);
  const fit = stairLandingFit(s, stair, undefined, catalogEntry);
  assert.deepEqual(fit.why, ['prop']);
  assert.deepEqual([fit.id, fit.floor, round(fit.x), round(fit.z)], [stair.id, 1, 82, 22]);
  assert.equal(stairLandingFit(s, stair), null, 'no catalog, no footprint: not asked');
  assert.deepEqual([d.x, d.z, s.props.length], [82, 22, 1], 'the desk was not moved');
  assert.deepEqual([stair.x, stair.z], [60.75, 22], 'the stair was not moved');

  const report = buildReport(s);
  const f = find(report.findings, 'stair-landing');
  assert.ok(f, 'a stair-landing finding');
  assert.equal(f.level, 'warn');
  assert.match(f.title, /^1 stair with something in the top landing$/);
  assert.match(f.detail, /furniture stands in it \(1\)/);
  assert.doesNotMatch(f.detail, /door swings/);
  assert.equal(f.cite, undefined, 'no section is invented');
  assert.deepEqual(f.doors.map((m) => [m.id, m.floor, round(m.x), round(m.z)]), [[stair.id, 1, 82, 22]]);
  const mark = findingMarks(report).find((m) => m.code === 'stair-landing');
  assert.ok(mark, 'findingMarks rings it');
  assert.deepEqual(mark.floors, [1]);
  assert.deepEqual(mark.doors.map((m) => [m.floor, round(m.x), round(m.z)]), [[1, 82, 22]]);
  assert.ok(reportCSV(report).split('\n').some((row) => row.startsWith('1 stair with something in the top landing,warn,')),
    'the CSV has its row');
  assert.equal(find(report.findings, 'ramp-landing'), undefined, 'a stair is not a ramp');
});

test('a desk past the landing, turned clear, or mounted on a wall is not in it', () => {
  // x 77 to 79: on the run, short of the landing at 80.
  const short = school(oneHall);
  desk(short.s, 78, 22);
  assert.equal(stairLandingFit(short.s, short.stair, undefined, catalogEntry), null);
  // Square on, a desk whose middle is 0.8ft past the end reaches 0.2ft back
  // over it (its 2ft runs along x); turned a quarter, its 1.5ft stops short.
  const square = school(oneHall);
  desk(square.s, 84.8, 22);
  assert.deepEqual(stairLandingFit(square.s, square.stair, undefined, catalogEntry).why, ['prop']);
  const turned = school(oneHall);
  desk(turned.s, 84.8, 22, { rotationY: Math.PI / 2 });
  assert.equal(stairLandingFit(turned.s, turned.stair, undefined, catalogEntry), null);
  const board = school(oneHall);
  addProp(board.s, 'whiteboard', { floor: 1, x: 82, z: 22, rotationY: 0 });
  assert.equal(stairLandingFit(board.s, board.stair, undefined, catalogEntry), null);
});

test('a door swinging in at the landing; the same door swinging away raises nothing', () => {
  const { s, stair } = school(doorAhead);
  assert.deepEqual(stairLandingFit(s, stair, undefined, catalogEntry).why, ['swing']);
  assert.deepEqual(stairLandingFit(s, stair).why, ['swing'], 'a swing needs no catalog');
  const f = find(accessibleAnalysis(s).findings, 'stair-landing');
  assert.ok(f && /a door swings into it \(1\)/.test(f.detail), f && f.detail);
  assert.doesNotMatch(f.detail, /furniture/);
  swingBack(s);
  assert.equal(stairLandingFit(s, stair, undefined, catalogEntry), null);
  assert.equal(find(accessibleAnalysis(s).findings, 'stair-landing'), undefined);
});

test('both reasons, counted; a ramp is still the ramp check\'s and not this one\'s', () => {
  const { s, stair } = school(doorAhead);
  desk(s, 81.5, 22);
  assert.deepEqual(stairLandingFit(s, stair, undefined, catalogEntry).why, ['prop', 'swing']);
  const f = find(accessibleAnalysis(s).findings, 'stair-landing');
  assert.match(f.detail, /furniture stands in it \(1\); a door swings into it \(1\)/);
  assert.equal(rampLandingFit(s, stair, undefined, catalogEntry), null, 'the ramp check skips a stair');
  // A 1:6 ramp in its place, foot at 8: 72ft of run, so its 5ft landing is
  // x 80 to 85 and holds the same desk and the same door's swing. The ramp
  // check finds both (and the wall at 84, a foot short of its end); this one\n  // is not asked.
  const r = createState(60, 20);
  addFloor(r);
  sheet(r, 0).box(1, 1, 40, 8, { name: 'Ground Hall' }).door(1, 4, false).bake();
  const u = sheet(r, 1);
  doorAhead(u);
  u.bake();
  const { link: ramp } = addStair(r, 0, { type: 'ramp', x: 8, z: 22, rotationY: Math.PI / 2, slope: 6 });
  desk(r, 81.5, 22);
  const rampWhy = rampLandingFit(r, ramp, undefined, catalogEntry).why;
  assert.ok(rampWhy.includes('prop') && rampWhy.includes('swing'), rampWhy.join());
  assert.equal(stairLandingFit(r, ramp, undefined, catalogEntry), null, 'this one skips a ramp');
  assert.equal(find(accessibleAnalysis(r).findings, 'stair-landing'), undefined);
});
