// snapgrid.js — the drawing grid you aim at, how fine it is, and where it
// starts.
//
// Until this module the 4ft lattice was the only thing a drawing tool could
// snap to, and it was 4ft whether the screen showed six hundred feet of site
// or thirty feet of one classroom. Both ends of that are wrong: zoomed out,
// 4ft lines are a grey wash nobody reads; zoomed in, 4ft is coarser than the
// thing being drawn — you cannot put a wall a foot off a column with it.
//
// So the grid has a *pitch* now, and the pitch is a function of the zoom. It
// steps through a ladder of round numbers rather than sliding, because a grid
// you can count on ("that's three squares, so twelve feet") stops being a
// measuring instrument the moment its squares are 3.7ft. The ladder is in
// feet and doubles: two feet to thirty-two.
//
// The rule is one line: **pick the finest pitch that still leaves the view
// legible.** `MAX_LINES` is what "legible" means — how many grid lines may
// cross the shorter axis of the viewport before the next pitch up takes over.
// The 4ft cell (grid.js `CELL`) is still the unit rooms are painted in and
// still the pitch at the default zoom; it is no longer the only one.
//
// ## Two feet is the floor
//
// The ladder used to start at six inches, which was a number chosen because
// it was the finest thing the *wall* tool could conceivably want. Nothing is
// drawn at six inches: a wall lands on a point, and a floor lands on a
// *square*, and a six-inch square of floor is not a thing anybody places. Two
// feet is the smallest square a building is made of — half a 4ft module, a
// third of a corridor, the width of a door leaf — so that is where the ladder
// stops. Every step above it is a whole multiple of it, which is what lets one
// raster hold a plan drawn at every zoom (see paint.js).
//
// ## The grid has a phase
//
// A grid is a pitch *and an origin*, and for thirty-four phases the origin was
// silently (0, 0) — the corner of the sheet. That is the right default and the
// wrong only answer the moment somebody traces a photograph: a scan's column
// lines fall where they fall, and a grid that cannot be slid onto them is a
// grid you end up fighting. So every function here takes an origin, defaulting
// to the corner it always used, and `gridref.js` is what decides where it is.
//
// The *sheet* still starts at the origin and grows +x and +z — that is
// footprint.js's constraint and nothing here changes it. What moves is the
// grid's phase across it.
//
// Pure module: no three.js, no DOM. Exercised by test/snapgrid.test.mjs.

import { CELL } from './grid.js';

// The ladder, in feet. Every step is a whole number of the one below it and
// 4ft (the paint brush's cell) is on it, so a finer grid always subdivides
// the cells rather than cutting across them.
export const PITCHES = [2, 4, 8, 16, 32];

// How many lines may cross the view's height before the grid coarsens. Sized
// from the two ends it has to survive: at the closest zoom (30ft of view) it
// must land on the finest pitch there is, and at the default (140ft) it must
// still land on the 4ft cell every earlier version drew.
export const MAX_LINES = 56;

export const MIN_PITCH = PITCHES[0];
export const MAX_PITCH = PITCHES[PITCHES.length - 1];

// Where the grid starts when nobody has said otherwise: the corner of the
// sheet, which is what every version before this one assumed.
export const ORIGIN = Object.freeze({ x: 0, z: 0 });

// Read an origin off anything — a point, a partial one, a null. Every entry
// point below takes one, so this is the only place that has to be careful.
export const asOrigin = (o) => (o && Number.isFinite(o.x) && Number.isFinite(o.z)
  ? { x: o.x, z: o.z }
  : ORIGIN);

// The pitch to draw and snap to for a given view height, in feet. Monotonic in
// `viewHeight`: zooming in never coarsens the grid.
export function gridPitch(viewHeight, maxLines = MAX_LINES) {
  const h = Number.isFinite(viewHeight) && viewHeight > 0 ? viewHeight : CELL * 35;
  const lines = Math.max(4, maxLines);
  for (const p of PITCHES) if (h / p <= lines) return p;
  return MAX_PITCH;
}

// Which of the drawn lines carry weight. The 20ft rule the sheet has always
// counted by, expressed against whatever the pitch is: once the grid is finer
// than a cell the heavy line falls on the cell, so the 4ft module stays
// readable underneath the finer one.
export function majorEvery(pitch) {
  const p = pitch > 0 ? pitch : CELL;
  if (p < CELL) return Math.max(2, Math.round(CELL / p));
  return 5;
}

// ---------- snapping ----------

// The nearest line of the grid to one coordinate. `origin` is where the grid
// starts; leave it out and it starts at zero, which is what every caller
// before the reference point wanted.
export const snapValue = (v, pitch, origin = 0) => (pitch > 0
  ? origin + Math.round((v - origin) / pitch) * pitch
  : v);

// The nearest intersection of the grid to a world point.
export const snapToGrid = (x, z, pitch, origin) => {
  const o = asOrigin(origin);
  return { x: snapValue(x, pitch, o.x), z: snapValue(z, pitch, o.z) };
};

// How far the snap moved the cursor — what a tool shows a snap indicator for.
export const snapDistance = (x, z, pitch, origin) => {
  const p = snapToGrid(x, z, pitch, origin);
  return Math.hypot(p.x - x, p.z - z);
};

// Hold `b` on the grid-parallel axis through `a` — the "snap parallel to the
// grid" toggle. Whichever of the two deltas is longer survives; the other goes
// to zero, so the run is axis-aligned and both ends stay on the grid.
export function orthoPoint(a, b) {
  if (!a) return { x: b.x, z: b.z };
  const dx = b.x - a.x, dz = b.z - a.z;
  return Math.abs(dx) >= Math.abs(dz)
    ? { x: b.x, z: a.z }
    : { x: a.x, z: b.z };
}

// The whole pipeline a point-target tool runs a raw cursor through: snap to
// the nearest intersection, then — if the parallel toggle is on and there is
// an anchor to be parallel *to* — square it up against that anchor.
//
// Squaring after snapping is deliberate and is why an ortho run still lands on
// intersections: `orthoPoint` only ever copies one coordinate from a point
// that is already on the grid.
export function targetPoint(x, z, opts = {}) {
  const pitch = opts.pitch > 0 ? opts.pitch : CELL;
  const p = opts.snap === false ? { x, z } : snapToGrid(x, z, pitch, opts.origin);
  return opts.ortho && opts.from ? orthoPoint(opts.from, p) : p;
}

// ---------- tiles ----------
//
// A wall lands on a *point* and a floor lands on a *square*, and those are two
// different questions about the same grid. Everything above answers the first;
// the six below answer the second.
//
// A tile is named by the two whole numbers that index it from the origin, so
// tiles are comparable, hashable and — the reason it is an index pair rather
// than a rectangle — the same tile whichever corner of it the cursor is in.

// Which tile a world point falls in. A point exactly on a line belongs to the
// tile on its + side, which is the rule `Math.floor` has always given the 4ft
// cell.
export const tileAt = (x, z, pitch, origin) => {
  const o = asOrigin(origin);
  const p = pitch > 0 ? pitch : CELL;
  return { ix: Math.floor((x - o.x) / p), iz: Math.floor((z - o.z) / p) };
};

// ...and back: the square that tile covers, in world feet.
export const tileBounds = (ix, iz, pitch, origin) => {
  const o = asOrigin(origin);
  const p = pitch > 0 ? pitch : CELL;
  return { x0: o.x + ix * p, z0: o.z + iz * p, x1: o.x + (ix + 1) * p, z1: o.z + (iz + 1) * p };
};

export const tileCentre = (ix, iz, pitch, origin) => {
  const b = tileBounds(ix, iz, pitch, origin);
  return { x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 };
};

// The square under the cursor, which is what a floor tool actually wants: one
// call instead of `tileBounds(...tileAt(...))` at every call site.
export const tileUnder = (x, z, pitch, origin) => {
  const t = tileAt(x, z, pitch, origin);
  return tileBounds(t.ix, t.iz, pitch, origin);
};

// Every tile between two corners, as the rectangle of indices a drag covers.
// Inclusive at both ends: a drag that never leaves one square still lays it.
export function tileSpan(a, b, pitch, origin) {
  const ta = tileAt(a.x, a.z, pitch, origin);
  const tb = tileAt(b.x, b.z, pitch, origin);
  const ix0 = Math.min(ta.ix, tb.ix), ix1 = Math.max(ta.ix, tb.ix);
  const iz0 = Math.min(ta.iz, tb.iz), iz1 = Math.max(ta.iz, tb.iz);
  return { ix0, ix1, iz0, iz1, w: ix1 - ix0 + 1, h: iz1 - iz0 + 1 };
}

// The world rectangle a span covers — what the rectangle cursor is drawn from
// and what the brush is handed.
export function spanBounds(span, pitch, origin) {
  const a = tileBounds(span.ix0, span.iz0, pitch, origin);
  const b = tileBounds(span.ix1, span.iz1, pitch, origin);
  return { x0: a.x0, z0: a.z0, x1: b.x1, z1: b.z1 };
}

// ---------- sliding along a segment ----------
//
// A point sliding along a wall snaps to the grid intersections the wall sits
// on — with one deliberate stretch of the phrase. An axis-aligned wall truly
// crosses intersections, and there the world coordinate along the run is
// snapped, so the marks are real grid crossings even when the wall's own
// endpoints were placed off-grid with Alt. A diagonal wall generally crosses
// *no* intersections at all, so the literal rule would leave nothing to snap
// to; instead the distance from the wall's own start is held to pitch
// multiples. Since `targetPoint` puts drawn endpoints on the grid, those
// multiples coincide with the drawing grid whenever the wall was gridded — a
// ruler that always exists beats an exact rule that is usually empty.
//
// Returns the snapped centre as `{ t, s, x, z }`: fraction of the run,
// distance from `a` in feet, and the world point. The projection is clamped
// to the segment first, so a cursor past either end answers that end.
const AXIS_EPS = 1e-6;

export function snapAlongSeg(a, b, x, z, pitch, opts = {}) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (!(len > 0)) return { t: 0, s: 0, x: a.x, z: a.z };
  const p = pitch > 0 ? pitch : CELL;
  const o = asOrigin(opts.origin);
  const ux = dx / len, uz = dz / len;
  const clamp = (v) => Math.min(len, Math.max(0, v));
  let s = clamp((x - a.x) * ux + (z - a.z) * uz);
  if (opts.snap !== false) {
    if (Math.abs(dx) <= AXIS_EPS) {
      s = (snapValue(a.z + uz * s, p, o.z) - a.z) / uz;
    } else if (Math.abs(dz) <= AXIS_EPS) {
      s = (snapValue(a.x + ux * s, p, o.x) - a.x) / ux;
    } else {
      s = snapValue(s, p);
    }
    s = clamp(s);
  }
  return { t: s / len, s, x: a.x + ux * s, z: a.z + uz * s };
}

// ---------- reading a run back ----------

export const runLength = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);

// The run's bearing in degrees, measured from +x toward +z and normalized to
// [0, 360). Reported rather than stored — it is a thing to read off the status
// line while drawing, never a field on anything.
export function runAngle(a, b) {
  const deg = (Math.atan2(b.z - a.z, b.x - a.x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

// Is this run square to the grid? A drawn wall that came out axis-aligned by
// hand should read the same as one the toggle squared up.
export const isAxisRun = (a, b, tol = 1e-6) =>
  Math.abs(b.x - a.x) <= tol || Math.abs(b.z - a.z) <= tol;

// "24 ft · 90°" — the live readout the wall tool rides on the cursor with.
//
// The angle is rounded, and a rounded angle is a small lie in exactly the
// case that matters: a run a hair off square still prints "90°", so the one
// reading that would have warned you looks identical to the one that
// wouldn't. When the rounding *would* claim square and the run isn't, the
// label spends a decimal place saying so instead. This is what `isAxisRun`
// was written for; until now nothing asked it.
export function runLabel(a, b) {
  const len = runLength(a, b);
  const deg = runAngle(a, b);
  // Both forms re-normalize after rounding: runAngle answers in [0, 360), but
  // a bearing a whisker under 360 rounds *up* and out of it, and "360°" is
  // not a bearing this readout is allowed to print.
  const wrap = (n) => ((n % 360) + 360) % 360;
  const rounded = wrap(Math.round(deg));
  const angle = rounded % 90 === 0 && !isAxisRun(a, b)
    ? `${wrap(Math.round(deg * 10) / 10).toFixed(1)}°`
    : `${rounded}°`;
  return `${len.toFixed(len < 10 ? 1 : 0)} ft · ${angle}`;
}
