// grid.js — grid data model, pure helpers (no three.js imports)
// Units are feet. One cell = 4ft x 4ft. Walls live on cell edges.

export const CELL = 4;        // ft per grid cell
export const WALL_H = 10;     // wall height, ft
export const WALL_T = 0.5;    // wall thickness, ft
export const DOOR_W = 3;      // door opening width, ft
export const DOOR_H = 7;      // door opening height, ft
export const EYE_H = 5.5;     // first-person eye height, ft

export const DEFAULT_W = 40;  // cells
export const DEFAULT_H = 30;  // cells

// Pastel floor tints for rooms
export const ROOM_COLORS = [
  '#f5d491', '#b8dfa2', '#a9d3e8', '#e8b4c8',
  '#d4c5f9', '#f5b891', '#9fdcd0', '#e6e08e',
];

export function createState(w = DEFAULT_W, h = DEFAULT_H) {
  return {
    version: 1,
    cellFt: CELL,
    w, h,
    // cells[i] = null (no floor) or { room: string|null, color: '#rrggbb'|null }
    cells: new Array(w * h).fill(null),
    // edgesH[y*w + x] = edge between cell (x,y-1) and (x,y), y in 0..h. 0 none, 1 wall, 2 door
    edgesH: new Array(w * (h + 1)).fill(0),
    // edgesV[y*(w+1) + x] = edge between cell (x-1,y) and (x,y), x in 0..w. 0 none, 1 wall, 2 door
    edgesV: new Array((w + 1) * h).fill(0),
  };
}

export const cellIdx  = (s, x, y) => y * s.w + x;
export const edgeHIdx = (s, x, y) => y * s.w + x;         // x in 0..w-1, y in 0..h
export const edgeVIdx = (s, x, y) => y * (s.w + 1) + x;   // x in 0..w,   y in 0..h-1

export const inGrid = (s, x, y) => x >= 0 && y >= 0 && x < s.w && y < s.h;

export function getCell(s, x, y) {
  return inGrid(s, x, y) ? s.cells[cellIdx(s, x, y)] : null;
}

export function setFloor(s, x, y, on) {
  if (!inGrid(s, x, y)) return false;
  const i = cellIdx(s, x, y);
  if (on && !s.cells[i]) { s.cells[i] = { room: null, color: null }; return true; }
  if (!on && s.cells[i]) { s.cells[i] = null; return true; }
  return false;
}

// Can we walk/flood from (x,y) to its neighbor in direction d?
// Both walls and doors bound a room region.
const DIRS = [
  { dx: 1, dy: 0 },  // east  -> edgesV(x+1, y)
  { dx: -1, dy: 0 }, // west  -> edgesV(x, y)
  { dx: 0, dy: 1 },  // south -> edgesH(x, y+1)
  { dx: 0, dy: -1 }, // north -> edgesH(x, y)
];

export function edgeBetween(s, x, y, dx, dy) {
  if (dx === 1)  return { arr: s.edgesV, i: edgeVIdx(s, x + 1, y) };
  if (dx === -1) return { arr: s.edgesV, i: edgeVIdx(s, x, y) };
  if (dy === 1)  return { arr: s.edgesH, i: edgeHIdx(s, x, y + 1) };
  return { arr: s.edgesH, i: edgeHIdx(s, x, y) };
}

// Flood fill from (x,y) across floored cells, bounded by walls and doors.
// Returns array of {x, y} cells in the region (empty if start has no floor).
export function floodRegion(s, x, y) {
  if (!getCell(s, x, y)) return [];
  const seen = new Set([cellIdx(s, x, y)]);
  const out = [];
  const stack = [{ x, y }];
  while (stack.length) {
    const c = stack.pop();
    out.push(c);
    for (const d of DIRS) {
      const nx = c.x + d.dx, ny = c.y + d.dy;
      if (!inGrid(s, nx, ny)) continue;
      const ni = cellIdx(s, nx, ny);
      if (seen.has(ni) || !s.cells[ni]) continue;
      const e = edgeBetween(s, c.x, c.y, d.dx, d.dy);
      if (e.arr[e.i] !== 0) continue; // wall or door blocks region spread
      seen.add(ni);
      stack.push({ x: nx, y: ny });
    }
  }
  return out;
}

// All labeled regions: [{ name, color, cx, cz (world ft centroid), count }]
export function computeLabels(s) {
  const visited = new Set();
  const labels = [];
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const i = cellIdx(s, x, y);
      if (visited.has(i) || !s.cells[i]) continue;
      const region = floodRegion(s, x, y);
      let name = null, color = null, sx = 0, sy = 0;
      for (const c of region) {
        const ci = cellIdx(s, c.x, c.y);
        visited.add(ci);
        const cell = s.cells[ci];
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

// ---------- sample school (first-run demo content) ----------

function floorRect(s, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) setFloor(s, x, y, true);
}

function wallRect(s, x0, y0, x1, y1) {
  for (let x = x0; x <= x1; x++) {
    s.edgesH[edgeHIdx(s, x, y0)] = 1;
    s.edgesH[edgeHIdx(s, x, y1 + 1)] = 1;
  }
  for (let y = y0; y <= y1; y++) {
    s.edgesV[edgeVIdx(s, x0, y)] = 1;
    s.edgesV[edgeVIdx(s, x1 + 1, y)] = 1;
  }
}

function assignRoom(s, x, y, name, color) {
  for (const c of floodRegion(s, x, y)) {
    const cell = s.cells[cellIdx(s, c.x, c.y)];
    cell.room = name;
    cell.color = color;
  }
}

export function buildSampleSchool() {
  const s = createState();
  // Main hall: x 6..33, y 13..15
  floorRect(s, 6, 13, 33, 15);
  // Classrooms north of the hall: four 7x6 rooms, y 7..12
  for (let r = 0; r < 4; r++) floorRect(s, 6 + r * 7, 7, 12 + r * 7, 12);
  // South side: office + two classrooms, y 16..21
  floorRect(s, 6, 16, 12, 21);   // office
  floorRect(s, 13, 16, 22, 21);  // room 105
  floorRect(s, 23, 16, 33, 21);  // room 106
  // Outer shell + interior partitions
  wallRect(s, 6, 7, 33, 21);
  for (let r = 1; r < 4; r++)
    for (let y = 7; y <= 12; y++) s.edgesV[edgeVIdx(s, 6 + r * 7, y)] = 1;
  for (let x = 6; x <= 33; x++) {
    s.edgesH[edgeHIdx(s, x, 13)] = 1;
    s.edgesH[edgeHIdx(s, x, 16)] = 1;
  }
  for (let y = 16; y <= 21; y++) {
    s.edgesV[edgeVIdx(s, 13, y)] = 1;
    s.edgesV[edgeVIdx(s, 23, y)] = 1;
  }
  // Doors: each north room into the hall
  for (let r = 0; r < 4; r++) s.edgesH[edgeHIdx(s, 8 + r * 7, 13)] = 2;
  // South rooms into the hall
  s.edgesH[edgeHIdx(s, 9, 16)] = 2;
  s.edgesH[edgeHIdx(s, 17, 16)] = 2;
  s.edgesH[edgeHIdx(s, 28, 16)] = 2;
  // Main entrance on the west end of the hall
  s.edgesV[edgeVIdx(s, 6, 14)] = 2;
  // Labels
  assignRoom(s, 7, 8, 'Room 101', ROOM_COLORS[0]);
  assignRoom(s, 14, 8, 'Room 102', ROOM_COLORS[1]);
  assignRoom(s, 21, 8, 'Room 103', ROOM_COLORS[2]);
  assignRoom(s, 28, 8, 'Room 104', ROOM_COLORS[3]);
  assignRoom(s, 8, 14, 'Main Hall', '#e9e4da');
  assignRoom(s, 8, 18, 'Office', ROOM_COLORS[4]);
  assignRoom(s, 16, 18, 'Room 105', ROOM_COLORS[5]);
  assignRoom(s, 28, 18, 'Room 106', ROOM_COLORS[6]);
  return s;
}
