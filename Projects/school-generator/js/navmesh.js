// navmesh.js — the walkable surface, cut into convex tiles.
//
// Phase 6 wrote a portal graph and put one hub in the middle of every room.
// That is honest about topology and a liar about distance: two classrooms
// forty feet apart on the same corridor route through the corridor's
// *midpoint*, so a generated three-storey school reported travel distances
// ten to twenty feet worse than anybody actually walks. Four findings in the
// wishlist, and one cause.
//
// This is the cause removed. A room is no longer a point — it is a set of
// **axis-aligned rectangles that between them cover its floor**, and inside a
// rectangle the walk between any two points is the straight line between
// them, because a rectangle is convex and has nothing in it. That is the
// whole trick. The graph that comes out has real distances in it and no
// solver anywhere: navgraph.js connects everything standing on one tile to
// everything else standing on it, at the distance a tape measure would give.
//
// **One raster, one algorithm.** A room is sampled onto a 2ft lattice inside
// its own bounding box and meshed, which makes the tiles an *inscribed*
// approximation: a diagonal wall keeps its stair-step, and the walk along it
// comes out a foot or so long. That is the right way round for a tool whose
// whole job here is to stop flattering itself. (Until Phase 12 there were two
// rasters through here, because there were two kinds of room. There is one
// kind of room now, and the lattice half of this file went with it.)
//
// **What a tile may not span.** Two samples of one room can sit either side of
// a wall — a C-shaped corridor wraps around one — so growing a rectangle
// checks the ring segments between every pair of samples it swallows. A tile
// that spanned a wall would be a hole punched through the building.
//
// **Gates.** Where two tiles of one room meet along an open span, a gate node
// sits at the middle of it. Tile-to-tile is therefore tile → gate → tile, and
// an L-shaped corridor gets the corner it actually has to walk round. Gates
// are the one thing here that becomes a graph node; tiles themselves are
// somewhere to *stand*, which navgraph.js and — since Phase 11 — hunt.js both
// want and neither wants as a node.
//
// Pure module: no three.js, no DOM. Exercised by test/navmesh.test.mjs.

import { CELL } from './grid.js';
import { shapesOf, shapeBBox, segEnds, pointInShape } from './shapes.js';

// How finely a polygon room is sampled. Half a lattice cell: fine enough that
// a 3ft door reveal and a 4ft jog in a wall both survive, coarse enough that
// the biggest room in a school is a few hundred samples.
export const MESH_STEP = CELL / 2;   // ft
// A tile thinner than this is a sliver off a diagonal wall — somewhere you
// could stand, not somewhere worth routing through.
export const MIN_TILE = 0.5;         // ft

// ---------- greedy meshing ----------

// The one algorithm both rasters use: sweep in reading order, and from every
// cell not yet spoken for grow a rectangle as far right as it will go and then
// as far down as it will go. Bigger-first would give fewer tiles; this gives
// *long* ones along the sweep, which is exactly the shape a corridor is.
//
// `open.right(x, y)` is "you can walk from (x, y) to (x + 1, y)", and
// `open.down(x, y)` the same downward — the two questions that keep a tile
// from spanning a wall.
export function greedyRects(w, h, walkable, open) {
  const used = new Uint8Array(w * h);
  const out = [];
  const free = (x, y) => !used[y * w + x] && walkable(x, y);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!free(x, y)) continue;
      let x1 = x;
      while (x1 + 1 < w && free(x1 + 1, y) && open.right(x1, y)) x1++;
      let y1 = y;
      for (;;) {
        const ny = y1 + 1;
        if (ny >= h) break;
        let ok = true;
        for (let cx = x; cx <= x1 && ok; cx++) {
          if (!free(cx, ny) || !open.down(cx, y1)) ok = false;
        }
        for (let cx = x; cx < x1 && ok; cx++) {
          if (!open.right(cx, ny)) ok = false;
        }
        if (!ok) break;
        y1 = ny;
      }
      for (let cy = y; cy <= y1; cy++) {
        for (let cx = x; cx <= x1; cx++) used[cy * w + cx] = 1;
      }
      out.push({ x0: x, y0: y, x1, y1 });
    }
  }
  return out;
}

// Where two rectangles of one raster meet, and how much of that meeting is
// open. Returns the shared span in cells and the middle of it, or null when
// they only touch at a corner or are walled off from each other along all of
// it. Gates are cut from the *open* part of the span rather than from its
// middle, so a corridor joined to a room through one cell of a long shared
// edge gets its gate at that cell.
export function tileGate(a, b, open) {
  let axis = null;
  if (a.x1 + 1 === b.x0) axis = 'x';
  else if (b.x1 + 1 === a.x0) { axis = 'x'; [a, b] = [b, a]; }
  else if (a.y1 + 1 === b.y0) axis = 'y';
  else if (b.y1 + 1 === a.y0) { axis = 'y'; [a, b] = [b, a]; }
  if (!axis) return null;

  const lo = axis === 'x' ? Math.max(a.y0, b.y0) : Math.max(a.x0, b.x0);
  const hi = axis === 'x' ? Math.min(a.y1, b.y1) : Math.min(a.x1, b.x1);
  if (hi < lo) return null;
  // The longest unbroken run of open cells along the shared edge — a shared
  // edge with a door-width hole in the middle of it is one gate, not a gate
  // per cell.
  let best = null, run = null;
  for (let i = lo; i <= hi; i++) {
    const passable = axis === 'x' ? open.right(a.x1, i) : open.down(i, a.y1);
    if (passable) run = run ? { lo: run.lo, hi: i } : { lo: i, hi: i };
    else run = null;
    if (run && (!best || run.hi - run.lo > best.hi - best.lo)) best = { ...run };
  }
  if (!best) return null;
  return {
    axis,
    // In raster coordinates: the cell edge crossed, and the middle of the run.
    at: axis === 'x' ? a.x1 + 1 : a.y1 + 1,
    mid: (best.lo + best.hi + 1) / 2,
    span: best.hi - best.lo + 1,
  };
}

// ---------- the two rasters ----------

// A raster is a window onto one room: where its origin is in world feet, how
// big a cell is, and the two questions greedy meshing asks.
const rasterOf = (ox, oz, step, w, h, walkable, open) => ({
  ox, oz, step, w, h, walkable, open,
});

// Does the walk between two sample points leave the polygon? Any ring segment
// crossed says yes — a wall, a glazed side and an open side alike, because
// all three are the room's boundary and what is on the far side of them is a
// different room.
function crossesRing(shape, ax, az, bx, bz) {
  const side = (px, pz, qx, qz, rx, rz) =>
    Math.sign((qx - px) * (rz - pz) - (qz - pz) * (rx - px));
  for (const ring of shape.rings) {
    for (let i = 0; i < ring.pts.length; i++) {
      const [p, q] = segEnds(ring, i);
      const d1 = side(ax, az, bx, bz, p.x, p.z);
      const d2 = side(ax, az, bx, bz, q.x, q.z);
      const d3 = side(p.x, p.z, q.x, q.z, ax, az);
      const d4 = side(p.x, p.z, q.x, q.z, bx, bz);
      if (d1 !== d2 && d3 !== d4) return true;
    }
  }
  return false;
}

// Every room on one storey, as a raster each.
//
// The overlap rule is `shapeAt`'s — a room drawn on top of another claims the
// shared ground, because that is what `roomIdAt` will say about a point
// standing there. Asking `shapeAt` per sample would be quadratic in rooms and
// a storey now holds every one of them, so the rooms that could possibly
// overlap this one are found once from their bounding boxes and only those are
// re-tested.
function shapeRasters(floor, fr, floorIndex) {
  const out = [];
  const list = shapesOf(floor);
  list.forEach((shape, si) => {
    const room = fr.rooms.find((r) => r.id === `r${floorIndex}:s${shape.id}`);
    if (!room) return;
    const bb = shapeBBox(shape);
    // Only later rooms can take ground off this one, and only those whose
    // bounding box actually reaches it.
    const over = [];
    for (let j = si + 1; j < list.length; j++) {
      const ob = shapeBBox(list[j]);
      if (ob.x1 < bb.x0 || ob.x0 > bb.x1 || ob.z1 < bb.z0 || ob.z0 > bb.z1) continue;
      over.push(list[j]);
    }
    const w = Math.max(1, Math.ceil((bb.x1 - bb.x0) / MESH_STEP));
    const h = Math.max(1, Math.ceil((bb.z1 - bb.z0) / MESH_STEP));
    const cx = (x) => bb.x0 + (x + 0.5) * MESH_STEP;
    const cz = (y) => bb.z0 + (y + 0.5) * MESH_STEP;
    const walkable = (x, y) => {
      const px = cx(x), pz = cz(y);
      if (!pointInShape(shape, px, pz)) return false;
      for (const other of over) if (pointInShape(other, px, pz)) return false;
      return true;
    };
    out.push({
      room,
      raster: rasterOf(bb.x0, bb.z0, MESH_STEP, w, h, walkable, {
        right: (x, y) => !crossesRing(shape, cx(x), cz(y), cx(x + 1), cz(y)),
        down: (x, y) => !crossesRing(shape, cx(x), cz(y), cx(x), cz(y + 1)),
      }),
    });
  });
  return out;
}

// ---------- one storey, meshed ----------

// Tiles and gates for a whole floor, keyed by room. `fr` is `floorRooms`'
// answer for the same storey — this reads it rather than re-deriving it,
// because the room ids have to be the same ids.
export function meshFloor(state, floorIndex, fr) {
  const floor = fr && fr.floor;
  const tiles = [];
  const gates = [];
  const byRoom = new Map();
  if (!floor) return { tiles, gates, byRoom, floor: null };

  const rasters = shapeRasters(floor, fr, floorIndex);
  for (const { room, raster } of rasters) {
    const rects = greedyRects(raster.w, raster.h, raster.walkable, raster.open);
    const mine = [];
    for (const r of rects) {
      const x0 = raster.ox + r.x0 * raster.step;
      const z0 = raster.oz + r.y0 * raster.step;
      const x1 = raster.ox + (r.x1 + 1) * raster.step;
      const z1 = raster.oz + (r.y1 + 1) * raster.step;
      if (x1 - x0 < MIN_TILE || z1 - z0 < MIN_TILE) continue;
      const tile = {
        id: `t${floorIndex}:${tiles.length}`,
        room: room.id,
        floor: floorIndex,
        x0, z0, x1, z1,
        cx: (x0 + x1) / 2,
        cz: (z0 + z1) / 2,
        area: (x1 - x0) * (z1 - z0),
        rect: r,
        anchors: [],
      };
      tiles.push(tile);
      mine.push(tile);
    }
    // A room too small or too thin to hold a single sample still has to be
    // somewhere: it gets one tile the size of its own bounding box, which is
    // the answer the hub-and-portal graph gave for every room.
    if (!mine.length) {
      const tile = {
        id: `t${floorIndex}:${tiles.length}`,
        room: room.id, floor: floorIndex,
        x0: raster.ox, z0: raster.oz,
        x1: raster.ox + raster.w * raster.step,
        z1: raster.oz + raster.h * raster.step,
        cx: room.x, cz: room.z,
        area: 0, rect: null, anchors: [],
      };
      tiles.push(tile);
      mine.push(tile);
    }
    byRoom.set(room.id, mine);

    // Gates, pair by pair. A room is a handful of tiles, so the quadratic is
    // over five things and not worth an index.
    for (let i = 0; i < mine.length; i++) {
      for (let j = i + 1; j < mine.length; j++) {
        if (!mine[i].rect || !mine[j].rect) continue;
        const g = tileGate(mine[i].rect, mine[j].rect, raster.open);
        if (!g) continue;
        gates.push({
          id: `m${gates.length}`,
          kind: 'gate',
          floor: floorIndex,
          room: room.id,
          a: mine[i].id, b: mine[j].id,
          x: g.axis === 'x' ? raster.ox + g.at * raster.step : raster.ox + g.mid * raster.step,
          z: g.axis === 'x' ? raster.oz + g.mid * raster.step : raster.oz + g.at * raster.step,
          w: g.span * raster.step,
        });
      }
    }
  }
  // Gate ids have to be unique across the building, not across one storey.
  for (let i = 0; i < gates.length; i++) gates[i].id = `m${floorIndex}:${i}`;

  return { tiles, gates, byRoom, floor };
}

// ---------- looking a point up ----------

// Which tile of a known room a point is standing on, or the nearest one to it
// when the point is off the mesh — three feet outside a doorway lands in the
// wall reveal often enough that "nearest" is the useful answer rather than
// "none". Callers that need to know the difference read `.inside`.
export function tileFor(mesh, roomId, x, z) {
  const list = (mesh && mesh.byRoom.get(roomId)) || [];
  let best = null, bestD = Infinity;
  for (const t of list) {
    if (x >= t.x0 && x <= t.x1 && z >= t.z0 && z <= t.z1) return { tile: t, inside: true };
    const dx = Math.max(t.x0 - x, 0, x - t.x1);
    const dz = Math.max(t.z0 - z, 0, z - t.z1);
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = t; }
  }
  return best ? { tile: best, inside: false } : null;
}

// Every tile on a storey, as somewhere a thing could stand — the walkable
// surface Phase 11 asked for, handed over as rectangles rather than as a
// graph.
export function walkableArea(mesh) {
  let a = 0;
  for (const t of (mesh ? mesh.tiles : [])) a += t.area;
  return a;
}
