// world.js — the grid: what a square is, what you can see, how you get there.
//
// Pure. Takes a parsed area from content.js and answers questions about it.
// No DOM, no rendering, no game state beyond what is handed in.

import { feetBetween } from "./rules.js";

export const TILE = { FLOOR: 0, WALL: 1, GATE: 2, PILLAR: 3, TREASURE: 4, STAIRS: 5 };

/**
 * A World wraps one area's tile grid.
 *
 * `occupied(x, y)` is injected rather than baked in, because "is a creature
 * standing there" is the game's business and the grid's only job is terrain.
 * Pathfinding for a mover passes an `ignore` so a creature is never blocked by
 * the square it is already standing on.
 */
export function makeWorld(area) {
  const { width: W, height: H, tiles } = area;

  const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const tileAt = (x, y) => (inBounds(x, y) ? tiles[y][x] : TILE.WALL);

  /** Terrain that stops a body. A gate stops one until it is open. */
  function blocksMove(x, y, gateOpen) {
    if (!inBounds(x, y)) return true;
    const t = tiles[y][x];
    if (t === TILE.WALL || t === TILE.PILLAR) return true;
    if (t === TILE.GATE && !gateOpen) return true;
    return false;
  }

  /** Terrain that stops a line of sight. Creatures do not block sight. */
  function blocksSight(x, y, gateOpen) {
    if (!inBounds(x, y)) return true;
    const t = tiles[y][x];
    return t === TILE.WALL || t === TILE.PILLAR || (t === TILE.GATE && !gateOpen);
  }

  /**
   * Bresenham between square centres. The two endpoints are exempt: you can
   * always see the pillar you are standing next to, and a creature standing in
   * a doorway can still be shot at.
   */
  function hasLoS(ax, ay, bx, by, gateOpen) {
    let x0 = ax, y0 = ay;
    const dx = Math.abs(bx - ax), dy = -Math.abs(by - ay);
    const sx = ax < bx ? 1 : -1, sy = ay < by ? 1 : -1;
    let err = dx + dy;
    // The grid is finite and every step moves at least one axis toward the
    // target, so this terminates; the guard is against a future caller passing
    // something off-grid.
    for (let steps = 0; steps <= W * H; steps++) {
      const atStart = x0 === ax && y0 === ay;
      const atEnd = x0 === bx && y0 === by;
      if (!atStart && !atEnd && blocksSight(x0, y0, gateOpen)) return false;
      if (atEnd) return true;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return false;
  }

  /** Every square within `radiusFeet` of (ox, oy) that the eye can reach. */
  function fieldOfView(ox, oy, radiusFeet, gateOpen) {
    const seen = new Set();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (feetBetween(ox, oy, x, y) > radiusFeet) continue;
        if (!hasLoS(ox, oy, x, y, gateOpen)) continue;
        seen.add(x + "," + y);
      }
    }
    return seen;
  }

  /**
   * A*, eight-directional, with rules-legal diagonal costs.
   *
   * The node key carries a diagonal parity bit alongside x and y: parity 0 means
   * the next diagonal costs 5 ft, parity 1 means it costs 10 ft. Without that
   * bit in the key, A* would happily reuse a cheaper-looking node reached on the
   * wrong parity and report a path length the rules disagree with.
   *
   * `path[i].g` is cumulative feet, which is what the caller charges Strides
   * against.
   */
  function findPath(sx, sy, tx, ty, { gateOpen, occupied }) {
    if (blocksMove(tx, ty, gateOpen) || occupied(tx, ty)) return null;
    const blocked = (x, y) => blocksMove(x, y, gateOpen) || occupied(x, y);

    const h = (x, y) => feetBetween(x, y, tx, ty);
    const open = new Map();
    const closed = new Set();
    open.set(sx + "," + sy + ",0", { x: sx, y: sy, p: 0, g: 0, f: h(sx, sy), parent: null });

    const DIRS = [
      [1, 0, false], [-1, 0, false], [0, 1, false], [0, -1, false],
      [1, 1, true], [1, -1, true], [-1, 1, true], [-1, -1, true],
    ];

    while (open.size) {
      let cur = null, curKey = null;
      for (const [k, n] of open) if (!cur || n.f < cur.f) { cur = n; curKey = k; }
      open.delete(curKey);
      closed.add(curKey);

      if (cur.x === tx && cur.y === ty) {
        const path = [];
        for (let n = cur; n; n = n.parent) path.unshift({ x: n.x, y: n.y, g: n.g });
        return path;
      }

      for (const [dx, dy, diag] of DIRS) {
        const nx = cur.x + dx, ny = cur.y + dy;
        if (blocked(nx, ny)) continue;
        // No cutting corners: a diagonal needs both orthogonal squares open.
        if (diag && (blocked(cur.x + dx, cur.y) || blocked(cur.x, cur.y + dy))) continue;
        const step = diag ? (cur.p === 0 ? 5 : 10) : 5;
        const np = diag ? (cur.p ^ 1) : cur.p;
        const key = nx + "," + ny + "," + np;
        if (closed.has(key)) continue;
        const g = cur.g + step;
        const existing = open.get(key);
        if (!existing || g < existing.g) {
          open.set(key, { x: nx, y: ny, p: np, g, f: g + h(nx, ny), parent: cur });
        }
      }
    }
    return null;
  }

  /** Open squares next to (x, y), nearest-first from (fromX, fromY). */
  function adjacentOpen(x, y, { gateOpen, occupied }) {
    const out = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const ax = x + dx, ay = y + dy;
        if (blocksMove(ax, ay, gateOpen) || occupied(ax, ay)) continue;
        out.push({ x: ax, y: ay });
      }
    }
    return out;
  }

  /**
   * The leg a creature Strides toward `to`: the cheapest path to any open
   * square beside it, cut to what `speed` feet will buy.
   *
   * This lives here rather than inside game.js's creature turn because the
   * suite needs the *same* planner the engine walks, not a second copy of it.
   * The reaction bus leans on a property of this function — a path to the
   * cheapest square beside the target cannot cross a square beside the target
   * on the way, because that crossing would have been cheaper — and a suite
   * that re-implemented the planner to check that property would have gone on
   * passing after the real one changed. Two versions of the line-of-sight
   * check once did exactly that (locked #34).
   *
   * Returns the squares to walk, starting with the one the mover is standing
   * on, or null if there is nowhere to go.
   */
  function planApproach(from, to, speed, opts) {
    let best = null;
    for (const sq of adjacentOpen(to.x, to.y, opts)) {
      const p = findPath(from.x, from.y, sq.x, sq.y, opts);
      if (p && (!best || p[p.length - 1].g < best[best.length - 1].g)) best = p;
    }
    if (!best || best.length < 2) return null;
    let cut = best.length - 1;
    while (cut > 0 && best[cut].g > speed) cut--;
    if (cut === 0) return null;
    return best.slice(0, cut + 1);
  }

  return {
    width: W, height: H,
    inBounds, tileAt, blocksMove, blocksSight, hasLoS, fieldOfView, findPath, adjacentOpen,
    planApproach,
  };
}

/* ---------------------------------------------------------------------------
   Explored-tile bitfield

   The save carries fog-of-war memory. A Set of "x,y" strings serialises to
   roughly 3 KB of JSON for a 22×22 room; a run of "0"/"1" is 484 bytes, is
   readable in a hand-inspected save, and does not grow a key per square.
--------------------------------------------------------------------------- */

export function packExplored(set, width, height) {
  let out = "";
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) out += set.has(x + "," + y) ? "1" : "0";
  }
  return out;
}

export function unpackExplored(bits, width, height) {
  const set = new Set();
  if (typeof bits !== "string") return set;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (bits[y * width + x] === "1") set.add(x + "," + y);
    }
  }
  return set;
}
