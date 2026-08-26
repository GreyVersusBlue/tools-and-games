// build.mjs — the fixture builder the suites share.
//
// Before Phase 12 a test drew its building straight onto the floor: `setTile`
// here, `edgesH[...] = EDGE_WALL` there. A floor has no lattice on it any
// more, so a test draws on a scratch one and bakes it into rooms — which is
// exactly what the paint brush, the generator and the save loader all do, and
// therefore the state a caller actually produces. (Phase 11's retrospective:
// "a pure module is only as honest as the state its tests put it in.")
//
// Not a module the app imports. It exists so fifteen suites don't each keep
// their own copy of "draw a walled box and bake it".

import {
  createLattice, setTile, cellIdx, edgeHIdx, edgeVIdx, bake,
  EDGE_WALL, EDGE_DOOR,
} from '../js/lattice.js';

// A scratch lattice bound to one storey of `state`, with a small chained
// vocabulary for drawing on it. Call `.bake()` when the storey is drawn.
export function sheet(state, floorIndex = 0) {
  const floor = state.floors[floorIndex];
  const lat = createLattice(floor.w, floor.h);
  const api = {
    lat,
    floorIndex,
    // The lattice's own fields, so a sheet can stand in for the floor record
    // fixtures used to draw on directly: `sh.edgesH[edgeHIdx(sh, x, y)] = ...`
    // reads exactly as it did, and `sh.bake()` is the new last line.
    w: lat.w,
    h: lat.h,
    cells: lat.cells,
    edgesH: lat.edgesH,
    edgesV: lat.edgesV,

    // One cell on or off.
    tile(x, y, on = true) { setTile(lat, x, y, on); return api; },

    // A solid block of cells, inclusive of both ends.
    fill(x0, y0, x1, y1) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setTile(lat, x, y, true);
      return api;
    },

    // ...and the wall around it.
    walls(x0, y0, x1, y1, val = EDGE_WALL) {
      for (let x = x0; x <= x1; x++) {
        lat.edgesH[edgeHIdx(lat, x, y0)] = val;
        lat.edgesH[edgeHIdx(lat, x, y1 + 1)] = val;
      }
      for (let y = y0; y <= y1; y++) {
        lat.edgesV[edgeVIdx(lat, x0, y)] = val;
        lat.edgesV[edgeVIdx(lat, x1 + 1, y)] = val;
      }
      return api;
    },

    // The two together, the way most fixtures want them.
    box(x0, y0, x1, y1, opts = {}) {
      api.fill(x0, y0, x1, y1).walls(x0, y0, x1, y1, opts.wall);
      if (opts.name || opts.color || opts.fin || opts.paint) {
        api.label(x0, y0, x1, y1, opts);
      }
      return api;
    },

    // Name, tint and finish a block of cells — what the bake lifts onto the
    // room record.
    label(x0, y0, x1, y1, opts = {}) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const c = lat.cells[cellIdx(lat, x, y)];
          if (!c) continue;
          if (opts.name !== undefined) c.room = opts.name;
          if (opts.color !== undefined) c.color = opts.color;
          if (opts.fin !== undefined) c.fin = opts.fin;
          if (opts.paint !== undefined) c.paint = opts.paint;
        }
      }
      return api;
    },

    // One edge, by lattice coordinates. `edgeH` runs along +X between two
    // rows; `edgeV` runs along +Z between two columns. (Not `h`/`v` — a sheet
    // stands in for a floor record, and `h` is its height.)
    edgeH(x, y, val = EDGE_WALL) { lat.edgesH[edgeHIdx(lat, x, y)] = val; return api; },
    edgeV(x, y, val = EDGE_WALL) { lat.edgesV[edgeVIdx(lat, x, y)] = val; return api; },

    hrun(x0, x1, y, val = EDGE_WALL) {
      for (let x = x0; x <= x1; x++) lat.edgesH[edgeHIdx(lat, x, y)] = val;
      return api;
    },
    vrun(x, y0, y1, val = EDGE_WALL) {
      for (let y = y0; y <= y1; y++) lat.edgesV[edgeVIdx(lat, x, y)] = val;
      return api;
    },

    door(x, y, horizontal = true, val = EDGE_DOOR) {
      return horizontal ? api.edgeH(x, y, val) : api.edgeV(x, y, val);
    },

    bake() { return bake(state, floorIndex, lat); },
  };
  return api;
}

// A bare slab with no walls on it — the fixture for everything that only
// cares where the floor is (the roof mask, the structural shadow, the site).
// `boxes` are [x0, y0, x1, y1] in cells, inclusive, and cells switched off by
// a later box are taken back out before the bake.
export function slabOn(state, floorIndex, ...boxes) {
  const sh = sheet(state, floorIndex);
  for (const [x0, y0, x1, y1, on = true] of boxes) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) sh.tile(x, y, on);
  }
  return sh.bake();
}

// The same for a hand-written list of cells.
export function cellsOn(state, floorIndex, cells) {
  const sh = sheet(state, floorIndex);
  for (const [x, y] of cells) sh.tile(x, y, true);
  return sh.bake();
}

// The one-liner: a walled box on a storey, baked, and the room it became.
export function boxRoom(state, floorIndex, x0, y0, x1, y1, opts = {}) {
  const s = sheet(state, floorIndex);
  s.box(x0, y0, x1, y1, opts);
  if (opts.draw) opts.draw(s);
  const out = s.bake();
  return out.shapes[0] || null;
}
