// Two ramp findings and where they point. A ramp a file made narrower than
// the tool's own 4 ft is a `narrow-ramp` warning that moves nothing; and a
// `ramp-rise` ramp is marked on the plan the way every finding that carries a
// position is, by `findingMarks` (the map's ring, "Show it on the plan").
//
// The fixture: two storeys of 12 ft, a hall on each, one straight ramp with
// its foot at (10, 22) climbing toward +X. At 1:12 that is one run rising
// 144 in, so `ramp-rise` holds; at 1:12 in four runs it does not.
//
// Run with: node --test test/ramp-findings.test.mjs  (from the project folder)

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, addFloor } from '../js/grid.js';
import { sheet } from './build.mjs';
import { addStair, stairWidth, RAMP_CTRL } from '../js/stairs.js';
import { accessibleAnalysis } from '../js/egress.js';
import { buildReport } from '../js/report.js';
import { buildSampleSchool } from '../js/sample.js';
import { findingMarks, markOnFloor } from '../js/minimap.js';
import { serialize, deserialize } from '../js/save-load.js';

const find = (list, code) => list.find((f) => f.code === code);

function school(ramp = {}, type = 'ramp') {
  const s = createState(60, 20);
  addFloor(s);
  const g = sheet(s, 0);
  g.box(1, 1, 40, 8, { name: 'Ground Hall' }).door(1, 4, false);
  g.bake();
  sheet(s, 1).box(1, 1, 40, 8, { name: 'Upper Hall' }).bake();
  const { link } = addStair(s, 0, { type, x: 10, z: 22, rotationY: Math.PI / 2, slope: 12, ...ramp });
  return { s, link };
}
// A width written into the file, the way an old or hand-edited save holds it.
function narrow(width, type = 'ramp') {
  const { s, link } = school({}, type);
  link.data.width = width;
  return { s, link };
}

// ---------- a ramp narrower than 4 ft ----------

test('the line is the panel\'s own bottom: 4 ft is no finding, under it is a warning', () => {
  assert.equal(RAMP_CTRL.minW, 4);
  assert.equal(find(accessibleAnalysis(narrow(4).s).findings, 'narrow-ramp'), undefined);
  assert.equal(find(accessibleAnalysis(school().s).findings, 'narrow-ramp'), undefined);
  for (const w of [3, 3.5, 3.99]) {
    const f = find(accessibleAnalysis(narrow(w).s).findings, 'narrow-ramp');
    assert.ok(f, `a ${w} ft ramp raised no narrow-ramp`);
    assert.equal(f.level, 'warn');
    assert.equal(f.cite, 'ADA 2010 · §405.5');
  }
});

test('the finding says the width read, the 36 in floor and the 4 ft line, and points at the ramp', () => {
  const { s, link } = narrow(3);
  const f = find(accessibleAnalysis(s).findings, 'narrow-ramp');
  assert.equal(f.title, '1 ramp narrower than 4 ft');
  assert.match(f.detail, /The narrowest is 36 in wide/);
  assert.match(f.detail, /36 in clear between the handrails \(ADA 405\.5\)/);
  assert.match(f.detail, /Nothing was moved or widened/);
  assert.match(f.detail, /raise Ramp width/);
  assert.deepEqual(f.doors, [{ id: link.id, floor: 0, x: 10, z: 22, w: 0 }]);
  // Two narrow ramps, counted and the narrowest named.
  const two = narrow(3.5);
  addStair(two.s, 0, { type: 'ramp', x: 10, z: 60, rotationY: Math.PI / 2, slope: 12, width: 3 })
    .link.data.width = 3;
  const g = find(accessibleAnalysis(two.s).findings, 'narrow-ramp');
  assert.equal(g.title, '2 ramps narrower than 4 ft');
  assert.match(g.detail, /The narrowest is 36 in wide/);
  assert.equal(g.doors.length, 2);
});

test('a width under the reader\'s 3 ft clamp is named as the 3 ft every reader takes it as', () => {
  const { s, link } = narrow(1);
  assert.equal(stairWidth(link), 3);
  assert.match(find(accessibleAnalysis(s).findings, 'narrow-ramp').detail, /The narrowest is 36 in wide/);
});

test('a narrow ramp moves nothing: still a way up, the file still holds its width', () => {
  const wide = accessibleAnalysis(school().s);
  const { s } = narrow(3);
  const a = accessibleAnalysis(s);
  assert.equal(a.summary.ramps, wide.summary.ramps);
  assert.equal(a.summary.storeysReached, wide.summary.storeysReached);
  assert.equal(a.summary.unreachable, wide.summary.unreachable);
  const back = deserialize(serialize(s));
  assert.equal(back.links.find((l) => l.type === 'ramp').data.width, 3);
  assert.ok(find(buildReport(back).findings, 'narrow-ramp'));
});

test('a narrow stair is not a narrow ramp', () => {
  const { s } = narrow(3, 'stair');
  assert.equal(find(accessibleAnalysis(s).findings, 'narrow-ramp'), undefined);
});

test('the sample school has no narrow ramp', () => {
  assert.equal(find(buildReport(buildSampleSchool()).findings, 'narrow-ramp'), undefined);
});

// ---------- where the plan marks them ----------

test('a ramp-rise finding is a mark on the plan at the ramp, on the storey it climbs from', () => {
  const { s, link } = school();
  const r = buildReport(s, { takeoff: false, acoustics: false });
  assert.ok(find(r.findings, 'ramp-rise'), 'the fixture should raise ramp-rise');
  const mark = findingMarks(r).find((m) => m.code === 'ramp-rise');
  assert.ok(mark, 'ramp-rise is not a mark');
  assert.equal(mark.level, 'warn');
  assert.deepEqual(mark.doors, [{ id: link.id, floor: 0, x: 10, z: 22, w: 0 }]);
  assert.deepEqual(mark.floors, [0]);
  assert.equal(markOnFloor(mark, 0).doors.length, 1);
  assert.equal(markOnFloor(mark, 1).doors.length, 0);
  // Folded into runs short enough, there is nothing to mark.
  const folded = buildReport(school({ runs: 6 }).s, { takeoff: false, acoustics: false });
  assert.equal(findingMarks(folded).find((m) => m.code === 'ramp-rise'), undefined);
});

test('a narrow ramp is a mark at the ramp too', () => {
  const { s, link } = narrow(3);
  const mark = findingMarks(buildReport(s, { takeoff: false, acoustics: false }))
    .find((m) => m.code === 'narrow-ramp');
  assert.ok(mark, 'narrow-ramp is not a mark');
  assert.deepEqual(mark.doors, [{ id: link.id, floor: 0, x: 10, z: 22, w: 0 }]);
});
