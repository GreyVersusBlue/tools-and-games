// shove.js — bump a chair and it scoots.
//
// Phase 11, and the one module in either arc with no downstream consumer at
// all. Nothing reads what this produces except the renderer, nothing is stored,
// and no analysis is a foot different because of it. It is here because a
// building you can walk through and not touch is a diorama.
//
// It is also, deliberately, almost no new arithmetic. `collide.js` spends its
// whole length answering "where does this box push the walker to"; a shove is
// that same answer, negated. Where the walker would have been moved a foot to
// the left by a chair, the chair is moved a foot to the right instead, and the
// walker keeps walking.
//
// Three things this is not, all of them on purpose:
//
// * **Not a solver.** One pass, one prop at a time, no iteration to a
//   consistent state. A shove that would put a chair inside a wall or inside
//   another prop is simply refused, and the chair stays where it was — which
//   is what a chair against a wall does.
// * **Not stacking.** A prop shoved into another prop stops; it never rides
//   up onto it, and nothing is ever supported by anything but the slab.
// * **Not persistent.** Nothing here touches `state.props`. The obstacle
//   records this moves belong to the collider, which is built when a walk
//   starts and thrown away when it ends, so the design is exactly what it was
//   before you walked into the furniture. Leave the walkthrough and every
//   chair is back where it was drawn.

import { WALKER_R, candidates, pushOutOfBox, pushOutOfSeg, doorSegments } from './collide.js';

// How far a prop may travel in one frame. A person walking at 5ft/s into a
// chair moves it about that far per second; the cap is what stops a long
// frame (a tab that was in the background, a headset re-projecting) from
// launching it across the gym.
export const MAX_SHOVE = 0.35;    // ft per frame
// Below this the contact is a rounding error rather than a bump. Without it a
// walker standing still against a chair jitters it forever, which costs a
// renderer update every frame and looks like the furniture is shivering.
export const MIN_SHOVE = 0.004;   // ft
// How much of the off-centre part of a shove turns the prop instead of sliding
// it. Tuned by eye to "a chair caught with a hip turns a little", not to any
// moment of inertia — there is no mass in this file.
export const SPIN = 0.5;
export const MAX_SPIN = 0.09;     // rad per frame

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// How readily a catalog row slides, 0 (not at all) to 1 (it takes the whole
// separation). `light: true` is the ordinary case and means 1; a number says
// this one is heavier than that. Anything else — a row that never mentions
// `light`, which is nearly all of them — is furniture that stays put.
export function shoveWeight(entry) {
  const v = entry && typeof entry === 'object' ? entry.light : entry;
  if (v === true) return 1;
  if (typeof v === 'number' && Number.isFinite(v)) return clamp(v, 0, 1);
  return 0;
}

// Is there room for `p` at (x, z)? The prop is treated as a circle of its own
// half-width for this test — light props are small and roughly square (a
// chair, a stool, a bin), and the alternative is a box-vs-box pass that would
// be the solver this file is not. `p` itself is skipped, so a prop never
// blocks itself.
export function shoveClear(collider, p, x, z) {
  const r = Math.min(p.hw, p.hd) * 0.9;
  const near = candidates(collider, x - r, z - r, x + r, z + r);
  for (const s of near.segs) if (pushOutOfSeg(s, x, z, r)) return false;
  for (const s of doorSegments(collider)) if (pushOutOfSeg(s, x, z, r)) return false;
  for (const o of near.props) {
    if (o === p) continue;
    if (pushOutOfBox(o, x, z, r)) return false;
  }
  return true;
}

// One frame of it. Walks the props near (x, z), moves the light ones out from
// under the walker, and returns the ones that actually went anywhere so the
// renderer can move the matching instances. Mutates the collider's obstacle
// records in place — that is the whole of the "no persistence" story: those
// records are the collider's, and the collider is the walk's.
export function shoveProps(collider, x, z, r = WALKER_R, opts = {}) {
  const moved = [];
  if (!collider || !collider.props || !collider.props.length) return moved;
  const maxStep = opts.maxStep ?? MAX_SHOVE;
  const near = candidates(collider, x - r, z - r, x + r, z + r);
  // `candidates` hands back an array it reuses between queries, and
  // `shoveClear` below queries again — so the list is copied before anything
  // is touched. Without this a second query mid-loop rewrites the list being
  // iterated, and props silently stop being shoved.
  for (const p of [...near.props]) {
    const w = shoveWeight(p);
    if (w <= 0) continue;
    const out = pushOutOfBox(p, x, z, r);
    if (!out) continue;                        // not touching it
    // The negation. `out` is where the walker would have been pushed to; the
    // prop goes the other way by the same amount, scaled by how light it is.
    let dx = (x - out.x) * w;
    let dz = (z - out.z) * w;
    const d = Math.hypot(dx, dz);
    if (d < MIN_SHOVE) continue;
    if (d > maxStep) { dx *= maxStep / d; dz *= maxStep / d; }
    const tx = p.x + dx, tz = p.z + dz;
    if (!shoveClear(collider, p, tx, tz)) continue;
    // A shove that misses the centre turns the thing as well as moving it.
    // The lever arm is where you hit it relative to its middle, and the cross
    // product of that with the push is the whole of the torque — no contact
    // point to find, and a head-on shove comes out at exactly zero.
    const wx = x - p.x, wz = z - p.z;
    const size = Math.hypot(p.hw, p.hd) || 1;
    const spin = clamp(((wx * dz - wz * dx) / (size * size)) * SPIN, -MAX_SPIN, MAX_SPIN);
    const from = { x: p.x, z: p.z, hw: p.hw, hd: p.hd };
    p.x = tx;
    p.z = tz;
    p.rotationY = (p.rotationY || 0) + spin;
    // The broad phase buckets props by where they *were*, so a prop that moves
    // and is not re-bucketed simply stops being found — a chair you could push
    // exactly once and never again. `idx` is the record's own place in
    // `collider.props`, set when the obstacles were built.
    if (collider.index && p.idx !== undefined) collider.index.reindex(p.idx, from, p);
    // `dx`/`dz` ride along because the caller wants to know how hard, not just
    // where: a chair nudged a thousandth of a foot and a chair kicked across
    // a classroom are the same record without them, and one of the two should
    // make a noise.
    moved.push({ id: p.id, type: p.type, x: p.x, z: p.z, rotationY: p.rotationY, dx, dz });
  }
  return moved;
}
