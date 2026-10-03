// builtin-models.js — the Blender pack, as catalog rows that name a file.
//
// `assets/models/` holds fifteen .glb files (HISTORY #761 to #765), each one
// catalog row's silhouette in the page's own axes: faces +Z, base on y=0,
// feet scaled to metres. models.js already made an imported file wear a
// catalog row; this is the same move for a file the build ships. A built-in
// row carries `file` (an id below) and `fit` ('contain' or 'stretch'), keeps
// its `geo` key, and render.js draws the file when it has the bytes and the
// procedural builder when it does not.
//
// Two rules decide which rows name a file, and the test holds both:
//
//   1. A file leaves out what budget.json's `left` lists (the round top, the
//      pegboard, the tote bins, the second tier), so a row whose builder
//      parameters ask for one of those stays procedural.
//   2. A row whose dimensions are the source row's is `contain`; a row that
//      wants other dimensions from the same file is `stretch`, which scales
//      each axis by row / source row rather than by an absolute box, so the
//      source row itself is drawn at exactly the file's own scale (a labbench
//      file is 3.58 ft tall against a 3 ft row because of its tap, and a
//      plain fit into 3 ft would shrink the whole bench).
//
// Colour is not a rule any more (HISTORY #819). A file carries its source
// row's colours in its vertices, and `tints` below says how each of those
// colours was made from the row's one `color`, by role, the way render.js's
// builder makes it. `retint` reads a vertex's role off its colour and paints
// it as the same role of another colour, so `teacher-desk` wears desk.glb in
// its own brown and a recoloured prop (Phase 11's `data.color`) keeps the
// file's shape.
//
// Pure: no DOM, no three. `fetchBuiltins` takes the fetch it should use.

import { parseModelFile, readModel, fitModel, bakeFit, FT_TO_M, bytesToBase64, base64ToBytes } from './gltf.js';

export const BUILTIN_DIR = 'assets/models/';

// The one tint (HISTORY #818). `dl` and `ds` move lightness and saturation in
// sRGB, which is the space a catalog row's `#rrggbb` is written in: a leg at
// -0.25 is a darker leg. Until #818 render.js did this in three.js's linear
// working space, where a mid blue has a lightness of 0.24 and the same -0.25
// is black. render.js's `tint` is this function, so the page, the pack's
// palette and `retint` cannot disagree. Takes and returns sRGB in 0..1.
export function tintSrgb([r, g, b], dl, ds = 0) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const c = max - min;
    s = l <= 0.5 ? c / (max + min) : c / (2 - max - min);
    if (max === r) h = (g - b) / c + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / c + 2;
    else h = (r - g) / c + 4;
    h /= 6;
  }
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const s2 = clamp(s + ds), l2 = clamp(l + dl);
  if (s2 === 0) return [l2, l2, l2];
  const q = l2 <= 0.5 ? l2 * (1 + s2) : l2 + s2 - l2 * s2;
  const p = 2 * l2 - q;
  const hue = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * 6 * (2 / 3 - t);
    return p;
  };
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)];
}

export const hexToSrgb = (hex) => {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
};
export const srgbToHex = (rgb) => rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255)
  .toString(16).padStart(2, '0')).join('');
const toLinear = (c) => (c < 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toSrgb = (c) => (c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

// A role's colour for a row painted `color`: a string is a fixed colour (the
// lab bench's tap, the plant's pot), an array is tint steps applied in order,
// each `[dl]` or `[dl, ds]`, and `[]` is the row's colour itself.
export function roleSrgb(recipe, color) {
  if (typeof recipe === 'string') return hexToSrgb(recipe);
  let c = hexToSrgb(color);
  for (const [dl, ds = 0] of recipe) c = tintSrgb(c, dl, ds);
  return c;
}

// id -> the catalog row the file was built against, and how render.js's
// builder for that row makes each colour in the file. budget.json in
// tools/blender carries the same pairing and each role's colour as hex;
// validate.mjs checks that file's side against `tints` and
// test/builtin-models.test.mjs checks this side against it.
const CHAIR = { seat: [], back: [[-0.08]], leg: [[-0.25]] };
const SHELF = { side: [[-0.12]], shelf: [[0.06]] };
export const BUILTIN_MODELS = {
  'chair-basic': { source: 'student-chair', tints: CHAIR },
  'chair-stack': { source: 'chair-stack', tints: { ...CHAIR, back: [[-0.06]] } },
  'chair-task': { source: 'chair-task', tints: { ...CHAIR, caster: [[-0.35]] } },
  'chair-rocker': { source: 'chair-rocking', tints: CHAIR },
  stool: { source: 'stool-lab-24', tints: { seat: [[0.15]], leg: [[-0.2]] } },
  sofa: { source: 'sofa', tints: { frame: [[-0.12]], cushion: [[0.08]], backcushion: [[0.05]] } },
  desk: { source: 'student-desk', tints: { top: [], leg: [[-0.28]] } },
  table: { source: 'table-seminar-6', tints: { top: [], leg: [[-0.3]] } },
  workstation: { source: 'desk-computer', tints: { top: [], leg: [[-0.28]], dark: [[-0.45, -0.2]], keys: [[0.15]] } },
  counter: { source: 'desk-circulation', tints: { body: [], top: [[0.12]] } },
  labbench: {
    source: 'bench-lab',
    tints: { top: [[-0.3]], body: [[0.18]], door: [[0.18], [0.06]], handle: [[-0.1]], tap: '#b8bcc2' },
  },
  shelf: { source: 'bookshelf-full', tints: SHELF },
  cubby: { source: 'cubby-unit', tints: { ...SHELF, divider: [[-0.15]] } },
  locker: { source: 'locker-bank', tints: { body: [[-0.18]], door: [], vent: [[-0.3]] } },
  plant: { source: 'plant-floor', tints: { pot: '#a9623f', stem: '#7a5230', leaf: [], leaf2: [[0.05]], leaf3: [[-0.06]] } },
};

// A file's palette for a row painted `color`: role -> 'rrggbb'.
export function builtinPalette(id, color) {
  const out = {};
  for (const [role, recipe] of Object.entries(BUILTIN_MODELS[id].tints)) out[role] = srgbToHex(roleSrgb(recipe, color));
  return out;
}

// Repaint a parsed file from its source row's colour to another. Each vertex
// is matched to a role by its colour (to one 8-bit step, which is what the
// file's 16-bit colours and the palette's hex agree to) and takes that role's
// colour for `to`. A colour no role claims is left alone, and the validator
// fails a file that has one. Mutates and returns `model`; colours are linear,
// as gltf.js hands them over.
export function retint(model, id, from, to) {
  const roles = Object.values(BUILTIN_MODELS[id].tints).map((recipe) => ({
    was: roleSrgb(recipe, from).map((c) => Math.round(c * 255)),
    now: roleSrgb(recipe, to).map(toLinear),
  }));
  for (const part of model.meshes) {
    const c = part.color;
    for (let i = 0; i < c.length; i += 3) {
      const r = Math.round(toSrgb(c[i]) * 255), g = Math.round(toSrgb(c[i + 1]) * 255), b = Math.round(toSrgb(c[i + 2]) * 255);
      const role = roles.find(({ was }) => Math.abs(was[0] - r) <= 1 && Math.abs(was[1] - g) <= 1 && Math.abs(was[2] - b) <= 1);
      if (!role) continue;
      c[i] = role.now[0]; c[i + 1] = role.now[1]; c[i + 2] = role.now[2];
    }
  }
  return model;
}

export const BUILTIN_IDS = Object.keys(BUILTIN_MODELS);

export const builtinFile = (id) => `${BUILTIN_DIR}${id}.glb`;

// The size a file is drawn at for a row: the file's own box, scaled per axis
// by how far the row's dimensions are from its source row's. `source` is that
// source row (w/d/h) and `bbox` the parsed file's, which is in metres: the
// page works in feet and gltf.js only converts on the way out. A source row
// gets the file's own box back, to the last bit.
export function builtinBox(entry, source, bbox) {
  const sx = (bbox.maxX - bbox.minX) / FT_TO_M;
  const sy = (bbox.maxY - bbox.minY) / FT_TO_M;
  const sz = (bbox.maxZ - bbox.minZ) / FT_TO_M;
  return {
    w: sx * (entry.w / source.w),
    d: sz * (entry.d / source.d),
    h: sy * (entry.h / source.h),
  };
}

// Parsed, fitted, baked into catalog coordinates and painted: what render.js
// merges into one geometry. `color` is the paint this prop wears, the row's
// own unless it was recoloured. Throws whatever gltf.js throws about a bad
// file.
export function loadBuiltin(bytes, entry, source, color = entry.color) {
  const model = readModel(parseModelFile(bytes));
  bakeFit(model, fitModel(model.bbox, builtinBox(entry, source, model.bbox), entry.fit));
  const same = String(color).toLowerCase() === String(source.color).toLowerCase();
  return same ? model : retint(model, entry.file, source.color, color);
}

// Whether a row draws from a file: any row that names one, in any paint.
export const drawsFromFile = (entry) => !!(entry && entry.file);

// The file ids a set of prop types needs that are not loaded yet.
export function neededBuiltins(types, entryOf, have) {
  const want = new Set();
  for (const type of types) {
    const e = entryOf(type);
    if (e && e.file && BUILTIN_MODELS[e.file] && !have.has(e.file)) want.add(e.file);
  }
  return [...want];
}

// Fetch the named files. Nothing here hides a miss: a file that could not be
// read comes back in `failed` with its reason, and the page says so.
export async function fetchBuiltins(ids, fetchFn, base = './') {
  const bytes = new Map();
  const failed = [];
  await Promise.all(ids.map(async (id) => {
    try {
      const resp = await fetchFn(`${base}${builtinFile(id)}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      bytes.set(id, new Uint8Array(await resp.arrayBuffer()));
    } catch (err) {
      failed.push({ id, message: err && err.message ? err.message : String(err) });
    }
  }));
  return { bytes, failed };
}

// The files a walk export carries (HISTORY #820): the ids a design's props
// name, as one JSON object of base64, which share.js's codec then deflates
// into the export's `sg-models` slot. An exported walk opens from file:// and
// asks the network for nothing, so the bytes ride in the file or not at all.
export function packBuiltins(bytesById) {
  const out = {};
  for (const id of [...bytesById.keys()].sort()) out[id] = bytesToBase64(bytesById.get(id));
  return JSON.stringify(out);
}

// The other way. An id this build has no row for is dropped: the file would
// have no source row to be fitted against.
export function unpackBuiltins(text) {
  const bytes = new Map();
  for (const [id, b64] of Object.entries(JSON.parse(text))) {
    if (BUILTIN_MODELS[id] && typeof b64 === 'string') bytes.set(id, base64ToBytes(b64));
  }
  return bytes;
}
