// sitemesh.js — the outdoors, cut into convex tiles.
//
// Four of this codebase's refusals had one cause: `navgraph.js` flattened the
// whole outdoors into a single node. Exit discharge stopped at the threshold,
// the scavenger hunt could not hide anything on the playing field, every
// layout scheme had to make one connected building, and a covered walk between
// two blocks was a thing the model had no way to measure. The site was open
// ground and Phase 5 gave it a heightfield rather than obstacles, so routing
// across it was a straight line and a graph would only have added nodes with
// nothing to say.
//
// That was true right up until the ground grew things to walk round. It now
// has regions with surfaces on them, a building standing in the middle of it,
// and slopes steep enough to be banks rather than lawns — which is a raster,
// and `navmesh.js` already greedy-meshes a raster into convex tiles. So this
// file is mostly *not* an algorithm: it is the one raster the outdoors makes,
// handed to `greedyRects` and `tileGate`, and the four questions the answer
// has to be able to settle.
//
// **What is walkable out here.** Not the building (a tile that crossed a wall
// would be a hole punched through it). Not a planting bed (`walk: false` on
// the surface row). Not a bank steeper than 25%, which is the slope a graded
// school site puts a retaining wall on rather than a path. Everything else,
// including the lawn, because people cut across lawns.
//
// **Where the property ends.** The mesh is cut to an extent, and the tiles at
// the rim of it are where you leave. Preferring *paved* rim tiles is the one
// judgement in the file: a code means the street or a walk that leads to one,
// and a gap in the hedge at the back of the playing field is not a public way.
// When nothing paved reaches the rim the whole rim counts, and the analysis
// says which rule it used, because a discharge distance measured to a fence is
// worth having and worth labelling.
//
// **The step is 8ft, not 2.** A site is fifty times the area of a storey and
// nothing out here is 3ft wide: the finest thing that has to survive is a walk
// between two buildings, and 8ft is two building cells.
//
// **Derived, never stored.** Same bargain as `navmesh.js` and `terrainField`:
// re-derived after every edit, no `state.yard`, and nothing in the save file.
//
// Pure module: no three.js, no DOM. Exercised by test/sitemesh.test.mjs.

import { CELL } from './grid.js';
import { shapesOf, shapeBBox, segEnds, pointInShape } from './shapes.js';
import { greedyRects, tileGate } from './navmesh.js';
import { regionsOf, regionBBox, pointInRegion, surfaceEntry } from './site.js';
import { terrainField, gradeAt } from './terrain.js';

// How finely the outdoors is sampled. Two building cells: coarse enough that a
// quarter-mile site is a few thousand samples, fine enough that an 8ft covered
// walk between two blocks is a tile rather than a rounding error.
export const YARD_STEP = 8;          // ft
// How far past the building the outdoors reaches when the design has no site
// drawn and no ground graded. Sixty feet is a fire lane and a walk — enough
// for a discharge route to be a measurement rather than a guess, and little
// enough that it is obviously not a property line.
export const YARD_MARGIN = 60;       // ft
// How close to the building you may stand. Half a body plus the wall.
export const FACE_CLEAR = 1.2;       // ft
// Steeper than this is a bank rather than a route: a 4:1 slope is what a
// grading plan puts turf on and what nobody walks up on purpose.
export const WALK_GRADE = 0.25;
// ADA 403.3 — a walking surface steeper than 1:20 is a ramp, and a ramp needs
// handrails, landings and edge protection this tool does not draw.
export const ACCESSIBLE_GRADE = 0.05;
// ADA 405.2 — and steeper than 1:12 is not even a ramp.
export const MAX_RAMP_GRADE = 1 / 12;
// A tile thinner than this is a sliver against the face of the building.
export const MIN_YARD_TILE = 2;      // ft
// How far apart the points on the public way sit. The property line is a
// *line*, and one node in the middle of it would put a door forty feet from
// the street four hundred feet from the street. Forty feet is close enough
// that the error in "which point of the kerb you walk to" is under twenty.
export const WAY_SPACING = 40;       // ft
// ...and a cap, so a mile of frontage is a polyline rather than a crowd.
export const MAX_WAYS = 64;
// A hostile file can ask for a site the size of a county. Past this the step
// doubles until the raster fits, so the answer gets coarser rather than
// enormous.
export const MAX_YARD_CELLS = 40000;

// ---------- the extent ----------

// Where the outdoors is, in world feet. Three answers in priority order,
// because they are three different claims and only one of them is about the
// property:
//
//   the regions somebody drew   — the grounds, stated
//   the ground somebody graded  — an apron, generated with a margin on it
//   the building and a margin   — nothing has been said about the site at all
//
// The drawn site wins where there is one: `terrainFor` lays a heightfield two
// hundred feet past the building whether or not anybody asked for a site that
// big, and taking that as a property line would measure every discharge to a
// boundary nobody drew. The building's own margin is always in the union, so a
// design whose only site region is a doormat still has somewhere to stand.
export function siteExtent(state, opts = {}) {
  const margin = Number.isFinite(opts.margin) ? opts.margin : YARD_MARGIN;
  let b = null;
  const grow = (x0, z0, x1, z1) => {
    if (!b) b = { x0, z0, x1, z1 };
    else {
      b.x0 = Math.min(b.x0, x0); b.z0 = Math.min(b.z0, z0);
      b.x1 = Math.max(b.x1, x1); b.z1 = Math.max(b.z1, z1);
    }
  };
  const built = buildingBounds(state);
  if (built) grow(built.x0 - margin, built.z0 - margin, built.x1 + margin, built.z1 + margin);
  const regions = regionsOf(state);
  for (const region of regions) {
    const r = regionBBox(region);
    grow(r.x0, r.z0, r.x1, r.z1);
  }
  const t = state && state.terrain ? state.terrain : null;
  if (!regions.length && t && t.cols > 1 && t.rows > 1) {
    grow(t.x0, t.z0, t.x0 + (t.cols - 1) * t.step, t.z0 + (t.rows - 1) * t.step);
  }
  if (!b) {
    // Nothing built, nothing drawn, nothing graded: the grid's own footprint
    // with a margin, which is the box the editor is already looking at.
    const w = (state && state.w ? state.w : 0) * CELL;
    const h = (state && state.h ? state.h : 0) * CELL;
    grow(-margin, -margin, w + margin, h + margin);
  }
  return b;
}

// Every storey's shapes, as one box. Every storey rather than the ground floor
// alone: an upper wing that oversails is still building, and standing under it
// is standing under a soffit rather than out on the site.
export function buildingBounds(state) {
  let b = null;
  for (const floor of (state && state.floors) || []) {
    for (const shape of shapesOf(floor)) {
      const s = shapeBBox(shape);
      if (!b) b = { ...s };
      else {
        b.x0 = Math.min(b.x0, s.x0); b.z0 = Math.min(b.z0, s.z0);
        b.x1 = Math.max(b.x1, s.x1); b.z1 = Math.max(b.z1, s.z1);
      }
    }
  }
  return b;
}

// ---------- the raster ----------

// The building, painted into the raster as "not here". Two passes, because a
// room is an area *and* a boundary: cells whose centre falls inside a shape,
// and cells any wall segment passes through. The second is what keeps a tile
// from ending flush against a wall with a walker's shoulder in it.
//
// Only the shapes whose own bounding box reaches a cell are ever tested, which
// is what keeps this linear in building area rather than quadratic in rooms.
function markBuilding(state, r, blocked) {
  const clear = FACE_CLEAR;
  const cellOf = (x, z) => ({
    c: Math.floor((x - r.x0) / r.step),
    v: Math.floor((z - r.z0) / r.step),
  });
  const block = (c, v) => {
    if (c < 0 || v < 0 || c >= r.cols || v >= r.rows) return;
    blocked[v * r.cols + c] = 1;
  };
  for (const floor of (state && state.floors) || []) {
    for (const shape of shapesOf(floor)) {
      const bb = shapeBBox(shape);
      const lo = cellOf(bb.x0 - clear, bb.z0 - clear);
      const hi = cellOf(bb.x1 + clear, bb.z1 + clear);
      for (let v = Math.max(0, lo.v); v <= Math.min(r.rows - 1, hi.v); v++) {
        for (let c = Math.max(0, lo.c); c <= Math.min(r.cols - 1, hi.c); c++) {
          if (blocked[v * r.cols + c]) continue;
          const px = r.x0 + (c + 0.5) * r.step;
          const pz = r.z0 + (v + 0.5) * r.step;
          if (pointInShape(shape, px, pz)) blocked[v * r.cols + c] = 1;
        }
      }
      // ...and the walls themselves, walked cell by cell so that a room whose
      // bounding box is mostly outdoors only blocks the part of it that is
      // actually building.
      for (const ring of shape.rings) {
        for (let s = 0; s < ring.pts.length; s++) {
          const [a, b] = segEnds(ring, s);
          const len = Math.hypot(b.x - a.x, b.z - a.z);
          const steps = Math.max(1, Math.ceil(len / (r.step / 2)));
          for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const px = a.x + (b.x - a.x) * t;
            const pz = a.z + (b.z - a.z) * t;
            // The cells the wall reaches once a body's clearance is allowed
            // for, and no more: blocking the whole eight-neighbourhood of an
            // 8ft cell would put a twenty-four-foot no-go band round every
            // wall, and close the forty-foot gap between two blocks of a
            // campus that people are meant to walk down.
            for (const dx of [-clear, clear]) {
              for (const dz of [-clear, clear]) {
                const at = cellOf(px + dx, pz + dz);
                block(at.c, at.v);
              }
            }
          }
        }
      }
    }
  }
}

// Which region is under a point, last drawn first — `regionAt`'s rule, with
// the bounding boxes hoisted out of the loop because this is asked once per
// cell rather than once per click.
function regionLookup(state) {
  const list = regionsOf(state).map((region) => ({ region, bb: regionBBox(region) }));
  return (x, z) => {
    for (let i = list.length - 1; i >= 0; i--) {
      const { region, bb } = list[i];
      if (x < bb.x0 || x > bb.x1 || z < bb.z0 || z > bb.z1) continue;
      if (pointInRegion(region, x, z)) return region;
    }
    return null;
  };
}

// ---------- one site, meshed ----------

// The outdoors as convex tiles, the gates between them, and the tiles that
// reach the public way. Shaped like `meshFloor`'s answer on purpose: a tile is
// somewhere to stand with `anchors` hung on it, a gate is the one thing that
// becomes a graph node, and `navgraph.js` wires both exactly as it wires a
// storey.
export function meshSite(state, opts = {}) {
  const extent = opts.extent || siteExtent(state, opts);
  let step = Number.isFinite(opts.step) ? opts.step : YARD_STEP;
  let cols = Math.max(1, Math.ceil((extent.x1 - extent.x0) / step));
  let rows = Math.max(1, Math.ceil((extent.z1 - extent.z0) / step));
  // A site bigger than the raster budget gets a coarser raster rather than a
  // bigger one. Doubling keeps the cells square and the arithmetic exact.
  while (cols * rows > MAX_YARD_CELLS) {
    step *= 2;
    cols = Math.max(1, Math.ceil((extent.x1 - extent.x0) / step));
    rows = Math.max(1, Math.ceil((extent.z1 - extent.z0) / step));
  }
  const r = { x0: extent.x0, z0: extent.z0, step, cols, rows };

  const blocked = new Uint8Array(cols * rows);
  markBuilding(state, r, blocked);

  const regions = regionsOf(state);
  const regionOf = regionLookup(state);
  // The heightfield, or the one the caller already had: `terrainField` is the
  // expensive half of this function and every caller that meshes a site is a
  // caller that is about to want one anyway.
  const field = opts.field || terrainField(state);
  const grade = new Float32Array(cols * rows);
  const paved = new Uint8Array(cols * rows);
  const walkable = new Uint8Array(cols * rows);
  // Which region each cell is in, as an index into `regions` — or -1 for the
  // graded earth between them. This is what keeps a tile from spanning two
  // surfaces, and it is the same rule `navmesh.js` applies indoors: a tile
  // belongs to one room, so a tile out here belongs to one piece of ground.
  const cellRegion = new Int16Array(cols * rows).fill(-1);
  for (let v = 0; v < rows; v++) {
    for (let c = 0; c < cols; c++) {
      const i = v * cols + c;
      if (blocked[i]) continue;
      const px = r.x0 + (c + 0.5) * step;
      const pz = r.z0 + (v + 0.5) * step;
      const region = regionOf(px, pz);
      const entry = region ? surfaceEntry(region.surf) : null;
      // No region is graded earth, and graded earth is walkable — a site
      // nobody has drawn is a site you can still cross.
      if (entry && entry.walk === false) continue;
      if (entry && entry.paved) paved[i] = 1;
      cellRegion[i] = region ? regions.indexOf(region) : -1;
      const g = field.flat ? 0 : gradeAt(field, px, pz).slope;
      grade[i] = g;
      if (g > WALK_GRADE) continue;
      walkable[i] = 1;
    }
  }

  const sameRegion = (a, b) => cellRegion[a] === cellRegion[b];
  const rects = greedyRects(cols, rows, (x, y) => !!walkable[y * cols + x], {
    right: (x, y) => sameRegion(y * cols + x, y * cols + x + 1),
    down: (x, y) => sameRegion(y * cols + x, (y + 1) * cols + x),
  });

  const tiles = [];
  for (const rect of rects) {
    const x0 = r.x0 + rect.x0 * step;
    const z0 = r.z0 + rect.y0 * step;
    const x1 = r.x0 + (rect.x1 + 1) * step;
    const z1 = r.z0 + (rect.y1 + 1) * step;
    if (x1 - x0 < MIN_YARD_TILE || z1 - z0 < MIN_YARD_TILE) continue;
    let worst = 0, made = false;
    for (let v = rect.y0; v <= rect.y1; v++) {
      for (let c = rect.x0; c <= rect.x1; c++) {
        const i = v * cols + c;
        if (grade[i] > worst) worst = grade[i];
        if (paved[i]) made = true;
      }
    }
    const region = regions[cellRegion[rect.y0 * cols + rect.x0]] || null;
    tiles.push({
      id: `y${tiles.length}`,
      kind: 'yard',
      outdoors: true,
      floor: 0,
      x0, z0, x1, z1,
      cx: (x0 + x1) / 2,
      cz: (z0 + z1) / 2,
      area: (x1 - x0) * (z1 - z0),
      rect,
      // The steepest cell in it, and whether any of it is a made surface. Both
      // are properties of a *piece of ground*, which is why they live on the
      // tile rather than being re-derived every time a route crosses it.
      grade: worst,
      paved: made,
      // The piece of ground this is: a site region if it is on one, nothing if
      // it is the graded earth between them. Carried because a tile is now the
      // unit an outdoor hint and an outdoor hiding place are both about, and
      // both of them want a *name*.
      region: region ? region.id : null,
      name: (region && region.name) || null,
      surf: region ? region.surf : null,
      anchors: [],
    });
  }

  // Gates, between every pair of tiles that share an edge. Unlike a storey
  // there is nothing out here a gate may not cross: the seam between the lawn
  // and the car park is a seam and not a wall, and you walk over it. So every
  // edge is open — the tiles themselves already stop where the ground does and
  // where one surface becomes another.
  const gates = [];
  const open = { right: () => true, down: () => true };
  for (let i = 0; i < tiles.length; i++) {
    for (let j = i + 1; j < tiles.length; j++) {
      const g = tileGate(tiles[i].rect, tiles[j].rect, open);
      if (!g) continue;
      gates.push({
        id: `yg${gates.length}`,
        kind: 'gate',
        outdoors: true,
        floor: 0,
        room: null,
        a: tiles[i].id, b: tiles[j].id,
        x: g.axis === 'x' ? r.x0 + g.at * step : r.x0 + g.mid * step,
        z: g.axis === 'x' ? r.z0 + g.mid * step : r.z0 + g.at * step,
        w: g.span * step,
      });
    }
  }

  const mesh = {
    extent, step, cols, rows,
    tiles, gates,
    byId: new Map(tiles.map((t) => [t.id, t])),
  };
  mesh.ways = publicWay(mesh, paved);
  return mesh;
}

// ---------- the public way ----------

// Where you leave the property. A tile that reaches the rim of the extent is
// on the boundary of everything this design knows about, which is as close to
// a street as a model with no street in it can honestly get.
//
// **It is a line, not a place.** One node per rim tile would put a door forty
// feet from the kerb four hundred feet from it, because the outdoors meshes
// into a handful of enormous rectangles and the middle of a nine-hundred-foot
// edge is nowhere near either end of it. So the rim is walked cell by cell and
// a node dropped every `WAY_SPACING` along it.
//
// **Paved wins where there is any.** A code means the street or a walk that
// leads to one, and a gap in the hedge at the back of the playing field is not
// a public way — so the question asked of each cell is whether the paving
// reaches the property line *here*, not whether the tile it belongs to happens
// to contain a car park somewhere. When nothing paved reaches the rim the
// whole rim counts and `rule` says so, because a discharge distance measured
// to a fence is worth having and worth labelling.
export function publicWay(mesh, pavedCells = null) {
  const e = mesh.extent;
  const eps = mesh.step / 4;
  const isPaved = (c, v) => !!(pavedCells && pavedCells[v * mesh.cols + c]);

  // Every cell of every tile that touches the rim, with the point on the rim
  // it touches and whether the paving reaches it there.
  const rim = [];
  for (const t of mesh.tiles) {
    const r = t.rect;
    if (!r) continue;
    if (t.x0 <= e.x0 + eps) {
      for (let v = r.y0; v <= r.y1; v++) {
        rim.push({ t, c: r.x0, v, x: e.x0, z: mesh.extent.z0 + (v + 0.5) * mesh.step });
      }
    }
    if (t.x1 >= e.x1 - eps) {
      for (let v = r.y0; v <= r.y1; v++) {
        rim.push({ t, c: r.x1, v, x: e.x1, z: mesh.extent.z0 + (v + 0.5) * mesh.step });
      }
    }
    if (t.z0 <= e.z0 + eps) {
      for (let c = r.x0; c <= r.x1; c++) {
        rim.push({ t, c, v: r.y0, x: mesh.extent.x0 + (c + 0.5) * mesh.step, z: e.z0 });
      }
    }
    if (t.z1 >= e.z1 - eps) {
      for (let c = r.x0; c <= r.x1; c++) {
        rim.push({ t, c, v: r.y1, x: mesh.extent.x0 + (c + 0.5) * mesh.step, z: e.z1 });
      }
    }
  }
  for (const row of rim) row.paved = isPaved(row.c, row.v);

  const paved = rim.filter((row) => row.paved);
  const chosen = paved.length ? paved : rim;
  const rule = paved.length ? 'paved' : (rim.length ? 'boundary' : 'none');
  // One node every `WAY_SPACING`, or fewer if the frontage is long enough that
  // that would be a crowd.
  const every = Math.max(1, Math.round(
    Math.max(WAY_SPACING, (chosen.length * mesh.step) / MAX_WAYS) / mesh.step));
  const ways = [];
  for (let i = 0; i < chosen.length; i += every) {
    const row = chosen[i];
    ways.push({
      id: `w${ways.length}`,
      kind: 'way',
      outdoors: true,
      floor: 0,
      name: 'Public way',
      tile: row.t.id,
      paved: row.paved,
      x: row.x,
      z: row.z,
    });
  }
  ways.rule = rule;
  return ways;
}

// ---------- looking a point up ----------

// The tile a point is standing on, or the nearest one when it is standing in a
// flower bed, against a wall, or off the edge of the site. Always an answer
// where there is any tile at all: an agent who has walked somewhere the mesh
// says is not walkable still has to be able to walk out of it.
export function yardTileFor(mesh, x, z) {
  if (!mesh || !mesh.tiles.length) return null;
  let best = null, bestD = Infinity;
  for (const t of mesh.tiles) {
    if (x >= t.x0 && x <= t.x1 && z >= t.z0 && z <= t.z1) return { tile: t, inside: true };
    const dx = Math.max(t.x0 - x, 0, x - t.x1);
    const dz = Math.max(t.z0 - z, 0, z - t.z1);
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = t; }
  }
  return best ? { tile: best, inside: false } : null;
}

// The steepest ground a route crosses, sampled along the line it actually
// walks. Not a property of the tiles it passes over: a five-hundred-foot lawn
// is one tile, and the bank at the far corner of it is nothing to do with a
// route that clips the near one.
export function pathGrade(field, points, step = YARD_STEP / 2) {
  if (!field || field.flat || !points || points.length < 2) return 0;
  let worst = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const g = gradeAt(field, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t).slope;
      if (g > worst) worst = g;
    }
  }
  return worst;
}

// How much ground there is to walk on, in ft² — the site's answer to
// `walkableArea`, and what says whether a mesh found a site or found a
// building with nothing round it.
export function yardArea(mesh) {
  let a = 0;
  for (const t of (mesh ? mesh.tiles : [])) a += t.area;
  return a;
}

// A one-line summary, for a panel that wants to say what the outdoors came out
// as without counting arrays itself.
export function yardSummary(mesh) {
  if (!mesh) return { tiles: 0, gates: 0, ways: 0, area: 0, rule: 'none', step: YARD_STEP };
  return {
    tiles: mesh.tiles.length,
    gates: mesh.gates.length,
    ways: mesh.ways.length,
    area: yardArea(mesh),
    rule: mesh.ways.rule || 'none',
    step: mesh.step,
  };
}
