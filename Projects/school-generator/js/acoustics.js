// acoustics.js — the room you are standing in, and how long it rings.
//
// Phase 4's third bullet is "reverb sized to the room the walker is in — room
// identity and area exist; map volume to a convolver preset". This module is
// the "sized to" half, and it turns out that once you know a room's volume and
// what its surfaces are made of, you don't need a preset at all: Sabine's
// equation has been answering this question since 1898 and it is one line.
//
//     RT60 = 0.049 * V / A          V in ft^3, A in sabins (ft^2 x alpha)
//
// The 0.049 is the imperial Sabine constant — 0.161 in metres, and this
// codebase has been in feet since v1, so imperial it is.
//
// Everything the equation wants, the model already knows or can derive:
//
//   V   the room's plan area (`shapeArea` for a polygon room, a cell count for
//       a flood-filled grid region) times its ceiling height, and the ceiling
//       height is itself derived — a room with a slab over it stops at that
//       slab, a gym with the storey above cut open runs two storeys.
//   A   the floor's own finish (Phase 2 put a real flooring product under every
//       room and `finish.js` now carries each one's absorption coefficient),
//       the walls, the ceiling, and every piece of furniture standing in it.
//
// That last term is the one worth pausing on: **furnishing a room makes it
// quieter**, because a soft chair is 25% absorptive and a bare block wall is
// 5%. The catalog already describes every prop's size and category, so the
// sabins a classroom's thirty desks and chairs contribute fall out of data
// that was there for Phase 1's reasons. Place an acoustic panel and watch the
// number drop; that is the whole feature.
//
// And because the number is real, it can be held to a real standard.
// ANSI/ASA S12.60 asks for RT60 <= 0.6 s in a core learning space under
// 10,000 ft^3 and <= 0.7 s up to 20,000 ft^3, so the readout doesn't say
// "lively", it says "0.9 s — over the 0.6 s classroom limit". Phase 7's
// "acoustics first pass, labeled as such" arrives early and by accident.
//
// Pure module: no three.js, no Web Audio. audio.js turns what comes out of
// here into a convolver; test/acoustics.test.mjs checks the physics.

import { CELL, WALL_H, floodRegion, getCell, cellIdx, wallHeightOf } from './grid.js';
import {
  shapesOf, shapeAt, shapeArea, shapeBBox, segEnds, segLength, pointInShape,
  floorSolidAt, interiorPoint,
} from './shapes.js';
import { finishEntry, DEFAULT_FINISH } from './finish.js';
import { floorCuts, inFloorCut } from './stairs.js';
import { propsOnFloor } from './props.js';

// Feet per second, dry air at room temperature. Used for the pre-delay: the
// gap before a room's first reflection arrives is how far the sound had to
// travel to a surface and back, divided by this.
export const SPEED_OF_SOUND = 1125;

// The imperial Sabine constant.
export const SABINE = 0.049;

// Absorption coefficients at 500 Hz, from published material tables. These are
// the surfaces the model knows about that aren't floors — floors carry their
// own coefficient on the finish row, because that is where "what this material
// is" already lives.
export const ALPHA = {
  wall: 0.05,       // painted gypsum board on studs — a school corridor
  glass: 0.04,      // fixed glazing, which reflects nearly everything
  door: 0.10,       // a hollow-core leaf
  // A suspended mineral acoustic tile ceiling, which is what is over almost
  // every room in a school...
  tile: 0.60,
  // ...except the ones open through more than one storey, where there is
  // nothing to hang it from and you are looking at painted steel deck. This
  // single distinction is most of why a gym rings and a classroom doesn't.
  deck: 0.12,
};

// How absorptive a prop is, per square foot of the face it presents, when its
// catalog row doesn't say. Category is a coarse instrument and it is meant to
// be: it gets a room full of soft seating right and a room full of lockers
// right, and any row where the category lies carries its own `absorb`.
export const CATEGORY_ALPHA = {
  'Seating': 0.25,
  'Decor': 0.20,
  'Library & Office': 0.12,
  'Tables & Desks': 0.10,
  'Subject Rooms': 0.10,
  'Gym & Stage': 0.15,
  'Cafeteria': 0.08,
  'Storage': 0.08,
  'Fixtures': 0.05,
  'Outdoor': 0.05,
  'Lighting': 0.03,
  'Restroom': 0.03,
};
export const DEFAULT_PROP_ALPHA = 0.08;

// Sabine stops describing anything useful at the extremes: a room with no
// absorption at all would ring forever, and one lined entirely in panels is
// past where the equation is valid anyway.
export const MIN_RT60 = 0.12;
export const MAX_RT60 = 8;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------- what a floor finish absorbs ----------

// The finish table's own coefficient, defaulting the way `finishEntry` does.
export function finishAlpha(key) {
  const e = finishEntry(key);
  return typeof e.absorb === 'number' ? e.absorb : 0.03;
}

// ---------- the room under a point ----------

// A grid region's perimeter in feet: every cell edge with no cell of the same
// region on the other side. `floodRegion` already stopped at walls and doors,
// so this is the room's boundary and not the building's.
function regionPerimeter(cells) {
  const inRegion = new Set(cells.map((c) => `${c.x},${c.y}`));
  let n = 0;
  for (const c of cells) {
    if (!inRegion.has(`${c.x - 1},${c.y}`)) n++;
    if (!inRegion.has(`${c.x + 1},${c.y}`)) n++;
    if (!inRegion.has(`${c.x},${c.y - 1}`)) n++;
    if (!inRegion.has(`${c.x},${c.y + 1}`)) n++;
  }
  return n * CELL;
}

// A polygon room's perimeter, outer ring plus every hole — a courtyard's wall
// is as much of this room's boundary as the outside wall is. Arcs are measured
// chord to chord, the same approximation the collider walks.
function shapePerimeter(shape) {
  let len = 0;
  for (const ring of shape.rings) {
    for (let i = 0; i < ring.pts.length; i++) {
      const [a, b] = segEnds(ring, i);
      len += segLength(a, b);
    }
  }
  return len;
}

// How high the ceiling is over a point, and whether it is a ceiling at all.
//
// A storey's walls run to the slab above it (`wallHeightOf`), so normally that
// is the answer. But this build has been cutting holes in slabs since Phase 4
// of the first arc, and a room with the floor above it opened up is not a
// 12ft room with a hole in the lid — it is a 24ft room. So climb: while the
// slab overhead is missing or cut away, keep adding storeys.
//
// `open` is what the ceiling is made of. A suspended tile grid needs something
// to hang from at a sane height; two storeys of open volume means you are
// looking at structure, and structure reflects.
//
// `cutsFor` lets a caller sampling a whole room share one set of hole polygons
// across every probe instead of rebuilding them per point.
function ceilingProbe(state, floorIndex, x, z, cutsFor) {
  const n = state && state.floors ? state.floors.length : 0;
  if (!n) return { height: WALL_H, open: false, storeys: 1 };
  let i = clamp(floorIndex, 0, n - 1);
  const from = i;
  let height = 0;
  let open = false;
  while (i < n) {
    height += wallHeightOf(state, i);
    const above = i + 1;
    if (above >= n) break;                       // the roof
    const f = state.floors[above];
    const solid = floorSolidAt(f, x, z) && !inFloorCut(cutsFor(above), x, z);
    if (solid) break;                            // a slab is a ceiling
    open = true;
    i = above;
  }
  return { height, open, storeys: i - from + 1 };
}

const cutsCache = (state) => {
  const seen = new Map();
  return (i) => {
    if (!seen.has(i)) seen.set(i, floorCuts(state, i));
    return seen.get(i);
  };
};

export function ceilingAt(state, floorIndex, x, z) {
  return ceilingProbe(state, floorIndex, x, z, cutsCache(state));
}

// How many points a room is sampled at to work out what is over it. A lattice
// this coarse can miss a light well the size of a desk; that is the intended
// trade, because the alternative is a per-cell sweep of a 2,000-cell floor
// plate every time somebody walks through a door.
export const CEILING_SAMPLES = 6;   // per axis, so up to 36 probes

// What is over a *room*, rather than over a point in one.
//
// This distinction is not pedantry, and the sample school is what found it: the
// main hall has a two-storey atrium down the middle of it, so probing at one
// point answered "12ft with a tile ceiling" or "22ft open to the deck"
// depending on which end of the same room you were standing in — and the
// reverberation readout changed as you walked across a room whose volume had
// not changed at all.
//
// A room has one volume, so it gets one height: the mean over a lattice of
// probes inside it. The ceiling material is mixed on the same evidence rather
// than picked by a threshold — a hall that is a third open is a third deck and
// two thirds tile, which is both more accurate and one fewer arbitrary number.
export function roomCeiling(state, floorIndex, room, samples = CEILING_SAMPLES) {
  const cuts = cutsCache(state);
  const bb = room && room.bbox;
  const probe = (x, z) => ceilingProbe(state, floorIndex, x, z, cuts);
  if (!bb) return { ...probe(0, 0), openFraction: 0 };

  const hits = [];
  const n = Math.max(1, samples);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const x = bb.x0 + ((ix + 0.5) / n) * (bb.x1 - bb.x0);
      const z = bb.z0 + ((iz + 0.5) / n) * (bb.z1 - bb.z0);
      if (!room.contains(x, z)) continue;
      hits.push(probe(x, z));
    }
  }
  // A room too thin for the lattice to land in still has a ceiling: fall back
  // to its own centre, which `roomAt` has already vouched for.
  if (!hits.length) hits.push(probe((bb.x0 + bb.x1) / 2, (bb.z0 + bb.z1) / 2));

  let height = 0, opens = 0, storeys = 1;
  for (const h of hits) {
    height += h.height;
    if (h.open) opens++;
    storeys = Math.max(storeys, h.storeys);
  }
  const openFraction = opens / hits.length;
  return {
    height: height / hits.length,
    open: openFraction > 0,
    openFraction,
    storeys,
  };
}

// The room around a point: a polygon room, a flood-filled grid region, or the
// outside. `contains` is handed back rather than an outline because that is
// what every caller actually asks — is this prop, this sound, this walker in
// the room I'm describing.
//
// Polygon rooms answer first, the same rule `shapeAt`, `finishAt` and the
// renderer already follow.
export function roomAt(state, floorIndex, x, z) {
  const floor = state && state.floors ? state.floors[floorIndex] : null;
  if (!floor) return outsideRoom();

  const shape = shapeAt(floor, x, z);
  if (shape) {
    return {
      kind: 'shape',
      id: `s${shape.id}`,
      floor: floorIndex,
      name: shape.name || null,
      fin: shape.fin || DEFAULT_FINISH,
      area: shapeArea(shape),
      perimeter: shapePerimeter(shape),
      bbox: shapeBBox(shape),
      contains: (px, pz) => pointInShape(shape, px, pz),
    };
  }

  const gx = Math.floor(x / CELL), gy = Math.floor(z / CELL);
  if (!getCell(floor, gx, gy)) return outsideRoom();
  const cells = floodRegion(floor, gx, gy);
  if (!cells.length) return outsideRoom();
  const keys = new Set(cells.map((c) => `${c.x},${c.y}`));
  let name = null, fin = null;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const c of cells) {
    const cell = floor.cells[cellIdx(floor, c.x, c.y)];
    if (!name && cell && cell.room) name = cell.room;
    if (!fin && cell && cell.fin) fin = cell.fin;
    x0 = Math.min(x0, c.x * CELL); x1 = Math.max(x1, (c.x + 1) * CELL);
    z0 = Math.min(z0, c.y * CELL); z1 = Math.max(z1, (c.y + 1) * CELL);
  }
  return {
    kind: 'grid',
    // Regions have no id of their own — the standing grid tax the retrospective
    // describes — so the lowest cell in the region names it. It is stable for
    // as long as the region is, which is exactly as long as the identity is.
    id: `g${floorIndex}:${cells.reduce((lo, c) => Math.min(lo, cellIdx(floor, c.x, c.y)), Infinity)}`,
    floor: floorIndex,
    name,
    fin: fin || DEFAULT_FINISH,
    area: cells.length * CELL * CELL,
    perimeter: regionPerimeter(cells),
    bbox: { x0, x1, z0, z1 },
    contains: (px, pz) => keys.has(`${Math.floor(px / CELL)},${Math.floor(pz / CELL)}`),
  };
}

// Outdoors. Not a room with a very long reverb — a room with none, which is a
// different thing and is why this is its own record rather than a big number.
export function outsideRoom() {
  return {
    kind: 'outside', id: 'outside', floor: -1, name: null, fin: DEFAULT_FINISH,
    area: 0, perimeter: 0, bbox: null, contains: () => false,
  };
}

export const isOutside = (room) => !room || room.kind === 'outside';

// ---------- what the furniture absorbs ----------

// The face a prop presents to the room: its plan footprint if it stands on the
// floor or hangs from the ceiling, its elevation if it is on a wall. Scaled
// props scale their area by the square, the same rule lights.js uses for
// lumens.
export function propFace(entry, prop) {
  const scale = prop && prop.scale > 0 ? prop.scale : 1;
  const w = entry.w || 1;
  const other = entry.mount === 'wall' ? (entry.h || 1) : (entry.d || 1);
  return w * other * scale * scale;
}

export function propAlpha(entry) {
  if (!entry) return DEFAULT_PROP_ALPHA;
  if (typeof entry.absorb === 'number') return clamp(entry.absorb, 0, 1);
  const byCat = CATEGORY_ALPHA[entry.category];
  return typeof byCat === 'number' ? byCat : DEFAULT_PROP_ALPHA;
}

// Total sabins standing in a room. `catalogEntry` is passed in for the reason
// it always is here: this module has no opinion about where prop types come
// from, and a test can hand it a table of three rows.
export function furnitureSabins(state, room, catalogEntry) {
  if (!state || !Array.isArray(state.props) || isOutside(room)) return { sabins: 0, count: 0 };
  let sabins = 0, count = 0;
  for (const p of propsOnFloor(state, room.floor)) {
    if (!room.contains(p.x, p.z)) continue;
    const entry = catalogEntry(p.type);
    if (!entry) continue;
    sabins += propFace(entry, p) * propAlpha(entry);
    count++;
  }
  return { sabins, count };
}

// ---------- the equation ----------

export function sabineRT60(volume, sabins) {
  if (!(volume > 0) || !(sabins > 0)) return 0;
  return clamp((SABINE * volume) / sabins, MIN_RT60, MAX_RT60);
}

// ANSI/ASA S12.60's reverberation limit for a core learning space, or null
// above the volume the standard stops giving one for. Reported rather than
// enforced — the tool says what the number is and what the standard asks for,
// and leaves the argument to the designer.
export function ansiLimit(volume) {
  if (!(volume > 0)) return null;
  if (volume <= 10000) return 0.6;
  if (volume <= 20000) return 0.7;
  return null;
}

// A word for a number, for the readout. The bands are the speech-intelligibility
// ones, not musical ones: this is a building where people have to hear a
// teacher from thirty feet away.
export function verdict(rt60) {
  if (!(rt60 > 0)) return 'Open air';
  if (rt60 < 0.35) return 'Dead';
  if (rt60 < 0.65) return 'Crisp';
  if (rt60 < 1.0) return 'Lively';
  if (rt60 < 1.8) return 'Reverberant';
  return 'Echoey';
}

// Everything about the room under a point, in one call. Same shape of promise
// `skyState` makes: nothing downstream has to remember the order the pieces go
// together in.
export function roomAcoustics(state, floorIndex, x, z, catalogEntry = () => null) {
  const room = roomAt(state, floorIndex, x, z);
  if (isOutside(room)) {
    return {
      ...room, height: 0, storeys: 0, openCeiling: true, openFraction: 1,
      volume: 0, surface: 0,
      sabins: 0, meanAlpha: 0, rt60: 0, mfp: 0, criticalDist: Infinity,
      limit: null, overLimit: false, verdict: verdict(0), props: 0,
      surfaces: [],
    };
  }

  const ceil = roomCeiling(state, floorIndex, room);
  const volume = room.area * ceil.height;
  const wallArea = room.perimeter * ceil.height;
  // Mixed on the evidence rather than picked by a threshold: a hall that is a
  // third open to the structure above is a third deck and two thirds tile.
  const ceilAlpha = ALPHA.tile + (ALPHA.deck - ALPHA.tile) * ceil.openFraction;
  const floorAlpha = finishAlpha(room.fin);
  const furniture = furnitureSabins(state, room, catalogEntry);

  const ceilingName = ceil.openFraction >= 0.999 ? 'Ceiling (open deck)'
    : (ceil.openFraction > 0
      ? `Ceiling (${Math.round(ceil.openFraction * 100)}% open)`
      : 'Ceiling (tile)');
  const surfaces = [
    { what: 'Floor', area: room.area, alpha: floorAlpha },
    { what: ceilingName, area: room.area, alpha: ceilAlpha },
    { what: 'Walls', area: wallArea, alpha: ALPHA.wall },
  ];
  let sabins = 0;
  for (const s of surfaces) sabins += s.area * s.alpha;
  sabins += furniture.sabins;
  if (furniture.count) {
    surfaces.push({ what: `Furniture (${furniture.count})`, area: 0, alpha: 0, sabins: furniture.sabins });
  }

  // Total boundary area, which the mean free path and the room constant both
  // want. Furniture doesn't add boundary — it absorbs from inside the volume.
  const surface = room.area * 2 + wallArea;
  const meanAlpha = surface > 0 ? clamp(sabins / surface, 0, 0.99) : 0;
  // Mean free path: the average distance a ray travels between reflections in
  // any convex-ish room is 4V/S. It is what the pre-delay is.
  const mfp = surface > 0 ? (4 * volume) / surface : 0;
  // Room constant and critical distance. Past `criticalDist` from a source you
  // are hearing the room rather than the source, which is exactly the number a
  // reverb send wants (see `wetFraction`).
  const R = meanAlpha < 0.99 ? sabins / (1 - meanAlpha) : sabins;
  const criticalDist = R > 0 ? 0.141 * Math.sqrt(R) : Infinity;

  const rt60 = sabineRT60(volume, sabins);
  const limit = ansiLimit(volume);

  return {
    ...room,
    height: ceil.height,
    storeys: ceil.storeys,
    openCeiling: ceil.open,
    openFraction: ceil.openFraction,
    volume, surface, wallArea,
    sabins, meanAlpha, mfp, criticalDist,
    rt60, limit,
    overLimit: limit !== null && rt60 > limit,
    verdict: verdict(rt60),
    props: furniture.count,
    surfaces,
  };
}

// ---------- what the convolver needs ----------

// How much of a source at `dist` feet arrives as room rather than as source.
// Direct sound falls off with the square of distance; the reverberant field
// doesn't fall off at all, so their ratio is (d/dc)^2 and the wet share is
// that over one plus itself. Real, bounded, monotone, and three lines.
export function wetFraction(ac, dist) {
  if (!ac || !(ac.rt60 > 0) || !(ac.criticalDist > 0) || !Number.isFinite(ac.criticalDist)) return 0;
  const r = Math.max(0.5, dist) / ac.criticalDist;
  const q = r * r;
  return clamp(q / (1 + q), 0, 0.92);
}

// The reverb itself: how long the tail is, how long before it starts, and how
// dark it is. `hf` is the corner the tail rolls off above — a room lined in
// soft absorptive surfaces loses its highs first, which is why a carpeted
// library sounds muffled and a tiled restroom sounds like knives.
export function reverbSpec(ac) {
  if (!ac || !(ac.rt60 > 0)) return { rt60: 0, predelay: 0, hf: 18000, size: 0 };
  const predelay = clamp(ac.mfp / SPEED_OF_SOUND, 0.002, 0.09);
  const hf = clamp(9000 - ac.meanAlpha * 14000, 1200, 9000);
  return {
    rt60: ac.rt60,
    predelay,
    hf,
    // A 0..1 "how big is this" handle, for anything that wants one number.
    size: clamp(Math.cbrt(ac.volume / 100000), 0, 1),
  };
}

// ---------- a floor's worth, for a roll-up ----------

// Every distinct room on one storey, each with its acoustics. Used by nothing
// in the walkthrough — this is the reader Phase 7's report will want, and it
// exists now because writing it is a loop over what is already here.
export function roomsOnFloor(state, floorIndex, catalogEntry = () => null) {
  const floor = state && state.floors ? state.floors[floorIndex] : null;
  if (!floor) return [];
  const out = [];
  const seen = new Set();
  const add = (x, z) => {
    const ac = roomAcoustics(state, floorIndex, x, z, catalogEntry);
    if (isOutside(ac) || seen.has(ac.id)) return null;
    seen.add(ac.id);
    out.push(ac);
    return ac;
  };
  for (const shape of shapesOf(floor)) {
    // `interiorPoint` rather than a centroid: a concave wing's centroid can sit
    // in the notch, and a point outside the room finds the wrong room.
    const p = interiorPoint(shape);
    add(p.x, p.z);
  }
  // The grid pass floods each region once and marks its cells off, so this is
  // linear in cells rather than one flood per cell.
  const done = new Set();
  for (let y = 0; y < floor.h; y++) {
    for (let x = 0; x < floor.w; x++) {
      const i = cellIdx(floor, x, y);
      if (done.has(i) || !getCell(floor, x, y)) continue;
      for (const c of floodRegion(floor, x, y)) done.add(cellIdx(floor, c.x, c.y));
      add((x + 0.5) * CELL, (y + 0.5) * CELL);
    }
  }
  return out;
}
