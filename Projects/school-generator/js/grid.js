// grid.js — grid data model, pure helpers (no three.js imports)
// Units are feet. One cell = 4ft x 4ft. Walls live on cell edges.
//
// State shape (v4):
//   { version, cellFt, floorHt, w, h,
//     floors: [ { w, h, cells[], edgesH[], edgesV[], shapes[] }, ... ],
//     currentFloor, props: [], links: [], nextId }
//
// A floor carries two room representations side by side. The cell grid is the
// fast rectangular mode — most of a school is rectangles, and laying them on a
// 4ft lattice is quicker than drawing them. `shapes[]` (see shapes.js) holds
// polygon rooms for everything the lattice can't say: angled corners, alcoves,
// breakout rooms, courtyards. Neither is going away; `convertRegion()` in
// shapes.js promotes a grid region to a polygon when a room outgrows the grid.
//
// All floors share one footprint (w x h) and one grid origin. That is a
// deliberate constraint: stairs, mezzanine openings and floor cuts all need
// to line up between levels, and a shared origin makes "same (x, y) cell on
// the level above" a trivial lookup instead of a coordinate transform.
// Each floor record still carries its own w/h so every pure helper below
// takes a *floor* and reads exactly the fields the v1 state had.

export const CELL = 4;        // ft per grid cell
export const WALL_H = 10;     // wall height (ceiling plane), ft
// Guardrail height. Waist-high on purpose: a railing has to read as an edge you
// can see over, never as an enclosure the way a wall does.
export const RAIL_H = 3.5;    // ft — a school's code minimum
export const FLOOR_H = 12;    // floor-to-floor height, ft (10ft ceiling + 2ft plenum)
export const WALL_T = 0.5;    // wall thickness, ft
export const DOOR_W = 3;      // door opening width, ft
export const DOOR_H = 7;      // door opening height, ft
export const EYE_H = 5.5;     // first-person eye height, ft

// Edge kinds on the lattice. 0-2 are v1's vocabulary and can't move; glass and
// railing are appended, so an old save reads exactly as it did. Everything
// non-zero bounds a region for flood fill, which is the point of the ordering:
// `if (edge)` still means "something is in the way", and only the renderer and
// the walkthrough care which kind of something it is.
export const EDGE_NONE = 0;
export const EDGE_WALL = 1;
export const EDGE_DOOR = 2;
export const EDGE_GLASS = 3;
export const EDGE_RAIL = 4;
export const EDGE_KINDS = [EDGE_NONE, EDGE_WALL, EDGE_DOOR, EDGE_GLASS, EDGE_RAIL];

export const DEFAULT_W = 40;  // cells
export const DEFAULT_H = 30;  // cells
export const MAX_FLOORS = 8;

// Pastel floor tints for rooms
export const ROOM_COLORS = [
  '#f5d491', '#b8dfa2', '#a9d3e8', '#e8b4c8',
  '#d4c5f9', '#f5b891', '#9fdcd0', '#e6e08e',
];

// ---------- construction ----------

export function createFloor(w = DEFAULT_W, h = DEFAULT_H) {
  return {
    w, h,
    // cells[i] = null (no floor) or { room: string|null, color: '#rrggbb'|null }
    cells: new Array(w * h).fill(null),
    // edgesH[y*w + x] = edge between cell (x,y-1) and (x,y), y in 0..h. See EDGE_* above.
    edgesH: new Array(w * (h + 1)).fill(0),
    // edgesV[y*(w+1) + x] = edge between cell (x-1,y) and (x,y), x in 0..w. See EDGE_* above.
    edgesV: new Array((w + 1) * h).fill(0),
    // Polygon rooms on this storey — see shapes.js. Free-floating outlines in
    // world feet, not tied to the lattice above.
    shapes: [],
  };
}

export function createState(w = DEFAULT_W, h = DEFAULT_H) {
  return {
    version: 4,
    cellFt: CELL,
    floorHt: FLOOR_H,
    w, h,
    floors: [createFloor(w, h)],
    currentFloor: 0,
    // Free-floating objects in world feet — see props.js
    props: [],
    // Inter-floor connections — stairs and the floor openings they cut. See
    // props.js for the record shape and stairs.js for what one means.
    links: [],
    nextId: 1,
  };
}

export const floorLabel = (i) => `Level ${i + 1}`;

// ---------- floor access ----------

export const activeFloor = (s) => s.floors[s.currentFloor] || s.floors[0];
export const floorAt = (s, i) => s.floors[i] || null;
export const floorBaseY = (s, i) => i * (s.floorHt || FLOOR_H);
export const topOfBuilding = (s) => floorBaseY(s, s.floors.length - 1) + WALL_H;

// Walls run full floor-to-floor height on any level that has a level above it,
// so the building has no gap band between storeys when seen from outside.
export const wallHeightOf = (s, i) => (i < s.floors.length - 1 ? (s.floorHt || FLOOR_H) : WALL_H);

// ---------- cell / edge helpers (operate on a single floor) ----------

export const cellIdx  = (f, x, y) => y * f.w + x;
export const edgeHIdx = (f, x, y) => y * f.w + x;         // x in 0..w-1, y in 0..h
export const edgeVIdx = (f, x, y) => y * (f.w + 1) + x;   // x in 0..w,   y in 0..h-1

export const inGrid = (f, x, y) => x >= 0 && y >= 0 && x < f.w && y < f.h;

export function getCell(f, x, y) {
  return inGrid(f, x, y) ? f.cells[cellIdx(f, x, y)] : null;
}

export function setTile(f, x, y, on) {
  if (!inGrid(f, x, y)) return false;
  const i = cellIdx(f, x, y);
  if (on && !f.cells[i]) { f.cells[i] = { room: null, color: null }; return true; }
  if (!on && f.cells[i]) { f.cells[i] = null; return true; }
  return false;
}

// Can we walk/flood from (x,y) to its neighbor in direction d?
// Every edge kind bounds a room region — a glass partition separates two rooms
// as surely as a plastered one does, and a railing is the edge of the floor.
const DIRS = [
  { dx: 1, dy: 0 },  // east  -> edgesV(x+1, y)
  { dx: -1, dy: 0 }, // west  -> edgesV(x, y)
  { dx: 0, dy: 1 },  // south -> edgesH(x, y+1)
  { dx: 0, dy: -1 }, // north -> edgesH(x, y)
];

export function edgeBetween(f, x, y, dx, dy) {
  if (dx === 1)  return { arr: f.edgesV, i: edgeVIdx(f, x + 1, y) };
  if (dx === -1) return { arr: f.edgesV, i: edgeVIdx(f, x, y) };
  if (dy === 1)  return { arr: f.edgesH, i: edgeHIdx(f, x, y + 1) };
  return { arr: f.edgesH, i: edgeHIdx(f, x, y) };
}

// Flood fill from (x,y) across floored cells, bounded by any edge kind.
// Returns array of {x, y} cells in the region (empty if start has no floor).
export function floodRegion(f, x, y) {
  if (!getCell(f, x, y)) return [];
  const seen = new Set([cellIdx(f, x, y)]);
  const out = [];
  const stack = [{ x, y }];
  while (stack.length) {
    const c = stack.pop();
    out.push(c);
    for (const d of DIRS) {
      const nx = c.x + d.dx, ny = c.y + d.dy;
      if (!inGrid(f, nx, ny)) continue;
      const ni = cellIdx(f, nx, ny);
      if (seen.has(ni) || !f.cells[ni]) continue;
      const e = edgeBetween(f, c.x, c.y, d.dx, d.dy);
      if (e.arr[e.i] !== EDGE_NONE) continue; // anything on the edge stops the region
      seen.add(ni);
      stack.push({ x: nx, y: ny });
    }
  }
  return out;
}

// All labeled regions on one floor: [{ name, color, cx, cz (world ft), count }]
export function computeLabels(f) {
  const visited = new Set();
  const labels = [];
  for (let y = 0; y < f.h; y++) {
    for (let x = 0; x < f.w; x++) {
      const i = cellIdx(f, x, y);
      if (visited.has(i) || !f.cells[i]) continue;
      const region = floodRegion(f, x, y);
      let name = null, color = null, sx = 0, sy = 0;
      for (const c of region) {
        const ci = cellIdx(f, c.x, c.y);
        visited.add(ci);
        const cell = f.cells[ci];
        if (!name && cell.room) { name = cell.room; color = cell.color; }
        sx += c.x + 0.5; sy += c.y + 0.5;
      }
      if (name) {
        labels.push({
          name, color,
          cx: (sx / region.length) * CELL,
          cz: (sy / region.length) * CELL,
          count: region.length,
        });
      }
    }
  }
  return labels;
}

export function floorCellCount(f) {
  let n = 0;
  for (let i = 0; i < f.cells.length; i++) if (f.cells[i]) n++;
  return n;
}

export const floorShapeCount = (f) => (f && Array.isArray(f.shapes) ? f.shapes.length : 0);

// Ids for props, links and polygon rooms all come off one monotonic counter so
// nothing in a save file can collide.
function nextShapeId(s) {
  const id = Math.max(1, Math.floor(s.nextId || 1));
  s.nextId = id + 1;
  return id;
}

// ---------- floor management ----------
//
// Inserting or removing a level renumbers everything above it, so props and
// inter-floor links are remapped here rather than left for callers to fix up.

function remapFloorRefs(s, map) {
  s.props = s.props.filter((p) => map(p.floor) !== null);
  for (const p of s.props) p.floor = map(p.floor);
  s.links = s.links.filter((l) => map(l.from) !== null && map(l.to) !== null);
  for (const l of s.links) { l.from = map(l.from); l.to = map(l.to); }
}

// Insert an empty floor at `index` (defaults to just above the current one).
// Returns the new floor's index, or -1 if the building is already at MAX_FLOORS.
export function addFloor(s, index = s.currentFloor + 1) {
  if (s.floors.length >= MAX_FLOORS) return -1;
  const at = Math.min(Math.max(0, Math.floor(index)), s.floors.length);
  s.floors.splice(at, 0, createFloor(s.w, s.h));
  remapFloorRefs(s, (i) => (i >= at ? i + 1 : i));
  s.currentFloor = at;
  return at;
}

// Copy an existing floor's structure onto a new level above it.
export function duplicateFloor(s, index = s.currentFloor) {
  if (s.floors.length >= MAX_FLOORS) return -1;
  const src = s.floors[index];
  if (!src) return -1;
  const at = index + 1;
  s.floors.splice(at, 0, {
    w: src.w, h: src.h,
    cells: src.cells.map((c) => (c ? { room: c.room, color: c.color } : null)),
    edgesH: src.edgesH.slice(),
    edgesV: src.edgesV.slice(),
    // Copied polygon rooms are new rooms: same outline, fresh ids, so a tool
    // holding a selection can't end up editing both storeys at once. Cloned
    // here rather than through shapes.js so grid.js stays a leaf module.
    shapes: (src.shapes || []).map((sh) => ({
      id: nextShapeId(s),
      name: sh.name,
      color: sh.color,
      rings: sh.rings.map((r) => ({
        pts: r.pts.map((p) => ({ x: p.x, z: p.z })),
        walls: r.walls.slice(),
        openings: r.openings.map((o) => ({ seg: o.seg, t: o.t, w: o.w })),
      })),
    })),
  });
  remapFloorRefs(s, (i) => (i >= at ? i + 1 : i));
  s.currentFloor = at;
  return at;
}

// Remove a floor along with anything anchored to it. The ground floor of a
// one-storey building can't be removed — there has to be something to edit.
export function removeFloor(s, index = s.currentFloor) {
  if (s.floors.length <= 1 || !s.floors[index]) return false;
  s.floors.splice(index, 1);
  remapFloorRefs(s, (i) => (i === index ? null : i > index ? i - 1 : i));
  s.currentFloor = Math.min(s.currentFloor, s.floors.length - 1);
  return true;
}

export function setCurrentFloor(s, i) {
  const n = Math.min(Math.max(0, Math.floor(i)), s.floors.length - 1);
  if (n === s.currentFloor) return false;
  s.currentFloor = n;
  return true;
}
