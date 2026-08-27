// snapgrid.js — the drawing grid you aim at, and how fine it is.
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
// feet and doubles: half a foot to thirty-two.
//
// The rule is one line: **pick the finest pitch that still leaves the view
// legible.** `MAX_LINES` is what "legible" means — how many grid lines may
// cross the shorter axis of the viewport before the next pitch up takes over.
// The 4ft cell (grid.js `CELL`) is still the unit rooms are painted in and
// still the pitch at the default zoom; it is no longer the only one.
//
// Pure module: no three.js, no DOM. Exercised by test/snapgrid.test.mjs.

import { CELL } from './grid.js';

// The ladder, in feet. Every step is a whole number of the one below it and
// 4ft (the paint brush's cell) is on it, so a finer grid always subdivides
// the cells rather than cutting across them.
export const PITCHES = [0.5, 1, 2, 4, 8, 16, 32];

// How many lines may cross the view's height before the grid coarsens. Sized
// from the two ends it has to survive: at the closest zoom (30ft of view) it
// must not force a pitch finer than a foot, and at the default (140ft) it must
// still land on the 4ft cell every earlier version drew.
export const MAX_LINES = 56;

export const MIN_PITCH = PITCHES[0];
export const MAX_PITCH = PITCHES[PITCHES.length - 1];

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

export const snapValue = (v, pitch) => (pitch > 0 ? Math.round(v / pitch) * pitch : v);

// The nearest intersection of the grid to a world point.
export const snapToGrid = (x, z, pitch) => ({ x: snapValue(x, pitch), z: snapValue(z, pitch) });

// How far the snap moved the cursor — what a tool shows a snap indicator for.
export const snapDistance = (x, z, pitch) => {
  const p = snapToGrid(x, z, pitch);
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
  const p = opts.snap === false ? { x, z } : snapToGrid(x, z, pitch);
  return opts.ortho && opts.from ? orthoPoint(opts.from, p) : p;
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

// "24 ft · 90°" — the live readout the wall tool rides on the cursor with.
export function runLabel(a, b) {
  const len = runLength(a, b);
  return `${len.toFixed(len < 10 ? 1 : 0)} ft · ${Math.round(runAngle(a, b))}°`;
}

// Is this run square to the grid? A drawn wall that came out axis-aligned by
// hand should read the same as one the toggle squared up.
export const isAxisRun = (a, b, tol = 1e-6) =>
  Math.abs(b.x - a.x) <= tol || Math.abs(b.z - a.z) <= tol;
