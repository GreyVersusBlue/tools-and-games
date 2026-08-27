// props.js — the object layer: free-floating props and inter-floor links.
//
// Props live *beside* the cell grid, not in it. A prop's (x, z) are world feet
// with sub-cell precision, so furniture can sit anywhere; snapping to the grid,
// to a wall, or to another prop is an editor affordance (Phase 3), never a
// constraint baked into the data.
//
// Phase 1 is the layer itself — shape, identity, validation, floor bookkeeping.
// The prop *catalog* (desks, chairs, shelves, smart boards) and the placement
// tool that puts them on screen are Phase 3 and plug in above this file.

import { CELL, MAX_FLOORS } from './grid.js';

export const MAX_PROPS = 20000;
export const MAX_LINKS = 512;

// How a prop is anchored. Floor-standing is the default; wall/ceiling mounts
// exist so Phase 3 can hang a smart board or a projector without a second
// data model for "things that aren't on the ground".
export const MOUNTS = ['floor', 'wall', 'ceiling'];

// Inter-floor link kinds. Phase 4 (stairs, mezzanines) filled the first two
// in; Phase 2 of the second arc appends the accessible pair. Appending is the
// only safe move here — a link whose `type` this build doesn't recognize is
// dropped by `normalizeLink`, so the list has to grow rather than change.
export const LINK_TYPES = ['stair', 'opening', 'ramp', 'elevator'];

const nextId = (state) => {
  const id = Math.max(1, Math.floor(state.nextId || 1));
  state.nextId = id + 1;
  return id;
};

const num = (v, dflt, lo, hi) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : dflt;
  return Math.min(hi, Math.max(lo, n));
};

const intIn = (v, dflt, lo, hi) => Math.round(num(v, dflt, lo, hi));

const str = (v, dflt, max = 60) =>
  (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : dflt);

// Type-specific fields ride in `data` so the core shape stays fixed as the
// catalog grows. Scalars only, one level deep — enough for "chair color" or
// "shelf height", shallow enough to validate cheaply on load.
function cleanData(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  let n = 0;
  for (const k of Object.keys(raw)) {
    if (n >= 24) break;
    const v = raw[k];
    const t = typeof v;
    if (t === 'string') out[k.slice(0, 40)] = v.slice(0, 200);
    else if (t === 'boolean') out[k.slice(0, 40)] = v;
    else if (t === 'number' && Number.isFinite(v)) out[k.slice(0, 40)] = v;
    else continue;
    n++;
  }
  return out;
}

const TAU = Math.PI * 2;
export const wrapAngle = (a) => {
  const n = typeof a === 'number' && Number.isFinite(a) ? a % TAU : 0;
  return n < 0 ? n + TAU : n;
};

// Normalize any candidate prop (from a save file, a paste, or a tool) into the
// canonical shape. `floors` bounds the floor index; returns null if unusable.
export function normalizeProp(raw, floors = MAX_FLOORS, extentFt = 4000) {
  if (!raw || typeof raw !== 'object') return null;
  const type = str(raw.type, '', 40);
  if (!type) return null;
  const mount = MOUNTS.includes(raw.mount) ? raw.mount : 'floor';
  return {
    id: intIn(raw.id, 0, 0, Number.MAX_SAFE_INTEGER),
    type,
    floor: intIn(raw.floor, 0, 0, Math.max(0, floors - 1)),
    x: num(raw.x, 0, -extentFt, extentFt),
    z: num(raw.z, 0, -extentFt, extentFt),
    // Height above the prop's own floor slab — 0 for floor-standing items,
    // mount height for a wall-hung TV or a ceiling projector.
    y: num(raw.y, 0, -50, 200),
    rotationY: wrapAngle(raw.rotationY),
    scale: num(raw.scale, 1, 0.05, 20),
    mount,
    data: cleanData(raw.data),
  };
}

export function normalizeLink(raw, floors = MAX_FLOORS, extentFt = 4000) {
  if (!raw || typeof raw !== 'object') return null;
  const type = LINK_TYPES.includes(raw.type) ? raw.type : null;
  if (!type) return null;
  const top = Math.max(0, floors - 1);
  const from = intIn(raw.from, 0, 0, top);
  const to = intIn(raw.to, 0, 0, top);
  if (from === to) return null; // a link has to connect two different levels
  return {
    id: intIn(raw.id, 0, 0, Number.MAX_SAFE_INTEGER),
    type,
    from, to,
    x: num(raw.x, 0, -extentFt, extentFt),
    z: num(raw.z, 0, -extentFt, extentFt),
    rotationY: wrapAngle(raw.rotationY),
    data: cleanData(raw.data),
  };
}

// ---------- mutation helpers ----------

export function addProp(state, type, opts = {}) {
  if (state.props.length >= MAX_PROPS) return null;
  const prop = normalizeProp(
    { floor: state.currentFloor, ...opts, type },
    state.floors.length
  );
  if (!prop) return null;
  prop.id = nextId(state);
  state.props.push(prop);
  return prop;
}

export function removeProp(state, id) {
  const i = state.props.findIndex((p) => p.id === id);
  if (i < 0) return false;
  state.props.splice(i, 1);
  return true;
}

export const getProp = (state, id) => state.props.find((p) => p.id === id) || null;

export const propsOnFloor = (state, floorIndex) =>
  state.props.filter((p) => p.floor === floorIndex);

export function addLink(state, type, opts = {}) {
  if (state.links.length >= MAX_LINKS) return null;
  const link = normalizeLink({ ...opts, type }, state.floors.length);
  if (!link) return null;
  link.id = nextId(state);
  state.links.push(link);
  return link;
}

export function removeLink(state, id) {
  const i = state.links.findIndex((l) => l.id === id);
  if (i < 0) return false;
  state.links.splice(i, 1);
  return true;
}

export const linksOnFloor = (state, floorIndex) =>
  state.links.filter((l) => l.from === floorIndex || l.to === floorIndex);

// Highest id in use + 1 — used after loading a file so freshly placed props
// can't collide with ids that came in from the save. Polygon rooms draw on the
// same counter, so they're counted here too.
export function reseedIds(state) {
  let max = 0;
  for (const p of state.props) max = Math.max(max, p.id);
  for (const l of state.links) max = Math.max(max, l.id);
  for (const f of state.floors || []) {
    for (const s of f.shapes || []) max = Math.max(max, s.id || 0);
    // Phase 25's free-standing walls take ids off this same counter, so a wall
    // line and a room can never name the same number.
    for (const l of f.walls || []) max = Math.max(max, l.id || 0);
  }
  state.nextId = max + 1;
  return state.nextId;
}

// Which grid cell a prop currently sits over. Props aren't stored per cell, but
// snapping, collision and floor-cut lookups all need the mapping.
export const propCell = (prop) => ({
  x: Math.floor(prop.x / CELL),
  y: Math.floor(prop.z / CELL),
});
