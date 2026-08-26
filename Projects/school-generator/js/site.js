// site.js — everything on the ground that isn't the building: parking, drives,
// walks, courts, fields, lawn and planting beds, and the paint on top of them.
//
// The wishlist guessed these would be "plausibly polygon rooms with a `site`
// flag rather than a new geometry system", and half of that guess was right.
// The geometry *is* a polygon ring in world feet, read with shapes.js's own
// helpers, because a second ring implementation would be a second set of
// winding bugs. But the flag was the wrong half. A site region has no walls,
// no ceiling, no openings, no paint, no finish, no flood fill, no acoustics
// and no storey; putting one in `floor.shapes[]` would mean every reader of a
// room — the blueprint, the collider, walls.js, finish.js, acoustics.js,
// polyedit — growing an `if (!s.site)` it can never drop again. The
// retrospective calls two room representations "a standing tax"; a third one
// wearing a room's clothes would have been worse. So site regions live in
// `state.site.regions[]`, they are *not* rooms, and the room readers were not
// touched.
//
// Two ideas carry the whole file.
//
// * **A surface is a row in a table**, the way a floor finish is — colour,
//   grain, plan hatch, and the absorption and footstep material Phase 4 asks
//   of anything you can stand on. Asphalt, concrete, turf, running track,
//   sport court, mulch, gravel, sand, planting bed. Adding one is adding a row.
// * **Markings are derived, never drawn.** You do not place a free-throw line.
//   You say "this asphalt is a basketball court" and the court paints itself
//   at the real published dimensions — 84 by 50 feet, a 19.75ft three-point
//   arc, a 12ft key — fitted into the region's own oriented bounding box, so a
//   court drawn at 30° to the grid comes out square to *itself*. The same
//   machinery stripes a parking lot at 9 by 18 with a 24ft aisle, ladders a
//   crosswalk, and lays out a 400m track. Every one of them is arithmetic over
//   a rectangle, which is why every one of them has a test.
//
// Pure module: no three.js. Exercised by test/site.test.mjs.

import { CELL } from './grid.js';
import { ringSignedArea, pointInRing, cleanRing } from './shapes.js';

export const MAX_REGIONS = 200;
export const MAX_REGION_PTS = 200;
export const MIN_REGION_AREA = 25;      // ft² — smaller than a parking stall is a mis-click

// ---------- surfaces ----------
//
// `color` is what the material looks like and `grain` is which procedural
// texture render.js lays over it — the same two columns FLOOR_FINISHES carries,
// answered by the same builder. `hatch` is the site plan's swatch. `absorb` is
// the 500Hz absorption coefficient, because Phase 4's reverberation math does
// not stop at the door and a courtyard walled on three sides is a real room.
// `step` names the footstep voice, out of sound.js's existing set, so walking
// off the terrazzo onto gravel sounds like walking onto gravel.
//
// Two more columns since Phase 17, and both are about routing rather than
// about looks. `walk` is whether the site mesh may cross this surface at all:
// a planting bed is a thing you walk *around*, and a discharge route measured
// through the shrubs is a discharge route nobody takes. `paved` is whether it
// is a made surface — which is what tells the public way from the fence line,
// because a code means a street or a walk that leads to one and a gap in a
// hedge at the back of the playing field is not one.
export const SITE_SURFACES = [
  { key: 'asphalt', label: 'Asphalt paving', color: '#4a4b4f', grain: 'speck', tile: 8, hatch: 'plain', absorb: 0.04, step: 'hard', walk: true, paved: true },
  { key: 'concrete', label: 'Concrete walk', color: '#9d9c96', grain: 'speck', tile: 6, hatch: 'grid', absorb: 0.02, step: 'hard', walk: true, paved: true },
  { key: 'court', label: 'Sport court coating', color: '#3f6a72', grain: 'speck', tile: 10, hatch: 'plain', absorb: 0.05, step: 'hard', walk: true, paved: true },
  { key: 'track', label: 'Running track', color: '#9c4a34', grain: 'speck', tile: 6, hatch: 'lines', absorb: 0.12, step: 'soft', walk: true, paved: true },
  { key: 'turf', label: 'Lawn', color: '#5d7c46', grain: 'fiber', tile: 12, hatch: 'dots', absorb: 0.35, step: 'soft', walk: true, paved: false },
  { key: 'field', label: 'Athletic field', color: '#4f7a3f', grain: 'mow', tile: 24, hatch: 'dots', absorb: 0.40, step: 'soft', walk: true, paved: false },
  { key: 'mulch', label: 'Playground mulch', color: '#6d5238', grain: 'chip', tile: 5, hatch: 'chips', absorb: 0.50, step: 'soft', walk: true, paved: false },
  { key: 'gravel', label: 'Gravel', color: '#8a8478', grain: 'chip', tile: 4, hatch: 'dots', absorb: 0.25, step: 'gravel', walk: true, paved: false },
  { key: 'sand', label: 'Sand', color: '#c4b287', grain: 'speck', tile: 4, hatch: 'dots', absorb: 0.40, step: 'gravel', walk: true, paved: false },
  { key: 'garden', label: 'Planting bed', color: '#4a3a2c', grain: 'chip', tile: 3, hatch: 'chips', absorb: 0.45, step: 'soft', walk: false, paved: false },
];

export const SURFACE_KEYS = SITE_SURFACES.map((s) => s.key);
export const DEFAULT_SURFACE = 'turf';
const SURF_BY_KEY = new Map(SITE_SURFACES.map((s) => [s.key, s]));
export const surfaceEntry = (key) => SURF_BY_KEY.get(key) || SURF_BY_KEY.get(DEFAULT_SURFACE);
export const readSurface = (v) => (typeof v === 'string' && SURF_BY_KEY.has(v) ? v : null);

// ---------- geometry helpers ----------

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const TAU = Math.PI * 2;

export function regionArea(region) {
  return region && region.pts ? Math.abs(ringSignedArea(region.pts)) : 0;
}

export function regionBBox(region) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of region.pts) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
  }
  return { x0, z0, x1, z1 };
}

export const pointInRegion = (region, x, z) => !!region && pointInRing(region.pts, x, z);

// Andrew's monotone chain. Needed because the minimum-area rectangle of a
// point set is the minimum-area rectangle of its hull, and a region drawn by
// hand has plenty of points that aren't on it.
export function convexHull(pts) {
  const p = pts.map((q) => ({ x: q.x, z: q.z }))
    .sort((a, b) => (a.x - b.x) || (a.z - b.z));
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const half = (src) => {
    const out = [];
    for (const q of src) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  return half(p).concat(half(p.slice().reverse()));
}

// The smallest rectangle that contains a set of points, by rotating calipers:
// one of the hull's own edges is a side of it, always, so trying every edge is
// exact rather than a search. Returned with `w >= d` and `angle` the direction
// of the long axis, which is the convention every marking below is authored in
// — a court is drawn along its own length, whatever angle the region sits at
// on the plan.
export function minAreaRect(pts) {
  const hull = convexHull(pts);
  if (hull.length < 3) {
    const b = regionBBox({ pts });
    return {
      cx: (b.x0 + b.x1) / 2, cz: (b.z0 + b.z1) / 2,
      w: Math.max(b.x1 - b.x0, b.z1 - b.z0), d: Math.min(b.x1 - b.x0, b.z1 - b.z0),
      angle: (b.x1 - b.x0) >= (b.z1 - b.z0) ? 0 : Math.PI / 2,
    };
  }
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const ex = b.x - a.x, ez = b.z - a.z;
    const len = Math.hypot(ex, ez);
    if (len < 1e-9) continue;
    const ux = ex / len, uz = ez / len;   // along the edge
    const vx = -uz, vz = ux;              // across it
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const q of hull) {
      const du = q.x * ux + q.z * uz, dv = q.x * vx + q.z * vz;
      u0 = Math.min(u0, du); u1 = Math.max(u1, du);
      v0 = Math.min(v0, dv); v1 = Math.max(v1, dv);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area - 1e-9) {
      const mu = (u0 + u1) / 2, mv = (v0 + v1) / 2;
      best = {
        area,
        cx: ux * mu + vx * mv, cz: uz * mu + vz * mv,
        du: u1 - u0, dv: v1 - v0,
        ux, uz, vx, vz,
      };
    }
  }
  if (!best) return { cx: 0, cz: 0, w: 0, d: 0, angle: 0 };
  // Long axis first, so every marking can be authored knowing which way is
  // "along".
  const longAlongU = best.du >= best.dv;
  const w = longAlongU ? best.du : best.dv;
  const d = longAlongU ? best.dv : best.du;
  const ax = longAlongU ? best.ux : best.vx;
  const az = longAlongU ? best.uz : best.vz;
  return { cx: best.cx, cz: best.cz, w, d, angle: Math.atan2(az, ax) };
}

// ---------- clipping ----------

// A polyline cut down to the parts of it inside a ring. Tiled markings —
// parking stripes, a crosswalk ladder, a drive's centre line — are generated
// across the whole bounding rectangle and then trimmed here, so a lot with a
// bite taken out of it stripes the shape you actually drew rather than the box
// around it.
export function clipToRing(ring, a, b) {
  const out = [];
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return out;
  // Every parameter at which the segment crosses an edge of the ring, plus the
  // two ends: between consecutive crossings the segment is wholly in or wholly
  // out, so one midpoint test per interval settles it.
  const ts = [0, 1];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    const rx = q.x - p.x, rz = q.z - p.z;
    const den = dx * rz - dz * rx;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((p.x - a.x) * rz - (p.z - a.z) * rx) / den;
    const s = ((p.x - a.x) * dz - (p.z - a.z) * dx) / den;
    if (t > 0 && t < 1 && s >= 0 && s <= 1) ts.push(t);
  }
  ts.sort((m, n) => m - n);
  for (let i = 0; i + 1 < ts.length; i++) {
    const t0 = ts[i], t1 = ts[i + 1];
    if (t1 - t0 < 1e-6) continue;
    const mid = (t0 + t1) / 2;
    if (!pointInRing(ring, a.x + dx * mid, a.z + dz * mid)) continue;
    out.push([
      { x: a.x + dx * t0, z: a.z + dz * t0 },
      { x: a.x + dx * t1, z: a.z + dz * t1 },
    ]);
  }
  return out;
}

// ---------- markings ----------
//
// Each generator is handed the region's own oriented rectangle and returns
// strokes in world feet: `{ pts, w, closed, color }`, `w` being the painted
// line width. Two families:
//
//   *fitted* — a court, a pitch, a diamond, a track. These have published
//   dimensions and are drawn at them, centred in the region, shrunk only if
//   the region is too small to hold one. You do not get a 60-foot-wide
//   basketball court by drawing a wide rectangle; you get a court with room
//   around it, which is what a real one has.
//
//   *tiled* — stalls, a crosswalk ladder, a drive's centre line. These have a
//   module rather than a size, repeat to fill, and are clipped to the ring.

const WHITE = '#eceae4';
const YELLOW = '#d8b13f';

// Canonical dimensions, in feet, from the published rule books. Kept together
// so the numbers are checkable in one place rather than scattered through the
// generators that use them.
export const COURT = { w: 84, d: 50, key: { w: 12, d: 19 }, circle: 6, arc: 19.75, arcStraight: 5.25 };
export const PITCH = { w: 330, d: 195, circle: 30, pen: { w: 54, d: 132 }, goal: { w: 18, d: 60 } };
export const DIAMOND = { base: 60, mound: 46, arc: 200 };
export const TRACK = { straight: 276.9, radius: 119.8, lanes: 8, lane: 4.0 };
export const STALL = { w: 9, d: 18, aisle: 24, accessible: 16 };
export const CROSSWALK = { bar: 2, gap: 2.5 };

// Map canonical (u, v) through a frame. Written out rather than composed so
// the sin/cos happen once per marking instead of once per point.
function mapper(rect, scale = 1) {
  const c = Math.cos(rect.angle), s = Math.sin(rect.angle);
  return (u, v) => ({ x: rect.cx + c * u * scale - s * v * scale, z: rect.cz + s * u * scale + c * v * scale });
}

// A rectangle in canonical coordinates, as a closed stroke.
const canonRect = (m, w, d, cu = 0, cv = 0) => [
  m(cu - w / 2, cv - d / 2), m(cu + w / 2, cv - d / 2),
  m(cu + w / 2, cv + d / 2), m(cu - w / 2, cv + d / 2),
];

function canonArc(m, cu, cv, r, a0, a1, steps = 24) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (a1 - a0) * (i / steps);
    pts.push(m(cu + Math.cos(a) * r, cv + Math.sin(a) * r));
  }
  return pts;
}

const canonCircle = (m, cu, cv, r, steps = 32) => canonArc(m, cu, cv, r, 0, TAU, steps).slice(0, -1);

// How much a fitted marking has to shrink to sit inside its region, never
// growing past life size.
const fitScale = (rect, w, d, pad = 0) =>
  Math.min(1, (rect.w - pad) / w, (rect.d - pad) / d);

function markBasketball(region, rect) {
  const k = fitScale(rect, COURT.w, COURT.d, 4);
  if (k <= 0) return [];
  const m = mapper(rect, k);
  const out = [];
  const line = (pts, closed = false, w = 0.33) => out.push({ pts, closed, w: w * k, color: WHITE });
  line(canonRect(m, COURT.w, COURT.d), true);
  line([m(0, -COURT.d / 2), m(0, COURT.d / 2)]);
  line(canonCircle(m, 0, 0, COURT.circle), true);
  for (const side of [-1, 1]) {
    const baseline = side * COURT.w / 2;
    const ftLine = baseline - side * COURT.key.d;
    line(canonRect(m, COURT.key.d, COURT.key.w, baseline - side * COURT.key.d / 2, 0), true);
    line(canonCircle(m, ftLine, 0, COURT.circle), true);
    // The three-point line: a straight run out from the baseline, then the arc
    // that meets it. Radius is measured from the basket, which stands 5.25ft
    // in off the baseline.
    const hoop = baseline - side * COURT.arcStraight;
    const corner = COURT.d / 2 - 3.1;
    const a = Math.asin(clamp(corner / COURT.arc, -1, 1));
    const sweep = side > 0
      ? canonArc(m, hoop, 0, COURT.arc, Math.PI - a, Math.PI + a)
      : canonArc(m, hoop, 0, COURT.arc, -a, a);
    line([m(baseline, -corner), sweep[0]]);
    line(sweep);
    line([sweep[sweep.length - 1], m(baseline, corner)]);
  }
  return out;
}

function markSoccer(region, rect) {
  const k = fitScale(rect, PITCH.w, PITCH.d, 10);
  if (k <= 0) return [];
  const m = mapper(rect, k);
  const out = [];
  const line = (pts, closed = false) => out.push({ pts, closed, w: 0.4 * k, color: WHITE });
  line(canonRect(m, PITCH.w, PITCH.d), true);
  line([m(0, -PITCH.d / 2), m(0, PITCH.d / 2)]);
  line(canonCircle(m, 0, 0, PITCH.circle), true);
  for (const side of [-1, 1]) {
    const goalLine = side * PITCH.w / 2;
    line(canonRect(m, PITCH.pen.w, PITCH.pen.d, goalLine - side * PITCH.pen.w / 2, 0), true);
    line(canonRect(m, PITCH.goal.w, PITCH.goal.d, goalLine - side * PITCH.goal.w / 2, 0), true);
    // Corner arcs. A yard of radius, swept from the goal line round to the
    // touchline the short way — which is always *into* the pitch, whichever
    // of the four corners this is.
    for (const end of [-1, 1]) {
      const a0 = side > 0 ? Math.PI : 0;
      const a1 = end > 0 ? -Math.PI / 2 : Math.PI / 2;
      let sweep = a1 - a0;
      while (sweep > Math.PI) sweep -= TAU;
      while (sweep < -Math.PI) sweep += TAU;
      line(canonArc(m, goalLine, end * PITCH.d / 2, 3, a0, a0 + sweep, 6));
    }
  }
  return out;
}

function markBaseball(region, rect) {
  // A quarter-circle field is wider across the foul poles than it is deep, so
  // its long axis runs *across* — outfield fence to outfield fence — and home
  // plate sits at the middle of one long side. Get that backwards and a
  // diamond drawn in a wide lot comes out sideways.
  const R = DIAMOND.arc;
  const W = R * Math.SQRT2, D = R;
  const k = fitScale(rect, W, D, 10);
  if (k <= 0) return [];
  const m = mapper(rect, k);
  const out = [];
  const line = (pts, closed = false) => out.push({ pts, closed, w: 0.4 * k, color: WHITE });
  const home = D / 2;                      // v of home plate; the field runs toward -v
  const b = DIAMOND.base / Math.SQRT2;     // half-diagonal of the base path square
  line([
    m(0, home), m(b, home - b), m(0, home - 2 * b), m(-b, home - b),
  ], true);
  // The foul lines run out at 45° and end exactly at the two ends of the arc.
  line([m(0, home), m(-W / 2, -D / 2)]);
  line([m(0, home), m(W / 2, -D / 2)]);
  line(canonArc(m, 0, home, R, -Math.PI * 0.75, -Math.PI * 0.25, 24));
  line(canonCircle(m, 0, home - DIAMOND.mound, 9, 20), true);
  return out;
}

function markTrack(region, rect) {
  const outerW = TRACK.straight + 2 * (TRACK.radius + TRACK.lanes * TRACK.lane);
  const outerD = 2 * (TRACK.radius + TRACK.lanes * TRACK.lane);
  const k = fitScale(rect, outerW, outerD, 6);
  if (k <= 0) return [];
  const m = mapper(rect, k);
  const out = [];
  const half = TRACK.straight / 2;
  for (let lane = 0; lane <= TRACK.lanes; lane++) {
    const r = TRACK.radius + lane * TRACK.lane;
    const pts = canonArc(m, half, 0, r, -Math.PI / 2, Math.PI / 2, 20)
      .concat(canonArc(m, -half, 0, r, Math.PI / 2, Math.PI * 1.5, 20));
    out.push({ pts, closed: true, w: 0.2 * k, color: WHITE });
  }
  // The finish line, across every lane at the end of the home straight.
  out.push({
    pts: [m(half, TRACK.radius), m(half, TRACK.radius + TRACK.lanes * TRACK.lane)],
    closed: false, w: 0.4 * k, color: WHITE,
  });
  return out;
}

// A parking lot: rows of 9x18 stalls back to back with a 24ft aisle between
// them, striped along the long axis and clipped to the region. The module
// repeats across the short axis, so a lot drawn any shape gets as many full
// rows as fit and no partial ones.
function markStalls(region, rect) {
  const out = [];
  const m = mapper(rect, 1);
  const module = STALL.d * 2 + STALL.aisle;
  const rows = Math.max(1, Math.floor(rect.d / module));
  const used = rows * module;
  const v0 = -used / 2;
  const halfU = rect.w / 2;
  const paint = (a, b, w = 0.33) => {
    for (const [p, q] of clipToRing(region.pts, a, b)) {
      out.push({ pts: [p, q], closed: false, w, color: WHITE });
    }
  };
  for (let row = 0; row < rows; row++) {
    const base = v0 + row * module;
    // Two banks of stalls, nose to nose, with the aisle between them.
    for (const bank of [0, 1]) {
      const near = bank === 0 ? base : base + STALL.d + STALL.aisle;
      const far = near + STALL.d;
      // The kerb line each bank's stalls end at.
      paint(m(-halfU, near + (bank === 0 ? 0 : STALL.d)), m(halfU, near + (bank === 0 ? 0 : STALL.d)), 0.4);
      const n = Math.floor(rect.w / STALL.w);
      const span = n * STALL.w;
      for (let i = 0; i <= n; i++) {
        const u = -span / 2 + i * STALL.w;
        paint(m(u, near), m(u, far));
      }
    }
  }
  return out;
}

// A crosswalk: bars across the *short* axis, which is the way you walk.
function markCrosswalk(region, rect) {
  const out = [];
  const m = mapper(rect, 1);
  const pitch = CROSSWALK.bar + CROSSWALK.gap;
  const n = Math.max(1, Math.floor(rect.w / pitch));
  const span = n * pitch;
  for (let i = 0; i < n; i++) {
    const u = -span / 2 + i * pitch + CROSSWALK.bar / 2;
    for (const [p, q] of clipToRing(region.pts, m(u, -rect.d / 2), m(u, rect.d / 2))) {
      out.push({ pts: [p, q], closed: false, w: CROSSWALK.bar, color: WHITE });
    }
  }
  return out;
}

// A drive or bus loop: a dashed yellow centre line down the long axis. Ten
// feet of paint, thirty of gap, which is what a highway manual says and what
// makes a loop read as a loop from the air.
function markLane(region, rect) {
  const out = [];
  const m = mapper(rect, 1);
  const pitch = 40, dash = 10;
  const n = Math.max(1, Math.ceil(rect.w / pitch));
  for (let i = 0; i < n; i++) {
    const u = -rect.w / 2 + i * pitch;
    for (const [p, q] of clipToRing(region.pts, m(u, 0), m(Math.min(u + dash, rect.w / 2), 0))) {
      out.push({ pts: [p, q], closed: false, w: 0.4, color: YELLOW });
    }
  }
  return out;
}

// Playground paint. Small, fixed, and the reason a blacktop reads as a school
// blacktop rather than as a car park with no cars on it.
function markFoursquare(region, rect) {
  const size = 16;
  const k = fitScale(rect, size, size, 2);
  if (k <= 0) return [];
  const m = mapper(rect, k);
  const h = size / 2;
  return [
    { pts: canonRect(m, size, size), closed: true, w: 0.25 * k, color: YELLOW },
    { pts: [m(-h, 0), m(h, 0)], closed: false, w: 0.25 * k, color: YELLOW },
    { pts: [m(0, -h), m(0, h)], closed: false, w: 0.25 * k, color: YELLOW },
  ];
}

function markHopscotch(region, rect) {
  const cell = 2.5, len = cell * 10;
  const k = fitScale(rect, len, cell * 2, 1);
  if (k <= 0) return [];
  const m = mapper(rect, k);
  const out = [];
  const box = (u, v, w, d) => out.push({ pts: canonRect(m, w, d, u, v), closed: true, w: 0.2 * k, color: WHITE });
  // 1, 2-3, 4, 5-6, 7, 8-9, 10 — the ordinary court.
  const plan = [[1], [2], [1], [2], [1], [2], [1]];
  let u = -len / 2 + cell / 2;
  for (const row of plan) {
    if (row[0] === 1) box(u, 0, cell, cell);
    else { box(u, -cell / 2, cell, cell); box(u, cell / 2, cell, cell); }
    u += cell;
  }
  return out;
}

export const SITE_MARKINGS = [
  { key: 'stalls', label: 'Parking stalls', surf: 'asphalt', fitted: false, paint: markStalls },
  { key: 'lane', label: 'Drive centre line', surf: 'asphalt', fitted: false, paint: markLane },
  { key: 'crosswalk', label: 'Crosswalk', surf: 'asphalt', fitted: false, paint: markCrosswalk },
  { key: 'basketball', label: 'Basketball court', surf: 'court', fitted: true, paint: markBasketball },
  { key: 'foursquare', label: 'Four square', surf: 'asphalt', fitted: true, paint: markFoursquare },
  { key: 'hopscotch', label: 'Hopscotch', surf: 'asphalt', fitted: true, paint: markHopscotch },
  { key: 'soccer', label: 'Soccer pitch', surf: 'field', fitted: true, paint: markSoccer },
  { key: 'baseball', label: 'Baseball diamond', surf: 'field', fitted: true, paint: markBaseball },
  { key: 'track', label: 'Running track', surf: 'track', fitted: true, paint: markTrack },
];

export const MARKING_KEYS = SITE_MARKINGS.map((m) => m.key);
const MARK_BY_KEY = new Map(SITE_MARKINGS.map((m) => [m.key, m]));
export const markingEntry = (key) => MARK_BY_KEY.get(key) || null;
export const readMarking = (v) => (typeof v === 'string' && MARK_BY_KEY.has(v) ? v : null);

// The paint on one region, in world feet. Everything downstream — the
// renderer's stripe meshes and the site plan's strokes — draws this same list,
// so a court you walk on is a court the plan draws.
export function markingsFor(region) {
  const entry = region && region.mark ? markingEntry(region.mark) : null;
  if (!entry || !region.pts || region.pts.length < 3) return [];
  const rect = minAreaRect(region.pts);
  if (!(rect.w > 0.5 && rect.d > 0.5)) return [];
  return entry.paint(region, rect) || [];
}

// ---------- the record ----------

let _fallbackId = 1;

export function makeRegion(pts, opts = {}) {
  const clean = cleanRing(pts);
  if (!clean || clean.length < 3) return null;
  const region = {
    id: 0,
    surf: readSurface(opts.surf) || DEFAULT_SURFACE,
    mark: readMarking(opts.mark),
    name: typeof opts.name === 'string' && opts.name.trim() ? opts.name.trim().slice(0, 60) : null,
    pts: clean.map((p) => ({ x: p.x, z: p.z })),
  };
  // Wound the same way rooms are, so a signed area is positive and every
  // consumer can assume it.
  if (ringSignedArea(region.pts) < 0) region.pts.reverse();
  return regionArea(region) >= MIN_REGION_AREA ? region : null;
}

export const siteOf = (state) => (state && state.site && Array.isArray(state.site.regions) ? state.site : null);
export const regionsOf = (state) => {
  const s = siteOf(state);
  return s ? s.regions : [];
};

export function ensureSite(state) {
  if (!state.site || !Array.isArray(state.site.regions)) state.site = { regions: [] };
  return state.site;
}

export function addRegion(state, pts, opts = {}) {
  const site = ensureSite(state);
  if (site.regions.length >= MAX_REGIONS) return null;
  const region = makeRegion(pts, opts);
  if (!region) return null;
  region.id = Math.max(1, Math.floor(state.nextId || 1));
  state.nextId = region.id + 1;
  site.regions.push(region);
  return region;
}

export function removeRegion(state, id) {
  const site = siteOf(state);
  if (!site) return false;
  const i = site.regions.findIndex((r) => r.id === id);
  if (i < 0) return false;
  site.regions.splice(i, 1);
  return true;
}

export const regionById = (state, id) => regionsOf(state).find((r) => r.id === id) || null;

// The region under a point, last one first — regions are drawn in list order,
// so the one on top is the one you clicked, the same rule `shapeAt` follows.
export function regionAt(state, x, z) {
  const list = regionsOf(state);
  for (let i = list.length - 1; i >= 0; i--) {
    if (pointInRegion(list[i], x, z)) return list[i];
  }
  return null;
}

// What you are standing on, out on the site: a surface key, or null where
// there is nothing but graded earth. Phase 4's footsteps read this, which is
// how walking off the terrazzo onto gravel started sounding like it.
export function siteSurfaceAt(state, x, z) {
  const r = regionAt(state, x, z);
  return r ? r.surf : null;
}

export function normalizeRegion(raw, extent = 4000) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.pts)) return null;
  const pts = [];
  for (const p of raw.pts.slice(0, MAX_REGION_PTS)) {
    if (!p || typeof p.x !== 'number' || typeof p.z !== 'number') continue;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
    pts.push({ x: clamp(p.x, -extent, extent), z: clamp(p.z, -extent, extent) });
  }
  const region = makeRegion(pts, { surf: raw.surf, mark: raw.mark, name: raw.name });
  if (!region) return null;
  const id = Math.floor(Number(raw.id));
  region.id = Number.isFinite(id) && id > 0 ? id : (_fallbackId += 1);
  return region;
}

export const cloneRegion = (r) => ({ ...r, pts: r.pts.map((p) => ({ x: p.x, z: p.z })) });

// ---------- the schedule ----------

// Every surface in use on the site, with its area and the markings on it. The
// site plan prints it as a legend; Phase 7's bill of materials wants exactly
// these numbers, which is why the arithmetic is here and not in the drawing
// code — the same bargain `finishSchedule` struck in Phase 2.
export function siteSchedule(state) {
  const rows = new Map();
  for (const region of regionsOf(state)) {
    const entry = surfaceEntry(region.surf);
    let row = rows.get(region.surf);
    if (!row) {
      row = { key: region.surf, label: entry.label, color: entry.color, hatch: entry.hatch, sqft: 0, marks: [] };
      rows.set(region.surf, row);
    }
    row.sqft += regionArea(region);
    const mark = region.mark ? markingEntry(region.mark) : null;
    if (mark && !row.marks.includes(mark.label)) row.marks.push(mark.label);
  }
  return [...rows.values()].sort((a, b) => b.sqft - a.sqft);
}

// The whole site's extent in world feet — the regions, the building footprint
// and the graded terrain together — so the site plan knows what to frame.
export function siteBounds(state) {
  let b = null;
  const grow = (x, z) => {
    if (!b) b = { x0: x, z0: z, x1: x, z1: z };
    else {
      b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x);
      b.z0 = Math.min(b.z0, z); b.z1 = Math.max(b.z1, z);
    }
  };
  for (const region of regionsOf(state)) for (const p of region.pts) grow(p.x, p.z);
  grow(0, 0);
  grow((state.w || 0) * CELL, (state.h || 0) * CELL);
  for (const p of state.props || []) grow(p.x, p.z);
  return b;
}
