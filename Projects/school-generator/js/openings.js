// openings.js — what an opening actually *is* once it has to be built.
//
// shapes.js owns the record (`{ seg, t, w, ... }` — see `openingSpec` there).
// This file owns everything derived from it: where a door's leaves hang, how
// far they have swung, and where the mullions in a window fall. Three very
// different consumers read the same answers out of here —
//
//   render.js      hangs a mesh on each leaf and turns it every frame
//   collide.js     puts each leaf's *current* position in the walker's way
//   blueprint.js   draws the swing arc a leaf would trace
//
// — which is the whole point of deriving it once. A door you can walk through
// on screen is a door the plan draws open the same way, by construction, the
// way `solidSpans` already ties the walkable gap to the drawn gap.
//
// ## The one thing in this codebase that moves
//
// Everything before Phase 2 was static while you walked: the collider is built
// once at walk-start precisely because nothing could change underneath it. A
// door that swings as you approach breaks that, and it is worth being explicit
// about how little it breaks. The *world* is still static — walls, props and
// slabs are all exactly where the collider found them. What moves is a short
// list of leaves, each of which knows its own hinge and its own angle, and
// which collide.js consults separately from its baked segment list. So the
// cache stays valid; it simply isn't the whole story any more.
//
// Leaves are collected in a deterministic order (`collectDoorLeaves`) and
// carry a stable `key`, so the mesh render.js hung on a leaf and the obstacle
// collide.js resolves against are the same leaf, without either module having
// to describe a door to the other.
//
// Pure module: no three.js. Exercised by test/openings.test.mjs.

import {
  CELL, DOOR_W, DOUBLE_DOOR_W, WALL_H, isDoorEdge,
  EDGE_DOOR, EDGE_DOOR2, EDGE_WINDOW, EDGE_OPENING,
} from './grid.js';
import {
  shapesOf, segEnds, isBuilt, openingSpec, isDoorOpening,
  LEAF_NONE, LEAF_SINGLE, LEAF_DOUBLE, OP_WINDOW,
  WINDOW_SILL, WINDOW_H,
} from './shapes.js';

// A leaf swings a quarter turn and no further — past 90° it would be standing
// in the wall it hangs on.
export const SWING_MAX = Math.PI / 2;
// Leaf thickness and the sliver of clearance either side of it, so a closed
// pair doesn't intersect its own jambs.
export const LEAF_T = 0.17;         // ft
export const LEAF_GAP = 0.06;       // ft

// Auto-open: how close a walker gets before the door starts moving, how much
// further they have to be for it to close again (hysteresis, or a door you
// stand in the middle of flutters), and how fast it swings.
export const OPEN_NEAR = 5.5;       // ft
export const OPEN_FAR = 7.5;        // ft
export const OPEN_RATE = 3.2;       // full swings per second
// A leaf only answers to a walker on its own storey — the leaf list is
// per-floor, and this is the height band within it that counts as "here".
export const OPEN_BAND = WALL_H;    // ft

// Glazing: mullion spacing and the frame either side of a pane. Shared with
// the glass curtain wall in render.js so a window and a glazed partition are
// visibly the same construction at different sizes.
export const MULLION_BAY = 4;       // ft between mullions
export const FRAME_T = 0.22;        // ft of frame around a pane

// A grid edge has no record to carry options, so each variant is a fixed
// geometry: a single leaf in a 3ft opening, a pair filling the cell, or a
// glazed band with a jamb either side.
export const GRID_DOOR2_W = CELL;           // ft — the pair fills the edge
export const GRID_WINDOW_W = CELL - 0.5;    // ft — a jamb each side reads as a mullion

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------- leaves ----------

// The leaves an opening hangs, along the world segment a->b.
//
// A leaf is described by where it is hinged and which way it turns, not by
// where its far end is: the far end is a function of how far open it is, and
// that changes several times a second.
//
//   hx, hz   the hinge, in world feet
//   ang0     the direction the leaf points when shut, as an (x, z) angle
//   turn     +1 / -1 — which way `open` rotates it from `ang0`
//   len      leaf length, ft
//   cx, cz   the opening's own centre, which is what proximity is measured to
//   hand     +1 if this leaf hangs on the start jamb, -1 on the end one
//   wall     the wall's own direction, so "which side is the walker on" is
//            one dot product rather than a case split on `hand`
//
// `hand` picks the jamb the leaf hangs on (+1 the start of the run); `sw`
// picks the side of the wall it opens toward (+1 the run's left-hand normal).
// A double door ignores the record's `hand` — it hangs one leaf on each jamb
// by definition — but each of its leaves still has one of its own.
//
// `turn` starts at the modelled swing and is the one thing about a leaf that
// the walkthrough overrides: see `updateLeaves`, where a door about to open
// picks the direction that takes it *away* from whoever is approaching.
export function segLeaves(spec, a, b, key = '') {
  if (spec.window || spec.leaf === LEAF_NONE) return [];
  const dx = b.x - a.x, dz = b.z - a.z;
  const L = Math.hypot(dx, dz);
  if (L < 0.01) return [];
  const ang = Math.atan2(dz, dx);
  const ux = dx / L, uz = dz / L;
  const s = spec.t * L;
  const cx = a.x + ux * s, cz = a.z + uz * s;
  const half = spec.w / 2;
  const jamb = (side) => ({ x: a.x + ux * (s + side * half), z: a.z + uz * (s + side * half) });
  const common = {
    cx, cz, wall: ang, h: spec.h, lite: spec.lite, bar: spec.bar,
    sw: spec.sw, open: 0, want: 0,
  };

  if (spec.leaf === LEAF_DOUBLE) {
    const w = spec.w / 2 - LEAF_GAP;
    const lo = jamb(-1), hi = jamb(1);
    return [
      { ...common, key: `${key}#0`, hx: lo.x, hz: lo.z, ang0: ang, hand: 1, turn: spec.sw, len: w },
      { ...common, key: `${key}#1`, hx: hi.x, hz: hi.z, ang0: ang + Math.PI, hand: -1,
        turn: -spec.sw, len: w },
    ];
  }
  const at = jamb(-spec.hand);
  return [{
    ...common,
    key: `${key}#0`,
    hx: at.x, hz: at.z,
    ang0: spec.hand === 1 ? ang : ang + Math.PI,
    hand: spec.hand,
    turn: spec.hand * spec.sw,
    len: spec.w - LEAF_GAP,
  }];
}

// Where a leaf's free edge is at a given openness (0 shut, 1 at a quarter turn).
export function leafAngle(leaf, open = leaf.open) {
  return leaf.ang0 + clamp(open, 0, 1) * leaf.turn * SWING_MAX;
}

export function leafEnd(leaf, open = leaf.open) {
  const a = leafAngle(leaf, open);
  return { x: leaf.hx + Math.cos(a) * leaf.len, z: leaf.hz + Math.sin(a) * leaf.len };
}

// The leaf as a segment collide.js can push a body out of.
export function leafSegment(leaf, open = leaf.open) {
  const e = leafEnd(leaf, open);
  return { ax: leaf.hx, az: leaf.hz, bx: e.x, bz: e.z };
}

// ---------- collecting a storey's leaves ----------

// A grid door as the same `{ spec, a, b }` a polygon opening produces, so one
// leaf builder serves both halves of the room model. The lattice fixes the
// opening at the middle of the cell — an edge is a whole cell wide and has
// nowhere to record a position along itself.
export function gridDoorSpec(val) {
  const base = { window: false, t: 0.5, h: 7, sill: 0, lite: false, bar: false, hand: 1, sw: 1 };
  if (val === EDGE_DOOR2) {
    // A corridor pair: lites and push bars, because that is what a pair of
    // doors across a school corridor always is.
    return { ...base, leaf: LEAF_DOUBLE, w: GRID_DOOR2_W, lite: true, bar: true };
  }
  if (val === EDGE_OPENING) return { ...base, leaf: LEAF_NONE, w: DOOR_W };
  return { ...base, leaf: LEAF_SINGLE, w: DOOR_W };
}

// Every swinging leaf on one storey, in a fixed order with stable keys.
// Grid edges first (rows, then columns), then polygon rooms in `shapes[]`
// order — deterministic so render.js and collide.js agree about which leaf is
// which without exchanging anything but the key.
//
// The key carries the storey. It didn't have to while only one storey's doors
// could be moving — the camera is on exactly one of them — but a school with
// people in it has a door swinging on level 1 while another swings on level 2,
// and an edge index means the same thing on both.
export function collectDoorLeaves(state, floorIndex) {
  const floor = state && state.floors ? state.floors[floorIndex] : null;
  const out = [];
  if (!floor) return out;

  const grid = (val, ax, az, bx, bz, key) => {
    const spec = gridDoorSpec(val);
    // The opening sits in the middle of a run that overlaps its neighbours by
    // half a wall thickness in render.js; leaves are hung on the bare cell so
    // a pair meets in the middle of the edge, not somewhere past it.
    for (const leaf of segLeaves(spec, { x: ax, z: az }, { x: bx, z: bz }, key)) out.push(leaf);
  };

  for (let y = 0; y <= floor.h; y++) {
    for (let x = 0; x < floor.w; x++) {
      const i = y * floor.w + x;
      const v = floor.edgesH[i];
      if (isDoorEdge(v)) grid(v, x * CELL, y * CELL, (x + 1) * CELL, y * CELL, `f${floorIndex}:H:${i}`);
    }
  }
  for (let y = 0; y < floor.h; y++) {
    for (let x = 0; x <= floor.w; x++) {
      const i = y * (floor.w + 1) + x;
      const v = floor.edgesV[i];
      if (isDoorEdge(v)) grid(v, x * CELL, y * CELL, x * CELL, (y + 1) * CELL, `f${floorIndex}:V:${i}`);
    }
  }

  for (const shape of shapesOf(floor)) {
    shape.rings.forEach((ring, ri) => {
      ring.openings.forEach((o, oi) => {
        if (!isDoorOpening(o)) return;
        if (!isBuilt(ring.walls[o.seg])) return;
        const spec = openingSpec(o);
        if (spec.leaf === LEAF_NONE) return;
        const [a, b] = segEnds(ring, o.seg);
        for (const leaf of segLeaves(spec, a, b, `f${floorIndex}:s:${shape.id}:${ri}:${oi}`)) out.push(leaf);
      });
    });
  }
  return out;
}

// ---------- the swing ----------

// How close a leaf at a given openness comes to a point. The leaf is a segment
// from its hinge, so this is the usual point-to-segment distance — kept here
// rather than borrowed from collide.js so this module stays a leaf of the
// import graph (shapes and grid only).
export function leafDistanceTo(leaf, open, x, z) {
  const a = leafAngle(leaf, open);
  const dx = Math.cos(a) * leaf.len, dz = Math.sin(a) * leaf.len;
  const t = clamp(((x - leaf.hx) * dx + (z - leaf.hz) * dz) / (leaf.len * leaf.len), 0, 1);
  return Math.hypot(x - (leaf.hx + dx * t), z - (leaf.hz + dz * t));
}

// The body a door won't swing through. A walker's radius plus the leaf's own
// half-thickness: the same clearance collide.js would push them out to.
export const BODY_R = 0.99;   // ft

// Advance every leaf toward where a walker at (x, z) wants it. Returns true if
// anything moved, so a caller that only re-poses meshes on change can.
//
// Proximity is measured to the *opening*, not to the leaf: both halves of a
// double door open together, and a leaf that has already swung away from you
// doesn't shut itself because its own far end got further off.
//
// Which side of its own wall a point is on: +1 for the run's left-hand normal,
// -1 for the right. The same normal `wallPaint` and the blueprint's swing
// symbol use, so "left of the run" means one thing everywhere.
export function sideOfWall(leaf, x, z) {
  const nx = -Math.sin(leaf.wall), nz = Math.cos(leaf.wall);
  return (x - leaf.hx) * nx + (z - leaf.hz) * nz >= 0 ? 1 : -1;
}

// **A door opens away from you.** This is the one place the walkthrough
// overrides the model, and it is worth saying why rather than leaving it as a
// surprise in the diff.
//
// A leaf that swings toward an approaching walker is unusable: collide.js
// pushes the body out of the leaf exactly as fast as the leaf sweeps into the
// body, so a door and a person shove each other back down the corridor. Every
// fix that keeps the modelled swing is worse than the disease — refusing to
// open leaves you standing at a door that won't; opening anyway shoves you.
//
// A real door has the same problem and the same answer: you push the side you
// approach from. So a leaf about to move picks the direction that takes it
// away from whoever triggered it, which makes every door in the building
// double-acting for the duration of a walk. The record's own `sw` is
// untouched, and it is still what the plan draws — a floor plan states the
// designed hand of a door, not which way the last person through pushed it.
//
// The direction is chosen only from *shut*, so a door already swinging can't
// reverse into you halfway.
export function faceLeafAway(leaf, x, z) {
  const away = -sideOfWall(leaf, x, z) * leaf.hand;
  if (leaf.turn === away) return false;
  leaf.turn = away;
  return true;
}

// A leaf still will not swing *through* the walker. Facing it away covers the
// approach, but you can also step into the sweep of a door that is already
// moving — for that, refusing the step that would close on them is both the
// fix and what a real door does: it stops against you, and moves again when
// you do. A leaf that already overlaps the body is allowed any move that
// doesn't make the overlap worse, so it can never wedge.
export function updateLeaves(leaves, x, z, dt, opts = {}) {
  return updateLeavesFor(leaves, [{ x, z }], dt, opts);
}

// The crowd version, and since Phase 6 the one that does the work. A leaf
// answers to whoever is *nearest* — which is the person who would push it —
// and holds for anyone at all it would swing into, which is everyone else in
// the doorway. Both halves matter: nearest-only would let a door sweep through
// the second person in a queue, and all-of-them-equally would have a leaf
// facing away from someone across the corridor.
//
// **A body with `open: false` never opens a door, but a door still won't shut
// on it.** With one walker, proximity was intent: nobody stands next to a door
// they aren't using. With forty, a queue walking *past* a classroom holds its
// door open, and the open leaf — three feet of it, square across the corridor
// — is then what the queue can't get past. So the crowd tells each leaf who is
// actually heading through it, and everybody else is only ever something not
// to swing into.
export function updateLeavesFor(leaves, bodies, dt, opts = {}) {
  if (!bodies || !bodies.length) return false;
  const near = opts.near ?? OPEN_NEAR;
  const far = opts.far ?? OPEN_FAR;
  const rate = opts.rate ?? OPEN_RATE;
  const body = opts.bodyR ?? BODY_R;
  const push = opts.pushOpen !== false;
  const step = clamp(dt * rate, 0, 1);
  let moved = false;
  for (const leaf of leaves) {
    let closest = null, best = Infinity;
    for (const b of bodies) {
      if (b.open === false) continue;
      const d = Math.hypot(b.x - leaf.cx, b.z - leaf.cz);
      if (d < best) { best = d; closest = b; }
    }
    if (best < near) leaf.want = 1;
    else if (best > far) leaf.want = 0;
    if (leaf.open === leaf.want) continue;
    if (push && closest && leaf.open === 0 && leaf.want === 1
      && faceLeafAway(leaf, closest.x, closest.z)) moved = true;
    const delta = leaf.want - leaf.open;
    const next = Math.abs(delta) <= step ? leaf.want : leaf.open + Math.sign(delta) * step;
    if (body > 0) {
      let blocked = false;
      for (const b of bodies) {
        const here = leafDistanceTo(leaf, leaf.open, b.x, b.z);
        const there = leafDistanceTo(leaf, next, b.x, b.z);
        if (there < body && there < here) { blocked = true; break; }
      }
      if (blocked) continue;   // it would close on somebody — hold
    }
    leaf.open = next;
    moved = true;
  }
  return moved;
}

export function closeAll(leaves) {
  for (const leaf of leaves) {
    leaf.open = 0;
    leaf.want = 0;
    leaf.turn = leaf.hand * leaf.sw;   // back to the modelled hand
  }
  return leaves;
}

// ---------- glazing ----------

// Where the mullions fall in a run of glass, as distances along it. A bay is
// never stretched past `bay` — a 13ft window gets four 3.25ft bays, not three
// 4.3ft ones — so glazing keeps one rhythm across a facade built out of runs
// of different lengths.
export function mullionPositions(len, bay = MULLION_BAY) {
  const bays = Math.max(1, Math.ceil(len / bay - 1e-6));
  const out = [];
  for (let i = 1; i < bays; i++) out.push((i / bays) * len);
  return out;
}

// The sill/head band a window opening occupies, in feet above the floor.
export function windowBand(spec) {
  const sill = spec && Number.isFinite(spec.sill) ? spec.sill : WINDOW_SILL;
  const h = spec && Number.isFinite(spec.h) ? spec.h : WINDOW_H;
  return { sill, head: Math.min(WALL_H, sill + h), h };
}

// The grid's own window, as the spec a polygon one would have carried.
export const gridWindowSpec = () => ({
  window: true, kind: OP_WINDOW, leaf: LEAF_NONE, w: GRID_WINDOW_W, t: 0.5,
  sill: WINDOW_SILL, h: WINDOW_H, head: WINDOW_SILL + WINDOW_H,
  lite: false, bar: false, hand: 1, sw: 1,
});

// The width the lattice gives each of its opening kinds — the one number the
// grid says differently from a polygon wall, wanted by the renderer, the
// collider and the plan alike.
export function gridOpeningWidth(val) {
  if (val === EDGE_DOOR2) return GRID_DOOR2_W;
  if (val === EDGE_WINDOW) return GRID_WINDOW_W;
  if (val === EDGE_DOOR || val === EDGE_OPENING) return DOOR_W;
  return 0;
}

export { DOOR_W, DOUBLE_DOOR_W, LEAF_NONE, LEAF_SINGLE, LEAF_DOUBLE };
