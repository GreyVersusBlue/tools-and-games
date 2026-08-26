// footprint.js — how big the sheet is, and what has to fit on it.
//
// The design has always had a footprint — `state.w` x `state.h`, in 4ft cells,
// with its origin at (0, 0) — and until Phase 13 there was no way to change
// it. Forty by thirty cells is 160 x 120 ft, which is a small primary school
// and nothing else, and every design that arrived at the tool from outside
// discovered the limit the same way: a tracing image gets measured, turns out
// to be three hundred feet across, and two thirds of it lands off the sheet
// where the brush cannot reach it.
//
// So the footprint is a number somebody can set. That is nearly all this
// module is; the rest of it is the two questions that come with the number.
//
// **What has to fit.** A room is a free-floating polygon in world feet and is
// allowed to sit anywhere — but the 4ft brush rasterizes a storey onto a
// lattice the size of the footprint (see paint.js), and a room that hangs off
// the edge of that lattice comes back from a repaint clipped. So growing the
// sheet is always safe and shrinking it is not, and `atRisk` is what a caller
// asks before it shrinks: which rooms the brush would start cutting.
//
// **Where the sheet starts.** At the origin, and it grows +x and +z. That is a
// real constraint rather than an oversight — `inGrid`, `cellAt`, every
// rasterizer and the whole save format read a cell index straight off
// `floor(ft / CELL)`, and giving the sheet an origin would be a change to all
// of them for no drawing anybody wants to do. What follows from it is that
// fitting the sheet to a picture is two moves rather than one: slide the
// picture onto the positive quadrant, then grow the sheet to cover it. Which
// of the two is allowed is the caller's call, because sliding a picture
// somebody has already traced half of would be worse than a short sheet — see
// `fitToOverlay`.
//
// Pure module: no three.js, no DOM. Exercised by test/footprint.test.mjs.

import { CELL, MIN_CELLS, MAX_CELLS } from './grid.js';
import { shapesOf, shapeBBox } from './shapes.js';
import { latticeAligned } from './paint.js';
import { overlayCorners, moveOverlay } from './overlay.js';

// The sheet's range, in cells — grid.js's, re-exported here so that everything
// about sizing the drawing surface can be imported from one place. The floor
// is a room and a corridor; the ceiling is 800ft square, which is a large high
// school on a generous site and forty thousand cells if anybody paints all of
// it. They are the same two numbers `save-load.js` clamps a loaded design to,
// so the editor and the loader cannot disagree about them.
export { MIN_CELLS, MAX_CELLS };

export const MIN_FT = MIN_CELLS * CELL;
export const MAX_FT = MAX_CELLS * CELL;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, dflt) => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);

export const clampCells = (v) => clamp(Math.round(num(v, MIN_CELLS)), MIN_CELLS, MAX_CELLS);

// Feet to whole cells, rounded *out*: asking for 250ft of sheet gets you 252,
// because a sheet that is a foot short of what was asked for is the bug this
// module exists to fix.
export const cellsForFt = (ft) => clampCells(Math.ceil(num(ft, 0) / CELL));

// ---------- what the sheet covers ----------

export const footprintFt = (state) => ({
  w: (state && num(state.w, 0)) * CELL,
  d: (state && num(state.h, 0)) * CELL,
});

export function footprintBounds(state) {
  const s = footprintFt(state);
  return { x0: 0, z0: 0, x1: s.w, z1: s.d };
}

const growBounds = (b, x, z) => ({
  x0: Math.min(b.x0, x), z0: Math.min(b.z0, z),
  x1: Math.max(b.x1, x), z1: Math.max(b.z1, z),
});

export function unionBounds(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return {
    x0: Math.min(a.x0, b.x0), z0: Math.min(a.z0, b.z0),
    x1: Math.max(a.x1, b.x1), z1: Math.max(a.z1, b.z1),
  };
}

// Everything drawn on every storey, as one rectangle — or null for a design
// nobody has drawn in yet, which is the case that lets `fitToOverlay` move the
// picture instead of only growing the sheet.
export function planBounds(state) {
  let out = null;
  for (const floor of (state && state.floors) || []) {
    for (const shape of shapesOf(floor)) {
      const b = shapeBBox(shape);
      if (b) out = unionBounds(out, b);
    }
  }
  return out;
}

// The tracing image's four corners, in world feet. A rotated image is bounded
// by its corners rather than by its width and height, which is why this asks
// overlay.js for the corners rather than doing the arithmetic itself.
export function overlayBounds(o) {
  const pts = overlayCorners(o);
  if (!pts.length) return null;
  let b = { x0: pts[0].x, z0: pts[0].z, x1: pts[0].x, z1: pts[0].z };
  for (const p of pts) b = growBounds(b, p.x, p.z);
  return b;
}

// Is `b` entirely on the sheet? A hair of tolerance, because a bounds that was
// just fitted lands exactly on the edge and floating point should not make
// that a "no".
export function coversBounds(state, b) {
  if (!b) return true;
  const f = footprintBounds(state);
  return b.x0 >= -1e-6 && b.z0 >= -1e-6 && b.x1 <= f.x1 + 1e-6 && b.z1 <= f.z1 + 1e-6;
}

// ---------- resizing ----------

// Which rooms a sheet of `w` x `h` cells would start clipping. Only rooms the
// brush can rasterize are counted: a free-drawn room is frozen to the vertex
// tool (see paint.js) and no repaint ever touches it, so it can hang off the
// edge of the sheet forever without coming to harm.
export function atRisk(state, w, h) {
  const x1 = clampCells(w) * CELL, z1 = clampCells(h) * CELL;
  const out = [];
  (state.floors || []).forEach((floor, fi) => {
    for (const shape of shapesOf(floor)) {
      if (!latticeAligned(shape)) continue;
      const b = shapeBBox(shape);
      if (!b) continue;
      if (b.x0 < -1e-6 || b.z0 < -1e-6 || b.x1 > x1 + 1e-6 || b.z1 > z1 + 1e-6) {
        out.push({ floor: fi, id: shape.id, name: shape.name });
      }
    }
  });
  return out;
}

// Set the sheet. Every storey shares one footprint and one origin — that is
// grid.js's oldest constraint and what makes "the same place on the level
// above" a lookup rather than a transform — so each floor record is written
// too, since every pure helper reads its w/h off the floor rather than off the
// design.
export function resizeFootprint(state, w, h) {
  const nw = clampCells(w), nh = clampCells(h);
  const clamped = nw !== Math.round(num(w, MIN_CELLS)) || nh !== Math.round(num(h, MIN_CELLS));
  if (state.w === nw && state.h === nh) return { changed: false, w: nw, h: nh, clamped, risk: [] };
  const risk = (nw < state.w || nh < state.h) ? atRisk(state, nw, nh) : [];
  state.w = nw;
  state.h = nh;
  for (const floor of state.floors || []) { floor.w = nw; floor.h = nh; }
  return { changed: true, w: nw, h: nh, clamped, risk };
}

// Grow the sheet until `bounds` fits on it. Never shrinks — this is the call
// every "make room for that" gesture makes, and a fit that could also take
// sheet away is one nobody can use without reading it twice.
export function growToCover(state, bounds) {
  if (!bounds) return { changed: false, w: state.w, h: state.h, clamped: false, covered: true };
  const w = Math.max(state.w, cellsForFt(bounds.x1));
  const h = Math.max(state.h, cellsForFt(bounds.z1));
  const out = resizeFootprint(state, w, h);
  out.covered = coversBounds(state, bounds);
  return out;
}

// ---------- the tracing image ----------

// How far the picture has to slide to sit on the positive quadrant, snapped to
// whole cells so the image's own edge lands on a grid line rather than a
// sixteenth of one — you are about to trace it with a 4ft brush.
export function offsetOntoSheet(bounds) {
  if (!bounds) return { dx: 0, dz: 0 };
  const dx = bounds.x0 < 0 ? Math.ceil(-bounds.x0 / CELL) * CELL : 0;
  const dz = bounds.z0 < 0 ? Math.ceil(-bounds.z0 / CELL) * CELL : 0;
  return { dx, dz };
}

// Make the whole tracing image drawable: slide it onto the sheet if that is
// allowed, then grow the sheet to cover it.
//
// `move` is the caller's answer to the one question this gesture cannot decide
// for itself. A picture that has just been measured has nothing traced onto it
// and should be slid; a picture somebody has already drawn half a building
// over must not move, because every wall they drew would come away from the
// line it was traced from. Same for a locked overlay, which is what the lock
// is for.
//
// Mutates the design — the sheet, and the overlay record — and reports what it
// did. A design with no overlay is not an error; it is a fit with nothing to
// fit, and it says so.
export function fitToOverlay(state, opts = {}) {
  const o = state && state.overlay;
  if (!o || !o.src) return { changed: false, moved: null, covered: true, w: state.w, h: state.h };
  const drawn = !!planBounds(state);
  const move = opts.move === undefined ? (!o.locked && !drawn) : !!opts.move;
  let bounds = overlayBounds(o);
  let moved = null;
  if (move) {
    const { dx, dz } = offsetOntoSheet(bounds);
    if (dx || dz) {
      const next = moveOverlay(o, dx, dz);
      if (next !== o) {
        state.overlay = next;
        moved = { dx, dz };
        bounds = overlayBounds(next);
      }
    }
  }
  const out = growToCover(state, bounds);
  out.moved = moved;
  out.changed = out.changed || !!moved;
  // What is still off the sheet: the negative corner of an image that wasn't
  // allowed to move, or an image so big the sheet's own ceiling cannot cover
  // it. Reported rather than hidden — the whole complaint this phase answers
  // is a sheet that quietly stopped short of the picture.
  out.covered = coversBounds(state, bounds);
  out.bounds = bounds;
  return out;
}

// One line for the panel: how big the sheet is, and in cells as well as feet
// because the brush works in cells and a plan is dimensioned in feet.
export function describeFootprint(state) {
  const f = footprintFt(state);
  return `${f.w.toLocaleString()} × ${f.d.toLocaleString()} ft — ` +
    `${state.w} × ${state.h} cells of ${CELL}ft`;
}
