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
// Three rules decide which rows name a file, and the test holds all three:
//
//   1. A file carries its source row's colours in its vertices, so a row
//      draws from it only if its colour is the source row's.
//   2. A file leaves out what budget.json's `left` lists (the round top, the
//      pegboard, the tote bins, the second tier), so a row whose builder
//      parameters ask for one of those stays procedural.
//   3. A row whose dimensions are the source row's is `contain`; a row that
//      wants other dimensions from the same file is `stretch`, which scales
//      each axis by row / source row rather than by an absolute box, so the
//      source row itself is drawn at exactly the file's own scale (a labbench
//      file is 3.58 ft tall against a 3 ft row because of its tap, and a
//      plain fit into 3 ft would shrink the whole bench).
//
// A recoloured prop (Phase 11's `data.color`) draws procedurally: the paint
// is baked into the vertices, and a file's are already baked.
//
// Pure: no DOM, no three. `fetchBuiltins` takes the fetch it should use.

import { parseModelFile, readModel, fitModel, bakeFit, FT_TO_M } from './gltf.js';

export const BUILTIN_DIR = 'assets/models/';

// id -> the catalog row the file was built against. budget.json in
// tools/blender carries the same pairing and validate.mjs checks that file's
// side; test/builtin-models.test.mjs checks this side against it.
export const BUILTIN_MODELS = {
  'chair-basic': { source: 'student-chair' },
  'chair-stack': { source: 'chair-stack' },
  'chair-task': { source: 'chair-task' },
  'chair-rocker': { source: 'chair-rocking' },
  stool: { source: 'stool-lab-24' },
  sofa: { source: 'sofa' },
  desk: { source: 'student-desk' },
  table: { source: 'table-seminar-6' },
  workstation: { source: 'desk-computer' },
  counter: { source: 'desk-circulation' },
  labbench: { source: 'bench-lab' },
  shelf: { source: 'bookshelf-full' },
  cubby: { source: 'cubby-unit' },
  locker: { source: 'locker-bank' },
  plant: { source: 'plant-floor' },
};

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

// Parsed, fitted and baked into catalog coordinates: what render.js merges
// into one geometry. Throws whatever gltf.js throws about a bad file.
export function loadBuiltin(bytes, entry, source) {
  const model = readModel(parseModelFile(bytes));
  return bakeFit(model, fitModel(model.bbox, builtinBox(entry, source, model.bbox), entry.fit));
}

// Whether a row would draw from a file given the paint on this one prop.
export const drawsFromFile = (entry, variant = '') => !!(entry && entry.file && !variant);

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
