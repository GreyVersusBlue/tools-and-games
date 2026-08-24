// save-load.js — JSON serialization, file download/upload, localStorage autosave.
//
// Save format history:
//   v1 — single floor, flat { w, h, cells, edgesH, edgesV }
//   v2 — { floors: [...], currentFloor, props, links } on a shared footprint
//   v3 — floors carry `shapes[]`: polygon rooms alongside the cell grid
//
// Older files keep loading forever: a v1 or v2 design is simply one with no
// polygon rooms in it, so migration is additive and nothing has to be guessed.
// The autosave key is deliberately unchanged so an in-progress design survives
// the upgrade — that was true of the v2 bump and stays true here.

import { CELL, FLOOR_H, MAX_FLOORS, createFloor, createState } from './grid.js';
import { normalizeProp, normalizeLink, reseedIds, MAX_PROPS, MAX_LINKS } from './props.js';
import { normalizeShape, MAX_SHAPES } from './shapes.js';

const AUTOSAVE_KEY = 'school-generator-autosave-v1';
export const SAVE_VERSION = 3;

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
    };
  }
}

function copyEdges(src, dst) {
  if (!Array.isArray(src)) return;
  for (let i = 0; i < Math.min(src.length, dst.length); i++) {
    dst[i] = src[i] === 1 || src[i] === 2 ? src[i] : 0;
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
