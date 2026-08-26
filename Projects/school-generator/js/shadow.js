// shadow.js — what an upper storey is standing on.
//
// Every floor in this model shares one lattice origin (see the note at the
// top of grid.js), and until now nothing has cared whether a room on Level 2
// had anything underneath it. You could draw a classroom hanging in the air
// over the car park and the tool would render it, walk it, price it and count
// its occupants without a word.
//
// The rule this file adds is the one a builder would have said out loud:
// **an upper storey stands on the storey below it.** The set of ground the
// floor below covers is that floor's *shadow*, and the storey above is drawn
// inside it. Not because the model can't express an overhang — a real school
// has entrance canopies, cantilevered stair towers and a library that leans
// out over the plaza — but because an overhang is a decision somebody makes
// on purpose, and everything else is a mistake. So the editor limits you to
// the shadow by default and lets you step outside it deliberately, and this
// module is what both halves ask.
//
// **Resolution is one cell — four feet.** A footprint here is a lattice mask,
// including for polygon rooms, which are rasterized by testing each cell's
// centre. So a wing that oversails by three feet doesn't register as an
// overhang and a room whose corner clips a cell centre registers as a whole
// cell of one. That is a real approximation and it is stated rather than
// hidden: the alternative is polygon clipping between two floors' worth of
// rings on every pointer move, which is not what this costs.
//
// Pure module: no three.js, no DOM. Exercised by test/shadow.test.mjs.

import { CELL, floorAt, floorLabel } from './grid.js';
import { shapesOf, pointInShape, shapeBBox } from './shapes.js';

// A cell's area, which is the unit every number below is counted in.
export const CELL_AREA = CELL * CELL;

// How much overhang is worth mentioning. A single cell is a rounding artefact
// of the rasterization above as often as it is a design decision, so one cell
// passes quietly and two start talking.
export const OVERHANG_NOTE = 2;      // cells
// ...and how much of a storey may hang before it stops being a canopy and
// starts being a second building with no support under it.
export const OVERHANG_WARN = 0.12;   // fraction of the storey's own footprint

// ---------- bounds ----------
//
// Rooms are unbounded by the drawing surface on purpose (a wing can stick out
// past it), so a mask that only covered 0..w, 0..h would quietly agree that
// everything outside was unsupported *and* unbuilt. Bounds are therefore in
// cell coordinates that may go negative, taken from whatever the floor
// actually contains.

export function floorBounds(floor) {
  if (!floor) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  let any = false;
  for (const shape of shapesOf(floor)) {
    const bb = shapeBBox(shape);
    if (!bb) continue;
    any = true;
    x0 = Math.min(x0, Math.floor(bb.x0 / CELL));
    y0 = Math.min(y0, Math.floor(bb.z0 / CELL));
    x1 = Math.max(x1, Math.ceil(bb.x1 / CELL) - 1);
    y1 = Math.max(y1, Math.ceil(bb.z1 / CELL) - 1);
  }
  if (!any) return null;
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// The union of two bounds, either of which may be null — an empty storey over
// a built one still needs the built one's extent to be measured against.
export function unionBounds(a, b) {
  if (!a) return b;
  if (!b) return a;
  const x0 = Math.min(a.x0, b.x0), y0 = Math.min(a.y0, b.y0);
  const x1 = Math.max(a.x1, b.x1), y1 = Math.max(a.y1, b.y1);
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// ---------- the mask ----------
//
// `cells[i]` is 1 where the floor covers the ground under that lattice cell.
// `at(cx, cy)` is the lookup, which takes the same cell coordinates
// `floorBounds` speaks in rather than an index into the array.
export function footprintMask(floor, bounds) {
  const b = bounds || floorBounds(floor) || { x0: 0, y0: 0, x1: -1, y1: -1, w: 0, h: 0 };
  const cells = new Uint8Array(Math.max(0, b.w * b.h));
  const set = (cx, cy) => {
    if (cx < b.x0 || cy < b.y0 || cx > b.x1 || cy > b.y1) return;
    cells[(cy - b.y0) * b.w + (cx - b.x0)] = 1;
  };
  if (floor) {
    for (const shape of shapesOf(floor)) {
      const bb = shapeBBox(shape);
      if (!bb) continue;
      const cx0 = Math.floor(bb.x0 / CELL), cx1 = Math.ceil(bb.x1 / CELL);
      const cy0 = Math.floor(bb.z0 / CELL), cy1 = Math.ceil(bb.z1 / CELL);
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          // The cell's centre, which is the whole of the rasterization rule.
          if (pointInShape(shape, (cx + 0.5) * CELL, (cy + 0.5) * CELL)) set(cx, cy);
        }
      }
    }
  }
  return {
    ...b,
    cells,
    at(cx, cy) {
      if (cx < b.x0 || cy < b.y0 || cx > b.x1 || cy > b.y1) return false;
      return cells[(cy - b.y0) * b.w + (cx - b.x0)] === 1;
    },
    get count() { let n = 0; for (const c of cells) n += c; return n; },
  };
}

// ---------- the question the editor asks ----------
//
// One cell, one answer, no mask built. The ground floor stands on the ground,
// so it is always supported — which is the base case that makes every rule
// below a rule about *upper* storeys only.
export function cellSupported(state, floorIndex, cx, cy) {
  if (!state || floorIndex <= 0) return true;
  const below = floorAt(state, floorIndex - 1);
  if (!below) return false;
  const x = (cx + 0.5) * CELL, z = (cy + 0.5) * CELL;
  for (const shape of shapesOf(below)) if (pointInShape(shape, x, z)) return true;
  return false;
}

// The same question in world feet, for the tools that work in them — the
// polygon tool dropping a vertex, the stair tool placing a run.
export function pointSupported(state, floorIndex, x, z) {
  if (!state || floorIndex <= 0) return true;
  const below = floorAt(state, floorIndex - 1);
  if (!below) return false;
  return shapesOf(below).some((shape) => pointInShape(shape, x, z));
}

// Whether every corner and the centre of a rectangle stands on something —
// the test a room-sized placement wants rather than a single point's.
export function areaSupported(state, floorIndex, x, z, w, d) {
  if (!state || floorIndex <= 0) return true;
  const hw = Math.max(0, w) / 2, hd = Math.max(0, d) / 2;
  for (const dx of [-hw, 0, hw]) {
    for (const dz of [-hd, 0, hd]) {
      if (!pointSupported(state, floorIndex, x + dx, z + dz)) return false;
    }
  }
  return true;
}

// ---------- the reading ----------

// Everything on `floorIndex` that stands on nothing, as cells and as area.
// `cells` is the list, capped, so a warning can point at where the problem is
// without a reader having to hold the whole storey in memory.
export function floorOverhang(state, floorIndex, opts = {}) {
  const limit = opts.limit ?? 400;
  const floor = floorAt(state, floorIndex);
  const empty = {
    floor: floorIndex,
    label: floorLabel(floorIndex),
    cells: [],
    count: 0,
    area: 0,
    footprint: 0,
    ratio: 0,
    truncated: false,
  };
  if (!floor || floorIndex <= 0) {
    if (floor) empty.footprint = footprintMask(floor).count * CELL_AREA;
    return empty;
  }
  const below = floorAt(state, floorIndex - 1);
  const bounds = unionBounds(floorBounds(floor), floorBounds(below));
  if (!bounds) return empty;
  const here = footprintMask(floor, bounds);
  const under = footprintMask(below, bounds);
  const cells = [];
  let count = 0, footprint = 0;
  for (let cy = bounds.y0; cy <= bounds.y1; cy++) {
    for (let cx = bounds.x0; cx <= bounds.x1; cx++) {
      if (!here.at(cx, cy)) continue;
      footprint++;
      if (under.at(cx, cy)) continue;
      count++;
      if (cells.length < limit) cells.push({ x: cx, y: cy });
    }
  }
  return {
    floor: floorIndex,
    label: floorLabel(floorIndex),
    cells,
    count,
    area: count * CELL_AREA,
    footprint: footprint * CELL_AREA,
    ratio: footprint ? count / footprint : 0,
    truncated: count > cells.length,
  };
}

// Every storey above the ground, and the one finding the report prints. The
// verdict ladder is deliberately gentle — this is a warning about structure,
// not a code check, and the tool has no idea whether there is a column under
// the corner of that classroom or not.
export function buildingOverhang(state, opts = {}) {
  const count = state && state.floors ? state.floors.length : 0;
  const floors = [];
  for (let i = 1; i < count; i++) floors.push(floorOverhang(state, i, opts));
  const cells = floors.reduce((n, f) => n + f.count, 0);
  const area = floors.reduce((n, f) => n + f.area, 0);
  const worst = floors.slice().sort((a, b) => b.ratio - a.ratio)[0] || null;
  const findings = [];
  if (cells >= OVERHANG_NOTE) {
    const heavy = worst && worst.ratio > OVERHANG_WARN;
    findings.push({
      level: heavy ? 'warn' : 'note',
      code: 'overhang',
      title: `${Math.round(area).toLocaleString()} ft² of upper storey stands on nothing`,
      detail: `${worst.label} has ${Math.round(worst.area).toLocaleString()} ft² outside the ` +
        `footprint below it — ${Math.round(worst.ratio * 100)}% of that storey. ` +
        (heavy
          ? 'At this share it is a second building rather than a canopy: something ' +
            'has to carry it, and nothing on the storey below does.'
          : 'A canopy or a cantilever is a real thing to draw — this is a note that ' +
            'you drew one, measured at 4ft lattice resolution.'),
      floors: floors.filter((f) => f.count > 0).map((f) => ({
        floor: f.floor, label: f.label, area: f.area, ratio: f.ratio,
      })),
    });
  } else if (count > 1) {
    findings.push({
      level: 'ok', code: 'overhang',
      title: 'Every upper storey stands on the one below it',
      detail: `${count - 1} storey${count === 2 ? '' : 's'} checked against the footprint ` +
        'underneath, cell by cell.',
    });
  }
  return { floors, cells, area, worst, findings };
}
