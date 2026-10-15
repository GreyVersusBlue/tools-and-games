// The hipped roof over a curve (#967): the top storey's true outline, the
// eave round it, the faces cut into triangles, and the section's height. Run
// `node --test 'test/*.test.mjs'` from Projects/school-generator.
//
// Each piece is pure and checked by arithmetic before anything draws it, and
// the wiring is checked against the rule that decides its scope: only a hipped
// roof over a footprint with a curve in it takes the new path, and every other
// roof is what it was, point for point.

import test from 'node:test';
import assert from 'node:assert/strict';

import { roofOutline, hasCurve } from '../js/roof.js';
import { arcPoints } from '../js/shapes.js';
import { eavePolygon, cleanPolygon } from '../js/skeleton.js';

const room = (pts) => ({ rings: [{ pts: pts.map(([x, z]) => ({ x, z })), walls: [], openings: [] }] });
const floorOf = (...rooms) => ({ shapes: rooms });
const area = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
};
// A 40 by 24 room whose east wall bows out into an arc of `steps` chords.
const bowed = (bulge = 0.4, steps = 12, x0 = 0) => {
  const arc = arcPoints({ x: x0 + 40, z: 0 }, { x: x0 + 40, z: 24 }, -bulge, steps);
  return [[x0, 0], ...arc.map((p) => [p.x, p.z]), [x0, 24]];
};

// ---------- the outline ----------

test('two rooms sharing a wall are one ring, the shared wall gone', () => {
  const o = roofOutline(floorOf(room([[0, 0], [20, 0], [20, 16], [0, 16]]), room([[20, 0], [40, 0], [40, 16], [20, 16]])));
  assert.equal(o.loops.length, 1);
  assert.equal(o.loops[0].length, 4, 'the wall at x 20 left no corner behind');
  assert.equal(area(o.loops[0]), 640);
});

test('a wall met part way along by a neighbour is split there and the rest kept', () => {
  // A 40ft room with a 16ft room against the middle of its south wall: a T.
  const o = roofOutline(floorOf(room([[0, 0], [40, 0], [40, 16], [0, 16]]), room([[12, 16], [28, 16], [28, 32], [12, 32]])));
  assert.equal(o.loops.length, 1);
  assert.equal(o.loops[0].length, 8);
  assert.equal(area(o.loops[0]), 640 + 256);
});

test('either winding of a room reads the same', () => {
  const a = roofOutline(floorOf(room([[0, 0], [20, 0], [20, 16], [0, 16]]), room([[20, 16], [40, 16], [40, 0], [20, 0]])));
  assert.equal(a.loops.length, 1);
  assert.equal(area(a.loops[0]), 640);
});

test('a curved room keeps every chord of its curve', () => {
  const pts = bowed(0.4, 12);
  const o = roofOutline(floorOf(room(pts), room([[-20, 0], [0, 0], [0, 24], [-20, 24]])));
  assert.equal(o.loops.length, 1);
  // Thirteen arc points; the two at x 0 merge away with the neighbour.
  assert.equal(o.loops[0].length, 13 + 2);
  for (const p of pts.slice(1, -1)) {
    assert.ok(o.loops[0].some((q) => q.x === p[0] && q.z === p[1]), `chord end ${p} survived`);
  }
  assert.ok(Math.abs(area(o.loops[0]) - (Math.abs(area(pts.map(([x, z]) => ({ x, z })))) + 480)) < 1e-9);
});

test('separate buildings are separate loops', () => {
  const o = roofOutline(floorOf(room([[0, 0], [20, 0], [20, 16], [0, 16]]), room([[40, 0], [60, 0], [60, 16], [40, 16]])));
  assert.equal(o.loops.length, 2);
});

test('a courtyard is refused, and says so', () => {
  // Four rooms round an empty middle.
  const o = roofOutline(floorOf(
    room([[0, 0], [48, 0], [48, 12], [0, 12]]), room([[0, 36], [48, 36], [48, 48], [0, 48]]),
    room([[0, 12], [12, 12], [12, 36], [0, 36]]), room([[36, 12], [48, 12], [48, 36], [36, 36]]),
  ));
  assert.equal(o.loops, null);
  assert.match(o.refused, /courtyard/);
});

test('a room with a hole of its own is refused', () => {
  const sh = room([[0, 0], [40, 0], [40, 40], [0, 40]]);
  sh.rings.push({ pts: [{ x: 10, z: 10 }, { x: 10, z: 30 }, { x: 30, z: 30 }, { x: 30, z: 10 }], walls: [], openings: [] });
  const o = roofOutline(floorOf(sh));
  assert.equal(o.loops, null);
  assert.match(o.refused, /hole/);
});

test('overlapping rooms are refused, whether or not they share a wall', () => {
  const same = roofOutline(floorOf(room([[0, 0], [20, 0], [20, 16], [0, 16]]), room([[0, 0], [20, 0], [20, 16], [0, 16]])));
  assert.equal(same.loops, null);
  assert.match(same.refused, /overlap/);
  const across = roofOutline(floorOf(room([[0, 0], [20, 0], [20, 16], [0, 16]]), room([[10, 8], [30, 8], [30, 24], [10, 24]])));
  assert.equal(across.loops, null);
  assert.match(across.refused, /overlap/);
  const inside = roofOutline(floorOf(room([[0, 0], [40, 0], [40, 40], [0, 40]]), room([[10, 10], [20, 10], [20, 20], [10, 20]])));
  assert.equal(inside.loops, null, 'a room inside another');
});

test('two rooms meeting only at a corner are refused', () => {
  const o = roofOutline(floorOf(room([[0, 0], [20, 0], [20, 16], [0, 16]]), room([[20, 16], [40, 16], [40, 32], [20, 32]])));
  assert.equal(o.loops, null);
  assert.match(o.refused, /point/);
});

test('an empty storey is no loops, not a refusal', () => {
  assert.deepEqual(roofOutline(floorOf()), { loops: [] });
});

// ---------- what counts as a curve ----------

test('a curve is two skew chords in a row; a diagonal wall or an octagon is not', () => {
  const pts = (a) => a.map(([x, z]) => ({ x, z }));
  assert.equal(hasCurve(pts([[0, 0], [40, 0], [40, 16], [0, 16]])), false);
  assert.equal(hasCurve(pts([[0, 0], [40, 0], [40, 10], [34, 16], [0, 16]])), false, 'a chamfer');
  assert.equal(hasCurve(pts([[8, 0], [16, 0], [24, 8], [24, 16], [16, 24], [8, 24], [0, 16], [0, 8]])), false, 'an octagon');
  assert.equal(hasCurve(pts(bowed(0.4, 12))), true);
  assert.equal(hasCurve(pts(bowed(0.05, 2))), true, 'the shallowest arc a wall can be given');
  assert.equal(hasCurve(pts([[0, 0], [10, 0], [20, 6], [30, 16], [0, 16]])), true, 'two skew walls meeting are read as a curve');
});

test('a diagonal wall drawn as two collinear pieces is one wall, not a curve', () => {
  const o = roofOutline(floorOf(room([[0, 0], [40, 0], [30, 10], [20, 20], [0, 20]])));
  assert.equal(o.loops[0].length, 4);
  assert.equal(hasCurve(o.loops[0]), false);
});

// ---------- the eave ----------

const P = (a) => a.map(([x, z]) => ({ x, z }));
const lineDist = (a, b, p) =>
  ((p.x - a.x) * (b.z - a.z) - (p.z - a.z) * (b.x - a.x)) / Math.hypot(b.x - a.x, b.z - a.z);

test('the eave of a rectangle is the rectangle 1.5ft bigger all round', () => {
  const e = eavePolygon(P([[0, 0], [40, 0], [40, 20], [0, 20]]), 1.5);
  assert.deepEqual(e.map((p) => [p.x, p.z]), [[-1.5, -1.5], [41.5, -1.5], [41.5, 21.5], [-1.5, 21.5]]);
});

test('every eave edge runs parallel to its wall, 1.5ft outside it, round a curve too', () => {
  for (const pts of [bowed(0.4, 12), bowed(0.9, 32), bowed(-0.2, 8), bowed(0.05, 2)]) {
    const poly = cleanPolygon(P(pts));
    const e = eavePolygon(poly, 1.5);
    assert.ok(e, `bulge ${pts.length}`);
    assert.equal(e.length, poly.length);
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      // Outward is the right-hand side of a wall walked counter-clockwise,
      // which `lineDist` counts positive.
      assert.ok(Math.abs(lineDist(a, b, e[i]) - 1.5) < 1e-9, `edge ${i} start`);
      assert.ok(Math.abs(lineDist(a, b, e[(i + 1) % e.length]) - 1.5) < 1e-9, `edge ${i} end`);
    }
    assert.ok(Math.abs(area(e)) > Math.abs(area(poly)), 'outward, not inward');
    assert.ok(cleanPolygon(e), 'and still a simple polygon');
  }
});

test('a curve bowed into the building tighter than the eave is refused, a looser one is not', () => {
  // A 40 by 24 room whose east wall is pushed in by a semicircle of radius r.
  const dented = (r, steps = 16) => {
    const arc = arcPoints({ x: 40, z: 12 - r }, { x: 40, z: 12 + r }, 0.5, steps);
    return P([[0, 0], [40, 0], ...arc.map((p) => [p.x, p.z]), [40, 24], [0, 24]]);
  };
  assert.ok(cleanPolygon(dented(1)), 'the room itself is fine');
  assert.equal(eavePolygon(dented(1), 1.5), null, 'r 1ft under a 1.5ft eave');
  assert.equal(eavePolygon(dented(1.4), 1.5), null, 'r 1.4ft');
  assert.ok(eavePolygon(dented(4), 1.5), 'r 4ft');
  assert.ok(eavePolygon(dented(10), 1.5), 'r 10ft');
});

test('a notch narrower than two eaves closes up and is refused', () => {
  const notch = (w) => P([[0, 0], [40, 0], [40, 10], [20 + w / 2, 10], [20 + w / 2, 4], [20 - w / 2, 4], [20 - w / 2, 10], [0, 10]]);
  assert.equal(eavePolygon(notch(2), 1.5), null);
  assert.ok(eavePolygon(notch(4), 1.5));
});
