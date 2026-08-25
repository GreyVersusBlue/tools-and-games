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
//
// Older files keep loading forever: a v1 or v2 design is simply one with no
// polygon rooms in it, a v3 one has no glass and no stairs, and a v4 one has
// no windows, no door leaves and no finishes — so every migration so far is
// additive and nothing has to be guessed.
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

const AUTOSAVE_KEY = 'school-generator-autosave-v1';
export const SAVE_VERSION = 5;

const MIN_DIM = 4;
const MAX_DIM = 200;

export function serialize(state) {
  return JSON.stringify(state);
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
export function autosave(state) {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, serialize(state));
    } catch (e) { /* storage full or blocked — skip */ }
  }, 400);
}

export function autosaveNow(state) {
  clearTimeout(autosaveTimer);
  try { localStorage.setItem(AUTOSAVE_KEY, serialize(state)); } catch (e) { /* ignore */ }
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
  try {
    localStorage.setItem(SLOT_PREFIX + slot.id, serialize(state));
  } catch (e) {
    throw new Error('Could not save — local storage may be full.');
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
