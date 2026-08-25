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
// The autosave key is deliberately unchanged so an in-progress design survives
// the upgrade — that was true of the v2 bump and stays true here.
//
// Phase 7 adds named save slots (see "named save slots" below) alongside the
// autosave and the file-based Save/Load — a separate localStorage index, not
// a save-format change, so nothing here invalidates an older file or an
// in-progress autosave.

import { CELL, FLOOR_H, MAX_FLOORS, EDGE_KINDS, createFloor, createState } from './grid.js';
import { normalizeProp, normalizeLink, reseedIds, MAX_PROPS, MAX_LINKS } from './props.js';
import { normalizeShape, MAX_SHAPES } from './shapes.js';
import { readFinish, readPaint } from './finish.js';
import { normalizeEnv, isDefaultEnv } from './sky.js';
import { normalizeTerrain, packTerrain } from './terrain.js';
import { normalizeRegion, MAX_REGIONS } from './site.js';
import { normalizeRoof, isDefaultRoof } from './roof.js';
import { normalizeLife, isDefaultLife } from './agents.js';
import { normalizeOverlay } from './overlay.js';

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
const AUTOSAVE_KEY = 'school-generator-autosave-v1';
export const SAVE_VERSION = 9;

const MIN_DIM = 4;
const MAX_DIM = 200;

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
  return JSON.stringify(out);
}

const clampDim = (v) => Math.min(MAX_DIM, Math.max(MIN_DIM, Math.floor(v)));

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

// One floor record out of whatever the file offered for it.
function readFloor(raw, w, h) {
  const f = createFloor(w, h);
  if (raw && typeof raw === 'object') {
    copyCells(raw.cells, f.cells);
    copyEdges(raw.edgesH, f.edgesH);
    copyEdges(raw.edgesV, f.edgesV);
    if (Array.isArray(raw.shapes)) {
      for (const rs of raw.shapes.slice(0, MAX_SHAPES)) {
        // Polygon rooms are unbounded by the footprint on purpose — a wing can
        // stick out past the lattice — so they're clamped to a sane extent
        // rather than to w x h.
        const shape = normalizeShape(rs, Math.max(w, h) * CELL * 4);
        if (shape) f.shapes.push(shape);
      }
    }
  }
  return f;
}

// Validate + normalize loaded data; returns a state object or throws.
export function deserialize(json) {
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
  state.floors = (rawFloors.length ? rawFloors : [null]).map((rf) => readFloor(rf, w, h));

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
  // v8's population settings, on the same terms as everything above: an
  // unreadable one is the default one, and a file from before v8 simply has
  // the default school in it.
  const life = normalizeLife(d.life);
  if (!isDefaultLife(life)) state.life = life;
  // v9, on the same terms as everything above it: an unreadable overlay is a
  // design with no overlay, never a design that won't open. An image type this
  // build can't decode, a data URL over the size cap, a missing pixel size —
  // all of them land here as null.
  const overlay = normalizeOverlay(d.overlay);
  if (overlay) state.overlay = overlay;

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
  // Site regions take ids off the same counter everything else does, so a
  // region and a room can never collide.
  for (const r of (state.site ? state.site.regions : [])) {
    if (!r.id || r.id >= state.nextId) r.id = state.nextId++;
  }
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

export function loadFromFile(file) {
  return file.text().then((text) => deserialize(text));
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

export function loadAutosave() {
  try {
    const json = localStorage.getItem(AUTOSAVE_KEY);
    return json ? deserialize(json) : null;
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

export function loadDesign(id) {
  let json = null;
  try { json = localStorage.getItem(SLOT_PREFIX + id); } catch (e) { /* ignore */ }
  if (!json) throw new Error('That saved design is missing, or was deleted in another tab.');
  return deserialize(json);
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
