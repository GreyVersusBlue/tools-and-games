// section.js — a set of records, repeated.
//
// Schools are the most repetitive building type there is, and until Phase 32
// the tool could not repeat anything: twenty classrooms meant drawing twenty
// classrooms. What was missing was never the geometry — shapes.js has had
// translate/rotate/mirror since Phase 6 — but the *set*: a clipboard that
// holds rooms together with the props inside them, a paste that can land the
// set anywhere, a row of copies at a spacing, a marquee that catches more
// than one room, and the backlog's missing verb, "move everything on this
// storey by (dx, dz)". Every one of those is the same operation — a transform
// over a set of records — so they live in one module.
//
// The clipboard itself is tool state, never file state: it holds *copies*
// (via `cloneShape`), carries no ids, and nothing here writes it anywhere.
// Ids are taken fresh at paste time off the state's own counter, which is the
// same promise `addShapeCopy` has always kept.
//
// Pure module: no three.js, no DOM. Exercised by test/section.test.mjs.

import { CELL } from './grid.js';
import {
  shapesOf, shapeBBox, pointInShape, cloneShape, addShapeCopy, translateShape,
  rotateShape90, rotatePoint90,
} from './shapes.js';
import { wrapAngle, addProp } from './props.js';
import { wallLinesOf } from './wallrun.js';

// The most copies one stamp gesture will lay down. Sixty-four rooms is a
// double-loaded corridor of thirty classrooms a side, which is more school
// than one drag should build; MAX_SHAPES still caps the storey underneath.
export const MAX_STAMP = 64;

const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// ---------- bounds ----------

// The combined bounding box of a set of rooms — the pivot for a group rotate,
// and the extent a stamp's pitch is measured from. Outer rings only: a hole
// is inside its room by definition.
export function sectionBounds(shapes) {
  let out = null;
  for (const sh of shapes || []) {
    const b = shapeBBox(sh);
    if (!b) continue;
    out = out
      ? {
        x0: Math.min(out.x0, b.x0), z0: Math.min(out.z0, b.z0),
        x1: Math.max(out.x1, b.x1), z1: Math.max(out.z1, b.z1),
      }
      : { ...b };
  }
  return out;
}

// ---------- the marquee ----------

// Does the segment a->b touch the axis-aligned box? Liang–Barsky clipping:
// walk the parameter interval [0,1] against each slab and see if anything
// survives. Chosen over "any endpoint inside" because the marquee's edge can
// cross a long wall whose corners both lie outside the box.
function segTouchesRect(a, b, r) {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dz = b.z - a.z;
  for (const [p, q] of [
    [-dx, a.x - r.x0], [dx, r.x1 - a.x],
    [-dz, a.z - r.z0], [dz, r.z1 - a.z],
  ]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t0 <= t1;
}

// Every room the rectangle from `a` to `b` catches, in storey order. A room
// counts if the rectangle touches it at all — crosses its boundary, sits
// wholly inside it, or swallows it whole — because a marquee that required
// full enclosure would need the person to know where a room ends before
// they have selected it to find out.
export function shapesInRect(floor, a, b) {
  const r = {
    x0: Math.min(a.x, b.x), z0: Math.min(a.z, b.z),
    x1: Math.max(a.x, b.x), z1: Math.max(a.z, b.z),
  };
  const out = [];
  for (const shape of shapesOf(floor)) {
    const bb = shapeBBox(shape);
    if (!bb || bb.x1 < r.x0 || bb.x0 > r.x1 || bb.z1 < r.z0 || bb.z0 > r.z1) continue;
    const ring = shape.rings[0];
    const caught =
      // a corner of the room inside the box…
      ring.pts.some((p) => p.x >= r.x0 && p.x <= r.x1 && p.z >= r.z0 && p.z <= r.z1) ||
      // …or the box inside the room…
      pointInShape(shape, (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2) ||
      // …or an edge of the room crossing the box with no corner in it.
      ring.pts.some((p, i) => segTouchesRect(p, ring.pts[(i + 1) % ring.pts.length], r));
    if (caught) out.push(shape);
  }
  return out;
}

// ---------- the clipboard ----------

// Props on `floorIndex` sitting inside any of `shapes`, deduplicated — two
// selected rooms overlapping is rare but not impossible.
export function propsInSection(state, floorIndex, shapes) {
  const seen = new Set();
  const out = [];
  for (const p of state.props || []) {
    if (p.floor !== floorIndex || seen.has(p.id)) continue;
    if (shapes.some((sh) => pointInShape(sh, p.x, p.z))) { seen.add(p.id); out.push(p); }
  }
  return out;
}

// A section to the clipboard: rooms — geometry, openings, finishes — and the
// props inside them. Everything is copied, nothing is referenced, and ids are
// dropped from the props on purpose: a clipboard that carried ids would paste
// records that collide with the originals'.
export function copySection(state, floorIndex, shapes) {
  if (!shapes || !shapes.length) return null;
  return {
    shapes: shapes.map(cloneShape),
    props: propsInSection(state, floorIndex, shapes).map((p) => ({
      type: p.type, x: p.x, z: p.z, y: p.y,
      rotationY: p.rotationY, scale: p.scale, mount: p.mount, data: { ...p.data },
    })),
  };
}

export const sectionEmpty = (clip) => !clip || !clip.shapes || !clip.shapes.length;

export const cloneSection = (clip) => (sectionEmpty(clip)
  ? { shapes: [], props: [] }
  : {
    shapes: clip.shapes.map(cloneShape),
    props: clip.props.map((p) => ({ ...p, data: { ...p.data } })),
  });

// Turn the pending clipboard a quarter turn about its own centre — what R
// does under the paste ghost. The prop rotation convention counter-rotates
// against section rotation (`rotationY -= φ` when the section turns by φ) —
// read the comments on rotateShape90 / rotatePoint90 before touching this.
export function rotateSection(clip, ccw = true) {
  if (sectionEmpty(clip)) return clip;
  const b = sectionBounds(clip.shapes);
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  const phi = ccw ? Math.PI / 2 : -Math.PI / 2;
  for (const sh of clip.shapes) rotateShape90(sh, cx, cz, ccw);
  for (const p of clip.props) {
    const r = rotatePoint90(p, cx, cz, ccw);
    p.x = r.x; p.z = r.z;
    p.rotationY = wrapAngle(p.rotationY - phi);
  }
  return clip;
}

// ---------- paste and stamp ----------

// Lay the clipboard down once per offset. Rooms that no longer fit (the
// storey's MAX_SHAPES, the prop cap) are refused by the same guards every
// other add goes through, and the refusals are *counted* rather than thrown:
// a stamp that fills the floor mid-row should say how far it got.
export function pasteSection(state, floorIndex, clip, offsets) {
  const out = { ids: [], shapes: 0, props: 0, refused: 0 };
  if (sectionEmpty(clip)) return out;
  for (const off of offsets || []) {
    const dx = fin(off && off.dx), dz = fin(off && off.dz);
    for (const sh of clip.shapes) {
      const added = addShapeCopy(state, floorIndex, sh, dx, dz);
      if (added) { out.ids.push(added.id); out.shapes += 1; } else out.refused += 1;
    }
    for (const p of clip.props) {
      const added = addProp(state, p.type, {
        ...p, x: p.x + dx, z: p.z + dz, floor: floorIndex,
      });
      if (added) out.props += 1; else out.refused += 1;
    }
  }
  return out;
}

// The offsets for a stamped row: from the anchor toward `to`, one copy per
// pitch, where the pitch is the clipboard's own extent along the dominant
// axis of the drag rounded up to whole cells — so classrooms land butted
// edge-to-edge on the lattice, which is what a corridor of them is. The
// anchor is always the first offset: a drag shorter than one pitch is a
// single paste, not a refusal.
export function stampRow(clip, anchor, to) {
  const adx = fin(anchor && anchor.dx), adz = fin(anchor && anchor.dz);
  const one = { offsets: [{ dx: adx, dz: adz }], pitch: 0, axis: null };
  if (sectionEmpty(clip)) return one;
  const b = sectionBounds(clip.shapes);
  if (!b) return one;
  const ddx = fin(to && to.dx) - adx, ddz = fin(to && to.dz) - adz;
  const alongX = Math.abs(ddx) >= Math.abs(ddz);
  const extent = alongX ? b.x1 - b.x0 : b.z1 - b.z0;
  const pitch = Math.max(CELL, Math.ceil(extent / CELL) * CELL);
  const dist = Math.abs(alongX ? ddx : ddz);
  const count = 1 + Math.min(MAX_STAMP - 1, Math.floor(dist / pitch));
  const sx = alongX ? Math.sign(ddx) * pitch : 0;
  const sz = alongX ? 0 : Math.sign(ddz) * pitch;
  const offsets = [];
  for (let k = 0; k < count; k++) offsets.push({ dx: adx + k * sx, dz: adz + k * sz });
  return { offsets, pitch, axis: alongX ? 'x' : 'z' };
}

// ---------- the storey ----------

// Move everything on one storey by (dx, dz): its rooms, its free-standing
// wall lines, and its props. The backlog's missing verb — a shrunk sheet can
// strand rooms past the edge where the brush cannot reach them, and the fix
// is to slide the storey, not to redraw it.
//
// Inter-floor links (stairs, lifts, ramps, floor openings) are deliberately
// *not* moved: a link stands on two storeys at once, and dragging it along
// with one of them would tear it off the other. They are counted and
// reported instead — never drop what you could not carry: say so.
export function moveStorey(state, floorIndex, dx, dz) {
  const floor = state.floors && state.floors[floorIndex];
  const out = { changed: false, rooms: 0, walls: 0, props: 0, links: 0 };
  const mx = fin(dx), mz = fin(dz);
  if (!floor || (!mx && !mz)) return out;
  for (const shape of shapesOf(floor)) {
    translateShape(shape, mx, mz);
    out.rooms += 1;
  }
  for (const line of wallLinesOf(floor)) {
    line.ax += mx; line.az += mz;
    line.bx += mx; line.bz += mz;
    out.walls += 1;
  }
  for (const p of state.props || []) {
    if (p.floor !== floorIndex) continue;
    p.x += mx; p.z += mz;
    out.props += 1;
  }
  for (const l of state.links || []) {
    if (l.from === floorIndex || l.to === floorIndex) out.links += 1;
  }
  out.changed = out.rooms + out.walls + out.props > 0;
  return out;
}
