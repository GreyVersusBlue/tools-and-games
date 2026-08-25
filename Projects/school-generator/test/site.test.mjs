// Hardscape, fields and the paint on them. Run `node --test test/*.mjs` from
// Projects/school-generator.
//
// The markings are the interesting half, and they're checked the way a
// surveyor would check them rather than against a golden image: a court comes
// out 84 by 50 feet whatever angle you drew the region at, every stroke lands
// inside the region that owns it, a tiled marking's stripes are one stall
// apart, and rotating the region rotates the paint by exactly the same amount.
// Those are the properties a swapped axis, a missing rotation or a scale
// applied twice breaks first.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState } from '../js/grid.js';
import {
  SITE_SURFACES, SURFACE_KEYS, DEFAULT_SURFACE, SITE_MARKINGS, MARKING_KEYS,
  COURT, PITCH, STALL, TRACK, CROSSWALK, MIN_REGION_AREA, MAX_REGIONS,
  surfaceEntry, readSurface, markingEntry, readMarking,
  makeRegion, addRegion, removeRegion, regionById, regionsOf, ensureSite,
  regionArea, regionBBox, pointInRegion, regionAt, siteSurfaceAt,
  convexHull, minAreaRect, clipToRing, markingsFor, normalizeRegion,
  siteSchedule, siteBounds,
} from '../js/site.js';

const near = (a, b, eps, msg) =>
  assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b} (±${eps})`);

// A rectangle of the given size, centred on (cx, cz), turned by `angle`.
function rectPts(cx, cz, w, d, angle = 0) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => {
    const lu = u * w / 2, lv = v * d / 2;
    return { x: cx + c * lu - s * lv, z: cz + s * lu + c * lv };
  });
}

const strokePts = (strokes) => strokes.flatMap((s) => s.pts);

// The extent of a set of strokes in the frame of a rectangle turned by
// `angle` — i.e. how long and how wide the paint actually is.
function extentIn(strokes, cx, cz, angle) {
  const c = Math.cos(-angle), s = Math.sin(-angle);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of strokePts(strokes)) {
    const dx = p.x - cx, dz = p.z - cz;
    const u = c * dx - s * dz, v = s * dx + c * dz;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u);
    v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  return { w: u1 - u0, d: v1 - v0, u0, u1, v0, v1 };
}

// ---------- surfaces ----------

test('every surface row is complete and unique', () => {
  const seen = new Set();
  for (const s of SITE_SURFACES) {
    assert.ok(!seen.has(s.key), `duplicate surface ${s.key}`);
    seen.add(s.key);
    assert.match(s.color, /^#[0-9a-f]{6}$/i, `${s.key} has a real colour`);
    assert.equal(typeof s.label, 'string');
    assert.ok(s.absorb >= 0 && s.absorb <= 1, `${s.key} absorbs between none and all of it`);
    assert.ok(['hard', 'soft', 'gravel'].includes(s.step), `${s.key} names a footstep voice`);
  }
  assert.ok(SURFACE_KEYS.includes(DEFAULT_SURFACE));
});

test('an unknown surface key reads as none, not as a default', () => {
  assert.equal(readSurface('asphalt'), 'asphalt');
  assert.equal(readSurface('lava'), null);
  assert.equal(readSurface(7), null);
  // ...but asking for the entry always gets you one, so nothing can fail to
  // have a material.
  assert.equal(surfaceEntry('lava').key, DEFAULT_SURFACE);
});

test('every marking names a surface that exists', () => {
  for (const m of SITE_MARKINGS) {
    assert.ok(SURFACE_KEYS.includes(m.surf), `${m.key} suggests a real surface`);
    assert.equal(typeof m.paint, 'function');
  }
  assert.equal(readMarking('nope'), null);
  assert.equal(markingEntry('basketball').key, 'basketball');
});

// ---------- the record ----------

test('a region needs three real corners and some area', () => {
  assert.equal(makeRegion([]), null);
  assert.equal(makeRegion([{ x: 0, z: 0 }, { x: 1, z: 0 }]), null);
  assert.equal(makeRegion(rectPts(0, 0, 2, 2)), null, 'four square feet is a mis-click');
  assert.ok(makeRegion(rectPts(0, 0, 40, 40)));
});

test('a region is wound positive whichever way it was drawn', () => {
  const cw = rectPts(0, 0, 40, 40).reverse();
  const r = makeRegion(cw);
  assert.ok(regionArea(r) > 0);
  near(regionArea(r), 1600, 1e-6, 'and its area is its area');
});

test('regions live on the state, not on a floor', () => {
  const s = createState(10, 10);
  assert.deepEqual(regionsOf(s), []);
  const r = addRegion(s, rectPts(100, 100, 60, 40), { surf: 'asphalt', mark: 'stalls' });
  assert.ok(r.id > 0, 'and take an id off the shared counter');
  assert.equal(regionsOf(s).length, 1);
  assert.equal(s.floors[0].shapes.length, 0, 'no room was created');
  assert.equal(regionById(s, r.id), r);
  assert.equal(removeRegion(s, r.id), true);
  assert.equal(removeRegion(s, r.id), false);
});

test('the region under a point is the one drawn last', () => {
  const s = createState(10, 10);
  const under = addRegion(s, rectPts(0, 0, 100, 100), { surf: 'turf' });
  const over = addRegion(s, rectPts(0, 0, 40, 40), { surf: 'asphalt' });
  assert.equal(regionAt(s, 0, 0), over);
  assert.equal(regionAt(s, 45, 0), under);
  assert.equal(regionAt(s, 500, 500), null);
  assert.equal(siteSurfaceAt(s, 0, 0), 'asphalt');
  assert.equal(siteSurfaceAt(s, 45, 0), 'turf');
  assert.equal(siteSurfaceAt(s, 500, 500), null, 'graded earth is not a surface');
});

test('a region survives anything a file can hand it', () => {
  assert.equal(normalizeRegion(null), null);
  assert.equal(normalizeRegion({ pts: 'no' }), null);
  const r = normalizeRegion({
    id: 12, surf: 'lava', mark: 'quidditch', name: 'x'.repeat(200),
    pts: [{ x: 0, z: 0 }, { x: 1e9, z: 0 }, { x: 1e9, z: 1e9 }, { x: 0, z: 1e9 }, { x: NaN, z: 3 }],
  }, 500);
  assert.equal(r.id, 12);
  assert.equal(r.surf, DEFAULT_SURFACE, 'an unknown surface falls back');
  assert.equal(r.mark, null, 'an unknown marking is simply no marking');
  assert.equal(r.name.length, 60);
  for (const p of r.pts) {
    assert.ok(Math.abs(p.x) <= 500 && Math.abs(p.z) <= 500, 'and the ring is clamped to the extent');
  }
});

test('the region list is capped', () => {
  const s = createState(4, 4);
  ensureSite(s);
  for (let i = 0; i < MAX_REGIONS + 5; i++) addRegion(s, rectPts(i * 60, 0, 40, 40));
  assert.equal(regionsOf(s).length, MAX_REGIONS);
});

// ---------- the oriented rectangle ----------

test('the minimum-area rectangle of an axis-aligned box is the box', () => {
  const r = minAreaRect(rectPts(50, 20, 80, 30));
  near(r.cx, 50, 1e-6, 'centre x');
  near(r.cz, 20, 1e-6, 'centre z');
  near(r.w, 80, 1e-6, 'long side');
  near(r.d, 30, 1e-6, 'short side');
  near(Math.abs(Math.sin(r.angle)), 0, 1e-6, 'and its long axis runs along x');
});

test('turning a rectangle turns its minimum-area rectangle with it', () => {
  for (const angle of [0.3, 0.9, -1.4, 2.6]) {
    const r = minAreaRect(rectPts(0, 0, 80, 30, angle));
    near(r.w, 80, 1e-6, `long side at ${angle}`);
    near(r.d, 30, 1e-6, `short side at ${angle}`);
    // The long axis is a direction, not a vector — either end will do.
    const dot = Math.abs(Math.cos(r.angle) * Math.cos(angle) + Math.sin(r.angle) * Math.sin(angle));
    near(dot, 1, 1e-6, `long axis lines up at ${angle}`);
  }
});

test('the minimum-area rectangle beats the axis-aligned one on a diamond', () => {
  // A square turned 45° has a bounding box half again as big as it is.
  const pts = rectPts(0, 0, 40, 40, Math.PI / 4);
  const r = minAreaRect(pts);
  near(r.w * r.d, 1600, 1e-4, 'the tight rectangle is the square itself');
  const b = regionBBox({ pts });
  assert.ok((b.x1 - b.x0) * (b.z1 - b.z0) > 3000, 'where the axis-aligned box is much bigger');
});

test('a convex hull drops the points that are not on it', () => {
  const pts = rectPts(0, 0, 40, 40).concat([{ x: 0, z: 0 }, { x: 5, z: -3 }]);
  assert.equal(convexHull(pts).length, 4);
});

// ---------- clipping ----------

test('a stripe is cut down to the part of it inside the region', () => {
  const ring = rectPts(0, 0, 40, 40);
  const parts = clipToRing(ring, { x: -100, z: 0 }, { x: 100, z: 0 });
  assert.equal(parts.length, 1);
  near(parts[0][0].x, -20, 1e-6, 'enters at the west edge');
  near(parts[0][1].x, 20, 1e-6, 'and leaves at the east one');
});

test('a stripe across a notch comes back in two pieces', () => {
  // A C-shape: a square with a slot cut into its east side along z = 0.
  const ring = [
    { x: -20, z: -20 }, { x: 20, z: -20 }, { x: 20, z: -4 },
    { x: -4, z: -4 }, { x: -4, z: 4 }, { x: 20, z: 4 },
    { x: 20, z: 20 }, { x: -20, z: 20 },
  ];
  const parts = clipToRing(ring, { x: -100, z: 0 }, { x: 100, z: 0 });
  assert.equal(parts.length, 1, 'only the west arm of the C is on this line');
  near(parts[0][1].x, -4, 1e-6);
  const across = clipToRing(ring, { x: 0, z: -100 }, { x: 0, z: 100 });
  assert.equal(across.length, 2, 'crossing the slot gives two pieces');
});

test('a stripe wholly outside the region paints nothing', () => {
  assert.deepEqual(clipToRing(rectPts(0, 0, 40, 40), { x: 100, z: -50 }, { x: 100, z: 50 }), []);
});

// ---------- fitted markings ----------

test('a basketball court is 84 by 50 feet, drawn on a lot much larger', () => {
  const region = makeRegion(rectPts(0, 0, 300, 300), { surf: 'court', mark: 'basketball' });
  const e = extentIn(markingsFor(region), 0, 0, 0);
  near(e.w, COURT.w, 0.5, 'court length');
  near(e.d, COURT.d, 0.5, 'court width');
});

test('a court drawn at an angle is square to itself', () => {
  const angle = 0.6;
  const region = makeRegion(rectPts(120, -40, 300, 220, angle), { surf: 'court', mark: 'basketball' });
  const e = extentIn(markingsFor(region), 120, -40, angle);
  near(e.w, COURT.w, 0.6, 'still 84 feet long along its own axis');
  near(e.d, COURT.d, 0.6, 'still 50 wide across it');
});

test('a court too small for a court shrinks rather than overflowing', () => {
  const region = makeRegion(rectPts(0, 0, 42, 25), { surf: 'court', mark: 'basketball' });
  const strokes = markingsFor(region);
  const e = extentIn(strokes, 0, 0, 0);
  assert.ok(e.w < COURT.w, 'smaller than life size');
  assert.ok(e.w > COURT.w * 0.3, 'but still recognisably a court');
  for (const p of strokePts(strokes)) {
    assert.ok(Math.abs(p.x) <= 21.01 && Math.abs(p.z) <= 12.51, 'and every line is inside the region');
  }
});

test('every fitted marking stays inside the region that owns it', () => {
  for (const m of SITE_MARKINGS.filter((k) => k.fitted)) {
    const region = makeRegion(rectPts(0, 0, 400, 260), { surf: m.surf, mark: m.key });
    const strokes = markingsFor(region);
    assert.ok(strokes.length, `${m.key} paints something`);
    for (const p of strokePts(strokes)) {
      assert.ok(Math.abs(p.x) <= 200.5 && Math.abs(p.z) <= 130.5, `${m.key} stays inside`);
    }
  }
});

test('a soccer pitch has its halfway line down the middle', () => {
  const region = makeRegion(rectPts(0, 0, 400, 260), { surf: 'field', mark: 'soccer' });
  const strokes = markingsFor(region);
  const e = extentIn(strokes, 0, 0, 0);
  near(e.w, PITCH.w, 1, 'pitch length');
  near(e.d, PITCH.d, 1, 'pitch width');
  const halfway = strokes.find((s) => s.pts.length === 2 && Math.abs(s.pts[0].x) < 0.01 && Math.abs(s.pts[1].x) < 0.01);
  assert.ok(halfway, 'there is a line at u = 0');
  near(Math.abs(halfway.pts[0].z - halfway.pts[1].z), PITCH.d, 1, 'and it spans the width');
});

test('a running track has one closed loop per lane boundary', () => {
  const region = makeRegion(rectPts(0, 0, 700, 400), { surf: 'track', mark: 'track' });
  const strokes = markingsFor(region);
  const loops = strokes.filter((s) => s.closed);
  assert.equal(loops.length, TRACK.lanes + 1, 'eight lanes have nine edges');
  // The innermost loop is the shortest; they nest outward.
  const span = (s) => extentIn([s], 0, 0, 0).w;
  for (let i = 1; i < loops.length; i++) {
    assert.ok(span(loops[i]) > span(loops[i - 1]), 'each lane is outside the last');
  }
});

// ---------- tiled markings ----------

test('parking stripes are one stall apart', () => {
  const region = makeRegion(rectPts(0, 0, 180, 60), { surf: 'asphalt', mark: 'stalls' });
  const strokes = markingsFor(region);
  assert.ok(strokes.length > 10, 'a 180ft lot gets a lot of stalls');
  // The stall lines run across the lot (constant x); collect their x's.
  const xs = [...new Set(strokes
    .filter((s) => Math.abs(s.pts[0].x - s.pts[1].x) < 1e-6)
    .map((s) => Math.round(s.pts[0].x * 100) / 100))].sort((a, b) => a - b);
  assert.ok(xs.length >= 2);
  for (let i = 1; i < xs.length; i++) {
    near(xs[i] - xs[i - 1], STALL.w, 1e-6, 'stalls are nine feet wide');
  }
});

test('a parking lot only stripes the shape you drew', () => {
  // An L-shaped lot: stripes must not appear in the missing quarter.
  const region = makeRegion([
    { x: -90, z: -30 }, { x: 90, z: -30 }, { x: 90, z: 0 },
    { x: 0, z: 0 }, { x: 0, z: 30 }, { x: -90, z: 30 },
  ], { surf: 'asphalt', mark: 'stalls' });
  const strokes = markingsFor(region);
  assert.ok(strokes.length, 'it stripes something');
  for (const p of strokePts(strokes)) {
    const inNotch = p.x > 0.01 && p.z > 0.01;
    assert.ok(!inNotch, `a stripe strayed into the notch at ${p.x}, ${p.z}`);
  }
});

test('a crosswalk ladders across the short way', () => {
  const region = makeRegion(rectPts(0, 0, 40, 12), { surf: 'asphalt', mark: 'crosswalk' });
  const strokes = markingsFor(region);
  assert.ok(strokes.length >= 8, 'a 40ft crossing gets several bars');
  for (const s of strokes) {
    near(s.w, CROSSWALK.bar, 1e-9, 'each bar is two feet wide');
    near(Math.abs(s.pts[0].x - s.pts[1].x), 0, 1e-6, 'and runs across the walk');
    near(Math.abs(s.pts[0].z - s.pts[1].z), 12, 1e-6, 'the full width of it');
  }
});

test('a drive gets a dashed centre line, not a solid one', () => {
  const region = makeRegion(rectPts(0, 0, 200, 24), { surf: 'asphalt', mark: 'lane' });
  const strokes = markingsFor(region);
  assert.ok(strokes.length >= 4, 'several dashes');
  let painted = 0;
  for (const s of strokes) painted += Math.hypot(s.pts[1].x - s.pts[0].x, s.pts[1].z - s.pts[0].z);
  assert.ok(painted < 200 * 0.4, 'and much more gap than paint');
});

test('a region with no marking paints nothing', () => {
  const region = makeRegion(rectPts(0, 0, 200, 200), { surf: 'turf' });
  assert.deepEqual(markingsFor(region), []);
});

// ---------- the schedule ----------

test('the site schedule sums area by surface and names the markings on it', () => {
  const s = createState(10, 10);
  addRegion(s, rectPts(0, 0, 100, 100), { surf: 'asphalt', mark: 'stalls' });
  addRegion(s, rectPts(400, 0, 100, 50), { surf: 'asphalt', mark: 'crosswalk' });
  addRegion(s, rectPts(0, 400, 200, 200), { surf: 'turf' });
  const rows = siteSchedule(s);
  assert.equal(rows.length, 2, 'two surfaces in use');
  assert.equal(rows[0].key, 'turf', 'biggest first');
  near(rows[0].sqft, 40000, 1e-6);
  const asphalt = rows.find((r) => r.key === 'asphalt');
  near(asphalt.sqft, 15000, 1e-6);
  assert.deepEqual(asphalt.marks.sort(), ['Crosswalk', 'Parking stalls']);
});

test('the site bounds take in the regions and the building both', () => {
  const s = createState(10, 10);   // 40ft x 40ft of grid
  const bare = siteBounds(s);
  near(bare.x1, 40, 1e-9);
  addRegion(s, rectPts(-300, -300, 100, 100), { surf: 'turf' });
  const b = siteBounds(s);
  near(b.x0, -350, 1e-9, 'out to the far lawn');
  near(b.x1, 40, 1e-9, 'and back to the building');
});

test('every marking key is unique and has a label', () => {
  assert.equal(new Set(MARKING_KEYS).size, MARKING_KEYS.length);
  for (const m of SITE_MARKINGS) assert.ok(m.label && m.label.length > 2, `${m.key} has a label`);
  assert.ok(MIN_REGION_AREA > 0);
});
