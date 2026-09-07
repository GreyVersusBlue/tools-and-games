// world.js — the grid: what a square is, what you can see, how you get there.
//
// Pure. Takes a parsed area from content.js and answers questions about it.
// No DOM, no rendering, no game state beyond what is handed in.

import { feetBetween } from "./rules.js";

/**
 * Every kind of square this engine knows, in one table.
 *
 * `TILE` was a bare enum here and `content.js` kept a second list mapping the
 * legend's names onto it, and `save.js` a third copy of "wall or pillar, and
 * the gate until it is open" written out longhand. Three lists, one fact: a
 * kind added to one and missed in another is a pack that either refuses to
 * load or loads with a hole in a wall. All three read this now.
 *
 * The three answers default to `true`: a kind that declares nothing is solid.
 * That direction is deliberate. A new kind whose author forgot to say what it
 * blocks becomes a square nobody can walk into, which is visible in the first
 * ten seconds of play. The other default is a wall you walk through and see
 * through, which reads as a rendering bug and gets found much later. Opt out
 * of solidity, never into it.
 *
 * `"unless-open"` is the one conditional answer, and it is the gate: solid
 * until the run's gate is open. There is exactly one thing in this engine that
 * opens, and a registry inventing a general mechanism for a second would be
 * offering content authors something no pack can reach.
 *
 * Order is the tile id. It is not written into any save — a save carries
 * coordinates and a fog bitfield, never a tile — but `render.js` and `ui.js`
 * still switch on `TILE.WALL` and friends, so a kind goes on the end.
 */
const SOLID = Object.freeze({ blocksMove: true, blocksSight: true, blocksEffect: true });
const OPEN = Object.freeze({ blocksMove: false, blocksSight: false, blocksEffect: false });

export const TILE_KINDS = Object.freeze([
  { name: "floor", ...OPEN },
  { name: "wall" },
  // A portcullis: it stops a body and it stops a spell, and it does not stop
  // an eye. The two empty seal-recesses flanking it are meant to be read from
  // the far side.
  { name: "gate", blocksMove: "unless-open", blocksSight: false, blocksEffect: "unless-open" },
  { name: "pillar" },
  { name: "treasure", ...OPEN },
  { name: "stairs", ...OPEN },
].map((kind, id) => Object.freeze({ ...SOLID, ...kind, id })));

/** The enum every module already reads: FLOOR, WALL, GATE, PILLAR, ... */
export const TILE = Object.freeze(Object.fromEntries(TILE_KINDS.map(k => [k.name.toUpperCase(), k.id])));

/** What a pack's legend writes, to what the grid stores. content.js's door. */
export const TILE_ID_BY_NAME = Object.freeze(Object.fromEntries(TILE_KINDS.map(k => [k.name, k.id])));

/** The kind names, in id order, for an error message that says what is legal. */
export const TILE_NAMES = Object.freeze(TILE_KINDS.map(k => k.name));

/** The three questions a square can be asked. */
export const BARRIERS = Object.freeze(["blocksMove", "blocksSight", "blocksEffect"]);

/**
 * Does tile `t` stop `barrier`?
 *
 * An unknown barrier name throws rather than answering. A typo would read
 * `undefined` off the kind, which is falsy, which is "nothing blocks" — the
 * one wrong answer this function must never give quietly. The check is the
 * `undefined` itself rather than a scan of `BARRIERS`: every kind is built
 * from `SOLID`, so it carries exactly the three keys and nothing else, and
 * this runs on every square of every line trace and every path node.
 */
export function tileBlocks(t, barrier, gateOpen = false) {
  const kind = TILE_KINDS[t];
  if (kind === undefined) return true;    // off the table is off the map
  const answer = kind[barrier];
  if (answer === undefined) {
    throw new Error(`tileBlocks: unknown barrier "${barrier}" (want ${BARRIERS.join(", ")})`);
  }
  return answer === "unless-open" ? !gateOpen : answer;
}

/**
 * The eight directions, in a ring, so that "one octant over from this one" is
 * an index step rather than eight cases. Order is clockwise from east; only
 * adjacency in the ring matters, not where it starts.
 */
export const RING = Object.freeze([
  { dx: 1, dy: 0 }, { dx: 1, dy: 1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 1 },
  { dx: -1, dy: 0 }, { dx: -1, dy: -1 }, { dx: 0, dy: -1 }, { dx: 1, dy: -1 },
]);

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

  /**
   * The three barriers, each read off the tile-kind registry above rather than
   * spelled out here. What a kind stops is a property of the kind; these three
   * only add "off the grid is solid", which is a property of the edge.
   *
   * Sight takes no `gateOpen` argument at all, which is the point — the whole
   * distinction between these questions is that two of them read the gate and
   * the third cannot. Line of *effect* is Player Core p.457: a solid barrier
   * with no gap stops a spell even where it does not stop an eye, which is a
   * closed gate exactly. You can see the Vault Keeper's chamber through the
   * bars and you cannot put a Force Fang through them.
   */
  function blocksMove(x, y, gateOpen) {
    return !inBounds(x, y) || tileBlocks(tiles[y][x], "blocksMove", gateOpen);
  }

  function blocksSight(x, y) {
    return !inBounds(x, y) || tileBlocks(tiles[y][x], "blocksSight");
  }

  function blocksEffect(x, y, gateOpen) {
    return !inBounds(x, y) || tileBlocks(tiles[y][x], "blocksEffect", gateOpen);
  }

  /**
   * Bresenham between square centres, against whichever of the two barriers
   * the caller asked about. The two endpoints are exempt: you can always see
   * the pillar you are standing next to, and a creature standing in an open
   * doorway can still be shot at.
   *
   * One walk, two predicates. The alternative — a second copy of the line for
   * effect — is the shape that put two versions of this very check in the repo
   * once before, both passing the suite while one of them did nothing (locked
   * decision #34).
   */
  function traceLine(ax, ay, bx, by, blocked) {
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
      if (!atStart && !atEnd && blocked(x0, y0)) return false;
      if (atEnd) return true;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return false;
  }

  /** Can the eye get there? Takes no gate argument, on purpose. */
  const hasLoS = (ax, ay, bx, by) => traceLine(ax, ay, bx, by, blocksSight);

  /** Can the spell get there? This is the one that reads the gate. */
  const hasLoE = (ax, ay, bx, by, gateOpen) =>
    traceLine(ax, ay, bx, by, (x, y) => blocksEffect(x, y, gateOpen));

  /** Every square within `radiusFeet` of (ox, oy) that the eye can reach. */
  function fieldOfView(ox, oy, radiusFeet) {
    const seen = new Set();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (feetBetween(ox, oy, x, y) > radiusFeet) continue;
        if (!hasLoS(ox, oy, x, y)) continue;
        seen.add(x + "," + y);
      }
    }
    return seen;
  }

  /**
   * Cut a template's squares down to the ones the effect actually reaches:
   * on the grid, not inside a solid, and with line of effect from the origin.
   *
   * This is the only place a shape meets terrain. templates.js does not know a
   * pillar exists and does not need to; the four wall blocks flanking the
   * pillars now throw a shadow across a cone the same way they already broke a
   * sentinel's line of sight.
   */
  function reachableFrom(ox, oy, squares, gateOpen) {
    return squares.filter(s =>
      inBounds(s.x, s.y) &&
      !blocksEffect(s.x, s.y, gateOpen) &&
      hasLoE(ox, oy, s.x, s.y, gateOpen));
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

  /**
   * The leg a creature Strides *away* from `foe`: straight back if the room
   * allows it, one octant either side if the wall does not.
   *
   * The destination has to end up more than `awayFeet` from the foe, which is
   * the foe's own reach — a retreat that stays inside it has bought nothing and
   * spent an action doing it. Longest first, so a Speed 20 construct backs off
   * twenty feet rather than five and calls it a day.
   *
   * It lives here beside planApproach for the reason planApproach lives here:
   * the suite has to walk the same planner the engine does. A second copy in a
   * test is a test of the copy.
   */
  function planRetreat(from, foe, speed, awayFeet, opts) {
    const dx = Math.sign(from.x - foe.x), dy = Math.sign(from.y - foe.y);
    if (!dx && !dy) return null;              // standing on it: nowhere is "away"
    const i = RING.findIndex(d => d.dx === dx && d.dy === dy);
    const dirs = [RING[i], RING[(i + 1) % 8], RING[(i + 7) % 8]];
    for (let steps = Math.floor(speed / 5); steps >= 1; steps--) {
      for (const d of dirs) {
        const tx = from.x + d.dx * steps, ty = from.y + d.dy * steps;
        if (blocksMove(tx, ty, opts.gateOpen) || opts.occupied(tx, ty)) continue;
        if (feetBetween(tx, ty, foe.x, foe.y) <= awayFeet) continue;
        const p = findPath(from.x, from.y, tx, ty, opts);
        // The path is what costs feet, not the straight line: a diagonal leg
        // is 5/10/5 and a detour around a pillar is longer still.
        if (p && p.length > 1 && p[p.length - 1].g <= speed) return p;
      }
    }
    return null;
  }

  /**
   * One square out of `foe`'s reach, or null. A Step in PF2e is five feet that
   * triggers nothing, which is the whole reason a creature would take one
   * instead of the Stride above.
   *
   * Furthest from the foe wins, and the ring order breaks the tie, because a
   * creature that picked differently on two identical boards would take the
   * balance harness's seeds with it.
   */
  function stepAway(from, foe, awayFeet, opts) {
    let best = null, bestFeet = -1;
    for (const d of RING) {
      const tx = from.x + d.dx, ty = from.y + d.dy;
      if (blocksMove(tx, ty, opts.gateOpen) || opts.occupied(tx, ty)) continue;
      const feet = feetBetween(tx, ty, foe.x, foe.y);
      if (feet <= awayFeet || feet <= bestFeet) continue;
      best = { x: tx, y: ty }; bestFeet = feet;
    }
    return best;
  }

  return {
    width: W, height: H,
    inBounds, tileAt, blocksMove, blocksSight, blocksEffect, hasLoS, hasLoE, fieldOfView,
    reachableFrom, findPath, adjacentOpen, planApproach, planRetreat, stepAway,
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
