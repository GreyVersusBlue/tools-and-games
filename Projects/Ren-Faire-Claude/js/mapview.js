// mapview.js — the plat's geometry, pure. Phase 6.
//
// The grounds are a grid of `cols` x `rows` cells, each `cell` px square at
// scale 1 with a 1px gap between them and a 1px rule around them (TRACK,
// which is .grounds-map's gap and border in style.css; the suite reads the
// sheet back and fails if they drift). Around the tracks sits FRAME, the
// paper margin the double rule and the cartouche are drawn in. Together
// they are the *content*, measured in content px. A view is that content
// under one transform — scale, then translate by (tx, ty) — into a
// viewport of `viewport.w` x `viewport.h` screen px, the .plat-stage.
//
// Everything here is a plain object in and a new plain object out. main.js
// owns the one live view (in its `ui` object, beside pendingBuild) and
// applies it two ways: as a CSS transform on the DOM marker layer, and as
// the canvas transform plat.js paints the ground under. Both read the same
// numbers, which is the whole point: a wrong answer here is silent — the
// map still draws, the stall is just one cell over — so the arithmetic is
// in one file with a suite (tests/mapview.mjs) that round-trips it.
//
// Screen coordinates are relative to the stage's top-left. y grows down.

export const TRACK = { gap: 1, border: 1 };
export const FRAME = { left: 12, right: 12, top: 12, bottom: 34 };
export const MARKER_MARGIN = 2;
export const TOUCH_MIN = 44;
export const SCALE = { min: 0.5, max: 3 };
export const KEY_PAN = 40;
export const KEY_ZOOM = 1.25;

export function trackSize(cols, rows, cell) {
  return {
    w: cols * cell + (cols - 1) * TRACK.gap + 2 * TRACK.border,
    h: rows * cell + (rows - 1) * TRACK.gap + 2 * TRACK.border,
  };
}

export function contentSize(cols, rows, cell) {
  const t = trackSize(cols, rows, cell);
  return { w: FRAME.left + t.w + FRAME.right, h: FRAME.top + t.h + FRAME.bottom };
}

// Content px of a cell's top-left corner (the cell itself, not its gap).
export function cellOrigin(x, y, cell) {
  return {
    x: FRAME.left + TRACK.border + x * (cell + TRACK.gap),
    y: FRAME.top + TRACK.border + y * (cell + TRACK.gap),
  };
}

// The smallest scale a pointer is allowed: on a coarse pointer a DOM marker
// (the cell minus its margin each side) must still measure TOUCH_MIN on
// screen, which at a 48px cell is exactly scale 1 — a phone pans rather
// than shrinks. A mouse may go to SCALE.min.
export function minScaleFor({ cell, coarse, markerMargin = MARKER_MARGIN }) {
  if (!coarse) return SCALE.min;
  return Math.max(SCALE.min, TOUCH_MIN / (cell - 2 * markerMargin));
}

// What a DOM marker measures on screen under this view.
export function markerSize(view, markerMargin = MARKER_MARGIN) {
  return (view.cell - 2 * markerMargin) * view.scale;
}

export function createView({ cols, rows, cell, viewport, minScale = SCALE.min, maxScale = SCALE.max }) {
  const view = {
    cols, rows, cell,
    viewport: { w: viewport.w, h: viewport.h },
    minScale, maxScale,
    scale: 1, tx: 0, ty: 0,
  };
  return fit(view);
}

// The scale the map settles at: as wide as the stage allows, never past 1
// (a wider sheet centres the map rather than enlarging it, #247), never
// under the pointer's floor. A stage of zero width (a jsdom boot, or a
// stage not yet laid out) reads as content width, so the scale is 1.
export function restScale(view) {
  const c = contentSize(view.cols, view.rows, view.cell);
  const w = view.viewport.w > 0 ? view.viewport.w : c.w;
  const byWidth = w / c.w;
  return clamp(Math.min(1, byWidth), view.minScale, view.maxScale);
}

// The stage's height for this view at rest: the content's, at rest scale.
// Set once per layout; a later zoom does not grow the page.
export function stageHeight(view) {
  const c = contentSize(view.cols, view.rows, view.cell);
  return Math.round(c.h * restScale(view));
}

export function withViewport(view, viewport) {
  return clampPan({ ...view, viewport: { w: viewport.w, h: viewport.h } });
}

export function fit(view) {
  return clampPan({ ...view, scale: restScale(view), tx: 0, ty: 0 });
}

// Content narrower than the viewport on an axis sits centred; content
// wider than it may pan, but never past its own edge, and never so far
// that the west edge (where the gate is) is lost off the east side.
export function clampPan(view) {
  const c = contentSize(view.cols, view.rows, view.cell);
  const cw = c.w * view.scale, ch = c.h * view.scale;
  const vw = view.viewport.w > 0 ? view.viewport.w : cw;
  const vh = view.viewport.h > 0 ? view.viewport.h : ch;
  const tx = cw <= vw ? (vw - cw) / 2 : clamp(view.tx, vw - cw, 0);
  const ty = ch <= vh ? (vh - ch) / 2 : clamp(view.ty, vh - ch, 0);
  return { ...view, tx, ty };
}

export function panBy(view, dx, dy) {
  return clampPan({ ...view, tx: view.tx + dx, ty: view.ty + dy });
}

// Zoom by `factor` keeping the content under screen point (px, py) where
// it is — the cell under the cursor, or the pinch midpoint, does not slide.
export function zoomAt(view, px, py, factor) {
  const scale = clamp(view.scale * factor, view.minScale, view.maxScale);
  const k = scale / view.scale;
  return clampPan({
    ...view,
    scale,
    tx: px - (px - view.tx) * k,
    ty: py - (py - view.ty) * k,
  });
}

// Two fingers, before and after: the distance between them is the zoom
// factor, applied at the old midpoint, and the midpoint's travel is a pan.
export function pinch(view, [a0, b0], [a1, b1]) {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y);
  const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
  const m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
  const factor = d0 > 0 ? d1 / d0 : 1;
  return panBy(zoomAt(view, m0.x, m0.y, factor), m1.x - m0.x, m1.y - m0.y);
}

// Where the DOM marker layer goes: its top-left is the tracks' top-left,
// which sits FRAME in from the content's origin.
export function trackTransform(view) {
  return {
    x: view.tx + FRAME.left * view.scale,
    y: view.ty + FRAME.top * view.scale,
    scale: view.scale,
  };
}

// Screen rect of a footprint anchored at cell (x, y), w by h cells.
export function cellToRect(view, x, y, w = 1, h = 1) {
  const o = cellOrigin(x, y, view.cell);
  const span = n => n * view.cell + (n - 1) * TRACK.gap;
  return {
    x: view.tx + o.x * view.scale,
    y: view.ty + o.y * view.scale,
    w: span(w) * view.scale,
    h: span(h) * view.scale,
  };
}

// The cell under a screen point, or null: outside the tracks, or in the
// 1px gap between two cells, which belongs to neither.
export function screenToCell(view, px, py) {
  const cx = (px - view.tx) / view.scale - FRAME.left - TRACK.border;
  const cy = (py - view.ty) / view.scale - FRAME.top - TRACK.border;
  if (cx < 0 || cy < 0) return null;
  const pitch = view.cell + TRACK.gap;
  const x = Math.floor(cx / pitch), y = Math.floor(cy / pitch);
  if (x >= view.cols || y >= view.rows) return null;
  if (cx - x * pitch >= view.cell || cy - y * pitch >= view.cell) return null;
  return { x, y };
}

// Which sides the content runs past the viewport on, for the edge shading
// that says "more this way".
export function edges(view) {
  const c = contentSize(view.cols, view.rows, view.cell);
  const cw = c.w * view.scale, ch = c.h * view.scale;
  const vw = view.viewport.w > 0 ? view.viewport.w : cw;
  const vh = view.viewport.h > 0 ? view.viewport.h : ch;
  const eps = 0.5;
  return {
    west: view.tx < -eps,
    east: view.tx + cw > vw + eps,
    north: view.ty < -eps,
    south: view.ty + ch > vh + eps,
  };
}

export function zoomCentred(view, factor) {
  const vw = view.viewport.w > 0 ? view.viewport.w : contentSize(view.cols, view.rows, view.cell).w * view.scale;
  const vh = view.viewport.h > 0 ? view.viewport.h : contentSize(view.cols, view.rows, view.cell).h * view.scale;
  return zoomAt(view, vw / 2, vh / 2, factor);
}

// Arrow keys pan by KEY_PAN screen px toward the side named; + and - zoom
// about the centre; 0 fits. Anything else returns null, so the caller can
// let the key through.
export function keyboardStep(view, key) {
  switch (key) {
    case 'ArrowLeft': return panBy(view, KEY_PAN, 0);
    case 'ArrowRight': return panBy(view, -KEY_PAN, 0);
    case 'ArrowUp': return panBy(view, 0, KEY_PAN);
    case 'ArrowDown': return panBy(view, 0, -KEY_PAN);
    case '+': case '=': return zoomCentred(view, KEY_ZOOM);
    case '-': case '_': return zoomCentred(view, 1 / KEY_ZOOM);
    case '0': return fit(view);
    default: return null;
  }
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
