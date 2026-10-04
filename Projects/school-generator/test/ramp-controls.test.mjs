// What the page can now set and say: a ramp's fold (#832), the finding for a
// run that rises more than 30in (#833), and which face of which wall a click on the
// plan means when an accent is being painted.
//
// The controls themselves are chrome and test/tools/run.mjs drives them in a
// browser. This file is the arithmetic under them, worked by hand: a 12ft
// storey over runs is 144in, 72in, 36in, 28.8in for 1, 2, 4 and 5 runs, so
// five is the fewest inside ADA 405.6; a 10ft storey in four is 30in exactly.
//
// Run with: node --test test/ramp-controls.test.mjs  (from the project folder)

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, addFloor } from '../js/grid.js';
import { sheet } from './build.mjs';
import {
  addStair, stairRun, rampRuns, rampSide, rampRunRise, rampOverRise, rampMinRuns,
  setRampFold, MAX_RUNS,
} from '../js/stairs.js';
import { accessibleAnalysis } from '../js/egress.js';
import { buildReport } from '../js/report.js';
import { buildSampleSchool } from '../js/sample.js';
import { serialize } from '../js/save-load.js';
import { accentFaceAt, setSegAccent, segAccent } from '../js/shapes.js';

const M12 = stairRun(12);
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const find = (list, code) => list.find((f) => f.code === code);
const ramp = (data = {}) => ({ id: 1, type: 'ramp', from: 0, to: 1, x: 0, z: 0, rotationY: 0, data });

// A hall on each of two storeys and a ramp between them, the fixture
// clearance.test.mjs uses for the steep ramp.
function twoHalls(opts = {}, floorHt) {
  const s = createState(30, 30);
  if (floorHt) s.floorHt = floorHt;
  addFloor(s);
  const f = sheet(s, 0);
  f.box(1, 1, 20, 8, { name: 'Ground Hall' }).door(1, 4, false);
  f.bake();
  sheet(s, 1).box(1, 1, 20, 8, { name: 'Upper Hall' }).bake();
  const { link } = addStair(s, 0, { type: 'ramp', x: 20, z: 12, rotationY: Math.PI / 2, ...opts });
  return { s, link };
}

// ---------- the rise of one run ----------

test('a run climbs the storey over the run count, and 30in is the line', () => {
  assert.equal(M12.rise, 12);
  assert.ok(near(rampRunRise(ramp(), M12) * 12, 144));
  assert.ok(near(rampRunRise(ramp({ runs: 2 }), M12) * 12, 72));
  assert.ok(near(rampRunRise(ramp({ runs: 4 }), M12) * 12, 36));
  assert.ok(near(rampRunRise(ramp({ runs: 5 }), M12) * 12, 28.8));
  assert.equal(rampOverRise(ramp(), M12), true);
  assert.equal(rampOverRise(ramp({ runs: 4 }), M12), true);
  assert.equal(rampOverRise(ramp({ runs: 5 }), M12), false);
  // On the line is not over it: 10ft in four runs is 30in each.
  const M10 = stairRun(10);
  assert.equal(M10.rise, 10);
  assert.equal(rampOverRise(ramp({ runs: 4 }), M10), false);
  assert.equal(rampOverRise(ramp({ runs: 3 }), M10), true);
  // Only a ramp is asked. A stair climbs a storey in one flight by design.
  assert.equal(rampOverRise({ type: 'stair', data: {} }, M12), false);
  assert.equal(rampOverRise(null, M12), false);
});

test('the fewest legal runs is the rise over 30in, rounded up, capped at what a link holds', () => {
  assert.equal(rampMinRuns(stairRun(12)), 5);
  assert.equal(rampMinRuns(stairRun(10)), 4);
  assert.equal(rampMinRuns(stairRun(9)), 4);
  // 40ft wants sixteen and a link holds twelve.
  assert.equal(MAX_RUNS, 12);
  assert.equal(rampMinRuns({ rise: 40 }), 12);
});

// ---------- setting the fold ----------

test('setRampFold writes what linkData writes, and one run is the old record', () => {
  const { link } = twoHalls();
  assert.deepEqual(link.data, { width: 4, slope: 12 });
  assert.equal(setRampFold(link, { runs: 5 }), true);
  assert.deepEqual(link.data, { width: 4, slope: 12, runs: 5 });
  assert.equal(setRampFold(link, { side: -1 }), true);
  assert.deepEqual(link.data, { width: 4, slope: 12, runs: 5, side: -1 });
  assert.equal(rampRuns(link), 5);
  assert.equal(rampSide(link), -1);
  // The same again changes nothing and says so.
  assert.equal(setRampFold(link, { runs: 5, side: -1 }), false);
  // The right hand is the absent default, not a stored 1.
  assert.equal(setRampFold(link, { side: 1 }), true);
  assert.deepEqual(link.data, { width: 4, slope: 12, runs: 5 });
  // Back to one run: both fields go, the left hand with it.
  setRampFold(link, { side: -1 });
  assert.equal(setRampFold(link, { runs: 1 }), true);
  assert.deepEqual(link.data, { width: 4, slope: 12 });
  // ...which is the record a ramp placed with no fold has, byte for byte.
  const fresh = twoHalls();
  assert.equal(JSON.stringify(link.data), JSON.stringify(fresh.link.data));
});

test('setRampFold clamps the count the way a file is read, and leaves a stair alone', () => {
  const { link } = twoHalls();
  setRampFold(link, { runs: 99 });
  assert.equal(link.data.runs, MAX_RUNS);
  setRampFold(link, { runs: 0 });
  assert.equal('runs' in link.data, false);
  setRampFold(link, { runs: 2.6 });
  assert.equal(link.data.runs, 3);
  assert.equal(setRampFold(link, { runs: NaN }), true, 'not a number reads as one run');
  assert.equal('runs' in link.data, false);
  const stair = { type: 'stair', data: { width: 4 } };
  assert.equal(setRampFold(stair, { runs: 5 }), false);
  assert.deepEqual(stair.data, { width: 4 });
  assert.equal(setRampFold(null, { runs: 5 }), false);
});

// ---------- the finding ----------

test('a straight ramp up a 12ft storey raises ramp-rise, and five runs clears it', () => {
  const { s, link } = twoHalls();
  let a = accessibleAnalysis(s);
  assert.equal(a.summary.longRamps, 1);
  assert.deepEqual(a.longRamps.map((l) => [l.id, l.runs]), [[link.id, 1]]);
  const f = find(a.findings, 'ramp-rise');
  assert.ok(f);
  assert.equal(f.level, 'warn');
  assert.equal(f.title, '1 ramp with a run that rises more than 30in');
  assert.match(f.detail, /climbs 144 in /);
  assert.match(f.detail, /A 12ft storey wants 5 runs/);
  assert.equal(f.cite, 'ADA 2010 · §405.6');
  assert.deepEqual(f.doors, [{ id: link.id, floor: 0, x: 20, z: 12, w: 0 }]);
  // The slope is legal, so it is still a way up and not a steep ramp.
  assert.equal(a.summary.ramps, 1);
  assert.equal(a.summary.steepRamps, 0);
  assert.ok(!find(a.findings, 'steep-ramp'));
  assert.ok(!find(a.findings, 'no-lift'));

  setRampFold(link, { runs: 4 });
  a = accessibleAnalysis(s);
  assert.match(find(a.findings, 'ramp-rise').detail, /climbs 36 in /);

  setRampFold(link, { runs: 5 });
  a = accessibleAnalysis(s);
  assert.equal(a.summary.longRamps, 0);
  assert.equal(find(a.findings, 'ramp-rise'), undefined);
  assert.deepEqual(a.longRamps, []);
});

test('the finding counts every long ramp and quotes the worst', () => {
  const { s } = twoHalls({ runs: 4 });
  addStair(s, 0, { type: 'ramp', x: 40, z: 12, rotationY: Math.PI / 2, runs: 2 });
  addStair(s, 0, { type: 'ramp', x: 60, z: 12, rotationY: Math.PI / 2, runs: 6 });
  const a = accessibleAnalysis(s);
  assert.equal(a.summary.longRamps, 2);
  const f = find(a.findings, 'ramp-rise');
  assert.equal(f.title, '2 ramps with a run that rises more than 30in');
  assert.match(f.detail, /climbs 72 in /);
  assert.equal(f.doors.length, 2);
});

test('a storey no fold can climb is told to use a lift, not to raise Runs', () => {
  const { s } = twoHalls({ runs: 12 }, 40);
  const f = find(accessibleAnalysis(s).findings, 'ramp-rise');
  assert.ok(f);
  assert.match(f.detail, /climbs 40 in /);
  assert.match(f.detail, /more than 12 runs can climb/);
  assert.doesNotMatch(f.detail, /raise Runs/);
});

test('the report carries it in the accessible section, and a stair-only school never sees it', () => {
  const { s } = twoHalls();
  const mine = buildReport(s).findings.filter((f) => f.code === 'ramp-rise');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].section, 'accessible');
  // The sample school has a stair, a lift and an opening and no ramp, so its
  // report, and the chrome-rail picture taken of it, do not move.
  const sample = buildSampleSchool();
  assert.equal((sample.links || []).filter((l) => l.type === 'ramp').length, 0);
  const a = accessibleAnalysis(sample);
  assert.equal(a.summary.longRamps, 0);
  assert.equal(find(a.findings, 'ramp-rise'), undefined);
  assert.equal(find(buildReport(sample).findings, 'ramp-rise'), undefined);
});

// ---------- which face a click means ----------

// A is x 4..16 and B is x 16..28, both z 4..12; the hall is x 4..28, z 12..20.
// The partition at x 16 is on A's ring; B's segment there is SEG_NONE.
function twoRoomsAndAHall() {
  const s = createState(20, 20);
  sheet(s, 0)
    .box(1, 1, 3, 2, { name: 'A', paint: '#aa0000' })
    .box(4, 1, 6, 2, { name: 'B', paint: '#0000aa' })
    .box(1, 3, 6, 4, { name: 'Hall' })
    .bake();
  return s;
}
const ends = (face) => {
  const pts = face.shape.rings[face.ring].pts;
  const a = pts[face.seg], b = pts[(face.seg + 1) % pts.length];
  return [a.x, a.z, b.x, b.z];
};
const onLine = (face, key, v) => {
  const [ax, az, bx, bz] = ends(face);
  return key === 'x' ? ax === v && bx === v : az === v && bz === v;
};

test('a click beside a shared wall means the room it is in, either side', () => {
  const s = twoRoomsAndAHall();
  const f = s.floors[0];
  const left = accentFaceAt(f, 15.5, 8, 3);
  const right = accentFaceAt(f, 16.5, 8, 3);
  assert.equal(left.shape.name, 'A');
  assert.equal(right.shape.name, 'B');
  assert.ok(onLine(left, 'x', 16) && onLine(right, 'x', 16));
  assert.ok(near(left.dist, 0.5) && near(right.dist, 0.5));
  // The two faces are two records: painting one leaves the other alone.
  assert.equal(setSegAccent(left.shape, left.ring, left.seg, '#2f5d8a'), true);
  assert.equal(segAccent(left.shape.rings[left.ring], left.seg), '#2f5d8a');
  assert.equal(segAccent(right.shape.rings[right.ring], right.seg), null);
  assert.equal('accents' in right.shape.rings[right.ring], false);
});

test('it is the nearest wall of that room, within reach, and nothing outside a room', () => {
  const s = twoRoomsAndAHall();
  const f = s.floors[0];
  // (10, 5) in A: 1ft from the wall at z 4, 6ft from either side.
  const top = accentFaceAt(f, 10, 5, 3);
  assert.equal(top.shape.name, 'A');
  assert.ok(onLine(top, 'z', 4));
  assert.ok(near(top.dist, 1));
  // In the corner both walls are in reach and the nearer one is meant:
  // (15, 6) is 1ft from the partition and 2ft from the wall at z 4.
  const corner = accentFaceAt(f, 15, 6, 3);
  assert.ok(onLine(corner, 'x', 16), JSON.stringify(ends(corner)));
  assert.ok(near(corner.dist, 1));
  // The middle of the room is out of a 3ft reach of everything.
  assert.equal(accentFaceAt(f, 10, 8, 3), null);
  assert.ok(accentFaceAt(f, 10, 8, 4.5), 'and inside a longer one');
  // Outside the building, a foot from A's west wall: the facade, not a room.
  assert.equal(accentFaceAt(f, 3, 8, 3), null);
  // The hall's side of the wall under A: the hall's own segment.
  const hall = accentFaceAt(f, 10, 12.5, 3);
  assert.equal(hall.shape.name, 'Hall');
  assert.ok(onLine(hall, 'z', 12));
});

test('an accent set through the picked face is in the file, and taking it off restores the bytes', () => {
  const s = twoRoomsAndAHall();
  const before = serialize(s);
  const face = accentFaceAt(s.floors[0], 16.5, 8, 3);
  setSegAccent(face.shape, face.ring, face.seg, '#D9A441');
  const painted = serialize(s);
  assert.notEqual(painted, before);
  assert.match(painted, /"accents":\[[^\]]*"#d9a441"/);
  setSegAccent(face.shape, face.ring, face.seg, null);
  assert.equal(serialize(s), before);
});
