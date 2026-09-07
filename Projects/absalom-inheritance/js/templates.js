// templates.js — the three area shapes, as grid squares.
//
// Pure. Squares in, squares out. No world, no content, no game state, no RNG,
// and no terrain: a template is a shape, and what a wall does to it belongs to
// world.js. Nothing in here knows a pillar exists.
//
// This file exists because the shape was written twice. game.js resolved a
// cone as "within coneFeet and within ±45° of the clicked bearing" and
// render.js previewed one from its own inline copy of the same trigonometry
// with the range hardcoded to `feet > 15`. Preview and resolution agreed only
// because Breathe Fire happens to be a 15-foot cone; the first 30-foot cone
// anyone wrote would have painted one shape and burned another, with nothing
// erroring.
//
// Areas are Player Core p.387.

import { feetBetween } from "./rules.js";

/**
 * The eight directions a template can point, as unit steps. Named so a log
 * line and a test can say "east" rather than "1,0".
 */
export const OCTANTS = Object.freeze([
  { name: "east", dx: 1, dy: 0 },
  { name: "south-east", dx: 1, dy: 1 },
  { name: "south", dx: 0, dy: 1 },
  { name: "south-west", dx: -1, dy: 1 },
  { name: "west", dx: -1, dy: 0 },
  { name: "north-west", dx: -1, dy: -1 },
  { name: "north", dx: 0, dy: -1 },
  { name: "north-east", dx: 1, dy: -1 },
]);

/**
 * tan(67.5°) = 1 + √2. It is the half-width of an octant expressed as a slope,
 * and it is the whole of the snap below: a target whose shallow axis is less
 * than 1/(1+√2) of its long one is inside the orthogonal octant, and anything
 * else is inside the diagonal one. Written as algebra rather than as an atan2
 * because the two copies this file replaces were both atan2, and the second
 * one drifted.
 */
const OCTANT_SLOPE = 1 + Math.SQRT2;

/**
 * Which of the eight directions a click at `target` points from `origin`.
 *
 * Null when the target is the origin square, which is the one click that names
 * no direction at all. A caller that gets null has no cone to draw.
 */
export function octantToward(origin, target) {
  const dx = target.x - origin.x, dy = target.y - origin.y;
  if (!dx && !dy) return null;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  let sx = Math.sign(dx), sy = Math.sign(dy);
  if (ax > OCTANT_SLOPE * ay) sy = 0;
  else if (ay > OCTANT_SLOPE * ax) sx = 0;
  return OCTANTS.find(o => o.dx === sx && o.dy === sy);
}

/** Every square whose Chebyshev offset from the origin could be in range. */
function box(origin, feet) {
  const r = Math.floor(feet / 5);
  const out = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) out.push({ x: origin.x + dx, y: origin.y + dy });
  }
  return out;
}
// feetBetween is at least 5 × max(|dx|, |dy|), so a square outside that box is
// always out of range and the bound loses nothing.

/**
 * A cone: "shoots out from you in a quarter circle on the grid" (p.387).
 *
 * The quarter circle is exactly that — a 90° quarter, snapped to one of the
 * eight grid directions, cut to `feet` by the same alternating-diagonal
 * measurement every other distance in this game uses (`feetBetween`). Two
 * consequences worth saying out loud, because both are visible on the board:
 *
 *   - The caster's own square is never in her own cone.
 *   - An orthogonal cone and a diagonal one are not the same size. At 15 feet
 *     they are 11 squares and 12. That is the diagonal rule showing through,
 *     not an error: 5/10/5 makes the grid measurably anisotropic, and a shape
 *     that came out identical in both would be one that had stopped using the
 *     game's own distances.
 *
 * The engine measures square centres and the book measures from a corner or an
 * edge of your space. That is a knowing departure, flagged here and in the
 * README: this grid has no corners anywhere — targeting, line of sight and the
 * A* all address squares — and giving templates their own coordinate system
 * would be a second geometry to keep in step with the first.
 */
export function coneSquares(origin, target, feet) {
  const dir = octantToward(origin, target);
  if (!dir) return [];
  const diagonal = dir.dx !== 0 && dir.dy !== 0;
  return box(origin, feet).filter(s => {
    const dx = s.x - origin.x, dy = s.y - origin.y;
    if (!dx && !dy) return false;
    if (feetBetween(origin.x, origin.y, s.x, s.y) > feet) return false;
    if (diagonal) return dx * dir.dx >= 0 && dy * dir.dy >= 0;
    // Orthogonal: `along` is the distance in the direction pointed, `across`
    // is the sideways drift. The quarter circle is everything whose drift does
    // not out-run its reach.
    const along = dx * dir.dx + dy * dir.dy;
    const across = Math.abs(dir.dx ? dy : dx);
    return along >= 1 && along >= across;
  });
}

/**
 * A burst: it "spreads in all directions to a specified radius" from a chosen
 * point (p.387). The chosen point is a square here rather than a corner, for
 * the reason `coneSquares` gives, and the centre square is inside its own
 * burst.
 */
export function burstSquares(centre, feet) {
  return box(centre, feet)
    .filter(s => feetBetween(centre.x, centre.y, s.x, s.y) <= feet);
}

/**
 * An emanation: it "issues forth from each side of your space" (p.387).
 *
 * At the one creature size this engine has — every actor in it stands in a
 * single square — an emanation of R feet and a burst of R feet centred on the
 * same square are the same set of squares, and pretending otherwise would be
 * two names for one shape with a bug waiting in whichever one gets read less.
 * The two are not the same *effect*: a burst's centre is chosen anywhere the
 * caster has range and line of effect to, and an emanation's is always the
 * caster. That difference lives in game.js, where the targeting does.
 *
 * A pack that grows a Large creature is what makes these two functions
 * diverge, and the suite asserts the equality so that day is a failing test
 * rather than a silently wrong shape.
 */
export function emanationSquares(origin, feet) {
  return burstSquares(origin, feet);
}
