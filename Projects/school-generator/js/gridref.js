// gridref.js — the point the drawing grid indexes off.
//
// A grid is a pitch and an origin. `snapgrid.js` owns the pitch, which follows
// the zoom; this file owns the origin, which for thirty-four phases was
// silently the corner of the sheet and had no way to be anything else.
//
// That is fine right up until somebody traces a photograph. A scan of a real
// floor plan has its own module — column lines at 24ft, a corridor that starts
// 3ft 6in from the left edge of the paper — and none of it lands on the
// corner of *our* sheet. Snapping then fights the picture instead of helping
// with it: every wall you draw is a foot off the line you drew it on, and the
// grid is something to switch off rather than something to aim at.
//
// So: **click a point on the tracing image and the grid starts there.** A
// column centre, the inside face of an exterior wall, the corner of the
// building — whatever the plan itself counts from. Everything the drawing
// tools snap to shifts onto it, and the sheet does not move at all (the sheet
// starts at the origin and grows +x and +z; that is footprint.js's constraint
// and this file does not touch it). What moves is the grid's *phase*.
//
// ## Before anything is drawn, and not after
//
// Re-phasing the grid under a plan that already exists would be a quiet
// catastrophe: every room and every wall was drawn on the old phase, and the
// moment the origin moves they are all off-grid — the brush freezes them (see
// `latticeAligned` in paint.js), the wall tool cannot meet them, and there is
// no gesture that puts it back. So the reference point can only be set while
// the design has **no rooms and no free-standing walls on any storey**, and
// `gridLocked` is that test. It is a real restriction and it is the honest
// one: this is a decision you make when you start tracing, in the same minute
// you measure the image's scale.
//
// ## Anchored to the picture, resolved to the world
//
// The record keeps both: `{ x, z }` in world feet, which is what everything
// snaps against, and `{ u, v }` in *image* pixels when the point was picked on
// an overlay, which is what survives the picture being nudged, turned or
// re-measured. `reanchorGridRef` re-resolves the world point from the image
// one — and refuses once the grid is locked, so aligning a scan after the
// building is drawn moves the picture and never the plan.
//
// Pure module: no three.js, no DOM. Exercised by test/gridref.test.mjs.

import { imageToWorld, worldToImage } from './overlay.js';
import { ORIGIN, asOrigin } from './snapgrid.js';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// The same range an overlay's own position is held in, for the same reason:
// a coordinate outside it is not a place on any sheet anybody will draw.
const LIMIT = 100000;

// ---------- the record ----------

// Never throws, never half-reads: a reference that isn't usable comes back as
// null and the design simply indexes off the corner, which is what every
// design before this one did. Same promise `normalizeOverlay` makes.
export function normalizeGridRef(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const x = num(raw.x), z = num(raw.z);
  if (x === null || z === null) return null;
  const out = { x: clamp(x, -LIMIT, LIMIT), z: clamp(z, -LIMIT, LIMIT) };
  // The image anchor is optional and is dropped whole if either half of it is
  // unreadable — half an anchor would re-resolve to somewhere nobody clicked.
  const u = num(raw.u), v = num(raw.v);
  if (u !== null && v !== null) { out.u = u; out.v = v; }
  return out;
}

export const gridRefOf = (state) => (state ? normalizeGridRef(state.gridRef) : null);

// Is this reference the default one? A design whose grid starts at the corner
// writes no `gridRef` key, which is the rule every optional record on the
// state follows.
export const isDefaultGridRef = (ref) => !ref || (ref.x === 0 && ref.z === 0);

// ---------- what the tools ask ----------

// Where the drawing grid starts, in world feet. The one function every tool
// and the sheet renderer call; everything else here exists to set it.
export function gridOrigin(state) {
  const ref = gridRefOf(state);
  return ref ? { x: ref.x, z: ref.z } : { ...ORIGIN };
}

// ---------- the lock ----------

// How much of a storey is already committed to the grid it was drawn on.
// Rooms and free-standing walls, and deliberately nothing else: a prop, a
// stair or a site region is placed in world feet and is not snapped to this
// grid, so none of them is a reason to refuse.
export const drawnOn = (floor) => (floor
  ? (Array.isArray(floor.shapes) ? floor.shapes.length : 0) +
    (Array.isArray(floor.walls) ? floor.walls.length : 0)
  : 0);

export function drawnCount(state) {
  if (!state || !Array.isArray(state.floors)) return 0;
  let n = 0;
  for (const f of state.floors) n += drawnOn(f);
  return n;
}

// Once anything is drawn the phase is what it was drawn on, and moving it
// would strand every one of them off-grid. See the note at the top.
export const gridLocked = (state) => drawnCount(state) > 0;

// ---------- setting it ----------

// A reference point from a click in world feet, carrying the image anchor when
// there is a picture under it — `worldToImage` is exact, so a point picked
// anywhere on the plan still records where it fell on the scan.
export function makeGridRef(x, z, overlay = null) {
  const base = { x: num(x), z: num(z) };
  if (base.x === null || base.z === null) return null;
  if (!overlay || !overlay.src) return normalizeGridRef(base);
  const p = worldToImage(overlay, base.x, base.z);
  return normalizeGridRef({ ...base, u: p.u, v: p.v });
}

// Set it, or say why not. The refusal is the whole safety of this feature, so
// it is a value the caller has to look at rather than a silent no-op.
export function setGridRef(state, ref) {
  if (!state) return { ok: false, reason: 'No design to set a grid on.' };
  const next = normalizeGridRef(ref);
  if (!next) return { ok: false, reason: 'That is not a point on the plan.' };
  if (gridLocked(state)) {
    return {
      ok: false,
      locked: true,
      reason: 'The grid is already indexed off what is drawn — the reference point ' +
        'can only be set on an empty plan, before the first floor or wall.',
    };
  }
  state.gridRef = next;
  return { ok: true, ref: next };
}

// Back to the corner of the sheet. Allowed on the same terms as setting it,
// because it moves the grid exactly as far.
export function clearGridRef(state) {
  if (!state) return { ok: false, reason: 'No design to clear a grid on.' };
  if (!state.gridRef) return { ok: true, ref: null };
  if (gridLocked(state)) {
    return {
      ok: false,
      locked: true,
      reason: 'The grid is already indexed off what is drawn — clearing the reference ' +
        'point would move it out from under every room on the plan.',
    };
  }
  delete state.gridRef;
  return { ok: true, ref: null };
}

// Re-resolve the world point from the image anchor, after the picture has been
// moved, turned or re-measured. A no-op without an anchor, without an overlay,
// or once the grid is locked — which is what keeps aligning a scan late in a
// design from dragging the grid off the building.
export function reanchorGridRef(state) {
  const ref = gridRefOf(state);
  if (!ref || ref.u === undefined) return false;
  const o = state && state.overlay;
  if (!o || !o.src) return false;
  if (gridLocked(state)) return false;
  const p = imageToWorld(o, ref.u, ref.v);
  if (Math.abs(p.x - ref.x) < 1e-9 && Math.abs(p.z - ref.z) < 1e-9) return false;
  state.gridRef = normalizeGridRef({ ...ref, x: p.x, z: p.z });
  return true;
}

// ---------- saying it ----------

const ft = (v) => (Math.abs(v - Math.round(v)) < 0.05
  ? String(Math.round(v))
  : v.toFixed(2).replace(/0$/, ''));

// One line for the panel: where the grid starts, whether it is pinned to the
// picture, and whether it can still be moved.
export function describeGridRef(state) {
  const ref = gridRefOf(state);
  const locked = gridLocked(state);
  if (!ref) {
    return locked
      ? 'The grid starts at the corner of the plan. Something is drawn already, so it stays there.'
      : 'The grid starts at the corner of the plan. Click a point on the tracing image ' +
        'to index it off that instead.';
  }
  const where = `The grid starts at ${ft(ref.x)}, ${ft(ref.z)} ft`;
  const pinned = ref.u !== undefined ? ', pinned to a point on the tracing image' : '';
  return `${where}${pinned}.` + (locked
    ? ' It is fixed there now — the plan has been drawn on it.'
    : ' Click again to move it, or Clear to go back to the corner.');
}

export { ORIGIN, asOrigin };
