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
import { shapesOf, shapeBBox, pointInShape, pointInRing } from './shapes.js';
import { eavePolygon, cleanPolygon, skeletonRoof, triangulate, offsetRing } from './skeleton.js';

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
  let rects = maskRects(mask);
  plan.deckRects = rects;

  if (r.style === 'parapet') {
    plan.rise = PARAPET_H + COPING_T;
    // Over a curve the parapet stands on the rooms' own chords and not on the
    // mask's 4ft steps, and the deck under it is the outline itself (#973).
    const chords = parapetOnChords(mask, plan.outlines, rects, curvedLoopsOf(floor));
    if (chords) Object.assign(plan, chords);
    return plan;
  }

  // A hipped roof over a curve stands on the straight skeleton of the rooms'
  // own outline, carried out to the eave (#967). Only there: every loop
  // without a curve in it, every gable (over a curve that is a weighted
  // skeleton) and every footprint the outline or the eave refuses keeps the
  // rectangles below, unchanged. The rectangles a curved loop takes over are
  // the ones whose first cell lies in it, which is the test the mask itself
  // used to put that cell on, and its deck goes with them: nothing under a
  // skeleton roof is open to the sky, and a 4ft deck cell would stand out
  // past a curved eave.
  const curved = skeletonRoofsOf(state, r);
  if (curved.length) {
    const firstCellIn = (rect) => curved.some((c) => inFootprint(c, rect.x0 + CELL / 2, rect.z0 + CELL / 2));
    rects = rects.filter((rect) => !firstCellIn(rect));
    plan.deckRects = rects;
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
  for (const c of curved) {
    plan.blocks.push(c);
    plan.rise = Math.max(plan.rise, c.rise);
  }
  return plan;
}

// The skeleton roofs of a storey's curved loops, one block each in the shape
// `blockRoof` gives (faces, gables, rise, topY) plus `skeleton: true`, the
// loop as `outline`, the eave line as `eave` and each face's triangles as
// `tris`; `rect` and `alongX` are null, since there is no rectangle. A loop
// the eave or the skeleton refuses is left out, so its rectangles stay.
//
// A footprint with a court (#999) stands on the outer eave with each court's
// eave, 1.5ft into the court, as a hole of the skeleton, so the slopes round
// the court rise from that eave as the outer ones rise from theirs; the block
// carries the court rings as `holes` and their eaves as `eaveHoles`. A court
// too narrow for its eave keeps the building on its rectangles
// (DESIGN-roof-holes.md question 3's default). A footprint with no court is
// the block it always was, key for key.
export function curvedRoofs(floor, eaveY, pitch) {
  const out = [];
  for (const { outer: loop, holes, pinch } of curvedLoopsOf(floor)) {
    const pinched = pinch ? pinchEave(loop, EAVE) : null;
    const eave = pinch ? pinched && pinched.eave : eaveLine(loop, EAVE);
    if (!eave) continue;
    if (holes.length || pinch) {
      const courts = holes.length ? courtEaves(holes, EAVE) : [];
      const eaveHoles = courts && [...courts, ...(pinched ? pinched.courts : [])];
      const roof = eaveHoles && skeletonRoof(eave, eaveY, pitch, { holes: eaveHoles });
      if (!roof) continue;
      const faces = roof.faces.map((f) => ({ ...f, tris: triangulate(f.pts) }));
      out.push({ ...roof, faces, skeleton: true, outline: loop, holes, eave, eaveHoles, rect: null, alongX: null });
      continue;
    }
    const roof = skeletonRoof(eave, eaveY, pitch);
    if (!roof) continue;
    const faces = roof.faces.map((f) => ({ ...f, tris: triangulate(f.pts) }));
    out.push({ ...roof, faces, skeleton: true, outline: loop, eave, rect: null, alongX: null });
  }
  return out;
}

// Each court's eave line, `d` feet into the court: the court ring's own
// wavefront stopped at `d` (`offsetRing`, #997), so a court the eave pinches
// in two gives both pieces. Null where any court has no eave left (narrower
// than 2d) or is refused, which keeps the building on its rectangles
// (DESIGN-roof-holes.md question 3's default: nothing drawn that was not).
function courtEaves(holes, d) {
  const out = [];
  for (const h of holes) {
    const loops = offsetRing(h, d);
    if (!loops || !loops.length) return null;
    out.push(...loops);
  }
  return out;
}

// The eave line over a loop, `d` feet out. Where the mitred eave stands it is
// that, corner for corner. Where it crosses itself because a curve bowed into
// the building is tighter than the overhang (#993), the chords are carried out
// the way the skeleton's own wavefront runs backwards: to the moment the first
// of them closes up, which is gone from there on, its neighbours meeting, and
// on to `d`. So a dent the overhang covers is covered (a V or a notch that
// narrows inward closes the same way), and the roof stands on the eave line
// as it is. Every step goes through `cleanPolygon`, which refuses a line that
// crosses itself, so a line that is returned holds every wall corner.
//
// Two sides meeting head on (a square notch, a slot, a dovetail) is a split,
// which neither of those answers takes. Only where both refuse, the third is
// the loop's own wavefront run outward to `d` (`offsetRing`, #997): the two
// sides walk towards each other, meet at half the notch's width, and the line
// runs straight past where the notch was (DESIGN-roof-holes.md 2.2, #1000).
// One loop back is the eave; none, or two pieces, is still null. So every
// loop that had an eave has the same eave.
function eaveLine(loop, d) {
  const mitred = eavePolygon(loop, d);
  if (mitred) return mitred;
  const stepped = steppedEave(loop, d);
  if (stepped) return stepped;
  const loops = offsetRing(loop, -d);
  return loops && loops.length === 1 ? cleanPolygon(loops[0]) : null;
}

// The eave of a loop through a corner twice (#1001), `d` feet out: the loop's
// own wavefront run outward through the frame, as `eaveLine`'s third answer
// is, with the corner let by (`pinch`). The two visits to the corner each
// pair their own walls, and run out they come apart, so what comes back is
// the eave round the outside and the court's own eave `d` into the court, not
// touching: on the L of DESIGN-roof-holes.md 2.3 the outer eave's corner is
// (21.5, 21.5) and the court's (18.5, 18.5), 4.24ft apart, which is the eave
// a court with no pinch would have. `{ eave, courts }`, the courts wound
// counter-clockwise as `courtEaves` gives them; null unless exactly one loop
// runs round the outside and one court comes back for each corner visited
// twice (a court the eave pinches in two, or a bottle notch's pocket, keeps
// the rectangles, as #1000 keeps it with no pinch).
function pinchEave(loop, d) {
  const loops = offsetRing(loop, -d, { pinch: true });
  if (!loops) return null;
  const outer = loops.filter((l) => loopArea(l) > 0);
  const inner = loops.filter((l) => loopArea(l) < 0);
  const seen = new Set(), twice = new Set();
  for (const p of loop) (seen.has(okey(p)) ? twice : seen).add(okey(p));
  // Run outward, nothing splits the loop round the outside (a pocket closes
  // off inside it), so `outer` is never two; the test is the statement.
  if (outer.length !== 1 || inner.length !== twice.size) return null;
  const eave = cleanPolygon(outer[0]);
  const courts = inner.map((l) => cleanPolygon(l));
  return eave && courts.every(Boolean) ? { eave, courts } : null;
}

// `eaveLine`'s second answer (#993).
function steppedEave(loop, d) {
  let cur = cleanPolygon(loop), left = d;
  for (let step = 0; cur && step < loop.length; step++) {
    const n = cur.length;
    const normal = (i) => {
      const a = cur[i], b = cur[(i + 1) % n];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      return { x: (b.z - a.z) / L, z: -(b.x - a.x) / L };
    };
    // Each corner's mitred speed, as `eavePolygon` moves it, and the moment
    // each edge's length runs out between its two corners.
    const speed = cur.map((_, i) => {
      const n1 = normal((i - 1 + n) % n), n2 = normal(i);
      const k = 1 + n1.x * n2.x + n1.z * n2.z;
      return { x: (n1.x + n2.x) / k, z: (n1.z + n2.z) / k };
    });
    let first = Infinity;
    for (let i = 0; i < n; i++) {
      const a = cur[i], b = cur[(i + 1) % n], j = (i + 1) % n;
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      const s = ((speed[j].x - speed[i].x) * (b.x - a.x) + (speed[j].z - speed[i].z) * (b.z - a.z)) / L;
      if (s < 0) first = Math.min(first, -L / s);
    }
    // Nothing closing before `d` means the mitred line failed on a split;
    // `cleanPolygon` would refuse the step below for the same reason, so this
    // only says it sooner.
    if (!(first < left)) return null;
    // Out to that moment; the closed edges come back as repeated corners,
    // which `cleanPolygon` drops, and a pair of sides that now run on one
    // line joins. Sides meeting head on leave a spike, which it refuses.
    cur = cleanPolygon(cur.map((p, i) => ({ x: p.x + speed[i].x * first, z: p.z + speed[i].z * first })));
    left -= first;
    const eave = cur && eavePolygon(cur, left);
    if (eave) return eave;
  }
  return null;
}

// The footprints of a storey's true outline with a curve in them, as
// `{ outer, holes, pinch }`: the buildings `roofOutline` accepts, one by one
// (#971), read by `hasCurve` (#967) on every ring, a court's included (#998,
// DESIGN-roof-holes.md question 2's default). The one test of which footprint
// a roof follows off its chords rather than the mask, for the hipped roof's
// skeleton and the parapet's run alike. `pinch` is false until a loop through
// a corner twice is accepted.
export function curvedLoopsOf(floor) {
  const o = roofOutline(floor);
  return (o.loops || []).map((outer, i) => ({ outer, holes: o.holes[i], pinch: o.pinch[i] }))
    .filter((f) => [f.outer, ...f.holes].some(hasCurve));
}

// Whether (x, z) lies on a footprint: in `block.outline` and in none of
// `block.holes` (#998). A block with no `holes` is its outline alone.
export function inFootprint(block, x, z) {
  return pointInRing(block.outline, x, z) && !(block.holes || []).some((h) => pointInRing(h, x, z));
}

// A parapet over a curve (#973). Each of the mask's loops is matched to the
// curved loop holding the middle of every cell along its edges; a curved loop
// whose cells are all in loops of its own takes their place, its chords as
// the parapet and itself, ear-clipped, as the deck, and the deck rectangles
// whose first cell lies in it go. `null` where nothing changes, so every
// other roof is the plan it always was, key for key.
//
// Two buildings whose walls do not meet can still have mask cells side by
// side, and share a mask loop (#988). The curved one is taken there too; the
// rest of the shared loop is outlined again from its own cells, and a deck
// rectangle laid across both keeps its cells outside the curve, cut again
// into rectangles. Where a cell of the other building reaches inside the
// chords, that building gives way (#990, Devon): its loop is cut back to the
// chords, so its parapet runs along them where it was cut, and each cell the
// curve takes a bite of leaves the deck as a rectangle and comes back as what
// is left of it (`deckPolys` entries marked `trim`). Where the cut cannot be
// vouched for (`ringMinus` says null) the pair stays on its steps, as before.
function parapetOnChords(mask, outlines, rects, curved) {
  if (!curved.length) return null;
  const owner = (x, z) => curved.findIndex((f) => inFootprint({ outline: f.outer, holes: f.holes }, x, z));
  const owners = outlines.map((loop) => {
    const seen = new Set();
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], b = loop[(i + 1) % loop.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
      // The covered side is on the right of every edge (`maskOutlines`).
      for (let t = CELL / 2; t < len; t += CELL) {
        seen.add(owner(a.x + dx * t - dz * CELL / 2, a.z + dz * t + dx * CELL / 2));
      }
    }
    return seen;
  });
  const taken = new Map(), reach = new Set();
  curved.forEach(({ outer: loop, holes }, k) => {
    const mine = owners.filter((o) => o.has(k));
    if (!mine.length) return;
    // A court is a hole of the deck (#998); no court is the shipped call.
    const tris = triangulate(loop, holes);
    if (!tris) return;
    if (mine.some((o) => o.size > 1) && cellReachesInto(mask, loop)) reach.add(k);
    taken.set(k, { pts: loop, holes, tris });
  });
  if (!taken.size) return null;
  const plan = chordPlan(mask, outlines, rects, owners, taken, reach);
  if (plan || !reach.size) return plan;
  for (const k of reach) taken.delete(k);
  return taken.size ? chordPlan(mask, outlines, rects, owners, taken, new Set()) : null;
}

// `parapetOnChords`' plan for the curved loops it took; `reach` names the ones
// another building's cells reach inside, which that building gives way to.
// `null` where a cut cannot be made.
function chordPlan(mask, outlines, rects, owners, taken, reach) {
  const polys = [...taken.values()];
  const inTaken = (x, z) => polys.some((d) => inFootprint({ outline: d.pts, holes: d.holes }, x, z));
  // Each taken footprint's parapet: its outer ring and every court's (#998),
  // which `roofOutline` winds as `maskOutlines` winds a hole loop, covered
  // side on the right. A neighbour is cut against the outer ring only: it
  // cannot reach into a court without crossing the curved building's walls.
  const parapets = polys.flatMap((d) => [d.pts, ...d.holes]);
  const kept = outlines.filter((_, i) => ![...owners[i]].some((k) => taken.has(k)));
  const shared = owners.some((o) => o.size > 1 && [...o].some((k) => taken.has(k)));
  if (!shared) {
    const firstCellIn = (rect) => inTaken(rect.x0 + CELL / 2, rect.z0 + CELL / 2);
    return {
      outlines: [...kept, ...parapets],
      deckRects: rects.filter((rect) => !firstCellIn(rect)),
      deckPolys: polys,
    };
  }
  const centreIn = (c, r) => inTaken((mask.cx0 + c + 0.5) * CELL, (mask.cy0 + r + 0.5) * CELL);
  const rest = { ...mask, on: mask.on.map((v, i) => (v && !centreIn(i % mask.w, Math.floor(i / mask.w)) ? 1 : 0)) };
  const keys = new Set(kept.map((l) => JSON.stringify(l)));
  const split = maskOutlines(rest).filter((l) => !keys.has(JSON.stringify(l)));
  // The cells the curve takes a bite of: covered, their middle outside it,
  // some of their area inside (#990). None where nothing reaches inside.
  const cuts = [...reach].map((k) => taken.get(k).pts);
  const bitten = new Set();
  for (const loop of cuts) for (const i of cellsReachingInto(rest, loop)) bitten.add(i);
  const pieceOf = (i) => {
    const sx = (mask.cx0 + (i % mask.w)) * CELL, sz = (mask.cy0 + Math.floor(i / mask.w)) * CELL;
    return cuts.reduce((left, loop) => left && left.flatMap((l) => ringMinus(l, loop) || [null]),
      [[{ x: sx, z: sz }, { x: sx + CELL, z: sz }, { x: sx + CELL, z: sz + CELL }, { x: sx, z: sz + CELL }]]);
  };
  const deckRects = rects.flatMap((rect) => {
    let inside = 0, bit = 0;
    for (let r = rect.r0; r < rect.r1; r++) {
      for (let c = rect.c0; c < rect.c1; c++) {
        if (centreIn(c, r)) inside++;
        else if (bitten.has(r * mask.w + c)) bit++;
      }
    }
    if (!inside && !bit) return [rect];
    if (inside + bit === (rect.r1 - rect.r0) * (rect.c1 - rect.c0)) return [];
    const part = { ...rest, on: rest.on.map((v, i) => {
      const c = i % mask.w, r = Math.floor(i / mask.w);
      return v && !bitten.has(i) && c >= rect.c0 && c < rect.c1 && r >= rect.r0 && r < rect.r1 ? 1 : 0;
    }) };
    return maskRects(part);
  });
  if (!bitten.size) {
    return { outlines: [...kept, ...split, ...parapets], deckRects, deckPolys: polys };
  }
  // The other building's loops, cut back to the chords: its parapet.
  const cutLoops = [];
  for (const loop of [...kept, ...split]) {
    let left = [loop];
    for (const c of cuts) {
      left = left.flatMap((l) => ringMinus(l, c) || [null]);
      if (left.includes(null)) return null;
    }
    cutLoops.push(...left);
  }
  // Its deck: each bitten cell, less the curve, in its own triangles.
  const pieces = [];
  for (const i of [...bitten].sort((a, b) => a - b)) {
    const left = pieceOf(i);
    if (left.includes(null)) return null;
    for (const pts of left) {
      const tris = triangulate(pts);
      if (!tris) return null;
      pieces.push({ pts, holes: [], tris, trim: true });
    }
  }
  // Along the cut the box's loop and the curve's stand on one line. The run is
  // the curve's, drawn whole, and the cut loop's edges along its chords are
  // left out (#992): every such edge is a piece of one chord, so nothing of
  // the cut loop's own parapet goes with them.
  const onChord = (p, q) => cuts.some((loop) => loop.some((a, i) => {
    const b = loop[(i + 1) % loop.length];
    const ux = b.x - a.x, uz = b.z - a.z, L2 = ux * ux + uz * uz;
    return [p, q].every((m) => {
      const t = ((m.x - a.x) * ux + (m.z - a.z) * uz) / L2;
      return t > -1e-9 && t < 1 + 1e-9 && Math.abs((m.x - a.x) * uz - (m.z - a.z) * ux) <= 1e-9 * Math.sqrt(L2);
    });
  }));
  const parapetSkip = [];
  cutLoops.forEach((loop, i) => loop.forEach((a, j) => {
    if (onChord(a, loop[(j + 1) % loop.length])) parapetSkip.push([i, j]);
  }));
  return { outlines: [...cutLoops, ...parapets], deckRects, deckPolys: [...polys, ...pieces], parapetSkip };
}

// The parapet as the renderer draws it: one `[from, to]` run per edge of every
// outline, less the edges `parapetSkip` names (#992), which only a plan cut
// back to a curve's chords carries.
export function parapetRuns(plan) {
  const skip = new Set((plan.parapetSkip || []).map(([i, j]) => `${i}:${j}`));
  const runs = [];
  plan.outlines.forEach((loop, i) => loop.forEach((a, j) => {
    if (!skip.has(`${i}:${j}`)) runs.push([a, loop[(j + 1) % loop.length]]);
  }));
  return runs;
}

// Does a covered cell whose middle lies outside `loop` lie partly inside it?
function cellReachesInto(mask, loop) {
  return cellsReachingInto(mask, loop, true).length > 0;
}

// The covered cells (indices into `mask.on`) whose middle lies outside `loop`
// and some of whose area lies inside it: the area of the loop clipped to the
// cell's square (Sutherland-Hodgman, which gives the right area for a loop
// that is not convex). `first` stops at the first one.
function cellsReachingInto(mask, loop, first = false) {
  const out = [];
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of loop) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
  const c0 = Math.max(0, Math.floor(x0 / CELL) - mask.cx0), c1 = Math.min(mask.w, Math.ceil(x1 / CELL) - mask.cx0);
  const r0 = Math.max(0, Math.floor(z0 / CELL) - mask.cy0), r1 = Math.min(mask.h, Math.ceil(z1 / CELL) - mask.cy0);
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      if (!mask.on[r * mask.w + c]) continue;
      const sx = (mask.cx0 + c) * CELL, sz = (mask.cy0 + r) * CELL;
      if (pointInRing(loop, sx + CELL / 2, sz + CELL / 2)) continue;
      let pts = loop;
      for (const [axis, at, keep] of [['x', sx, 1], ['x', sx + CELL, -1], ['z', sz, 1], ['z', sz + CELL, -1]]) {
        const next = [];
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          const ia = (a[axis] - at) * keep >= 0, ib = (b[axis] - at) * keep >= 0;
          if (ia) next.push(a);
          if (ia !== ib) {
            const t = (at - a[axis]) / (b[axis] - a[axis]);
            next.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
          }
        }
        pts = next;
        if (!pts.length) break;
      }
      if (pts.length >= 3 && Math.abs(loopArea(pts)) > 1e-6) {
        out.push(r * mask.w + c);
        if (first) return out;
      }
    }
  }
  return out;
}

// What is left of ring `a` once ring `b` is taken out of it (#990): a list of
// loops, each wound as `a` is, or `null` where the bookkeeping cannot vouch
// for the answer, and the caller then leaves things as they were. Both edges
// lists are split where they cross; `a`'s pieces outside `b` and `b`'s pieces
// inside `a`, reversed, chain end to start into the loops. Refused: an edge
// of one lying along the other or ending on it, `b` wholly inside `a` (a hole
// is not a loop), and `a` a hole loop of the mask that `b` crosses.
function ringMinus(a, b) {
  const E = 1e-9;
  const cutsA = a.map(() => []), cutsB = b.map(() => []);
  for (let i = 0; i < a.length; i++) {
    const p = a[i], q = a[(i + 1) % a.length];
    const ux = q.x - p.x, uz = q.z - p.z;
    for (let j = 0; j < b.length; j++) {
      const r = b[j], s = b[(j + 1) % b.length];
      const vx = s.x - r.x, vz = s.z - r.z;
      const wx = r.x - p.x, wz = r.z - p.z;
      const d = ux * vz - uz * vx;
      const scale = Math.hypot(ux, uz) * Math.hypot(vx, vz);
      if (Math.abs(d) <= 1e-12 * scale) {
        // Parallel: refused if they lie on one line and meet.
        if (Math.abs(wx * uz - wz * ux) > 1e-9 * Math.hypot(ux, uz)) continue;
        const len2 = ux * ux + uz * uz;
        const t0 = (wx * ux + wz * uz) / len2, t1 = ((s.x - p.x) * ux + (s.z - p.z) * uz) / len2;
        if (Math.max(t0, t1) >= -E && Math.min(t0, t1) <= 1 + E) return null;
        continue;
      }
      const t = (wx * vz - wz * vx) / d, u = (wx * uz - wz * ux) / d;
      if (t < -E || t > 1 + E || u < -E || u > 1 + E) continue;
      if (t < E || t > 1 - E || u < E || u > 1 - E) return null;
      const pt = { x: p.x + ux * t, z: p.z + uz * t };
      cutsA[i].push({ t, pt });
      cutsB[j].push({ t: u, pt });
    }
  }
  if (!cutsA.some((c) => c.length)) {
    if (pointInRing(b, a[0].x, a[0].z)) return [];
    if (pointInRing(a, b[0].x, b[0].z)) return null;
    return [a];
  }
  if (loopArea(a) < 0) return null;
  const forward = loopArea(b) > 0;
  const pieces = new Map();
  const put = (from, to) => {
    const k = okey(from);
    if (pieces.has(k)) return false;
    pieces.set(k, { from, to });
    return true;
  };
  const runs = (ring, cuts, i) => {
    const pts = [ring[i], ...cuts[i].sort((m, n) => m.t - n.t).map((c) => c.pt), ring[(i + 1) % ring.length]];
    return pts.slice(1).map((to, k) => [pts[k], to]);
  };
  for (let i = 0; i < a.length; i++) {
    for (const [from, to] of runs(a, cutsA, i)) {
      if (pointInRing(b, (from.x + to.x) / 2, (from.z + to.z) / 2)) continue;
      if (!put(from, to)) return null;
    }
  }
  for (let j = 0; j < b.length; j++) {
    for (const [from, to] of runs(b, cutsB, j)) {
      if (!pointInRing(a, (from.x + to.x) / 2, (from.z + to.z) / 2)) continue;
      // `b`'s boundary inside `a` runs against `b`'s own winding.
      if (!(forward ? put(to, from) : put(from, to))) return null;
    }
  }
  const loops = [];
  while (pieces.size) {
    const [startKey, first] = pieces.entries().next().value;
    const pts = [];
    let cur = first, key = startKey;
    while (cur) {
      pieces.delete(key);
      pts.push(cur.from);
      key = okey(cur.to);
      if (key === startKey) break;
      cur = pieces.get(key);
      if (!cur) return null;
    }
    if (pts.length < 3 || Math.abs(loopArea(pts)) < 1e-9) return null;
    loops.push(pts);
  }
  return loops;
}

// The skeleton roofs a design's top storey stands under: the hipped style
// over a loop the outline, the eave and the skeleton all accept, and nothing
// for every other roof. This is the one test of which footprint takes the
// skeleton path; `roofPlan`, the takeoff and the estimate all ask it.
export function skeletonRoofsOf(state, roof = null) {
  const r = normalizeRoof(roof || state.roof);
  const top = (state.floors || []).length - 1;
  const floor = (state.floors || [])[top];
  if (!floor || r.style !== 'hip') return [];
  return curvedRoofs(floor, floorBaseY(state, top) + WALL_H, r.pitch);
}

// The roof's quantity for the takeoff and the estimate: `footprint`, the plan
// area it covers inside the walls (the mask's cells, never the eave), and
// `area`, that footprint sloped at the pitch. Where a loop takes the skeleton
// path its cells give way to the loop's own area off its chords, so a curve
// is counted as drawn and not as a staircase of 4ft cells. Every face of a
// skeleton roof stands at the one pitch, so its sloped area over that outline
// is still the plan area over the cosine. A parapet roof whose parapet runs on
// the chords (`roofPlan`'s `deckPolys`, #973's one test) is counted off that
// same outline, flat (#986), and so is a neighbour cut back to those chords,
// off its whole cells and what is left of each cut one (#990): the deck as
// drawn. Every other footprint is the mask's count, by the same lines the
// takeoff and the estimate each had before (#970).
export function roofCover(state) {
  const top = state.floors.length - 1;
  const floor = state.floors[top];
  if (!floor) return null;
  const roof = normalizeRoof(state.roof || ensureRoof(state));
  const entry = roofStyleEntry(roof.style);
  const mask = roofMask(floor, floor.w, floor.h);
  let footprint = maskCount(mask) * CELL * CELL;
  const slope = entry.pitched ? Math.hypot(12, roof.pitch) / 12 : 1;
  const curved = skeletonRoofsOf(state, roof);
  // Only a parapet plan has `deckPolys`; the style test saves building the
  // plan for every other roof and changes no figure.
  const chords = roof.style === 'parapet' ? (roofPlan(state, roof).deckPolys || []) : [];
  // A footprint with a court is its outline less the court (#998).
  const loops = [...curved.map((k) => ({ outline: k.outline, holes: k.holes || [] })),
    ...chords.map((d) => ({ outline: d.pts, holes: d.holes || [] }))];
  if (loops.length) {
    let cells = 0;
    for (let r = 0; r < mask.h; r++) {
      for (let c = 0; c < mask.w; c++) {
        if (!mask.on[r * mask.w + c]) continue;
        const x = (mask.cx0 + c + 0.5) * CELL, z = (mask.cy0 + r + 0.5) * CELL;
        if (loops.some((f) => inFootprint(f, x, z))) cells++;
      }
    }
    footprint -= cells * CELL * CELL;
    for (const f of loops) footprint += loopArea(f.outline) - f.holes.reduce((a, h) => a + Math.abs(loopArea(h)), 0);
  }
  return { roof, entry, footprint, area: footprint * slope, skeleton: curved.length, chords: chords.filter((d) => !d.trim).length };
}

// ---------- 5. the true outline, for a roof over a curve ----------
//
// The mask above is the roof's resolution for every rectilinear school, and a
// curve reaches it as a staircase of 4ft cells. A hipped roof over a curve is
// stood on the rooms' own chords instead (#965, #967), so it needs the top
// storey's footprint as polygons: the union of the rooms' outer rings. Rooms
// share walls exactly, so the union is bookkeeping rather than clipping: every
// ring wound the same way, each edge split wherever another ring's corner lies
// on it, every edge that has its own reverse somewhere (a shared wall) taken
// out with it, and what is left chained into loops. Anything that bookkeeping
// cannot vouch for is refused with a sentence, and a refused footprint keeps
// its rectangles:
//   * two rooms laying the same wall the same way (they overlap),
//   * two rooms whose walls cross, or one room inside another,
//   * rooms wrapped round a courtyard that meets the outside at one corner.
// Two rooms meeting at a corner are not refused: the outline is split at
// that corner into a loop each (#976). A court is not refused either (#998):
// a room's own hole goes into the bookkeeping wound the other way, so the
// room is on the left of every edge of it, and a loop that comes out wound
// the other way, whether a room's hole or the space rooms close round, is a
// hole of the loop that holds it.
// A refusal keeps the rectangles for its own building only (#971): rooms
// whose walls touch or cross, or one of which stands inside another, one to
// the next, are a building (#991), and where the storey as a whole is
// refused each building is judged alone, so a curved building beside a
// courtyard building, or in the notch of one of its rooms, still stands on
// its skeleton.

const OUTLINE_ON = 1e-4;     // ft — a corner this close to a wall lies on it
const okey = (p) => `${Math.round(p.x * 1e4)},${Math.round(p.z * 1e4)}`;
const loopArea = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
};

// `{ loops, holes }` (each loop a list of { x, z }, positive area, no
// repeated point; `holes[i]` the courts inside `loops[i]`, each wound the
// other way, negative area, and empty where there are none), or
// `{ loops: null, refused }` with the reason in words. Where some buildings
// are refused and others are not, `{ loops, holes, refused }`: the loops of
// the buildings that passed, and the first refusal's reason.
export function roofOutline(floor) {
  const shapes = shapesOf(floor);
  const whole = unionOf(shapes);
  if (whole.loops) return whole;
  const groups = buildingsOf(shapes);
  if (groups.length < 2) return whole;
  const loops = [], holes = [], pinch = [];
  let refused = null;
  for (const g of groups) {
    const o = unionOf(g);
    if (o.loops) { loops.push(...o.loops); holes.push(...o.holes); pinch.push(...o.pinch); }
    else refused = refused || o.refused;
  }
  return loops.length ? { loops, holes, pinch, refused } : whole;
}

// The rooms in groups that meet, one to the next: two rooms meet where a wall
// of one comes within OUTLINE_ON of a wall of the other (touching, a corner
// on a wall, crossing) or a corner of one lies inside the other (#991). No
// wall of one group meets, crosses or encloses a wall of another, so each is
// judged alone. By bounds alone (#971), a room standing in the notch of an
// L-shaped room was judged with it.
function buildingsOf(shapes) {
  const boxes = shapes.map((sh) => {
    const b = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
    for (const ring of sh.rings) {
      for (const p of ring.pts) {
        b.x0 = Math.min(b.x0, p.x); b.z0 = Math.min(b.z0, p.z);
        b.x1 = Math.max(b.x1, p.x); b.z1 = Math.max(b.z1, p.z);
      }
    }
    return b;
  });
  const parent = shapes.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.x0 > b.x1 + OUTLINE_ON || b.x0 > a.x1 + OUTLINE_ON ||
          a.z0 > b.z1 + OUTLINE_ON || b.z0 > a.z1 + OUTLINE_ON) continue;
      if (!roomsMeet(shapes[i], shapes[j])) continue;
      parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  shapes.forEach((sh, i) => {
    const k = find(i);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(sh);
  });
  return [...groups.values()];
}

function roomsMeet(p, q) {
  const segs = (sh) => sh.rings.flatMap((r) => r.pts.map((a, i) => [a, r.pts[(i + 1) % r.pts.length]]));
  const sp = segs(p), sq = segs(q);
  for (const [a, b] of sp) for (const [c, d] of sq) if (segGap(a, b, c, d) <= OUTLINE_ON) return true;
  const inside = (u, v) => u.rings.some((r) => pointInRing(r.pts, v.rings[0].pts[0].x, v.rings[0].pts[0].z));
  return inside(p, q) || inside(q, p);
}

// The least distance between segments ab and cd: 0 where they cross, else
// the nearest of each end to the other segment.
function segGap(a, b, c, d) {
  const side = (p, q, r) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const s1 = side(c, d, a), s2 = side(c, d, b), s3 = side(a, b, c), s4 = side(a, b, d);
  if (((s1 > 0 && s2 < 0) || (s1 < 0 && s2 > 0)) && ((s3 > 0 && s4 < 0) || (s3 < 0 && s4 > 0))) return 0;
  const toSeg = (p, u, v) => {
    const dx = v.x - u.x, dz = v.z - u.z, L2 = dx * dx + dz * dz;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((p.x - u.x) * dx + (p.z - u.z) * dz) / L2)) : 0;
    return Math.hypot(p.x - u.x - dx * t, p.z - u.z - dz * t);
  };
  return Math.min(toSeg(a, c, d), toSeg(b, c, d), toSeg(c, a, b), toSeg(d, a, b));
}

function unionOf(shapes) {
  const rings = [];
  for (const shape of shapes) {
    shape.rings.forEach((ring, k) => {
      const pts = ring.pts.map((p) => ({ x: p.x, z: p.z }));
      // The outer ring counter-clockwise, a hole (#998) the other way.
      if ((loopArea(pts) < 0) === (k === 0)) pts.reverse();
      rings.push(pts);
    });
  }
  const corners = rings.flat();
  const edges = new Map();     // 'from|to' -> { from, to }
  const add = (from, to) => {
    const kf = okey(from), kt = okey(to);
    if (kf === kt) return true;
    const back = `${kt}|${kf}`;
    if (edges.has(back)) { edges.delete(back); return true; }
    if (edges.has(`${kf}|${kt}`)) return false;
    edges.set(`${kf}|${kt}`, { from, to, kf, kt });
    return true;
  };
  for (const pts of rings) {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
      if (L2 <= 0) continue;
      const lo = { x: Math.min(a.x, b.x) - OUTLINE_ON, z: Math.min(a.z, b.z) - OUTLINE_ON };
      const hi = { x: Math.max(a.x, b.x) + OUTLINE_ON, z: Math.max(a.z, b.z) + OUTLINE_ON };
      const cuts = [];
      for (const c of corners) {
        if (c.x < lo.x || c.x > hi.x || c.z < lo.z || c.z > hi.z) continue;
        const t = ((c.x - a.x) * dx + (c.z - a.z) * dz) / L2;
        if (t <= 1e-9 || t >= 1 - 1e-9) continue;
        if (Math.abs((c.x - a.x) * dz - (c.z - a.z) * dx) / Math.sqrt(L2) > OUTLINE_ON) continue;
        cuts.push({ t, c });
      }
      cuts.sort((u, v) => u.t - v.t);
      let from = a;
      for (const { c } of cuts) {
        if (!add(from, c)) return { loops: null, refused: 'two rooms overlap' };
        from = c;
      }
      if (!add(from, b)) return { loops: null, refused: 'two rooms overlap' };
    }
  }
  const out = new Map();       // corner -> the edges leaving it
  for (const e of edges.values()) {
    if (!out.has(e.kf)) out.set(e.kf, []);
    out.get(e.kf).push(e);
  }
  // Where the outline touches itself at a corner (two rooms meeting at a
  // point) two edges leave it. Each edge arriving goes on along the one that
  // turns hardest towards the rooms, so the outline splits there into loops
  // that each keep their own rooms (#976). Two arrivals wanting the same edge
  // means two rooms' corners open into each other: they overlap.
  const turnTo = (e, f) => {
    const ax = e.to.x - e.from.x, az = e.to.z - e.from.z, bx = f.to.x - f.from.x, bz = f.to.z - f.from.z;
    return Math.atan2(ax * bz - az * bx, ax * bx + az * bz);
  };
  const next = new Map();
  const taken = new Set();
  for (const e of edges.values()) {
    const leaving = out.get(e.kt);
    if (!leaving) return { loops: null, refused: 'the outline does not close' };
    const f = leaving.reduce((best, g) => (turnTo(e, g) > turnTo(e, best) ? g : best));
    if (taken.has(f)) return { loops: null, refused: 'two rooms overlap' };
    taken.add(f);
    next.set(e, f);
  }
  const loops = [], courts = [], pinched = [];
  const done = new Set();
  for (const first of edges.values()) {
    if (done.has(first)) continue;
    const loop = [];
    const at = new Set();
    let e = first, twice = false;
    do {
      // One loop through a corner twice wraps round a courtyard open to the
      // outside only at that corner. It is kept as one loop, marked `pinch`
      // (#1001), and `cleanPolygon({ pinch })` judges the corner below, a
      // corner three times included.
      if (at.has(e.kf)) twice = true;
      at.add(e.kf);
      done.add(e);
      loop.push({ x: e.from.x, z: e.from.z });
      e = next.get(e);
    } while (e !== first);
    // A wall split where a neighbour's corner met it is one wall again.
    for (let i = 0; loop.length > 3 && i < loop.length;) {
      const p = loop[(i - 1 + loop.length) % loop.length], q = loop[i], r = loop[(i + 1) % loop.length];
      const ax = q.x - p.x, az = q.z - p.z, bx = r.x - q.x, bz = r.z - q.z;
      const cross = ax * bz - az * bx, dot = ax * bx + az * bz;
      if (Math.abs(cross) <= 1e-9 * Math.hypot(ax, az) * Math.hypot(bx, bz) && dot > 0) loop.splice(i, 1);
      else i++;
    }
    const a = loopArea(loop);
    if (a === 0) return { loops: null, refused: 'the outline does not close' };
    // No layout of rooms is known that reaches this refusal: the turn
    // towards the rooms keeps the wedges at a pinch apart. It stands so that
    // nothing `cleanPolygon` would refuse is handed on as a pinch.
    if (twice && !(a > 0 && cleanPolygon(loop, { pinch: true }))) {
      return { loops: null, refused: 'the rooms close round a courtyard' };
    }
    if (a > 0) { loops.push(loop); pinched.push(twice); } else courts.push(loop);
  }
  // Rooms that cross without sharing a corner leave both rings whole, and
  // their areas still add up; their walls cross, or one loop sits in another.
  const segs = [...loops, ...courts].flatMap((l) => l.map((p, i) => [p, l[(i + 1) % l.length]]));
  const side = (p, q, r) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const [a, b] = segs[i], [c, d] = segs[j];
      if (Math.max(a.x, b.x) < Math.min(c.x, d.x) || Math.max(c.x, d.x) < Math.min(a.x, b.x) ||
          Math.max(a.z, b.z) < Math.min(c.z, d.z) || Math.max(c.z, d.z) < Math.min(a.z, b.z)) continue;
      const s1 = side(c, d, a), s2 = side(c, d, b), s3 = side(a, b, c), s4 = side(a, b, d);
      if (((s1 > 1e-9 && s2 < -1e-9) || (s1 < -1e-9 && s2 > 1e-9)) &&
          ((s3 > 1e-9 && s4 < -1e-9) || (s3 < -1e-9 && s4 > 1e-9))) {
        return { loops: null, refused: 'two rooms overlap' };
      }
    }
  }
  // Each court is a hole of the smallest loop holding it (#998); a loop
  // standing in another's footprint, and not in one of its courts, overlaps it.
  const mid = (l) => ({ x: (l[0].x + l[1].x) / 2, z: (l[0].z + l[1].z) / 2 });
  const holes = loops.map(() => []);
  for (const c of courts) {
    const m = mid(c);
    let best = -1;
    loops.forEach((l, i) => {
      if (pointInRing(l, m.x, m.z) && (best < 0 || loopArea(l) < loopArea(loops[best]))) best = i;
    });
    if (best < 0) return { loops: null, refused: 'the rooms close round a courtyard' };
    holes[best].push(c);
  }
  for (const l of loops) {
    const m = mid(l);
    if (loops.some((o, i) => o !== l && inFootprint({ outline: o, holes: holes[i] }, m.x, m.z))) {
      return { loops: null, refused: 'two rooms overlap' };
    }
  }
  return { loops, holes, pinch: pinched };
}

// Whether an outline has a curve in it. A curved wall is stored as its chords
// (shapes.js tessellates an arc when it is drawn, in equal steps of angle, three
// at least), and nothing records that they were ever a curve; so a curve is
// read off its chords: three in a row of one length, turning the same way by
// one angle, under 85 degrees a turn (#967). A diagonal wall, a chamfer, a
// wing set at an angle, a rotated square and an octagon's alternate sides are
// straight walls and keep their rectangles. Read as a curve as well, and
// meant to be: a regular polygon of five sides or more, which is a curve
// drawn by hand. An arc of two chords (only a `steps` of 2 asked for in code
// lays one down) has one turn of its own, so it is read by its ends instead
// (#976): two chords of one length turning under 85 degrees, where the turn
// at each end plus half the middle one (the turn of the wall they were bowed
// off) is alike at both ends and at least 45 degrees (#994; a right angle
// before it). That is a wall square to both its neighbours, or splayed alike
// at both, bowed. A chamfer, a saw-tooth wall and a prow of 45 degree walls
// are not; a prow of two equal walls on such an end turning under 85 degrees
// at its tip is, and is the same chords. Two equal saw teeth or a V cut in a
// straight wall read as a wall turning under 42.5 degrees, so the 45 keeps
// them out. A wall whose ends turn unlike (a parallelogram's end) is not read:
// bowed in two chords it is the same polygon as a chamfer as long as the wall
// before it.
const CURVE_TURN = (85 * Math.PI) / 180;
export function hasCurve(loop) {
  const n = loop.length;
  if (n < 4) return false;
  const len = (i) => Math.hypot(loop[(i + 1) % n].x - loop[i].x, loop[(i + 1) % n].z - loop[i].z);
  const turn = (i) => {       // the signed turn at corner i + 1, between edges i and i + 1
    const a = loop[i], b = loop[(i + 1) % n], c = loop[(i + 2) % n];
    return Math.atan2((b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x),
      (b.x - a.x) * (c.x - b.x) + (b.z - a.z) * (c.z - b.z));
  };
  for (let i = 0; i < n; i++) {
    const l0 = len(i), l1 = len((i + 1) % n), l2 = len((i + 2) % n);
    const t0 = turn(i), t1 = turn((i + 1) % n);
    if (Math.abs(l1 - l0) > 1e-6 * l0 || Math.abs(l2 - l0) > 1e-6 * l0) continue;
    if (Math.abs(t1 - t0) > 1e-6 || t0 === 0 || Math.abs(t0) >= CURVE_TURN) continue;
    return true;
  }
  for (let i = 0; i < n; i++) {
    const l0 = len(i), l1 = len((i + 1) % n);
    if (Math.abs(l1 - l0) > 1e-6 * l0) continue;
    const before = turn((i - 1 + n) % n), mid = turn(i), after = turn((i + 1) % n);
    if (mid === 0 || Math.abs(mid) >= CURVE_TURN || Math.abs(after - before) > 1e-6) continue;
    if (Math.abs(before + mid / 2) < Math.PI / 4) continue;
    return true;
  }
  return false;
}

// The world height of the highest thing on the building, for the sun's shadow
// frustum and the edit camera's standoff.
export const roofTop = (plan) => plan.eaveY + plan.rise;
