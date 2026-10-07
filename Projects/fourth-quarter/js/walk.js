// walk.js — how a body gets across the room, and round the other bodies.
//
// Pure: layout.js and arithmetic, no three.js and no DOM, so the walk the game
// does every night is the walk `test/smoke-crowd.mjs` runs in Node. Route and
// stepToward() lived in patrons.js until #900 and could not be imported
// without a scene; they are here unchanged except that the room is handed in
// rather than read off world.js.
//
// The second half is local avoidance (#900). Route plans against the furniture
// and nothing else, so until this file two patrons walking opposite ways down
// one lane passed through each other. separate() runs once a frame, after
// every body has taken its step, and moves apart whatever now overlaps.

import { pathToward, navOpen, navGrid, stepBetween, floorYAt, inBounds, WALKER_R, SNAP_R } from "./layout.js";

const REPATH_D = 0.6;          // a target that moved this far gets a new plan
const WAYPOINT_R = 0.08;       // how close counts as "on" an intermediate corner
export const EXIT_SNAP = 2.5;  // DOOR_OUT sits outside the room on purpose

// ----------------------------------------------------------------- routing
// A queue of waypoints from layout.js's nav grid, replanned when the target
// moves. stepToward() still walks each leg; what changed is that the legs go
// round the furniture instead of through it. A route that cannot reach its
// target is not an error and not a freeze — it ends at the nearest point the
// floor does join to, and aim() returns false so the caller can decide.

export class Route {
  /** `layoutOf` answers "which room": world.js's currentLayout in the game,
   *  a closure over a description in a test. */
  constructor(layoutOf, within = SNAP_R) {
    this.layoutOf = layoutOf;
    this.pts = null; this.i = 0; this.to = null; this.complete = false; this.within = within;
  }

  /** Plan, or replan if the target has moved. False means the floor does not
   *  join `pos` to `to`; the route still leads somewhere, just not there. */
  aim(pos, to) {
    if (this.pts && this.to && Math.hypot(to.x - this.to.x, to.z - this.to.z) < REPATH_D) return this.complete;
    const res = pathToward(this.layoutOf(), pos, to, WALKER_R, this.within);
    this.to = { x: to.x, z: to.z };
    this.pts = res.pts.slice(1);
    if (!this.pts.length) this.pts = [{ x: res.pts[0].x, z: res.pts[0].z }];
    this.i = 0;
    this.complete = res.complete;
    return this.complete;
  }

  clear() { this.pts = null; this.to = null; this.i = 0; this.complete = false; }

  /** The waypoint being walked to right now — what a body should face. */
  head() { return this.pts && this.i < this.pts.length ? this.pts[this.i] : this.to; }

  /** Walk `dist` along the route, spilling what is left of a step into the
   *  next leg so a corner does not cost a frame. True once the last waypoint
   *  is within `arrive`. */
  step(pos, dist, arrive = 0.12) {
    if (!this.pts || !this.pts.length) return true;
    const desc = this.layoutOf();
    // arrived: stand on the floor, whatever the last stride left of a kerb
    const there = () => { pos.y = floorYAt(desc, pos.x, pos.z); return true; };
    let left = dist;
    while (this.i < this.pts.length) {
      const last = this.i === this.pts.length - 1;
      const wp = this.pts[this.i];
      const stop = last ? arrive : WAYPOINT_R;
      const d = Math.hypot(wp.x - pos.x, wp.z - pos.z);
      if (d <= stop) { if (last) return there(); this.i++; continue; }
      if (!stepToward(desc, pos, wp, left, stop)) return false;
      if (last) return there();
      left -= Math.max(0, d - stop);
      this.i++;
      if (left <= 0) return false;
    }
    return true;
  }
}

// ---------------------------------------------------------------- movement
// A body's y is the floor's (#200), and since #901 it gets there at a walk.
// The stair is a ramp, so climbing it was always smooth; what was not is its
// side near the foot, a kerb of up to STEP_H that the planner lets a body step
// over. Read straight off the floor that was the whole kerb in one 3 cm
// stride: 15.6 cm between two frames in a headless run, and #200's own note
// that it showed in the browser. So the feet follow the floor at FOOT_RATE and
// a kerb is taken over a few strides instead of one. Arriving puts a body
// exactly on the floor, so nothing stands still at the wrong height.

/** How fast a body's feet follow the floor: metres of rise per metre walked.
 *  Above MAX_SLOPE or a body would sink into the stair it is climbing; the
 *  number itself was picked without a screen to judge it on. */
export const FOOT_RATE = 1.2;

/** Move pos.y toward the floor under pos, by no more than a stride of `run`
 *  earns. */
export function settleY(desc, pos, run) {
  const fy = floorYAt(desc, pos.x, pos.z), dy = fy - pos.y, cap = FOOT_RATE * run;
  pos.y = Math.abs(dy) <= cap ? fy : pos.y + Math.sign(dy) * cap;
}

export function stepToward(desc, pos, target, step, arrive = 0.12) {
  const dx = target.x - pos.x, dz = target.z - pos.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d <= arrive) return true;
  if (step >= d) { pos.x = target.x; pos.z = target.z; settleY(desc, pos, d); return true; }
  const k = step / d;
  pos.x += dx * k; pos.z += dz * k;
  settleY(desc, pos, step);
  return false;
}

// ---------------------------------------------------------- local avoidance
//
// The rule, whole. Two bodies closer than their radii overlap, and the overlap
// is taken back out the same frame, along the line between them:
//
//   1. Who moves. A body that is walking into the other one moves; a body
//      that is standing, or walking away, does not. So a queue forms behind a
//      slow walker instead of shoving it, and nobody is pushed off a stool.
//   2. Which way. Back along the line, plus the same distance sideways to the
//      mover's right, so it comes round the other's shoulder instead of
//      walking on the spot behind it.
//   3. Where not. A move has to land on floor the nav grid calls open and
//      within a step of where it started, so nobody is pushed into a table,
//      through a wall or off the deck. If the sideways half does not fit, the
//      straight half is tried alone.
//   4. Right of way. Two walking into each other do not split it: the one
//      later in the list gives way and takes all of it, and the earlier one
//      keeps its line. Splitting stalls both wherever there is no room to
//      pass (a doorway, the funnel at the exit); this way one of them is
//      walked backwards out of the gap until the floor opens and rule 2
//      works again. Only if the later one has nowhere to go does the earlier
//      one move.
//   5. An errand. A walker is not pushed off a standing body that is where it
//      is going: a server reaching past a stool to the pass, or stopping at a
//      seated guest. It would never arrive otherwise.
//   6. Outside. Past the walls there is no floor to be pushed across, only the
//      line to DOOR_OUT, so a body over the threshold is out of the room and
//      nobody is moved off it.
//   7. The last resort. A body that has been shoved and is no further on
//      after STALL_T than a quarter of what it would have walked stops being
//      solid for GHOST_T and walks through. It is the old behaviour, kept as
//      the one thing that cannot deadlock, and `smoke-crowd.mjs` counts how
//      often it is needed.
//
// Nothing here is random, and nothing reads a clock: the same bodies in the
// same order give the same floor.
//
// What it does not do is plan. A shoved body walks on to the corner it was
// already heading for, from wherever it now stands. A version that checked
// that line after every shove and planned again when a table was in it was
// built and measured on eight crowded floors: the body-frames spent inside
// furniture did not move either way, so it is not here.

export const BODY_R = 0.2;     // personMesh()'s widest ring, at the hem
export const STALL_T = 1.2;    // seconds of walking nowhere before rule 7
export const GHOST_T = 0.8;    // long enough to cross one body at a walk
const STALL_PROGRESS = 0.25;   // under this share of the distance counts as nowhere
const ERRAND_R = 0.15;         // rule 5: how near its goal a standing body has to be
const TOUCH = 1e-4;

function crowdOf(b) {
  return b.crowd || (b.crowd = { t: 0, x: 0, z: 0, shoved: false, ghost: 0, pushed: false, hx: 0, hz: 0 });
}

function tryMove(desc, cols, b, dx, dz) {
  const p = b.pos, x = p.x + dx, z = p.z + dz;
  if (!navOpen(desc, x, z, WALKER_R, cols) || !stepBetween(desc, p.x, p.z, x, z)) return false;
  p.x = x; p.z = z;
  // a fixed body is never moved and a walker's y is its own: the boss's pos
  // is the camera's, at eye height, and is not this function's to write
  settleY(desc, p, Math.hypot(dx, dz));
  b.crowd.pushed = true;
  return true;
}

/** Rule 5: is the standing body `o` at the place walker `w` is going? */
function errand(w, o, reach) {
  const to = w.route && w.route.to;
  return !!to && Math.hypot(to.x - o.pos.x, to.z - o.pos.z) < reach + ERRAND_R;
}

/** Rule 2 for one body: `s` away from the other (nx, nz points from it to
 *  b) and `s` to b's right. False if that lands somewhere rule 3 refuses. */
function slide(desc, cols, b, nx, nz, s) {
  const c = b.crowd;
  // the tangent on the side of b's forward-right; with no heading, either
  let tx = -nz, tz = nx;
  if (tx * (c.hx - c.hz) + tz * (c.hz + c.hx) < 0) { tx = -tx; tz = -tz; }
  return tryMove(desc, cols, b, (nx + tx) * s, (nz + tz) * s);
}

/**
 * One frame of local avoidance. `bodies` is everything with a body: each has
 * `pos` ({x, y, z}, written), `walking` (is it under way this frame), `speed`
 * (m/s, for rule 7) and, if it walks, `route` (a Route). A body with
 * `solid: false` is skipped; a body with `fixed: true` is never moved (the
 * boss: the crowd goes round the player, the player is not shoved by it).
 * List order is the right of way in a doorway. Returns how many pairs
 * overlapped on the way in.
 */
export function separate(desc, bodies, dt) {
  const cols = navGrid(desc, WALKER_R).cols;
  const live = [];
  for (const b of bodies) {
    if (b.solid === false || !inBounds(desc, b.pos.x, b.pos.z, 0)) continue;
    const c = crowdOf(b);
    c.pushed = false;
    c.hx = 0; c.hz = 0;
    const head = b.walking && b.route ? b.route.head() : null;
    if (head) {
      const dx = head.x - b.pos.x, dz = head.z - b.pos.z, d = Math.hypot(dx, dz);
      if (d > TOUCH) { c.hx = dx / d; c.hz = dz / d; }
    }
    live.push(b);
  }

  // the flags are read once: a getter per pair was most of this function
  const n = live.length;
  const walks = new Array(n), reachOf = new Array(n);
  for (let i = 0; i < n; i++) {
    const b = live[i];
    walks[i] = !!b.walking && !b.fixed && b.crowd.ghost <= 0;
    reachOf[i] = b.crowd.ghost > 0 ? -1 : (b.r ?? BODY_R);
  }
  const go = (b, nx, nz, over) => slide(desc, cols, b, nx, nz, over) || tryMove(desc, cols, b, nx * over, nz * over);

  let touching = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      if (reachOf[i] < 0) continue;
      const a = live[i], ca = a.crowd, aw = walks[i];
      for (let j = i + 1; j < n; j++) {
        const bw = walks[j];
        if ((!aw && !bw) || reachOf[j] < 0) continue;
        const b = live[j];
        let nx = b.pos.x - a.pos.x, nz = b.pos.z - a.pos.z;
        const reach = reachOf[i] + reachOf[j];
        if (nx >= reach || nx <= -reach || nz >= reach || nz <= -reach) continue;
        const d = Math.hypot(nx, nz);
        if (d >= reach - TOUCH) continue;
        if (pass === 0) touching++;
        if ((aw && !bw && errand(a, b, reach)) || (bw && !aw && errand(b, a, reach))) continue;
        // two bodies on one point have no line between them: the list picks one
        if (d < TOUCH) { nx = 1; nz = 0; } else { nx /= d; nz /= d; }
        const over = reach - d, cb = b.crowd;
        // rule 1: n points a → b, so a walks into b when its heading runs with n
        const aIn = aw && ca.hx * nx + ca.hz * nz > 0.1;
        const bIn = bw && cb.hx * nx + cb.hz * nz < -0.1;
        const aGo = aIn || (!bIn && aw), bGo = bIn || (!aIn && bw);
        // rule 4: b is the later of the two
        if (aGo && bGo) go(b, nx, nz, over) || go(a, -nx, -nz, over);
        else if (aGo) go(a, -nx, -nz, over);
        else if (bGo) go(b, nx, nz, over);
      }
    }
  }

  for (const b of live) {
    const c = b.crowd;
    if (c.ghost > 0) c.ghost = Math.max(0, c.ghost - dt);
    const head = b.walking && b.route ? b.route.head() : null;
    if (!head) { c.t = 0; c.shoved = false; continue; }
    // rule 7, over a window: where it was STALL_T ago against where it is
    if (c.t <= 0) { c.t = STALL_T; c.x = b.pos.x; c.z = b.pos.z; c.shoved = false; }
    c.shoved = c.shoved || c.pushed;
    c.t -= dt;
    if (c.t <= 0) {
      const went = Math.hypot(b.pos.x - c.x, b.pos.z - c.z);
      if (c.shoved && went < STALL_PROGRESS * (b.speed || 1) * STALL_T) c.ghost = GHOST_T;
    }
  }
  return touching;
}
