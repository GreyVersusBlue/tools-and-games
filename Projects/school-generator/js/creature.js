// creature.js — where does it go, and when does it come for you?
//
// Phase 24's one body. Not an agent: agents.js is fourteen hundred lines of
// timetable society — seats, lunch queues, door-yielding politeness — and
// the creature has no schedule, no seat and no manners. Its goal model is a
// sightline query re-asked every couple of seconds: it prefers the corridor
// you are *not* looking down (Phase 21 inverted, the same cast with the
// arguments swapped), it stops the moment you see it, it closes when you
// don't, and stared at too long — with the chase armed — it comes at a speed
// no sprint outruns. You escape by breaking its line of sight, or by a door
// slamming between you; never by cardio.
//
// What it genuinely shares, it imports: the crowd's seeded `rng`, the
// navgraph's routes, the collider's `moveWalker` (through an injected
// `colliderFor`, the same bargain the crowd struck), and sightline's cast.
// Everything else it does with one switch statement.
//
// Pure module: no three.js, no DOM, no clock. `makeCreatureCtx` takes only
// functions, so the tests drive the whole hunt headless — the way every
// tool-shaped module here is driven.

import { rng } from './agents.js';
import { route, nodeAt } from './navgraph.js';
import { moveWalker } from './collide.js';
import { sightClear } from './sightline.js';
import { EYE_H } from './grid.js';

// ---------- the numbers ----------

export const CREATURE_R = 1.1;    // ft — broader than a walker, on purpose
export const CREATURE_H = 6.9;    // ft — reads wrong in a 10ft corridor
export const LURK_SPEED = 4.6;    // ft/s — anyone's walk, until it isn't
export const CHASE_SPEED = 26;    // ft/s — a hair past SPRINT_SPEED's 24:
                                  // you break sight, you don't outrun it
export const CATCH_R = 2.2;       // ft
export const SEEN_FOV = 0.45;     // cos of the half-angle that counts as
                                  // "looking at it" — generous, because the
                                  // corner of your eye is the whole genre
export const STARE_S = 1.6;       // s of being seen before the chase, at
                                  // intensity 0.5 — harder nights snap sooner
export const LOS_BREAK_S = 2.5;   // s unseen mid-chase before it gives up
export const RELAX_S = 0.6;       // s unseen in a freeze before it moves again
export const DOOR_LOCKOUT_S = 3;  // s a slammed door costs it
export const SLAM_REACH = 8;      // ft — a slam this close breaks the chase
export const REPATH_S = 0.7;      // s between chase repaths — a hunter
                                  // repaths like a hunter
export const THINK_S = 1.8;       // s between lurk retargets
export const THUD_EVERY = 6;      // s, roughly, between being audible at all
// How near the player the lurk is allowed to orbit, by intensity: the band's
// near edge tightens as the night leans harder.
export const BAND_FAR = 120;      // ft
export const BAND_NEAR_SOFT = 60; // ft at intensity 0
export const BAND_NEAR_HARD = 24; // ft at intensity 1
// How many candidate nodes a think may cast at — the label gate's budget
// idea: sight is cheap, but not per-node-per-frame cheap.
export const THINK_CASTS = 8;

// ---------- making one ----------

// The creature, as a body the crowd's renderer already knows how to pose:
// x/z/y/floor/facing/gait/height and the three colours, all of them wrong.
export function makeCreature(opts = {}) {
  const seed = Number.isFinite(opts.seed) ? Math.max(1, Math.round(opts.seed)) : 1;
  const at = opts.at || { x: 0, z: 0, floor: 0 };
  return {
    id: -666,
    x: at.x, z: at.z, y: 0, floor: at.floor || 0,
    facing: 0, gait: 0, walked: 0,
    height: CREATURE_H,
    shirt: '#0b0d10', trousers: '#0b0d10', skin: '#141019',
    state: 'lurk',              // lurk | freeze | chase
    wp: null, i: 0,
    seenS: 0, unseenS: 0, lockout: 0,
    thinkAcc: THINK_S,          // think immediately on the first step
    repathAcc: 0, thudAcc: 0,
    rand: rng(seed),
  };
}

// Everything the brain is allowed to know, as injected functions — the
// `makeContext` pattern. `chaseArmed` and `intensity` are the caller's to
// retune every frame from the stage knobs.
export function makeCreatureCtx(nav, opts = {}) {
  return {
    nav,
    state: opts.state || null,
    colliderFor: opts.colliderFor || (() => ({ floor: 0, segs: [], props: [], doors: [], bodies: [] })),
    sightSegsFor: opts.sightSegsFor || (() => []),
    leavesFor: opts.leavesFor || ((f) => {
      const c = (opts.colliderFor || (() => null))(f);
      return (c && c.doors) || null;
    }),
    playerAt: opts.playerAt || (() => ({ x: 0, z: 0, floor: 0 })),
    // The direction the player faces, as a unit {x, z} in plan.
    playerLook: opts.playerLook || (() => ({ x: 0, z: 1 })),
    chaseArmed: opts.chaseArmed === true,
    intensity: Number.isFinite(opts.intensity) ? Math.min(1, Math.max(0, opts.intensity)) : 0.5,
  };
}

// ---------- being seen ----------

// Both halves of "seen": the creature is inside the player's view cone AND
// an unobstructed line runs eye to creature — sightline's cast with the
// arguments the label gate never swaps. Different storeys are never seen;
// the slab is the one occluder nobody argues with.
export function creatureSeen(ctx, c) {
  const eye = ctx.playerAt();
  if ((eye.floor || 0) !== (c.floor || 0)) return false;
  const dx = c.x - eye.x, dz = c.z - eye.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return true;
  const look = ctx.playerLook();
  if ((dx / d) * look.x + (dz / d) * look.z < SEEN_FOV) return false;
  return sightClear(ctx.sightSegsFor(eye.floor || 0), ctx.leavesFor(eye.floor || 0),
    eye.x, eye.z, c.x, c.z);
}

// ---------- choosing where to lurk ----------

const bandNear = (intensity) =>
  BAND_NEAR_SOFT + (BAND_NEAR_HARD - BAND_NEAR_SOFT) * intensity;

// The corridor you are not looking down: room nodes on the player's storey,
// inside the band, scored by whether the *player* can see them — at most
// THINK_CASTS casts, seeded sample. Unseen candidates close on the player;
// if everything in the band is watched, it drifts to the far edge and waits.
export function pickLurkTarget(ctx, c) {
  const nav = ctx.nav;
  if (!nav || !nav.nodes) return null;
  const eye = ctx.playerAt();
  const near = bandNear(ctx.intensity);
  const pool = [];
  for (const n of nav.nodes.values()) {
    if (n.kind !== 'room' || n.floor !== (eye.floor || 0)) continue;
    const d = Math.hypot(n.x - eye.x, n.z - eye.z);
    if (d < near * 0.5 || d > BAND_FAR) continue;
    pool.push({ n, d });
  }
  if (!pool.length) return null;
  // Seeded sample, then the casts.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(c.rand() * (i + 1));
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }
  const sample = pool.slice(0, THINK_CASTS);
  const segs = ctx.sightSegsFor(eye.floor || 0);
  const leaves = ctx.leavesFor(eye.floor || 0);
  let best = null, bestScore = -Infinity;
  for (const cand of sample) {
    const watched = sightClear(segs, leaves, eye.x, eye.z, cand.n.x, cand.n.z);
    // Unseen and near beats unseen and far; watched anything comes last, far
    // end first — out of view is where it lives.
    const score = watched
      ? -1000 + cand.d * 0.5 + c.rand()
      : 100 - Math.abs(cand.d - near) + c.rand() * 8;
    if (score > bestScore) { bestScore = score; best = cand.n; }
  }
  return best;
}

// ---------- the step ----------

// Follow the current waypoints at `speed` through the collider. A waypoint
// on another storey is a stair the creature takes in one stride — it gains
// on you in stairwells, which is both a simplification and a fact about
// stairwells.
function walkAlong(ctx, c, speed, dt) {
  if (!c.wp || c.i >= c.wp.length) return 0;
  let target = c.wp[c.i];
  if ((target.floor ?? c.floor) !== c.floor) {
    c.floor = target.floor;
    c.x = target.x; c.z = target.z;
    c.i++;
    return 0;
  }
  const dx = target.x - c.x, dz = target.z - c.z;
  const d = Math.hypot(dx, dz);
  if (d < 1) { c.i++; return 0; }
  const step = Math.min(speed * dt, d);
  const collider = ctx.colliderFor(c.floor);
  const moved = moveWalker(ctx.state, collider,
    { x: c.x, y: c.y, z: c.z }, (dx / d) * step, (dz / d) * step,
    { grounded: true, radius: CREATURE_R, skip: c.id });
  const walked = Math.hypot(moved.x - c.x, moved.z - c.z);
  c.x = moved.x; c.z = moved.z;
  if (moved.support) c.y = moved.support.y;
  c.walked += walked;
  c.gait += walked * 1.1;
  if (walked > 1e-4) c.facing = Math.atan2(dx, dz);
  // Held up by geometry — a door still swinging, a desk: skip the waypoint
  // rather than re-plan, the crowd's own lesson.
  if (walked < step * 0.2) { c.stuckS = (c.stuckS || 0) + dt; if (c.stuckS > 1.2) { c.stuckS = 0; c.i++; } }
  else c.stuckS = 0;
  return walked;
}

const retarget = (ctx, c, node) => {
  if (!node) { c.wp = null; return; }
  c.wp = route(ctx.nav, { x: c.x, z: c.z, floor: c.floor }, node.id || node);
  c.i = 0;
};

// Did it get you? Same storey, and inside its reach.
export const checkCaught = (c, at) =>
  (c.floor || 0) === (at.floor || 0) && Math.hypot(c.x - at.x, c.z - at.z) <= CATCH_R;

// A door just slammed at (x, z): if it is anywhere near the creature — its
// face, most likely — the chase breaks and the leaf is dead to it for a
// while. The caller detects the slam (haunt.js's `slamCandidate`); this is
// only the creature's side of the bargain.
export function noteSlam(ctx, c, at) {
  if ((at.floor ?? c.floor) !== c.floor) return false;
  if (Math.hypot(c.x - at.x, c.z - at.z) > SLAM_REACH) return false;
  c.lockout = DOOR_LOCKOUT_S;
  return true;
}

// One frame of the brain. Returns the events the caller turns into audio
// and consequences: 'thud' (heard through walls — the whole game), 'freeze',
// 'chase-start', 'chase-break', 'caught'.
export function stepCreature(ctx, c, dt) {
  const events = [];
  const eye = ctx.playerAt();
  c.lockout = Math.max(0, c.lockout - dt);
  const seen = creatureSeen(ctx, c);

  if (c.state === 'lurk') {
    if (seen) {
      c.state = 'freeze';
      c.seenS = 0; c.unseenS = 0;
      c.wp = null;
      events.push({ kind: 'freeze', x: c.x, z: c.z, floor: c.floor });
    } else {
      c.thinkAcc += dt;
      if (c.thinkAcc >= THINK_S || !c.wp || c.i >= c.wp.length) {
        c.thinkAcc = 0;
        retarget(ctx, c, pickLurkTarget(ctx, c));
      }
      walkAlong(ctx, c, LURK_SPEED * (0.8 + 0.5 * ctx.intensity), dt);
      c.thudAcc += dt;
      if (c.thudAcc >= THUD_EVERY * (0.6 + 0.8 * c.rand())) {
        c.thudAcc = 0;
        events.push({ kind: 'thud', x: c.x, z: c.z, floor: c.floor });
      }
    }
  } else if (c.state === 'freeze') {
    if (seen) {
      c.unseenS = 0;
      c.seenS += dt;
      // Face what is looking at it. Slowly.
      c.facing = Math.atan2(eye.x - c.x, eye.z - c.z);
      if (ctx.chaseArmed && c.seenS > STARE_S / (0.5 + ctx.intensity)) {
        c.state = 'chase';
        c.repathAcc = REPATH_S;
        c.unseenS = 0;
        events.push({ kind: 'chase-start', x: c.x, z: c.z, floor: c.floor });
      }
    } else {
      c.seenS = 0;
      c.unseenS += dt;
      if (c.unseenS > RELAX_S) {
        c.state = 'lurk';
        c.thinkAcc = THINK_S;
      }
    }
  } else if (c.state === 'chase') {
    c.unseenS = seen ? 0 : c.unseenS + dt;
    if (c.unseenS > LOS_BREAK_S || c.lockout > 0) {
      c.state = 'lurk';
      c.wp = null;
      c.thinkAcc = THINK_S;
      events.push({ kind: 'chase-break', x: c.x, z: c.z, floor: c.floor });
    } else {
      c.repathAcc += dt;
      if (c.repathAcc >= REPATH_S) {
        c.repathAcc = 0;
        const node = nodeAt(ctx.nav, eye.floor || 0, eye.x, eye.z);
        if (node) retarget(ctx, c, node);
        // Run at the player, not at the middle of their room: the route gets
        // it through the doors; the last leg is the straight line.
        if (c.wp) c.wp = [...c.wp, { x: eye.x, z: eye.z, floor: eye.floor || 0, kind: 'walk' }];
      }
      walkAlong(ctx, c, CHASE_SPEED, dt);
      if (checkCaught(c, eye)) {
        c.state = 'lurk';
        c.wp = null;
        events.push({ kind: 'caught', x: c.x, z: c.z, floor: c.floor });
      }
    }
  }
  return events;
}

// After a catch the caller banishes it — haunt.js knows where — and this
// puts the body there with its head clear.
export function placeCreature(c, at) {
  c.x = at.x; c.z = at.z; c.floor = at.floor || 0;
  c.wp = null; c.i = 0;
  c.state = 'lurk';
  c.seenS = 0; c.unseenS = 0; c.lockout = 0;
  c.thinkAcc = THINK_S; c.thudAcc = 0;
}
