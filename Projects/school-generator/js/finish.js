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
// A room carries both (until Phase 12 the lattice had no room object to hang
// which is the standing tax the retrospective describes) and the room tool
// writes them across a flood-filled region the same way it writes the name.
// Polygon rooms carry them once, on the shape.
//
// Both are optional, both default to what the renderer already drew, and both
// are ignored by anything that doesn't ask — so a v4 file is a design where
// every room happens to be VCT and off-white.
//
// Pure module: no three.js. Exercised by test/finish.test.mjs.

import { CELL } from './grid.js';
import { shapesOf, shapeArea, shapeAt, segAccent } from './shapes.js';
import { wallLinesOf, lineEnds, lineAccent, LINE_LEFT, LINE_RIGHT } from './wallrun.js';

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

// ---------- the outside of the building ----------
//
// Phase 5 of the second arc. A facade material is the same kind of row as a
// floor finish and lives beside it for the same reason: "what this material
// is" is one fact, and the renderer, the site plan and the bill of materials
// should all read it off the same line. `color` is the material's own colour,
// `grain` the procedural texture over it, `tile` how many feet of wall one
// tile of that texture covers, and `hatch` how the plan draws it.
//
// These are the five things a mid-century American school is actually clad in,
// plus wood for the one that isn't. Every colour is a real product colour: red
// face brick, buff split-face block, a grey factory-finished metal panel,
// sand-coloured EIFS, and the pale grey of precast.
export const FACADE_MATERIALS = [
  { key: 'brick', label: 'Face brick', color: '#9a5744', grain: 'brick', tile: 4, hatch: 'brick' },
  { key: 'brick-buff', label: 'Buff brick', color: '#bda781', grain: 'brick', tile: 4, hatch: 'brick' },
  { key: 'block', label: 'Split-face block', color: '#a49f93', grain: 'block', tile: 4, hatch: 'grid' },
  { key: 'panel', label: 'Metal panel', color: '#77808a', grain: 'rib', tile: 2, hatch: 'lines' },
  { key: 'stucco', label: 'Stucco / EIFS', color: '#cbc2b0', grain: 'speck', tile: 8, hatch: 'plain' },
  { key: 'precast', label: 'Precast concrete', color: '#b0ada4', grain: 'speck', tile: 10, hatch: 'plain' },
  { key: 'wood', label: 'Wood cladding', color: '#a2743f', grain: 'plank', tile: 2, hatch: 'lines' },
];

export const FACADE_KEYS = FACADE_MATERIALS.map((f) => f.key);
export const DEFAULT_FACADE = 'brick';
const FACADE_BY_KEY = new Map(FACADE_MATERIALS.map((f) => [f.key, f]));
export const facadeEntry = (key) => FACADE_BY_KEY.get(key) || FACADE_BY_KEY.get(DEFAULT_FACADE);
export const readFacade = (v) => (typeof v === 'string' && FACADE_BY_KEY.has(v) ? v : null);

// ---------- what a pane is made of ----------
//
// Phase 31. Glazing is the third material table and the shortest, because a
// school glazes in exactly two ways: you can see through it, or you can't.
// The columns are what a physically-based material wants — `transmission` is
// how much light goes through, `roughness` scatters it on the way (which is
// the entire difference between clear and frosted), `ior` is glass, and
// `thickness` is how far the light travels inside the pane before it leaves.
//
// **Nothing chooses this.** There is no glazing knob and no glazing field in
// the save file: `glazingForUse` below reads it off what the room *is*, the
// same way wall thickness is probed rather than stored. Frost a pane because
// the room behind it is a restroom, and a restroom that is renamed to a
// classroom un-frosts itself on the next rebuild.
//
// `blend` is the same pane's plain alpha, for every frame that is not paying
// for refraction — see the note on `applyGlassMode` in render.js. It carries
// the one thing that must survive without a transmission pass: you can see
// through a window and you cannot see through a frosted one. Clear's 0.26 is
// the alpha the glass has had since v1, so a design with no private room in it
// renders exactly as it did.
export const GLAZINGS = [
  {
    key: 'clear', label: 'Clear glazing',
    color: '#cfe4ee', transmission: 0.92, roughness: 0.06, ior: 1.52, thickness: 0.22,
    blend: 0.26,
  },
  {
    key: 'frosted', label: 'Frosted glazing',
    // Acid-etched or sandblasted: it passes nearly as much light and scatters
    // almost all of it, which is what privacy glass is for. Thicker on
    // purpose — the scattering reads as depth rather than as a dirty pane.
    color: '#dde8ea', transmission: 0.86, roughness: 0.62, ior: 1.52, thickness: 0.5,
    blend: 0.58,
  },
];

export const GLAZING_KEYS = GLAZINGS.map((g) => g.key);
export const DEFAULT_GLAZING = 'clear';
const GLAZING_BY_KEY = new Map(GLAZINGS.map((g) => [g.key, g]));
export const glazingEntry = (key) =>
  GLAZING_BY_KEY.get(key) || GLAZING_BY_KEY.get(DEFAULT_GLAZING);

// The occupancy uses a school actually frosts. Locker rooms and restrooms, and
// that is the list — an office has a vision panel in its door on purpose, and
// a classroom with a frosted borrowed light is a classroom nobody can be
// supervised in, which is the opposite of what the glass is there for.
export const PRIVATE_USES = ['restroom', 'locker'];

// Which glazing an occupancy use calls for. Takes the key occupancy.js's
// `classify` hands back (or a room's own `group`), so this file needs to know
// nothing about room names and imports nothing to answer.
export const glazingForUse = (use) =>
  (typeof use === 'string' && PRIVATE_USES.includes(use) ? 'frosted' : DEFAULT_GLAZING);

// What a roof deck is covered in. Not a knob: a flat roof is a membrane and a
// pitched one is shingled, because that is what they are — one fewer thing to
// choose and one fewer invalid combination to guard.
export const ROOF_MEMBRANE = { color: '#6d7076', grain: 'speck', tile: 8 };
export const ROOF_SHINGLE = { color: '#4d4a48', grain: 'shingle', tile: 3 };

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

// The floor finish of the room at a point — `shapeAt`'s answer, so a room
// drawn over another is the one you are standing in.
export function finishAt(floor, x, z) {
  if (!floor) return DEFAULT_FINISH;
  const shape = shapeAt(floor, x, z);
  return (shape && readFinish(shape.fin)) || DEFAULT_FINISH;
}

// The wall colour of the room at a point, or null where there is no room —
// which is what tells `wallPaint` below that it is looking at the outside.
export function paintAt(floor, x, z) {
  if (!floor) return null;
  const shape = shapeAt(floor, x, z);
  return shape ? readPaint(shape.paint) : null;
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
  return pickPaint(sides[0], sides[1]);
}

// Two rooms, two opinions: the lower hex wins. Arbitrary, but *stable* —
// the alternative is a wall whose colour depends on ring winding.
function pickPaint(a, b) {
  if (a && b) return a <= b ? a : b;
  return a || b || DEFAULT_PAINT;
}

const sideAt = (runs, t) => runs.find((r) => t >= r.t0 && t <= r.t1) || { room: false, paint: null };

// ---------- one wall, two faces ----------
//
// `wallPaint` answers for the wall as one object, and until #823 that was the
// only answer: a red room beside a blue one shared a wall that was red on both
// sides, and a painted room beside a plain corridor painted the corridor's
// side of the wall too. A wall has two faces, and each one is in a room.
//
// So a boundary is read as *stretches*: along the run, wherever the room on
// either side changes, the wall changes with it. Each stretch says what its
// left face is painted, what its right face is painted, and what the rest of
// it is — the top, the ends, a face with no room in front of it — which is
// `wallPaint`'s old rule asked of that stretch alone. Since #827 a face can be
// an accent instead of its room's paint, and a stretch ends where one does.
//
//   { t0, t1, left, right, body }
//
// `t0`/`t1` are fractions of the run. `left` is the face on the run's
// left-hand normal (in (x, z), 90° counter-clockwise from a to b — walls.js's
// `side: +1`) and `right` the other. A face is the hex of the room in front of
// it, `DEFAULT_PAINT` for a room that never said, and null where there is no
// room at all: that face is the weather's, and the facade's to clad.
//
// The stretches come from where the probe line *crosses a room's outline*,
// not from samples along it, so a corridor wall with six classrooms behind it
// changes colour exactly on each partition and nowhere else.

// How far off the run's own line a face is read. Rooms meet on a wall's
// centreline, so "which room is this face in" is exact however close the
// probe stands — and close is what an angled room needs: at a 45° corner a
// probe 1.2ft out (`wallPaint`'s, a 4ft lattice's) is outside the room for the
// first 1.2ft of the wall, and that much of a painted wall would come out
// plain.
export const FACE_PROBE = 0.1;   // ft

// A face shorter than this is not worth a seam. At an acute corner the probe
// line starts outside the room it is about to enter, and a sliver of "no room"
// there would cut a 6in piece off the end of the wall to say so.
export const MIN_FACE = 1;   // ft

// What one side of a run sees: [{ t0, t1, room, paint }], in order.
function sideRuns(floor, segs, ox, oz, dx, dz) {
  const ts = [0, 1];
  for (const [p, q] of segs) {
    const ex = q.x - p.x, ez = q.z - p.z;
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-9) continue;          // parallel: it never crosses
    const t = ((p.x - ox) * ez - (p.z - oz) * ex) / den;
    const u = ((p.x - ox) * dz - (p.z - oz) * dx) / den;
    if (u < -1e-9 || u > 1 + 1e-9) continue;
    if (t > 1e-9 && t < 1 - 1e-9) ts.push(t);
  }
  ts.sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const t0 = ts[i], t1 = ts[i + 1];
    if (t1 - t0 < 1e-9) continue;
    const m = (t0 + t1) / 2;
    const shape = shapeAt(floor, ox + dx * m, oz + dz * m);
    out.push({ t0, t1, shape, room: !!shape, paint: shape ? readPaint(shape.paint) : null });
  }
  return out;
}

// ---------- one room, one wall a different colour ----------
//
// #827. A face is the room's paint unless the room has said otherwise about
// that wall: `ring.accents[i]` (shapes.js) is the colour of the room's own
// face of segment i, whichever ring the wall on it is stored on. It reaches a run the way a room does, by geometry: a
// run lies along a segment or it does not, and the part of it that does is
// the accent's. The room is on its ring's left, so a segment that runs the
// run's way is on the run's left face and one that runs against it is on the
// right.
//
// How far off the run's line a segment may sit and still be the same wall.
// walls.js cuts its runs out of these same points, so this is rounding, and
// it is well under the 0.1ft the probe stands off.
const ON_RUN = 0.01;   // ft

// Every accented segment on the storey: [{ shape, a, b, paint }].
function accentSegs(floor) {
  const out = [];
  for (const shape of shapesOf(floor)) {
    for (const ring of shape.rings || []) {
      if (!Array.isArray(ring.accents)) continue;
      const n = ring.pts.length;
      for (let i = 0; i < n; i++) {
        const paint = segAccent(ring, i);
        if (!paint) continue;
        out.push({ shape, a: ring.pts[i], b: ring.pts[(i + 1) % n], paint });
      }
    }
  }
  // A free-standing wall's own two faces (#910, wallrun.js's `line.accents`), said
  // the way a ring says one: a segment with the painted face on its left. So
  // the left face runs a to b and the right face b to a, and `accentsOn` puts
  // each on the right side of whatever run lies along the wall. `shape: null`
  // is "whichever room stands in front": the wall is nobody's.
  for (const line of wallLinesOf(floor)) {
    const [a, b] = lineEnds(line);
    const l = lineAccent(line, LINE_LEFT), r = lineAccent(line, LINE_RIGHT);
    if (l) out.push({ shape: null, a, b, paint: l });
    if (r) out.push({ shape: null, a: b, b: a, paint: r });
  }
  return out;
}

// The accents lying along one run, by the face they are on:
// { left: [{ t0, t1, shape, paint }], right: [...] }.
function accentsOn(accents, ax, az, dx, dz, len) {
  const out = { left: [], right: [] };
  for (const s of accents) {
    const pa = { x: s.a.x - ax, z: s.a.z - az }, pb = { x: s.b.x - ax, z: s.b.z - az };
    if (Math.abs(pa.x * dz - pa.z * dx) / len > ON_RUN) continue;
    if (Math.abs(pb.x * dz - pb.z * dx) / len > ON_RUN) continue;
    const ta = (pa.x * dx + pa.z * dz) / (len * len);
    const tb = (pb.x * dx + pb.z * dz) / (len * len);
    // Clipped to the run, and an end within rounding of the run's own end is
    // that end: a diagonal's projection comes back as 0.9999999999999999.
    const clip = (t) => (t < 1e-9 ? 0 : t > 1 - 1e-9 ? 1 : t);
    const t0 = clip(Math.min(ta, tb)), t1 = clip(Math.max(ta, tb));
    if (t1 - t0 < 1e-9) continue;
    (tb > ta ? out.left : out.right).push({ t0, t1, shape: s.shape, paint: s.paint });
  }
  return out;
}

// What one face of a stretch is painted: the accent of the room in front of
// it if that room has one here, else the accent a free-standing wall carries
// on that face, else that room's paint, else nobody's. The room's own word
// comes first because it was the only word before a wall could carry one, and
// a design painted then must not change.
function faceAt(runs, accents, t) {
  const side = sideAt(runs, t);
  if (!side.room) return null;
  const here = (a) => t >= a.t0 && t <= a.t1;
  const acc = accents.find((a) => a.shape === side.shape && here(a)) ||
    accents.find((a) => a.shape === null && here(a));
  return acc ? acc.paint : side.paint || DEFAULT_PAINT;
}

const sameFace = (a, b) => a.left === b.left && a.right === b.right && a.body === b.body;

const NO_ACCENTS = { left: [], right: [] };

// A reader for one storey. Every room outline on it is gathered once, so a
// rebuild that asks about a thousand walls walks the rings a thousand times
// rather than gathering them a thousand times.
export function facePainter(floor, probe = FACE_PROBE) {
  const segs = [];
  for (const shape of shapesOf(floor)) {
    for (const ring of shape.rings || []) {
      const n = ring.pts.length;
      for (let i = 0; i < n; i++) segs.push([ring.pts[i], ring.pts[(i + 1) % n]]);
    }
  }
  const accents = accentSegs(floor);
  return (ax, az, bx, bz) => {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return [];
    const nx = (-dz / len) * probe, nz = (dx / len) * probe;
    const left = sideRuns(floor, segs, ax + nx, az + nz, dx, dz);
    const right = sideRuns(floor, segs, ax - nx, az - nz, dx, dz);
    // An accent ends where its segment does, which is a corner of the room
    // and need not be a place the probe line crosses anything.
    const acc = accents.length ? accentsOn(accents, ax, az, dx, dz, len) : NO_ACCENTS;
    const cuts = [...new Set([...left, ...right, ...acc.left, ...acc.right]
      .flatMap((r) => [r.t0, r.t1]))].sort((a, b) => a - b);
    let runs = [];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const t0 = cuts[i], t1 = cuts[i + 1];
      if (t1 - t0 < 1e-9) continue;
      const l = sideAt(left, (t0 + t1) / 2), r = sideAt(right, (t0 + t1) / 2);
      runs.push({
        t0, t1,
        left: faceAt(left, acc.left, (t0 + t1) / 2),
        right: faceAt(right, acc.right, (t0 + t1) / 2),
        // The top and the ends are the rooms' own paint: an accent is a face.
        body: pickPaint(l.paint, r.paint),
      });
    }
    // Slivers go to the longer neighbour, shortest first...
    for (;;) {
      if (runs.length < 2) break;
      let k = -1;
      for (let i = 0; i < runs.length; i++) {
        const span = (runs[i].t1 - runs[i].t0) * len;
        if (span < MIN_FACE && (k < 0 || span < (runs[k].t1 - runs[k].t0) * len)) k = i;
      }
      if (k < 0) break;
      const a = runs[k - 1], b = runs[k + 1];
      const into = !b || (a && a.t1 - a.t0 >= b.t1 - b.t0) ? a : b;
      if (into === a) a.t1 = runs[k].t1; else b.t0 = runs[k].t0;
      runs.splice(k, 1);
    }
    // ...and two stretches that say the same thing are one stretch.
    runs = runs.reduce((acc, r) => {
      const last = acc[acc.length - 1];
      if (last && sameFace(last, r)) last.t1 = r.t1; else acc.push(r);
      return acc;
    }, []);
    return runs;
  };
}

export const wallFaceRuns = (floor, ax, az, bx, bz, probe = FACE_PROBE) =>
  facePainter(floor, probe)(ax, az, bx, bz);

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

  for (const shape of shapesOf(floor)) {
    const r = row(readFinish(shape.fin) || DEFAULT_FINISH);
    r.sqft += shapeArea(shape);
    note(r, shape.name);
  }
  return [...rows.values()].sort((a, b) => b.sqft - a.sqft);
}
