// terrain.js — the ground the school stands on.
//
// Every phase before this one believed one number: `GROUND_Y = 0`, the site is
// flat, everywhere, forever. It was a good lie — a floor-plan tool has no use
// for a hillside until it has something to put on one — but it is the first
// assumption this arc has had to take back rather than build on, and taking it
// back is what Phase 5 is.
//
// What replaces it is deliberately the smallest thing that can be true: a
// **heightfield**. A lattice of elevation posts over the site, sampled
// bilinearly, with a step (20ft) about five times the building grid's. No
// caves, no overhangs, no cliffs — a school site is a graded plane with some
// slope on it, and a heightfield says exactly that and nothing more. It also
// makes `supportAt()`'s "the site" answer a lookup instead of a constant,
// which is the line the wishlist wrote for this phase.
//
// Three things are worth knowing before reading on.
//
// * **The building's pad is derived, never stored.** A slab is at y = 0 by
//   definition — `floorBaseY` says so and eight phases of geometry agree — so
//   ground that runs under the building has to be at 0 too, or the school
//   either floats or is buried. Rather than forbid grading there (a rule you'd
//   have to re-enforce every time somebody laid a floor tile), the pad is a
//   *field*: `terrainField()` pulls every post within an apron of the
//   footprint down to 0 and eases back out to the graded height over a blend
//   band. Move a wall, and the pad moves with it, for free, the way stair cuts
//   and guardrails have moved with their links since Phase 4 of the first arc.
// * **A design with no terrain is a design on flat ground**, and stays byte
//   identical through a save. `state.terrain` is absent until somebody grades
//   something, `groundAt(null, ...)` is 0, and `isFlatTerrain()` is what
//   `serialize()` asks before writing the field out at all.
// * **The field is a probe, not a cache on the state.** `terrainField(state)`
//   is built once per rebuild and once per walk-start, the way `wallProbe`
//   is, and handed to whoever needs to ask. Nothing mutates the state to
//   answer a question about it.
//
// Pure module: no three.js. Exercised by test/terrain.test.mjs.

import { CELL } from './grid.js';
import { shapesOf, shapeBBox, pointInShape } from './shapes.js';

// Distance between elevation posts. Twenty feet is five building cells: fine
// enough to shape a berm, a swale or a slope up to a bus loop, coarse enough
// that a whole site is a few hundred numbers in the save file rather than a
// few hundred thousand. It is emphatically not a terrain-sculpting resolution,
// and that is the point — this is a site plan, not a landscape.
export const POST_FT = 20;
// How far past the building footprint the site extends when one is first
// made. Two hundred feet is about a parking lot and a bus loop on one side and
// a field on the other, which is the smallest site a school actually needs.
export const SITE_MARGIN = 200;   // ft
// Sanity rails. A post can't be more than this far off datum, and a site can't
// have more than this many posts — both so a hostile file can't ask for a
// gigabyte of Float64Array or a mountain the sun can't light.
export const MAX_ELEV = 120;      // ft either side of datum
export const MAX_POSTS = 20000;
export const MIN_COLS = 2;

// The building's pad. Everything within `PAD_APRON` of a floored cell is held
// at slab level; from there to `PAD_APRON + PAD_BLEND` the ground eases back
// to whatever it was graded to. Twenty feet of flat apron is a walkway and a
// door swing; sixty feet of blend is a slope no steeper than the grading tools
// would let you draw anyway.
export const PAD_APRON = 20;      // ft
export const PAD_BLEND = 60;      // ft

// Brush limits, shared by the site tool and its tests.
export const MIN_BRUSH = 15;      // ft
export const MAX_BRUSH = 200;     // ft

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, dflt) => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);
// Smoothstep, used for every falloff in this file so a brush edge, a pad blend
// and a contour all soften the same way.
const smooth = (t) => { const u = clamp(t, 0, 1); return u * u * (3 - 2 * u); };

// ---------- the record ----------
//
// A terrain is its own lattice, stated in full rather than derived from the
// building grid, because the two are allowed to disagree: grow the footprint
// after grading a site and the site is simply smaller than the building for a
// moment, with `groundAt` holding the edge value outward, which reads as "the
// ground keeps going" rather than as a cliff.
//
//   { x0, z0, step, cols, rows, h: [ ... cols*rows elevations, ft ] }

export function makeTerrain(x0, z0, cols, rows, step = POST_FT) {
  const c = Math.max(MIN_COLS, Math.floor(cols));
  const r = Math.max(MIN_COLS, Math.floor(rows));
  return {
    x0: num(x0, 0), z0: num(z0, 0),
    step: Math.max(1, num(step, POST_FT)),
    cols: c, rows: r,
    h: new Array(c * r).fill(0),
  };
}

// A site sized to the building it surrounds: the footprint plus a margin,
// rounded out to whole posts so the lattice lands on tidy coordinates.
export function terrainFor(state, margin = SITE_MARGIN, step = POST_FT) {
  const gw = (state.w || 0) * CELL, gh = (state.h || 0) * CELL;
  let minX = -margin, minZ = -margin, maxX = gw + margin, maxZ = gh + margin;
  // Polygon rooms are allowed outside the lattice, so the site has to be too —
  // otherwise the one wing that escapes the grid is the one standing on
  // nothing.
  for (const floor of state.floors || []) {
    for (const shape of shapesOf(floor)) {
      const b = shapeBBox(shape);
      if (!b) continue;
      minX = Math.min(minX, b.x0 - margin); maxX = Math.max(maxX, b.x1 + margin);
      minZ = Math.min(minZ, b.z0 - margin); maxZ = Math.max(maxZ, b.z1 + margin);
    }
  }
  const x0 = Math.floor(minX / step) * step;
  const z0 = Math.floor(minZ / step) * step;
  let cols = Math.ceil((maxX - x0) / step) + 1;
  let rows = Math.ceil((maxZ - z0) / step) + 1;
  // A hostile footprint could ask for more posts than anyone wants to carry;
  // coarsen rather than refuse, so the site still exists.
  while (cols * rows > MAX_POSTS) { cols = Math.ceil(cols / 2); rows = Math.ceil(rows / 2); step *= 2; }
  return makeTerrain(x0, z0, cols, rows, step);
}

export const ensureTerrain = (state) => (state.terrain || (state.terrain = terrainFor(state)));

// Is this terrain doing anything? A field of zeroes is flat ground, which is
// what a design without one already has — so `serialize()` leaves it out and a
// v6 file round-trips through v7 as the same bytes.
export function isFlatTerrain(t) {
  if (!t || !Array.isArray(t.h)) return true;
  for (let i = 0; i < t.h.length; i++) if (Math.abs(t.h[i]) > 1e-6) return false;
  return true;
}

export function normalizeTerrain(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const step = clamp(num(raw.step, POST_FT), 1, 500);
  const cols = clamp(Math.floor(num(raw.cols, 0)), MIN_COLS, MAX_POSTS);
  const rows = clamp(Math.floor(num(raw.rows, 0)), MIN_COLS, MAX_POSTS);
  if (cols * rows > MAX_POSTS) return null;
  const t = makeTerrain(num(raw.x0, 0), num(raw.z0, 0), cols, rows, step);
  const src = Array.isArray(raw.h) ? raw.h : [];
  for (let i = 0; i < t.h.length; i++) t.h[i] = clamp(num(src[i], 0), -MAX_ELEV, MAX_ELEV);
  return isFlatTerrain(t) ? null : t;
}

// Elevations are written to a tenth of a foot. A site's worth of raw doubles
// is most of a save file and none of that precision survives a 20ft lattice
// anyway; an inch and a fifth is well under what the eye can read off a berm.
export function packTerrain(t) {
  if (!t || isFlatTerrain(t)) return null;
  return {
    x0: t.x0, z0: t.z0, step: t.step, cols: t.cols, rows: t.rows,
    h: t.h.map((v) => Math.round(v * 10) / 10),
  };
}

export const postIdx = (t, c, r) => r * t.cols + c;

// Elevation at a post, with out-of-range indices holding the edge value. That
// clamp is the whole of this module's "what's past the site?" answer: the
// ground keeps doing what it was doing at the boundary.
export function postAt(t, c, r) {
  if (!t) return 0;
  const cc = clamp(Math.floor(c), 0, t.cols - 1);
  const rr = clamp(Math.floor(r), 0, t.rows - 1);
  return t.h[postIdx(t, cc, rr)] || 0;
}

// ---------- sampling ----------

// The graded elevation at a world point, bilinear between the four posts
// around it. This is the *raw* terrain — no building pad. Everything that
// wants the ground a walker actually stands on wants `terrainField` below.
export function rawHeightAt(t, x, z) {
  if (!t) return 0;
  const fx = (x - t.x0) / t.step, fz = (z - t.z0) / t.step;
  const c = Math.floor(fx), r = Math.floor(fz);
  const tx = clamp(fx - c, 0, 1), tz = clamp(fz - r, 0, 1);
  const h00 = postAt(t, c, r), h10 = postAt(t, c + 1, r);
  const h01 = postAt(t, c, r + 1), h11 = postAt(t, c + 1, r + 1);
  return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
}

// ---------- the building pad ----------

// How finely the footprint is rasterized before the distance sweep. The posts
// are 20ft apart and the apron is 20ft wide, so measuring "how far is this
// post from the building?" post-to-post would round a 4ft gap up to a whole
// spacing and let a hillside leak under a small schoolhouse. Rasterizing at
// one building cell and sweeping *there* costs a few thousand cells once per
// rebuild and makes the apron mean what it says at any building size.
const PAD_FINE = CELL;   // ft

// Which fine cells sit over the building. Grid cells and polygon rooms both
// count — a wing that escaped the lattice still has a slab under it — and only
// the ground storey is asked, since that is the one in contact with the earth.
function coveredMask(state, x0, z0, cols, rows, step) {
  const covered = new Uint8Array(cols * rows);
  const floor = (state.floors || [])[0];
  if (!floor) return covered;
  // Prefiltering by bounding box turns "test every polygon at every cell" into
  // "test the one polygon that could possibly contain it" — the difference
  // between a sweep you notice and one you don't.
  const boxes = shapesOf(floor).map((shape) => ({ shape, b: shapeBBox(shape) }));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = x0 + (c + 0.5) * step, z = z0 + (r + 0.5) * step;
      const gx = Math.floor(x / CELL), gy = Math.floor(z / CELL);
      let on = gx >= 0 && gy >= 0 && gx < floor.w && gy < floor.h && !!floor.cells[gy * floor.w + gx];
      if (!on) {
        for (const { shape, b } of boxes) {
          if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
          if (pointInShape(shape, x, z)) { on = true; break; }
        }
      }
      if (on) covered[r * cols + c] = 1;
    }
  }
  return covered;
}

// Distance from every cell to the nearest covered one, in feet, by the usual
// two-pass chamfer sweep. Approximate — a chamfer distance is a couple of
// percent off true Euclidean on the diagonals — and feeding a smoothstep over
// a sixty-foot blend, a couple of percent is invisible.
function chamfer(covered, cols, rows, step) {
  const INF = 1e9;
  const d = new Float64Array(cols * rows).fill(INF);
  for (let i = 0; i < d.length; i++) if (covered[i]) d[i] = 0;
  const diag = step * Math.SQRT2;
  const relax = (i, j, w) => { if (d[j] + w < d[i]) d[i] = d[j] + w; };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (c > 0) relax(i, i - 1, step);
      if (r > 0) relax(i, i - cols, step);
      if (c > 0 && r > 0) relax(i, i - cols - 1, diag);
      if (c < cols - 1 && r > 0) relax(i, i - cols + 1, diag);
    }
  }
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = cols - 1; c >= 0; c--) {
      const i = r * cols + c;
      if (c < cols - 1) relax(i, i + 1, step);
      if (r < rows - 1) relax(i, i + cols, step);
      if (c < cols - 1 && r < rows - 1) relax(i, i + cols + 1, diag);
      if (c > 0 && r < rows - 1) relax(i, i + cols - 1, diag);
    }
  }
  return d;
}

// The distance from each elevation post to the building, sampled off the fine
// sweep above.
function padDistance(state, t) {
  const width = (t.cols - 1) * t.step, depth = (t.rows - 1) * t.step;
  const fc = Math.max(2, Math.ceil(width / PAD_FINE) + 1);
  const fr = Math.max(2, Math.ceil(depth / PAD_FINE) + 1);
  const covered = coveredMask(state, t.x0, t.z0, fc, fr, PAD_FINE);
  const fine = chamfer(covered, fc, fr, PAD_FINE);
  const out = new Float64Array(t.cols * t.rows);
  for (let r = 0; r < t.rows; r++) {
    for (let c = 0; c < t.cols; c++) {
      const fx = Math.min(fc - 1, Math.max(0, Math.round((c * t.step) / PAD_FINE)));
      const fz = Math.min(fr - 1, Math.max(0, Math.round((r * t.step) / PAD_FINE)));
      out[postIdx(t, c, r)] = fine[fz * fc + fx];
    }
  }
  return out;
}

// The ground as it actually is: the graded heightfield, plus the distance from
// every post to the building that presses a pad into it. Build one per rebuild
// and per walk-start and pass it around; sampling it is two bilinear lookups
// and a smoothstep.
//
// Two lattices rather than one pre-multiplied lattice, and the reason is the
// small building. Blend the pad in per *post* and a 40ft schoolhouse on a 20ft
// lattice bleeds a few inches of hillside under its own slab, because the
// apron is narrower than the spacing of the posts that would have to record
// it. Interpolate the *distance* and apply the falloff at sample time and the
// apron is exact wherever it's asked, at any building size, for the cost of
// one extra lerp. The same trick keeps the pad's edge smooth: distance is a
// well-behaved thing to interpolate, and a smoothstep of an interpolation is
// still monotone.
//
// A state with no terrain still gets a field — a flat one — so callers never
// have to branch on whether the site has been graded. `flat` says which it is,
// for the readouts that want to say "level site".
export function terrainField(state) {
  const t = state && state.terrain ? state.terrain : null;
  if (!t) return emptyField();
  return {
    flat: isFlatTerrain(t), t,
    x0: t.x0, z0: t.z0, step: t.step, cols: t.cols, rows: t.rows,
    h: Float64Array.from(t.h),
    d: padDistance(state, t),
  };
}

export const emptyField = () => ({
  flat: true, t: null, x0: 0, z0: 0, step: POST_FT, cols: 0, rows: 0, h: null, d: null,
});

function lerpPost(arr, f, c, r) {
  const cc = clamp(Math.floor(c), 0, f.cols - 1);
  const rr = clamp(Math.floor(r), 0, f.rows - 1);
  return arr[rr * f.cols + cc] || 0;
}

function bilinear(arr, f, x, z) {
  const fx = (x - f.x0) / f.step, fz = (z - f.z0) / f.step;
  const c = Math.floor(fx), r = Math.floor(fz);
  const tx = clamp(fx - c, 0, 1), tz = clamp(fz - r, 0, 1);
  const a00 = lerpPost(arr, f, c, r), a10 = lerpPost(arr, f, c + 1, r);
  const a01 = lerpPost(arr, f, c, r + 1), a11 = lerpPost(arr, f, c + 1, r + 1);
  return (a00 * (1 - tx) + a10 * tx) * (1 - tz) + (a01 * (1 - tx) + a11 * tx) * tz;
}

// How much of the graded ground survives at a point: 0 on the building's own
// pad and its apron, 1 out past the blend band.
export function padWeight(field, x, z) {
  if (!field || !field.d) return 1;
  return smooth((bilinear(field.d, field, x, z) - PAD_APRON) / PAD_BLEND);
}

// The one function the rest of the build calls. `groundAt(null, x, z)` is 0,
// which is exactly what every caller did before this phase existed.
export function groundAt(field, x, z) {
  if (!field || !field.h || !field.cols) return 0;
  return bilinear(field.h, field, x, z) * padWeight(field, x, z);
}

// The padded ground at every post, as one flat array — what the terrain mesh
// is lofted from, what a contour marches over, and what the range readout
// measures. Equal to `groundAt` at each post by construction.
export function fieldHeights(field) {
  if (!field || !field.h || !field.cols) return new Float64Array(0);
  const out = new Float64Array(field.cols * field.rows);
  for (let r = 0; r < field.rows; r++) {
    for (let c = 0; c < field.cols; c++) {
      const i = r * field.cols + c;
      out[i] = field.h[i] * smooth((field.d[i] - PAD_APRON) / PAD_BLEND);
    }
  }
  return out;
}

// Downhill direction and steepness at a point, as a percent grade. The site
// panel prints it while you grade, because "8%" is a number a civil drawing
// uses and "a bit steep" is not — ADA caps a walking surface at 5% before it
// becomes a ramp, and a parking lot at 5% before it stops being one.
export function gradeAt(field, x, z, probe = 6) {
  const hx = groundAt(field, x + probe, z) - groundAt(field, x - probe, z);
  const hz = groundAt(field, x, z + probe) - groundAt(field, x, z - probe);
  const dx = hx / (2 * probe), dz = hz / (2 * probe);
  return { slope: Math.hypot(dx, dz), pct: Math.hypot(dx, dz) * 100, dx, dz };
}

// The surface normal, for the renderer. Same finite difference, turned into a
// unit vector with +Y up.
export function normalAt(field, x, z, probe = 6) {
  const g = gradeAt(field, x, z, probe);
  const len = Math.hypot(g.dx, 1, g.dz);
  return { x: -g.dx / len, y: 1 / len, z: -g.dz / len };
}

// ---------- grading ----------
//
// Three brushes, one falloff. Each returns whether it changed anything, so the
// editor knows whether a drag is worth an undo entry.

function brushPosts(t, x, z, radius, fn) {
  const rad = clamp(radius, MIN_BRUSH, MAX_BRUSH);
  const c0 = Math.floor((x - rad - t.x0) / t.step), c1 = Math.ceil((x + rad - t.x0) / t.step);
  const r0 = Math.floor((z - rad - t.z0) / t.step), r1 = Math.ceil((z + rad - t.z0) / t.step);
  let changed = false;
  for (let r = Math.max(0, r0); r <= Math.min(t.rows - 1, r1); r++) {
    for (let c = Math.max(0, c0); c <= Math.min(t.cols - 1, c1); c++) {
      const px = t.x0 + c * t.step, pz = t.z0 + r * t.step;
      const d = Math.hypot(px - x, pz - z);
      if (d > rad) continue;
      // 1 at the centre, 0 at the rim — a brush with a hard edge leaves a
      // mesa, and every mesa on a school site is a mistake.
      const w = smooth(1 - d / rad);
      const i = postIdx(t, c, r);
      const next = clamp(fn(t.h[i], w, i), -MAX_ELEV, MAX_ELEV);
      if (Math.abs(next - t.h[i]) > 1e-9) { t.h[i] = next; changed = true; }
    }
  }
  return changed;
}

// Raise (or, with a negative delta, lower) the ground under the brush.
export function raiseTerrain(t, x, z, radius, delta) {
  if (!t || !delta) return false;
  return brushPosts(t, x, z, radius, (h, w) => h + delta * w);
}

// Pull the ground under the brush toward one elevation. Passing no target
// levels to the mean under the brush, which is what "flatten" means when
// you're clearing a spot for a court rather than cutting to a datum.
export function flattenTerrain(t, x, z, radius, target = null, strength = 0.5) {
  if (!t) return false;
  let goal = target;
  if (goal === null || goal === undefined) {
    let sum = 0, n = 0;
    brushPosts(t, x, z, radius, (h) => { sum += h; n++; return h; });
    goal = n ? sum / n : 0;
  }
  const k = clamp(strength, 0, 1);
  return brushPosts(t, x, z, radius, (h, w) => h + (goal - h) * k * w);
}

// Average each post under the brush with its four neighbours — the standard
// relaxation, which is what takes the stairsteps out of a slope built by
// repeated clicks.
export function smoothTerrain(t, x, z, radius, strength = 0.5) {
  if (!t) return false;
  const k = clamp(strength, 0, 1);
  const src = t.h.slice();
  const at = (c, r) => src[clamp(r, 0, t.rows - 1) * t.cols + clamp(c, 0, t.cols - 1)] || 0;
  return brushPosts(t, x, z, radius, (h, w, i) => {
    const c = i % t.cols, r = Math.floor(i / t.cols);
    const avg = (at(c - 1, r) + at(c + 1, r) + at(c, r - 1) + at(c, r + 1)) / 4;
    return h + (avg - h) * k * w;
  });
}

// ---------- contours ----------
//
// The site plan's whole reason for existing. Marching squares over the field
// at a fixed interval, emitting one line segment per crossed cell edge pair —
// unordered, because a plan draws them as strokes and nothing here needs a
// closed loop. Pure arithmetic over the same lattice everything else samples,
// so a contour can never disagree with the ground the walker is standing on.

export const CONTOUR_FT = 2;      // ft between contour lines

export function contours(field, interval = CONTOUR_FT) {
  const out = [];
  if (!field || !field.h || field.cols < 2 || field.rows < 2) return out;
  const step = Math.max(0.25, interval);
  // The padded ground, per post. At a post the two bilinears in `groundAt`
  // both return that post's own value, so this lattice *is* what the walker
  // stands on there — a contour and a footstep can't disagree about a spot
  // height. Between posts a marching square reads the edge as linear where
  // `groundAt` reads it as a product of two lerps; the gap is an inch or two
  // on a 20ft lattice, and only near the pad's rim.
  const eff = fieldHeights(field);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < eff.length; i++) { lo = Math.min(lo, eff[i]); hi = Math.max(hi, eff[i]); }
  if (!(hi - lo > 1e-6)) return out;

  const first = Math.ceil(lo / step) * step;
  for (let level = first; level <= hi + 1e-9; level += step) {
    const segs = [];
    for (let r = 0; r < field.rows - 1; r++) {
      for (let c = 0; c < field.cols - 1; c++) {
        const h00 = eff[r * field.cols + c];
        const h10 = eff[r * field.cols + c + 1];
        const h11 = eff[(r + 1) * field.cols + c + 1];
        const h01 = eff[(r + 1) * field.cols + c];
        const x = field.x0 + c * field.step, z = field.z0 + r * field.step, s = field.step;
        // Corners in marching-squares order, walking the cell clockwise.
        const corner = [
          { x, z, h: h00 }, { x: x + s, z, h: h10 },
          { x: x + s, z: z + s, h: h11 }, { x, z: z + s, h: h01 },
        ];
        const cross = [];
        for (let e = 0; e < 4; e++) {
          const a = corner[e], b = corner[(e + 1) % 4];
          if ((a.h < level) === (b.h < level)) continue;
          const t = (level - a.h) / (b.h - a.h);
          cross.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
        }
        // Two crossings is the ordinary case; four is a saddle, and joining
        // them in found order is one of the two equally defensible readings.
        for (let k = 0; k + 1 < cross.length; k += 2) segs.push([cross[k], cross[k + 1]]);
      }
    }
    if (segs.length) out.push({ level: Math.round(level * 100) / 100, segs });
  }
  return out;
}

// The high and low points of a field, for the panel's readout.
export function terrainRange(field) {
  const eff = fieldHeights(field);
  if (!eff.length) return { lo: 0, hi: 0, relief: 0 };
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < eff.length; i++) { lo = Math.min(lo, eff[i]); hi = Math.max(hi, eff[i]); }
  return { lo, hi, relief: hi - lo };
}
