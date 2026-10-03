// A folded ramp, wired (#825): `data.runs` and `data.side` on a ramp link, and
// everything stairs.js, collide.js and navgraph.js say about it.
//
// switchback.test.mjs owns the fold's own arithmetic. This file is about the
// link: what is stored, what a file without the fields reads as, and whether
// the footprint, the hole, the surface, the guards and the route are the same
// ramp. Every number here is worked by hand from the one case the module's
// header states: a 12ft storey at 1:12 in five 4ft lanes is five runs of
// 28.8ft rising 2.4ft each, with 5ft landings, in 20ft by 38.8ft.
//
// Run with: node --test test/ramp-fold.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, addFloor } from '../js/grid.js';
import { sheet } from './build.mjs';
import {
  addStair, stairRun, rampRuns, rampSide, isSwitchback, rampLayout,
  footprintBox, footprintPolygon, cutBox, cutColumns, cutPolygon, floorCuts, inFloorCut,
  openingRails, stairSurfaceAt, rampGuards, runLength, runTravel, linkAt, MAX_RUNS,
} from '../js/stairs.js';
import {
  buildCollider, rampGuardSegs, moveWalker, supportAt, storeyAt,
} from '../js/collide.js';
import { buildNav, runLandings, runTurns, waypoints } from '../js/navgraph.js';
import { serialize, deserialize, SAVE_VERSION } from '../js/save-load.js';
import { catalogEntry } from '../js/catalog.js';
import { rampPath, rampLandingArea, rampTopGuardSegments } from '../js/stairs.js';
import { takeoff } from '../js/takeoff.js';
import { quantities } from '../js/cost.js';
import { specSheet } from '../js/spec.js';
import { computeFloorPlan } from '../js/blueprint.js';
import { computeSection } from '../js/elevation.js';
import { seatedStep } from '../js/clearance.js';
import { buildReport } from '../js/report.js';

const M = stairRun(12);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const ramp = (data = {}, at = {}) => ({ id: 1, type: 'ramp', from: 0, to: 1, x: 0, z: 0, rotationY: 0, ...at, data });
const L5 = 28.8;                      // one run of the five
const len = (s) => Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z);

// Two storeys of bare slab, 240ft square, and a ramp on the lower one.
function school(opts = {}) {
  const s = createState(60, 60);
  addFloor(s);
  sheet(s, 0).fill(0, 0, 59, 59).bake();
  sheet(s, 1).fill(0, 0, 59, 59).bake();
  const { link } = addStair(s, 0, { type: 'ramp', x: 100, z: 100, rotationY: 0, ...opts });
  return { s, link };
}

// ---------- what is stored ----------

test('a ramp placed without a run count stores the two fields it always stored', () => {
  const { link } = school();
  assert.deepEqual(link.data, { width: 4, slope: 12 });
  assert.equal(rampRuns(link), 1);
  assert.equal(isSwitchback(link), false);
  assert.equal(rampLayout(link, M), null);
});

test('a run count is stored when it folds the ramp, and the side only when it is the other one', () => {
  assert.deepEqual(school({ runs: 5 }).link.data, { width: 4, slope: 12, runs: 5 });
  assert.deepEqual(school({ runs: 5, side: -1 }).link.data, { width: 4, slope: 12, runs: 5, side: -1 });
  assert.deepEqual(school({ runs: 1, side: -1 }).link.data, { width: 4, slope: 12 });
  assert.deepEqual(school({ runs: 99 }).link.data, { width: 4, slope: 12, runs: MAX_RUNS });
});

test('the run count is clamped where it is read, and only a ramp has one', () => {
  assert.equal(rampRuns(ramp({})), 1);
  assert.equal(rampRuns(ramp({ runs: 0 })), 1);
  assert.equal(rampRuns(ramp({ runs: -3 })), 1);
  assert.equal(rampRuns(ramp({ runs: 2.6 })), 3);
  assert.equal(rampRuns(ramp({ runs: 400 })), 12);
  assert.equal(rampRuns(ramp({ runs: 'five' })), 1);
  assert.equal(rampRuns({ type: 'stair', data: { runs: 5 } }), 1);
  assert.equal(rampSide(ramp({ side: -1 })), -1);
  assert.equal(rampSide(ramp({ side: 7 })), 1);
  assert.equal(rampSide(ramp({})), 1);
});

test('a folded ramp survives a save and a load, and the version does not move', () => {
  const { s } = school({ runs: 5, side: -1 });
  const text = serialize(s);
  assert.equal(JSON.parse(text).version, SAVE_VERSION, 'a run count is not a version bump');
  assert.equal(SAVE_VERSION, 12);
  const back = deserialize(text);
  assert.deepEqual(back.links[0].data, { width: 4, slope: 12, runs: 5, side: -1 });
  assert.equal(rampLayout(back.links[0], M).n, 5);
});

test('a save with no run count loads as the straight ramp it was, and saves back the same', () => {
  const { s } = school();
  const text = serialize(s);
  assert.ok(!/"runs"|"side"/.test(text), 'a straight ramp writes neither field');
  const back = deserialize(text);
  const link = back.links[0];
  assert.deepEqual(link.data, { width: 4, slope: 12 });
  assert.equal(serialize(back), text);
  // The straight run, by the numbers it has always had: 144ft of it, cut
  // from where 6.8ft of headroom runs out to 4ft past the top.
  const here = { ...link, x: 0, z: 0 };
  assert.deepEqual(footprintBox(here, M), { x0: -2, x1: 2, z0: 0, z1: 144 });
  const cut = cutBox(here, M);
  assert.ok(near(cut.x0, -2.25) && near(cut.x1, 2.25) && near(cut.z0, 62.4) && near(cut.z1, 148));
  assert.equal(cutColumns(here, M), null);
  assert.deepEqual(openingRails(here, M).map((r) => r.side), ['near', 'right', 'left']);
  assert.ok(near(stairSurfaceAt(here, M, 0, 72), 6));
  assert.equal(stairSurfaceAt(here, M, 0, 146), 12);
  assert.equal(stairSurfaceAt(here, M, 3, 72), null);
  assert.deepEqual(rampGuards(here, M), []);
  assert.equal(rampGuardSegs(back, 0).length, 0);
  assert.equal(runTravel(here, M), 144);
});

test('a file whose run count is nonsense loads, and reads as a number in range', () => {
  const { s } = school({ runs: 3 });
  const raw = JSON.parse(serialize(s));
  raw.links[0].data.runs = 400;
  assert.equal(rampRuns(deserialize(JSON.stringify(raw)).links[0]), 12);
  raw.links[0].data.runs = 'lots';
  const odd = deserialize(JSON.stringify(raw)).links[0];
  assert.equal(rampRuns(odd), 1);
  assert.deepEqual(footprintBox({ ...odd, x: 0, z: 0 }, M), { x0: -2, x1: 2, z0: 0, z1: 144 });
});

// ---------- the footprint ----------

test('five runs stand on 20ft by 38.8ft, and on the other side when asked', () => {
  const b = footprintBox(ramp({ runs: 5 }), M);
  assert.ok(near(b.x0, -2) && near(b.x1, 18) && near(b.z0, -5) && near(b.z1, 33.8));
  const m = footprintBox(ramp({ runs: 5, side: -1 }), M);
  assert.ok(near(m.x0, -18) && near(m.x1, 2) && near(m.z0, -5) && near(m.z1, 33.8));
  // The sloped length is still what the slope costs; the walk is longer.
  assert.equal(runLength(ramp({ runs: 5 }), M), 144);
  assert.ok(near(runTravel(ramp({ runs: 5 }), M), 5 * L5 + 4 * (4 + 5)));
});

test('the footprint turns with the link, and picking finds the far lane', () => {
  const { s, link } = school({ runs: 5, rotationY: Math.PI / 2 });
  // Facing +X: local +Z is world +X and local +X is world -Z.
  const xs = footprintPolygon(link, M).map((p) => p.x), zs = footprintPolygon(link, M).map((p) => p.z);
  assert.ok(near(Math.min(...xs), 95) && near(Math.max(...xs), 133.8));
  assert.ok(near(Math.min(...zs), 82) && near(Math.max(...zs), 102));
  assert.equal(linkAt(s, 0, 120, 84), link, 'lane 4 is part of the ramp');
  assert.equal(linkAt(s, 0, 120, 104), null, 'the other side of the first lane is not');
});

// ---------- the hole in the floor above ----------

test('five runs open the floor above over the top three lanes and nothing else', () => {
  const link = ramp({ runs: 5 });
  // Headroom runs out at 12 - 6.8 = 5.2ft. Lanes 0 and 1 top out at 4.8ft and
  // keep their ceiling. Lane 2 climbs 4.8 to 7.2 and crosses 5.2 a sixth of
  // the way up, 4.8ft along. Lanes 3 and 4 are open end to end with their
  // landings.
  const cols = cutColumns(link, M);
  assert.equal(cols.length, 3);
  const want = [
    { x0: 5.75, x1: 10, z0: 4.8, z1: 33.8 },
    { x0: 10, x1: 14, z0: -5, z1: 33.8 },
    { x0: 14, x1: 18.25, z0: -5, z1: 33.8 },
  ];
  cols.forEach((c, i) => {
    for (const k of ['x0', 'x1', 'z0', 'z1']) assert.ok(near(c[k], want[i][k]), `column ${i} ${k} ${c[k]}`);
  });
  const ring = cutPolygon(link, M);
  assert.equal(ring.length, 6, 'one L-shaped ring');
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += ring[j].x * ring[i].z - ring[i].x * ring[j].z;
  }
  // 4.25 x 29 + 4 x 38.8 + 4.25 x 38.8
  assert.ok(near(area / 2, 443.35), `area ${area / 2}, wound counter-clockwise`);
  const box = cutBox(link, M);
  assert.ok(near(box.x0, 5.75) && near(box.x1, 18.25) && near(box.z0, -5) && near(box.z1, 33.8));
});

test('the storey above has a hole where the ramp needs air and floor where it does not', () => {
  const { s } = school({ runs: 5 });
  const cuts = floorCuts(s, 1);
  assert.equal(cuts.length, 1);
  const open = (lx, lz) => inFloorCut(cuts, 100 + lx, 100 + lz);
  assert.equal(open(16, 31), true, 'the top landing');
  assert.equal(open(12, 10), true, 'lane 3');
  assert.equal(open(8, 20), true, 'lane 2 past the headroom line');
  assert.equal(open(8, 2), false, 'lane 2 short of it');
  assert.equal(open(8, -3), false, 'the landing lanes 1 and 2 share, at 4.8ft');
  assert.equal(open(0, 14), false, 'lane 0');
  assert.equal(open(4, 14), false, 'lane 1');
  assert.equal(open(16, 36), false, 'the floor you step off onto');
  assert.equal(floorCuts(s, 0).length, 0);
});

test('the hole is railed all round except where the top landing lets you off', () => {
  // The ring is 4.25 + 9.8 + 8.25 + 38.8 + 12.5 + 29 = 102.6ft round. The way
  // off is the far end of the last column, 4.25ft, for an odd count.
  const five = openingRails(ramp({ runs: 5 }), M);
  assert.ok(near(five.reduce((n, r) => n + len(r), 0), 102.6 - 4.25));
  assert.ok(!five.some((r) => near(r.a.z, 33.8) && near(r.b.z, 33.8) && Math.max(r.a.x, r.b.x) > 14.1),
    'nothing across the far end of the last lane');
  assert.ok(five.some((r) => near(r.a.z, -5) && near(r.b.z, -5) && Math.max(r.a.x, r.b.x) > 14.1),
    'the near end of the last lane is shut');
  assert.ok(five.some((r) => r.side === 'step' && near(r.a.x, 10) && near(len(r), 9.8)),
    'the step between the short column and the long one');
  // An even count comes off at the near end instead.
  const six = openingRails(ramp({ runs: 6 }), M);
  assert.ok(!six.some((r) => near(r.a.z, -5) && near(r.b.z, -5) && Math.max(r.a.x, r.b.x) > 18.1));
  assert.ok(six.some((r) => near(r.a.z, 29) && near(r.b.z, 29) && Math.max(r.a.x, r.b.x) > 18.1));
});

test('a rail with no floor behind it is dropped, as it is for a straight run', () => {
  const s = createState(60, 60);
  addFloor(s);
  sheet(s, 0).fill(0, 0, 59, 59).bake();
  // The storey above stops at x = 116ft, the middle of the last lane. The
  // outer side has no floor behind it, and neither has the near end of the
  // last column, whose middle is at 116.1ft.
  sheet(s, 1).fill(0, 0, 28, 59).bake();
  const { link } = addStair(s, 0, { type: 'ramp', x: 100, z: 100, runs: 5 });
  const all = openingRails(link, M), kept = openingRails(link, M, s.floors[1]);
  assert.equal(all.length, 8);
  assert.equal(kept.length, 6);
  assert.ok(!kept.some((r) => r.side === 'right'));
  assert.ok(!kept.some((r) => r.side === 'near' && Math.max(r.a.x, r.b.x) > 116));
  assert.ok(kept.some((r) => r.side === 'left'));
});

test('the step between two columns is railed from the side its floor is on', () => {
  const s = createState(60, 60);
  addFloor(s);
  sheet(s, 0).fill(0, 0, 59, 59).bake();
  // The ramp a foot over, so the step stands at x = 111ft, and a storey above
  // that starts at 112ft: the floor a step rail guards is on the short
  // column's side, at 109.5ft, and there is none there.
  sheet(s, 1).fill(28, 0, 59, 59).bake();
  const { link } = addStair(s, 0, { type: 'ramp', x: 101, z: 100, runs: 5 });
  assert.ok(openingRails(link, M).some((r) => r.side === 'step'));
  assert.ok(!openingRails(link, M, s.floors[1]).some((r) => r.side === 'step'));
});

test('a ramp edited in place is the ramp it now is', () => {
  const link = ramp({ runs: 5 });
  assert.ok(near(footprintBox(link, M).x1, 18));
  link.data.runs = 6;
  assert.ok(near(footprintBox(link, M).x1, 22) && near(footprintBox(link, M).z1, 29));
  link.data.width = 5;
  assert.ok(near(footprintBox(link, M).x1, 27.5));
  link.data.runs = 1;
  assert.deepEqual(footprintBox(link, M), { x0: -2.5, x1: 2.5, z0: 0, z1: 144 });
});

// ---------- the surface ----------

test('the surface is the lane you are in, at any turn of the link', () => {
  for (const rot of [0, Math.PI / 2, Math.PI]) {
    const link = ramp({ runs: 5 }, { x: 30, z: 40, rotationY: rot });
    const c = Math.cos(rot), sn = Math.sin(rot);
    const at = (lx, lz) => stairSurfaceAt(link, M, 30 + lx * c + lz * sn, 40 - lx * sn + lz * c);
    assert.ok(near(at(0, 14.4), 1.2), 'half way up lane 0');
    assert.ok(near(at(4, 14.4), 3.6), 'half way down lane 1, which climbs coming back');
    assert.ok(near(at(2, 31), 2.4), 'the first turn');
    assert.ok(near(at(16, 31), 12), 'the top landing');
    assert.equal(at(-3, 10), null, 'beside lane 0');
    assert.equal(at(0, -3), null, 'in front of the entry');
    assert.equal(at(0, -0.2), 0, 'a toe short of the first lane is on it');
    assert.equal(at(16, 35), null, 'past the top landing');
  }
});

// ---------- the guards on the ramp ----------

test('every guard stands on the higher of the two surfaces it divides', () => {
  const g = rampGuards(ramp({ runs: 5 }), M);
  const find = (x0, z0, x1, z1) => g.find((p) =>
    near(p.a.x, x0) && near(p.a.z, z0) && near(p.b.x, x1) && near(p.b.z, z1));
  // The outside of lane 0: up the run, then level along the first turn.
  const up = find(-2, 0, -2, L5);
  assert.ok(up && near(up.a.y, 0, 1e-3) && near(up.b.y, 2.4, 1e-3));
  const flat = find(-2, L5, -2, 33.8);
  assert.ok(flat && near(flat.a.y, 2.4) && near(flat.b.y, 2.4));
  // Between lanes 0 and 1, lane 1 is the higher all the way: 4.8ft at the
  // near end down to 2.4ft where they meet.
  const div = find(2, 0, 2, L5);
  assert.ok(div && div.kind === 'divider' && near(div.a.y, 4.8, 1e-3) && near(div.b.y, 2.4, 1e-3));
  // The far end is cut at every lane line: the two landings there are at
  // 2.4ft and 7.2ft.
  const farA = find(-2, 33.8, 2, 33.8), farC = find(6, 33.8, 10, 33.8);
  assert.ok(farA && near(farA.a.y, 2.4) && near(farA.b.y, 2.4));
  assert.ok(farC && near(farC.a.y, 7.2) && near(farC.b.y, 7.2));
});

test('no guard stands across the way on or the way off, on either side', () => {
  for (const side of [1, -1]) {
    for (const runs of [2, 5, 6]) {
      const link = ramp({ runs, side });
      const layout = rampLayout(link, M);
      for (const gap of [layout.entry, layout.exit]) {
        const mx = (gap.a.x + gap.b.x) / 2;
        const across = rampGuards(link, M).filter((p) =>
          near(p.a.z, gap.a.z) && near(p.b.z, gap.a.z)
          && Math.min(p.a.x, p.b.x) < mx && Math.max(p.a.x, p.b.x) > mx);
        assert.equal(across.length, 0, `${runs} runs, side ${side}`);
      }
    }
  }
});

// ---------- walking it ----------

// Walk a body at each point in turn, half a foot a step, and say where it
// ended up. The collider is the storey's the feet are on, as walkthrough does.
function walk(s, start, points, opts = { grounded: true }) {
  const colliders = [0, 1].map((i) => buildCollider(s, i, catalogEntry));
  const pos = { ...start };
  let steps = 0;
  for (const p of points) {
    for (; steps < 4000; steps++) {
      const dx = p.x - pos.x, dz = p.z - pos.z, d = Math.hypot(dx, dz);
      if (d < 0.3) break;
      const k = Math.min(0.5, d) / d;
      const r = moveWalker(s, colliders[storeyAt(s, pos.y)], pos, dx * k, dz * k, opts);
      if (r.blocked) return { ...pos, stuck: p };
      pos.x = r.x; pos.z = r.z; pos.y = r.support.y;
    }
  }
  return pos;
}

test('a walker is carried from the floor below to the floor above, lane by lane', () => {
  for (const [runs, side] of [[5, 1], [5, -1], [2, 1], [6, 1]]) {
    const { s, link } = school({ runs, side });
    const ends = runLandings(link, M);
    const end = walk(s, { x: ends.foot.x, y: 0, z: ends.foot.z }, [...runTurns(link, M), ends.head]);
    assert.equal(end.stuck, undefined, `${runs} runs, side ${side}: stopped at ${JSON.stringify(end)}`);
    assert.ok(near(end.y, 12), `${runs} runs: arrived at ${end.y}ft`);
    const under = supportAt(s, end.x, end.z, end.y);
    assert.equal(under.kind, 'floor');
    assert.equal(under.floor, 1);
  }
});

test('and back down the same way', () => {
  const { s, link } = school({ runs: 5 });
  const ends = runLandings(link, M);
  const end = walk(s, { x: ends.head.x, y: 12, z: ends.head.z }, [...runTurns(link, M).reverse(), ends.foot]);
  assert.equal(end.stuck, undefined);
  assert.ok(near(end.y, 0));
});

test('the guard between two lanes stops the short cut beside a turn', () => {
  const { s } = school({ runs: 5 });
  // A foot short of the top of lane 0, where lane 1 is 2in higher: a kerb,
  // if nothing stood on it.
  const start = { x: 100, y: (L5 - 1) / 12, z: 100 + L5 - 1 };
  const end = walk(s, start, [{ x: 104, z: 100 + L5 - 1 }]);
  assert.ok(end.x < 102, `stopped at x ${end.x}, short of the divider at 102`);
  // ...and the same stride a foot further on, on the landing, is the turn.
  const turn = walk(s, { x: 100, y: 2.4, z: 100 + L5 + 2 }, [{ x: 104, z: 100 + L5 + 2 }]);
  assert.ok(near(turn.x, 104, 0.3));
});

test('nobody on the floor below walks in through the side of a lane', () => {
  const { s } = school({ runs: 5 });
  const end = walk(s, { x: 94, y: 0, z: 101 }, [{ x: 100, z: 101 }]);
  assert.ok(end.x < 98, `stopped at x ${end.x}, outside the rail at 98`);
});

// ---------- the storey above (#826) ----------

// Sorted and rounded, so a test states a guard as four numbers and a kind.
const flat = (segs) => segs
  .map((g) => [Math.min(g.a.x, g.b.x), Math.min(g.a.z, g.b.z), Math.max(g.a.x, g.b.x), Math.max(g.a.z, g.b.z)]
    .map((v) => +v.toFixed(4)).concat(g.kind))
  .sort((p, q) => p[0] - q[0]);

test('the guards at the upper floor are the two sides of the top landing', () => {
  // Five runs: the top landing is lane 4, x 14 to 18, past the far end of its
  // run, z 28.8 to 33.8. Lane 3 beside it is the turn at 7.2ft.
  assert.deepEqual(flat(rampTopGuardSegments(ramp({ runs: 5 }), M)),
    [[14, 28.8, 14, 33.8, 'landing'], [18, 28.8, 18, 33.8, 'edge']]);
  // Six: lane 5, x 18 to 22, at the near end, z -5 to 0.
  assert.deepEqual(flat(rampTopGuardSegments(ramp({ runs: 6 }), M)),
    [[18, -5, 18, 0, 'landing'], [22, -5, 22, 0, 'edge']]);
  // Two: lane 1 at the near end, and the side that faces the entry is an edge.
  assert.deepEqual(flat(rampTopGuardSegments(ramp({ runs: 2 }), M)),
    [[2, -5, 2, 0, 'edge'], [6, -5, 6, 0, 'edge']]);
  // The other hand is the same two, mirrored.
  assert.deepEqual(flat(rampTopGuardSegments(ramp({ runs: 5, side: -1 }), M)),
    [[-18, 28.8, -18, 33.8, 'edge'], [-14, 28.8, -14, 33.8, 'landing']]);
});

test('a straight ramp has no guard on the storey above, and neither has a stair', () => {
  assert.deepEqual(rampTopGuardSegments(ramp({}), M), []);
  assert.deepEqual(rampTopGuardSegments({ ...ramp({ runs: 5 }), type: 'stair' }, M), []);
  const { s } = school();
  assert.deepEqual(rampGuardSegs(s, 1), []);
});

test('the upper storey collides with those two and the lower with every one', () => {
  const { s, link } = school({ runs: 5 });
  assert.deepEqual(
    flat(rampGuardSegs(s, 1).map((g) => ({ a: { x: g.ax, z: g.az }, b: { x: g.bx, z: g.bz }, kind: g.pad }))),
    [[114, 128.8, 114, 133.8, 0.1], [118, 128.8, 118, 133.8, 0.1]]);
  assert.equal(rampGuardSegs(s, 0).length, rampGuards(link, M).length);
  // A storey the ramp does not touch has none of them.
  addFloor(s);
  assert.deepEqual(rampGuardSegs(s, 2), []);
});

test('somebody on the top landing is stopped by the guard, not by the drop behind it', () => {
  // The body is 0.9ft in radius and a guard's pad is 0.1ft, so a walker
  // pressed against the guard on the lane line is 1ft off it. Without the
  // guard the drop holds them with their middle past the line. They start
  // 1.8ft off it, so no whole number of half-foot steps lands on the answer.
  for (const [runs, side] of [[5, 1], [5, -1], [6, 1], [4, 1]]) {
    const { s } = school({ runs, side });
    const far = (runs - 1) % 2 === 0;
    const z = 100 + (far ? 144 / runs + 2.5 : -2.5);
    const line = 100 + side * ((runs - 1) * 4 - 2);
    const end = walk(s, { x: line + side * 1.8, y: 12, z }, [{ x: line - side * 4, z }]);
    const off = (end.x - line) * side;
    assert.ok(near(off, 1, 0.02), `${runs} runs, side ${side}: ${off}ft from the lane line`);
    assert.ok(near(end.y, 12));
  }
});

test('and is still let off the open end of it, and back down the run', () => {
  for (const runs of [5, 6]) {
    const { s } = school({ runs });
    const far = (runs - 1) % 2 === 0;
    const L = 144 / runs, x = 100 + (runs - 1) * 4;
    const z = 100 + (far ? L + 2.5 : -2.5);
    const out = walk(s, { x, y: 12, z }, [{ x, z: z + (far ? 6 : -6) }]);
    assert.equal(out.stuck, undefined);
    assert.equal(supportAt(s, out.x, out.z, out.y).kind, 'floor');
    const down = walk(s, { x, y: 12, z }, [{ x, z: 100 + (far ? L - 6 : 6) }]);
    assert.equal(down.stuck, undefined);
    assert.ok(near(down.y, 12 - 6 / 12, 0.05), `${runs} runs: ${down.y}ft, six feet down the last run`);
  }
});

test('a chair is carried up a 1:12 fold and refused a 1:8 one', () => {
  const { s, link } = school({ runs: 5 });
  const ends = runLandings(link, M);
  const route = [...runTurns(link, M), ends.head];
  const end = walk(s, { x: ends.foot.x, y: 0, z: ends.foot.z }, route, seatedStep({ grounded: true }));
  assert.equal(end.stuck, undefined, `stopped at ${JSON.stringify(end)}`);
  assert.ok(near(end.y, 12));
  const steep = school({ runs: 5, slope: 8 });
  const e2 = runLandings(steep.link, M);
  const stop = walk(steep.s, { x: e2.foot.x, y: 0, z: e2.foot.z },
    [...runTurns(steep.link, M), e2.head], seatedStep({ grounded: true }));
  assert.ok(stop.y < 1, `a chair got ${stop.y}ft up a 1:8 ramp`);
});

test('the whole report builds on a school with a folded ramp in it', () => {
  const { s } = school({ runs: 5 });
  const report = buildReport(s);
  assert.ok(report && Array.isArray(report.findings));
});

// ---------- the route ----------

test('the top of a folded ramp is where its top landing opens, not straight ahead', () => {
  const five = runLandings(ramp({ runs: 5 }), M);
  assert.ok(near(five.foot.x, 0) && near(five.foot.z, -2));
  assert.ok(near(five.head.x, 16) && near(five.head.z, 35.8), 'odd: the far end of the last lane');
  const two = runLandings(ramp({ runs: 2 }), M);
  assert.ok(near(two.head.x, 4) && near(two.head.z, -7), 'even: back at the near end, one lane over');
  const one = runLandings(ramp({}), M);
  assert.ok(near(one.head.x, 0) && near(one.head.z, 150), 'straight: 144 + the 4ft landing + 2');
  assert.deepEqual(runTurns(ramp({}), M), []);
});

test('a route over a folded ramp names every turn, in the order it is met', () => {
  const s = createState(60, 60);
  addFloor(s);
  sheet(s, 0).box(1, 1, 58, 58, { name: 'Ground' }).bake();
  sheet(s, 1).box(1, 1, 58, 58, { name: 'Upper' }).bake();
  const { link } = addStair(s, 0, { type: 'ramp', x: 100, z: 100, runs: 5 });
  const nav = buildNav(s, { accessible: true });
  const node = nav.links.find((l) => l.link === link);
  assert.ok(node, 'a 1:12 ramp is on the accessible graph folded or not');
  assert.equal(node.via.length, 8);
  // Half a landing in, down the middle of each lane: far, far, near, near...
  assert.deepEqual(node.via.map((v) => [v.x - 100, +(v.z - 100).toFixed(1)]),
    [[0, 31.3], [4, 31.3], [4, -2.5], [8, -2.5], [8, 31.3], [12, 31.3], [12, -2.5], [16, -2.5]]);
  const up = waypoints(nav, [node.id], { floor: 0 });
  assert.equal(up.length, 10);
  assert.deepEqual([up[0].kind, up[0].floor, up[9].floor], ['link', 0, 1]);
  assert.ok(near(up[1].x, 100) && near(up[8].x, 116));
  const down = waypoints(nav, [node.id], { floor: 1 });
  assert.deepEqual([down[0].floor, down[9].floor], [1, 0]);
  assert.ok(near(down[1].x, 116) && near(down[8].x, 100));
  // What the climb is charged as: the walk, not the slope.
  // 5 x 28.8 + 4 x (4 + 5) = 180ft, on top of the walk from the head.
  const top = nav.adj.get(node.id).find((e) => nav.node(e.to).floor === 1);
  const room = nav.node(top.to);
  const fromHead = Math.hypot(room.x - node.b.x, room.z - node.b.z);
  assert.ok(near(top.dist - fromHead, 180), `the climb is ${top.dist - fromHead}ft`);
});

// ---------- what is drawn and counted ----------

test('the middle of the ramp is the two ends of every run, in the order they are climbed', () => {
  const path = rampPath(ramp({ runs: 5 }), M);
  assert.equal(path.length, 10);
  assert.deepEqual(path.map((p) => p.x), [0, 0, 4, 4, 8, 8, 12, 12, 16, 16]);
  path.map((p) => p.z).forEach((z, i) => assert.ok(near(z, [0, L5, L5, 0, 0, L5, L5, 0, 0, L5][i]), `z ${i}`));
  path.map((p) => p.y).forEach((y, i) => assert.ok(near(y, [0, 2.4, 2.4, 4.8, 4.8, 7.2, 7.2, 9.6, 9.6, 12][i]), `y ${i}`));
  assert.deepEqual(rampPath(ramp({}), M), []);
});

test('a folded ramp is measured and priced with its landings', () => {
  // Four turns of 8ft by 5ft and a top landing of 4ft by 5ft: 180 ft² level,
  // on top of the 4 x 144 = 576 ft² that slopes.
  assert.ok(near(rampLandingArea(ramp({ runs: 5 }), M), 180));
  assert.equal(rampLandingArea(ramp({}), M), 0);
  const { s } = school({ runs: 5 });
  const row = takeoff(s).links.find((l) => l.type === 'ramp');
  assert.ok(near(row.area, 756));
  assert.equal(row.runs, 5);
  assert.equal(row.label, 'Ramp 4 ft wide at 1:12, 5 runs');
  assert.ok(near(quantities(s).all.get('ramp'), 756));
  // ...and a straight one is the line it always was.
  const straight = school().s;
  const was = takeoff(straight).links.find((l) => l.type === 'ramp');
  assert.equal(was.area, 576);
  assert.equal(was.label, 'Ramp 4 ft wide at 1:12');
  assert.ok(!('runs' in was));
  assert.equal(quantities(straight).all.get('ramp'), 576);
});

test('the spec says what the longest run rises, once a ramp is folded', () => {
  const rated = (st) => specSheet(st).lines.find((l) => l.key === 'ramp').rated;
  assert.equal(rated(school().s), 'steepest 1:12 — 1:12 is the accessible maximum');
  assert.equal(rated(school({ runs: 5 }).s),
    'steepest 1:12 — 1:12 is the accessible maximum; longest run rises 28.8 in, 30 in is the most one may');
  // Two ramps, one straight: the straight one is the longest run, all 144in.
  const { s } = school({ runs: 5 });
  addStair(s, 0, { type: 'ramp', x: 20, z: 20 });
  assert.ok(/longest run rises 144 in/.test(rated(s)), rated(s));
});

test('the plan symbol of a folded ramp has an arrow up every run', () => {
  const { s } = school({ runs: 5 });
  const sym = computeFloorPlan(s, 0).stairs.find((x) => x.kind === 'ramp');
  assert.equal(sym.runs, 5);
  assert.equal(sym.lanes.length, 5);
  // Lane 0 climbs away from the entry, lane 1 comes back.
  assert.ok(near(sym.lanes[0].a.z, 100) && near(sym.lanes[0].b.z, 100 + L5) && near(sym.lanes[0].a.x, 100));
  assert.ok(near(sym.lanes[1].a.z, 100 + L5) && near(sym.lanes[1].b.z, 100) && near(sym.lanes[1].a.x, 104));
  // Four dividers, three places two landings meet, and the two ends of five runs.
  assert.equal(sym.lines.length, 4 + 3 + 10);
  const plain = computeFloorPlan(school().s, 0).stairs.find((x) => x.kind === 'ramp');
  assert.ok(!('lanes' in plain) && !('runs' in plain));
});

test('a section through a folded ramp draws every run', () => {
  const { s } = school({ runs: 5 });
  const sec = computeSection(s, { id: 1, name: 'A', ax: 108, az: 90, bx: 108, bz: 140 });
  assert.equal(sec.stairs.length, 1);
  const pts = sec.stairs[0].pts;
  assert.equal(pts.length, 10);
  // The cut runs along the lanes from z = 90, so the foot of a run is 10ft
  // along it and the head 38.8ft.
  pts.map((p) => p.u).forEach((u, i) =>
    assert.ok(near(u, [10, 38.8, 38.8, 10, 10, 38.8, 38.8, 10, 10, 38.8][i]), `u ${i} is ${u}`));
  pts.map((p) => p.y).forEach((y, i) =>
    assert.ok(near(y, [0, 2.4, 2.4, 4.8, 4.8, 7.2, 7.2, 9.6, 9.6, 12][i]), `y ${i} is ${y}`));
});
