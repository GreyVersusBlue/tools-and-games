// takeoff.js — the bill of materials: what this design is made of, by the
// foot, the square foot and the row.
//
// A quantity takeoff is the least glamorous analysis in Phase 7 and the one
// that most wants to exist, because every number in it has been sitting in the
// model since the phase that added the thing it measures. `finishSchedule`
// already sums floor area by finish. `siteSchedule` already sums paving by
// surface. `computeFloorPlan` already splits every wall into runs and every
// run into spans, with the thickness `walls.js` probed for it. This file is
// the reader in front of all of them, and it deliberately calls the plan's own
// geometry rather than re-deriving it: **the wall the drawing prints is the
// wall the schedule prices**, by construction, the same bargain `solidSpans`
// struck between the collider and the plan.
//
// Everything is a count of what is drawn, not an estimate of what it costs.
// There are no dollars here and there should not be: unit prices are a local,
// dated, trade-by-trade business, and a tool that guessed at them would be
// wrong in a way that looks authoritative. Quantities are the honest half, and
// they are the half a spreadsheet wants anyway.
//
// Pure module: no three.js, no DOM. Exercised by test/takeoff.test.mjs.

import {
  CELL, WALL_H, floorLabel, wallHeightOf,
} from './grid.js';
import { totalShapeArea } from './shapes.js';
import { WALL_T_EXT } from './walls.js';
import { propsOnFloor } from './props.js';
import { catalogEntry as defaultCatalogEntry } from './catalog.js';
import {
  stairsOf, stairWidth, runMetrics, stairMetrics, rampSlope, elevatorSize,
  isRun, isElevator, openingSize,
} from './stairs.js';
import { computeFloorPlan } from './blueprint.js';
import { finishEntry } from './finish.js';
import { siteSchedule, regionsOf, markingEntry } from './site.js';
import { roofMask, maskCount, roofStyleEntry, ensureRoof, normalizeRoof } from './roof.js';
import { MULLION_BAY } from './openings.js';

// A wall's plan thickness says which of the two it is — `walls.js` probes for
// it, and this only has to read the answer back.
const isExterior = (t) => t >= WALL_T_EXT - 0.001;

const round = (n, places = 1) => {
  const p = 10 ** places;
  return Math.round(n * p) / p;
};

// ---------- one storey ----------

// Walls, by what they are and how thick they were built. Length is the run as
// drawn — openings already cut out of it, because the plan cut them out of it
// — and area is that length times the storey's own wall height, which is the
// full floor-to-floor on every level but the top one.
function wallRows(plan, height) {
  const rows = new Map();
  for (const w of plan.walls) {
    const len = Math.hypot(w.bx - w.ax, w.bz - w.az);
    if (len < 0.01) continue;
    const ext = isExterior(w.t);
    const key = `${w.kind}:${ext ? 'ext' : 'int'}`;
    let r = rows.get(key);
    if (!r) {
      r = {
        key,
        kind: w.kind,
        exterior: ext,
        label: `${ext ? 'Exterior' : 'Interior'} ${w.kind === 'glass' ? 'glazing' : w.kind}`,
        thickness: w.t,
        lf: 0,
        area: 0,
      };
      rows.set(key, r);
    }
    r.lf += len;
    r.area += len * height;
  }
  return [...rows.values()].sort((a, b) => b.lf - a.lf);
}

// Doors and windows, grouped by what they are and how wide. A double leaf and
// a single are different line items in every schedule ever drawn.
function openingRows(plan) {
  const rows = new Map();
  for (const o of plan.doors) {
    const leaves = o.leaves ? o.leaves.length : 0;
    const w = round(o.w, 2);
    const h = round(o.h ?? (o.kind === 'window' ? 4 : 7), 2);
    const key = `${o.kind}:${w}:${h}:${leaves}`;
    let r = rows.get(key);
    if (!r) {
      r = {
        key,
        kind: o.kind,
        w, h,
        area: w * h,
        leaves,
        label: o.kind === 'window'
          ? `Window ${round(o.w)}×${round(h)} ft`
          : `${leaves === 2 ? 'Pair of doors' : leaves === 1 ? 'Single door' : 'Cased opening'} ${round(o.w)} ft`,
        count: 0,
      };
      rows.set(key, r);
    }
    r.count++;
  }
  return [...rows.values()].sort((a, b) => b.count - a.count);
}

function propRows(state, floorIndex, catalogGet) {
  const rows = new Map();
  for (const p of propsOnFloor(state, floorIndex)) {
    const entry = catalogGet(p.type);
    let r = rows.get(p.type);
    if (!r) {
      r = {
        type: p.type,
        label: entry ? entry.name : p.type,
        category: entry ? entry.category : 'Unknown',
        count: 0,
      };
      rows.set(p.type, r);
    }
    r.count++;
  }
  return [...rows.values()].sort((a, b) =>
    a.category.localeCompare(b.category) || b.count - a.count);
}

export function floorTakeoff(state, floorIndex, opts = {}) {
  const floor = state.floors[floorIndex];
  if (!floor) return null;
  const catalogGet = opts.catalogGet || defaultCatalogEntry;
  const plan = opts.plan || computeFloorPlan(state, floorIndex);
  const height = wallHeightOf(state, floorIndex);
  const walls = wallRows(plan, height);
  const openings = openingRows(plan);
  const props = propRows(state, floorIndex, catalogGet);
  const slab = totalShapeArea(floor);

  const glazing = walls.filter((w) => w.kind === 'glass').reduce((n, w) => n + w.area, 0)
    + openings.filter((o) => o.kind === 'window')
      .reduce((n, o) => n + o.count * o.area, 0);
  const glassLf = walls.filter((w) => w.kind === 'glass').reduce((n, w) => n + w.lf, 0);

  return {
    floor: floorIndex,
    label: floorLabel(floorIndex),
    height,
    slab,
    walls,
    openings,
    props,
    finishes: plan.finishes,
    // Paint goes on both faces of a partition and on the inside face of an
    // exterior wall; the outside of that one is facade, and priced as facade.
    paintArea: walls.filter((w) => w.kind !== 'glass')
      .reduce((n, w) => n + w.area * (w.exterior ? 1 : 2), 0),
    facadeArea: walls.filter((w) => w.exterior && w.kind !== 'glass')
      .reduce((n, w) => n + w.area, 0),
    glazing,
    // Glass is bought by the bay as much as by the square foot, and the
    // mullion spacing that decides how many is the renderer's own.
    bays: Math.ceil(glassLf / MULLION_BAY),
    doors: openings.filter((o) => o.kind !== 'window').reduce((n, o) => n + o.count, 0),
    windows: openings.filter((o) => o.kind === 'window').reduce((n, o) => n + o.count, 0),
    propCount: props.reduce((n, r) => n + r.count, 0),
  };
}

// ---------- the vertical, the roof and the ground ----------

function linkRows(state) {
  const metrics = stairMetrics(state);
  const rows = [];
  for (const link of stairsOf(state)) {
    if (isElevator(link)) {
      const { w, d } = elevatorSize(link);
      rows.push({
        id: link.id, type: 'elevator', from: link.from, to: link.to,
        label: `Elevator ${round(w)}×${round(d)} ft`,
        w, d, area: w * d, rise: (state.floorHt || 0) || null,
      });
      continue;
    }
    if (isRun(link)) {
      const m = runMetrics(link, metrics);
      const w = stairWidth(link);
      rows.push({
        id: link.id, type: link.type, from: link.from, to: link.to,
        label: link.type === 'ramp'
          ? `Ramp ${round(w)} ft wide at 1:${rampSlope(link)}`
          : `Stair ${round(w)} ft wide, ${m.steps} risers`,
        w, run: m.run, steps: m.steps, area: w * m.run,
        slope: link.type === 'ramp' ? rampSlope(link) : 0,
      });
      continue;
    }
    const { w, d } = openingSize(link);
    rows.push({
      id: link.id, type: 'opening', from: link.from, to: link.to,
      label: `Floor opening ${round(w)}×${round(d)} ft`,
      w, d, area: w * d,
    });
  }
  return rows;
}

// The roof, as the area it covers. `roofMask` is the same mask the renderer
// builds its planes from, so a pitched roof's *sloped* area is the footprint
// scaled by the pitch — one over the cosine of the slope, which for a 4:12 is
// about 1.05.
function roofTakeoff(state) {
  const top = state.floors.length - 1;
  const floor = state.floors[top];
  if (!floor) return null;
  const roof = normalizeRoof(state.roof || ensureRoof(state));
  const entry = roofStyleEntry(roof.style);
  const mask = roofMask(floor, floor.w, floor.h);
  const footprint = maskCount(mask) * CELL * CELL;
  const slope = entry.pitched ? Math.hypot(12, roof.pitch) / 12 : 1;
  return {
    style: roof.style,
    label: entry.label,
    pitched: !!entry.pitched,
    pitch: entry.pitched ? roof.pitch : 0,
    footprint,
    area: footprint * slope,
    facade: roof.facade,
  };
}

function siteTakeoff(state) {
  const surfaces = siteSchedule(state);
  const marks = new Map();
  for (const r of regionsOf(state)) {
    if (!r.mark) continue;
    const entry = markingEntry(r.mark);
    if (!entry) continue;
    marks.set(r.mark, (marks.get(r.mark) || 0) + 1);
  }
  return {
    surfaces,
    sqft: surfaces.reduce((n, r) => n + r.sqft, 0),
    regions: regionsOf(state).length,
    markings: [...marks.entries()].map(([key, count]) => ({
      key, label: markingEntry(key).label, count,
    })).sort((a, b) => b.count - a.count),
  };
}

// ---------- the whole design ----------

export function takeoff(state, opts = {}) {
  const floors = [];
  const count = state && state.floors ? state.floors.length : 0;
  for (let i = 0; i < count; i++) {
    const f = floorTakeoff(state, i, opts);
    if (f) floors.push(f);
  }
  const links = linkRows(state);
  const site = siteTakeoff(state);
  const roof = roofTakeoff(state);

  // Finishes roll up across storeys by key: a schedule wants one row per
  // material for the building, and one per storey on each sheet.
  const finishes = new Map();
  for (const f of floors) {
    for (const row of f.finishes) {
      let r = finishes.get(row.key);
      if (!r) {
        r = { key: row.key, label: finishEntry(row.key).label, sqft: 0 };
        finishes.set(row.key, r);
      }
      r.sqft += row.sqft;
    }
  }

  const props = new Map();
  for (const f of floors) {
    for (const row of f.props) {
      let r = props.get(row.type);
      if (!r) r = { ...row, count: 0 };
      r.count += row.count;
      props.set(row.type, r);
    }
  }

  const sum = (pick) => floors.reduce((n, f) => n + pick(f), 0);
  const exteriorLf = sum((f) => f.walls.filter((w) => w.exterior).reduce((n, w) => n + w.lf, 0));
  const interiorLf = sum((f) => f.walls.filter((w) => !w.exterior).reduce((n, w) => n + w.lf, 0));
  return {
    floors,
    links,
    site,
    roof,
    finishes: [...finishes.values()].sort((a, b) => b.sqft - a.sqft),
    props: [...props.values()].sort((a, b) =>
      a.category.localeCompare(b.category) || b.count - a.count),
    totals: {
      storeys: floors.length,
      slab: sum((f) => f.slab),
      // Added rather than summed a third time: a bill of materials whose
      // total is a rounding error away from its own two lines is a bill
      // somebody has to explain. Since Phase 12 a wall is one polygon run
      // rather than a cell's worth of edge, so the two orders of addition
      // stopped agreeing in the last bit.
      wallLf: exteriorLf + interiorLf,
      exteriorLf,
      interiorLf,
      paintArea: sum((f) => f.paintArea),
      facadeArea: sum((f) => f.facadeArea),
      glazing: sum((f) => f.glazing),
      bays: sum((f) => f.bays),
      doors: sum((f) => f.doors),
      windows: sum((f) => f.windows),
      props: sum((f) => f.propCount),
      stairs: links.filter((l) => l.type === 'stair').length,
      ramps: links.filter((l) => l.type === 'ramp').length,
      elevators: links.filter((l) => l.type === 'elevator').length,
      roof: roof ? roof.area : 0,
      site: site.sqft,
    },
  };
}

// ---------- the spreadsheet ----------

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const csvRows = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

// The takeoff as a spreadsheet, one row per line item. Deliberately long and
// flat rather than pretty: this is the format a quantity surveyor pastes into
// a column of unit prices, and every row carries which storey it came from so
// the pivot table works.
export function takeoffCSV(t) {
  const rows = [['Section', 'Where', 'Item', 'Detail', 'Quantity', 'Unit']];
  for (const f of t.floors) {
    rows.push(['Building', f.label, 'Floor area', 'Slab, as drawn', round(f.slab), 'ft²']);
    for (const w of f.walls) {
      rows.push(['Walls', f.label, w.label, `${round(w.thickness, 2)} ft thick, ${round(f.height)} ft high`,
        round(w.lf), 'lf']);
      rows.push(['Walls', f.label, `${w.label} — face area`, '', round(w.area), 'ft²']);
    }
    rows.push(['Finishes', f.label, 'Paint', 'Wall faces, interior', round(f.paintArea), 'ft²']);
    rows.push(['Finishes', f.label, 'Facade', 'Exterior face', round(f.facadeArea), 'ft²']);
    for (const row of f.finishes) {
      rows.push(['Finishes', f.label, row.label, 'Floor finish', round(row.sqft), 'ft²']);
    }
    for (const o of f.openings) {
      rows.push(['Openings', f.label, o.label,
        o.kind === 'window' ? `${round(o.area)} ft² each` : `${o.leaves} leaf`, o.count, 'ea']);
    }
    if (f.glazing > 0) {
      rows.push(['Openings', f.label, 'Glazing', `${f.bays} bays at ${MULLION_BAY} ft`, round(f.glazing), 'ft²']);
    }
    for (const p of f.props) {
      rows.push(['Furniture', f.label, p.label, p.category, p.count, 'ea']);
    }
  }
  for (const l of t.links) {
    rows.push(['Vertical', `${floorLabel(l.from)}→${floorLabel(l.to)}`, l.label, '', 1, 'ea']);
  }
  if (t.roof) {
    rows.push(['Roof', 'Building', t.roof.label,
      t.roof.pitched ? `${t.roof.pitch}:12 pitch` : 'Flat', round(t.roof.area), 'ft²']);
  }
  for (const s of t.site.surfaces) {
    rows.push(['Site', 'Site', s.label, s.marks.join(' / '), round(s.sqft), 'ft²']);
  }
  for (const m of t.site.markings) {
    rows.push(['Site', 'Site', m.label, 'Painted markings', m.count, 'ea']);
  }
  return csvRows(rows);
}

export { round as roundQty, WALL_H };
