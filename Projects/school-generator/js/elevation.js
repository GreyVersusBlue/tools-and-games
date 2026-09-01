// elevation.js — the building projected onto a vertical plane: the four
// facades, and the cuts somebody has drawn through the plan.
//
// Everything vertical has lived only in the walkthrough until now — storey
// heights, the roof line, a stair climbing, what a facade actually looks like
// — and the walkthrough is the one place a drawing reviewer will not go. The
// model already knows every number an elevation needs: wall heights from the
// storeys, sills and heads from the window bands, the roof from roof.js, the
// ground from terrain.js. This module is the projection and nothing else: it
// answers in 2D segments and fills on the blueprint's own drawing terms, and
// no three.js import appears anywhere in it.
//
// The sheet's coordinates are (u, y): `u` runs along the viewer's right in
// feet, `y` is world height. Everything that can hide something else carries a
// `depth` — distance from the viewer, larger is farther — and `paints` comes
// back sorted far-to-near so the drawing half is a painter's algorithm: fill
// each polygon opaquely in order and the near wing covers the far one. That is
// the honest compromise of the file, taken the same way roof.js took
// rectangles over a straight skeleton: true hidden-line removal is a hard
// piece of computational geometry, and a painter over opaque masses gives the
// right picture for every building this tool draws, at the cost of filling a
// few polygons nobody ever sees.
//
// A *section* is the same projection with a knife in it: two points on the
// plan define a vertical cut plane, walls and slabs the plane passes through
// fill with poché, a stair crossing it shows its risers in profile, and the
// openings beyond it show in elevation — painter-sorted the same way. The
// section lines themselves are the one thing here that is *stored*: a drawn
// section is a fact about the drawing and has to survive a reload to print
// twice, so `state.sections` is an additive save record (absent when none),
// on the same terms as every optional record before it.
//
// Pure module: no three.js, no DOM. Exercised by test/elevation.test.mjs.

import {
  CELL, WALL_H, RAIL_H, floorBaseY, wallHeightOf, floorLabel,
} from './grid.js';
import {
  shapesOf, segEnds, openingSpec,
  SEG_WALL, SEG_GLASS, SEG_RAIL, isBuilt, takeId, floorSolidAt,
} from './shapes.js';
import { solidBeside, wallProbe } from './walls.js';
import {
  roofPlan, roofTop, roofMask, maskAt, PARAPET_H, COPING_T,
} from './roof.js';
import { terrainField, groundAt } from './terrain.js';
import {
  stairMetrics, linksFrom, runMetrics, localToWorld, footprintPolygon, isRun,
  floorCuts, inFloorCut, pointInPolygon,
} from './stairs.js';
import { sheetDims, stackDims } from './annotate.js';

// Phase 38: the drawn dimensions that are true on a vertical sheet — the ones
// parallel to its plane, whose projected span *is* their measured length —
// strung below the drawing in stacked rows. Every storey's records project,
// because a facade has no storey of its own. Returns the rows and where the
// lowest one sits, so the caller can grow its bounds to fit.
const DIM_ROW_H = 2.6;   // ft of sheet between stacked strings
function sheetDimRows(state, uOf, topY) {
  const dims = stackDims(state.floors.flatMap((fl) => sheetDims(fl, uOf)));
  for (const d of dims) d.y = topY - 1.6 - d.row * DIM_ROW_H;
  const bottom = dims.length ? Math.min(...dims.map((d) => d.y)) - 1.6 : topY;
  return { dims, bottom };
}

// ---------- the four facades ----------

// Which way is which: the plan's +z runs down the page and the north arrow
// points up it, so north is -z and east is +x. Each facade is named for the
// direction it faces; its viewer stands off that side of the building looking
// back at it. `view` points from the building toward the viewer, and `u` is
// the viewer's right — which is what makes a printed north elevation read
// mirrored from the south one, exactly as two people standing on opposite
// sides of a building disagree about left and right.
const FACADE = {
  north: { view: { x: 0, z: -1 }, u: { x: -1, z: 0 }, label: 'North Elevation' },
  east: { view: { x: 1, z: 0 }, u: { x: 0, z: -1 }, label: 'East Elevation' },
  south: { view: { x: 0, z: 1 }, u: { x: 1, z: 0 }, label: 'South Elevation' },
  west: { view: { x: -1, z: 0 }, u: { x: 0, z: 1 }, label: 'West Elevation' },
};
export const FACADES = ['north', 'east', 'south', 'west'];
export const facadeEntry = (dir) => FACADE[dir] || FACADE.south;

// How far a wall may turn away from the sheet before its openings stop being
// drawn. 45° is the drafting convention: past it a window is mostly jamb.
const FACING = Math.cos(Math.PI / 4) - 1e-9;

// The slab a storey stands on, drawn in section. One foot reads as structure;
// the model stores no such number, so this is a drawing convention, stated
// once.
export const SLAB_T = 1;

const uOf = (f, x, z) => f.u.x * x + f.u.z * z;
const depthOf = (f, x, z) => -(f.view.x * x + f.view.z * z);
// (u, depth) back to the world, for sampling the ground under a facade.
const worldOf = (f, u, depth) => ({
  x: u * f.u.x - depth * f.view.x,
  z: u * f.u.z - depth * f.view.z,
});

const rect = (u0, u1, y0, y1) => [
  { u: u0, y: y0 }, { u: u1, y: y0 }, { u: u1, y: y1 }, { u: u0, y: y1 },
];

// ---------- what the viewer sees of a storey ----------

// One storey's visible mass, as intervals of `u` at the depth of the nearest
// covered cell — read off the same mask the roof reads, because a facade does
// not follow a 4ft jog in a wall any more than a roof does. Each face is
// { u0, u1, depth } with u0 < u1.
export function storeyFaces(floor, dir) {
  const f = facadeEntry(dir);
  const m = roofMask(floor, floor && floor.w, floor && floor.h);
  if (!m.w || !m.h) return [];
  // Columns run across the sheet; depth runs into it. For a north/south view
  // the mask's `c` is the sheet axis and `r` the depth axis; east/west swaps
  // them.
  const acrossX = f.view.x === 0;
  const cols = acrossX ? m.w : m.h;
  const rows = acrossX ? m.h : m.w;
  // The near boundary of a covered cell in sheet depth: any corner will do
  // for the axis across the sheet, so take the minimum over all four.
  const cellDepth = (c, r) => {
    const x0 = (m.cx0 + c) * CELL, x1 = x0 + CELL;
    const z0 = (m.cy0 + r) * CELL, z1 = z0 + CELL;
    return Math.min(
      depthOf(f, x0, z0), depthOf(f, x1, z0),
      depthOf(f, x0, z1), depthOf(f, x1, z1));
  };
  const colEdgeU = (i) => (acrossX
    ? uOf(f, (m.cx0 + i) * CELL, 0)
    : uOf(f, 0, (m.cy0 + i) * CELL));
  const faces = [];
  let open = null;
  for (let i = 0; i <= cols; i++) {
    let depth = null;
    if (i < cols) {
      for (let j = 0; j < rows; j++) {
        const c = acrossX ? i : j, r = acrossX ? j : i;
        if (!maskAt(m, c, r)) continue;
        const d = cellDepth(c, r);
        depth = depth === null ? d : Math.min(depth, d);
      }
    }
    if (open && (depth === null || Math.abs(depth - open.depth) > 1e-6)) {
      faces.push(open);
      open = null;
    }
    if (depth !== null && !open) open = { u0: colEdgeU(i), u1: colEdgeU(i), depth };
    if (open) open.u1 = colEdgeU(i + 1);
  }
  if (open) faces.push(open);
  // `u` can run against the world axis (north and east mirror), so put every
  // face the right way round before anyone measures it.
  for (const face of faces) {
    if (face.u0 > face.u1) { const t = face.u0; face.u0 = face.u1; face.u1 = t; }
  }
  return faces.filter((x) => x.u1 - x.u0 > 1e-6);
}

// ---------- openings, projected ----------

// Every opening on a viewer-facing boundary of one storey, pushed onto `out`
// as paints. An exterior wall's openings are taken only from its outdoor
// face; an interior partition's are taken whichever way it faces, because a
// door through it can be seen from both sides — on a facade those sit deeper
// than the front wall and the painter covers them, and in a section they are
// exactly the doors "in elevation beyond" a cut is drawn to show.
//
// `opts.originU`/`opts.originDepth` re-zero the sheet for a section, whose
// (u, depth) is measured from its own cut line rather than from the world
// origin; `opts.minDepth` drops whatever is behind the viewer's back.
function projectOpenings(state, floorIndex, f, out, opts = {}) {
  const floor = state.floors[floorIndex];
  const base = floorBaseY(state, floorIndex);
  const minDepth = opts.minDepth ?? -Infinity;
  const originU = opts.originU || 0;
  const originDepth = opts.originDepth || 0;
  // A section shows the *inside* face of the exterior wall beyond it, so a
  // cut takes every wall whichever way it faces; a facade takes an exterior
  // wall only by its outdoor face.
  const eitherFace = !!opts.eitherFace;
  const pushSeg = (a, b, openings, interior, outwardSide) => {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 0.01 || !openings.length) return;
    const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
    // The left normal of the run, times which side is outdoors — or, for an
    // interior wall, whichever way happens to point sheet-ward.
    let nx = -dz * outwardSide, nz = dx * outwardSide;
    let dot = nx * f.view.x + nz * f.view.z;
    if ((interior || eitherFace) && dot < 0) { nx = -nx; nz = -nz; dot = -dot; }
    if (dot < FACING) return;
    for (const o of openings) {
      const spec = openingSpec(o);
      const at = spec.t * len;
      const j0 = { x: a.x + dx * (at - spec.w / 2), z: a.z + dz * (at - spec.w / 2) };
      const j1 = { x: a.x + dx * (at + spec.w / 2), z: a.z + dz * (at + spec.w / 2) };
      const u0 = uOf(f, j0.x, j0.z) - originU;
      const u1 = uOf(f, j1.x, j1.z) - originU;
      if (Math.abs(u1 - u0) < 0.05) continue; // edge-on: all jamb, no face
      const mid = { x: (j0.x + j1.x) / 2, z: (j0.z + j1.z) / 2 };
      const depth = depthOf(f, mid.x, mid.z) - originDepth;
      if (depth < minDepth) continue;
      out.push({
        kind: spec.window ? 'window' : 'door',
        poly: rect(Math.min(u0, u1), Math.max(u0, u1), base + spec.sill, base + spec.head),
        depth,
        layer: 1,
        storey: floorIndex,
      });
    }
  };
  for (const shape of shapesOf(floor)) {
    for (const ring of shape.rings) {
      for (let i = 0; i < ring.pts.length; i++) {
        if (!isBuilt(ring.walls[i])) continue;
        const here = ring.openings.filter((o) => o.seg === i);
        if (!here.length) continue;
        const [a, b] = segEnds(ring, i);
        const left = solidBeside(floor, a.x, a.z, b.x, b.z, 1);
        const right = solidBeside(floor, a.x, a.z, b.x, b.z, -1);
        pushSeg(a, b, here, left && right, left ? -1 : 1);
      }
    }
  }
  // Free-standing walls carry the same opening record a ring does, and a door
  // in a garden wall prints on the elevation the same way. Neither side has a
  // room, so the facing side is simply the one toward the viewer.
  for (const line of (Array.isArray(floor.walls) ? floor.walls : [])) {
    const a = { x: line.ax, z: line.az }, b = { x: line.bx, z: line.bz };
    const here = Array.isArray(line.openings) ? line.openings : [];
    pushSeg(a, b, here, true, 1);
  }
}

// ---------- the roof, projected ----------

function roofPaints(state, dir, f, out) {
  const plan = roofPlan(state);
  const top = state.floors.length - 1;
  if (plan.style === 'parapet') {
    // The parapet stands on the top storey's own faces — same intervals, same
    // depths, a band above the eaves capped by its coping.
    for (const face of storeyFaces(state.floors[top], dir)) {
      out.push({
        kind: 'parapet',
        poly: rect(face.u0, face.u1, plan.eaveY, plan.eaveY + PARAPET_H + COPING_T),
        depth: face.depth,
        layer: 0,
      });
    }
    return;
  }
  // Pitched: project every face and gable of every block. A slope seen
  // edge-on collapses to a sliver and is dropped; the block's other faces
  // carry the silhouette.
  for (const block of plan.blocks) {
    for (const face of [...block.faces, ...block.gables]) {
      const poly = face.pts.map((p) => ({ u: uOf(f, p.x, p.z), y: p.y }));
      const depth = Math.min(...face.pts.map((p) => depthOf(f, p.x, p.z)));
      const spanU = Math.max(...poly.map((p) => p.u)) - Math.min(...poly.map((p) => p.u));
      if (spanU < 0.05) continue;
      out.push({
        kind: face.kind === 'gable' ? 'gable' : 'roof',
        poly, depth, layer: 0,
      });
    }
  }
}

// ---------- the elevation ----------

// Everything one facade needs to draw, in sheet feet, with no canvas/DOM
// dependency — the same bargain `computeFloorPlan` strikes. `paints` is
// sorted far-to-near: fill each polygon opaquely in order and what is behind
// stays behind.
export function computeElevation(state, dir) {
  const f = facadeEntry(dir);
  const paints = [];
  for (let i = 0; i < state.floors.length; i++) {
    const y0 = floorBaseY(state, i);
    const y1 = y0 + wallHeightOf(state, i);
    for (const face of storeyFaces(state.floors[i], dir)) {
      paints.push({
        kind: 'wall',
        poly: rect(face.u0, face.u1, y0, y1),
        depth: face.depth,
        layer: 0,
        storey: i,
      });
    }
    projectOpenings(state, i, f, paints);
  }
  roofPaints(state, dir, f, paints);
  // Far to near, and at equal depth the mass before the opening cut into it.
  paints.sort((a, b) => b.depth - a.depth || a.layer - b.layer);

  // Bounds from the masses, with margin for the ground running past the ends.
  let minU = Infinity, maxU = -Infinity;
  for (const p of paints) {
    for (const pt of p.poly) {
      minU = Math.min(minU, pt.u); maxU = Math.max(maxU, pt.u);
    }
  }
  if (!Number.isFinite(minU)) { minU = 0; maxU = Math.max(state.w || 0, state.h || 0) * CELL; }
  const margin = 12;
  minU -= margin; maxU += margin;

  // The ground line, sampled along the front of the building: at each `u` the
  // grade is read at the nearest mass, and past the ends at the building's
  // own front plane, so the line keeps walking off both edges of the sheet.
  const field = terrainField(state);
  const faces0 = storeyFaces(state.floors[0] || null, dir);
  let frontmost = null;
  for (const face of faces0) frontmost = frontmost === null ? face.depth : Math.min(frontmost, face.depth);
  const frontAt = (u) => {
    let d = null;
    for (const face of faces0) {
      if (u >= face.u0 - 1e-6 && u <= face.u1 + 1e-6) {
        d = d === null ? face.depth : Math.min(d, face.depth);
      }
    }
    return d ?? frontmost ?? 0;
  };
  const grade = [];
  for (let u = minU; u <= maxU + 1e-6; u += 2) {
    const w = worldOf(f, u, frontAt(u));
    grade.push({ u, y: groundAt(field, w.x, w.z) });
  }

  const levels = state.floors.map((_, i) => ({ y: floorBaseY(state, i), label: floorLabel(i) }));
  const topY = roofTop(roofPlan(state));
  let minY = 0;
  for (const g of grade) minY = Math.min(minY, g.y);

  // Phase 38: the drawn dimensions parallel to this facade, strung below the
  // grade line the way a drafter strings them.
  const { dims, bottom } = sheetDimRows(state, (x, z) => uOf(f, x, z), minY - 3);

  return {
    dir,
    label: f.label,
    paints,
    grade,
    levels,
    dims,
    bounds: { minU, maxU, minY: bottom, maxY: topY + 4 },
  };
}

// ---------- section lines: the stored record ----------
//
// The one thing in this module that goes in the file. A section line is two
// points on the plan and a name; everything the cut shows is derived at draw
// time, so the record stays three facts and survives every phase after it.

export const MAX_SECTIONS = 12;
export const MIN_SECTION_LEN = 4;   // ft — shorter than that cuts nothing

export const sectionsOf = (state) =>
  (state && Array.isArray(state.sections) ? state.sections : []);

export const sectionLabel = (sec) => `${sec.name}-${sec.name}`;

// A-A, B-B, ... the first letter no drawn section is using. Deleting B and
// drawing again reuses B, which is what a person renumbering by hand would do.
export function nextSectionName(state) {
  const used = new Set(sectionsOf(state).map((s) => s.name));
  for (let i = 0; i < MAX_SECTIONS; i++) {
    const name = String.fromCharCode(65 + i);
    if (!used.has(name)) return name;
  }
  return null;
}

export function addSection(state, a, b) {
  if (Math.hypot(b.x - a.x, b.z - a.z) < MIN_SECTION_LEN) return null;
  const name = nextSectionName(state);
  if (!name) return null;
  if (!Array.isArray(state.sections)) state.sections = [];
  const sec = { id: takeId(state), name, ax: a.x, az: a.z, bx: b.x, bz: b.z };
  state.sections.push(sec);
  return sec;
}

// Removing the last one removes the key: a design with no drawn section
// writes no `sections` record, which is the promise every optional record
// keeps.
export function removeSection(state, id) {
  const list = sectionsOf(state);
  const i = list.findIndex((s) => s.id === id);
  if (i < 0) return false;
  list.splice(i, 1);
  if (!list.length) delete state.sections;
  return true;
}

// The drawn line under a point, for the click that removes it.
export function sectionAt(state, x, z, tol = 2) {
  let best = null, bestD = tol;
  for (const sec of sectionsOf(state)) {
    const dx = sec.bx - sec.ax, dz = sec.bz - sec.az;
    const len2 = dx * dx + dz * dz;
    if (len2 < 1e-9) continue;
    const t = Math.max(0, Math.min(1, ((x - sec.ax) * dx + (z - sec.az) * dz) / len2));
    const d = Math.hypot(sec.ax + dx * t - x, sec.az + dz * t - z);
    if (d < bestD) { bestD = d; best = sec; }
  }
  return best;
}

// What the loader keeps of whatever a file offered. A bad line is a line that
// isn't there, never a design that won't open; names are re-lettered only
// when the file's own are unusable or collide.
export function normalizeSections(raw, extent = 4000) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const used = new Set();
  for (const r of raw.slice(0, MAX_SECTIONS)) {
    if (!r || typeof r !== 'object') continue;
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const ax = num(r.ax), az = num(r.az), bx = num(r.bx), bz = num(r.bz);
    if (ax === null || az === null || bx === null || bz === null) continue;
    if ([ax, az, bx, bz].some((v) => Math.abs(v) > extent)) continue;
    if (Math.hypot(bx - ax, bz - az) < MIN_SECTION_LEN) continue;
    let name = typeof r.name === 'string' && /^[A-Z]$/.test(r.name) && !used.has(r.name)
      ? r.name : null;
    if (!name) {
      for (let i = 0; i < MAX_SECTIONS && !name; i++) {
        const c = String.fromCharCode(65 + i);
        if (!used.has(c)) name = c;
      }
      if (!name) continue;
    }
    used.add(name);
    const id = num(r.id);
    out.push({ id: id && id > 0 ? Math.round(id) : 0, name, ax, az, bx, bz });
  }
  return out;
}

// ---------- the section cut ----------

// 2D segment intersection: where a·b crosses p·q, as parameters along each,
// or null.
function segCross(ax, az, bx, bz, px, pz, qx, qz) {
  const rX = bx - ax, rZ = bz - az;
  const sX = qx - px, sZ = qz - pz;
  const den = rX * sZ - rZ * sX;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((px - ax) * sZ - (pz - az) * sX) / den;
  const s = ((px - ax) * rZ - (pz - az) * rX) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || s < -1e-9 || s > 1 + 1e-9) return null;
  return { t, s };
}

// Poché for one wall the cut passes through, split around any opening the
// plane happens to slice: a door leaves the wall above its head, a window
// leaves it below the sill and above the head, a railing is waist-high solid.
function cutWall(a, b, openings, kind, u, thick, base, top, out) {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const wallTop = kind === SEG_RAIL ? base + RAIL_H : top;
  // The wall's own thickness, spread across the sheet by how obliquely the
  // cut crosses it — clamped so a near-parallel wall smears no wider than a
  // door, which is a drawing decision, not a measurement.
  const sin = Math.max(0.35, Math.abs(Math.sin(thick.angle)));
  const half = (thick.t / 2) / sin;
  const along = thick.s * len;
  let bands = [{ y0: base, y1: wallTop }];
  for (const o of openings) {
    const spec = openingSpec(o);
    if (Math.abs(along - spec.t * len) > spec.w / 2) continue;
    const lo = base + spec.sill, hi = base + spec.head;
    bands = bands.flatMap(({ y0, y1 }) => {
      const keep = [];
      if (lo > y0) keep.push({ y0, y1: Math.min(y1, lo) });
      if (hi < y1) keep.push({ y0: Math.max(y0, hi), y1 });
      return keep;
    });
  }
  for (const bnd of bands) {
    if (bnd.y1 - bnd.y0 < 0.05) continue;
    out.push({ poly: rect(u - half, u + half, bnd.y0, bnd.y1), glass: kind === SEG_GLASS });
  }
}

// The roof's height over one point of the plan, read off the same plan the
// renderer extrudes, or null where nothing is overhead.
export function roofHeightAt(plan, mask, x, z) {
  const c = Math.floor(x / CELL) - mask.cx0;
  const r = Math.floor(z / CELL) - mask.cy0;
  if (!maskAt(mask, c, r)) return null;
  if (plan.style === 'flat') return plan.eaveY;
  if (plan.style === 'parapet') return plan.eaveY + PARAPET_H + COPING_T;
  let best = plan.eaveY;
  for (const b of plan.blocks) {
    const rc = b.rect;
    if (x < rc.x0 - 1e-6 || x > rc.x1 + 1e-6 || z < rc.z0 - 1e-6 || z > rc.z1 + 1e-6) continue;
    // Height climbs from the eave toward the ridge across the short span.
    const mid = b.alongX ? (rc.z0 + rc.z1) / 2 : (rc.x0 + rc.x1) / 2;
    const halfSpan = b.alongX ? (rc.z1 - rc.z0) / 2 : (rc.x1 - rc.x0) / 2;
    const dist = Math.abs((b.alongX ? z : x) - mid);
    const frac = halfSpan > 0 ? Math.max(0, 1 - dist / halfSpan) : 0;
    best = Math.max(best, plan.eaveY + b.rise * frac);
  }
  return best;
}

const slabRect = (run, base) => ({
  poly: rect(run.u0, run.u1, base - SLAB_T, base),
  glass: false,
});

// Everything one cut needs to draw. The viewer looks along the cut's
// right-hand normal in (x, z) — which, with +z running down the plan, is the
// *left* of the direction drawn as a person sees it on the sheet; draw the
// line the other way round to look the other way.
// `cuts` and `slabs` are the poché (nearest of all: they are *on* the
// plane); `paints` are the openings beyond, far-to-near; `stairs` are risers
// in profile; `roofline` is the roof passing overhead.
export function computeSection(state, sec) {
  const a = { x: sec.ax, z: sec.az }, b = { x: sec.bx, z: sec.bz };
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  if (len < 1e-6) return null;
  const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
  // The right-hand normal in (x, z): the direction the section looks.
  const view = { x: dz, z: -dx };
  const uAt = (x, z) => (x - a.x) * dx + (z - a.z) * dz;

  const cuts = [];
  const slabs = [];
  const paints = [];
  const stairs = [];

  // A facade frame whose axes are the cut's own, so the openings beyond come
  // through the exact code path the elevations use — `view` points from the
  // content back toward the viewer standing on the plane, and (u, depth) are
  // re-zeroed onto the cut line.
  const frame = { view: { x: -view.x, z: -view.z }, u: { x: dx, z: dz } };
  const originU = uOf(frame, a.x, a.z);
  const originDepth = depthOf(frame, a.x, a.z);

  for (let i = 0; i < state.floors.length; i++) {
    const floor = state.floors[i];
    const base = floorBaseY(state, i);
    const top = base + wallHeightOf(state, i);
    const probe = wallProbe(floor);

    // Walls the plane passes through.
    const eachSeg = (pa, pb, kind, openings) => {
      const hit = segCross(a.x, a.z, b.x, b.z, pa.x, pa.z, pb.x, pb.z);
      if (!hit) return;
      const angle = Math.atan2(pb.z - pa.z, pb.x - pa.x) - Math.atan2(dz, dx);
      cutWall(pa, pb, openings, kind, hit.t * len,
        { t: probe(pa.x, pa.z, pb.x, pb.z), s: hit.s, angle }, base, top, cuts);
    };
    for (const shape of shapesOf(floor)) {
      for (const ring of shape.rings) {
        for (let k = 0; k < ring.pts.length; k++) {
          if (!isBuilt(ring.walls[k])) continue;
          const [pa, pb] = segEnds(ring, k);
          eachSeg(pa, pb, ring.walls[k], ring.openings.filter((o) => o.seg === k));
        }
      }
    }
    for (const line of (Array.isArray(floor.walls) ? floor.walls : [])) {
      eachSeg({ x: line.ax, z: line.az }, { x: line.bx, z: line.bz },
        isBuilt(line.kind) ? line.kind : SEG_WALL,
        Array.isArray(line.openings) ? line.openings : []);
    }

    // The slab underfoot, where the cut is actually inside this storey —
    // minus the holes the stairs have cut in it, which stairs.js knows.
    const holes = floorCuts(state, i);
    let run = null;
    for (let u = 0; u <= len + 1e-6; u += 1) {
      const x = a.x + dx * u, z = a.z + dz * u;
      const solid = floorSolidAt(floor, x, z) && !inFloorCut(holes, x, z);
      if (solid && !run) run = { u0: u, u1: u };
      if (solid && run) run.u1 = u;
      if (!solid && run) { slabs.push(slabRect(run, base)); run = null; }
    }
    if (run) slabs.push(slabRect(run, base));

    // The openings beyond, in elevation — the same projection the facades
    // use, with depth measured from the cut plane and everything behind the
    // viewer's back left out.
    projectOpenings(state, i, frame, paints,
      { originU, originDepth, minDepth: 0.1, eitherFace: true });
  }

  // A stair the plane crosses shows in profile: one riser and one tread per
  // step, climbing from its storey to the next.
  const metrics = stairMetrics(state);
  for (let i = 0; i < state.floors.length; i++) {
    const base = floorBaseY(state, i);
    for (const link of linksFrom(state, i)) {
      if (!isRun(link)) continue;
      const poly = footprintPolygon(link, metrics);
      const crossed = pointInPolygon(poly, a.x, a.z) || poly.some((p, k) => {
        const q = poly[(k + 1) % poly.length];
        return !!segCross(a.x, a.z, b.x, b.z, p.x, p.z, q.x, q.z);
      });
      if (!crossed) continue;
      const m = runMetrics(link, metrics);
      const pts = [];
      if (link.type === 'ramp') {
        const p0 = localToWorld(link, 0, 0);
        const p1 = localToWorld(link, 0, m.run);
        pts.push({ u: uAt(p0.x, p0.z), y: base });
        pts.push({ u: uAt(p1.x, p1.z), y: base + m.rise });
      } else {
        for (let k = 0; k < m.steps; k++) {
          const p0 = localToWorld(link, 0, (k / m.steps) * m.run);
          const p1 = localToWorld(link, 0, ((k + 1) / m.steps) * m.run);
          pts.push({ u: uAt(p0.x, p0.z), y: base + k * m.riser });
          pts.push({ u: uAt(p0.x, p0.z), y: base + (k + 1) * m.riser });
          pts.push({ u: uAt(p1.x, p1.z), y: base + (k + 1) * m.riser });
        }
      }
      stairs.push({ kind: link.type, pts, steps: link.type === 'ramp' ? 0 : m.steps });
    }
  }

  // The roof passing overhead, sampled along the cut.
  const plan = roofPlan(state);
  const topFloor = state.floors[state.floors.length - 1];
  const mask = roofMask(topFloor, state.w, state.h);
  const roofline = [];
  let seg = null;
  for (let u = 0; u <= len + 1e-6; u += 1) {
    const x = a.x + dx * u, z = a.z + dz * u;
    const y = roofHeightAt(plan, mask, x, z);
    if (y !== null) {
      if (!seg) { seg = []; roofline.push(seg); }
      seg.push({ u, y });
    } else seg = null;
  }

  paints.sort((p, q) => q.depth - p.depth || p.layer - q.layer);

  // The ground through the cut, sampled on the plane itself.
  const field = terrainField(state);
  const grade = [];
  for (let u = -4; u <= len + 4 + 1e-6; u += 2) {
    grade.push({ u, y: groundAt(field, a.x + dx * u, a.z + dz * u) });
  }

  const levels = state.floors.map((_, i) => ({ y: floorBaseY(state, i), label: floorLabel(i) }));
  let minY = -SLAB_T;
  for (const g of grade) minY = Math.min(minY, g.y);
  let maxY = floorBaseY(state, state.floors.length - 1) + WALL_H;
  for (const segPts of roofline) for (const p of segPts) maxY = Math.max(maxY, p.y);

  // Phase 38: the drawn dimensions parallel to the cut, on the same terms as
  // the facades' — the cut's own (u, y) frame, strings below the drawing.
  const { dims, bottom } = sheetDimRows(state, uAt, minY - 2);

  return {
    name: sec.name,
    label: `Section ${sectionLabel(sec)}`,
    length: len,
    cuts,
    slabs,
    paints,
    stairs,
    roofline,
    grade,
    levels,
    dims,
    bounds: { minU: -4, maxU: len + 4, minY: bottom, maxY: maxY + 4 },
  };
}
