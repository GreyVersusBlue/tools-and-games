// The straight skeleton of a polygon with holes (DESIGN-roof-holes.md,
// increment 1, #996). Run `node --test 'test/*.test.mjs'` from
// Projects/school-generator.
//
// Nothing in the page asks for a hole yet; this is the pure module checked by
// arithmetic first, as test/skeleton.test.mjs checked the one-ring skeleton
// before roof.js stood anything on it. The figures for (a) to (c) are the
// design's, measured on its prototype: a 40ft square round a centred 20ft
// court rises 5ft (the court's eave walks 5ft to meet the outer one) and has
// 1600 - 400 ft² of faces. The old code ignored `holes`, so it gave the outer
// ring's four faces and 1600 ft²: every one of (a) to (d) fails there.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createHash } from 'node:crypto';

import {
  straightSkeleton, cleanRings, skeletonHolds, cleanPolygon, eavePolygon, skeletonRoof, triangulate,
} from '../js/skeleton.js';
// Increment 2's function is reached through the namespace, so the code before
// it fails each of its tests by name rather than the whole file on import.
import * as skeleton from '../js/skeleton.js';

const R = (x0, z0, x1, z1) => [
  { x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 },
];
// A 40 by 32 hall whose east end is a semicircle of 16 chords, radius 16.
const HALL = (() => {
  const pts = [{ x: 0, z: 0 }, { x: 40, z: 0 }];
  for (let i = 1; i < 16; i++) {
    const th = -Math.PI / 2 + (Math.PI * i) / 16;
    pts.push({ x: 40 + 16 * Math.cos(th), z: 16 + 16 * Math.sin(th) });
  }
  pts.push({ x: 40, z: 32 }, { x: 0, z: 32 });
  return pts;
})();
const L_SHAPE = [
  { x: 0, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 20 }, { x: 20, z: 20 }, { x: 20, z: 40 }, { x: 0, z: 40 },
];
const roundCourt = (cx, cz, r, k) => Array.from({ length: k }, (_, i) => ({
  x: cx + r * Math.cos((2 * Math.PI * i) / k), z: cz + r * Math.sin((2 * Math.PI * i) / k),
}));

const area = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
};

// What every skeleton with holes has to be: one face per edge of every ring,
// each starting on its own eave edge, each node on the plane through that
// edge at its own time, and the faces adding up to the outer ring less the
// holes. Returns the skeleton for the figures.
function holds(name, outer, holes) {
  const sk = straightSkeleton(outer, { holes });
  assert.ok(sk, `${name}: refused`);
  // The area first: a skeleton that ignored the holes covers the outer ring.
  const sum = sk.faces.reduce((s, f) => s + area(f.nodes.map((id) => sk.nodes[id])), 0);
  const want = Math.abs(area(outer)) - holes.reduce((s, h) => s + Math.abs(area(h)), 0);
  assert.ok(Math.abs(sum - want) < 1e-6, `${name}: faces cover ${sum} ft², want ${want}`);
  const edges = [outer, ...holes].reduce((s, r) => s + r.length, 0);
  assert.equal(sk.faces.length, edges, `${name}: one face per edge of every ring`);
  assert.equal(sk.rings.length, 1 + holes.length, `${name}: one ring each`);
  let worst = 0, k = 0;
  sk.rings.forEach((ring, r) => {
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length];
      const f = sk.faces[k++];
      assert.equal(f.ring, r, `${name}: face ${k - 1} is on ring ${r}`);
      const [n0, n1] = f.nodes.map((id) => sk.nodes[id]);
      assert.deepEqual([n0.x, n0.z, n1.x, n1.z], [a.x, a.z, b.x, b.z], `${name}: face ${k - 1} starts on its eave`);
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      for (const id of f.nodes) {
        const p = sk.nodes[id];
        const d = ((b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x)) / L;
        worst = Math.max(worst, Math.abs(d - p.t));
      }
    });
  });
  assert.ok(worst < 1e-9, `${name}: a face is ${worst}ft off its plane`);
  // Holes run clockwise, so the building is on the left of every edge.
  for (const h of sk.rings.slice(1)) assert.ok(area(h) < 0, `${name}: a hole is wound clockwise`);
  return { sk, rise: Math.max(...sk.nodes.map((p) => p.t)), sum };
}

test('(a) a 40ft square round a centred 20ft court: 8 faces, rise 5, 1200 ft²', () => {
  const { sk, rise, sum } = holds('centred', R(0, 0, 40, 40), [R(10, 10, 30, 30)]);
  assert.equal(sk.faces.length, 8);
  assert.ok(Math.abs(rise - 5) < 1e-9, `rise ${rise}`);
  assert.ok(Math.abs(sum - 1200) < 1e-9, `area ${sum}`);
});

test('(b) the court off centre (x 6 to 18, z 10 to 30): rise 11, 1360 ft²', () => {
  const { rise, sum } = holds('off centre', R(0, 0, 40, 40), [R(6, 10, 18, 30)]);
  assert.ok(Math.abs(rise - 11) < 1e-9, `rise ${rise}`);
  assert.ok(Math.abs(sum - 1360) < 1e-9, `area ${sum}`);
});

test('(c) 40 by 40 round a 24 by 24 court: rise 4, 1024 ft²', () => {
  const { rise, sum } = holds('courtyard', R(0, 0, 40, 40), [R(8, 8, 32, 32)]);
  assert.ok(Math.abs(rise - 4) < 1e-9, `rise ${rise}`);
  assert.ok(Math.abs(sum - 1024) < 1e-9, `area ${sum}`);
});

test('(d) the 16-chord bowed hall with one court, two, and a round one', () => {
  const one = holds('one court', HALL, [R(10, 12, 22, 20)]);
  assert.equal(one.sk.faces.length, 23);
  const two = holds('two courts', HALL, [R(10, 12, 22, 20), R(30, 10, 40, 18)]);
  assert.equal(two.sk.faces.length, 27);
  const round = holds('round court', HALL, [roundCourt(20, 16, 6, 12)]);
  assert.equal(round.sk.faces.length, 31);
  // The design's figure: a court west of the apse leaves its 16ft peak, the
  // centre of the semicircle, where it was. A court can lower the roof and
  // never raise it, and the second one, by the apse, does.
  assert.ok(Math.abs(one.rise - 16) < 1e-9, `one court rises ${one.rise}`);
  const bare = Math.max(...straightSkeleton(HALL).nodes.map((p) => p.t));
  for (const c of [one, two, round]) assert.ok(c.rise <= bare + 1e-9, `${c.rise} over ${bare}`);
  assert.ok(two.rise < 8, `two courts rise ${two.rise}`);
});

test('a court given either way round gives the same skeleton, every time', () => {
  const cw = [...R(10, 12, 22, 20)].reverse();
  const a = JSON.stringify(straightSkeleton(HALL, { holes: [R(10, 12, 22, 20)] }));
  assert.equal(JSON.stringify(straightSkeleton(HALL, { holes: [cw] })), a);
  assert.equal(JSON.stringify(straightSkeleton(HALL, { holes: [R(10, 12, 22, 20)] })), a);
});

// Computed from the shipped module at 7c43796, before holes went in: with no
// hole the search is the shipped one line for line, so the skeleton is too.
// `rings` and each face's `ring` are new keys and are left out of the match.
const HALL_TODAY = '{"poly":[{"x":0,"z":0},{"x":40,"z":0},{"x":43.121445152258055,"z":0.3074355135483131},{"x":46.122934917841434,"z":1.2179274798194122},{"x":48.889123728313635,"z":2.6964862031592762},{"x":51.31370849898476,"z":4.686291501015241},{"x":53.303513796840726,"z":7.110876271686365},{"x":54.78207252018059,"z":9.877065082158563},{"x":55.69256448645169,"z":12.878554847741949},{"x":56,"z":16},{"x":55.69256448645169,"z":19.12144515225805},{"x":54.78207252018059,"z":22.122934917841437},{"x":53.303513796840726,"z":24.889123728313635},{"x":51.31370849898476,"z":27.31370849898476},{"x":48.889123728313635,"z":29.303513796840726},{"x":46.122934917841434,"z":30.782072520180588},{"x":43.121445152258055,"z":31.692564486451687},{"x":40,"z":32},{"x":0,"z":32}],"nodes":[{"x":0,"z":0,"t":0},{"x":40,"z":0,"t":0},{"x":43.121445152258055,"z":0.3074355135483131,"t":0},{"x":46.122934917841434,"z":1.2179274798194122,"t":0},{"x":48.889123728313635,"z":2.6964862031592762,"t":0},{"x":51.31370849898476,"z":4.686291501015241,"t":0},{"x":53.303513796840726,"z":7.110876271686365,"t":0},{"x":54.78207252018059,"z":9.877065082158563,"t":0},{"x":55.69256448645169,"z":12.878554847741949,"t":0},{"x":56,"z":16,"t":0},{"x":55.69256448645169,"z":19.12144515225805,"t":0},{"x":54.78207252018059,"z":22.122934917841437,"t":0},{"x":53.303513796840726,"z":24.889123728313635,"t":0},{"x":51.31370849898476,"z":27.31370849898476,"t":0},{"x":48.889123728313635,"z":29.303513796840726,"t":0},{"x":46.122934917841434,"z":30.782072520180588,"t":0},{"x":43.121445152258055,"z":31.692564486451687,"t":0},{"x":40,"z":32,"t":0},{"x":0,"z":32,"t":0},{"x":40,"z":15.999999999999986,"t":15.922955626755135},{"x":39.21397040368852,"z":16.000000000000014,"t":15.999999999999986},{"x":15.999999999999986,"z":16.000000000000018,"t":15.999999999999986}],"arcs":[[2,19],[3,19],[4,19],[5,19],[6,19],[7,19],[8,19],[9,19],[10,19],[11,19],[12,19],[13,19],[14,19],[15,19],[16,19],[19,20],[17,20],[18,21],[0,21],[1,20],[20,21]],"faces":[{"edge":0,"nodes":[0,1,20,21]},{"edge":1,"nodes":[1,2,19,20]},{"edge":2,"nodes":[2,3,19]},{"edge":3,"nodes":[3,4,19]},{"edge":4,"nodes":[4,5,19]},{"edge":5,"nodes":[5,6,19]},{"edge":6,"nodes":[6,7,19]},{"edge":7,"nodes":[7,8,19]},{"edge":8,"nodes":[8,9,19]},{"edge":9,"nodes":[9,10,19]},{"edge":10,"nodes":[10,11,19]},{"edge":11,"nodes":[11,12,19]},{"edge":12,"nodes":[12,13,19]},{"edge":13,"nodes":[13,14,19]},{"edge":14,"nodes":[14,15,19]},{"edge":15,"nodes":[15,16,19]},{"edge":16,"nodes":[16,17,20,19]},{"edge":17,"nodes":[17,18,21,20]},{"edge":18,"nodes":[18,0,21]}]}';
const L_TODAY = '{"poly":[{"x":0,"z":0},{"x":40,"z":0},{"x":40,"z":20},{"x":20,"z":20},{"x":20,"z":40},{"x":0,"z":40}],"nodes":[{"x":0,"z":0,"t":0},{"x":40,"z":0,"t":0},{"x":40,"z":20,"t":0},{"x":20,"z":20,"t":0},{"x":20,"z":40,"t":0},{"x":0,"z":40,"t":0},{"x":30,"z":10,"t":10},{"x":10,"z":30,"t":10},{"x":10,"z":10,"t":10}],"arcs":[[1,6],[2,6],[4,7],[5,7],[3,8],[0,8],[6,8],[7,8]],"faces":[{"edge":0,"nodes":[0,1,6,8]},{"edge":1,"nodes":[1,2,6]},{"edge":2,"nodes":[2,3,8,6]},{"edge":3,"nodes":[3,4,7,8]},{"edge":4,"nodes":[4,5,7]},{"edge":5,"nodes":[5,0,8,7]}]}';
const shipped = (sk) => JSON.stringify({
  poly: sk.poly, nodes: sk.nodes, arcs: sk.arcs,
  faces: sk.faces.map((f) => ({ edge: f.edge, nodes: f.nodes })),
});

test('(e) with no holes the bowed hall and an L are exactly what they were', () => {
  assert.equal(shipped(straightSkeleton(HALL)), HALL_TODAY);
  assert.equal(shipped(straightSkeleton(L_SHAPE)), L_TODAY);
  assert.equal(shipped(straightSkeleton(HALL, { holes: [] })), HALL_TODAY);
  const sk = straightSkeleton(L_SHAPE);
  assert.equal(sk.rings.length, 1);
  assert.ok(sk.faces.every((f) => f.ring === 0));
});

test('(f) a hole crossing the outer ring, outside it, or touching its edge is refused', () => {
  const sq = R(0, 0, 40, 40);
  assert.equal(straightSkeleton(sq, { holes: [R(30, 10, 50, 30)] }), null, 'crossing');
  assert.equal(straightSkeleton(sq, { holes: [R(50, 10, 60, 30)] }), null, 'outside');
  // A diamond whose top corner sits on the square's south edge, at its middle.
  // cleanRings's touch check alone refuses it: this skeleton roofs it right
  // (on its planes, area exact), so the gate would let it through, unlike the
  // design's prototype (DESIGN-roof-holes.md, increment 1's implementation
  // note). It is refused because a touch is the pinch's job (increment 6).
  const touch = [{ x: 20, z: 0 }, { x: 30, z: 10 }, { x: 20, z: 20 }, { x: 10, z: 10 }];
  assert.equal(straightSkeleton(sq, { holes: [touch] }), null, 'touching');
  assert.equal(cleanRings(sq, [touch]), null, 'touching, at the rings');
  // Two holes that cross each other, and one inside another.
  assert.equal(straightSkeleton(sq, { holes: [R(5, 5, 20, 20), R(15, 15, 30, 30)] }), null, 'holes crossing');
  assert.equal(straightSkeleton(sq, { holes: [R(5, 5, 35, 35), R(15, 15, 25, 25)] }), null, 'a hole in a hole');
  // A hole that is not a polygon.
  assert.equal(straightSkeleton(sq, { holes: [[{ x: 10, z: 10 }, { x: 20, z: 10 }]] }), null, 'a hole of two points');
});

test('cleanRings winds the outer ring counter-clockwise and every hole clockwise', () => {
  const r = cleanRings([...R(0, 0, 40, 40)].reverse(), [R(10, 10, 30, 30), [...R(1, 1, 5, 5)].reverse()]);
  assert.ok(area(r.outer) > 0);
  assert.equal(r.holes.length, 2);
  for (const h of r.holes) assert.ok(area(h) < 0);
});

// The gate: a skeleton is returned only if it holds. Checked from outside on a
// good one and on the same one with one node moved, then with one node's time
// changed, so the gate is seen to look at both.
test('skeletonHolds passes a good skeleton and fails one with a node off its plane', () => {
  const sk = straightSkeleton(R(0, 0, 40, 40), { holes: [R(10, 10, 30, 30)] });
  assert.equal(skeletonHolds(sk), true);
  const inner = sk.nodes.findIndex((p) => p.t > 0);
  const moved = { ...sk, nodes: sk.nodes.map((p, i) => i === inner ? { ...p, x: p.x + 0.01 } : p) };
  assert.equal(skeletonHolds(moved), false, 'a node moved a hundredth of a foot');
  const late = { ...sk, nodes: sk.nodes.map((p, i) => i === inner ? { ...p, t: p.t + 0.01 } : p) };
  assert.equal(skeletonHolds(late), false, 'a node a hundredth of a foot high');
  // A face dropped: every node still on its plane, the area short.
  assert.equal(skeletonHolds({ ...sk, faces: sk.faces.slice(1) }), false, 'a face missing');
  for (const s of [HALL, L_SHAPE]) assert.equal(skeletonHolds(straightSkeleton(s)), true);
});

// Fifteen hundred random star-shaped rooms, each with one to three courts
// (rectangles at any angle, or small stars), seeded. Every set cleanRings
// accepts must come back, so through the gate: on its planes and tiled.
test('fifteen hundred random rooms with one to three courts each hold', () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const star = (cx, cz, k, r0, r1) => Array.from({ length: k }, (_, i) => {
    const th = (2 * Math.PI * (i + 0.3 * rnd())) / k, r = r0 + (r1 - r0) * rnd();
    return { x: cx + r * Math.cos(th), z: cz + r * Math.sin(th) };
  });
  const box = (cx, cz, w, h, a) => [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, z]) => ({
    x: cx + x * Math.cos(a) - z * Math.sin(a), z: cz + x * Math.sin(a) + z * Math.cos(a),
  }));
  let held = 0;
  for (let n = 0; n < 1500; n++) {
    const outer = star(50, 50, 5 + Math.floor(rnd() * 20), 25, 45);
    const holes = [];
    for (let h = 1 + Math.floor(rnd() * 3); h > 0; h--) {
      const cx = 35 + rnd() * 30, cz = 35 + rnd() * 30;
      holes.push(rnd() < 0.5 ? box(cx, cz, 1 + rnd() * 6, 1 + rnd() * 6, rnd() * 3) : star(cx, cz, 3 + Math.floor(rnd() * 9), 1, 6));
    }
    if (!cleanRings(outer, holes)) continue;
    const sk = straightSkeleton(outer, { holes });
    assert.ok(sk, `case ${n} refused: ${JSON.stringify({ outer, holes })}`);
    held++;
  }
  // Most sets are accepted; a court near the wall or on another is not.
  assert.ok(held > 900, `only ${held} accepted`);
});

// ---------- increment 2: the stopped wavefront, the bridged triangulation (#997)

// The design's notched block (2.2): 40 by 24, a notch `w` wide and `deep` into
// its west wall, centred on z 12.
const notched = (w, deep = 3) => [
  { x: 0, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 24 }, { x: 0, z: 24 },
  { x: 0, z: 12 + w / 2 }, { x: deep, z: 12 + w / 2 }, { x: deep, z: 12 - w / 2 }, { x: 0, z: 12 - w / 2 },
];
const EAVE_BOX = R(-1.5, -1.5, 41.5, 25.5);
const samePts = (name, got, want, tol = 1e-9) => {
  assert.equal(got.length, want.length, `${name}: ${got.length} corners, want ${want.length}`);
  got.forEach((p, i) => assert.ok(Math.hypot(p.x - want[i].x, p.z - want[i].z) < tol,
    `${name}: corner ${i} at (${p.x}, ${p.z}), want (${want[i].x}, ${want[i].z})`));
};
// An outward offset that closed its notch: one loop, which is the plain eave
// rectangle once the straight-through corner where the notch was is dropped.
const closedNotch = (name, ring) => {
  const out = skeleton.offsetRing(ring, -1.5);
  assert.ok(Array.isArray(out), `${name}: refused`);
  assert.equal(out.length, 1, `${name}: ${out.length} loops`);
  samePts(name, cleanPolygon(out[0]), EAVE_BOX);
};

test('offsetRing: a notch 2ft or 3ft wide closes under a 1.5ft eave, 4ft stays open as eavePolygon has it', () => {
  // 2ft: its sides meet at t = 1, before the stop.
  closedNotch('2ft notch', notched(2));
  // 3ft: they meet at t = 1.5, the stop itself, and that event is processed.
  closedNotch('3ft notch', notched(3));
  // The same notch at 1.4ft is still open, 0.2ft wide.
  const early = skeleton.offsetRing(notched(3), -1.4);
  assert.equal(early.length, 1);
  const zs = early[0].filter((p) => p.x > 0 && p.x < 40).map((p) => p.z).sort((a, b) => a - b);
  assert.equal(zs.length, 2, '3ft notch at 1.4ft: the notch\'s back corners stand');
  assert.ok(Math.abs(zs[1] - zs[0] - 0.2) < 1e-9, `3ft notch at 1.4ft is ${zs[1] - zs[0]}ft wide`);
  // 4ft: open 1ft wide, point for point the mitred line, in its order.
  const four = skeleton.offsetRing(notched(4), -1.5);
  assert.equal(four.length, 1);
  samePts('4ft notch', four[0], eavePolygon(notched(4), 1.5));
  assert.equal(eavePolygon(notched(3), 1.5), null, 'the mitred line refuses the 3ft notch');
});

test('offsetRing: a slot 0.5ft wide and 6ft deep, and a dovetail, close too', () => {
  closedNotch('slot', notched(0.5, 6));
  // Narrower at the mouth (2ft) than at the back (3ft).
  closedNotch('dovetail', [
    { x: 0, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 24 }, { x: 0, z: 24 },
    { x: 0, z: 13 }, { x: 3, z: 13.5 }, { x: 3, z: 10.5 }, { x: 0, z: 11 },
  ]);
});

test('offsetRing inward: a court 2.5ft wide has no eave at 1.5, a dumbbell court is pinched in two', () => {
  assert.deepEqual(skeleton.offsetRing(R(0, 0, 2.5, 10), 1.5), []);
  // Two 8ft squares joined by a neck 2ft wide and 4ft long.
  const dumbbell = [
    { x: 0, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 3 }, { x: 12, z: 3 }, { x: 12, z: 0 }, { x: 20, z: 0 },
    { x: 20, z: 8 }, { x: 12, z: 8 }, { x: 12, z: 5 }, { x: 8, z: 5 }, { x: 8, z: 8 }, { x: 0, z: 8 },
  ];
  const two = skeleton.offsetRing(dumbbell, 1.5);
  assert.equal(two.length, 2, `${two.length} loops`);
  for (const l of two) {
    assert.ok(area(l) > 0, 'each loop counter-clockwise');
    assert.ok(Math.abs(area(l) - 25) < 1e-9, `a 5ft square each, got ${area(l)} ft²`);
  }
  samePts('west half', cleanPolygon(two[0]), R(1.5, 1.5, 6.5, 6.5));
  samePts('east half', cleanPolygon(two[1]), R(13.5, 1.5, 18.5, 6.5));
});

test('offsetRing on a square: out is eavePolygon\'s answer, in is the square 1.5ft smaller', () => {
  const sq = R(0, 0, 10, 10);
  const out = skeleton.offsetRing(sq, -1.5);
  assert.equal(out.length, 1);
  samePts('out', out[0], eavePolygon(sq, 1.5));
  const inn = skeleton.offsetRing(sq, 1.5);
  assert.equal(inn.length, 1);
  samePts('in', inn[0], R(1.5, 1.5, 8.5, 8.5));
  // Either winding in, the same answer out.
  samePts('out, clockwise', skeleton.offsetRing([...sq].reverse(), -1.5)[0], eavePolygon(sq, 1.5));
  // A corner 4.6 degrees sharp runs out 37.5ft by 1.5: the frame stands clear
  // of it, and the answer is still the mitred line.
  const spike = [{ x: 0, z: 0 }, { x: 100, z: 4 }, { x: 0, z: 8 }];
  samePts('spike', skeleton.offsetRing(spike, -1.5)[0], eavePolygon(spike, 1.5));
  assert.equal(skeleton.offsetRing([{ x: 0, z: 0 }, { x: 1, z: 0 }], -1.5), null);
  assert.equal(skeleton.offsetRing(sq, NaN), null);
});

// Triangles off `triangulate(outer, holes)` that cover the outer ring less the
// holes exactly: each wound as the outer ring, none with its middle outside
// the outer ring or inside a hole, and their areas adding up.
function covers(name, outer, holes) {
  const tris = triangulate(outer, holes);
  assert.ok(tris, `${name}: refused`);
  const all = [...outer, ...holes.flat()];
  const inside = (ring, x, z) => {
    let k = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) k = !k;
    }
    return k;
  };
  let sum = 0;
  for (const t of tris) {
    const [a, b, c] = t.map((i) => all[i]);
    const ta = area([a, b, c]);
    assert.ok(ta > 0, `${name}: triangle ${t} is wound backwards or flat (${ta})`);
    const mx = (a.x + b.x + c.x) / 3, mz = (a.z + b.z + c.z) / 3;
    assert.ok(inside(outer, mx, mz), `${name}: triangle ${t} is outside the outer ring`);
    for (const h of holes) assert.ok(!inside(h, mx, mz), `${name}: triangle ${t} has its middle in a hole`);
    sum += ta;
  }
  const want = area(outer) - holes.reduce((s, h) => s + Math.abs(area(h)), 0);
  assert.ok(Math.abs(sum - want) < 1e-9 * want, `${name}: triangles cover ${sum} ft², want ${want}`);
  return tris;
}

test('triangulate with holes: a square round a centred hole, and the bowed hall round a round court', () => {
  covers('square', R(0, 0, 40, 40), [R(10, 10, 30, 30)]);
  covers('square, hole clockwise', R(0, 0, 40, 40), [[...R(10, 10, 30, 30)].reverse()]);
  covers('hall, round court', HALL, [roundCourt(20, 16, 6, 12)]);
  covers('hall, two courts', HALL, [R(10, 12, 22, 20), R(30, 10, 40, 18)]);
  covers('hall, three courts', HALL, [R(4, 4, 10, 10), roundCourt(20, 16, 6, 12), R(30, 10, 40, 18)]);
  // An outer ring given clockwise gives clockwise triangles, as without holes.
  const cw = triangulate([...R(0, 0, 40, 40)].reverse(), [R(10, 10, 30, 30)]);
  const all = [...[...R(0, 0, 40, 40)].reverse(), ...R(10, 10, 30, 30)];
  assert.ok(cw.every((t) => area(t.map((i) => all[i])) < 0));
});

// The courts of the fifteen hundred random rooms above, seeded the same way:
// every set cleanRings accepts is bridged and covered exactly. A court's
// nearest corner here is often hidden behind another court or a re-entrant
// wall, or already used by an earlier bridge.
test('the random rooms\' courts are each bridged and covered exactly', () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const star = (cx, cz, k, r0, r1) => Array.from({ length: k }, (_, i) => {
    const th = (2 * Math.PI * (i + 0.3 * rnd())) / k, r = r0 + (r1 - r0) * rnd();
    return { x: cx + r * Math.cos(th), z: cz + r * Math.sin(th) };
  });
  const box = (cx, cz, w, h, a) => [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, z]) => ({
    x: cx + x * Math.cos(a) - z * Math.sin(a), z: cz + x * Math.sin(a) + z * Math.cos(a),
  }));
  let done = 0;
  for (let n = 0; n < 1500; n++) {
    const outer = star(50, 50, 5 + Math.floor(rnd() * 20), 25, 45);
    const holes = [];
    for (let h = 1 + Math.floor(rnd() * 3); h > 0; h--) {
      const cx = 35 + rnd() * 30, cz = 35 + rnd() * 30;
      holes.push(rnd() < 0.5 ? box(cx, cz, 1 + rnd() * 6, 1 + rnd() * 6, rnd() * 3) : star(cx, cz, 3 + Math.floor(rnd() * 9), 1, 6));
    }
    const rings = cleanRings(outer, holes);
    if (!rings) continue;
    covers(`case ${n}`, rings.outer, rings.holes);
    done++;
  }
  assert.ok(done > 900, `only ${done} accepted`);
});

// Every face of every shape in test/skeleton.test.mjs (the rectangle, L, U, T,
// plus, the regular polygons, the curved walls and its 3,000 seeded random
// rooms), as skeletonRoof gives them, ear clipped with no holes. The hash was
// taken from the module at d677d2d, before `holes` went in.
const TRIS_TODAY = { faces: 63665, tris: 172618, sha256: 'ce23aada52b0539e665a6d4205c23d505f123019fe9d9fc3dcdfe33a0fbefeaa' };

test('triangulate with no holes gives the shipped triangles for every skeleton test face', () => {
  const shapes = [R(0, 0, 40, 20),
    [[0, 0], [40, 0], [40, 20], [20, 20], [20, 40], [0, 40]],
    [[0, 0], [60, 0], [60, 40], [40, 40], [40, 20], [20, 20], [20, 40], [0, 40]],
    [[0, 0], [60, 0], [60, 20], [40, 20], [40, 50], [20, 50], [20, 20], [0, 20]],
    [[20, 0], [40, 0], [40, 20], [70, 20], [70, 40], [40, 40], [40, 65], [20, 65], [20, 40], [0, 40], [0, 20], [20, 20]],
  ].map((s) => s.map((p) => (Array.isArray(p) ? { x: p[0], z: p[1] } : p)));
  for (const k of [3, 5, 8, 12, 24, 64]) shapes.push(roundCourt(0, 0, 15, k));
  for (const k of [8, 16, 32, 64]) {
    for (const bulge of [12, -10, 4, 0.5]) {
      const pts = [{ x: 0, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 20 }];
      for (let i = 1; i < k; i++) {
        const th = (Math.PI * i) / k;
        pts.push({ x: 20 + 20 * Math.cos(th), z: 20 + bulge * Math.sin(th) });
      }
      pts.push({ x: 0, z: 20 });
      shapes.push(pts);
    }
  }
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let c = 0; c < 3000; c++) {
    const n = 5 + Math.floor(rnd() * 36);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const th = (2 * Math.PI * (i + 0.8 * rnd())) / n, r = 10 + 40 * rnd();
      pts.push({ x: +(r * Math.cos(th)).toFixed(2), z: +(r * Math.sin(th)).toFixed(2) });
    }
    shapes.push(pts);
  }
  const got = [], also = [];
  for (const s of shapes) {
    for (const f of skeletonRoof(s, 0, 12).faces) {
      got.push(triangulate(f.pts));
      also.push(triangulate(f.pts, []));
    }
  }
  assert.equal(got.length, TRIS_TODAY.faces);
  assert.equal(got.flat().length, TRIS_TODAY.tris);
  assert.equal(createHash('sha256').update(JSON.stringify(got)).digest('hex'), TRIS_TODAY.sha256);
  assert.equal(JSON.stringify(also), JSON.stringify(got), 'an empty `holes` is no holes');
});
