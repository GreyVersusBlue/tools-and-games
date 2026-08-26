// roof.js — what the building looks like from the outside, above the walls.
//
// Every version before this one stopped the building at the top of its walls.
// From the air a school was a set of extruded rooms with a ceiling laid over
// them, which reads as a floor plan seen in perspective rather than as a
// building — and once there is a site around it, that is the thing you notice
// first.
//
// A roof is derived, like everything else here. Nothing is drawn, nothing is
// stored per wing: `state.roof` is one small record — a style, a pitch and a
// facade material — and the geometry falls out of the footprint the same way
// stair cuts fall out of a link. Draw a new wing and it gets a roof; erase one
// and its roof goes with it.
//
// The pipeline is four steps, each its own testable function:
//
//   1. `roofMask()`     the top storey's footprint, rasterized onto the cell
//                       lattice — grid cells and polygon rooms both, because a
//                       wing that escaped the grid still needs covering.
//   2. `maskOutlines()` the boundary of that mask as closed loops in world
//                       feet, collinear runs merged. This is the parapet.
//   3. `maskRects()`    the mask cut into a few large rectangles, biggest
//                       first. This is where a pitched roof gets its ridges.
//   4. `roofPlan()`     the two above, plus arithmetic, turned into faces the
//                       renderer extrudes and the site plan draws.
//
// Step 3 is the honest compromise in the file, and it is worth naming. A true
// pitched roof over an arbitrary polygon is a straight skeleton, which is a
// genuinely hard piece of computational geometry and a large amount of code to
// get subtly wrong. A rectangle, on the other hand, has an exactly correct hip
// or gable that anyone can check by hand — so an L-shaped school is roofed as
// two rectangular masses that meet, which is *also* how an L-shaped school is
// actually built. The blocks interpenetrate at the joint at a shared eave
// height and a shared pitch, which is what a valley looks like. Where this
// shows its seams is a wing much narrower than its neighbour: two ridges at
// two heights, which is true of the building and still reads as a compromise.
//
// Pure module: no three.js. Exercised by test/roof.test.mjs.

import { CELL, WALL_H, floorBaseY } from './grid.js';
import { shapesOf, shapeBBox, pointInShape } from './shapes.js';

// A parapet is a low wall around a flat roof, hiding the mechanical plant and
// carrying the flashing. Three feet is a school's; anything shorter reads as a
// kerb and anything taller as a storey.
export const PARAPET_H = 3;       // ft
export const COPING_T = 0.35;     // ft — the cap stone on top of it
// How far a pitched roof hangs past the wall it sits on. Eighteen inches is a
// soffit with a gutter on it.
export const EAVE = 1.5;          // ft
// Pitch is stated the way a builder states it: rise per twelve of run. 4:12 is
// a low institutional pitch, 12:12 is a steep gable, and 2:12 is about as flat
// as anything you would still call pitched.
export const MIN_PITCH = 2;
export const MAX_PITCH = 12;
export const DEFAULT_PITCH = 4;

export const ROOF_STYLES = [
  // `flat` is what every version before this one drew, kept as a style rather
  // than deleted so a design can ask for it back.
  { key: 'flat', label: 'Flat (no cap)', pitched: false },
  { key: 'parapet', label: 'Flat with parapet', pitched: false },
  { key: 'hip', label: 'Hipped', pitched: true },
  { key: 'gable', label: 'Gabled', pitched: true },
];
export const ROOF_STYLE_KEYS = ROOF_STYLES.map((s) => s.key);
const STYLE_BY_KEY = new Map(ROOF_STYLES.map((s) => [s.key, s]));
export const roofStyleEntry = (k) => STYLE_BY_KEY.get(k) || STYLE_BY_KEY.get('parapet');
export const isPitched = (k) => roofStyleEntry(k).pitched;

// The default is a parapet, and that is a deliberate change to how an old file
// looks — the same call Phase 5's door leaves made when an `EDGE_DOOR` that
// used to be a hole started hanging a leaf. Nothing about the file changed; a
// school with no parapet is the unusual one, and a building that stops dead at
// its wall top is the thing this phase set out to fix.
export const DEFAULT_ROOF = { style: 'parapet', pitch: DEFAULT_PITCH, facade: 'brick' };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const defaultRoof = () => ({ ...DEFAULT_ROOF });

export function normalizeRoof(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const pitch = Number(r.pitch);
  return {
    style: ROOF_STYLE_KEYS.includes(r.style) ? r.style : DEFAULT_ROOF.style,
    pitch: Number.isFinite(pitch) ? clamp(Math.round(pitch), MIN_PITCH, MAX_PITCH) : DEFAULT_PITCH,
    // Validated against finish.js's table by the caller, which owns the
    // material list — this module only carries the key.
    facade: typeof r.facade === 'string' ? r.facade.slice(0, 24) : DEFAULT_ROOF.facade,
  };
}

// The state's roof record, created on first write. Same shape as
// `ensureTerrain` and `ensureSite`, and for the same reason: a design that
// never touches its roof never carries one.
export const ensureRoof = (state) => {
  if (!state.roof || typeof state.roof !== 'object') state.roof = defaultRoof();
  return state.roof;
};

export const isDefaultRoof = (roof) => {
  const r = normalizeRoof(roof);
  return r.style === DEFAULT_ROOF.style && r.pitch === DEFAULT_ROOF.pitch &&
    r.facade === DEFAULT_ROOF.facade;
};

// ---------- 1. the footprint mask ----------

// The storey's covered cells, on a raster that can start left of and above the
// drawing surface — a room is allowed outside the footprint, and a roof that
// stopped at the grid edge would leave one wing bare.
export function roofMask(floor, gridW, gridH) {
  if (!floor) return { cx0: 0, cy0: 0, w: 0, h: 0, on: new Uint8Array(0) };
  let cx0 = 0, cy0 = 0, cx1 = floor.w ?? gridW ?? 0, cy1 = floor.h ?? gridH ?? 0;
  const boxes = shapesOf(floor).map((shape) => ({ shape, b: shapeBBox(shape) }));
  for (const { b } of boxes) {
    cx0 = Math.min(cx0, Math.floor(b.x0 / CELL));
    cy0 = Math.min(cy0, Math.floor(b.z0 / CELL));
    cx1 = Math.max(cx1, Math.ceil(b.x1 / CELL));
    cy1 = Math.max(cy1, Math.ceil(b.z1 / CELL));
  }
  const w = Math.max(0, cx1 - cx0), h = Math.max(0, cy1 - cy0);
  const on = new Uint8Array(w * h);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const gx = cx0 + c, gy = cy0 + r;
      let covered = false;
      {
        // A room covers a cell if it covers the middle of it. Coarse by
        // construction — the mask is the roof's resolution, and a roof does
        // not follow a 4ft jog in a wall.
        const x = (gx + 0.5) * CELL, z = (gy + 0.5) * CELL;
        for (const { shape, b } of boxes) {
          if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
          if (pointInShape(shape, x, z)) { covered = true; break; }
        }
      }
      if (covered) on[r * w + c] = 1;
    }
  }
  return { cx0, cy0, w, h, on };
}

export const maskAt = (m, c, r) =>
  (c < 0 || r < 0 || c >= m.w || r >= m.h ? 0 : m.on[r * m.w + c]);

export const maskCount = (m) => {
  let n = 0;
  for (let i = 0; i < m.on.length; i++) if (m.on[i]) n++;
  return n;
};

// ---------- 2. the outline ----------

const ptKey = (p) => `${p.c},${p.r}`;

// The boundary of the mask as closed loops of world points, wound so the
// covered side is consistent. Each covered cell contributes one directed edge
// per uncovered neighbour; the edges chain end-to-start into loops because
// every boundary vertex has exactly as many edges leaving it as arriving.
export function maskOutlines(m) {
  const edges = new Map();   // start key -> [ {from, to} ]
  const push = (from, to) => {
    const k = ptKey(from);
    if (!edges.has(k)) edges.set(k, []);
    edges.get(k).push({ from, to });
  };
  for (let r = 0; r < m.h; r++) {
    for (let c = 0; c < m.w; c++) {
      if (!maskAt(m, c, r)) continue;
      // Clockwise in (x, z), which puts the covered side on the right of
      // every edge — the winding shapes.js uses for a hole, and the one the
      // renderer's extrusion assumes.
      if (!maskAt(m, c, r - 1)) push({ c, r }, { c: c + 1, r });
      if (!maskAt(m, c + 1, r)) push({ c: c + 1, r }, { c: c + 1, r: r + 1 });
      if (!maskAt(m, c, r + 1)) push({ c: c + 1, r: r + 1 }, { c, r: r + 1 });
      if (!maskAt(m, c - 1, r)) push({ c, r: r + 1 }, { c, r });
    }
  }
  const loops = [];
  while (edges.size) {
    const startKey = edges.keys().next().value;
    const first = edges.get(startKey)[0];
    let cur = first;
    const pts = [];
    // Guard against a malformed chain rather than spinning: the loop can visit
    // each edge at most once, so the edge count is a hard bound.
    let guard = 0, guardMax = 8 + m.w * m.h * 4;
    while (cur && guard++ < guardMax) {
      pts.push(cur.from);
      const k = ptKey(cur.from);
      const list = edges.get(k);
      const i = list.indexOf(cur);
      if (i >= 0) list.splice(i, 1);
      if (!list.length) edges.delete(k);
      const nextList = edges.get(ptKey(cur.to));
      if (!nextList || !nextList.length) break;
      // At a pinch point two loops share a vertex; taking the first available
      // edge splits them into two loops, which is the reading a roof wants.
      cur = nextList[0];
      if (ptKey(cur.from) === startKey) { pts.push(cur.from); break; }
      if (pts.length > guardMax) break;
    }
    if (pts.length >= 4) {
      loops.push(simplifyLoop(pts).map((p) => ({ x: (m.cx0 + p.c) * CELL, z: (m.cy0 + p.r) * CELL })));
    }
  }
  return loops.filter((l) => l.length >= 4);
}

// Drop the middle point of any three that are collinear — a 40ft wall should
// be one segment, not ten.
function simplifyLoop(pts) {
  const uniq = [];
  for (const p of pts) {
    const last = uniq[uniq.length - 1];
    if (!last || last.c !== p.c || last.r !== p.r) uniq.push(p);
  }
  if (uniq.length > 1) {
    const a = uniq[0], b = uniq[uniq.length - 1];
    if (a.c === b.c && a.r === b.r) uniq.pop();
  }
  const out = [];
  const n = uniq.length;
  for (let i = 0; i < n; i++) {
    const prev = uniq[(i - 1 + n) % n], cur = uniq[i], next = uniq[(i + 1) % n];
    const cross = (cur.c - prev.c) * (next.r - cur.r) - (cur.r - prev.r) * (next.c - cur.c);
    if (cross !== 0) out.push(cur);
  }
  return out.length >= 3 ? out : uniq;
}

// ---------- 3. rectangles ----------

// The largest all-covered rectangle in a mask, by the usual maximal-rectangle-
// in-a-histogram sweep: one row at a time, heights accumulated, a monotonic
// stack finding the widest bar span each height can claim.
export function largestRect(on, w, h) {
  const heights = new Int32Array(w);
  let best = null;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) heights[c] = on[r * w + c] ? heights[c] + 1 : 0;
    const stack = [];
    for (let c = 0; c <= w; c++) {
      const cur = c < w ? heights[c] : 0;
      while (stack.length && heights[stack[stack.length - 1]] >= cur) {
        const top = stack.pop();
        const height = heights[top];
        const left = stack.length ? stack[stack.length - 1] + 1 : 0;
        const area = height * (c - left);
        if (height > 0 && (!best || area > best.area)) {
          best = { area, c0: left, c1: c, r0: r - height + 1, r1: r + 1 };
        }
      }
      stack.push(c);
    }
  }
  return best;
}

// The mask cut into rectangles, biggest first, each one taken out before the
// next is looked for. Greedy rather than optimal — the optimal decomposition
// of a rectilinear polygon is a matching problem, and for a building footprint
// greedy gives the same answer nine times in ten and a defensible one the
// tenth.
export function maskRects(m, maxRects = 24) {
  const on = Uint8Array.from(m.on);
  const out = [];
  for (let i = 0; i < maxRects; i++) {
    const rect = largestRect(on, m.w, m.h);
    if (!rect || rect.area <= 0) break;
    for (let r = rect.r0; r < rect.r1; r++) {
      for (let c = rect.c0; c < rect.c1; c++) on[r * m.w + c] = 0;
    }
    out.push({
      c0: rect.c0, r0: rect.r0, c1: rect.c1, r1: rect.r1,
      x0: (m.cx0 + rect.c0) * CELL, z0: (m.cy0 + rect.r0) * CELL,
      x1: (m.cx0 + rect.c1) * CELL, z1: (m.cy0 + rect.r1) * CELL,
    });
  }
  return out;
}

// Is the whole of one side of this rectangle on the outside of the mask? Only
// then does it get an eave — an overhang into the middle of the same building
// would hang inside the roof next door.
export function sideIsOuter(m, rect, side) {
  if (side === 'n') {
    for (let c = rect.c0; c < rect.c1; c++) if (maskAt(m, c, rect.r0 - 1)) return false;
  } else if (side === 's') {
    for (let c = rect.c0; c < rect.c1; c++) if (maskAt(m, c, rect.r1)) return false;
  } else if (side === 'w') {
    for (let r = rect.r0; r < rect.r1; r++) if (maskAt(m, rect.c0 - 1, r)) return false;
  } else {
    for (let r = rect.r0; r < rect.r1; r++) if (maskAt(m, rect.c1, r)) return false;
  }
  return true;
}

// ---------- 4. the plan ----------

// One rectangular mass's roof: two slopes and either two hips or two gable
// walls, at a stated pitch, over a rectangle already expanded by its eaves.
// The ridge always runs along the longer side, which is what makes a wing look
// like a wing.
export function blockRoof(x0, z0, x1, z1, eaveY, pitch, style) {
  const w = x1 - x0, d = z1 - z0;
  const alongX = w >= d;
  const shortSpan = alongX ? d : w;
  const rise = (clamp(pitch, MIN_PITCH, MAX_PITCH) / 12) * (shortSpan / 2);
  const topY = eaveY + rise;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const faces = [];
  const gables = [];
  // A hip pulls the ridge in by half the short span at each end; a gable runs
  // it to the wall and closes the ends with masonry.
  const inset = style === 'hip' ? shortSpan / 2 : 0;
  const P = (x, y, z) => ({ x, y, z });

  let ridge;
  if (alongX) {
    const ra = Math.min(cx, x0 + inset), rb = Math.max(cx, x1 - inset);
    ridge = { a: P(ra, topY, cz), b: P(rb, topY, cz) };
    faces.push({ kind: 'slope', pts: [P(x0, eaveY, z0), P(x1, eaveY, z0), P(rb, topY, cz), P(ra, topY, cz)] });
    faces.push({ kind: 'slope', pts: [P(x1, eaveY, z1), P(x0, eaveY, z1), P(ra, topY, cz), P(rb, topY, cz)] });
    if (style === 'hip') {
      faces.push({ kind: 'slope', pts: [P(x0, eaveY, z1), P(x0, eaveY, z0), P(ra, topY, cz)] });
      faces.push({ kind: 'slope', pts: [P(x1, eaveY, z0), P(x1, eaveY, z1), P(rb, topY, cz)] });
    } else {
      gables.push({ kind: 'gable', pts: [P(x0, eaveY, z0), P(x0, eaveY, z1), P(x0, topY, cz)] });
      gables.push({ kind: 'gable', pts: [P(x1, eaveY, z1), P(x1, eaveY, z0), P(x1, topY, cz)] });
    }
  } else {
    const ra = Math.min(cz, z0 + inset), rb = Math.max(cz, z1 - inset);
    ridge = { a: P(cx, topY, ra), b: P(cx, topY, rb) };
    faces.push({ kind: 'slope', pts: [P(x0, eaveY, z1), P(x0, eaveY, z0), P(cx, topY, ra), P(cx, topY, rb)] });
    faces.push({ kind: 'slope', pts: [P(x1, eaveY, z0), P(x1, eaveY, z1), P(cx, topY, rb), P(cx, topY, ra)] });
    if (style === 'hip') {
      faces.push({ kind: 'slope', pts: [P(x0, eaveY, z0), P(x1, eaveY, z0), P(cx, topY, ra)] });
      faces.push({ kind: 'slope', pts: [P(x1, eaveY, z1), P(x0, eaveY, z1), P(cx, topY, rb)] });
    } else {
      gables.push({ kind: 'gable', pts: [P(x1, eaveY, z0), P(x0, eaveY, z0), P(cx, topY, ra)] });
      gables.push({ kind: 'gable', pts: [P(x0, eaveY, z1), P(x1, eaveY, z1), P(cx, topY, rb)] });
    }
  }
  return { faces, gables, ridge, rise, topY, alongX };
}

// Everything above the top storey's walls, ready to be extruded. `outlines`
// carries the parapet (and the fascia line a site plan draws); `blocks` carry
// the pitched masses; `rise` is how far the tallest of them stands above the
// eaves, which is what the sun's shadow frustum and the edit camera need.
export function roofPlan(state, roof = null) {
  const r = normalizeRoof(roof || state.roof);
  const top = (state.floors || []).length - 1;
  const floor = (state.floors || [])[top];
  const eaveY = floorBaseY(state, top) + WALL_H;
  const plan = {
    style: r.style, pitch: r.pitch, facade: r.facade,
    eaveY, outlines: [], deckRects: [], blocks: [], rise: 0,
    parapetH: r.style === 'parapet' ? PARAPET_H : 0,
  };
  // A flat roof is what every earlier version drew: the wall top, and nothing
  // above it. It stays a style rather than a gap so a design can ask for it.
  if (!floor || r.style === 'flat') return plan;
  const mask = roofMask(floor, state.w, state.h);
  if (!maskCount(mask)) return plan;
  plan.outlines = maskOutlines(mask);
  // The deck. A flat roof needs one because there is nothing else up there,
  // and a pitched roof needs one too: two masses of different width meet at a
  // valley, and without a deck under them that valley is a hole you can see
  // the classrooms through.
  const rects = maskRects(mask);
  plan.deckRects = rects;

  if (r.style === 'parapet') {
    plan.rise = PARAPET_H + COPING_T;
    return plan;
  }

  for (const rect of rects) {
    // An eave only hangs where the building actually ends.
    const x0 = rect.x0 - (sideIsOuter(mask, rect, 'w') ? EAVE : 0);
    const x1 = rect.x1 + (sideIsOuter(mask, rect, 'e') ? EAVE : 0);
    const z0 = rect.z0 - (sideIsOuter(mask, rect, 'n') ? EAVE : 0);
    const z1 = rect.z1 + (sideIsOuter(mask, rect, 's') ? EAVE : 0);
    const block = blockRoof(x0, z0, x1, z1, eaveY, r.pitch, r.style);
    plan.blocks.push({ ...block, rect });
    plan.rise = Math.max(plan.rise, block.rise);
  }
  return plan;
}

// The world height of the highest thing on the building, for the sun's shadow
// frustum and the edit camera's standoff.
export const roofTop = (plan) => plan.eaveY + plan.rise;
