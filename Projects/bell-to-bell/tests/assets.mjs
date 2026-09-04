// tests/assets.mjs — what the room weighs.
//
// The room shipped with 142 MB of Assets/ and no way to say which of it the
// game actually opens. This walks the tree, resolves every path
// `data/assets.json` names — including the `.bin` sidecars and texture
// folders a `.gltf` names but the manifest does not — and sorts every file on
// disk into three buckets:
//
//   referenced   the game loads it
//   cataloged    an `_alternates` block names it: the set we chose against,
//                kept on purpose so the choice stays re-makeable
//   unreferenced neither
//
// It fails, rather than prints, on four things:
//   1. a referenced path that is not on disk (the game would 404)
//   2. a cataloged path that is not on disk (assets.json advertising a ghost)
//   3. a `_pruned` path that IS on disk (something deleted came back without
//      the record changing with it)
//   4. either byte total over its `_budget` ceiling
//
// Run from tests/: `node assets.mjs`. smoke.mjs imports auditAssets() for the
// same budget assertion, so the ceiling is enforced by the suite people
// already run as well as by this one.

import fs from 'fs';
import path from 'path';

const ROOT = '..';
const MANIFEST = `${ROOT}/data/assets.json`;

// --- the tree ---------------------------------------------------------------

function walk(dir, out = new Map()) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.posix.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.set(p, fs.statSync(p).size);
  }
  return out;
}

// --- resolving what the manifest means --------------------------------------

// A glTF names its own buffers and images by relative URI. `wall_clock_1k.gltf`
// is 3 KB of JSON pointing at a 1.5 MB .bin and five jpgs; counting the .gltf
// alone would call this prop free. Character glTFs embed everything as data:
// URIs instead and legitimately name nothing.
function gltfSidecars(file) {
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return []; }
  const dir = path.posix.dirname(file);
  const uris = [...(doc.buffers || []), ...(doc.images || [])].map(x => x && x.uri);
  return uris
    .filter(u => u && !u.startsWith('data:'))
    .map(u => path.posix.join(dir, decodeURIComponent(u)));
}

// A model path pulls its own sidecars in with it; anything else is just itself.
function expand(p) {
  return p.endsWith('.gltf') ? [p, ...gltfSidecars(p)] : [p];
}

// materials.js builds three or four jpg names out of each texture entry: diff,
// nor_gl, and either the packed arm or a plain rough. The manifest stores the
// folder and the base name, so the filenames only exist here and there.
function textureFiles({ dir, base, packedArm = true }) {
  return [
    `${dir}/${base}_diff_1k.jpg`,
    `${dir}/${base}_nor_gl_1k.jpg`,
    packedArm ? `${dir}/${base}_arm_1k.jpg` : `${dir}/${base}_rough_1k.jpg`
  ];
}

// An `_alternates` entry can be a folder (a whole texture set) or a single
// file (one painting). A folder counts every file under it.
function entryFiles(p, tree) {
  const abs = `${ROOT}/${p}`;
  if (tree.has(abs)) return [abs];
  const prefix = abs.endsWith('/') ? abs : abs + '/';
  return [...tree.keys()].filter(f => f.startsWith(prefix));
}

export function auditAssets() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const tree = walk(`${ROOT}/Assets`);

  const referenced = new Set();
  const add = p => { for (const f of expand(`${ROOT}/${p}`)) referenced.add(f); };

  for (const tex of Object.values(manifest.textures || {})) {
    for (const f of textureFiles(tex)) referenced.add(`${ROOT}/${f}`);
  }
  for (const p of Object.values(manifest.models || {})) add(p);
  for (const p of manifest.characters?.outfits || []) add(p);
  if (manifest.art?.frame) add(manifest.art.frame);
  for (const p of Object.values(manifest.art?.paintings || {})) add(p);
  for (const p of Object.values(manifest.props || {})) add(p);

  // Cataloged: on disk on purpose, never loaded.
  const cataloged = new Set();
  const alternates = [];
  for (const [group, list] of Object.entries(manifest._alternates || {})) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      alternates.push({ group, ...entry });
      for (const f of entryFiles(entry.path, tree)) {
        if (!referenced.has(f)) cataloged.add(f);
      }
    }
  }

  const pruned = manifest._pruned?.paths || [];
  const budget = manifest._budget || {};

  const bytes = set => [...set].reduce((n, f) => n + (tree.get(f) || 0), 0);
  const unreferenced = [...tree.keys()].filter(f => !referenced.has(f) && !cataloged.has(f));

  const problems = [];
  for (const f of referenced) {
    if (!tree.has(f)) problems.push(`referenced but missing: ${f.slice(ROOT.length + 1)}`);
  }
  for (const a of alternates) {
    if (!entryFiles(a.path, tree).length) {
      problems.push(`_alternates.${a.group} advertises a path that is gone: ${a.path}`);
    }
  }
  for (const p of pruned) {
    if (entryFiles(p, tree).length) {
      problems.push(`_pruned still on disk: ${p}`);
    }
  }

  const totals = {
    referenced: { count: referenced.size, bytes: bytes(referenced) },
    cataloged: { count: cataloged.size, bytes: bytes(cataloged) },
    unreferenced: { count: unreferenced.length, bytes: unreferenced.reduce((n, f) => n + tree.get(f), 0) },
    all: { count: tree.size, bytes: [...tree.values()].reduce((a, b) => a + b, 0) }
  };

  // A budget that can be deleted is a budget, not a ceiling. Its absence is
  // the failure, so nobody gets past this check by removing the block.
  if (budget.referencedBytes == null || budget.unreferencedBytes == null) {
    problems.push('data/assets.json has no _budget with referencedBytes and unreferencedBytes');
  }
  if (budget.referencedBytes != null && totals.referenced.bytes > budget.referencedBytes) {
    problems.push(`referenced bytes ${totals.referenced.bytes} over budget ${budget.referencedBytes}`);
  }
  if (budget.unreferencedBytes != null && totals.unreferenced.bytes > budget.unreferencedBytes) {
    problems.push(`unreferenced bytes ${totals.unreferenced.bytes} over budget ${budget.unreferencedBytes}`);
  }

  return { totals, problems, budget, unreferenced: unreferenced.map(f => f.slice(ROOT.length + 1)) };
}

// --- report -----------------------------------------------------------------

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const { totals, problems, budget, unreferenced } = auditAssets();
  const mb = n => (n / 1048576).toFixed(1) + ' MB';
  const row = (k, t) => console.log(`  ${k.padEnd(13)} ${String(t.count).padStart(5)} files  ${mb(t.bytes).padStart(9)}`);

  console.log('asset manifest\n');
  row('referenced', totals.referenced);
  row('cataloged', totals.cataloged);
  row('unreferenced', totals.unreferenced);
  row('total', totals.all);
  console.log(`\n  budget: referenced <= ${mb(budget.referencedBytes || 0)}, unreferenced <= ${mb(budget.unreferencedBytes || 0)}`);

  if (process.argv.includes('--list')) {
    console.log('\nunreferenced files:');
    for (const f of unreferenced) console.log('  ' + f);
  }

  if (problems.length) {
    console.log('\n' + problems.length + ' PROBLEMS');
    for (const p of problems) console.log('  ' + p);
  } else {
    console.log('\nall green');
  }
  process.exit(problems.length ? 1 : 0);
}
