// The straight skeleton and the hipped roof over it. Run
// `node --test 'test/*.test.mjs'` from Projects/school-generator.
//
// Checked as arithmetic, the way roof.test.mjs checks the rectangles: a
// rectangle's skeleton roof is blockRoof's hip point for point, an L's ridges
// and valley sit where a pencil puts them, a regular polygon is a cone to its
// apothem, and on every shape every face is one plane at the pitch through
// its own eave, the faces tile the footprint exactly once, and the skeleton
// is a tree. Those last three are what a wrong event, a missed merge or a
// face walked the wrong way round breaks first.

import test from 'node:test';
import assert from 'node:assert/strict';

import { blockRoof, DEFAULT_PITCH } from '../js/roof.js';
import { cleanPolygon, straightSkeleton, skeletonRoof } from '../js/skeleton.js';

const R = (x0, z0, x1, z1) => [
  { x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 },
];
const L_SHAPE = [
  { x: 0, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 20 }, { x: 20, z: 20 }, { x: 20, z: 40 }, { x: 0, z: 40 },
];
const U_SHAPE = [
  { x: 0, z: 0 }, { x: 60, z: 0 }, { x: 60, z: 40 }, { x: 40, z: 40 },
  { x: 40, z: 20 }, { x: 20, z: 20 }, { x: 20, z: 40 }, { x: 0, z: 40 },
];
const T_SHAPE = [
  { x: 0, z: 0 }, { x: 60, z: 0 }, { x: 60, z: 20 }, { x: 40, z: 20 },
  { x: 40, z: 50 }, { x: 20, z: 50 }, { x: 20, z: 20 }, { x: 0, z: 20 },
];
// Four arms of one width whose two sides all meet at the middle at once.
const PLUS = [
  { x: 20, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 20 }, { x: 70, z: 20 }, { x: 70, z: 40 }, { x: 40, z: 40 },
  { x: 40, z: 65 }, { x: 20, z: 65 }, { x: 20, z: 40 }, { x: 0, z: 40 }, { x: 0, z: 20 }, { x: 20, z: 20 },
];
const regular = (k, r) => Array.from({ length: k }, (_, i) => ({
  x: r * Math.cos((2 * Math.PI * i) / k), z: r * Math.sin((2 * Math.PI * i) / k),
}));
// A 40ft by 20ft room whose far wall is curved through `k` chords, out by
// `bulge` feet (in, for a negative one), the way shapes.js leaves a curved
// wall: real vertices, no memory of the arc.
const arcRoom = (k, bulge) => {
  const pts = [{ x: 0, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 20 }];
  for (let i = 1; i < k; i++) {
    const th = (Math.PI * i) / k;
    pts.push({ x: 20 + 20 * Math.cos(th), z: 20 + bulge * Math.sin(th) });
  }
  pts.push({ x: 0, z: 20 });
  return pts;
};

const area = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
};

// The checks every shape has to pass.
function wellFormed(name, input, pitch = DEFAULT_PITCH) {
  const eaveY = 10;
  const sk = straightSkeleton(input);
  assert.ok(sk, `${name}: refused`);
  const roof = skeletonRoof(input, eaveY, pitch);
  const n = sk.poly.length;
  assert.equal(sk.faces.length, n, `${name}: one face per edge`);
  assert.equal(roof.faces.length, n, `${name}: one roof face per edge`);
  // A tree: every node joined, no cycle, no arc laid twice.
  assert.equal(sk.arcs.length, sk.nodes.length - 1, `${name}: the skeleton is a tree`);
  // Each face is one plane: a point's height over the eave is the pitch times
  // its distance from that face's own eave line.
  let worst = 0;
  for (const f of roof.faces) {
    const a = sk.poly[f.edge], b = sk.poly[(f.edge + 1) % n];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len;
    assert.deepEqual([f.pts[0].x, f.pts[0].z, f.pts[1].x, f.pts[1].z], [a.x, a.z, b.x, b.z],
      `${name}: face ${f.edge} starts on its eave`);
    for (const p of f.pts) {
      const d = nx * (p.x - a.x) + nz * (p.z - a.z);
      assert.ok(d >= -1e-9, `${name}: face ${f.edge} reaches behind its eave`);
      worst = Math.max(worst, Math.abs(p.y - eaveY - (d * pitch) / 12));
    }
  }
  assert.ok(worst < 1e-9, `${name}: a face is off its plane by ${worst}`);
  // Every point after the eave is a corner of its face: a T's stem meets
  // the bar's ridge part way along, and that node is not a corner of the
  // bar's long face.
  for (const f of roof.faces) {
    for (let k = 2; k < f.pts.length; k++) {
      const p = f.pts[k - 1], q = f.pts[k], r = f.pts[(k + 1) % f.pts.length];
      const cross = (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
      assert.ok(Math.abs(cross) > 1e-6, `${name}: face ${f.edge} has a point that is not a corner`);
    }
  }
  // The faces tile the footprint: each counter-clockwise, none empty, summing
  // to the polygon's own area.
  let sum = 0;
  for (const f of roof.faces) {
    const a = area(f.pts);
    assert.ok(a > 0, `${name}: face ${f.edge} is wound backwards or empty (${a})`);
    sum += a;
  }
  assert.ok(Math.abs(sum - area(sk.poly)) < 1e-6 * area(sk.poly), `${name}: faces cover ${sum} of ${area(sk.poly)}`);
  return { sk, roof };
}

const r9 = (v) => Math.round(v * 1e9) / 1e9;
const facePts = (f) => f.pts.map((p) => [r9(p.x), r9(p.y), r9(p.z)]);

test('a rectangle is blockRoof\'s hip, face for face and point for point', () => {
  for (const [x0, z0, x1, z1] of [[0, 0, 60, 30], [-1.5, -1.5, 41.5, 101.5], [3, 7, 23, 27]]) {
    for (const pitch of [2, DEFAULT_PITCH, 7, 12]) {
      const block = blockRoof(x0, z0, x1, z1, 10, pitch, 'hip');
      const roof = skeletonRoof(R(x0, z0, x1, z1), 10, pitch);
      // blockRoof repeats the apex of a square's trapezoids; one point is one point.
      const want = block.faces.map((f) => facePts(f).filter((p, i, a) => i === 0 || p.join() !== a[i - 1].join()));
      const got = roof.faces.map(facePts);
      const key = (f) => f[0].join() + '|' + f[1].join();
      const byEave = new Map(got.map((f) => [key(f), f]));
      assert.equal(got.length, want.length);
      for (const w of want) assert.deepEqual(byEave.get(key(w)), w, `${x0},${z0} to ${x1},${z1} at ${pitch}:12`);
      assert.ok(Math.abs(roof.rise - block.rise) < 1e-9);
      assert.ok(Math.abs(roof.topY - block.topY) < 1e-9);
    }
  }
});

test('an L has two ridges at half its arm width and a valley to the inside corner', () => {
  const { sk } = wellFormed('L', L_SHAPE);
  const inner = sk.nodes.slice(sk.poly.length).map((p) => `${r9(p.x)},${r9(p.z)},${r9(p.t)}`).sort();
  assert.deepEqual(inner, ['10,10,10', '10,30,10', '30,10,10']);
  const at = (x, z) => sk.nodes.findIndex((p) => r9(p.x) === x && r9(p.z) === z);
  const has = (a, b) => sk.arcs.some(([p, q]) => (p === a && q === b) || (p === b && q === a));
  assert.ok(has(at(30, 10), at(10, 10)), 'the long arm\'s ridge');
  assert.ok(has(at(10, 10), at(10, 30)), 'the other arm\'s ridge');
  assert.ok(has(at(20, 20), at(10, 10)), 'the valley from the inside corner');
});

test('a U, a T and a plus are well formed, and the plus meets in the middle', () => {
  wellFormed('U', U_SHAPE);
  const { sk: t } = wellFormed('T', T_SHAPE);
  assert.equal(Math.max(...t.nodes.map((p) => p.t)), 10);
  const { sk } = wellFormed('plus', PLUS);
  // All four inside corners walk to (30, 30) at the same moment.
  const mid = sk.nodes.filter((p) => r9(p.x) === 30 && r9(p.z) === 30);
  assert.equal(mid.length, 1);
  assert.equal(r9(mid[0].t), 10);
  // The long arms keep a ridge out to 10ft short of their ends.
  assert.ok(sk.nodes.some((p) => r9(p.x) === 60 && r9(p.z) === 30 && r9(p.t) === 10));
  assert.ok(sk.nodes.some((p) => r9(p.x) === 30 && r9(p.z) === 55 && r9(p.t) === 10));
});

test('a regular polygon is a cone: every face a triangle to one apex at the apothem', () => {
  for (const k of [3, 5, 8, 12, 24, 64]) {
    const r = 15;
    const { sk, roof } = wellFormed(`${k}-gon`, regular(k, r));
    const apothem = r * Math.cos(Math.PI / k);
    for (const f of roof.faces) {
      assert.equal(f.pts.length, 3, `${k}-gon: face ${f.edge} is a triangle`);
      assert.ok(Math.hypot(f.pts[2].x, f.pts[2].z) < 1e-9, `${k}-gon: apex at the centre`);
    }
    assert.ok(Math.abs(Math.max(...sk.nodes.map((p) => p.t)) - apothem) < 1e-9);
    assert.ok(Math.abs(roof.rise - (apothem * DEFAULT_PITCH) / 12) < 1e-9);
  }
});

test('a curved wall of 8 to 64 chords, out or in, roofs with a face per chord and no slivers', () => {
  for (const k of [8, 16, 32, 64]) {
    for (const bulge of [12, -10, 4, 0.5]) {
      const pts = arcRoom(k, bulge);
      const { sk, roof } = wellFormed(`${k} chords, bulge ${bulge}`, pts);
      assert.equal(sk.poly.length, k + 3, 'every chord is kept as an edge');
      const chord = Math.hypot(pts[3].x - pts[4].x, pts[3].z - pts[4].z);
      for (const f of roof.faces) {
        // A sliver is a face with no width to it, which is what a missed
        // merge between two near-collinear chords leaves: area ~1e-10. The
        // thinnest real face measured is 0.0121 chord², at the far corner of
        // a 64-chord inward curve, where the curve meets the side wall almost
        // tangentially and the corner itself is a few degrees wide.
        assert.ok(area(f.pts) > 0.01 * chord * chord, `${k}/${bulge}: face ${f.edge} is ${area(f.pts)} ft²`);
        for (const p of f.pts) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
      }
      // The roof can rise no higher than the deepest point inside the room
      // allows: half the room's depth, curve included.
      const depth = 20 + Math.max(0, bulge);
      assert.ok(roof.rise <= ((depth / 2) * DEFAULT_PITCH) / 12 + 1e-9);
    }
  }
});

test('collinear and near-collinear points fold into one edge', () => {
  const plain = skeletonRoof(R(0, 0, 40, 20), 10, 6);
  // A straight wall drawn as eight pieces, one of them off by a hair.
  const pieces = [{ x: 0, z: 0 }];
  for (let i = 1; i < 8; i++) pieces.push({ x: i * 5, z: i === 3 ? 1e-9 : 0 });
  pieces.push({ x: 40, z: 0 }, { x: 40, z: 10 }, { x: 40, z: 20 }, { x: 40, z: 20 }, { x: 0, z: 20 });
  const folded = skeletonRoof(pieces, 10, 6);
  assert.equal(folded.poly.length, 4);
  assert.deepEqual(folded.faces.map(facePts), plain.faces.map(facePts));
  // The fold stops at a real turn, however small: a 2ft chord on a 400ft
  // radius turns by 0.005 and stays a corner.
  assert.equal(cleanPolygon([{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 4, z: 0.01 }, { x: 4, z: 10 }, { x: 0, z: 10 }]).length, 5);
});

test('either winding gives the same roof, and the same input always gives the same output', () => {
  for (const shape of [R(0, 0, 40, 20), R(0, 0, 20, 20), L_SHAPE, U_SHAPE, T_SHAPE, PLUS, regular(8, 10), arcRoom(32, 12), arcRoom(16, -10)]) {
    const a = skeletonRoof(shape, 10, 4);
    const b = skeletonRoof([...shape].reverse(), 10, 4);
    const sortFaces = (r) => r.faces.map(facePts).map((f) => JSON.stringify(f)).sort();
    assert.deepEqual(sortFaces(b), sortFaces(a));
    assert.deepEqual(skeletonRoof(shape, 10, 4), a);
    // Starting the ring somewhere else changes the edge numbers, not the roof.
    // Every start is tried: an L begun at its inside corner once met three
    // events at one point in an order nothing else reached.
    for (let i = 1; i < shape.length; i++) {
      const turned = shape.slice(i).concat(shape.slice(0, i));
      assert.deepEqual(sortFaces(skeletonRoof(turned, 10, 4)), sortFaces(a), `start ${i}`);
    }
  }
});

test('degenerate input is refused with null, not a roof', () => {
  const bad = [
    null, undefined, 'square', [], [{ x: 0, z: 0 }, { x: 1, z: 0 }],
    [{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }],                         // one point
    [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 20, z: 0 }],                        // a line
    [{ x: 0, z: 0 }, { x: 10, z: 10 }, { x: 10, z: 0 }, { x: 0, z: 10 }],     // a bow tie, no area
    // A wall run back across the room, with area either side of the crossing.
    [{ x: 0, z: 0 }, { x: 30, z: 0 }, { x: 30, z: 20 }, { x: 10, z: 20 }, { x: 10, z: -10 }],
    [{ x: 0, z: 0 }, { x: NaN, z: 0 }, { x: 10, z: 10 }],
    [{ x: 0, z: 0 }, { x: Infinity, z: 0 }, { x: 10, z: 10 }],
    [{ x: 0, z: 0 }, { x: 10, z: 0 }, null],
    // Two squares touching at one corner: a pinch, not one polygon.
    [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 20, z: 10 }, { x: 20, z: 20 }, { x: 10, z: 20 }, { x: 10, z: 10 }, { x: 0, z: 10 }],
    // A wall that doubles back on itself.
    [{ x: 0, z: 0 }, { x: 20, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }],
  ];
  for (const p of bad) {
    assert.equal(straightSkeleton(p), null, JSON.stringify(p));
    assert.equal(skeletonRoof(p, 10, 4), null, JSON.stringify(p));
  }
});

test('three thousand random star-shaped rooms are each planar, tiled and a tree', () => {
  // A seeded generator, so a failure names a polygon that fails again. Two of
  // the 3,000 fold a node into a neighbour 1e-4ft away, which puts it 1e-4ft
  // off one face's plane: 1/400 of an inch, so the bound here is 1e-3ft.
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let c = 0; c < 3000; c++) {
    const n = 5 + Math.floor(rnd() * 36);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const th = (2 * Math.PI * (i + 0.8 * rnd())) / n, r = 10 + 40 * rnd();
      pts.push({ x: +(r * Math.cos(th)).toFixed(2), z: +(r * Math.sin(th)).toFixed(2) });
    }
    const sk = straightSkeleton(pts);
    assert.ok(sk, `case ${c} refused`);
    const roof = skeletonRoof(pts, 0, 12);
    let sum = 0;
    for (const f of roof.faces) {
      const a = sk.poly[f.edge], b = sk.poly[(f.edge + 1) % sk.poly.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len;
      for (const p of f.pts) {
        const off = Math.abs(p.y - (nx * (p.x - a.x) + nz * (p.z - a.z)));
        assert.ok(off < 1e-3, `case ${c}: face ${f.edge} is ${off}ft off its plane`);
      }
      const fa = area(f.pts);
      assert.ok(fa > 0, `case ${c}: face ${f.edge} is wound backwards`);
      sum += fa;
    }
    assert.ok(Math.abs(sum - area(sk.poly)) < 1e-6 * area(sk.poly), `case ${c}: faces cover ${sum} of ${area(sk.poly)}`);
    assert.equal(sk.arcs.length, sk.nodes.length - 1, `case ${c}: not a tree`);
  }
});
