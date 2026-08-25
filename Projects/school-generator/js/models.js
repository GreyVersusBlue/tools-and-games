// models.js — the imported model library: a glTF file, wearing a catalog row.
//
// Phase 9's first item, in one sentence: `assets/models/` finally earns its
// keep, and a catalog row points at a file instead of at a `geo` key. This is
// the record that makes that true, and the seam is deliberately narrow —
// gltf.js knows the format and nothing about props; catalog.js knows how to
// register a row and nothing about files; this file is the one place that
// knows both.
//
// The design decision worth stating: an imported model lives *in the design*,
// not in the browser. The overlay (Phase 8) already set the precedent and the
// reasoning is the same one, in the same words — keeping the file outside the
// save and referring to it by id makes saves small and makes a design you
// email somebody arrive without the furniture in it, which is the wrong half
// to lose. So `state.models[]` carries the bytes, `serialize` grew an
// `omitModels` escape hatch for the autosave the way it grew `omitOverlay`,
// and a design with imported props in it is a design you can send.
//
// The row a model produces is a *real* catalog row: same fields, same
// contract, so every module that reads the catalog — propplace's footprint,
// collide's obstacle, blueprint's symbol, takeoff's count, autofurnish's
// choice — treats an imported chair exactly like a built-in one, and none of
// them needed a line changed for it.

import { MOUNTS } from './props.js';
import { MAX_MODEL_BYTES, bytesToBase64, base64ToBytes, toBytes, parseModelFile } from './gltf.js';

// Types are namespaced so an imported row can never shadow (or be shadowed
// by) a built-in one, and so a prop referring to a model that has since been
// deleted is recognisably an *import* that went missing rather than a typo.
export const MODEL_PREFIX = 'model:';
export const MODEL_CATEGORY = 'Imported';
export const MODEL_MIME = 'model/gltf-binary';

// How many, and how much. The per-file cap is gltf.js's; this is the cap on
// the library as a whole, which is what actually decides whether a design
// still fits in localStorage.
export const MAX_MODELS = 24;
export const MAX_LIBRARY_BYTES = 24 * 1024 * 1024;

// A model's default footprint, when nothing else is known: a 3ft cube is the
// size of a piece of furniture rather than the size of a building, so an
// import that arrives before anybody has typed a dimension is at least in the
// right order of magnitude.
export const DEFAULT_BOX = { w: 3, d: 3, h: 3 };
export const MIN_DIM = 0.25;
export const MAX_DIM = 60;

export const FIT_MODES = ['contain', 'stretch'];

const clampDim = (v, fallback) =>
  (Number.isFinite(v) ? Math.min(MAX_DIM, Math.max(MIN_DIM, v)) : fallback);

const cleanName = (s, fallback) => {
  const t = typeof s === 'string' ? s.trim().slice(0, 40) : '';
  return t || fallback;
};

// A file name, minus its path and extension, is the best name anybody has
// offered — "Oak Chair.glb" is a better palette label than "Model 3".
export function nameFromFile(filename) {
  const base = String(filename || '').split(/[\\/]/).pop() || '';
  return cleanName(base.replace(/\.(glb|gltf)$/i, '').replace(/[_-]+/g, ' '), '');
}

export const modelDataURL = (bytes) => `data:${MODEL_MIME};base64,${bytesToBase64(bytes)}`;

// The bytes back out of a record, for whoever actually has to parse them.
export function modelBytes(model) {
  if (!model || typeof model.data !== 'string') return null;
  const comma = model.data.indexOf(',');
  if (comma < 0 || !/^data:[^,]*;base64$/i.test(model.data.slice(0, comma))) return null;
  try {
    return base64ToBytes(model.data.slice(comma + 1));
  } catch {
    return null;
  }
}

// Roughly what a record costs in a save file. Base64 is four bytes out for
// every three in, and the record's own fields are noise beside that.
export const modelSize = (model) =>
  (model && typeof model.data === 'string' ? model.data.length : 0);

export const librarySize = (list) =>
  (list || []).reduce((sum, m) => sum + modelSize(m), 0);

// Ids count up from the highest one already in the library rather than from
// its length, so deleting a model can never hand its id — and with it every
// prop placed from it — to the next import.
export function nextModelId(list) {
  let max = 0;
  for (const m of list || []) {
    const n = /^m(\d+)$/.exec(String(m && m.id || ''));
    if (n) max = Math.max(max, Number(n[1]));
  }
  return `m${max + 1}`;
}

// The record. `source` is the file's bytes (or an already-made data URL, so a
// round trip through a save doesn't have to re-encode).
export function makeModel(source, opts = {}) {
  const data = typeof source === 'string' ? source : modelDataURL(toBytes(source));
  const bytes = typeof source === 'string' ? null : toBytes(source);
  if (bytes && bytes.byteLength > MAX_MODEL_BYTES) {
    throw new Error(`Model is ${(bytes.byteLength / 1048576).toFixed(1)} MB; the limit is ${MAX_MODEL_BYTES / 1048576} MB`);
  }
  const mount = MOUNTS.includes(opts.mount) ? opts.mount : 'floor';
  return {
    id: typeof opts.id === 'string' && opts.id ? opts.id : 'm1',
    name: cleanName(opts.name, 'Imported Model'),
    w: clampDim(opts.w, DEFAULT_BOX.w),
    d: clampDim(opts.d, DEFAULT_BOX.d),
    h: clampDim(opts.h, DEFAULT_BOX.h),
    // Wall and ceiling mounts keep their own default heights the way the
    // built-in rows do; a floor-standing model sits at zero.
    y: Number.isFinite(opts.y) ? Math.min(MAX_DIM, Math.max(0, opts.y)) : (mount === 'floor' ? 0 : 4),
    mount,
    fit: FIT_MODES.includes(opts.fit) ? opts.fit : 'contain',
    // The tint the palette swatch and the blueprint symbol use. The model's
    // own vertex colours are what actually gets drawn — this is the one
    // colour everything *else* asks a catalog row for.
    color: /^#[0-9a-fA-F]{6}$/.test(opts.color || '') ? opts.color : '#8a8f96',
    site: !!opts.site,
    data,
  };
}

// Whatever a save file offered, or nothing. Fails the way every other
// optional record in this codebase fails: a model that can't be read is a
// model that isn't there, never a design that won't open.
export function normalizeModel(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.data !== 'string' || !raw.data.startsWith('data:')) return null;
  if (raw.data.length > MAX_MODEL_BYTES * 2) return null; // base64 of an over-cap file
  const id = typeof raw.id === 'string' && /^m\d+$/.test(raw.id) ? raw.id : null;
  if (!id) return null;
  try {
    return makeModel(raw.data, { ...raw, id });
  } catch {
    return null;
  }
}

// The whole library out of a save file, deduplicated by id and held to both
// caps — count first, then bytes, so a design that is over the size cap loses
// its last import rather than all of them.
export function normalizeModels(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  let bytes = 0;
  for (const item of raw.slice(0, MAX_MODELS * 2)) {
    const model = normalizeModel(item);
    if (!model || seen.has(model.id)) continue;
    const size = modelSize(model);
    if (bytes + size > MAX_LIBRARY_BYTES) continue;
    bytes += size;
    seen.add(model.id);
    out.push(model);
    if (out.length >= MAX_MODELS) break;
  }
  return out;
}

// ---------- what the rest of the build sees ----------

export const modelType = (id) => `${MODEL_PREFIX}${id}`;
export const isModelType = (type) => typeof type === 'string' && type.startsWith(MODEL_PREFIX);
export const modelIdOf = (type) => (isModelType(type) ? type.slice(MODEL_PREFIX.length) : null);

// A record, as a catalog row. Everything downstream of `catalogEntry` reads
// this and nothing else — which is why an imported prop snaps to a wall,
// stops a walker, draws on a plan and appears in the bill of materials
// without any of those modules knowing that files exist.
export function modelRow(model) {
  if (!model) return null;
  return {
    type: modelType(model.id),
    name: model.name,
    category: MODEL_CATEGORY,
    icon: '📦',
    w: model.w,
    d: model.d,
    h: model.h,
    y: model.y,
    color: model.color,
    mount: model.mount,
    geo: 'model',
    ...(model.site ? { site: true } : {}),
    // The one field that is not catalog vocabulary: which library row to draw
    // this from. render.js reads it; nothing else looks.
    model: model.id,
  };
}

export const modelRows = (list) => (list || []).map(modelRow).filter(Boolean);

export const modelsOf = (state) => (state && Array.isArray(state.models) ? state.models : []);

export const findModel = (list, id) => (list || []).find((m) => m.id === id) || null;

// ---------- editing the library ----------

// Add, with both caps enforced and the id assigned here rather than by the
// caller — the same arrangement `state.nextId` has for everything else that
// needs a name it can't collide on.
export function addModel(list, model) {
  const current = list || [];
  if (current.length >= MAX_MODELS) {
    throw new Error(`This design already has ${MAX_MODELS} imported models`);
  }
  const size = modelSize(model);
  if (librarySize(current) + size > MAX_LIBRARY_BYTES) {
    throw new Error(`Imported models would total more than ${MAX_LIBRARY_BYTES / 1048576} MB`);
  }
  const next = { ...model, id: nextModelId(current) };
  return { models: current.concat([next]), model: next };
}

// Remove — and say what it costs. Props placed from a deleted model keep
// their type (props.js has always let an unknown type survive, so a save
// round trip is lossless), but nothing will draw them, so the caller has to
// be able to tell somebody how many are about to go quiet.
export function removeModel(list, id) {
  return (list || []).filter((m) => m.id !== id);
}

export const modelUseCount = (state, id) =>
  (state && Array.isArray(state.props) ? state.props : [])
    .filter((p) => p.type === modelType(id)).length;

export function updateModel(list, id, patch) {
  return (list || []).map((m) => (m.id === id ? makeModel(m.data, { ...m, ...patch, id: m.id }) : m));
}

// A line for the panel: what it is, how big it stands, and what it costs.
export function describeModel(model, uses = null) {
  if (!model) return '';
  const mb = modelSize(model) / 1048576;
  const size = mb >= 0.1 ? `${mb.toFixed(1)} MB` : `${Math.round(modelSize(model) / 1024)} KB`;
  const dims = `${model.w.toFixed(1)} × ${model.d.toFixed(1)} × ${model.h.toFixed(1)} ft`;
  const used = uses === null ? '' : ` · ${uses} placed`;
  return `${dims} · ${size}${used}`;
}

// The whole import, as the file input's handler wants it: bytes in, a record
// out, having actually parsed the file so a bad one fails *here* rather than
// three seconds later when the renderer asks for geometry.
export function importModel(bytes, filename, opts = {}) {
  const parsed = parseModelFile(bytes); // throws with a readable message
  const name = cleanName(opts.name, nameFromFile(filename)) || 'Imported Model';
  const model = makeModel(bytes, { ...opts, name });
  return { model, json: parsed.json };
}
