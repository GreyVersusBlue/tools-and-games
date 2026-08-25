// finish.js — what a room is made of: floor material and wall paint.
//
// A room record has carried a `color` since v1, and that colour has always
// been a *label* tint — the pastel that says "this is the science wing" on a
// plan and in the editor's top-down view. It is not what the floor is made of,
// and overloading it into one would have meant a plan legend that lists
// "#f5d491" as a flooring product.
//
// So Phase 2 adds two fields beside it, on both halves of the room model:
//
//   fin    a floor finish key out of the table below — VCT, carpet, tile...
//   paint  a wall colour, '#rrggbb' or null for the default
//
// Grid cells carry them per cell (the grid has no room object to hang them on,
// which is the standing tax the retrospective describes) and the room tool
// writes them across a flood-filled region the same way it writes the name.
// Polygon rooms carry them once, on the shape.
//
// Both are optional, both default to what the renderer already drew, and both
// are ignored by anything that doesn't ask — so a v4 file is a design where
// every room happens to be VCT and off-white.
//
// Pure module: no three.js. Exercised by test/finish.test.mjs.

import { CELL, getCell } from './grid.js';
import { shapesOf, shapeArea, shapeAt } from './shapes.js';

// The finish table. `color` is the floor's own base colour — what the material
// looks like, not the room's label tint — and `grain` tells render.js which
// procedural texture to lay over it. `hatch` is the plan legend's swatch style.
//
// Everything here is a real school flooring product at a real colour: VCT in
// corridors and classrooms, carpet tile in libraries and offices, ceramic in
// restrooms, maple in the gym, terrazzo in a lobby that had a budget.
//
// Phase 4 of the second arc adds one column: `absorb`, the material's sound
// absorption coefficient at 500 Hz, out of the same published product tables
// the colours came from. It lives here rather than in acoustics.js because
// this is where "what this material is" already lives — a floor finish that
// says how it looks, how it draws on a plan and how it sounds is one fact in
// one row, and acoustics.js reads it the way render.js reads `grain`.
export const FLOOR_FINISHES = [
  { key: 'vct', label: 'Vinyl tile (VCT)', color: '#d8d4cb', grain: 'tile', tile: 1, hatch: 'grid', absorb: 0.03 },
  { key: 'carpet', label: 'Carpet tile', color: '#7d8794', grain: 'fiber', tile: 2, hatch: 'dots', absorb: 0.30 },
  { key: 'tile', label: 'Ceramic tile', color: '#cdd6da', grain: 'tile', tile: 0.667, hatch: 'grid', absorb: 0.02 },
  { key: 'wood', label: 'Wood (maple)', color: '#c69a5e', grain: 'plank', tile: 1, hatch: 'lines', absorb: 0.10 },
  { key: 'rubber', label: 'Rubber / sport', color: '#5f6b63', grain: 'speck', tile: 3, hatch: 'dots', absorb: 0.06 },
  { key: 'concrete', label: 'Sealed concrete', color: '#a9a9a5', grain: 'speck', tile: 4, hatch: 'plain', absorb: 0.02 },
  { key: 'terrazzo', label: 'Terrazzo', color: '#c3bdb2', grain: 'chip', tile: 3, hatch: 'chips', absorb: 0.02 },
];

export const FINISH_KEYS = FLOOR_FINISHES.map((f) => f.key);
export const DEFAULT_FINISH = 'vct';
// Off-white, because that is what a school is painted, and because a tint
// applied to it still reads as the tint rather than as mud.
export const DEFAULT_PAINT = '#f2f0ec';

const BY_KEY = new Map(FLOOR_FINISHES.map((f) => [f.key, f]));

export const finishEntry = (key) => BY_KEY.get(key) || BY_KEY.get(DEFAULT_FINISH);

// A finish key out of a save file, or null. Unknown keys become null rather
// than the default so `readFinish(x) ?? DEFAULT_FINISH` is the caller's choice
// and a room that never specified one is distinguishable from one that did.
export const readFinish = (v) => (typeof v === 'string' && BY_KEY.has(v) ? v : null);

export const readPaint = (v) =>
  (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : null);

// ---------- what's underfoot ----------

// A polygon room drawn over grid cells is the room you are standing in — the
// same rule `shapeAt` follows everywhere else — so it answers first.
export function finishAt(floor, x, z) {
  if (!floor) return DEFAULT_FINISH;
  const shape = shapeAt(floor, x, z);
  if (shape) return readFinish(shape.fin) || DEFAULT_FINISH;
  const cell = getCell(floor, Math.floor(x / CELL), Math.floor(z / CELL));
  return (cell && readFinish(cell.fin)) || DEFAULT_FINISH;
}

// The wall colour of the room at a point, or null where there is no room —
// which is what tells `wallPaint` below that it is looking at the outside.
export function paintAt(floor, x, z) {
  if (!floor) return null;
  const shape = shapeAt(floor, x, z);
  if (shape) return readPaint(shape.paint);
  const cell = getCell(floor, Math.floor(x / CELL), Math.floor(z / CELL));
  return cell ? readPaint(cell.paint) : null;
}

// The colour to paint one boundary. A wall belongs to the rooms on either side
// of it and this build draws it as one object, so the rule is simply "the
// first room that has an opinion" — walking the two sides in a fixed order so
// the answer doesn't depend on which way the segment happens to run.
//
// The probe distance matches walls.js's: far enough off the boundary to clear
// the wall, close enough to stay inside a 4ft cell.
export function wallPaint(floor, ax, az, bx, bz, probe = 1.2) {
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return DEFAULT_PAINT;
  const mx = ax + dx / 2, mz = az + dz / 2;
  const nx = (-dz / len) * probe, nz = (dx / len) * probe;
  const sides = [
    paintAt(floor, mx + nx, mz + nz),
    paintAt(floor, mx - nx, mz - nz),
  ].filter(Boolean);
  // Two rooms, two opinions: the lower hex wins. Arbitrary, but *stable* —
  // the alternative is a wall whose colour depends on ring winding.
  if (sides.length === 2) return sides[0] <= sides[1] ? sides[0] : sides[1];
  return sides[0] || DEFAULT_PAINT;
}

// ---------- writing ----------

// Set (or clear) a room's finish and paint. Passing `undefined` for either
// leaves it alone; passing null clears it back to the default.
export function applyFinish(target, fin, paint) {
  if (!target) return false;
  let changed = false;
  if (fin !== undefined) {
    const v = readFinish(fin);
    if ((target.fin || null) !== v) { target.fin = v; changed = true; }
  }
  if (paint !== undefined) {
    const v = readPaint(paint);
    if ((target.paint || null) !== v) { target.paint = v; changed = true; }
  }
  return changed;
}

// ---------- the plan legend ----------

// Every finish in use on a storey, with the floor area it covers and the rooms
// that use it. The blueprint prints this as a schedule; Phase 7's bill of
// materials will want exactly the same numbers, which is why the area is
// summed here rather than in the drawing code.
export function finishSchedule(floor) {
  if (!floor) return [];
  const rows = new Map();
  const row = (key) => {
    let r = rows.get(key);
    if (!r) {
      const e = finishEntry(key);
      r = { key, label: e.label, color: e.color, hatch: e.hatch, sqft: 0, rooms: [] };
      rows.set(key, r);
    }
    return r;
  };
  const note = (r, name) => { if (name && !r.rooms.includes(name)) r.rooms.push(name); };

  // Grid cells: one region's cells all carry the same finish (the room tool
  // writes it across a flood fill), so summing per cell and naming per cell is
  // the same thing as summing per room.
  for (let y = 0; y < floor.h; y++) {
    for (let x = 0; x < floor.w; x++) {
      const c = floor.cells[y * floor.w + x];
      if (!c) continue;
      const r = row(readFinish(c.fin) || DEFAULT_FINISH);
      r.sqft += CELL * CELL;
      note(r, c.room);
    }
  }
  for (const shape of shapesOf(floor)) {
    const r = row(readFinish(shape.fin) || DEFAULT_FINISH);
    r.sqft += shapeArea(shape);
    note(r, shape.name);
  }
  return [...rows.values()].sort((a, b) => b.sqft - a.sqft);
}
