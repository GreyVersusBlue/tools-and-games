// Rift Wall's gameplay wall: each stone slab blocks the nav grid from the tick it breaks ground until the tick it
// starts to crumble, so the collision stands exactly as long as the picture does. The effect (vfx/effects/ondur_liora.js)
// is handed these same timings by the ability, so there is one set of numbers.
//
// The rules, all of them the ones the map's other obstacles already follow:
// - It blocks walking for every unit, the caster and his allies included ("nothing can walk through the wall").
// - Projectiles, vision, blinks and forced moves cross it, as they cross trees and buildings; a blink or a knockback
//   that would end inside it ends beside it (util.js safePoint), and one that was already in the air lands beside it.
// - A unit standing where a slab rises is put down beside the wall, on the side of the centre line it was already on
//   (dead on the line: the +n side), the other side if that spot is a cliff or a tree, else the nearest walkable spot.
// - Units whose planned path crosses the wall re-plan once when the whole wall is up (they route round its ends) and
//   once when the last slab has crumbled (they go straight again). Two re-plans a unit a wall, never one a slab.
// No Math.random and no wall clock in here: seeded headless matches stay reproducible.

export const RIFT_WALL = {
  per: 2.2, // slab spacing along the line (world units)
  rise: 0.28, // seconds a slab takes to climb
  hold: 2.6, // seconds it stands after that
  stagger: 0.025, // extra seconds each later slab stands before crumbling
  sink: 0.6, // seconds the crumble takes (picture only: a crumbling slab no longer blocks)
  halfWidth: 1.0, // radius of the blocked circles
  step: 0.55, // spacing of the blocked circles along a slab
  lead: 0.5, // no circle closer than this to the line's start, which is 1 unit ahead of the caster
  clear: 0.4, // how far past the blocked band a pushed unit is put down (a fine nav cell's half diagonal is 0.354)
};

// The slabs of a wall from `from` along the unit vector `dir`: where each one is, which circles it blocks, and the game
// times (relative to the cast) between which it blocks. Pure, so the picture and the collision can be checked apart.
export function riftWallSlabs(from, dir, length, delayPerUnit = 1 / 60, T = RIFT_WALL) {
  const n = Math.floor(length / T.per) + 1;
  const slabs = [];
  for (let i = 0; i < n; i++) {
    const d = i * T.per;
    const circles = [];
    for (let k = -2; k <= 2; k++) {
      const a = d + k * T.step;
      if (a < T.lead) continue;
      circles.push({ x: from.x + dir.x * a, z: from.z + dir.z * a });
    }
    const t0 = d * delayPerUnit;
    slabs.push({ i, d, x: from.x + dir.x * d, z: from.z + dir.z * d, circles, t0, t1: t0 + T.rise + T.hold + i * T.stagger, up: false });
  }
  return slabs;
}

// Where a unit at (x, z) is put down beside the wall. isWalkable(x, z) and nearestWalkable(x, z) are the world's.
export function riftWallExit(wall, x, z, isWalkable, nearestWalkable, T = RIFT_WALL) {
  const { from, dir } = wall;
  const rx = x - from.x, rz = z - from.z;
  const along = rx * dir.x + rz * dir.z;
  const nx = dir.z, nz = -dir.x;
  const side = rx * nx + rz * nz >= 0 ? 1 : -1;
  const off = T.halfWidth + T.clear;
  const fx = from.x + dir.x * along, fz = from.z + dir.z * along;
  for (const s of [side, -side]) {
    const px = fx + nx * off * s, pz = fz + nz * off * s;
    if (isWalkable(px, pz)) return { x: px, z: pz };
  }
  const nw = nearestWalkable?.(x, z);
  return nw ? { x: nw.x, z: nw.z } : null;
}

// Shortest distance between segments p1-p2 and p3-p4 on the ground plane.
function segDist(p1, p2, p3, p4) {
  const ptSeg = (p, a, b) => {
    const vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / l2)) : 0;
    return Math.hypot(p.x - a.x - vx * t, p.z - a.z - vz * t);
  };
  const cross = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2), d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(ptSeg(p1, p3, p4), ptSeg(p2, p3, p4), ptSeg(p3, p1, p2), ptSeg(p4, p1, p2));
}

// True when the path a unit is walking (its position, then its waypoints) passes through the wall.
export function pathCrossesRiftWall(wall, unit, T = RIFT_WALL) {
  const reach = T.halfWidth + 0.75; // a coarse nav cell (1 unit) is blocked when any fine cell in it is
  let a = unit.position;
  for (const b of unit.path ?? []) {
    if (segDist(a, b, wall.a, wall.b) <= reach) return true;
    a = b;
  }
  return false;
}

const mobile = (u) => u.alive && !u.immobile && u.kind !== 'ward';
const replan = (u) => { u.path = []; u.repathTimer = 0; };

// Raise the wall in `game`. Returns the wall, or null when the world has no nav grid to block (a stubbed world).
export function raiseRiftWall(game, { from, dir, length, delayPerUnit = 1 / 60 }, T = RIFT_WALL) {
  const w = game.world;
  if (!w?.blockCircle || !w?.unblockCircle || !w?.isWalkable) return null;
  const f = { x: from.x, z: from.z }, d = { x: dir.x, z: dir.z };
  const slabs = riftWallSlabs(f, d, length, delayPerUnit, T);
  const end = (slabs.length - 1) * T.per + 2 * T.step;
  const wall = {
    from: f, dir: d, length, slabs, standing: 0, done: false, rerouted: new Set(),
    a: { x: f.x + d.x * T.lead, z: f.z + d.z * T.lead }, b: { x: f.x + d.x * end, z: f.z + d.z * end },
    mid: { x: f.x + d.x * end * 0.5, z: f.z + d.z * end * 0.5 },
  };
  const near = () => game.unitsInRadius(wall.mid, end * 0.5 + T.halfWidth + 2, mobile);
  const inside = (u, slab) => slab.circles.some((c) => Math.hypot(u.position.x - c.x, u.position.z - c.z) <= T.halfWidth + T.clear);
  const pushOut = (u) => {
    const p = riftWallExit(wall, u.position.x, u.position.z, (x, z) => w.isWalkable(x, z), (x, z) => w.nearestWalkable?.(x, z), T);
    if (!p) return;
    u.position.x = p.x; u.position.z = p.z;
    replan(u);
  };
  // The moment the first slab rises and every tick after while one stands, after that tick's slabs have risen (this
  // timer is re-queued behind them): nobody is left inside one. It is the only push-out, so it also catches a knockback
  // that was in the air when the wall rose.
  const sweep = () => {
    if (!wall.standing) return;
    for (const u of near()) {
      if (w.isWalkable(u.position.x, u.position.z)) continue;
      if (slabs.some((s) => s.up && inside(u, s))) pushOut(u);
    }
    game.delay(0, sweep);
  };
  const rise = (slab) => {
    for (const c of slab.circles) w.blockCircle(c.x, c.z, T.halfWidth);
    slab.up = true;
    if (wall.standing++ === 0) sweep();
    if (slab.i === slabs.length - 1) {
      for (const u of game.units) if (mobile(u) && pathCrossesRiftWall(wall, u, T)) { replan(u); wall.rerouted.add(u); }
    }
  };
  const fall = (slab) => {
    for (const c of slab.circles) w.unblockCircle(c.x, c.z, T.halfWidth);
    slab.up = false;
    if (--wall.standing > 0 || slab.i !== slabs.length - 1) return;
    wall.done = true;
    // Units that planned a way round while it stood (their own half-second re-plan) are near it too: all go straight again.
    for (const u of game.unitsInRadius(wall.mid, end * 0.5 + 15, mobile)) wall.rerouted.add(u);
    for (const u of wall.rerouted) if (u.alive) replan(u);
    wall.rerouted.clear();
  };
  for (const slab of slabs) {
    if (slab.t0 <= 0) rise(slab); else game.delay(slab.t0, () => rise(slab));
    game.delay(slab.t1, () => fall(slab));
  }
  return wall;
}
