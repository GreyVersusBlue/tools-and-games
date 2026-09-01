// annotate.js — what the sheet says: dimensions and notes.
//
// The overlay tool can measure, and a measurement evaporates when the tool
// changes; the printed plan carries rooms, doors and a title block and not a
// single dimension. A drawing nobody can build from is a picture with a scale
// bar. This module is the two records that fix that, and everything derived
// from them:
//
//   a dimension   two anchor points and an offset. The *number* on it is
//                 computed from the measured distance between the anchors at
//                 draw time, never typed and never stored — so the sheet
//                 cannot disagree with the model it prints. Re-anchor the
//                 dimension and the text follows; there is no way to make it
//                 lie.
//   a note        a point, a leader, a sentence. The one thing here somebody
//                 *types*, because "align this jamb with the existing column"
//                 is a fact the geometry cannot say.
//
// Both are per-storey records on the floor, beside Phase 25's `walls` and
// Phase 26's `spawn`, and on the same terms: a storey with none writes no
// key, so every file written before this build round-trips unchanged.
//
// The chain (`chainDims`) is the tool's best trick and is pure arithmetic
// over the opening records a wall already carries: click a wall and its piers
// and openings come out dimensioned end to end, jamb to jamb, the way a real
// plan strings them. The jambs are read off `openingSpec` — the same record
// the leaf hangs from and the collider cuts at, so the chain and the doorway
// can never disagree about where the jamb is.
//
// Pure module: no three.js, no DOM. Anchors are snapped by the *tool* through
// snapgrid.js before they arrive here; this file never guesses a grid.
// Exercised by test/annotate.test.mjs.

import { openingSpec, takeId } from './shapes.js';

export const MAX_DIMS = 240;      // per storey — a sheet, not a database
export const MAX_NOTES = 120;
export const MIN_DIM_LEN = 0.25;  // ft — shorter than that points at nothing
export const MAX_NOTE_TEXT = 240; // characters of sentence
export const MAX_DIM_OFF = 80;    // ft a dimension line may stand off its anchors
export const DIM_OFF = 5;         // ft — the default standoff a tool starts from

// The drawn parts, in feet at world scale; the sheet multiplies by its own
// px-per-ft. Gap: the air between an anchor and the start of its extension
// line (drafting convention — the extension line never touches the thing it
// measures). Over: how far the extension line runs past the dimension line.
export const EXT_GAP = 0.6;
export const EXT_OVER = 0.9;
export const TICK_R = 0.7;        // half-length of the 45° tick slash

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------- the records on a storey ----------

export const dimsOf = (floor) =>
  (floor && Array.isArray(floor.dims) ? floor.dims : []);

export const notesOf = (floor) =>
  (floor && Array.isArray(floor.notes) ? floor.notes : []);

// A dimension between two anchors, standing `off` feet to the left of the run
// a→b (negative for the right). Returns the record, or null for a pair of
// anchors too close to measure anything.
export function addDim(state, floorIndex, a, b, off = DIM_OFF) {
  const floor = state.floors[floorIndex];
  if (!floor) return null;
  if (Math.hypot(b.x - a.x, b.z - a.z) < MIN_DIM_LEN) return null;
  if (dimsOf(floor).length >= MAX_DIMS) return null;
  if (!Array.isArray(floor.dims)) floor.dims = [];
  const dim = {
    id: takeId(state),
    ax: a.x, az: a.z, bx: b.x, bz: b.z,
    off: clamp(num(off) ?? DIM_OFF, -MAX_DIM_OFF, MAX_DIM_OFF),
  };
  floor.dims.push(dim);
  return dim;
}

// A note: an anchor on the plan, the spot its sentence sits, and the sentence.
export function addNote(state, floorIndex, at, tx, tz, text) {
  const floor = state.floors[floorIndex];
  if (!floor) return null;
  if (notesOf(floor).length >= MAX_NOTES) return null;
  if (!Array.isArray(floor.notes)) floor.notes = [];
  const note = {
    id: takeId(state),
    x: at.x, z: at.z,
    tx: num(tx) ?? at.x, tz: num(tz) ?? at.z,
    text: noteText(text),
  };
  floor.notes.push(note);
  return note;
}

// Removing the last one removes the key — the promise every optional record
// keeps, so a design annotated and then cleaned writes the same bytes as one
// never annotated.
export function removeDim(state, floorIndex, id) {
  const floor = state.floors[floorIndex];
  const list = dimsOf(floor);
  const i = list.findIndex((d) => d.id === id);
  if (i < 0) return false;
  list.splice(i, 1);
  if (!list.length) delete floor.dims;
  return true;
}

export function removeNote(state, floorIndex, id) {
  const floor = state.floors[floorIndex];
  const list = notesOf(floor);
  const i = list.findIndex((n) => n.id === id);
  if (i < 0) return false;
  list.splice(i, 1);
  if (!list.length) delete floor.notes;
  return true;
}

export function setDimOffset(dim, off) {
  dim.off = clamp(num(off) ?? dim.off, -MAX_DIM_OFF, MAX_DIM_OFF);
  return dim.off;
}

export function moveNote(note, tx, tz) {
  const x = num(tx), z = num(tz);
  if (x === null || z === null) return false;
  note.tx = x;
  note.tz = z;
  return true;
}

export const noteText = (text) => {
  const t = typeof text === 'string' ? text.trim().slice(0, MAX_NOTE_TEXT) : '';
  return t || 'Note';
};

export function setNoteText(note, text) {
  note.text = noteText(text);
  return note.text;
}

// ---------- what the number says ----------

export const dimLength = (dim) => Math.hypot(dim.bx - dim.ax, dim.bz - dim.az);

// A length as a drawing writes it: feet and inches, to the nearest inch.
// `24'-6"`, `9'-0"`, `8"`. Rounded here and nowhere else, so the plan, the
// elevation and the status line all print the same string for the same pair
// of anchors.
export function dimLabel(lenFt) {
  const ft = num(lenFt);
  if (ft === null || ft < 0) return '0"';
  let whole = Math.floor(ft);
  let inches = Math.round((ft - whole) * 12);
  if (inches === 12) { whole += 1; inches = 0; }
  return whole > 0 ? `${whole}'-${inches}"` : `${inches}"`;
}

// ---------- the drawn parts ----------

// Everything a sheet draws for one dimension, in world feet: the dimension
// line, the two extension lines, the two 45° ticks, and where the text sits.
// The label is derived from the anchors right here — the one rule of the
// module, applied at the one place drawing happens.
export function dimGeometry(dim) {
  const dx = dim.bx - dim.ax, dz = dim.bz - dim.az;
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return null;
  const ux = dx / len, uz = dz / len;
  // The run's left-hand normal — the same normal `sideOfWall` and the plan's
  // door swing read, so "left of the run" means one thing everywhere.
  const nx = -uz, nz = ux;
  const off = num(dim.off) ?? DIM_OFF;
  const s = off >= 0 ? 1 : -1;
  const la = { x: dim.ax + nx * off, z: dim.az + nz * off };
  const lb = { x: dim.bx + nx * off, z: dim.bz + nz * off };
  const extFor = (px, pz) => [
    { x: px + nx * EXT_GAP * s, z: pz + nz * EXT_GAP * s },
    { x: px + nx * (off + EXT_OVER * s), z: pz + nz * (off + EXT_OVER * s) },
  ];
  // The tick is the architect's slash: 45° across the dimension line, drawn
  // along u+n so both ticks lean the same way.
  const tx = (ux + nx) * TICK_R * 0.7071, tz = (uz + nz) * TICK_R * 0.7071;
  const tickAt = (p) => [{ x: p.x - tx, z: p.z - tz }, { x: p.x + tx, z: p.z + tz }];
  return {
    a: { x: dim.ax, z: dim.az },
    b: { x: dim.bx, z: dim.bz },
    la, lb,
    ext: [extFor(dim.ax, dim.az), extFor(dim.bx, dim.bz)],
    ticks: [tickAt(la), tickAt(lb)],
    mid: { x: (la.x + lb.x) / 2, z: (la.z + lb.z) / 2 },
    // Which side of the dimension line the text stands on: away from the
    // anchors, so the string never lies across the wall it measures.
    tn: { x: nx * s, z: nz * s },
    angle: Math.atan2(dz, dx),
    len,
    label: dimLabel(len),
  };
}

// ---------- finding one under the cursor ----------

const segDist = (px, pz, ax, az, bx, bz) => {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-9) return Math.hypot(px - ax, pz - az);
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / len2, 0, 1);
  return Math.hypot(ax + dx * t - px, az + dz * t - pz);
};

// The dimension under a point — measured to the drawn line, not to the
// anchors, because the line is what is on screen to be clicked.
export function dimAt(floor, x, z, tol = 2) {
  let best = null, bestD = tol;
  for (const dim of dimsOf(floor)) {
    const g = dimGeometry(dim);
    if (!g) continue;
    const d = segDist(x, z, g.la.x, g.la.z, g.lb.x, g.lb.z);
    if (d < bestD) { bestD = d; best = dim; }
  }
  return best;
}

// The note under a point: its text spot first (that is what a drag moves),
// then its anchor.
export function noteAt(floor, x, z, tol = 2) {
  let best = null, bestD = tol;
  for (const note of notesOf(floor)) {
    const d = Math.min(
      Math.hypot(note.tx - x, note.tz - z),
      Math.hypot(note.x - x, note.z - z));
    if (d < bestD) { bestD = d; best = note; }
  }
  return best;
}

// ---------- the chain ----------

// Where a run of wall breaks, as distances along it: the start, both jambs of
// every opening, the end. Read off `openingSpec`, which is also what hangs
// the leaf and cuts the collider — one description of a doorway, dimensioned
// the same way it is built.
export function chainStations(len, openings = []) {
  const pts = [0, len];
  for (const o of openings) {
    const spec = openingSpec(o);
    const at = spec.t * len;
    pts.push(clamp(at - spec.w / 2, 0, len));
    pts.push(clamp(at + spec.w / 2, 0, len));
  }
  pts.sort((a, b) => a - b);
  const out = [];
  for (const p of pts) {
    if (!out.length || p - out[out.length - 1] > 0.05) out.push(p);
  }
  return out;
}

// One dimension per pier and per opening, end to end along a→b, standing
// `off` to the run's left (negative right). A wall with no openings chains to
// its one overall dimension. Returns the records it added.
export function chainDims(state, floorIndex, a, b, openings = [], off = DIM_OFF) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < MIN_DIM_LEN) return [];
  const ux = dx / len, uz = dz / len;
  const at = (s) => ({ x: a.x + ux * s, z: a.z + uz * s });
  const stations = chainStations(len, openings);
  const out = [];
  for (let i = 0; i + 1 < stations.length; i++) {
    const dim = addDim(state, floorIndex, at(stations[i]), at(stations[i + 1]), off);
    if (dim) out.push(dim);
  }
  return out;
}

// ---------- projection onto a vertical sheet ----------

// The dimensions of one storey that are true on a sheet whose horizontal axis
// is `uOf(x, z)`: exactly the ones drawn parallel to the sheet's plane, whose
// projected span *is* their measured length. An oblique dimension would print
// a foreshortened line under an unforeshortened number, so it stays on the
// plan where it was drawn.
export function sheetDims(floor, uOf, tol = 0.05) {
  const out = [];
  for (const dim of dimsOf(floor)) {
    const len = dimLength(dim);
    if (len < MIN_DIM_LEN) continue;
    const u0 = uOf(dim.ax, dim.az);
    const u1 = uOf(dim.bx, dim.bz);
    if (Math.abs(Math.abs(u1 - u0) - len) > tol) continue;
    out.push({ u0: Math.min(u0, u1), u1: Math.max(u0, u1), len, label: dimLabel(len) });
  }
  return out;
}

// Stack a sheet's dimension strings into rows so overlapping spans never
// print through each other: each takes the first row where it fits, with a
// little air between neighbours. Sorted by left edge, so the rows come out
// the way a drafter would stack them.
export function stackDims(dims, gap = 2) {
  const rows = [];
  const out = dims.slice().sort((p, q) => p.u0 - q.u0 || p.u1 - q.u1);
  for (const d of out) {
    let row = 0;
    while ((rows[row] ?? -Infinity) > d.u0 - gap) row++;
    rows[row] = d.u1;
    d.row = row;
  }
  return out;
}

// ---------- the loader's half ----------

// What the loader keeps of whatever a file offered. A bad record is one that
// isn't there, never a design that won't open — the promise every optional
// record keeps.
export function normalizeDims(raw, extent = 4000) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const r of raw.slice(0, MAX_DIMS)) {
    if (!r || typeof r !== 'object') continue;
    const ax = num(r.ax), az = num(r.az), bx = num(r.bx), bz = num(r.bz);
    if (ax === null || az === null || bx === null || bz === null) continue;
    if ([ax, az, bx, bz].some((v) => Math.abs(v) > extent)) continue;
    if (Math.hypot(bx - ax, bz - az) < MIN_DIM_LEN) continue;
    const id = num(r.id);
    out.push({
      id: id && id > 0 ? Math.round(id) : 0,
      ax, az, bx, bz,
      off: clamp(num(r.off) ?? DIM_OFF, -MAX_DIM_OFF, MAX_DIM_OFF),
    });
  }
  return out;
}

export function normalizeNotes(raw, extent = 4000) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const r of raw.slice(0, MAX_NOTES)) {
    if (!r || typeof r !== 'object') continue;
    const x = num(r.x), z = num(r.z);
    if (x === null || z === null) continue;
    if (Math.abs(x) > extent || Math.abs(z) > extent) continue;
    const tx = num(r.tx), tz = num(r.tz);
    const id = num(r.id);
    out.push({
      id: id && id > 0 ? Math.round(id) : 0,
      x, z,
      tx: tx === null || Math.abs(tx) > extent ? x : tx,
      tz: tz === null || Math.abs(tz) > extent ? z : tz,
      text: noteText(r.text),
    });
  }
  return out;
}
