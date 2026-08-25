// The minimap: the transform between world feet and thumbnail pixels, and
// the two decisions that transform encodes — how much you can see, and which
// way is up.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MODES, ORIENTS, MINI_SIZE, MINI_RANGE, MIN_RANGE, MAX_RANGE, FIT_PAD, CONE_LEN,
  nextMode, nextOrient, clampCentre, minimapView, worldToMini, miniToWorld,
  inView, visibleWindow, markerAngle, viewCone, scaleBar, describeMinimap,
  findingMarks, markAt, markOnFloor, describeMark, markFill, markLine,
} from '../js/minimap.js';
import { buildSampleSchool } from '../js/sample.js';
import { buildReport } from '../js/report.js';

const bounds = { minX: 0, minZ: 0, maxX: 300, maxZ: 200 };
const eye = (x, z, yaw = 0) => ({ x, y: 5.5, z, yaw });

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('the two modes and two orientations cycle', () => {
  assert.equal(nextMode('fit'), 'follow');
  assert.equal(nextMode('follow'), 'fit');
  assert.equal(nextOrient('north'), 'heading');
  assert.equal(nextOrient('heading'), 'north');
  assert.deepEqual(MODES, ['fit', 'follow']);
  assert.deepEqual(ORIENTS, ['north', 'heading']);
});

test('a hostile view spec lands on the defaults rather than on NaN', () => {
  const view = minimapView(null, {}, { mode: 'nope', orient: 'nope', size: NaN, range: NaN });
  assert.equal(view.mode, 'follow');
  assert.equal(view.orient, 'heading');
  assert.equal(view.size, MINI_SIZE);
  assert.equal(view.range, MINI_RANGE);
  assert.ok(Number.isFinite(view.scale) && view.scale > 0);
  assert.ok(Number.isFinite(worldToMini(view, 3, 4).x));
});

test('the walker is at the middle of a follow map, whichever way it points', () => {
  for (const orient of ORIENTS) {
    const view = minimapView(bounds, eye(150, 100, 1.2), { orient });
    const p = worldToMini(view, 150, 100);
    assert.ok(near(p.x, view.size / 2, 1e-9), orient);
    assert.ok(near(p.y, view.size / 2, 1e-9), orient);
  }
});

test('north-up puts world +x right and world +z down', () => {
  const view = minimapView(bounds, eye(150, 100), { orient: 'north', range: 100 });
  const right = worldToMini(view, 160, 100);
  const down = worldToMini(view, 150, 110);
  assert.ok(right.x > view.size / 2 && near(right.y, view.size / 2));
  assert.ok(down.y > view.size / 2 && near(down.x, view.size / 2));
});

test('heading-up puts whatever you are looking at straight up the map', () => {
  for (const yaw of [0, 0.7, Math.PI / 2, 2.9, -1.4]) {
    const view = minimapView(bounds, eye(150, 100, yaw), { orient: 'heading', range: 100 });
    // 20ft along the camera's own forward vector.
    const fx = 150 - Math.sin(yaw) * 20;
    const fz = 100 - Math.cos(yaw) * 20;
    const p = worldToMini(view, fx, fz);
    assert.ok(near(p.x, view.size / 2, 1e-6), `yaw ${yaw}: x drifted to ${p.x}`);
    assert.ok(p.y < view.size / 2 - 1, `yaw ${yaw}: not above centre`);
  }
});

test('the transform is its own inverse, in both orientations', () => {
  for (const orient of ORIENTS) {
    const view = minimapView(bounds, eye(120, 80, 0.9), { orient });
    for (const [x, z] of [[0, 0], [300, 200], [77, 133]]) {
      const p = worldToMini(view, x, z);
      const back = miniToWorld(view, p.x, p.y);
      assert.ok(near(back.x, x, 1e-6) && near(back.z, z, 1e-6), `${orient} ${x},${z}`);
    }
  }
});

test('a fitted map shows the whole storey with a margin', () => {
  const view = minimapView(bounds, eye(10, 10), { mode: 'fit', orient: 'north' });
  for (const [x, z] of [[0, 0], [300, 0], [300, 200], [0, 200]]) {
    const p = worldToMini(view, x, z);
    assert.ok(p.x >= 0 && p.x <= view.size, `corner ${x},${z} off the map`);
    assert.ok(p.y >= 0 && p.y <= view.size);
  }
  // ...and the margin is real: the outer wall is not drawn on the bezel.
  const corner = worldToMini(view, 0, 0);
  assert.ok(corner.x > 0.5, 'padded');
  assert.ok(view.range >= 300 + FIT_PAD * 2);
});

test('a fitted map that turns still shows its corners', () => {
  for (const yaw of [0, 0.6, 1.1, 2.2]) {
    const view = minimapView(bounds, eye(150, 100, yaw), { mode: 'fit', orient: 'heading' });
    for (const [x, z] of [[0, 0], [300, 0], [300, 200], [0, 200]]) {
      const p = worldToMini(view, x, z);
      assert.ok(p.x >= -0.01 && p.x <= view.size + 0.01, `yaw ${yaw} corner ${x},${z}`);
      assert.ok(p.y >= -0.01 && p.y <= view.size + 0.01);
    }
  }
});

test('a north-up follow window stays inside the plan at a corner of the building', () => {
  const view = minimapView(bounds, eye(2, 2), { orient: 'north', range: 100 });
  const win = visibleWindow(view);
  assert.ok(win.minX >= bounds.minX - 1e-6, `ran off the west edge to ${win.minX}`);
  assert.ok(win.minZ >= bounds.minZ - 1e-6);
  assert.ok(win.maxX <= bounds.maxX + 1e-6);
  const far = minimapView(bounds, eye(299, 199), { orient: 'north', range: 100 });
  assert.ok(visibleWindow(far).maxX <= bounds.maxX + 1e-6);
});

test('a plan smaller than the window is centred rather than shoved into a corner', () => {
  const small = { minX: 0, minZ: 0, maxX: 40, maxZ: 30 };
  const c = clampCentre(small, 2, 2, 50, 50);
  assert.equal(c.cx, 20);
  assert.equal(c.cz, 15);
  const c2 = clampCentre({ minX: 0, minZ: 0, maxX: 400, maxZ: 30 }, 5, 5, 50, 50);
  assert.equal(c2.cx, 50, 'clamped on the long axis');
  assert.equal(c2.cz, 15, 'centred on the short one');
});

test('the follow range is clamped to something readable', () => {
  assert.equal(minimapView(bounds, eye(0, 0), { range: 1 }).range, MIN_RANGE);
  assert.equal(minimapView(bounds, eye(0, 0), { range: 99999 }).range, MAX_RANGE);
  assert.ok(minimapView(bounds, eye(0, 0), { range: 120 }).scale > 0);
});

test('the visible window shrinks as you zoom in', () => {
  const wide = visibleWindow(minimapView(bounds, eye(150, 100), { orient: 'north', range: 200 }));
  const tight = visibleWindow(minimapView(bounds, eye(150, 100), { orient: 'north', range: 60 }));
  assert.ok(tight.maxX - tight.minX < wide.maxX - wide.minX);
});

test('culling answers for the things on and off the map', () => {
  const view = minimapView(bounds, eye(150, 100), { orient: 'north', range: 100 });
  assert.ok(inView(view, 150, 100));
  assert.equal(inView(view, 230, 100), false, 'past the edge of a 100ft window');
  assert.ok(inView(view, 230, 100, 60), 'padding widens the net');
  assert.ok(!inView(view, 1000, 1000, 10));
});

test('the marker turns under north-up and stands still under heading-up', () => {
  const north = minimapView(bounds, eye(0, 0, 1.2), { orient: 'north' });
  assert.ok(near(markerAngle(north, 1.2), 1.2));
  const heading = minimapView(bounds, eye(0, 0, 1.2), { orient: 'heading' });
  assert.ok(near(markerAngle(heading, 1.2), 0), 'the map turned, so the marker need not');
});

test('the view cone opens ahead of the walker', () => {
  const view = minimapView(bounds, eye(150, 100, 0), { orient: 'north', range: 200 });
  const cone = viewCone(view, eye(150, 100, 0));
  assert.ok(near(cone.at.x, view.size / 2) && near(cone.at.y, view.size / 2));
  assert.ok(cone.left.y < cone.at.y && cone.right.y < cone.at.y, 'both arms point up-map');
  assert.ok(cone.left.x < cone.at.x && cone.right.x > cone.at.x, 'left arm to the west, right arm to the east');
  assert.equal(cone.len, CONE_LEN);
});

test('the cone follows the heading it is given', () => {
  const view = minimapView(bounds, eye(150, 100, 0), { orient: 'north', range: 200 });
  const east = viewCone(view, eye(150, 100, -Math.PI / 2));
  assert.ok(east.left.x > east.at.x && east.right.x > east.at.x, 'looking east, both arms are east');
});

test('the scale bar picks a round number that fits', () => {
  const view = minimapView(bounds, eye(0, 0), { range: 90, size: 168 });
  const bar = scaleBar(view);
  assert.ok([5, 10, 20, 25, 50].includes(bar.ft), `got ${bar.ft}`);
  assert.ok(bar.px > 0 && bar.px < view.size);
  assert.match(bar.label, /^\d+ ft$/);
  const wide = scaleBar(minimapView(bounds, eye(0, 0), { mode: 'fit' }));
  assert.ok(wide.ft >= bar.ft);
});

test('the readout says what the map is doing', () => {
  assert.match(describeMinimap(minimapView(bounds, eye(0, 0), { mode: 'fit', orient: 'north' })), /whole floor · north up/);
  assert.match(describeMinimap(minimapView(bounds, eye(0, 0), { range: 90, orient: 'heading' })), /90 ft across · heading up/);
  assert.equal(describeMinimap(null), '');
});


// ---------- the findings, on the plan ----------

const report = (findings) => ({ findings });

test('a finding with nowhere to point is not a mark', () => {
  const marks = findingMarks(report([
    { level: 'fail', code: 'exit-count', title: 'Not enough exits', detail: '' },
    { level: 'warn', code: 'no-rooms', title: 'Nothing at all', detail: '', rooms: [] },
  ]));
  assert.deepEqual(marks, []);
});

test('rooms and doorways both become marks, in the report\'s own order', () => {
  const marks = findingMarks(report([
    {
      level: 'fail', code: 'travel-distance', section: 'egress',
      title: 'Too far', detail: 'x',
      rooms: [{ id: 'r0:g4', floor: 0, name: 'Hall' }, { id: 'r1:s2', floor: 1, name: 'Lab' }],
    },
    {
      level: 'note', code: 'narrow-doors', section: 'accessible',
      title: 'Narrow', detail: 'y',
      doors: [{ id: 'p3', floor: 0, x: 40, z: 12, w: 2.5 }],
    },
  ]));
  assert.equal(marks.length, 2);
  assert.equal(marks[0].code, 'travel-distance');
  assert.deepEqual(marks[0].floors, [0, 1]);
  assert.equal(marks[1].doors.length, 1);
  assert.deepEqual(marks[1].floors, [0]);
  // Only what is on the storey being drawn gets drawn.
  assert.equal(markOnFloor(marks[0], 0).rooms.length, 1);
  assert.equal(markOnFloor(marks[0], 1).rooms.length, 1);
  assert.equal(markOnFloor(marks[0], 2).rooms.length, 0);
});

test('the index wraps in both directions', () => {
  const marks = findingMarks(report([
    { level: 'fail', code: 'a', title: 'A', rooms: [{ id: 'r0:g1', floor: 0 }] },
    { level: 'warn', code: 'b', title: 'B', rooms: [{ id: 'r0:g2', floor: 0 }] },
  ]));
  assert.equal(markAt(marks, 0).code, 'a');
  assert.equal(markAt(marks, 2).code, 'a');
  assert.equal(markAt(marks, -1).code, 'b');
  assert.equal(markAt([], 0), null);
});

test('the caption says which finding, and where to go to see it', () => {
  const marks = findingMarks(report([
    { level: 'warn', code: 'a', title: 'Two doors wanted', rooms: [{ id: 'r1:g1', floor: 1 }] },
  ]));
  assert.match(describeMark(marks, 0, 1), /^1\/1 · Two doors wanted \(1 here\)$/);
  assert.match(describeMark(marks, 0, 0), /try Level 2/);
  assert.equal(describeMark([], 0, 0), '');
});

test('every level has a wash and a line, and an unknown one falls back', () => {
  for (const level of ['fail', 'warn', 'note', 'ok']) {
    assert.ok(markFill(level).startsWith('rgba('));
    assert.ok(markLine(level).startsWith('rgba('));
  }
  assert.equal(markFill('nonsense'), markFill('note'));
  assert.equal(markLine(undefined), markLine('note'));
});

test('the sample school produces marks a map could draw', () => {
  const marks = findingMarks(buildReport(buildSampleSchool(), { takeoff: false, acoustics: false }));
  for (const m of marks) {
    assert.ok(m.rooms.length || m.doors.length);
    assert.ok(m.floors.length);
    assert.ok(m.title);
  }
});
