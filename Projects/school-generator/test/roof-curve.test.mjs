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

import { roofOutline, hasCurve, roofPlan, roofMask, EAVE, curvedRoofs } from '../js/roof.js';
import { arcPoints, addShape, curveSegment } from '../js/shapes.js';
import { createState, CELL, WALL_H, floorBaseY } from '../js/grid.js';
import { roofHeightAt, computeElevation, computeSection } from '../js/elevation.js';
import { eavePolygon, cleanPolygon, skeletonRoof, triangulate, roofHeightOver } from '../js/skeleton.js';

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

// Two rooms meeting only at a corner were refused here until #976, which
// splits them into a loop each: test/roof-pinch.test.mjs.

test('an empty storey is no loops, not a refusal', () => {
  assert.deepEqual(roofOutline(floorOf()), { loops: [] });
});

// ---------- what counts as a curve ----------

test('a curve is three equal chords turning equally; straight walls at angles are not', () => {
  const pts = (a) => a.map(([x, z]) => ({ x, z }));
  const ngon = (k, r, rot = 0) => Array.from({ length: k }, (_, i) =>
    ({ x: 50 + r * Math.cos(rot + (2 * Math.PI * i) / k), z: 50 + r * Math.sin(rot + (2 * Math.PI * i) / k) }));
  assert.equal(hasCurve(pts([[0, 0], [40, 0], [40, 16], [0, 16]])), false);
  assert.equal(hasCurve(pts([[0, 0], [40, 0], [40, 10], [34, 16], [0, 16]])), false, 'a chamfer');
  assert.equal(hasCurve(pts([[8, 0], [16, 0], [24, 8], [24, 16], [16, 24], [8, 24], [0, 16], [0, 8]])), false, 'an octagon');
  // test/fixtures/plan-v5.json's wing: two skew walls of one length, at a right angle.
  assert.equal(hasCurve(pts([[4, 4], [36, 4], [36, 16], [56, 12], [60, 32], [36, 28], [36, 24], [4, 24]])), false, 'plan-v5');
  assert.equal(hasCurve(ngon(4, 20, 0.5)), false, 'a rotated square');
  assert.equal(hasCurve(pts([[0, 0], [10, 0], [20, 6], [30, 16], [0, 16]])), false, 'two skew walls');
  assert.equal(hasCurve(pts(bowed(0.4, 12))), true);
  assert.equal(hasCurve(pts(bowed(0.4))), true, 'the steps the curve tool picks');
  assert.equal(hasCurve(pts(bowed(0.9, 3))), true, 'three chords round most of a circle');
  assert.equal(hasCurve(pts(bowed(0.5, 3))), true, 'a semicircle whose middle chord runs along z');
  // Two chords were not read as a curve until #976: test/roof-pinch.test.mjs.
  assert.equal(hasCurve(pts(bowed(0.05, 2))), true, 'two chords bowed off a square wall');
  // Walk a path of (length, turn in degrees) steps from the origin, then home.
  const walk = (steps) => {
    let x = 0, z = 0, h = 0;
    const out = [{ x, z }];
    for (const [l, deg] of steps) {
      h += (deg * Math.PI) / 180;
      x += l * Math.cos(h); z += l * Math.sin(h);
      out.push({ x, z });
    }
    return out;
  };
  assert.equal(hasCurve(walk([[10, 0], [10, 40], [10, -80], [10, 80], [40, 100]])), false, 'an S of equal walls');
  assert.equal(hasCurve(walk([[10, 0], [10, 30], [15, 30], [20, 30], [40, 120]])), false, 'equal turns, walls lengthening');
  assert.equal(hasCurve(pts([[0, 0], [10, 0], [20, 0], [30, 0], [30, 10], [0, 10]])), false, 'a wall in three equal pieces');
  assert.equal(hasCurve(ngon(5, 20, 0.3)), true, 'a regular pentagon, meant');
  assert.equal(hasCurve(ngon(12, 20)), true, 'a regular 12-gon, meant');
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

// ---------- the faces, in triangles ----------

const inPoly = (pts, x, z) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
};
const crosses = (a, b, c, d) => {
  const o = (p, q, r) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const e = 1e-9;
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > e && d2 < -e) || (d1 < -e && d2 > e)) && ((d3 > e && d4 < -e) || (d3 < -e && d4 > e));
};
// Every triangle wound like the face, inside it (its middle inside, none of
// its sides crossing the face's), and the areas adding up to the face's.
function assertTiles(face, tris, label) {
  assert.ok(tris, `${label}: no triangles`);
  const sign = Math.sign(area(face));
  let sum = 0;
  for (const [a, b, c] of tris) {
    const tri = [face[a], face[b], face[c]];
    const ar = area(tri) * sign;
    assert.ok(ar > 1e-12, `${label}: triangle ${a},${b},${c} wound backward or flat`);
    sum += ar;
    const mx = (tri[0].x + tri[1].x + tri[2].x) / 3, mz = (tri[0].z + tri[1].z + tri[2].z) / 3;
    assert.ok(inPoly(face, mx, mz), `${label}: triangle ${a},${b},${c} lies outside its face`);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < face.length; j++) {
        assert.ok(!crosses(tri[i], tri[(i + 1) % 3], face[j], face[(j + 1) % face.length]),
          `${label}: triangle ${a},${b},${c} crosses the face's side ${j}`);
      }
    }
  }
  const want = Math.abs(area(face));
  assert.ok(Math.abs(sum - want) < 1e-9 * (1 + want), `${label}: ${sum} against ${want}`);
}

test('a non-convex face is cut into triangles inside it, where a fan from its first point is not', () => {
  // An L's long slope: eave along the bottom, ridge, valley, short ridge.
  const face = P([[0, 0], [40, 0], [30, 10], [30, 30], [20, 20], [10, 10]]);
  const fan = face.slice(1, -1).map((_, i) => [0, i + 1, i + 2]);
  assert.throws(() => assertTiles(face, fan, 'fan'), /outside|crosses|backward/, 'the old fan really is wrong here');
  // From every corner, either way round, and with a corner that does not
  // turn put in the middle of the eave.
  const withFlat = P([[0, 0], [20, 0], [40, 0], [30, 10], [30, 30], [20, 20], [10, 10]]);
  for (const f of [face, withFlat]) {
    for (let k = 0; k < f.length; k++) {
      const turned = [...f.slice(k), ...f.slice(0, k)];
      assertTiles(turned, triangulate(turned), `ear clip from ${k}`);
      const back = [...turned].reverse();
      assertTiles(back, triangulate(back), `ear clip from ${k}, wound back`);
    }
  }
});

test('every face of every curved roof is cut into triangles inside it', () => {
  const shapes = [bowed(0.4, 12), bowed(0.9, 32), bowed(-0.2, 8), bowed(0.05, 2),
    [[0, 0], [60, 0], ...arcPoints({ x: 60, z: 0 }, { x: 60, z: 40 }, -0.5, 24).slice(1, -1).map((p) => [p.x, p.z]),
      [60, 40], [40, 40], [40, 20], [20, 20], [20, 40], [0, 40]]];
  let faces = 0;
  for (const s of shapes) {
    const roof = skeletonRoof(eavePolygon(P(s), 1.5), 12, 4);
    assert.ok(roof);
    for (const f of roof.faces) {
      assertTiles(f.pts, triangulate(f.pts), `face ${f.edge} of a ${s.length}-gon`);
      faces++;
    }
  }
  assert.ok(faces > 60);
});

// ---------- the section's height ----------

// A seeded walk, so a failure names a point that can be found again.
const rand = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();

test('over a convex curved roof the height is the eave plus the pitch times the distance to the nearest wall line', () => {
  // On a convex footprint every face's plane is that arithmetic, which
  // is a fact about hips and not the skeleton's own code.
  // Under half a circle, so the corners where the arc meets the straight
  // walls still turn the same way and the footprint is convex.
  for (const s of [bowed(0.4, 12), bowed(0.45, 32), bowed(0.05, 2)]) {
    const eave = eavePolygon(P(s), 1.5);
    const roof = skeletonRoof(eave, 12, 6);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of eave) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    let n = 0;
    for (let k = 0; k < 400; k++) {
      const x = x0 + (x1 - x0) * rand(), z = z0 + (z1 - z0) * rand();
      const y = roofHeightOver(roof.faces, x, z);
      if (!inPoly(eave, x, z)) { if (y !== null) assert.ok(Math.abs(y - 12) < 1e-6, 'only the eave line itself is on it'); continue; }
      let d = Infinity;
      for (let i = 0; i < eave.length; i++) d = Math.min(d, -lineDist(eave[i], eave[(i + 1) % eave.length], { x, z }));
      assert.ok(Math.abs(y - (12 + (6 / 12) * d)) < 1e-6, `(${x}, ${z}): ${y} against ${12 + d / 2}`);
      n++;
    }
    assert.ok(n > 150, 'enough of the points fell on the roof');
  }
});

test('over a non-convex curved roof the height is each face\'s plane, continuous across every hip and valley', () => {
  const s = [[0, 0], [60, 0], ...arcPoints({ x: 60, z: 0 }, { x: 60, z: 40 }, -0.5, 24).slice(1, -1).map((p) => [p.x, p.z]),
    [60, 40], [40, 40], [40, 20], [20, 20], [20, 40], [0, 40]];
  const roof = skeletonRoof(eavePolygon(P(s), 1.5), 12, 4);
  for (const f of roof.faces) {
    // Every corner of a face sits on its own plane...
    for (const p of f.pts) assert.ok(Math.abs(roofHeightOver([f], p.x, p.z) - p.y) < 1e-6);
    // ...and a point inside it, nudged along a side, reads the same from either face that side borders.
    for (let i = 0; i < f.pts.length; i++) {
      const a = f.pts[i], b = f.pts[(i + 1) % f.pts.length];
      const m = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      const y = roofHeightOver(roof.faces, m.x, m.z);
      assert.ok(Math.abs(y - (a.y + b.y) / 2) < 1e-6, `face ${f.edge} side ${i}: ${y} against ${(a.y + b.y) / 2}`);
    }
  }
  assert.equal(roofHeightOver(roof.faces, 30, 35), null, 'the courtyard of the U is not under the roof');
  assert.equal(roofHeightOver(roof.faces, -10, 10), null);
});

// ---------- the wiring ----------

const R4 = (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
// A school of two buildings on one storey: a 40 by 24 hall with its east wall
// bowed out by the curve tool, against a 16ft room on its west side, and a
// separate L-shaped block to the south that has no curve at all.
function school({ curve = true, style = 'hip', pitch = 6, courtyard = false } = {}) {
  const s = createState(30, 30);
  const hall = addShape(s, 0, R4(24, 8, 64, 32));
  addShape(s, 0, R4(8, 8, 24, 32));
  if (courtyard) {
    // Close the hall's north side into a ring round an open middle.
    addShape(s, 0, R4(8, -24, 64, -12));
    addShape(s, 0, R4(8, -12, 20, 8));
    addShape(s, 0, R4(52, -12, 64, 8));
  }
  addShape(s, 0, R4(8, 60, 48, 76));
  addShape(s, 0, R4(8, 76, 24, 100));
  if (curve) {
    // Segment 1 is the hall's east wall, (64, 8) to (64, 32); a negative
    // bulge bows it out of the room, to x 73.6.
    assert.ok(curveSegment(hall, 0, 1, -0.4) > 3, 'the curve tool laid a curve');
  }
  s.roof = { style, pitch, facade: 'brick' };
  return s;
}
const strip = (b) => JSON.parse(JSON.stringify(b));

test('a hipped roof over a curve is one skeleton block, and the straight-walled building beside it is not touched', () => {
  const s = school();
  const plan = roofPlan(s);
  const sk = plan.blocks.filter((b) => b.skeleton);
  assert.equal(sk.length, 1);
  assert.ok(hasCurve(sk[0].outline));
  assert.ok(sk[0].faces.length > 10, 'a face per wall and per chord');
  assert.ok(sk[0].faces.every((f) => f.tris && f.tris.length), 'every face brings its triangles');
  // The L to the south: the same blocks, point for point, as a school whose hall has no curve.
  const before = roofPlan(school({ curve: false })).blocks.filter((b) => b.rect.z0 >= 60);
  const after = plan.blocks.filter((b) => !b.skeleton);
  assert.ok(after.length >= 2);
  assert.deepEqual(strip(after), strip(before));
  assert.ok(after.every((b) => b.rect.z0 >= 60), 'no rectangle is left over the curved hall');
});

test('a curved roof starts 1.5ft outside the walls at the eave height and rises at the pitch', () => {
  const s = school();
  const plan = roofPlan(s);
  const [sk] = plan.blocks.filter((b) => b.skeleton);
  const eaveY = floorBaseY(s, 0) + WALL_H;
  assert.equal(plan.eaveY, eaveY);
  for (const f of sk.faces) {
    assert.equal(f.pts[0].y, eaveY);
    assert.equal(f.pts[1].y, eaveY);
  }
  for (let i = 0; i < sk.outline.length; i++) {
    const a = sk.outline[i], b = sk.outline[(i + 1) % sk.outline.length];
    assert.ok(Math.abs(lineDist(a, b, sk.eave[i]) - EAVE) < 1e-9);
  }
  // The hall and its neighbour are 24ft deep, so the eave line is 27ft
  // across and the ridge stands half of that, at 6 in 12, over the eave.
  assert.ok(Math.abs(sk.rise - 13.5 * 0.5) < 1e-9, `rise ${sk.rise}`);
  assert.equal(plan.rise, Math.max(sk.rise, ...plan.blocks.map((b) => b.rise)));
});

test('the deck under the curved roof goes, and the straight building keeps its own', () => {
  const plan = roofPlan(school());
  const plain = roofPlan(school({ curve: false }));
  assert.deepEqual(strip(plan.deckRects), strip(plain.deckRects.filter((r) => r.z0 >= 60)));
});

test('only the hipped style takes the new path', () => {
  for (const style of ['gable', 'parapet', 'flat']) {
    const plan = roofPlan(school({ style }));
    assert.ok(!plan.blocks.some((b) => b.skeleton), style);
  }
  assert.ok(!roofPlan(school({ curve: false })).blocks.some((b) => b.skeleton), 'no curve, no skeleton');
});

test('a curve on a courtyard keeps the rectangles, the outline having said why', () => {
  const s = school({ courtyard: true });
  assert.match(roofOutline(s.floors[0]).refused, /courtyard/);
  const plan = roofPlan(s);
  assert.ok(!plan.blocks.some((b) => b.skeleton));
  assert.ok(plan.blocks.length > 2);
});

test('a curve too tight for the eave stands on its skeleton, the eave closed over it (#993)', () => {
  // A semicircular dent 1ft in radius in the hall's east wall: the mitred
  // eave crosses itself there (see the eave tests), and the wavefront closes
  // the dent instead; test/roof-tightcurve.test.mjs has the figures.
  const s = createState(30, 30);
  const arc = arcPoints({ x: 64, z: 19 }, { x: 64, z: 21 }, 0.5, 8);
  addShape(s, 0, [{ x: 24, z: 8 }, { x: 64, z: 8 }, ...arc, { x: 64, z: 32 }, { x: 24, z: 32 }]);
  s.roof = { style: 'hip', pitch: 6 };
  assert.ok(hasCurve(roofOutline(s.floors[0]).loops[0]));
  assert.equal(curvedRoofs(s.floors[0], 12, 6).length, 1);
  assert.ok(roofPlan(s).blocks.some((b) => b.skeleton));
});

test('the section reads a curved roof off its faces, and nothing past its walls', () => {
  const s = school();
  const plan = roofPlan(s);
  const [sk] = plan.blocks.filter((b) => b.skeleton);
  const mask = roofMask(s.floors[0], s.w, s.h);
  // Inside the walls, the face's plane, which on this convex hall is the
  // eave plus the pitch times the distance in from the nearest eave line.
  for (const [x, z] of [[10, 10], [30, 20], [60, 20], [70, 20], [72.5, 15]]) {
    const y = roofHeightAt(plan, mask, x, z);
    let d = Infinity;
    for (let i = 0; i < sk.eave.length; i++) d = Math.min(d, -lineDist(sk.eave[i], sk.eave[(i + 1) % sk.eave.length], { x, z }));
    assert.ok(Math.abs(y - (plan.eaveY + 0.5 * d)) < 1e-6, `(${x}, ${z}): ${y}`);
  }
  // A cell the mask turned on past the curve (its middle is inside the hall,
  // its corner is not) reads as nothing overhead outside the wall.
  let found = 0;
  for (let c = 0; c < mask.w; c++) {
    for (let r = 0; r < mask.h; r++) {
      if (!mask.on[r * mask.w + c]) continue;
      for (const [fx, fz] of [[0.02, 0.02], [0.98, 0.02], [0.02, 0.98], [0.98, 0.98]]) {
        const x = (mask.cx0 + c + fx) * CELL, z = (mask.cy0 + r + fz) * CELL;
        if (inPoly(sk.outline, x, z) || z >= 60) continue;
        assert.equal(roofHeightAt(plan, mask, x, z), null, `(${x}, ${z}) is outside the hall`);
        found++;
      }
    }
  }
  assert.ok(found > 0, 'the test found a cell corner past the curve');
  // The L to the south reads as it always did.
  const plain = roofPlan(school({ curve: false }));
  const plainMask = roofMask(school({ curve: false }).floors[0], 30, 30);
  for (const [x, z] of [[10, 62], [20, 70], [30, 75], [15, 90], [46, 61]]) {
    assert.equal(roofHeightAt(plan, mask, x, z), roofHeightAt(plain, plainMask, x, z), `(${x}, ${z})`);
  }
  // And a cut across the hall's curve draws the roof up to the ridge and back.
  const sec = computeSection(s, { ax: 0, az: 20, bx: 90, bz: 20 });
  const ys = sec.roofline.flat().map((p) => p.y);
  assert.ok(Math.abs(Math.max(...ys) - (plan.eaveY + sk.rise)) < 0.6);
});

test('the elevation draws the curved roof\'s faces, up to its ridge', () => {
  const s = school();
  const plan = roofPlan(s);
  const [sk] = plan.blocks.filter((b) => b.skeleton);
  const el = computeElevation(s, 'e');
  const roofs = el.paints.filter((p) => p.kind === 'roof');
  const top = Math.max(...roofs.flatMap((p) => p.poly.map((q) => q.y)));
  assert.ok(Math.abs(top - (plan.eaveY + sk.rise)) < 1e-9, `${top}`);
});
