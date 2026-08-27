// save-load.js — JSON serialization, file download/upload, localStorage autosave.
//
// Save format history:
//   v1 — single floor, flat { w, h, cells, edgesH, edgesV }
//   v2 — { floors: [...], currentFloor, props, links } on a shared footprint
//   v3 — floors carry `shapes[]`: polygon rooms alongside the cell grid
//   v4 — glass and railing edge/segment kinds, and `links[]` carrying stairs
//        and floor openings
//   v5 — doors and windows as opening variants (leaves, sills, hands), the
//        cased-opening / window / double-door lattice kinds, room finishes
//        (`fin`/`paint` on cells and shapes), and ramp/elevator links
//   v6 — `env`: the date, hour, latitude, compass orientation and interior-
//        light mode the design is lit by (see sky.js)
//   v7 — the site: `terrain` (a graded heightfield, see terrain.js), `site`
//        (hardscape and field regions with their surfaces and markings, see
//        site.js) and `roof` (style, pitch and facade material, see roof.js)
//   v8 — `life`: how many people are in the building and the seed that puts
//        them there (see agents.js)
//   v9 — `overlay`: a scaled tracing image under the plan (see overlay.js)
//   v10 — `tours` (recorded camera paths, see tour.js) and `models` (imported
//        glTF files wearing catalog rows, see models.js)
//   v11 — **the first bump that changes a shape rather than adding to one.**
//        A floor no longer carries `cells`, `edgesH` or `edgesV`: every room
//        is a polygon with an id (see lattice.js and shapes.js). A room record
//        grows `group` and `load`, and the design grows `code` — the two
//        questions Phase 7's analysis had nowhere to keep an answer to.
//   v11+ — `timetable`: the school day this building is for — cohorts,
//        teachers and one section per group per period, each bound to a room
//        by the id v11 gave it (see timetable.js). An *append* to v11 rather
//        than a bump of its own, which is Phase 5's lesson applied on purpose:
//        a v11 file with no timetable in it reads identically either way, and
//        a v11 file with one opens in a build that predates it as the same
//        building minus a school day.
//   v11+ — `rates` (the unit prices this design was costed against — dated,
//        sourced, editable, see rates.js) and `phasing` (what gets built and
//        in what order, as an ordered list of room ids, see phasing.js). Two
//        more appends on the same terms as the timetable, and for the same
//        reason: a rate table is a fact *about this design* — the prices that
//        produced this estimate are half of what the estimate means — and a
//        phasing plan is a set of references to rooms v11 gave ids to.
//
// Older files keep loading forever: a v1 or v2 design is simply one with no
// polygon rooms in it, a v3 one has no glass and no stairs, a v4 one has no
// windows, no door leaves and no finishes, and a v5 one is a building that
// never said what time of day it was — so every migration so far is additive
// and nothing has to be guessed.
//
// The v5 bump is additive in an unusually strict sense, worth stating because
// it is what keeps this cheap: every field it adds is *optional with a default
// equal to v4's behaviour*, and `writeOpening` only records a field that
// differs from that default. So a v4 design doesn't merely still load — it
// round-trips through v5 as the same bytes it went in as, minus nothing.
//
// The one thing v5 changes about an old design's *behaviour* is deliberate: an
// `EDGE_DOOR` that was a hole in a wall now hangs a leaf that swings, because
// that is the phase. Nothing about the file changed; the building simply has
// doors in it now. A design that wants the hole back says `EDGE_OPENING`.
//
// v6 keeps that bargain and takes the same shortcut: `env` is written only
// when it differs from the default, so a v5 design still round-trips as the
// same bytes, and the default environment is by construction the light the
// fixed pre-Phase-3 rig drew with. Opening an old file changes nothing about
// how it looks; it just gains a clock you can now move.
//
// v7 keeps the same bargain for the third time, and it is worth noting how
// little it costs: `terrain` is written only when something has been graded,
// `site` only when a region has been drawn, and `roof` only when it differs
// from the default — so a v6 design still round-trips as the same bytes.
//
// It does change one thing about how an old design *looks*, deliberately and
// for the second time in this arc: the default roof is a parapet, so a
// building that used to stop dead at its wall tops now has a cap on it. Same
// call the v5 bump made when an `EDGE_DOOR` that was a hole started hanging a
// leaf. Nothing about the file changed; the building simply has a roof now. A
// design that wants the old silhouette back says `roof: { style: 'flat' }`.
//
// ## The v11 migration
//
// Ten versions of "read the extra field if it is there" end here, and the
// promise this file has kept since v5 — that an older design round-trips as
// the same bytes it went in as — cannot be kept across it. What replaces it is
// the promise that actually mattered: **an older design opens as the same
// building.**
//
// A pre-v11 floor's cells and edges are read onto a scratch lattice and baked
// (see lattice.js): one flood region becomes one room, walls merge into runs,
// every lattice opening kind becomes an opening at a point along the run it
// sat in, and each partition is built by exactly one of the two rooms it
// divides. Baked rooms go *under* the file's own polygon rooms, which is where
// the lattice always sat, so a room drawn on top of the grid is still on top
// of it.
//
// One thing does not survive, and `deserialize` reports it rather than hiding
// it: a lattice wall with no room on either side. It is the only thing the
// polygon model cannot say, and the count comes back through `opts.onMigrate`
// so a caller can tell somebody how many.
//
// The autosave key is deliberately unchanged so an in-progress design survives
// the upgrade — that was true of the v2 bump and stays true here.
//
// Phase 7 adds named save slots (see "named save slots" below) alongside the
// autosave and the file-based Save/Load — a separate localStorage index, not
// a save-format change, so nothing here invalidates an older file or an
// in-progress autosave.

import {
  CELL, FLOOR_H, MAX_FLOORS, MIN_CELLS, MAX_CELLS, createFloor, createState,
} from './grid.js';
import { EDGE_KINDS, createLattice, bake } from './lattice.js';
import { normalizeCode, isDefaultCode } from './occupancy.js';
import { normalizeProp, normalizeLink, reseedIds, MAX_PROPS, MAX_LINKS } from './props.js';
import { normalizeShape, MAX_SHAPES } from './shapes.js';
import { normalizeWallLines } from './wallrun.js';
import { readFinish, readPaint } from './finish.js';
import { normalizeEnv, isDefaultEnv } from './sky.js';
import { normalizeTerrain, packTerrain } from './terrain.js';
import { normalizeRegion, MAX_REGIONS } from './site.js';
import { normalizeRoof, isDefaultRoof } from './roof.js';
import { normalizeLife, isDefaultLife } from './agents.js';
import { normalizeOverlay } from './overlay.js';
import { normalizeTours } from './tour.js';
import { normalizeModels, librarySize } from './models.js';
import { normalizeTimetable, isEmptyTimetable } from './timetable.js';
import { normalizeRates, isEmptyRates } from './rates.js';
import { normalizePhasing, isEmptyPhasing } from './phasing.js';
import { normalizeHaunt, isDefaultHaunt } from './haunt.js';

// v9 is the first bump that is not free.
//
// Every version before it added fields measured in bytes: an environment is
// six numbers, a roof is three, a whole graded heightfield packs into a few
// kilobytes. `overlay` carries an image, as a data URL, and an image is
// megabytes. The bargain the format has kept since v5 — an older design
// round-trips as the same bytes it went in as — still holds, because a design
// with no tracing paper in it records no `overlay`. What changes is that a
// design *with* one can now be large enough that localStorage refuses it, and
// that has to be handled rather than hoped about: see `serialize`'s
// `omitOverlay` and the retry in `autosaveNow`.
//
// The alternative was keeping the image outside the file, in its own
// localStorage key, and referring to it by id. That keeps saves small and
// makes a design you email somebody arrive without the drawing they traced —
// which is the wrong half to lose.
// v10 adds the second and third records that carry weight, and splits them
// deliberately. `tours` is a handful of numbers per stop — free, in the sense
// every version before v9 was free. `models` is the opposite: glTF files as
// data URLs, which is the same problem the overlay posed and gets the same
// answer, one hatch wider. `serialize` now takes `{ omitOverlay, omitModels }`
// and the autosave sheds them in that order — the picture first, because a
// design without its tracing paper is still the design, and the furniture
// only if it must be.
//
// A design that has shed its models on the way into localStorage still has
// the *props* placed from them: props.js has always let an unknown type
// survive a round trip untouched, so re-importing the same file under the
// same id brings a room's worth of chairs back rather than leaving holes.
const AUTOSAVE_KEY = 'school-generator-autosave-v1';
export const SAVE_VERSION = 12;

// The drawing surface's range. grid.js owns it since Phase 13, because the
// editor can resize a design now and a file has to be read against the same
// two numbers the editor writes against.
const MIN_DIM = MIN_CELLS;
const MAX_DIM = MAX_CELLS;

// Everything a design hasn't actually used is left out. The rule is one rule,
// applied four times now — a plain doorway records no options, a mid-morning
// records no environment, a level site records no terrain, a bare site records
// no regions and an ordinary roof records no roof — and it is the whole reason
// a file from an older build survives a round trip through a newer one
// unchanged.
export function serialize(state, opts = {}) {
  if (!state) return JSON.stringify(state);
  const out = { ...state };
  // Whatever a state in memory says it is, what goes in the file is what this
  // build writes. A design loaded from v3 and edited is a v9 design.
  out.version = SAVE_VERSION;
  if (!out.env || isDefaultEnv(out.env)) delete out.env;
  const packed = packTerrain(out.terrain);
  if (packed) out.terrain = packed; else delete out.terrain;
  if (!out.site || !Array.isArray(out.site.regions) || !out.site.regions.length) delete out.site;
  if (isDefaultRoof(out.roof)) delete out.roof;
  // v8: how many people are in the building, and the seed that puts them
  // there. Never the people themselves — see agents.js.
  if (isDefaultLife(out.life)) delete out.life; else out.life = normalizeLife(out.life);
  // v9's tracing image. `omitOverlay` is the escape hatch for the one caller
  // that has somewhere too small to put it — the autosave, which would rather
  // keep the design without the picture than lose both.
  const overlay = opts.omitOverlay ? null : normalizeOverlay(out.overlay);
  if (overlay) out.overlay = overlay; else delete out.overlay;
  // v10's two. A design with no recorded tour and no imported model writes
  // neither key, so a v9 file still round-trips as the same bytes it went in
  // as — the fifth time that promise has been kept.
  const tours = normalizeTours(out.tours);
  if (tours.length) out.tours = tours; else delete out.tours;
  const models = opts.omitModels ? [] : normalizeModels(out.models);
  if (models.length) out.models = models; else delete out.models;
  // v11's one design-wide record, on the same terms as the nine above it: a
  // building nobody has answered a code question about writes no `code` key.
  if (isDefaultCode(out.code)) delete out.code; else out.code = normalizeCode(out.code);
  // Phase 15's append, and the eleventh time the same rule has been applied: a
  // design with no school day in it writes no `timetable` key, so every file
  // written before this build round-trips through it as the same bytes.
  const timetable = normalizeTimetable(out.timetable);
  if (isEmptyTimetable(timetable)) delete out.timetable; else out.timetable = timetable;
  // Phase 16's two, and the twelfth and thirteenth times the same rule has
  // been applied: a design nobody has priced writes no `rates` key and a
  // design nobody has phased writes no `phasing` key, so every file written
  // before this build still round-trips through it as the same bytes.
  const rates = normalizeRates(out.rates);
  if (isEmptyRates(rates)) delete out.rates; else out.rates = rates;
  const phasing = normalizePhasing(out.phasing);
  if (isEmptyPhasing(phasing)) delete out.phasing; else out.phasing = phasing;
  // v12's one record, the cheap append kind, and the fourteenth application
  // of the one rule: a building nobody has haunted writes no `haunt` key, so
  // every file written before this build round-trips through it unchanged.
  const haunt = normalizeHaunt(out.haunt);
  if (isDefaultHaunt(haunt)) delete out.haunt; else out.haunt = haunt;
  // Phase 25, and the fifteenth application of the same rule — the first one
  // that is per *storey* rather than design-wide: a level with no
  // free-standing walls writes no `walls` key, so every file written before
  // this build round-trips through it as the same bytes. Copied rather than
  // deleted in place — `out` is a shallow spread and its floors are the live
  // records the editor is still holding.
  if (Array.isArray(out.floors) && out.floors.some((f) => f && f.walls && !f.walls.length)) {
    out.floors = out.floors.map((f) => {
      if (!f || !f.walls || f.walls.length) return f;
      const { walls, ...rest } = f;
      return rest;
    });
  }
  return JSON.stringify(out);
}

const clampDim = (v) => Math.min(MAX_DIM, Math.max(MIN_DIM, Math.floor(v)));

// A pre-v11 floor's cells, onto the scratch lattice they are about to be baked
// off. The record is the same four fields it always was; it now lives for
// exactly as long as the migration does.
function copyCells(src, dst) {
  if (!Array.isArray(src)) return;
  for (let i = 0; i < Math.min(src.length, dst.length); i++) {
    const c = src[i];
    if (!c || typeof c !== 'object') continue;
    dst[i] = {
      room: typeof c.room === 'string' ? c.room.slice(0, 60) : null,
      color: typeof c.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.color) ? c.color : null,
      // Phase 2's finishes. An unknown finish key reads as null — the room
      // falls back to the default material rather than to no floor at all.
      fin: readFinish(c.fin),
      paint: readPaint(c.paint),
    };
  }
}

function copyEdges(src, dst) {
  if (!Array.isArray(src)) return;
  for (let i = 0; i < Math.min(src.length, dst.length); i++) {
    // An edge kind this build doesn't know is kept as a plain wall rather than
    // dropped: losing it would open a room up, which is the worse of the two
    // ways to be wrong about a file from a newer version.
    dst[i] = EDGE_KINDS.includes(src[i]) ? src[i] : (src[i] ? 1 : 0);
  }
}

// One floor record out of whatever the file offered for it, plus the scratch
// lattice a pre-v11 file wants baking — or null if it has not got one.
function readFloor(raw, w, h) {
  const f = createFloor(w, h);
  let lat = null;
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.cells) || Array.isArray(raw.edgesH) || Array.isArray(raw.edgesV)) {
      lat = createLattice(w, h);
      copyCells(raw.cells, lat.cells);
      copyEdges(raw.edgesH, lat.edgesH);
      copyEdges(raw.edgesV, lat.edgesV);
    }
    if (Array.isArray(raw.shapes)) {
      for (const rs of raw.shapes.slice(0, MAX_SHAPES)) {
        // Rooms are unbounded by the footprint on purpose — a wing can stick
        // out past the drawing surface — so they are clamped to a sane extent
        // rather than to w x h.
        const shape = normalizeShape(rs, Math.max(w, h) * CELL * 4);
        if (!shape) continue;
        // shapes.js validates a finish by shape rather than against finish.js's
        // table, so that it stays a module that imports only the grid. The
        // table lives here, so this is where an unknown key becomes null — the
        // room falls back to the default material rather than to no floor at
        // all, which is the promise the cell path used to keep.
        shape.fin = readFinish(shape.fin);
        shape.paint = readPaint(shape.paint);
        f.shapes.push(shape);
      }
    }
    // Phase 25's one append: walls drawn between two points that are not the
    // side of any room (see wallrun.js). Absent from every file written before
    // it, and absent again from any design nobody has drawn one on.
    const lines = normalizeWallLines(raw.walls, Math.max(w, h) * CELL * 4);
    if (lines.length) f.walls = lines;
  }
  return { floor: f, lat };
}

// Validate + normalize loaded data; returns a state object or throws.
// `opts.onMigrate(info)` is called once when a pre-v11 file was baked, with
// `{ from, rooms, orphans }` — which version it came from, how many rooms came
// out of the lattice, and how many built boundaries had no room on either side
// to belong to and so could not come with them.
export function deserialize(json, opts = {}) {
  const d = typeof json === 'string' ? JSON.parse(json) : json;
  if (!d || typeof d !== 'object') throw new Error('Not a school-generator save file');

  // v1 has its single floor's arrays inline; v2 has a floors array.
  const legacy = !Array.isArray(d.floors);
  if (typeof d.w !== 'number' || typeof d.h !== 'number') {
    throw new Error('Not a school-generator save file');
  }
  const w = clampDim(d.w);
  const h = clampDim(d.h);

  const state = createState(w, h);
  state.floorHt = typeof d.floorHt === 'number' && d.floorHt > 0
    ? Math.min(60, Math.max(CELL, d.floorHt))
    : FLOOR_H;

  const rawFloors = legacy ? [d] : d.floors.slice(0, MAX_FLOORS);
  const read = (rawFloors.length ? rawFloors : [null]).map((rf) => readFloor(rf, w, h));
  state.floors = read.map((r) => r.floor);

  const top = state.floors.length - 1;
  state.currentFloor = typeof d.currentFloor === 'number'
    ? Math.min(top, Math.max(0, Math.floor(d.currentFloor)))
    : 0;

  // Phase 3's environment. `normalizeEnv` never fails and never returns null,
  // so a file with no `env`, a hostile one, or one from a build that spelled it
  // differently all land on the default mid-morning rather than on a design
  // that can't be lit.
  state.env = normalizeEnv(d.env);

  // The site. All three are optional and all three fail *safe*: an unreadable
  // terrain is a level one, an unreadable region is one that isn't there, and
  // an unreadable roof is the default one. None of them can stop a design from
  // loading, which is the same promise `normalizeEnv` makes about the sky.
  const terrain = normalizeTerrain(d.terrain);
  if (terrain) state.terrain = terrain;
  if (d.site && Array.isArray(d.site.regions)) {
    const extent = Math.max(w, h) * CELL * 8;
    const regions = [];
    for (const raw of d.site.regions.slice(0, MAX_REGIONS)) {
      const region = normalizeRegion(raw, extent);
      if (region) regions.push(region);
    }
    if (regions.length) state.site = { regions };
  }
  const roof = normalizeRoof(d.roof);
  if (!isDefaultRoof(roof)) state.roof = roof;
  // v11's code settings: which edition the analysis is read against, and
  // whether the building is sprinklered. Absent means the defaults, which are
  // what every reader assumed before there was anywhere to say otherwise.
  const code = normalizeCode(d.code);
  if (!isDefaultCode(code)) state.code = code;
  // Phase 15's timetable, on the same terms as everything above it: a section
  // that names a cohort the file doesn't contain is dropped by
  // `normalizeTimetable`, and an unreadable timetable is a design with no
  // school day rather than a design that won't open.
  const timetable = normalizeTimetable(d.timetable);
  if (!isEmptyTimetable(timetable)) state.timetable = timetable;
  // Phase 16's two, on the same terms as everything above them. A rate row
  // keyed on an assembly this build has never heard of is *kept* — it is
  // somebody's typed-in number, and dropping it would be the one unrecoverable
  // thing a loader can do. A phase naming a room the file doesn't contain is
  // dropped instead, because a reference to nothing is not data.
  const rates = normalizeRates(d.rates);
  if (!isEmptyRates(rates)) state.rates = rates;
  const phasing = normalizePhasing(d.phasing);
  if (!isEmptyPhasing(phasing)) state.phasing = phasing;
  // v8's population settings, on the same terms as everything above: an
  // unreadable one is the default one, and a file from before v8 simply has
  // the default school in it.
  const life = normalizeLife(d.life);
  if (!isDefaultLife(life)) state.life = life;
  // v12's haunt, on the same terms: an unreadable haunt is a building with
  // no haunt in it, never a design that won't open.
  const haunt = normalizeHaunt(d.haunt);
  if (!isDefaultHaunt(haunt)) state.haunt = haunt;
  // v9, on the same terms as everything above it: an unreadable overlay is a
  // design with no overlay, never a design that won't open. An image type this
  // build can't decode, a data URL over the size cap, a missing pixel size —
  // all of them land here as null.
  const overlay = normalizeOverlay(d.overlay);
  if (overlay) state.overlay = overlay;
  // v10, on the same terms as the eight optional records above it: an
  // unreadable tour is a design with no tour in it, and an unreadable model
  // is one import fewer, never a design that won't open.
  const tours = normalizeTours(d.tours);
  if (tours.length) state.tours = tours;
  const models = normalizeModels(d.models);
  if (models.length) state.models = models;

  if (Array.isArray(d.props)) {
    for (const raw of d.props.slice(0, MAX_PROPS)) {
      const p = normalizeProp(raw, state.floors.length);
      if (p) state.props.push(p);
    }
  }
  if (Array.isArray(d.links)) {
    for (const raw of d.links.slice(0, MAX_LINKS)) {
      const l = normalizeLink(raw, state.floors.length);
      if (l) state.links.push(l);
    }
  }
  // Ids from the file win; new placements continue past the highest one.
  reseedIds(state);
  for (const p of state.props) if (!p.id) p.id = state.nextId++;
  for (const l of state.links) if (!l.id) l.id = state.nextId++;
  for (const f of state.floors) for (const sh of f.shapes) if (!sh.id) sh.id = state.nextId++;
  for (const f of state.floors) for (const l of f.walls || []) if (!l.id) l.id = state.nextId++;
  // Site regions take ids off the same counter everything else does, so a
  // region and a room can never collide.
  for (const r of (state.site ? state.site.regions : [])) {
    if (!r.id || r.id >= state.nextId) r.id = state.nextId++;
  }
  // A tour is an object with an id, the way a polygon room and a prop are,
  // and off the same counter — so the tour list and the room list can never
  // name the same number.
  for (const t of (state.tours || [])) {
    if (!t.id || t.id >= state.nextId) t.id = state.nextId++;
  }

  // ...and only now the migration, because a baked room takes its id off the
  // same counter and every id already in the file has to be spoken for first.
  let migrated = null;
  read.forEach((r, i) => {
    if (!r.lat) return;
    // Baked rooms go under the file's own polygon rooms, which is where the
    // lattice always sat: a room drawn over the grid is still drawn over it.
    const drawn = r.floor.shapes;
    r.floor.shapes = [];
    const out = bake(state, i, r.lat);
    r.floor.shapes.push(...drawn);
    if (!migrated) {
      migrated = { from: Number.isFinite(d.version) ? d.version : 1, rooms: 0, orphans: 0 };
    }
    migrated.rooms += out.shapes.length;
    migrated.orphans += out.orphans;
  });
  if (migrated && typeof opts.onMigrate === 'function') opts.onMigrate(migrated);
  return state;
}

export function downloadSave(state, filename = 'school.json') {
  const blob = new Blob([serialize(state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function loadFromFile(file, opts = {}) {
  return file.text().then((text) => deserialize(text, opts));
}

let autosaveTimer = null;
// Write the design, and if the browser won't take it, write it again without
// the tracing image. Returns what actually happened, so a caller can say
// "autosaved without the overlay — it's too big for this browser's storage"
// rather than leaving somebody to discover it after a reload.
//
//   'full'    the whole design, overlay included
//   'partial' the design, with the overlay dropped to make it fit
//   'failed'  storage refused both, or is blocked entirely
function writeAutosave(state) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, serialize(state));
    return 'full';
  } catch (e) { /* fall through — usually QuotaExceededError */ }
  try {
    localStorage.setItem(AUTOSAVE_KEY, serialize(state, { omitOverlay: true }));
    return state && state.overlay ? 'partial' : 'failed';
  } catch (e) { /* fall through — the models are the other heavy record */ }
  try {
    localStorage.setItem(AUTOSAVE_KEY, serialize(state, { omitOverlay: true, omitModels: true }));
    const shed = state && (state.overlay || librarySize(state.models));
    return shed ? 'partial' : 'failed';
  } catch (e) {
    return 'failed';
  }
}

export function autosave(state, onResult = null) {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    const result = writeAutosave(state);
    if (onResult) onResult(result);
  }, 400);
}

export function autosaveNow(state) {
  clearTimeout(autosaveTimer);
  return writeAutosave(state);
}

export function loadAutosave(opts = {}) {
  try {
    const json = localStorage.getItem(AUTOSAVE_KEY);
    return json ? deserialize(json, opts) : null;
  } catch (e) {
    return null;
  }
}

export function clearAutosave() {
  try { localStorage.removeItem(AUTOSAVE_KEY); } catch (e) { /* ignore */ }
}

// ---------- named save slots ----------
//
// The autosave above is a single scratch buffer — whatever you're looking at
// right now, keyed the same way since v1 so an in-progress design always
// survives a reload. Slots are a library on top of it: any number of named
// designs, each its own localStorage entry, so you can park a finished
// building and start a different one without the file-download/upload round
// trip. A slot is metadata (id, name, updatedAt) plus its own JSON blob under
// a per-slot key — listing designs never has to parse every design to do it.

const SLOTS_KEY = 'school-generator-slots-v1';
const SLOT_PREFIX = 'school-generator-slot-';
export const MAX_SLOTS = 30;
const MAX_SLOT_NAME = 60;

function readSlotIndex() {
  try {
    const raw = localStorage.getItem(SLOTS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr.filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string');
  } catch (e) {
    return [];
  }
}

function writeSlotIndex(list) {
  try { localStorage.setItem(SLOTS_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
}

// Newest first — the design you just touched is the one you're most likely
// to want back.
export function listDesigns() {
  return readSlotIndex().sort((a, b) => b.updatedAt - a.updatedAt);
}

function newSlotId() {
  return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Save `state` into a slot: a new one if `id` is omitted or unknown, an
// overwrite of the existing one otherwise. Returns the slot id, or throws if
// storage is full/blocked or the slot limit is reached (creating only —
// overwriting an existing slot never grows the list).
export function saveDesign(state, name, id = null) {
  const list = readSlotIndex();
  const trimmedName = (typeof name === 'string' && name.trim() ? name.trim() : 'Untitled').slice(0, MAX_SLOT_NAME);
  let slot = id ? list.find((s) => s.id === id) : null;
  if (!slot) {
    if (list.length >= MAX_SLOTS) {
      throw new Error(`You can keep up to ${MAX_SLOTS} saved designs — delete one first.`);
    }
    slot = { id: newSlotId(), name: trimmedName, updatedAt: 0 };
    list.push(slot);
  } else {
    slot.name = trimmedName;
  }
  slot.updatedAt = Date.now();
  // A named slot is a deliberate act, so it says so when the tracing image is
  // what didn't fit rather than quietly dropping it: an overlay is part of the
  // design, and somebody saving one under a name should know if it is gone.
  try {
    localStorage.setItem(SLOT_PREFIX + slot.id, serialize(state));
  } catch (e) {
    throw new Error(state && state.overlay
      ? 'Could not save — local storage is full. The tracing image is usually what fills it; ' +
        'remove it, or use Save to download the design as a file instead.'
      : 'Could not save — local storage may be full.');
  }
  writeSlotIndex(list);
  return slot.id;
}

export function loadDesign(id, opts = {}) {
  let json = null;
  try { json = localStorage.getItem(SLOT_PREFIX + id); } catch (e) { /* ignore */ }
  if (!json) throw new Error('That saved design is missing, or was deleted in another tab.');
  return deserialize(json, opts);
}

export function deleteDesign(id) {
  writeSlotIndex(readSlotIndex().filter((s) => s.id !== id));
  try { localStorage.removeItem(SLOT_PREFIX + id); } catch (e) { /* ignore */ }
}

export function renameDesign(id, name) {
  const list = readSlotIndex();
  const slot = list.find((s) => s.id === id);
  if (!slot) return false;
  slot.name = (typeof name === 'string' && name.trim() ? name.trim() : 'Untitled').slice(0, MAX_SLOT_NAME);
  writeSlotIndex(list);
  return true;
}
